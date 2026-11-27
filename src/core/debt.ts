/**
 * Phase 12 — debt, treasury & capital structure. Built on the Phase 9 loans (`loans.ts`): this module reads
 * their schedules and the ledger, and never posts. Everything here is a pure function over BooksState except the
 * settings / covenant / rate / value / scenario / alternative / related-party writers at the bottom.
 *
 * The functions Phase 13 (growth & owners) reads:
 *   covenantMetrics / headlineMetrics — EBITDA, debt service, DSCR, leverage, FCC, liquidity by month (TTM or annualized)
 *   dscrWithNewDebt — DSCR after adding an annual debt service (a new store loan)
 *   reserveTarget / deployableCash / reserveHistory — the cash reserve policy and the cash above it
 *   paydownPlan — ranked uses of deployable cash and months to fund the next store
 */
import type { Books } from './books';
import { ValidationError } from './books';
import type {
  BooksState, Covenant, CovenantKind, DebtSettings, DebtState, ID, InvestAlternative, Loan, MarketRate, PropertyValue, RefiScenario,
  RelatedPartyAck, RelatedPartyTerms, ReportBasis, User,
} from './types';
import { formatMoney, type Cents } from './money';
import { addDays, daysBetween, isValidDate, lastDayOfPeriod, periodOf, periodsBetween } from './dates';
import { amortization, levelPayment, loanAccountTie, loanStatus, loansOf, LOAN_KIND_LABEL, type AmortRow, type LoanStatus } from './loans';
import { basisEntries, statement, firstDay, type BasisEntry } from './statements';
import { forecast } from './forecast';
import { liveInvoices } from './fuel';
import { payWeeks, storeWeeks, weekIndex } from './payroll';

// ── State ────────────────────────────────────────────────────────────────
export const DEFAULT_DEBT_SETTINGS: DebtSettings = {
  ratioBasis: 'booked', ttmMonths: 12, annualize: true, includeCurrentMonth: false,
  taxRateBps: 2_500, costOfCapitalBps: 900, afrBps: 400, nearPct: 15, horizonDays: 182, dscrTarget: 125,
  refiGapBps: 75, refiBreakEvenMonths: 36, refiFeeBps: 100, ltvTargetPct: 70, maturityMonths: 12,
  nextStoreEquity: 25_000_000,
  reserve: { weeksFixed: 4, lookbackMonths: 3, fuelLoad: true, payroll: true, cushion: 0, cashSubtypes: ['bank', 'cash', 'clearing'] },
};

export function emptyDebt(): DebtState {
  return { settings: structuredClone(DEFAULT_DEBT_SETTINGS), covenants: [], marketRates: [], propertyValues: [], scenarios: [], alternatives: [], rpTerms: [], rpAcks: [] };
}

/** Books saved before phase 12 have no debt slice: read it as empty with default settings. */
export function debtOf(state: BooksState): DebtState {
  const d = state.debt;
  if (!d) return emptyDebt();
  return { ...emptyDebt(), ...d, settings: { ...DEFAULT_DEBT_SETTINGS, ...d.settings, reserve: { ...DEFAULT_DEBT_SETTINGS.reserve, ...(d.settings?.reserve ?? {}) } } };
}

export function ensureDebt(books: Books): DebtState {
  if (!books.state.debt) books.state.debt = emptyDebt();
  const d = books.state.debt;
  for (const k of ['covenants', 'marketRates', 'propertyValues', 'scenarios', 'alternatives', 'rpTerms', 'rpAcks'] as const) if (!d[k]) (d as unknown as Record<string, unknown[]>)[k] = [];
  d.settings = { ...DEFAULT_DEBT_SETTINGS, ...(d.settings ?? {}), reserve: { ...DEFAULT_DEBT_SETTINGS.reserve, ...(d.settings?.reserve ?? {}) } };
  return d;
}

export const COVENANT_LABEL: Record<CovenantKind, string> = {
  dscr: 'Debt service coverage (DSCR)', leverage: 'Leverage (debt ÷ EBITDA)', min_liquidity: 'Minimum liquidity', fcc: 'Fixed-charge coverage',
};
export const INTEREST_ACCT = 'acct_interest';
export const RENT_ACCT = 'acct_rent';
const DA_ACCTS: ID[] = ['acct_depreciation', 'acct_disposal'];

const round2 = (n: number) => Math.round(n * 100) / 100;
export const bpsPct = (bps: number, d = 2) => (bps / 100).toFixed(d) + '%';
export const ratioX = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '–' : !Number.isFinite(v) ? '∞' : v.toFixed(d) + 'x');

function addMonthsP(period: string, n: number): string {
  let [y, m] = period.split('-').map(Number);
  m += n;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.slice(0, 7).split('-').map(Number);
  const [yb, mb] = b.slice(0, 7).split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma) - (Number(b.slice(8, 10) || 1) < Number(a.slice(8, 10) || 1) ? 1 : 0);
}

/** The first month of activity in these books (opening entries left out). */
export function firstBooksPeriod(state: BooksState): string | null {
  let d: string | null = null;
  for (const t of state.transactions) if (!t.deleted && t.kind !== 'opening' && (!d || t.date < d)) d = t.date;
  return d ? periodOf(d) : null;
}

/** Balances (natural sign) of several accounts at the end of a date, in one pass over the ledger. */
export function balancesAt(state: BooksState, accountIds: ID[], date: string): Map<ID, Cents> {
  const want = new Set(accountIds);
  const sign = new Map(state.accounts.map((a) => [a.id, a.type === 'asset' || a.type === 'expense' || a.type === 'cogs' ? 1 : -1]));
  const m = new Map<ID, Cents>(accountIds.map((id) => [id, 0]));
  for (const t of state.transactions) {
    if (t.deleted || t.date > date) continue;
    for (const l of t.lines) if (want.has(l.accountId)) m.set(l.accountId, m.get(l.accountId)! + (sign.get(l.accountId) ?? 1) * (l.debit - l.credit));
  }
  return m;
}

const accountsOfSubtype = (state: BooksState, subs: string[]) => state.accounts.filter((a) => a.type === 'asset' && subs.includes(a.subtype)).map((a) => a.id);
/** Liquidity for the covenants = the bank accounts (the operating account in the demo). */
export function liquidityAt(state: BooksState, date: string): Cents {
  return [...balancesAt(state, accountsOfSubtype(state, ['bank']), date).values()].reduce((a, b) => a + b, 0);
}
/** Funded debt on the books: the loan liability accounts (2300, 2310, 2320). */
export function bookDebtAt(state: BooksState, date: string): Cents {
  return [...balancesAt(state, state.accounts.filter((a) => a.subtype === 'loan').map((a) => a.id), date).values()].reduce((a, b) => a + b, 0);
}

// ── Debt dashboard ───────────────────────────────────────────────────────
export interface DebtRow {
  loan: Loan;
  status: LoanStatus;
  heldBy: Loan['heldBy'];
  /** Who carries it, for related-party-held loans. */
  carriedBy?: string;
  balance: Cents;
  rateBps: number;
  afterTaxBps: number;
  /** The next scheduled payment (interest only for a line of credit). */
  payment: Cents;
  nextDue?: string;
  maturity: string;
  balloon?: AmortRow;
  /** Interest expense on the ledger (6500) from this loan's posted payments; null when it isn't on our books. */
  interestToDate: Cents | null;
  /** Projected interest from the schedule: the next 12 months, and the rest of the life. */
  projected12: Cents;
  projectedLife: Cents;
  covenants: Covenant[];
  /** Current LTV for a mortgage with a property value. */
  ltv: number | null;
}

export interface LadderBucket { label: string; from: string; to: string; amortization: Cents; maturities: Cents; total: Cents; loans: string[] }
export interface DebtDashboard {
  asOf: string;
  rows: DebtRow[];
  company: DebtRow[];
  related: DebtRow[];
  companyDebt: Cents;
  relatedCarried: Cents;
  /** Weighted-average cost of debt (balance-weighted rate), company debt; and including related-party-carried mortgages. */
  wacdBps: number | null;
  wacdAllBps: number | null;
  afterTaxWacdBps: number | null;
  ladder: LadderBucket[];
  /** 6500 on the ledger through asOf, and the part attributed to loan payments. */
  interestLedger: Cents;
  interestAttributed: Cents;
  accountTie: ReturnType<typeof loanAccountTie>;
  /** Σ schedule balances of company loans = Σ loan accounts in the ledger. */
  ties: boolean;
}

function interestPosted(state: BooksState, loan: Loan, asOf: string): Cents {
  const ids = new Set(Object.values(loan.payments).map((p) => p.txnId));
  let n = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf || !ids.has(t.id)) continue;
    for (const l of t.lines) if (l.accountId === loan.interestAccountId) n += l.debit - l.credit;
  }
  return n;
}

export function interestOnLedger(state: BooksState, asOf: string, from?: string): Cents {
  let n = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf || (from && t.date < from)) continue;
    for (const l of t.lines) if (l.accountId === INTEREST_ACCT) n += l.debit - l.credit;
  }
  return n;
}

