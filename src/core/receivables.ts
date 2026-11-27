import type { Books } from './books';
import { ValidationError } from './books';
import type { BooksState, ID, ReceivableItem, ReceivableKind, ReceivablesState, RentSchedule, Transaction, User } from './types';
import type { Cents } from './money';
import type { PartyMovement } from './intercompany';
import { addDays, daysBetween, isValidDate, lastDayOfPeriod, periodOf, periodsBetween } from './dates';
import { formatMoney } from './money';
import { bankStoreId } from './bank';

export const RENT_INCOME = 'acct_rent_income';
export const KIND_LABEL: Record<ReceivableKind, string> = { rebate: 'Rebate / program', insurance: 'Insurance claim', refund: 'Refund owed to us', other: 'Other' };
export const DEFAULT_INCOME: Record<ReceivableKind, ID> = { rebate: 'acct_rebates', insurance: 'acct_other_income', refund: 'acct_other_income', other: 'acct_other_income' };

export function arState(state: BooksState): ReceivablesState {
  return state.receivables ?? { rent: [], items: [] };
}

// ── Tenant rent ──────────────────────────────────────────────────────────
export type RentStatus = 'paid' | 'paid_late' | 'partial' | 'late' | 'due' | 'upcoming';
export const RENT_STATUS_LABEL: Record<RentStatus, string> = { paid: 'Paid', paid_late: 'Paid late', partial: 'Part paid', late: 'Late', due: 'Due', upcoming: 'Upcoming' };

export interface RentCharge {
  scheduleId: ID;
  tenantId: ID;
  storeId: ID;
  period: string;
  dueDate: string;
  /** Late once today is after this date. */
  lateAfter: string;
  amount: Cents;
  paid: Cents;
  paidOn?: string;
  status: RentStatus;
  daysLate: number;
}

export interface RentReceipt {
  t: Transaction;
  tenantId: ID;
  amount: Cents;
}

function dueDateFor(s: RentSchedule, period: string): string {
  const last = Number(lastDayOfPeriod(period).slice(8, 10));
  return `${period}-${String(Math.min(s.dueDay, last)).padStart(2, '0')}`;
}

/** Rent deposits from a tenant: money in that credits rent income and names the tenant. */
export function rentReceipts(state: BooksState, tenantId: ID | null, asOf: string): RentReceipt[] {
  const out: RentReceipt[] = [];
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf || !t.partyId || (tenantId && t.partyId !== tenantId)) continue;
    let amt = 0;
    for (const l of t.lines) if (l.accountId === RENT_INCOME) amt += l.credit - l.debit;
    if (amt) out.push({ t, tenantId: t.partyId, amount: amt });
  }
  return out.sort((a, b) => a.t.date.localeCompare(b.t.date));
}

/**
 * The rent roll: each tenant's monthly charge, due vs received. Deposits apply to the oldest
 * charge first, so a late payment settles the month it was for.
 */
export function rentRoll(state: BooksState, today: string): { charges: RentCharge[]; receipts: RentReceipt[]; unapplied: Map<ID, Cents> } {
  const charges: RentCharge[] = [];
  const schedules = arState(state).rent.filter((s) => s.active);
  for (const s of schedules) {
    const end = s.endPeriod && s.endPeriod < periodOf(today) ? s.endPeriod : periodOf(today);
    for (const p of periodsBetween(s.startPeriod, end)) {
      const dueDate = dueDateFor(s, p);
      charges.push({ scheduleId: s.id, tenantId: s.tenantId, storeId: s.storeId, period: p, dueDate, lateAfter: addDays(dueDate, s.graceDays), amount: s.amount, paid: 0, status: 'upcoming', daysLate: 0 });
    }
  }
  charges.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const tenants = new Set(schedules.map((s) => s.tenantId));
  const receipts = rentReceipts(state, null, today).filter((r) => tenants.has(r.tenantId));
  const unapplied = new Map<ID, Cents>();
  for (const r of receipts) {
    let left = r.amount;
    for (const c of charges) {
      if (left <= 0) break;
      if (c.tenantId !== r.tenantId || c.paid >= c.amount) continue;
      const take = Math.min(left, c.amount - c.paid);
      c.paid += take;
      left -= take;
      if (c.paid === c.amount) c.paidOn = r.t.date;
    }
    if (left > 0) unapplied.set(r.tenantId, (unapplied.get(r.tenantId) ?? 0) + left);
  }
  for (const c of charges) {
    if (c.paid >= c.amount) c.status = c.paidOn! <= c.lateAfter ? 'paid' : 'paid_late';
    else if (today > c.lateAfter) c.status = c.paid > 0 ? 'partial' : 'late';
    else c.status = today >= c.dueDate ? 'due' : 'upcoming';
    if (c.status === 'late' || c.status === 'partial') c.daysLate = daysBetween(c.dueDate, today);
    else if (c.status === 'paid_late') c.daysLate = daysBetween(c.dueDate, c.paidOn!);
  }
  return { charges, receipts, unapplied };
}

