import type { SeedCtx } from './seed';
import { ensureCompass, recordCompass } from '../core/compass';

/**
 * Growth compass demo: default assumptions and September's verdict, recorded from these books on 8 October (the
 * snapshot keeps what the books said that day). October is left for the CFO to record, so the inbox asks for it and
 * compares it with September.
 */
export function seedCompass({ books, cfo, setClock }: SeedCtx): void {
  ensureCompass(books);
  setClock('2026-10-08');
  recordCompass(books, cfo, '2026-10-08');
  setClock('2026-11-09'); // where the growth seed left the clock
}
