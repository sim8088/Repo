import type { Books } from './books';
import { ValidationError } from './books';
import type { Attachment, BooksState, ID, Loan, LoanKind, Transaction, User } from './types';
import { formatMoney, type Cents } from './money';
import { addDays, daysBetween, isValidDate, lastDayOfPeriod } from './dates';
import { assetsOf, ensureAssets } from './assets';
import { bankStoreId } from './bank';
import { icState } from './intercompany';

export const LOAN_KIND_LABEL: Record<LoanKind, string> = { mortgage: 'Mortgage', equipment_note: 'Equipment note', line_of_credit: 'Line of credit', term_loan: 'Term loan' };

export function loansOf(state: BooksState): Loan[] {
  return assetsOf(state).loans;
}

export function ratePct(bps: number): string {
  return (bps / 100).toFixed(2) + '%';
}

function addMonthsKeepDay(date: string, months: number): string {
  const day = Number(date.slice(8, 10));
  let y = Number(date.slice(0, 4));
  let m = Number(date.slice(5, 7)) + months;
  while (m > 12) { m -= 12; y += 1; }
  const p = `${y}-${String(m).padStart(2, '0')}`;
  return `${p}-${String(Math.min(day, Number(lastDayOfPeriod(p).slice(8, 10)))).padStart(2, '0')}`;
}

/** The level monthly payment that pays off `principal` over `months` at the annual rate (in basis points), rounded up to the cent. */
export function levelPayment(principal: Cents, rateBps: number, months: number): Cents {
  const r = rateBps / 10000 / 12;
  if (r === 0) return Math.ceil(principal / months);
  return Math.ceil((principal * r) / (1 - Math.pow(1 + r, -months)));
}

export interface AmortRow {
  n: number;
  date: string;
  opening: Cents;
  payment: Cents;
  interest: Cents;
  principal: Cents;
  closing: Cents;
  /** The final payment at maturity carries the remaining balance (a balloon when the amortization is longer than the term). */
  balloon: boolean;
  /** Paid before these books began: in the opening balance. */
  before: boolean;
  txnId?: ID;
}

/** Due dates from the first payment, monthly, through maturity. */
export function paymentDates(loan: Pick<Loan, 'firstPayment' | 'maturity'>): string[] {
  const out: string[] = [];
  for (let i = 0; i < 1200; i++) {
    const d = addMonthsKeepDay(loan.firstPayment, i);
    if (d > loan.maturity) break;
    out.push(d);
  }
  if (out.at(-1) !== loan.maturity && loan.maturity > (out.at(-1) ?? '')) out.push(loan.maturity);
  return out;
}

/** A line of credit's balance at the end of a day: draws less paydowns. */
export function locBalance(loan: Loan, asOf: string): Cents {
  return loan.draws.filter((d) => d.date <= asOf).reduce((s, d) => s + d.amount, 0);
}

/**
 * The amortization table. Amortizing loans: interest is the balance × rate ÷ 12 each month (30/360), principal is
 * the payment less interest, and the last row at maturity pays off what is left. Lines of credit pay interest only:
 * actual days × daily balance × rate ÷ 365 since the last due date, with the balance due at maturity; future rows
 * assume today's balance. Payoff date = the last row.
 */
export function amortization(loan: Loan): AmortRow[] {
  const dates = paymentDates(loan);
  const rows: AmortRow[] = [];
  const before = (d: string) => !!loan.booksFrom && d < loan.booksFrom;
  if (loan.interestOnly) {
    let prev = loan.start;
    dates.forEach((date, i) => {
      let interest = 0;
      for (let d = addDays(prev, 1); d <= date; d = addDays(d, 1)) interest += (locBalance(loan, d) * loan.rateBps) / 10000 / 365;
      interest = Math.round(interest);
      const opening = locBalance(loan, prev);
      const last = i === dates.length - 1;
      const closingBal = locBalance(loan, date);
      const principal = last ? closingBal : 0;
      rows.push({ n: i + 1, date, opening, payment: interest + principal, interest, principal, closing: closingBal - principal, balloon: last && principal > 0, before: before(date), txnId: loan.payments[date]?.txnId });
      prev = date;
    });
    return rows;
  }
  let bal = loan.original;
  const r = loan.rateBps / 10000 / 12;
  for (let i = 0; i < dates.length && bal > 0; i++) {
    const date = dates[i];
    const interest = Math.round(bal * r);
    const last = i === dates.length - 1;
    let payment = loan.payment;
    if (last || payment >= bal + interest) payment = bal + interest;
    const principal = payment - interest;
    rows.push({ n: i + 1, date, opening: bal, payment, interest, principal, closing: bal - principal, balloon: last && payment > loan.payment, before: before(date), txnId: loan.payments[date]?.txnId });
    bal -= principal;
  }
  return rows;
}

