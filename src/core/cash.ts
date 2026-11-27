import type { Books } from './books';
import { ValidationError } from './books';
import { can, PermissionError } from './permissions';
import type { BooksState, CashBag, CashEvent, CashPayout, CashStage, ID, PayoutKind, Transaction, User } from './types';
import type { DraftLine } from './ledger';
import { addDays, daysBetween } from './dates';
import { formatMoney } from './money';
import { bankStoreId } from './bank';

export const STAGES: CashStage[] = ['count', 'pickup', 'hq_receipt', 'deposit'];
export const STAGE_LABEL: Record<CashStage, string> = { count: 'Store count', pickup: 'Operator pickup', hq_receipt: 'HQ receipt', deposit: 'Deposited' };
export const PAYOUT_LABEL: Record<PayoutKind, string> = { payroll: 'Payroll', vendor: 'Vendor', change: 'Change for a store', draw: 'Owner withdrawal', other: 'Other' };

export const ACCT = { registers: 'acct_cash_registers', pool: 'acct_cash_transit', overShort: 'acct_over_short' } as const;

/** What the POS says should be in the drawer: cash debits on that day's POS close for the store. */
export function posExpectedCash(state: BooksState, storeId: ID, date: string): number | null {
  let found = false;
  let n = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date !== date || !t.tags.includes('pos')) continue;
    for (const l of t.lines) if (l.storeId === storeId && l.accountId === ACCT.registers) { n += l.debit - l.credit; found = true; }
  }
  return found ? n : null;
}

export function event(bag: CashBag, stage: CashStage): CashEvent | undefined {
  return bag.events.find((e) => e.stage === stage);
}

export function bagStage(bag: CashBag): CashStage | null {
  for (let i = STAGES.length - 1; i >= 0; i--) if (event(bag, STAGES[i])) return STAGES[i];
  return null;
}

export interface BagVariance {
  stage: CashStage;
  /** Compared against: POS expected (count) or the previous step. */
  expected: number;
  actual: number;
  diff: number;
  flagged: boolean;
}

/** Each handoff compared with the one before it. Differences at or above materiality are flagged. */
export function bagVariances(state: BooksState, bag: CashBag): BagVariance[] {
  const m = state.settings.materialityCents;
  const out: BagVariance[] = [];
  const count = event(bag, 'count');
  const pos = posExpectedCash(state, bag.storeId, bag.businessDate);
  if (count && pos !== null) out.push({ stage: 'count', expected: pos, actual: count.amount, diff: count.amount - pos, flagged: Math.abs(count.amount - pos) >= m });
  let prev = count;
  for (const st of ['pickup', 'hq_receipt'] as CashStage[]) {
    const e = event(bag, st);
    if (e && prev) out.push({ stage: st, expected: prev.amount, actual: e.amount, diff: e.amount - prev.amount, flagged: Math.abs(e.amount - prev.amount) >= m });
    if (e) prev = e;
  }
  return out;
}

export function bagFlagged(state: BooksState, bag: CashBag): boolean {
  return bagVariances(state, bag).some((v) => v.flagged);
}

/** Picked up but not deposited within the allowed number of days. */
export function bagOverdue(state: BooksState, bag: CashBag, today: string): boolean {
  const p = event(bag, 'pickup');
  return !!p && !event(bag, 'deposit') && daysBetween(p.at.slice(0, 10), today) > state.settings.depositWithinDays;
}

function findBag(state: BooksState, storeId: ID, date: string): CashBag | undefined {
  return state.cash.bags.find((b) => b.storeId === storeId && b.businessDate === date);
}

function post(books: Books, actor: User, date: string, description: string, lines: DraftLine[], tags: string[]): Transaction {
  const pnl = lines.some((l) => l.accountId === ACCT.overShort);
  return books.createTransaction(actor, { date, kind: pnl ? 'journal' : 'transfer', description, tags: ['cash', ...tags], lines }, { source: 'manual' });
}

/**
 * Record one handoff for a store's business-day cash.
 * - count: compares with POS cash; any difference posts to Cash over/short.
 * - pickup: moves the counted cash from the store's registers to the HQ pool (difference to over/short).
 * - hq_receipt: HQ recount; any difference to the pickup posts to over/short.
 * Deposits are pooled across bags: see depositBags.
 */
