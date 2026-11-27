import type { BooksState, Line, ID, Account, Store } from './types';
import { assertCents, formatMoney } from './money';
import { isValidDate, periodOf } from './dates';

export const SYS = {
  dueFrom: 'acct_due_from',
  dueTo: 'acct_due_to',
  retained: 'acct_retained',
  uncatExpense: 'acct_uncat_expense',
  uncatIncome: 'acct_uncat_income',
} as const;

export type DraftLine = Omit<Line, 'id' | 'system' | 'counterEntityId'> & { id?: ID };

export interface TxnDraft {
  date: string;
  kind: 'money_out' | 'money_in' | 'journal' | 'transfer' | 'opening';
  description: string;
  memo?: string;
  tags?: string[];
  partyId?: ID;
  checkNo?: string;
  docNo?: string;
  lines: DraftLine[];
}

export function lineAmount(l: Pick<Line, 'debit' | 'credit'>): number {
  return l.debit - l.credit;
}

/** Validate a transaction before it is posted. Errors are sentences that say how to fix them. */
export function validateDraft(state: BooksState, d: TxnDraft): string[] {
  const errs: string[] = [];
  if (!isValidDate(d.date)) errs.push('Enter the date as YYYY-MM-DD.');
  if (!d.description.trim()) errs.push('Add a description so this can be found later.');
  if (d.lines.length < 2) errs.push('A transaction needs at least two lines: where the money came from and where it went.');
  const accounts = new Map(state.accounts.map((a) => [a.id, a]));
  const stores = new Map(state.stores.filter((s) => !s.deleted).map((s) => [s.id, s]));
  let dr = 0;
  let cr = 0;
  d.lines.forEach((l, i) => {
    const n = i + 1;
    try {
      assertCents(l.debit, `Line ${n} debit`);
      assertCents(l.credit, `Line ${n} credit`);
    } catch (e) {
      errs.push((e as Error).message);
      return;
    }
    if (l.debit < 0 || l.credit < 0) errs.push(`Line ${n}: amounts can't be negative. Move the amount to the other side instead.`);
    if ((l.debit > 0) === (l.credit > 0)) errs.push(`Line ${n}: put an amount in either debit or credit, not both or neither.`);
    const a = accounts.get(l.accountId);
    if (!a) errs.push(`Line ${n}: choose an account.`);
    else if (!a.active) errs.push(`Line ${n}: ${a.number} ${a.name} is inactive. Reactivate it in the chart of accounts or pick another.`);
    if (!stores.has(l.storeId)) errs.push(`Line ${n}: choose a store (use CORP for company-wide items).`);
    dr += l.debit;
    cr += l.credit;
  });
  if (dr !== cr) {
    errs.push(`Debits and credits are off by ${formatMoney(Math.abs(dr - cr), { dollarSign: true })}. Adjust a line so both sides are equal.`);
  }
  const period = state.periods[periodOf(d.date)];
  if (period?.status === 'locked') {
    errs.push(`${periodOf(d.date)} is locked. Unlock it from Close › Periods (with a reason) or date this in an open month.`);
  }
  return errs;
}

function hubFor(state: BooksState): { entityId: ID; store: Store } | null {
  const hub = state.entities.find((e) => e.isHub && !e.deleted);
  if (!hub) return null;
  const store =
    state.stores.find((s) => s.entityId === hub.id && s.kind === 'corporate' && !s.deleted) ??
    state.stores.find((s) => s.entityId === hub.id && !s.deleted);
  return store ? { entityId: hub.id, store } : null;
}

/**
 * When a transaction's lines span more than one entity (e.g. the shared Corporate bank
 * pays an HM11 bill), add due-to / due-from lines so every entity's books balance on their own.
 * Non-hub entities settle against the hub (Corporate).
 */
export function balanceEntities(state: BooksState, lines: Line[], newId: () => ID): Line[] {
  const user = lines.filter((l) => !l.system);
  const storeById = new Map(state.stores.map((s) => [s.id, s]));
  const net = new Map<ID, number>();
  const firstStore = new Map<ID, ID>();
  for (const l of user) {
    const ent = storeById.get(l.storeId)?.entityId;
    if (!ent) continue;
    net.set(ent, (net.get(ent) ?? 0) + lineAmount(l));
    if (!firstStore.has(ent)) firstStore.set(ent, l.storeId);
  }
  if (net.size <= 1) return user;
  const hub = hubFor(state);
  if (!hub) throw new Error('This transaction spans entities but no hub entity is set. Mark Corporate as the hub in Setup › Entities.');
  const out = [...user];
  for (const [ent, n] of net) {
    if (ent === hub.entityId || n === 0) continue;
    const storeId = firstStore.get(ent)!;
    const amt = Math.abs(n);
    if (n > 0) {
      out.push({ id: newId(), accountId: SYS.dueTo, storeId, debit: 0, credit: amt, system: 'intercompany', counterEntityId: hub.entityId, memo: 'Due to Corporate (auto)' });
      out.push({ id: newId(), accountId: SYS.dueFrom, storeId: hub.store.id, debit: amt, credit: 0, system: 'intercompany', counterEntityId: ent, memo: 'Due from store entity (auto)' });
    } else {
      out.push({ id: newId(), accountId: SYS.dueFrom, storeId, debit: amt, credit: 0, system: 'intercompany', counterEntityId: hub.entityId, memo: 'Due from Corporate (auto)' });
      out.push({ id: newId(), accountId: SYS.dueTo, storeId: hub.store.id, debit: 0, credit: amt, system: 'intercompany', counterEntityId: ent, memo: 'Due to store entity (auto)' });
    }
  }
  return out;
}

/** Natural sign of an account: +1 when debits increase it. */
export function normalSign(a: Account): 1 | -1 {
  return a.type === 'asset' || a.type === 'expense' || a.type === 'cogs' || a.type === 'contra_revenue' ? 1 : -1;
}

export function isPnl(a: Account): boolean {
  return a.type === 'revenue' || a.type === 'contra_revenue' || a.type === 'cogs' || a.type === 'expense';
}