export interface LoanStatus {
  loan: Loan;
  rows: AmortRow[];
  /** Balance by the schedule after every payment due on or before the date. */
  scheduleBalance: Cents;
  /** Balance on the books: the liability account for this lender (company loans only). */
  ledgerBalance: Cents | null;
  next?: AmortRow;
  payoffDate: string;
  totalInterest: Cents;
  interestPaidYtd: Cents;
  /** Payments due inside these books and not yet posted. */
  unposted: AmortRow[];
  /** Company loans: does the book balance tie to the schedule? */
  ties: boolean | null;
}

function live(state: BooksState, id?: ID): boolean {
  return !!id && state.transactions.some((t) => t.id === id && !t.deleted);
}

/** What the liability account says we owe this lender (credit balance, shown positive). */
export function loanLedgerBalance(state: BooksState, loan: Loan, asOf: string): Cents | null {
  if (loan.heldBy !== 'company' || !loan.liabilityAccountId) return null;
  let n = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf) continue;
    for (const l of t.lines) if (l.accountId === loan.liabilityAccountId && !l.system && (l.partyId ?? t.partyId) === loan.lenderPartyId) n += l.credit - l.debit;
  }
  return n;
}

export function loanStatus(state: BooksState, loan: Loan, asOf: string): LoanStatus {
  const rows = amortization(loan);
  const due = rows.filter((r) => r.date <= asOf);
  const scheduleBalance = loan.interestOnly ? locBalance(loan, asOf) - due.reduce((s, r) => s + r.principal, 0) : (due.at(-1)?.closing ?? (loan.start <= asOf ? loan.original : 0));
  const ledgerBalance = loanLedgerBalance(state, loan, asOf);
  const yr = asOf.slice(0, 4);
  const unposted = loan.heldBy === 'company' ? due.filter((r) => !r.before && !live(state, r.txnId) && r.payment > 0) : [];
  return {
    loan, rows, scheduleBalance, ledgerBalance, next: rows.find((r) => r.date > asOf), payoffDate: rows.at(-1)?.date ?? loan.maturity,
    totalInterest: rows.reduce((s, r) => s + r.interest, 0),
    interestPaidYtd: due.filter((r) => r.date.startsWith(yr)).reduce((s, r) => s + r.interest, 0),
    unposted,
    ties: ledgerBalance === null ? null : ledgerBalance === scheduleBalance,
  };
}

export type LoanDraft = Omit<Loan, 'id' | 'payments' | 'draws' | 'attachments' | 'openingTxnId'> & { id?: ID; draws?: Loan['draws']; attachments?: Attachment[] };

export function validateLoan(state: BooksState, d: LoanDraft): string[] {
  const errs: string[] = [];
  if (!d.name.trim()) errs.push('Name the loan, e.g. "HM15 equipment note".');
  if (!d.lender.trim()) errs.push('Enter the lender.');
  if (!Number.isSafeInteger(d.original) || d.original <= 0) errs.push('Enter the original amount (the credit limit for a line of credit), above zero.');
  if (!Number.isInteger(d.rateBps) || d.rateBps < 0 || d.rateBps > 5000) errs.push('Enter the rate as a percentage between 0 and 50.');
  if (d.rateType === 'variable' && !d.index?.trim()) errs.push('A variable rate needs its index (e.g. Prime, SOFR).');
  for (const [k, label] of [['start', 'start'], ['firstPayment', 'first payment'], ['maturity', 'maturity']] as const) if (!isValidDate(d[k])) errs.push(`Enter the ${label} date as YYYY-MM-DD.`);
  if (isValidDate(d.firstPayment) && isValidDate(d.maturity) && d.maturity < d.firstPayment) errs.push('Maturity must be on or after the first payment.');
  if (!d.interestOnly && (!Number.isSafeInteger(d.payment) || d.payment <= 0)) errs.push('Enter the monthly payment.');
  if (!state.stores.some((s) => s.id === d.storeId)) errs.push('Choose the store or entity the loan belongs to.');
  if (d.heldBy === 'company') {
    const a = state.accounts.find((x) => x.id === d.liabilityAccountId);
    if (!a || a.type !== 'liability') errs.push('Choose the liability account the balance sits in (2300, 2310, 2320).');
    if (!d.lenderPartyId) errs.push('Pick the lender as a party (Setup › Vendors & parties, type lender) so its ledger ties.');
  } else if (!d.holderPartyId) errs.push('Pick the related party that carries this loan.');
  return errs;
}

