import type { BooksState, Account, ID, Transaction, Line, LineOfBusiness } from './types';
import { isPnl, normalSign, SYS } from './ledger';
import { lastDayOfPeriod, periodOf } from './dates';

export interface FlatLine {
  t: Transaction;
  l: Line;
  date: string;
  period: string;
  entityId: ID;
}

/** Every live (not deleted) ledger line, flattened, with its entity resolved from its store. */
export function flatLines(state: BooksState): FlatLine[] {
  const ent = new Map(state.stores.map((s) => [s.id, s.entityId]));
  const out: FlatLine[] = [];
  for (const t of state.transactions) {
    if (t.deleted) continue;
    const period = periodOf(t.date);
    for (const l of t.lines) out.push({ t, l, date: t.date, period, entityId: ent.get(l.storeId) ?? '' });
  }
  return out;
}

export function fiscalYearStart(asOf: string, startMonth: number): string {
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7));
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${String(startMonth).padStart(2, '0')}-01`;
}

// ── Trial balance ─────────────────────────────────────────────────────────
export interface TBRow {
  account: Account;
  debit: number;
  credit: number;
  /** debit − credit */
  net: number;
}
export interface TrialBalance {
  asOf: string;
  fyStart: string;
  rows: TBRow[];
  totalDebit: number;
  totalCredit: number;
  /** Must be zero. */
  difference: number;
  /** Net income for the fiscal year to date (credit-positive). */
  netIncome: number;
}

export function trialBalance(state: BooksState, opts: { asOf: string; entityId?: ID; lines?: FlatLine[] }): TrialBalance {
  const fyStart = fiscalYearStart(opts.asOf, state.settings.fiscalYearStartMonth);
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const net = new Map<ID, number>();
  const add = (id: ID, v: number) => net.set(id, (net.get(id) ?? 0) + v);
  let ni = 0;
  for (const f of opts.lines ?? flatLines(state)) {
    if (f.date > opts.asOf) continue;
    if (opts.entityId && f.entityId !== opts.entityId) continue;
    const a = acc.get(f.l.accountId);
    if (!a) continue;
    const v = f.l.debit - f.l.credit;
    if (isPnl(a) && f.date < fyStart) add(SYS.retained, v);
    else {
      add(a.id, v);
      if (isPnl(a)) ni -= v;
    }
  }
  const rows: TBRow[] = [];
  let td = 0;
  let tc = 0;
  for (const a of [...state.accounts].sort((x, y) => x.number.localeCompare(y.number))) {
    const n = net.get(a.id) ?? 0;
    if (n === 0) continue;
    const row = { account: a, debit: n > 0 ? n : 0, credit: n < 0 ? -n : 0, net: n };
    td += row.debit;
    tc += row.credit;
    rows.push(row);
  }
  return { asOf: opts.asOf, fyStart, rows, totalDebit: td, totalCredit: tc, difference: td - tc, netIncome: ni };
}

// ── Profit & loss by store ────────────────────────────────────────────────
export type PnlSection = 'revenue' | 'contra_revenue' | 'cogs' | 'expense';
export interface PnlRow {
  account: Account;
  section: PnlSection;
  lob: LineOfBusiness;
  /** Shown sign: revenue positive, contra negative, costs positive. Keyed by store id. */
  byStore: Record<ID, number>;
  total: number;
}
export interface Pnl {
  from: string;
  to: string;
  storeIds: ID[];
  rows: PnlRow[];
  /** Totals keyed by store id, plus 'total'. */
  netSales: Record<string, number>;
  cogs: Record<string, number>;
  grossProfit: Record<string, number>;
  expenses: Record<string, number>;
  netIncome: Record<string, number>;
  salesByLob: Record<LineOfBusiness, Record<string, number>>;
  gpByLob: Record<LineOfBusiness, Record<string, number>>;
  /** Independent check straight from the ledger lines (credit − debit over every P&L line in range). */
  ledgerNet: number;
  /** netIncome.total − ledgerNet; must be zero. */
  difference: number;
}

const LOBS: LineOfBusiness[] = ['fuel', 'inside', 'kitchen', 'other'];

export function pnl(state: BooksState, opts: { from: string; to: string; storeIds: ID[]; lines?: FlatLine[] }): Pnl {
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const want = new Set(opts.storeIds);
  const rowMap = new Map<ID, PnlRow>();
  let ledgerNet = 0;
  for (const f of opts.lines ?? flatLines(state)) {
    if (f.period < opts.from || f.period > opts.to || !want.has(f.l.storeId)) continue;
    const a = acc.get(f.l.accountId);
    if (!a || !isPnl(a)) continue;
    const raw = f.l.debit - f.l.credit;
    ledgerNet -= raw;
    const shown = a.type === 'revenue' || a.type === 'contra_revenue' ? -raw : raw;
    let r = rowMap.get(a.id);
    if (!r) {
      r = { account: a, section: a.type as PnlSection, lob: a.lob ?? 'other', byStore: {}, total: 0 };
      rowMap.set(a.id, r);
    }
    r.byStore[f.l.storeId] = (r.byStore[f.l.storeId] ?? 0) + shown;
    r.total += shown;
  }
  const rows = [...rowMap.values()].sort((x, y) => x.account.number.localeCompare(y.account.number));
  const keys = [...opts.storeIds, 'total'];
  const zero = () => Object.fromEntries(keys.map((k) => [k, 0])) as Record<string, number>;
  const netSales = zero(), cogs = zero(), expenses = zero();
  const salesByLob = Object.fromEntries(LOBS.map((l) => [l, zero()])) as Pnl['salesByLob'];
  const cogsByLob = Object.fromEntries(LOBS.map((l) => [l, zero()])) as Pnl['salesByLob'];
  for (const r of rows) {
    for (const k of keys) {
      const v = k === 'total' ? r.total : r.byStore[k] ?? 0;
      if (r.section === 'revenue' || r.section === 'contra_revenue') {
        netSales[k] += v;
        salesByLob[r.lob][k] += v;
      } else if (r.section === 'cogs') {
        cogs[k] += v;
        cogsByLob[r.lob][k] += v;
      } else expenses[k] += v;
    }
  }
  const grossProfit = zero(), netIncome = zero();
  const gpByLob = Object.fromEntries(LOBS.map((l) => [l, zero()])) as Pnl['gpByLob'];
  for (const k of keys) {
    grossProfit[k] = netSales[k] - cogs[k];
    netIncome[k] = grossProfit[k] - expenses[k];
    for (const l of LOBS) gpByLob[l][k] = salesByLob[l][k] - cogsByLob[l][k];
  }
  return { from: opts.from, to: opts.to, storeIds: opts.storeIds, rows, netSales, cogs, grossProfit, expenses, netIncome, salesByLob, gpByLob, ledgerNet, difference: netIncome.total - ledgerNet };
}

// ── Account detail (general ledger) ───────────────────────────────────────
export interface GLRow {
  t: Transaction;
  l: Line;
  /** In the account's natural sign. */
  change: number;
  balance: number;
}
export interface AccountDetail {
  account: Account;
  opening: number;
  rows: GLRow[];
  closing: number;
  totalDebit: number;
  totalCredit: number;
}

export function accountDetail(state: BooksState, accountId: ID, opts: { from: string; to: string; storeId?: ID; entityId?: ID; lines?: FlatLine[] }): AccountDetail {
  const a = state.accounts.find((x) => x.id === accountId);
  if (!a) throw new Error('Unknown account');
  const sign = normalSign(a);
  const fyStart = fiscalYearStart(opts.from, state.settings.fiscalYearStartMonth);
  let opening = 0;
  const inRange: FlatLine[] = [];
  for (const f of opts.lines ?? flatLines(state)) {
    if (f.l.accountId !== accountId) continue;
    if (opts.storeId && f.l.storeId !== opts.storeId) continue;
    if (opts.entityId && f.entityId !== opts.entityId) continue;
    if (f.date < opts.from) {
      if (!isPnl(a) || f.date >= fyStart) opening += sign * (f.l.debit - f.l.credit);
    } else if (f.date <= opts.to) inRange.push(f);
  }
  inRange.sort((x, y) => x.date.localeCompare(y.date) || x.t.ref.localeCompare(y.t.ref));
  let bal = opening;
  let td = 0;
  let tc = 0;
  const rows = inRange.map((f) => {
    const change = sign * (f.l.debit - f.l.credit);
    bal += change;
    td += f.l.debit;
    tc += f.l.credit;
    return { t: f.t, l: f.l, change, balance: bal };
  });
  return { account: a, opening, rows, closing: bal, totalDebit: td, totalCredit: tc };
}

/** Natural-sign balance of an account through a date (all stores, all entities). */
export function balanceAsOf(state: BooksState, accountId: ID, asOf: string, lines?: FlatLine[]): number {
  const a = state.accounts.find((x) => x.id === accountId);
  if (!a) return 0;
  let n = 0;
  for (const f of lines ?? flatLines(state)) if (f.l.accountId === accountId && f.date <= asOf) n += f.l.debit - f.l.credit;
  return normalSign(a) * n;
}

/** The latest month with any sales posted. */
export function latestSalesPeriod(state: BooksState, lines?: FlatLine[]): string | null {
  const rev = new Set(state.accounts.filter((a) => a.type === 'revenue').map((a) => a.id));
  let best: string | null = null;
  for (const f of lines ?? flatLines(state)) if (rev.has(f.l.accountId) && (!best || f.period > best)) best = f.period;
  return best;
}

export function periodEnd(period: string): string {
  return lastDayOfPeriod(period);
}

/** Lines still sitting in an uncategorized account. */
export function uncategorized(state: BooksState, lines?: FlatLine[]): FlatLine[] {
  const ids = new Set(state.accounts.filter((a) => a.subtype === 'uncategorized').map((a) => a.id));
  return (lines ?? flatLines(state)).filter((f) => ids.has(f.l.accountId));
}
