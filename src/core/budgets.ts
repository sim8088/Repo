/**
 * Phase 8 — budgets, budget vs actual, the rolling forecast, scenarios and break-even.
 *
 * A budget is a grid of cells: store × P&L account × month, in the P&L's shown sign (sales +, costs +), for one
 * fiscal year. Budgets are built on the ACCRUAL basis (transaction date, accrual fuel cost of sales), the basis the
 * owners manage to; budget vs actual compares against the accrual P&L unless another basis is asked for.
 *
 * Every figure here is turned into BasisEntry rows and summed by `statement()` from statements.ts, so budget,
 * forecast and scenario totals add up exactly the way the P&L does (sections, lines of business, net profit).
 */
import type { Books } from './books';
import { ValidationError } from './books';
import type { Account, BooksState, BudgetMethod, BudgetsState, BudgetVersion, ID, ReportBasis, Scenario, ScenarioAdj, User, VarianceComment } from './types';
import type { Cents } from './money';
import { isPnl } from './ledger';
import { addDays, dayOfWeek, lastDayOfPeriod, periodLabel, periodOf, periodsBetween, todayInChicago } from './dates';
import { allocate, formatMoney } from './money';
import { basisEntries, budgetCompare, CARD_FEE_ACCTS, firstDay, GROUPS, LABOR_ACCTS, shownSign, statement, type BasisEntry, type BudgetCompare, type Statement } from './statements';
import { salesRows } from './fuel';
import { peopleOf } from './payroll';

// ── Slice ────────────────────────────────────────────────────────────────
export const DEFAULT_VARIANCE_THRESHOLD = { pct: 10, minCents: 100_000 };
export function emptyBudgets(): BudgetsState {
  return { versions: [], comments: [], scenarios: [], threshold: { ...DEFAULT_VARIANCE_THRESHOLD } };
}
const EMPTY = emptyBudgets();
/** The budgets slice, or an empty one for books saved before phase 8. */
export function budgetsOf(state: BooksState): BudgetsState {
  return state.budgets ?? EMPTY;
}
function ensure(books: Books): BudgetsState {
  if (!books.state.budgets) books.state.budgets = emptyBudgets();
  return books.state.budgets;
}

// ── Keys, fiscal years, accounts ─────────────────────────────────────────
export const cellKey = (storeId: ID, accountId: ID, period: string) => `${storeId}|${accountId}|${period}`;
export function parseKey(k: string): { storeId: ID; accountId: ID; period: string } {
  const [storeId, accountId, period] = k.split('|');
  return { storeId, accountId, period };
}
const nextPeriod = (p: string) => periodOf(addDays(lastDayOfPeriod(p), 1));
const prevPeriod = (p: string) => periodOf(addDays(firstDay(p), -1));
const monthIndex = (p: string) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1;

/** The fiscal year a month belongs to, named by the calendar year it starts in (January start: the same year). */
export function fiscalYearOf(state: BooksState, period: string): number {
  const start = state.settings.fiscalYearStartMonth || 1;
  const y = Number(period.slice(0, 4)), m = Number(period.slice(5, 7));
  return m >= start ? y : y - 1;
}
/** The twelve months of a fiscal year. */
export function fyPeriods(state: BooksState, fy: number): string[] {
  const start = state.settings.fiscalYearStartMonth || 1;
  const from = `${fy}-${String(start).padStart(2, '0')}`;
  const out = [from];
  while (out.length < 12) out.push(nextPeriod(out.at(-1)!));
  return out;
}
export const fyLabel = (state: BooksState, fy: number) => {
  const ps = fyPeriods(state, fy);
  return (state.settings.fiscalYearStartMonth || 1) === 1 ? `FY${fy}` : `FY${fy} (${periodLabel(ps[0])} – ${periodLabel(ps[11])})`;
};

/** P&L accounts in chart order. */
export function pnlAccounts(state: BooksState): Account[] {
  return state.accounts.filter((a) => isPnl(a)).sort((a, b) => a.number.localeCompare(b.number));
}

export function activeVersion(state: BooksState, fy: number): BudgetVersion | undefined {
  return budgetsOf(state).versions.find((v) => v.fiscalYear === fy && v.active);
}
export function versionById(state: BooksState, id: ID): BudgetVersion | undefined {
  return budgetsOf(state).versions.find((v) => v.id === id);
}

// ── Actuals as cells ─────────────────────────────────────────────────────
/** Every P&L entry on a basis as store|account|month cells in shown sign (what statement() would show). */
export function actualCells(state: BooksState, opts: { basis?: ReportBasis; entries?: BasisEntry[] } = {}): Map<string, Cents> {
  const basis = opts.basis ?? 'accrual';
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const out = new Map<string, Cents>();
  for (const e of opts.entries ?? basisEntries(state)) {
    const d = basis === 'cash' ? e.cashDate : basis === 'accrual' ? e.accrualDate : e.fuel ? null : e.bookDate;
    const a = acc.get(e.accountId);
    if (!d || !a) continue;
    const k = cellKey(e.storeId, e.accountId, periodOf(d));
    out.set(k, (out.get(k) ?? 0) + shownSign(a) * e.amount);
  }
  return out;
}

/** The last day of P&L activity in the books (the demo runs to 26 Nov 2026). */
export function dataEnd(state: BooksState): string | null {
  let end: string | null = null;
  const pl = new Set(state.accounts.filter((a) => isPnl(a)).map((a) => a.id));
  for (const t of state.transactions) {
    if (t.deleted || t.kind === 'opening') continue;
    if ((!end || t.date > end) && t.lines.some((l) => pl.has(l.accountId))) end = t.date;
  }
  return end;
}
/** The first month with P&L activity. */
export function dataStart(state: BooksState): string | null {
  let start: string | null = null;
  const pl = new Set(state.accounts.filter((a) => isPnl(a)).map((a) => a.id));
  for (const t of state.transactions) {
    if (t.deleted || t.kind === 'opening') continue;
    if ((!start || t.date < start) && t.lines.some((l) => pl.has(l.accountId))) start = t.date;
  }
  return start ? periodOf(start) : null;
}

/** Cells (in shown sign) as basis entries dated the first of their month, so statement() can total them. */
export function cellsToEntries(state: BooksState, cells: Map<string, Cents> | Record<string, Cents>, tag = 'cell'): BasisEntry[] {
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const out: BasisEntry[] = [];
  const it = cells instanceof Map ? cells.entries() : Object.entries(cells);
  for (const [k, v] of it) {
    if (!v) continue;
    const { storeId, accountId, period } = parseKey(k);
    const a = acc.get(accountId);
    if (!a) continue;
    const d = firstDay(period);
    out.push({ id: `${tag}:${k}`, accountId, storeId, amount: shownSign(a) * v, bookDate: d, cashDate: d, accrualDate: d, reason: null });
  }
  return out;
}
const sumCells = (state: BooksState, cells: Map<string, Cents>, filter: (k: { storeId: ID; accountId: ID; period: string }) => boolean) => {
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  let profit = 0, gross = 0;
  for (const [k, v] of cells) {
    const p = parseKey(k);
    if (!filter(p)) continue;
    const a = acc.get(p.accountId);
    if (!a) continue;
    gross += v;
    profit += shownSign(a) * v;
  }
  return { profit, gross };
};