/** The latest property value for a store on or before a date, and the one before it. */
export function propertyValues(state: BooksState, storeId: ID, asOf: string): { latest?: PropertyValue; prior?: PropertyValue } {
  const vs = debtOf(state).propertyValues.filter((v) => v.storeId === storeId && v.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
  return { latest: vs.at(-1), prior: vs.at(-2) };
}

export function weighted(rows: { balance: Cents; rateBps: number }[]): number | null {
  const tot = rows.reduce((a, r) => a + r.balance, 0);
  if (tot <= 0) return null;
  return rows.reduce((a, r) => a + r.balance * r.rateBps, 0) / tot;
}

/**
 * The maturity ladder: principal coming due by year from the schedules (amortization within the year, plus the
 * balance due at maturity or a balloon). Lines of credit assume today's balance is due at maturity. Buckets add to
 * the balances.
 */
export function maturityLadder(rows: Pick<DebtRow, 'status' | 'loan'>[], asOf: string, years = 5): LadderBucket[] {
  const buckets: LadderBucket[] = [];
  for (let i = 0; i < years; i++) {
    const from = i === 0 ? addDays(asOf, 1) : addDays(asOf, 1 + 365 * i);
    const to = addDays(asOf, 365 * (i + 1));
    buckets.push({ label: i === 0 ? 'Within 12 months' : `${i}–${i + 1} years`, from, to, amortization: 0, maturities: 0, total: 0, loans: [] });
  }
  buckets.push({ label: `Over ${years} years`, from: addDays(asOf, 365 * years + 1), to: '9999-12-31', amortization: 0, maturities: 0, total: 0, loans: [] });
  for (const { status, loan } of rows) {
    const rem = status.rows.filter((r) => r.date > asOf);
    rem.forEach((r, i) => {
      const b = buckets.find((x) => r.date >= x.from && r.date <= x.to)!;
      const last = i === rem.length - 1;
      if (last) { b.maturities += r.principal; if (r.principal && !b.loans.includes(loan.name)) b.loans.push(loan.name); } else b.amortization += r.principal;
    });
  }
  for (const b of buckets) b.total = b.amortization + b.maturities;
  return buckets;
}

export function debtDashboard(state: BooksState, asOf: string, visible?: Set<ID>): DebtDashboard {
  const d = debtOf(state);
  const tax = d.settings.taxRateBps / 10000;
  const loans = loansOf(state).filter((l) => !visible || visible.has(l.storeId));
  const rows: DebtRow[] = loans.map((loan) => {
    const status = loanStatus(state, loan, asOf);
    const rem = status.rows.filter((r) => r.date > asOf);
    const yr = addDays(asOf, 365);
    const balance = status.scheduleBalance;
    const pv = loan.kind === 'mortgage' ? propertyValues(state, loan.storeId, asOf).latest : undefined;
    return {
      loan, status, heldBy: loan.heldBy, carriedBy: loan.heldBy === 'related_party' ? state.parties.find((p) => p.id === loan.holderPartyId)?.name : undefined,
      balance, rateBps: loan.rateBps, afterTaxBps: Math.round(loan.rateBps * (1 - tax)), payment: status.next?.payment ?? 0, nextDue: status.next?.date, maturity: loan.maturity,
      balloon: rem.find((r) => r.balloon),
      interestToDate: loan.heldBy === 'company' ? interestPosted(state, loan, asOf) : null,
      projected12: rem.filter((r) => r.date <= yr).reduce((a, r) => a + r.interest, 0), projectedLife: rem.reduce((a, r) => a + r.interest, 0),
      covenants: d.covenants.filter((c) => c.loanId === loan.id && c.active), ltv: pv && pv.value > 0 ? balance / pv.value : null,
    };
  });
  const company = rows.filter((r) => r.heldBy === 'company');
  const related = rows.filter((r) => r.heldBy === 'related_party');
  const wacd = weighted(company);
  const accountTie = loanAccountTie(state, asOf);
  const companyDebt = company.reduce((a, r) => a + r.balance, 0);
  return {
    asOf, rows, company, related, companyDebt, relatedCarried: related.reduce((a, r) => a + r.balance, 0),
    wacdBps: wacd, wacdAllBps: weighted(rows), afterTaxWacdBps: wacd === null ? null : wacd * (1 - tax),
    ladder: maturityLadder(company, asOf), interestLedger: interestOnLedger(state, asOf), interestAttributed: company.reduce((a, r) => a + (r.interestToDate ?? 0), 0),
    accountTie, ties: accountTie.every((t) => t.ledger === t.loans) && companyDebt === accountTie.reduce((a, t) => a + t.ledger, 0),
  };
}

// ── Covenant metrics (monthly, TTM or annualized) ────────────────────────
export interface MonthMetrics {
  period: string;
  /** First month of the trailing window. */
  from: string;
  months: number;
  /** Scale to a year: 12 ÷ months when annualizing a short history, else 1 (or 12 ÷ ttm). */
  factor: number;
  annualized: boolean;
  /** The month is still in progress. */
  provisional: boolean;
  /** The date balances are read at: the month end, or asOf for the month in progress. */
  date: string;
  basis: ReportBasis;
  netIncome: Cents;
  interest: Cents;
  depreciation: Cents;
  rent: Cents;
  ebitda: Cents;
  /** Scheduled principal + interest on company loans in the window (balloon principal left out). */
  principal: Cents;
  scheduledInterest: Cents;
  debtService: Cents;
  /** Payments on mortgages carried by related parties (reimbursed through rent) in the window. */
  relatedDebtService: Cents;
  ebitdaAnnual: Cents;
  debtServiceAnnual: Cents;
  debt: Cents;
  liquidity: Cents;
  dscr: number | null;
  leverage: number | null;
  /** (EBITDA + rent) ÷ (debt service + rent). */
  fcc: number | null;
  /** (EBITDA + rent) ÷ (debt service + related-party mortgage payments): the whole group's coverage. */
  globalDscr: number | null;
}

function rowsIn(loans: Loan[], from: string, to: string): AmortRow[] {
  return loans.flatMap((l) => amortization(l).filter((r) => r.date >= from && r.date <= to));
}
const service = (rows: AmortRow[]) => ({ principal: rows.reduce((a, r) => a + (r.balloon ? 0 : r.principal), 0), interest: rows.reduce((a, r) => a + r.interest, 0) });
const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** EBITDA and the coverage ratios for one trailing window ending in `period`. */
export function windowMetrics(state: BooksState, period: string, asOf: string, opts: { entries?: BasisEntry[]; settings?: DebtSettings; first?: string } = {}): MonthMetrics {
  const s = opts.settings ?? debtOf(state).settings;
  const first = opts.first ?? firstBooksPeriod(state) ?? period;
  let from = addMonthsP(period, -(s.ttmMonths - 1));
  if (from < first) from = first;
  const months = periodsBetween(from, period).length;
  const factor = s.annualize ? 12 / months : 1;
  const annualized = factor !== 1;
  const st = statement(state, { basis: s.ratioBasis, from, to: period, storeIds: state.stores.map((x) => x.id), entries: opts.entries });
  const row = (ids: ID[]) => st.rows.filter((r) => ids.includes(r.account.id)).reduce((a, r) => a + r.total, 0);
  const interest = row([INTEREST_ACCT]);
  const depreciation = row(DA_ACCTS);
  const rent = row([RENT_ACCT]);
  const netIncome = st.netIncome.total;
  const ebitda = netIncome + interest + depreciation;
  const d0 = firstDay(from), d1 = lastDayOfPeriod(period);
  const loans = loansOf(state);
  const co = service(rowsIn(loans.filter((l) => l.heldBy === 'company'), d0, d1));
  const rp = service(rowsIn(loans.filter((l) => l.heldBy === 'related_party'), d0, d1));
  const debtService = co.principal + co.interest;
  const relatedDebtService = rp.principal + rp.interest;
  const date = d1 < asOf ? d1 : asOf;
  const ebitdaAnnual = Math.round(ebitda * factor);
  const debt = bookDebtAt(state, date);
  return {
    period, from, months, factor, annualized, provisional: asOf < d1, date, basis: s.ratioBasis, netIncome, interest, depreciation, rent, ebitda,
    principal: co.principal, scheduledInterest: co.interest, debtService, relatedDebtService, ebitdaAnnual, debtServiceAnnual: Math.round(debtService * factor),
    debt, liquidity: liquidityAt(state, date),
    dscr: ratio(ebitda, debtService), leverage: ebitdaAnnual > 0 ? debt / ebitdaAnnual : debt > 0 ? Infinity : 0,
    fcc: ratio(ebitda + rent, debtService + rent), globalDscr: ratio(ebitda + rent, debtService + relatedDebtService),
  };
}

/** Every month in the books through asOf's month, each with its trailing window. */
export function covenantMetrics(state: BooksState, asOf: string, opts: { entries?: BasisEntry[]; settings?: DebtSettings } = {}): MonthMetrics[] {
  const first = firstBooksPeriod(state);
  if (!first) return [];
  const entries = opts.entries ?? basisEntries(state);
  return periodsBetween(first, periodOf(asOf)).map((p) => windowMetrics(state, p, asOf, { entries, settings: opts.settings, first }));
}

/** The month the covenants are reported on: the latest complete month (or the month in progress when the settings say so). */
export function headlineMetrics(metrics: MonthMetrics[], settings: DebtSettings): MonthMetrics | undefined {
  const use = settings.includeCurrentMonth ? metrics : metrics.filter((m) => !m.provisional);
  return use.at(-1) ?? metrics.at(-1);
}

/** DSCR once a new annual debt service is added (e.g. a new store's loan), optionally with the EBITDA it brings. */
export function dscrWithNewDebt(m: Pick<MonthMetrics, 'ebitdaAnnual' | 'debtServiceAnnual'>, addedDebtServiceAnnual: Cents, addedEbitdaAnnual: Cents = 0): number | null {
  return ratio(m.ebitdaAnnual + addedEbitdaAnnual, m.debtServiceAnnual + addedDebtServiceAnnual);
}

// ── Covenant tests, headroom and breach forecast ─────────────────────────
export type CovenantStatus = 'ok' | 'near' | 'breach' | 'na';
export interface BreachForecast {
  /** First date the forecast or trend falls through the covenant (null: not within 24 months). */
  date: string | null;
  method: 'forecast' | 'trend' | 'now' | null;
  /** Within the horizon (2 quarters by default). */
  within: boolean;
  /** The projected value at the breach. */
  value?: number;
  /** The lowest the 13-week forecast goes (liquidity). */
  low?: { date: string; amount: Cents };
}
export interface CovenantTest {
  covenant: Covenant;
  loan?: Loan;
  /** The threshold in the metric's units: a ratio (1.25) or cents. */
  limit: number;
  actual: number | null;
  pass: boolean | null;
  /** Same units as actual (ratio points or cents); + is room to spare. */
  headroom: number | null;
  headroomPct: number | null;
  status: CovenantStatus;
  period?: string;
  series: { period: string; value: number | null; provisional: boolean }[];
  forecast: BreachForecast;
}

export const covLimit = (c: Pick<Covenant, 'kind' | 'threshold'>) => (c.kind === 'min_liquidity' ? c.threshold : c.threshold / 100);
export function metricOf(m: MonthMetrics, kind: CovenantKind): number | null {
  return kind === 'dscr' ? m.dscr : kind === 'fcc' ? m.fcc : kind === 'leverage' ? m.leverage : m.liquidity;
}
const passes = (kind: CovenantKind, v: number, limit: number) => (kind === 'leverage' ? v <= limit : v >= limit);
export const formatCovenant = (c: Pick<Covenant, 'kind' | 'threshold'>) => (c.kind === 'min_liquidity' ? `≥ ${formatMoney(c.threshold, { dollarSign: true, whole: true })}` : c.kind === 'leverage' ? `≤ ${(c.threshold / 100).toFixed(2)}x` : `≥ ${(c.threshold / 100).toFixed(2)}x`);
export function formatMetric(kind: CovenantKind, v: number | null): string {
  if (v === null) return '–';
  return kind === 'min_liquidity' ? formatMoney(Math.round(v), { dollarSign: true, whole: true }) : ratioX(v);
}

/** A trend needs at least this many complete months; fewer gives no ratio forecast (two points are noise). */
export const TREND_MIN_MONTHS = 3;

/** Least-squares line through (0, y0), (1, y1), …: slope per step and the fitted value at the last point. */
export function trendLine(ys: number[], min = TREND_MIN_MONTHS): { slope: number; last: number } | null {
  const pts = ys.filter((y) => Number.isFinite(y));
  if (pts.length < Math.max(2, min)) return null;
  const n = pts.length;
  const mx = (n - 1) / 2;
  const my = pts.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  pts.forEach((y, x) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; });
  const slope = sxy / sxx;
  return { slope, last: my + slope * (n - 1 - mx) };
}

