import type { BooksState, ID, Transaction } from '../core/types';
import { uncategorized, balanceAsOf, type FlatLine } from '../core/reports';
import { findDuplicates, txnTotal } from '../core/duplicates';
import { addDays, periodOf, todayInChicago } from '../core/dates';
import { checksRegister, isMatched, matchIndex } from '../core/bank';
import { bagFlagged, bagOverdue } from '../core/cash';
import { formatMoney } from '../core/money';
import { newHiresToConfirm, payWeek, peopleOf, pendingRateChanges, runStores, weeklyReview } from '../core/payroll';
import { fuelInbox } from '../core/fuel';
import { billTotal, dueWithin, pastDue, unscheduledDueSoon, utilityRows, vendorName } from '../core/payables';
import { lateRent } from '../core/receivables';
import { overLimit } from '../core/intercompany';
import { approvalQueue } from '../core/approvals';
import { complianceInbox } from '../core/compliance';
import { maintenanceDue, unpostedDepreciation } from '../core/assets';
import { unpostedPrepaidMonths } from '../core/prepaids';
import { loanStatus, loansOf } from '../core/loans';
import { insideInbox } from '../core/inside';
import { kitchenInbox } from '../core/kitchen';
import { debtInbox } from '../core/debt';
import { taxInbox } from '../core/tax';

/** Phase 9: compliance deadlines, licenses, notices, maintenance and warranties, and month-end postings for assets and debt. */
function phase9Inbox(state: BooksState, visible: Set<ID>, today: string, seesBank: boolean): InboxItem[] {
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? '';
  const due = maintenanceDue(state, today).filter((d) => visible.has(d.storeId));
  const dep = seesBank ? unpostedDepreciation(state, today) : [];
  const pre = seesBank ? unpostedPrepaidMonths(state, today) : [];
  const loans = seesBank ? loansOf(state).flatMap((l) => loanStatus(state, l, today).unposted.map((r) => `${l.name} ${r.date}`)) : [];
  const posts = [...dep.map((p) => `depreciation ${p}`), ...pre.map((p) => `prepaid amortization ${p}`), ...loans.map((l) => `loan payment ${l}`)];
  return [
    ...complianceInbox(state, visible, today),
    { key: 'maint', count: due.length, title: 'Maintenance or warranties due in 30 days', detail: due.length ? due.map((d) => `${code(d.storeId)} ${d.label} ${d.overdue ? (d.kind === 'warranty' ? 'ended' : 'was due') : 'due'} ${d.due}`).join('; ') : 'No service, inspection or warranty date in the next 30 days.', to: '/assets/maintenance', action: 'Schedule' },
    ...(seesBank ? [{ key: 'assetpost', count: posts.length, title: 'Month-end postings for assets and debt', detail: posts.length ? posts.join('; ') : 'Depreciation, prepaid amortization and loan payments are posted.', to: dep.length ? '/assets/depreciation' : pre.length ? '/assets/prepaids' : '/assets/loans', action: 'Post' }] : []),
  ];
}

import { cellName, closeInbox } from '../core/close';
import { uncommentedVariances } from '../core/budgets';
import { basisEntries } from '../core/statements';
import { periodLabel } from '../core/dates';

/** Month-end close (phase 8): overdue close steps, months past their lock date, and budget variances still to explain. */
function closeItems(state: BooksState, visible: Set<ID>, today: string): InboxItem[] {
  const storeIds = state.stores.filter((s) => visible.has(s.id)).map((s) => s.id);
  const entries = basisEntries(state);
  const ci = closeInbox(state, { today, storeIds, entries });
  const vars = uncommentedVariances(state, { storeIds, today, entries });
  const months = [...new Set(ci.overdue.map((o) => o.period))];
  const vMonths = [...new Set(vars.map((v) => v.period))].sort();
  return [
    { key: 'closetasks', count: ci.overdue.length, title: 'Close steps overdue', detail: ci.overdue.length ? `${ci.overdue.slice(0, 3).map((o) => `${cellName(state, o.cell)} (${periodLabel(o.period)})`).join('; ')}${ci.overdue.length > 3 ? '…' : ''}.` : 'Every close step is on time.', to: months[0] ? `/close?month=${months[0]}` : '/close', action: 'Close' },
    { key: 'closelate', count: ci.pastDue.length, title: 'Months past their close date, not locked', detail: ci.pastDue.length ? `${ci.pastDue.map(periodLabel).join(', ')}: finish the checklist and lock.` : 'Every month is locked by its due date.', to: ci.pastDue[0] ? `/close?month=${ci.pastDue[0]}` : '/close', action: 'Lock' },
    { key: 'variances', count: vars.length, title: 'Budget variances over the threshold with no comment', detail: vars.length ? `${vMonths.map(periodLabel).join(', ')}: say why each line is off budget.` : 'Every variance over the threshold is explained.', to: vMonths[0] ? `/budgets/bva?month=${vMonths[0]}&show=open` : '/budgets/bva', action: 'Explain' },
  ];
}
import { glInbox } from './glinbox';
import { controlsInbox } from './controlsinbox';

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

