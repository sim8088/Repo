import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Help, Money, PageHead, TieOut, csvMoney, useToast } from '../components/ui';
import { BasisSeg, BASES, ExportButtons, pct, useEntries } from '../components/reportkit';
import { latestSalesPeriod } from '../../core/reports';
import {
  addScorecardNote, balanceSheet, BASIS_LABEL, cashFlow, commandCenter, deleteReport, firstDay, GROUPS, KPIS, reportsOf, runReport, saveReport, scorecards,
  setThreshold, statement, summaryLetter, thresholdsOf, type KpiKey, type KpiStatus, type ReportDraft,
} from '../../core/statements';
import { icSummary } from '../../core/intercompany';
import { lastDayOfPeriod, periodLabel, periodOf, periodsBetween, shortDate, todayInChicago } from '../../core/dates';
import { can } from '../../core/permissions';
import { buildInbox } from '../inbox';
import { ValidationError } from '../../core/books';
import type { ReportBasis, ScheduleCadence } from '../../core/types';

function useMonth(): [string, (v: string) => void, string, string[]] {
  const { state, lines } = useBooks();
  const [sp, setSp] = useSearchParams();
  const latest = useMemo(() => latestSalesPeriod(state, lines) ?? periodOf(todayInChicago()), [state, lines]);
  const months = useMemo(() => {
    const rev = new Set(state.accounts.filter((a) => a.type === 'revenue').map((a) => a.id));
    return [...new Set(lines.filter((f) => rev.has(f.l.accountId)).map((f) => f.period))].sort().reverse();
  }, [state, lines]);
  const m = sp.get('month') ?? latest;
  return [m, (v) => { const n = new URLSearchParams(sp); if (v === latest) n.delete('month'); else n.set('month', v); setSp(n, { replace: true }); }, latest, months];
}

const STATUS_CLASS: Record<KpiStatus, string> = { green: 'ok', amber: 'warn', red: 'bad', na: '' };
const STATUS_WORD: Record<KpiStatus, string> = { green: 'Green', amber: 'Amber', red: 'Red', na: 'No data' };
const NoAccess = ({ title }: { title: string }) => <PageHead title={title} lede="Your role doesn't include company reports. Ask the CFO for access." />;

