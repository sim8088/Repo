import { Fragment, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Help, Money, PageHead, TieOut, csvMoney } from '../components/ui';
import { BasisSeg, BASES, ExportButtons, pct, useEntries } from '../components/reportkit';
import { latestSalesPeriod, periodEnd } from '../../core/reports';
import {
  BASIS_LABEL, BRIDGE_LABEL, balanceSheet, cashFlow, commandCenter, drill, entryDate, firstDay, statement, type BridgeReason, type CommandRow,
} from '../../core/statements';
import { lastDayOfPeriod, periodLabel, periodOf, shortDate, todayInChicago } from '../../core/dates';
import { can } from '../../core/permissions';
import { formatMoney } from '../../core/money';
import { GRADE_LABEL } from '../../core/fuel';
import type { ReportBasis } from '../../core/types';

function useParam(key: string, fallback: string): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams();
  return [sp.get(key) ?? fallback, (v: string) => { const n = new URLSearchParams(sp); if (v && v !== fallback) n.set(key, v); else n.delete(key); setSp(n, { replace: true }); }];
}

function NoAccess({ title }: { title: string }) {
  return <PageHead title={title} lede="Your role doesn't include company reports. Ask the CFO for access." />;
}

/** Months that have any sales posted, newest first. */
function useSalesMonths(): string[] {
  const { state, lines } = useBooks();
  return useMemo(() => {
    const rev = new Set(state.accounts.filter((a) => a.type === 'revenue').map((a) => a.id));
    return [...new Set(lines.filter((f) => rev.has(f.l.accountId)).map((f) => f.period))].sort().reverse();
  }, [state, lines]);
}