/**
 * When does the covenant break? Liquidity: the first day the 13-week cash forecast falls below the minimum, then
 * the month-end trend beyond the 13 weeks. Ratios: the straight-line trend of the monthly series, month end by month
 * end. Looks up to 24 months ahead; `within` says whether it falls inside the horizon.
 */
export function breachForecast(state: BooksState, c: Covenant, series: { period: string; value: number | null }[], asOf: string, settings: DebtSettings): BreachForecast {
  const limit = covLimit(c);
  const horizonEnd = addDays(asOf, settings.horizonDays);
  const latest = [...series].reverse().find((s) => s.value !== null);
  if (latest && latest.value !== null && !passes(c.kind, latest.value, limit)) return { date: lastDayOfPeriod(latest.period) < asOf ? lastDayOfPeriod(latest.period) : asOf, method: 'now', within: true, value: latest.value };
  if (c.kind === 'min_liquidity') {
    const banks = accountsOfSubtype(state, ['bank']);
    const fcs = banks.map((id) => forecast(state, id, asOf));
    const at = (n: number) => fcs.reduce((a, f) => a + f.at(n), 0);
    let low = { date: asOf, amount: at(0) };
    for (let n = 1; n <= 91; n++) {
      const v = at(n);
      if (v < low.amount) low = { date: addDays(asOf, n), amount: v };
      if (v < limit) {
        const date = addDays(asOf, n);
        return { date, method: 'forecast', within: date <= horizonEnd, value: v, low };
      }
    }
    const tr = trendLine(series.map((s) => s.value ?? NaN));
    if (tr && tr.slope < 0) {
      const perDay = tr.slope / 30.4;
      const start = at(91);
      const days = Math.ceil((start - limit) / -perDay);
      if (days <= 730) { const date = addDays(asOf, 91 + days); return { date, method: 'trend', within: date <= horizonEnd, value: limit, low }; }
    }
    return { date: null, method: null, within: false, low };
  }
  const tr = trendLine(series.map((s) => (s.value === null || !Number.isFinite(s.value) ? NaN : s.value)));
  const lastPeriod = series.filter((s) => s.value !== null).at(-1)?.period;
  if (!tr || !lastPeriod) return { date: null, method: null, within: false };
  for (let k = 1; k <= 24; k++) {
    const v = tr.last + tr.slope * k;
    if (!passes(c.kind, v, limit)) {
      const date = lastDayOfPeriod(addMonthsP(lastPeriod, k));
      return { date, method: 'trend', within: date <= horizonEnd, value: round2(v) };
    }
  }
  return { date: null, method: null, within: false };
}

export function testCovenant(state: BooksState, c: Covenant, metrics: MonthMetrics[], asOf: string, settings = debtOf(state).settings): CovenantTest {
  const limit = covLimit(c);
  const used = settings.includeCurrentMonth ? metrics : metrics.filter((m) => !m.provisional);
  // Liquidity is "at all times": read it today. The ratios are read on the headline month.
  const head = c.kind === 'min_liquidity' ? metrics.at(-1) : headlineMetrics(metrics, settings);
  const actual = head ? metricOf(head, c.kind) : null;
  const series = metrics.map((m) => ({ period: m.period, value: metricOf(m, c.kind), provisional: m.provisional }));
  let headroom: number | null = null, headroomPct: number | null = null, pass: boolean | null = null;
  let status: CovenantStatus = 'na';
  if (actual !== null) {
    pass = passes(c.kind, actual, limit);
    headroom = c.kind === 'leverage' ? limit - actual : actual - limit;
    headroomPct = limit ? headroom / limit : null;
    status = !pass ? 'breach' : headroomPct !== null && headroomPct < settings.nearPct / 100 ? 'near' : 'ok';
  }
  const fc = breachForecast(state, c, (c.kind === 'min_liquidity' ? metrics : used).map((m) => ({ period: m.period, value: metricOf(m, c.kind) })), asOf, settings);
  // Passing today but forecast to break inside the horizon: near.
  if (status === 'ok' && fc.within && fc.date) status = 'near';
  return { covenant: c, loan: loansOf(state).find((l) => l.id === c.loanId), limit, actual, pass, headroom, headroomPct, status, period: head?.period, series, forecast: fc };
}

export interface CovenantMonitor {
  asOf: string;
  metrics: MonthMetrics[];
  headline?: MonthMetrics;
  tests: CovenantTest[];
  settings: DebtSettings;
  /** EBITDA re-derived from the P&L rows (net income + 6500 + 6400/6410) = the metric; scheduled interest = 6500 on the P&L. */
  ties: { ebitda: boolean; interest: boolean; debt: boolean };
}

export function covenantMonitor(state: BooksState, asOf: string, opts: { entries?: BasisEntry[] } = {}): CovenantMonitor {
  const d = debtOf(state);
  const entries = opts.entries ?? basisEntries(state);
  const metrics = covenantMetrics(state, asOf, { entries, settings: d.settings });
  const headline = headlineMetrics(metrics, d.settings);
  const tests = d.covenants.filter((c) => c.active).map((c) => testCovenant(state, c, metrics, asOf, d.settings));
  let ties = { ebitda: true, interest: true, debt: true };
  if (headline) {
    const st = statement(state, { basis: d.settings.ratioBasis, from: headline.from, to: headline.period, storeIds: state.stores.map((s) => s.id), entries });
    const add = st.rows.filter((r) => r.account.id === INTEREST_ACCT || DA_ACCTS.includes(r.account.id)).reduce((a, r) => a + r.total, 0);
    const interestBooked = interestOnLedger(state, lastDayOfPeriod(headline.period), firstDay(headline.from));
    ties = { ebitda: st.difference === 0 && st.netIncome.total + add === headline.ebitda, interest: interestBooked === headline.scheduledInterest, debt: headline.debt === loanAccountTie(state, headline.date).reduce((a, t) => a + t.loans, 0) };
  }
  return { asOf, metrics, headline, tests, settings: d.settings, ties };
}

// ── Refinance analyzer ───────────────────────────────────────────────────
export interface ProjRow { n: number; payment: Cents; interest: Cents; principal: Cents; closing: Cents; balloon: boolean }