export function recordCashStep(books: Books, actor: User, input: { storeId: ID; businessDate: string; stage: Exclude<CashStage, 'deposit'>; amount: number; person: string; date?: string; note?: string }): CashBag {
  const { storeId, businessDate, stage, amount } = input;
  if (stage === 'count') {
    books.require(actor, 'cash.count', 'record cash counts');
    if (!can(actor, 'view.all_stores') && !(actor.storeIds ?? []).includes(storeId)) throw new PermissionError('You can only count cash for your own store.');
  } else books.require(actor, 'cash.handle', 'record cash pickups and receipts');
  const errs: string[] = [];
  if (!Number.isSafeInteger(amount) || amount < 0) errs.push('Enter the amount counted, in dollars and cents.');
  if (!input.person.trim()) errs.push('Say who handled the cash.');
  const store = books.store(storeId);
  if (!store) errs.push('Choose a store.');
  if (errs.length) throw new ValidationError(errs);
  let bag = findBag(books.state, storeId, businessDate);
  const idx = STAGES.indexOf(stage);
  if (bag && event(bag, stage)) throw new ValidationError([`${STAGE_LABEL[stage]} is already recorded for ${store!.code} on ${businessDate}.`]);
  const prevStage = idx > 0 ? STAGES[idx - 1] : null;
  if (prevStage && (!bag || !event(bag, prevStage))) throw new ValidationError([`Record the ${STAGE_LABEL[prevStage].toLowerCase()} first.`]);
  if (!bag) {
    bag = { id: books.nextId('bag'), storeId, businessDate, events: [] };
    books.state.cash.bags.push(bag);
  }
  const date = input.date ?? businessDate;
  const corp = bankStoreId(books.state);
  const label = `${store!.code} ${businessDate}`;
  let txn: Transaction | undefined;
  if (stage === 'count') {
    const pos = posExpectedCash(books.state, storeId, businessDate);
    const diff = pos === null ? 0 : amount - pos;
    if (diff !== 0) {
      txn = post(books, actor, date, `Cash count variance ${label}`, diff < 0
        ? [{ accountId: ACCT.overShort, storeId, debit: -diff, credit: 0, memo: `Counted ${formatMoney(amount)} vs POS ${formatMoney(pos!)}` }, { accountId: ACCT.registers, storeId, debit: 0, credit: -diff }]
        : [{ accountId: ACCT.registers, storeId, debit: diff, credit: 0 }, { accountId: ACCT.overShort, storeId, debit: 0, credit: diff, memo: `Counted ${formatMoney(amount)} vs POS ${formatMoney(pos!)}` }], ['count']);
    }
  } else if (stage === 'pickup') {
    const count = event(bag, 'count')!.amount;
    const diff = amount - count;
    const lines: DraftLine[] = [{ accountId: ACCT.pool, storeId: corp, debit: amount, credit: 0, memo: `Picked up by ${input.person.trim()}` }, { accountId: ACCT.registers, storeId, debit: 0, credit: count }];
    if (diff < 0) lines.push({ accountId: ACCT.overShort, storeId, debit: -diff, credit: 0, memo: 'Pickup short of count' });
    if (diff > 0) lines.push({ accountId: ACCT.overShort, storeId, debit: 0, credit: diff, memo: 'Pickup over count' });
    if (amount > 0 || count > 0) txn = post(books, actor, date, `Cash pickup ${label}`, lines, ['pickup']);
  } else {
    const picked = event(bag, 'pickup')!.amount;
    const diff = amount - picked;
    if (diff !== 0) {
      txn = post(books, actor, date, `HQ receipt variance ${label}`, diff < 0
        ? [{ accountId: ACCT.overShort, storeId, debit: -diff, credit: 0, memo: `HQ counted ${formatMoney(amount)} vs pickup ${formatMoney(picked)}` }, { accountId: ACCT.pool, storeId: corp, debit: 0, credit: -diff }]
        : [{ accountId: ACCT.pool, storeId: corp, debit: diff, credit: 0 }, { accountId: ACCT.overShort, storeId, debit: 0, credit: diff, memo: `HQ counted ${formatMoney(amount)} vs pickup ${formatMoney(picked)}` }], ['receipt']);
    }
  }
  const ev: CashEvent = { id: books.nextId('ce'), stage, amount, person: input.person.trim(), at: date + books.clock().slice(10), note: input.note?.trim() || undefined, txnId: txn?.id };
  bag.events.push(ev);
  books.audit(actor, { action: stage, objectType: 'cash', objectId: bag.id, summary: `${STAGE_LABEL[stage]} ${label}: ${formatMoney(amount, { dollarSign: true })} by ${ev.person}`, after: ev });
  books.changed();
  return bag;
}

