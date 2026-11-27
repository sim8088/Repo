import type { Books } from './books';
import { ValidationError } from './books';
import type { Account, BooksState, ID, IntercompanyState, Line, Party, PartyType, RentTemplate, Transaction, User } from './types';
import type { Cents } from './money';
import { SYS, type DraftLine } from './ledger';
import { addDays, daysBetween, isValidDate, lastDayOfPeriod, periodOf, periodsBetween } from './dates';
import { formatMoney } from './money';
import { bankStoreId } from './bank';
import { fiscalYearStart, trialBalance } from './reports';
import { tenantMovements } from './receivables';

/** Party types that carry a running due-to / due-from ledger. */
export const IC_PARTY_TYPES: PartyType[] = ['related_company', 'owner', 'tenant', 'lender'];
export const PARTY_TYPE_LABEL: Record<PartyType, string> = {
  related_company: 'Related company', owner: 'Owner', tenant: 'Tenant', lender: 'Lender', vendor: 'Vendor', customer: 'Customer',
};

export const IC_ACCT = { loans: 'acct_loans_related', paidFor: 'acct_paid_for_related', dueTo: 'acct_due_related', bank: 'acct_trustmark' } as const;

export function icState(state: BooksState): IntercompanyState {
  return state.intercompany ?? { limits: {}, rentTemplates: [] };
}

/** Balance-sheet accounts a party ledger reads: intercompany (not the automatic entity lines), loans and receivables. */
export function partyAccounts(state: BooksState): Set<ID> {
  return new Set(state.accounts.filter((a) => (a.subtype === 'intercompany' && !a.system) || a.subtype === 'loan' || a.subtype === 'receivable').map((a) => a.id));
}

// ── Ledgers ──────────────────────────────────────────────────────────────
export interface PartyMovement {
  date: string;
  txnId?: ID;
  ref?: string;
  description: string;
  accountId?: ID;
  /** Money out: loans made, bills paid for them, rent charged. Raises what they owe us. */
  out: Cents;
  /** Money in: repayments, reimbursements, bills they paid for us. */
  in: Cents;
  /** Running balance after this line: + they owe us, − we owe them. */
  balance: Cents;
  /** Not a ledger posting (a scheduled rent charge on the cash basis). */
  memoOnly?: boolean;
}

export const AGING_LABELS = ['0–30 days', '31–60', '61–90', '91–120', 'Over 120'] as const;

export interface PartyLedger {
  id: ID;
  kind: 'party' | 'entity';
  name: string;
  typeLabel: string;
  opening: Cents;
  movements: PartyMovement[];
  totalOut: Cents;
  totalIn: Cents;
  /** + they owe us, − we owe them. */
  balance: Cents;
  /** The open balance by age of the items that make it up (oldest paid first). */
  aging: Cents[];
  limit?: Cents;
  overLimit: boolean;
  lastDate?: string;
}

/** Age an open balance first-in, first-out: payments settle the oldest items. Buckets follow AGING_LABELS. */
export function fifoAging(moves: { date: string; amount: Cents }[], asOf: string): Cents[] {
  const net = moves.reduce((a, m) => a + m.amount, 0);
  const buckets = [0, 0, 0, 0, 0];
  if (net === 0) return buckets;
  const sign = net > 0 ? 1 : -1;
  // Items in the direction of the balance, newest first; the newest ones make up what is still open.
  let left = Math.abs(net);
  const items = moves.filter((m) => Math.sign(m.amount) === sign).sort((a, b) => b.date.localeCompare(a.date));
  for (const m of items) {
    if (left <= 0) break;
    const take = Math.min(left, Math.abs(m.amount));
    left -= take;
    const age = daysBetween(m.date, asOf);
    const i = age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : age <= 120 ? 3 : 4;
    buckets[i] += sign * take;
  }
  if (left > 0) buckets[4] += sign * left;
  return buckets;
}

