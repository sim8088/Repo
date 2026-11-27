import type { Books } from './books';
import { ValidationError } from './books';
import type { Attachment, Bill, BillLine, BooksState, ID, PayMethod, PayablesState, Transaction, User, UtilityAccount, UtilityService, VendorStatement } from './types';
import type { Cents } from './money';
import { can, PermissionError } from './permissions';
import { addDays, daysBetween, isValidDate, periodOf } from './dates';
import { formatMoney } from './money';
import { bankStoreId } from './bank';
import { balanceAsOf } from './reports';
import { addForecastSource, forecast, type ForecastEvent } from './forecast';
import { requireApproval } from './limits';

export const AP = 'acct_ap';
export const BILL_STATUS_LABEL: Record<Bill['status'], string> = { draft: 'Awaiting approval', approved: 'Approved', scheduled: 'Scheduled', paid: 'Paid', void: 'Void' };
export const METHOD_LABEL: Record<PayMethod, string> = { check: 'Check', ach: 'ACH / online', autopay: 'Autopay', card: 'Card', cash: 'Cash' };
export const SERVICE_LABEL: Record<UtilityService, string> = { electric: 'Electric', water: 'Water & sewer', gas: 'Natural gas', telecom: 'Phone & internet', waste: 'Waste hauling' };
export const AP_AGING_LABELS = ['Current', '1–30 days', '31–60', '61–90', 'Over 90'] as const;
export const TEN99_THRESHOLD = 60_000;
/** A utility bill more than this much above the one before it is flagged. */
export const JUMP_PCT = 25;

export function apState(state: BooksState): PayablesState {
  return state.payables ?? { bills: [], utilities: [], statements: [] };
}

export function billTotal(b: Pick<Bill, 'lines'>): Cents {
  return b.lines.reduce((a, l) => a + l.amount, 0);
}

export function vendorName(state: BooksState, id: ID): string {
  return state.parties.find((p) => p.id === id)?.name ?? id;
}

// ── Entering bills ───────────────────────────────────────────────────────
export interface BillDraft {
  vendorId: ID;
  storeId: ID;
  invoiceNo: string;
  billDate: string;
  dueDate: string;
  lines: Omit<BillLine, 'id'>[];
  autopay?: boolean;
  memo?: string;
  utilityAccountId?: ID;
  disconnectNotice?: boolean;
  attachments?: Attachment[];
  source?: Bill['source'];
}

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');

export function validateBill(state: BooksState, d: BillDraft, selfId?: ID): string[] {
  const errs: string[] = [];
  const v = state.parties.find((p) => p.id === d.vendorId && !p.deleted);
  if (!v) errs.push('Choose the vendor. Add new ones in Setup › Vendors & parties.');
  if (!d.invoiceNo.trim()) errs.push('Enter the invoice number from the bill, so the vendor statement can be matched.');
  else if (apState(state).bills.some((b) => b.id !== selfId && b.status !== 'void' && b.vendorId === d.vendorId && norm(b.invoiceNo) === norm(d.invoiceNo))) {
    errs.push(`${v?.name ?? 'This vendor'} invoice ${d.invoiceNo.trim()} is already entered. Open that bill instead of entering it twice.`);
  }
  if (!isValidDate(d.billDate)) errs.push('Enter the bill date as YYYY-MM-DD.');
  if (!isValidDate(d.dueDate)) errs.push('Enter the due date as YYYY-MM-DD.');
  else if (isValidDate(d.billDate) && d.dueDate < d.billDate) errs.push('The due date is before the bill date. Check both dates on the bill.');
  if (!state.stores.some((s) => s.id === d.storeId && !s.deleted)) errs.push('Choose the store the bill is for (CORP for company-wide).');
  if (!d.lines.length) errs.push('Add at least one category line.');
  d.lines.forEach((l, i) => {
    const a = state.accounts.find((x) => x.id === l.accountId);
    if (!a) errs.push(`Line ${i + 1}: choose a category.`);
    else if (!a.active) errs.push(`Line ${i + 1}: ${a.number} ${a.name} is inactive.`);
    else if (a.subtype === 'bank' || a.subtype === 'cash' || a.id === AP) errs.push(`Line ${i + 1}: a bill can't be categorized to ${a.name}. Pick the expense or purchase it was for.`);
    if (!state.stores.some((s) => s.id === l.storeId && !s.deleted)) errs.push(`Line ${i + 1}: choose a store.`);
    if (!Number.isSafeInteger(l.amount) || l.amount <= 0) errs.push(`Line ${i + 1}: enter an amount above zero.`);
  });
  return errs;
}

function assertStores(actor: User, stores: ID[]): void {
  if (can(actor, 'view.all_stores')) return;
  const mine = new Set(actor.storeIds ?? []);
  if (stores.some((s) => !mine.has(s))) throw new PermissionError('You can only enter bills for your own store.');
}