// ── Scorecards ───────────────────────────────────────────────────────────
export function ScorecardsPage() {
  const { state, books, user, stores } = useBooks();
  const entries = useEntries();
  const [month, setMonth, latest, months] = useMonth();
  const [toast, say] = useToast();
  const [errs, setErrs] = useState<string[]>([]);
  const [noteStore, setNoteStore] = useState('');
  const [noteText, setNoteText] = useState('');
  const ids = stores.map((s) => s.id);
  const rows = useMemo(() => scorecards(state, { period: month, storeIds: ids, entries }), [state, month, ids.join(), entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const th = thresholdsOf(state);
  const [edit, setEdit] = useState<Record<string, { green: string; amber: string }>>({});
  if (!can(user, 'view.reports')) return <NoAccess title="Store scorecards" />;
  const code = (id: string) => stores.find((s) => s.id === id)?.code ?? id;
  const st = statement(state, { basis: 'accrual', from: month, to: month, storeIds: rows.map((r) => r.storeId), entries });
  const kpiNet = rows.reduce((a, r) => a + (r.kpis.find((k) => k.key === 'netProfit')!.value ?? 0), 0);
  const counts = rows.reduce((a, r) => ({ green: a.green + r.counts.green, amber: a.amber + r.counts.amber, red: a.red + r.counts.red }), { green: 0, amber: 0, red: 0 });
  const header = ['KPI', ...rows.map((r) => code(r.storeId)), 'Green', 'Amber', 'Better'];
  const exportRows = KPIS.map((d) => [d.label, ...rows.map((r) => { const k = r.kpis.find((x) => x.key === d.key)!; return `${k.display} (${STATUS_WORD[k.status]})`; }), String(th[d.key].green), String(th[d.key].amber), d.better]);
  const saveT = (key: KpiKey) => {
    const e = edit[key];
    if (!e) return;
    try { setThreshold(books, user, key, { green: Number(e.green), amber: Number(e.amber) }); setErrs([]); say('Threshold saved.'); setEdit((x) => { const n = { ...x }; delete n[key]; return n; }); }
    catch (err) { setErrs(err instanceof ValidationError ? err.errors : [(err as Error).message]); }
  };
  const addNote = () => {
    try { addScorecardNote(books, user, { storeId: noteStore || rows[0]?.storeId || '', period: month, text: noteText }); setNoteText(''); setErrs([]); say('Note added.'); }
    catch (err) { setErrs(err instanceof ValidationError ? err.errors : [(err as Error).message]); }
  };

  return (
    <>
      <PageHead eyebrow="Reports · accrual basis" title="Store scorecards" lede={<>{periodLabel(month)}{month === latest ? ', the latest month with sales' : ''}. Each KPI against its threshold: green, amber or red.</>}>
        <ExportButtons name={`scorecards-${month}`} header={header} rows={exportRows} sheet={`Scorecards ${month}`} />
      </PageHead>
      {toast}
      <section className="figures" aria-label="Summary" style={{ marginBottom: 20 }}>
        <div className="figure"><div className="label">Stores scored</div><div className="value">{rows.length}</div></div>
        <div className="figure"><div className="label">Green</div><div className="value pos">{counts.green}</div></div>
        <div className="figure"><div className="label">Amber</div><div className="value">{counts.amber}</div></div>
        <div className="figure"><div className="label">Red</div><div className="value neg">{counts.red}</div></div>
      </section>
      <Errors errors={errs} />
      <section className="panel">
        <div className="filters">
          <div className="field"><label htmlFor="sc-month">Month</label><select id="sc-month" value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}</select></div>
        </div>
        <div className="table-wrap">
          <table className="t scorecard">
            <thead><tr><th scope="col">KPI</th>{rows.map((r) => <th scope="col" key={r.storeId}><Link to={`/reports/pnl?basis=accrual&from=${month}&to=${month}&store=${r.storeId}`}>{code(r.storeId)}</Link></th>)}<th scope="col">Threshold</th></tr></thead>
            <tbody>
              {KPIS.map((d) => (
                <tr key={d.key}>
                  <th scope="row">{d.label}</th>
                  {rows.map((r) => {
                    const k = r.kpis.find((x) => x.key === d.key)!;
                    return <td key={r.storeId}><span className={'pill ' + STATUS_CLASS[k.status]}>{k.display}<span className="sr-only">, {STATUS_WORD[k.status]}</span></span>{k.detail && <div className="muted small">{k.detail}</div>}</td>;
                  })}
                  <td className="small muted">{d.better === 'higher' ? '≥' : '≤'} {th[d.key].green} green, {d.better === 'higher' ? '≥' : '≤'} {th[d.key].amber} amber · {d.thresholdHint}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Notes</th>
                {rows.map((r) => <td key={r.storeId} className="small">{r.notes.length ? r.notes.map((n) => <p key={n.id}>{n.text}</p>) : <span className="muted">–</span>}</td>)}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <TieOut items={[
          { label: kpiNet === st.netIncome.total ? 'Net profit ties to the accrual P&L' : 'Net profit does not tie to the P&L', ok: kpiNet === st.netIncome.total, detail: <Money c={st.netIncome.total} dollar /> },
          { label: 'Every KPI rated', ok: rows.every((r) => r.counts.green + r.counts.amber + r.counts.red + r.counts.na === KPIS.length) },
        ]} />
      </section>
      <div className="grid-2" style={{ marginTop: 20 }}>
        <section className="panel">
          <div className="panel-head"><h2>Notes for {periodLabel(month)}</h2></div>
          <div className="panel-pad form-grid">
            <div className="field"><label htmlFor="sc-note-store">Store</label><select id="sc-note-store" value={noteStore || rows[0]?.storeId || ''} onChange={(e) => setNoteStore(e.target.value)}>{rows.map((r) => <option key={r.storeId} value={r.storeId}>{code(r.storeId)}</option>)}</select></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="sc-note">Note</label><textarea id="sc-note" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="What explains this month, and what happens next" /></div>
            <div><button className="btn primary" onClick={addNote} disabled={!rows.length}>Add note</button></div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Thresholds</h2><span className="muted small">{can(user, 'setup.edit') ? 'Company-wide; labor is points over each store\'s target' : 'Only the CFO or bookkeeper can change these'}</span></div>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th scope="col">KPI</th><th scope="col" className="num">Green</th><th scope="col" className="num">Amber</th><th scope="col"><span className="sr-only">Save</span></th></tr></thead>
              <tbody>
                {KPIS.map((d) => {
                  const e = edit[d.key] ?? { green: String(th[d.key].green), amber: String(th[d.key].amber) };
                  const ch = (f: 'green' | 'amber', v: string) => setEdit((x) => ({ ...x, [d.key]: { ...e, [f]: v } }));
                  return (
                    <tr key={d.key}>
                      <td>{d.label}<div className="muted small">{d.better} is better</div></td>
                      <td className="num"><input className="num" aria-label={`${d.label} green`} value={e.green} disabled={!can(user, 'setup.edit')} onChange={(x) => ch('green', x.target.value)} style={{ maxWidth: 110 }} /></td>
                      <td className="num"><input className="num" aria-label={`${d.label} amber`} value={e.amber} disabled={!can(user, 'setup.edit')} onChange={(x) => ch('amber', x.target.value)} style={{ maxWidth: 110 }} /></td>
                      <td>{edit[d.key] && <button className="btn sm" onClick={() => saveT(d.key)}>Save</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <Help k="scorecards" />
    </>
  );
}

// ── Board / owner pack ───────────────────────────────────────────────────
export function BoardPackPage() {
  const { state, lines, stores, user, visible } = useBooks();
  const entries = useEntries();
  const [month, setMonth, latest, months] = useMonth();
  const ids = stores.map((s) => s.id);
  const end = lastDayOfPeriod(month);
  const data = useMemo(() => {
    const cc = commandCenter(state, { period: month, basis: 'accrual', storeIds: ids, entries });
    const bs = balanceSheet(state, { asOf: end, lines });
    const cf = cashFlow(state, { from: firstDay(month), to: end, lines });
    const sc = scorecards(state, { period: month, storeIds: ids, entries });
    const ic = icSummary(state, end);
    const issues = buildInbox(state, lines, visible).filter((i) => i.count > 0 && !i.review);
    return { cc, bs, cf, sc, ic, issues };
  }, [state, month, ids.join(), entries, lines, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const generated = useMemo(() => summaryLetter(state, { period: month, periodName: periodLabel(month), cc: data.cc, bs: data.bs, cashFlow: data.cf, issues: data.issues.length }), [state, month, data]);
  const [draft, setDraft] = useState<{ month: string; text: string } | null>(null);
  const letter = draft && draft.month === month ? draft.text : generated;
  if (!can(user, 'view.reports') || !can(user, 'view.all_stores')) return <NoAccess title="Board pack" />;
  const code = (id: string) => state.stores.find((s) => s.id === id)?.code ?? id;
  const { cc, bs, cf, sc, ic, issues } = data;
  const icRows = [...ic.parties, ...ic.entities].filter((p) => p.balance);
  const header = ['Section', 'Line', 'Amount'];
  const exportRows: (string | number)[][] = [
    ...letter.split('\n').map((l) => ['Letter', l, '']),
    ...[...cc.rows, cc.total].map((r) => ['P&L (accrual)', r.key === 'total' ? 'Company total net profit' : `${code(r.key)} net profit`, csvMoney(r.net)]),
    ['Balance sheet', 'Total assets', csvMoney(bs.totalAssets)], ['Balance sheet', 'Total liabilities', csvMoney(bs.totalLiabilities)], ['Balance sheet', 'Equity', csvMoney(bs.totalEquity)],
    ['Cash', 'Opening', csvMoney(cf.openingCash)], ...cf.sections.map((s) => ['Cash', s.label, csvMoney(s.total)]), ['Cash', 'Closing', csvMoney(cf.closingCash)],
    ...icRows.map((p) => ['Intercompany', p.name, csvMoney(p.balance)]),
    ...issues.map((i) => ['Open issues', `${i.title} (${i.count})`, '']),
  ];
  const ties = [
    { label: 'P&L stores add to the total', ok: cc.rowsAddUp && cc.tiesToPnl },
    { label: 'Balance sheet balances and agrees to the TB', ok: bs.difference === 0 && bs.agreesToTb },
    { label: 'Cash flow ties to the change in cash', ok: cf.ties },
  ];

  return (
    <>
      <PageHead eyebrow="Reports · owner pack" title="Board pack" lede={<>{periodLabel(month)}{month === latest ? ', the latest month with sales' : ''}. One page for the owners; edit the letter, then print to PDF.</>}>
        <ExportButtons name={`board-pack-${month}`} header={header} rows={exportRows} print={false} sheet={`Board pack ${month}`} />
        <button className="btn primary" onClick={() => window.print()}>Print / PDF</button>
      </PageHead>
      <div className="filters no-print panel" style={{ marginBottom: 16 }}>
        <div className="field"><label htmlFor="bp-month">Month</label><select id="bp-month" value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}</select></div>
        {draft && draft.month === month && <button className="btn" onClick={() => setDraft(null)}>Reset the letter to the numbers</button>}
      </div>
      <article className="pack">
        <header className="pack-head">
          <div className="eyebrow">{state.settings.companyName} · owner pack</div>
          <h2>{periodLabel(month)}</h2>
          <div className="muted small">As of {shortDate(end)} · accrual P&amp;L, booked balance sheet and cash</div>
        </header>
        <section className="pack-sec">
          <h3>Summary letter</h3>
          <label htmlFor="bp-letter" className="no-print">Letter (edit before printing)</label>
          <textarea id="bp-letter" className="no-print pack-letter" value={letter} rows={9} onChange={(e) => setDraft({ month, text: e.target.value })} />
          <div className="print-only pack-letter-print">{letter.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div>
        </section>
        <section className="pack-sec">
          <h3>Profit &amp; loss by store (accrual)</h3>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Store</th><th scope="col" className="num">Sales</th><th scope="col" className="num">Gross margin</th><th scope="col" className="num">Labor %</th><th scope="col" className="num">Net profit</th><th scope="col" className="num">vs prior</th></tr></thead>
            <tbody>
              {cc.rows.map((r) => <tr key={r.key}><td>{code(r.key)}</td><td className="num"><Money c={r.sales} whole /></td><td className="num"><Money c={r.gross} whole /> <span className="muted small">{pct(r.gmPct)}</span></td><td className="num">{pct(r.laborPct)}</td><td className="num"><Money c={r.net} whole signed /></td><td className="num"><Money c={r.net - r.priorNet} whole signed /></td></tr>)}
              <tr className="total"><td>Company</td><td className="num"><Money c={cc.total.sales} whole /></td><td className="num"><Money c={cc.total.gross} whole /> <span className="muted small">{pct(cc.total.gmPct)}</span></td><td className="num">{pct(cc.total.laborPct)}</td><td className="num"><Money c={cc.total.net} whole signed /></td><td className="num"><Money c={cc.total.net - cc.total.priorNet} whole signed /></td></tr>
            </tbody>
          </table></div>
        </section>
        <div className="grid-2 pack-grid">
          <section className="pack-sec">
            <h3>Balance sheet</h3>
            <table className="t"><tbody>
              {bs.sections.map((s) => (
                <Fragment key={s.key}>
                  {s.groups.filter((g) => g.total).map((g) => <tr key={g.key} className="indent"><td>{g.label}</td><td className="num"><Money c={g.total} whole /></td></tr>)}
                  <tr className="sub"><td>Total {s.label.toLowerCase()}</td><td className="num"><Money c={s.total} whole /></td></tr>
                </Fragment>
              ))}
            </tbody></table>
          </section>
          <section className="pack-sec">
            <h3>Cash</h3>
            <table className="t"><tbody>
              <tr className="indent"><td>Opening cash and equivalents</td><td className="num"><Money c={cf.openingCash} whole /></td></tr>
              {cf.sections.map((s) => <tr key={s.key} className="indent"><td>{s.label}</td><td className="num"><Money c={s.total} whole signed /></td></tr>)}
              <tr className="sub"><td>Closing cash and equivalents</td><td className="num"><Money c={cf.closingCash} whole /></td></tr>
            </tbody></table>
          </section>
        </div>
        <section className="pack-sec">
          <h3>KPIs</h3>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">KPI</th>{sc.map((r) => <th scope="col" key={r.storeId}>{code(r.storeId)}</th>)}</tr></thead>
            <tbody>{KPIS.map((d) => <tr key={d.key}><th scope="row">{d.label}</th>{sc.map((r) => { const k = r.kpis.find((x) => x.key === d.key)!; return <td key={r.storeId}><span className={'pill ' + STATUS_CLASS[k.status]}>{k.display}<span className="sr-only">, {STATUS_WORD[k.status]}</span></span></td>; })}</tr>)}</tbody>
          </table></div>
        </section>
        <div className="grid-2 pack-grid">
          <section className="pack-sec">
            <h3>Intercompany positions</h3>
            <table className="t"><tbody>
              {icRows.map((p) => <tr key={p.id} className="indent"><td>{p.name}<div className="muted small">{p.balance > 0 ? 'owes us' : 'we owe'}{p.overLimit ? ' · over limit' : ''}</div></td><td className="num"><Money c={p.balance} whole /></td></tr>)}
              {!icRows.length && <tr><td className="muted">No open balances.</td></tr>}
            </tbody></table>
          </section>
          <section className="pack-sec">
            <h3>Open issues</h3>
            <ul className="pack-issues">
              {issues.map((i) => <li key={i.key}><b>{i.count}</b> {i.title}</li>)}
              {!issues.length && <li className="muted">Nothing open on the inbox.</li>}
            </ul>
          </section>
        </div>
        <TieOut items={ties} />
      </article>
      <Help k="boardPack" />
    </>
  );
}

// ── Report builder ───────────────────────────────────────────────────────
const blank = (month: string): ReportDraft => ({ name: '', rows: ['group:sales', 'group:gp', 'group:net'], columns: 'store', basis: 'accrual', from: month, to: month, storeIds: [] });

export function ReportBuilderPage() {
  const { state, books, user, stores } = useBooks();
  const entries = useEntries();
  const [, , latest, months] = useMonth();
  const [sp, setSp] = useSearchParams();
  const saved = reportsOf(state).saved;
  const openId = sp.get('id') ?? '';
  const open = saved.find((r) => r.id === openId);
  const [draft, setDraft] = useState<ReportDraft & { id?: string }>(() => (open ? { ...open } : blank(latest)));
  const [addAcct, setAddAcct] = useState('');
  const [errs, setErrs] = useState<string[]>([]);
  const [toast, say] = useToast();
  const visible = stores.map((s) => s.id);
  const result = useMemo(() => (draft.rows.length && draft.to >= draft.from ? runReport(state, draft, { visible, entries }) : null), [state, draft, visible.join(), entries]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can(user, 'view.reports')) return <NoAccess title="Report builder" />;
  const load = (id: string) => { const r = saved.find((x) => x.id === id); if (!r) return; setDraft({ ...r }); setSp(new URLSearchParams({ id }), { replace: true }); setErrs([]); };
  const set = <K extends keyof ReportDraft>(k: K, v: ReportDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const toggleRow = (key: string, on: boolean) => set('rows', on ? [...draft.rows, key] : draft.rows.filter((r) => r !== key));
  const save = (asNew: boolean) => {
    try {
      const { id, ...d } = draft;
      const r = saveReport(books, user, d, asNew ? undefined : id);
      setDraft({ ...r }); setSp(new URLSearchParams({ id: r.id }), { replace: true }); setErrs([]); say(`Saved "${r.name}".`);
    } catch (e) { setErrs(e instanceof ValidationError ? e.errors : [(e as Error).message]); }
  };
  const header = ['Row', ...(result?.cols.map((c) => c.label) ?? []), 'Total'];
  const exportRows = (result?.rows ?? []).map((r) => [r.label, ...result!.cols.map((c) => csvMoney(r.by[c.key])), csvMoney(r.total)]);
  const accountRows = draft.rows.filter((r) => r.startsWith('acct:'));

  return (
    <>
      <PageHead eyebrow="Reports" title="Report builder" lede="Pick rows (accounts or groups), columns (stores or months) and filters. Save it to come back to it.">
        <ExportButtons name={`report-${(draft.name || 'custom').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} header={header} rows={exportRows} sheet={draft.name || 'Report'} />
      </PageHead>
      {toast}
      <section className="figures" aria-label="Summary" style={{ marginBottom: 20 }}>
        <div className="figure"><div className="label">Saved reports</div><div className="value">{saved.length}</div></div>
        <div className="figure"><div className="label">Scheduled</div><div className="value">{saved.filter((r) => r.schedule).length}</div><div className="fig-note">cadence kept; nothing is emailed yet</div></div>
        <div className="figure"><div className="label">Rows × columns</div><div className="value">{result ? `${result.rows.length} × ${result.cols.length}` : '–'}</div></div>
      </section>
      <Errors errors={errs} />
      <div className="grid-2 wide-left">
        <section className="panel">
          <div className="panel-head"><h2>{draft.id ? `Editing "${saved.find((r) => r.id === draft.id)?.name ?? draft.name}"` : 'New report'}</h2>{draft.id && <button className="btn sm" onClick={() => { setDraft(blank(latest)); setSp(new URLSearchParams(), { replace: true }); }}>Start a new one</button>}</div>
          <div className="panel-pad stack">
            <div className="form-grid">
              <div className="field"><label htmlFor="rb-name">Name</label><input id="rb-name" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Fuel vs inside by month" /></div>
              <div className="field"><label htmlFor="rb-cols">Columns</label><select id="rb-cols" value={draft.columns} onChange={(e) => set('columns', e.target.value as 'store' | 'month')}><option value="store">Stores</option><option value="month">Months</option></select></div>
              <div className="field"><label htmlFor="rb-from">From month</label><select id="rb-from" value={draft.from} onChange={(e) => set('from', e.target.value)}>{[...months].reverse().map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}</select></div>
              <div className="field"><label htmlFor="rb-to">To month</label><select id="rb-to" value={draft.to} onChange={(e) => set('to', e.target.value)}>{[...months].reverse().map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}</select></div>
            </div>
            <div className="field seg-field"><span className="seg-label" aria-hidden>Basis</span><BasisSeg label="Basis" value={draft.basis} onChange={(v: ReportBasis) => set('basis', v)} options={BASES} /></div>
            <fieldset className="rb-set"><legend>Row groups</legend>
              <div className="rb-checks">{GROUPS.map((g) => <label key={g.key} className="check"><input type="checkbox" checked={draft.rows.includes(`group:${g.key}`)} onChange={(e) => toggleRow(`group:${g.key}`, e.target.checked)} /> {g.label}</label>)}</div>
            </fieldset>
            <div className="form-grid">
              <div className="field"><label htmlFor="rb-acct">Add an account row</label><select id="rb-acct" value={addAcct} onChange={(e) => setAddAcct(e.target.value)}><option value="">Pick an account…</option>{[...state.accounts].sort((a, b) => a.number.localeCompare(b.number)).filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}</select></div>
              <div style={{ alignSelf: 'end' }}><button className="btn" disabled={!addAcct || draft.rows.includes(`acct:${addAcct}`)} onClick={() => { toggleRow(`acct:${addAcct}`, true); setAddAcct(''); }}>Add row</button></div>
            </div>
            {accountRows.length > 0 && <ul className="rb-list">{accountRows.map((r) => { const a = state.accounts.find((x) => `acct:${x.id}` === r); return <li key={r}>{a ? `${a.number} · ${a.name}` : r} <button className="btn ghost sm" onClick={() => toggleRow(r, false)} aria-label={`Remove ${a?.name ?? r}`}>Remove</button></li>; })}</ul>}
            <fieldset className="rb-set"><legend>Stores (none ticked = every store you can see)</legend>
              <div className="rb-checks">{stores.map((s) => <label key={s.id} className="check"><input type="checkbox" checked={draft.storeIds.includes(s.id)} onChange={(e) => set('storeIds', e.target.checked ? [...draft.storeIds, s.id] : draft.storeIds.filter((x) => x !== s.id))} /> {s.code}</label>)}</div>
            </fieldset>
            <div className="form-grid">
              <div className="field"><label htmlFor="rb-sched">Schedule</label><select id="rb-sched" value={draft.schedule?.cadence ?? ''} onChange={(e) => set('schedule', e.target.value ? { cadence: e.target.value as ScheduleCadence, note: draft.schedule?.note } : undefined)}><option value="">Not scheduled</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select><span className="hint">The cadence is saved for later. Nothing is emailed yet: sending needs the hosted back end.</span></div>
            </div>
            <div className="actions">
              <button className="btn primary" onClick={() => save(false)}>{draft.id ? 'Save changes' : 'Save report'}</button>
              {draft.id && <button className="btn" onClick={() => save(true)}>Save as new</button>}
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Saved reports</h2></div>
          <ul className="inbox">
            {saved.map((r) => (
              <li key={r.id} style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                <div className="what"><b>{r.name}</b><span>{r.rows.length} rows by {r.columns} · {BASIS_LABEL[r.basis].toLowerCase()} · {r.from === r.to ? r.from : `${r.from} to ${r.to}`}{r.schedule ? ` · ${r.schedule.cadence}` : ''}</span></div>
                <div className="actions"><button className="btn sm" onClick={() => load(r.id)}>Open</button><button className="btn sm ghost" aria-label={`Remove ${r.name}`} onClick={() => { deleteReport(books, user, r.id); if (draft.id === r.id) setDraft(blank(latest)); say('Removed.'); }}>Remove</button></div>
              </li>
            ))}
            {!saved.length && <li className="muted" style={{ display: 'block' }}>No saved reports yet.</li>}
          </ul>
        </section>
      </div>
      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head"><h2>{draft.name || 'Preview'}</h2><span className="muted small">{BASIS_LABEL[draft.basis]} · {periodsBetween(draft.from, draft.to < draft.from ? draft.from : draft.to).map(periodLabel).join(', ')}</span></div>
        {result ? (
          <>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th scope="col">Row</th>{result.cols.map((c) => <th scope="col" className="num" key={c.key}>{c.label}</th>)}<th scope="col" className="num">Total</th></tr></thead>
                <tbody>{result.rows.map((r) => <tr key={r.key} className={r.key === 'group:net' || r.key === 'group:gp' ? 'sub' : undefined}><td>{r.label}</td>{result.cols.map((c) => <td className="num" key={c.key}><Money c={r.by[c.key]} /></td>)}<td className="num"><Money c={r.total} /></td></tr>)}</tbody>
              </table>
            </div>
            <TieOut items={[
              { label: result.rowsTie ? 'Every row adds across to its total' : 'A row does not add up', ok: result.rowsTie },
              ...(result.netTies === null ? [] : [{ label: result.netTies ? `Net profit agrees with the ${BASIS_LABEL[draft.basis].toLowerCase()} P&L` : 'Net profit differs from the P&L', ok: result.netTies }]),
            ]} />
          </>
        ) : <div className="panel-pad muted">Pick at least one row and a valid month range.</div>}
      </section>
      <p className="muted small" style={{ marginTop: 10 }}>P&amp;L rows use the chosen basis, shown the way the P&amp;L shows them (sales and costs positive; gross profit and net profit as profit). Balance-sheet accounts show their booked activity in the range.</p>
      <Help k="reportBuilder" />
    </>
  );
}