// ── Command center ───────────────────────────────────────────────────────
export function CommandCenterPage() {
  const { state, lines, stores, user } = useBooks();
  const entries = useEntries();
  const months = useSalesMonths();
  const latest = useMemo(() => latestSalesPeriod(state, lines) ?? periodOf(todayInChicago()), [state, lines]);
  const [month, setMonth] = useParam('month', latest);
  const [basis, setBasis] = useParam('basis', 'accrual');
  const b = basis as ReportBasis;
  const ids = stores.map((s) => s.id);
  const cc = useMemo(() => commandCenter(state, { period: month, basis: b, storeIds: ids, entries }), [state, month, b, ids.join(), entries]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can(user, 'view.reports')) return <NoAccess title="Command center" />;
  const store = (id: string) => stores.find((s) => s.id === id);
  const pnlHref = (id?: string) => `/reports/pnl?from=${month}&to=${month}${b !== 'booked' ? `&basis=${b}` : ''}${id ? `&store=${id}` : ''}`;
  const laborPill = (r: CommandRow) => {
    if (r.laborPct === null) return <span className="muted">–</span>;
    if (r.laborTargetBps === undefined) return <>{pct(r.laborPct)}</>;
    const over = r.laborPct * 10000 > r.laborTargetBps;
    return <span className={'pill ' + (over ? 'bad' : 'ok')} title={`Target ${(r.laborTargetBps / 100).toFixed(1)}%`}>{pct(r.laborPct)}<span className="sr-only">{over ? ', over target' : ', within target'}</span></span>;
  };
  const delta = (r: CommandRow) => r.net - r.priorNet;
  const rows = cc.rows;
  const header = ['Store', 'Net sales', 'Gross margin', 'GM %', 'Labor', 'Labor %', 'Net profit', 'Net margin', `Net profit ${cc.prior}`, 'Change'];
  const exportRows: (string | number)[][] = [...rows, cc.total].map((r) => [r.key === 'total' ? 'Company total' : store(r.key)?.code ?? r.key, csvMoney(r.sales), csvMoney(r.gross), r.gmPct === null ? '' : (r.gmPct * 100).toFixed(1), csvMoney(r.labor), r.laborPct === null ? '' : (r.laborPct * 100).toFixed(1), csvMoney(r.net), r.netPct === null ? '' : (r.netPct * 100).toFixed(1), csvMoney(r.priorNet), csvMoney(delta(r))]);
  const defaulted = month === latest;

  return (
    <>
      <PageHead eyebrow={`Reports · ${BASIS_LABEL[b].toLowerCase()} basis`} title="Command center" lede={<>{periodLabel(month)}{defaulted ? ', the latest month with sales.' : '.'} One row per store with activity, and the company total. Click a store&apos;s profit for its P&amp;L.</>}>
        <ExportButtons name={`command-center-${b}-${month}`} header={header} rows={exportRows} sheet={`Command center ${month}`} />
      </PageHead>
      <section className="figures" aria-label="Company" style={{ marginBottom: 20 }}>
        <div className="figure"><div className="label">Net sales</div><Link className="value" to={pnlHref()}><Money c={cc.total.sales} whole dollar /></Link><div className="fig-note">{rows.length} stores with activity</div></div>
        <div className="figure"><div className="label">Gross margin</div><div className="value"><Money c={cc.total.gross} whole dollar /></div><div className="fig-note">{pct(cc.total.gmPct)} of sales</div></div>
        <div className="figure"><div className="label">Labor</div><div className="value">{pct(cc.total.laborPct)}</div><div className="fig-note"><Money c={cc.total.labor} whole dollar /> net pay + payroll taxes</div></div>
        <div className="figure"><div className="label">Net profit</div><Link className="value" to={pnlHref()}><Money c={cc.total.net} whole dollar signed /></Link><div className="fig-note"><Money c={delta(cc.total)} whole dollar signed /> vs {periodLabel(cc.prior)}</div></div>
      </section>
      <section className="panel">
        <div className="filters">
          <div className="field"><label htmlFor="cc-month">Month</label><select id="cc-month" value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{periodLabel(m)}{m === latest ? ' (latest)' : ''}</option>)}</select></div>
          <div className="field seg-field"><span className="seg-label" aria-hidden>Basis</span><BasisSeg label="Basis" value={b} onChange={(v) => setBasis(v)} options={BASES} /></div>
        </div>
        <ul className="board" aria-label="Stores">
          {rows.map((r) => {
            const s = store(r.key);
            const d = delta(r);
            return (
              <li key={r.key} className={'board-tile' + (r.net < 0 ? ' loss' : '')}>
                <div className="board-top"><span className="board-code">{s?.code}</span><span className="muted small">{s?.name}</span></div>
                <Link className="board-net" to={pnlHref(r.key)} aria-label={`${s?.code} net profit ${formatMoney(r.net, { dollarSign: true, whole: true })} — open the P&L`}><Money c={r.net} whole dollar signed /></Link>
                <div className="board-sub muted small">net profit · {pct(r.netPct)} of sales · <Money c={d} whole dollar signed /> vs prior</div>
                <dl className="board-kv">
                  <dt>Sales</dt><dd><Money c={r.sales} whole dollar /></dd>
                  <dt>Gross margin</dt><dd><Money c={r.gross} whole dollar /> <span className="muted">{pct(r.gmPct)}</span></dd>
                  <dt>Labor</dt><dd>{laborPill(r)}</dd>
                </dl>
              </li>
            );
          })}
        </ul>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Store</th><th scope="col" className="num">Net sales</th><th scope="col" className="num">Gross margin</th><th scope="col" className="num">GM %</th><th scope="col" className="num">Labor %</th><th scope="col" className="num">Net profit</th><th scope="col" className="num">Net margin</th><th scope="col" className="num">vs {periodLabel(cc.prior)}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td><Link to={pnlHref(r.key)}>{store(r.key)?.code}</Link> <span className="muted small">{store(r.key)?.name}</span></td>
                  <td className="num"><Money c={r.sales} whole /></td>
                  <td className="num"><Money c={r.gross} whole /></td>
                  <td className="num">{pct(r.gmPct)}</td>
                  <td className="num">{laborPill(r)}</td>
                  <td className="num"><Money c={r.net} whole signed /></td>
                  <td className="num">{pct(r.netPct)}</td>
                  <td className="num"><Money c={delta(r)} whole signed /></td>
                </tr>
              ))}
              <tr className="total">
                <td>Company total</td><td className="num"><Money c={cc.total.sales} whole /></td><td className="num"><Money c={cc.total.gross} whole /></td><td className="num">{pct(cc.total.gmPct)}</td>
                <td className="num">{pct(cc.total.laborPct)}</td><td className="num"><Money c={cc.total.net} whole signed /></td><td className="num">{pct(cc.total.netPct)}</td><td className="num"><Money c={delta(cc.total)} whole signed /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <TieOut items={[
          { label: cc.rowsAddUp ? 'Store rows add to the company total' : 'Store rows do not add up', ok: cc.rowsAddUp },
          { label: cc.tiesToPnl ? `Ties to the ${BASIS_LABEL[b].toLowerCase()} P&L` : 'Does not tie to the P&L', ok: cc.tiesToPnl, detail: <Link to={pnlHref()}>open the P&amp;L</Link> },
        ]} />
      </section>
      <p className="muted small" style={{ marginTop: 10 }}>Labor % = net pay + payroll taxes (6100 + 6110) ÷ net sales on the same basis; the pill compares it with the store&apos;s target from People › Labor %. <Link to="/reports/scorecards">Scorecards</Link> · <Link to="/reports/board">Board pack</Link></p>
      <Help k="commandCenter" />
    </>
  );
}