export function lateRent(state: BooksState, today: string): RentCharge[] {
  return rentRoll(state, today).charges.filter((c) => c.status === 'late' || c.status === 'partial');
}

/** A tenant's statement lines for the party ledger: scheduled charges (not posted on the cash basis) and rent received. */
export function tenantMovements(state: BooksState, tenantId: ID, asOf: string): Omit<PartyMovement, 'balance'>[] {
  const out: Omit<PartyMovement, 'balance'>[] = [];
  for (const s of arState(state).rent) {
    if (s.tenantId !== tenantId || !s.active) continue;
    const end = s.endPeriod && s.endPeriod < periodOf(asOf) ? s.endPeriod : periodOf(asOf);
    for (const p of periodsBetween(s.startPeriod, end)) {
      const d = dueDateFor(s, p);
      if (d <= asOf) out.push({ date: d, description: `Rent due ${p}`, out: s.amount, in: 0, memoOnly: true });
    }
  }
  for (const r of rentReceipts(state, tenantId, asOf)) out.push({ date: r.t.date, txnId: r.t.id, ref: r.t.ref, description: r.t.description, accountId: RENT_INCOME, out: 0, in: r.amount });
  return out;
}

export function recordRentReceipt(books: Books, actor: User, input: { tenantId: ID; date: string; amount: Cents; storeId?: ID; bankAccountId?: ID; memo?: string }): Transaction {
  books.require(actor, 'ar.edit', 'record rent received');
  const s = arState(books.state).rent.find((x) => x.tenantId === input.tenantId && x.active);
  const tenant = books.state.parties.find((p) => p.id === input.tenantId);
  const errs: string[] = [];
  if (!tenant) errs.push('Choose the tenant.');
  if (!isValidDate(input.date)) errs.push('Enter the date the rent arrived, as YYYY-MM-DD.');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) errs.push('Enter the amount received.');
  const storeId = input.storeId ?? s?.storeId ?? tenant?.defaultStoreId;
  if (!storeId) errs.push('Choose the store the rent is for.');
  if (errs.length) throw new ValidationError(errs);
  const t = books.createTransaction(actor, {
    date: input.date, kind: 'money_in', description: `Rent received – ${tenant!.name.replace(' (tenant)', '')}`, memo: input.memo, partyId: tenant!.id, tags: ['rent'],
    lines: [
      { accountId: input.bankAccountId ?? 'acct_trustmark', storeId: bankStoreId(books.state), debit: input.amount, credit: 0 },
      { accountId: RENT_INCOME, storeId: storeId!, debit: 0, credit: input.amount },
    ],
  });
  books.audit(actor, { action: 'rent_received', objectType: 'receivable', objectId: tenant!.id, summary: `Rent received from ${tenant!.name}: ${formatMoney(input.amount, { dollarSign: true })} (${t.ref})` });
  books.changed();
  return t;
}

