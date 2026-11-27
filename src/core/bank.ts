import type { Books } from './books';
import { ValidationError } from './books';
import type { BankLine, BooksState, DepositSource, ID, ImportBatch, Line, Reconciliation, Transaction, User } from './types';
import { lineHashes, type ParsedLine } from './bankio';
import { addDays, daysBetween } from './dates';
import { formatMoney } from './money';
import { suggest } from './rules';

export const DEPOSIT_SOURCE_LABEL: Record<DepositSource, string> = {
  store_cash: 'Store cash',
  card_settlement: 'Card settlement (Craddock / Dash)',
  mudflap: 'Mudflap',
  fiserv: 'Fiserv / AccessOne',
  tenant_rent: 'Tenant rent',
  rebate: 'Rebate / program',
  atm: 'ATM income',
  lottery: 'Lottery',
  related_repayment: 'Loan repayment from related party',
  owner_contribution: 'Owner contribution',
  transfer: 'Transfer between accounts',
  refund: 'Refund owed to us',
  other: 'Other',
};

/** First guess at where a deposit came from, from its bank description. */
export function guessDepositSource(description: string): DepositSource | undefined {
  const d = description.toUpperCase();
  if (/MER BNKCD|FISERV|ACCESSONE/.test(d)) return 'fiserv';
  if (/MUDFLAP/.test(d)) return 'mudflap';
  if (/CRADDOCK|DASH OIL/.test(d)) return 'card_settlement';
  if (/RENT/.test(d)) return 'tenant_rent';
  if (/LOTTERY/.test(d)) return 'lottery';
  if (/\bATM\b/.test(d)) return 'atm';
  if (/REBATE|REYNOLDS|ITG|VICKSBURG|CLARK/.test(d)) return 'rebate';
  if (/SOUTHERN EAGLE|CHEERS|ROWDY|BULLSEYE|FIVE RIVERS/.test(d)) return 'related_repayment';
  if (/TRANSFER FROM|XFER FROM/.test(d)) return 'transfer';
  if (/^DEPOSIT$|^DEPOSIT \d*$|BRANCH DEPOSIT|CASH DEPOSIT/.test(d.trim())) return 'store_cash';
  return undefined;
}

/** The store that holds the shared bank accounts: the hub entity's corporate store. */
export function bankStoreId(state: BooksState): ID {
  const hub = state.entities.find((e) => e.isHub);
  return state.stores.find((s) => s.entityId === hub?.id && s.kind === 'corporate')?.id ?? state.stores[0].id;
}

// ── Indexes ──────────────────────────────────────────────────────────────
export interface BookLine {
  t: Transaction;
  l: Line;
  /** + money in, − money out, from the bank's point of view. */
  amount: number;
}

/** Live ledger lines on a bank account (opening-balance entries are covered by the statement opening). */
export function bookLines(state: BooksState, accountId: ID): BookLine[] {
  const out: BookLine[] = [];
  for (const t of state.transactions) {
    if (t.deleted || t.kind === 'opening') continue;
    for (const l of t.lines) if (l.accountId === accountId) out.push({ t, l, amount: l.debit - l.credit });
  }
  return out;
}

/** Ledger line id → bank line, counting only matches to live ledger lines. */
export function matchIndex(state: BooksState): Map<ID, BankLine> {
  const live = new Set<ID>();
  for (const t of state.transactions) if (!t.deleted) for (const l of t.lines) live.add(l.id);
  const m = new Map<ID, BankLine>();
  for (const b of state.bank.lines) for (const id of b.matchedLineIds) if (live.has(id)) m.set(id, b);
  return m;
}

export function isMatched(b: BankLine, idx: Map<ID, BankLine>): boolean {
  return b.matchedLineIds.some((id) => idx.get(id) === b);
}

export function reconciledThrough(state: BooksState, accountId: ID): string | null {
  const r = state.bank.reconciliations.filter((x) => x.accountId === accountId).map((x) => x.statementDate).sort();
  return r.at(-1) ?? null;
}