// ── Building a budget ────────────────────────────────────────────────────
export interface BuildOpts { fiscalYear: number; method: BudgetMethod; growthPct: number; /** Data through this date (default: last P&L activity). */ asOf?: string; entries?: BasisEntry[] }
export interface BuiltBudget { lines: Record<string, Cents>; note: string; sourceMonths: string[]; storesFromPartial: ID[] }

const roundDollars = (c: number) => Math.round(c / 100) * 100;

/**
 * Last year's actuals + growth, or zero-based.
 * - prior_actuals: each month gets the same month a year earlier on the accrual basis × (1 + growth). Where the books
 *   don't reach back that far, the available COMPLETE months are annualized instead: each store's monthly average,
 *   flat across the year, × (1 + growth). A store with no complete month yet (opened mid-quarter) is scaled up from
 *   its partial month by days. Months before a store opens get nothing. Cells are rounded to whole dollars.
 * - zero: an empty grid to fill in.
 */
export function buildBudget(state: BooksState, opts: BuildOpts): BuiltBudget {
  const months = fyPeriods(state, opts.fiscalYear);
  if (opts.method === 'zero') return { lines: {}, note: 'Zero-based: every line starts at $0 and is entered by hand.', sourceMonths: [], storesFromPartial: [] };
  const g = 1 + opts.growthPct / 100;
  const actual = actualCells(state, { basis: 'accrual', entries: opts.entries });
  const end = opts.asOf ?? dataEnd(state) ?? todayInChicago();
  const start = dataStart(state);
  const complete = (p: string) => lastDayOfPeriod(p) <= end;
  const lines: Record<string, Cents> = {};
  // Months with a prior-year actual month.
  const havePrior = new Set<string>();
  for (const k of actual.keys()) havePrior.add(parseKey(k).period);
  const yearAgo = (p: string) => `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`;
  const priorMonths = months.filter((p) => havePrior.has(yearAgo(p)) && complete(yearAgo(p)));
  for (const p of priorMonths) {
    const py = yearAgo(p);
    for (const [k, v] of actual) {
      const x = parseKey(k);
      if (x.period !== py) continue;
      const r = roundDollars(v * g);
      if (r) lines[cellKey(x.storeId, x.accountId, p)] = r;
    }
  }
  const rest = months.filter((p) => !priorMonths.includes(p));
  // Annualize the rest from the complete months on file, per store.
  const src = start ? periodsBetween(start, periodOf(end)).filter(complete) : [];
  const byStore = new Map<ID, Map<ID, number>>();
  const storeMonths = new Map<ID, Set<string>>();
  const opened = new Map(state.stores.map((s) => [s.id, s.openedOn ? periodOf(s.openedOn) : '']));
  const skip = new Set(state.accounts.filter((a) => a.subtype === 'uncategorized').map((a) => a.id));
  for (const [k, v] of actual) {
    const x = parseKey(k);
    // Only complete months the store was open for (pre-opening costs don't repeat), and nothing uncategorized.
    if (!src.includes(x.period) || x.period < (opened.get(x.storeId) ?? '') || skip.has(x.accountId)) continue;
    if (!byStore.has(x.storeId)) byStore.set(x.storeId, new Map());
    const m = byStore.get(x.storeId)!;
    m.set(x.accountId, (m.get(x.accountId) ?? 0) + v);
    if (!storeMonths.has(x.storeId)) storeMonths.set(x.storeId, new Set());
    storeMonths.get(x.storeId)!.add(x.period);
  }
  const partial: ID[] = [];
  const endPeriod = periodOf(end);
  if (!complete(endPeriod)) {
    for (const s of state.stores) {
      if (s.deleted || byStore.has(s.id)) continue;
      const m = new Map<ID, number>();
      for (const [k, v] of actual) { const x = parseKey(k); if (x.storeId === s.id && x.period === endPeriod && !skip.has(x.accountId)) m.set(x.accountId, (m.get(x.accountId) ?? 0) + v); }
      if (!m.size) continue;
      const opened = s.openedOn && s.openedOn > firstDay(endPeriod) ? s.openedOn : firstDay(endPeriod);
      const days = Math.max(1, Number(end.slice(8, 10)) - Number(opened.slice(8, 10)) + 1);
      const full = Number(lastDayOfPeriod(endPeriod).slice(8, 10));
      for (const [a, v] of m) m.set(a, (v * full) / days);
      byStore.set(s.id, m);
      storeMonths.set(s.id, new Set(['1']));
      partial.push(s.id);
    }
  }
  for (const [storeId, accts] of byStore) {
    const n = storeMonths.get(storeId)!.size;
    const st = state.stores.find((s) => s.id === storeId);
    const opens = st?.openedOn ? periodOf(st.openedOn) : null;
    for (const p of rest) {
      if (opens && p < opens) continue;
      for (const [accountId, total] of accts) {
        const r = roundDollars((total / n) * g);
        if (r) lines[cellKey(storeId, accountId, p)] = r;
      }
    }
  }
  const srcLabel = src.length ? (src.length === 1 ? periodLabel(src[0]) : `${periodLabel(src[0])} – ${periodLabel(src.at(-1)!)}`) : '';
  const parts: string[] = [];
  if (priorMonths.length) parts.push(`${priorMonths.length} month${priorMonths.length === 1 ? '' : 's'} from the same month last year`);
  if (rest.length) {
    parts.push(src.length
      ? `${rest.length === 12 ? 'every month' : `${rest.length} months`} annualized from ${srcLabel} accrual actuals (${src.length} complete month${src.length === 1 ? '' : 's'}; the books ${start && periodOf(start) > `${opts.fiscalYear - 1}-12` ? `start ${periodLabel(start)}, so there is no prior year to copy` : 'have no prior-year month for these'}), flat by month`
      : 'no complete month on file to annualize');
  }
  const codes = partial.map((id) => state.stores.find((s) => s.id === id)?.code ?? id);
  const note = `Last year's actuals + ${opts.growthPct}% growth: ${parts.join('; ')}.${codes.length ? ` ${codes.join(', ')} scaled up from ${periodLabel(endPeriod)} to date (opened this month).` : ''} Rounded to whole dollars. Months before a store opens are $0.`;
  return { lines, note, sourceMonths: src, storesFromPartial: partial };
}

// ── Version writes ───────────────────────────────────────────────────────
export interface VersionInput { fiscalYear: number; name: string; method: BudgetMethod; growthPct: number; copyFromId?: ID; activate?: boolean }