export function saveRentSchedule(books: Books, actor: User, s: RentSchedule): RentSchedule {
  books.require(actor, 'ar.edit', 'change the rent schedule');
  const errs: string[] = [];
  const tenant = books.state.parties.find((p) => p.id === s.tenantId);
  if (!tenant || tenant.type !== 'tenant') errs.push('Choose a tenant (add them in Setup › Vendors & parties with type Tenant).');
  if (!books.state.stores.some((x) => x.id === s.storeId)) errs.push('Choose the store the space belongs to.');
  if (!Number.isSafeInteger(s.amount) || s.amount <= 0) errs.push('Enter the monthly rent.');
  if (!(s.dueDay >= 1 && s.dueDay <= 28)) errs.push('Pick a due day from 1 to 28.');
  if (!(s.graceDays >= 0 && s.graceDays <= 30)) errs.push('Grace days run from 0 to 30.');
  if (!/^\d{4}-\d{2}$/.test(s.startPeriod)) errs.push('Pick the first month, as YYYY-MM.');
  if (errs.length) throw new ValidationError(errs);
  if (!books.state.receivables) books.state.receivables = { rent: [], items: [] };
  const list = books.state.receivables.rent;
  const i = list.findIndex((x) => x.id === s.id);
  const before = i >= 0 ? structuredClone(list[i]) : undefined;
  if (i >= 0) list[i] = s; else list.push(s);
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'receivable', objectId: s.id, summary: `${before ? 'Updated' : 'Added'} rent schedule for ${tenant!.name}`, before, after: structuredClone(s) });
  books.changed();
  return s;
}

// ── Rebates, claims and refunds ──────────────────────────────────────────
export interface ItemStatus {
  item: ReceivableItem;
  received: Cents;
  outstanding: Cents;
  overdue: boolean;
  status: 'open' | 'overdue' | 'received' | 'closed';
}

/** Received counts only deposits still live in the books. */
export function itemStatus(state: BooksState, item: ReceivableItem, today: string): ItemStatus {
  const live = new Set(state.transactions.filter((t) => !t.deleted).map((t) => t.id));
  const received = item.receipts.filter((r) => live.has(r.txnId)).reduce((a, r) => a + r.amount, 0);
  const outstanding = item.closed ? 0 : Math.max(0, item.expected - received);
  const overdue = outstanding > 0 && item.expectedBy < today;
  return { item, received, outstanding, overdue, status: item.closed ? 'closed' : outstanding === 0 ? 'received' : overdue ? 'overdue' : 'open' };
}

export function receivableItems(state: BooksState, today: string, kind?: ReceivableKind): ItemStatus[] {
  return arState(state).items.filter((i) => !kind || i.kind === kind).map((i) => itemStatus(state, i, today)).sort((a, b) => a.item.expectedBy.localeCompare(b.item.expectedBy));
}

export function saveReceivable(books: Books, actor: User, item: ReceivableItem): ReceivableItem {
  books.require(actor, 'ar.edit', 'change receivables');
  const errs: string[] = [];
  if (!item.payer.trim()) errs.push('Say who owes it (the program, insurer or vendor).');
  if (!item.description.trim()) errs.push('Describe what it is for.');
  if (!Number.isSafeInteger(item.expected) || item.expected <= 0) errs.push('Enter the amount expected.');
  if (!isValidDate(item.expectedBy)) errs.push('Enter when you expect it, as YYYY-MM-DD.');
  if (!books.state.stores.some((s) => s.id === item.storeId)) errs.push('Choose the store.');
  if (!books.account(item.incomeAccountId)) errs.push('Choose the account the money posts to when it arrives.');
  if (errs.length) throw new ValidationError(errs);
  if (!books.state.receivables) books.state.receivables = { rent: [], items: [] };
  const list = books.state.receivables.items;
  const i = list.findIndex((x) => x.id === item.id);
  const before = i >= 0 ? structuredClone(list[i]) : undefined;
  if (i >= 0) list[i] = item; else list.push(item);
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'receivable', objectId: item.id, summary: `${before ? 'Updated' : 'Added'} ${KIND_LABEL[item.kind].toLowerCase()}: ${item.payer} ${formatMoney(item.expected, { dollarSign: true })}`, before, after: structuredClone(item) });
  books.changed();
  return item;
}

function findItem(books: Books, id: ID): ReceivableItem {
  const it = arState(books.state).items.find((x) => x.id === id);
  if (!it) throw new ValidationError(['That receivable no longer exists.']);
  return it;
}