export function saveLoan(books: Books, actor: User, d: LoanDraft): Loan {
  books.require(actor, 'assets.edit', 'change loans');
  const errs = validateLoan(books.state, d);
  if (errs.length) throw new ValidationError(errs);
  const st = ensureAssets(books);
  const existing = d.id ? st.loans.find((x) => x.id === d.id) : undefined;
  const loan: Loan = {
    ...d, name: d.name.trim(), lender: d.lender.trim(), covenants: d.covenants.map((c) => c.trim()).filter(Boolean),
    id: existing?.id ?? d.id ?? books.nextId('loan'), payments: existing?.payments ?? {}, draws: d.draws ?? existing?.draws ?? [], attachments: d.attachments ?? existing?.attachments ?? [],
    openingTxnId: existing?.openingTxnId,
  };
  if (existing) Object.assign(existing, loan); else st.loans.push(loan);
  books.audit(actor, { action: existing ? 'update' : 'create', objectType: 'loan', objectId: loan.id, summary: `${existing ? 'Updated' : 'Added'} loan ${loan.name}`, after: structuredClone(loan) });
  books.changed();
  return existing ?? loan;
}

function getLoan(books: Books, id: ID): Loan {
  const l = ensureAssets(books).loans.find((x) => x.id === id);
  if (!l) throw new ValidationError(['That loan no longer exists.']);
  return l;
}

/**
 * Bring a loan taken out before these books onto them: Cr the liability for the scheduled balance at the date, against
 * the offset account (owner capital by default: the opening equity was stated before the loan).
 */
export function postLoanOpening(books: Books, actor: User, id: ID, x: { date: string; offsetAccountId?: ID }): Transaction {
  books.require(actor, 'assets.edit', 'post loan balances');
  const loan = getLoan(books, id);
  if (loan.heldBy !== 'company') throw new ValidationError([`${loan.name} is carried by a related party; it isn't on our books.`]);
  if (loan.openingTxnId && live(books.state, loan.openingTxnId)) throw new ValidationError(['The opening balance is already posted.']);
  if (!isValidDate(x.date)) throw new ValidationError(['Enter the date as YYYY-MM-DD.']);
  const bal = loanStatus(books.state, loan, x.date).scheduleBalance;
  if (bal <= 0) throw new ValidationError(['The schedule shows nothing owed at that date.']);
  const t = books.createTransaction(actor, {
    date: x.date, kind: 'opening', description: `Opening balance – ${loan.name}`, partyId: loan.lenderPartyId, tags: ['loan'],
    memo: 'Loan taken out before these books; balance per the amortization schedule',
    lines: [
      { accountId: x.offsetAccountId ?? 'acct_owner_capital', storeId: loan.storeId, debit: bal, credit: 0 },
      { accountId: loan.liabilityAccountId!, storeId: loan.storeId, debit: 0, credit: bal, partyId: loan.lenderPartyId, memo: `${loan.name} balance` },
    ],
  });
  loan.openingTxnId = t.id;
  loan.booksFrom = addDays(x.date, 1);
  books.audit(actor, { action: 'opening', objectType: 'loan', objectId: loan.id, summary: `Posted opening balance ${formatMoney(bal, { dollarSign: true })} for ${loan.name}` });
  books.changed();
  return t;
}

/**
 * Post a scheduled payment: Dr the liability for principal, Dr interest expense, Cr the bank. Idempotent per due date:
 * a payment already posted is refused. Related-party loans are information only and never post.
 */
export function postLoanPayment(books: Books, actor: User, id: ID, dueDate: string, opts: { date?: string; checkNo?: string } = {}): Transaction {
  books.require(actor, 'assets.edit', 'post loan payments');
  const loan = getLoan(books, id);
  if (loan.heldBy !== 'company') throw new ValidationError([`${loan.name} is carried by ${books.state.parties.find((p) => p.id === loan.holderPartyId)?.name ?? 'a related party'} and reimbursed through rent; nothing posts here.`]);
  const ex = loan.payments[dueDate];
  if (ex && live(books.state, ex.txnId)) throw new ValidationError([`The ${dueDate} payment is already posted.`]);
  const row = amortization(loan).find((r) => r.date === dueDate);
  if (!row) throw new ValidationError([`No payment is due on ${dueDate}. Pick a date from the amortization table.`]);
  if (row.before) throw new ValidationError([`The ${dueDate} payment was before these books; it is in the opening balance.`]);
  const date = opts.date ?? dueDate;
  if (!isValidDate(date)) throw new ValidationError(['Enter the payment date as YYYY-MM-DD.']);
  const lines = [
    ...(row.principal ? [{ accountId: loan.liabilityAccountId!, storeId: loan.storeId, debit: row.principal, credit: 0, partyId: loan.lenderPartyId, memo: 'Principal' }] : []),
    ...(row.interest ? [{ accountId: loan.interestAccountId, storeId: loan.storeId, debit: row.interest, credit: 0, memo: 'Interest' }] : []),
    { accountId: loan.payFromAccountId, storeId: bankStoreId(books.state), debit: 0, credit: row.payment },
  ];
  const t = books.createTransaction(actor, {
    date, kind: 'money_out', description: `LOAN PAYMENT ${loan.lender.toUpperCase()}`, partyId: loan.lenderPartyId, checkNo: opts.checkNo, tags: ['loan'],
    memo: `${loan.name} payment ${row.n} due ${dueDate}: principal ${formatMoney(row.principal, { dollarSign: true })}, interest ${formatMoney(row.interest, { dollarSign: true })}`,
    lines,
  });
  loan.payments[dueDate] = { txnId: t.id, principal: row.principal, interest: row.interest, date };
  books.audit(actor, { action: 'pay', objectType: 'loan', objectId: loan.id, summary: `Posted ${loan.name} payment due ${dueDate} (${t.ref})` });
  books.changed();
  return t;
}

