/**
 * Phase 13 — growth & owners. Expansion readiness, site scoring, the new-store pro forma (buy / build / lease), the
 * acquisition model, capital allocation, company valuation, owner returns and the safe distribution amount, the
 * quarterly CFO review and "evaluate a deal". Built on Phase 12 (`debt.ts`: covenant metrics, reserve, paydown) and
 * Phase 11 (`tax.ts`: estimates and tax distributions). Everything is a pure function over BooksState except the
 * writers at the bottom; the only thing that posts is a recorded distribution (Dr owner draws, Cr the bank).
 */
import type { Books } from './books';
import { ValidationError } from './books';
import type {
  Acquisition, AddBack, Attachment, BooksState, CapitalProject, DdItem, DdStatus, Distribution, FixPlan, GrowthSettings, GrowthState, ID, PriorDistributions,
  ProForma, ProFormaInputs, Rag, RampPlan, RiskLevel, ScoreRecord, SiteFactor, SiteProfile, User, ValuationSnapshot, Financing,
} from './types';
import { formatMoney, type Cents } from './money';
import { addDays, isValidDate, lastDayOfPeriod, periodLabel, periodOf, periodsBetween } from './dates';
import {
  covenantMetrics, covenantMonitor, debtOf, dscrWithNewDebt, firstBooksPeriod, headlineMetrics, paydownPlan, projectSchedule, propertyValues, ratioX,
  refinanceTriggers, reserveTarget, type MonthMetrics, type ReserveTarget,
} from './debt';
import { amortization, loanStatus, loansOf } from './loans';
import { balanceSheet, basisEntries, commandCenter, statement, type BasisEntry } from './statements';
import { breakEven, bva } from './budgets';
import { ownerDraws } from './intercompany';
import { estimates, taxDistributions } from './tax';
import { dueDate } from './close';
import { salesRows } from './fuel';
import type { Sheet } from './xlsx';

// ── State ────────────────────────────────────────────────────────────────
export const DEFAULT_GROWTH_SETTINGS: GrowthSettings = {
  dscrTarget: 125, leverageTarget: 350, discountRateBps: 1000, hurdleIrrBps: 1500, stableDropPct: 5,
  managerReady: false, closeOnTimeMonths: 3,
  multipleLow: 400, multipleHigh: 600, perGallonLow: 60, perGallonHigh: 110,
  capexWindowDays: 90, taxWindowDays: 90, debtCushionMonths: 2,
};
export const SITE_FACTORS: { key: SiteFactor; label: string; hint: string }[] = [
  { key: 'aadt', label: 'Traffic (AADT)', hint: '25,000 cars a day or more scores 100' },
  { key: 'visibility', label: 'Visibility', hint: '1 hidden – 5 corner, seen both ways' },
  { key: 'access', label: 'Ingress / egress', hint: '1 one awkward cut – 5 signalized, both directions' },
  { key: 'competition', label: 'Competition (1–3 mi)', hint: 'Less 30 a competitor within 1 mi, 15 within 2, 7 within 3' },
  { key: 'population', label: 'Population (3 mi)', hint: '15,000 or more scores 100' },
  { key: 'growth', label: 'Population growth', hint: '2% a year or more scores 100' },
  { key: 'truck', label: 'Truck traffic', hint: '1,000 trucks a day or more scores 100' },
  { key: 'zoning', label: 'Zoning', hint: 'Permitted 100, conditional 60, unknown 40, rezoning 20' },
  { key: 'environmental', label: 'Environmental', hint: 'Clean 100, RECs 60, unknown 40, Phase II 30, contaminated 0' },
  { key: 'utilities', label: 'Utilities', hint: 'All at the site 100, partial 50, none 0' },
  { key: 'income', label: 'Household income', hint: '$80,000 median or more scores 100' },
];
export const DEFAULT_WEIGHTS: Record<SiteFactor, number> = { aadt: 20, visibility: 10, access: 10, competition: 12, population: 8, growth: 6, truck: 8, zoning: 8, environmental: 10, utilities: 4, income: 4 };

export function emptyGrowth(): GrowthState {
  return {
    settings: structuredClone(DEFAULT_GROWTH_SETTINGS), sites: [], weights: { ...DEFAULT_WEIGHTS }, proFormas: [], acquisitions: [], projects: [],
    valuations: [], scoreHistory: [], fixPlans: [], ramps: [], distributions: [], priorDistributions: [],
  };
}

const LISTS = ['sites', 'proFormas', 'acquisitions', 'projects', 'valuations', 'scoreHistory', 'fixPlans', 'ramps', 'distributions', 'priorDistributions'] as const;

/** Books saved before phase 13 have no growth slice: read it as empty with default settings. */
export function growthOf(state: BooksState): GrowthState {
  const g = state.growth;
  if (!g) return emptyGrowth();
  return { ...emptyGrowth(), ...g, settings: { ...DEFAULT_GROWTH_SETTINGS, ...g.settings }, weights: { ...DEFAULT_WEIGHTS, ...(g.weights ?? {}) } };
}

export function ensureGrowth(books: Books): GrowthState {
  if (!books.state.growth) books.state.growth = emptyGrowth();
  const g = books.state.growth;
  for (const k of LISTS) if (!g[k]) (g as unknown as Record<string, unknown[]>)[k] = [];
  g.settings = { ...DEFAULT_GROWTH_SETTINGS, ...(g.settings ?? {}) };
  g.weights = { ...DEFAULT_WEIGHTS, ...(g.weights ?? {}) };
  return g;
}

export const MODE_LABEL = { buy: 'Buy an existing site', build: 'Build new', lease: 'Lease' } as const;
export const RAG_LABEL: Record<Rag, string> = { green: 'Green', amber: 'Amber', red: 'Red', na: 'Not enough history' };
export const RAG_PILL: Record<Rag, string> = { green: 'ok', amber: 'warn', red: 'bad', na: '' };
export const RISK_FACTOR: Record<RiskLevel, number> = { low: 1, medium: 0.75, high: 0.5 };
export const PROJECT_KIND_LABEL: Record<CapitalProject['kind'], string> = { next_store: 'Next store', remodel: 'Remodel', kitchen: 'Kitchen upgrade', ev: 'EV charging', car_wash: 'Car wash', other: 'Other' };
export const DD_AREA_LABEL: Record<DdItem['area'], string> = { phase1: 'Phase I environmental', phase2: 'Phase II environmental', ust: 'UST compliance', title: 'Title & survey', permits: 'Permits & licenses', supply: 'Supply contract', other: 'Other' };
export const DD_STATUS_LABEL: Record<DdStatus, string> = { not_started: 'Not started', in_progress: 'In progress', done: 'Done', issue: 'Issue found', na: 'Not needed' };
/** A seller's monthly gallons more than this % off the supplier statement is flagged. */
export const GALLON_VARIANCE_PCT = 2;

const money = (c: Cents) => formatMoney(c, { dollarSign: true, whole: true });
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

function addMonthsP(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
const quarterOf = (date: string) => `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
export function quarterRange(q: string): { from: string; to: string; months: string[] } {
  const y = Number(q.slice(0, 4)), n = Number(q.slice(6));
  const from = `${y}-${String(n * 3 - 2).padStart(2, '0')}`;
  const to = `${y}-${String(n * 3).padStart(2, '0')}`;
  return { from, to, months: periodsBetween(from, to) };
}
const prevQuarter = (q: string) => { const y = Number(q.slice(0, 4)), n = Number(q.slice(6)); return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`; };
export const quarterLabel = (q: string) => `Q${q.slice(6)} ${q.slice(0, 4)}`;
/** The latest complete month on or before asOf. */
export function lastCompleteMonth(asOf: string): string {
  const p = periodOf(asOf);
  return asOf >= lastDayOfPeriod(p) ? p : addMonthsP(p, -1);
}

// ── Investment math ──────────────────────────────────────────────────────
/** A dated cash flow: t in years from today (fractions allowed). */
export interface Flow { t: number; amount: Cents; label?: string }

/** Net present value at an annual rate, discounting each flow by (1 + r)^t. */
export function npv(rate: number, flows: Flow[]): number {
  return flows.reduce((a, f) => a + f.amount / Math.pow(1 + rate, f.t), 0);
}

/**
 * Internal rate of return: the annual rate where NPV = 0. Bracketed bisection between −99.99% and +1,000% (widened
 * if needed), finished with Newton steps that stay inside the bracket. Null when the flows never change sign or no
 * root is bracketed (e.g. money is never paid back).
 */
export function irr(flows: Flow[]): number | null {
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const f = (r: number) => npv(r, flows);
  let lo = -0.9999, hi = 10;
  let flo = f(lo), fhi = f(hi);
  for (let i = 0; i < 6 && flo * fhi > 0; i++) { hi *= 4; fhi = f(hi); }
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  let r = 0.1;
  if (r <= lo || r >= hi) r = (lo + hi) / 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-7 || hi - lo < 1e-12) { r = mid; break; }
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    r = mid;
    if (i > 40) break;
  }
  // Newton polish, kept inside the bracket.
  for (let i = 0; i < 50; i++) {
    const fr = f(r);
    const d = flows.reduce((a, x) => a - (x.t * x.amount) / Math.pow(1 + r, x.t + 1), 0);
    if (!d) break;
    const next = r - fr / d;
    if (!(next > lo && next < hi)) break;
    if (Math.abs(next - r) < 1e-12) { r = next; break; }
    r = next;
  }
  return r;
}

/** Years until cumulative cash turns positive, interpolated within the year (flows spread evenly over the year before t). */
export function payback(flows: Flow[]): number | null {
  const xs = [...flows].sort((a, b) => a.t - b.t);
  let cum = 0, prevT = 0;
  for (const x of xs) {
    const before = cum;
    cum += x.amount;
    if (before < 0 && cum >= 0 && x.amount > 0) {
      const span = x.t - prevT || 0;
      return prevT + (span * -before) / x.amount;
    }
    prevT = x.t;
  }
  return cum >= 0 && xs.length && xs[0].amount >= 0 ? 0 : null;
}

// ── Pro forma ────────────────────────────────────────────────────────────
export const PF_YEARS = 10;
export interface PfMonth {
  /** Operating month, 1 = the opening month. */
  n: number;
  year: number;
  rampPct: number;
  gallons: number;
  fuelGp: Cents;
  insideSales: Cents;
  insideGp: Cents;
  kitchenSales: Cents;
  kitchenGp: Cents;
  otherIncome: Cents;
  incentive: Cents;
  sales: Cents;
  grossProfit: Cents;
  labor: Cents; occupancy: Cents; utilities: Cents; cardFees: Cents; repairs: Cents; insurance: Cents; propertyTax: Cents; otherExpense: Cents;
  opex: Cents;
  ebitda: Cents;
  interest: Cents;
  principal: Cents;
  debtService: Cents;
  cashAfterDebt: Cents;
}
export type PfYear = Omit<PfMonth, 'n' | 'rampPct'> & { months: number; dscr: number | null };
export const PF_SUM_KEYS = ['gallons', 'fuelGp', 'insideSales', 'insideGp', 'kitchenSales', 'kitchenGp', 'otherIncome', 'incentive', 'sales', 'grossProfit', 'labor', 'occupancy', 'utilities', 'cardFees', 'repairs', 'insurance', 'propertyTax', 'otherExpense', 'opex', 'ebitda', 'interest', 'principal', 'debtService', 'cashAfterDebt'] as const;

export interface BreakEvenPf {
  /** The stabilized year the break-evens are figured on (monthly averages). */
  year: number;
  gallonsEbitda: number | null;
  gallonsAfterDebt: number | null;
  insideEbitda: Cents | null;
  insideAfterDebt: Cents | null;
  planGallons: number;
  planInside: Cents;
}

export interface ProFormaResult {
  pf: ProForma;
  months: PfMonth[];
  years: PfYear[];
  capitalTotal: Cents;
  upfrontIncentives: Cents;
  loan: Cents;
  equity: Cents;
  /** Debt service paid before the store opens (carrying cost). */
  preOpeningDebtService: Cents;
  loanBalanceAtExit: Cents;
  residual: Cents;
  residualRealEstate: Cents;
  recoveredCapital: Cents;
  unleveredFlows: Flow[];
  leveredFlows: Flow[];
  unleveredIrr: number | null;
  leveredIrr: number | null;
  unleveredNpv: Cents;
  leveredNpv: Cents;
  paybackYears: number | null;
  leveredPaybackYears: number | null;
  stabilizedYear: number;
  cashOnCash: number | null;
  breakEven: BreakEvenPf;
  /** Annual totals add exactly to the months. */
  ties: boolean;
}

const rampAt = (ramp: number[], n: number) => (n <= ramp.length ? ramp[n - 1] : 100);

/** 120 operating months of P&L plus debt service. Volumes ramp, then grow; every money line grows with them. */
export function proFormaMonths(pf: ProForma): PfMonth[] {
  const i = pf.inputs;
  const loan = pf.financing.loanAmount;
  const sched = loan > 0 ? projectSchedule(loan, pf.financing.rateBps, pf.financing.amortizationMonths, pf.financing.amortizationMonths) : [];
  const cpgIncentives = pf.incentives.filter((x) => x.kind === 'cpg');
  const out: PfMonth[] = [];
  for (let n = 1; n <= PF_YEARS * 12; n++) {
    const year = Math.ceil(n / 12);
    const rampPct = rampAt(i.ramp, n);
    const g = Math.pow(1 + i.growthBps / 10000, year - 1);
    const vol = (rampPct / 100) * g;
    const gallons = Math.round(i.gallons * vol);
    const fuelGp = Math.round(gallons * i.cpg);
    const insideSales = Math.round(i.insideSales * vol);
    const insideGp = Math.round((insideSales * i.insideMarginPct) / 100);
    const kitchenSales = Math.round(i.kitchenSales * vol);
    const kitchenGp = kitchenSales - Math.round((kitchenSales * i.foodCostPct) / 100);
    const otherIncome = Math.round(i.otherIncome * vol);
    const incentive = cpgIncentives.reduce((a, x) => a + (n <= (x.months ?? 0) ? Math.round(gallons * (x.cpg ?? 0)) : 0), 0);
    const sales = Math.round(gallons * i.retailCpg) + insideSales + kitchenSales + otherIncome;
    const grossProfit = fuelGp + insideGp + kitchenGp + otherIncome + incentive;
    // Labor and the fixed lines grow with inflation, not with the ramp (a new store staffs up on day one).
    const cost = (c: Cents) => Math.round(c * g);
    const labor = cost(i.labor), occupancy = cost(i.occupancy), utilities = cost(i.utilities), repairs = cost(i.repairs), insurance = cost(i.insurance), propertyTax = cost(i.propertyTax), otherExpense = cost(i.otherExpense);
    const cardFees = Math.round(((sales - otherIncome) * i.cardFeePct) / 100);
    const opex = labor + occupancy + utilities + cardFees + repairs + insurance + propertyTax + otherExpense;
    const ebitda = grossProfit - opex;
    const row = sched[n - 1 + pf.monthsToOpen];
    const interest = row?.interest ?? 0, principal = row?.principal ?? 0;
    out.push({
      n, year, rampPct, gallons, fuelGp, insideSales, insideGp, kitchenSales, kitchenGp, otherIncome, incentive, sales, grossProfit,
      labor, occupancy, utilities, cardFees, repairs, insurance, propertyTax, otherExpense, opex, ebitda, interest, principal, debtService: interest + principal, cashAfterDebt: ebitda - interest - principal,
    });
  }
  return out;
}

