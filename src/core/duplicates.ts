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
 * Possible duplicates: same total, same party (or same description when there is no party),
 * dated within ±3 days of each other. Pairs the user dismissed are skipped.
 */
export function findDuplicates(txns: Transaction[], dismissed: Set<string> = new Set(), windowDays = 3): DuplicatePair[] {
  const live = txns.filter((t) => !t.deleted && t.kind !== 'opening');
  const buckets = new Map<string, Transaction[]>();
  for (const t of live) {
    const who = t.partyId ?? 'd:' + t.description.trim().toUpperCase();
    const key = `${txnTotal(t)}|${who}`;
    const arr = buckets.get(key);
    if (arr) arr.push(t);
    else buckets.set(key, [t]);
  }
  const out: DuplicatePair[] = [];
  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    arr.sort((x, y) => x.date.localeCompare(y.date));
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const days = daysBetween(arr[i].date, arr[j].date);
        if (days > windowDays) break;
        if (dismissed.has(pairKey(arr[i].id, arr[j].id))) continue;
        out.push({ a: arr[i], b: arr[j], days });
      }
    }
  }
  return out;
}

export function pairKey(a: ID, b: ID): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