function getBill(books: Books, id: ID): Bill {
  const b = apState(books.state).bills.find((x) => x.id === id || x.ref === id);
  if (!b) throw new ValidationError(['That bill no longer exists.']);
  return b;
}

function ensure(books: Books): PayablesState {
  if (!books.state.payables) books.state.payables = { bills: [], utilities: [], statements: [] };
  return books.state.payables;
}

/** Enter a new bill, or edit one still awaiting approval. Bills start as drafts: nothing posts until approval. */
export function saveBill(books: Books, actor: User, d: BillDraft, id?: ID): Bill {
  books.require(actor, 'bills.enter', 'enter bills');
  assertStores(actor, [d.storeId, ...d.lines.map((l) => l.storeId)]);
  const existing = id ? getBill(books, id) : undefined;
  if (existing && existing.status !== 'draft') throw new ValidationError([`${existing.ref} is ${BILL_STATUS_LABEL[existing.status].toLowerCase()}, so it can't be edited. Void it and enter it again if it is wrong.`]);
  const errs = validateBill(books.state, d, existing?.id);
  if (errs.length) throw new ValidationError(errs);
  const ap = ensure(books);
  const lines: BillLine[] = d.lines.map((l) => ({ id: books.nextId('bln'), accountId: l.accountId, storeId: l.storeId, amount: l.amount, memo: l.memo?.trim() || undefined }));
  const fields = {
    vendorId: d.vendorId, storeId: d.storeId, invoiceNo: d.invoiceNo.trim(), billDate: d.billDate, dueDate: d.dueDate, lines, autopay: !!d.autopay,
    memo: d.memo?.trim() || undefined, utilityAccountId: d.utilityAccountId || undefined, disconnectNotice: d.disconnectNotice || undefined,
  };
  if (existing) {
    const before = structuredClone(existing);
    Object.assign(existing, fields);
    if (d.attachments) existing.attachments = d.attachments;
    books.audit(actor, { action: 'update', objectType: 'bill', objectId: existing.id, summary: `Edited ${existing.ref}`, before, after: structuredClone(existing) });
    books.changed();
    return existing;
  }
  const b: Bill = {
    id: books.nextId('bill'), ref: 'BILL-' + String(ap.bills.length + 1).padStart(4, '0'), ...fields, status: 'draft',
    attachments: d.attachments ?? [], source: d.source ?? 'manual', createdAt: books.clock(), createdBy: actor.id,
  };
  ap.bills.push(b);
  books.audit(actor, { action: 'create', objectType: 'bill', objectId: b.id, summary: `Entered ${b.ref} · ${vendorName(books.state, b.vendorId)} ${b.invoiceNo} ${formatMoney(billTotal(b), { dollarSign: true })}`, after: structuredClone(b) });
  books.changed();
  return b;
}

/**
 * Approve a bill: posts the expense lines against 2000 Accounts payable on the bill date (accrual).
 * Needs the `approve` permission. The entry is posted under the approver when their role can post
 * journals, otherwise under the person who entered the bill.
 */
export function approveBill(books: Books, actor: User, id: ID, note?: string): Transaction {
  const b = getBill(books, id);
  // Phase 14: approval limits by role and amount (one central check; names who can approve when refused).
  requireApproval(books, actor, 'bill', billTotal(b), b.ref);
  if (b.status !== 'draft') throw new ValidationError([`${b.ref} is already ${BILL_STATUS_LABEL[b.status].toLowerCase()}.`]);
  const errs = validateBill(books.state, { ...b }, b.id);
  if (errs.length) throw new ValidationError(errs);
  const creator = books.state.users.find((u) => u.id === b.createdBy);
  const poster = can(actor, 'journal.create') ? actor : creator && can(creator, 'journal.create') ? creator : null;
  if (!poster) throw new ValidationError(['Nobody on this bill can post to the books. Ask the bookkeeper or CFO to approve it, or to enter it themselves.']);
  const vendor = vendorName(books.state, b.vendorId);
  const total = billTotal(b);
  const t = books.createTransaction(poster, {
    date: b.billDate, kind: 'journal', description: `Bill ${vendor} ${b.invoiceNo}`, docNo: b.invoiceNo, partyId: b.vendorId, tags: ['payables', 'bill'],
    memo: note?.trim() || b.memo,
    lines: [
      ...b.lines.map((l) => ({ accountId: l.accountId, storeId: l.storeId, debit: l.amount, credit: 0, memo: l.memo })),
      { accountId: AP, storeId: b.storeId, debit: 0, credit: total, partyId: b.vendorId, memo: `${b.ref} due ${b.dueDate}` },
    ],
  }, { attachments: b.attachments.map((a) => ({ ...a })) });
  const before = structuredClone(b);
  b.approved = { by: actor.id, at: books.clock(), note: note?.trim() || undefined, txnId: t.id };
  if (b.autopay) {
    b.status = 'scheduled';
    b.scheduled = { date: b.dueDate, method: 'autopay', by: actor.id, at: books.clock() };
  } else b.status = 'approved';
  books.audit(actor, { action: 'approve', objectType: 'bill', objectId: b.id, summary: `Approved ${b.ref} · ${vendor} ${formatMoney(total, { dollarSign: true })}; posted ${t.ref}`, before, after: structuredClone(b), reason: note });
  books.changed();
  return t;
}

