/**
 * Growth compass — when to grow, and what to do first. One opinionated verdict built from numbers the portal already
 * has: return on invested capital against the cost of capital, unit economics, the cash engine, debt capacity and the
 * newest store's ramp, run through explicit stage gates (Fix → Stabilize → Optimize → Replicate → Scale).
 *
 * Two layers, so every rule can be tested on hand-built numbers:
 *  - `compassInputs(state, asOf)` gathers the numbers from the existing modules (statements, balance sheet, cash
 *    flow, covenant metrics, reserve, paydown, capital allocation, pro formas, ramp). It recomputes nothing they own.
 *  - `compassVerdict(inputs, settings)` is pure arithmetic on those inputs: ROIC, WACC, gates, the stage, store roles,
 *    the next three moves, triggers and the sensitivity.
 * The only writers are the settings and the monthly snapshot (for the inbox's "stage changed" alert). Nothing posts.
 */
import type { Books } from './books';
import { ValidationError } from './books';
import type { BooksState, CompassRecord, CompassSettings, CompassStage, CompassState, ID, ReportBasis, User } from './types';
import { formatMoney, type Cents } from './money';
import { lastDayOfPeriod, periodLabel, periodOf, periodsBetween, shortDate } from './dates';
import {
  COVENANT_LABEL, covenantMetrics, covenantMonitor, debtDashboard, debtOf, dscrWithNewDebt, firstBooksPeriod, formatCovenant, formatMetric, headlineMetrics,
  monthsBetween, monthsToFund, paydownPlan, ratioX, reserveTarget, trendLine, TREND_MIN_MONTHS, metricOf,
} from './debt';
import { balanceSheet, basisEntries, cashFlow, LABOR_ACCTS, statement, thresholdsOf, type BalanceSheet, type BasisEntry, type Statement } from './statements';
import { breakEven, budgetStatement, hasBudget } from './budgets';
import { fuelMargin } from './fuel';
import { ownerRateBps } from './tax';
import { laborTarget } from './payroll';
import { storeTraffic } from './inside';
import { loansOf } from './loans';
import { capitalAllocation, dealProForma, growthOf, newestStore, proFormaResult, rampCheck } from './growth';

// ── State ────────────────────────────────────────────────────────────────
export const DEFAULT_COMPASS_SETTINGS: CompassSettings = {
  costOfEquityBps: 1500,
  cashConversionMinPct: 60,
  reserveCushionPct: 10,
  valueStoreSharePct: 75,
  rampMinPct: 100,
  scaleMonths: 3,
  scaleFundMonths: 6,
  growSpreadPts: 10,
  growVolumePct: 2,
  watchMonths: 12,
  shockCpg: 2,
  shockGallonsPct: 10,
};

export function emptyCompass(): CompassState {
  return { settings: structuredClone(DEFAULT_COMPASS_SETTINGS), history: [] };
}
/** Books saved before the compass have no slice: read it as empty with default settings. */
export function compassOf(state: BooksState): CompassState {
  const c = state.compass;
  if (!c) return emptyCompass();
  return { settings: { ...DEFAULT_COMPASS_SETTINGS, ...(c.settings ?? {}) }, history: c.history ?? [] };
}
export function ensureCompass(books: Books): CompassState {
  if (!books.state.compass) books.state.compass = emptyCompass();
  const c = books.state.compass;
  c.settings = { ...DEFAULT_COMPASS_SETTINGS, ...(c.settings ?? {}) };
  if (!c.history) c.history = [];
  return c;
}

export const STAGES: { key: CompassStage; label: string; definition: string; next: string }[] = [
  { key: 'fix', label: 'Fix', definition: 'Stop the bleeding: the company loses money, a covenant is broken or forecast to break, or cash is under the reserve.', next: 'Gates to Stabilize' },
  { key: 'stabilize', label: 'Stabilize', definition: 'Profitable, but not yet earning the cost of capital, turning profit into cash, or holding a real cushion over the reserve.', next: 'Gates to Optimize' },
  { key: 'optimize', label: 'Optimize', definition: 'Earning more than the cost of capital overall: bring the weak stores up and line up the debt room and equity before adding one.', next: 'Gates to Replicate' },
  { key: 'replicate', label: 'Replicate', definition: 'Ready to add one store: most stores create value, the new loan fits, the equity is on hand and the newest store has ramped.', next: 'Gates to Scale' },
  { key: 'scale', label: 'Scale', definition: 'The replicate gates have held for months and cash funds the next store quickly: run a pipeline of stores.', next: 'Top of the ladder' },
];
export const STAGE_ORDER: CompassStage[] = STAGES.map((s) => s.key);
export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<CompassStage, string>;