// ── Import ───────────────────────────────────────────────────────────────
export interface ImportPreview {
  rows: (ParsedLine & { hash: string; duplicate: boolean })[];
  added: number;
  skipped: number;
  totalIn: number;
  totalOut: number;
  from: string;
  to: string;
  /** Does the file's running balance hold line by line? null when the file has no balances. */
  runningBalanceTies: boolean | null;
  runningBalanceBreaks: string[];
}

export function previewImport(state: BooksState, accountId: ID, lines: ParsedLine[]): ImportPreview {
  const hashes = lineHashes(accountId, lines);
  const existing = new Set(state.bank.lines.filter((b) => b.accountId === accountId).map((b) => b.hash));
  const rows = lines.map((l, i) => ({ ...l, hash: hashes[i], duplicate: existing.has(hashes[i]) }));
  const fresh = rows.filter((r) => !r.duplicate);
  const dates = lines.map((l) => l.date).sort();
  let ties: boolean | null = null;
  const breaks: string[] = [];
  if (lines.length > 1 && lines.every((l) => l.balance !== undefined)) {
    const chrono = lines[0].date <= lines[lines.length - 1].date ? lines : [...lines].reverse();
    ties = true;
    for (let i = 1; i < chrono.length; i++) {
      if (chrono[i - 1].balance! + chrono[i].amount !== chrono[i].balance!) {
        ties = false;
        if (breaks.length < 5) breaks.push(`${chrono[i].date} ${chrono[i].description}: balance should be ${formatMoney(chrono[i - 1].balance! + chrono[i].amount)}, file says ${formatMoney(chrono[i].balance!)}`);
      }
    }
  }
  return {
    rows,
    added: fresh.length,
    skipped: rows.length - fresh.length,
    totalIn: fresh.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0),
    totalOut: fresh.filter((r) => r.amount < 0).reduce((a, r) => a - r.amount, 0),
    from: dates[0] ?? '',
    to: dates.at(-1) ?? '',
    runningBalanceTies: ties,
    runningBalanceBreaks: breaks,
  };
}

/** Store new lines (idempotent), guess deposit sources, then auto-match. */
export function commitImport(books: Books, actor: User, accountId: ID, file: { name: string; format: ImportBatch['format']; lines: ParsedLine[]; statementBalance?: number }): { batch: ImportBatch; matched: number } {
  books.require(actor, 'bank.import', 'import bank statements');
  const acct = books.account(accountId);
  if (!acct || acct.subtype !== 'bank') throw new ValidationError(['Choose a bank account to import into.']);
  const p = previewImport(books.state, accountId, file.lines);
  const batch: ImportBatch = {
    id: books.nextId('imp'), accountId, fileName: file.name, format: file.format, importedAt: books.clock(), by: actor.id,
    added: p.added, skipped: p.skipped, totalIn: p.totalIn, totalOut: p.totalOut, from: p.from, to: p.to, statementBalance: file.statementBalance,
  };
  const added: BankLine[] = [];
  for (const r of p.rows) {
    if (r.duplicate) continue;
    added.push({
      id: books.nextId('bl'), accountId, date: r.date, description: r.description, amount: r.amount, checkNo: r.checkNo, fitId: r.fitId,
      hash: r.hash, batchId: batch.id, source: r.amount > 0 ? guessDepositSource(r.description) : undefined, matchedLineIds: [],
    });
  }
  books.state.bank.lines.push(...added);
  books.state.bank.batches.push(batch);
  books.audit(actor, { action: 'import', objectType: 'bank', objectId: batch.id, summary: `Imported ${file.name}: ${p.added} new lines, ${p.skipped} already present`, after: { ...batch } });
  const matched = autoMatch(books, actor, added.map((a) => a.id));
  books.changed();
  return { batch, matched };
}

// ── Matching ─────────────────────────────────────────────────────────────
export interface Candidate {
  line: BookLine;
  score: number;
  why: string;
}

const words = (s: string) => new Set(s.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));