export function validateVersion(state: BooksState, x: VersionInput): string[] {
  const errs: string[] = [];
  if (!x.name.trim()) errs.push('Give the budget a name, e.g. "FY2026 budget".');
  if (!Number.isInteger(x.fiscalYear) || x.fiscalYear < 2000 || x.fiscalYear > 2100) errs.push('Pick the fiscal year the budget is for.');
  if (!Number.isFinite(x.growthPct) || x.growthPct < -50 || x.growthPct > 100) errs.push('Growth must be a percent between −50 and 100.');
  if (budgetsOf(state).versions.some((v) => v.fiscalYear === x.fiscalYear && v.name.trim().toLowerCase() === x.name.trim().toLowerCase())) errs.push(`There is already a budget called "${x.name.trim()}" for this year; pick another name.`);
  if (x.copyFromId && !versionById(state, x.copyFromId)) errs.push('The version to copy no longer exists.');
  return errs;
}

export function createBudgetVersion(books: Books, actor: User, x: VersionInput, opts: { entries?: BasisEntry[]; asOf?: string } = {}): BudgetVersion {
  books.require(actor, 'budget.edit', 'build budgets');
  const errs = validateVersion(books.state, x);
  if (errs.length) throw new ValidationError(errs);
  const src = x.copyFromId ? versionById(books.state, x.copyFromId)! : undefined;
  const built = src ? { lines: { ...src.lines }, note: `Copied from "${src.name}". ${src.basisNote}` } : buildBudget(books.state, { fiscalYear: x.fiscalYear, method: x.method, growthPct: x.growthPct, entries: opts.entries, asOf: opts.asOf });
  const b = ensure(books);
  const now = books.clock();
  const first = !b.versions.some((v) => v.fiscalYear === x.fiscalYear);
  const v: BudgetVersion = {
    id: books.nextId('bud'), fiscalYear: x.fiscalYear, name: x.name.trim(), method: src ? src.method : x.method, growthPct: src ? src.growthPct : x.growthPct,
    basisNote: built.note, lines: built.lines, active: false, forecastMode: 'budget', forecast: {}, createdBy: actor.id, createdAt: now, updatedBy: actor.id, updatedAt: now,
  };
  b.versions.push(v);
  if (x.activate || first) for (const o of b.versions) if (o.fiscalYear === v.fiscalYear) o.active = o.id === v.id;
  books.audit(actor, { action: 'create', objectType: 'budget', objectId: v.id, summary: `Built budget "${v.name}" for FY${v.fiscalYear} (${formatMoney(versionTotals(books.state, v).net, { dollarSign: true, whole: true })} net profit)`, after: { ...v, lines: undefined } });
  books.changed();
  return v;
}

export function setActiveVersion(books: Books, actor: User, id: ID): void {
  books.require(actor, 'budget.edit', 'choose the active budget');
  const v = versionById(books.state, id);
  if (!v) throw new ValidationError(['That budget version no longer exists.']);
  const before = budgetsOf(books.state).versions.find((o) => o.fiscalYear === v.fiscalYear && o.active)?.id;
  for (const o of ensure(books).versions) if (o.fiscalYear === v.fiscalYear) o.active = o.id === id;
  books.audit(actor, { action: 'activate', objectType: 'budget', objectId: id, summary: `Made "${v.name}" the active FY${v.fiscalYear} budget`, before });
  books.changed();
}

export interface CellInput { storeId: ID; accountId: ID; period: string; amount: Cents }

function checkCells(state: BooksState, v: BudgetVersion, cells: CellInput[]): string[] {
  const errs: string[] = [];
  const months = new Set(fyPeriods(state, v.fiscalYear));
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  for (const c of cells) {
    if (!state.stores.some((s) => s.id === c.storeId && !s.deleted)) errs.push('Pick a store for every budget line.');
    const a = acc.get(c.accountId);
    if (!a || !isPnl(a)) errs.push('Budgets hold P&L lines only (sales, cost of goods, expenses).');
    if (!months.has(c.period)) errs.push(`${c.period} isn't in FY${v.fiscalYear}.`);
    if (!Number.isInteger(c.amount)) errs.push('Amounts are whole cents.');
  }
  return [...new Set(errs)];
}

/** Write grid cells (shown sign: sales +, costs +). Zero clears a cell. */
export function setBudgetCells(books: Books, actor: User, versionId: ID, cells: CellInput[], what: 'lines' | 'forecast' = 'lines'): void {
  books.require(actor, 'budget.edit', 'edit budgets');
  const v = versionById(books.state, versionId);
  if (!v) throw new ValidationError(['That budget version no longer exists.']);
  const errs = checkCells(books.state, v, cells);
  if (errs.length) throw new ValidationError(errs);
  const target = v[what];
  const before: Record<string, Cents | undefined> = {};
  for (const c of cells) {
    const k = cellKey(c.storeId, c.accountId, c.period);
    before[k] = target[k];
    if (c.amount) target[k] = c.amount; else delete target[k];
  }
  v.updatedAt = books.clock();
  v.updatedBy = actor.id;
  books.audit(actor, { action: 'edit', objectType: 'budget', objectId: v.id, summary: `Edited ${cells.length} ${what === 'lines' ? 'budget' : 'forecast'} cell${cells.length === 1 ? '' : 's'} in "${v.name}"`, before, after: Object.fromEntries(cells.map((c) => [cellKey(c.storeId, c.accountId, c.period), c.amount])) });
  books.changed();
}

/**
 * Fill one line across the year: `copy` repeats the `from` month in every later month; `spread` divides an annual
 * total evenly over the twelve months (cents add back exactly).
 */
export function fillAcross(books: Books, actor: User, versionId: ID, x: { storeId: ID; accountId: ID; mode: 'copy' | 'spread'; from?: string; annual?: Cents }): void {
  const v = versionById(books.state, versionId);
  if (!v) throw new ValidationError(['That budget version no longer exists.']);
  const months = fyPeriods(books.state, v.fiscalYear);
  let cells: CellInput[];
  if (x.mode === 'copy') {
    const from = x.from ?? months[0];
    if (!months.includes(from)) throw new ValidationError(['Pick a month in the budget year to copy from.']);
    const amount = v.lines[cellKey(x.storeId, x.accountId, from)] ?? 0;
    cells = months.filter((p) => p > from).map((period) => ({ storeId: x.storeId, accountId: x.accountId, period, amount }));
  } else {
    if (x.annual === undefined || !Number.isInteger(x.annual)) throw new ValidationError(['Enter the annual total to spread.']);
    const parts = allocate(x.annual, months.map(() => 1));
    cells = months.map((period, i) => ({ storeId: x.storeId, accountId: x.accountId, period, amount: parts[i] }));
  }
  setBudgetCells(books, actor, versionId, cells);
}

export function setForecastMode(books: Books, actor: User, versionId: ID, mode: BudgetVersion['forecastMode']): void {
  books.require(actor, 'budget.edit', 'change the forecast');
  const v = versionById(books.state, versionId);
  if (!v) throw new ValidationError(['That budget version no longer exists.']);
  const before = v.forecastMode;
  v.forecastMode = mode;
  books.audit(actor, { action: 'edit', objectType: 'budget', objectId: v.id, summary: `Forecast for "${v.name}" now uses ${mode === 'budget' ? 'the budget' : 'the run rate'} for remaining months`, before, after: mode });
  books.changed();
}