const money = (c: Cents) => formatMoney(Math.round(c), { dollarSign: true, whole: true });
const pct1 = (v: number | null) => (v === null || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(1)}%`);
const pts = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)} pts`;
const cents1 = (v: number) => `${v.toFixed(1)}¢`;
function addMonthsP(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
/** A date n whole months after asOf (same day, clipped to the month end). */
export function addMonthsDate(asOf: string, n: number): string {
  const p = addMonthsP(periodOf(asOf), n);
  const end = lastDayOfPeriod(p);
  const d = `${p}-${asOf.slice(8, 10)}`;
  return d > end ? end : d;
}

// ── Inputs ───────────────────────────────────────────────────────────────
export interface InvestedCapital { fixed: Cents; inventory: Cents; workingCapital: Cents; total: Cents }
export interface StoreInput {
  storeId: ID;
  code: string;
  name: string;
  openedOn?: string;
  /** Whole months open at asOf (null: open before the books). */
  monthsOpen: number | null;
  /** Window figures (m.from … m.period) on the verdict basis. */
  sales: Cents;
  netIncome: Cents;
  interest: Cents;
  depreciation: Cents;
  ebitda: Cents;
  labor: Cents;
  insideSales: Cents;
  insideGp: Cents;
  /** Fuel, accrual cost (the fuel screen): gallons incl. truck lane, margin $ and ¢/gal. */
  gallons: number;
  fuelMargin: Cents;
  fuelCpg: number | null;
  laborTargetPct: number;
  /** Break-even margin of safety (accrual, budgets screen): (sales − break-even) ÷ sales. */
  breakEvenSafety: number | null;
  capital: InvestedCapital;
  /** Complete months: sales, net income (verdict basis) and gallons. */
  monthly: { period: string; sales: Cents; net: Cents; gallons: number }[];
  /** Latest complete month vs the active budget (accrual), when a budget covers it. */
  budget: { period: string; sales: Cents; budgetSales: Cents; net: Cents; budgetNet: Cents } | null;
  /** From imported POS customer counts, when there are any. */
  traffic: { days: number; transactions: number; avgTicket: Cents; marginPct: number; marginPerTxn: Cents } | null;
}
export interface CovenantInput { key: string; label: string; loan: string; name: string; status: 'ok' | 'near' | 'breach' | 'na'; actual: string; limit: string; forecastDate: string | null; within: boolean; lowAmount?: Cents; limitCents?: Cents; kind: string }
export interface CompassInputs {
  asOf: string;
  ready: boolean;
  basis: ReportBasis;
  /** The trailing window the ratios are read on (the covenant headline month). */
  period: string;
  from: string;
  months: number;
  factor: number;
  annualized: boolean;
  /** Month end the balances are read at. */
  date: string;
  company: { sales: Cents; netIncome: Cents; interest: Cents; depreciation: Cents; ebitda: Cents; gallons: number; fuelMargin: Cents; capital: InvestedCapital; otherBasis: ReportBasis; otherNetIncome: Cents; corporateNet: Cents };
  stores: StoreInput[];
  monthlyCompany: { period: string; ebitda: Cents; net: Cents; sales: Cents }[];
  tax: { rateBps: number; source: string };
  capitalStructure: { debt: Cents; equity: Cents; wacdBps: number | null; loans: { name: string; balance: Cents; rateBps: number }[] };
  cash: { operating: Cents; capex: Cents; fcf: Cents; reserveTarget: Cents; cash: Cents; deployable: Cents; equityNeed: Cents; equitySource: string };
  covenants: CovenantInput[];
  capacity: { dscr: number | null; ebitdaAnnual: Cents; debtServiceAnnual: Cents; debt: Cents; addedDebtService: Cents; addedEbitda: Cents; newLoan: Cents; dealName: string | null; dealId: ID | null };
  ramp: { code: string; rows: { period: string; gallonsPct: number | null; insidePct: number | null; days: number; daysInMonth: number }[] } | null;
  paydown: { label: string; balance: Cents; rateBps: number; afterTaxBps: number } | null;
  project: { label: string; amount: Cents; expectedReturn: number; status?: string; to: string } | null;
  proForma: { id: ID; name: string; npv: Cents; irr: number | null; equity: Cents; stabilizedCash: Cents; stabilizedYear: number } | null;
  targets: { fuelCpg: number; insideGmPct: number };
  nextStoreNumber: number;
  history: CompassRecord[];
  /** What the books hold, so a gate can say it can't tell rather than judge zeros. */
  evidence: { loans: number; cashFlowDetail: number; hasDeal: boolean };
  ties: { ebitda: boolean; storesAddUp: boolean; capital: boolean; debt: boolean; balanceSheet: boolean; cashFlow: boolean; cashFlowNetIncome: boolean };
  tieDetail: { ebitdaStatement: Cents; ebitdaMetric: Cents; capitalEntities: Cents; capitalConsolidated: Cents; debtBs: Cents; debtMetric: Cents; cfNetIncome: Cents; bookedNetIncome: Cents };
}

const DA_ACCTS: ID[] = ['acct_depreciation', 'acct_disposal'];
const sumRows = (st: Statement, ids: ID[], col?: string) => st.rows.filter((r) => ids.includes(r.account.id)).reduce((a, r) => a + (col ? r.by[col] ?? 0 : r.total), 0);
const groupTotal = (bs: BalanceSheet, section: 'assets' | 'liabilities', key: string) => bs.sections.find((s) => s.key === section)?.groups.find((g) => g.key === key)?.total ?? 0;
/** Invested capital from a balance sheet: net fixed assets + inventory + operating working capital (bank cash and intercompany left out). */
export function capitalOf(bs: BalanceSheet): InvestedCapital {
  const fixed = groupTotal(bs, 'assets', 'fixed_asset');
  const inventory = groupTotal(bs, 'assets', 'inventory');
  const wcAssets = ['cash', 'clearing', 'receivable', 'prepaid'].reduce((a, k) => a + groupTotal(bs, 'assets', k), 0);
  const wcLiabs = ['payable', 'accrued'].reduce((a, k) => a + groupTotal(bs, 'liabilities', k), 0);
  const workingCapital = wcAssets - wcLiabs;
  return { fixed, inventory, workingCapital, total: fixed + inventory + workingCapital };
}

export function compassInputs(state: BooksState, asOf: string, opts: { entries?: BasisEntry[]; settings?: CompassSettings } = {}): CompassInputs {
  const cs = opts.settings ?? compassOf(state).settings;
  const entries = opts.entries ?? basisEntries(state);
  const ds = debtOf(state).settings;
  const basis: ReportBasis = cs.basis ?? ds.ratioBasis;
  const metrics = covenantMetrics(state, asOf, { entries, settings: { ...ds, ratioBasis: basis } });
  const m = headlineMetrics(metrics, ds);
  const allIds = state.stores.map((s) => s.id);
  const ops = state.stores.filter((s) => !s.deleted && s.kind === 'operating');
  const opIds = ops.map((s) => s.id);
  const period = m?.period ?? periodOf(asOf);
  const from = m?.from ?? period;
  const date = m?.date ?? asOf;
  const d0 = `${from}-01`, d1 = lastDayOfPeriod(period) < asOf ? lastDayOfPeriod(period) : asOf;
  const factor = m?.factor ?? 1;
  const st = statement(state, { basis, from, to: period, storeIds: allIds, entries });
  const otherBasis: ReportBasis = basis === 'accrual' ? 'booked' : 'accrual';
  const other = statement(state, { basis: otherBasis, from, to: period, storeIds: allIds, entries });
  const booked = basis === 'booked' ? st : otherBasis === 'booked' ? other : statement(state, { basis: 'booked', from, to: period, storeIds: allIds, entries });
  const interest = sumRows(st, ['acct_interest']), depreciation = sumRows(st, DA_ACCTS);
  const fm = fuelMargin(state, { storeIds: opIds, from: d0, to: d1, by: 'month' });
  const be = breakEven(state, { from, to: period, storeIds: opIds, entries });
  const th = thresholdsOf(state);

  // Balance sheets at the window's month end: each entity, and the group.
  const bsAll = balanceSheet(state, { asOf: date });
  const entityCap = new Map<ID, InvestedCapital>();
  for (const e of state.entities.filter((x) => !x.deleted)) entityCap.set(e.id, capitalOf(balanceSheet(state, { asOf: date, entityId: e.id })));
  const capitalEntities = [...entityCap.values()].reduce((a, c) => a + c.total, 0);

  // Complete months for the month-over-month view.
  const first = firstBooksPeriod(state);
  const complete = first ? periodsBetween(first, period).filter((p) => lastDayOfPeriod(p) <= asOf) : [];
  const monthSt = new Map(complete.map((p) => [p, statement(state, { basis, from: p, to: p, storeIds: allIds, entries })]));
  const latest = complete.at(-1);
  const budget = latest && hasBudget(state, latest, latest) ? { b: budgetStatement(state, { from: latest, to: latest, storeIds: opIds }), a: statement(state, { basis: 'accrual', from: latest, to: latest, storeIds: opIds, entries }) } : null;

  const stores: StoreInput[] = ops.map((s) => {
    const sameEntity = ops.filter((x) => x.entityId === s.entityId);
    const ec = entityCap.get(s.entityId) ?? { fixed: 0, inventory: 0, workingCapital: 0, total: 0 };
    const share = sameEntity.length > 1 ? (() => { const tot = sameEntity.reduce((a, x) => a + (st.netSales[x.id] ?? 0), 0); return tot ? (st.netSales[s.id] ?? 0) / tot : 1 / sameEntity.length; })() : 1;
    const capital = share === 1 ? ec : { fixed: Math.round(ec.fixed * share), inventory: Math.round(ec.inventory * share), workingCapital: Math.round(ec.workingCapital * share), total: 0 };
    if (share !== 1) capital.total = capital.fixed + capital.inventory + capital.workingCapital;
    const f = fm.stores.find((x) => x.storeId === s.id);
    const ni = st.netIncome[s.id] ?? 0, int = sumRows(st, ['acct_interest'], s.id), dep = sumRows(st, DA_ACCTS, s.id);
    const tr = storeTraffic(state, [s.id], d0, d1);
    const ik = (st.salesByLob.inside[s.id] ?? 0) + (st.salesByLob.kitchen[s.id] ?? 0);
    const ikGp = (st.gpByLob.inside[s.id] ?? 0) + (st.gpByLob.kitchen[s.id] ?? 0);
    const marginPct = ik ? ikGp / ik : 0;
    return {
      storeId: s.id, code: s.code, name: s.name, openedOn: s.openedOn, monthsOpen: s.openedOn ? Math.max(0, monthsBetween(s.openedOn, asOf)) : null,
      sales: st.netSales[s.id] ?? 0, netIncome: ni, interest: int, depreciation: dep, ebitda: ni + int + dep, labor: sumRows(st, LABOR_ACCTS, s.id),
      insideSales: st.salesByLob.inside[s.id] ?? 0, insideGp: st.gpByLob.inside[s.id] ?? 0,
      gallons: f?.gallons ?? 0, fuelMargin: f?.margin ?? 0, fuelCpg: f && f.gallons ? f.marginCpg : null,
      laborTargetPct: laborTarget(state, s.id) / 100, breakEvenSafety: be.find((r) => r.storeId === s.id)?.safety ?? null, capital,
      monthly: complete.map((p) => ({ period: p, sales: monthSt.get(p)!.netSales[s.id] ?? 0, net: monthSt.get(p)!.netIncome[s.id] ?? 0, gallons: Math.round(fm.rows.filter((r) => r.storeId === s.id && r.bucket === p).reduce((a, r) => a + r.gallons, 0)) })),
      budget: budget && latest ? { period: latest, sales: budget.a.netSales[s.id] ?? 0, budgetSales: budget.b.netSales[s.id] ?? 0, net: budget.a.netIncome[s.id] ?? 0, budgetNet: budget.b.netIncome[s.id] ?? 0 } : null,
      traffic: tr.transactions && tr.avgTicket !== null ? { days: tr.days, transactions: tr.transactions, avgTicket: tr.avgTicket, marginPct, marginPerTxn: Math.round(tr.avgTicket * marginPct) } : null,
    };
  });
  // Fuel margin for months outside the fuel window would double count; complete months only use the fuel rows in the window.
  const fmMonths = complete.filter((p) => p >= from);
  if (fmMonths.length < complete.length) {
    const fmAll = fuelMargin(state, { storeIds: opIds, from: `${complete[0]}-01`, to: lastDayOfPeriod(period), by: 'month' });
    for (const s of stores) for (const x of s.monthly) x.gallons = Math.round(fmAll.rows.filter((r) => r.storeId === s.storeId && r.bucket === x.period).reduce((a, r) => a + r.gallons, 0));
  }

  const ebitdaStatement = st.netIncome.total + interest + depreciation;
  const cf = cashFlow(state, { from: d0, to: d1 });
  const operating = cf.sections.find((x) => x.key === 'operating')?.total ?? 0;
  const capex = (cf.sections.find((x) => x.key === 'investing')?.lines ?? []).filter((l) => l.accountId && state.accounts.find((a) => a.id === l.accountId)?.subtype === 'fixed_asset').reduce((a, l) => a + l.amount, 0);
  const reserve = reserveTarget(state, asOf, { entries });
  const g = growthOf(state);
  const deal = dealProForma(state);
  const dr = deal ? proFormaResult(deal, g.settings) : undefined;
  const equityNeed = dr ? Math.max(0, dr.equity + dr.preOpeningDebtService) : ds.nextStoreEquity;
  const mon = covenantMonitor(state, asOf, { entries });
  const covenants: CovenantInput[] = mon.tests.map((t) => {
    const last = t.covenant.kind === 'min_liquidity' ? mon.metrics.at(-1) : mon.headline;
    return {
      key: t.covenant.id, kind: t.covenant.kind, label: `${t.loan?.name ?? 'Loan'}: ${COVENANT_LABEL[t.covenant.kind]}`, loan: t.loan?.name ?? 'the loan', name: COVENANT_LABEL[t.covenant.kind], status: t.status,
      actual: formatMetric(t.covenant.kind, last ? metricOf(last, t.covenant.kind) : t.actual), limit: formatCovenant(t.covenant),
      forecastDate: t.forecast.date, within: t.forecast.within, lowAmount: t.forecast.low?.amount, limitCents: t.covenant.kind === 'min_liquidity' ? t.covenant.threshold : undefined,
    };
  });
  const newest = newestStore(state);
  const rc = newest ? rampCheck(state, newest.id, asOf, entries) : undefined;
  const pp = paydownPlan(state, asOf, { entries, metrics: m });
  const topDebt = pp.debts[0];
  const ca = capitalAllocation(state, asOf, { entries });
  const proj = ca.uses.filter((u) => u.kind === 'project' && u.projectKind !== 'next_store' && u.expectedReturn !== null && u.expectedReturn > 0).sort((a, b) => b.riskAdjusted - a.riskAdjusted)[0];
  const pfs = g.proFormas.map((p) => ({ p, r: proFormaResult(p, g.settings) })).sort((a, b) => b.r.leveredNpv - a.r.leveredNpv);
  const best = pfs[0];
  const dd = debtDashboard(state, asOf);
  const debtBs = groupTotal(bsAll, 'liabilities', 'loan');
  const y1 = dr?.years[0];
  const capCompany = capitalOf(bsAll);
  const monthlyCompany = complete.map((p) => { const x = monthSt.get(p)!; return { period: p, ebitda: x.netIncome.total + sumRows(x, ['acct_interest']) + sumRows(x, DA_ACCTS), net: x.netIncome.total, sales: x.netSales.total }; });
  const corp = state.stores.filter((s) => s.kind === 'corporate').reduce((a, s) => a + (st.netIncome[s.id] ?? 0), 0);
  const taxBps = cs.taxRateBps ?? ownerRateBps(state);

  return {
    asOf, ready: !!m, basis, period, from, months: m?.months ?? 0, factor, annualized: !!m?.annualized, date,
    company: {
      sales: st.netSales.total, netIncome: st.netIncome.total, interest, depreciation, ebitda: ebitdaStatement,
      gallons: stores.reduce((a, s) => a + s.gallons, 0), fuelMargin: stores.reduce((a, s) => a + s.fuelMargin, 0), capital: capCompany,
      otherBasis, otherNetIncome: other.netIncome.total, corporateNet: corp,
    },
    stores, monthlyCompany,
    tax: { rateBps: taxBps, source: cs.taxRateBps === undefined ? 'Owner rate from the tax tables (federal + state)' : 'Set on this screen' },
    capitalStructure: { debt: debtBs, equity: bsAll.totalEquity, wacdBps: dd.wacdBps, loans: dd.company.map((r) => ({ name: r.loan.name, balance: r.balance, rateBps: r.rateBps })) },
    cash: { operating, capex, fcf: operating + capex, reserveTarget: reserve.target, cash: reserve.cash, deployable: reserve.deployable, equityNeed, equitySource: dr ? `${deal!.name}: equity + debt service before opening` : 'Next-store equity in the Debt settings' },
    covenants,
    capacity: {
      dscr: m?.dscr ?? null, ebitdaAnnual: m?.ebitdaAnnual ?? 0, debtServiceAnnual: m?.debtServiceAnnual ?? 0, debt: m?.debt ?? 0,
      addedDebtService: y1?.debtService ?? 0, addedEbitda: y1?.ebitda ?? 0, newLoan: dr?.loan ?? 0, dealName: deal?.name ?? null, dealId: deal?.id ?? null,
    },
    ramp: newest && rc?.plan ? { code: newest.code, rows: rc.rows.map((r) => ({ period: r.period, gallonsPct: r.gallonsPct, insidePct: r.insidePct, days: r.days, daysInMonth: r.daysInMonth })) } : null,
    paydown: topDebt ? { label: topDebt.label, balance: topDebt.amount, rateBps: topDebt.rateBps, afterTaxBps: topDebt.afterTaxBps } : null,
    project: proj ? { label: proj.label, amount: proj.amount, expectedReturn: proj.expectedReturn!, status: proj.status, to: proj.to } : null,
    proForma: best ? { id: best.p.id, name: best.p.name, npv: best.r.leveredNpv, irr: best.r.leveredIrr, equity: Math.max(0, best.r.equity + best.r.preOpeningDebtService), stabilizedCash: best.r.years[best.r.stabilizedYear - 1]?.cashAfterDebt ?? 0, stabilizedYear: best.r.stabilizedYear } : null,
    targets: { fuelCpg: th.fuelCpg.green, insideGmPct: th.insideGm.green },
    nextStoreNumber: state.stores.filter((s) => !s.deleted && s.kind !== 'corporate').length + 1,
    history: compassOf(state).history,
    evidence: { loans: loansOf(state).length, cashFlowDetail: cf.sections.reduce((a, x) => a + x.lines.filter((l) => l.key !== 'ni').length, 0), hasDeal: !!deal },
    ties: {
      ebitda: !m || ebitdaStatement === m.ebitda,
      storesAddUp: allIds.reduce((a, id) => a + (st.netIncome[id] ?? 0), 0) === st.netIncome.total && st.difference === 0,
      capital: capitalEntities === capCompany.total,
      debt: !m || debtBs === m.debt,
      balanceSheet: bsAll.difference === 0 && bsAll.agreesToTb,
      cashFlow: cf.ties,
      cashFlowNetIncome: cf.netIncome === booked.netIncome.total,
    },
    tieDetail: { ebitdaStatement, ebitdaMetric: m?.ebitda ?? 0, capitalEntities, capitalConsolidated: capCompany.total, debtBs, debtMetric: m?.debt ?? 0, cfNetIncome: cf.netIncome, bookedNetIncome: booked.netIncome.total },
  };
}

// ── The math ─────────────────────────────────────────────────────────────
/** NOPAT a year: (EBITDA − depreciation) less tax at the rate on a positive result, × the annualizing factor. */
export function nopat(ebitda: Cents, depreciation: Cents, taxRateBps: number, factor = 1): Cents {
  const ebit = ebitda - depreciation;
  const tax = ebit > 0 ? (ebit * taxRateBps) / 10_000 : 0;
  return Math.round((ebit - tax) * factor);
}
export const roicOf = (nopatAnnual: Cents, capital: Cents): number | null => (capital > 0 ? nopatAnnual / capital : null);

export interface Wacc {
  costOfEquity: number;
  preTaxDebt: number | null;
  afterTaxDebt: number | null;
  debtWeight: number;
  equityWeight: number;
  wacc: number;
  note: string;
}
/** WACC = E/(D+E) × cost of equity + D/(D+E) × WACD × (1 − tax). With no positive equity on the books, the cost of equity alone (conservative). */
export function waccOf(x: { debt: Cents; equity: Cents; wacdBps: number | null; taxRateBps: number; costOfEquityBps: number }): Wacc {
  const ke = x.costOfEquityBps / 10_000;
  const kd = x.wacdBps === null ? null : x.wacdBps / 10_000;
  const kdAfter = kd === null ? null : kd * (1 - x.taxRateBps / 10_000);
  if (x.equity <= 0) return { costOfEquity: ke, preTaxDebt: kd, afterTaxDebt: kdAfter, debtWeight: 0, equityWeight: 1, wacc: ke, note: 'Equity on the books is not positive, so the weights mean nothing: the cost of equity is used alone.' };
  const d = kdAfter === null ? 0 : Math.max(0, x.debt);
  const wd = d / (d + x.equity), we = 1 - wd;
  return { costOfEquity: ke, preTaxDebt: kd, afterTaxDebt: kdAfter, debtWeight: wd, equityWeight: we, wacc: we * ke + wd * (kdAfter ?? 0), note: kdAfter === null ? 'No company debt: all equity.' : 'Weights are the loans and the equity on the group balance sheet.' };
}

export type GateStatus = 'pass' | 'fail' | 'na';
export interface Gate {
  key: string;
  /** The stage this gate leads out of. */
  stage: CompassStage;
  label: string;
  status: GateStatus;
  value: string;
  target: string;
  detail: string;
  /** Can't tell yet: the missing input and where to enter it. */
  needs?: string;
  /** Short reason used in the verdict sentence when it fails. */
  why: string;
  to: string;
}
export type StoreRole = 'grow' | 'fix' | 'harvest' | 'watch';
export const ROLE_LABEL: Record<StoreRole, string> = { grow: 'Grow', fix: 'Fix', harvest: 'Harvest', watch: 'Watch' };
export const ROLE_HINT: Record<StoreRole, string> = {
  grow: 'Invest: the spread is high and volume is rising.',
  fix: 'Earns less than the cost of capital: work the main lever.',
  harvest: 'Stable and cash-generative: maintain it and pull the cash.',
  watch: 'New or ramping: judge it against its ramp, not its returns.',
};
export interface Lever { kind: 'fuel' | 'labor' | 'inside'; label: string; gap: Cents; to: string }
export interface StoreView {
  input: StoreInput;
  nopatAnnual: Cents;
  roic: number | null;
  spread: number | null;
  role: StoreRole;
  roleWhy: string;
  levers: Lever[];
  mainLever: Lever | null;
  profitPerGallon: number | null;
  profitPerMonth: Cents;
  laborPct: number | null;
  volumeChange: number | null;
  salesChange: number | null;
  trend: 'up' | 'down' | 'flat' | 'na';
}
export interface Move { key: string; title: string; why: string; value: Cents | null; valueKind: 'annual' | 'risk'; to: string; linkLabel: string; clears?: string }
export interface Trigger { gate: string; label: string; target: string; now: string; eta: string; etaDate: string | null }
export interface Verdict {
  inputs: CompassInputs;
  settings: CompassSettings;
  stage: CompassStage;
  sentence: string;
  wacc: Wacc;
  company: { nopatAnnual: Cents; roic: number | null; spread: number | null; netIncomeAnnual: Cents; ebitdaAnnual: Cents; profitPerGallon: number | null; profitPerStoreMonth: Cents | null };
  cash: { fcfAnnual: Cents; fcfMonthly: Cents; conversion: number | null; monthsToFund: number | null };
  capacity: { dscrAfter: number | null; dscrTarget: number; leverageAfter: number | null; leverageTarget: number };
  /** Gates that can't be judged on these books, with what they need. */
  missing: { key: string; label: string; needs: string }[];
  /** The stage stands on incomplete evidence. */
  provisional: boolean;
  gates: Gate[];
  stores: StoreView[];
  moves: Move[];
  triggers: Trigger[];
  replicateReady: boolean;
  heldMonths: number;
}

const TO = { pnl: '/reports/pnl', covenants: '/debt/covenants', reserve: '/debt/reserve', capital: '/growth/capital', evaluate: '/growth/evaluate', readiness: '/growth/readiness#ramp', cashflow: '/reports/cash-flow', compass: '/growth/compass' };

function storeView(s: StoreInput, x: { factor: number; taxBps: number; wacc: number; targets: CompassInputs['targets']; cs: CompassSettings; months: number }): StoreView {
  const nopatAnnual = nopat(s.ebitda, s.depreciation, x.taxBps, x.factor);
  const roic = s.capital.fixed > 0 ? roicOf(nopatAnnual, s.capital.total) : null;
  const spread = roic === null ? null : roic - x.wacc;
  const levers: Lever[] = [];
  const cpgGap = s.fuelCpg === null ? 0 : x.targets.fuelCpg - s.fuelCpg;
  if (cpgGap > 0) levers.push({ kind: 'fuel', label: `fuel margin ${cents1(cpgGap)} below the ${cents1(x.targets.fuelCpg)} target`, gap: Math.round(cpgGap * s.gallons * x.factor), to: '/fuel' });
  const laborPct = s.sales ? (s.labor / s.sales) * 100 : null;
  if (laborPct !== null && laborPct > s.laborTargetPct) levers.push({ kind: 'labor', label: `labor ${(laborPct - s.laborTargetPct).toFixed(1)} pts over the ${s.laborTargetPct.toFixed(1)}% target`, gap: Math.round(((laborPct - s.laborTargetPct) / 100) * s.sales * x.factor), to: '/people/labor' });
  const gm = s.insideSales ? (s.insideGp / s.insideSales) * 100 : null;
  if (gm !== null && gm < x.targets.insideGmPct) levers.push({ kind: 'inside', label: `inside margin ${(x.targets.insideGmPct - gm).toFixed(1)} pts below the ${x.targets.insideGmPct}% target`, gap: Math.round(((x.targets.insideGmPct - gm) / 100) * s.insideSales * x.factor), to: '/inside' });
  levers.sort((a, b) => b.gap - a.gap);
  const mainLever = levers[0] ?? null;
  const ms = s.monthly;
  const last = ms.at(-1), prev = ms.at(-2);
  const volumeChange = last && prev && prev.gallons ? (last.gallons - prev.gallons) / prev.gallons : null;
  const salesChange = last && prev && prev.sales ? (last.sales - prev.sales) / prev.sales : null;
  const trend = salesChange === null ? 'na' : salesChange > 0.01 ? 'up' : salesChange < -0.01 ? 'down' : 'flat';
  let role: StoreRole, roleWhy: string;
  const young = s.monthsOpen !== null && s.monthsOpen < x.cs.watchMonths;
  const noAssets = s.capital.fixed <= 0;
  if (young || roic === null || noAssets) {
    role = 'watch';
    roleWhy = young ? `Opened ${shortDate(s.openedOn!)}, under ${x.cs.watchMonths} months: judged on its ramp, not its returns.` : "Can't tell yet: needs its fixed assets on the books to measure a return (Assets › Fixed assets).";
  } else if (spread! < 0) {
    role = 'fix';
    roleWhy = `ROIC ${pct1(roic)} is ${pts(spread!)} against the cost of capital${mainLever ? `; main lever: ${mainLever.label} (about ${money(mainLever.gap)} a year)` : '; no operating lever is below target, so the gap is the capital tied up'}.`;
  } else if (spread! * 100 >= x.cs.growSpreadPts && volumeChange !== null && volumeChange * 100 >= x.cs.growVolumePct) {
    role = 'grow';
    roleWhy = `Spread ${pts(spread!)} and gallons up ${pct1(volumeChange)} on the month before.`;
  } else {
    role = 'harvest';
    roleWhy = `Spread ${pts(spread!)}; ${volumeChange === null ? 'only one complete month, so no volume trend yet' : `gallons ${volumeChange >= 0 ? 'up' : 'down'} ${pct1(Math.abs(volumeChange))}`}${spread! * 100 < x.cs.growSpreadPts ? ` (Grow needs a ${x.cs.growSpreadPts}-point spread)` : ` (Grow needs gallons up ${x.cs.growVolumePct}%)`}.`;
  }
  return {
    input: s, nopatAnnual, roic, spread, role, roleWhy, levers, mainLever,
    profitPerGallon: s.gallons ? s.netIncome / s.gallons : null, profitPerMonth: x.months ? Math.round(s.netIncome / x.months) : 0,
    laborPct, volumeChange, salesChange, trend,
  };
}

/** The gates on their own: the verdict's core, cheap enough to scan for the sensitivity. */
export function evaluateGates(inp: CompassInputs, cs: CompassSettings, growthTargets: { dscr: number; leverage: number }) {
  const taxBps = inp.tax.rateBps;
  const wacc = waccOf({ debt: inp.capitalStructure.debt, equity: inp.capitalStructure.equity, wacdBps: inp.capitalStructure.wacdBps, taxRateBps: taxBps, costOfEquityBps: cs.costOfEquityBps });
  const f = inp.factor;
  const nopatAnnual = nopat(inp.company.ebitda, inp.company.depreciation, taxBps, f);
  const roic = roicOf(nopatAnnual, inp.company.capital.total);
  const spread = roic === null ? null : roic - wacc.wacc;
  const netIncomeAnnual = Math.round(inp.company.netIncome * f);
  const ebitdaAnnual = Math.round(inp.company.ebitda * f);
  const fcfAnnual = Math.round(inp.cash.fcf * f);
  const fcfMonthly = Math.round(fcfAnnual / 12);
  const conversion = inp.company.ebitda > 0 ? inp.cash.fcf / inp.company.ebitda : null;
  const stores = inp.stores.map((s) => storeView(s, { factor: f, taxBps, wacc: wacc.wacc, targets: inp.targets, cs, months: inp.months }));
  const measured = stores.filter((s) => s.role !== 'watch');
  const creating = measured.filter((s) => (s.spread ?? -1) > 0);
  const dscrTarget = (cs.dscrAfterTarget ?? growthTargets.dscr) / 100;
  const leverageTarget = (cs.leverageAfterTarget ?? growthTargets.leverage) / 100;
  const c = inp.capacity;
  const dscrAfter = inp.ready ? dscrWithNewDebt({ ebitdaAnnual: c.ebitdaAnnual, debtServiceAnnual: c.debtServiceAnnual }, c.addedDebtService, c.addedEbitda) : null;
  const debtAfter = c.debt + c.newLoan, ebitdaAfter = c.ebitdaAnnual + c.addedEbitda;
  const leverageAfter = ebitdaAfter > 0 ? debtAfter / ebitdaAfter : debtAfter > 0 ? Infinity : 0;
  const deployable = inp.cash.deployable;
  const need = inp.cash.equityNeed;
  const toFund = monthsToFund(need, Math.max(0, deployable), fcfMonthly);
  const basisLabel = inp.basis === 'accrual' ? 'accrual' : inp.basis === 'cash' ? 'cash' : 'booked';
  const ann = inp.annualized ? ` (annualized from ${inp.months} month${inp.months === 1 ? '' : 's'}, × ${f.toFixed(1)})` : '';
  const st = (ok: boolean | null): GateStatus => (ok === null ? 'na' : ok ? 'pass' : 'fail');
  const gates: Gate[] = [];

  // Fix → Stabilize
  gates.push({
    key: 'profit', stage: 'fix', label: 'The company makes money', status: st(inp.ready ? netIncomeAnnual > 0 : null),
    value: inp.ready ? `${money(netIncomeAnnual)} a year` : '–', target: `Net income above $0 (${basisLabel} basis)`,
    detail: inp.ready ? `${money(inp.company.netIncome)} net income ${periodLabel(inp.from)} – ${periodLabel(inp.period)}${ann}. On the ${inp.company.otherBasis} basis it was ${money(inp.company.otherNetIncome)}.` : 'No complete month on the books yet.',
    why: `the company is losing ${money(-netIncomeAnnual)} a year`, to: TO.pnl,
  });
  const badCov = inp.covenants.filter((x) => x.status === 'breach' || (x.within && x.forecastDate));
  gates.push({
    key: 'covenants', stage: 'fix', label: 'No covenant broken or forecast to break', status: st(inp.covenants.length ? !badCov.length : true),
    value: badCov.length ? badCov.map((x) => `${x.label}: ${x.status === 'breach' ? `broken (${x.actual})` : `forecast to break ${shortDate(x.forecastDate!)}`}`).join('; ') : `${inp.covenants.length} covenant${inp.covenants.length === 1 ? '' : 's'} clear`,
    target: 'Every covenant passes and none is forecast to break within the horizon',
    detail: inp.covenants.length ? inp.covenants.map((x) => `${x.label} ${x.actual} vs ${x.limit}${x.forecastDate ? `, forecast to break ${shortDate(x.forecastDate)}` : ''}`).join('; ') + '.' : 'No covenants on file.',
    why: badCov.map((x) => `the ${x.name.toLowerCase()} covenant on the ${x.loan[0].toLowerCase()}${x.loan.slice(1)} is ${x.status === 'breach' ? `broken (${x.actual} vs ${x.limit})` : `forecast to break on ${shortDate(x.forecastDate!)}`}`).join(' and '), to: TO.covenants,
  });
  gates.push({
    key: 'reserve', stage: 'fix', label: 'Cash covers the reserve', status: st(deployable >= 0),
    value: `${money(inp.cash.cash)} cash`, target: `≥ the ${money(inp.cash.reserveTarget)} reserve target`,
    detail: deployable >= 0 ? `${money(deployable)} above the reserve.` : `${money(-deployable)} short of the reserve.`,
    why: `cash is ${money(-deployable)} short of the reserve`, to: TO.reserve,
  });
  // Stabilize → Optimize
  gates.push({
    key: 'roic', stage: 'stabilize', label: 'Company ROIC at or above the cost of capital', status: st(roic === null ? null : roic >= wacc.wacc),
    value: `ROIC ${pct1(roic)} vs WACC ${pct1(wacc.wacc)}`, target: 'ROIC ≥ WACC (spread ≥ 0)',
    detail: `NOPAT ${money(nopatAnnual)} a year ÷ invested capital ${money(inp.company.capital.total)}; spread ${spread === null ? '–' : pts(spread)}.`,
    why: `company ROIC (${pct1(roic)}) is below the ${pct1(wacc.wacc)} cost of capital`, to: '/reports/balance-sheet',
  });
  gates.push({
    key: 'conversion', stage: 'stabilize', label: 'Profit turns into cash', status: st(conversion === null ? (inp.ready ? false : null) : conversion * 100 >= cs.cashConversionMinPct),
    value: `${pct1(conversion)} cash conversion`, target: `Free cash flow ÷ EBITDA ≥ ${cs.cashConversionMinPct}%`,
    detail: `Free cash flow ${money(inp.cash.fcf)} (operating ${money(inp.cash.operating)} less capex ${money(-inp.cash.capex)}) ÷ EBITDA ${money(inp.company.ebitda)}, ${periodLabel(inp.from)} – ${periodLabel(inp.period)}.${conversion === null ? ' EBITDA is not positive, so there is nothing to convert.' : ''}`,
    why: conversion === null ? 'EBITDA is not positive' : `only ${pct1(conversion)} of EBITDA turns into free cash`, to: TO.cashflow,
  });
  const cushionNeed = Math.round((inp.cash.reserveTarget * cs.reserveCushionPct) / 100);
  gates.push({
    key: 'cushion', stage: 'stabilize', label: 'A real cushion over the reserve', status: st(deployable >= cushionNeed),
    value: `${money(Math.max(0, deployable))} above the reserve`, target: `≥ ${cs.reserveCushionPct}% of the reserve (${money(cushionNeed)})`,
    detail: `Reserve ${money(inp.cash.reserveTarget)}; cash ${money(inp.cash.cash)}.`, why: `cash above the reserve is thin (${money(Math.max(0, deployable))}, ${cs.reserveCushionPct}% would be ${money(cushionNeed)})`, to: TO.reserve,
  });
  // Optimize → Replicate
  const share = measured.length ? creating.length / measured.length : null;
  gates.push({
    key: 'stores', stage: 'optimize', label: 'Most stores earn more than the cost of capital', status: st(share === null ? null : share * 100 >= cs.valueStoreSharePct),
    value: measured.length ? `${creating.length} of ${measured.length} stores` : 'No store measured yet', target: `≥ ${cs.valueStoreSharePct}% of the stores past their first year with a positive spread`,
    detail: stores.map((s) => `${s.input.code} ${s.role === 'watch' ? 'watch (ramping)' : `${pct1(s.roic)} (${s.spread === null ? '–' : pts(s.spread)})`}`).join('; ') + '. Store ROIC is before corporate overhead.',
    why: `${measured.length - creating.length} of ${measured.length} stores earn less than the cost of capital`, to: '/reports/scorecards',
  });
  gates.push({
    key: 'dscrAfter', stage: 'optimize', label: 'DSCR after a new-store loan', status: st(dscrAfter === null ? null : dscrAfter >= dscrTarget),
    value: ratioX(dscrAfter), target: `≥ ${dscrTarget.toFixed(2)}x`,
    detail: inp.ready ? `${ratioX(c.dscr)} today; adding ${c.dealName ?? 'no deal'}: ${money(c.addedDebtService)} year-1 debt service and ${money(c.addedEbitda)} year-1 EBITDA.` : 'No covenant metrics yet.',
    why: `DSCR after the new loan would be ${ratioX(dscrAfter)} (target ${dscrTarget.toFixed(2)}x)`, to: TO.evaluate,
  });
  gates.push({
    key: 'leverageAfter', stage: 'optimize', label: 'Leverage after the deal', status: st(inp.ready ? leverageAfter <= leverageTarget : null),
    value: ratioX(leverageAfter), target: `≤ ${leverageTarget.toFixed(2)}x debt ÷ EBITDA`,
    detail: `${money(debtAfter)} debt (${money(c.debt)} + ${money(c.newLoan)} new) ÷ ${money(ebitdaAfter)} EBITDA.`, why: `leverage after the deal would be ${ratioX(leverageAfter)}`, to: TO.evaluate,
  });
  gates.push({
    key: 'equity', stage: 'optimize', label: 'Equity for the next store on hand', status: st(deployable >= need),
    value: `${money(Math.max(0, deployable))} deployable`, target: `≥ ${money(need)} (${inp.cash.equitySource})`,
    detail: deployable >= need ? 'Cash above the reserve covers the equity.' : `Short ${money(need - Math.max(0, deployable))}; ${toFund === null ? 'free cash flow does not close the gap' : `about ${toFund} month${toFund === 1 ? '' : 's'} at ${money(fcfMonthly)} free cash flow a month`}.`,
    why: `the ${money(need)} of equity isn't on hand (${money(Math.max(0, deployable))} above the reserve)`, to: TO.capital,
  });
  const rl = inp.ramp?.rows.at(-1);
  const rampWorst = rl ? Math.min(rl.gallonsPct ?? Infinity, rl.insidePct ?? Infinity) : null;
  const rampVal = rampWorst === null || !Number.isFinite(rampWorst) ? null : rampWorst;
  gates.push({
    key: 'ramp', stage: 'optimize', label: `Newest store has ramped${inp.ramp ? ` (${inp.ramp.code})` : ''}`, status: st(rampVal === null ? null : rampVal * 100 >= cs.rampMinPct),
    value: rl ? `${pct1(rl.gallonsPct)} gallons · ${pct1(rl.insidePct)} inside` : '–', target: `≥ ${cs.rampMinPct}% of its ramp targets, gallons and inside`,
    detail: !inp.ramp ? 'No ramp targets entered for the newest store.' : !rl ? 'No sales yet in a target month.' : `${periodLabel(rl.period)}, ${rl.days} of ${rl.daysInMonth} days (targets prorated).`,
    why: inp.ramp && rl ? `${inp.ramp.code} is at ${pct1(rampVal)} of its ramp target` : 'the newest store has no ramp to judge', to: TO.readiness,
  });
  // Missing evidence: say what is needed rather than judge zeros.
  const ev = inp.evidence;
  const unknown = (key: string, msg: string) => { const g = gates.find((x) => x.key === key)!; g.status = 'na'; g.needs = msg; g.value = `Can't tell yet: needs ${msg}`; };
  if (!inp.ready) unknown('profit', 'a complete month of P&L (Books › Transactions)');
  if (!ev.loans && !inp.covenants.length) unknown('covenants', 'the loans and their covenants (Assets › Loans, Debt › Covenants)');
  if (inp.cash.reserveTarget <= 0) {
    const r = 'a reserve target from fixed costs, fuel loads and payroll (Debt › Cash reserve)';
    unknown('reserve', r); unknown('cushion', r); unknown('equity', r);
  }
  if (inp.company.capital.fixed <= 0) unknown('roic', 'fixed assets on the books to know invested capital (Assets › Fixed assets)');
  if (!inp.ready) unknown('conversion', 'a complete month of P&L (Books › Transactions)');
  else if (!ev.cashFlowDetail) unknown('conversion', 'balance-sheet activity (bank, payables, inventory, assets) to tell cash from profit (Bank, Payables, Assets)');
  if (!measured.length) unknown('stores', 'each store\'s fixed assets to measure its return (Assets › Fixed assets)');
  if (!ev.hasDeal) { const d = 'a new-store pro forma with its loan (Growth › Pro forma)'; unknown('dscrAfter', d); unknown('leverageAfter', d); }
  else if (!ev.loans) unknown('dscrAfter', 'the loans on file for today\'s debt service (Assets › Loans)');
  else if (!inp.ready) { unknown('dscrAfter', 'a complete month of P&L (Books › Transactions)'); unknown('leverageAfter', 'a complete month of P&L (Books › Transactions)'); }
  if (!inp.ramp) unknown('ramp', 'ramp targets for the newest store (Growth › Expansion readiness)');
  else if (!rl) unknown('ramp', `a month of sales at ${inp.ramp.code} in a target month`);
  const replicateReady = gates.every((g) => g.status === 'pass');
  const prior = [...inp.history].filter((h) => h.period < inp.period).sort((a, b) => b.period.localeCompare(a.period));
  let held = replicateReady ? 1 : 0;
  if (replicateReady) for (let i = 0, p = addMonthsP(inp.period, -1); i < prior.length && prior[i].period === p && prior[i].replicateReady; i++, p = addMonthsP(p, -1)) held += 1;
  // Replicate → Scale
  gates.push({
    key: 'held', stage: 'replicate', label: `Replicate gates held ${cs.scaleMonths} months in a row`, status: st(held >= cs.scaleMonths),
    value: `${held} month${held === 1 ? '' : 's'}`, target: `${cs.scaleMonths} consecutive recorded months`,
    detail: prior.length ? `Recorded: ${prior.slice(0, 6).map((h) => `${periodLabel(h.period)} ${h.replicateReady ? 'ready' : STAGE_LABEL[h.stage]}`).join(', ')}.` : 'No earlier month recorded yet; record each month to build the history.',
    why: `the replicate gates have held ${held} of ${cs.scaleMonths} months`, to: TO.compass,
  });
  const after = deployable - need;
  const toFundNext = monthsToFund(need, Math.max(0, after), fcfMonthly);
  gates.push({
    key: 'fund', stage: 'replicate', label: `Cash funds the store after next within ${cs.scaleFundMonths} months`, status: st(toFundNext !== null && toFundNext <= cs.scaleFundMonths && after >= 0),
    value: after < 0 ? 'The next store is not funded yet' : toFundNext === null ? 'Not at the current pace' : `${toFundNext} month${toFundNext === 1 ? '' : 's'}`, target: `≤ ${cs.scaleFundMonths} months`,
    detail: `After the next store's ${money(need)} equity, ${money(Math.max(0, after))} is left above the reserve; free cash flow is ${money(fcfMonthly)} a month.`,
    why: 'free cash flow would not fund another store soon enough', to: TO.capital,
  });
  // The furthest stage the available evidence supports: the first rung with a failing gate. Gates that can't be judged
  // don't block, but a store is never opened on missing evidence: with any unknown up to Replicate, the stage stops at Optimize.
  let stage: CompassStage = 'scale';
  for (const k of ['fix', 'stabilize', 'optimize', 'replicate'] as CompassStage[]) if (gates.some((g) => g.stage === k && g.status === 'fail')) { stage = k; break; }
  const missing = gates.filter((g) => g.status === 'na').map((g) => ({ key: g.key, label: g.label, needs: g.needs ?? 'more data' }));
  const unknownBefore = gates.some((g) => g.status === 'na' && ['fix', 'stabilize', 'optimize'].includes(g.stage));
  if (unknownBefore && STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf('optimize')) stage = 'optimize';
  const provisional = gates.some((g) => g.status === 'na' && STAGE_ORDER.indexOf(g.stage) <= STAGE_ORDER.indexOf(stage));
  return {
    stage, gates, wacc, stores, replicateReady, held, missing, provisional,
    company: { nopatAnnual, roic, spread, netIncomeAnnual, ebitdaAnnual, profitPerGallon: inp.company.gallons ? inp.company.netIncome / inp.company.gallons : null, profitPerStoreMonth: inp.stores.length && inp.months ? Math.round(inp.stores.reduce((a, s) => a + s.netIncome, 0) / inp.stores.length / inp.months) : null },
    cash: { fcfAnnual, fcfMonthly, conversion, monthsToFund: toFund },
    capacity: { dscrAfter: gates.find((g) => g.key === 'dscrAfter')!.status === 'na' ? null : dscrAfter, dscrTarget, leverageAfter: gates.find((g) => g.key === 'leverageAfter')!.status === 'na' || !Number.isFinite(leverageAfter) ? null : leverageAfter, leverageTarget },
  };
}
type GateResult = ReturnType<typeof evaluateGates>;

const growthTargetsOf = (state?: BooksState) => { const s = state ? growthOf(state).settings : { dscrTarget: 125, leverageTarget: 350 }; return { dscr: s.dscrTarget, leverage: s.leverageTarget }; };

/** The next three moves: anything that clears a failing gate of the current stage first, then by annual value. */
export function rankMoves(inp: CompassInputs, cs: CompassSettings, r: GateResult): Move[] {
  const out: Move[] = [];
  const failing = new Set(r.gates.filter((g) => g.stage === r.stage && g.status === 'fail').map((g) => g.key));
  // Fix the worst store's main lever: Fix-role stores first (lowest spread), else the biggest gap anywhere.
  const fixers = r.stores.filter((s) => s.role === 'fix' && s.mainLever).sort((a, b) => (a.spread ?? 0) - (b.spread ?? 0));
  const leverStore = fixers[0] ?? r.stores.filter((s) => (s.input.monthsOpen === null || s.input.monthsOpen >= cs.watchMonths) && s.mainLever).sort((a, b) => b.mainLever!.gap - a.mainLever!.gap)[0];
  if (leverStore?.mainLever) {
    const l = leverStore.mainLever;
    out.push({ key: `lever:${leverStore.input.storeId}`, title: `${leverStore.input.code}: close the ${l.kind === 'fuel' ? 'fuel margin' : l.kind === 'labor' ? 'labor' : 'inside margin'} gap`, why: `${l.label[0].toUpperCase()}${l.label.slice(1)}. Gap × volume ≈ ${money(l.gap)} a year.`, value: l.gap, valueKind: 'annual', to: l.to, linkLabel: l.kind === 'fuel' ? 'Fuel margin' : l.kind === 'labor' ? 'Labor' : 'Inside store', clears: failing.has('profit') || failing.has('roic') || failing.has('stores') ? [...failing].find((k) => ['profit', 'roic', 'stores'].includes(k)) : undefined });
  }
  const dep = inp.cash.deployable;
  // Head off a covenant breach.
  const bad = inp.covenants.filter((x) => x.status === 'breach' || (x.within && x.forecastDate));
  for (const x of bad) {
    const short = x.limitCents !== undefined && x.lowAmount !== undefined ? Math.max(0, x.limitCents - x.lowAmount) : null;
    out.push({ key: `cov:${x.key}`, title: `Head off the ${x.name.toLowerCase()} breach`, why: x.status === 'breach' ? `${x.label} is broken: ${x.actual} vs ${x.limit}. Talk to the lender before the next test.` : `${x.label} is forecast to break on ${shortDate(x.forecastDate!)}${short !== null ? `: the forecast low is ${money(x.lowAmount!)}, ${money(short)} under the minimum. Move cash into the operating account or delay payments to keep it above ${x.limit.replace('≥ ', '')}` : ''}.`, value: short, valueKind: 'risk', to: TO.covenants, linkLabel: 'Covenant monitor', clears: 'covenants' });
  }
  // Raise the reserve.
  const cushionNeed = Math.round((inp.cash.reserveTarget * cs.reserveCushionPct) / 100);
  if (dep < cushionNeed) {
    const gap = dep < 0 ? -dep : cushionNeed - dep;
    out.push({ key: 'reserve', title: dep < 0 ? 'Rebuild the cash reserve' : 'Build a cushion over the reserve', why: dep < 0 ? `Cash is ${money(-dep)} under the ${money(inp.cash.reserveTarget)} reserve. Hold distributions and new projects until it is back.` : `Only ${money(dep)} sits above the reserve; hold back ${money(gap)} more before committing cash.`, value: gap, valueKind: 'risk', to: TO.reserve, linkLabel: 'Cash reserve', clears: dep < 0 ? 'reserve' : 'cushion' });
  }
  // Pay down the dearest debt (only with cash above the reserve).
  if (inp.paydown && dep > 0 && inp.cash.reserveTarget > 0) {
    const amt = Math.min(dep, inp.paydown.balance);
    out.push({ key: 'paydown', title: `Pay down the ${inp.paydown.label}`, why: `${(inp.paydown.rateBps / 100).toFixed(2)}% (${(inp.paydown.afterTaxBps / 100).toFixed(2)}% after tax), a certain return: ${money(amt)} of the cash above the reserve saves about ${money(Math.round((amt * inp.paydown.afterTaxBps) / 10_000))} a year after tax.`, value: Math.round((amt * inp.paydown.afterTaxBps) / 10_000), valueKind: 'annual', to: '/debt/paydown', linkLabel: 'Paydown vs invest' });
  }
  // Fund the best capital project.
  if (inp.project) {
    const p = inp.project;
    out.push({ key: 'project', title: `Fund ${p.label}`, why: `${pct1(p.expectedReturn)} expected return on ${money(p.amount)} ≈ ${money(Math.round(p.amount * p.expectedReturn))} a year${p.status === 'idea' ? '; still an idea: approve it on Capital allocation first' : ''}${p.amount > Math.max(0, dep) ? `; needs ${money(p.amount - Math.max(0, dep))} more than the cash above the reserve` : ''}.`, value: Math.round(p.amount * p.expectedReturn), valueKind: 'annual', to: p.to, linkLabel: 'Capital allocation' });
  }
  // Open the next store, only once the stage allows it.
  if (inp.proForma && (r.stage === 'replicate' || r.stage === 'scale')) {
    const pf = inp.proForma;
    out.push({ key: 'store', title: `Open store #${inp.nextStoreNumber}: ${pf.name}`, why: `Levered NPV ${money(pf.npv)}, IRR ${pct1(pf.irr)}; about ${money(pf.stabilizedCash)} a year after debt service once stabilized (year ${pf.stabilizedYear}), on ${money(pf.equity)} of equity.`, value: pf.stabilizedCash, valueKind: 'annual', to: `/growth/evaluate`, linkLabel: 'Evaluate a deal' });
  }
  const rank = (m: Move) => (m.clears && failing.has(m.clears) ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || (b.value ?? -1) - (a.value ?? -1));
}

/** Months until a trend in monthly EBITDA makes `passes(extraAnnualEbitda)` true; null when there is no trend or it never gets there in 36 months. */
function etaFromTrend(inp: CompassInputs, passes: (extraAnnualEbitda: number) => boolean): { months: number | null; note: string } {
  const ys = inp.monthlyCompany.map((x) => x.ebitda);
  const tr = trendLine(ys);
  if (!tr) return { months: null, note: `no estimate: a trend needs ${TREND_MIN_MONTHS} complete months and the books have ${ys.length}` };
  if (tr.slope <= 0) return { months: null, note: 'no estimate: monthly EBITDA is flat or falling' };
  const base = (inp.company.ebitda / Math.max(1, inp.months)) * 12;
  for (let k = 1; k <= 36; k++) {
    const proj = (tr.last + tr.slope * k) * 12;
    if (passes(proj - base)) return { months: k, note: `about ${k} month${k === 1 ? '' : 's'} on the EBITDA trend (+${money(tr.slope)} a month)` };
  }
  return { months: null, note: 'not within 36 months on the current EBITDA trend' };
}

/** "Open store #N when …": every gate still between today and Replicate, with the number to reach and an estimated date where computable. */
export function buildTriggers(inp: CompassInputs, cs: CompassSettings, r: GateResult): Trigger[] {
  const want = new Set<CompassStage>(['fix', 'stabilize', 'optimize']);
  const scale = r.stage === 'replicate' || r.stage === 'scale';
  const gates = r.gates.filter((g) => (scale ? g.stage === 'replicate' : want.has(g.stage)) && g.status !== 'pass');
  const t = inp.tax.rateBps;
  const out: Trigger[] = [];
  const at = (months: number | null) => (months === null ? null : addMonthsDate(inp.asOf, months));
  for (const g of gates) {
    let eta: { months: number | null; note: string } = { months: null, note: 'no estimate from the data on file' };
    const fcf = r.cash.fcfMonthly;
    if (g.status === 'na') {
      eta = { months: null, note: `can't tell yet: needs ${g.needs}` };
    } else if (g.key === 'equity' || g.key === 'reserve' || g.key === 'cushion') {
      const need = g.key === 'equity' ? inp.cash.equityNeed : g.key === 'reserve' ? 0 : Math.round((inp.cash.reserveTarget * cs.reserveCushionPct) / 100);
      const m = g.key === 'equity' ? monthsToFund(need, Math.max(0, inp.cash.deployable), fcf) : monthsToFund(need, inp.cash.deployable, fcf);
      eta = { months: m, note: m === null ? 'no estimate: free cash flow is not positive' : `about ${m} month${m === 1 ? '' : 's'} at the current pace (${money(fcf)} free cash flow a month)` };
    } else if (g.key === 'profit') {
      eta = etaFromTrend(inp, (x) => r.company.netIncomeAnnual + x > 0);
    } else if (g.key === 'roic') {
      eta = etaFromTrend(inp, (x) => { const n = nopat(inp.company.ebitda * inp.factor + x, inp.company.depreciation * inp.factor, t); return inp.company.capital.total > 0 && n / inp.company.capital.total >= r.wacc.wacc; });
    } else if (g.key === 'dscrAfter') {
      eta = etaFromTrend(inp, (x) => (dscrWithNewDebt({ ebitdaAnnual: inp.capacity.ebitdaAnnual + x, debtServiceAnnual: inp.capacity.debtServiceAnnual }, inp.capacity.addedDebtService, inp.capacity.addedEbitda) ?? 0) >= r.capacity.dscrTarget);
    } else if (g.key === 'leverageAfter') {
      eta = etaFromTrend(inp, (x) => { const e = inp.capacity.ebitdaAnnual + inp.capacity.addedEbitda + x; return e > 0 && (inp.capacity.debt + inp.capacity.newLoan) / e <= r.capacity.leverageTarget; });
    } else if (g.key === 'ramp') {
      const rows = inp.ramp?.rows ?? [];
      const ys = rows.map((x) => Math.min(x.gallonsPct ?? Infinity, x.insidePct ?? Infinity)).filter(Number.isFinite);
      if (ys.length < 2) eta = { months: null, note: `no estimate: ${ys.length} ramp month${ys.length === 1 ? '' : 's'} on file (a trend needs two)` };
      else {
        const slope = ys.at(-1)! - ys.at(-2)!;
        const k = slope > 0 ? Math.ceil((cs.rampMinPct / 100 - ys.at(-1)!) / slope) : null;
        eta = { months: k, note: k === null ? 'no estimate: the ramp is not improving' : `about ${k} month${k === 1 ? '' : 's'} at the last month's improvement` };
      }
    } else if (g.key === 'covenants') {
      eta = { months: null, note: 'clears when no covenant is broken and the forecast stays above every limit' };
    } else if (g.key === 'held') {
      const left = cs.scaleMonths - r.held;
      eta = { months: left, note: `${left} more month${left === 1 ? '' : 's'} recorded with the gates holding` };
    } else if (g.key === 'stores') {
      eta = { months: null, note: 'clears as the Fix stores close their gaps' };
    }
    out.push({ gate: g.key, label: g.label, target: g.target, now: g.value, eta: eta.note, etaDate: at(eta.months) });
  }
  return out;
}

const sentenceOf = (stage: CompassStage, gates: Gate[]) => {
  const fails = gates.filter((g) => g.stage === stage && g.status === 'fail');
  const unknown = gates.filter((g) => g.status === 'na');
  const tail = unknown.length ? ` Can't tell yet: ${unknown.map((g) => `${g.label[0].toLowerCase()}${g.label.slice(1)} (needs ${g.needs})`).join('; ')}.` : '';
  if (stage === 'scale') return 'Scale: every gate passes, has held for months, and cash funds the next store quickly.';
  if (!fails.length) return `${STAGE_LABEL[stage]}, provisionally: every gate with evidence passes up to here, but some can't be judged on these books.${tail}`;
  return `${STAGE_LABEL[stage]}: ${fails.map((g) => g.why).join('; ')}.${tail}`;
};

export function compassVerdict(inp: CompassInputs, cs: CompassSettings, growthTargets = growthTargetsOf()): Verdict {
  const r = evaluateGates(inp, cs, growthTargets);
  return {
    inputs: inp, settings: cs, stage: r.stage, sentence: sentenceOf(r.stage, r.gates), wacc: r.wacc, company: r.company, cash: r.cash, capacity: r.capacity, missing: r.missing, provisional: r.provisional,
    gates: r.gates, stores: r.stores, moves: rankMoves(inp, cs, r).slice(0, 3), triggers: buildTriggers(inp, cs, r), replicateReady: r.replicateReady, heldMonths: r.held,
  };
}

/** The verdict for the books as of a date (live). */
export function growthCompass(state: BooksState, asOf: string, opts: { entries?: BasisEntry[]; settings?: Partial<CompassSettings> } = {}): Verdict {
  const cs = { ...compassOf(state).settings, ...(opts.settings ?? {}) };
  return compassVerdict(compassInputs(state, asOf, { entries: opts.entries, settings: cs }), cs, growthTargetsOf(state));
}

// ── Sensitivity ──────────────────────────────────────────────────────────
/** The inputs with fuel margin moved by `cpg` cents a gallon, or gallons by `gallonsPct` % (inside sales, costs, covenants and the reserve held). */
export function shockInputs(inp: CompassInputs, x: { cpg?: number; gallonsPct?: number }): CompassInputs {
  let total = 0, cash = 0;
  const stores = inp.stores.map((s) => {
    const d = Math.round((x.cpg ?? 0) * s.gallons + ((x.gallonsPct ?? 0) / 100) * s.fuelMargin);
    total += d;
    cash += d;
    const gallons = s.gallons * (1 + (x.gallonsPct ?? 0) / 100);
    return { ...s, netIncome: s.netIncome + d, ebitda: s.ebitda + d, fuelMargin: s.fuelMargin + d, gallons, fuelCpg: gallons ? (s.fuelMargin + d) / gallons : s.fuelCpg, monthly: s.monthly.map((mm) => ({ ...mm, gallons: Math.round(mm.gallons * (1 + (x.gallonsPct ?? 0) / 100)) })) };
  });
  const ann = Math.round(total * inp.factor);
  return {
    ...inp, stores,
    company: { ...inp.company, netIncome: inp.company.netIncome + total, ebitda: inp.company.ebitda + total, fuelMargin: inp.company.fuelMargin + total, gallons: stores.reduce((a, s) => a + s.gallons, 0) },
    cash: { ...inp.cash, operating: inp.cash.operating + cash, fcf: inp.cash.fcf + cash },
    capacity: { ...inp.capacity, ebitdaAnnual: inp.capacity.ebitdaAnnual + ann },
  };
}
export interface Scenario { key: string; label: string; stage: CompassStage; flips: { key: string; label: string; from: GateStatus; to: GateStatus }[] }
export interface FlipPoint { key: string; label: string; status: GateStatus; cpg: number | null; gallonsPct: number | null }
export interface SensitivityResult { scenarios: Scenario[]; flipPoints: FlipPoint[]; firstFlip: FlipPoint | null }

export function compassSensitivity(inp: CompassInputs, cs: CompassSettings, growthTargets = growthTargetsOf()): SensitivityResult {
  const base = evaluateGates(inp, cs, growthTargets);
  const run = (key: string, label: string, x: { cpg?: number; gallonsPct?: number }): Scenario => {
    const r = evaluateGates(shockInputs(inp, x), cs, growthTargets);
    return { key, label, stage: r.stage, flips: r.gates.map((g, i) => ({ key: g.key, label: g.label, from: base.gates[i].status, to: g.status })).filter((f) => f.from !== f.to) };
  };
  const c = cs.shockCpg, gp = cs.shockGallonsPct;
  const scenarios = [run('cpg+', `Fuel margin +${c}¢`, { cpg: c }), run('cpg-', `Fuel margin −${c}¢`, { cpg: -c }), run('gal+', `Gallons +${gp}%`, { gallonsPct: gp }), run('gal-', `Gallons −${gp}%`, { gallonsPct: -gp })];
  // The smallest move that flips each gate (fuel margin in 0.1¢ steps to ±10¢; gallons in 1% steps to ±30%), nearest first.
  const scan = (steps: number[], mk: (v: number) => { cpg?: number; gallonsPct?: number }): (number | null)[] => {
    const found: (number | null)[] = base.gates.map(() => null);
    for (const v of steps) {
      const gs = evaluateGates(shockInputs(inp, mk(v)), cs, growthTargets).gates;
      gs.forEach((g, i) => { if (found[i] === null && base.gates[i].status !== 'na' && g.status !== base.gates[i].status) found[i] = v; });
      if (found.every((f, i) => f !== null || base.gates[i].status === 'na')) break;
    }
    return found;
  };
  const cpgSteps: number[] = [], galSteps: number[] = [];
  for (let k = 1; k <= 100; k++) cpgSteps.push(k / 10, -k / 10);
  for (let k = 1; k <= 30; k++) galSteps.push(k, -k);
  const byCpg = scan(cpgSteps, (v) => ({ cpg: v })), byGal = scan(galSteps, (v) => ({ gallonsPct: v }));
  const flipPoints = base.gates.map((g, i) => ({ key: g.key, label: g.label, status: g.status, cpg: byCpg[i], gallonsPct: byGal[i] }));
  const firstFlip = [...flipPoints].filter((f) => f.cpg !== null).sort((a, b) => Math.abs(a.cpg!) - Math.abs(b.cpg!))[0] ?? null;
  return { scenarios, flipPoints, firstFlip };
}

// ── How it is calculated ─────────────────────────────────────────────────
export interface Assumption { key: string; label: string; formula: string; value: string; setting?: keyof CompassSettings }
export function assumptions(v: Verdict): Assumption[] {
  const i = v.inputs, s = v.settings;
  const ic = i.company.capital;
  return [
    { key: 'window', label: 'Window', formula: `The covenant headline month and its trailing window, ${i.basis} basis${i.annualized ? `; annualized × ${i.factor.toFixed(1)} from ${i.months} month${i.months === 1 ? '' : 's'}, not a true trailing year` : ''}. There is no prior year on these books, so nothing is compared with last year.`, value: `${periodLabel(i.from)} – ${periodLabel(i.period)}`, setting: 'basis' },
    { key: 'ke', label: 'Cost of equity', formula: 'A judgement call: what the owners could earn on money at this risk elsewhere. Not from the books.', value: `${(s.costOfEquityBps / 100).toFixed(2)}%`, setting: 'costOfEquityBps' },
    { key: 'tax', label: 'Tax rate', formula: `Used for NOPAT and the debt tax shield. ${i.tax.source}.`, value: `${(i.tax.rateBps / 100).toFixed(2)}%`, setting: 'taxRateBps' },
    { key: 'kd', label: 'After-tax cost of debt', formula: 'Weighted-average cost of company debt (Debt dashboard, balance-weighted) × (1 − tax rate). Related-party mortgages are not on our books: their cost sits in rent.', value: v.wacc.afterTaxDebt === null ? 'No company debt' : `${pct1(v.wacc.preTaxDebt)} × (1 − ${(i.tax.rateBps / 100).toFixed(1)}%) = ${(v.wacc.afterTaxDebt * 100).toFixed(2)}%` },
    { key: 'wacc', label: 'WACC', formula: `E ÷ (D + E) × cost of equity + D ÷ (D + E) × after-tax cost of debt. D = loans (${money(i.capitalStructure.debt)}), E = equity (${money(i.capitalStructure.equity)}) on the group balance sheet at ${shortDate(i.date)}. ${v.wacc.note}`, value: `${(v.wacc.equityWeight * 100).toFixed(1)}% × ${pct1(v.wacc.costOfEquity)} + ${(v.wacc.debtWeight * 100).toFixed(1)}% × ${pct1(v.wacc.afterTaxDebt ?? 0)} = ${(v.wacc.wacc * 100).toFixed(2)}%` },
    { key: 'nopat', label: 'NOPAT', formula: '(EBITDA − depreciation) less tax at the rate when positive, × the annualizing factor. EBITDA = net income + interest (6500) + depreciation and disposals (6400 / 6410).', value: `(${money(i.company.ebitda)} − ${money(i.company.depreciation)}) × (1 − tax) × ${i.factor.toFixed(1)} = ${money(v.company.nopatAnnual)}` },
    { key: 'ic', label: 'Invested capital', formula: 'Net fixed assets + inventory + operating working capital (cash on hand, card and supplier clearing, receivables, prepaids − payables − accrued) from the balance sheet at the month end. Bank cash and intercompany balances are left out. Store figures are before corporate overhead.', value: `${money(ic.fixed)} + ${money(ic.inventory)} + ${money(ic.workingCapital)} = ${money(ic.total)}` },
    { key: 'roic', label: 'ROIC and spread', formula: 'ROIC = NOPAT ÷ invested capital. Spread = ROIC − WACC; positive means value is created.', value: `${pct1(v.company.roic)} − ${pct1(v.wacc.wacc)} = ${v.company.spread === null ? '–' : pts(v.company.spread)}` },
    { key: 'fcf', label: 'Free cash flow', formula: 'Operating cash flow − capex (purchases of fixed assets) from the cash flow statement, annualized. Working-capital swings in a short history can flatter or hurt it.', value: `${money(i.cash.operating)} − ${money(-i.cash.capex)} = ${money(i.cash.fcf)} (${money(v.cash.fcfAnnual)} a year)` },
    { key: 'conv', label: 'Cash conversion', formula: 'Free cash flow ÷ EBITDA over the same months.', value: `${pct1(v.cash.conversion)} (gate ≥ ${s.cashConversionMinPct}%)`, setting: 'cashConversionMinPct' },
    { key: 'cushion', label: 'Reserve cushion', formula: 'Cash above the reserve target (Debt › Cash reserve) as a share of the target; below it the reserve is thin.', value: `≥ ${s.reserveCushionPct}%`, setting: 'reserveCushionPct' },
    { key: 'fund', label: 'Months to fund', formula: '(Equity needed − cash above the reserve) ÷ free cash flow a month, rounded up.', value: v.cash.monthsToFund === null ? 'Not at the current pace' : `${v.cash.monthsToFund} months` },
    { key: 'stores', label: 'Stores creating value', formula: 'Share of stores past their first year whose spread is positive.', value: `≥ ${s.valueStoreSharePct}%`, setting: 'valueStoreSharePct' },
    { key: 'dscr', label: 'DSCR after the new loan', formula: '(EBITDA + the deal pro forma’s year-1 EBITDA) ÷ (debt service + its year-1 debt service), as Expansion readiness.', value: `≥ ${v.capacity.dscrTarget.toFixed(2)}x${s.dscrAfterTarget === undefined ? ' (growth DSCR target)' : ''}`, setting: 'dscrAfterTarget' },
    { key: 'lev', label: 'Leverage after the deal', formula: '(Loans + the new loan) ÷ (EBITDA + the deal’s year-1 EBITDA).', value: `≤ ${v.capacity.leverageTarget.toFixed(2)}x${s.leverageAfterTarget === undefined ? ' (growth leverage target)' : ''}`, setting: 'leverageAfterTarget' },
    { key: 'ramp', label: 'Ramp', formula: 'The newest store’s latest month against its ramp targets (prorated by days with sales); the lower of gallons and inside.', value: `≥ ${s.rampMinPct}%`, setting: 'rampMinPct' },
    { key: 'scale', label: 'Scale', formula: 'Replicate gates held for N recorded months in a row, and after funding the next store, free cash flow funds the one after within M months.', value: `N = ${s.scaleMonths}, M = ${s.scaleFundMonths}`, setting: 'scaleMonths' },
    { key: 'scalefund', label: 'Scale funding window', formula: 'Months of free cash flow allowed to fund the store after next.', value: `${s.scaleFundMonths} months`, setting: 'scaleFundMonths' },
    { key: 'roles', label: 'Store roles', formula: `Watch: open under ${s.watchMonths} months. Fix: spread below zero (main lever = the biggest of fuel ¢/gal under the ${i.targets.fuelCpg}¢ scorecard target × gallons, labor % over the store target × sales, inside margin under ${i.targets.insideGmPct}% × inside sales). Grow: spread ≥ ${s.growSpreadPts} pts and gallons up ≥ ${s.growVolumePct}% on the month before. Harvest: the rest.`, value: `${s.growSpreadPts} pts / ${s.growVolumePct}%`, setting: 'growSpreadPts' },
    { key: 'growvol', label: 'Grow: volume rising', formula: 'Gallons up at least this much on the month before.', value: `${s.growVolumePct}%`, setting: 'growVolumePct' },
    { key: 'watch', label: 'Watch: months open', formula: 'A store open fewer months than this is judged on its ramp.', value: `${s.watchMonths} months`, setting: 'watchMonths' },
    { key: 'shock', label: 'Sensitivity', formula: 'Fuel margin moved by ±N¢ on every gallon, or gallons by ±M% at today’s margin; inside sales, costs, covenants and the reserve held. Flows straight to EBITDA, profit and free cash flow.', value: `±${s.shockCpg}¢, ±${s.shockGallonsPct}%`, setting: 'shockCpg' },
    { key: 'shockgal', label: 'Sensitivity: gallons', formula: 'The gallons shock, % either way.', value: `±${s.shockGallonsPct}%`, setting: 'shockGallonsPct' },
  ];
}

// ── Snapshots, change and inbox ──────────────────────────────────────────
export function compassChange(state: BooksState, live: Pick<Verdict, 'stage'> & { period: string }): { previous?: CompassRecord; changed: boolean; message: string } {
  const hist = [...compassOf(state).history].sort((a, b) => a.period.localeCompare(b.period));
  const previous = hist.filter((h) => h.period < live.period).at(-1);
  if (!previous) return { changed: false, message: 'No earlier month recorded to compare with.' };
  const changed = previous.stage !== live.stage;
  const dir = STAGE_ORDER.indexOf(live.stage) > STAGE_ORDER.indexOf(previous.stage) ? 'up' : 'down';
  return {
    previous, changed,
    message: changed ? `The growth compass moved ${dir} from ${STAGE_LABEL[previous.stage]} (${periodLabel(previous.period)}) to ${STAGE_LABEL[live.stage]} (${periodLabel(live.period)}).` : `${STAGE_LABEL[live.stage]} for ${periodLabel(live.period)}, as in ${periodLabel(previous.period)}.`,
  };
}

export interface CompassInboxItem { key: string; count: number; title: string; detail: string; to: string; action: string; review?: boolean }
export function compassInbox(state: BooksState, today: string, opts: { entries?: BasisEntry[] } = {}): CompassInboxItem[] {
  if (!state.compass) return [];
  const v = growthCompass(state, today, { entries: opts.entries });
  const ch = compassChange(state, { stage: v.stage, period: v.inputs.period });
  const recorded = compassOf(state).history.some((h) => h.period === v.inputs.period);
  return [
    { key: 'compass_stage', count: ch.changed ? 1 : 0, title: 'Growth compass stage changed', detail: ch.message, to: TO.compass, action: 'Review' },
    { key: 'compass_record', count: recorded ? 0 : 1, title: "Record this month's growth compass", detail: recorded ? `${periodLabel(v.inputs.period)} is recorded (${STAGE_LABEL[v.stage]}).` : `${periodLabel(v.inputs.period)} reads ${STAGE_LABEL[v.stage]} and is not yet in the history.`, to: TO.compass, action: 'Record', review: true },
  ];
}

/** The verdict as export rows: one section per panel. */
export function compassRows(v: Verdict): (string | number)[][] {
  const d = (c: number) => Math.round(c) / 100;
  return [
    ['Verdict', 'Stage', STAGE_LABEL[v.stage], v.sentence, ''],
    ['Verdict', 'ROIC − WACC', v.company.spread === null ? '' : Math.round(v.company.spread * 1000) / 10, `ROIC ${pct1(v.company.roic)}, WACC ${pct1(v.wacc.wacc)}`, ''],
    ...v.gates.map((g) => ['Gate', `${STAGE_LABEL[g.stage]} → ${g.label}`, g.status, g.value, g.target]),
    ...v.stores.map((s) => ['Store role', s.input.code, ROLE_LABEL[s.role], s.roleWhy, s.roic === null ? '' : Math.round(s.roic * 1000) / 10]),
    ...v.moves.map((m, i) => ['Move', `${i + 1}. ${m.title}`, m.value === null ? '' : d(m.value), m.why, m.valueKind]),
    ...v.triggers.map((t) => ['Trigger', `${t.label}: ${t.target}`, t.now, t.eta, t.etaDate ?? '']),
    ...assumptions(v).map((a) => ['Assumption', a.label, a.value, a.formula, '']),
  ];
}

// ── Writers ──────────────────────────────────────────────────────────────
export function validateCompassSettings(s: CompassSettings): string[] {
  const e: string[] = [];
  const pctOk = (v: number, max = 100) => Number.isFinite(v) && v >= 0 && v <= max;
  if (!Number.isFinite(s.costOfEquityBps) || s.costOfEquityBps <= 0 || s.costOfEquityBps > 10_000) e.push('Cost of equity must be a rate above 0% and at most 100%.');
  if (s.taxRateBps !== undefined && (!Number.isFinite(s.taxRateBps) || s.taxRateBps < 0 || s.taxRateBps >= 10_000)) e.push('Tax rate must be between 0% and 99.99%, or blank to use the owner rate.');
  if (s.basis !== undefined && !['booked', 'accrual', 'cash'].includes(s.basis)) e.push('Basis must be booked, cash or accrual.');
  if (!pctOk(s.cashConversionMinPct, 1000)) e.push('Cash conversion must be a percentage of 0 or more.');
  if (!pctOk(s.reserveCushionPct, 1000)) e.push('Reserve cushion must be a percentage of 0 or more.');
  if (!pctOk(s.valueStoreSharePct)) e.push('The share of stores creating value must be between 0% and 100%.');
  if (!pctOk(s.rampMinPct, 1000)) e.push('Ramp must be a percentage of 0 or more.');
  if (s.dscrAfterTarget !== undefined && (!Number.isFinite(s.dscrAfterTarget) || s.dscrAfterTarget <= 0)) e.push('DSCR after the new loan must be above 0x, or blank to use the growth target.');
  if (s.leverageAfterTarget !== undefined && (!Number.isFinite(s.leverageAfterTarget) || s.leverageAfterTarget <= 0)) e.push('Leverage after the deal must be above 0x, or blank to use the growth target.');
  for (const [k, label] of [['scaleMonths', 'Months the gates must hold'], ['scaleFundMonths', 'Months to fund the store after next'], ['watchMonths', 'Months a store is on watch']] as const) if (!Number.isInteger(s[k]) || s[k] < 1 || s[k] > 120) e.push(`${label} must be a whole number from 1 to 120.`);
  if (!Number.isFinite(s.growSpreadPts) || s.growSpreadPts < 0) e.push('The Grow spread must be 0 points or more.');
  if (!Number.isFinite(s.growVolumePct)) e.push('The Grow volume change must be a number.');
  if (!Number.isFinite(s.shockCpg) || s.shockCpg <= 0 || s.shockCpg > 50) e.push('The fuel margin shock must be above 0¢ and at most 50¢.');
  if (!Number.isFinite(s.shockGallonsPct) || s.shockGallonsPct <= 0 || s.shockGallonsPct > 90) e.push('The gallons shock must be above 0% and at most 90%.');
  return e;
}

export function saveCompassSettings(books: Books, actor: User, patch: Partial<CompassSettings>): CompassSettings {
  books.require(actor, 'growth.edit', 'change the growth compass assumptions');
  const c = ensureCompass(books);
  const next = { ...c.settings, ...patch };
  for (const k of Object.keys(patch) as (keyof CompassSettings)[]) if (patch[k] === undefined) delete next[k];
  const errs = validateCompassSettings(next);
  if (errs.length) throw new ValidationError(errs);
  const before = structuredClone(c.settings);
  c.settings = next;
  books.audit(actor, { action: 'update compass settings', objectType: 'growth', objectId: 'compass', summary: `Growth compass assumptions: ${Object.keys(patch).join(', ')}`, before: before as never, after: next as never });
  books.changed();
  return next;
}

/** Record the month's verdict (one row a month; recording again replaces it). */
export function recordCompass(books: Books, actor: User, asOf: string, opts: { entries?: BasisEntry[] } = {}): CompassRecord {
  books.require(actor, 'growth.edit', 'record the growth compass');
  const v = growthCompass(books.state, asOf, { entries: opts.entries });
  const c = ensureCompass(books);
  const rec: CompassRecord = {
    period: v.inputs.period, stage: v.stage, gates: Object.fromEntries(v.gates.map((g) => [g.key, g.status === 'pass'])), replicateReady: v.replicateReady,
    roicPct: v.company.roic === null ? null : Math.round(v.company.roic * 10_000) / 100, waccPct: Math.round(v.wacc.wacc * 10_000) / 100, at: books.clock(), by: actor.id,
  };
  const i = c.history.findIndex((h) => h.period === rec.period);
  const before = i >= 0 ? structuredClone(c.history[i]) : undefined;
  if (i >= 0) c.history[i] = rec; else c.history.push(rec);
  books.audit(actor, { action: `${before ? 'update' : 'create'} compass record`, objectType: 'growth', objectId: `compass:${rec.period}`, summary: `Growth compass ${periodLabel(rec.period)}: ${STAGE_LABEL[rec.stage]}`, before: before as never, after: rec as never });
  books.changed();
  return rec;
}

