import { useMemo, Fragment, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Help, Money, PageHead, TieOut, csvMoney } from '../components/ui';
import { BasisSeg, BASES, ExportButtons, pct, ratioPct, useEntries } from '../components/reportkit';
import { latestSalesPeriod, pnl, type PnlSection } from '../../core/reports';
import { BASIS_LABEL, bridge, budgetCompare, priorRange, statement, type Bridge, type Statement, type StmtRow } from '../../core/statements';
import { lastDayOfPeriod, periodLabel, periodOf, todayInChicago } from '../../core/dates';
import { LOB_LABEL } from '../../core/coa';
import { can } from '../../core/permissions';
import { formatMoney } from '../../core/money';
import type { LineOfBusiness, ReportBasis } from '../../core/types';

// ── Profit & loss: booked, cash, accrual, and the bridge ─────────────────
const SECTION_LABEL: Record<PnlSection, string> = { revenue: 'Sales', contra_revenue: 'Discounts', cogs: 'Cost of goods', expense: 'Operating expenses' };
type Mode = ReportBasis | 'compare';
type View = 'store' | 'month' | 'prior';
type Grid = Pick<Statement, 'rows' | 'netSales' | 'cogs' | 'grossProfit' | 'expenses' | 'netIncome' | 'salesByLob' | 'gpByLob'>;
interface Col { key: string; label: string; title?: string; drill?: { basis: ReportBasis; from: string; to: string; storeId?: string }; diff?: boolean }

/** Two statements' totals side by side, plus a difference column (a − b). */
function merge(a: Statement, b: Statement, ka: string, kb: string, kd: string): Grid {
  const ids = [...new Set([...a.rows, ...b.rows].map((r) => r.account.id))];
  const rows: StmtRow[] = ids.map((id) => {
    const ra = a.rows.find((r) => r.account.id === id), rb = b.rows.find((r) => r.account.id === id);
    const base = (ra ?? rb)!;
    const va = ra?.total ?? 0, vb = rb?.total ?? 0;
    return { ...base, by: { [ka]: va, [kb]: vb, [kd]: va - vb }, total: va - vb };
  }).sort((x, y) => x.account.number.localeCompare(y.account.number));
  const rec = (x: Record<string, number>, y: Record<string, number>) => ({ [ka]: x.total, [kb]: y.total, [kd]: x.total - y.total, total: x.total - y.total });
  const lob = (x: Statement['salesByLob'], y: Statement['salesByLob']) => Object.fromEntries((Object.keys(x) as LineOfBusiness[]).map((l) => [l, rec(x[l], y[l])])) as unknown as Statement['salesByLob'];
  return { rows, netSales: rec(a.netSales, b.netSales), cogs: rec(a.cogs, b.cogs), grossProfit: rec(a.grossProfit, b.grossProfit), expenses: rec(a.expenses, b.expenses), netIncome: rec(a.netIncome, b.netIncome), salesByLob: lob(a.salesByLob, b.salesByLob), gpByLob: lob(a.gpByLob, b.gpByLob) };
}