/** A new loan's schedule: 30/360 monthly interest, a level payment over the amortization, the rest due at the end of the term. */
export function projectSchedule(principal: Cents, rateBps: number, termMonths: number, amortizationMonths: number): ProjRow[] {
  const r = rateBps / 10000 / 12;
  const pay = amortizationMonths > 0 ? levelPayment(principal, rateBps, amortizationMonths) : 0;
  const out: ProjRow[] = [];
  let bal = principal;
  for (let n = 1; n <= termMonths && bal > 0; n++) {
    const interest = Math.round(bal * r);
    let payment = amortizationMonths > 0 ? pay : interest;
    const last = n === termMonths;
    if (last || payment >= bal + interest) payment = bal + interest;
    const principalPart = payment - interest;
    out.push({ n, payment, interest, principal: principalPart, closing: bal - principalPart, balloon: last && payment > (amortizationMonths > 0 ? pay : interest) });
    bal -= principalPart;
  }
  return out;
}

export interface RefiProposal { rateBps: number; termMonths: number; amortizationMonths: number; fees: Cents; prepaymentPenalty: Cents; cashOut: Cents; rollInCosts: boolean }
export interface CurrentDebt { balance: Cents; payment: Cents; rows: { payment: Cents; interest: Cents }[] }
export interface RefiMath {
  balance: Cents;
  currentPayment: Cents;
  newPrincipal: Cents;
  newPayment: Cents;
  /** new − current: negative is a saving. */
  paymentChange: Cents;
  currentInterest: Cents;
  newInterest: Cents;
  interestSaved: Cents;
  /** Interest saved over the months both loans run (comparable when the new term is longer or shorter). */
  interestSavedSameMonths: Cents;
  sameMonths: number;
  /** Fees + prepayment penalty (the cost of refinancing). */
  costs: Cents;
  /** What we pay in cash at closing (zero when costs are rolled in). */
  upfront: Cents;
  breakEvenMonths: number | null;
  /** PV(current payments) − PV(new payments) + cash out − upfront costs, at the cost of capital. */
  npv: Cents;
  cashFreedMonthly: Cents;
  /** 12 × the monthly saving + cash out − upfront costs. */
  cashFreedFirstYear: Cents;
  newRows: ProjRow[];
}

export function pv(payments: Cents[], annualBps: number): number {
  const k = annualBps / 10000 / 12;
  return payments.reduce((a, p, i) => a + p / Math.pow(1 + k, i + 1), 0);
}

/** The refinance math on its own: current remaining payments vs the proposed loan. */
export function analyzeRefi(cur: CurrentDebt, p: RefiProposal, costOfCapitalBps: number): RefiMath {
  const costs = p.fees + p.prepaymentPenalty;
  const newPrincipal = cur.balance + p.cashOut + (p.rollInCosts ? costs : 0);
  const newRows = projectSchedule(newPrincipal, p.rateBps, p.termMonths, p.amortizationMonths);
  const newPayment = newRows[0]?.payment ?? 0;
  const upfront = p.rollInCosts ? 0 : costs;
  const saving = cur.payment - newPayment;
  const currentInterest = cur.rows.reduce((a, r) => a + r.interest, 0);
  const newInterest = newRows.reduce((a, r) => a + r.interest, 0);
  const sameMonths = Math.min(cur.rows.length, newRows.length);
  const sumI = (rs: { interest: Cents }[]) => rs.slice(0, sameMonths).reduce((a, r) => a + r.interest, 0);
  const npv = Math.round(pv(cur.rows.map((r) => r.payment), costOfCapitalBps) - pv(newRows.map((r) => r.payment), costOfCapitalBps) + p.cashOut - upfront);
  return {
    balance: cur.balance, currentPayment: cur.payment, newPrincipal, newPayment, paymentChange: newPayment - cur.payment, currentInterest, newInterest,
    interestSaved: currentInterest - newInterest, interestSavedSameMonths: sumI(cur.rows) - sumI(newRows), sameMonths, costs, upfront, breakEvenMonths: saving > 0 ? Math.ceil(costs / saving) : null, npv,
    cashFreedMonthly: saving, cashFreedFirstYear: saving * 12 + p.cashOut - upfront, newRows,
  };
}

/** The current loan as the analyzer sees it: balance today and its remaining scheduled payments. */
export function currentDebt(state: BooksState, loan: Loan, asOf: string): CurrentDebt & { remaining: AmortRow[]; status: LoanStatus } {
  const status = loanStatus(state, loan, asOf);
  const remaining = status.rows.filter((r) => r.date > asOf);
  return { balance: status.scheduleBalance, payment: remaining[0]?.payment ?? 0, rows: remaining, remaining, status };
}

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
/**
 * The prepayment penalty a payoff today would cost, read from the loan's wording: "2% … in the first three years",
 * "Step-down 3/2/1% in years 1–3", or "None". A best reading to prefill the analyzer; check it against the note.
 */
export function suggestedPenalty(loan: Pick<Loan, 'prepaymentPenalty' | 'start'>, balance: Cents, asOf: string): Cents {
  const t = loan.prepaymentPenalty ?? '';
  if (!t.trim() || /^none/i.test(t.trim())) return 0;
  const m = t.match(/(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)*)\s*%/);
  if (!m) return 0;
  const steps = m[1].split('/').map((x) => Number(x.trim()));
  const year = Math.floor(Math.max(0, monthsBetween(loan.start, asOf)) / 12);
  const lim = t.match(/first (\w+) years?/i) ?? t.match(/years? 1\s*[–-]\s*(\d+)/i);
  const limit = lim ? WORDS[lim[1].toLowerCase()] ?? Number(lim[1]) : null;
  if (limit !== null && year >= limit) return 0;
  const pct = steps.length > 1 ? steps[year] ?? 0 : steps[0];
  return Math.round((balance * pct) / 100);
}

export interface RefiResult extends RefiMath {
  loan: Loan;
  remainingMonths: number;
  /** DSCR on the latest annual figures, and with the payment change. Related-party-carried loans use the group's coverage. */
  dscrBefore: number | null;
  dscrAfter: number | null;
  dscrKind: 'company' | 'global';
}

export function refinance(state: BooksState, x: RefiProposal & { loanId: ID }, asOf: string, opts: { metrics?: MonthMetrics; costOfCapitalBps?: number } = {}): RefiResult {
  const loan = loansOf(state).find((l) => l.id === x.loanId);
  if (!loan) throw new ValidationError(['Pick the loan to refinance.']);
  const d = debtOf(state);
  const cur = currentDebt(state, loan, asOf);
  const math = analyzeRefi(cur, x, opts.costOfCapitalBps ?? d.settings.costOfCapitalBps);
  const m = opts.metrics ?? headlineMetrics(covenantMetrics(state, asOf), d.settings);
  let dscrBefore: number | null = null, dscrAfter: number | null = null;
  const dscrKind = loan.heldBy === 'company' ? 'company' : 'global';
  if (m) {
    const num = dscrKind === 'company' ? m.ebitdaAnnual : Math.round((m.ebitda + m.rent) * m.factor);
    const den = dscrKind === 'company' ? m.debtServiceAnnual : Math.round((m.debtService + m.relatedDebtService) * m.factor);
    dscrBefore = ratio(num, den);
    dscrAfter = ratio(num, den + 12 * math.paymentChange);
  }
  return { ...math, loan, remainingMonths: cur.remaining.length, dscrBefore, dscrAfter, dscrKind };
}

/** A sensible starting proposal: the latest fixed quote for the loan's kind, the original term, the remaining amortization. */
export function defaultProposal(state: BooksState, loan: Loan, asOf: string): RefiProposal {
  const s = debtOf(state).settings;
  const cur = currentDebt(state, loan, asOf);
  const quote = marketQuote(state, loan.kind, 'fixed', asOf);
  const paid = cur.status.rows.filter((r) => r.date <= asOf).length;
  const amort = loan.interestOnly ? loan.termMonths : Math.max(1, (loan.amortizationMonths || loan.termMonths) - paid);
  return {
    rateBps: quote?.rateBps ?? loan.rateBps, termMonths: Math.min(loan.termMonths, amort), amortizationMonths: amort,
    fees: Math.round((cur.balance * s.refiFeeBps) / 10000), prepaymentPenalty: suggestedPenalty(loan, cur.balance, asOf), cashOut: 0, rollInCosts: false,
  };
}

// ── Market rates and triggers ────────────────────────────────────────────
/** The latest quote on or before a date for a kind of loan (a fixed quote falls back to term loans). */
export function marketQuote(state: BooksState, kind: Loan['kind'], rateType: 'fixed' | 'variable', asOf: string): MarketRate | undefined {
  const all = debtOf(state).marketRates.filter((r) => r.date <= asOf && r.rateType === rateType).sort((a, b) => a.date.localeCompare(b.date));
  return all.filter((r) => r.kind === kind).at(-1) ?? (rateType === 'fixed' ? all.filter((r) => r.kind === 'term_loan').at(-1) : undefined);
}

export type TriggerKind = 'rate_gap' | 'maturity' | 'ltv' | 'variable_above_fixed' | 'covenant_forecast';
export const TRIGGER_LABEL: Record<TriggerKind, string> = {
  rate_gap: 'Market rate below ours, and it pays back', maturity: 'Matures or balloons within 12 months', ltv: 'Property value up: LTV below target',
  variable_above_fixed: 'Variable rate above the fixed alternative', covenant_forecast: 'Covenant forecast to breach',
};
export interface RefiTrigger { kind: TriggerKind; loanId: ID; loanName: string; title: string; detail: string; date?: string }