/** People & payroll (phase 6): runs to review, rate changes to approve, new hires, and week-over-week moves over 15%. */
function payrollInbox(state: BooksState, visible: Set<ID>): InboxItem[] {
  const runs = peopleOf(state).runs.filter((r) => r.status === 'imported' && runStores(r).some((s) => visible.has(s)));
  const weeks = [...new Set(runs.map((r) => payWeek(r.payDate)))].sort();
  const pending = pendingRateChanges(state, visible);
  const hires = newHiresToConfirm(state, visible);
  const moved = weeks.flatMap((w) => weeklyReview(state, w, visible).stores.filter((s) => s.cost.flagged).map((s) => ({ w, s })));
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  return [
    { key: 'payroll', count: runs.length, title: 'Payroll to review', detail: runs.length ? `Gusto run${runs.length === 1 ? '' : 's'} for ${weeks.join(', ')} imported, not posted.` : 'Every Gusto run is reviewed and posted.', to: weeks[0] ? `/people/review?week=${weeks[0]}` : '/people/review', action: 'Review' },
    { key: 'rates', count: pending.length, title: 'Rate changes awaiting approval', detail: pending.length ? 'A raise or rate change needs the CFO or an owner to approve it.' : 'No rate changes waiting.', to: '/people/employees?show=pending', action: 'Approve' },
    { key: 'hires', count: hires.length, title: 'New hires to confirm', detail: hires.length ? hires.map((e) => `${e.name} (${code(e.storeId)})`).join(', ') + ': check the W-4, I-9 and rate.' : 'Every new hire is confirmed.', to: '/people/employees?show=new', action: 'Confirm' },
    { key: 'wow', count: moved.length, title: 'Payroll moved more than 15% week to week', detail: moved.length ? moved.map(({ s }) => `${code(s.storeId)} ${s.cost.pct! > 0 ? '+' : ''}${(s.cost.pct! * 100).toFixed(0)}%`).join(', ') + ' vs last week.' : 'No store moved more than 15% in the weeks to review.', to: weeks[0] ? `/people/review?week=${weeks[0]}` : '/people/review', action: 'Review' },
  ];
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
  const seesBank = visible.has(state.stores.find((x) => x.kind === 'corporate')?.id ?? '');
  const idx = matchIndex(state);
  const unmatched = seesBank ? state.bank.lines.filter((b) => !b.excluded && !isMatched(b, idx)) : [];
  const unclassified = seesBank ? state.bank.lines.filter((b) => !b.excluded && b.amount > 0 && !b.source) : [];
  const bags = state.cash.bags.filter((b) => visible.has(b.storeId));
  const flagged = bags.filter((b) => !b.reviewed && bagFlagged(state, b));
  const overdue = bags.filter((b) => bagOverdue(state, b, today));
  const stale = seesBank ? checksRegister(state, today).filter((c) => c.status === 'stale') : [];
  const bank: InboxItem[] = seesBank ? [
    { key: 'unmatched', count: unmatched.length, title: 'Unmatched bank lines', detail: unmatched.length ? 'Auto-match, match by hand, or book what only the bank knows about.' : 'Every bank line is matched.', to: '/bank?tab=match', action: 'Match' },
    { key: 'unclassified', count: unclassified.length, title: 'Unclassified deposits', detail: 'Say where each deposit came from.', to: '/bank/deposits?show=unclassified', action: 'Classify' },
  ] : [];
  const mat = formatMoney(state.settings.materialityCents, { dollarSign: true });
  // Phase 5: payables, receivables, intercompany, approvals.
  const mineBill = (b: { storeId: ID }) => visible.has(b.storeId);
  const due7 = dueWithin(state, today, 7).filter(mineBill);
  const unsched = unscheduledDueSoon(state, today, 3).filter(mineBill);
  const late = pastDue(state, today).filter(mineBill);
  const utils = utilityRows(state, today).filter((u) => visible.has(u.ua.storeId) && (u.pastDue.length || u.disconnect));
  const rentLate = seesBank ? lateRent(state, today) : [];
  const over = seesBank ? overLimit(state, today) : [];
  const approvals = approvalQueue(state, visible);
  const money = (n: number) => formatMoney(n, { dollarSign: true });
  const ap: InboxItem[] = [
    { key: 'approvals', count: approvals.length, title: 'Approvals waiting', detail: approvals.length ? `${approvals.map((a) => a.title).slice(0, 2).join('; ')}${approvals.length > 2 ? '…' : ''}` : 'Nothing waiting for a yes or no.', to: '/approvals', action: 'Approve' },
    { key: 'billsunsched', count: unsched.length, title: 'Bills due in 3 days with no payment scheduled', detail: unsched.length ? unsched.map((b) => `${vendorName(state, b.vendorId)} ${money(billTotal(b))} due ${b.dueDate}`).join('; ') : 'Everything due soon is scheduled or on autopay.', to: unsched.length === 1 ? `/payables/bills/${unsched[0].id}` : '/payables/calendar', action: 'Schedule' },
    { key: 'billslate', count: late.length, title: 'Bills past due', detail: late.length ? `${money(late.reduce((a, b) => a + billTotal(b), 0))} across ${[...new Set(late.map((b) => vendorName(state, b.vendorId)))].join(', ')}.` : 'No bill is late.', to: '/payables/aging', action: 'Pay' },
    { key: 'utility', count: utils.length, title: 'Utilities past due or with a disconnect notice', detail: utils.length ? utils.map((u) => `${state.stores.find((x) => x.id === u.ua.storeId)?.code} ${u.ua.accountNo}${u.disconnect ? ' (disconnect notice)' : ''}`).join(', ') : 'Every utility account is current.', to: '/payables/utilities', action: 'Review' },
    ...(seesBank ? [
      { key: 'rentlate', count: rentLate.length, title: 'Tenant rent late', detail: rentLate.length ? rentLate.map((c) => `${state.parties.find((p) => p.id === c.tenantId)?.name.replace(' (tenant)', '')} ${c.period}`).join(', ') : 'Every tenant is paid up.', to: '/receivables/rent', action: 'Follow up' },
      { key: 'iclimit', count: over.length, title: 'Intercompany balances over their limit', detail: over.length ? over.map((p) => `${p.name} ${money(Math.abs(p.balance))} (limit ${money(p.limit!)})`).join(', ') : 'Every related party is inside its limit.', to: over.length === 1 ? `/intercompany/parties/${over[0].id}` : '/intercompany/parties', action: 'Review' },
    ] : []),
    { key: 'billsdue', count: due7.length, title: 'Bills due in the next 7 days', detail: `${money(due7.reduce((a, b) => a + billTotal(b), 0))} going out. Check the payment calendar against cash.`, to: '/payables/calendar', action: 'Plan' },
  ];
  return [
    ...bank,
    ...(seesBank ? payrollInbox(state, visible) : []),
    ...fuelInbox(state, visible, today),
    ...insideInbox(state, visible, today),
    ...kitchenInbox(state, visible),
    ...ap,
    ...phase9Inbox(state, visible, today, seesBank),
    ...glInbox(state, lines, visible, today, seesBank),
    ...(seesBank ? debtInbox(state, today, visible) : []),
    ...taxInbox(state, visible, today),
    ...controlsInbox(state, visible, today, seesBank),
    { key: 'cashvar', count: flagged.length, title: 'Cash handoffs with variances', detail: mat + ' or more between a count and the step before it.', to: '/cash?show=flagged', action: 'Review' },
    { key: 'overdue', count: overdue.length, title: 'Cash picked up but not deposited', detail: 'Older than ' + state.settings.depositWithinDays + ' days since pickup.', to: '/cash?show=overdue', action: 'Deposit' },
    { key: 'uncat', count: uncat.length, title: 'Uncategorized transactions', detail: uncat.length ? 'Suggestions are ready where a rule matches.' : 'Everything has a category.', to: '/books/transactions?queue=uncat', action: 'Categorize' },
    { key: 'dup', count: dups.length, title: 'Possible duplicates', detail: 'Same amount and payee within 3 days.', to: '/books/transactions?queue=dup', action: 'Review' },
    { key: 'floor', count: below.length, title: 'Accounts below their floor', detail: below.length ? below.map((a) => a.name).join(', ') : 'Trustmark is above the $30,000 floor.', to: below[0] ? `/books/accounts/${below[0].id}` : '/books/accounts/acct_trustmark', action: 'Open' },
    ...(seesBank ? closeItems(state, visible, today) : []),
    { key: 'close', count: openPast.length, title: 'Past months still open', detail: openPast.length ? openPast.join(', ') + ' — close and lock when reconciled.' : 'Every past month is locked.', to: '/close/periods', action: 'Close' },
    ...(seesBank ? [{ key: 'stale', count: stale.length, title: 'Stale checks', detail: 'Uncleared after ' + state.settings.staleCheckDays + ' days. Follow up or void.', to: '/bank/checks?status=stale', action: 'Review', review: true }] : []),
    { key: 'nodoc', count: noDoc.length, title: 'Payments of $1,000+ with no document', detail: 'Last 30 days. Attach the invoice or notice so each number traces to its source.', to: '/books/transactions?queue=nodoc', action: 'Attach', review: true },
  ];
}
