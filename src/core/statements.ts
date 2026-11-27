/**
 * Phase 4 — financial statements on two bases, the bridge between them, the balance sheet, the cash flow
 * statement, the command center, store scorecards and the report builder. Pure functions over BooksState;
 * the only writers are the saved-report / note / threshold operations at the bottom.
 *
 * Basis definitions (also in docs/DECISIONS.md and the P&L help note):
 *
 * BOOKED  — the ledger as posted: every P&L line on its transaction date. Fuel cost (5000) is fuel invoices
 *           on the day they were paid (netted on a Craddock notice, or out of Dash clearing).
 *
 * CASH    — every P&L line on the day its cash moved:
 *           · a transaction that touches a bank account counts on the date its bank line cleared (the matched
 *             statement line). If it hasn't cleared: a check is left out until it clears; anything else
 *             (ACH, card, online payment — the feed may simply not be imported yet) counts on its book date.
 *           · a bill counts when it is paid (the payment's clear date by the same rule), not when approved;
 *             an unpaid bill is left out.
 *           · anything settled through cash on hand, cash in transit or supplier / card clearing counts on its
 *             book date: those are cash equivalents (card proceeds the supplier holds for us, settled in days).
 *           · non-cash entries (depreciation, rent pass-throughs paid by a related party) count on their date.
 *
 * ACCRUAL — every P&L line on its transaction date, except fuel: paid fuel invoices (5000) are taken out and
 *           replaced by accrual fuel COGS from `fuelCostOfSales` (gallons sold × that month's delivered cost
 *           per gallon), dated the last day of the month. Merchandise and food are on their invoice date:
 *           bills post on the bill date when approved, and direct purchases carry the invoice date as their
 *           transaction date.
 *
 * Every P&L line becomes a BasisEntry with a cash date and an accrual date (either may be null = not in that
 * basis). Cash and accrual P&Ls are sums over the same entries, so the bridge — each entry's
 * (in accrual − in cash) × amount, grouped by why its dates differ — ties to the cent by construction.
 */
import type { Books } from './books';
import { ValidationError } from './books';
import type {
  Account, AccountSubtype, BooksState, ID, KpiThreshold, LineOfBusiness, ReportBasis, ReportsState, SavedReport, ScorecardNote, Transaction, User,
} from './types';
import { isPnl, normalSign, SYS } from './ledger';
import { addDays, lastDayOfPeriod, periodOf, periodsBetween } from './dates';
import { matchIndex } from './bank';
import { apState } from './payables';
import { costTable, fuelCostOfSales, fuelMargin, fuelOf, salesRows, FUEL_ACCT, type FuelCostOfSales } from './fuel';
import { laborTarget } from './payroll';
import { fiscalYearStart, flatLines, trialBalance, type FlatLine, type PnlSection } from './reports';
import { formatMoney } from './money';

export const BASIS_LABEL: Record<ReportBasis, string> = { booked: 'Booked (ledger)', cash: 'Cash', accrual: 'Accrual' };
const LOBS: LineOfBusiness[] = ['fuel', 'inside', 'kitchen', 'other'];
export const LABOR_ACCTS: ID[] = ['acct_wages', 'acct_payroll_taxes'];
export const CARD_FEE_ACCTS: ID[] = ['acct_card_fees', 'acct_network_fees'];
export const OVER_SHORT_ACCT = 'acct_over_short';
/** Cash and cash equivalents for the cash basis and the cash flow statement. */
export const CASH_EQUIV: AccountSubtype[] = ['bank', 'cash', 'clearing'];

// ── Ranges ───────────────────────────────────────────────────────────────
export const firstDay = (period: string) => `${period}-01`;
export function priorRange(from: string, to: string): { from: string; to: string } {
  const n = periodsBetween(from, to).length;
  const end = periodOf(addDays(firstDay(from), -1));
  let start = end;
  for (let i = 1; i < n; i++) start = periodOf(addDays(firstDay(start), -1));
  return { from: start, to: end };
}

// ── Basis entries ────────────────────────────────────────────────────────
export type BridgeReason = 'clear_timing' | 'uncleared_check' | 'bill_timing' | 'fuel_paid' | 'fuel_accrual';
export const BRIDGE_LABEL: Record<BridgeReason, { label: string; detail: string }> = {
  clear_timing: { label: 'Bank clear date vs book date', detail: 'Booked in the period but cleared the bank in another, less items that cleared in the period from another.' },
  uncleared_check: { label: 'Checks written, not yet cleared', detail: 'Cash basis leaves out checks until they clear the bank.' },
  bill_timing: { label: 'Bills on invoice date, not when paid', detail: 'Accrual expenses a bill on its bill date; cash basis when the payment clears.' },
  fuel_paid: { label: 'Paid fuel invoices taken out', detail: 'Fuel invoices paid in the period (account 5000), the cash-basis fuel cost.' },
  fuel_accrual: { label: 'Accrual fuel cost of sales put in', detail: 'Gallons sold × that month\'s delivered cost per gallon (Plus blended 50/50).' },
};
export const BRIDGE_ORDER: BridgeReason[] = ['clear_timing', 'uncleared_check', 'bill_timing', 'fuel_paid', 'fuel_accrual'];

export interface BasisEntry {
  id: string;
  accountId: ID;
  storeId: ID;
  /** Profit effect in cents: credit − debit (revenue +, costs −). */
  amount: number;
  bookDate: string;
  /** null: not in the cash basis (an uncleared check, an unpaid bill, accrual fuel cost). */
  cashDate: string | null;
  /** null: not in the accrual basis (paid fuel invoices). */
  accrualDate: string | null;
  /** Why the cash and accrual dates differ; null when they agree. */
  reason: BridgeReason | null;
  txn?: Transaction;
  lineId?: ID;
  /** Accrual fuel COGS entries have no transaction: this is their working. */
  fuel?: FuelCostOfSales;
  checkNo?: string;
}

/** Cash date of a transaction, by the cash-basis rules above. */
function cashDater(state: BooksState) {
  const bank = new Set(state.accounts.filter((a) => a.subtype === 'bank').map((a) => a.id));
  const idx = matchIndex(state);
  return (t: Transaction): string | null => {
    const lines = t.lines.filter((l) => bank.has(l.accountId));
    if (!lines.length) return t.date;
    const cleared = lines.map((l) => idx.get(l.id)?.date).filter((d): d is string => !!d).sort();
    if (cleared.length) return cleared.at(-1)!;
    return t.checkNo ? null : t.date;
  };
}