export function setVarianceThreshold(books: Books, actor: User, t: { pct: number; minCents: Cents }): void {
  books.require(actor, 'budget.edit', 'change the variance threshold');
  if (!(t.pct >= 0 && t.pct <= 100) || !Number.isInteger(t.minCents) || t.minCents < 0) throw new ValidationError(['The threshold is a percent from 0 to 100 and a dollar amount of $0 or more.']);
  const b = ensure(books);
  const before = { ...b.threshold };
  b.threshold = { pct: t.pct, minCents: t.minCents };
  books.audit(actor, { action: 'edit', objectType: 'budget', objectId: 'threshold', summary: `Variance threshold set to ${t.pct}% and ${formatMoney(t.minCents, { dollarSign: true, whole: true })}`, before, after: b.threshold });
  books.changed();
}

// ── Budget figures ───────────────────────────────────────────────────────
/** Budget cells for any month: the active version of that month's fiscal year. */
export function budgetCells(state: BooksState, opts: { versionId?: ID } = {}): Map<string, Cents> {
  const out = new Map<string, Cents>();
  const vs = opts.versionId ? [versionById(state, opts.versionId)].filter((v): v is BudgetVersion => !!v) : budgetsOf(state).versions.filter((v) => v.active);
  for (const v of vs) for (const [k, n] of Object.entries(v.lines)) out.set(k, n);
  return out;
}

export function versionTotals(state: BooksState, v: BudgetVersion): { sales: Cents; net: Cents; byStore: Map<ID, Cents> } {
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  let sales = 0, net = 0;
  const byStore = new Map<ID, Cents>();
  for (const [k, n] of Object.entries(v.lines)) {
    const x = parseKey(k);
    const a = acc.get(x.accountId);
    if (!a) continue;
    if (a.type === 'revenue' || a.type === 'contra_revenue') sales += shownSign(a) * n;
    net += shownSign(a) * n;
    byStore.set(x.storeId, (byStore.get(x.storeId) ?? 0) + shownSign(a) * n);
  }
  return { sales, net, byStore };
}

/** The budget as a statement (same rows, sections and totals as the P&L). */
export function budgetStatement(state: BooksState, opts: { from: string; to: string; storeIds: ID[]; cols?: 'store' | 'month'; versionId?: ID }): Statement {
  return statement(state, { basis: 'accrual', from: opts.from, to: opts.to, storeIds: opts.storeIds, cols: opts.cols, entries: cellsToEntries(state, budgetCells(state, { versionId: opts.versionId }), 'budget') });
}

/** Does any active budget cover these months? */
export function hasBudget(state: BooksState, from: string, to: string): boolean {
  const fys = new Set(periodsBetween(from, to).map((p) => fiscalYearOf(state, p)));
  return [...fys].some((fy) => !!activeVersion(state, fy));
}

// ── Budget vs actual ─────────────────────────────────────────────────────
export interface BvaRow { account: Account; actual: Cents; budget: Cents; variance: Cents; pct: number | null; /** Profit effect of the variance: + favorable. */ effect: Cents; flagged: number; uncommented: number }
export interface VarianceCell {
  key: string; period: string; storeId: ID; account: Account;
  actual: Cents; budget: Cents; variance: Cents; pct: number | null; effect: Cents;
  over: boolean; comments: VarianceComment[];
}
export interface Bva {
  from: string; to: string; basis: ReportBasis; storeIds: ID[];
  actual: Statement; budget: Statement; compare: BudgetCompare;
  rows: BvaRow[];
  cells: VarianceCell[];
  /** Actual column ties to the P&L statement on the same basis and range. */
  actualTiesToPnl: boolean;
  /** Budget column ties to the budget cells summed directly. */
  budgetTiesToCells: boolean;
  budgetCellNet: Cents;
  available: boolean;
}

export function isOver(state: BooksState, variance: Cents, budget: Cents): boolean {
  const t = budgetsOf(state).threshold;
  if (Math.abs(variance) < t.minCents) return false;
  return budget === 0 || Math.abs(variance) / Math.abs(budget) >= t.pct / 100;
}

/** Variance cells for each store × account × month in range, with comments and the threshold flag. */
export function varianceCells(state: BooksState, opts: { from: string; to: string; storeIds: ID[]; basis?: ReportBasis; entries?: BasisEntry[]; actual?: Map<string, Cents> }): VarianceCell[] {
  const actual = opts.actual ?? actualCells(state, { basis: opts.basis ?? 'accrual', entries: opts.entries });
  const budget = budgetCells(state);
  const periods = new Set(periodsBetween(opts.from, opts.to).filter((p) => !!activeVersion(state, fiscalYearOf(state, p))));
  const stores = new Set(opts.storeIds);
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const keys = new Set<string>();
  for (const m of [actual, budget]) for (const k of m.keys()) { const x = parseKey(k); if (periods.has(x.period) && stores.has(x.storeId)) keys.add(k); }
  const comments = new Map<string, VarianceComment[]>();
  for (const c of budgetsOf(state).comments) { const k = cellKey(c.storeId, c.accountId, c.period); comments.set(k, [...(comments.get(k) ?? []), c]); }
  const out: VarianceCell[] = [];
  for (const k of keys) {
    const x = parseKey(k);
    const a = acc.get(x.accountId);
    if (!a) continue;
    const act = actual.get(k) ?? 0, bud = budget.get(k) ?? 0;
    const variance = act - bud;
    out.push({ key: k, period: x.period, storeId: x.storeId, account: a, actual: act, budget: bud, variance, pct: bud ? variance / Math.abs(bud) : null, effect: shownSign(a) * variance, over: isOver(state, variance, bud), comments: comments.get(k) ?? [] });
  }
  return out.sort((p, q) => p.period.localeCompare(q.period) || p.storeId.localeCompare(q.storeId) || p.account.number.localeCompare(q.account.number));
}

export function bva(state: BooksState, opts: { from: string; to: string; storeIds: ID[]; basis?: ReportBasis; entries?: BasisEntry[] }): Bva {
  const basis = opts.basis ?? 'accrual';
  const entries = opts.entries ?? basisEntries(state);
  const actual = statement(state, { basis, from: opts.from, to: opts.to, storeIds: opts.storeIds, entries });
  const budget = budgetStatement(state, opts);
  const available = hasBudget(state, opts.from, opts.to);
  const compare = budgetCompare(actual, available ? { byAccount: Object.fromEntries(budget.rows.map((r) => [r.account.id, r.total])), net: budget.netIncome.total } : undefined);
  const cells = varianceCells(state, { ...opts, basis, entries });
  const ids = [...new Set([...actual.rows, ...budget.rows].map((r) => r.account.id))];
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const rows: BvaRow[] = ids.map((id) => {
    const a = acc.get(id)!;
    const act = actual.rows.find((r) => r.account.id === id)?.total ?? 0;
    const bud = budget.rows.find((r) => r.account.id === id)?.total ?? 0;
    const mine = cells.filter((c) => c.account.id === id && c.over);
    return { account: a, actual: act, budget: bud, variance: act - bud, pct: bud ? (act - bud) / Math.abs(bud) : null, effect: shownSign(a) * (act - bud), flagged: mine.length, uncommented: mine.filter((c) => !c.comments.length).length };
  }).sort((x, y) => x.account.number.localeCompare(y.account.number));
  const pnlCheck = statement(state, { basis, from: opts.from, to: opts.to, storeIds: opts.storeIds, entries });
  const want = new Set(opts.storeIds), periods = new Set(periodsBetween(opts.from, opts.to));
  const budgetCellNet = sumCells(state, budgetCells(state), (x) => want.has(x.storeId) && periods.has(x.period)).profit;
  return {
    from: opts.from, to: opts.to, basis, storeIds: opts.storeIds, actual, budget, compare, rows, cells,
    actualTiesToPnl: rows.reduce((s, r) => s + shownSign(r.account) * r.actual, 0) === pnlCheck.netIncome.total,
    budgetTiesToCells: budget.netIncome.total === budgetCellNet, budgetCellNet, available,
  };
}