/** Ledger lines that could be this bank line: same account and amount, booked 7 days before to 3 days after (checks: any time before). */
export function candidates(state: BooksState, b: BankLine, idx = matchIndex(state), lines = bookLines(state, b.accountId)): Candidate[] {
  const out: Candidate[] = [];
  const bw = words(b.description);
  for (const x of lines) {
    if (x.amount !== b.amount || idx.has(x.l.id)) continue;
    const lag = daysBetween(x.t.date, b.date); // positive: bank after book
    const checkHit = !!b.checkNo && x.t.checkNo === b.checkNo;
    if (b.checkNo && x.t.checkNo && !checkHit) continue;
    if (!checkHit && (lag > 7 || lag < -3)) continue;
    if (checkHit && lag < -3) continue;
    let score = checkHit ? 100 : 50 - Math.abs(lag) * 5;
    const overlap = [...words(x.t.description)].filter((w) => bw.has(w)).length;
    score += Math.min(overlap, 3) * 8;
    out.push({ line: x, score, why: checkHit ? `Check #${b.checkNo}` : lag === 0 ? 'Same amount, same day' : `Same amount, ${Math.abs(lag)} day${Math.abs(lag) === 1 ? '' : 's'} ${lag > 0 ? 'after' : 'before'} booking` });
  }
  return out.sort((a, c) => c.score - a.score);
}

/** Match each line to its clear best candidate. Returns how many were matched. */
export function autoMatch(books: Books, actor: User, bankLineIds?: ID[]): number {
  const state = books.state;
  const idx = matchIndex(state);
  const want = bankLineIds ? new Set(bankLineIds) : null;
  const byAcct = new Map<ID, BookLine[]>();
  let n = 0;
  for (const b of state.bank.lines) {
    if ((want && !want.has(b.id)) || b.excluded || isMatched(b, idx)) continue;
    if (!byAcct.has(b.accountId)) byAcct.set(b.accountId, bookLines(state, b.accountId));
    const c = candidates(state, b, idx, byAcct.get(b.accountId));
    if (!c.length) continue;
    if (c.length > 1 && c[0].score - c[1].score < 10) continue; // ambiguous: leave for a person
    b.matchedLineIds = [c[0].line.l.id];
    idx.set(c[0].line.l.id, b);
    n++;
  }
  if (n) {
    books.audit(actor, { action: 'auto_match', objectType: 'bank', objectId: 'auto', summary: `Auto-matched ${n} bank line${n === 1 ? '' : 's'}` });
    books.changed();
  }
  return n;
}

function bankLine(books: Books, id: ID): BankLine {
  const b = books.state.bank.lines.find((x) => x.id === id);
  if (!b) throw new ValidationError(['That bank line no longer exists.']);
  return b;
}

function assertNotReconciled(books: Books, b: BankLine): void {
  const thru = reconciledThrough(books.state, b.accountId);
  if (thru && b.date <= thru) throw new ValidationError([`This line is in a reconciliation through ${thru}. Undo that reconciliation first.`]);
}

/** Manually match a bank line to one or more ledger lines whose amounts add up to it exactly. */
export function matchBankLine(books: Books, actor: User, bankLineId: ID, ledgerLineIds: ID[]): void {
  books.require(actor, 'bank.reconcile', 'match bank lines');
  const b = bankLine(books, bankLineId);
  assertNotReconciled(books, b);
  const idx = matchIndex(books.state);
  const lines = bookLines(books.state, b.accountId).filter((x) => ledgerLineIds.includes(x.l.id));
  if (lines.length !== ledgerLineIds.length) throw new ValidationError(['Pick ledger lines on the same bank account.']);
  const taken = lines.find((x) => idx.has(x.l.id) && idx.get(x.l.id) !== b);
  if (taken) throw new ValidationError([`${taken.t.ref} is already matched to another bank line. Unmatch it first.`]);
  const total = lines.reduce((a, x) => a + x.amount, 0);
  if (total !== b.amount) throw new ValidationError([`The ledger lines add up to ${formatMoney(total, { dollarSign: true })} but the bank line is ${formatMoney(b.amount, { dollarSign: true })}. Pick lines that add up exactly, or create an entry for the difference.`]);
  const before = [...b.matchedLineIds];
  b.matchedLineIds = [...ledgerLineIds];
  books.audit(actor, { action: 'match', objectType: 'bank', objectId: b.id, summary: `Matched bank line ${b.date} ${b.description} to ${lines.map((x) => x.t.ref).join(', ')}`, before, after: b.matchedLineIds });
  books.changed();
}

