import type { Books } from './books';
import type { BooksState, ID, LimitKind, User } from './types';
import type { Cents } from './money';
import type { Permission } from './permissions';
import { approveBill, awaitingApproval, billTotal, rejectBill, vendorName } from './payables';
import { approveJournal, jeTotal, pendingJournals, rejectJournal } from './journals';

/** One thing waiting for someone with authority to say yes or no. */
export interface ApprovalItem {
  kind: string;
  id: ID;
  title: string;
  detail: string;
  amount: Cents;
  storeId?: ID;
  requestedBy: ID;
  requestedAt: string;
  /** Where to see the full record. */
  to: string;
}

/**
 * A kind of approval. Bills ship in phase 5; rate changes (phase 6), write-offs and adjusting
 * entries (phase 10) plug in by adding a provider here. Amount limits by role arrive in phase 14.
 */
export interface ApprovalProvider {
  kind: string;
  label: string;
  permission: Permission;
  /** Phase 14: the approval limit this kind falls under (who may approve, and how much). */
  limitKind?: LimitKind;
  list: (state: BooksState) => ApprovalItem[];
  approve: (books: Books, actor: User, id: ID, note?: string) => void;
  reject: (books: Books, actor: User, id: ID, reason: string) => void;
}

const bills: ApprovalProvider = {
  kind: 'bill',
  label: 'Bills',
  permission: 'approve',
  limitKind: 'bill',
  list: (state) => awaitingApproval(state).map((b) => ({
    kind: 'bill', id: b.id, title: `${vendorName(state, b.vendorId)} · invoice ${b.invoiceNo}`,
    detail: `${state.stores.find((s) => s.id === b.storeId)?.code ?? ''} · billed ${b.billDate} · due ${b.dueDate}${b.autopay ? ' · autopay' : ''}${b.lines.length > 1 ? ` · ${b.lines.length} lines` : ''}`,
    amount: billTotal(b), storeId: b.storeId, requestedBy: b.createdBy, requestedAt: b.createdAt, to: `/payables/bills/${b.id}`,
  })),
  approve: (books, actor, id, note) => { approveBill(books, actor, id, note); },
  reject: (books, actor, id, reason) => rejectBill(books, actor, id, reason),
};

/** Phase 10: journal entries over the approval limit. The approver can't be the preparer. */
const journals: ApprovalProvider = {
  kind: 'journal',
  label: 'Journal entries',
  permission: 'approve',
  limitKind: 'journal',
  list: (state) => pendingJournals(state).map((j) => ({
    kind: 'journal', id: j.id, title: `${j.ref} · ${j.description}`,
    detail: `${j.date}${j.adjusting ? ' · adjusting' : ''}${j.reverseOn ? ` · reverses ${j.reverseOn}` : ''} · ${j.lines.length} lines · over the ${(state.settings.jeApprovalLimitCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} limit`,
    amount: jeTotal(j.lines), storeId: j.lines[0]?.storeId, requestedBy: j.preparedBy, requestedAt: j.preparedAt, to: `/books/journals/${j.id}`,
  })),
  approve: (books, actor, id, note) => { approveJournal(books, actor, id, note); },
  reject: (books, actor, id, reason) => { rejectJournal(books, actor, id, reason); },
};

export const APPROVAL_PROVIDERS: ApprovalProvider[] = [bills, journals];

export function approvalQueue(state: BooksState, visible?: Set<ID>): (ApprovalItem & { provider: ApprovalProvider })[] {
  return APPROVAL_PROVIDERS.flatMap((p) => p.list(state).map((i) => ({ ...i, provider: p })))
    .filter((i) => !visible || !i.storeId || visible.has(i.storeId))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}