export function addVarianceComment(books: Books, actor: User, x: { period: string; storeId: ID; accountId: ID; text: string }): VarianceComment {
  books.require(actor, 'budget.edit', 'comment on variances');
  const errs: string[] = [];
  if (!x.text.trim()) errs.push('Say what caused the variance, e.g. "Two extra Sysco deliveries for the football weekend".');
  if (!/^\d{4}-\d{2}$/.test(x.period)) errs.push('Pick the month the comment is for.');
  if (!books.state.stores.some((s) => s.id === x.storeId)) errs.push('Pick the store the comment is for.');
  const a = books.account(x.accountId);
  if (!a || !isPnl(a)) errs.push('Comments go on P&L lines.');
  if (errs.length) throw new ValidationError(errs);
  const c: VarianceComment = { id: books.nextId('vc'), period: x.period, storeId: x.storeId, accountId: x.accountId, text: x.text.trim(), by: actor.id, at: books.clock() };
  ensure(books).comments.push(c);
  books.audit(actor, { action: 'comment', objectType: 'budget', objectId: cellKey(x.storeId, x.accountId, x.period), summary: `Variance comment on ${a!.name}, ${books.store(x.storeId)?.code} ${x.period}`, after: c });
  books.changed();
  return c;
}

/** Over-threshold variances with no comment, in months that are over (before `today`'s month). */
export function uncommentedVariances(state: BooksState, opts: { storeIds: ID[]; today?: string; entries?: BasisEntry[] }): VarianceCell[] {
  const today = opts.today ?? todayInChicago();
  const vs = budgetsOf(state).versions.filter((v) => v.active);
  if (!vs.length) return [];
  const start = dataStart(state);
  if (!start) return [];
  const last = prevPeriod(periodOf(today));
  if (last < start) return [];
  return varianceCells(state, { from: start, to: last, storeIds: opts.storeIds, entries: opts.entries }).filter((c) => c.over && !c.comments.length);
}

// ── Rolling forecast ─────────────────────────────────────────────────────
export type ForecastSource = 'actual' | 'mtd' | 'forecast' | 'budget_before_books';
export interface ForecastMonth { period: string; source: ForecastSource; /** Share of the month still to come (mtd only). */ remaining: number }
export interface Forecast {
  fiscalYear: number;
  months: ForecastMonth[];
  /** Cells in shown sign for the whole year: actuals where the month is over, forecast for the rest. */
  cells: Map<string, Cents>;
  statement: Statement;
  /** The same year on the budget alone. */
  budget: Statement;
  /** Where the budget came from when the year has no active version. */
  budgetNote: string;
  mode: BudgetVersion['forecastMode'];
  version?: BudgetVersion;
  actualToDate: Cents;
  /** Net profit of the actual months, from the P&L independently. */
  actualPnl: Cents;
  ties: boolean;
}

/** The budget for a fiscal year: its active version, or the latest earlier active budget carried forward month for month. */
function yearBudget(state: BooksState, fy: number): { cells: Map<string, Cents>; note: string; version?: BudgetVersion } {
  const v = activeVersion(state, fy);
  if (v) return { cells: new Map(Object.entries(v.lines)), note: `Budget: "${v.name}".`, version: v };
  const earlier = budgetsOf(state).versions.filter((x) => x.active && x.fiscalYear < fy).sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
  const growthPct = earlier?.growthPct ?? 0;
  const built = buildBudget(state, { fiscalYear: fy, method: 'prior_actuals', growthPct });
  return { cells: new Map(Object.entries(built.lines)), note: `No FY${fy} budget yet: last year's actuals + ${growthPct}% stand in (${built.note.replace(/^Last year's actuals \+ [^:]+: /, '')})`, version: undefined };
}

export function rollingForecast(state: BooksState, opts: { fiscalYear: number; storeIds: ID[]; entries?: BasisEntry[]; today?: string }): Forecast {
  const today = opts.today ?? todayInChicago();
  const entries = opts.entries ?? basisEntries(state);
  const months = fyPeriods(state, opts.fiscalYear);
  const cur = periodOf(today);
  const start = dataStart(state) ?? cur;
  const want = new Set(opts.storeIds);
  const actual = actualCells(state, { basis: 'accrual', entries });
  const yb = yearBudget(state, opts.fiscalYear);
  const v = activeVersion(state, opts.fiscalYear);
  const mode = v?.forecastMode ?? 'budget';
  const overrides = v?.forecast ?? {};
  const full = Number(lastDayOfPeriod(cur).slice(8, 10));
  const fm: ForecastMonth[] = months.map((p) => ({
    period: p,
    source: p < start ? 'budget_before_books' : p < cur ? 'actual' : p === cur ? 'mtd' : 'forecast',
    remaining: p === cur ? (full - Number(today.slice(8, 10)) + 1) / full : p > cur ? 1 : 0,
  }));
  // Run rate: average of the last three complete actual months per cell.
  const complete = periodsBetween(start, prevPeriod(cur)).slice(-3);
  const runRate = new Map<string, Cents>();
  if (complete.length) {
    const tot = new Map<string, number>();
    for (const [k, n] of actual) { const x = parseKey(k); if (complete.includes(x.period)) { const kk = `${x.storeId}|${x.accountId}`; tot.set(kk, (tot.get(kk) ?? 0) + n); } }
    for (const [kk, n] of tot) runRate.set(kk, Math.round(n / complete.length));
  }
  const keysByMonth = new Map<string, Set<string>>();
  const addKey = (k: string) => { const x = parseKey(k); if (!want.has(x.storeId)) return; if (!keysByMonth.has(x.period)) keysByMonth.set(x.period, new Set()); keysByMonth.get(x.period)!.add(`${x.storeId}|${x.accountId}`); };
  for (const k of yb.cells.keys()) addKey(k);
  for (const k of actual.keys()) addKey(k);
  for (const k of Object.keys(overrides)) addKey(k);
  const cells = new Map<string, Cents>();
  const futureKeys = new Set<string>();
  for (const s of keysByMonth.values()) for (const k of s) futureKeys.add(k);
  if (mode === 'run_rate') for (const k of runRate.keys()) if (want.has(k.split('|')[0])) futureKeys.add(k);
  for (const m of fm) {
    const sa = m.source === 'actual' || m.source === 'budget_before_books' ? keysByMonth.get(m.period) ?? new Set<string>() : futureKeys;
    for (const kk of sa) {
      const [storeId, accountId] = kk.split('|');
      const k = cellKey(storeId, accountId, m.period);
      const plan = overrides[k] ?? (mode === 'run_rate' ? runRate.get(kk) ?? 0 : yb.cells.get(k) ?? 0);
      let n = 0;
      if (m.source === 'actual') n = actual.get(k) ?? 0;
      else if (m.source === 'budget_before_books') n = yb.cells.get(k) ?? 0;
      else if (m.source === 'mtd') n = (actual.get(k) ?? 0) + Math.round(plan * m.remaining);
      else n = plan;
      if (n) cells.set(k, n);
    }
  }
  const from = months[0], to = months[11];
  const st = statement(state, { basis: 'accrual', from, to, storeIds: opts.storeIds, cols: 'month', entries: cellsToEntries(state, cells, 'fc') });
  const bud = statement(state, { basis: 'accrual', from, to, storeIds: opts.storeIds, cols: 'month', entries: cellsToEntries(state, yb.cells, 'budget') });
  const actualMonths = fm.filter((m) => m.source === 'actual').map((m) => m.period);
  const actualToDate = actualMonths.reduce((a, p) => a + (st.netIncome[p] ?? 0), 0);
  const actualPnl = actualMonths.length ? statement(state, { basis: 'accrual', from: actualMonths[0], to: actualMonths.at(-1)!, storeIds: opts.storeIds, entries }).netIncome.total : 0;
  const note = mode === 'run_rate' ? `Remaining months: run rate of ${complete.length ? complete.map(periodLabel).join(', ') : 'no complete month'}. ${yb.note}` : yb.note;
  return { fiscalYear: opts.fiscalYear, months: fm, cells, statement: st, budget: bud, budgetNote: note, mode, version: v, actualToDate, actualPnl, ties: actualToDate === actualPnl };
}