/** Send a bill back: it becomes void and nothing was ever posted. */
export function rejectBill(books: Books, actor: User, id: ID, reason: string): void {
  books.require(actor, 'approve', 'reject bills');
  const b = getBill(books, id);
  if (b.status !== 'draft') throw new ValidationError(['Only bills awaiting approval can be rejected. Void an approved bill instead.']);
  if (!reason.trim()) throw new ValidationError(['Say why the bill is rejected. The reason goes in the audit log.']);
  const before = structuredClone(b);
  b.status = 'void';
  b.voided = { by: actor.id, at: books.clock(), reason: reason.trim() };
  books.audit(actor, { action: 'reject', objectType: 'bill', objectId: b.id, summary: `Rejected ${b.ref}`, before, reason });
  books.changed();
}

/** Void an approved, unpaid bill: its accrual entry is soft-deleted with the reason. */
export function voidBill(books: Books, actor: User, id: ID, reason: string): void {
  books.require(actor, 'bills.pay', 'void bills');
  const b = getBill(books, id);
  if (b.status === 'paid') throw new ValidationError(['This bill is paid. Record a refund or credit from the vendor instead.']);
  if (b.status === 'void') return;
  if (!reason.trim()) throw new ValidationError(['Say why the bill is void.']);
  const before = structuredClone(b);
  if (b.approved) books.deleteTransaction(actor, b.approved.txnId, `Bill ${b.ref} voided: ${reason.trim()}`);
  b.status = 'void';
  b.voided = { by: actor.id, at: books.clock(), reason: reason.trim() };
  books.audit(actor, { action: 'void', objectType: 'bill', objectId: b.id, summary: `Voided ${b.ref}`, before, reason });
  books.changed();
}

export function scheduleBill(books: Books, actor: User, id: ID, input: { date: string; method: PayMethod } | null): void {
  books.require(actor, 'bills.pay', 'schedule bill payments');
  const b = getBill(books, id);
  if (b.status !== 'approved' && b.status !== 'scheduled') throw new ValidationError([b.status === 'draft' ? `${b.ref} needs approval before it can be scheduled.` : `${b.ref} is ${BILL_STATUS_LABEL[b.status].toLowerCase()}.`]);
  if (input && !isValidDate(input.date)) throw new ValidationError(['Pick the date the payment goes out.']);
  const before = structuredClone(b);
  if (input) {
    b.scheduled = { date: input.date, method: input.method, by: actor.id, at: books.clock() };
    b.status = 'scheduled';
  } else {
    b.scheduled = undefined;
    b.status = 'approved';
  }
  books.audit(actor, { action: input ? 'schedule' : 'unschedule', objectType: 'bill', objectId: b.id, summary: input ? `Scheduled ${b.ref} for ${input.date} by ${METHOD_LABEL[input.method].toLowerCase()}` : `Unscheduled ${b.ref}`, before, after: structuredClone(b) });
  books.changed();
}

export interface PaymentInput {
  date: string;
  method: PayMethod;
  checkNo?: string;
  confirmation?: string;
  bankAccountId?: ID;
  attachments?: Attachment[];
}

