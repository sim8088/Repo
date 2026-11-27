import type { BooksState, ID } from '../core/types';
import type { FlatLine } from '../core/reports';
import type { InboxItem } from './inbox';
import { formatMoney } from '../core/money';
import { pendingJournals, recurringDue, reversalsDue, jeTotal } from '../core/journals';
import { lastClosedPeriod, unsignedRecons } from '../core/recons';
import { qboAlerts, unmappedAccounts } from '../core/qbo';

/**
 * Phase 10 inbox: journal entries awaiting approval (also counted under Approvals, so listed as a
 * review), recurring runs and reversals due, account recs not signed off after month end, QBO
 * differences over $5 and unmapped accounts.
 */
export function glInbox(state: BooksState, allLines: FlatLine[], visible: Set<ID>, today: string, seesBank: boolean): InboxItem[] {
  const pending = pendingJournals(state, visible);
  const due = recurringDue(state, today, visible);
  const rev = reversalsDue(state, today).filter((j) => j.lines.some((l) => visible.has(l.storeId)));
  const money = (n: number) => formatMoney(n, { dollarSign: true });
  const items: InboxItem[] = [
    { key: 'je_pending', count: pending.length, title: 'Journal entries awaiting approval', detail: pending.length ? pending.map((j) => `${j.ref} ${money(jeTotal(j.lines))}`).join(', ') + ': over the limit, approved by someone other than the preparer.' : 'No journal entry is waiting.', to: pending.length === 1 ? `/books/journals/${pending[0].id}` : '/books/journals?status=pending', action: 'Approve', review: true },
    { key: 'je_recurring', count: due.length, title: 'Recurring entries due', detail: due.length ? due.map((d) => `${d.schedule.name} ${d.period}`).join(', ') : 'Every recurring run is generated.', to: '/books/journals?tab=recurring', action: 'Generate' },
    { key: 'je_reversals', count: rev.length, title: 'Reversing entries due', detail: rev.length ? rev.map((j) => `${j.ref} on ${j.reverseOn}`).join(', ') : 'Every reversal is posted.', to: '/books/journals?tab=reversing', action: 'Post' },
  ];
  if (!seesBank) return items;
  const period = lastClosedPeriod(today);
  const unsigned = unsignedRecons(state, today, allLines);
  const alerts = qboAlerts(state, allLines);
  const unmapped = unmappedAccounts(state);
  const code = (id: ID) => state.entities.find((e) => e.id === id)?.code ?? id;
  return [
    ...items,
    { key: 'recons', count: unsigned.length, title: `Account reconciliations not signed off for ${period}`, detail: unsigned.length ? `${unsigned.filter((r) => r.status === 'open').length} to prepare, ${unsigned.filter((r) => r.status === 'prepared').length} awaiting review, ${unsigned.filter((r) => r.status === 'stale').length} invalidated by later postings.` : 'Every balance-sheet account is signed off.', to: `/books/recons?period=${period}`, action: 'Reconcile' },
    { key: 'qbo_diff', count: alerts.reduce((a, x) => a + x.over.length, 0), title: 'QuickBooks differences over $5', detail: alerts.length ? alerts.map((x) => `${code(x.entityId)} ${x.period}: ${x.over.length} account${x.over.length === 1 ? '' : 's'}`).join('; ') : 'The portal agrees with every imported QBO trial balance.', to: alerts[0] ? `/qbo/differences?entity=${alerts[0].entityId}&period=${alerts[0].period}` : '/qbo/differences', action: 'Resolve' },
    { key: 'qbo_unmapped', count: unmapped.length, title: 'Accounts not mapped to QuickBooks', detail: unmapped.length ? unmapped.map((a) => `${a.number} ${a.name}`).join(', ') + ': their entries are held back from pushes.' : 'Every account has a QBO account.', to: '/qbo/mapping?show=unmapped', action: 'Map' },
  ];
}