/** Every P&L line in the books as a basis entry, plus one accrual fuel COGS entry per store and month with fuel sales. */
export function basisEntries(state: BooksState): BasisEntry[] {
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const cashDate = cashDater(state);
  const byId = new Map(state.transactions.map((t) => [t.id, t]));
  const billPay = new Map<ID, Transaction | null>();
  for (const b of apState(state).bills) {
    if (!b.approved) continue;
    const pay = b.payment ? byId.get(b.payment.txnId) : undefined;
    billPay.set(b.approved.txnId, pay && !pay.deleted ? pay : null);
  }
  const out: BasisEntry[] = [];
  for (const t of state.transactions) {
    if (t.deleted) continue;
    const isBill = billPay.has(t.id);
    const pay = billPay.get(t.id);
    const cd = isBill ? (pay ? cashDate(pay) : null) : cashDate(t);
    for (const l of t.lines) {
      const a = acc.get(l.accountId);
      if (!a || !isPnl(a)) continue;
      const fuelPaid = l.accountId === FUEL_ACCT.cogs;
      const accrualDate = fuelPaid ? null : t.date;
      let reason: BridgeReason | null = null;
      if (fuelPaid) reason = 'fuel_paid';
      else if (cd !== accrualDate) reason = isBill ? 'bill_timing' : cd === null ? 'uncleared_check' : 'clear_timing';
      out.push({ id: l.id, accountId: l.accountId, storeId: l.storeId, amount: l.credit - l.debit, bookDate: t.date, cashDate: cd, accrualDate, reason, txn: t, lineId: l.id, checkNo: t.checkNo });
    }
  }
  const table = costTable(state);
  const keys = new Set(salesRows(state).map((r) => `${r.storeId}|${periodOf(r.date)}`));
  for (const k of [...keys].sort()) {
    const [storeId, period] = k.split('|');
    const f = fuelCostOfSales(state, storeId, period, table);
    if (!f.cogs) continue;
    const d = lastDayOfPeriod(period);
    out.push({ id: `fuelcogs:${k}`, accountId: FUEL_ACCT.cogs, storeId, amount: -f.cogs, bookDate: d, cashDate: null, accrualDate: d, reason: 'fuel_accrual', fuel: f });
  }
  return out;
}

export function entryDate(e: BasisEntry, basis: ReportBasis): string | null {
  if (basis === 'cash') return e.cashDate;
  if (basis === 'accrual') return e.accrualDate;
  return e.fuel ? null : e.bookDate;
}

// ── Statements (P&L on any basis) ────────────────────────────────────────
export interface StmtRow {
  account: Account;
  section: PnlSection;
  lob: LineOfBusiness;
  /** Shown sign (revenue +, contra −, costs +), keyed by column. */
  by: Record<string, number>;
  total: number;
}
export interface Statement {
  basis: ReportBasis;
  from: string;
  to: string;
  colKind: 'store' | 'month';
  cols: string[];
  rows: StmtRow[];
  netSales: Record<string, number>;
  cogs: Record<string, number>;
  grossProfit: Record<string, number>;
  expenses: Record<string, number>;
  netIncome: Record<string, number>;
  salesByLob: Record<LineOfBusiness, Record<string, number>>;
  gpByLob: Record<LineOfBusiness, Record<string, number>>;
  /** Straight sum of every entry's profit effect in range: the independent check. */
  independent: number;
  /** netIncome.total − independent; must be zero. */
  difference: number;
  entryCount: number;
}

export interface StmtOpts { basis: ReportBasis; from: string; to: string; storeIds: ID[]; cols?: 'store' | 'month'; entries?: BasisEntry[] }

export function shownSign(a: Account): 1 | -1 {
  return a.type === 'revenue' || a.type === 'contra_revenue' ? 1 : -1;
}

export function statement(state: BooksState, opts: StmtOpts): Statement {
  const colKind = opts.cols ?? 'store';
  const cols = colKind === 'store' ? [...opts.storeIds] : periodsBetween(opts.from, opts.to);
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const want = new Set(opts.storeIds);
  const d0 = firstDay(opts.from), d1 = lastDayOfPeriod(opts.to);
  const rowMap = new Map<ID, StmtRow>();
  let independent = 0;
  let n = 0;
  for (const e of opts.entries ?? basisEntries(state)) {
    if (!want.has(e.storeId)) continue;
    const d = entryDate(e, opts.basis);
    if (!d || d < d0 || d > d1) continue;
    const a = acc.get(e.accountId);
    if (!a) continue;
    independent += e.amount;
    n += 1;
    const key = colKind === 'store' ? e.storeId : periodOf(d);
    let r = rowMap.get(a.id);
    if (!r) { r = { account: a, section: a.type as PnlSection, lob: a.lob ?? 'other', by: {}, total: 0 }; rowMap.set(a.id, r); }
    const v = shownSign(a) * e.amount;
    r.by[key] = (r.by[key] ?? 0) + v;
    r.total += v;
  }
  const rows = [...rowMap.values()].sort((x, y) => x.account.number.localeCompare(y.account.number));
  const keys = [...cols, 'total'];
  const zero = () => Object.fromEntries(keys.map((k) => [k, 0])) as Record<string, number>;
  const netSales = zero(), cogs = zero(), expenses = zero(), grossProfit = zero(), netIncome = zero();
  const salesByLob = Object.fromEntries(LOBS.map((l) => [l, zero()])) as Statement['salesByLob'];
  const cogsByLob = Object.fromEntries(LOBS.map((l) => [l, zero()])) as Statement['salesByLob'];
  const gpByLob = Object.fromEntries(LOBS.map((l) => [l, zero()])) as Statement['gpByLob'];
  for (const r of rows) for (const k of keys) {
    const v = k === 'total' ? r.total : r.by[k] ?? 0;
    if (r.section === 'revenue' || r.section === 'contra_revenue') { netSales[k] += v; salesByLob[r.lob][k] += v; }
    else if (r.section === 'cogs') { cogs[k] += v; cogsByLob[r.lob][k] += v; }
    else expenses[k] += v;
  }
  for (const k of keys) {
    grossProfit[k] = netSales[k] - cogs[k];
    netIncome[k] = grossProfit[k] - expenses[k];
    for (const l of LOBS) gpByLob[l][k] = salesByLob[l][k] - cogsByLob[l][k];
  }
  return { basis: opts.basis, from: opts.from, to: opts.to, colKind, cols, rows, netSales, cogs, grossProfit, expenses, netIncome, salesByLob, gpByLob, independent, difference: netIncome.total - independent, entryCount: n };
}