/** Record that a bill was paid: 2000 Accounts payable → the bank (or cash at HQ), with check # and confirmation. */
export function payBill(books: Books, actor: User, id: ID, p: PaymentInput): Transaction {
  books.require(actor, 'bills.pay', 'record bill payments');
  const b = getBill(books, id);
  if (b.status === 'draft') throw new ValidationError([`${b.ref} needs approval before it can be paid.`]);
  if (b.status === 'paid' || b.status === 'void') throw new ValidationError([`${b.ref} is already ${BILL_STATUS_LABEL[b.status].toLowerCase()}.`]);
  const errs: string[] = [];
  if (!isValidDate(p.date)) errs.push('Enter the payment date as YYYY-MM-DD.');
  if (p.method === 'check' && !p.checkNo?.trim()) errs.push('Enter the check number.');
  if ((p.method === 'ach' || p.method === 'card') && !p.confirmation?.trim() && !p.attachments?.length) errs.push('Enter the confirmation number, or attach the confirmation.');
  const banks = new Set(books.state.accounts.filter((a) => a.subtype === 'bank').map((a) => a.id));
  const payFrom = p.method === 'cash' ? 'acct_cash_transit' : p.bankAccountId ?? 'acct_trustmark';
  if (p.checkNo?.trim()) {
    const clash = books.state.transactions.find((t) => !t.deleted && t.checkNo === p.checkNo!.trim() && t.lines.some((l) => banks.has(l.accountId)));
    if (clash) errs.push(`Check #${p.checkNo.trim()} is already used by ${clash.ref}. Check the number on the stub.`);
  }
  if (errs.length) throw new ValidationError(errs);
  const vendor = vendorName(books.state, b.vendorId);
  const total = billTotal(b);
  const corp = bankStoreId(books.state);
  const t = books.createTransaction(actor, {
    date: p.date, kind: 'money_out', description: `${vendor} ${b.invoiceNo}`, partyId: b.vendorId, checkNo: p.method === 'check' ? p.checkNo!.trim() : undefined,
    docNo: b.invoiceNo, tags: ['payables'], memo: p.confirmation?.trim() ? `Confirmation ${p.confirmation.trim()}` : undefined,
    lines: [
      { accountId: AP, storeId: b.storeId, debit: total, credit: 0, partyId: b.vendorId, memo: `Pays ${b.ref}` },
      { accountId: payFrom, storeId: corp, debit: 0, credit: total },
    ],
  }, { attachments: p.attachments ?? [] });
  const before = structuredClone(b);
  b.status = 'paid';
  b.payment = { date: p.date, method: p.method, checkNo: p.checkNo?.trim() || undefined, confirmation: p.confirmation?.trim() || undefined, txnId: t.id, by: actor.id, at: books.clock(), attachments: p.attachments ?? [] };
  books.audit(actor, { action: 'pay', objectType: 'bill', objectId: b.id, summary: `Paid ${b.ref} · ${vendor} ${formatMoney(total, { dollarSign: true })} by ${METHOD_LABEL[p.method].toLowerCase()}${p.checkNo ? ' #' + p.checkNo : ''} (${t.ref})`, before, after: structuredClone(b) });
  books.changed();
  return t;
}

export function addBillAttachment(books: Books, actor: User, id: ID, att: Attachment): void {
  books.require(actor, 'bills.enter', 'attach documents to bills');
  const b = getBill(books, id);
  assertStores(actor, [b.storeId]);
  b.attachments.push(att);
  if (b.approved) {
    const t = books.getTransaction(b.approved.txnId);
    if (t && !books.isLocked(periodOf(t.date))) t.attachments.push({ ...att });
  }
  books.audit(actor, { action: 'attach', objectType: 'bill', objectId: b.id, summary: `Attached ${att.name} to ${b.ref}` });
  books.changed();
}

// ── Where bills stand ────────────────────────────────────────────────────
/** On the books as payable at the date: approved with a bill date on or before it, and not paid by then. */
export function isOpenAt(b: Bill, asOf: string): boolean {
  if (!b.approved || b.status === 'void' || b.billDate > asOf) return false;
  return !b.payment || b.payment.date > asOf;
}

export function openBills(state: BooksState, asOf: string): Bill[] {
  return apState(state).bills.filter((b) => isOpenAt(b, asOf));
}

/** When the money goes out: the scheduled date, else the due date (never before tomorrow). */
export function payDate(b: Bill, today: string): string {
  const d = b.scheduled?.date ?? b.dueDate;
  return d > today ? d : addDays(today, 1);
}

export function daysPastDue(b: Bill, today: string): number {
  return daysBetween(b.dueDate, today);
}

export function pastDue(state: BooksState, today: string): Bill[] {
  return openBills(state, today).filter((b) => b.dueDate < today && !(b.scheduled && b.scheduled.date <= today));
}

export function dueWithin(state: BooksState, today: string, days: number): Bill[] {
  const end = addDays(today, days);
  return openBills(state, today).filter((b) => b.dueDate >= today && b.dueDate <= end);
}

/** Approved, due in the next `days` days (or already due), with no payment scheduled and no autopay. */
export function unscheduledDueSoon(state: BooksState, today: string, days = 3): Bill[] {
  const end = addDays(today, days);
  return openBills(state, today).filter((b) => b.status === 'approved' && !b.autopay && b.dueDate >= today && b.dueDate <= end);
}

export function awaitingApproval(state: BooksState): Bill[] {
  return apState(state).bills.filter((b) => b.status === 'draft');
}

// ── AP aging ─────────────────────────────────────────────────────────────
export interface AgingRow {
  vendorId: ID;
  name: string;
  buckets: Cents[];
  total: Cents;
  bills: Bill[];
}
export interface ApAging {
  asOf: string;
  rows: AgingRow[];
  buckets: Cents[];
  total: Cents;
  /** 2000 Accounts payable per the ledger. */
  glBalance: Cents;
  /** AP ledger lines that did not come from a bill (manual entries), credit-positive. */
  unlinked: Cents;
  unlinkedTxns: Transaction[];
  ties: boolean;
}

export function agingBucket(daysPast: number): number {
  return daysPast <= 0 ? 0 : daysPast <= 30 ? 1 : daysPast <= 60 ? 2 : daysPast <= 90 ? 3 : 4;
}