/** Pooled deposit of received bags: HQ pool → bank. The slip amount may be less than the pool (cash kept for payouts). */
export function depositBags(books: Books, actor: User, input: { bagIds: ID[]; date: string; amount: number; person: string; bankAccountId?: ID; slipNo?: string }): Transaction {
  books.require(actor, 'cash.handle', 'record deposits');
  const bags = input.bagIds.map((id) => books.state.cash.bags.find((b) => b.id === id)).filter((b): b is CashBag => !!b);
  const errs: string[] = [];
  if (!bags.length) errs.push('Pick at least one received bag to deposit.');
  if (bags.some((b) => !event(b, 'hq_receipt'))) errs.push('Only bags received at HQ can be deposited.');
  if (bags.some((b) => event(b, 'deposit'))) errs.push('One of these bags is already deposited.');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) errs.push('Enter the deposit slip total.');
  if (!input.person.trim()) errs.push('Say who made the deposit.');
  const pool = poolBalance(books.state, input.date);
  if (input.amount > pool) errs.push(`The slip (${formatMoney(input.amount, { dollarSign: true })}) is more than the cash at HQ (${formatMoney(pool, { dollarSign: true })}). Record the receipts first.`);
  if (errs.length) throw new ValidationError(errs);
  const corp = bankStoreId(books.state);
  const bank = input.bankAccountId ?? 'acct_trustmark';
  const t = books.createTransaction(actor, {
    date: input.date, kind: 'transfer', description: 'DEPOSIT', docNo: input.slipNo, memo: `Pooled store cash: ${bags.map((b) => `${books.store(b.storeId)?.code} ${b.businessDate}`).join(', ')}`,
    tags: ['cash', 'deposit'], lines: [{ accountId: bank, storeId: corp, debit: input.amount, credit: 0 }, { accountId: ACCT.pool, storeId: corp, debit: 0, credit: input.amount }],
  });
  for (const b of bags) b.events.push({ id: books.nextId('ce'), stage: 'deposit', amount: event(b, 'hq_receipt')!.amount, person: input.person.trim(), at: input.date + books.clock().slice(10), txnId: t.id, note: input.slipNo ? `Slip ${input.slipNo}` : undefined });
  books.audit(actor, { action: 'deposit', objectType: 'cash', objectId: t.id, summary: `Deposited ${formatMoney(input.amount, { dollarSign: true })} from ${bags.length} bag${bags.length === 1 ? '' : 's'}` });
  books.changed();
  return t;
}

