import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { AccountOptions, Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useExport, useToast } from '../components/ui';
import { AttachButton, DocList } from '../components/docs';
import {
  CLASS_LABEL, DEFAULT_LIFE, MAINT_LABEL, assetStatus, assetTie, assetsOf, attachToAsset, depreciationSchedule, disposeAsset, lastClosedPeriod, logMaintenance,
  maintenanceDue, maintenanceTie, monthlyDepreciation, postDepreciation, saveAsset, unpostedDepreciation,
} from '../../core/assets';
import { PREPAID_EXPENSE, PREPAID_LABEL, amortizePrepaids, prepaidEnd, prepaidStatus, prepaidTie, prepaidsOf, savePrepaid, unpostedPrepaidMonths } from '../../core/prepaids';
import { lastDayOfPeriod, periodLabel, periodsBetween, shortDate, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import type { AssetClass, ID, MaintenanceEntry, PrepaidKind } from '../../core/types';

const errList = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);

function useAssetsAccess() {
  const { user } = useBooks();
  return can(user, 'view.reports');
}

function NoAccess({ title }: { title: string }) {
  return <PageHead eyebrow="Assets & debt" title={title} lede="Your role doesn't include fixed assets, prepaids or debt." />;
}

function addMonths(period: string, n: number): string {
  let [y, m] = period.split('-').map(Number);
  m += n;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// ── Fixed assets register ────────────────────────────────────────────────
export function FixedAssetsPage() {
  const { state, user, visible, stores, version } = useBooks();
  const [sp, setSp] = useSearchParams();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ok = useAssetsAccess();
  const today = todayInChicago();
  const store = sp.get('store') ?? '';
  const text = (sp.get('q') ?? '').toLowerCase();
  const showDisposed = sp.get('disposed') === '1';
  const sel = sp.get('id');
  const all = useMemo(() => assetsOf(state).assets.filter((a) => visible.has(a.storeId)).map((a) => assetStatus(state, a, today)), [state, visible, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const tie = useMemo(() => assetTie(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ok) return <NoAccess title="Fixed assets" />;
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? '';
  const rows = all.filter((s) => (!store || s.a.storeId === store) && (showDisposed || !s.disposed) && (!text || `${s.a.tag} ${s.a.name} ${CLASS_LABEL[s.a.class]} ${code(s.a.storeId)}`.toLowerCase().includes(text)));
  const onBooks = all.filter((s) => !s.disposed);
  const cost = onBooks.reduce((a, s) => a + s.a.cost, 0);
  const accum = onBooks.reduce((a, s) => a + s.accumulated, 0);
  const monthly = onBooks.reduce((a, s) => a + s.monthly, 0);
  const unposted = unpostedDepreciation(state, today);
  const set = (k: string, v: string) => { const x = new URLSearchParams(sp); if (v) x.set(k, v); else x.delete(k); setSp(x, { replace: true }); };
  const selected = all.find((s) => s.a.id === sel || s.a.tag === sel);
  const tieRows = tie.rows.filter((r) => visible.has(r.storeId));
  return (
    <>
      <PageHead eyebrow="Assets & debt" title="Fixed assets" lede="The register: dispensers, canopies, tanks, coolers, kitchen and POS equipment, buildings and improvements, by store, with cost, in-service date, life and salvage. Book depreciation is straight-line by month.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('fixed-assets', ['Tag', 'Asset', 'Class', 'Store', 'In service', 'Life (months)', 'Cost', 'Salvage', 'Accumulated', 'Book value', 'Monthly', 'Warranty ends', 'Disposed'], rows.map((s) => [s.a.tag, s.a.name, CLASS_LABEL[s.a.class], code(s.a.storeId), s.a.inService, s.a.lifeMonths, csvMoney(s.a.cost), csvMoney(s.a.salvage), csvMoney(s.accumulated), csvMoney(s.bookValue), csvMoney(s.monthly), s.a.warrantyEnds ?? '', s.a.disposal?.date ?? '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Fixed assets" style={{ marginBottom: 20 }}>
        <Figure label="Cost on the books" value={<Money c={cost} whole dollar />} note={`${onBooks.length} assets`} />
        <Figure label="Accumulated depreciation" value={<Money c={accum} whole dollar />} note={`Through ${periodLabel(lastClosedPeriod(today))}`} />
        <Figure label="Net book value" value={<Money c={cost - accum} whole dollar />} />
        <Figure label="Depreciation next month" value={<Money c={monthly} whole dollar />} note={unposted.length ? `${unposted.length} month(s) not posted` : 'Every month is posted'} href="/assets/depreciation" />
      </section>
      <div className="stack">
        {selected && <AssetDetail id={selected.a.id} onSay={say} />}
        <section className="panel" aria-labelledby="fa-h">
          <div className="panel-head"><h2 id="fa-h">Register</h2></div>
          <div className="filters">
            <div className="field"><label htmlFor="fa-q">Search</label><input id="fa-q" type="search" value={sp.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} /></div>
            <div className="field"><label htmlFor="fa-store">Store</label><select id="fa-store" value={store} onChange={(e) => set('store', e.target.value)}><option value="">All stores</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
            <label className="check"><input type="checkbox" checked={showDisposed} onChange={(e) => set('disposed', e.target.checked ? '1' : '')} /> Show disposed</label>
          </div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Asset</th><th scope="col">Store</th><th scope="col">In service</th><th scope="col" className="num">Life</th><th scope="col" className="num">Cost</th><th scope="col" className="num">Accumulated</th><th scope="col" className="num">Book value</th><th scope="col" className="num">Monthly</th><th scope="col">Status</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.a.id}><td><Link to={`/assets?id=${s.a.id}`}>{s.a.tag}</Link> {s.a.name}<div className="muted small">{CLASS_LABEL[s.a.class]}</div></td><td>{code(s.a.storeId)}</td><td>{shortDate(s.a.inService)}</td>
                <td className="num">{s.a.method === 'none' ? '—' : `${Math.round(s.a.lifeMonths / 12 * 10) / 10} yr`}</td>
                <td className="num"><Money c={s.a.cost} /></td><td className="num"><Money c={s.accumulated} /></td><td className="num"><Money c={s.bookValue} /></td><td className="num"><Money c={s.monthly} /></td>
                <td>{s.disposed ? <span className="pill">Disposed {shortDate(s.a.disposal!.date)}</span> : s.a.method === 'none' ? <span className="pill">Not depreciated</span> : s.fullyDepreciated ? <span className="pill">Fully depreciated</span> : s.a.inService > today ? <span className="pill warn">Not in service yet</span> : <span className="pill ok">In service</span>}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
        <section className="panel" aria-labelledby="fat-h">
          <div className="panel-head"><h2 id="fat-h">Register vs the ledger</h2><span className="muted small">As of {shortDate(today)}</span></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Store</th><th scope="col" className="num">Register cost</th><th scope="col" className="num">1500 + 1510</th><th scope="col" className="num">Register accumulated</th><th scope="col" className="num">1590</th><th scope="col">Ties</th></tr></thead>
            <tbody>{tieRows.map((r) => <tr key={r.storeId}><td>{code(r.storeId)}</td><td className="num"><Money c={r.costRegister} /></td><td className="num"><Money c={r.costLedger} /></td><td className="num"><Money c={r.accumRegister} /></td><td className="num"><Money c={r.accumLedger} /></td><td><span className={'pill ' + (r.ok ? 'ok' : 'bad')}>{r.ok ? 'Ties' : `Off ${formatMoney(r.costLedger - r.costRegister + r.accumLedger - r.accumRegister, { dollarSign: true })}`}</span></td></tr>)}</tbody>
          </table></div>
          <TieOut items={[
            { label: tieRows.every((r) => r.costRegister === r.costLedger) ? 'Register cost ties to 1500 Equipment + 1510 Buildings by store' : 'Register cost does not tie to 1500 + 1510', ok: tieRows.every((r) => r.costRegister === r.costLedger), detail: <Money c={tieRows.reduce((a, r) => a + r.costLedger, 0)} dollar /> },
            { label: tieRows.every((r) => r.accumRegister === r.accumLedger) ? 'Accumulated depreciation ties to 1590 by store' : 'Accumulated depreciation does not tie to 1590: post the missing months', ok: tieRows.every((r) => r.accumRegister === r.accumLedger), detail: <Money c={tieRows.reduce((a, r) => a + r.accumLedger, 0)} dollar /> },
          ]} />
        </section>
        {can(user, 'assets.edit') && <NewAsset onSaved={say} />}
      </div>
      {toast}
      <Help k="fixedAssets" />
    </>
  );
}

function AssetDetail({ id, onSay }: { id: ID; onSay: (m: string) => void }) {
  const { state, books, user } = useBooks();
  const today = todayInChicago();
  const a = assetsOf(state).assets.find((x) => x.id === id)!;
  const st = assetStatus(state, a, today);
  const sched = depreciationSchedule(a, assetsOf(state).depreciationFrom);
  const [dz, setDz] = useState({ date: today, proceeds: '', reason: '' });
  const [errors, setErrors] = useState<string[]>([]);
  const sum = sched.reduce((s, r) => s + r.depreciation, 0);
  const posted = sched.filter((r) => r.txnId);
  const code = state.stores.find((s) => s.id === a.storeId)?.code;
  return (
    <section className="panel" aria-labelledby="ad-h">
      <div className="panel-head"><h2 id="ad-h">{a.tag} · {a.name}</h2><Link className="btn sm" to="/assets">Close</Link></div>
      <div className="panel-pad">
        <dl className="kv">
          <dt>Store</dt><dd>{code}</dd><dt>Class</dt><dd>{CLASS_LABEL[a.class]}</dd>
          <dt>Cost / salvage</dt><dd><Money c={a.cost} dollar /> / <Money c={a.salvage} dollar /></dd>
          <dt>In service · life</dt><dd>{shortDate(a.inService)} · {a.method === 'none' ? 'not depreciated' : `${a.lifeMonths} months, straight line`}</dd>
          <dt>Book value</dt><dd><Money c={st.bookValue} dollar /> after <Money c={st.accumulated} dollar /> accumulated</dd>
          {a.warrantyEnds && <><dt>Warranty</dt><dd>Ends {shortDate(a.warrantyEnds)}</dd></>}
          {a.vendor && <><dt>Vendor</dt><dd>{a.vendor}</dd></>}
          {a.notes && <><dt>Notes</dt><dd>{a.notes}</dd></>}
          <dt>Tax depreciation</dt><dd>{a.tax ? `${a.tax.method === 'none' ? 'Not depreciated' : `${a.tax.recoveryYears ? `${a.tax.recoveryYears}-year ` : ''}${a.tax.method === 'straight_line' ? 'straight line' : 'MACRS'}`}${a.tax.section179 ? `, §179 ${formatMoney(a.tax.section179, { dollarSign: true })}` : ''}${a.tax.bonusPct ? `, bonus ${a.tax.bonusPct}%` : ''}` : <span className="muted">No elections recorded (class defaults)</span>} · <Link to="/tax/depreciation">Book vs tax</Link></dd>
          <dt>Documents</dt><dd><DocList items={a.attachments} say={onSay} />{can(user, 'assets.edit') && <AttachButton books={books} userId={user.id} label="Attach" say={onSay} onFile={(x) => { attachToAsset(books, user, { kind: 'asset', id: a.id }, x); onSay(`Attached ${x.name}.`); }} />}</dd>
          {a.disposal && <><dt>Disposed</dt><dd>{shortDate(a.disposal.date)}: {a.disposal.reason}. Proceeds <Money c={a.disposal.proceeds} dollar />, {a.disposal.gainLoss >= 0 ? 'loss' : 'gain'} <Money c={Math.abs(a.disposal.gainLoss)} dollar /> · <Link to={`/books/transactions/${a.disposal.txnId}`}>{state.transactions.find((t) => t.id === a.disposal!.txnId)?.ref}</Link></dd></>}
        </dl>
      </div>
      {sched.length > 0 && <>
        <div className="table-wrap" data-static="1" tabIndex={0} role="region" aria-label="Depreciation schedule, scrolls" style={{ maxHeight: 320, overflowY: 'auto' }}><table className="t">
          <thead><tr><th scope="col">Month</th><th scope="col" className="num">Depreciation</th><th scope="col" className="num">Accumulated</th><th scope="col" className="num">Book value</th><th scope="col">Posted</th></tr></thead>
          <tbody>{sched.map((r) => <tr key={r.period}><td>{periodLabel(r.period)}</td><td className="num"><Money c={r.depreciation} /></td><td className="num"><Money c={r.accumulated} /></td><td className="num"><Money c={r.bookValue} /></td><td>{r.before ? <span className="muted small">Opening balance</span> : r.txnId ? <Link to={`/books/transactions/${r.txnId}`}>{state.transactions.find((t) => t.id === r.txnId)?.ref}</Link> : lastDayOfPeriod(r.period) <= today ? <span className="pill warn">Not posted</span> : <span className="muted small">Scheduled</span>}</td></tr>)}</tbody>
        </table></div>
        <TieOut items={[{ label: a.disposal ? 'Schedule stops the month before disposal' : sum === a.cost - a.salvage ? 'The months add to cost less salvage' : 'The months do not add to cost less salvage', ok: !!a.disposal || sum === a.cost - a.salvage, detail: <><Money c={sum} dollar /> over {sched.length} months · {posted.length} posted in these books</> }]} />
      </>}
      {!a.disposal && can(user, 'assets.edit') && (
        <div className="panel-pad">
          <h3 style={{ marginBottom: 8 }}>Dispose of this asset</h3>
          <Errors errors={errors} />
          <div className="form-grid">
            <div className="field"><label htmlFor="dz-d">Date</label><input id="dz-d" type="date" value={dz.date} onChange={(e) => setDz({ ...dz, date: e.target.value })} /></div>
            <div className="field"><label htmlFor="dz-p">Proceeds</label><input id="dz-p" className="num" inputMode="decimal" value={dz.proceeds} placeholder="0.00" onChange={(e) => setDz({ ...dz, proceeds: e.target.value })} /></div>
            <div className="field"><label htmlFor="dz-r">What happened</label><input id="dz-r" value={dz.reason} placeholder="Sold, scrapped, traded in" onChange={(e) => setDz({ ...dz, reason: e.target.value })} /></div>
          </div>
          <div className="actions" style={{ marginTop: 12 }}><button className="btn danger" onClick={() => { setErrors([]); try { const t = disposeAsset(books, user, a.id, { date: dz.date, proceeds: dz.proceeds.trim() ? parseMoney(dz.proceeds) ?? NaN : 0, reason: dz.reason }); onSay(`Disposed of ${a.tag}. Posted ${t.ref}.`); } catch (e) { setErrors(errList(e)); } }}>Record disposal</button><span className="muted small">Removes cost and accumulated depreciation; the difference from proceeds goes to 6410.</span></div>
        </div>
      )}
    </section>
  );
}

function NewAsset({ onSaved }: { onSaved: (m: string) => void }) {
  const { books, user, stores } = useBooks();
  const today = todayInChicago();
  const [d, setD] = useState({ name: '', class: 'equipment' as AssetClass, storeId: stores[0]?.id ?? '', costAccountId: 'acct_equipment', cost: '', salvage: '0', inService: today, life: String(DEFAULT_LIFE.equipment), warrantyEnds: '', vendor: '', post: false });
  const [errors, setErrors] = useState<string[]>([]);
  const up = (k: keyof typeof d, v: string | boolean) => setD({ ...d, [k]: v });
  return (
    <section className="panel panel-pad" aria-labelledby="na-h">
      <h2 id="na-h" style={{ marginBottom: 8 }}>Add an asset</h2>
      <Errors errors={errors} />
      <div className="form-grid">
        <div className="field"><label htmlFor="na-n">Name</label><input id="na-n" value={d.name} onChange={(e) => up('name', e.target.value)} /></div>
        <div className="field"><label htmlFor="na-c">Class</label><select id="na-c" value={d.class} onChange={(e) => setD({ ...d, class: e.target.value as AssetClass, life: String(DEFAULT_LIFE[e.target.value as AssetClass]), costAccountId: ['building', 'building_improvements', 'land'].includes(e.target.value) ? 'acct_buildings' : 'acct_equipment' })}>{(Object.keys(CLASS_LABEL) as AssetClass[]).map((k) => <option key={k} value={k}>{CLASS_LABEL[k]}</option>)}</select></div>
        <div className="field"><label htmlFor="na-s">Store</label><select id="na-s" value={d.storeId} onChange={(e) => up('storeId', e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
        <div className="field"><label htmlFor="na-a">Cost account</label><select id="na-a" value={d.costAccountId} onChange={(e) => up('costAccountId', e.target.value)}><AccountOptions filter={(a) => a.subtype === 'fixed_asset' && a.id !== 'acct_accum_dep'} /></select></div>
        <div className="field"><label htmlFor="na-co">Cost</label><input id="na-co" className="num" inputMode="decimal" value={d.cost} onChange={(e) => up('cost', e.target.value)} /></div>
        <div className="field"><label htmlFor="na-sv">Salvage</label><input id="na-sv" className="num" inputMode="decimal" value={d.salvage} onChange={(e) => up('salvage', e.target.value)} /></div>
        <div className="field"><label htmlFor="na-i">In service</label><input id="na-i" type="date" value={d.inService} onChange={(e) => up('inService', e.target.value)} /></div>
        <div className="field"><label htmlFor="na-l">Life (months)</label><input id="na-l" className="num" inputMode="numeric" value={d.life} onChange={(e) => up('life', e.target.value)} /></div>
        <div className="field"><label htmlFor="na-w">Warranty ends</label><input id="na-w" type="date" value={d.warrantyEnds} onChange={(e) => up('warrantyEnds', e.target.value)} /></div>
        <label className="check"><input type="checkbox" checked={d.post} onChange={(e) => up('post', e.target.checked)} /> Post the purchase from Trustmark</label>
      </div>
      <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => {
        setErrors([]);
        try {
          const a = saveAsset(books, user, { name: d.name, class: d.class, storeId: d.storeId, costAccountId: d.costAccountId, cost: parseMoney(d.cost) ?? NaN, salvage: parseMoney(d.salvage || '0') ?? NaN, inService: d.inService, lifeMonths: Number(d.life), method: d.class === 'land' ? 'none' : 'straight_line', warrantyEnds: d.warrantyEnds || undefined, vendor: d.vendor || undefined }, d.post ? { date: d.inService } : undefined);
          setD({ ...d, name: '', cost: '', salvage: '0' });
          onSaved(`Added ${a.tag} ${a.name}${a.purchaseTxnId ? ' and posted the purchase' : ''}.`);
        } catch (e) { setErrors(errList(e)); }
      }}>Add asset</button><span className="muted small">Without "post the purchase", the cost must already be on the books.</span></div>
    </section>
  );
}

// ── Depreciation ─────────────────────────────────────────────────────────
export function DepreciationPage() {
  const { state, books, user, visible, lines, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ok = useAssetsAccess();
  const today = todayInChicago();
  const [errors, setErrors] = useState<string[]>([]);
  const st = assetsOf(state);
  const from = st.depreciationFrom ?? (st.assets.map((a) => a.inService.slice(0, 7)).sort()[0] ?? today.slice(0, 7));
  const months = periodsBetween(from, addMonths(lastClosedPeriod(today), 1));
  const storeIds = [...new Set(st.assets.map((a) => a.storeId))].filter((s) => visible.has(s)).sort((a, b) => (state.stores.find((x) => x.id === a)?.code ?? '').localeCompare(state.stores.find((x) => x.id === b)?.code ?? ''));
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? '';
  const grid = useMemo(() => months.map((p) => {
    const by: Record<ID, number> = {};
    for (const a of st.assets) if (visible.has(a.storeId)) by[a.storeId] = (by[a.storeId] ?? 0) + monthlyDepreciation(a, p);
    const txIds = [...new Set(st.assets.map((a) => a.posted[p]).filter(Boolean))] as ID[];
    const due = lastDayOfPeriod(p) <= today;
    const ledger = lines.filter((f) => f.l.accountId === 'acct_depreciation' && f.period === p).reduce((a, f) => a + f.l.debit - f.l.credit, 0);
    const scheduled = Object.values(by).reduce((a, b) => a + b, 0);
    const postedAmt = st.assets.filter((a) => visible.has(a.storeId) && a.posted[p]).reduce((s, a) => s + monthlyDepreciation(a, p), 0);
    return { p, by, txIds, due, ledger, scheduled, postedAmt };
  }), [state, version, visible, today]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ok) return <NoAccess title="Depreciation" />;
  const unposted = unpostedDepreciation(state, today);
  const yr = today.slice(0, 4);
  const ytd = grid.filter((g) => g.p.startsWith(yr)).reduce((a, g) => a + g.ledger, 0);
  const next = grid.find((g) => !g.due);
  const mismatched = grid.filter((g) => g.txIds.length && g.ledger !== g.postedAmt);
  return (
    <>
      <PageHead eyebrow="Assets & debt" title="Depreciation" lede="Book depreciation by month and store, generated from the asset register and posted on each month's last day: 6400 Depreciation against 1590 Accumulated depreciation. Posting is idempotent per asset and month.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('depreciation', ['Month', ...storeIds.map(code), 'Total', 'Posted', 'Entry'], grid.map((g) => [g.p, ...storeIds.map((s) => csvMoney(g.by[s] ?? 0)), csvMoney(g.scheduled), g.txIds.length ? 'yes' : 'no', g.txIds.map((id) => state.transactions.find((t) => t.id === id)?.ref).join(' ')]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Depreciation" style={{ marginBottom: 20 }}>
        <Figure label={next ? `${periodLabel(next.p)} (scheduled)` : 'Next month'} value={<Money c={next?.scheduled ?? 0} whole dollar />} note={next ? `Posts on ${shortDate(lastDayOfPeriod(next.p))}` : ''} />
        <Figure label={`Booked in ${yr} (6400)`} value={<Money c={ytd} whole dollar />} note={`Since ${periodLabel(from)} in these books`} />
        <Figure label="Months not posted" value={<span className={unposted.length ? 'neg' : undefined}>{unposted.length}</span>} note={unposted.length ? unposted.map(periodLabel).join(', ') : 'Every completed month is posted'} />
        <Figure label="Assets depreciating" value={st.assets.filter((a) => visible.has(a.storeId) && monthlyDepreciation(a, next?.p ?? today.slice(0, 7)) > 0).length} />
      </section>
      <Errors errors={errors} />
      <section className="panel" aria-labelledby="dp-h">
        <div className="panel-head"><h2 id="dp-h">By month and store</h2></div>
        <div className="table-wrap"><table className="t">
          <thead><tr><th scope="col">Month</th>{storeIds.map((s) => <th key={s} scope="col" className="num">{code(s)}</th>)}<th scope="col" className="num">Total</th><th scope="col">Entry</th></tr></thead>
          <tbody>{grid.map((g) => (
            <tr key={g.p}><td>{periodLabel(g.p)}</td>{storeIds.map((s) => <td key={s} className="num"><Money c={g.by[s] ?? 0} /></td>)}<td className="num"><b><Money c={g.scheduled} /></b></td>
              <td>{g.txIds.length ? g.txIds.map((id) => <Link key={id} to={`/books/transactions/${id}`}>{state.transactions.find((t) => t.id === id)?.ref} </Link>) : g.due && g.scheduled ? (can(user, 'assets.edit') ? <button className="btn sm primary" onClick={() => { setErrors([]); try { const t = postDepreciation(books, user, g.p); say(t ? `Posted ${periodLabel(g.p)} depreciation: ${t.ref}.` : 'Nothing to post.'); } catch (e) { setErrors(errList(e)); } }}>Post {periodLabel(g.p)}</button> : <span className="pill warn">Not posted</span>) : <span className="muted small">{g.due ? '—' : `Posts ${shortDate(lastDayOfPeriod(g.p))}`}</span>}</td></tr>
          ))}</tbody>
        </table></div>
        <TieOut items={[
          { label: mismatched.length ? `6400 differs from the register in ${mismatched.map((g) => g.p).join(', ')}` : '6400 for every posted month equals the register\'s depreciation', ok: !mismatched.length },
          { label: unposted.length ? `${unposted.length} completed month(s) still to post` : 'Every completed month is posted from the register', ok: !unposted.length },
        ]} />
      </section>
      {toast}
      <Help k="depreciation" />
    </>
  );
}

// ── Maintenance & warranties ─────────────────────────────────────────────
export function MaintenancePage() {
  const { state, books, user, visible, stores } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ok = useAssetsAccess();
  const today = todayInChicago();
  const st = assetsOf(state);
  const log = st.maintenance.filter((m) => visible.has(m.storeId)).sort((a, b) => b.date.localeCompare(a.date));
  const due = maintenanceDue(state, today).filter((d) => visible.has(d.storeId));
  const tie = maintenanceTie(state);
  const yr = today.slice(0, 4);
  const spent = log.filter((m) => m.date.startsWith(yr)).reduce((a, m) => a + (m.cost ?? 0), 0);
  const warranties = due.filter((d) => d.kind === 'warranty');
  const [d, setD] = useState({ assetId: '', storeId: stores[0]?.id ?? '', date: today, kind: 'repair' as MaintenanceEntry['kind'], description: '', vendor: '', cost: '', txn: '', nextDue: '' });
  const [errors, setErrors] = useState<string[]>([]);
  if (!ok) return <NoAccess title="Maintenance" />;
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? '';
  const assetName = (id?: ID) => { const a = st.assets.find((x) => x.id === id); return a ? `${a.tag} ${a.name}` : '—'; };
  const storeAssets = st.assets.filter((a) => a.storeId === d.storeId && !a.disposal);
  return (
    <>
      <PageHead eyebrow="Assets & debt" title="Maintenance & warranties" lede="The equipment maintenance log (repairs, service, inspections, calibrations), when the next one is due, and warranty end dates. Anything due within 30 days reaches the inbox.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('maintenance-log', ['Date', 'Store', 'Asset', 'Kind', 'Work', 'Vendor', 'Cost', 'Transaction', 'Next due'], log.map((m) => [m.date, code(m.storeId), assetName(m.assetId), MAINT_LABEL[m.kind], m.description, m.vendor ?? '', m.cost !== undefined ? csvMoney(m.cost) : '', state.transactions.find((t) => t.id === m.txnId)?.ref ?? '', m.nextDue ?? '']))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Maintenance" style={{ marginBottom: 20 }}>
        <Figure label="Due or overdue in 30 days" value={<span className={due.some((x) => x.overdue) ? 'neg' : undefined}>{due.length - warranties.length}</span>} note={due.filter((x) => x.kind === 'maintenance').map((x) => `${code(x.storeId)} ${x.label} ${shortDate(x.due)}`).join('; ') || 'Nothing due'} />
        <Figure label="Warranties ending in 30 days" value={warranties.length} note={warranties.map((w) => `${code(w.storeId)} ${w.label.replace('Warranty ends: ', '')} ${shortDate(w.due)}`).join('; ') || 'None'} />
        <Figure label={`Logged cost in ${yr}`} value={<Money c={spent} whole dollar />} note={`${log.length} entries`} />
        <Figure label="Linked to a payment" value={`${tie.agree} of ${tie.linked}`} note="Logged costs that agree with their transaction" />
      </section>
      <div className="stack">
        {due.length > 0 && <section className="panel" aria-labelledby="md-h">
          <div className="panel-head"><h2 id="md-h">Coming due</h2></div>
          <div className="table-wrap"><table className="t"><thead><tr><th scope="col">Due</th><th scope="col">Store</th><th scope="col">What</th><th scope="col">Status</th></tr></thead>
            <tbody>{due.map((x) => <tr key={x.label + x.due}><td>{shortDate(x.due)}</td><td>{code(x.storeId)}</td><td>{x.label}</td><td><span className={'pill ' + (x.overdue ? 'bad' : 'warn')}>{x.overdue ? (x.kind === 'warranty' ? 'Warranty ended' : 'Overdue') : 'Due soon'}</span></td></tr>)}</tbody></table></div>
        </section>}
        <section className="panel" aria-labelledby="ml-h">
          <div className="panel-head"><h2 id="ml-h">Maintenance log</h2></div>
          <div className="table-wrap"><table className="t"><thead><tr><th scope="col">Date</th><th scope="col">Store</th><th scope="col">Asset</th><th scope="col">Work</th><th scope="col" className="num">Cost</th><th scope="col">Paid by</th><th scope="col">Next due</th></tr></thead>
            <tbody>{log.map((m) => <tr key={m.id}><td>{shortDate(m.date)}</td><td>{code(m.storeId)}</td><td>{m.assetId ? <Link to={`/assets?id=${m.assetId}`}>{assetName(m.assetId)}</Link> : '—'}</td><td>{MAINT_LABEL[m.kind]}: {m.description}{m.vendor && <div className="muted small">{m.vendor}</div>}<DocList items={m.attachments} say={say} /></td><td className="num">{m.cost !== undefined ? <Money c={m.cost} /> : '—'}</td><td>{m.txnId ? <Link to={`/books/transactions/${m.txnId}`}>{state.transactions.find((t) => t.id === m.txnId)?.ref}</Link> : '—'}</td><td>{m.nextDue ? shortDate(m.nextDue) : '—'}</td></tr>)}</tbody></table></div>
          <TieOut items={[{ label: tie.mismatched.length ? `${tie.mismatched.length} logged cost(s) differ from their transaction` : 'Every logged cost with a transaction agrees with that transaction at the store', ok: !tie.mismatched.length, detail: `${tie.linked} linked` }]} />
        </section>
        {can(user, 'assets.edit') && (
          <section className="panel panel-pad" aria-labelledby="mn-h">
            <h2 id="mn-h" style={{ marginBottom: 8 }}>Log maintenance</h2>
            <Errors errors={errors} />
            <div className="form-grid">
              <div className="field"><label htmlFor="mn-s">Store</label><select id="mn-s" value={d.storeId} onChange={(e) => setD({ ...d, storeId: e.target.value, assetId: '' })}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
              <div className="field"><label htmlFor="mn-a">Asset</label><select id="mn-a" value={d.assetId} onChange={(e) => setD({ ...d, assetId: e.target.value })}><option value="">None / general</option>{storeAssets.map((a) => <option key={a.id} value={a.id}>{a.tag} {a.name}</option>)}</select></div>
              <div className="field"><label htmlFor="mn-k">Kind</label><select id="mn-k" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as MaintenanceEntry['kind'] })}>{(Object.keys(MAINT_LABEL) as MaintenanceEntry['kind'][]).map((k) => <option key={k} value={k}>{MAINT_LABEL[k]}</option>)}</select></div>
              <div className="field"><label htmlFor="mn-d">Date</label><input id="mn-d" type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></div>
              <div className="field"><label htmlFor="mn-w">Work done</label><input id="mn-w" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></div>
              <div className="field"><label htmlFor="mn-v">Vendor</label><input id="mn-v" value={d.vendor} onChange={(e) => setD({ ...d, vendor: e.target.value })} /></div>
              <div className="field"><label htmlFor="mn-c">Cost</label><input id="mn-c" className="num" inputMode="decimal" value={d.cost} onChange={(e) => setD({ ...d, cost: e.target.value })} /></div>
              <div className="field"><label htmlFor="mn-t">Paid by (TX-ref)</label><input id="mn-t" value={d.txn} placeholder="TX-000123" onChange={(e) => setD({ ...d, txn: e.target.value })} /></div>
              <div className="field"><label htmlFor="mn-n">Next due</label><input id="mn-n" type="date" value={d.nextDue} onChange={(e) => setD({ ...d, nextDue: e.target.value })} /></div>
            </div>
            <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => {
              setErrors([]);
              try {
                const t = d.txn.trim() ? books.getTransaction(d.txn.trim().toUpperCase()) : undefined;
                if (d.txn.trim() && !t) { setErrors([`No transaction ${d.txn.trim()}.`]); return; }
                logMaintenance(books, user, { assetId: d.assetId || undefined, storeId: d.storeId, date: d.date, kind: d.kind, description: d.description, vendor: d.vendor, cost: d.cost.trim() ? parseMoney(d.cost) ?? NaN : undefined, txnId: t?.id, nextDue: d.nextDue || undefined });
                setD({ ...d, description: '', cost: '', txn: '', nextDue: '' });
                say('Logged.');
              } catch (e) { setErrors(errList(e)); }
            }}>Log it</button></div>
          </section>
        )}
      </div>
      {toast}
      <Help k="maintenance" />
    </>
  );
}

// ── Prepaids ─────────────────────────────────────────────────────────────
export function PrepaidsPage() {
  const { state, books, user, visible, stores, version } = useBooks();
  const exportCsv = useExport();
  const [toast, say] = useToast();
  const ok = useAssetsAccess();
  const today = todayInChicago();
  const [errors, setErrors] = useState<string[]>([]);
  const rows = useMemo(() => prepaidsOf(state).filter((p) => visible.has(p.storeId)).map((p) => prepaidStatus(state, p, today)), [state, visible, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const tie = useMemo(() => prepaidTie(state, today), [state, today, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [d, setD] = useState({ label: '', kind: 'insurance' as PrepaidKind, storeId: 'st_corp', amount: '', start: today.slice(0, 7), months: '12', pay: true, date: today });
  if (!ok) return <NoAccess title="Prepaids" />;
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? '';
  const unposted = unpostedPrepaidMonths(state, today);
  const nextP = addMonths(lastClosedPeriod(today), 1);
  const monthly = rows.filter((r) => r.p.active).reduce((a, r) => a + (r.months.find((m) => m.period === nextP)?.amount ?? 0), 0);
  return (
    <>
      <PageHead eyebrow="Assets & debt" title="Prepaids" lede="Property tax, insurance and annual fees are paid up front and spread evenly over the months they cover (SPEC §6.10): each month's last day posts 1400 Prepaid → the expense.">
        {can(user, 'export') && <button className="btn" onClick={() => exportCsv('prepaids', ['Prepaid', 'Kind', 'Store', 'Amount', 'From', 'To', 'Monthly', 'Amortized', 'Remaining', 'Months not posted'], rows.map((r) => [r.p.label, PREPAID_LABEL[r.p.kind], code(r.p.storeId), csvMoney(r.p.amount), r.p.startPeriod, prepaidEnd(r.p), csvMoney(r.monthly), csvMoney(r.booked), csvMoney(r.remaining), r.unposted.map((m) => m.period).join(' ')]))}>Export CSV</button>}
      </PageHead>
      <section className="figures" aria-label="Prepaids" style={{ marginBottom: 20 }}>
        <Figure label="1400 Prepaid expenses" value={<Money c={tie.ledger} whole dollar />} note={`As of ${shortDate(today)}`} href="/books/accounts/acct_prepaid" />
        <Figure label={`${periodLabel(nextP)} amortization`} value={<Money c={monthly} whole dollar />} note={`Posts ${shortDate(lastDayOfPeriod(nextP))}`} />
        <Figure label="Months not posted" value={<span className={unposted.length ? 'neg' : undefined}>{unposted.length}</span>} note={unposted.map(periodLabel).join(', ') || 'Up to date'} />
        <Figure label="Schedules" value={rows.filter((r) => r.remaining > 0).length} note="With a balance left" />
      </section>
      <Errors errors={errors} />
      <div className="stack">
        <section className="panel" aria-labelledby="pp-h">
          <div className="panel-head"><h2 id="pp-h">Schedules</h2>{unposted.length > 0 && can(user, 'assets.edit') && <button className="btn sm primary" onClick={() => { setErrors([]); try { const t = amortizePrepaids(books, user, unposted[0]); say(t ? `Posted ${periodLabel(unposted[0])} amortization: ${t.ref}.` : 'Nothing to post.'); } catch (e) { setErrors(errList(e)); } }}>Post {periodLabel(unposted[0])}</button>}</div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Prepaid</th><th scope="col">Store</th><th scope="col">Covers</th><th scope="col" className="num">Amount</th><th scope="col" className="num">Monthly</th><th scope="col" className="num">Amortized</th><th scope="col" className="num">Remaining</th><th scope="col">Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.p.id}><td><b>{r.p.label}</b><div className="muted small">{PREPAID_LABEL[r.p.kind]} → {state.accounts.find((a) => a.id === r.p.expenseAccountId)?.number}{r.p.paidTxnId ? <> · paid <Link to={`/books/transactions/${r.p.paidTxnId}`}>{state.transactions.find((t) => t.id === r.p.paidTxnId)?.ref}</Link></> : r.p.amortizedThrough ? ' · in the opening balance' : ''}{r.p.policyId ? <> · <Link to="/compliance/insurance">policy</Link></> : ''}</div></td>
                <td>{code(r.p.storeId)}</td><td>{periodLabel(r.p.startPeriod)} – {periodLabel(prepaidEnd(r.p))}</td>
                <td className="num"><Money c={r.p.amount} /></td><td className="num"><Money c={r.monthly} /></td><td className="num"><Money c={r.booked} /></td><td className="num"><Money c={r.remaining} /></td>
                <td>{r.unposted.length ? <span className="pill warn">{r.unposted.length} month(s) to post</span> : r.remaining === 0 ? <span className="pill">Fully amortized</span> : <span className="pill ok">Up to date</span>}</td></tr>
            ))}</tbody>
          </table></div>
          <TieOut items={[
            { label: tie.difference === 0 ? 'Remaining on the schedules ties to 1400 Prepaid expenses' : 'Schedules do not tie to 1400', ok: tie.difference === 0, detail: <><Money c={tie.schedules} dollar /> vs <Money c={tie.ledger} dollar /> in the ledger</> },
            { label: tie.scheduledByMath === tie.schedules ? 'Every completed month is amortized' : 'Some completed months are not amortized yet', ok: tie.scheduledByMath === tie.schedules, detail: tie.scheduledByMath !== tie.schedules ? <>By the schedules 1400 should be <Money c={tie.scheduledByMath} dollar /></> : undefined },
          ]} />
        </section>
        {can(user, 'assets.edit') && (
          <section className="panel panel-pad" aria-labelledby="pn-h">
            <h2 id="pn-h" style={{ marginBottom: 8 }}>Add a prepaid</h2>
            <div className="form-grid">
              <div className="field"><label htmlFor="pn-l">What</label><input id="pn-l" value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} /></div>
              <div className="field"><label htmlFor="pn-k">Kind</label><select id="pn-k" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as PrepaidKind })}>{(Object.keys(PREPAID_LABEL) as PrepaidKind[]).map((k) => <option key={k} value={k}>{PREPAID_LABEL[k]}</option>)}</select></div>
              <div className="field"><label htmlFor="pn-s">Store</label><select id="pn-s" value={d.storeId} onChange={(e) => setD({ ...d, storeId: e.target.value })}>{stores.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}</select></div>
              <div className="field"><label htmlFor="pn-a">Amount</label><input id="pn-a" className="num" inputMode="decimal" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} /></div>
              <div className="field"><label htmlFor="pn-f">First month (YYYY-MM)</label><input id="pn-f" value={d.start} onChange={(e) => setD({ ...d, start: e.target.value })} /></div>
              <div className="field"><label htmlFor="pn-m">Months</label><input id="pn-m" className="num" inputMode="numeric" value={d.months} onChange={(e) => setD({ ...d, months: e.target.value })} /></div>
              <label className="check"><input type="checkbox" checked={d.pay} onChange={(e) => setD({ ...d, pay: e.target.checked })} /> Post the payment from Trustmark</label>
              {d.pay && <div className="field"><label htmlFor="pn-d">Paid on</label><input id="pn-d" type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></div>}
            </div>
            <div className="actions" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => {
              setErrors([]);
              try {
                const p = savePrepaid(books, user, { label: d.label, kind: d.kind, storeId: d.storeId, expenseAccountId: PREPAID_EXPENSE[d.kind], amount: parseMoney(d.amount) ?? NaN, startPeriod: d.start.trim(), months: Number(d.months), active: true }, d.pay ? { date: d.date } : undefined);
                setD({ ...d, label: '', amount: '' });
                say(`Added ${p.label}: ${formatMoney(prepaidStatus(state, p, today).monthly, { dollarSign: true })} a month.`);
              } catch (e) { setErrors(errList(e)); }
            }}>Add prepaid</button></div>
          </section>
        )}
      </div>
      {toast}
      <Help k="prepaids" />
    </>
  );
}