export function apAging(state: BooksState, asOf: string): ApAging {
  const by = new Map<ID, AgingRow>();
  for (const b of openBills(state, asOf)) {
    const r = by.get(b.vendorId) ?? { vendorId: b.vendorId, name: vendorName(state, b.vendorId), buckets: [0, 0, 0, 0, 0], total: 0, bills: [] };
    const t = billTotal(b);
    r.buckets[agingBucket(daysPastDue(b, asOf))] += t;
    r.total += t;
    r.bills.push(b);
    by.set(b.vendorId, r);
  }
  const rows = [...by.values()].sort((a, b) => b.total - a.total);
  const buckets = [0, 1, 2, 3, 4].map((i) => rows.reduce((a, r) => a + r.buckets[i], 0));
  const total = rows.reduce((a, r) => a + r.total, 0);
  const billTxns = new Set(apState(state).bills.flatMap((b) => [b.approved?.txnId, b.payment?.txnId]).filter(Boolean) as ID[]);
  let unlinked = 0;
  const unlinkedTxns: Transaction[] = [];
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf || billTxns.has(t.id)) continue;
    let n = 0;
    for (const l of t.lines) if (l.accountId === AP) n += l.credit - l.debit;
    if (n) { unlinked += n; unlinkedTxns.push(t); }
  }
  const glBalance = balanceAsOf(state, AP, asOf);
  return { asOf, rows, buckets, total, glBalance, unlinked, unlinkedTxns, ties: total + unlinked === glBalance };
}

// ── Payment calendar & the forecast hook ─────────────────────────────────
/** Approved and scheduled bills as known cash-out events in the 13-week forecast. */
export function billEvents(state: BooksState, accountId: ID, asOf: string, end: string): ForecastEvent[] {
  if (accountId !== 'acct_trustmark') return []; // bills are paid from the shared operating account
  const out: ForecastEvent[] = [];
  for (const b of openBills(state, asOf)) {
    if (b.scheduled?.method === 'cash') continue;
    const d = payDate(b, asOf);
    if (d > end) continue;
    out.push({ date: d, label: `${vendorName(state, b.vendorId)} ${b.invoiceNo}`, amount: -billTotal(b), source: 'bill', key: b.id, replaces: `p:${b.vendorId}|out` });
  }
  return out;
}
addForecastSource(billEvents);

export interface CalendarDay {
  date: string;
  bills: Bill[];
  out: Cents;
  /** Projected bank balance at the end of the day, scheduled bills included. */
  projected: Cents;
  belowFloor: boolean;
}

export function paymentCalendar(state: BooksState, accountId: ID, today: string, days = 35): { days: CalendarDay[]; floor: Cents; opening: Cents; forecastBills: Cents; calendarBills: Cents; awaiting: Bill[] } {
  const fc = forecast(state, accountId, today);
  const open = openBills(state, today).filter((b) => b.scheduled?.method !== 'cash');
  const out: CalendarDay[] = [];
  for (let n = 1; n <= days; n++) {
    const date = addDays(today, n);
    const bills = open.filter((b) => payDate(b, today) === date);
    const projected = fc.at(n);
    out.push({ date, bills, out: bills.reduce((a, b) => a + billTotal(b), 0), projected, belowFloor: projected < fc.floor });
  }
  const end = addDays(today, days);
  const forecastBills = -fc.weeks.flatMap((w) => w.events).filter((e) => e.source === 'bill' && e.date <= end).reduce((a, e) => a + e.amount, 0);
  return { days: out, floor: fc.floor, opening: fc.opening, forecastBills, calendarBills: out.reduce((a, d) => a + d.out, 0), awaiting: awaitingApproval(state) };
}

// ── Utilities ────────────────────────────────────────────────────────────
export interface UtilityEntry {
  date: string;
  amount: Cents;
  dueDate?: string;
  billId?: ID;
  txnId?: ID;
  status: string;
  source: 'bill' | 'bank';
}
export interface UtilityRow {
  ua: UtilityAccount;
  history: UtilityEntry[];
  last?: UtilityEntry;
  previous?: UtilityEntry;
  /** Percent change of the last bill over the one before, rounded. */
  changePct: number | null;
  jump: boolean;
  openBills: Bill[];
  pastDue: Bill[];
  disconnect: boolean;
  nextDue?: string;
}

export function isJump(previous: Cents, last: Cents): boolean {
  return previous > 0 && last * 100 > previous * (100 + JUMP_PCT);
}