function finish(base: Omit<PartyLedger, 'movements' | 'totalOut' | 'totalIn' | 'balance' | 'aging' | 'overLimit' | 'opening' | 'lastDate'>, raw: Omit<PartyMovement, 'balance'>[], opts: { from?: string; to: string }): PartyLedger {
  raw.sort((a, b) => a.date.localeCompare(b.date) || (a.ref ?? '').localeCompare(b.ref ?? ''));
  const upto = raw.filter((m) => m.date <= opts.to);
  let opening = 0;
  let bal = 0;
  const movements: PartyMovement[] = [];
  for (const m of upto) {
    bal += m.out - m.in;
    if (opts.from && m.date < opts.from) { opening = bal; continue; }
    movements.push({ ...m, balance: bal });
  }
  const aging = fifoAging(upto.map((m) => ({ date: m.date, amount: m.out - m.in })), opts.to);
  return {
    ...base, opening, movements, balance: bal, aging,
    totalOut: movements.reduce((a, m) => a + m.out, 0), totalIn: movements.reduce((a, m) => a + m.in, 0),
    overLimit: base.limit !== undefined && Math.abs(bal) > base.limit, lastDate: upto.at(-1)?.date,
  };
}

/** Ledger lines that belong to a party: on a party account and tagged with it (on the line, or on the transaction). */
function partyLines(state: BooksState, partyId: ID): { t: Transaction; l: Line }[] {
  const accts = partyAccounts(state);
  const out: { t: Transaction; l: Line }[] = [];
  for (const t of state.transactions) {
    if (t.deleted) continue;
    for (const l of t.lines) if (accts.has(l.accountId) && !l.system && (l.partyId ?? t.partyId) === partyId) out.push({ t, l });
  }
  return out;
}

/** The running due-to / due-from ledger with one related party, owner, tenant or lender. */
export function partyLedger(state: BooksState, partyId: ID, opts: { from?: string; to: string }): PartyLedger {
  const p = state.parties.find((x) => x.id === partyId);
  if (!p) throw new Error('Unknown party');
  const raw: Omit<PartyMovement, 'balance'>[] = partyLines(state, partyId).map(({ t, l }) => ({
    date: t.date, txnId: t.id, ref: t.ref, description: l.memo ? `${t.description} · ${l.memo}` : t.description, accountId: l.accountId,
    out: l.debit, in: l.credit,
  }));
  if (p.type === 'tenant') raw.push(...tenantMovements(state, partyId, opts.to));
  return finish({ id: p.id, kind: 'party', name: p.name, typeLabel: PARTY_TYPE_LABEL[p.type], limit: icState(state).limits[p.id] }, raw, opts);
}

function hubEntityId(state: BooksState): ID | undefined {
  return state.entities.find((e) => e.isHub && !e.deleted)?.id;
}

/** Corporate's position with one store entity, from the automatic due-to / due-from lines on Corporate's side. */
export function entityLedger(state: BooksState, entityId: ID, opts: { from?: string; to: string }): PartyLedger {
  const e = state.entities.find((x) => x.id === entityId);
  if (!e) throw new Error('Unknown entity');
  const hub = hubEntityId(state);
  const entOf = new Map(state.stores.map((s) => [s.id, s.entityId]));
  const raw: Omit<PartyMovement, 'balance'>[] = [];
  for (const t of state.transactions) {
    if (t.deleted) continue;
    for (const l of t.lines) {
      if (l.system !== 'intercompany' || l.counterEntityId !== entityId || entOf.get(l.storeId) !== hub) continue;
      raw.push({ date: t.date, txnId: t.id, ref: t.ref, description: t.description, accountId: l.accountId, out: l.debit, in: l.credit });
    }
  }
  return finish({ id: e.id, kind: 'entity', name: `${e.code} · ${e.name}`, typeLabel: 'Group entity', limit: icState(state).limits[e.id] }, raw, opts);
}