export function sumMonths(ms: PfMonth[]): Record<(typeof PF_SUM_KEYS)[number], number> {
  const o = Object.fromEntries(PF_SUM_KEYS.map((k) => [k, 0])) as Record<(typeof PF_SUM_KEYS)[number], number>;
  for (const m of ms) for (const k of PF_SUM_KEYS) o[k] += m[k];
  return o;
}

export function proFormaResult(pf: ProForma, settings: Pick<GrowthSettings, 'discountRateBps'> = DEFAULT_GROWTH_SETTINGS): ProFormaResult {
  const months = proFormaMonths(pf);
  const years: PfYear[] = [];
  for (let y = 1; y <= PF_YEARS; y++) {
    const ms = months.filter((m) => m.year === y);
    const s = sumMonths(ms);
    years.push({ ...s, year: y, months: ms.length, dscr: s.debtService > 0 ? s.ebitda / s.debtService : null });
  }
  const ties = PF_SUM_KEYS.every((k) => years.reduce((a, y) => a + y[k], 0) === months.reduce((a, m) => a + m[k], 0));
  const capitalTotal = pf.capital.reduce((a, c) => a + c.amount, 0);
  const upfrontIncentives = pf.incentives.filter((x) => x.kind === 'upfront').reduce((a, x) => a + x.amount, 0);
  const loan = pf.financing.loanAmount;
  const equity = capitalTotal - upfrontIncentives - loan;
  const sched = loan > 0 ? projectSchedule(loan, pf.financing.rateBps, pf.financing.amortizationMonths, pf.financing.amortizationMonths) : [];
  const preOpeningDebtService = sched.slice(0, pf.monthsToOpen).reduce((a, r) => a + r.payment, 0);
  const exitIdx = pf.monthsToOpen + PF_YEARS * 12;
  const loanBalanceAtExit = loan > 0 ? (sched[exitIdx - 1]?.closing ?? 0) : 0;
  const horizonYears = exitIdx / 12;
  const residualRealEstate = Math.round(pf.realEstateValue * Math.pow(1 + pf.appreciationBps / 10000, horizonYears));
  const recoveredCapital = pf.capital.filter((c) => c.kind === 'inventory' || c.kind === 'working_capital').reduce((a, c) => a + c.amount, 0);
  const residual = residualRealEstate + recoveredCapital;
  const open = pf.monthsToOpen / 12;
  const unleveredFlows: Flow[] = [{ t: 0, amount: -(capitalTotal - upfrontIncentives), label: 'Capital less upfront incentives' }];
  const leveredFlows: Flow[] = [{ t: 0, amount: -equity - preOpeningDebtService, label: preOpeningDebtService ? 'Equity + debt service before opening' : 'Equity' }];
  for (const y of years) {
    const last = y.year === PF_YEARS;
    unleveredFlows.push({ t: open + y.year, amount: y.ebitda + (last ? residual : 0), label: `Year ${y.year} EBITDA${last ? ' + residual' : ''}` });
    leveredFlows.push({ t: open + y.year, amount: y.cashAfterDebt + (last ? residual - loanBalanceAtExit : 0), label: `Year ${y.year} cash after debt service${last ? ' + residual − loan payoff' : ''}` });
  }
  const r = settings.discountRateBps / 10000;
  const noResidual = (fs: Flow[], extra: Cents) => fs.map((f, i) => (i === fs.length - 1 ? { ...f, amount: f.amount - extra } : f));
  const ramped = Math.ceil(pf.inputs.ramp.length / 12) + 1;
  const stabilizedYear = Math.min(PF_YEARS, Math.max(2, ramped));
  const sy = years[stabilizedYear - 1];
  return {
    pf, months, years, capitalTotal, upfrontIncentives, loan, equity, preOpeningDebtService, loanBalanceAtExit, residual, residualRealEstate, recoveredCapital,
    unleveredFlows, leveredFlows, unleveredIrr: irr(unleveredFlows), leveredIrr: irr(leveredFlows),
    unleveredNpv: Math.round(npv(r, unleveredFlows)), leveredNpv: Math.round(npv(r, leveredFlows)),
    paybackYears: payback(noResidual(unleveredFlows, residual)), leveredPaybackYears: payback(noResidual(leveredFlows, residual - loanBalanceAtExit)),
    stabilizedYear, cashOnCash: equity > 0 ? sy.cashAfterDebt / equity : null, breakEven: breakEvenOf(pf, sy), ties,
  };
}

function breakEvenOf(pf: ProForma, y: PfYear): BreakEvenPf {
  const i = pf.inputs;
  const m = (v: number) => v / y.months;
  const fee = i.cardFeePct / 100;
  const gal = m(y.gallons), inside = m(y.insideSales), kitchen = m(y.kitchenSales);
  const fixed = m(y.opex - y.cardFees);
  const ds = m(y.debtService);
  const perGallon = i.cpg - fee * i.retailCpg;
  const insideC = i.insideMarginPct / 100 - fee;
  const kitchenC = 1 - i.foodCostPct / 100 - fee;
  // Other income and per-gallon incentives are fixed contributions at the stabilized volume.
  const other = m(y.otherIncome + y.incentive);
  const g = (extra: number) => (perGallon > 0 ? Math.max(0, Math.round((fixed + extra - insideC * inside - kitchenC * kitchen - other) / perGallon)) : null);
  const s = (extra: number) => (insideC > 0 ? Math.max(0, Math.round((fixed + extra - perGallon * gal - kitchenC * kitchen - other) / insideC)) : null);
  return { year: y.year, gallonsEbitda: g(0), gallonsAfterDebt: g(ds), insideEbitda: s(0), insideAfterDebt: s(ds), planGallons: Math.round(gal), planInside: Math.round(inside) };
}

/** A pro forma with some inputs changed (for sensitivity). */
export function tweak(pf: ProForma, x: { cpgDelta?: number; gallonsPct?: number; rateBpsDelta?: number }): ProForma {
  return {
    ...pf,
    inputs: { ...pf.inputs, cpg: pf.inputs.cpg + (x.cpgDelta ?? 0), gallons: Math.round(pf.inputs.gallons * (1 + (x.gallonsPct ?? 0) / 100)) },
    financing: { ...pf.financing, rateBps: Math.max(0, pf.financing.rateBps + (x.rateBpsDelta ?? 0)) },
  };
}

export interface Sensitivity {
  cpgSteps: number[];
  gallonSteps: number[];
  /** [gallon step][cpg step] */
  irrGrid: (number | null)[][];
  npvGrid: Cents[][];
  rateSteps: number[];
  rateRows: { delta: number; rateBps: number; leveredIrr: number | null; npv: Cents; dscr: number | null; cashOnCash: number | null }[];
}
/** ±2¢ margin × ±10% gallons (levered IRR and NPV), and ±1% on the loan rate. */
export function sensitivity(pf: ProForma, settings: Pick<GrowthSettings, 'discountRateBps'> = DEFAULT_GROWTH_SETTINGS): Sensitivity {
  const cpgSteps = [-2, -1, 0, 1, 2], gallonSteps = [-10, -5, 0, 5, 10], rateSteps = [-100, -50, 0, 50, 100];
  const irrGrid: (number | null)[][] = [], npvGrid: Cents[][] = [];
  for (const gp of gallonSteps) {
    const ri: (number | null)[] = [], rn: Cents[] = [];
    for (const c of cpgSteps) { const r = proFormaResult(tweak(pf, { cpgDelta: c, gallonsPct: gp }), settings); ri.push(r.leveredIrr); rn.push(r.leveredNpv); }
    irrGrid.push(ri); npvGrid.push(rn);
  }
  const rateRows = rateSteps.map((d) => {
    const r = proFormaResult(tweak(pf, { rateBpsDelta: d }), settings);
    return { delta: d, rateBps: Math.max(0, pf.financing.rateBps + d), leveredIrr: r.leveredIrr, npv: r.leveredNpv, dscr: r.years[r.stabilizedYear - 1].dscr, cashOnCash: r.cashOnCash };
  });
  return { cpgSteps, gallonSteps, irrGrid, npvGrid, rateSteps, rateRows };
}

// ── Prefill from a store's actuals ───────────────────────────────────────
const EXCLUDE_OPEX: ID[] = ['acct_depreciation', 'acct_disposal', 'acct_interest', 'acct_income_taxes', 'acct_ic_fees'];
const MAPPED: Record<string, keyof ProFormaInputs> = {
  acct_wages: 'labor', acct_payroll_taxes: 'labor', acct_rent: 'occupancy', acct_utilities: 'utilities', acct_repairs: 'repairs', acct_insurance: 'insurance', acct_property_tax: 'propertyTax',
};

/**
 * Monthly operating inputs from a store's statements over complete months: gallons from the POS, fuel margin and retail
 * price per gallon, inside and kitchen sales and margins by line of business, other income, and each expense line.
 * Card and network fees become a % of sales. Depreciation, interest and income taxes stay out (this is EBITDA).
 */