export function unmatchBankLine(books: Books, actor: User, bankLineId: ID): void {
  books.require(actor, 'bank.reconcile', 'unmatch bank lines');
  const b = bankLine(books, bankLineId);
  assertNotReconciled(books, b);
  const before = [...b.matchedLineIds];
  b.matchedLineIds = [];
  books.audit(actor, { action: 'unmatch', objectType: 'bank', objectId: b.id, summary: `Unmatched bank line ${b.date} ${b.description}`, before });
  books.changed();
}

export function setDepositSource(books: Books, actor: User, bankLineId: ID, source: DepositSource | undefined): void {
  books.require(actor, 'bank.reconcile', 'classify deposits');
  const b = bankLine(books, bankLineId);
  const before = b.source;
  b.source = source;
  books.audit(actor, { action: 'classify', objectType: 'bank', objectId: b.id, summary: `Deposit ${b.date} ${formatMoney(b.amount, { dollarSign: true })} classified as ${source ? DEPOSIT_SOURCE_LABEL[source] : 'unclassified'}`, before, after: source });
  books.changed();
}

export function excludeBankLine(books: Books, actor: User, bankLineId: ID, reason: string | null): void {
  books.require(actor, 'bank.reconcile', 'exclude bank lines');
  const b = bankLine(books, bankLineId);
  assertNotReconciled(books, b);
  if (reason !== null && !reason.trim()) throw new ValidationError(['Say why this line is excluded (e.g. pending item the bank later reversed).']);
  b.excluded = reason === null ? undefined : { reason: reason.trim(), by: actor.id, at: books.clock() };
  if (b.excluded) b.matchedLineIds = [];
  books.audit(actor, { action: reason === null ? 'include' : 'exclude', objectType: 'bank', objectId: b.id, summary: `${reason === null ? 'Included' : 'Excluded'} bank line ${b.date} ${b.description}`, reason: reason ?? undefined });
  books.changed();
}

/** Book a bank line nobody entered yet (a fee, a deposit) and match it in one step. Learns a rule. */
export function createFromBankLine(books: Books, actor: User, bankLineId: ID, opts: { accountId: ID; storeId: ID; partyId?: ID; source?: DepositSource; description?: string; memo?: string }): Transaction {
  const b = bankLine(books, bankLineId);
  if (isMatched(b, matchIndex(books.state))) throw new ValidationError(['This bank line is already matched.']);
  const cat = books.account(opts.accountId);
  if (!cat) throw new ValidationError(['Choose a category.']);
  const isTransfer = ['asset', 'liability', 'equity'].includes(cat.type);
  const amt = Math.abs(b.amount);
  const bankSide = { accountId: b.accountId, storeId: bankStoreId(books.state), debit: b.amount > 0 ? amt : 0, credit: b.amount < 0 ? amt : 0 };
  const other = { accountId: opts.accountId, storeId: opts.storeId, debit: b.amount < 0 ? amt : 0, credit: b.amount > 0 ? amt : 0, partyId: opts.partyId, memo: opts.memo };
  const t = books.createTransaction(actor, {
    date: b.date, kind: isTransfer && cat.subtype !== 'intercompany' && cat.subtype !== 'draws' ? 'transfer' : b.amount > 0 ? 'money_in' : 'money_out',
    description: opts.description?.trim() || b.description, partyId: opts.partyId, checkNo: b.checkNo, tags: ['bank'], lines: [bankSide, other],
  }, { source: 'import', batchId: b.batchId });
  b.matchedLineIds = [t.lines.find((l) => l.accountId === b.accountId && !l.system)!.id];
  if (opts.source) b.source = opts.source;
  books.learnRule(actor, b.description, opts.accountId, opts.storeId, opts.partyId);
  books.changed();
  return t;
}