/** Line of credit: a draw (money in, + amount) or a paydown (money out, − amount). */
export function recordDraw(books: Books, actor: User, id: ID, x: { date: string; amount: Cents }): Transaction {
  books.require(actor, 'assets.edit', 'record draws and paydowns');
  const loan = getLoan(books, id);
  const errs: string[] = [];
  if (!loan.interestOnly || loan.heldBy !== 'company') errs.push('Draws and paydowns are for a line of credit on our books.');
  if (!isValidDate(x.date)) errs.push('Enter the date as YYYY-MM-DD.');
  if (!Number.isSafeInteger(x.amount) || x.amount === 0) errs.push('Enter the amount: positive for a draw, negative for a paydown.');
  if (errs.length) throw new ValidationError(errs);
  const after = locBalance(loan, '9999-12-31') + x.amount;
  if (after < 0) throw new ValidationError([`That pays down more than is drawn (${formatMoney(locBalance(loan, '9999-12-31'), { dollarSign: true })}).`]);
  if (loan.creditLimit && after > loan.creditLimit) throw new ValidationError([`That takes the line over its ${formatMoney(loan.creditLimit, { dollarSign: true })} limit.`]);
  const amt = Math.abs(x.amount);
  const draw = x.amount > 0;
  const bank = { accountId: loan.payFromAccountId, storeId: bankStoreId(books.state), debit: draw ? amt : 0, credit: draw ? 0 : amt };
  const liab = { accountId: loan.liabilityAccountId!, storeId: loan.storeId, debit: draw ? 0 : amt, credit: draw ? amt : 0, partyId: loan.lenderPartyId };
  const t = books.createTransaction(actor, {
    date: x.date, kind: 'transfer', description: `${draw ? 'LOC ADVANCE' : 'LOC PAYDOWN'} ${loan.lender.toUpperCase()}`, partyId: loan.lenderPartyId, tags: ['loan'], lines: [bank, liab],
  });
  loan.draws.push({ date: x.date, amount: x.amount, txnId: t.id });
  loan.draws.sort((a, b) => a.date.localeCompare(b.date));
  books.audit(actor, { action: draw ? 'draw' : 'paydown', objectType: 'loan', objectId: loan.id, summary: `${draw ? 'Drew' : 'Paid down'} ${formatMoney(amt, { dollarSign: true })} on ${loan.name}` });
  books.changed();
  return t;
}

/**
 * A related party's loan against the rent pass-through that reimburses it: the payment should be covered by the
 * monthly rent the store books to that party.
 */
export function passThroughCover(state: BooksState, loan: Loan, asOf: string): { rent: Cents; payment: Cents; covered: boolean } | null {
  if (loan.heldBy !== 'related_party') return null;
  const rent = icState(state).rentTemplates.filter((t) => t.active && t.storeId === loan.storeId && t.partyId === loan.holderPartyId).reduce((s, t) => s + t.amount, 0);
  const next = loanStatus(state, loan, asOf).next;
  const payment = next?.payment ?? loan.payment;
  return { rent, payment, covered: rent >= payment };
}

/** Company loans: book balance by liability account vs the sum of the loans in it (the tie-out). */
export function loanAccountTie(state: BooksState, asOf: string): { accountId: ID; loans: Cents; ledger: Cents }[] {
  const accts = new Set(state.accounts.filter((a) => a.subtype === 'loan').map((a) => a.id));
  const m = new Map<ID, { loans: Cents; ledger: Cents }>();
  for (const id of accts) m.set(id, { loans: 0, ledger: 0 });
  for (const l of loansOf(state)) if (l.heldBy === 'company' && l.liabilityAccountId) m.get(l.liabilityAccountId)!.loans += loanStatus(state, l, asOf).scheduleBalance;
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf) continue;
    for (const ln of t.lines) if (accts.has(ln.accountId)) m.get(ln.accountId)!.ledger += ln.credit - ln.debit;
  }
  return [...m].map(([accountId, v]) => ({ accountId, ...v }));
}

export function daysToMaturity(loan: Loan, today: string): number {
  return daysBetween(today, loan.maturity);
}
