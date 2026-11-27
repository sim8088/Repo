import type { Books } from './books';
import type { BooksState, CashControlSettings, ID, LimitKind, Role, User } from './types';
import { can, PermissionError, ROLE_LABEL } from './permissions';
import { formatMoney, type Cents } from './money';

/**
 * Phase 14: approval limits by role and amount, checked in one place. `settings.jeApprovalLimitCents`
 * still decides whether a journal entry needs approval; these limits decide who may give it.
 * With no limit recorded for a role, the role's `approve` permission decides (no limit, or none at all),
 * so books from before phase 14 behave exactly as they did.
 */
export const LIMIT_KINDS: LimitKind[] = ['bill', 'journal', 'writeoff', 'rate_change'];
export const LIMIT_LABEL: Record<LimitKind, string> = { bill: 'Bills', journal: 'Journal entries', writeoff: 'Write-offs', rate_change: 'Rate changes' };
const NOUN: Record<LimitKind, string> = { bill: 'bills', journal: 'journal entries', writeoff: 'write-offs', rate_change: 'rate changes' };
/** Roles that may never approve, whatever is recorded. */
export const NEVER_APPROVE: Role[] = ['store_manager', 'reviewer'];

/** The most this role may approve of this kind: null = no limit, 0 = may not approve. */
export function limitFor(state: BooksState, role: Role, kind: LimitKind): Cents | null {
  if (NEVER_APPROVE.includes(role)) return 0;
  const row = state.controls?.limits?.find((l) => l.role === role && l.kind === kind);
  if (row) return row.maxCents;
  return can({ id: '', name: '', role, active: true }, 'approve') ? null : 0;
}

/** Whether the user may approve some amount of this kind (shows the approve buttons). */
export function canApproveKind(state: BooksState, user: User, kind: LimitKind): boolean {
  if (!user.active) return false;
  const l = limitFor(state, user.role, kind);
  return l === null || l > 0;
}

export function withinLimit(state: BooksState, user: User, kind: LimitKind, amount: Cents): boolean {
  if (!user.active) return false;
  const l = limitFor(state, user.role, kind);
  return l === null || (l > 0 && Math.abs(amount) <= l);
}

/** Active users who may approve this amount, CFO first. `exclude` drops the preparer / the person asking. */
export function whoCanApprove(state: BooksState, kind: LimitKind, amount: Cents, exclude: ID[] = []): User[] {
  const order: Role[] = ['cfo', 'owner', 'bookkeeper', 'store_manager', 'reviewer'];
  return state.users.filter((u) => u.active && !exclude.includes(u.id) && withinLimit(state, u, kind, amount))
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name));
}

export function approverNames(state: BooksState, kind: LimitKind, amount: Cents, exclude: ID[] = []): string {
  const who = whoCanApprove(state, kind, amount, exclude);
  if (!who.length) return 'Nobody else can approve it yet: the CFO can raise a limit under Controls › Approval limits.';
  return `Who can approve it: ${who.map((u) => `${u.name} (${ROLE_LABEL[u.role]})`).join(', ')}.`;
}

/**
 * The central check every approve function calls. Refuses (PermissionError) when the actor's role may not
 * approve this kind, or the amount is over the role's limit; the message names who can.
 */
export function requireApproval(books: Books, actor: User, kind: LimitKind, amount: Cents, what: string, exclude: ID[] = []): void {
  const state = books.state;
  const l = actor.active ? limitFor(state, actor.role, kind) : 0;
  const others = [actor.id, ...exclude];
  if (l === 0) throw new PermissionError(`Your role can't approve ${NOUN[kind]}. ${approverNames(state, kind, amount, others)}`);
  if (l !== null && Math.abs(amount) > l) {
    throw new PermissionError(`${what} is ${formatMoney(Math.abs(amount), { dollarSign: true })}, over your ${formatMoney(l, { dollarSign: true })} limit for ${NOUN[kind]}. ${approverNames(state, kind, amount, others)}`);
  }
}

// ── Cash controls (phase 14): the dual-count rule, checked from the cash chain ──
export const DEFAULT_CASH_CONTROLS: CashControlSettings = { dualCountAboveCents: 250_000, dualFrom: '2026-11-16', enforceDual: false, blindHq: false, patternMin: 4, patternWindowDays: 30 };

export function cashControlsOf(state: BooksState): CashControlSettings {
  return { ...DEFAULT_CASH_CONTROLS, ...(state.controls?.cash ?? {}) };
}

/** Counts and HQ receipts at or above the amount need a second counter. */
export function needsSecondCount(state: BooksState, stage: string, amount: Cents, businessDate: string): boolean {
  const c = cashControlsOf(state);
  return (stage === 'count' || stage === 'hq_receipt') && amount >= c.dualCountAboveCents && businessDate >= c.dualFrom;
}

/** Problems with a second count; when the control is enforced, a missing one is a problem too. */
export function dualCountErrors(state: BooksState, x: { stage: string; amount: Cents; businessDate: string; person: string; second?: { person: string; amount: Cents } }): string[] {
  const errs: string[] = [];
  if (x.second) {
    if (!x.second.person.trim()) errs.push('Say who did the second count.');
    else if (x.second.person.trim().toLowerCase() === x.person.trim().toLowerCase()) errs.push('The second count has to be done by someone else.');
    if (!Number.isSafeInteger(x.second.amount) || x.second.amount < 0) errs.push('Enter the amount the second counter counted.');
  } else if (cashControlsOf(state).enforceDual && needsSecondCount(state, x.stage, x.amount, x.businessDate)) {
    errs.push(`Counts of ${formatMoney(cashControlsOf(state).dualCountAboveCents, { dollarSign: true })} or more need a second counter. Have someone else count it and enter their name and amount.`);
  }
  return errs;
}