export function counterpartyLedger(state: BooksState, id: ID, opts: { from?: string; to: string }): PartyLedger {
  return state.entities.some((e) => e.id === id) ? entityLedger(state, id, opts) : partyLedger(state, id, opts);
}

/** Every related party, owner, tenant and lender, plus each store entity's position with Corporate. */
export function icSummary(state: BooksState, asOf: string): { parties: PartyLedger[]; entities: PartyLedger[] } {
  const parties = state.parties.filter((p) => !p.deleted && IC_PARTY_TYPES.includes(p.type)).map((p) => partyLedger(state, p.id, { to: asOf }));
  const hub = hubEntityId(state);
  const entities = state.entities.filter((e) => !e.deleted && e.id !== hub).map((e) => entityLedger(state, e.id, { to: asOf }));
  return { parties, entities };
}

/** Parties (and entities) whose balance is above their limit. */
export function overLimit(state: BooksState, asOf: string): PartyLedger[] {
  const lim = icState(state).limits;
  if (!Object.keys(lim).length) return [];
  const { parties, entities } = icSummary(state, asOf);
  return [...parties, ...entities].filter((p) => p.overLimit);
}

/** Independent check: the party ledgers on each party account add up to that account's party-tagged balance. */
export function partyAccountTotals(state: BooksState, asOf: string): { accountId: ID; ledger: Cents; parties: Cents; untagged: Cents }[] {
  const accts = partyAccounts(state);
  const icParties = new Set(state.parties.filter((p) => IC_PARTY_TYPES.includes(p.type)).map((p) => p.id));
  const m = new Map<ID, { ledger: Cents; parties: Cents; untagged: Cents }>();
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf) continue;
    for (const l of t.lines) {
      if (!accts.has(l.accountId) || l.system) continue;
      const r = m.get(l.accountId) ?? { ledger: 0, parties: 0, untagged: 0 };
      const v = l.debit - l.credit;
      r.ledger += v;
      const pid = l.partyId ?? t.partyId;
      if (pid && icParties.has(pid)) r.parties += v; else r.untagged += v;
      m.set(l.accountId, r);
    }
  }
  return [...m].map(([accountId, r]) => ({ accountId, ...r }));
}

// ── Owner draws ──────────────────────────────────────────────────────────
export interface DrawRow {
  t: Transaction;
  l: Line;
  ownerId?: ID;
  amount: Cents;
  /** Booked as an equity draw, or as an expense under the current policy. */
  via: 'draw' | 'expense';
}

/**
 * Owner withdrawals, wherever the policy booked them: lines on a draws account, or lines on the
 * owner-withdrawal expense account (Corporate · Miscellaneous) that name an owner.
 */
export function ownerDraws(state: BooksState, opts: { from: string; to: string }): { rows: DrawRow[]; byOwner: Map<ID, Cents>; total: Cents } {
  const owners = new Set(state.parties.filter((p) => p.type === 'owner').map((p) => p.id));
  const drawAccts = new Set(state.accounts.filter((a) => a.subtype === 'draws').map((a) => a.id));
  const expAcct = state.settings.ownerWithdrawalExpenseAccountId ?? 'acct_misc';
  const rows: DrawRow[] = [];
  for (const t of state.transactions) {
    if (t.deleted || t.date < opts.from || t.date > opts.to) continue;
    for (const l of t.lines) {
      const pid = l.partyId ?? t.partyId;
      const ownerId = pid && owners.has(pid) ? pid : undefined;
      if (drawAccts.has(l.accountId)) rows.push({ t, l, ownerId, amount: l.debit - l.credit, via: 'draw' });
      else if (l.accountId === expAcct && (ownerId || t.tags.includes('draw'))) rows.push({ t, l, ownerId, amount: l.debit - l.credit, via: 'expense' });
    }
  }
  rows.sort((a, b) => a.t.date.localeCompare(b.t.date));
  const byOwner = new Map<ID, Cents>();
  for (const r of rows) byOwner.set(r.ownerId ?? '', (byOwner.get(r.ownerId ?? '') ?? 0) + r.amount);
  return { rows, byOwner, total: rows.reduce((a, r) => a + r.amount, 0) };
}