export function refinanceTriggers(state: BooksState, asOf: string, opts: { monitor?: CovenantMonitor; visible?: Set<ID> } = {}): RefiTrigger[] {
  const s = debtOf(state).settings;
  const out: RefiTrigger[] = [];
  const money = (c: Cents) => formatMoney(c, { dollarSign: true, whole: true });
  const loans = loansOf(state).filter((l) => !opts.visible || opts.visible.has(l.storeId));
  const metrics = opts.monitor?.headline;
  for (const loan of loans) {
    const cur = currentDebt(state, loan, asOf);
    if (cur.balance <= 0 || !cur.remaining.length) continue;
    const base = { loanId: loan.id, loanName: loan.name };
    const fixed = marketQuote(state, loan.kind, 'fixed', asOf);
    if (fixed && !loan.interestOnly && loan.rateBps - fixed.rateBps >= s.refiGapBps) {
      const r = refinance(state, { ...defaultProposal(state, loan, asOf), loanId: loan.id }, asOf, { metrics });
      if (r.breakEvenMonths !== null && r.breakEvenMonths < s.refiBreakEvenMonths) {
        out.push({ ...base, kind: 'rate_gap', title: `${loan.name}: market ${bpsPct(fixed.rateBps)} vs ${bpsPct(loan.rateBps)}`, detail: `${loan.rateBps - fixed.rateBps} bps lower; saves ${money(r.cashFreedMonthly)} a month and breaks even in ${r.breakEvenMonths} months (costs ${money(r.costs)}).` });
      }
    }
    const lim = addDays(asOf, Math.round(s.maturityMonths * 30.44));
    const balloon = loan.interestOnly ? undefined : cur.remaining.find((r) => r.balloon);
    const end = balloon?.date ?? loan.maturity;
    if (end <= lim) out.push({ ...base, kind: 'maturity', date: end, title: `${loan.name} ${balloon ? 'balloons' : 'matures'} ${end}`, detail: `${money(balloon?.payment ?? cur.balance)} due; line up the renewal or refinance now.` });
    if (loan.kind === 'mortgage') {
      const { latest, prior } = propertyValues(state, loan.storeId, asOf);
      if (latest && latest.value > 0) {
        const ltv = cur.balance / latest.value;
        const priorBal = prior ? (prior.date < loan.start ? loan.original : loanStatus(state, loan, prior.date).scheduleBalance) : 0;
        const priorLtv = prior && prior.value > 0 ? priorBal / prior.value : null;
        if (ltv * 100 < s.ltvTargetPct && (priorLtv === null || priorLtv * 100 >= s.ltvTargetPct) && (!prior || latest.value > prior.value)) {
          out.push({ ...base, kind: 'ltv', title: `${loan.name}: LTV ${(ltv * 100).toFixed(1)}%`, detail: `Valued at ${money(latest.value)} (${latest.source}, ${latest.date})${prior ? `, up from ${money(prior.value)}` : ''}: below the ${s.ltvTargetPct}% target, so better terms or cash-out may be open.` });
        }
      }
    }
    if (loan.rateType === 'variable' && fixed && loan.rateBps > fixed.rateBps) {
      out.push({ ...base, kind: 'variable_above_fixed', title: `${loan.name}: ${bpsPct(loan.rateBps)} variable vs ${bpsPct(fixed.rateBps)} fixed`, detail: `${loan.index ?? 'Index'} + margin is ${loan.rateBps - fixed.rateBps} bps above the fixed quote of ${fixed.date}.` });
    }
  }
  const mon = opts.monitor ?? covenantMonitor(state, asOf);
  for (const t of mon.tests) {
    if (t.status === 'breach' || !t.forecast.within || !t.forecast.date) continue;
    if (opts.visible && t.loan && !opts.visible.has(t.loan.storeId)) continue;
    out.push({ kind: 'covenant_forecast', loanId: t.covenant.loanId, loanName: t.loan?.name ?? '', date: t.forecast.date, title: `${t.loan?.name ?? 'Loan'}: ${COVENANT_LABEL[t.covenant.kind]} ${formatCovenant(t.covenant)} forecast to break ${t.forecast.date}`, detail: `Now ${formatMetric(t.covenant.kind, t.actual)}; the ${t.forecast.method === 'forecast' ? '13-week cash forecast' : 'trend'} reaches ${formatMetric(t.covenant.kind, t.forecast.value ?? null)}.` });
  }
  return out;
}

// ── Cash reserve policy ──────────────────────────────────────────────────
export const FIXED_EXCLUDE: ID[] = ['acct_card_fees', 'acct_network_fees', 'acct_wages', 'acct_payroll_taxes', 'acct_depreciation', 'acct_disposal'];
export interface ReserveTarget {
  asOf: string;
  months: string[];
  /** Fixed costs in the lookback: expenses less card fees (variable), payroll (counted once below) and depreciation (non-cash). */
  fixedCosts: Cents;
  weeklyFixed: Cents;
  fixedPart: Cents;
  fuelLoads: { storeId: ID; cost: Cents; loads: number }[];
  fuelPart: Cents;
  payroll: Cents;
  payrollWeeks: string[];
  cushion: Cents;
  target: Cents;
  cash: Cents;
  deployable: Cents;
}

/** One typical fuel load at a store: the median delivered invoice in the 90 days to asOf. */
export function typicalLoadCost(state: BooksState, storeId: ID, asOf: string): { cost: Cents; loads: number } {
  const xs = liveInvoices(state).filter((i) => i.storeId === storeId && i.deliveredOn <= asOf && i.deliveredOn > addDays(asOf, -90)).map((i) => i.total).sort((a, b) => a - b);
  if (!xs.length) return { cost: 0, loads: 0 };
  const m = Math.floor(xs.length / 2);
  return { cost: xs.length % 2 ? xs[m] : Math.round((xs[m - 1] + xs[m]) / 2), loads: xs.length };
}

/** One payroll: the average labor cost (Gusto + cash/check pay + employer taxes) of the last four pay weeks to asOf. */
export function onePayroll(state: BooksState, asOf: string): { amount: Cents; weeks: string[] } {
  const idx = weekIndex(state);
  const weeks = payWeeks(state).filter((w) => w <= asOf).slice(0, 4);
  if (!weeks.length) return { amount: 0, weeks };
  const tot = weeks.reduce((a, w) => a + [...storeWeeks(state, w, idx).values()].reduce((x, s) => x + s.cost, 0), 0);
  return { amount: Math.round(tot / weeks.length), weeks };
}

export function reserveCash(state: BooksState, asOf: string): Cents {
  const subs = debtOf(state).settings.reserve.cashSubtypes;
  return [...balancesAt(state, accountsOfSubtype(state, subs), asOf).values()].reduce((a, b) => a + b, 0);
}

/** Target = N weeks of fixed costs + one fuel load per fuel-selling store + one payroll + cushion. Cash above it is deployable. */
export function reserveTarget(state: BooksState, asOf: string, opts: { entries?: BasisEntry[] } = {}): ReserveTarget {
  const pol = debtOf(state).settings.reserve;
  const first = firstBooksPeriod(state);
  let last = periodOf(asOf);
  if (asOf < lastDayOfPeriod(last)) last = addMonthsP(last, -1);
  let months: string[] = [];
  if (first && last >= first) {
    let from = addMonthsP(last, -(pol.lookbackMonths - 1));
    if (from < first) from = first;
    months = periodsBetween(from, last);
  } else if (first) months = [periodOf(asOf)];
  let fixedCosts = 0, days = 0;
  if (months.length) {
    const st = statement(state, { basis: 'booked', from: months[0], to: months.at(-1)!, storeIds: state.stores.map((s) => s.id), entries: opts.entries });
    fixedCosts = st.rows.filter((r) => r.section === 'expense' && !FIXED_EXCLUDE.includes(r.account.id)).reduce((a, r) => a + r.total, 0);
    const end = lastDayOfPeriod(months.at(-1)!) < asOf ? lastDayOfPeriod(months.at(-1)!) : asOf;
    days = daysBetween(firstDay(months[0]), end) + 1;
  }
  const weeklyFixed = days ? Math.round((fixedCosts * 7) / days) : 0;
  const fixedPart = Math.round(weeklyFixed * pol.weeksFixed);
  const fuelLoads = pol.fuelLoad
    ? state.stores.filter((s) => !s.deleted && s.kind === 'operating' && s.fuelSupplier !== 'none' && (!s.openedOn || s.openedOn <= asOf)).map((s) => ({ storeId: s.id, ...typicalLoadCost(state, s.id, asOf) }))
    : [];
  const fuelPart = fuelLoads.reduce((a, f) => a + f.cost, 0);
  const pr = pol.payroll ? onePayroll(state, asOf) : { amount: 0, weeks: [] };
  const target = fixedPart + fuelPart + pr.amount + pol.cushion;
  const cash = reserveCash(state, asOf);
  return { asOf, months, fixedCosts, weeklyFixed, fixedPart, fuelLoads, fuelPart, payroll: pr.amount, payrollWeeks: pr.weeks, cushion: pol.cushion, target, cash, deployable: cash - target };
}

export function deployableCash(state: BooksState, asOf: string): Cents {
  return reserveTarget(state, asOf).deployable;
}

