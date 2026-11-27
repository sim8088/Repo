import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBooks } from '../store';
import { Errors, Figure, Help, Money, PageHead, TieOut, csvMoney, useToast } from '../components/ui';
import { BasisSeg, BASES, ExportButtons, pct, ratioPct, useEntries } from '../components/reportkit';
import {
  activeVersion, addVarianceComment, adjLabel, breakEven, budgetsOf, budgetStatement, bva, cellKey, createBudgetVersion, dataStart, fillAcross, fiscalYearOf,
  fyLabel, fyPeriods, newStoreId, PCT_TARGETS, pnlAccounts, rollingForecast, runScenario, saveScenario, deleteScenario, SCENARIO_KIND_LABEL, setActiveVersion,
  setBudgetCells, setForecastMode, setVarianceThreshold, versionById, versionTotals, WEEKDAYS, type ForecastSource, type ScenarioResult,
} from '../../core/budgets';
import { scorecards, type Statement } from '../../core/statements';
import { addDays, lastDayOfPeriod, periodLabel, periodOf, todayInChicago } from '../../core/dates';
import { formatMoney, parseMoney } from '../../core/money';
import { can } from '../../core/permissions';
import { ValidationError } from '../../core/books';
import { LOB_LABEL } from '../../core/coa';
import type { Account, BudgetMethod, ID, ReportBasis, ScenarioAdj } from '../../core/types';

const errText = (e: unknown) => (e instanceof ValidationError ? e.errors.join(' ') : (e as Error).message);
const errList = (e: unknown) => (e instanceof ValidationError ? e.errors : [(e as Error).message]);
const mon = (p: string) => `${periodLabel(p).slice(0, 3)} ’${p.slice(2, 4)}`;
const prevPeriod = (p: string) => periodOf(addDays(`${p}-01`, -1));

type Section = 'sales' | 'cogs' | 'expense';
const SECTIONS: { key: Section; label: string; match: (a: Account) => boolean }[] = [
  { key: 'sales', label: 'Sales', match: (a) => a.type === 'revenue' || a.type === 'contra_revenue' },
  { key: 'cogs', label: 'Cost of goods', match: (a) => a.type === 'cogs' },
  { key: 'expense', label: 'Operating expenses', match: (a) => a.type === 'expense' },
];

/** The fiscal year to show: ?fy=, else the year today is in. */
function useFy(): [number, number[], (fy: number) => void] {
  const { state } = useBooks();
  const [sp, setSp] = useSearchParams();
  const now = fiscalYearOf(state, periodOf(todayInChicago()));
  const known = [...new Set([now, now + 1, ...budgetsOf(state).versions.map((v) => v.fiscalYear), ...budgetsOf(state).scenarios.map((s) => s.fiscalYear)])].sort();
  const fy = Number(sp.get('fy')) || now;
  return [fy, known, (f) => { const n = new URLSearchParams(sp); n.set('fy', String(f)); n.delete('v'); setSp(n, { replace: true }); }];
}
function FySelect({ id = 'fy' }: { id?: string }) {
  const { state } = useBooks();
  const [fy, fys, setFy] = useFy();
  return <div className="field"><label htmlFor={id}>Fiscal year</label><select id={id} value={fy} onChange={(e) => setFy(Number(e.target.value))}>{fys.map((f) => <option key={f} value={f}>{fyLabel(state, f)}</option>)}</select></div>;
}

/** The last month that is over and has activity: the default month for comparisons. */
function useLastMonth(): string {
  const { state } = useBooks();
  const cur = periodOf(todayInChicago());
  const start = dataStart(state) ?? cur;
  const last = prevPeriod(cur);
  return last < start ? cur : last;
}

