import type { Books } from './books';
import { ValidationError } from './books';
import type { BooksState, ID, PrepaidKind, PrepaidSchedule, Transaction, User } from './types';
import { allocate, formatMoney, type Cents } from './money';
import { isValidDate, lastDayOfPeriod, periodLabel, periodsBetween } from './dates';
import { assetsOf, ensureAssets } from './assets';
import { balanceAsOf } from './reports';
import { bankStoreId } from './bank';

export const PREPAID_ACCOUNT = 'acct_prepaid';
export const PREPAID_LABEL: Record<PrepaidKind, string> = { insurance: 'Insurance', property_tax: 'Property tax', annual_fee: 'Annual fees', license: 'License / permit', other: 'Other' };
export const PREPAID_EXPENSE: Record<PrepaidKind, ID> = { insurance: 'acct_insurance', property_tax: 'acct_property_tax', annual_fee: 'acct_licenses', license: 'acct_licenses', other: 'acct_misc' };

function addMonths(period: string, n: number): string {
  let [y, m] = period.split('-').map(Number);
  m += n;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function prepaidEnd(p: Pick<PrepaidSchedule, 'startPeriod' | 'months'>): string {
  return addMonths(p.startPeriod, p.months - 1);
}

export interface PrepaidMonth { period: string; amount: Cents; /** Before these books: already out of the opening balance. */ before: boolean; txnId?: ID }

/** The schedule: the amount spread evenly over its months, cents exact (the parts always add back to the total). */
export function prepaidSchedule(p: PrepaidSchedule): PrepaidMonth[] {
  const parts = allocate(p.amount, Array.from({ length: p.months }, () => 1));
  return parts.map((amount, i) => {
    const period = addMonths(p.startPeriod, i);
    return { period, amount, before: !!p.amortizedThrough && period <= p.amortizedThrough, txnId: p.posted[period] };
  });
}

export interface PrepaidStatus {
  p: PrepaidSchedule;
  months: PrepaidMonth[];
  /** Amortized through the last completed month, by the schedule. */
  scheduled: Cents;
  /** Amortization actually posted in these books (plus what came before the books). */
  booked: Cents;
  /** What should be left in 1400 by the schedule, and what is left by the postings. */
  remainingScheduled: Cents;
  remaining: Cents;
  /** Months that should be posted (completed, inside these books) and aren't. */
  unposted: PrepaidMonth[];
  monthly: Cents;
}

/** A period is completed once its last day is on or before `asOf`. */
export function prepaidStatus(state: BooksState, p: PrepaidSchedule, asOf: string): PrepaidStatus {
  const months = prepaidSchedule(p);
  const live = (id?: ID) => !!id && state.transactions.some((t) => t.id === id && !t.deleted);
  const done = months.filter((m) => lastDayOfPeriod(m.period) <= asOf);
  const scheduled = done.reduce((a, m) => a + m.amount, 0);
  const booked = months.filter((m) => m.before || (live(m.txnId) && lastDayOfPeriod(m.period) <= asOf)).reduce((a, m) => a + m.amount, 0);
  const inBooks = p.paidTxnId ? live(p.paidTxnId) : !!p.amortizedThrough;
  return {
    p, months, scheduled, booked, monthly: months[0]?.amount ?? 0,
    remainingScheduled: inBooks ? p.amount - scheduled : 0,
    remaining: inBooks ? p.amount - booked : 0,
    unposted: done.filter((m) => !m.before && !live(m.txnId)),
  };
}

export function prepaidsOf(state: BooksState): PrepaidSchedule[] {
  return assetsOf(state).prepaids;
}

export type PrepaidDraft = Omit<PrepaidSchedule, 'id' | 'posted' | 'prepaidAccountId' | 'paidTxnId'> & { id?: ID; prepaidAccountId?: ID };

/**
 * Add a prepaid schedule. With `payment`, also posts the payment: Dr 1400 Prepaid / Cr the bank (Trustmark).
 * Without it, the amount is assumed to be in 1400 already (an opening balance, or a payment booked to 1400 by hand).
 */
export function savePrepaid(books: Books, actor: User, d: PrepaidDraft, payment?: { date: string; bankAccountId?: ID; checkNo?: string; partyId?: ID }): PrepaidSchedule {
  books.require(actor, 'assets.edit', 'set up prepaid schedules');
  const s = books.state;
  const errs: string[] = [];
  if (!d.label.trim()) errs.push('Describe the prepaid, e.g. "Property insurance 2026–27".');
  if (!Number.isSafeInteger(d.amount) || d.amount <= 0) errs.push('Enter the amount paid, above zero.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(d.startPeriod)) errs.push('Enter the first month covered as YYYY-MM.');
  if (!Number.isInteger(d.months) || d.months < 1 || d.months > 120) errs.push('Spread it over 1 to 120 months.');
  if (!s.stores.some((x) => x.id === d.storeId && !x.deleted)) errs.push('Choose the store the cost belongs to (CORP for company-wide).');
  const exp = s.accounts.find((a) => a.id === d.expenseAccountId);
  if (!exp || !(exp.type === 'expense' || exp.type === 'cogs')) errs.push('Choose the expense account the months go to (insurance, property tax, licenses).');
  if (d.amortizedThrough && !/^\d{4}-\d{2}$/.test(d.amortizedThrough)) errs.push('Enter "amortized before these books" as YYYY-MM, or leave it blank.');
  if (payment && !isValidDate(payment.date)) errs.push('Enter the payment date as YYYY-MM-DD.');
  if (errs.length) throw new ValidationError(errs);
  const a = ensureAssets(books);
  const existing = d.id ? a.prepaids.find((x) => x.id === d.id) : undefined;
  if (existing && Object.values(existing.posted).length && (existing.amount !== d.amount || existing.months !== d.months || existing.startPeriod !== d.startPeriod)) {
    throw new ValidationError(['Months are already posted from this schedule, so the amount, start and months are fixed. Add a new schedule for the change.']);
  }
  const p: PrepaidSchedule = {
    ...d, label: d.label.trim(), prepaidAccountId: d.prepaidAccountId ?? PREPAID_ACCOUNT, id: existing?.id ?? d.id ?? books.nextId('ppd'),
    posted: existing?.posted ?? {}, paidTxnId: existing?.paidTxnId,
  };
  if (payment && !p.paidTxnId) {
    const t = books.createTransaction(actor, {
      date: payment.date, kind: 'money_out', description: `Prepaid: ${p.label}`, partyId: payment.partyId, checkNo: payment.checkNo, tags: ['prepaid'],
      lines: [
        { accountId: p.prepaidAccountId, storeId: p.storeId, debit: p.amount, credit: 0, memo: `${p.months} months from ${p.startPeriod}` },
        { accountId: payment.bankAccountId ?? 'acct_trustmark', storeId: bankStoreId(s), debit: 0, credit: p.amount },
      ],
    });
    p.paidTxnId = t.id;
  }
  if (existing) Object.assign(existing, p); else a.prepaids.push(p);
  books.audit(actor, { action: existing ? 'update' : 'create', objectType: 'asset', objectId: p.id, summary: `${existing ? 'Updated' : 'Added'} prepaid ${p.label} (${formatMoney(p.amount, { dollarSign: true })} over ${p.months} months)`, after: structuredClone(p) });
  books.changed();
  return existing ?? p;
}

/**
 * Post one month's amortization for every active schedule that covers it: Dr expense / Cr 1400, on the month's last day.
 * Idempotent: a schedule already posted for the month is skipped. One entry per month carries every schedule's line.
 */
export function amortizePrepaids(books: Books, actor: User, period: string): Transaction | null {
  books.require(actor, 'assets.edit', 'post prepaid amortization');
  books.require(actor, 'journal.create', 'post prepaid amortization');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ValidationError(['Pick the month as YYYY-MM.']);
  const s = books.state;
  const live = (id?: ID) => !!id && s.transactions.some((t) => t.id === id && !t.deleted);
  const due: { p: PrepaidSchedule; amount: Cents }[] = [];
  for (const p of prepaidsOf(s)) {
    if (!p.active || live(p.posted[period])) continue;
    const m = prepaidSchedule(p).find((x) => x.period === period);
    if (!m || m.before || m.amount === 0) continue;
    if (!p.paidTxnId && !p.amortizedThrough) continue; // never put into 1400 in these books
    if (p.paidTxnId && !live(p.paidTxnId)) continue;
    due.push({ p, amount: m.amount });
  }
  if (!due.length) return null;
  const t = books.createTransaction(actor, {
    date: lastDayOfPeriod(period), kind: 'journal', description: `Prepaid amortization ${period}`, tags: ['prepaid', 'amortization'],
    memo: `${periodLabel(period)}: ${due.length} schedule${due.length === 1 ? '' : 's'}`,
    lines: due.flatMap(({ p, amount }) => [
      { accountId: p.expenseAccountId, storeId: p.storeId, debit: amount, credit: 0, memo: p.label },
      { accountId: p.prepaidAccountId, storeId: p.storeId, debit: 0, credit: amount, memo: p.label },
    ]),
  });
  for (const { p } of due) p.posted[period] = t.id;
  books.audit(actor, { action: 'amortize', objectType: 'asset', objectId: period, summary: `Posted prepaid amortization for ${period} (${t.ref})` });
  books.changed();
  return t;
}

/** Months with something left to post, oldest first, through the last completed month. */
export function unpostedPrepaidMonths(state: BooksState, asOf: string): string[] {
  const set = new Set<string>();
  for (const p of prepaidsOf(state)) if (p.active) for (const m of prepaidStatus(state, p, asOf).unposted) set.add(m.period);
  return [...set].sort();
}

/** The tie-out: what the schedules say is left in 1400 vs the 1400 balance in the ledger. */
export function prepaidTie(state: BooksState, asOf: string): { schedules: Cents; scheduledByMath: Cents; ledger: Cents; difference: Cents } {
  const st = prepaidsOf(state).map((p) => prepaidStatus(state, p, asOf));
  const schedules = st.reduce((a, x) => a + x.remaining, 0);
  const scheduledByMath = st.reduce((a, x) => a + x.remainingScheduled, 0);
  const accts = new Set(prepaidsOf(state).map((p) => p.prepaidAccountId).concat(PREPAID_ACCOUNT));
  const ledger = [...accts].reduce((a, id) => a + balanceAsOf(state, id, asOf), 0);
  return { schedules, scheduledByMath, ledger, difference: ledger - schedules };
}

export function periodsToDate(from: string, asOf: string): string[] {
  return periodsBetween(from, asOf.slice(0, 7)).filter((p) => lastDayOfPeriod(p) <= asOf);
}