export function utilityHistory(state: BooksState, ua: UtilityAccount): UtilityEntry[] {
  const bills = apState(state).bills.filter((b) => b.utilityAccountId === ua.id && b.status !== 'void');
  const billTxns = new Set(apState(state).bills.flatMap((b) => [b.approved?.txnId, b.payment?.txnId]).filter(Boolean) as ID[]);
  const out: UtilityEntry[] = bills.map((b) => ({ date: b.billDate, amount: billTotal(b), dueDate: b.dueDate, billId: b.id, status: BILL_STATUS_LABEL[b.status], source: 'bill' as const }));
  // Paid straight from the bank with no bill entered (e.g. autopay drafts): still part of the history.
  for (const t of state.transactions) {
    if (t.deleted || t.partyId !== ua.vendorId || billTxns.has(t.id) || t.kind !== 'money_out') continue;
    const amt = t.lines.filter((l) => l.accountId === 'acct_utilities' && l.storeId === ua.storeId).reduce((a, l) => a + l.debit - l.credit, 0);
    if (amt > 0) out.push({ date: t.date, amount: amt, txnId: t.id, status: 'Paid from bank', source: 'bank' });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function utilityRows(state: BooksState, today: string): UtilityRow[] {
  return apState(state).utilities.filter((u) => u.active).map((ua) => {
    const history = utilityHistory(state, ua);
    const last = history.at(-1);
    const previous = history.at(-2);
    const bills = apState(state).bills.filter((b) => b.utilityAccountId === ua.id && b.status !== 'void');
    const open = bills.filter((b) => b.status === 'draft' || isOpenAt(b, today));
    const past = open.filter((b) => b.dueDate < today);
    return {
      ua, history, last, previous,
      changePct: last && previous && previous.amount > 0 ? Math.round(((last.amount - previous.amount) * 100) / previous.amount) : null,
      jump: !!(last && previous && isJump(previous.amount, last.amount)),
      openBills: open, pastDue: past, disconnect: open.some((b) => b.disconnectNotice),
      nextDue: open.map((b) => b.dueDate).sort()[0],
    };
  });
}

export function saveUtilityAccount(books: Books, actor: User, ua: UtilityAccount): UtilityAccount {
  books.require(actor, 'setup.edit', 'change utility accounts');
  const errs: string[] = [];
  if (!books.state.parties.some((p) => p.id === ua.vendorId)) errs.push('Choose the utility company.');
  if (!books.state.stores.some((s) => s.id === ua.storeId)) errs.push('Choose the store served.');
  if (!ua.accountNo.trim()) errs.push('Enter the account number from the bill.');
  if (!ua.serviceAddress.trim()) errs.push('Enter the service address.');
  if (errs.length) throw new ValidationError(errs);
  const list = ensure(books).utilities;
  const i = list.findIndex((x) => x.id === ua.id);
  const before = i >= 0 ? structuredClone(list[i]) : undefined;
  if (i >= 0) list[i] = ua; else list.push(ua);
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'bill', objectId: ua.id, summary: `${before ? 'Updated' : 'Added'} utility account ${vendorName(books.state, ua.vendorId)} ${ua.accountNo}`, before, after: structuredClone(ua) });
  books.changed();
  return ua;
}

// ── Vendor statement reconciliation ──────────────────────────────────────
export type StatementItemKind = 'agreed' | 'amount_diff' | 'in_transit' | 'not_entered' | 'not_on_statement' | 'unexplained';
export const STATEMENT_ITEM_LABEL: Record<StatementItemKind, string> = {
  agreed: 'Agrees', amount_diff: 'Amount differs', in_transit: 'Paid by us, not yet credited by vendor', not_entered: 'On statement, not in our AP',
  not_on_statement: 'In our AP, not on statement', unexplained: 'Not explained by any invoice',
};
export interface StatementItem {
  kind: StatementItemKind;
  invoiceNo: string;
  date?: string;
  ours?: Cents;
  theirs?: Cents;
  /** How much this item adds to (statement − our AP). */
  effect: Cents;
  billId?: ID;
  note: string;
}
export interface StatementRec {
  statement: VendorStatement;
  apBalance: Cents;
  difference: Cents;
  items: StatementItem[];
  explained: Cents;
  unexplained: Cents;
}

export function vendorAp(state: BooksState, vendorId: ID, asOf: string): Bill[] {
  return openBills(state, asOf).filter((b) => b.vendorId === vendorId);
}

