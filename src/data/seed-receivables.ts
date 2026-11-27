import type { SeedCtx } from './seed';
import type { ReceivableItem, RentSchedule } from '../core/types';
import { linkReceipt, recordReceivableReceipt, recordRentReceipt, saveReceivable, saveRentSchedule } from '../core/receivables';

const c = (dollars: number) => Math.round(dollars * 100);

/** Tenant rent schedules (one tenant late for November), rebates and programs outstanding, an insurance claim and a refund owed to us. */
export function seedReceivables({ state, books, cfo, setClock }: SeedCtx): void {
  state.parties.push({ id: 'pt_laundry', name: 'Laundromat (tenant)', type: 'tenant', defaultStoreId: 'st_hm13', notes: 'Leases the side unit at HM13 (demo).' });
  setClock('2026-09-01');
  const sched = (id: string, tenantId: string, storeId: string, dollars: number, dueDay: number): RentSchedule => ({ id, tenantId, storeId, amount: c(dollars), dueDay, graceDays: 5, startPeriod: '2026-09', active: true });
  for (const s of [
    sched('rs_taco', 'pt_taco_feliz', 'st_hm11', 2_800, 1), sched('rs_mavs', 'pt_mavs', 'st_hm11', 650, 1),
    sched('rs_gulfport', 'pt_gulfport_op', 'st_hm14', 8_500, 1), sched('rs_laundry', 'pt_laundry', 'st_hm13', 1_100, 1),
  ]) saveRentSchedule(books, cfo, s);
  // The laundromat paid September and October; November is late.
  for (const date of ['2026-09-04', '2026-10-06']) {
    setClock(date);
    recordRentReceipt(books, cfo, { tenantId: 'pt_laundry', date, amount: c(1_100) });
  }

  const item = (id: string, kind: ReceivableItem['kind'], payer: string, storeId: string, description: string, expected: number, expectedBy: string, incomeAccountId: string, createdAt: string): ReceivableItem => ({
    id, kind, payer, storeId, description, expected: c(expected), expectedBy, incomeAccountId, receipts: [], createdAt: createdAt + 'T15:00:00.000Z',
  });
  const items = [
    item('ar_reynolds_q3', 'rebate', 'Reynolds', 'st_corp', 'Q3 scan-data rebate', 3_240.6, '2026-10-31', 'acct_rebates', '2026-10-01'),
    item('ar_itg_q3', 'rebate', 'ITG', 'st_corp', 'Q3 scan-data rebate', 1_180, '2026-11-15', 'acct_rebates', '2026-10-01'),
    item('ar_vicksburg', 'rebate', 'Vicksburg', 'st_corp', 'Distributor volume rebate', 940.15, '2026-11-30', 'acct_rebates', '2026-10-15'),
    item('ar_clark_q4', 'rebate', 'Clark', 'st_corp', 'Q4 display program', 600, '2027-01-15', 'acct_rebates', '2026-11-01'),
    item('ar_ins_hm15', 'insurance', 'Property & liability insurer', 'st_hm15', 'Walk-in cooler compressor failure claim', 2_400, '2026-12-15', 'acct_other_income', '2026-10-30'),
    item('ar_gas_refund', 'refund', 'Natural gas utility (demo)', 'st_hm15', 'Overpaid service deposit refund', 350, '2026-11-30', 'acct_other_income', '2026-11-05'),
  ];
  items[4].partyId = 'pt_insurer';
  items[5].partyId = 'pt_gas';
  for (const it of items) {
    setClock(it.createdAt.slice(0, 10));
    saveReceivable(books, cfo, it);
  }
  const reynolds = state.transactions.find((t) => t.description === 'ACH CREDIT REYNOLDS AMERICAN REBATE');
  if (reynolds) { setClock('2026-10-22'); linkReceipt(books, cfo, 'ar_reynolds_q3', reynolds.id); }
  setClock('2026-11-20');
  recordReceivableReceipt(books, cfo, 'ar_ins_hm15', { date: '2026-11-20', amount: c(1_000) });
}
