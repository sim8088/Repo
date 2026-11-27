import type { SeedCtx } from './seed';
import { addScorecardNote, saveReport } from '../core/statements';

/** Phase 4 demo: two saved reports (one with a monthly cadence) and scorecard notes. Posts nothing to the books. */
export function seedReports({ books, cfo, setClock }: SeedCtx): void {
  setClock('2026-11-02');
  saveReport(books, cfo, {
    name: 'Fuel vs inside by month', rows: ['group:sales:fuel', 'group:cogs:fuel', 'group:sales:inside', 'group:cogs:inside', 'group:net'],
    columns: 'month', basis: 'accrual', from: '2026-09', to: '2026-11', storeIds: [], schedule: { cadence: 'monthly', note: 'For the owners, first Monday of the month.' },
  });
  saveReport(books, cfo, {
    name: 'Labor and card fees by store', rows: ['group:labor', 'acct:acct_card_fees', 'acct:acct_network_fees', 'group:sales'],
    columns: 'store', basis: 'booked', from: '2026-11', to: '2026-11', storeIds: [],
  });
  setClock('2026-11-26');
  addScorecardNote(books, cfo, { storeId: 'st_hm17', period: '2026-11', text: 'Opened 1 Nov. Fuel priced low on purpose to build traffic; review the price in December.' });
  addScorecardNote(books, cfo, { storeId: 'st_hm13', period: '2026-11', text: 'Premium tank losing gallons since 8 Nov; leak check booked.' });
}
