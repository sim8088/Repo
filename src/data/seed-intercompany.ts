import type { SeedCtx } from './seed';
import type { RentTemplate } from '../core/types';
import { recordPartyMovement, type PartyMoveInput } from '../core/intercompany';

const c = (dollars: number) => Math.round(dollars * 100);

/**
 * Rent pass-throughs as recurring templates. The demo's main loop generates them on the 1st of each
 * month through `generateRent`, so the entries are exactly what a person would get from the screen.
 * Round illustrative amounts; real ones are entered as data.
 */
export function rentTemplates(): RentTemplate[] {
  const t = (id: string, storeId: string, partyId: string, amount: number): RentTemplate => ({
    id, storeId, partyId, amount, dayOfMonth: 1, expenseAccountId: 'acct_rent', payableAccountId: 'acct_due_related', startPeriod: '2026-09', active: true, generated: {},
  });
  return [t('rt_hm11', 'st_hm11', 'pt_dhunna', 2_950_000), t('rt_hm13', 'st_hm13', 'pt_dhunna', 1_125_000), t('rt_hm15', 'st_hm15', 'pt_skd', 3_100_000)];
}

/** Related-party activity and limits: each related party ends with a sensible balance, and one is over its limit. */
export function seedIntercompany({ state, books, cfo, setClock }: SeedCtx): void {
  const moves: PartyMoveInput[] = [
    { partyId: 'pt_rowdys', kind: 'paid_bill', date: '2026-09-22', amount: c(1_860), payee: 'Propane supplier' },
    { partyId: 'pt_bullseye', kind: 'loan_out', date: '2026-10-02', amount: c(8_000), memo: 'Short-term working capital loan' },
    { partyId: 'pt_cheers', kind: 'paid_bill', date: '2026-10-14', amount: c(1_480), payee: 'Beer distributor', checkNo: '4201' },
    { partyId: 'pt_rowdys', kind: 'repayment', date: '2026-10-28', amount: c(1_860) },
    { partyId: 'pt_cheers', kind: 'repayment', date: '2026-11-03', amount: c(1_000), settles: 'paidFor' },
    { partyId: 'pt_five_rivers', kind: 'they_paid_for_us', date: '2026-11-04', amount: c(1_200), payee: 'Opening supplies vendor', expenseAccountId: 'acct_supplies', storeId: 'st_hm17' },
    { partyId: 'pt_rowdys', kind: 'paid_bill', date: '2026-11-09', amount: c(940), payee: 'Ice machine repair', checkNo: '4207' },
    { partyId: 'pt_bullseye', kind: 'repayment', date: '2026-11-16', amount: c(2_000), settles: 'loans' },
  ];
  for (const m of moves) {
    setClock(m.date);
    recordPartyMovement(books, cfo, m);
  }
  state.intercompany.limits = {
    pt_dhunna: c(50_000), pt_skd: c(40_000), pt_cheers: c(5_000), pt_southern_eagle: c(7_500), pt_bullseye: c(10_000), pt_rowdys: c(3_000), pt_five_rivers: c(5_000),
  };
}
