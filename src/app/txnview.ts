import type { BooksState, Transaction, Line, Account } from '../core/types';
import { txnTotal } from '../core/duplicates';

const MONEY_SUBTYPES = new Set(['bank', 'cash', 'clearing']);

/** The "category" side of a transaction: lines that aren't the bank / cash / clearing side and aren't auto lines. */
export function categoryLines(t: Transaction, acc: Map<string, Account>): Line[] {
  const user = t.lines.filter((l) => !l.system);
  const cat = user.filter((l) => !MONEY_SUBTYPES.has(acc.get(l.accountId)?.subtype ?? ''));
  return cat.length ? cat : user;
}

export function moneyLine(t: Transaction, acc: Map<string, Account>): Line | undefined {
  return t.lines.find((l) => !l.system && MONEY_SUBTYPES.has(acc.get(l.accountId)?.subtype ?? ''));
}

export function categoryLabel(t: Transaction, acc: Map<string, Account>): string {
  const cat = categoryLines(t, acc);
  const ids = [...new Set(cat.map((l) => l.accountId))];
  if (ids.length === 1) return acc.get(ids[0])?.name ?? '—';
  return `Split · ${ids.length} accounts`;
}

export function storeLabel(t: Transaction, state: BooksState): string {
  const codes = [...new Set(t.lines.filter((l) => !l.system).map((l) => state.stores.find((s) => s.id === l.storeId)?.code ?? '?'))];
  const nonCorp = codes.filter((c) => c !== 'CORP');
  if (nonCorp.length === 0) return 'CORP';
  return nonCorp.length > 3 ? `${nonCorp.length} stores` : nonCorp.join(', ');
}

/** Signed amount from the bank's point of view: money in positive, money out negative. */
export function signedAmount(t: Transaction, acc: Map<string, Account>): number {
  const m = moneyLine(t, acc);
  const total = txnTotal(t);
  if (!m) return total;
  return m.debit > 0 ? total : -total;
}