// ── Bridge: cash → accrual ───────────────────────────────────────────────
export interface BridgeLine { reason: BridgeReason; label: string; detail: string; amount: number; count: number }
export interface Bridge {
  cash: number;
  accrual: number;
  lines: BridgeLine[];
  /** Σ lines. */
  total: number;
  /** cash + Σ lines = accrual, computed. */
  ties: boolean;
  fuel: {
    /** Fuel delivered in the period at invoice cost (product + freight + taxes). */
    delivered: number;
    /** Fuel invoices paid in the period (cash-basis fuel cost). */
    paid: number;
    /** Accrual fuel COGS. */
    accrualCogs: number;
    /** delivered − accrual COGS: the increase in fuel inventory (1300) at delivered cost. Not yet booked in the ledger. */
    inventoryChange: number;
    /** delivered − paid: the increase in fuel delivered but not yet paid for. */
    payableChange: number;
  };
}

export function bridge(state: BooksState, opts: { from: string; to: string; storeIds: ID[]; entries?: BasisEntry[] }): Bridge {
  const entries = opts.entries ?? basisEntries(state);
  const want = new Set(opts.storeIds);
  const d0 = firstDay(opts.from), d1 = lastDayOfPeriod(opts.to);
  const inR = (d: string | null) => !!d && d >= d0 && d <= d1;
  const sums = new Map<BridgeReason, { amount: number; count: number }>();
  let cash = 0, accrual = 0, paid = 0, accrualCogs = 0;
  for (const e of entries) {
    if (!want.has(e.storeId)) continue;
    const c = inR(e.cashDate), a = inR(e.accrualDate);
    if (c) cash += e.amount;
    if (a) accrual += e.amount;
    if (e.reason === 'fuel_paid' && c) paid -= e.amount;
    if (e.reason === 'fuel_accrual' && a) accrualCogs -= e.amount;
    const diff = (a ? 1 : 0) - (c ? 1 : 0);
    if (!diff || !e.reason) continue;
    const s = sums.get(e.reason) ?? { amount: 0, count: 0 };
    s.amount += diff * e.amount;
    s.count += 1;
    sums.set(e.reason, s);
  }
  const lines = BRIDGE_ORDER.map((reason) => ({ reason, ...BRIDGE_LABEL[reason], amount: sums.get(reason)?.amount ?? 0, count: sums.get(reason)?.count ?? 0 }));
  const total = lines.reduce((x, l) => x + l.amount, 0);
  // Fuel delivered in range at invoice cost, on the same basis as the cost per gallon (no duplicates, no BOL-only loads).
  let delivered = 0;
  const periods = new Set(periodsBetween(opts.from, opts.to));
  for (const [k, v] of costTable(state)) {
    const [s, p] = k.split('|');
    if (s !== '*' && want.has(s) && periods.has(p)) delivered += v.cost;
  }
  delivered = Math.round(delivered);
  return { cash, accrual, lines, total, ties: cash + total === accrual, fuel: { delivered, paid, accrualCogs, inventoryChange: delivered - accrualCogs, payableChange: delivered - paid } };
}

// ── Drill-down ───────────────────────────────────────────────────────────
export function drill(entries: BasisEntry[], opts: { basis: ReportBasis; from: string; to: string; storeIds: ID[]; accountIds?: Set<ID> }): BasisEntry[] {
  const want = new Set(opts.storeIds);
  const d0 = firstDay(opts.from), d1 = lastDayOfPeriod(opts.to);
  return entries.filter((e) => {
    if (!want.has(e.storeId) || (opts.accountIds && !opts.accountIds.has(e.accountId))) return false;
    const d = entryDate(e, opts.basis);
    return !!d && d >= d0 && d <= d1;
  }).sort((a, b) => (entryDate(a, opts.basis)! .localeCompare(entryDate(b, opts.basis)!)) || (a.txn?.ref ?? '').localeCompare(b.txn?.ref ?? ''));
}

// ── Budget hook (phase 8) ────────────────────────────────────────────────
/** Budget figures for one range, shown sign, by account id (and optionally by column). Phase 8 supplies these. */
export interface BudgetFigures { byAccount: Record<ID, number> }
export type BudgetCompare =
  | { available: false; message: string }
  | { available: true; rows: { accountId: ID; actual: number; budget: number; variance: number; pct: number | null }[]; actualNet: number; budgetNet: number };

/** Actual vs budget per P&L line. With no budget figures it says so; phase 8 passes them in. */
export function budgetCompare(stmt: Statement, budget?: BudgetFigures): BudgetCompare {
  if (!budget) return { available: false, message: 'Budgets arrive in phase 8.' };
  const ids = new Set([...stmt.rows.map((r) => r.account.id), ...Object.keys(budget.byAccount)]);
  const rows = [...ids].map((accountId) => {
    const actual = stmt.rows.find((r) => r.account.id === accountId)?.total ?? 0;
    const b = budget.byAccount[accountId] ?? 0;
    return { accountId, actual, budget: b, variance: actual - b, pct: b ? (actual - b) / Math.abs(b) : null };
  });
  return { available: true, rows, actualNet: stmt.netIncome.total, budgetNet: 0 };
}