/** Rule suggestion for a bank line (category + store), if any rule matches. */
export function suggestFor(state: BooksState, b: BankLine) {
  return suggest(state, b.description);
}

// ── Reconciliation ───────────────────────────────────────────────────────
export interface RecItem {
  date: string;
  ref?: string;
  txnId?: ID;
  description: string;
  amount: number;
  bankLineId?: ID;
  lineId?: ID;
}

export interface RecStatus {
  accountId: ID;
  date: string;
  bookBalance: number;
  /** Opening + imported bank lines through the date. */
  feedBalance: number | null;
  /** In the books, not yet on the statement: outstanding checks (−) and deposits in transit (+). */
  bookOnly: RecItem[];
  /** On the statement, not in the books yet. */
  bankOnly: RecItem[];
  /** What the statement should say if every difference is explained. */
  expectedStatement: number;
}

export function reconcileStatus(state: BooksState, accountId: ID, date: string): RecStatus {
  const idx = matchIndex(state);
  const opening = state.bank.openings[accountId];
  let bookBalance = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date > date) continue;
    for (const l of t.lines) if (l.accountId === accountId) bookBalance += l.debit - l.credit;
  }
  const bookOnly: RecItem[] = [];
  for (const x of bookLines(state, accountId)) {
    if (x.t.date > date) continue;
    const b = idx.get(x.l.id);
    if (!b || b.date > date) bookOnly.push({ date: x.t.date, ref: x.t.ref, txnId: x.t.id, description: x.t.description, amount: x.amount, lineId: x.l.id });
  }
  const dateOf = new Map<ID, string>();
  for (const t of state.transactions) if (!t.deleted) for (const l of t.lines) dateOf.set(l.id, t.date);
  const bankOnly: RecItem[] = [];
  let feed = opening ? opening.balance : null;
  for (const b of state.bank.lines) {
    if (b.accountId !== accountId || b.date > date || b.excluded) continue;
    if (opening && b.date <= opening.date) continue;
    if (feed !== null) feed += b.amount;
    const matched = b.matchedLineIds.filter((id) => idx.get(id) === b);
    if (!matched.length || matched.every((id) => (dateOf.get(id) ?? '9999') > date)) {
      bankOnly.push({ date: b.date, description: b.description, amount: b.amount, bankLineId: b.id });
    }
  }
  const sum = (xs: RecItem[]) => xs.reduce((a, x) => a + x.amount, 0);
  bookOnly.sort((a, b) => a.date.localeCompare(b.date));
  bankOnly.sort((a, b) => a.date.localeCompare(b.date));
  return { accountId, date, bookBalance, feedBalance: feed, bookOnly, bankOnly, expectedStatement: bookBalance - sum(bookOnly) + sum(bankOnly) };
}

/** Record a reconciliation. Only allowed when the statement balance is fully explained (difference $0.00). */
export function saveReconciliation(books: Books, actor: User, accountId: ID, date: string, statementBalance: number): Reconciliation {
  books.require(actor, 'bank.reconcile', 'reconcile bank accounts');
  const st = reconcileStatus(books.state, accountId, date);
  const difference = statementBalance - st.expectedStatement;
  if (difference !== 0) throw new ValidationError([`The statement is off by ${formatMoney(difference, { dollarSign: true })} after every listed item. Import missing bank lines, match or book them, then try again.`]);
  const prev = reconciledThrough(books.state, accountId);
  if (prev && date <= prev) throw new ValidationError([`This account is already reconciled through ${prev}. Pick a later statement date.`]);
  const rec: Reconciliation = {
    id: books.nextId('rec'), accountId, statementDate: date, statementBalance, bookBalance: st.bookBalance,
    bookOnly: st.bookOnly.reduce((a, x) => a + x.amount, 0), bankOnly: st.bankOnly.reduce((a, x) => a + x.amount, 0), difference: 0,
    by: actor.id, at: books.clock(), outstandingLineIds: st.bookOnly.map((x) => x.lineId!), bankOnlyIds: st.bankOnly.map((x) => x.bankLineId!),
  };
  books.state.bank.reconciliations.push(rec);
  books.audit(actor, { action: 'reconcile', objectType: 'reconciliation', objectId: rec.id, summary: `Reconciled ${books.account(accountId)?.name} through ${date} at ${formatMoney(statementBalance, { dollarSign: true })}`, after: rec });
  books.changed();
  return rec;
}