// ── Scenarios ────────────────────────────────────────────────────────────
export const SCENARIO_KIND_LABEL: Record<ScenarioAdj['kind'], string> = {
  fuel_margin: 'Fuel margin ± ¢ a gallon',
  new_store: 'New store opens',
  close_kitchen: 'Close the kitchen one day a week',
  account_pct: '% change to an account group',
};
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PROFIT_GROUPS = new Set(GROUPS.filter((g) => g.profit).map((g) => g.key));
export const PCT_TARGETS = GROUPS.filter((g) => !g.profit).map((g) => ({ key: `group:${g.key}`, label: g.label }));
export const newStoreId = (code: string) => `new:${code.trim().toUpperCase()}`;

/** Average retail price per gallon at a store from every gallon on file (company average as a fallback). */
export function pricePerGallon(state: BooksState, storeId: ID): number | null {
  const rows = salesRows(state);
  const mine = rows.filter((r) => r.storeId === storeId);
  const use = mine.length ? mine : rows;
  const gal = use.reduce((a, r) => a + r.gallons, 0);
  return gal > 0 ? use.reduce((a, r) => a + r.retail, 0) / gal : null;
}
const isFuelSales = (a: Account) => a.type === 'revenue' && a.lob === 'fuel';

/** Share of a month's kitchen sales that fall on one weekday, from the average kitchen sales by weekday on file. */
export function weekdayShare(state: BooksState, storeId: ID, weekday: number, period: string): number {
  const byDow = Array.from({ length: 7 }, () => ({ sales: 0, days: new Set<string>() }));
  for (const t of state.transactions) {
    if (t.deleted) continue;
    for (const l of t.lines) if (l.accountId === 'acct_sales_kitchen' && l.storeId === storeId) { const d = byDow[dayOfWeek(t.date)]; d.sales += l.credit - l.debit; d.days.add(t.date); }
  }
  const avg = byDow.map((d) => (d.days.size ? d.sales / d.days.size : 0));
  let all = 0, that = 0;
  for (let d = firstDay(period); d <= lastDayOfPeriod(period); d = addDays(d, 1)) {
    const w = dayOfWeek(d);
    all += avg[w];
    if (w === weekday) that += avg[w];
  }
  return all > 0 ? that / all : 0;
}

/** Kitchen department's share of a store's pay (Gusto gross plus cash/check pay), or kitchen's share of sales when there's no payroll detail. */
export function kitchenLaborShare(state: BooksState, storeId: ID): number {
  const p = peopleOf(state);
  const dept = new Map(p.employees.map((e) => [e.id, e]));
  let kitchen = 0, all = 0;
  for (const r of p.runs) for (const l of r.lines) if (l.storeId === storeId) { all += l.gross; if (l.department === 'kitchen') kitchen += l.gross; }
  for (const o of p.offPayroll) { const e = dept.get(o.employeeId); if (e?.storeId !== storeId) continue; all += o.amount; if (e.department === 'kitchen') kitchen += o.amount; }
  if (all > 0) return kitchen / all;
  let ks = 0, ss = 0;
  for (const t of state.transactions) {
    if (t.deleted) continue;
    for (const l of t.lines) {
      if (l.storeId !== storeId) continue;
      const a = state.accounts.find((x) => x.id === l.accountId);
      if (a?.type !== 'revenue') continue;
      ss += l.credit - l.debit;
      if (a.lob === 'kitchen') ks += l.credit - l.debit;
    }
  }
  return ss > 0 ? ks / ss : 0;
}

export function adjLabel(state: BooksState, a: ScenarioAdj): string {
  const code = (id?: ID) => (id ? state.stores.find((s) => s.id === id)?.code ?? id : 'all stores');
  const from = (p?: string) => (p ? ` from ${periodLabel(p)}` : '');
  switch (a.kind) {
    case 'fuel_margin': return `Fuel margin ${a.cpg >= 0 ? '+' : '−'}${Math.abs(a.cpg)}¢ a gallon, ${code(a.storeId)}${from(a.from)}`;
    case 'new_store': return `New store ${a.code.toUpperCase()} opens ${periodLabel(a.opens)}, copying ${code(a.copyOf)}, ramping from ${a.rampStartPct}% over ${a.rampMonths} month${a.rampMonths === 1 ? '' : 's'}`;
    case 'close_kitchen': return `Close the kitchen on ${WEEKDAYS[a.weekday]}s, ${code(a.storeId)}${from(a.from)}`;
    case 'account_pct': {
      const label = a.target.startsWith('group:') ? GROUPS.find((g) => `group:${g.key}` === a.target)?.label ?? a.target : state.accounts.find((x) => `acct:${x.id}` === a.target)?.name ?? a.target;
      return `${label} ${a.pct >= 0 ? '+' : '−'}${Math.abs(a.pct)}%, ${code(a.storeId)}${from(a.from)}`;
    }
  }
}