export interface ReservePoint { date: string; cash: Cents; target: Cents; deployable: Cents; above: boolean }
/** Cash vs the reserve at each month end in the books, and today. `monthsAbove` counts the latest month ends in a row above it. */
export function reserveHistory(state: BooksState, asOf: string, opts: { entries?: BasisEntry[] } = {}): { points: ReservePoint[]; monthsAbove: number } {
  const first = firstBooksPeriod(state);
  if (!first) return { points: [], monthsAbove: 0 };
  const entries = opts.entries ?? basisEntries(state);
  const dates = periodsBetween(first, periodOf(asOf)).map((p) => lastDayOfPeriod(p)).filter((d) => d < asOf);
  dates.push(asOf);
  const points = dates.map((date) => { const r = reserveTarget(state, date, { entries }); return { date, cash: r.cash, target: r.target, deployable: r.deployable, above: r.deployable > 0 }; });
  let monthsAbove = 0;
  for (const p of [...points].reverse()) { if (p.date === asOf) { if (!p.above) break; continue; } if (p.above) monthsAbove += 1; else break; }
  return { points, monthsAbove };
}

// ── Paydown vs invest ────────────────────────────────────────────────────
export interface CashUse {
  key: string;
  label: string;
  kind: 'debt' | 'alternative';
  /** Balance (debt) or how much it can absorb (alternative). */
  amount: Cents;
  rateBps: number;
  afterTaxBps: number;
  loan?: Loan;
  alt?: InvestAlternative;
  interestOnly?: boolean;
}
export interface PaydownPlan {
  asOf: string;
  reserve: ReserveTarget;
  reserveMet: boolean;
  /** Cash to deploy: deployable cash, or the amount asked for. */
  toDeploy: Cents;
  debts: CashUse[];
  alternatives: CashUse[];
  /** Debts and alternatives together, highest after-tax rate first (avalanche). */
  ranked: CashUse[];
  allocations: { use: CashUse; amount: Cents }[];
  effects: {
    dscrBefore: number | null; dscrAfter: number | null;
    liquidityBefore: Cents; liquidityAfter: Cents;
    /** Annual interest saved (pre-tax) and alternative returns gained. */
    interestSaved: Cents; returnsGained: Cents;
    monthlyFreeCashBefore: Cents; monthlyFreeCashAfter: Cents;
    monthsToFundBefore: number | null; monthsToFundAfter: number | null;
  };
}

/** Months until cash on hand above the reserve plus free cash flow covers the next store's equity. */
export function monthsToFund(need: Cents, available: Cents, monthlyFreeCash: Cents): number | null {
  if (available >= need) return 0;
  if (monthlyFreeCash <= 0) return null;
  return Math.ceil((need - available) / monthlyFreeCash);
}

export function paydownPlan(state: BooksState, asOf: string, opts: { amount?: Cents; entries?: BasisEntry[]; metrics?: MonthMetrics } = {}): PaydownPlan {
  const d = debtOf(state);
  const tax = d.settings.taxRateBps / 10000;
  const entries = opts.entries ?? basisEntries(state);
  const reserve = reserveTarget(state, asOf, { entries });
  const m = opts.metrics ?? headlineMetrics(covenantMetrics(state, asOf, { entries }), d.settings);
  const debts: CashUse[] = loansOf(state).filter((l) => l.heldBy === 'company').map((loan) => {
    const bal = loanStatus(state, loan, asOf).scheduleBalance;
    return { key: loan.id, label: loan.name, kind: 'debt' as const, amount: bal, rateBps: loan.rateBps, afterTaxBps: Math.round(loan.rateBps * (1 - tax)), loan, interestOnly: !!loan.interestOnly };
  }).filter((u) => u.amount > 0);
  const alternatives: CashUse[] = d.alternatives.map((a) => ({ key: a.id, label: a.name, kind: 'alternative' as const, amount: a.amount, rateBps: a.returnBps, afterTaxBps: Math.round(a.returnBps * (a.taxable ? 1 - tax : 1)), alt: a }));
  const ranked = [...debts, ...alternatives].sort((a, b) => b.afterTaxBps - a.afterTaxBps || (a.kind === 'debt' ? -1 : 1));
  debts.sort((a, b) => b.afterTaxBps - a.afterTaxBps);
  alternatives.sort((a, b) => b.afterTaxBps - a.afterTaxBps);
  const reserveMet = reserve.deployable >= 0;
  const toDeploy = Math.max(0, opts.amount ?? reserve.deployable);
  const allocations: { use: CashUse; amount: Cents }[] = [];
  let left = reserveMet ? toDeploy : 0;
  for (const u of ranked) {
    if (left <= 0) break;
    const amt = Math.min(left, u.amount);
    if (amt > 0) { allocations.push({ use: u, amount: amt }); left -= amt; }
  }
  const interestSaved = allocations.filter((a) => a.use.kind === 'debt').reduce((x, a) => x + Math.round((a.amount * a.use.rateBps) / 10000), 0);
  const ioSaved = allocations.filter((a) => a.use.kind === 'debt' && a.use.interestOnly).reduce((x, a) => x + Math.round((a.amount * a.use.rateBps) / 10000), 0);
  const returnsGained = allocations.filter((a) => a.use.kind === 'alternative').reduce((x, a) => x + Math.round((a.amount * a.use.rateBps) / 10000), 0);
  const spent = allocations.reduce((x, a) => x + a.amount, 0);
  const ebitda = m?.ebitdaAnnual ?? 0, ds = m?.debtServiceAnnual ?? 0;
  const freeBefore = Math.round((ebitda - ds) / 12);
  // A prepaid amortizing loan keeps its payment (the term shortens); a line of credit's interest falls at once.
  const freeAfter = Math.round((ebitda + returnsGained - (ds - ioSaved)) / 12);
  const toStore = allocations.filter((a) => a.use.alt?.kind === 'new_store').reduce((x, a) => x + a.amount, 0);
  const avail = Math.max(0, reserve.deployable);
  return {
    asOf, reserve, reserveMet, toDeploy, debts, alternatives, ranked, allocations,
    effects: {
      dscrBefore: ratio(ebitda, ds), dscrAfter: ratio(ebitda + returnsGained, ds - ioSaved),
      liquidityBefore: reserve.cash, liquidityAfter: reserve.cash - spent, interestSaved, returnsGained,
      monthlyFreeCashBefore: freeBefore, monthlyFreeCashAfter: freeAfter,
      monthsToFundBefore: monthsToFund(d.settings.nextStoreEquity, avail, freeBefore),
      monthsToFundAfter: monthsToFund(d.settings.nextStoreEquity, Math.max(0, avail - spent) + toStore, freeAfter),
    },
  };
}

// ── Related-party loans ──────────────────────────────────────────────────
export interface RpLoanRow {
  partyId: ID;
  partyName: string;
  accountId: ID;
  direction: 'lent' | 'borrowed';
  /** + owed (to us when lent, by us when borrowed). */
  balance: Cents;
  terms?: RelatedPartyTerms;
  /** Rate below the AFR on a balance: interest may be imputed (IRC §7872). */
  imputed: boolean;
  /** (AFR − stated rate) × balance, a year. */
  imputedAnnual: Cents;
  /** Month ends in the books with the balance and its acknowledgment. */
  months: { period: string; date: string; balance: Cents; ack?: RelatedPartyAck; agreed: boolean | null }[];
}

export function rpBalance(state: BooksState, partyId: ID, accountId: ID, asOf: string): Cents {
  const a = state.accounts.find((x) => x.id === accountId);
  const sign = a?.type === 'asset' ? 1 : -1;
  let n = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf) continue;
    for (const l of t.lines) if (l.accountId === accountId && !l.system && (l.partyId ?? t.partyId) === partyId) n += sign * (l.debit - l.credit);
  }
  return n;
}

export const RP_LOAN_ACCTS = { lent: 'acct_loans_related', borrowed: 'acct_due_related' } as const;

/** Every related-party loan both ways: documented terms, plus any party with a balance on 1910 (loans to) or 2400 (due to). */
export function relatedPartyLoans(state: BooksState, asOf: string): RpLoanRow[] {
  const d = debtOf(state);
  const keys = new Map<string, { partyId: ID; accountId: ID; direction: 'lent' | 'borrowed'; terms?: RelatedPartyTerms }>();
  for (const t of d.rpTerms) keys.set(`${t.partyId}|${t.accountId}`, { partyId: t.partyId, accountId: t.accountId, direction: t.direction, terms: t });
  for (const p of state.parties) {
    if (p.deleted || p.type === 'vendor' || p.type === 'customer' || p.type === 'tenant' || p.type === 'lender') continue;
    for (const [dir, acct] of Object.entries(RP_LOAN_ACCTS) as ['lent' | 'borrowed', ID][]) {
      const k = `${p.id}|${acct}`;
      if (!keys.has(k) && rpBalance(state, p.id, acct, asOf) !== 0) keys.set(k, { partyId: p.id, accountId: acct, direction: dir });
    }
  }
  const first = firstBooksPeriod(state);
  const periods = first ? periodsBetween(first, periodOf(asOf)).filter((p) => lastDayOfPeriod(p) <= asOf) : [];
  return [...keys.values()].map((k) => {
    const balance = rpBalance(state, k.partyId, k.accountId, asOf);
    const rate = k.terms?.rateBps ?? 0;
    const imputed = !!k.terms && balance > 0 && rate < d.settings.afrBps;
    const months = periods.map((period) => {
      const date = lastDayOfPeriod(period);
      const bal = rpBalance(state, k.partyId, k.accountId, date);
      const ack = k.terms ? d.rpAcks.filter((a) => a.termsId === k.terms!.id && a.period === period).at(-1) : undefined;
      return { period, date, balance: bal, ack, agreed: ack ? ack.confirmedBalance === bal : null };
    });
    return {
      ...k, partyName: state.parties.find((p) => p.id === k.partyId)?.name ?? k.partyId, balance, imputed,
      imputedAnnual: imputed ? Math.round((balance * (d.settings.afrBps - rate)) / 10000) : 0, months,
    };
  }).sort((a, b) => a.direction.localeCompare(b.direction) || b.balance - a.balance);
}