export function PnlPage() {
  const { state, lines, stores, user } = useBooks();
  const entries = useEntries();
  const [sp, setSp] = useSearchParams();
  const latest = useMemo(() => latestSalesPeriod(state, lines) ?? periodOf(todayInChicago()), [state, lines]);
  const fromP = sp.get('from') ?? latest;
  const toP = sp.get('to') ?? fromP;
  const storeFilter = sp.get('store') ?? '';
  const mode = (['booked', 'cash', 'accrual', 'compare'].includes(sp.get('basis') ?? '') ? sp.get('basis') : 'booked') as Mode;
  const view = (['store', 'month', 'prior'].includes(sp.get('view') ?? '') ? sp.get('view') : 'store') as View;
  const showPct = sp.get('pct') === '1';
  const defaulted = !sp.get('from');
  const cols = stores.filter((s) => (storeFilter ? s.id === storeFilter : true));
  const ids = cols.map((s) => s.id);
  const key = ids.join();
  const basis: ReportBasis = mode === 'compare' ? 'accrual' : mode;
  const prior = priorRange(fromP, toP);
  const ledger = useMemo(() => pnl(state, { from: fromP, to: toP, storeIds: ids, lines }), [state, fromP, toP, key, lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const main = useMemo(() => statement(state, { basis, from: fromP, to: toP, storeIds: ids, cols: view === 'month' && mode !== 'compare' ? 'month' : 'store', entries }), [state, basis, fromP, toP, key, view, mode, entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const br = useMemo(() => bridge(state, { from: fromP, to: toP, storeIds: ids, entries }), [state, fromP, toP, key, entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const periods = useMemo(() => [...new Set(lines.map((f) => f.period))].sort(), [lines]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (!n.get('from')) n.set('from', fromP); setSp(n, { replace: true }); };
  const label = fromP === toP ? periodLabel(fromP) : `${periodLabel(fromP)} – ${periodLabel(toP)}`;
  const priorLabel = prior.from === prior.to ? periodLabel(prior.from) : `${periodLabel(prior.from)} – ${periodLabel(prior.to)}`;
  const shown = cols.filter((s) => s.kind !== 'leased_out' || main.rows.some((row) => row.by[s.id]));
  const codeOf = (id?: string) => stores.find((s) => s.id === id)?.code ?? '';
  const sf = storeFilter || undefined;

  // Columns, and the grid they read from.
  let grid: Grid = main;
  let colDefs: Col[];
  if (mode === 'compare') {
    const cash = statement(state, { basis: 'cash', from: fromP, to: toP, storeIds: ids, entries });
    grid = merge(main, cash, 'accrual', 'cash', 'diff');
    colDefs = [{ key: 'cash', label: 'Cash', drill: { basis: 'cash', from: fromP, to: toP, storeId: sf } }, { key: 'accrual', label: 'Accrual', drill: { basis: 'accrual', from: fromP, to: toP, storeId: sf } }, { key: 'diff', label: 'Accrual − cash', diff: true }];
  } else if (view === 'prior') {
    const pri = statement(state, { basis, from: prior.from, to: prior.to, storeIds: ids, entries });
    grid = merge(main, pri, 'cur', 'pri', 'chg');
    colDefs = [{ key: 'cur', label, drill: { basis, from: fromP, to: toP, storeId: sf } }, { key: 'pri', label: priorLabel, drill: { basis, from: prior.from, to: prior.to, storeId: sf } }, { key: 'chg', label: 'Change', diff: true }];
  } else if (view === 'month') {
    colDefs = [...main.cols.map((p) => ({ key: p, label: periodLabel(p), drill: { basis, from: p, to: p, storeId: sf } })), { key: 'total', label: 'Total', drill: { basis, from: fromP, to: toP, storeId: sf } }];
  } else {
    colDefs = [...shown.map((s) => ({ key: s.id, label: s.code, title: s.name, drill: { basis, from: fromP, to: toP, storeId: s.id } })), { key: 'total', label: 'Total', drill: { basis, from: fromP, to: toP, storeId: sf } }];
  }
  const drillHref = (accountId: string, c: Col) => {
    const d = c.drill!;
    if (d.basis === 'booked') return `/books/transactions?account=${accountId}${d.storeId ? `&store=${d.storeId}` : ''}&from=${d.from}-01&to=${lastDayOfPeriod(d.to)}`;
    return `/reports/drill?basis=${d.basis}&account=${accountId}${d.storeId ? `&store=${d.storeId}` : ''}&from=${d.from}&to=${d.to}`;
  };
  const merged = mode === 'compare' || view === 'prior';
  const headKey = merged ? colDefs[mode === 'compare' ? 1 : 0].key : 'total';
  const fig = { netSales: grid.netSales[headKey], grossProfit: grid.grossProfit[headKey], expenses: grid.expenses[headKey], netIncome: grid.netIncome[headKey] };

  const under = (v: number, c: Col, base: Record<string, number> | undefined, pri?: number) => {
    if (c.diff) return view === 'prior' && pri !== undefined ? <div className="muted small">{pri ? pct(v / Math.abs(pri)) : '–'}</div> : null;
    return base ? <div className="muted small">{ratioPct(v, base[c.key])}</div> : null;
  };
  const sub = (title: string, vals: Record<string, number>, cls = 'sub', base?: Record<string, number>) => (
    <tr className={cls}>
      <td>{title}</td>
      {colDefs.map((c) => <td className="num" key={c.key}><Money c={vals[c.key] ?? 0} signed={c.diff} />{under(vals[c.key] ?? 0, c, base ?? (showPct ? grid.netSales : undefined), vals.pri)}</td>)}
    </tr>
  );
  const rowsOf = (sections: PnlSection[]) => grid.rows.filter((x) => sections.includes(x.section));
  const accountRow = (x: StmtRow) => (
    <tr key={x.account.id} className="indent">
      <td><Link to={`/books/accounts/${x.account.id}?from=${fromP}-01&to=${lastDayOfPeriod(toP)}`}>{x.account.name}</Link>{x.account.id === 'acct_cogs_fuel' && basis !== 'booked' && <div className="muted small">{mode === 'compare' ? 'cash: invoices paid · accrual: gallons sold × delivered cost' : 'gallons sold × delivered cost per gallon'}</div>}</td>
      {colDefs.map((c) => {
        const v = x.by[c.key];
        if (!v) return <td className="num" key={c.key}><span className="muted">–</span></td>;
        if (!c.drill) return <td className="num" key={c.key}><Money c={v} signed />{under(v, c, undefined, x.by.pri)}</td>;
        return <td className="num" key={c.key}><Link className="cell-link" to={drillHref(x.account.id, c)} aria-label={`${x.account.name}, ${c.label}: ${formatMoney(v)} — see transactions`}><Money c={v} /></Link>{showPct && under(v, c, grid.netSales)}</td>;
      })}
    </tr>
  );
  const plain = !merged;
  const sumCols = plain ? colDefs.filter((c) => c.key !== 'total').reduce((a, c) => a + (main.netIncome[c.key] ?? 0), 0) + (view === 'store' ? cols.filter((s) => !shown.includes(s)).reduce((a, s) => a + main.netIncome[s.id], 0) : 0) : null;
  const colsOk = sumCols === null || sumCols === main.netIncome.total;
  const paidFuel = ledger.rows.find((r) => r.account.id === 'acct_cogs_fuel')?.total ?? 0;
  const ties: { label: string; ok: boolean; detail?: ReactNode }[] = [];
  if (mode === 'booked') {
    const ok = ledger.difference === 0 && main.netIncome.total === ledger.netIncome.total;
    ties.push({ label: ok ? 'Ties to the ledger' : `Differs from the ledger by ${formatMoney(Math.abs(main.netIncome.total - ledger.ledgerNet), { dollarSign: true })}`, ok, detail: 'every P&L line in range, summed independently' });
  } else ties.push({ label: main.difference === 0 ? `${BASIS_LABEL[basis]} P&L ties to its ${main.entryCount} entries` : 'Does not tie to its entries', ok: main.difference === 0 });
  if (basis === 'accrual') {
    const ok = main.netIncome.total === ledger.netIncome.total + paidFuel - br.fuel.accrualCogs;
    ties.push({ label: ok ? 'Accrual = booked + paid fuel − accrual fuel cost' : 'Accrual does not reconcile to the ledger', ok, detail: <><Money c={ledger.netIncome.total} dollar /> + <Money c={paidFuel} dollar /> − <Money c={br.fuel.accrualCogs} dollar /></> });
  }
  if (mode !== 'booked') ties.push({ label: br.ties ? 'Cash + bridge = accrual' : 'Bridge does not tie', ok: br.ties, detail: <><Money c={br.cash} dollar /> + <Money c={br.total} dollar /> = <Money c={br.accrual} dollar /></> });
  if (mode === 'compare') ties.push({ label: grid.netIncome.diff === br.total ? 'Line differences add to the bridge' : 'Line differences do not add to the bridge', ok: grid.netIncome.diff === br.total });
  if (sumCols !== null) ties.push({ label: colsOk ? (view === 'month' ? 'Month columns add to the total' : 'Store columns add to the total') : 'Columns do not add up', ok: colsOk });

  const exportName = `pnl-${mode}-${merged ? (mode === 'compare' ? 'compare' : 'prior') : view}-${fromP}-to-${toP}${storeFilter ? '-' + codeOf(storeFilter) : ''}`;
  const exportHeader = ['Account', 'Section', 'Line of business', ...colDefs.map((c) => c.title ?? c.label)];
  const exportRows: (string | number)[][] = [
    ...grid.rows.map((x) => [x.account.name, SECTION_LABEL[x.section], LOB_LABEL[x.lob], ...colDefs.map((c) => csvMoney(x.by[c.key] ?? 0))]),
    ['Net sales', '', '', ...colDefs.map((c) => csvMoney(grid.netSales[c.key] ?? 0))],
    ['Gross profit', '', '', ...colDefs.map((c) => csvMoney(grid.grossProfit[c.key] ?? 0))],
    ['Net profit', '', '', ...colDefs.map((c) => csvMoney(grid.netIncome[c.key] ?? 0))],
    ...(mode !== 'booked' ? [[], ['Bridge: net profit, cash basis', '', '', csvMoney(br.cash)], ...br.lines.map((l) => [l.label, 'Bridge', '', csvMoney(l.amount)]), ['Net profit, accrual basis', '', '', csvMoney(br.accrual)]] : []),
    [], ...ties.map((t) => [`Tie-out: ${t.label}`, t.ok ? 'OK' : 'CHECK']),
  ];
  const budget = budgetCompare(main);
  if (!can(user, 'view.reports') && !stores.length) return <PageHead title="Profit & loss" lede="Your role doesn't include company reports. Ask the CFO for access." />;

  return (
    <>
      <PageHead eyebrow={`Reports · ${mode === 'compare' ? 'cash vs accrual' : BASIS_LABEL[basis].toLowerCase() + ' basis'}`} title="Profit & loss by store" lede={<>{label}{defaulted && ' — the latest month with sales'}. Click any amount for the transactions behind it.</>}>
        <ExportButtons name={exportName} header={exportHeader} rows={exportRows} sheet={`P&L ${fromP}`} />
      </PageHead>

      <section className="figures" aria-label="Summary" style={{ marginBottom: 20 }}>
        <div className="figure"><div className="label">Net sales</div><div className="value"><Money c={fig.netSales} whole dollar /></div><div className="fig-note">{mode === 'compare' ? 'accrual basis' : BASIS_LABEL[basis]}</div></div>
        <div className="figure"><div className="label">Gross profit</div><div className="value"><Money c={fig.grossProfit} whole dollar /></div><div className="fig-note">{ratioPct(fig.grossProfit, fig.netSales)} of sales</div></div>
        <div className="figure"><div className="label">Operating expenses</div><div className="value"><Money c={fig.expenses} whole dollar /></div><div className="fig-note">{ratioPct(fig.expenses, fig.netSales)} of sales</div></div>
        <div className="figure"><div className="label">Net profit</div><div className="value"><Money c={fig.netIncome} whole dollar signed /></div><div className="fig-note">{ratioPct(fig.netIncome, fig.netSales)} of sales</div></div>
        {mode !== 'booked' && <div className="figure"><div className="label">Cash → accrual bridge</div><div className="value"><Money c={br.total} whole dollar signed /></div><div className="fig-note">{br.ties ? 'ties to the cent' : 'does not tie'}</div></div>}
      </section>

      <section className="panel">
        <div className="filters">
          <div className="field"><label htmlFor="p-from">From month</label><select id="p-from" value={fromP} onChange={(e) => { const n = new URLSearchParams(sp); n.set('from', e.target.value); if (toP < e.target.value) n.set('to', e.target.value); setSp(n, { replace: true }); }}>{periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
          <div className="field"><label htmlFor="p-to">To month</label><select id="p-to" value={toP} onChange={(e) => { const n = new URLSearchParams(sp); n.set('from', fromP); n.set('to', e.target.value); setSp(n, { replace: true }); }}>{periods.filter((p) => p >= fromP).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
          <div className="field"><label htmlFor="p-store">Store</label><select id="p-store" value={storeFilter} onChange={(e) => set('store', e.target.value)}><option value="">All stores</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
          <div className="field"><label htmlFor="p-view">View</label><select id="p-view" value={mode === 'compare' ? 'store' : view} disabled={mode === 'compare'} onChange={(e) => set('view', e.target.value === 'store' ? '' : e.target.value)}><option value="store">By store</option><option value="month">By month (trend)</option><option value="prior">Vs prior period</option></select></div>
          <div className="field seg-field"><span className="seg-label" aria-hidden>Basis</span><BasisSeg label="Basis" value={mode} onChange={(v) => set('basis', v === 'booked' ? '' : v)} options={[...BASES, { v: 'compare' as const, label: 'Compare' }]} /></div>
          <label className="check" style={{ marginBottom: 8 }}><input type="checkbox" checked={showPct} onChange={(e) => set('pct', e.target.checked ? '1' : '')} /> % of sales</label>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Line</th>{colDefs.map((c) => <th scope="col" className="num" key={c.key}><span title={c.title}>{c.label}</span></th>)}</tr></thead>
            <tbody>
              {(['fuel', 'inside', 'kitchen', 'other'] as LineOfBusiness[]).map((lob) => {
                const rows = rowsOf(['revenue', 'contra_revenue']).filter((x) => x.lob === lob);
                if (!rows.length) return null;
                return (
                  <Fragment key={lob}>
                    <tr className="section"><td colSpan={colDefs.length + 1}>{LOB_LABEL[lob]} sales</td></tr>
                    {rows.map(accountRow)}
                  </Fragment>
                );
              })}
              {sub('Net sales', grid.netSales)}
              <tr className="section"><td colSpan={colDefs.length + 1}>Cost of goods</td></tr>
              {rowsOf(['cogs']).map(accountRow)}
              {sub('Total cost of goods', grid.cogs)}
              {sub('Gross profit', grid.grossProfit, 'sub', grid.netSales)}
              {(['fuel', 'inside', 'kitchen'] as LineOfBusiness[]).map((lob) => colDefs.some((c) => grid.salesByLob[lob][c.key]) ? <Fragment key={lob}>{sub(`${LOB_LABEL[lob]} margin`, grid.gpByLob[lob], 'indent', grid.salesByLob[lob])}</Fragment> : null)}
              <tr className="section"><td colSpan={colDefs.length + 1}>Operating expenses</td></tr>
              {rowsOf(['expense']).map(accountRow)}
              {sub('Total operating expenses', grid.expenses)}
              {sub('Net profit', grid.netIncome, 'total', grid.netSales)}
            </tbody>
          </table>
        </div>
        <TieOut items={ties} />
      </section>

      {mode !== 'booked' && <BridgePanel br={br} from={fromP} to={toP} storeId={storeFilter} />}

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head"><h2>Budget comparison</h2><span className="muted small">{budget.available ? 'Budget vs actual' : budget.message}</span></div>
        <div className="panel-pad"><p className="muted small" style={{ margin: 0 }}>Budget vs actual on every line, with the variance in dollars and percent, plugs in here once budgets are entered.</p></div>
      </section>
      <Help k="pnl" />
    </>
  );
}

export function BridgePanel({ br, from, to, storeId }: { br: Bridge; from: string; to: string; storeId?: string }) {
  const q = (reason: string) => `/reports/drill?basis=bridge&reason=${reason}&from=${from}&to=${to}${storeId ? `&store=${storeId}` : ''}`;
  return (
    <section className="panel" style={{ marginTop: 20 }} aria-labelledby="bridge-h">
      <div className="panel-head"><h2 id="bridge-h">Bridge: cash basis to accrual basis</h2><span className="muted small">Every difference, by why the dates differ</span></div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th scope="col">Line</th><th scope="col" className="num">Items</th><th scope="col" className="num">Amount</th></tr></thead>
          <tbody>
            <tr className="sub"><td>Net profit, cash basis</td><td /><td className="num"><Money c={br.cash} /></td></tr>
            {br.lines.map((l) => (
              <tr key={l.reason} className="indent">
                <td>{l.count ? <Link to={q(l.reason)}>{l.label}</Link> : l.label}<div className="muted small">{l.detail}</div></td>
                <td className="num">{l.count || '–'}</td>
                <td className="num"><Money c={l.amount} signed /></td>
              </tr>
            ))}
            <tr className="total"><td>Net profit, accrual basis</td><td /><td className="num"><Money c={br.accrual} /></td></tr>
          </tbody>
        </table>
      </div>
      <div className="panel-pad">
        <h3 style={{ marginBottom: 6 }}>Fuel, explained</h3>
        <p className="small muted">The fuel lines of the bridge split into what changed on the balance sheet. Fuel inventory (1300) and fuel delivered but not yet paid aren&apos;t adjusted in the ledger yet, so the accrual basis carries them here.</p>
        <dl className="kv">
          <dt>Fuel delivered (invoice cost)</dt><dd><Money c={br.fuel.delivered} dollar /></dd>
          <dt>Fuel invoices paid</dt><dd><Money c={br.fuel.paid} dollar /></dd>
          <dt>Accrual fuel cost of sales</dt><dd><Money c={br.fuel.accrualCogs} dollar /></dd>
          <dt>Fuel inventory change at cost</dt><dd><Money c={br.fuel.inventoryChange} dollar signed /> <span className="muted small">delivered − sold</span></dd>
          <dt>Delivered, not yet paid</dt><dd><Money c={br.fuel.payableChange} dollar signed /> <span className="muted small">delivered − paid</span></dd>
        </dl>
      </div>
      <TieOut items={[
        { label: br.ties ? 'Cash + bridge = accrual, to the cent' : 'Bridge does not tie', ok: br.ties, detail: <><Money c={br.cash} dollar /> + <Money c={br.total} dollar /> = <Money c={br.accrual} dollar /></> },
        { label: 'Fuel: inventory change − unpaid change = paid − accrual cost', ok: br.fuel.inventoryChange - br.fuel.payableChange === br.fuel.paid - br.fuel.accrualCogs },
      ]} />
    </section>
  );
}