export function drawsYtd(state: BooksState, asOf: string) {
  return ownerDraws(state, { from: fiscalYearStart(asOf, state.settings.fiscalYearStartMonth), to: asOf });
}

// ── Elimination view ─────────────────────────────────────────────────────
export interface PairCheck {
  a: ID;
  b: ID;
  /** A's net receivable from B (+) on A's own books. */
  aSide: Cents;
  bSide: Cents;
  net: Cents;
}
export interface EliminationRow {
  account: Account;
  /** All entities added together, natural sign. */
  combined: Cents;
  elimination: Cents;
  consolidated: Cents;
}
export interface Elimination {
  asOf: string;
  pairs: PairCheck[];
  dueFrom: Cents;
  dueTo: Cents;
  rows: EliminationRow[];
  netIncome: Cents;
  /** Debits − credits after eliminating; must be zero. */
  consolidatedDifference: Cents;
  /** Sum of the elimination column in debit/credit terms; must be zero. */
  eliminationNet: Cents;
  ok: boolean;
}

/** The consolidated balance sheet with the automatic entity due-to / due-from lines netted out. Related parties outside the group stay. */
export function eliminations(state: BooksState, asOf: string): Elimination {
  const entOf = new Map(state.stores.map((s) => [s.id, s.entityId]));
  const pos = new Map<string, Cents>();
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf) continue;
    for (const l of t.lines) {
      if (l.system !== 'intercompany' || !l.counterEntityId) continue;
      const k = `${entOf.get(l.storeId)}|${l.counterEntityId}`;
      pos.set(k, (pos.get(k) ?? 0) + l.debit - l.credit);
    }
  }
  const pairs: PairCheck[] = [];
  const seen = new Set<string>();
  for (const k of pos.keys()) {
    const [a, b] = k.split('|');
    const key = [a, b].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const aSide = pos.get(`${a}|${b}`) ?? 0;
    const bSide = pos.get(`${b}|${a}`) ?? 0;
    pairs.push({ a, b, aSide, bSide, net: aSide + bSide });
  }
  const tb = trialBalance(state, { asOf });
  const elim = new Set<ID>([SYS.dueFrom, SYS.dueTo]);
  const sign = (a: Account) => (a.type === 'asset' ? 1 : -1);
  const rows: EliminationRow[] = [];
  let consolidatedNet = 0;
  let eliminationNet = 0;
  for (const r of tb.rows) {
    const a = r.account;
    if (!['asset', 'liability', 'equity'].includes(a.type)) { consolidatedNet += r.net; continue; }
    const e = elim.has(a.id) ? -r.net : 0;
    eliminationNet += e;
    consolidatedNet += r.net + e;
    rows.push({ account: a, combined: sign(a) * r.net, elimination: sign(a) * e, consolidated: sign(a) * (r.net + e) });
  }
  const dueFrom = rows.find((r) => r.account.id === SYS.dueFrom)?.combined ?? 0;
  const dueTo = rows.find((r) => r.account.id === SYS.dueTo)?.combined ?? 0;
  return {
    asOf, pairs, dueFrom, dueTo, rows, netIncome: tb.netIncome, consolidatedDifference: consolidatedNet, eliminationNet,
    ok: eliminationNet === 0 && consolidatedNet === 0 && dueFrom === dueTo && pairs.every((p) => p.net === 0),
  };
}