/** Book the money arriving (bank → income account) and apply it to the item. */
export function recordReceivableReceipt(books: Books, actor: User, id: ID, input: { date: string; amount: Cents; bankAccountId?: ID }): Transaction {
  books.require(actor, 'ar.edit', 'record money received');
  const it = findItem(books, id);
  if (it.closed) throw new ValidationError(['This item is closed. Reopen it first.']);
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new ValidationError(['Enter the amount received.']);
  const t = books.createTransaction(actor, {
    date: input.date, kind: 'money_in', description: `${it.payer} – ${it.description}`, partyId: it.partyId, tags: [it.kind === 'rebate' ? 'rebates' : 'receivables'],
    lines: [
      { accountId: input.bankAccountId ?? 'acct_trustmark', storeId: bankStoreId(books.state), debit: input.amount, credit: 0 },
      { accountId: it.incomeAccountId, storeId: it.storeId, debit: 0, credit: input.amount, partyId: it.partyId },
    ],
  });
  it.receipts.push({ txnId: t.id, amount: input.amount });
  books.audit(actor, { action: 'received', objectType: 'receivable', objectId: it.id, summary: `Received ${formatMoney(input.amount, { dollarSign: true })} from ${it.payer} (${t.ref})` });
  books.changed();
  return t;
}

/** Apply a deposit already in the books (e.g. booked from the bank feed) to an item. */
export function linkReceipt(books: Books, actor: User, id: ID, txnId: ID): void {
  books.require(actor, 'ar.edit', 'apply deposits to receivables');
  const it = findItem(books, id);
  const t = books.getTransaction(txnId);
  if (!t || t.deleted) throw new ValidationError(['That deposit is not in the books.']);
  const banks = new Set(books.state.accounts.filter((a) => a.subtype === 'bank').map((a) => a.id));
  const amt = t.lines.filter((l) => banks.has(l.accountId)).reduce((a, l) => a + l.debit - l.credit, 0);
  if (amt <= 0) throw new ValidationError([`${t.ref} isn't a deposit. Pick money that came into the bank.`]);
  if (arState(books.state).items.some((x) => x.receipts.some((r) => r.txnId === t.id))) throw new ValidationError([`${t.ref} is already applied to a receivable.`]);
  it.receipts.push({ txnId: t.id, amount: amt });
  books.audit(actor, { action: 'link', objectType: 'receivable', objectId: it.id, summary: `Applied ${t.ref} (${formatMoney(amt, { dollarSign: true })}) to ${it.payer}` });
  books.changed();
}

export function closeReceivable(books: Books, actor: User, id: ID, reason: string | null): void {
  books.require(actor, 'ar.edit', 'close receivables');
  const it = findItem(books, id);
  if (reason !== null && !reason.trim()) throw new ValidationError(['Say why you are closing it (e.g. program ended, claim denied).']);
  const before = it.closed;
  it.closed = reason === null ? undefined : { by: actor.id, at: books.clock(), reason: reason.trim() };
  books.audit(actor, { action: reason === null ? 'reopen' : 'close', objectType: 'receivable', objectId: it.id, summary: `${reason === null ? 'Reopened' : 'Closed'} ${it.payer} ${it.description}`, before, reason: reason ?? undefined });
  books.changed();
}

/** Deposits that could be the money for an item: unapplied money in, around the expected amount. */
export function receiptCandidates(state: BooksState, item: ReceivableItem): Transaction[] {
  const applied = new Set(arState(state).items.flatMap((i) => i.receipts.map((r) => r.txnId)));
  const banks = new Set(state.accounts.filter((a) => a.subtype === 'bank').map((a) => a.id));
  return state.transactions.filter((t) => {
    if (t.deleted || applied.has(t.id) || t.kind !== 'money_in') return false;
    const amt = t.lines.filter((l) => banks.has(l.accountId)).reduce((a, l) => a + l.debit - l.credit, 0);
    return amt > 0 && t.lines.some((l) => l.accountId === item.incomeAccountId) && Math.abs(amt - item.expected) <= Math.max(item.expected * 0.25, 1_000);
  }).slice(-10);
}

// ── ATM income ───────────────────────────────────────────────────────────
export function atmIncome(state: BooksState, from: string, to: string): { period: string; amount: Cents; txns: Transaction[] }[] {
  const out = periodsBetween(from, to).map((period) => ({ period, amount: 0, txns: [] as Transaction[] }));
  const by = new Map(out.map((r) => [r.period, r]));
  for (const t of state.transactions) {
    if (t.deleted) continue;
    for (const l of t.lines) {
      if (l.accountId !== 'acct_atm_income') continue;
      const r = by.get(periodOf(t.date));
      if (!r) continue;
      r.amount += l.credit - l.debit;
      if (!r.txns.includes(t)) r.txns.push(t);
    }
  }
  return out;
}