// ── Balance sheet ────────────────────────────────────────────────────────
export interface BsChild { key: string; label: string; amount: number }
export interface BsLine { account: Account; amount: number; children?: BsChild[] }
export interface BsGroup { key: string; label: string; lines: BsLine[]; total: number; extra?: { label: string; amount: number } }
export interface BsSection { key: 'assets' | 'liabilities' | 'equity'; label: string; groups: BsGroup[]; total: number }
export interface BalanceSheet {
  asOf: string;
  entityId?: ID;
  fyStart: string;
  sections: BsSection[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  currentEarnings: number;
  /** assets − (liabilities + equity); must be zero. */
  difference: number;
  /** Every balance agrees with the trial balance account by account, and the TB balances. */
  agreesToTb: boolean;
  tbMismatches: string[];
  /** Consolidated: group due-from (1900) minus due-to (2900); eliminates to zero. */
  groupNet: number;
}

const ASSET_GROUPS: [AccountSubtype | 'other', string][] = [
  ['bank', 'Bank'], ['cash', 'Cash on hand and in transit'], ['clearing', 'Supplier and card clearing'], ['receivable', 'Receivables'],
  ['inventory', 'Inventory'], ['prepaid', 'Prepaid expenses'], ['intercompany', 'Intercompany and related parties'], ['fixed_asset', 'Fixed assets, net'], ['other', 'Other assets'],
];
const LIAB_GROUPS: [AccountSubtype | 'other', string][] = [
  ['payable', 'Accounts payable'], ['accrued', 'Accrued payroll, payroll taxes and sales tax'], ['loan', 'Loans and mortgages'], ['intercompany', 'Intercompany and related parties'], ['other', 'Other liabilities'],
];
const EQUITY_GROUPS: [AccountSubtype | 'other', string][] = [['equity', 'Owner capital'], ['draws', 'Owner draws'], ['retained', 'Retained earnings'], ['other', 'Other equity']];

export function balanceSheet(state: BooksState, opts: { asOf: string; entityId?: ID; lines?: FlatLine[] }): BalanceSheet {
  const fyStart = fiscalYearStart(opts.asOf, state.settings.fiscalYearStartMonth);
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const ents = new Map(state.entities.map((e) => [e.id, e]));
  const parties = new Map(state.parties.map((p) => [p.id, p]));
  const raw = new Map<ID, number>(); // debit − credit
  const kids = new Map<ID, Map<string, BsChild>>();
  let pnlCurrent = 0, pnlPrior = 0;
  for (const f of opts.lines ?? flatLines(state)) {
    if (f.date > opts.asOf || (opts.entityId && f.entityId !== opts.entityId)) continue;
    const a = acc.get(f.l.accountId);
    if (!a) continue;
    const v = f.l.debit - f.l.credit;
    if (isPnl(a)) { if (f.date < fyStart) pnlPrior += v; else pnlCurrent += v; continue; }
    raw.set(a.id, (raw.get(a.id) ?? 0) + v);
    if (a.subtype === 'intercompany') {
      const pid = f.l.partyId ?? f.t.partyId;
      const key = f.l.counterEntityId ? `ent:${f.l.counterEntityId}` : pid ? `pty:${pid}` : 'none';
      const label = f.l.counterEntityId ? ents.get(f.l.counterEntityId)?.name ?? 'Group entity' : pid ? parties.get(pid)?.name ?? 'Party' : 'Not tagged to a party';
      const m = kids.get(a.id) ?? new Map<string, BsChild>();
      const c = m.get(key) ?? { key, label, amount: 0 };
      c.amount += normalSign(a) * v;
      m.set(key, c);
      kids.set(a.id, m);
    }
  }
  raw.set(SYS.retained, (raw.get(SYS.retained) ?? 0) + pnlPrior);
  const currentEarnings = pnlCurrent === 0 ? 0 : -pnlCurrent;
  const section = (key: BsSection['key'], label: string, type: Account['type'], groups: [AccountSubtype | 'other', string][]): BsSection => {
    const known = new Set(groups.map((g) => g[0]));
    const accounts = state.accounts.filter((a) => a.type === type && (a.active || raw.get(a.id))).sort((x, y) => x.number.localeCompare(y.number));
    const gs: BsGroup[] = groups.map(([sub, gl]) => {
      const mine = accounts.filter((a) => (known.has(a.subtype) ? a.subtype === sub : sub === 'other'));
      const lines = mine.map((a) => ({ account: a, amount: normalSign(a) * (raw.get(a.id) ?? 0), children: kids.get(a.id) ? [...kids.get(a.id)!.values()].filter((c) => c.amount).sort((x, y) => x.label.localeCompare(y.label)) : undefined }));
      return { key: String(sub), label: gl, lines, total: lines.reduce((x, l) => x + l.amount, 0) };
    }).filter((g) => g.lines.length);
    if (key === 'equity') gs.push({ key: 'current', label: 'Current-year earnings', lines: [], total: currentEarnings, extra: { label: `Net income ${fyStart} to ${opts.asOf}`, amount: currentEarnings } });
    return { key, label, groups: gs, total: gs.reduce((x, g) => x + g.total, 0) };
  };
  const sections = [section('assets', 'Assets', 'asset', ASSET_GROUPS), section('liabilities', 'Liabilities', 'liability', LIAB_GROUPS), section('equity', 'Equity', 'equity', EQUITY_GROUPS)];
  const [A, L, E] = sections.map((s) => s.total);
  // Agree to the trial balance, account by account.
  const tb = trialBalance(state, { asOf: opts.asOf, entityId: opts.entityId, lines: opts.lines });
  const tbNet = new Map(tb.rows.map((r) => [r.account.id, r.net]));
  const mism: string[] = [];
  for (const a of state.accounts) {
    if (isPnl(a)) continue;
    const mine = raw.get(a.id) ?? 0;
    if (mine !== (tbNet.get(a.id) ?? 0)) mism.push(`${a.number} ${a.name}`);
  }
  if (tb.netIncome !== currentEarnings) mism.push('Current-year earnings');
  if (tb.difference !== 0) mism.push('Trial balance out of balance');
  return {
    asOf: opts.asOf, entityId: opts.entityId, fyStart, sections, totalAssets: A, totalLiabilities: L, totalEquity: E, currentEarnings,
    difference: A - (L + E), agreesToTb: mism.length === 0, tbMismatches: mism, groupNet: (raw.get(SYS.dueFrom) ?? 0) + (raw.get(SYS.dueTo) ?? 0),
  };
}

// ── Cash flow statement (indirect) ───────────────────────────────────────
export type CfSectionKey = 'operating' | 'investing' | 'financing';
export interface CfLine { key: string; label: string; amount: number; accountId?: ID }
export interface CashFlow {
  from: string;
  to: string;
  entityId?: ID;
  netIncome: number;
  sections: { key: CfSectionKey; label: string; lines: CfLine[]; total: number }[];
  netChange: number;
  openingCash: number;
  closingCash: number;
  /** Σ cash-equivalent ledger lines in range, independently. */
  directChange: number;
  ties: boolean;
  cashAccounts: Account[];
}

export function cfSection(a: Account): CfSectionKey {
  if (a.id === SYS.dueFrom || a.id === SYS.dueTo) return 'financing';
  switch (a.subtype) {
    case 'fixed_asset': return /depreciation/i.test(a.name) ? 'operating' : 'investing';
    case 'intercompany': return a.type === 'asset' ? 'investing' : 'financing';
    case 'loan': case 'equity': case 'draws': case 'retained': return 'financing';
    default: return 'operating';
  }
}

/** Indirect cash flow for dates from..to (inclusive): net income → working capital → investing → financing = change in cash and equivalents. */
export function cashFlow(state: BooksState, opts: { from: string; to: string; entityId?: ID; lines?: FlatLine[] }): CashFlow {
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const isCash = (a: Account) => CASH_EQUIV.includes(a.subtype) && a.type === 'asset';
  const change = new Map<ID, number>();
  let ni = 0, opening = 0, closing = 0, direct = 0;
  for (const f of opts.lines ?? flatLines(state)) {
    if (opts.entityId && f.entityId !== opts.entityId) continue;
    const a = acc.get(f.l.accountId);
    if (!a) continue;
    const v = f.l.debit - f.l.credit;
    if (isCash(a)) {
      if (f.date < opts.from) opening += v;
      if (f.date <= opts.to) closing += v;
      if (f.date >= opts.from && f.date <= opts.to) direct += v;
      continue;
    }
    if (f.date < opts.from || f.date > opts.to) continue;
    if (isPnl(a)) ni -= v;
    else change.set(a.id, (change.get(a.id) ?? 0) - v);
  }
  const lab: Record<CfSectionKey, string> = { operating: 'Operating activities', investing: 'Investing activities', financing: 'Financing activities' };
  const sections = (['operating', 'investing', 'financing'] as CfSectionKey[]).map((key) => {
    const lines: CfLine[] = key === 'operating' ? [{ key: 'ni', label: 'Net income (booked basis)', amount: ni }] : [];
    if (key === 'financing') {
      const g = (change.get(SYS.dueFrom) ?? 0) + (change.get(SYS.dueTo) ?? 0);
      if (g) lines.push({ key: 'group', label: 'Settled with group entities (due to / due from, net)', amount: g });
    }
    for (const a of [...state.accounts].sort((x, y) => x.number.localeCompare(y.number))) {
      const v = change.get(a.id);
      if (!v || cfSection(a) !== key || a.id === SYS.dueFrom || a.id === SYS.dueTo) continue;
      const verb = a.subtype === 'fixed_asset' && key === 'operating' ? 'Add back' : v > 0 ? (a.type === 'asset' ? 'Decrease in' : 'Increase in') : a.type === 'asset' ? 'Increase in' : 'Decrease in';
      lines.push({ key: a.id, accountId: a.id, label: `${verb} ${a.name.toLowerCase()}`, amount: v });
    }
    return { key, label: lab[key], lines, total: lines.reduce((x, l) => x + l.amount, 0) };
  });
  const netChange = sections.reduce((x, s) => x + s.total, 0);
  return {
    from: opts.from, to: opts.to, entityId: opts.entityId, netIncome: ni, sections, netChange, openingCash: opening, closingCash: closing, directChange: direct,
    ties: opening + netChange === closing && netChange === direct, cashAccounts: state.accounts.filter(isCash),
  };
}

// ── Command center ───────────────────────────────────────────────────────
export interface CommandRow {
  key: string;
  sales: number;
  gross: number;
  gmPct: number | null;
  labor: number;
  laborPct: number | null;
  laborTargetBps?: number;
  net: number;
  netPct: number | null;
  priorNet: number;
}
export interface CommandCenter { period: string; prior: string; basis: ReportBasis; rows: CommandRow[]; total: CommandRow; rowsAddUp: boolean; tiesToPnl: boolean }

const ratio = (v: number, base: number) => (base ? v / base : null);

export function commandCenter(state: BooksState, opts: { period: string; basis: ReportBasis; storeIds: ID[]; entries?: BasisEntry[] }): CommandCenter {
  const entries = opts.entries ?? basisEntries(state);
  const prior = priorRange(opts.period, opts.period).from;
  const cur = statement(state, { basis: opts.basis, from: opts.period, to: opts.period, storeIds: opts.storeIds, entries });
  const pri = statement(state, { basis: opts.basis, from: prior, to: prior, storeIds: opts.storeIds, entries });
  const operating = (id: string) => state.stores.find((s) => s.id === id)?.kind === 'operating';
  const row = (k: string): CommandRow => {
    const labor = cur.rows.filter((r) => LABOR_ACCTS.includes(r.account.id)).reduce((x, r) => x + (k === 'total' ? r.total : r.by[k] ?? 0), 0);
    const sales = cur.netSales[k] ?? 0;
    return {
      key: k, sales, gross: cur.grossProfit[k] ?? 0, gmPct: ratio(cur.grossProfit[k] ?? 0, sales), labor,
      // Labor % only means something for an operating store (and the company); Corporate's office payroll has no sales of its own.
      laborPct: k === 'total' || operating(k) ? ratio(labor, sales) : null,
      laborTargetBps: k !== 'total' && operating(k) ? laborTarget(state, k) : undefined, net: cur.netIncome[k] ?? 0, netPct: ratio(cur.netIncome[k] ?? 0, sales), priorNet: pri.netIncome[k] ?? 0,
    };
  };
  const active = opts.storeIds.filter((s) => cur.rows.some((r) => r.by[s]));
  const rows = active.map(row);
  const total = row('total');
  return { period: opts.period, prior, basis: opts.basis, rows, total, rowsAddUp: rows.reduce((x, r) => x + r.net, 0) === total.net, tiesToPnl: total.net === cur.independent };
}

// ── Store scorecards ─────────────────────────────────────────────────────
export type KpiKey = 'gallons' | 'fuelCpg' | 'insideGm' | 'foodCost' | 'labor' | 'cardFee' | 'cashVar' | 'netProfit' | 'breakEven';
export type KpiStatus = 'green' | 'amber' | 'red' | 'na';
export interface KpiDef { key: KpiKey; label: string; better: 'higher' | 'lower'; unit: 'gal' | 'cpg' | 'pct' | 'money' | 'pts'; thresholdHint: string }
export const KPIS: KpiDef[] = [
  { key: 'gallons', label: 'Fuel gallons', better: 'higher', unit: 'gal', thresholdHint: 'gallons in the month' },
  { key: 'fuelCpg', label: 'Fuel margin ¢/gal', better: 'higher', unit: 'cpg', thresholdHint: 'cents per gallon, accrual cost' },
  { key: 'insideGm', label: 'Inside GM %', better: 'higher', unit: 'pct', thresholdHint: 'percent of inside sales' },
  { key: 'foodCost', label: 'Food cost %', better: 'lower', unit: 'pct', thresholdHint: 'percent of kitchen sales' },
  { key: 'labor', label: 'Labor %', better: 'lower', unit: 'pts', thresholdHint: 'points over the store\'s labor target' },
  { key: 'cardFee', label: 'Card fee %', better: 'lower', unit: 'pct', thresholdHint: 'percent of net sales' },
  { key: 'cashVar', label: 'Cash over / short', better: 'lower', unit: 'money', thresholdHint: 'dollars either way' },
  { key: 'netProfit', label: 'Net profit', better: 'higher', unit: 'money', thresholdHint: 'dollars, accrual basis' },
  { key: 'breakEven', label: 'Break-even sales', better: 'higher', unit: 'pct', thresholdHint: 'margin of safety: sales above break-even, % of sales' },
];
/** Thresholds per KPI. Money in whole dollars; percentages and points in percent; cpg in cents. */
export const DEFAULT_THRESHOLDS: Record<KpiKey, KpiThreshold> = {
  gallons: { green: 60_000, amber: 30_000 },
  fuelCpg: { green: 25, amber: 18 },
  insideGm: { green: 28, amber: 22 },
  foodCost: { green: 35, amber: 40 },
  labor: { green: 0, amber: 2 },
  cardFee: { green: 2.0, amber: 2.5 },
  cashVar: { green: 25, amber: 100 },
  netProfit: { green: 0, amber: -5_000 },
  breakEven: { green: 10, amber: 0 },
};

export function thresholdsOf(state: BooksState): Record<KpiKey, KpiThreshold> {
  return { ...DEFAULT_THRESHOLDS, ...(reportsOf(state).thresholds as Partial<Record<KpiKey, KpiThreshold>>) };
}

export function rate(value: number | null, def: Pick<KpiDef, 'better'>, t: KpiThreshold): KpiStatus {
  if (value === null || !Number.isFinite(value)) return 'na';
  if (def.better === 'higher') return value >= t.green ? 'green' : value >= t.amber ? 'amber' : 'red';
  return value <= t.green ? 'green' : value <= t.amber ? 'amber' : 'red';
}

export interface KpiCell { key: KpiKey; value: number | null; /** The number shown (e.g. labor % itself, break-even dollars). */ display: string; status: KpiStatus; detail?: string }
export interface ScoreRow { storeId: ID; kpis: KpiCell[]; notes: ScorecardNote[]; counts: Record<KpiStatus, number> }

const pctS = (v: number | null, d = 1) => (v === null ? '–' : `${v.toFixed(d)}%`);
const $ = (c: number) => formatMoney(c, { dollarSign: true, whole: true });

export function scorecards(state: BooksState, opts: { period: string; storeIds: ID[]; entries?: BasisEntry[] }): ScoreRow[] {
  const entries = opts.entries ?? basisEntries(state);
  const st = statement(state, { basis: 'accrual', from: opts.period, to: opts.period, storeIds: opts.storeIds, entries });
  const fm = fuelMargin(state, { storeIds: opts.storeIds, from: firstDay(opts.period), to: lastDayOfPeriod(opts.period), by: 'month' });
  const th = thresholdsOf(state);
  const notes = reportsOf(state).notes;
  const sumAcct = (ids: ID[], s: ID) => st.rows.filter((r) => ids.includes(r.account.id)).reduce((x, r) => x + (r.by[s] ?? 0), 0);
  const ops = opts.storeIds.filter((s) => state.stores.find((x) => x.id === s)?.kind === 'operating' && st.netSales[s]);
  return ops.map((s) => {
    const def = (k: KpiKey) => KPIS.find((d) => d.key === k)!;
    const cell = (key: KpiKey, value: number | null, display: string, detail?: string, valueForRating = value): KpiCell => ({ key, value, display, detail, status: rate(valueForRating, def(key), th[key]) });
    const f = fm.stores.find((x) => x.storeId === s);
    const sales = st.netSales[s];
    const inside = st.salesByLob.inside[s], kitchen = st.salesByLob.kitchen[s];
    const labor = sumAcct(LABOR_ACCTS, s);
    const laborP = sales ? (labor / sales) * 100 : null;
    const target = laborTarget(state, s) / 100;
    const fees = sumAcct(CARD_FEE_ACCTS, s);
    const overShort = sumAcct([OVER_SHORT_ACCT], s); // + = short (an expense)
    const fixed = st.expenses[s] - fees;
    const cmRatio = sales ? (st.grossProfit[s] - fees) / sales : 0;
    const be = cmRatio > 0 ? Math.round(fixed / cmRatio) : null;
    const safety = be !== null && sales ? ((sales - be) / sales) * 100 : null;
    const kpis: KpiCell[] = [
      cell('gallons', f ? f.gallons : null, f ? Math.round(f.gallons).toLocaleString('en-US') : '–', f?.truckGallons ? `incl. ${Math.round(f.truckGallons).toLocaleString('en-US')} truck lane` : undefined),
      cell('fuelCpg', f ? f.marginCpg : null, f ? `${f.marginCpg.toFixed(1)}¢` : '–', f ? `break-even ${f.breakEvenCpg.toFixed(1)}¢` : undefined),
      cell('insideGm', inside ? (st.gpByLob.inside[s] / inside) * 100 : null, pctS(inside ? (st.gpByLob.inside[s] / inside) * 100 : null)),
      cell('foodCost', kitchen ? ((kitchen - st.gpByLob.kitchen[s]) / kitchen) * 100 : null, pctS(kitchen ? ((kitchen - st.gpByLob.kitchen[s]) / kitchen) * 100 : null), kitchen ? 'purchases ÷ food sales; counts come in phase 7' : 'no kitchen'),
      cell('labor', laborP, pctS(laborP), `target ${target.toFixed(1)}%`, laborP === null ? null : laborP - target),
      cell('cardFee', sales ? (fees / sales) * 100 : null, pctS(sales ? (fees / sales) * 100 : null, 2)),
      cell('cashVar', overShort, overShort === 0 ? '$0' : `${overShort > 0 ? 'short' : 'over'} ${formatMoney(Math.abs(overShort), { dollarSign: true })}`, undefined, Math.abs(overShort) / 100),
      cell('netProfit', st.netIncome[s], formatMoney(st.netIncome[s], { dollarSign: true, whole: true }), undefined, st.netIncome[s] / 100),
      cell('breakEven', safety, be === null ? 'not reached' : $(be), safety === null ? 'contribution margin ≤ 0' : `sales ${safety >= 0 ? 'above' : 'below'} by ${Math.abs(safety).toFixed(1)}%`),
    ];
    const counts = { green: 0, amber: 0, red: 0, na: 0 } as Record<KpiStatus, number>;
    for (const k of kpis) counts[k.status] += 1;
    return { storeId: s, kpis, notes: notes.filter((n) => n.storeId === s && n.period === opts.period), counts };
  });
}

// ── Report builder ───────────────────────────────────────────────────────
export interface RowGroup { key: string; label: string; match: (a: Account) => boolean; profit?: boolean }
export const GROUPS: RowGroup[] = [
  { key: 'sales', label: 'Net sales (all revenue less discounts)', match: (a) => a.type === 'revenue' || a.type === 'contra_revenue' },
  ...LOBS.map((l) => ({ key: `sales:${l}`, label: `${l[0].toUpperCase()}${l.slice(1)} sales`, match: (a: Account) => (a.type === 'revenue' || a.type === 'contra_revenue') && (a.lob ?? 'other') === l })),
  { key: 'cogs', label: 'Cost of goods', match: (a) => a.type === 'cogs' },
  ...LOBS.filter((l) => l !== 'other').map((l) => ({ key: `cogs:${l}`, label: `${l[0].toUpperCase()}${l.slice(1)} cost of goods`, match: (a: Account) => a.type === 'cogs' && (a.lob ?? 'other') === l })),
  { key: 'gp', label: 'Gross profit', match: (a) => a.type === 'revenue' || a.type === 'contra_revenue' || a.type === 'cogs', profit: true },
  { key: 'labor', label: 'Labor (net pay + payroll taxes)', match: (a) => LABOR_ACCTS.includes(a.id) },
  { key: 'expense', label: 'Operating expenses', match: (a) => a.type === 'expense' },
  { key: 'net', label: 'Net profit', match: (a) => isPnl(a), profit: true },
];

export interface BuiltRow { key: string; label: string; by: Record<string, number>; total: number }
export interface BuiltReport { cols: { key: string; label: string }[]; rows: BuiltRow[]; /** Every row's columns add to its total. */ rowsTie: boolean; /** The net-profit row (if any) agrees with the statement on the same basis. */ netTies: boolean | null }

/**
 * Run a report definition. P&L rows use the chosen basis and the P&L's shown sign (sales +, costs +);
 * profit groups (gross profit, net) are profit-signed. Balance-sheet accounts show booked net activity in their natural sign.
 */
export function runReport(state: BooksState, def: Pick<SavedReport, 'rows' | 'columns' | 'basis' | 'from' | 'to' | 'storeIds'>, opts: { visible: ID[]; entries?: BasisEntry[]; lines?: FlatLine[] }): BuiltReport {
  const storeIds = def.storeIds.length ? def.storeIds.filter((s) => opts.visible.includes(s)) : opts.visible;
  const entries = opts.entries ?? basisEntries(state);
  const st = statement(state, { basis: def.basis, from: def.from, to: def.to, storeIds, cols: def.columns, entries });
  const codes = new Map(state.stores.map((s) => [s.id, s.code]));
  const cols = st.cols.map((k) => ({ key: k, label: def.columns === 'store' ? codes.get(k) ?? k : k }));
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const rows: BuiltRow[] = [];
  let bsActivity: Map<string, number> | null = null;
  for (const r of def.rows) {
    const by: Record<string, number> = {};
    let label = r;
    if (r.startsWith('group:')) {
      const g = GROUPS.find((x) => x.key === r.slice(6));
      if (!g) continue;
      label = g.label;
      for (const sr of st.rows) {
        if (!g.match(sr.account)) continue;
        const sign = g.profit ? shownSign(sr.account) : 1;
        for (const c of st.cols) by[c] = (by[c] ?? 0) + sign * (sr.by[c] ?? 0);
      }
    } else {
      const a = acc.get(r.replace(/^acct:/, ''));
      if (!a) continue;
      label = `${a.number} ${a.name}`;
      if (isPnl(a)) {
        const sr = st.rows.find((x) => x.account.id === a.id);
        for (const c of st.cols) by[c] = sr?.by[c] ?? 0;
      } else {
        if (!bsActivity) {
          bsActivity = new Map();
          const want = new Set(storeIds);
          const d0 = firstDay(def.from), d1 = lastDayOfPeriod(def.to);
          for (const f of opts.lines ?? flatLines(state)) {
            if (f.date < d0 || f.date > d1 || !want.has(f.l.storeId)) continue;
            const k = `${f.l.accountId}|${def.columns === 'store' ? f.l.storeId : f.period}`;
            bsActivity.set(k, (bsActivity.get(k) ?? 0) + f.l.debit - f.l.credit);
          }
        }
        for (const c of st.cols) by[c] = normalSign(a) * (bsActivity.get(`${a.id}|${c}`) ?? 0);
      }
    }
    for (const c of st.cols) by[c] = by[c] ?? 0;
    rows.push({ key: r, label, by, total: st.cols.reduce((x, c) => x + by[c], 0) });
  }
  const net = rows.find((r) => r.key === 'group:net');
  const rowsTie = rows.every((r) => st.cols.reduce((x, c) => x + r.by[c], 0) === r.total);
  return { cols, rows, rowsTie, netTies: net ? net.total === st.netIncome.total : null };
}

// ── Board pack letter ────────────────────────────────────────────────────
export function summaryLetter(state: BooksState, x: { period: string; periodName: string; cc: CommandCenter; bs: BalanceSheet; cashFlow: CashFlow; issues: number }): string {
  const code = (id: string) => state.stores.find((s) => s.id === id)?.code ?? id;
  const t = x.cc.total;
  const ops = x.cc.rows.filter((r) => state.stores.find((s) => s.id === r.key)?.kind === 'operating');
  const best = [...ops].sort((a, b) => b.net - a.net)[0];
  const worst = [...ops].sort((a, b) => a.net - b.net)[0];
  const ch = t.net - t.priorNet;
  const p = (v: number | null) => (v === null ? '–' : `${(v * 100).toFixed(1)}%`);
  const money = (c: number) => formatMoney(c, { dollarSign: true, whole: true });
  const lines = [
    `${x.periodName} summary for the owners.`,
    '',
    `Net sales were ${money(t.sales)} with gross margin of ${money(t.gross)} (${p(t.gmPct)}). Labor ran ${p(t.laborPct)} of sales. Net profit on the ${BASIS_LABEL[x.cc.basis].toLowerCase()} basis was ${money(t.net)}, ${ch >= 0 ? 'up' : 'down'} ${money(Math.abs(ch))} on the month before.`,
    best && worst && best.key !== worst.key ? `${code(best.key)} led with ${money(best.net)}; ${code(worst.key)} was the weakest at ${money(worst.net)}.` : '',
    `Cash and cash equivalents ended at ${money(x.cashFlow.closingCash)}, a change of ${money(x.cashFlow.netChange)} over the month. Total assets were ${money(x.bs.totalAssets)} against liabilities of ${money(x.bs.totalLiabilities)}.`,
    x.issues ? `${x.issues} open item${x.issues === 1 ? '' : 's'} on the inbox are listed at the end.` : 'There are no open items on the inbox.',
  ];
  return lines.filter((l, i) => l || i === 1).join('\n');
}

// ── Saved reports, notes, thresholds (state) ─────────────────────────────
export function emptyReports(): ReportsState {
  return { saved: [], thresholds: {}, notes: [] };
}
const EMPTY: ReportsState = emptyReports();
/** The reports slice, or an empty one for books saved before phase 4. */
export function reportsOf(state: BooksState): ReportsState {
  return state.reports ?? EMPTY;
}
function ensure(books: Books): ReportsState {
  if (!books.state.reports) books.state.reports = emptyReports();
  return books.state.reports;
}

export type ReportDraft = Omit<SavedReport, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'>;

export function validateReport(state: BooksState, d: ReportDraft): string[] {
  const errs: string[] = [];
  if (!d.name.trim()) errs.push('Give the report a name so you can find it again.');
  if (!d.rows.length) errs.push('Pick at least one row: an account or a group.');
  if (!/^\d{4}-\d{2}$/.test(d.from) || !/^\d{4}-\d{2}$/.test(d.to)) errs.push('Pick the from and to months.');
  else if (d.to < d.from) errs.push('The to month is before the from month; swap them.');
  const ids = new Set(state.accounts.map((a) => a.id));
  for (const r of d.rows) if (!(r.startsWith('group:') ? GROUPS.some((g) => `group:${g.key}` === r) : ids.has(r.replace(/^acct:/, '')))) errs.push(`Row "${r}" isn't an account or group any more; remove it.`);
  return errs;
}

export function saveReport(books: Books, actor: User, d: ReportDraft, id?: ID): SavedReport {
  books.require(actor, 'view.reports', 'save reports');
  const errs = validateReport(books.state, d);
  if (errs.length) throw new ValidationError(errs);
  const rs = ensure(books);
  const now = books.clock();
  const existing = id ? rs.saved.find((r) => r.id === id) : undefined;
  if (existing) {
    const before = structuredClone(existing);
    Object.assign(existing, { ...d, name: d.name.trim(), updatedAt: now });
    books.audit(actor, { action: 'update', objectType: 'report', objectId: existing.id, summary: `Updated saved report "${existing.name}"`, before, after: structuredClone(existing) });
    books.changed();
    return existing;
  }
  const r: SavedReport = { ...d, name: d.name.trim(), id: books.nextId('rpt'), createdBy: actor.id, createdAt: now, updatedAt: now };
  rs.saved.push(r);
  books.audit(actor, { action: 'create', objectType: 'report', objectId: r.id, summary: `Saved report "${r.name}"${r.schedule ? ` (${r.schedule.cadence})` : ''}`, after: r });
  books.changed();
  return r;
}

export function deleteReport(books: Books, actor: User, id: ID): void {
  books.require(actor, 'view.reports', 'remove saved reports');
  const rs = ensure(books);
  const r = rs.saved.find((x) => x.id === id);
  if (!r) return;
  rs.saved = rs.saved.filter((x) => x.id !== id);
  books.audit(actor, { action: 'delete', objectType: 'report', objectId: id, summary: `Removed saved report "${r.name}"`, before: r });
  books.changed();
}

export function addScorecardNote(books: Books, actor: User, x: { storeId: ID; period: string; text: string }): ScorecardNote {
  books.require(actor, 'view.reports', 'add scorecard notes');
  if (!x.text.trim()) throw new ValidationError(['Write the note first.']);
  if (!books.store(x.storeId)) throw new ValidationError(['Pick the store the note is about.']);
  const n: ScorecardNote = { id: books.nextId('note'), storeId: x.storeId, period: x.period, text: x.text.trim(), by: actor.id, at: books.clock() };
  ensure(books).notes.push(n);
  books.audit(actor, { action: 'note', objectType: 'report', objectId: n.id, summary: `Scorecard note for ${books.store(x.storeId)?.code} ${x.period}`, after: n });
  books.changed();
  return n;
}

export function setThreshold(books: Books, actor: User, key: KpiKey, t: KpiThreshold | null): void {
  books.require(actor, 'setup.edit', 'change scorecard thresholds');
  const def = KPIS.find((k) => k.key === key);
  if (!def) throw new ValidationError(['Unknown KPI.']);
  const rs = ensure(books);
  const before = rs.thresholds[key];
  if (t === null) delete rs.thresholds[key];
  else {
    if (!Number.isFinite(t.green) || !Number.isFinite(t.amber)) throw new ValidationError(['Enter numbers for green and amber.']);
    if (def.better === 'higher' ? t.amber > t.green : t.amber < t.green) {
      throw new ValidationError([def.better === 'higher' ? `For ${def.label}, higher is better: the amber line must be at or below the green line.` : `For ${def.label}, lower is better: the amber line must be at or above the green line.`]);
    }
    rs.thresholds[key] = { green: t.green, amber: t.amber };
  }
  books.audit(actor, { action: 'threshold', objectType: 'report', objectId: key, summary: `Scorecard threshold for ${def.label}`, before, after: rs.thresholds[key] });
  books.changed();
}

/** Fuel targets from Phase 3 seed the scorecard's cpg amber line when nobody has set one. */
export function fuelCpgFloor(state: BooksState): number {
  return fuelOf(state).targets.cpgMin;
}