// ── Inbox (SPEC §9) ──────────────────────────────────────────────────────
export interface DebtInboxItem { key: string; count: number; title: string; detail: string; to: string; action: string; review?: boolean }

export function debtInbox(state: BooksState, today: string, visible?: Set<ID>): DebtInboxItem[] {
  const d = debtOf(state);
  if (!loansOf(state).length && !d.covenants.length) return [];
  const entries = basisEntries(state);
  const mon = covenantMonitor(state, today, { entries });
  const trig = refinanceTriggers(state, today, { monitor: mon, visible });
  const of = (k: TriggerKind) => trig.filter((t) => t.kind === k);
  const dscrTests = mon.tests.filter((t) => t.covenant.kind === 'dscr');
  const dscrLow = dscrTests.length ? dscrTests.filter((t) => t.status === 'breach') : mon.headline?.dscr !== null && mon.headline?.dscr !== undefined && mon.headline.dscr < d.settings.dscrTarget / 100 ? [null] : [];
  const anyBreach = mon.tests.filter((t) => t.status === 'breach' && t.covenant.kind !== 'dscr');
  const hist = reserveHistory(state, today, { entries });
  const list = (xs: RefiTrigger[], none: string) => (xs.length ? xs.map((t) => t.title).join('; ') : none);
  return [
    { key: 'debt_covforecast', count: of('covenant_forecast').length + anyBreach.length, title: 'Covenant breach forecast within 2 quarters', detail: anyBreach.length ? anyBreach.map((t) => `${t.loan?.name}: ${COVENANT_LABEL[t.covenant.kind]} is ${formatMetric(t.covenant.kind, t.actual)} vs ${formatCovenant(t.covenant)}`).concat(of('covenant_forecast').map((t) => t.title)).join('; ') : list(of('covenant_forecast'), 'Every covenant holds through the forecast.'), to: '/debt/covenants', action: 'Review' },
    { key: 'debt_dscr', count: dscrLow.length, title: 'DSCR below target', detail: dscrLow.length ? `DSCR ${ratioX(mon.headline?.dscr)} for ${mon.headline?.period}.` : `DSCR ${ratioX(mon.headline?.dscr)} is above the ${(d.settings.dscrTarget / 100).toFixed(2)}x target.`, to: '/debt/covenants', action: 'Review' },
    { key: 'debt_maturity', count: of('maturity').length, title: 'Loans maturing within 12 months', detail: list(of('maturity'), 'Nothing matures or balloons in the next 12 months.'), to: '/debt', action: 'Plan' },
    { key: 'debt_refi', count: of('rate_gap').length + of('ltv').length, title: 'Refinance opportunities', detail: list([...of('rate_gap'), ...of('ltv')], 'No rate gap that pays back, and no LTV below target.'), to: '/debt/refinance', action: 'Analyze', review: true },
    { key: 'debt_varfixed', count: of('variable_above_fixed').length, title: 'Variable rate above the fixed alternative', detail: list(of('variable_above_fixed'), 'No variable loan is above the fixed quote.'), to: '/debt/refinance', action: 'Analyze', review: true },
    { key: 'debt_deployable', count: hist.monthsAbove >= 2 ? 1 : 0, title: 'Cash above the reserve for 2+ months', detail: hist.monthsAbove >= 2 ? `${hist.monthsAbove} month ends in a row above the reserve target; ${formatMoney(Math.max(0, hist.points.at(-1)!.deployable), { dollarSign: true, whole: true })} deployable today.` : 'Cash has not sat above the reserve for two month ends in a row.', to: '/debt/reserve', action: 'Deploy', review: true },
  ];
}

// ── Writers ──────────────────────────────────────────────────────────────
function done(books: Books, actor: User, summary: string, kind: string, objectId: ID, before?: unknown, after?: unknown) {
  books.audit(actor, { action: `${before ? 'update' : 'create'} ${kind}`, objectType: 'debt', objectId, summary, before: before as never, after: after as never });
  books.changed();
}

export function saveDebtSettings(books: Books, actor: User, patch: Partial<DebtSettings>): DebtSettings {
  books.require(actor, 'debt.edit', 'change debt settings');
  const d = ensureDebt(books);
  const next: DebtSettings = { ...d.settings, ...patch, reserve: { ...d.settings.reserve, ...(patch.reserve ?? {}) } };
  const errs: string[] = [];
  const intIn = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;
  if (!intIn(next.ttmMonths, 1, 24)) errs.push('Trailing months must be between 1 and 24 (12 = TTM).');
  if (!intIn(next.taxRateBps, 0, 6000)) errs.push('Enter a tax rate between 0% and 60%.');
  if (!intIn(next.costOfCapitalBps, 0, 5000)) errs.push('Enter a cost of capital between 0% and 50%.');
  if (!intIn(next.afrBps, 0, 2000)) errs.push('Enter the AFR between 0% and 20%.');
  if (!intIn(next.reserve.weeksFixed, 0, 52)) errs.push('Reserve weeks of fixed costs must be between 0 and 52.');
  if (!intIn(next.reserve.lookbackMonths, 1, 12)) errs.push('Look back 1 to 12 months for fixed costs.');
  if (!Number.isSafeInteger(next.reserve.cushion) || next.reserve.cushion < 0) errs.push('The reserve cushion is a dollar amount, zero or more.');
  if (!intIn(next.ltvTargetPct, 1, 100)) errs.push('The LTV target is a percentage between 1 and 100.');
  if (!intIn(next.refiBreakEvenMonths, 1, 360) || !intIn(next.refiGapBps, 0, 2000)) errs.push('Refinance triggers: a gap of 0–2,000 bps and a break-even of 1–360 months.');
  if (!Number.isSafeInteger(next.nextStoreEquity) || next.nextStoreEquity < 0) errs.push('Next-store equity is a dollar amount, zero or more.');
  if (errs.length) throw new ValidationError(errs);
  const before = structuredClone(d.settings);
  d.settings = next;
  done(books, actor, 'Changed debt & treasury settings', 'debt_settings', 'debt', before, next);
  return next;
}

export function saveCovenant(books: Books, actor: User, c: Omit<Covenant, 'id'> & { id?: ID }): Covenant {
  books.require(actor, 'debt.edit', 'change covenants');
  const errs: string[] = [];
  if (!loansOf(books.state).some((l) => l.id === c.loanId)) errs.push('Pick the loan the covenant is in.');
  if (!Number.isFinite(c.threshold) || c.threshold <= 0) errs.push(c.kind === 'min_liquidity' ? 'Enter the minimum balance.' : 'Enter the ratio, e.g. 1.25.');
  if (errs.length) throw new ValidationError(errs);
  const d = ensureDebt(books);
  const i = c.id ? d.covenants.findIndex((x) => x.id === c.id) : -1;
  const before = i >= 0 ? structuredClone(d.covenants[i]) : undefined;
  const cov: Covenant = { ...c, id: c.id ?? books.nextId('cov'), threshold: c.kind === 'min_liquidity' ? Math.round(c.threshold) : Math.round(c.threshold) };
  if (i >= 0) d.covenants[i] = cov; else d.covenants.push(cov);
  done(books, actor, `${before ? 'Updated' : 'Added'} covenant ${COVENANT_LABEL[cov.kind]} ${formatCovenant(cov)}`, 'covenant', cov.id, before, cov);
  return cov;
}

export function addMarketRate(books: Books, actor: User, r: Omit<MarketRate, 'id'>): MarketRate {
  books.require(actor, 'debt.edit', 'record market rates');
  const errs: string[] = [];
  if (!isValidDate(r.date)) errs.push('Enter the quote date as YYYY-MM-DD.');
  if (!Number.isInteger(r.rateBps) || r.rateBps <= 0 || r.rateBps > 3000) errs.push('Enter the rate as a percentage between 0 and 30.');
  if (!LOAN_KIND_LABEL[r.kind]) errs.push('Pick the kind of loan the quote is for.');
  if (errs.length) throw new ValidationError(errs);
  const rate = { ...r, id: books.nextId('mr') };
  ensureDebt(books).marketRates.push(rate);
  done(books, actor, `Recorded market rate ${bpsPct(r.rateBps)} ${r.rateType} for ${LOAN_KIND_LABEL[r.kind].toLowerCase()} on ${r.date}`, 'market_rate', rate.id, undefined, rate);
  return rate;
}

