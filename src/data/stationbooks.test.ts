import { describe, expect, it } from 'vitest';
import { importStationBooks, isSnapshot, type SBSnapshot } from './stationbooks';
import { pnl, trialBalance, balanceAsOf } from '../core/reports';
import { fuelOf } from '../core/fuel';

/** A tiny, made-up export in the StationBooks shape (no real data). */
function snap(): SBSnapshot {
  return {
    format: 'stationbooks-export',
    exportedAt: '2026-11-27T12:00:00.000Z',
    meta: {
      stores: { items: [{ id: 'sA', code: 'HM11', name: 'Store A' }, { id: 'sC', code: 'CORP', name: 'Corp', isCorporate: true }, { id: 'sX', code: 'PERS', name: 'Personal', isCorporate: true }] },
      categories: { items: [
        { id: 'gFuel', name: 'Fuel Sales', classification: 'REVENUE', parentId: null },
        { id: 'cReg', name: 'Regular', classification: 'REVENUE', parentId: 'gFuel', isFuel: true },
        { id: 'cCom', name: 'Diesel - COMDATA', classification: 'REVENUE', parentId: 'gFuel', isFuel: true },
        { id: 'gIn', name: 'Inside Sales', classification: 'REVENUE', parentId: null },
        { id: 'cBeer', name: 'Beer', classification: 'REVENUE', parentId: 'gIn' },
        { id: 'gFc', name: 'Fuel COGS', classification: 'COGS', parentId: null },
        { id: 'cFc', name: 'Fuel Purchases', classification: 'COGS', parentId: 'gFc' },
        { id: 'gPay', name: 'Payroll', classification: 'OPERATING_EXPENSE', parentId: null },
        { id: 'cWag', name: 'Wages', classification: 'OPERATING_EXPENSE', parentId: 'gPay' },
        { id: 'gFin', name: 'Financial Expenses', classification: 'OPERATING_EXPENSE', parentId: null },
        { id: 'cCard', name: 'Credit Card / Merchant Fees', classification: 'OPERATING_EXPENSE', parentId: 'gFin' },
      ] },
      vendors: { items: [{ id: 'v1', name: 'Fuel Supplier' }] },
      settings: { company: { name: 'Demo Co', fiscalYearStartMonth: 1 } },
    },
    ledger: [
      { storeId: 'sA', month: '2026-10', txns: [
        { id: 't1', type: 'SALE', amountCents: 1_000_000, categoryId: 'cReg', storeId: 'sA', date: '2026-10-31', gallons: 3000 },
        { id: 't2', type: 'SALE', amountCents: 200_000, categoryId: 'cCom', storeId: 'sA', date: '2026-10-31', gallons: 500 },
        { id: 't3', type: 'SALE', amountCents: 300_000, categoryId: 'cBeer', storeId: 'sA', date: '2026-10-31' },
        { id: 't4', type: 'EXPENSE', amountCents: 900_000, categoryId: 'cFc', storeId: 'sA', date: '2026-10-05', vendorId: 'v1', invoiceNumber: 'INV-1', referenceNumber: 'BOL-9', gallons: 3500, notes: 'Delivered 2026-10-01 · Paid 2026-10-05' },
        { id: 't5', type: 'EXPENSE', amountCents: 150_000, categoryId: 'cWag', storeId: 'sA', date: '2026-10-09', checkNumber: '1001' },
        { id: 't6', type: 'EXPENSE', amountCents: 25_000, categoryId: 'cCard', storeId: 'sA', date: '2026-10-12' },
        { id: 't7', type: 'EXPENSE', amountCents: -5_000, categoryId: 'cCard', storeId: 'sA', date: '2026-10-20', description: 'Fee refund' },
      ] },
      { storeId: 'sX', month: '2026-10', txns: [{ id: 'p1', type: 'EXPENSE', amountCents: 10_000, categoryId: 'cWag', storeId: 'sX', date: '2026-10-02' }] },
    ],
    accounts: { items: [{ id: 'b1', kind: 'BANK', name: 'Operating' }] },
    balances: { items: [{ accountId: 'b1', balanceCents: 4_500_000, date: '2026-10-31' }] },
    parties: { items: [{ id: 'r1', name: 'Related Co', kind: 'RELATED_COMPANY' }] },
  };
}