export function inputsFromStore(state: BooksState, storeId: ID, opts: { from: string; to: string; basis?: 'booked' | 'accrual'; entries?: BasisEntry[] }): { inputs: Omit<ProFormaInputs, 'ramp' | 'growthBps'>; months: number; source: string } {
  const basis = opts.basis ?? 'accrual';
  const st = statement(state, { basis, from: opts.from, to: opts.to, storeIds: [storeId], entries: opts.entries });
  const months = periodsBetween(opts.from, opts.to).length;
  const per = (v: number) => Math.round(v / months);
  const gallons = salesRows(state, { storeIds: [storeId], from: `${opts.from}-01`, to: lastDayOfPeriod(opts.to) }).reduce((a, r) => a + r.gallons, 0);
  const fuelSales = st.salesByLob.fuel.total, fuelGp = st.gpByLob.fuel.total;
  const inside = st.salesByLob.inside.total, insideGp = st.gpByLob.inside.total;
  const kitchen = st.salesByLob.kitchen.total, kitchenGp = st.gpByLob.kitchen.total;
  const other = st.salesByLob.other.total;
  const ex: Record<string, number> = { labor: 0, occupancy: 0, utilities: 0, repairs: 0, insurance: 0, propertyTax: 0, otherExpense: 0 };
  let fees = 0;
  for (const r of st.rows) {
    if (r.section !== 'expense' || EXCLUDE_OPEX.includes(r.account.id)) continue;
    if (r.account.id === 'acct_card_fees' || r.account.id === 'acct_network_fees') { fees += r.total; continue; }
    ex[MAPPED[r.account.id] ?? 'otherExpense'] += r.total;
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const salesExOther = st.netSales.total - other;
  const code = state.stores.find((s) => s.id === storeId)?.code ?? storeId;
  return {
    months,
    source: `Prefilled from ${code}, ${periodLabel(opts.from)}${opts.from === opts.to ? '' : ` – ${periodLabel(opts.to)}`} (${basis} basis, monthly average)`,
    inputs: {
      gallons: Math.round(gallons / months), cpg: gallons ? r2(fuelGp / gallons) : 0, retailCpg: gallons ? r2(fuelSales / gallons) : 0,
      insideSales: per(inside), insideMarginPct: inside ? r2((insideGp / inside) * 100) : 0,
      kitchenSales: per(kitchen), foodCostPct: kitchen ? r2(((kitchen - kitchenGp) / kitchen) * 100) : 0,
      otherIncome: per(other), labor: per(ex.labor), occupancy: per(ex.occupancy), utilities: per(ex.utilities), cardFeePct: salesExOther ? r2((fees / salesExOther) * 100) : 0,
      repairs: per(ex.repairs), insurance: per(ex.insurance), propertyTax: per(ex.propertyTax), otherExpense: per(ex.otherExpense),
    },
  };
}

// ── Buy vs build vs lease ────────────────────────────────────────────────
export interface OptionRow {
  pf: ProForma;
  r: ProFormaResult;
  upfrontCash: Cents;
  timeToOpen: number;
  residualRealEstate: Cents;
  risks: string[];
  /** Levered IRR with the build overrun spent (build only). */
  irrWithOverrun: number | null;
}
export function compareOptions(pfs: ProForma[], settings: Pick<GrowthSettings, 'discountRateBps'> = DEFAULT_GROWTH_SETTINGS): { rows: OptionRow[]; bestIrr?: ID; bestNpv?: ID; leastCash?: ID } {
  const rows = pfs.map((pf): OptionRow => {
    const r = proFormaResult(pf, settings);
    const risks = [...pf.risks];
    let irrWithOverrun: number | null = null;
    if (pf.mode === 'build' && pf.overrunPct > 0) {
      const construction = pf.capital.filter((c) => c.kind === 'construction' || c.kind === 'building').reduce((a, c) => a + c.amount, 0);
      const over = Math.round((construction * pf.overrunPct) / 100);
      irrWithOverrun = proFormaResult({ ...pf, capital: [...pf.capital, { label: 'Construction overrun', kind: 'other', amount: over }] }, settings).leveredIrr;
      risks.push(`Construction overrun: ${pf.overrunPct}% of construction is ${money(over)} more equity`);
    }
    if (pf.mode === 'buy') risks.push('Environmental: an existing site can carry contamination; Phase I/II before closing');
    if (pf.mode === 'lease') risks.push('Lease: no real estate at the end, and rent resets at renewal');
    return { pf, r, upfrontCash: r.equity, timeToOpen: pf.monthsToOpen, residualRealEstate: r.residualRealEstate, risks, irrWithOverrun };
  });
  const best = (f: (x: OptionRow) => number) => rows.length ? [...rows].sort((a, b) => f(b) - f(a))[0].pf.id : undefined;
  return { rows, bestIrr: best((x) => x.r.leveredIrr ?? -Infinity), bestNpv: best((x) => x.r.leveredNpv), leastCash: best((x) => -x.upfrontCash) };
}

// ── Site scorecard ───────────────────────────────────────────────────────
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
export function factorScores(s: SiteProfile): Record<SiteFactor, number> {
  const comp = s.competitors.reduce((a, c) => a - (c.distanceMi <= 1 ? 30 : c.distanceMi <= 2 ? 15 : c.distanceMi <= 3 ? 7 : 0), 100);
  return {
    aadt: clamp(s.aadt / 250), visibility: clamp(((s.visibility - 1) / 4) * 100), access: clamp(((s.access - 1) / 4) * 100), competition: clamp(comp),
    population: clamp(s.population / 150), growth: clamp(20 + s.growthBps * 0.4), truck: clamp(s.trucksPerDay / 10),
    zoning: { permitted: 100, conditional: 60, rezoning: 20, unknown: 40 }[s.zoning], environmental: { clean: 100, recs: 60, phase2: 30, contaminated: 0, unknown: 40 }[s.environmental],
    utilities: { all: 100, partial: 50, none: 0 }[s.utilities], income: clamp(s.medianIncome / 8000),
  };
}
export function siteScore(s: SiteProfile, weights: Record<SiteFactor, number>): number {
  const f = factorScores(s);
  const tw = SITE_FACTORS.reduce((a, x) => a + Math.max(0, weights[x.key] ?? 0), 0);
  if (!tw) return 0;
  return Math.round((SITE_FACTORS.reduce((a, x) => a + f[x.key] * Math.max(0, weights[x.key] ?? 0), 0) / tw) * 10) / 10;
}
export interface SiteRow { site: SiteProfile; scores: Record<SiteFactor, number>; score: number; vsExisting: number | null; rating: 'strong' | 'fair' | 'weak' }
export function siteScorecard(state: BooksState): { rows: SiteRow[]; existingAvg: number | null; weightTotal: number } {
  const g = growthOf(state);
  const rows0 = g.sites.map((site) => ({ site, scores: factorScores(site), score: siteScore(site, g.weights) }));
  const ex = rows0.filter((r) => r.site.kind === 'existing');
  const existingAvg = ex.length ? Math.round((ex.reduce((a, r) => a + r.score, 0) / ex.length) * 10) / 10 : null;
  const rows = rows0.map((r) => ({ ...r, vsExisting: existingAvg === null ? null : Math.round((r.score - existingAvg) * 10) / 10, rating: (r.score >= (existingAvg ?? 70) ? 'strong' : r.score >= (existingAvg ?? 70) - 15 ? 'fair' : 'weak') as SiteRow['rating'] }));
  return { rows, existingAvg, weightTotal: SITE_FACTORS.reduce((a, x) => a + (g.weights[x.key] ?? 0), 0) };
}

// ── Acquisitions ─────────────────────────────────────────────────────────
export interface AcqAnalysis {
  acq: Acquisition;
  revenue: Cents; cogs: Cents; expenses: Cents;
  reportedEbitda: Cents;
  addBacks: Cents; perks: Cents; normalizations: Cents;
  normalizedEbitda: Cents;
  gallons: { checks: { period: string; seller: number; supplier?: number; variancePct: number | null; flagged: boolean }[]; verified: boolean; annual: number; flagged: number };
  valuation: {
    multiple: { low: Cents; high: Cents };
    perGallon: { low: Cents; high: Cents };
    realEstatePlusBusiness: { realEstate: Cents; businessEbitda: Cents; low: Cents; high: Cents };
    low: Cents; mid: Cents; high: Cents;
  };
  purchase: { price: Cents; inventory: Cents; fuelInTank: Cents; total: Cents; loan: Cents; equity: Cents };
  dd: { total: number; done: number; issues: number; open: number; pct: number };
  qoe: { total: number; done: number };
}
export function analyzeAcquisition(acq: Acquisition, settings: Pick<GrowthSettings, 'multipleLow' | 'multipleHigh' | 'perGallonLow' | 'perGallonHigh'> = DEFAULT_GROWTH_SETTINGS): AcqAnalysis {
  const sec = (k: 'revenue' | 'cogs' | 'expense') => acq.sellerPnl.filter((l) => l.section === k).reduce((a, l) => a + l.amount, 0);
  const revenue = sec('revenue'), cogs = sec('cogs'), expenses = sec('expense');
  const reportedEbitda = revenue - cogs - expenses;
  const by = (k: AddBack['kind']) => acq.addBacks.filter((a) => a.kind === k).reduce((x, a) => x + a.amount, 0);
  const addBacks = by('addback'), perks = by('perk'), normalizations = by('normalize');
  const normalizedEbitda = reportedEbitda + addBacks + perks - normalizations;
  const checks = acq.gallonChecks.map((c) => {
    const variancePct = c.supplier ? ((c.seller - c.supplier) / c.supplier) * 100 : null;
    return { ...c, variancePct, flagged: variancePct !== null && Math.abs(variancePct) > GALLON_VARIANCE_PCT };
  });
  const sup = checks.filter((c) => c.supplier);
  const verified = sup.length > 0;
  const annual = verified ? Math.round((sup.reduce((a, c) => a + (c.supplier ?? 0), 0) * 12) / sup.length) : acq.sellerGallons;
  const x = (m: number) => Math.round((normalizedEbitda * m) / 100);
  const multiple = { low: x(settings.multipleLow), high: x(settings.multipleHigh) };
  const perGallon = { low: Math.round(annual * settings.perGallonLow), high: Math.round(annual * settings.perGallonHigh) };
  const businessEbitda = Math.max(0, normalizedEbitda - acq.marketRent);
  const re = { realEstate: acq.realEstateValue, businessEbitda, low: acq.realEstateValue + Math.round((businessEbitda * settings.multipleLow) / 100), high: acq.realEstateValue + Math.round((businessEbitda * settings.multipleHigh) / 100) };
  const lows = [multiple.low, perGallon.low, re.low], highs = [multiple.high, perGallon.high, re.high];
  const low = Math.min(...lows), high = Math.max(...highs);
  const mid = Math.round([...lows, ...highs].reduce((a, v) => a + v, 0) / 6);
  const inventory = acq.insideInventoryAtCost, fuelInTank = Math.round(acq.fuelGallonsInTank * acq.fuelCostCpg);
  const total = acq.offerPrice + inventory + fuelInTank;
  const live = acq.dd.filter((d) => d.status !== 'na');
  const done = live.filter((d) => d.status === 'done').length;
  return {
    acq, revenue, cogs, expenses, reportedEbitda, addBacks, perks, normalizations, normalizedEbitda,
    gallons: { checks, verified, annual, flagged: checks.filter((c) => c.flagged).length },
    valuation: { multiple, perGallon, realEstatePlusBusiness: re, low, mid, high },
    purchase: { price: acq.offerPrice, inventory, fuelInTank, total, loan: acq.financing.loanAmount, equity: total - acq.financing.loanAmount },
    dd: { total: live.length, done, issues: live.filter((d) => d.status === 'issue').length, open: live.length - done, pct: live.length ? done / live.length : 1 },
    qoe: { total: acq.qoe.length, done: acq.qoe.filter((q) => q.done).length },
  };
}
export const DEFAULT_QOE: { key: string; label: string }[] = [
  { key: 'deposits', label: 'Bank deposits tie to reported sales' }, { key: 'fuel', label: 'Fuel gallons tie to supplier statements' },
  { key: 'pos', label: 'Inside sales tie to POS reports' }, { key: 'payroll', label: 'Payroll ties to payroll tax returns' },
  { key: 'salestax', label: 'Sales tax returns agree with reported sales' }, { key: 'inventory', label: 'Inventory counted at closing' },
  { key: 'addbacks', label: 'Every add-back supported by a document' }, { key: 'related', label: 'Related-party and owner transactions identified' },
  { key: 'cutoff', label: 'Payables and accruals cut off at the month end' }, { key: 'lottery', label: 'Lottery settlements reconciled' },
];
export const DEFAULT_DD: { area: DdItem['area']; title: string }[] = [
  { area: 'phase1', title: 'Phase I environmental site assessment' }, { area: 'phase2', title: 'Phase II sampling (if the Phase I finds RECs)' },
  { area: 'ust', title: 'UST registration, tank and line tests, release history' }, { area: 'title', title: 'Title commitment, survey and easements' },
  { area: 'permits', title: 'Permits and licenses transfer (beer, tobacco, food, fire)' }, { area: 'supply', title: 'Fuel supply contract: term, volume commitments, rebranding costs' },
];

/** The acquisition as a pro forma: normalized EBITDA held flat (grown at the growth rate), financed as entered. */
export function acquisitionProForma(state: BooksState, acq: Acquisition): ProForma {
  const linked = growthOf(state).proFormas.find((p) => p.acquisitionId === acq.id);
  if (linked) return linked;
  const a = analyzeAcquisition(acq, growthOf(state).settings);
  const monthly = Math.round(a.normalizedEbitda / 12);
  return {
    id: `acq:${acq.id}`, name: acq.name, mode: 'buy', acquisitionId: acq.id, source: 'Normalized seller EBITDA, held flat', monthsToOpen: 0,
    inputs: { gallons: Math.round(a.gallons.annual / 12), cpg: 0, retailCpg: 0, insideSales: 0, insideMarginPct: 0, kitchenSales: 0, foodCostPct: 0, otherIncome: monthly, labor: 0, occupancy: 0, utilities: 0, cardFeePct: 0, repairs: 0, insurance: 0, propertyTax: 0, otherExpense: 0, ramp: [], growthBps: 0 },
    capital: [{ label: 'Purchase price', kind: 'building', amount: acq.offerPrice }, { label: 'Inside inventory at cost', kind: 'inventory', amount: a.purchase.inventory }, { label: 'Fuel in the tanks', kind: 'inventory', amount: a.purchase.fuelInTank }],
    incentives: [], financing: acq.financing, realEstateValue: acq.realEstateValue, appreciationBps: 0, overrunPct: 0, risks: [], updatedAt: '', updatedBy: '',
  };
}

// ── Expansion readiness scorecard ────────────────────────────────────────
export interface Check { key: string; label: string; status: Rag; value: string; target: string; detail: string; to: string }
export interface Scorecard {
  asOf: string;
  period: string;
  overall: Rag;
  checks: Check[];
  metrics?: MonthMetrics;
  deal?: { pf: ProForma; r: ProFormaResult; addedDebtService: Cents; addedEbitda: Cents };
  reserve: ReserveTarget;
  equityNeed: Cents;
}

export function overallOf(statuses: Rag[]): Rag {
  if (statuses.some((s) => s === 'red')) return 'red';
  if (statuses.length && statuses.every((s) => s === 'green')) return 'green';
  return 'amber';
}

export function dealProForma(state: BooksState): ProForma | undefined {
  const g = growthOf(state);
  return g.proFormas.find((p) => p.id === g.settings.dealProFormaId) ?? g.proFormas.find((p) => p.mode === 'build') ?? g.proFormas[0];
}

/** The most recently opened operating store. */
export function newestStore(state: BooksState) {
  return state.stores.filter((s) => !s.deleted && s.kind === 'operating' && s.openedOn).sort((a, b) => b.openedOn!.localeCompare(a.openedOn!))[0];
}

export interface RampRow { period: string; days: number; daysInMonth: number; target: { gallons: number; insideSales: Cents; ebitda: Cents }; actual: { gallons: number; insideSales: Cents; ebitda: Cents }; gallonsPct: number | null; insidePct: number | null; status: Rag }
/** Actual vs ramp targets by month; a month in progress compares with its target prorated by the days with POS sales. */
export function rampCheck(state: BooksState, storeId: ID, asOf: string, entries?: BasisEntry[]): { plan?: RampPlan; rows: RampRow[]; latest?: RampRow } {
  const plan = growthOf(state).ramps.find((r) => r.storeId === storeId);
  if (!plan) return { rows: [] };
  const ents = entries ?? basisEntries(state);
  const rows: RampRow[] = [];
  for (const t of plan.targets) {
    if (`${t.period}-01` > asOf) continue;
    const end = lastDayOfPeriod(t.period) < asOf ? lastDayOfPeriod(t.period) : asOf;
    const sales = salesRows(state, { storeIds: [storeId], from: `${t.period}-01`, to: end });
    const days = new Set(sales.map((r) => r.date)).size;
    if (!days) continue;
    const dim = Number(lastDayOfPeriod(t.period).slice(8, 10));
    const share = days / dim;
    const st = statement(state, { basis: 'booked', from: t.period, to: t.period, storeIds: [storeId], entries: ents });
    const da = st.rows.filter((r) => ['acct_interest', 'acct_depreciation', 'acct_disposal'].includes(r.account.id)).reduce((a, r) => a + r.total, 0);
    const actual = { gallons: Math.round(sales.reduce((a, r) => a + r.gallons, 0)), insideSales: st.salesByLob.inside.total, ebitda: st.netIncome.total + da };
    const target = { gallons: Math.round(t.gallons * share), insideSales: Math.round(t.insideSales * share), ebitda: Math.round(t.ebitda * share) };
    const gallonsPct = target.gallons ? actual.gallons / target.gallons : null;
    const insidePct = target.insideSales ? actual.insideSales / target.insideSales : null;
    const worst = Math.min(gallonsPct ?? 1, insidePct ?? 1);
    rows.push({ period: t.period, days, daysInMonth: dim, target, actual, gallonsPct, insidePct, status: worst >= 1 ? 'green' : worst >= 0.85 ? 'amber' : 'red' });
  }
  return { plan, rows, latest: rows.at(-1) };
}

/** Months that closed on time: locked by the lock step's due date. Months whose due date hasn't come are pending. */
export function closeOnTime(state: BooksState, asOf: string, n: number): { months: { period: string; due: string; lockedOn?: string; onTime: boolean | null }[]; onTime: number; needed: number } {
  const first = firstBooksPeriod(state);
  const last = lastCompleteMonth(asOf);
  const all = first && last >= first ? periodsBetween(first, last) : [];
  const months = all.slice(-n).map((period) => {
    const due = dueDate(state, period, 'lock');
    const p = state.periods[period];
    const lockedOn = p?.status === 'locked' ? p.lockedAt?.slice(0, 10) : undefined;
    return { period, due, lockedOn, onTime: lockedOn ? lockedOn <= due : due >= asOf ? null : false };
  });
  return { months, onTime: months.filter((m) => m.onTime).length, needed: n };
}

/** Same-store profit by complete quarter (booked net income of the stores open for the whole span). */
export function sameStoreQuarters(state: BooksState, asOf: string, entries?: BasisEntry[]): { quarters: { q: string; net: Cents; change: number | null }[]; stores: ID[] } {
  const first = firstBooksPeriod(state);
  if (!first) return { quarters: [], stores: [] };
  const qs: string[] = [];
  let q = quarterOf(lastDayOfPeriod(lastCompleteMonth(asOf)));
  if (quarterRange(q).to > lastCompleteMonth(asOf)) q = prevQuarter(q);
  while (quarterRange(q).from >= first) { qs.unshift(q); q = prevQuarter(q); }
  const start = qs[0] ? `${quarterRange(qs[0]).from}-01` : '';
  const stores = state.stores.filter((s) => !s.deleted && s.kind === 'operating' && (!s.openedOn || s.openedOn <= start)).map((s) => s.id);
  const ents = entries ?? basisEntries(state);
  const out: { q: string; net: Cents; change: number | null }[] = [];
  for (const x of qs) {
    const r = quarterRange(x);
    const net = statement(state, { basis: 'booked', from: r.from, to: r.to, storeIds: stores, entries: ents }).netIncome.total;
    const prev = out.at(-1);
    out.push({ q: x, net, change: prev && prev.net ? (net - prev.net) / Math.abs(prev.net) : null });
  }
  return { quarters: out, stores };
}

export function expansionScorecard(state: BooksState, asOf: string, opts: { entries?: BasisEntry[] } = {}): Scorecard {
  const g = growthOf(state);
  const s = g.settings;
  const entries = opts.entries ?? basisEntries(state);
  const ds = debtOf(state).settings;
  const all = covenantMetrics(state, asOf, { entries, settings: ds });
  const m = headlineMetrics(all, ds);
  const period = m?.period ?? lastCompleteMonth(asOf);
  const checks: Check[] = [];

  // 1. TTM EBITDA and trend.
  const complete = all.filter((x) => !x.provisional);
  const monthly = complete.map((x) => statementEbitda(state, x.period, entries));
  const last = monthly.at(-1), prior = monthly.at(-2);
  const trend = last !== undefined && prior !== undefined ? (last >= prior ? 'up' : 'down') : null;
  const ebitda = m?.ebitdaAnnual ?? 0;
  checks.push({
    key: 'ebitda', label: 'TTM EBITDA and trend', status: !m ? 'na' : ebitda <= 0 ? 'red' : trend === 'down' ? 'amber' : 'green',
    value: m ? money(ebitda) : '–', target: 'Positive and not falling',
    detail: m ? `${m.annualized ? `Annualized from ${m.months} month${m.months === 1 ? '' : 's'} (× ${m.factor.toFixed(1)}), not a true trailing twelve months. ` : ''}Monthly EBITDA ${monthly.map((v, i) => `${periodLabel(complete[i].period)} ${money(v)}`).join(', ')}${trend ? `: ${trend === 'up' ? 'up' : 'down'} on the month before` : ''}.` : 'No complete month on the books yet.',
    to: '/debt/covenants',
  });

  // 2. Three consecutive quarters of stable or growing same-store profit.
  const ss = sameStoreQuarters(state, asOf, entries);
  const changes = ss.quarters.map((x) => x.change).filter((c): c is number => c !== null);
  const need = 3;
  const lastN = changes.slice(-need);
  const stable = lastN.every((c) => c >= -s.stableDropPct / 100);
  checks.push({
    key: 'samestore', label: '3 quarters of stable or growing same-store profit', status: changes.length < need ? 'na' : stable ? 'green' : lastN.filter((c) => c < -s.stableDropPct / 100).length === 1 ? 'amber' : 'red',
    value: `${changes.length} of ${need} quarters`, target: `Each quarter within −${s.stableDropPct}% of the one before`,
    detail: changes.length < need ? `Not enough history: ${ss.quarters.length} complete quarter${ss.quarters.length === 1 ? '' : 's'} on the books (${ss.quarters.map((x) => quarterLabel(x.q)).join(', ') || 'none'}); three quarter-on-quarter comparisons need four.` : lastN.map((c, i) => `${quarterLabel(ss.quarters[ss.quarters.length - need + i].q)} ${c >= 0 ? '+' : ''}${pct1(c)}`).join(', '),
    to: '/reports/pnl',
  });

  // 3. Every store at or above break-even (stores past their first year), with a fix plan for any below.
  const newest = newestStore(state);
  const window = complete.slice(-3).map((x) => x.period);
  const mature = state.stores.filter((st) => !st.deleted && st.kind === 'operating' && (!st.openedOn || st.openedOn <= addDays(asOf, -365))).map((st) => st.id);
  const be = window.length ? breakEven(state, { from: window[0], to: window.at(-1)!, storeIds: mature, entries }) : [];
  const below = be.filter((r) => r.breakEvenSales === null || r.sales < r.breakEvenSales);
  const plans = (id: ID) => g.fixPlans.filter((f) => f.storeId === id);
  const unplanned = below.filter((r) => !plans(r.storeId).length);
  const code = (id: ID) => state.stores.find((x) => x.id === id)?.code ?? id;
  checks.push({
    key: 'breakeven', label: 'Every store at or above break-even', status: !be.length ? 'na' : !below.length ? 'green' : unplanned.length ? 'red' : 'amber',
    value: be.length ? `${be.length - below.length} of ${be.length} stores` : '–', target: 'Sales ≥ break-even sales (accrual), fix plan for any below',
    detail: !be.length ? 'No complete month on the books.' : `${window.map(periodLabel).join(' – ')}: ` + be.map((r) => `${code(r.storeId)} ${money(r.sales)} vs ${r.breakEvenSales === null ? 'no break-even' : money(r.breakEvenSales)}${below.includes(r) ? (plans(r.storeId).length ? ' (below; fix plan on file)' : ' (below; no fix plan)') : ''}`).join('; ') + (newest && !mature.includes(newest.id) ? `. ${newest.code} is in its ramp year and is tested against its ramp targets instead.` : '.'),
    to: '/growth/readiness',
  });

  // 4. Reserve met plus equity for the next deal.
  const reserve = reserveTarget(state, asOf, { entries });
  const deal = dealProForma(state);
  const dr = deal ? proFormaResult(deal, s) : undefined;
  const equityNeed = dr ? Math.max(0, dr.equity + dr.preOpeningDebtService) : ds.nextStoreEquity;
  const plan = paydownPlan(state, asOf, { entries, metrics: m });
  const free = plan.effects.monthlyFreeCashBefore;
  const toFund = reserve.deployable >= equityNeed ? 0 : free > 0 ? Math.ceil((equityNeed - Math.max(0, reserve.deployable)) / free) : null;
  checks.push({
    key: 'reserve', label: 'Reserve met plus equity on hand for the next deal', status: reserve.deployable < 0 ? 'red' : reserve.deployable >= equityNeed ? 'green' : 'amber',
    value: `${money(Math.max(0, reserve.deployable))} deployable`, target: `Reserve ${money(reserve.target)} + equity ${money(equityNeed)}`,
    detail: reserve.deployable < 0 ? `Cash is ${money(-reserve.deployable)} short of the reserve target.` : reserve.deployable >= equityNeed ? `Cash above the reserve covers the ${deal ? deal.name : 'next store'} equity.` : `Short ${money(equityNeed - reserve.deployable)} of the equity${deal ? ` for ${deal.name}` : ''}; ${toFund === null ? 'free cash flow does not close the gap' : `about ${toFund} month${toFund === 1 ? '' : 's'} of free cash flow (${money(free)} a month)`}.`,
    to: '/debt/reserve',
  });

  // 5 & 6. DSCR and leverage after the projected new debt.
  const y1 = dr?.years[0];
  const addedDebtService = y1?.debtService ?? 0, addedEbitda = y1?.ebitda ?? 0;
  const dscrAfter = m && dr ? dscrWithNewDebt(m, addedDebtService, addedEbitda) : m?.dscr ?? null;
  const tgt = s.dscrTarget / 100;
  checks.push({
    key: 'dscr', label: 'DSCR at or above target after the new debt', status: dscrAfter === null ? 'na' : dscrAfter >= tgt * 1.1 ? 'green' : dscrAfter >= tgt ? 'amber' : 'red',
    value: ratioX(dscrAfter), target: `≥ ${tgt.toFixed(2)}x`,
    detail: m ? `Company ${ratioX(m.dscr)} today (${money(m.ebitdaAnnual)} EBITDA ÷ ${money(m.debtServiceAnnual)} debt service a year)${dr ? `; adding ${deal!.name}: ${money(addedDebtService)} of year-1 debt service and ${money(addedEbitda)} of year-1 EBITDA.` : '; no deal pro forma to test.'} Within 10% of the target is amber.` : 'No covenant metrics yet.',
    to: '/growth/evaluate',
  });
  const debtAfter = (m?.debt ?? 0) + (dr?.loan ?? 0);
  const ebitdaAfter = (m?.ebitdaAnnual ?? 0) + addedEbitda;
  const levAfter = ebitdaAfter > 0 ? debtAfter / ebitdaAfter : debtAfter > 0 ? Infinity : 0;
  const lt = s.leverageTarget / 100;
  checks.push({
    key: 'leverage', label: 'Leverage at or below target after the deal', status: !m ? 'na' : levAfter <= lt * 0.9 ? 'green' : levAfter <= lt ? 'amber' : 'red',
    value: ratioX(levAfter), target: `≤ ${lt.toFixed(2)}x debt ÷ EBITDA`,
    detail: `${money(debtAfter)} of debt (${money(m?.debt ?? 0)} today${dr ? ` + ${money(dr.loan)} new loan` : ''}) ÷ ${money(ebitdaAfter)} EBITDA (company + the deal's year 1). Within 10% of the target is amber.`,
    to: '/growth/evaluate',
  });

  // 7. Management bandwidth.
  const ct = closeOnTime(state, asOf, s.closeOnTimeMonths);
  const closeOk = ct.onTime >= ct.needed;
  const late = ct.months.filter((x) => x.onTime === false);
  checks.push({
    key: 'management', label: 'Management bandwidth', status: s.managerReady && closeOk ? 'green' : s.managerReady || closeOk ? 'amber' : 'red',
    value: `${s.managerReady ? 'Manager ready' : 'No manager ready'} · ${ct.onTime} of ${ct.needed} closes on time`, target: `A manager ready to promote; books closed on time ${ct.needed} months running`,
    detail: `${s.managerReady ? `Manager ready${s.managerNote ? `: ${s.managerNote}` : ''}.` : 'Nobody marked ready to promote.'} Closes: ${ct.months.map((x) => `${periodLabel(x.period)} ${x.onTime === null ? `due ${x.due}` : x.onTime ? `locked ${x.lockedOn} (on time)` : x.lockedOn ? `locked ${x.lockedOn}, due ${x.due}` : `not locked, due ${x.due}`}`).join('; ') || 'none yet'}${ct.months.length < ct.needed ? ` (only ${ct.months.length} month${ct.months.length === 1 ? '' : 's'} on the books)` : ''}${late.length ? '.' : '.'}`,
    to: '/close/periods',
  });

  // 8. The most recent store hit its ramp targets.
  const rc = newest ? rampCheck(state, newest.id, asOf, entries) : { rows: [] as RampRow[], latest: undefined, plan: undefined };
  const lr = rc.latest;
  checks.push({
    key: 'ramp', label: `Most recent store hit its ramp targets${newest ? ` (${newest.code})` : ''}`, status: !lr ? 'na' : lr.status,
    value: lr ? `${lr.gallonsPct === null ? '–' : pct1(lr.gallonsPct)} gallons · ${lr.insidePct === null ? '–' : pct1(lr.insidePct)} inside` : '–', target: '100% of the pro forma ramp (85% is amber)',
    detail: !newest ? 'No store with an opening date.' : !rc.plan ? `No ramp targets entered for ${newest.code}.` : !lr ? 'No sales yet in a target month.' : `${periodLabel(lr.period)} (${lr.days} of ${lr.daysInMonth} days, targets prorated): ${Math.round(lr.actual.gallons).toLocaleString('en-US')} gallons vs ${lr.target.gallons.toLocaleString('en-US')}; inside ${money(lr.actual.insideSales)} vs ${money(lr.target.insideSales)}.`,
    to: '/growth/readiness#ramp',
  });

  return { asOf, period, overall: overallOf(checks.map((c) => c.status)), checks, metrics: m, deal: deal && dr ? { pf: deal, r: dr, addedDebtService, addedEbitda } : undefined, reserve, equityNeed };
}

function statementEbitda(state: BooksState, period: string, entries: BasisEntry[]): Cents {
  const st = statement(state, { basis: debtOf(state).settings.ratioBasis, from: period, to: period, storeIds: state.stores.map((x) => x.id), entries });
  return st.netIncome.total + st.rows.filter((r) => ['acct_interest', 'acct_depreciation', 'acct_disposal'].includes(r.account.id)).reduce((a, r) => a + r.total, 0);
}

/** Live result vs the last recorded month: an alert when the overall turns green or drops to red. */
export function scorecardChange(state: BooksState, live: Pick<Scorecard, 'overall' | 'period'>): { previous?: ScoreRecord; changed: boolean; to?: Rag; message: string } {
  const hist = [...growthOf(state).scoreHistory].sort((a, b) => a.period.localeCompare(b.period));
  const previous = hist.filter((h) => h.period < live.period).at(-1) ?? (hist.at(-1)?.period === live.period ? undefined : hist.at(-1));
  if (!previous) return { changed: false, message: 'No earlier month recorded to compare with.' };
  const changed = previous.overall !== live.overall && (live.overall === 'green' || live.overall === 'red');
  const message = changed
    ? `The expansion scorecard ${live.overall === 'green' ? 'turned green' : 'dropped to red'}: ${RAG_LABEL[previous.overall].toLowerCase()} for ${periodLabel(previous.period)}, ${RAG_LABEL[live.overall].toLowerCase()} for ${periodLabel(live.period)}.`
    : `${RAG_LABEL[live.overall]} for ${periodLabel(live.period)}; ${RAG_LABEL[previous.overall].toLowerCase()} for ${periodLabel(previous.period)}.`;
  return { previous, changed, to: changed ? live.overall : undefined, message };
}

// ── Owner returns & distributions ────────────────────────────────────────
export interface OwnerRow { partyId: ID; name: string; drawsYtd: Cents; distributionsYtd: Cents; priorYtd: Cents; ytd: Cents; booksLifetime: Cents; priorLifetime: Cents; lifetime: Cents }
const DIST_TAG = 'distribution';

/** Every owner's withdrawals and distributions: from the ledger (owner draws under either policy), plus what came before these books. */
export function distributionsByOwner(state: BooksState, asOf: string): { rows: OwnerRow[]; ytd: Cents; lifetime: Cents; year: number } {
  const year = Number(asOf.slice(0, 4));
  const fyStart = `${year}-${String(state.settings.fiscalYearStartMonth).padStart(2, '0')}-01`;
  const from = fyStart <= asOf ? fyStart : `${year - 1}-${fyStart.slice(5)}`;
  const g = growthOf(state);
  const ytd = ownerDraws(state, { from, to: asOf });
  const life = ownerDraws(state, { from: '0000-01-01', to: asOf });
  const owners = state.parties.filter((p) => p.type === 'owner' && !p.deleted);
  const rows = owners.map((p): OwnerRow => {
    const mine = ytd.rows.filter((r) => r.ownerId === p.id);
    const dist = mine.filter((r) => r.t.tags.includes(DIST_TAG)).reduce((a, r) => a + r.amount, 0);
    const all = mine.reduce((a, r) => a + r.amount, 0);
    const prior = g.priorDistributions.filter((x) => x.partyId === p.id);
    const priorYtd = prior.filter((x) => x.year === year).reduce((a, x) => a + x.ytd, 0);
    const priorLifetime = prior.reduce((a, x) => Math.max(a, x.lifetime), 0);
    const booksLifetime = life.byOwner.get(p.id) ?? 0;
    return { partyId: p.id, name: p.name, drawsYtd: all - dist, distributionsYtd: dist, priorYtd, ytd: all + priorYtd, booksLifetime, priorLifetime, lifetime: booksLifetime + priorLifetime };
  });
  return { rows, ytd: rows.reduce((a, r) => a + r.ytd, 0), lifetime: rows.reduce((a, r) => a + r.lifetime, 0), year };
}

/** Recorded distributions vs the ledger: each one's transaction exists and carries exactly its amount on owner draws. */
export function distributionTie(state: BooksState): { recorded: Cents; ledger: Cents; ok: boolean; missing: ID[] } {
  const g = growthOf(state);
  let ledger = 0;
  const missing: ID[] = [];
  for (const d of g.distributions) {
    const t = state.transactions.find((x) => x.id === d.txnId && !x.deleted);
    if (!t) { missing.push(d.id); continue; }
    ledger += t.lines.filter((l) => l.accountId === 'acct_owner_draws' && !l.system).reduce((a, l) => a + l.debit - l.credit, 0);
  }
  const recorded = g.distributions.reduce((a, d) => a + d.amount, 0);
  return { recorded, ledger, ok: recorded === ledger && !missing.length, missing };
}

export interface SafeDistribution {
  asOf: string;
  cash: Cents;
  reserveTarget: Cents;
  aboveReserve: Cents;
  capex: { id: ID; name: string; start?: string; amount: Cents }[];
  capexTotal: Cents;
  taxDue: { label: string; dueDate: string; amount: Cents }[];
  taxTotal: Cents;
  cushionMonths: number;
  cushion: Cents;
  /** above − capex − tax − cushion (may be negative). */
  raw: Cents;
  safe: Cents;
  reserve: ReserveTarget;
}

/**
 * Safe distribution (SPEC §4.21) = cash above the reserve target − near-term capex (approved or in-progress capital
 * projects starting within the window) − entity tax estimates due within the window − a cushion of N months of
 * scheduled company debt service. Never below zero.
 */
export function safeDistribution(state: BooksState, asOf: string, opts: { entries?: BasisEntry[] } = {}): SafeDistribution {
  const s = growthOf(state).settings;
  const reserve = reserveTarget(state, asOf, { entries: opts.entries });
  const horizon = addDays(asOf, s.capexWindowDays);
  const capex = growthOf(state).projects.filter((p) => (p.status === 'approved' || p.status === 'in_progress') && (!p.start || p.start <= horizon)).map((p) => ({ id: p.id, name: p.name, start: p.start, amount: p.cost }));
  const taxHorizon = addDays(asOf, s.taxWindowDays);
  const taxDue = estimates(state, asOf).filter((e) => e.plan.payer === 'entity').flatMap((e) => e.installments.filter((i) => !i.done && i.short > 0 && i.dueDate <= taxHorizon).map((i) => ({ label: `${state.entities.find((x) => x.id === e.plan.entityId)?.code ?? 'Entity'} ${e.plan.jurisdiction} estimate Q${i.quarter}`, dueDate: i.dueDate, amount: i.short })));
  const cushionEnd = lastDayOfPeriod(addMonthsP(periodOf(asOf), s.debtCushionMonths));
  const cushion = loansOf(state).filter((l) => l.heldBy === 'company').flatMap((l) => amortization(l)).filter((r) => r.date > asOf && r.date <= cushionEnd).reduce((a, r) => a + r.interest + (r.balloon ? 0 : r.principal), 0);
  const capexTotal = capex.reduce((a, c) => a + c.amount, 0);
  const taxTotal = taxDue.reduce((a, t) => a + t.amount, 0);
  const raw = reserve.deployable - capexTotal - taxTotal - cushion;
  return { asOf, cash: reserve.cash, reserveTarget: reserve.target, aboveReserve: reserve.deployable, capex, capexTotal, taxDue, taxTotal, cushionMonths: s.debtCushionMonths, cushion, raw, safe: Math.max(0, raw), reserve };
}

/** The safe distribution at each month end in the books and today. */
export function safeDistributionHistory(state: BooksState, asOf: string, opts: { entries?: BasisEntry[] } = {}): { date: string; safe: Cents; aboveReserve: Cents }[] {
  const first = firstBooksPeriod(state);
  if (!first) return [];
  const entries = opts.entries ?? basisEntries(state);
  const dates = periodsBetween(first, periodOf(asOf)).map((p) => lastDayOfPeriod(p)).filter((d) => d < asOf);
  dates.push(asOf);
  return dates.map((date) => { const x = safeDistribution(state, date, { entries }); return { date, safe: x.safe, aboveReserve: x.aboveReserve }; });
}

/** Tax distributions (Phase 11) against the safe amount: what still has to go to the owners for their tax. */
export function taxDistributionCover(state: BooksState, asOf: string, safe: Cents) {
  const td = taxDistributions(state, { year: Number(asOf.slice(0, 4)), asOf });
  const still = td.rows.reduce((a, r) => a + r.remaining, 0);
  return { ...td, still, covered: safe >= still };
}

export interface ReturnRow { storeId: ID; entityId: ID; code: string; netIncome: Cents; interest: Cents; annualNet: Cents; annualNopat: Cents; equity: Cents; debt: Cents; investedCapital: Cents; roe: number | null; roic: number | null; months: number }
/**
 * ROE and ROIC by store, from each store entity's balance sheet at the latest complete month end: ROE = annualized net
 * income ÷ the entity's equity; ROIC = annualized (net income + interest) ÷ (equity + loans on its books). Related-party
 * mortgages are not on the store's books (the store pays rent), so they are not in its capital.
 */
export function returnsByStore(state: BooksState, asOf: string, opts: { entries?: BasisEntry[] } = {}): ReturnRow[] {
  const first = firstBooksPeriod(state);
  const last = lastCompleteMonth(asOf);
  if (!first || last < first) return [];
  const entries = opts.entries ?? basisEntries(state);
  const date = lastDayOfPeriod(last);
  const out: ReturnRow[] = [];
  for (const st of state.stores.filter((x) => !x.deleted && x.kind === 'operating')) {
    let from = st.openedOn && periodOf(st.openedOn) > first ? periodOf(st.openedOn) : first;
    if (from < addMonthsP(last, -11)) from = addMonthsP(last, -11);
    if (from > last) continue;
    const months = periodsBetween(from, last).length;
    const s = statement(state, { basis: 'booked', from, to: last, storeIds: [st.id], entries });
    const interest = s.rows.filter((r) => r.account.id === 'acct_interest').reduce((a, r) => a + r.total, 0);
    const bs = balanceSheet(state, { asOf: date, entityId: st.entityId });
    const debt = bs.sections.find((x) => x.key === 'liabilities')?.groups.find((x) => x.key === 'loan')?.total ?? 0;
    const equity = bs.totalEquity;
    const f = 12 / months;
    const annualNet = Math.round(s.netIncome.total * f), annualNopat = Math.round((s.netIncome.total + interest) * f);
    const investedCapital = equity + debt;
    out.push({ storeId: st.id, entityId: st.entityId, code: st.code, netIncome: s.netIncome.total, interest, annualNet, annualNopat, equity, debt, investedCapital, roe: equity > 0 ? annualNet / equity : null, roic: investedCapital > 0 ? annualNopat / investedCapital : null, months });
  }
  return out;
}

// ── Capital allocation ──────────────────────────────────────────────────
export interface CapitalUse {
  key: string;
  label: string;
  kind: 'project' | 'debt' | 'distribution' | 'reserve';
  projectKind?: CapitalProject['kind'];
  amount: Cents;
  /** Expected annual return as a fraction (null: not a return, e.g. a distribution). */
  expectedReturn: number | null;
  risk: RiskLevel;
  riskAdjusted: number;
  paybackYears: number | null;
  strategic: number;
  note: string;
  to: string;
  status?: CapitalProject['status'];
}
export interface CapitalPlan { asOf: string; deployable: Cents; uses: CapitalUse[]; allocations: { use: CapitalUse; amount: Cents }[]; unallocated: Cents; safe: SafeDistribution }

/** Every competing use of cash on one list, ranked by risk-adjusted return, with deployable cash allocated down it. */
export function capitalAllocation(state: BooksState, asOf: string, opts: { entries?: BasisEntry[] } = {}): CapitalPlan {
  const g = growthOf(state);
  const entries = opts.entries ?? basisEntries(state);
  const plan = paydownPlan(state, asOf, { entries });
  const safe = safeDistribution(state, asOf, { entries });
  const deployable = plan.reserve.deployable;
  const uses: CapitalUse[] = [];
  for (const p of g.projects.filter((x) => x.status !== 'done' && x.status !== 'declined')) {
    const pf = p.proFormaId ? g.proFormas.find((x) => x.id === p.proFormaId) : undefined;
    const r = pf ? proFormaResult(pf, g.settings) : undefined;
    const amount = r ? Math.max(0, r.equity) : p.cost;
    const expectedReturn = r ? r.cashOnCash : p.cost ? p.annualReturn / p.cost : null;
    const pb = r ? r.leveredPaybackYears : p.annualReturn > 0 ? p.cost / p.annualReturn : null;
    uses.push({
      key: p.id, label: p.name, kind: 'project', projectKind: p.kind, amount, expectedReturn, risk: p.risk, riskAdjusted: (expectedReturn ?? 0) * RISK_FACTOR[p.risk], paybackYears: pb, strategic: p.strategic,
      note: r ? `Equity for ${pf!.name}: stabilized cash-on-cash ${pct1(r.cashOnCash ?? 0)}, levered IRR ${r.leveredIrr === null ? '–' : pct1(r.leveredIrr)}` : `${money(p.annualReturn)} a year on ${money(p.cost)}`, to: pf ? `/growth/pro-forma?id=${pf.id}` : '/growth/capital', status: p.status,
    });
  }
  for (const d of plan.debts) {
    uses.push({ key: `debt:${d.key}`, label: `Pay down ${d.label}`, kind: 'debt', amount: d.amount, expectedReturn: d.afterTaxBps / 10000, risk: 'low', riskAdjusted: d.afterTaxBps / 10000, paybackYears: null, strategic: 3, note: `${(d.rateBps / 100).toFixed(2)}% rate, ${(d.afterTaxBps / 100).toFixed(2)}% after tax: a certain return`, to: '/debt/paydown' });
  }
  const reserveAlt = debtOf(state).alternatives.find((a) => a.kind === 'cash_reserve');
  if (deployable < 0) uses.push({ key: 'reserve', label: 'Rebuild the cash reserve', kind: 'reserve', amount: -deployable, expectedReturn: null, risk: 'low', riskAdjusted: Infinity, paybackYears: null, strategic: 5, note: 'Cash is below the reserve target: this comes first.', to: '/debt/reserve' });
  else if (reserveAlt) uses.push({ key: 'reserve', label: 'Hold in the reserve account', kind: 'reserve', amount: reserveAlt.amount, expectedReturn: reserveAlt.returnBps / 10000 * (1 - debtOf(state).settings.taxRateBps / 10000), risk: 'low', riskAdjusted: reserveAlt.returnBps / 10000 * (1 - debtOf(state).settings.taxRateBps / 10000), paybackYears: null, strategic: 2, note: `${reserveAlt.name}, after tax`, to: '/debt/reserve' });
  uses.push({ key: 'distribution', label: 'Owner distributions', kind: 'distribution', amount: safe.safe, expectedReturn: null, risk: 'low', riskAdjusted: -1, paybackYears: null, strategic: 3, note: `Up to the safe distribution of ${money(safe.safe)}; returns cash to the owners, earns nothing for the company.`, to: '/growth/owners' });
  uses.sort((a, b) => b.riskAdjusted - a.riskAdjusted || b.strategic - a.strategic);
  const allocations: { use: CapitalUse; amount: Cents }[] = [];
  let left = Math.max(0, deployable);
  for (const u of uses) {
    if (left <= 0 || u.kind === 'reserve' && deployable < 0) continue;
    if (u.status === 'idea') continue;
    const amt = Math.min(left, u.amount);
    if (amt > 0) { allocations.push({ use: u, amount: amt }); left -= amt; }
  }
  return { asOf, deployable, uses, allocations, unallocated: left, safe };
}

/** One line for the "cash above the reserve" alert: the top ranked use of the money. */
export function deploySuggestion(state: BooksState, asOf: string): string {
  const p = capitalAllocation(state, asOf);
  const top = p.allocations.slice(0, 3).map((a) => `${a.use.label} ${money(a.amount)}`);
  return top.length ? `Suggested: ${top.join('; ')}.` : 'Nothing ranked to fund; see capital allocation.';
}

// ── Company valuation ────────────────────────────────────────────────────
export interface Valuation {
  asOf: string;
  quarter: string;
  metrics?: MonthMetrics;
  ebitda: Cents;
  annualized: boolean;
  gallons: number;
  realEstate: { storeId: ID; value: Cents; date: string; source: string }[];
  realEstateTotal: Cents;
  noValue: ID[];
  companyDebt: Cents;
  propertyDebt: { loanId: ID; name: string; balance: Cents }[];
  debt: Cents;
  multiple: { low: Cents; mid: Cents; high: Cents };
  perGallon: { low: Cents; high: Cents };
  equityLow: Cents; equityMid: Cents; equityHigh: Cents;
  perGallonEquity: { low: Cents; high: Cents };
}
/**
 * Group valuation: EBITDA × a market multiple range for the business, the per-gallon method as a cross-check, plus the
 * store real estate at its latest appraised value (Phase 12), less every loan against it (our loans and the mortgages
 * the related parties carry on those properties) = equity value.
 */
export function companyValuation(state: BooksState, asOf: string, opts: { entries?: BasisEntry[] } = {}): Valuation {
  const s = growthOf(state).settings;
  const ds = debtOf(state).settings;
  const entries = opts.entries ?? basisEntries(state);
  const m = headlineMetrics(covenantMetrics(state, asOf, { entries, settings: ds }), ds);
  const ebitda = m?.ebitdaAnnual ?? 0;
  const gallonsRaw = m ? salesRows(state, { from: `${m.from}-01`, to: lastDayOfPeriod(m.period) }).reduce((a, r) => a + r.gallons, 0) : 0;
  const gallons = Math.round(gallonsRaw * (m?.factor ?? 1));
  const realEstate: Valuation['realEstate'] = [];
  const noValue: ID[] = [];
  for (const st of state.stores.filter((x) => !x.deleted && x.kind !== 'corporate')) {
    const v = propertyValues(state, st.id, asOf).latest;
    if (v) realEstate.push({ storeId: st.id, value: v.value, date: v.date, source: v.source }); else noValue.push(st.id);
  }
  const valued = new Set(realEstate.map((r) => r.storeId));
  const propertyDebt = loansOf(state).filter((l) => l.heldBy === 'related_party' && valued.has(l.storeId)).map((l) => ({ loanId: l.id, name: l.name, balance: loanStatus(state, l, asOf).scheduleBalance })).filter((x) => x.balance > 0);
  const realEstateTotal = realEstate.reduce((a, r) => a + r.value, 0);
  const companyDebt = m?.debt ?? 0;
  const debt = companyDebt + propertyDebt.reduce((a, x) => a + x.balance, 0);
  const x = (mult: number) => Math.round((ebitda * mult) / 100);
  const multiple = { low: x(s.multipleLow), mid: x((s.multipleLow + s.multipleHigh) / 2), high: x(s.multipleHigh) };
  const perGallon = { low: Math.round(gallons * s.perGallonLow), high: Math.round(gallons * s.perGallonHigh) };
  const eq = (v: Cents) => v + realEstateTotal - debt;
  return {
    asOf, quarter: quarterOf(asOf), metrics: m, ebitda, annualized: !!m?.annualized, gallons, realEstate, realEstateTotal, noValue, companyDebt, propertyDebt, debt,
    multiple, perGallon, equityLow: eq(multiple.low), equityMid: eq(multiple.mid), equityHigh: eq(multiple.high), perGallonEquity: { low: eq(perGallon.low), high: eq(perGallon.high) },
  };
}

export function valuationTrend(state: BooksState): (ValuationSnapshot & { change: Cents | null })[] {
  const xs = [...growthOf(state).valuations].sort((a, b) => a.quarter.localeCompare(b.quarter) || a.at.localeCompare(b.at));
  return xs.map((v, i) => ({ ...v, change: i ? v.equityMid - xs[i - 1].equityMid : null }));
}

// ── Evaluate a deal ──────────────────────────────────────────────────────
export type DealRef = { kind: 'proforma' | 'acquisition'; id: ID };
export interface DealCheck { label: string; pass: boolean; critical: boolean; detail: string }
export interface DealEvaluation {
  ref: DealRef;
  name: string;
  pf: ProForma;
  r: ProFormaResult;
  site?: SiteRow;
  acquisition?: AcqAnalysis;
  before: { dscr: number | null; leverage: number | null; deployable: Cents; ebitda: Cents; debt: Cents; debtService: Cents };
  after: { dscr: number | null; leverage: number | null; cashAfter: Cents; ebitda: Cents; debt: Cents; debtService: Cents };
  checks: DealCheck[];
  decision: 'go' | 'conditional' | 'no_go';
  reasons: string[];
}

export function evaluateDeal(state: BooksState, asOf: string, ref: DealRef, opts: { financing?: Financing; entries?: BasisEntry[] } = {}): DealEvaluation | null {
  const g = growthOf(state);
  const s = g.settings;
  let pf: ProForma | undefined;
  let acquisition: AcqAnalysis | undefined;
  if (ref.kind === 'proforma') pf = g.proFormas.find((p) => p.id === ref.id);
  else {
    const acq = g.acquisitions.find((a) => a.id === ref.id);
    if (acq) { acquisition = analyzeAcquisition(acq, s); pf = acquisitionProForma(state, acq); }
  }
  if (!pf) return null;
  if (opts.financing) pf = { ...pf, financing: opts.financing };
  const entries = opts.entries ?? basisEntries(state);
  const r = proFormaResult(pf, s);
  const ds = debtOf(state).settings;
  const m = headlineMetrics(covenantMetrics(state, asOf, { entries, settings: ds }), ds);
  const reserve = reserveTarget(state, asOf, { entries });
  const y1 = r.years[0];
  const before = { dscr: m?.dscr ?? null, leverage: m?.leverage ?? null, deployable: reserve.deployable, ebitda: m?.ebitdaAnnual ?? 0, debt: m?.debt ?? 0, debtService: m?.debtServiceAnnual ?? 0 };
  const aEbitda = before.ebitda + y1.ebitda, aDebt = before.debt + r.loan, aDs = before.debtService + y1.debtService;
  const after = { dscr: m ? dscrWithNewDebt(m, y1.debtService, y1.ebitda) : null, leverage: aEbitda > 0 ? aDebt / aEbitda : aDebt > 0 ? Infinity : 0, cashAfter: reserve.deployable - r.equity - r.preOpeningDebtService, ebitda: aEbitda, debt: aDebt, debtService: aDs };
  const site = pf.siteId ? siteScorecard(state).rows.find((x) => x.site.id === pf!.siteId) : undefined;
  const checks: DealCheck[] = [];
  const hurdle = s.hurdleIrrBps / 10000;
  checks.push({ label: `Levered IRR at or above the ${pct1(hurdle)} hurdle`, pass: (r.leveredIrr ?? -1) >= hurdle, critical: true, detail: `Levered IRR ${r.leveredIrr === null ? 'none (never pays back)' : pct1(r.leveredIrr)}, unlevered ${r.unleveredIrr === null ? '–' : pct1(r.unleveredIrr)}; NPV at ${pct1(s.discountRateBps / 10000)} ${money(r.leveredNpv)}.` });
  checks.push({ label: 'NPV positive', pass: r.leveredNpv > 0, critical: true, detail: `Levered NPV ${money(r.leveredNpv)}.` });
  checks.push({ label: `Company DSCR stays at or above ${(s.dscrTarget / 100).toFixed(2)}x`, pass: after.dscr !== null && after.dscr >= s.dscrTarget / 100, critical: true, detail: `${ratioX(before.dscr)} today → ${ratioX(after.dscr)} with year-1 debt service ${money(y1.debtService)} and EBITDA ${money(y1.ebitda)}.` });
  checks.push({ label: `Leverage stays at or below ${(s.leverageTarget / 100).toFixed(2)}x`, pass: after.leverage <= s.leverageTarget / 100, critical: true, detail: `${ratioX(before.leverage)} today → ${ratioX(after.leverage)} (${money(aDebt)} ÷ ${money(aEbitda)}).` });
  checks.push({ label: 'Equity available above the reserve', pass: after.cashAfter >= 0, critical: false, detail: after.cashAfter >= 0 ? `${money(r.equity + r.preOpeningDebtService)} of equity leaves ${money(after.cashAfter)} above the reserve.` : `Needs ${money(r.equity + r.preOpeningDebtService)}; ${money(Math.max(0, reserve.deployable))} is above the reserve today, short ${money(-after.cashAfter)}.` });
  const y3 = r.years[r.stabilizedYear - 1];
  checks.push({ label: `Store DSCR at or above ${(s.dscrTarget / 100).toFixed(2)}x when stabilized`, pass: y3.dscr === null || y3.dscr >= s.dscrTarget / 100, critical: false, detail: `Year ${r.stabilizedYear}: ${ratioX(y3.dscr)}.` });
  if (site) checks.push({ label: 'Site scores at least as well as our stores', pass: site.rating !== 'weak', critical: site.rating === 'weak', detail: `${site.score} vs our stores' ${siteScorecard(state).existingAvg ?? '–'} (${site.rating}).` });
  if (acquisition) {
    checks.push({ label: 'Offer within the valuation range (at or below the high)', pass: acquisition.acq.offerPrice <= acquisition.valuation.high, critical: false, detail: `Offer ${money(acquisition.acq.offerPrice)} vs ${money(acquisition.valuation.low)} – ${money(acquisition.valuation.high)} (mid ${money(acquisition.valuation.mid)}).` });
    checks.push({ label: 'Fuel volume verified against supplier statements', pass: acquisition.gallons.verified && !acquisition.gallons.flagged, critical: false, detail: acquisition.gallons.verified ? `${acquisition.gallons.flagged} month${acquisition.gallons.flagged === 1 ? '' : 's'} more than ${GALLON_VARIANCE_PCT}% off.` : 'No supplier statements entered yet.' });
    checks.push({ label: 'No open due-diligence issue', pass: acquisition.dd.issues === 0, critical: true, detail: `${acquisition.dd.done} of ${acquisition.dd.total} items done; ${acquisition.dd.issues} issue${acquisition.dd.issues === 1 ? '' : 's'}.` });
  }
  const failedCritical = checks.filter((c) => !c.pass && c.critical);
  const failedOther = checks.filter((c) => !c.pass && !c.critical);
  const decision = failedCritical.length ? 'no_go' : failedOther.length ? 'conditional' : 'go';
  const reasons = decision === 'go' ? ['Every test passes.'] : [...failedCritical, ...failedOther].map((c) => `${c.label}: ${c.detail}`);
  return { ref, name: pf.name, pf, r, site, acquisition, before, after, checks, decision, reasons };
}
export const DECISION_LABEL = { go: 'Go', conditional: 'Go, with conditions', no_go: 'No go' } as const;

// ── Quarterly CFO review ─────────────────────────────────────────────────
export function quarterlyReview(state: BooksState, asOf: string, opts: { entries?: BasisEntry[]; storeIds?: ID[] } = {}) {
  const entries = opts.entries ?? basisEntries(state);
  const storeIds = opts.storeIds ?? state.stores.map((s) => s.id);
  const quarter = quarterOf(asOf);
  const qr = quarterRange(quarter);
  const first = firstBooksPeriod(state) ?? qr.from;
  const from = qr.from < first ? first : qr.from;
  const to = periodOf(asOf) < qr.to ? periodOf(asOf) : qr.to;
  const budget = bva(state, { from, to, storeIds, entries });
  const months = first <= periodOf(asOf) ? periodsBetween(first, periodOf(asOf)) : [];
  const kpis = months.map((p) => { const cc = commandCenter(state, { period: p, basis: 'booked', storeIds, entries }); return { period: p, sales: cc.total.sales, gross: cc.total.gross, gmPct: cc.total.gmPct, labor: cc.total.labor, laborPct: cc.total.laborPct, net: cc.total.net, provisional: lastDayOfPeriod(p) > asOf }; });
  const monitor = covenantMonitor(state, asOf, { entries });
  const triggers = refinanceTriggers(state, asOf, { monitor });
  const paydown = paydownPlan(state, asOf, { entries });
  const scorecard = expansionScorecard(state, asOf, { entries });
  const est = estimates(state, asOf).flatMap((e) => e.installments.filter((i) => !i.done && i.short > 0).map((i) => ({ payer: e.payerName, jurisdiction: e.plan.jurisdiction, quarter: i.quarter, dueDate: i.dueDate, amount: i.short })));
  const safe = safeDistribution(state, asOf, { entries });
  const tax = taxDistributionCover(state, asOf, safe.safe);
  const valuation = companyValuation(state, asOf, { entries });
  return { asOf, quarter, from, to, budget, kpis, monitor, triggers, paydown, scorecard, estimates: est, safe, tax, valuation };
}
export type QuarterlyReview = ReturnType<typeof quarterlyReview>;

/** The quarterly review as workbook sheets (the owner / bank pack's numbers). */
export function reviewWorkbook(state: BooksState, q: QuarterlyReview): Sheet[] {
  const d = (c: Cents) => Math.round(c) / 100;
  const name = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  void name;
  return [
    { name: 'Budget vs actual', rows: [['Account', 'Actual', 'Budget', 'Variance', 'Variance %'], ...q.budget.rows.map((r) => [`${r.account.number} ${r.account.name}`, d(r.actual), d(r.budget), d(r.variance), r.pct === null ? '' : Math.round(r.pct * 1000) / 10]), ['Net income', d(q.budget.actual.netIncome.total), d(q.budget.budget.netIncome.total), d(q.budget.actual.netIncome.total - q.budget.budget.netIncome.total), '']] },
    { name: 'KPI trend', rows: [['Month', 'Sales', 'Gross profit', 'GM %', 'Labor', 'Labor %', 'Net income'], ...q.kpis.map((k) => [k.period + (k.provisional ? ' (to date)' : ''), d(k.sales), d(k.gross), k.gmPct === null ? '' : Math.round(k.gmPct * 1000) / 10, d(k.labor), k.laborPct === null ? '' : Math.round(k.laborPct * 1000) / 10, d(k.net)])] },
    { name: 'Covenants', rows: [['Loan', 'Covenant', 'Actual', 'Status', 'Headroom %', 'Forecast breach'], ...q.monitor.tests.map((t) => [t.loan?.name ?? '', t.covenant.kind, t.actual === null ? '' : t.covenant.kind === 'min_liquidity' ? d(t.actual) : Math.round(t.actual * 100) / 100, t.status, t.headroomPct === null ? '' : Math.round(t.headroomPct * 10) / 10, t.forecast.date ?? ''])] },
    { name: 'Refinance & paydown', rows: [['Item', 'Detail', 'Amount'], ...q.triggers.map((t) => ['Refinance trigger', `${t.loanName}: ${t.title}`, '']), ...q.paydown.allocations.map((a) => ['Recommended use of deployable cash', a.use.label, d(a.amount)])] },
    { name: 'Expansion scorecard', rows: [['Check', 'Status', 'Value', 'Target', 'Detail'], ...q.scorecard.checks.map((c) => [c.label, c.status, c.value, c.target, c.detail]), ['Overall', q.scorecard.overall, '', '', '']] },
    { name: 'Tax & distributions', rows: [['Item', 'Due', 'Amount'], ...q.estimates.map((e) => [`${e.payer} ${e.jurisdiction} estimate Q${e.quarter}`, e.dueDate, d(e.amount)]), ['Cash above the reserve', '', d(q.safe.aboveReserve)], ['Less near-term capex', '', -d(q.safe.capexTotal)], ['Less tax estimates due', '', -d(q.safe.taxTotal)], ['Less debt-service cushion', '', -d(q.safe.cushion)], ['Safe distribution', '', d(q.safe.safe)], ['Tax distributions still to make', '', d(q.tax.still)]] },
    { name: 'Valuation', rows: [['Method', 'Low', 'Mid', 'High'], ['EBITDA × multiple', d(q.valuation.multiple.low), d(q.valuation.multiple.mid), d(q.valuation.multiple.high)], ['Per gallon', d(q.valuation.perGallon.low), '', d(q.valuation.perGallon.high)], ['Real estate', d(q.valuation.realEstateTotal), d(q.valuation.realEstateTotal), d(q.valuation.realEstateTotal)], ['Less debt', -d(q.valuation.debt), -d(q.valuation.debt), -d(q.valuation.debt)], ['Equity value', d(q.valuation.equityLow), d(q.valuation.equityMid), d(q.valuation.equityHigh)]] },
  ];
}

// ── Inbox (SPEC §9: expansion scorecard changes) ─────────────────────────
export interface GrowthInboxItem { key: string; count: number; title: string; detail: string; to: string; action: string; review?: boolean }
export function growthInbox(state: BooksState, today: string): GrowthInboxItem[] {
  const g = growthOf(state);
  if (!state.growth || (!g.proFormas.length && !g.scoreHistory.length && !g.sites.length)) return [];
  const entries = basisEntries(state);
  const sc = expansionScorecard(state, today, { entries });
  const ch = scorecardChange(state, sc);
  const recorded = g.scoreHistory.some((h) => h.period === sc.period);
  const ddOpen = g.acquisitions.filter((a) => a.status === 'diligence' || a.status === 'loi').flatMap((a) => a.dd.filter((d) => d.status === 'issue' || (d.status !== 'done' && d.status !== 'na' && d.due && d.due < today)).map((d) => `${a.name}: ${d.title}${d.status === 'issue' ? ' (issue)' : ` (due ${d.due})`}`));
  return [
    { key: 'growth_score', count: ch.changed ? 1 : 0, title: 'Expansion scorecard changed', detail: ch.message, to: '/growth/readiness', action: 'Review' },
    { key: 'growth_record', count: recorded ? 0 : 1, title: 'Record this month\'s expansion scorecard', detail: recorded ? `${periodLabel(sc.period)} is recorded (${RAG_LABEL[sc.overall].toLowerCase()}).` : `${periodLabel(sc.period)} is ${RAG_LABEL[sc.overall].toLowerCase()} and not yet in the history.`, to: '/growth/readiness', action: 'Record', review: true },
    { key: 'growth_dd', count: ddOpen.length, title: 'Due diligence overdue or with an issue', detail: ddOpen.length ? ddOpen.slice(0, 3).join('; ') : 'Every open diligence item is on schedule.', to: '/growth/acquisitions', action: 'Review' },
  ];
}

// ── Writers ──────────────────────────────────────────────────────────────
const errs = (xs: string[]) => new ValidationError(xs);
function done(books: Books, actor: User, summary: string, kind: string, objectId: ID, before?: unknown, after?: unknown) {
  books.audit(actor, { action: `${before ? 'update' : 'create'} ${kind}`, objectType: 'growth', objectId, summary, before: before as never, after: after as never });
  books.changed();
}
function upsert<T extends { id: ID }>(list: T[], item: T): T | undefined {
  const i = list.findIndex((x) => x.id === item.id);
  const before = i >= 0 ? structuredClone(list[i]) : undefined;
  if (i >= 0) list[i] = item; else list.push(item);
  return before;
}
const finite = (v: number) => Number.isFinite(v);
const nonNeg = (v: number) => Number.isFinite(v) && v >= 0;

export function saveGrowthSettings(books: Books, actor: User, patch: Partial<GrowthSettings>): GrowthSettings {
  books.require(actor, 'growth.edit', 'change growth settings');
  const g = ensureGrowth(books);
  const next = { ...g.settings, ...patch };
  const e: string[] = [];
  if (!(next.dscrTarget > 0 && next.dscrTarget <= 1000)) e.push('Enter a DSCR target between 0.01x and 10x.');
  if (!(next.leverageTarget > 0 && next.leverageTarget <= 2000)) e.push('Enter a leverage target between 0.01x and 20x.');
  if (!(nonNeg(next.discountRateBps) && next.discountRateBps <= 5000)) e.push('Enter a discount rate between 0% and 50%.');
  if (!(nonNeg(next.hurdleIrrBps) && next.hurdleIrrBps <= 10000)) e.push('Enter a hurdle rate between 0% and 100%.');
  if (!(next.multipleLow > 0 && next.multipleHigh >= next.multipleLow)) e.push('The EBITDA multiple range needs a low above zero and a high at or above it.');
  if (!(nonNeg(next.perGallonLow) && next.perGallonHigh >= next.perGallonLow)) e.push('The per-gallon range needs a high at or above the low.');
  if (!(Number.isInteger(next.closeOnTimeMonths) && next.closeOnTimeMonths >= 1 && next.closeOnTimeMonths <= 12)) e.push('Closed-on-time months must be 1 to 12.');
  if (!(Number.isInteger(next.debtCushionMonths) && next.debtCushionMonths >= 0 && next.debtCushionMonths <= 12)) e.push('The debt-service cushion must be 0 to 12 months.');
  if (!(nonNeg(next.capexWindowDays) && nonNeg(next.taxWindowDays))) e.push('Windows are a number of days, zero or more.');
  if (next.dealProFormaId && !g.proFormas.some((p) => p.id === next.dealProFormaId)) e.push('Choose a saved pro forma for the deal the scorecard tests.');
  if (e.length) throw errs(e);
  const before = structuredClone(g.settings);
  g.settings = next;
  done(books, actor, 'Growth settings', 'growth settings', 'settings', before, next);
  return next;
}

export function validateSite(s: Omit<SiteProfile, 'id'>): string[] {
  const e: string[] = [];
  if (!s.name.trim()) e.push('Name the site.');
  if (!nonNeg(s.aadt)) e.push('Enter traffic (AADT) as cars a day, zero or more.');
  for (const [k, v] of [['Visibility', s.visibility], ['Ingress / egress', s.access]] as const) if (!(Number.isInteger(v) && v >= 1 && v <= 5)) e.push(`${k} is a score from 1 to 5.`);
  if (!nonNeg(s.population) || !nonNeg(s.trucksPerDay) || !nonNeg(s.medianIncome)) e.push('Population, trucks a day and income are zero or more.');
  if (!finite(s.growthBps)) e.push('Enter population growth as a percent a year.');
  for (const c of s.competitors) if (!c.name.trim() || !nonNeg(c.distanceMi)) e.push('Every competitor needs a name and a distance in miles.');
  return e;
}
export function saveSite(books: Books, actor: User, s: Omit<SiteProfile, 'id'> & { id?: ID }): SiteProfile {
  books.require(actor, 'growth.edit', 'save a site');
  const e = validateSite(s);
  if (e.length) throw errs(e);
  const g = ensureGrowth(books);
  const rec: SiteProfile = { ...s, id: s.id ?? books.nextId('site') };
  const before = upsert(g.sites, rec);
  done(books, actor, `Site ${rec.name}`, 'site', rec.id, before, rec);
  return rec;
}
export function saveWeights(books: Books, actor: User, w: Record<SiteFactor, number>): void {
  books.require(actor, 'growth.edit', 'change site weights');
  const vals = SITE_FACTORS.map((f) => w[f.key]);
  if (vals.some((v) => !nonNeg(v))) throw errs(['Weights are zero or more.']);
  if (!vals.some((v) => v > 0)) throw errs(['Give at least one factor a weight.']);
  const g = ensureGrowth(books);
  const before = { ...g.weights };
  g.weights = { ...w };
  done(books, actor, 'Site score weights', 'site weights', 'weights', before, g.weights);
}

export function validateProForma(p: Omit<ProForma, 'id' | 'updatedAt' | 'updatedBy'>): string[] {
  const e: string[] = [];
  const i = p.inputs;
  if (!p.name.trim()) e.push('Name the pro forma.');
  if (!(Number.isInteger(p.monthsToOpen) && p.monthsToOpen >= 0 && p.monthsToOpen <= 60)) e.push('Months to open is 0 to 60.');
  if (!nonNeg(i.gallons) || !finite(i.cpg) || !nonNeg(i.retailCpg)) e.push('Enter gallons a month, a margin in cents per gallon and a retail price per gallon.');
  for (const [k, v] of [['Inside margin', i.insideMarginPct], ['Food cost', i.foodCostPct], ['Card fees', i.cardFeePct]] as const) if (!(finite(v) && v >= 0 && v <= 100)) e.push(`${k} is a percent from 0 to 100.`);
  for (const k of ['insideSales', 'kitchenSales', 'otherIncome', 'labor', 'occupancy', 'utilities', 'repairs', 'insurance', 'propertyTax', 'otherExpense'] as const) if (!Number.isSafeInteger(i[k]) || i[k] < 0) { e.push('Monthly amounts are zero or more.'); break; }
  if (i.ramp.some((r) => !(finite(r) && r >= 0 && r <= 200))) e.push('Each ramp month is a percent of stabilized volume (0–200).');
  if (i.ramp.length > 60) e.push('Keep the ramp to 60 months or fewer.');
  if (!(finite(i.growthBps) && Math.abs(i.growthBps) <= 2000)) e.push('Growth is a percent a year between −20% and 20%.');
  if (!p.capital.length) e.push('Add the capital needed (at least one line).');
  if (p.capital.some((c) => !c.label.trim() || !Number.isSafeInteger(c.amount) || c.amount < 0)) e.push('Each capital line needs a label and an amount of zero or more.');
  const f = p.financing;
  const cap = p.capital.reduce((a, c) => a + c.amount, 0);
  if (!Number.isSafeInteger(f.loanAmount) || f.loanAmount < 0) e.push('The loan amount is zero or more.');
  if (f.loanAmount > cap) e.push('The loan can\'t be more than the capital needed.');
  if (f.loanAmount > 0 && !(f.rateBps >= 0 && f.rateBps <= 3000 && f.termMonths >= 1 && f.amortizationMonths >= f.termMonths && f.amortizationMonths <= 480)) e.push('Financing needs a rate (0–30%), a term, and an amortization at least as long as the term (up to 40 years).');
  if (p.incentives.some((x) => !x.label.trim() || (x.kind === 'upfront' ? !nonNeg(x.amount) : !(finite(x.cpg ?? NaN) && (x.months ?? 0) > 0)))) e.push('Each incentive needs a label and an amount (upfront) or cents per gallon and months.');
  if (!nonNeg(p.realEstateValue) || !finite(p.appreciationBps) || !nonNeg(p.overrunPct)) e.push('Real estate value, appreciation and overrun are numbers (value and overrun zero or more).');
  return e;
}
export function saveProForma(books: Books, actor: User, p: Omit<ProForma, 'id' | 'updatedAt' | 'updatedBy'> & { id?: ID }): ProForma {
  books.require(actor, 'growth.edit', 'save a pro forma');
  const e = validateProForma(p);
  if (e.length) throw errs(e);
  const g = ensureGrowth(books);
  const rec: ProForma = { ...structuredClone(p), id: p.id ?? books.nextId('pf'), updatedAt: books.clock(), updatedBy: actor.id };
  const before = upsert(g.proFormas, rec);
  done(books, actor, `Pro forma ${rec.name}`, 'pro forma', rec.id, before, rec);
  return rec;
}
export function deleteProForma(books: Books, actor: User, id: ID): void {
  books.require(actor, 'growth.edit', 'delete a pro forma');
  const g = ensureGrowth(books);
  const i = g.proFormas.findIndex((p) => p.id === id);
  if (i < 0) return;
  if (g.projects.some((p) => p.proFormaId === id)) throw errs(['A capital project uses this pro forma. Unlink it first.']);
  const before = g.proFormas[i];
  g.proFormas.splice(i, 1);
  if (g.settings.dealProFormaId === id) g.settings.dealProFormaId = undefined;
  books.audit(actor, { action: 'delete pro forma', objectType: 'growth', objectId: id, summary: `Deleted pro forma ${before.name}`, before });
  books.changed();
}

export function validateAcquisition(a: Omit<Acquisition, 'id'>): string[] {
  const e: string[] = [];
  if (!a.name.trim()) e.push('Name the target.');
  for (const v of [a.askingPrice, a.offerPrice, a.realEstateValue, a.marketRent, a.insideInventoryAtCost]) if (!Number.isSafeInteger(v) || v < 0) { e.push('Prices, values, rent and inventory are amounts of zero or more.'); break; }
  if (!nonNeg(a.sellerGallons) || !nonNeg(a.fuelGallonsInTank) || !nonNeg(a.fuelCostCpg)) e.push('Gallons and fuel cost are zero or more.');
  if (a.sellerPnl.some((l) => !l.label.trim() || !Number.isSafeInteger(l.amount))) e.push('Each seller P&L line needs a label and an amount.');
  if (a.addBacks.some((x) => !x.label.trim() || !Number.isSafeInteger(x.amount) || x.amount < 0)) e.push('Each add-back needs a label and an amount of zero or more.');
  for (const c of a.gallonChecks) if (!/^\d{4}-\d{2}$/.test(c.period) || !nonNeg(c.seller) || (c.supplier !== undefined && !nonNeg(c.supplier))) e.push('Each gallon check needs a month (YYYY-MM) and gallons of zero or more.');
  if (a.financing.loanAmount > 0 && !(a.financing.amortizationMonths >= a.financing.termMonths && a.financing.termMonths > 0)) e.push('Financing needs a term and an amortization at least as long.');
  return [...new Set(e)];
}
export function saveAcquisition(books: Books, actor: User, a: Omit<Acquisition, 'id'> & { id?: ID }): Acquisition {
  books.require(actor, 'growth.edit', 'save an acquisition');
  const e = validateAcquisition(a);
  if (e.length) throw errs(e);
  const g = ensureGrowth(books);
  const rec: Acquisition = { ...structuredClone(a), id: a.id ?? books.nextId('acq') };
  const before = upsert(g.acquisitions, rec);
  done(books, actor, `Acquisition ${rec.name}`, 'acquisition', rec.id, before, rec);
  return rec;
}
export function setDdItem(books: Books, actor: User, acqId: ID, itemId: ID, patch: { status?: DdStatus; owner?: string; due?: string; note?: string }): DdItem {
  books.require(actor, 'growth.edit', 'update due diligence');
  const a = ensureGrowth(books).acquisitions.find((x) => x.id === acqId);
  const d = a?.dd.find((x) => x.id === itemId);
  if (!a || !d) throw errs(['That diligence item no longer exists.']);
  const next = { ...d, ...patch };
  if (next.status === 'issue' && !next.note?.trim()) throw errs(['Describe the issue in the note so the next step is clear.']);
  if (next.status === 'done' && !next.attachments.length) throw errs(['Attach the report or document before marking it done.']);
  if (next.due && !isValidDate(next.due)) throw errs(['Enter the due date as YYYY-MM-DD.']);
  const before = structuredClone(d);
  Object.assign(d, next);
  done(books, actor, `${a.name}: ${d.title} ${DD_STATUS_LABEL[d.status].toLowerCase()}`, 'due diligence', `${acqId}:${itemId}`, before, d);
  return d;
}
export function attachDdDoc(books: Books, actor: User, acqId: ID, itemId: ID, att: Attachment): void {
  books.require(actor, 'growth.edit', 'attach a diligence document');
  const a = ensureGrowth(books).acquisitions.find((x) => x.id === acqId);
  const d = a?.dd.find((x) => x.id === itemId);
  if (!a || !d) throw errs(['That diligence item no longer exists.']);
  d.attachments.push(att);
  done(books, actor, `${a.name}: ${att.name} attached to ${d.title}`, 'due diligence', `${acqId}:${itemId}`, undefined, att);
}
export function setQoe(books: Books, actor: User, acqId: ID, key: string, x: { done: boolean; note?: string }): void {
  books.require(actor, 'growth.edit', 'update the QoE checklist');
  const a = ensureGrowth(books).acquisitions.find((y) => y.id === acqId);
  const q = a?.qoe.find((y) => y.key === key);
  if (!a || !q) throw errs(['That checklist item no longer exists.']);
  const before = structuredClone(q);
  q.done = x.done; q.note = x.note;
  done(books, actor, `${a.name}: QoE ${q.label} ${x.done ? 'done' : 'reopened'}`, 'qoe', `${acqId}:${key}`, before, q);
}

export function saveProject(books: Books, actor: User, p: Omit<CapitalProject, 'id'> & { id?: ID }): CapitalProject {
  books.require(actor, 'growth.edit', 'save a capital project');
  const e: string[] = [];
  if (!p.name.trim()) e.push('Name the project.');
  if (!Number.isSafeInteger(p.cost) || p.cost <= 0) e.push('Enter the cost, above zero.');
  if (!Number.isSafeInteger(p.annualReturn)) e.push('Enter the added cash flow a year (zero if none).');
  if (!(Number.isInteger(p.strategic) && p.strategic >= 1 && p.strategic <= 5)) e.push('Strategic value is 1 to 5.');
  if (p.start && !isValidDate(p.start)) e.push('Enter the start as YYYY-MM-DD.');
  const g = ensureGrowth(books);
  if (p.proFormaId && !g.proFormas.some((x) => x.id === p.proFormaId)) e.push('Choose a saved pro forma, or none.');
  if (e.length) throw errs(e);
  const rec: CapitalProject = { ...p, id: p.id ?? books.nextId('cap') };
  const before = upsert(g.projects, rec);
  done(books, actor, `Capital project ${rec.name}`, 'capital project', rec.id, before, rec);
  return rec;
}

/** Record this quarter's valuation from the books (or enter one from before them). */
export function saveValuationSnapshot(books: Books, actor: User, asOf: string, x: { note?: string; entered?: Omit<ValuationSnapshot, 'id' | 'by' | 'at' | 'entered'> } = {}): ValuationSnapshot {
  books.require(actor, 'growth.edit', 'record a valuation');
  const g = ensureGrowth(books);
  let rec: ValuationSnapshot;
  if (x.entered) {
    if (!/^\d{4}-Q[1-4]$/.test(x.entered.quarter)) throw errs(['Enter the quarter as YYYY-Q1 … YYYY-Q4.']);
    rec = { ...x.entered, id: books.nextId('val'), entered: true, by: actor.id, at: books.clock() };
  } else {
    const v = companyValuation(books.state, asOf);
    const s = g.settings;
    rec = {
      id: books.nextId('val'), quarter: v.quarter, date: asOf, ebitda: v.ebitda, annualized: v.annualized, multipleLow: s.multipleLow, multipleHigh: s.multipleHigh, gallons: v.gallons,
      perGallonLow: s.perGallonLow, perGallonHigh: s.perGallonHigh, realEstate: v.realEstateTotal, debt: v.debt, equityLow: v.equityLow, equityMid: v.equityMid, equityHigh: v.equityHigh, note: x.note, by: actor.id, at: books.clock(),
    };
  }
  const i = g.valuations.findIndex((y) => y.quarter === rec.quarter);
  const before = i >= 0 ? g.valuations[i] : undefined;
  if (i >= 0) g.valuations[i] = rec; else g.valuations.push(rec);
  done(books, actor, `Valuation ${quarterLabel(rec.quarter)}: equity ${money(rec.equityMid)}`, 'valuation', rec.quarter, before, rec);
  return rec;
}

export function recordScorecard(books: Books, actor: User, asOf: string): ScoreRecord {
  books.require(actor, 'growth.edit', 'record the expansion scorecard');
  const sc = expansionScorecard(books.state, asOf);
  const g = ensureGrowth(books);
  const rec: ScoreRecord = { period: sc.period, overall: sc.overall, checks: Object.fromEntries(sc.checks.map((c) => [c.key, c.status])), at: books.clock(), by: actor.id };
  const i = g.scoreHistory.findIndex((h) => h.period === rec.period);
  const before = i >= 0 ? g.scoreHistory[i] : undefined;
  if (i >= 0) g.scoreHistory[i] = rec; else g.scoreHistory.push(rec);
  done(books, actor, `Expansion scorecard ${periodLabel(rec.period)}: ${RAG_LABEL[rec.overall].toLowerCase()}`, 'scorecard', rec.period, before, rec);
  return rec;
}
export function addFixPlan(books: Books, actor: User, x: { storeId: ID; text: string }): FixPlan {
  books.require(actor, 'growth.edit', 'add a fix plan');
  if (!books.state.stores.some((s) => s.id === x.storeId)) throw errs(['Choose the store.']);
  if (x.text.trim().length < 10) throw errs(['Write the fix plan: what changes, who owns it and by when.']);
  const rec: FixPlan = { id: books.nextId('fix'), storeId: x.storeId, text: x.text.trim(), by: actor.id, at: books.clock() };
  ensureGrowth(books).fixPlans.push(rec);
  done(books, actor, `Fix plan for ${books.state.stores.find((s) => s.id === x.storeId)?.code}`, 'fix plan', rec.id, undefined, rec);
  return rec;
}
export function saveRampPlan(books: Books, actor: User, r: RampPlan): RampPlan {
  books.require(actor, 'growth.edit', 'save ramp targets');
  if (!books.state.stores.some((s) => s.id === r.storeId)) throw errs(['Choose the store.']);
  if (r.targets.some((t) => !/^\d{4}-\d{2}$/.test(t.period) || !nonNeg(t.gallons) || !Number.isSafeInteger(t.insideSales) || !Number.isSafeInteger(t.ebitda))) throw errs(['Each target needs a month (YYYY-MM), gallons, inside sales and EBITDA.']);
  const g = ensureGrowth(books);
  const i = g.ramps.findIndex((x) => x.storeId === r.storeId);
  const before = i >= 0 ? g.ramps[i] : undefined;
  const rec = { ...r, targets: [...r.targets].sort((a, b) => a.period.localeCompare(b.period)) };
  if (i >= 0) g.ramps[i] = rec; else g.ramps.push(rec);
  done(books, actor, `Ramp targets for ${books.state.stores.find((s) => s.id === r.storeId)?.code}`, 'ramp', r.storeId, before, rec);
  return rec;
}
export function setPriorDistributions(books: Books, actor: User, p: PriorDistributions): void {
  books.require(actor, 'growth.edit', 'enter distributions before these books');
  if (!books.state.parties.some((x) => x.id === p.partyId && x.type === 'owner')) throw errs(['Choose an owner.']);
  if (!nonNeg(p.ytd) || !nonNeg(p.lifetime) || p.ytd > p.lifetime) throw errs(['Enter year-to-date and lifetime amounts (lifetime at least year to date).']);
  const g = ensureGrowth(books);
  const i = g.priorDistributions.findIndex((x) => x.partyId === p.partyId && x.year === p.year);
  const before = i >= 0 ? g.priorDistributions[i] : undefined;
  if (i >= 0) g.priorDistributions[i] = p; else g.priorDistributions.push(p);
  done(books, actor, `Distributions before the books for ${books.state.parties.find((x) => x.id === p.partyId)?.name}`, 'prior distributions', p.partyId, before, p);
}

/**
 * Record an owner distribution: posts Dr 3100 Owner draws (tagged to the owner) / Cr the bank through the ledger, so it
 * is validated, balanced and period-locked. Above the safe distribution amount it needs a reason, kept with it.
 */
export function recordDistribution(books: Books, actor: User, x: { date: string; partyId: ID; amount: Cents; kind?: 'regular' | 'tax'; storeId?: ID; bankAccountId?: ID; note?: string; override?: string }): Distribution {
  books.require(actor, 'growth.distribute', 'record an owner distribution');
  const state = books.state;
  const e: string[] = [];
  if (!isValidDate(x.date)) e.push('Enter the date as YYYY-MM-DD.');
  const owner = state.parties.find((p) => p.id === x.partyId && p.type === 'owner' && !p.deleted);
  if (!owner) e.push('Choose the owner receiving the distribution.');
  if (!Number.isSafeInteger(x.amount) || x.amount <= 0) e.push('Enter the amount, above zero.');
  const hub = state.stores.find((s) => s.kind === 'corporate')?.id ?? state.stores[0]?.id;
  const storeId = x.storeId ?? hub;
  const bank = x.bankAccountId ?? 'acct_trustmark';
  if (!state.accounts.some((a) => a.id === bank && a.subtype === 'bank')) e.push('Pay it from a bank account.');
  if (e.length) throw errs(e);
  const safe = safeDistribution(state, x.date);
  if (x.amount > safe.safe && !x.override?.trim()) throw errs([`${money(x.amount)} is above the safe distribution of ${money(safe.safe)} on ${x.date}. Lower it, or give a reason to go ahead.`]);
  const t = books.createTransaction(actor, {
    date: x.date, kind: 'money_out', description: `${x.kind === 'tax' ? 'Tax distribution' : 'Owner distribution'} – ${owner!.name}`, memo: x.note, tags: [DIST_TAG, 'owner'], partyId: x.partyId,
    lines: [{ accountId: 'acct_owner_draws', storeId: storeId!, debit: x.amount, credit: 0, partyId: x.partyId, memo: 'Distribution' }, { accountId: bank, storeId: storeId!, debit: 0, credit: x.amount }],
  });
  const g = ensureGrowth(books);
  const rec: Distribution = { id: books.nextId('dist'), date: x.date, partyId: x.partyId, storeId: storeId!, amount: x.amount, kind: x.kind ?? 'regular', bankAccountId: bank, txnId: t.id, override: x.override?.trim() || undefined, note: x.note, by: actor.id, at: books.clock() };
  g.distributions.push(rec);
  books.audit(actor, { action: 'create distribution', objectType: 'growth', objectId: rec.id, summary: `${owner!.name} distribution ${money(x.amount)} (${t.ref})`, after: rec, reason: rec.override });
  books.changed();
  return rec;
}