export function undoReconciliation(books: Books, actor: User, recId: ID, reason: string): void {
  books.require(actor, 'period.unlock', 'undo a reconciliation');
  if (!reason.trim()) throw new ValidationError(['Give a reason for undoing the reconciliation.']);
  const rec = books.state.bank.reconciliations.find((r) => r.id === recId);
  if (!rec) return;
  const later = books.state.bank.reconciliations.some((r) => r.accountId === rec.accountId && r.statementDate > rec.statementDate);
  if (later) throw new ValidationError(['Undo the later reconciliations first.']);
  books.state.bank.reconciliations = books.state.bank.reconciliations.filter((r) => r.id !== recId);
  books.audit(actor, { action: 'unreconcile', objectType: 'reconciliation', objectId: rec.id, summary: `Undid reconciliation through ${rec.statementDate}`, before: rec, reason });
  books.changed();
}

// ── Checks register ──────────────────────────────────────────────────────
export type CheckStatus = 'outstanding' | 'cleared' | 'stale' | 'void' | 'not_in_books';
export interface CheckRow {
  checkNo: string;
  date: string;
  payee: string;
  amount: number;
  status: CheckStatus;
  clearedOn?: string;
  txnId?: ID;
  bankLineId?: ID;
  ageDays: number;
  hasImage: boolean;
}

export function checksRegister(state: BooksState, asOf: string): CheckRow[] {
  const idx = matchIndex(state);
  const bankAccts = new Set(state.accounts.filter((a) => a.subtype === 'bank').map((a) => a.id));
  const rows: CheckRow[] = [];
  const seen = new Set<string>();
  for (const t of state.transactions) {
    if (!t.checkNo) continue;
    const l = t.lines.find((x) => bankAccts.has(x.accountId) && x.credit > 0);
    if (!l) continue;
    if (t.deleted && !/^void/i.test(t.deleted.reason)) continue; // deleted for other reasons: not a check anymore
    const party = t.partyId ? state.parties.find((p) => p.id === t.partyId)?.name : undefined;
    const b = t.deleted ? undefined : idx.get(l.id);
    const age = daysBetween(t.date, asOf);
    let status: CheckStatus = 'outstanding';
    if (t.deleted) status = 'void';
    else if (b) status = 'cleared';
    else if (age > state.settings.staleCheckDays) status = 'stale';
    seen.add(t.checkNo);
    rows.push({ checkNo: t.checkNo, date: t.date, payee: party ?? t.description, amount: l.credit, status, clearedOn: b?.date, txnId: t.id, bankLineId: b?.id, ageDays: age, hasImage: t.attachments.length > 0 });
  }
  for (const b of state.bank.lines) {
    if (!b.checkNo || seen.has(b.checkNo) || b.amount >= 0 || b.excluded) continue;
    rows.push({ checkNo: b.checkNo, date: b.date, payee: b.description, amount: -b.amount, status: 'not_in_books', clearedOn: b.date, bankLineId: b.id, ageDays: daysBetween(b.date, asOf), hasImage: false });
  }
  return rows.sort((a, b) => b.checkNo.localeCompare(a.checkNo, undefined, { numeric: true }));
}

/** Void a check: soft-deletes its transaction with a "Void" reason so it stays in the register. */
export function voidCheck(books: Books, actor: User, txnId: ID, reason: string): void {
  const t = books.getTransaction(txnId);
  if (!t) return;
  const idx = matchIndex(books.state);
  if (t.lines.some((l) => idx.has(l.id))) throw new ValidationError(['This check already cleared the bank, so it can\'t be voided. Book a reversing entry instead.']);
  books.deleteTransaction(actor, txnId, `Void: ${reason.trim() || 'check voided'}`);
}

export function staleCutoff(asOf: string, days: number): string {
  return addDays(asOf, -days);
}