// ── Annual budget ────────────────────────────────────────────────────────
export function AnnualBudgetPage() {
  const { state, books, user, stores } = useBooks();
  const [sp, setSp] = useSearchParams();
  const [toast, say] = useToast();
  const [fy] = useFy();
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const versions = budgetsOf(state).versions.filter((v) => v.fiscalYear === fy);
  const v = versionById(state, sp.get('v') ?? '') ?? activeVersion(state, fy) ?? versions[0];
  const storeId = sp.get('store') ?? '';
  const months = fyPeriods(state, fy);
  const ids = storeId ? [storeId] : stores.map((s) => s.id);
  const key = ids.join();
  const st = useMemo(() => (v ? budgetStatement(state, { from: months[0], to: months[11], storeIds: ids, cols: 'month', versionId: v.id }) : null), [state, v, key, fy]); // eslint-disable-line react-hooks/exhaustive-deps
  const [extra, setExtra] = useState<ID[]>([]);
  const [adding, setAdding] = useState('');
  const editable = !!v && !!storeId && can(user, 'budget.edit');
  const totals = v ? versionTotals(state, v) : null;
  const accounts = pnlAccounts(state);
  const rowIds = new Set([...(st?.rows.map((r) => r.account.id) ?? []), ...(editable ? extra : [])]);
  const rows = accounts.filter((a) => rowIds.has(a.id));
  const byId = new Map(st?.rows.map((r) => [r.account.id, r]) ?? []);
  const codeOf = (id: ID) => stores.find((s) => s.id === id)?.code ?? id;
  const save = (accountId: ID, period: string, text: string, before: number) => {
    const c = parseMoney(text);
    if (c === null && text.trim()) { say('Type an amount such as 12,500 or (300).'); return; }
    const amount = c ?? 0;
    if (amount === before) return;
    try { setBudgetCells(books, user, v!.id, [{ storeId, accountId, period, amount }]); say(`${accounts.find((a) => a.id === accountId)?.name}, ${periodLabel(period)}: ${formatMoney(amount, { dollarSign: true })}.`); } catch (e) { say(errText(e)); }
  };
  const fill = (accountId: ID, mode: 'copy' | 'spread') => {
    try {
      fillAcross(books, user, v!.id, { storeId, accountId, mode, from: months[0], annual: byId.get(accountId)?.total ?? 0 });
      say(mode === 'copy' ? `Copied ${periodLabel(months[0])} into every later month.` : 'Spread the year\'s total evenly over twelve months.');
    } catch (e) { say(errText(e)); }
  };
  const fc = useMemo(() => (v?.active ? rollingForecast(state, { fiscalYear: fy, storeIds: ids }) : null), [state, v, fy, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const sumCols = st ? months.reduce((a, p) => a + (st.netIncome[p] ?? 0), 0) : 0;
  const cellNet = totals ? ids.reduce((a, s) => a + (totals.byStore.get(s) ?? 0), 0) : 0;
  const ties = st ? [
    { label: sumCols === st.netIncome.total ? 'Months add to the year' : 'Months do not add up', ok: sumCols === st.netIncome.total },
    { label: cellNet === st.netIncome.total ? 'Grid ties to the budget\'s cells' : 'Grid differs from the budget\'s cells', ok: cellNet === st.netIncome.total, detail: <Money c={cellNet} dollar /> },
    ...(fc ? [{ label: fc.budget.netIncome.total === st.netIncome.total ? 'Same total on Rolling forecast' : 'Rolling forecast budget differs', ok: fc.budget.netIncome.total === st.netIncome.total, detail: <Link to={`/budgets/forecast?fy=${fy}${storeId ? `&store=${storeId}` : ''}`}>forecast</Link> }] : []),
  ] : [];
  const exportRows = st ? [
    ...rows.map((a) => [`${a.number} ${a.name}`, ...months.map((p) => csvMoney(byId.get(a.id)?.by[p] ?? 0)), csvMoney(byId.get(a.id)?.total ?? 0)]),
    ['Net sales', ...months.map((p) => csvMoney(st.netSales[p])), csvMoney(st.netSales.total)],
    ['Gross profit', ...months.map((p) => csvMoney(st.grossProfit[p])), csvMoney(st.grossProfit.total)],
    ['Net profit', ...months.map((p) => csvMoney(st.netIncome[p])), csvMoney(st.netIncome.total)],
  ] : [];

  return (
    <>
      <PageHead eyebrow="Budgets" title="Annual budget" lede={v ? <>{v.name} · {fyLabel(state, fy)}. {v.basisNote}</> : `No budget for ${fyLabel(state, fy)} yet. Build one below from last year's actuals plus growth, or start from zero.`}>
        {st && <ExportButtons name={`budget-${fy}-${v!.name.replace(/\W+/g, '-').toLowerCase()}${storeId ? '-' + codeOf(storeId) : ''}`} header={['Line', ...months.map(periodLabel), 'Year']} rows={exportRows} sheet={`Budget ${fy}`} />}
      </PageHead>
      <section className="figures" aria-label="Summary" style={{ marginBottom: 20 }}>
        <Figure label="Budget net sales" value={<Money c={st?.netSales.total ?? 0} whole dollar />} note={storeId ? codeOf(storeId) : 'all stores'} />
        <Figure label="Budget gross profit" value={<Money c={st?.grossProfit.total ?? 0} whole dollar />} note={`${ratioPct(st?.grossProfit.total ?? 0, st?.netSales.total ?? 0)} of sales`} />
        <Figure label="Budget net profit" value={<Money c={st?.netIncome.total ?? 0} whole dollar signed />} note={`${ratioPct(st?.netIncome.total ?? 0, st?.netSales.total ?? 0)} of sales`} />
        <Figure label="Versions" value={versions.length} note={v?.active ? `"${v.name}" is active` : versions.length ? 'none active' : 'none yet'} />
      </section>

      {v && st && (
        <section className="panel" aria-labelledby="grid-h">
          <div className="panel-head"><h2 id="grid-h">{storeId ? `${codeOf(storeId)} budget by month` : 'All stores by month'}</h2><span className="muted small">{editable ? 'Type a figure and leave the cell to save it. Sales and costs are both positive.' : storeId ? 'Read only for your role.' : 'Pick one store to edit its lines.'}</span></div>
          <div className="filters">
            <FySelect id="bud-fy" />
            <div className="field wide"><label htmlFor="bud-v">Version</label><select id="bud-v" value={v.id} onChange={(e) => set('v', e.target.value)}>{versions.map((x) => <option key={x.id} value={x.id}>{x.name}{x.active ? ' (active)' : ''}</option>)}</select></div>
            <div className="field"><label htmlFor="bud-store">Store</label><select id="bud-store" value={storeId} onChange={(e) => set('store', e.target.value)}><option value="">All stores</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
            {editable && (
              <div className="field wide"><label htmlFor="bud-add">Add a line</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select id="bud-add" value={adding} onChange={(e) => setAdding(e.target.value)}><option value="">Pick an account…</option>{accounts.filter((a) => !rowIds.has(a.id)).map((a) => <option key={a.id} value={a.id}>{a.number} · {a.name}</option>)}</select>
                  <button className="btn sm" disabled={!adding} onClick={() => { setExtra([...extra, adding]); setAdding(''); }}>Add</button>
                </div>
              </div>
            )}
          </div>
          <div className="table-wrap">
            <table className="t budget-grid">
              <thead><tr><th scope="col">Line</th>{months.map((p) => <th scope="col" className="num" key={p}>{mon(p)}</th>)}<th scope="col" className="num">Year</th>{editable && <th scope="col"><span className="sr-only">Fill</span></th>}</tr></thead>
              <tbody>
                {SECTIONS.map((sec) => {
                  const mine = rows.filter(sec.match);
                  return (
                    <Fragment key={sec.key}>
                      <tr className="section"><td colSpan={months.length + 2 + (editable ? 1 : 0)}>{sec.label}</td></tr>
                      {mine.map((a) => {
                        const r = byId.get(a.id);
                        return (
                          <tr key={a.id} className="indent">
                            <td>{a.name}</td>
                            {months.map((p) => {
                              const val = r?.by[p] ?? 0;
                              return <td key={p} className="num">{editable ? <input className="num grid-input" aria-label={`${a.name}, ${periodLabel(p)}`} key={`${v.id}|${cellKey(storeId, a.id, p)}|${val}`} defaultValue={val ? formatMoney(val, { whole: val % 100 === 0 }) : ''} onBlur={(e) => save(a.id, p, e.target.value, val)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /> : val ? <Money c={val} whole /> : <span className="muted">–</span>}</td>;
                            })}
                            <td className="num"><b><Money c={r?.total ?? 0} whole /></b></td>
                            {editable && <td style={{ whiteSpace: 'nowrap' }}><button className="btn sm ghost" onClick={() => fill(a.id, 'copy')} aria-label={`Copy ${mon(months[0])} → ${a.name}`}>Copy {mon(months[0])} →</button><button className="btn sm ghost" onClick={() => fill(a.id, 'spread')} aria-label={`Even out ${a.name}`}>Even out</button></td>}
                          </tr>
                        );
                      })}
                      {sec.key === 'sales' && <SubRow label="Net sales" vals={st.netSales} months={months} extra={editable} />}
                      {sec.key === 'cogs' && <><SubRow label="Total cost of goods" vals={st.cogs} months={months} extra={editable} /><SubRow label="Gross profit" vals={st.grossProfit} months={months} extra={editable} /></>}
                      {sec.key === 'expense' && <SubRow label="Total operating expenses" vals={st.expenses} months={months} extra={editable} />}
                    </Fragment>
                  );
                })}
                <SubRow label="Net profit" vals={st.netIncome} months={months} extra={editable} cls="total" signed />
              </tbody>
            </table>
          </div>
          <TieOut items={ties} />
        </section>
      )}

      <VersionsPanel fy={fy} onMsg={say} />
      {toast}
      <Help k="budgetAnnual" />
    </>
  );
}

function SubRow({ label, vals, months, extra, cls = 'sub', signed }: { label: string; vals: Record<string, number>; months: string[]; extra?: boolean; cls?: string; signed?: boolean }) {
  return <tr className={cls}><td>{label}</td>{months.map((p) => <td key={p} className="num"><Money c={vals[p] ?? 0} whole signed={signed} /></td>)}<td className="num"><Money c={vals.total ?? 0} whole signed={signed} /></td>{extra && <td />}</tr>;
}

function VersionsPanel({ fy, onMsg }: { fy: number; onMsg: (m: string) => void }) {
  const { state, books, user } = useBooks();
  const entries = useEntries();
  const [, setSp] = useSearchParams();
  const versions = budgetsOf(state).versions.filter((v) => v.fiscalYear === fy);
  const [name, setName] = useState('');
  const [method, setMethod] = useState<BudgetMethod | 'copy'>('prior_actuals');
  const [growth, setGrowth] = useState('3');
  const [errs, setErrs] = useState<string[]>([]);
  const edit = can(user, 'budget.edit');
  const act = activeVersion(state, fy);
  const build = () => {
    try {
      const g = Number(growth);
      const v = createBudgetVersion(books, user, { fiscalYear: fy, name: name || `FY${fy} ${method === 'zero' ? 'zero-based' : 'budget'}`, method: method === 'copy' ? 'prior_actuals' : method, growthPct: Number.isFinite(g) ? g : NaN, copyFromId: method === 'copy' ? act?.id : undefined }, { entries });
      setErrs([]); setName('');
      onMsg(`Built "${v.name}".`);
      setSp((sp) => { const n = new URLSearchParams(sp); n.set('v', v.id); return n; }, { replace: true });
    } catch (e) { setErrs(errList(e)); }
  };
  return (
    <section className="panel" aria-labelledby="ver-h" style={{ marginTop: 20 }}>
      <div className="panel-head"><h2 id="ver-h">Versions for {fyLabel(state, fy)}</h2><span className="muted small">One version is active: budget vs actual, the forecast and the close read it.</span></div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th scope="col">Version</th><th scope="col">Built from</th><th scope="col" className="num">Net sales</th><th scope="col" className="num">Net profit</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
          <tbody>
            {versions.length === 0 && <tr><td colSpan={6} className="muted">No versions yet.</td></tr>}
            {versions.map((v) => {
              const t = versionTotals(state, v);
              return (
                <tr key={v.id}>
                  <td><Link to={`/budgets?fy=${fy}&v=${v.id}`}>{v.name}</Link></td>
                  <td className="small">{v.method === 'zero' ? 'Zero-based' : `Last year's actuals + ${v.growthPct}%`}</td>
                  <td className="num"><Money c={t.sales} whole /></td>
                  <td className="num"><Money c={t.net} whole signed /></td>
                  <td>{v.active ? <span className="pill ok">Active</span> : <span className="pill">Draft</span>}</td>
                  <td>{edit && !v.active && <button className="btn sm" onClick={() => { try { setActiveVersion(books, user, v.id); onMsg(`"${v.name}" is now the active budget.`); } catch (e) { onMsg(errText(e)); } }}>Make active</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {edit && (
        <div className="panel-pad" style={{ borderTop: '1px solid var(--rule)' }}>
          <h3 style={{ marginBottom: 10 }}>Build a new version</h3>
          <Errors errors={errs} />
          <div className="form-grid">
            <div className="field"><label htmlFor="nv-name">Name</label><input id="nv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`FY${fy} budget`} /></div>
            <div className="field"><label htmlFor="nv-method">Start from</label><select id="nv-method" value={method} onChange={(e) => setMethod(e.target.value as BudgetMethod | 'copy')}><option value="prior_actuals">Last year's actuals + growth</option><option value="zero">Zero (enter every line)</option>{act && <option value="copy">A copy of "{act.name}"</option>}</select></div>
            {method === 'prior_actuals' && <div className="field"><label htmlFor="nv-growth">Growth %</label><input id="nv-growth" className="num" inputMode="decimal" value={growth} onChange={(e) => setGrowth(e.target.value)} /></div>}
          </div>
          <p className="muted small">The demo books start in September 2026, so there is no prior year to copy: the complete months on file are annualized (each store's monthly average, flat across the year) and the note on the version says exactly which months.</p>
          <div className="actions" style={{ marginTop: 10 }}><button className="btn primary" onClick={build}>Build version</button></div>
        </div>
      )}
    </section>
  );
}

// ── Budget vs actual ─────────────────────────────────────────────────────
export function BvaPage() {
  const { state, books, user, stores } = useBooks();
  const entries = useEntries();
  const [sp, setSp] = useSearchParams();
  const [toast, say] = useToast();
  const last = useLastMonth();
  const fromP = sp.get('month') ?? sp.get('from') ?? last;
  const toP = sp.get('to') && sp.get('to')! >= fromP ? sp.get('to')! : fromP;
  const storeFilter = sp.get('store') ?? '';
  const basis = (['booked', 'cash', 'accrual'].includes(sp.get('basis') ?? '') ? sp.get('basis') : 'accrual') as ReportBasis;
  const onlyOpen = sp.get('show') === 'open';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (!n.get('month') && !n.get('from')) n.set('month', fromP); setSp(n, { replace: true }); };
  const ids = storeFilter ? [storeFilter] : stores.map((s) => s.id);
  const key = ids.join();
  const r = useMemo(() => bva(state, { from: fromP, to: toP, storeIds: ids, basis, entries }), [state, fromP, toP, key, basis, entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = dataStart(state) ?? fromP;
  const cur = periodOf(todayInChicago());
  const periods = useMemo(() => {
    const fys = budgetsOf(state).versions.map((v) => v.fiscalYear);
    const all = new Set<string>();
    for (const f of fys) for (const p of fyPeriods(state, f)) if (p >= start && p <= cur) all.add(p);
    if (!all.size) all.add(fromP);
    return [...all].sort();
  }, [state, start, cur, fromP]);
  const codeOf = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  const userName = (id: ID) => state.users.find((u) => u.id === id)?.name ?? id;
  const over = r.cells.filter((c) => c.over);
  const open = over.filter((c) => !c.comments.length);
  const listed = onlyOpen ? open : over;
  const varianceNet = r.actual.netIncome.total - r.budget.netIncome.total;
  const label = fromP === toP ? periodLabel(fromP) : `${periodLabel(fromP)} – ${periodLabel(toP)}`;
  const partial = toP >= cur;
  const t = budgetsOf(state).threshold;
  const varianceOk = r.rows.every((x) => x.variance === x.actual - x.budget);

  const sub = (title: string, a: number, b: number, cls = 'sub', sign: 1 | -1 = 1) => (
    <tr className={cls}><td>{title}</td><td className="num"><Money c={a} /></td><td className="num"><Money c={b} /></td><td className="num"><Money c={a - b} signed={sign === 1} className={sign === -1 ? (a - b > 0 ? 'neg' : a - b < 0 ? 'pos' : '') : undefined} /></td><td className="num">{b ? pct((a - b) / Math.abs(b)) : '–'}</td><td /></tr>
  );
  const exportRows = [
    ...r.rows.map((x) => [`${x.account.number} ${x.account.name}`, csvMoney(x.actual), csvMoney(x.budget), csvMoney(x.variance), x.pct === null ? '' : (x.pct * 100).toFixed(1), x.flagged, x.uncommented]),
    ['Net profit', csvMoney(r.actual.netIncome.total), csvMoney(r.budget.netIncome.total), csvMoney(varianceNet)],
    [], ['Store', 'Month', 'Line', 'Actual', 'Budget', 'Variance', 'Comment'],
    ...over.map((c) => [codeOf(c.storeId), c.period, c.account.name, csvMoney(c.actual), csvMoney(c.budget), csvMoney(c.variance), c.comments.map((x) => x.text).join(' / ')]),
  ];

  return (
    <>
      <PageHead eyebrow={`Budgets · ${basis} basis`} title="Budget vs actual" lede={<>{label}{!sp.get('month') && !sp.get('from') && ' — the last month that is over'}. Every P&L line against the active budget, with the variance in dollars and percent, and a comment on every variance over the threshold.</>}>
        <ExportButtons name={`budget-vs-actual-${fromP}-to-${toP}${storeFilter ? '-' + codeOf(storeFilter) : ''}`} header={['Line', 'Actual', 'Budget', 'Variance', 'Variance %', 'Over threshold', 'Without comment']} rows={exportRows} sheet={`BvA ${fromP}`} />
      </PageHead>
      <section className="figures" aria-label="Summary" style={{ marginBottom: 20 }}>
        <Figure label="Actual net profit" value={<Money c={r.actual.netIncome.total} whole dollar signed />} note={`${basis} basis`} href={`/reports/pnl?basis=${basis === 'booked' ? '' : basis}&from=${fromP}&to=${toP}${storeFilter ? `&store=${storeFilter}` : ''}`} />
        <Figure label="Budget net profit" value={<Money c={r.budget.netIncome.total} whole dollar signed />} note={r.available ? 'active budget' : 'no active budget'} />
        <Figure label="Variance" value={<Money c={varianceNet} whole dollar signed />} note={varianceNet >= 0 ? 'better than budget' : 'worse than budget'} />
        <Figure label="Over the threshold" value={over.length} note={`${open.length} without a comment`} />
      </section>
      {!r.available && <div className="note warn" style={{ marginBottom: 16 }}>No active budget covers {label}. <Link to="/budgets">Build one in Annual budget</Link>.</div>}
      {partial && r.available && <div className="note" style={{ marginBottom: 16 }}>{periodLabel(cur)} isn't over: actuals run to date while the budget is the whole month.</div>}

      <section className="panel" aria-labelledby="bva-h">
        <div className="panel-head"><h2 id="bva-h">Every P&L line</h2><span className="muted small">Variance = actual − budget. Green helps profit, red hurts it.</span></div>
        <div className="filters">
          <div className="field"><label htmlFor="bva-from">Month</label><select id="bva-from" value={fromP} onChange={(e) => { const n = new URLSearchParams(sp); n.delete('from'); n.set('month', e.target.value); if (toP < e.target.value) n.delete('to'); setSp(n, { replace: true }); }}>{periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
          <div className="field"><label htmlFor="bva-to">Through</label><select id="bva-to" value={toP} onChange={(e) => set('to', e.target.value === fromP ? '' : e.target.value)}>{periods.filter((p) => p >= fromP).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
          <div className="field"><label htmlFor="bva-store">Store</label><select id="bva-store" value={storeFilter} onChange={(e) => set('store', e.target.value)}><option value="">All stores</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
          <div className="field seg-field"><span className="seg-label" aria-hidden>Basis</span><BasisSeg label="Basis" value={basis} onChange={(v) => set('basis', v === 'accrual' ? '' : v)} options={BASES} /></div>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Line</th><th scope="col" className="num">Actual</th><th scope="col" className="num">Budget</th><th scope="col" className="num">Variance</th><th scope="col" className="num">%</th><th scope="col">Over threshold</th></tr></thead>
            <tbody>
              {SECTIONS.map((sec) => {
                const mine = r.rows.filter((x) => sec.match(x.account));
                if (!mine.length) return null;
                return (
                  <Fragment key={sec.key}>
                    <tr className="section"><td colSpan={6}>{sec.label}</td></tr>
                    {mine.map((x) => (
                      <tr key={x.account.id} className="indent">
                        <td><Link to={`/reports/drill?basis=${basis}&account=${x.account.id}&from=${fromP}&to=${toP}${storeFilter ? `&store=${storeFilter}` : ''}`}>{x.account.name}</Link>{x.account.lob && x.account.lob !== 'other' && <span className="muted small"> · {LOB_LABEL[x.account.lob]}</span>}</td>
                        <td className="num"><Money c={x.actual} /></td>
                        <td className="num"><Money c={x.budget} /></td>
                        <td className="num"><Money c={x.variance} className={x.effect > 0 ? 'pos' : x.effect < 0 ? 'neg' : undefined} /></td>
                        <td className="num">{pct(x.pct)}</td>
                        <td>{x.flagged ? <Link className={'pill ' + (x.uncommented ? 'warn' : 'ok')} to={`?${new URLSearchParams({ month: fromP, ...(toP !== fromP ? { to: toP } : {}), ...(storeFilter ? { store: storeFilter } : {}), ...(x.uncommented ? { show: 'open' } : {}) }).toString()}#var-h`}>{x.flagged} · {x.uncommented ? `${x.uncommented} to explain` : 'explained'}</Link> : ''}</td>
                      </tr>
                    ))}
                    {sec.key === 'sales' && sub('Net sales', r.actual.netSales.total, r.budget.netSales.total)}
                    {sec.key === 'cogs' && sub('Total cost of goods', r.actual.cogs.total, r.budget.cogs.total, 'sub', -1)}
                    {sec.key === 'cogs' && sub('Gross profit', r.actual.grossProfit.total, r.budget.grossProfit.total)}
                    {sec.key === 'expense' && sub('Total operating expenses', r.actual.expenses.total, r.budget.expenses.total, 'sub', -1)}
                  </Fragment>
                );
              })}
              {sub('Net profit', r.actual.netIncome.total, r.budget.netIncome.total, 'total')}
            </tbody>
          </table>
        </div>
        <TieOut items={[
          { label: r.actualTiesToPnl ? 'Actuals tie to the P&L' : 'Actuals differ from the P&L', ok: r.actualTiesToPnl, detail: <Link to={`/reports/pnl?basis=${basis === 'booked' ? '' : basis}&from=${fromP}&to=${toP}${storeFilter ? `&store=${storeFilter}` : ''}`}>net profit <Money c={r.actual.netIncome.total} dollar /></Link> },
          { label: r.budgetTiesToCells ? 'Budget ties to the annual budget grid' : 'Budget differs from the grid', ok: r.budgetTiesToCells, detail: <Link to={`/budgets?fy=${fiscalYearOf(state, fromP)}${storeFilter ? `&store=${storeFilter}` : ''}`}><Money c={r.budgetCellNet} dollar /></Link> },
          { label: varianceOk ? 'Variance = actual − budget on every line' : 'A variance does not compute', ok: varianceOk },
        ]} />
      </section>

      <section className="panel" aria-labelledby="var-h" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <h2 id="var-h">Variances over the threshold</h2>
          <div className="actions">
            <label className="check"><input type="checkbox" checked={onlyOpen} onChange={(e) => set('show', e.target.checked ? 'open' : '')} /> Only without a comment</label>
          </div>
        </div>
        <p className="panel-pad muted small" style={{ margin: 0, paddingBottom: 0 }}>A store's line, in one month, at least {formatMoney(t.minCents, { dollarSign: true, whole: true })} and {t.pct}% off budget. Each one needs a sentence on why before the month can close.</p>
        {listed.length === 0 ? <p className="panel-pad muted">{over.length ? 'Every variance over the threshold has a comment.' : 'Nothing over the threshold.'}</p> : (
          <ul className="inbox var-list">
            {listed.map((c) => <VarianceItem key={c.key} c={c} codeOf={codeOf} userName={userName} canEdit={can(user, 'budget.edit') && state.periods[c.period]?.status !== 'locked'} onSave={(text) => { try { addVarianceComment(books, user, { period: c.period, storeId: c.storeId, accountId: c.account.id, text }); say('Comment saved.'); return true; } catch (e) { say(errText(e)); return false; } }} />)}
          </ul>
        )}
        <ThresholdForm />
      </section>
      {toast}
      <Help k="budgetBva" />
    </>
  );
}

function VarianceItem({ c, codeOf, userName, canEdit, onSave }: { c: ReturnType<typeof bva>['cells'][number]; codeOf: (id: ID) => string; userName: (id: ID) => string; canEdit: boolean; onSave: (t: string) => boolean }) {
  const [text, setText] = useState('');
  const id = `vc-${c.key.replace(/\W/g, '-')}`;
  return (
    <li style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <div className="what">
        <b>{codeOf(c.storeId)} · {c.account.name} · {periodLabel(c.period)}</b>
        <span>Actual <Money c={c.actual} dollar /> vs budget <Money c={c.budget} dollar />: <Money c={c.variance} dollar className={c.effect > 0 ? 'pos' : 'neg'} /> ({pct(c.pct)}) {c.effect > 0 ? 'better' : 'worse'} than plan.</span>
        {c.comments.map((x) => <span key={x.id} className="var-comment">“{x.text}” — {userName(x.by)}, {x.at.slice(0, 10)}</span>)}
        {canEdit && (
          <form className="var-form" onSubmit={(e) => { e.preventDefault(); if (onSave(text)) setText(''); }}>
            <label className="sr-only" htmlFor={id}>Comment on {codeOf(c.storeId)} {c.account.name}, {periodLabel(c.period)}</label>
            <input id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder={c.comments.length ? 'Add to the explanation…' : 'Why is this off budget?'} />
            <button className="btn sm" type="submit" disabled={!text.trim()}>{c.comments.length ? 'Add' : 'Save comment'}</button>
          </form>
        )}
      </div>
    </li>
  );
}

function ThresholdForm() {
  const { state, books, user } = useBooks();
  const t = budgetsOf(state).threshold;
  const [p, setP] = useState(String(t.pct));
  const [m, setM] = useState(String(t.minCents / 100));
  const [msg, setMsg] = useState('');
  if (!can(user, 'budget.edit')) return null;
  return (
    <div className="panel-pad" style={{ borderTop: '1px solid var(--rule)' }}>
      <div className="filters" style={{ padding: 0, border: 0 }}>
        <div className="field"><label htmlFor="th-pct">Threshold %</label><input id="th-pct" className="num" inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} /></div>
        <div className="field"><label htmlFor="th-min">and at least $</label><input id="th-min" className="num" inputMode="decimal" value={m} onChange={(e) => setM(e.target.value)} /></div>
        <button className="btn" style={{ marginBottom: 1 }} onClick={() => { try { setVarianceThreshold(books, user, { pct: Number(p), minCents: parseMoney(m) ?? NaN }); setMsg('Threshold saved.'); } catch (e) { setMsg(errText(e)); } }}>Save threshold</button>
        {msg && <span className="muted small" role="status">{msg}</span>}
      </div>
    </div>
  );
}

// ── Rolling forecast ─────────────────────────────────────────────────────
const SOURCE_LABEL: Record<ForecastSource, string> = { actual: 'Actual', mtd: 'Actual to date + rest of month', forecast: 'Forecast', budget_before_books: 'Budget (before the books start)' };
const SOURCE_SHORT: Record<ForecastSource, string> = { actual: 'actual', mtd: 'to date + plan', forecast: 'forecast', budget_before_books: 'budget' };

export function RollingForecastPage() {
  const { state, books, user, stores } = useBooks();
  const entries = useEntries();
  const [sp, setSp] = useSearchParams();
  const [toast, say] = useToast();
  const [fy] = useFy();
  const storeId = sp.get('store') ?? '';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const ids = storeId ? [storeId] : stores.map((s) => s.id);
  const key = ids.join();
  const fc = useMemo(() => rollingForecast(state, { fiscalYear: fy, storeIds: ids, entries }), [state, fy, key, entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = fc.statement;
  const months = fc.months;
  const v = fc.version;
  const editable = !!v && !!storeId && can(user, 'budget.edit');
  const byId = new Map(st.rows.map((r) => [r.account.id, r]));
  const budById = new Map(fc.budget.rows.map((r) => [r.account.id, r]));
  const ids2 = new Set([...st.rows, ...fc.budget.rows].map((r) => r.account.id));
  const accounts = pnlAccounts(state).filter((a) => ids2.has(a.id));
  const sumCols = months.reduce((a, m) => a + (st.netIncome[m.period] ?? 0), 0);
  const budgetTotals = v ? ids.reduce((a, s) => a + (versionTotals(state, v).byStore.get(s) ?? 0), 0) : null;
  const remaining = st.netIncome.total - fc.actualToDate;
  const saveOverride = (accountId: ID, period: string, text: string, before: number) => {
    const c = parseMoney(text);
    if (c === null && text.trim()) { say('Type an amount such as 12,500.'); return; }
    if ((c ?? 0) === before) return;
    try { setBudgetCells(books, user, v!.id, [{ storeId, accountId, period, amount: c ?? 0 }], 'forecast'); say(`Forecast for ${periodLabel(period)} saved.`); } catch (e) { say(errText(e)); }
  };
  const exportRows = [
    ['Source', ...months.map((m) => SOURCE_SHORT[m.source]), '', ''],
    ...accounts.map((a) => [`${a.number} ${a.name}`, ...months.map((m) => csvMoney(byId.get(a.id)?.by[m.period] ?? 0)), csvMoney(byId.get(a.id)?.total ?? 0), csvMoney(budById.get(a.id)?.total ?? 0)]),
    ['Net profit', ...months.map((m) => csvMoney(st.netIncome[m.period])), csvMoney(st.netIncome.total), csvMoney(fc.budget.netIncome.total)],
  ];
  const codeOf = (id: ID) => stores.find((s) => s.id === id)?.code ?? id;
  const editMonth = (m: { source: ForecastSource }) => editable && m.source === 'forecast';

  return (
    <>
      <PageHead eyebrow="Budgets" title="Rolling forecast" lede={<>{fyLabel(state, fy)}: actuals for every month that is over, then {fc.mode === 'run_rate' ? 'the run rate' : 'the budget'} (or your override) for the months to come. {fc.budgetNote}</>}>
        <ExportButtons name={`forecast-${fy}${storeId ? '-' + codeOf(storeId) : ''}`} header={['Line', ...months.map((m) => periodLabel(m.period)), 'Year', 'Budget']} rows={exportRows} sheet={`Forecast ${fy}`} />
      </PageHead>
      <section className="figures" aria-label="Summary" style={{ marginBottom: 20 }}>
        <Figure label="Forecast net profit" value={<Money c={st.netIncome.total} whole dollar signed />} note={fyLabel(state, fy)} />
        <Figure label="Budget net profit" value={<Money c={fc.budget.netIncome.total} whole dollar signed />} note={v ? `"${v.name}"` : 'stand-in from actuals'} />
        <Figure label="Forecast vs budget" value={<Money c={st.netIncome.total - fc.budget.netIncome.total} whole dollar signed />} note={st.netIncome.total >= fc.budget.netIncome.total ? 'ahead of plan' : 'behind plan'} />
        <Figure label="Actual to date" value={<Money c={fc.actualToDate} whole dollar signed />} note={`${months.filter((m) => m.source === 'actual').length} months over; ${formatMoney(remaining, { dollarSign: true, whole: true })} still to come`} />
      </section>
      <section className="panel" aria-labelledby="fc-h">
        <div className="panel-head"><h2 id="fc-h">{storeId ? codeOf(storeId) : 'All stores'} by month</h2><span className="muted small">{editable ? 'Type over a forecast month to override it; clear it to go back.' : 'Pick one store to override forecast months.'}</span></div>
        <div className="filters">
          <FySelect id="fc-fy" />
          <div className="field"><label htmlFor="fc-store">Store</label><select id="fc-store" value={storeId} onChange={(e) => set('store', e.target.value)}><option value="">All stores</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
          {v && can(user, 'budget.edit') && <div className="field seg-field"><span className="seg-label" aria-hidden>Months to come</span><BasisSeg label="Months to come" value={fc.mode} onChange={(m) => { setForecastMode(books, user, v.id, m); say(m === 'budget' ? 'Remaining months follow the budget.' : 'Remaining months follow the run rate of the last three months.'); }} options={[{ v: 'budget' as const, label: 'Budget' }, { v: 'run_rate' as const, label: 'Run rate' }]} /></div>}
        </div>
        <div className="table-wrap">
          <table className="t budget-grid">
            <thead>
              <tr><th scope="col">Line</th>{months.map((m) => <th scope="col" className="num" key={m.period}>{mon(m.period)}<div className={'muted small fc-src ' + m.source}>{SOURCE_SHORT[m.source]}</div></th>)}<th scope="col" className="num">Year</th><th scope="col" className="num">Budget</th><th scope="col" className="num">vs budget</th></tr>
            </thead>
            <tbody>
              {SECTIONS.map((sec) => (
                <Fragment key={sec.key}>
                  <tr className="section"><td colSpan={months.length + 4}>{sec.label}</td></tr>
                  {accounts.filter(sec.match).map((a) => {
                    const r = byId.get(a.id);
                    const b = budById.get(a.id)?.total ?? 0;
                    return (
                      <tr key={a.id} className="indent">
                        <td>{a.name}</td>
                        {months.map((m) => {
                          const val = r?.by[m.period] ?? 0;
                          return <td key={m.period} className={'num' + (m.source === 'actual' ? '' : ' fc-cell')}>{editMonth(m) ? <input className="num grid-input" aria-label={`${a.name}, ${periodLabel(m.period)} forecast`} key={`${cellKey(storeId, a.id, m.period)}|${val}`} defaultValue={val ? formatMoney(val, { whole: val % 100 === 0 }) : ''} onBlur={(e) => saveOverride(a.id, m.period, e.target.value, val)} /> : val ? <Money c={val} whole /> : <span className="muted">–</span>}</td>;
                        })}
                        <td className="num"><b><Money c={r?.total ?? 0} whole /></b></td>
                        <td className="num"><Money c={b} whole /></td>
                        <td className="num"><Money c={(r?.total ?? 0) - b} whole /></td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
              <FcRow label="Net sales" st={st} bud={fc.budget} k="netSales" months={months.map((m) => m.period)} />
              <FcRow label="Gross profit" st={st} bud={fc.budget} k="grossProfit" months={months.map((m) => m.period)} />
              <FcRow label="Net profit" st={st} bud={fc.budget} k="netIncome" months={months.map((m) => m.period)} cls="total" />
            </tbody>
          </table>
        </div>
        <p className="panel-pad muted small" style={{ margin: 0 }}>{months.map((m) => `${mon(m.period)}: ${SOURCE_LABEL[m.source]}${m.source === 'mtd' ? ` (${Math.round(m.remaining * 100)}% of the month still to come)` : ''}`).filter((_, i, all) => i === 0 || all[i].split(': ')[1] !== all[i - 1].split(': ')[1]).join(' · ')}.</p>
        <TieOut items={[
          { label: fc.ties ? 'Actual months tie to the accrual P&L' : 'Actual months differ from the P&L', ok: fc.ties, detail: <Money c={fc.actualPnl} dollar /> },
          { label: sumCols === st.netIncome.total ? 'Months add to the year' : 'Months do not add up', ok: sumCols === st.netIncome.total },
          ...(budgetTotals !== null ? [{ label: budgetTotals === fc.budget.netIncome.total ? 'Budget column ties to the annual budget' : 'Budget column differs from the annual budget', ok: budgetTotals === fc.budget.netIncome.total, detail: <Link to={`/budgets?fy=${fy}${storeId ? `&store=${storeId}` : ''}`}><Money c={budgetTotals} dollar /></Link> }] : []),
        ]} />
      </section>
      {toast}
      <Help k="budgetForecast" />
    </>
  );
}

function FcRow({ label, st, bud, k, months, cls = 'sub' }: { label: string; st: Statement; bud: Statement; k: 'netSales' | 'grossProfit' | 'netIncome'; months: string[]; cls?: string }) {
  return <tr className={cls}><td>{label}</td>{months.map((p) => <td key={p} className="num"><Money c={st[k][p] ?? 0} whole /></td>)}<td className="num"><Money c={st[k].total} whole /></td><td className="num"><Money c={bud[k].total} whole /></td><td className="num"><Money c={st[k].total - bud[k].total} whole signed /></td></tr>;
}

// ── Scenarios ────────────────────────────────────────────────────────────
type Draft = { kind: ScenarioAdj['kind']; cpg: string; storeId: string; from: string; code: string; copyOf: string; opens: string; rampMonths: string; rampStartPct: string; weekday: string; target: string; pct: string };
const blankDraft = (kind: ScenarioAdj['kind'] = 'fuel_margin'): Draft => ({ kind, cpg: '-2', storeId: '', from: '', code: 'HM19', copyOf: 'st_hm15', opens: '', rampMonths: '6', rampStartPct: '50', weekday: '0', target: 'group:labor', pct: '5' });
function draftToAdj(d: Draft, fyFirst: string): ScenarioAdj {
  const store = d.storeId || undefined, from = d.from || undefined;
  switch (d.kind) {
    case 'fuel_margin': return { kind: 'fuel_margin', cpg: Number(d.cpg), storeId: store, from };
    case 'new_store': return { kind: 'new_store', code: d.code.trim().toUpperCase(), copyOf: d.copyOf, opens: d.opens || fyFirst, rampMonths: Number(d.rampMonths), rampStartPct: Number(d.rampStartPct) };
    case 'close_kitchen': return { kind: 'close_kitchen', weekday: Number(d.weekday), storeId: store, from };
    default: return { kind: 'account_pct', target: d.target, pct: Number(d.pct), storeId: store, from };
  }
}

export function ScenariosPage() {
  const { state, books, user, stores } = useBooks();
  const entries = useEntries();
  const [sp, setSp] = useSearchParams();
  const [toast, say] = useToast();
  const [fy] = useFy();
  const months = fyPeriods(state, fy);
  const ids = stores.map((s) => s.id);
  const key = ids.join();
  const saved = budgetsOf(state).scenarios.filter((s) => s.fiscalYear === fy);
  const base = useMemo(() => rollingForecast(state, { fiscalYear: fy, storeIds: ids, entries }), [state, fy, key, entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const hidden = new Set((sp.get('hide') ?? '').split(',').filter(Boolean));
  const shown = saved.filter((s) => !hidden.has(s.id));
  const results = useMemo(() => shown.map((s) => ({ id: s.id, r: runScenario(state, s, { storeIds: ids, entries, base }) })), [state, shown.map((s) => s.id + s.updatedAt).join(), base]); // eslint-disable-line react-hooks/exhaustive-deps
  const [name, setName] = useState('');
  const [adjs, setAdjs] = useState<ScenarioAdj[]>([]);
  const [d, setD] = useState<Draft>(blankDraft());
  const [errs, setErrs] = useState<string[]>([]);
  const [editing, setEditing] = useState<ID | undefined>();
  const preview = useMemo(() => (adjs.length ? runScenario(state, { name: name || 'Draft', fiscalYear: fy, adjustments: adjs }, { storeIds: ids, entries, base }) : null), [state, adjs, fy, base, name]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: ID) => { const n = new URLSearchParams(sp); const h = new Set(hidden); if (h.has(id)) h.delete(id); else h.add(id); if (h.size) n.set('hide', [...h].join(',')); else n.delete('hide'); setSp(n, { replace: true }); };
  const cols: { key: string; label: string; r: ScenarioResult | null }[] = [{ key: 'base', label: 'Base forecast', r: null }, ...results.map((x) => ({ key: x.id, label: saved.find((s) => s.id === x.id)!.name, r: x.r })), ...(preview ? [{ key: 'draft', label: `${name || 'Draft'} (not saved)`, r: preview }] : [])];
  const val = (r: ScenarioResult | null, k: 'netSales' | 'grossProfit' | 'expenses' | 'netIncome') => (r ? r.statement[k].total : base.statement[k].total);
  const best = results.length ? results.reduce((a, b) => (b.r.net > a.r.net ? b : a)) : null;
  const edit = can(user, 'budget.edit');
  const addAdj = () => {
    const a = draftToAdj(d, months.find((p) => p >= periodOf(todayInChicago())) ?? months[0]);
    const e = budgetsErr(a);
    if (e.length) { setErrs(e); return; }
    setAdjs([...adjs, a]); setErrs([]); setD(blankDraft(d.kind));
  };
  const budgetsErr = (a: ScenarioAdj) => {
    try { runScenario(state, { name: 'x', fiscalYear: fy, adjustments: [a] }, { storeIds: ids, entries, base }); } catch (e) { return errList(e); }
    return [];
  };
  const saveIt = () => {
    try { const s = saveScenario(books, user, { name, fiscalYear: fy, adjustments: adjs }, editing); say(`Saved "${s.name}".`); setAdjs([]); setName(''); setEditing(undefined); setErrs([]); } catch (e) { setErrs(errList(e)); }
  };
  const exportRows = [
    ...(['netSales', 'grossProfit', 'expenses', 'netIncome'] as const).map((k) => [{ netSales: 'Net sales', grossProfit: 'Gross profit', expenses: 'Operating expenses', netIncome: 'Net profit' }[k], ...cols.map((c) => csvMoney(val(c.r, k)))]),
    ['Change in net profit vs base', ...cols.map((c) => csvMoney(c.r ? c.r.net - c.r.baseNet : 0))],
    [], ...cols.filter((c) => c.r).flatMap((c) => c.r!.effects.map((e) => [c.label, e.label, csvMoney(e.net), e.detail])),
  ];

  return (
    <>
      <PageHead eyebrow="Budgets" title="Scenarios" lede={<>What-ifs on top of the {fyLabel(state, fy)} rolling forecast, side by side. Each change is figured on the base forecast for the months still to come.</>}>
        <ExportButtons name={`scenarios-${fy}`} header={['Line', ...cols.map((c) => c.label)]} rows={exportRows} sheet={`Scenarios ${fy}`} />
      </PageHead>
      <section className="figures" aria-label="Summary" style={{ marginBottom: 20 }}>
        <Figure label="Base forecast net profit" value={<Money c={base.statement.netIncome.total} whole dollar signed />} note={fyLabel(state, fy)} href={`/budgets/forecast?fy=${fy}`} />
        <Figure label="Saved scenarios" value={saved.length} note={`${shown.length} compared`} />
        <Figure label="Best scenario" value={best ? <Money c={best.r.net - best.r.baseNet} whole dollar signed /> : '–'} note={best ? saved.find((s) => s.id === best.id)!.name : 'none saved'} />
        <Figure label="Months still to come" value={base.months.filter((m) => m.remaining > 0).length} note="where a scenario can change anything" />
      </section>

      <section className="panel" aria-labelledby="cmp-h">
        <div className="panel-head"><h2 id="cmp-h">Side by side</h2><div className="filters" style={{ padding: 0, border: 0 }}><FySelect id="scn-fy" /></div></div>
        {saved.length > 0 && <div className="panel-pad" style={{ paddingBottom: 0 }}><div className="rb-checks">{saved.map((s) => <label className="check" key={s.id}><input type="checkbox" checked={!hidden.has(s.id)} onChange={() => toggle(s.id)} /> {s.name}</label>)}</div></div>}
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Line</th>{cols.map((c) => <th scope="col" className="num" key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>
              {(['netSales', 'grossProfit', 'expenses', 'netIncome'] as const).map((k) => (
                <tr key={k} className={k === 'netIncome' ? 'total' : ''}><td>{{ netSales: 'Net sales', grossProfit: 'Gross profit', expenses: 'Operating expenses', netIncome: 'Net profit' }[k]}</td>{cols.map((c) => <td className="num" key={c.key}><Money c={val(c.r, k)} whole signed={k === 'netIncome'} /></td>)}</tr>
              ))}
              <tr className="sub"><td>Change in net profit</td>{cols.map((c) => <td className="num" key={c.key}>{c.r ? <Money c={c.r.net - c.r.baseNet} whole signed /> : '–'}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <TieOut items={cols.filter((c) => c.r).map((c) => ({ label: `${c.label}: changes add up to the difference`, ok: c.r!.ties })).concat(base.ties ? [{ label: 'Base forecast ties to the P&L for months that are over', ok: true }] : [{ label: 'Base forecast does not tie to the P&L', ok: false }])} />
      </section>

      {cols.filter((c) => c.r).map((c) => (
        <section className="panel" key={c.key} aria-label={`${c.label}: what changes`} style={{ marginTop: 20 }}>
          <div className="panel-head"><h2>{c.label}</h2>
            {c.key !== 'draft' && edit && <div className="actions"><button className="btn sm" onClick={() => { const s = saved.find((x) => x.id === c.key)!; setEditing(s.id); setName(s.name); setAdjs(structuredClone(s.adjustments)); }}>Edit</button><button className="btn sm ghost" onClick={() => { deleteScenario(books, user, c.key); say('Scenario deleted.'); }}>Delete</button></div>}
          </div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th scope="col">Change</th><th scope="col">How it's figured</th><th scope="col" className="num">Net profit effect</th></tr></thead>
            <tbody>{c.r!.effects.map((e, i) => <tr key={i}><td>{e.label}</td><td className="small muted">{e.detail}</td><td className="num"><Money c={e.net} signed /></td></tr>)}
              <tr className="total"><td colSpan={2}>Total</td><td className="num"><Money c={c.r!.net - c.r!.baseNet} signed /></td></tr></tbody>
          </table></div>
        </section>
      ))}

      {edit && (
        <section className="panel" aria-labelledby="new-h" style={{ marginTop: 20 }}>
          <div className="panel-head"><h2 id="new-h">{editing ? 'Edit scenario' : 'Build a scenario'}</h2><span className="muted small">Add one or more changes; the draft column above previews them.</span></div>
          <div className="panel-pad">
            <Errors errors={errs} />
            <div className="form-grid">
              <div className="field"><label htmlFor="sc-name">Scenario name</label><input id="sc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fuel −3¢ all winter" /></div>
              <div className="field"><label htmlFor="sc-kind">Change</label><select id="sc-kind" value={d.kind} onChange={(e) => setD(blankDraft(e.target.value as ScenarioAdj['kind']))}>{(Object.keys(SCENARIO_KIND_LABEL) as ScenarioAdj['kind'][]).map((k) => <option key={k} value={k}>{SCENARIO_KIND_LABEL[k]}</option>)}</select></div>
              {d.kind === 'fuel_margin' && <div className="field"><label htmlFor="sc-cpg">Cents a gallon (+ or −)</label><input id="sc-cpg" className="num" inputMode="decimal" value={d.cpg} onChange={(e) => setD({ ...d, cpg: e.target.value })} /></div>}
              {d.kind === 'account_pct' && <>
                <div className="field"><label htmlFor="sc-target">Group or account</label><select id="sc-target" value={d.target} onChange={(e) => setD({ ...d, target: e.target.value })}><optgroup label="Groups">{PCT_TARGETS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</optgroup><optgroup label="Accounts">{pnlAccounts(state).map((a) => <option key={a.id} value={`acct:${a.id}`}>{a.number} · {a.name}</option>)}</optgroup></select></div>
                <div className="field"><label htmlFor="sc-pct">Change %</label><input id="sc-pct" className="num" inputMode="decimal" value={d.pct} onChange={(e) => setD({ ...d, pct: e.target.value })} /></div>
              </>}
              {d.kind === 'close_kitchen' && <div className="field"><label htmlFor="sc-wd">Closed on</label><select id="sc-wd" value={d.weekday} onChange={(e) => setD({ ...d, weekday: e.target.value })}>{WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}s</option>)}</select></div>}
              {d.kind !== 'new_store' && <div className="field"><label htmlFor="sc-store">Store</label><select id="sc-store" value={d.storeId} onChange={(e) => setD({ ...d, storeId: e.target.value })}><option value="">All stores</option>{stores.filter((s) => d.kind !== 'close_kitchen' || s.hasKitchen).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>}
              {d.kind !== 'new_store' && <div className="field"><label htmlFor="sc-from">From month</label><select id="sc-from" value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })}><option value="">Every month to come</option>{months.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>}
              {d.kind === 'new_store' && <>
                <div className="field"><label htmlFor="sc-code">New store code</label><input id="sc-code" value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} /></div>
                <div className="field"><label htmlFor="sc-copy">Copy the profile of</label><select id="sc-copy" value={d.copyOf} onChange={(e) => setD({ ...d, copyOf: e.target.value })}>{stores.filter((s) => s.kind === 'operating').map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></div>
                <div className="field"><label htmlFor="sc-opens">Opens in</label><select id="sc-opens" value={d.opens} onChange={(e) => setD({ ...d, opens: e.target.value })}><option value="">The next month to come</option>{months.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
                <div className="field"><label htmlFor="sc-ramp">Ramp (months)</label><input id="sc-ramp" className="num" inputMode="numeric" value={d.rampMonths} onChange={(e) => setD({ ...d, rampMonths: e.target.value })} /></div>
                <div className="field"><label htmlFor="sc-start">Opens at % of the profile</label><input id="sc-start" className="num" inputMode="decimal" value={d.rampStartPct} onChange={(e) => setD({ ...d, rampStartPct: e.target.value })} /></div>
              </>}
            </div>
            <div className="actions" style={{ marginTop: 10 }}><button className="btn" onClick={addAdj}>Add change</button></div>
            {adjs.length > 0 && (
              <ul className="rb-list" style={{ marginTop: 12 }} aria-label="Changes in this scenario">
                {adjs.map((a, i) => <li key={i}><span>{adjLabel(state, a)}</span><button className="btn sm ghost" onClick={() => setAdjs(adjs.filter((_, j) => j !== i))} aria-label={`Remove ${adjLabel(state, a)}`}>Remove</button></li>)}
              </ul>
            )}
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={!adjs.length} onClick={saveIt}>{editing ? 'Save changes' : 'Save scenario'}</button>
              {(adjs.length > 0 || editing) && <button className="btn ghost" onClick={() => { setAdjs([]); setName(''); setEditing(undefined); setErrs([]); }}>Cancel</button>}
            </div>
            <p className="muted small">A new store shows as its own column ({newStoreId(d.code || 'HM19')}) with the copied store's lines: sales, cost of goods and card fees ramp; rent, payroll and other fixed costs start in full.</p>
          </div>
        </section>
      )}
      {toast}
      <Help k="budgetScenarios" />
    </>
  );
}

// ── Break-even ───────────────────────────────────────────────────────────
export function BreakEvenPage() {
  const { state, stores } = useBooks();
  const entries = useEntries();
  const [sp, setSp] = useSearchParams();
  const last = useLastMonth();
  const fromP = sp.get('from') ?? last;
  const toP = sp.get('to') && sp.get('to')! >= fromP ? sp.get('to')! : fromP;
  const source = sp.get('source') === 'budget' ? 'budget' : 'actual';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (!n.get('from')) n.set('from', fromP); setSp(n, { replace: true }); };
  const ops = stores.filter((s) => s.kind === 'operating').map((s) => s.id);
  const key = ops.join();
  const rows = useMemo(() => breakEven(state, { from: fromP, to: toP, storeIds: ops, source, entries }), [state, fromP, toP, key, source, entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const cards = useMemo(() => (source === 'actual' && fromP === toP ? scorecards(state, { period: fromP, storeIds: ops, entries }) : null), [state, fromP, toP, key, source, entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = dataStart(state) ?? fromP;
  const periods = useMemo(() => { const out: string[] = []; for (let p = start; p <= periodOf(todayInChicago()); p = periodOf(addDays(lastDayOfPeriod(p), 1))) out.push(p); return out; }, [start]);
  const codeOf = (id: ID) => stores.find((s) => s.id === id)?.code ?? id;
  const above = rows.filter((r) => r.breakEvenSales !== null && r.sales >= r.breakEvenSales);
  const fixed = rows.reduce((a, r) => a + r.fixed, 0);
  const sales = rows.reduce((a, r) => a + r.sales, 0);
  const contribution = rows.reduce((a, r) => a + r.contribution, 0);
  const coBe = contribution > 0 ? Math.round(fixed / (contribution / sales)) : null;
  const netOk = rows.every((r) => r.contribution - r.fixed === r.net);
  const cardOk = cards ? rows.every((r) => { const k = cards.find((c) => c.storeId === r.storeId)?.kpis.find((x) => x.key === 'breakEven'); return !k || (k.value === null ? r.safety === null : r.safety !== null && Math.abs(k.value - r.safety * 100) < 1e-6); }) : null;
  const label = fromP === toP ? periodLabel(fromP) : `${periodLabel(fromP)} – ${periodLabel(toP)}`;
  const gal = (g: number | null) => (g === null ? '–' : Math.round(g).toLocaleString('en-US'));
  const exportRows = rows.map((r) => [codeOf(r.storeId), csvMoney(r.sales), csvMoney(r.variable), csvMoney(r.contribution), r.cmPct === null ? '' : (r.cmPct * 100).toFixed(1), csvMoney(r.fixed), r.breakEvenSales === null ? '' : csvMoney(r.breakEvenSales), Math.round(r.gallons), r.breakEvenGallons === null ? '' : Math.round(r.breakEvenGallons), r.safety === null ? '' : (r.safety * 100).toFixed(1), csvMoney(r.net)]);
  const cell = (x: ReactNode) => <td className="num">{x}</td>;

  return (
    <>
      <PageHead eyebrow={`Budgets · ${source === 'actual' ? 'accrual actuals' : 'active budget'}`} title="Break-even by store" lede={<>{label}{!sp.get('from') && ' — the last month that is over'}. Break-even sales = fixed costs ÷ contribution margin %. Variable costs are cost of goods plus card and network fees; every other operating expense is fixed.</>}>
        <ExportButtons name={`break-even-${source}-${fromP}-to-${toP}`} header={['Store', 'Net sales', 'Variable costs', 'Contribution', 'Contribution %', 'Fixed costs', 'Break-even sales', 'Gallons', 'Break-even gallons', 'Margin of safety %', 'Net profit']} rows={exportRows} sheet={`Break-even ${fromP}`} />
      </PageHead>
      <section className="figures" aria-label="Summary" style={{ marginBottom: 20 }}>
        <Figure label="Stores above break-even" value={`${above.length} of ${rows.length}`} note={label} />
        <Figure label="Company break-even sales" value={coBe === null ? 'not reached' : <Money c={coBe} whole dollar />} note={`vs ${formatMoney(sales, { dollarSign: true, whole: true })} sales`} />
        <Figure label="Fixed costs" value={<Money c={fixed} whole dollar />} note="operating expenses less card fees" />
        <Figure label="Contribution margin" value={ratioPct(contribution, sales)} note="of net sales, all operating stores" />
      </section>
      <section className="panel" aria-labelledby="be-h">
        <div className="panel-head"><h2 id="be-h">Each store</h2></div>
        <div className="filters">
          <div className="field"><label htmlFor="be-from">From month</label><select id="be-from" value={fromP} onChange={(e) => { const n = new URLSearchParams(sp); n.set('from', e.target.value); if (toP < e.target.value) n.delete('to'); setSp(n, { replace: true }); }}>{periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
          <div className="field"><label htmlFor="be-to">Through</label><select id="be-to" value={toP} onChange={(e) => set('to', e.target.value === fromP ? '' : e.target.value)}>{periods.filter((p) => p >= fromP).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></div>
          <div className="field seg-field"><span className="seg-label" aria-hidden>Figures</span><BasisSeg label="Figures" value={source} onChange={(v) => set('source', v === 'actual' ? '' : v)} options={[{ v: 'actual' as const, label: 'Actual' }, { v: 'budget' as const, label: 'Budget' }]} /></div>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Store</th><th scope="col" className="num">Net sales</th><th scope="col" className="num">Variable costs</th><th scope="col" className="num">Contribution</th><th scope="col" className="num">CM %</th><th scope="col" className="num">Fixed costs</th><th scope="col" className="num">Break-even sales</th><th scope="col" className="num">a day</th><th scope="col" className="num">Gallons</th><th scope="col" className="num">Break-even gallons</th><th scope="col" className="num">Margin of safety</th><th scope="col" className="num">Net profit</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.storeId}>
                  <td><b>{codeOf(r.storeId)}</b> <span className="muted small">{stores.find((s) => s.id === r.storeId)?.name}</span></td>
                  {cell(<Money c={r.sales} whole />)}{cell(<Money c={r.variable} whole />)}{cell(<Money c={r.contribution} whole />)}{cell(pct(r.cmPct))}{cell(<Money c={r.fixed} whole />)}
                  {cell(r.breakEvenSales === null ? 'not reached' : <Money c={r.breakEvenSales} whole />)}
                  {cell(r.breakEvenSales === null ? '–' : <Money c={Math.round(r.breakEvenSales / r.days)} whole />)}
                  {cell(gal(r.gallons))}{cell(gal(r.breakEvenGallons))}
                  {cell(r.safety === null ? '–' : <span className={'pill ' + (r.safety >= 0.1 ? 'ok' : r.safety >= 0 ? 'warn' : 'bad')}>{pct(r.safety)}</span>)}
                  {cell(<Money c={r.net} whole signed />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TieOut items={[
          { label: netOk ? 'Contribution − fixed costs = net profit, every store' : 'Contribution and fixed costs do not explain net profit', ok: netOk },
          ...(cardOk !== null ? [{ label: cardOk ? 'Agrees with the store scorecards' : 'Differs from the store scorecards', ok: cardOk, detail: <Link to={`/reports/scorecards?month=${fromP}`}>scorecards</Link> }] : []),
        ]} />
        <p className="panel-pad muted small" style={{ margin: 0 }}>Break-even gallons are at each store's current mix of fuel and inside sales: gallons × break-even sales ÷ sales.{source === 'budget' && ' On the budget, gallons are budget fuel sales ÷ the store\'s average price per gallon on file.'}</p>
      </section>
      <Help k="budgetBreakEven" />
    </>
  );
}