/** Statement balance vs our AP for that vendor, with every invoice explained. Effects add up to the difference exactly. */
export function reconcileStatement(state: BooksState, st: VendorStatement): StatementRec {
  const open = vendorAp(state, st.vendorId, st.date);
  const apBalance = open.reduce((a, b) => a + billTotal(b), 0);
  const all = apState(state).bills.filter((b) => b.vendorId === st.vendorId && b.status !== 'void');
  const items: StatementItem[] = [];
  const onStatement = new Set<ID>();
  for (const sl of st.lines) {
    const b = all.find((x) => norm(x.invoiceNo) === norm(sl.invoiceNo));
    if (b) onStatement.add(b.id);
    const ours = b ? billTotal(b) : undefined;
    if (b && isOpenAt(b, st.date)) {
      items.push(ours === sl.amount
        ? { kind: 'agreed', invoiceNo: sl.invoiceNo, date: sl.date, ours, theirs: sl.amount, effect: 0, billId: b.id, note: `${b.ref}, open both sides.` }
        : { kind: 'amount_diff', invoiceNo: sl.invoiceNo, date: sl.date, ours, theirs: sl.amount, effect: sl.amount - ours!, billId: b.id, note: `We entered ${formatMoney(ours!, { dollarSign: true })}; the vendor shows ${formatMoney(sl.amount, { dollarSign: true })}. Check the bill.` });
    } else if (b && b.payment && b.payment.date <= st.date) {
      items.push({ kind: 'in_transit', invoiceNo: sl.invoiceNo, date: sl.date, ours, theirs: sl.amount, effect: sl.amount, billId: b.id, note: `Paid ${b.payment.date}${b.payment.checkNo ? ' by check #' + b.payment.checkNo : ''}. Should drop off the next statement.` });
    } else {
      items.push({ kind: 'not_entered', invoiceNo: sl.invoiceNo, date: sl.date, theirs: sl.amount, effect: sl.amount, billId: b?.id, note: b ? `${b.ref} is ${BILL_STATUS_LABEL[b.status].toLowerCase()}; it isn't in AP until approved.` : 'No bill entered for this invoice. Get a copy from the vendor and enter it.' });
    }
  }
  for (const b of open) {
    if (onStatement.has(b.id)) continue;
    items.push({ kind: 'not_on_statement', invoiceNo: b.invoiceNo, date: b.billDate, ours: billTotal(b), effect: -billTotal(b), billId: b.id, note: 'The vendor may not have posted it yet, or it was paid and credited. Ask them.' });
  }
  const difference = st.balance - apBalance;
  const explained = items.reduce((a, i) => a + i.effect, 0);
  const unexplained = difference - explained;
  if (unexplained !== 0) items.push({ kind: 'unexplained', invoiceNo: '—', effect: unexplained, note: 'The statement total and its invoice lines differ: usually finance charges, credits or unapplied payments. Ask the vendor for detail.' });
  return { statement: st, apBalance, difference, items, explained: explained + unexplained, unexplained };
}