export function validateScenario(state: BooksState, x: { name: string; fiscalYear: number; adjustments: ScenarioAdj[] }, selfId?: ID): string[] {
  const errs: string[] = [];
  if (!x.name.trim()) errs.push('Give the scenario a name, e.g. "Fuel −2¢ and no Sunday kitchen".');
  if (budgetsOf(state).scenarios.some((s) => s.id !== selfId && s.fiscalYear === x.fiscalYear && s.name.trim().toLowerCase() === x.name.trim().toLowerCase())) errs.push(`There is already a scenario called "${x.name.trim()}"; pick another name.`);
  if (!x.adjustments.length) errs.push('Add at least one change to the forecast.');
  const months = new Set(fyPeriods(state, x.fiscalYear));
  const store = (id?: ID) => !id || state.stores.some((s) => s.id === id && !s.deleted);
  for (const a of x.adjustments) {
    if ('from' in a && a.from && !months.has(a.from)) errs.push(`Start month ${a.from} isn't in FY${x.fiscalYear}.`);
    if ('storeId' in a && !store(a.storeId)) errs.push('Pick a store that exists, or all stores.');
    if (a.kind === 'fuel_margin' && !(Number.isFinite(a.cpg) && Math.abs(a.cpg) <= 100 && a.cpg !== 0)) errs.push('Fuel margin change is a number of cents a gallon between −100 and 100, not zero.');
    if (a.kind === 'close_kitchen') {
      if (!(Number.isInteger(a.weekday) && a.weekday >= 0 && a.weekday <= 6)) errs.push('Pick the day of the week the kitchen closes.');
      if (a.storeId && !state.stores.find((s) => s.id === a.storeId)?.hasKitchen) errs.push(`${state.stores.find((s) => s.id === a.storeId)?.code} has no kitchen; pick a store with one.`);
    }
    if (a.kind === 'account_pct') {
      if (!(Number.isFinite(a.pct) && a.pct >= -100 && a.pct <= 500 && a.pct !== 0)) errs.push('The % change is between −100 and 500, not zero.');
      const okT = a.target.startsWith('group:') ? GROUPS.some((g) => `group:${g.key}` === a.target) && !PROFIT_GROUPS.has(a.target.slice(6)) : state.accounts.some((acc) => `acct:${acc.id}` === a.target && isPnl(acc));
      if (!okT) errs.push('Pick a sales, cost or expense group, or one P&L account (not a profit line).');
    }
    if (a.kind === 'new_store') {
      if (!a.code.trim()) errs.push('Give the new store a short code, e.g. HM19.');
      else if (state.stores.some((s) => s.code.toUpperCase() === a.code.trim().toUpperCase())) errs.push(`${a.code.trim().toUpperCase()} is already a store; pick a new code.`);
      if (!state.stores.some((s) => s.id === a.copyOf && s.kind === 'operating')) errs.push('Pick an operating store whose profile the new store copies.');
      if (!months.has(a.opens)) errs.push(`Pick an opening month in FY${x.fiscalYear}.`);
      if (!(Number.isInteger(a.rampMonths) && a.rampMonths >= 0 && a.rampMonths <= 24)) errs.push('The ramp is 0 to 24 months.');
      if (!(a.rampStartPct > 0 && a.rampStartPct <= 100)) errs.push('The opening level is a percent above 0 and up to 100.');
    }
  }
  return [...new Set(errs)];
}

export function saveScenario(books: Books, actor: User, x: { name: string; fiscalYear: number; adjustments: ScenarioAdj[]; note?: string }, id?: ID): Scenario {
  books.require(actor, 'budget.edit', 'save scenarios');
  const errs = validateScenario(books.state, x, id);
  if (errs.length) throw new ValidationError(errs);
  const b = ensure(books);
  const now = books.clock();
  const existing = id ? b.scenarios.find((s) => s.id === id) : undefined;
  const before = existing ? structuredClone(existing) : undefined;
  const s: Scenario = existing ?? { id: books.nextId('scn'), name: '', fiscalYear: x.fiscalYear, adjustments: [], createdBy: actor.id, createdAt: now, updatedAt: now };
  Object.assign(s, { name: x.name.trim(), fiscalYear: x.fiscalYear, adjustments: structuredClone(x.adjustments), note: x.note?.trim() || undefined, updatedAt: now });
  if (!existing) b.scenarios.push(s);
  books.audit(actor, { action: existing ? 'update' : 'create', objectType: 'budget', objectId: s.id, summary: `${existing ? 'Updated' : 'Saved'} scenario "${s.name}"`, before, after: structuredClone(s) });
  books.changed();
  return s;
}

export function deleteScenario(books: Books, actor: User, id: ID): void {
  books.require(actor, 'budget.edit', 'delete scenarios');
  const b = ensure(books);
  const s = b.scenarios.find((x) => x.id === id);
  if (!s) return;
  b.scenarios = b.scenarios.filter((x) => x.id !== id);
  books.audit(actor, { action: 'delete', objectType: 'budget', objectId: id, summary: `Deleted scenario "${s.name}"`, before: s });
  books.changed();
}

export interface ScenarioEffect { adj: ScenarioAdj; label: string; cells: Map<string, Cents>; net: Cents; detail: string }
export interface ScenarioResult {
  scenario: Pick<Scenario, 'name' | 'fiscalYear' | 'adjustments'>;
  base: Forecast;
  cells: Map<string, Cents>;
  storeIds: ID[];
  statement: Statement;
  effects: ScenarioEffect[];
  baseNet: Cents;
  net: Cents;
  /** scenario − base = Σ effects, computed. */
  ties: boolean;
}

const VARIABLE = (a: Account) => a.type === 'revenue' || a.type === 'contra_revenue' || a.type === 'cogs' || CARD_FEE_ACCTS.includes(a.id);