describe('StationBooks import', () => {
  it('recognizes an export and refuses anything else', () => {
    expect(isSnapshot(snap())).toBe(true);
    expect(isSnapshot({ hello: 1 })).toBe(false);
    expect(() => importStationBooks({} as SBSnapshot)).toThrow(/not a StationBooks export/);
  });

  it('posts every sale and expense, skips other businesses, and the books balance', () => {
    const { state, report } = importStationBooks(snap());
    expect(report.posted).toBe(7);
    expect(report.skippedOtherBusinesses).toEqual([{ code: 'PERS', txns: 1 }]);
    expect(report.from).toBe('2026-10-05');
    expect(trialBalance(state, { asOf: '2026-12-31' }).difference).toBe(0);
    expect(state.source?.kind).toBe('stationbooks');
    expect(state.settings.companyName).toBe('Demo Co');
    expect(state.settings.closeFrom).toBe('2026-11');
  });

  it('the P&L equals StationBooks: sales − expenses per store, with KPI categories on the standard accounts', () => {
    const { state } = importStationBooks(snap());
    const r = pnl(state, { from: '2026-10', to: '2026-10', storeIds: ['st_hm11'] });
    expect(r.netSales.total).toBe(1_500_000);
    expect(r.netIncome.total).toBe(1_500_000 - 900_000 - 150_000 - 25_000 + 5_000);
    const row = (id: string) => r.rows.find((x) => x.account.id === id)?.total;
    expect(row('acct_fuel_regular')).toBe(1_000_000);
    expect(row('acct_wages')).toBe(150_000);
    expect(row('acct_card_fees')).toBe(20_000);
    // Fuel purchases sit on 5000, like any fuel invoice.
    expect(row('acct_cogs_fuel')).toBe(900_000);
    expect(r.salesByLob.fuel.total).toBe(1_200_000);
    expect(r.salesByLob.inside.total).toBe(300_000);
  });

  it('gallons feed the fuel module (Comdata as the truck lane), and the bank snapshot sets Trustmark', () => {
    const { state } = importStationBooks(snap());
    const f = fuelOf(state);
    expect(f.sales).toHaveLength(1);
    expect(f.sales[0]).toMatchObject({ storeId: 'st_hm11', grade: 'regular', gallons: 3000, retail: 1_000_000 });
    expect(f.comdata).toHaveLength(1);
    expect(f.comdata[0]).toMatchObject({ gallons: 500, sales: 200_000 });
    expect(balanceAsOf(state, 'acct_trustmark', '2026-10-31')).toBe(4_500_000);
    expect(state.parties.some((p) => p.name === 'Related Co' && p.type === 'related_company')).toBe(true);
    expect(state.transactions.find((t) => t.docNo === 'INV-1')?.partyId).toBe('sb_v_v1');
  });

  it('fuel purchases with gallons become fuel invoices, split by the month\'s gallon mix at one blended cost', () => {
    const { state, report } = importStationBooks(snap());
    const inv = fuelOf(state).invoices;
    expect(report.fuelInvoices).toBe(1);
    expect(inv[0]).toMatchObject({ invoiceNo: 'INV-1', bolNo: 'BOL-9', deliveredOn: '2026-10-01', total: 900_000, supplier: 'craddock' });
    expect(inv[0].settlement?.kind).toBe('imported');
    // Mix: 3000 gal regular (POS) + 500 diesel (Comdata) → 6/7 regular, 1/7 diesel.
    expect(inv[0].lines.map((l) => l.grade)).toEqual(['regular', 'diesel']);
    expect(inv[0].lines.reduce((a, l) => a + l.netGallons, 0)).toBe(3500);
    expect(inv[0].lines.reduce((a, l) => a + l.cost, 0)).toBe(900_000);
    expect(inv[0].lines[0].netGallons).toBe(3000);
  });
});