export function addPropertyValue(books: Books, actor: User, v: Omit<PropertyValue, 'id'>): PropertyValue {
  books.require(actor, 'debt.edit', 'record property values');
  const errs: string[] = [];
  if (!books.state.stores.some((s) => s.id === v.storeId)) errs.push('Pick the store the property is.');
  if (!isValidDate(v.date)) errs.push('Enter the valuation date as YYYY-MM-DD.');
  if (!Number.isSafeInteger(v.value) || v.value <= 0) errs.push('Enter the value.');
  if (!v.source.trim()) errs.push('Say where the value came from (appraisal, broker opinion, estimate).');
  if (errs.length) throw new ValidationError(errs);
  const pv0 = { ...v, source: v.source.trim(), id: books.nextId('pv') };
  ensureDebt(books).propertyValues.push(pv0);
  done(books, actor, `Recorded property value ${formatMoney(v.value, { dollarSign: true, whole: true })} for ${books.state.stores.find((s) => s.id === v.storeId)?.code}`, 'property_value', pv0.id, undefined, pv0);
  return pv0;
}

export function validateProposal(p: RefiProposal): string[] {
  const errs: string[] = [];
  if (!Number.isInteger(p.rateBps) || p.rateBps < 0 || p.rateBps > 3000) errs.push('Enter the proposed rate as a percentage between 0 and 30.');
  if (!Number.isInteger(p.termMonths) || p.termMonths < 1 || p.termMonths > 480) errs.push('Enter the term in months (1–480).');
  if (!Number.isInteger(p.amortizationMonths) || p.amortizationMonths < 0 || p.amortizationMonths > 480) errs.push('Enter the amortization in months (0 = interest only).');
  if (p.amortizationMonths > 0 && p.amortizationMonths < p.termMonths) errs.push('Amortization can\'t be shorter than the term.');
  for (const [k, label] of [['fees', 'fees'], ['prepaymentPenalty', 'prepayment penalty'], ['cashOut', 'cash out']] as const) if (!Number.isSafeInteger(p[k]) || p[k] < 0) errs.push(`Enter the ${label} as a dollar amount, zero or more.`);
  return errs;
}

export function saveScenario(books: Books, actor: User, s: Omit<RefiScenario, 'id' | 'createdBy' | 'createdAt'> & { id?: ID }): RefiScenario {
  books.require(actor, 'debt.edit', 'save refinance scenarios');
  const errs = [...(s.name.trim() ? [] : ['Name the scenario, e.g. "5-year fixed at 6.5%".']), ...(loansOf(books.state).some((l) => l.id === s.loanId) ? [] : ['Pick the loan to refinance.']), ...validateProposal(s)];
  if (errs.length) throw new ValidationError(errs);
  const d = ensureDebt(books);
  const i = s.id ? d.scenarios.findIndex((x) => x.id === s.id) : -1;
  const before = i >= 0 ? structuredClone(d.scenarios[i]) : undefined;
  const sc: RefiScenario = { ...s, name: s.name.trim(), id: before?.id ?? s.id ?? books.nextId('refi'), createdBy: before?.createdBy ?? actor.id, createdAt: before?.createdAt ?? books.clock() };
  if (i >= 0) d.scenarios[i] = sc; else d.scenarios.push(sc);
  done(books, actor, `${before ? 'Updated' : 'Saved'} refinance scenario ${sc.name}`, 'refi_scenario', sc.id, before, sc);
  return sc;
}

export function deleteScenario(books: Books, actor: User, id: ID): void {
  books.require(actor, 'debt.edit', 'delete refinance scenarios');
  const d = ensureDebt(books);
  const i = d.scenarios.findIndex((x) => x.id === id);
  if (i < 0) throw new ValidationError(['That scenario no longer exists.']);
  const [before] = d.scenarios.splice(i, 1);
  books.audit(actor, { action: 'delete refi_scenario', objectType: 'debt', objectId: id, summary: `Deleted refinance scenario ${before.name}`, before: before as never });
  books.changed();
}

export function saveAlternative(books: Books, actor: User, a: Omit<InvestAlternative, 'id'> & { id?: ID }): InvestAlternative {
  books.require(actor, 'debt.edit', 'change investment alternatives');
  const errs: string[] = [];
  if (!a.name.trim()) errs.push('Name the alternative, e.g. "Cooler upgrade HM13".');
  if (!Number.isSafeInteger(a.amount) || a.amount <= 0) errs.push('Enter how much it would take.');
  if (!Number.isInteger(a.returnBps) || a.returnBps < 0 || a.returnBps > 10000) errs.push('Enter the expected return as a percentage between 0 and 100.');
  if (errs.length) throw new ValidationError(errs);
  const d = ensureDebt(books);
  const i = a.id ? d.alternatives.findIndex((x) => x.id === a.id) : -1;
  const before = i >= 0 ? structuredClone(d.alternatives[i]) : undefined;
  const alt = { ...a, name: a.name.trim(), id: before?.id ?? a.id ?? books.nextId('alt') };
  if (i >= 0) d.alternatives[i] = alt; else d.alternatives.push(alt);
  done(books, actor, `${before ? 'Updated' : 'Added'} alternative ${alt.name}`, 'invest_alternative', alt.id, before, alt);
  return alt;
}

export function saveRpTerms(books: Books, actor: User, t: Omit<RelatedPartyTerms, 'id' | 'attachments'> & { id?: ID; attachments?: RelatedPartyTerms['attachments'] }): RelatedPartyTerms {
  books.require(actor, 'debt.edit', 'record related-party loan terms');
  const errs: string[] = [];
  if (!books.state.parties.some((p) => p.id === t.partyId)) errs.push('Pick the related party.');
  if (!books.state.accounts.some((a) => a.id === t.accountId)) errs.push('Pick the account the balance sits in (1910 loans to, 2400 due to).');
  if (!Number.isInteger(t.rateBps) || t.rateBps < 0 || t.rateBps > 3000) errs.push('Enter the stated rate as a percentage (0 for interest free).');
  if (!t.schedule.trim()) errs.push('Write down the repayment terms, e.g. "On demand" or "Monthly $1,000".');
  if (!isValidDate(t.start)) errs.push('Enter the start date as YYYY-MM-DD.');
  if (t.maturity && !isValidDate(t.maturity)) errs.push('Enter the maturity as YYYY-MM-DD, or leave it blank.');
  if (errs.length) throw new ValidationError(errs);
  const d = ensureDebt(books);
  const i = t.id ? d.rpTerms.findIndex((x) => x.id === t.id) : -1;
  const before = i >= 0 ? structuredClone(d.rpTerms[i]) : undefined;
  const terms: RelatedPartyTerms = { ...t, schedule: t.schedule.trim(), id: before?.id ?? t.id ?? books.nextId('rpt'), attachments: t.attachments ?? before?.attachments ?? [] };
  if (i >= 0) d.rpTerms[i] = terms; else d.rpTerms.push(terms);
  done(books, actor, `${before ? 'Updated' : 'Recorded'} loan terms with ${books.state.parties.find((p) => p.id === t.partyId)?.name}`, 'rp_terms', terms.id, before, terms);
  return terms;
}

/** Record that the related party agreed (or didn't) the month-end balance. */
export function acknowledgeBalance(books: Books, actor: User, x: { termsId: ID; period: string; confirmedBalance: Cents; confirmedBy: string; note?: string }): RelatedPartyAck {
  books.require(actor, 'debt.edit', 'record balance confirmations');
  const d = ensureDebt(books);
  const terms = d.rpTerms.find((t) => t.id === x.termsId);
  const errs: string[] = [];
  if (!terms) errs.push('Record the loan terms first.');
  if (!/^\d{4}-\d{2}$/.test(x.period)) errs.push('Pick the month (YYYY-MM).');
  if (!Number.isSafeInteger(x.confirmedBalance)) errs.push('Enter the balance the related party confirmed.');
  if (!x.confirmedBy.trim()) errs.push('Say who confirmed it.');
  if (errs.length) throw new ValidationError(errs);
  const bookBalance = rpBalance(books.state, terms!.partyId, terms!.accountId, lastDayOfPeriod(x.period));
  if (x.confirmedBalance !== bookBalance && !x.note?.trim()) throw new ValidationError([`The confirmed balance differs from the books (${formatMoney(bookBalance, { dollarSign: true })}). Add a note saying what the difference is.`]);
  const ack: RelatedPartyAck = { id: books.nextId('rpa'), termsId: terms!.id, period: x.period, bookBalance, confirmedBalance: x.confirmedBalance, confirmedBy: x.confirmedBy.trim(), by: actor.id, at: books.clock(), note: x.note?.trim() || undefined };
  d.rpAcks.push(ack);
  done(books, actor, `${books.state.parties.find((p) => p.id === terms!.partyId)?.name} confirmed ${formatMoney(x.confirmedBalance, { dollarSign: true })} at ${x.period}`, 'rp_ack', ack.id, undefined, ack);
  return ack;
}

/** The headline numbers other modules (Phase 13) read in one call. */
export function capitalSnapshot(state: BooksState, asOf: string): { metrics?: MonthMetrics; dscr: number | null; leverage: number | null; reserve: ReserveTarget; deployable: Cents; wacdBps: number | null } {
  const entries = basisEntries(state);
  const s = debtOf(state).settings;
  const metrics = headlineMetrics(covenantMetrics(state, asOf, { entries, settings: s }), s);
  const reserve = reserveTarget(state, asOf, { entries });
  return { metrics, dscr: metrics?.dscr ?? null, leverage: metrics?.leverage ?? null, reserve, deployable: reserve.deployable, wacdBps: debtDashboard(state, asOf).wacdBps };
}