/** Apply a scenario's changes on top of the rolling forecast. Each change is figured on the base forecast, so the order doesn't matter. */
export function runScenario(state: BooksState, scn: Pick<Scenario, 'name' | 'fiscalYear' | 'adjustments'>, opts: { storeIds: ID[]; entries?: BasisEntry[]; today?: string; base?: Forecast }): ScenarioResult {
  const base = opts.base ?? rollingForecast(state, { fiscalYear: scn.fiscalYear, storeIds: opts.storeIds, entries: opts.entries, today: opts.today });
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const share = new Map(base.months.map((m) => [m.period, m.remaining]));
  const want = new Set(opts.storeIds);
  const effects: ScenarioEffect[] = [];
  const extraStores: ID[] = [];
  const affected = (p: string, from?: string) => (share.get(p) ?? 0) > 0 && (!from || p >= from);
  const baseBy = (filter: (x: { storeId: ID; accountId: ID; period: string }) => boolean) => [...base.cells].map(([k, v]) => ({ k, v, ...parseKey(k) })).filter(filter);
  for (const adj of scn.adjustments) {
    const cells = new Map<string, Cents>();
    const add = (k: string, n: number) => { const r = Math.round(n); if (r) cells.set(k, (cells.get(k) ?? 0) + r); };
    let detail = '';
    if (adj.kind === 'fuel_margin') {
      let gallons = 0;
      const stores = adj.storeId ? [adj.storeId] : opts.storeIds;
      for (const storeId of stores) {
        if (!want.has(storeId)) continue;
        const ppg = pricePerGallon(state, storeId);
        if (!ppg) continue;
        const rev = new Map<string, number>();
        for (const c of baseBy((x) => x.storeId === storeId && affected(x.period, adj.from) && isFuelSales(acc.get(x.accountId)!))) rev.set(c.period, (rev.get(c.period) ?? 0) + c.v);
        for (const [p, r] of rev) {
          const g = (r * share.get(p)!) / ppg;
          gallons += g;
          add(cellKey(storeId, 'acct_cogs_fuel', p), -adj.cpg * g);
        }
      }
      detail = `${Math.round(gallons).toLocaleString('en-US')} forecast gallons × ${adj.cpg}¢`;
    } else if (adj.kind === 'new_store') {
      const id = newStoreId(adj.code);
      extraStores.push(id);
      const start = adj.rampStartPct / 100;
      for (const c of baseBy((x) => x.storeId === adj.copyOf && x.period >= adj.opens && affected(x.period))) {
        const i = monthIndex(c.period) - monthIndex(adj.opens);
        const ramp = adj.rampMonths <= 0 ? 1 : Math.min(1, start + ((1 - start) * i) / adj.rampMonths);
        add(cellKey(id, c.accountId, c.period), c.v * share.get(c.period)! * (VARIABLE(acc.get(c.accountId)!) ? ramp : 1));
      }
      detail = `${state.stores.find((s) => s.id === adj.copyOf)?.code} profile; sales, cost of goods and card fees ramp, fixed costs from day one`;
    } else if (adj.kind === 'close_kitchen') {
      const stores = (adj.storeId ? [adj.storeId] : opts.storeIds).filter((s) => want.has(s) && state.stores.find((x) => x.id === s)?.hasKitchen);
      const parts: string[] = [];
      for (const storeId of stores) {
        const ls = kitchenLaborShare(state, storeId);
        let avgShare = 0, n = 0;
        for (const c of baseBy((x) => x.storeId === storeId && affected(x.period, adj.from))) {
          const a = acc.get(c.accountId)!;
          const ws = weekdayShare(state, storeId, adj.weekday, c.period) * share.get(c.period)!;
          if (c.accountId === 'acct_sales_kitchen') { add(c.k, -c.v * ws); avgShare += ws; n += 1; }
          else if (a.type === 'cogs' && a.lob === 'kitchen') add(c.k, -c.v * ws);
          else if (LABOR_ACCTS.includes(c.accountId)) add(c.k, -c.v * ws * ls);
        }
        parts.push(`${state.stores.find((x) => x.id === storeId)?.code}: ${n ? ((avgShare / n) * 100).toFixed(1) : '0.0'}% of kitchen sales, kitchen ${(ls * 100).toFixed(0)}% of labor`);
      }
      detail = parts.join('; ') || 'no store with a kitchen';
    } else {
      const match = adj.target.startsWith('group:') ? GROUPS.find((g) => `group:${g.key}` === adj.target)?.match ?? (() => false) : (a: Account) => `acct:${a.id}` === adj.target;
      for (const c of baseBy((x) => (!adj.storeId || x.storeId === adj.storeId) && want.has(x.storeId) && affected(x.period, adj.from) && match(acc.get(x.accountId)!))) add(c.k, (c.v * adj.pct * share.get(c.period)!) / 100);
      detail = `${adj.pct}% of the forecast lines it covers`;
    }
    const net = [...cells].reduce((s, [k, v]) => s + shownSign(acc.get(parseKey(k).accountId)!) * v, 0);
    effects.push({ adj, label: adjLabel(state, adj), cells, net, detail });
  }
  const cells = new Map(base.cells);
  for (const e of effects) for (const [k, v] of e.cells) { const n = (cells.get(k) ?? 0) + v; if (n) cells.set(k, n); else cells.delete(k); }
  const months = fyPeriods(state, scn.fiscalYear);
  const storeIds = [...opts.storeIds, ...extraStores];
  const st = statement(state, { basis: 'accrual', from: months[0], to: months[11], storeIds, cols: 'month', entries: cellsToEntries(state, cells, 'scn') });
  const baseNet = base.statement.netIncome.total;
  return { scenario: scn, base, cells, storeIds, statement: st, effects, baseNet, net: st.netIncome.total, ties: st.netIncome.total - baseNet === effects.reduce((s, e) => s + e.net, 0) };
}

// ── Break-even ───────────────────────────────────────────────────────────
export interface BreakEvenRow {
  storeId: ID;
  sales: Cents;
  variable: Cents;
  contribution: Cents;
  /** Contribution margin as a fraction of sales. */
  cmPct: number | null;
  fixed: Cents;
  net: Cents;
  breakEvenSales: Cents | null;
  gallons: number;
  breakEvenGallons: number | null;
  /** (sales − break-even) ÷ sales. */
  safety: number | null;
  days: number;
}

/**
 * Break-even per store: fixed costs ÷ contribution margin %. Variable costs are cost of goods plus card and network
 * fees (they move with sales); fixed costs are every other operating expense. Break-even gallons are at the store's
 * current sales mix: gallons × break-even sales ÷ sales. Same formula as the scorecard's break-even sales.
 */
export function breakEven(state: BooksState, opts: { from: string; to: string; storeIds: ID[]; source?: 'actual' | 'budget'; entries?: BasisEntry[] }): BreakEvenRow[] {
  const source = opts.source ?? 'actual';
  const st = source === 'actual' ? statement(state, { basis: 'accrual', from: opts.from, to: opts.to, storeIds: opts.storeIds, entries: opts.entries }) : budgetStatement(state, opts);
  const days = periodsBetween(opts.from, opts.to).reduce((a, p) => a + Number(lastDayOfPeriod(p).slice(8, 10)), 0);
  const gal = new Map<ID, number>();
  for (const r of salesRows(state, { from: firstDay(opts.from), to: lastDayOfPeriod(opts.to) })) gal.set(r.storeId, (gal.get(r.storeId) ?? 0) + r.gallons);
  return opts.storeIds.filter((s) => st.netSales[s]).map((s) => {
    const sales = st.netSales[s];
    const fees = st.rows.filter((r) => CARD_FEE_ACCTS.includes(r.account.id)).reduce((a, r) => a + (r.by[s] ?? 0), 0);
    const variable = st.cogs[s] + fees;
    const contribution = sales - variable;
    const fixed = st.expenses[s] - fees;
    const cmRatio = sales ? contribution / sales : 0;
    const be = cmRatio > 0 ? Math.round(fixed / cmRatio) : null;
    let gallons = gal.get(s) ?? 0;
    if (source === 'budget') {
      const ppg = pricePerGallon(state, s);
      const fuelRev = st.rows.filter((r) => isFuelSales(r.account)).reduce((a, r) => a + (r.by[s] ?? 0), 0);
      gallons = ppg ? fuelRev / ppg : 0;
    }
    return {
      storeId: s, sales, variable, contribution, cmPct: sales ? cmRatio : null, fixed, net: st.netIncome[s], breakEvenSales: be,
      gallons, breakEvenGallons: be !== null && sales ? (gallons * be) / sales : null, safety: be !== null && sales ? (sales - be) / sales : null, days,
    };
  });
}