// ── Drill-down ───────────────────────────────────────────────────────────
export function DrillPage() {
  const { state, stores, user } = useBooks();
  const entries = useEntries();
  const [sp] = useSearchParams();
  const basisP = sp.get('basis') ?? 'accrual';
  const isBridge = basisP === 'bridge';
  const basis = (isBridge ? 'accrual' : basisP) as ReportBasis;
  const from = sp.get('from') ?? periodOf(todayInChicago());
  const to = sp.get('to') ?? from;
  const storeId = sp.get('store') ?? '';
  const accountId = sp.get('account') ?? '';
  const reason = sp.get('reason') as BridgeReason | null;
  const ids = storeId ? stores.filter((s) => s.id === storeId).map((s) => s.id) : stores.map((s) => s.id);
  const account = state.accounts.find((a) => a.id === accountId);
  const d0 = firstDay(from), d1 = lastDayOfPeriod(to);
  const inR = (d: string | null) => !!d && d >= d0 && d <= d1;
  const rows = useMemo(() => {
    if (isBridge) {
      const want = new Set(ids);
      return entries.filter((e) => want.has(e.storeId) && e.reason === reason && (!accountId || e.accountId === accountId) && inR(e.cashDate) !== inR(e.accrualDate))
        .sort((a, b) => a.bookDate.localeCompare(b.bookDate));
    }
    return drill(entries, { basis, from, to, storeIds: ids, accountIds: accountId ? new Set([accountId]) : undefined });
  }, [entries, isBridge, basis, from, to, ids.join(), accountId, reason]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can(user, 'view.reports')) return <NoAccess title="Drill-down" />;
  const sign = account && (account.type === 'revenue' || account.type === 'contra_revenue') ? 1 : account ? -1 : 1;
  const shown = (amt: number) => sign * amt;
  /** Bridge contribution of one entry: (in accrual − in cash) × amount. */
  const contrib = (e: typeof rows[number]) => isBridge ? ((inR(e.accrualDate) ? 1 : 0) - (inR(e.cashDate) ? 1 : 0)) * e.amount : shown(e.amount);
  const total = rows.reduce((a, e) => a + contrib(e), 0);
  // Independent figure the rows must equal.
  const st = useMemo(() => statement(state, { basis, from, to, storeIds: ids, entries }), [state, basis, from, to, ids.join(), entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const figure = isBridge ? null : account ? (st.rows.find((r) => r.account.id === account.id)?.total ?? 0) : st.netIncome.total;
  const code = (id: string) => state.stores.find((s) => s.id === id)?.code ?? id;
  const range = from === to ? periodLabel(from) : `${periodLabel(from)} – ${periodLabel(to)}`;
  const title = isBridge && reason ? BRIDGE_LABEL[reason].label : `${account?.name ?? 'Net profit'}${storeId ? ` · ${code(storeId)}` : ''}`;
  const LIMIT = 400;
  const header = ['Date', 'Book date', 'Cash date', 'Ref', 'Description', 'Store', 'Account', 'Why dates differ', 'Amount'];
  const exportRows = rows.map((e) => [entryDate(e, basis) ?? '', e.bookDate, e.cashDate ?? 'not in cash basis', e.txn?.ref ?? 'accrual fuel', e.txn?.description ?? 'Gallons sold × delivered cost', code(e.storeId), state.accounts.find((a) => a.id === e.accountId)?.name ?? '', e.reason ? BRIDGE_LABEL[e.reason].label : '', csvMoney(contrib(e))]);
  const back = `/reports/pnl?from=${from}&to=${to}${basis !== 'booked' ? `&basis=${isBridge ? 'compare' : basis}` : ''}${storeId ? `&store=${storeId}` : ''}`;

  return (
    <>
      <PageHead eyebrow={`Reports · drill-down · ${isBridge ? 'cash → accrual bridge' : BASIS_LABEL[basis].toLowerCase() + ' basis'}`} title={title} lede={<>{range}{storeId ? '' : ', all stores'}. Every entry behind the figure. <Link to={back}>Back to the P&amp;L</Link></>}>
        <ExportButtons name={`drill-${basisP}-${accountId || reason || 'net'}-${from}-${to}`} header={header} rows={exportRows} />
      </PageHead>
      <section className="figures" aria-label="Summary" style={{ marginBottom: 20 }}>
        <div className="figure"><div className="label">{isBridge ? 'Bridge amount' : 'Figure'}</div><div className="value"><Money c={total} dollar signed={isBridge} /></div></div>
        <div className="figure"><div className="label">Entries</div><div className="value">{rows.length}</div></div>
        <div className="figure"><div className="label">Basis</div><div className="value">{isBridge ? 'Bridge' : BASIS_LABEL[basis].replace(' (ledger)', '')}</div><div className="fig-note">{basis === 'cash' ? 'by clear / settlement date' : basis === 'accrual' ? 'by transaction date, accrual fuel cost' : 'as posted'}</div></div>
      </section>
      <section className="panel">
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">{isBridge ? 'Book date' : 'Date'}</th><th scope="col">Ref</th><th scope="col">Description</th><th scope="col">Store</th>{!account && <th scope="col">Account</th>}<th scope="col">Cash date</th><th scope="col" className="num">Amount</th></tr></thead>
            <tbody>
              {rows.slice(0, LIMIT).map((e) => (
                <tr key={e.id}>
                  <td>{shortDate(isBridge ? e.bookDate : entryDate(e, basis)!)}</td>
                  <td>{e.txn ? <Link to={`/books/transactions/${e.txn.id}`}>{e.txn.ref}</Link> : <Link to={`/fuel?month=${periodOf(e.bookDate)}`}>Fuel margin</Link>}</td>
                  <td>{e.txn ? e.txn.description : <>Accrual fuel cost: {e.fuel!.byGrade.map((g) => `${GRADE_LABEL[g.grade]} ${Math.round(g.gallons).toLocaleString('en-US')} gal × ${g.costPerGallon === null ? '–' : (g.costPerGallon / 100).toFixed(4)}`).join('; ')}</>}
                    {e.reason && e.reason !== 'fuel_accrual' && <div className="muted small">{BRIDGE_LABEL[e.reason].label}{e.checkNo ? ` · check #${e.checkNo}` : ''}</div>}</td>
                  <td>{code(e.storeId)}</td>
                  {!account && <td>{state.accounts.find((a) => a.id === e.accountId)?.name}</td>}
                  <td>{e.cashDate ? (e.cashDate === e.bookDate ? <span className="muted">same</span> : shortDate(e.cashDate)) : <span className="pill warn">not in cash</span>}</td>
                  <td className="num"><Money c={contrib(e)} signed={isBridge} /></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="muted">Nothing on this basis in the range.</td></tr>}
              <tr className="total"><td colSpan={account ? 5 : 6}>Total{rows.length > LIMIT ? ` (first ${LIMIT} of ${rows.length} shown; the export has all)` : ''}</td><td className="num"><Money c={total} signed={isBridge} /></td></tr>
            </tbody>
          </table>
        </div>
        <TieOut items={figure === null ? [{ label: `${rows.length} entries add to the bridge line`, ok: true, detail: 'see the bridge on the P&L' }] : [
          { label: total === figure ? 'Entries add to the P&L figure' : `Entries differ from the P&L by ${formatMoney(Math.abs(total - figure), { dollarSign: true })}`, ok: total === figure, detail: <Money c={figure} dollar /> },
        ]} />
      </section>
      <Help k="drill" />
    </>
  );
}

// ── Balance sheet ────────────────────────────────────────────────────────
export function BalanceSheetPage() {
  const { state, lines, user } = useBooks();
  const [asOf, setAsOf] = useParam('asOf', todayInChicago());
  const [entityId, setEntity] = useParam('entity', '');
  const bs = useMemo(() => balanceSheet(state, { asOf, entityId: entityId || undefined, lines }), [state, asOf, entityId, lines]);
  if (!can(user, 'view.reports') || !can(user, 'view.all_stores')) return <NoAccess title="Balance sheet" />;
  const ent = state.entities.find((e) => e.id === entityId);
  const exportRows: (string | number)[][] = [];
  for (const s of bs.sections) {
    exportRows.push([s.label, '', '']);
    for (const g of s.groups) {
      for (const l of g.lines) {
        exportRows.push([g.label, `${l.account.number} ${l.account.name}`, csvMoney(l.amount)]);
        for (const c of l.children ?? []) exportRows.push([g.label, `  ${c.label}`, csvMoney(c.amount)]);
      }
      if (g.extra) exportRows.push([g.label, g.extra.label, csvMoney(g.extra.amount)]);
      exportRows.push([`Total ${g.label.toLowerCase()}`, '', csvMoney(g.total)]);
    }
    exportRows.push([`Total ${s.label.toLowerCase()}`, '', csvMoney(s.total)]);
  }
  exportRows.push(['Liabilities + equity', '', csvMoney(bs.totalLiabilities + bs.totalEquity)]);
  const ties = [
    { label: bs.difference === 0 ? 'Assets = liabilities + equity' : `Out of balance by ${formatMoney(Math.abs(bs.difference), { dollarSign: true })}`, ok: bs.difference === 0 },
    { label: bs.agreesToTb ? 'Agrees to the trial balance, account by account' : `Differs from the trial balance: ${bs.tbMismatches.join(', ')}`, ok: bs.agreesToTb, detail: <Link to={`/reports/trial-balance?asOf=${asOf}${entityId ? `&entity=${entityId}` : ''}`}>trial balance</Link> },
    ...(!entityId ? [{ label: bs.groupNet === 0 ? 'Due from and due to group entities eliminate' : `Group due-to / due-from off by ${formatMoney(Math.abs(bs.groupNet), { dollarSign: true })}`, ok: bs.groupNet === 0 }] : []),
  ];

  return (
    <>
      <PageHead eyebrow="Reports · booked basis" title="Balance sheet" lede={`${ent ? ent.name : 'Consolidated, all entities'} · as of ${shortDate(asOf)}`}>
        <ExportButtons name={`balance-sheet-${ent?.code ?? 'consolidated'}-${asOf}`} header={['Group', 'Account', 'Amount']} rows={[...exportRows, [], ...ties.map((t) => [`Tie-out: ${t.label}`, t.ok ? 'OK' : 'CHECK'])]} sheet={`Balance sheet ${asOf}`} />
      </PageHead>
      <section className="figures" aria-label="Summary" style={{ marginBottom: 20 }}>
        <div className="figure"><div className="label">Total assets</div><div className="value"><Money c={bs.totalAssets} whole dollar /></div></div>
        <div className="figure"><div className="label">Total liabilities</div><div className="value"><Money c={bs.totalLiabilities} whole dollar /></div></div>
        <div className="figure"><div className="label">Equity</div><div className="value"><Money c={bs.totalEquity} whole dollar /></div><div className="fig-note">incl. <Money c={bs.currentEarnings} whole dollar signed /> this year</div></div>
        <div className="figure"><div className="label">Cash and equivalents</div><div className="value"><Money c={bs.sections[0].groups.filter((g) => ['bank', 'cash', 'clearing'].includes(g.key)).reduce((a, g) => a + g.total, 0)} whole dollar /></div><div className="fig-note">bank, cash, supplier clearing</div></div>
      </section>
      <section className="panel">
        <div className="filters">
          <div className="field"><label htmlFor="bs-asof">As of</label><input id="bs-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
          <div className="field wide"><label htmlFor="bs-ent">Entity</label><select id="bs-ent" value={entityId} onChange={(e) => setEntity(e.target.value)}><option value="">Consolidated (all entities)</option>{state.entities.filter((e) => !e.deleted).map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}</select></div>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Line</th><th scope="col" className="num">Amount</th></tr></thead>
            <tbody>
              {bs.sections.map((s) => (
                <Fragment key={s.key}>
                  <tr className="section"><td colSpan={2}>{s.label}</td></tr>
                  {s.groups.map((g) => (
                    <Fragment key={g.key}>
                      <tr className="sub"><td>{g.label}</td><td className="num"><Money c={g.total} /></td></tr>
                      {g.lines.filter((l) => l.amount || ['accrued', 'inventory', 'bank'].includes(g.key)).map((l) => (
                        <Fragment key={l.account.id}>
                          <tr className="indent"><td><Link to={`/books/accounts/${l.account.id}?from=${bs.fyStart}&to=${asOf}`}>{l.account.number} · {l.account.name}</Link></td><td className="num"><Money c={l.amount} /></td></tr>
                          {l.children?.map((c) => <tr key={c.key} className="indent child"><td><span className="muted">{c.label}</span></td><td className="num muted"><Money c={c.amount} /></td></tr>)}
                        </Fragment>
                      ))}
                      {g.extra && <tr className="indent"><td><Link to={`/reports/pnl?from=${bs.fyStart.slice(0, 7)}&to=${periodOf(asOf)}`}>{g.extra.label}</Link></td><td className="num"><Money c={g.extra.amount} /></td></tr>}
                    </Fragment>
                  ))}
                  <tr className="total"><td>Total {s.label.toLowerCase()}</td><td className="num"><Money c={s.total} /></td></tr>
                </Fragment>
              ))}
              <tr className="total"><td>Liabilities + equity</td><td className="num"><Money c={bs.totalLiabilities + bs.totalEquity} /></td></tr>
            </tbody>
          </table>
        </div>
        <TieOut items={ties} />
      </section>
      <p className="muted small" style={{ marginTop: 10 }}>The balance sheet is the ledger as posted. Fuel inventory (1300) isn&apos;t adjusted for gallons in the tanks yet; the accrual P&amp;L&apos;s bridge shows the change at delivered cost.</p>
      <Help k="balanceSheet" />
    </>
  );
}

// ── Cash flow ────────────────────────────────────────────────────────────
export function CashFlowPage() {
  const { state, lines, user } = useBooks();
  const months = useSalesMonths();
  const latest = useMemo(() => latestSalesPeriod(state, lines) ?? periodOf(todayInChicago()), [state, lines]);
  const [from, setFrom] = useParam('from', latest);
  const [toRaw, setTo] = useParam('to', '');
  const to = toRaw && toRaw >= from ? toRaw : from;
  const [entityId, setEntity] = useParam('entity', '');
  const cf = useMemo(() => cashFlow(state, { from: firstDay(from), to: periodEnd(to), entityId: entityId || undefined, lines }), [state, from, to, entityId, lines]);
  if (!can(user, 'view.reports') || !can(user, 'view.all_stores')) return <NoAccess title="Cash flow" />;
  const ent = state.entities.find((e) => e.id === entityId);
  const range = from === to ? periodLabel(from) : `${periodLabel(from)} – ${periodLabel(to)}`;
  const exportRows: (string | number)[][] = [
    ...cf.sections.flatMap((s) => [...s.lines.map((l) => [s.label, l.label, csvMoney(l.amount)]), [`Net cash from ${s.label.toLowerCase()}`, '', csvMoney(s.total)]]),
    ['Net change in cash and equivalents', '', csvMoney(cf.netChange)], ['Opening cash and equivalents', '', csvMoney(cf.openingCash)], ['Closing cash and equivalents', '', csvMoney(cf.closingCash)],
    [], ['Tie-out: opening + net change = closing', cf.openingCash + cf.netChange === cf.closingCash ? 'OK' : 'CHECK'],
  ];
  const sorted = [...months].reverse();

  return (
    <>
      <PageHead eyebrow="Reports · indirect method" title="Cash flow statement" lede={`${ent ? ent.name : 'Consolidated, all entities'} · ${range}`}>
        <ExportButtons name={`cash-flow-${ent?.code ?? 'consolidated'}-${from}-to-${to}`} header={['Section', 'Line', 'Amount']} rows={exportRows} sheet={`Cash flow ${from}`} />
      </PageHead>
      <section className="figures" aria-label="Summary" style={{ marginBottom: 20 }}>
        <div className="figure"><div className="label">Net income</div><div className="value"><Money c={cf.netIncome} whole dollar signed /></div><div className="fig-note">booked basis</div></div>
        {cf.sections.map((s) => <div className="figure" key={s.key}><div className="label">{s.label}</div><div className="value"><Money c={s.total} whole dollar signed /></div></div>)}
        <div className="figure"><div className="label">Change in cash</div><div className="value"><Money c={cf.netChange} whole dollar signed /></div><div className="fig-note">to <Money c={cf.closingCash} whole dollar /></div></div>
      </section>
      <section className="panel">
        <div className="filters">
          <div className="field"><label htmlFor="cf-from">From month</label><select id="cf-from" value={from} onChange={(e) => setFrom(e.target.value)}>{sorted.map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}</select></div>
          <div className="field"><label htmlFor="cf-to">To month</label><select id="cf-to" value={to} onChange={(e) => setTo(e.target.value)}>{sorted.filter((m) => m >= from).map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}</select></div>
          <div className="field wide"><label htmlFor="cf-ent">Entity</label><select id="cf-ent" value={entityId} onChange={(e) => setEntity(e.target.value)}><option value="">Consolidated (all entities)</option>{state.entities.filter((e) => !e.deleted).map((e) => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}</select></div>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Line</th><th scope="col" className="num">Amount</th></tr></thead>
            <tbody>
              {cf.sections.map((s) => (
                <Fragment key={s.key}>
                  <tr className="section"><td colSpan={2}>{s.label}</td></tr>
                  {s.lines.map((l) => <tr key={l.key} className="indent"><td>{l.accountId ? <Link to={`/books/accounts/${l.accountId}?from=${firstDay(from)}&to=${periodEnd(to)}`}>{l.label}</Link> : l.key === 'ni' ? <Link to={`/reports/pnl?from=${from}&to=${to}`}>{l.label}</Link> : l.label}</td><td className="num"><Money c={l.amount} /></td></tr>)}
                  {!s.lines.length && <tr className="indent"><td className="muted">Nothing in the period.</td><td /></tr>}
                  <tr className="sub"><td>Net cash from {s.label.toLowerCase()}</td><td className="num"><Money c={s.total} /></td></tr>
                </Fragment>
              ))}
              <tr className="total"><td>Net change in cash and equivalents</td><td className="num"><Money c={cf.netChange} /></td></tr>
              <tr className="indent"><td>Opening cash and equivalents</td><td className="num"><Money c={cf.openingCash} /></td></tr>
              <tr className="sub"><td>Closing cash and equivalents</td><td className="num"><Money c={cf.closingCash} /></td></tr>
            </tbody>
          </table>
        </div>
        <TieOut items={[
          { label: cf.openingCash + cf.netChange === cf.closingCash ? 'Opening + net change = closing cash' : 'Does not reach the closing cash', ok: cf.openingCash + cf.netChange === cf.closingCash },
          { label: cf.netChange === cf.directChange ? 'Agrees with the cash accounts in the ledger' : `Differs from the cash accounts by ${formatMoney(Math.abs(cf.netChange - cf.directChange), { dollarSign: true })}`, ok: cf.netChange === cf.directChange, detail: cf.cashAccounts.map((a) => a.number).join(', ') },
        ]} />
      </section>
      <p className="muted small" style={{ marginTop: 10 }}>Cash and cash equivalents = bank, cash on hand and in transit, and supplier / card clearing. Looking ahead: <Link to="/cash/forecast">the 13-week forecast</Link>.</p>
      <Help k="cashFlow" />
    </>
  );
}