// ── Entry flows ──────────────────────────────────────────────────────────
export type PartyMoveKind = 'paid_bill' | 'loan_out' | 'repayment' | 'reimbursed_them' | 'they_paid_for_us';
export const MOVE_LABEL: Record<PartyMoveKind, string> = {
  paid_bill: 'We paid a bill for them',
  loan_out: 'We lent them money',
  repayment: 'They paid us back',
  reimbursed_them: 'We paid them back',
  they_paid_for_us: 'They paid a bill for us',
};

export interface PartyMoveInput {
  partyId: ID;
  kind: PartyMoveKind;
  date: string;
  amount: Cents;
  /** Who the bill was owed to (paid_bill, they_paid_for_us). */
  payee?: string;
  checkNo?: string;
  memo?: string;
  /** repayment: which receivable it settles (defaults to bills paid for them while that has a balance). */
  settles?: 'paidFor' | 'loans';
  /** they_paid_for_us: the expense and store it covered. */
  expenseAccountId?: ID;
  storeId?: ID;
  bankAccountId?: ID;
}

/**
 * Post one movement with a related party. Paying another business's bill from the shared account
 * posts to that party's receivable (1920), never to store expenses.
 */
export function recordPartyMovement(books: Books, actor: User, input: PartyMoveInput): Transaction {
  books.require(actor, 'txn.create', 'record intercompany movements');
  books.require(actor, 'view.all_stores', 'record intercompany movements');
  const state = books.state;
  const p = state.parties.find((x) => x.id === input.partyId && !x.deleted);
  const errs: string[] = [];
  if (!p) errs.push('Choose the related party.');
  else if (!IC_PARTY_TYPES.includes(p.type)) errs.push(`${p.name} is a ${PARTY_TYPE_LABEL[p.type].toLowerCase()}. Change its type in Setup › Vendors & parties, or record a normal bill.`);
  if (!isValidDate(input.date)) errs.push('Enter the date as YYYY-MM-DD.');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) errs.push('Enter the amount.');
  if ((input.kind === 'paid_bill' || input.kind === 'they_paid_for_us') && !input.payee?.trim()) errs.push('Say whose bill it was (the vendor paid).');
  if (input.kind === 'they_paid_for_us' && (!input.expenseAccountId || !input.storeId)) errs.push('Pick the expense and the store the bill was for.');
  if (errs.length) throw new ValidationError(errs);
  const corp = bankStoreId(state);
  const bank = input.bankAccountId ?? IC_ACCT.bank;
  const a = input.amount;
  const name = p!.name;
  const memo = input.memo?.trim();
  const line = (accountId: ID, debit: Cents, credit: Cents, extra: Partial<DraftLine> = {}): DraftLine => ({ accountId, storeId: corp, debit, credit, ...extra });
  let d: { kind: 'money_out' | 'money_in' | 'journal'; description: string; lines: DraftLine[] };
  switch (input.kind) {
    case 'paid_bill':
      d = { kind: 'money_out', description: `Paid ${input.payee!.trim()} for ${name}`, lines: [line(IC_ACCT.paidFor, a, 0, { partyId: p!.id, memo: memo || `Bill paid on behalf of ${name}` }), line(bank, 0, a)] };
      break;
    case 'loan_out':
      d = { kind: 'money_out', description: `Loan to ${name}`, lines: [line(IC_ACCT.loans, a, 0, { partyId: p!.id, memo: memo || `Loan to ${name}` }), line(bank, 0, a)] };
      break;
    case 'repayment': {
      const paidForBal = partyLines(state, p!.id).filter((x) => x.l.accountId === IC_ACCT.paidFor).reduce((s, x) => s + x.l.debit - x.l.credit, 0);
      const acct = input.settles === 'loans' ? IC_ACCT.loans : input.settles === 'paidFor' ? IC_ACCT.paidFor : paidForBal > 0 ? IC_ACCT.paidFor : IC_ACCT.loans;
      d = { kind: 'money_in', description: `Repayment from ${name}`, lines: [line(bank, a, 0), line(acct, 0, a, { partyId: p!.id, memo: memo || `Repayment from ${name}` })] };
      break;
    }
    case 'reimbursed_them':
      d = { kind: 'money_out', description: `Reimbursed ${name}`, lines: [line(IC_ACCT.dueTo, a, 0, { partyId: p!.id, memo: memo || `Paid back ${name}` }), line(bank, 0, a)] };
      break;
    case 'they_paid_for_us':
      d = { kind: 'journal', description: `${name} paid ${input.payee!.trim()} for us`, lines: [
        { accountId: input.expenseAccountId!, storeId: input.storeId!, debit: a, credit: 0, memo: memo || `Paid by ${name}` }, line(IC_ACCT.dueTo, 0, a, { partyId: p!.id, memo: `Owed to ${name}` })] };
      break;
  }
  if (d.kind === 'journal') books.require(actor, 'journal.create', 'post journal entries');
  const t = books.createTransaction(actor, { date: input.date, kind: d.kind, description: d.description, memo, partyId: p!.id, checkNo: input.checkNo, tags: ['intercompany'], lines: d.lines });
  books.audit(actor, { action: input.kind, objectType: 'intercompany', objectId: p!.id, summary: `${MOVE_LABEL[input.kind]}: ${name} ${formatMoney(a, { dollarSign: true })} (${t.ref})` });
  books.changed();
  return t;
}

