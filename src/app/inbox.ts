import type { BooksState, ID, Transaction } from '../core/types';
import { uncategorized, balanceAsOf, type FlatLine } from '../core/reports';
import { findDuplicates, txnTotal } from '../core/duplicates';
import { addDays, periodOf, todayInChicago } from '../core/dates';

export interface InboxItem {
  key: string;
  count: number;
  title: string;
  detail: string;
  to: string;
  action: string;
  /** Review queues are listed but don't count toward "items that need you". */
  review?: boolean;
}

export const DOC_THRESHOLD = 100_000; // money out of $1,000+ should carry its invoice
export const DOC_WINDOW_DAYS = 30;

/** Money out that should carry its source document: $1,000+, last 30 days, open month, not payroll (Gusto reports arrive in phase 6). */
export function needsDocument(t: Transaction, state: BooksState, today = todayInChicago()): boolean {
  return !t.deleted && t.kind === 'money_out' && t.attachments.length === 0 && !t.tags.includes('payroll') && txnTotal(t) >= DOC_THRESHOLD
    && t.date >= addDays(today, -DOC_WINDOW_DAYS) && state.periods[periodOf(t.date)]?.status !== 'locked';
}

export function buildInbox(state: BooksState, lines: FlatLine[], visible: Set<ID>, today = todayInChicago()): InboxItem[] {
  const uncat = uncategorized(state, lines);
  const vis = state.transactions.filter((t) => t.lines.some((l) => visible.has(l.storeId)));
  const dups = findDuplicates(vis, new Set(state.dismissedDuplicates));
  const floors = state.accounts.filter((a) => a.floorCents !== undefined && a.active);
  const below = floors.filter((a) => balanceAsOf(state, a.id, today, lines) < a.floorCents!);
  const thisPeriod = periodOf(today);
  const openPast = [...new Set(lines.map((f) => f.period))].filter((p) => p < thisPeriod && state.periods[p]?.status !== 'locked').sort();
  const noDoc = vis.filter((t) => needsDocument(t, state, today));
  return [
    { key: 'uncat', count: uncat.length, title: 'Uncategorized transactions', detail: uncat.length ? 'Suggestions are ready where a rule matches.' : 'Everything has a category.', to: '/books/transactions?queue=uncat', action: 'Categorize' },
    { key: 'dup', count: dups.length, title: 'Possible duplicates', detail: 'Same amount and payee within 3 days.', to: '/books/transactions?queue=dup', action: 'Review' },
    { key: 'floor', count: below.length, title: 'Accounts below their floor', detail: below.length ? below.map((a) => a.name).join(', ') : 'Trustmark is above the $30,000 floor.', to: below[0] ? `/books/accounts/${below[0].id}` : '/books/accounts/acct_trustmark', action: 'Open' },
    { key: 'close', count: openPast.length, title: 'Past months still open', detail: openPast.length ? openPast.join(', ') + ' — close and lock when reconciled.' : 'Every past month is locked.', to: '/close/periods', action: 'Close' },
    { key: 'nodoc', count: noDoc.length, title: 'Payments of $1,000+ with no document', detail: 'Last 30 days. Attach the invoice or notice so each number traces to its source.', to: '/books/transactions?queue=nodoc', action: 'Attach', review: true },
  ];
}