/** Cash paid out of a store's registers or the HQ pool: payroll, vendors, change, owner draws. */
export function recordPayout(books: Books, actor: User, input: { date: string; fromStoreId: ID; kind: PayoutKind; payee: string; amount: number; person: string; accountId?: ID; storeId?: ID; toStoreId?: ID; partyId?: ID }): CashPayout {
  books.require(actor, 'cash.handle', 'record cash payouts');
  const errs: string[] = [];
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) errs.push('Enter the amount paid out.');
  if (!input.payee.trim()) errs.push('Say who was paid.');
  if (!input.person.trim()) errs.push('Say who handed out the cash.');
  if (input.kind === 'change' && !input.toStoreId) errs.push('Choose which store gets the change.');
  if (input.kind !== 'change' && input.kind !== 'draw' && !input.accountId) errs.push('Choose what the cash paid for.');
  if (errs.length) throw new ValidationError(errs);
  const corp = bankStoreId(books.state);
  const fromAcct = input.fromStoreId === corp ? ACCT.pool : ACCT.registers;
  const s = books.state.settings;
  let lines: DraftLine[];
  let kind: 'money_out' | 'transfer' = 'money_out';
  if (input.kind === 'change') {
    kind = 'transfer';
    lines = [{ accountId: ACCT.registers, storeId: input.toStoreId!, debit: input.amount, credit: 0, memo: 'Change fund' }];
  } else if (input.kind === 'draw') {
    const acct = s.ownerWithdrawalPolicy === 'draw' ? 'acct_owner_draws' : s.ownerWithdrawalExpenseAccountId ?? 'acct_misc';
    if (s.ownerWithdrawalPolicy === 'draw') kind = 'transfer';
    lines = [{ accountId: acct, storeId: corp, debit: input.amount, credit: 0, memo: 'Owner withdrawal (cash)', partyId: input.partyId }];
  } else {
    lines = [{ accountId: input.accountId!, storeId: input.storeId ?? input.fromStoreId, debit: input.amount, credit: 0, partyId: input.partyId }];
  }
  lines.push({ accountId: fromAcct, storeId: input.fromStoreId, debit: 0, credit: input.amount, memo: `Paid by ${input.person.trim()}` });
  const t = books.createTransaction(actor, { date: input.date, kind, description: `Cash ${PAYOUT_LABEL[input.kind].toLowerCase()} – ${input.payee.trim()}`, partyId: input.partyId, tags: ['cash', 'payout', input.kind], lines });
  const p: CashPayout = { id: books.nextId('po'), date: input.date, fromStoreId: input.fromStoreId, kind: input.kind, payee: input.payee.trim(), amount: input.amount, person: input.person.trim(), txnId: t.id };
  books.state.cash.payouts.push(p);
  books.audit(actor, { action: 'payout', objectType: 'cash', objectId: p.id, summary: `Cash ${PAYOUT_LABEL[input.kind].toLowerCase()} ${formatMoney(input.amount, { dollarSign: true })} to ${p.payee}`, after: p });
  books.changed();
  return p;
}

/** Cash held at HQ (received, not deposited, net of payouts) as of a date. */
export function poolBalance(state: BooksState, asOf: string): number {
  let n = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf) continue;
    for (const l of t.lines) if (l.accountId === ACCT.pool) n += l.debit - l.credit;
  }
  return n;
}

/** Running cash on hand per location: each store's registers, plus the HQ pool. */
export function cashByLocation(state: BooksState, asOf: string): { storeId: ID; registers: number; pool: number }[] {
  const m = new Map<ID, { registers: number; pool: number }>();
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf) continue;
    for (const l of t.lines) {
      if (l.accountId !== ACCT.registers && l.accountId !== ACCT.pool) continue;
      const r = m.get(l.storeId) ?? { registers: 0, pool: 0 };
      if (l.accountId === ACCT.registers) r.registers += l.debit - l.credit;
      else r.pool += l.debit - l.credit;
      m.set(l.storeId, r);
    }
  }
  return [...m].map(([storeId, v]) => ({ storeId, ...v }));
}

export function bagsBetween(state: BooksState, from: string, to: string): CashBag[] {
  return state.cash.bags.filter((b) => b.businessDate >= from && b.businessDate <= to);
}

export const weekAgo = (d: string) => addDays(d, -7);

/** Sign off a flagged variance after looking into it. The note is kept in the audit log. */
export function reviewBag(books: Books, actor: User, bagId: ID, note: string): void {
  books.require(actor, 'cash.handle', 'sign off cash variances');
  if (!note.trim()) throw new ValidationError(['Say what you found, e.g. "Short $20 at pickup; operator recounted, cashier error".']);
  const bag = books.state.cash.bags.find((b) => b.id === bagId);
  if (!bag) return;
  bag.reviewed = { by: actor.id, at: books.clock(), note: note.trim() };
  books.audit(actor, { action: 'review', objectType: 'cash', objectId: bag.id, summary: `Reviewed cash variance ${books.store(bag.storeId)?.code} ${bag.businessDate}`, reason: note.trim() });
  books.changed();
}