export function saveVendorStatement(books: Books, actor: User, st: Omit<VendorStatement, 'id' | 'by' | 'at'> & { id?: ID }): VendorStatement {
  books.require(actor, 'bills.pay', 'record vendor statements');
  const errs: string[] = [];
  if (!books.state.parties.some((p) => p.id === st.vendorId)) errs.push('Choose the vendor.');
  if (!isValidDate(st.date)) errs.push('Enter the statement date as YYYY-MM-DD.');
  if (!Number.isSafeInteger(st.balance)) errs.push('Enter the statement balance.');
  st.lines.forEach((l, i) => { if (!l.invoiceNo.trim() || !Number.isSafeInteger(l.amount)) errs.push(`Statement line ${i + 1}: enter the invoice number and amount.`); });
  if (errs.length) throw new ValidationError(errs);
  const list = ensure(books).statements;
  const rec: VendorStatement = { ...st, id: st.id ?? books.nextId('vst'), by: actor.id, at: books.clock() };
  const i = list.findIndex((x) => x.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
  books.audit(actor, { action: i >= 0 ? 'update' : 'create', objectType: 'bill', objectId: rec.id, summary: `Recorded ${vendorName(books.state, rec.vendorId)} statement ${rec.date}: ${formatMoney(rec.balance, { dollarSign: true })}`, after: rec });
  books.changed();
  return rec;
}

// ── 1099 tracking ────────────────────────────────────────────────────────
/** What we paid a party in the date range: money out of bank or cash accounts on transactions naming them. */
export function paidTo(state: BooksState, partyId: ID, from: string, to: string): { total: Cents; txns: Transaction[] } {
  const money = new Set(state.accounts.filter((a) => a.subtype === 'bank' || a.subtype === 'cash').map((a) => a.id));
  let total = 0;
  const txns: Transaction[] = [];
  for (const t of state.transactions) {
    if (t.deleted || t.partyId !== partyId || t.date < from || t.date > to) continue;
    const n = t.lines.filter((l) => money.has(l.accountId)).reduce((a, l) => a + l.credit - l.debit, 0);
    if (n) { total += n; txns.push(t); }
  }
  return { total, txns };
}

export function ten99(state: BooksState, year: number, asOf: string): { partyId: ID; name: string; paid: Cents; count: number; flagged: boolean }[] {
  const from = `${year}-01-01`;
  const to = `${year}-12-31` < asOf ? `${year}-12-31` : asOf;
  return state.parties.filter((p) => p.is1099 && !p.deleted).map((p) => {
    const r = paidTo(state, p.id, from, to);
    return { partyId: p.id, name: p.name, paid: r.total, count: r.txns.length, flagged: r.total >= TEN99_THRESHOLD };
  }).sort((a, b) => b.paid - a.paid);
}

// ── Bills inbox: read what we can from pasted text or a file name ────────
export interface Extracted {
  vendorId?: ID;
  storeId?: ID;
  utilityAccountId?: ID;
  invoiceNo?: string;
  amount?: Cents;
  billDate?: string;
  dueDate?: string;
  disconnect: boolean;
  /** What was found, in plain words, for the CFO to check. */
  found: string[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE_RE = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4})`;

export function parseDate(s: string): string | undefined {
  const t = s.trim().toLowerCase();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return isValidDate(t) ? t : undefined;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    const d = `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    return isValidDate(d) ? d : undefined;
  }
  m = /^([a-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/.exec(t);
  if (m && MONTHS.includes(m[1])) {
    const d = `${m[3]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    return isValidDate(d) ? d : undefined;
  }
  return undefined;
}

const toCents = (s: string) => Math.round(Number(s.replace(/[,$\s]/g, '')) * 100);

/** Regex extraction from pasted email text and/or a file name. There is no OCR: a photo only gives what its file name says. */
export function extractBill(state: BooksState, text: string, fileName = ''): Extracted {
  const all = `${fileName.replace(/[_]+/g, ' ')}\n${text}`;
  const low = all.toLowerCase();
  const found: string[] = [];
  const out: Extracted = { disconnect: /disconnect|shut[- ]?off|termination notice|service will be interrupted/i.test(all), found };
  if (out.disconnect) found.push('Disconnect / shut-off wording');
  // Amount: a labelled total wins; otherwise the largest dollar amount.
  const lab = new RegExp(String.raw`(?:amount due|total due|balance due|please pay|total amount|invoice total|\btotal|amount)[^0-9$\n]{0,24}\$?\s*([0-9][0-9,]*\.[0-9]{2})`, 'i').exec(all);
  if (lab) { out.amount = toCents(lab[1]); found.push(`Amount ${formatMoney(out.amount, { dollarSign: true })} (labelled)`); } else {
    const amts = [...all.matchAll(/\$\s?([0-9][0-9,]*\.[0-9]{2})/g)].map((m) => toCents(m[1]));
    if (amts.length) { out.amount = Math.max(...amts); found.push(`Amount ${formatMoney(out.amount, { dollarSign: true })} (largest $ figure)`); }
  }
  const inv = /(?:invoice|inv|bill)\s*(?:no\.?|number|num|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/i.exec(all);
  if (inv && /\d/.test(inv[1])) { out.invoiceNo = inv[1].toUpperCase(); found.push(`Invoice # ${out.invoiceNo}`); }
  const due = new RegExp(String.raw`(?:due date|due by|due on|payment due|due)\s*[:\-]?\s*${DATE_RE}`, 'i').exec(all);
  if (due) { out.dueDate = parseDate(due[1]); if (out.dueDate) found.push(`Due ${out.dueDate}`); }
  const bd = new RegExp(String.raw`(?:invoice date|bill date|statement date|date of service|dated|date)\s*[:\-]?\s*${DATE_RE}`, 'i').exec(all);
  if (bd) { out.billDate = parseDate(bd[1]); if (out.billDate) found.push(`Bill date ${out.billDate}`); }
  if (!out.billDate || !out.dueDate) {
    const dates = [...all.matchAll(new RegExp(DATE_RE, 'gi'))].map((m) => parseDate(m[1])).filter(Boolean) as string[];
    if (!out.billDate && dates.length) out.billDate = dates.filter((d) => d !== out.dueDate).sort()[0] ?? dates[0];
    if (!out.dueDate && dates.length > 1) out.dueDate = dates.sort().at(-1);
  }
  const acctNo = /account\s*(?:no\.?|number|num|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/i.exec(all);
  const utils = apState(state).utilities;
  if (acctNo) {
    const u = utils.find((x) => norm(x.accountNo) === norm(acctNo[1]));
    if (u) { out.utilityAccountId = u.id; out.vendorId = u.vendorId; out.storeId = u.storeId; found.push(`Utility account ${u.accountNo}`); }
  }
  if (!out.vendorId) {
    const vendors = state.parties.filter((p) => !p.deleted && (p.type === 'vendor' || p.type === 'related_company'));
    const hit = vendors.find((p) => low.includes(p.name.toLowerCase().replace(/\s*\(.*\)$/, '')))
      ?? vendors.find((p) => p.name.toLowerCase().split(/[^a-z]+/).some((w) => w.length >= 6 && new RegExp(`\\b${w}\\b`).test(low)));
    if (hit) { out.vendorId = hit.id; found.push(`Vendor ${hit.name}`); }
  }
  if (!out.storeId) {
    const s = state.stores.find((x) => !x.deleted && (new RegExp(`\\b${x.code.toLowerCase()}\\b`).test(low) || low.includes(x.name.toLowerCase())));
    if (s) { out.storeId = s.id; found.push(`Store ${s.code}`); }
  }
  return out;
}