export function setPartyLimit(books: Books, actor: User, id: ID, limit: Cents | null): void {
  books.require(actor, 'setup.edit', 'set intercompany limits');
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) throw new ValidationError(['Enter the limit in dollars, or leave it blank for no limit.']);
  if (!books.state.intercompany) books.state.intercompany = { limits: {}, rentTemplates: [] };
  const lim = books.state.intercompany.limits;
  const before = lim[id];
  if (limit === null) delete lim[id]; else lim[id] = limit;
  const name = books.state.parties.find((p) => p.id === id)?.name ?? books.state.entities.find((e) => e.id === id)?.code ?? id;
  books.audit(actor, { action: 'limit', objectType: 'intercompany', objectId: id, summary: limit === null ? `Removed the intercompany limit for ${name}` : `Set the intercompany limit for ${name} to ${formatMoney(limit, { dollarSign: true })}`, before, after: limit });
  books.changed();
}

// ── Rent pass-through templates ──────────────────────────────────────────
export function rentDescription(state: BooksState, t: RentTemplate): string {
  const code = state.stores.find((s) => s.id === t.storeId)?.code ?? t.storeId;
  const party = state.parties.find((p) => p.id === t.partyId)?.name ?? t.partyId;
  return `Rent pass-through ${code} via ${party}`;
}

export function rentDate(t: RentTemplate, period: string): string {
  const last = Number(lastDayOfPeriod(period).slice(8, 10));
  return `${period}-${String(Math.min(t.dayOfMonth, last)).padStart(2, '0')}`;
}

function generatedTxn(state: BooksState, t: RentTemplate, period: string): Transaction | undefined {
  const id = t.generated[period];
  const tx = id ? state.transactions.find((x) => x.id === id) : undefined;
  return tx && !tx.deleted ? tx : undefined;
}

