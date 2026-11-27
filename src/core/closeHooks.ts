import type { BooksState, ID } from './types';
import { registerCloseEvidence, type Proof } from './close';
import { insideOf, inventoryTie } from './inside';
import { lastDayOfPeriod, shortDate } from './dates';

/**
 * The close checklist's "inventory counted" step, proved by the inside-store counts (phase 7):
 * a posted count dated on or after the 25th of the month, and counts that tie to 1310.
 * Stores with no counts at all stay manual (null).
 */
export function inventoryProof(state: BooksState, storeId: ID, period: string): Proof | null {
  const counts = insideOf(state).counts.filter((c) => c.storeId === storeId && c.status !== 'void');
  if (!counts.length) return null;
  const end = lastDayOfPeriod(period);
  const inWindow = counts.filter((c) => c.status === 'posted' && c.date >= `${period}-25` && c.date <= end).sort((a, b) => b.date.localeCompare(a.date));
  const to = `/inside/inventory?store=${storeId}`;
  if (!inWindow.length) {
    const draft = counts.find((c) => c.status === 'draft' && c.date.startsWith(period));
    return { ok: false, evidence: [], missing: [draft ? `Count of ${shortDate(draft.date)} is saved but not posted` : 'No count posted in the last week of the month'], to };
  }
  const tie = inventoryTie(state, storeId, end);
  const evidence = [`Count posted ${shortDate(inWindow[0].date)}`];
  if (tie.ok) evidence.push('Counts tie to 1310 at month end');
  return { ok: tie.ok, evidence, missing: tie.ok ? [] : ['Counts do not tie to 1310 at month end'], to };
}

let registered = false;
/** Wire the phase 7 counts into the phase 8 close. Safe to call more than once. */
export function registerCloseHooks(): void {
  if (registered) return;
  registerCloseEvidence('inventory', inventoryProof);
  registered = true;
}
