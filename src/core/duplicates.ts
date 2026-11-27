import type { Transaction, ID } from './types';
import { daysBetween } from './dates';

export function txnTotal(t: Transaction): number {
  let s = 0;
  for (const l of t.lines) if (!l.system) s += l.debit;
  return s;
}

export interface DuplicatePair {
  a: Transaction;
  b: Transaction;
  days: number;
}

/**
 * Possible duplicates: same total, same party (or same description when there is no party), same debit accounts,
 * dated within ±3 days of each other. Pairs the user dismissed are skipped.
 */
/** Clusters larger than this are recurring charges, not double entries. */
export const MAX_CLUSTER = 3;

export function findDuplicates(txns: Transaction[], dismissed: Set<string> = new Set(), windowDays = 3): DuplicatePair[] {
  const live = txns.filter((t) => !t.deleted && t.kind !== 'opening');
  const buckets = new Map<string, Transaction[]>();
  for (const t of live) {
    const who = t.partyId ?? 'd:' + t.description.trim().toUpperCase();
    // Same total, same payee (or description) and the same accounts on the debit side: generic bank or QuickBooks
    // descriptions ("QuickBooks Expense") alone would pair unrelated same-amount items.
    const accts = [...new Set(t.lines.filter((l) => !l.system && l.debit > 0).map((l) => l.accountId))].sort().join(',');
    const key = `${txnTotal(t)}|${who}|${accts}`;
    const arr = buckets.get(key);
    if (arr) arr.push(t);
    else buckets.set(key, [t]);
  }
  const out: DuplicatePair[] = [];
  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    arr.sort((x, y) => x.date.localeCompare(y.date));
    // Split into clusters of items no more than `windowDays` apart. A double entry looks like a cluster of 2
    // (or 3); a longer run of identical items is a recurring charge (e.g. a day of overdraft fees), not a duplicate.
    const clusters: Transaction[][] = [];
    for (const t of arr) {
      const last = clusters.at(-1);
      if (last && daysBetween(last[last.length - 1].date, t.date) <= windowDays) last.push(t);
      else clusters.push([t]);
    }
    for (const c of clusters) {
      if (c.length < 2 || c.length > MAX_CLUSTER) continue;
      for (let i = 0; i < c.length; i++) {
        for (let j = i + 1; j < c.length; j++) {
          if (dismissed.has(pairKey(c[i].id, c[j].id))) continue;
          out.push({ a: c[i], b: c[j], days: daysBetween(c[i].date, c[j].date) });
        }
      }
    }
  }
  return out;
}

export function pairKey(a: ID, b: ID): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