/** Template runs due through `through` (YYYY-MM-DD) that have not been generated yet. */
export function rentDue(state: BooksState, through: string): { template: RentTemplate; period: string; date: string }[] {
  const out: { template: RentTemplate; period: string; date: string }[] = [];
  for (const t of icState(state).rentTemplates) {
    if (!t.active) continue;
    const end = t.endPeriod && t.endPeriod < periodOf(through) ? t.endPeriod : periodOf(through);
    for (const p of periodsBetween(t.startPeriod, end)) {
      const date = rentDate(t, p);
      if (date <= through && !generatedTxn(state, t, p)) out.push({ template: t, period: p, date });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function nextRentRun(state: BooksState, t: RentTemplate, today: string): string | null {
  if (!t.active) return null;
  for (let p = t.startPeriod; !t.endPeriod || p <= t.endPeriod; p = periodOf(addDays(lastDayOfPeriod(p), 1))) {
    if (!generatedTxn(state, t, p)) return rentDate(t, p);
    if (p > periodOf(addDays(today, 400))) return null;
  }
  return null;
}

/**
 * Generate one month's rent pass-throughs: store rent expense against Corporate's payable to the
 * related party. Idempotent: a template that already generated the month is skipped.
 */
export function generateRent(books: Books, actor: User, period: string, templateIds?: ID[]): Transaction[] {
  books.require(actor, 'journal.create', 'generate rent pass-throughs');
  if (!/^\d{4}-\d{2}$/.test(period)) throw new ValidationError(['Pick the month to generate, as YYYY-MM.']);
  const state = books.state;
  const corp = bankStoreId(state);
  const out: Transaction[] = [];
  for (const t of icState(state).rentTemplates) {
    if (!t.active || (templateIds && !templateIds.includes(t.id))) continue;
    if (period < t.startPeriod || (t.endPeriod && period > t.endPeriod) || generatedTxn(state, t, period)) continue;
    const tx = books.createTransaction(actor, {
      date: rentDate(t, period), kind: 'journal', description: rentDescription(state, t), partyId: t.partyId, tags: ['rent', 'intercompany'],
      lines: [
        { accountId: t.expenseAccountId, storeId: t.storeId, debit: t.amount, credit: 0, memo: 'Mortgage paid by related party' },
        { accountId: t.payableAccountId, storeId: corp, debit: 0, credit: t.amount, memo: 'Reimburse through Corporate', partyId: t.partyId },
      ],
    });
    t.generated[period] = tx.id;
    out.push(tx);
  }
  if (out.length) {
    books.audit(actor, { action: 'generate', objectType: 'intercompany', objectId: period, summary: `Generated ${out.length} rent pass-through${out.length === 1 ? '' : 's'} for ${period}` });
    books.changed();
  }
  return out;
}

export function saveRentTemplate(books: Books, actor: User, t: RentTemplate): RentTemplate {
  books.require(actor, 'setup.edit', 'change rent pass-through templates');
  const state = books.state;
  const errs: string[] = [];
  if (!state.stores.some((s) => s.id === t.storeId && !s.deleted)) errs.push('Choose the store that books the rent.');
  const p = state.parties.find((x) => x.id === t.partyId);
  if (!p || p.type !== 'related_company') errs.push('Choose the related company that pays the mortgage.');
  if (!Number.isSafeInteger(t.amount) || t.amount <= 0) errs.push('Enter the monthly amount.');
  if (!(t.dayOfMonth >= 1 && t.dayOfMonth <= 28)) errs.push('Pick a day of the month from 1 to 28.');
  if (!/^\d{4}-\d{2}$/.test(t.startPeriod)) errs.push('Pick the first month, as YYYY-MM.');
  if (t.endPeriod && t.endPeriod < t.startPeriod) errs.push('The last month must be after the first.');
  if (errs.length) throw new ValidationError(errs);
  if (!state.intercompany) state.intercompany = { limits: {}, rentTemplates: [] };
  const list = state.intercompany.rentTemplates;
  const i = list.findIndex((x) => x.id === t.id);
  const before = i >= 0 ? structuredClone(list[i]) : undefined;
  if (i >= 0) list[i] = t; else list.push(t);
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'intercompany', objectId: t.id, summary: `${before ? 'Updated' : 'Added'} rent pass-through template ${rentDescription(state, t)}`, before, after: structuredClone(t) });
  books.changed();
  return t;
}

export function partyName(state: BooksState, id?: ID): string {
  if (!id) return '';
  return state.parties.find((p: Party) => p.id === id)?.name ?? state.entities.find((e) => e.id === id)?.code ?? id;
}
