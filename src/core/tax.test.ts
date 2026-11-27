import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import { saveAsset, type AssetDraft } from './assets';
import { PermissionError } from './permissions';
import { unzip } from './xlsx';
import { balanceAsOf, trialBalance } from './reports';
import { ownerDraws } from './intercompany';
import {
  adjustments, basisRollForward, bookToTax, bookVsTax, distributionCapacity, estimateStatus, estimatesDueSoon, grossReceiptsTest, k1Allocation, m2, macrsTable, maskEin,
  midQuarterTest, methodsPanel, ownerBasis, planning, projectTaxable, recordEstimatePayment, remitPeriod, returnUnits, reviewAdjustment, salesTaxPeriod, salesTaxTie,
  saveAdjustment, saveAssetTax, saveEstimatePlan, saveTaxProfile, saveTaxRates, setLever, setOwnerStart, setPriorIncome, setReceipts, slMidMonthTable, slTable, taxCalendar,
  taxDistributions, taxInbox, taxSchedule, removeAdjustment,
} from './tax';
import { cpaPackage, cpaPackageZip } from './taxPackage';
import type { User } from './types';

const T = '2026-11-27';
const setup = () => {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  const cfo = s.users.find((x) => x.id === CFO_ID)!;
  const u = (role: User['role']) => s.users.find((x) => x.role === role)!;
  b.createTransaction(cfo, { date: '2026-01-01', kind: 'opening', description: 'Opening', lines: [
    { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 50_000_000, credit: 0 }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: 0, credit: 50_000_000 }] });
  return { s, b, cfo, u };
};
const equip = (over: Partial<AssetDraft> = {}): AssetDraft => ({
  name: 'Dispensers', class: 'dispensers', storeId: 'st_hm11', costAccountId: 'acct_equipment', cost: 10_000_000, salvage: 0, inService: '2026-03-01', lifeMonths: 120, method: 'straight_line', ...over,
});
const sale = (b: Books, cfo: User, date: string, store: string, taxable: number, tax: number, fuel = 0) => b.createTransaction(cfo, {
  date, kind: 'journal', description: 'POS daily close', tags: ['pos'], lines: [
    { accountId: 'acct_cash_registers', storeId: store, debit: taxable + tax + fuel, credit: 0 },
    { accountId: 'acct_sales_grocery', storeId: store, debit: 0, credit: taxable },
    ...(fuel ? [{ accountId: 'acct_fuel_regular', storeId: store, debit: 0, credit: fuel }] : []),
    { accountId: 'acct_sales_tax', storeId: store, debit: 0, credit: tax },
  ] });

// ── MACRS tables against IRS Pub 946 ────────────────────────────────────
describe('MACRS percentage tables (Pub 946, Table A-1 to A-5 and A-7a)', () => {
  it('half-year: 5, 7 and 15-year match the published tables and add to 100%', () => {
    expect(macrsTable(5, 'half_year')).toEqual([20, 32, 19.2, 11.52, 11.52, 5.76]);
    expect(macrsTable(7, 'half_year')).toEqual([14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46]);
    expect(macrsTable(15, 'half_year')).toEqual([5, 9.5, 8.55, 7.7, 6.93, 6.23, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 2.95]);
    expect(macrsTable(3, 'half_year')).toEqual([33.33, 44.45, 14.81, 7.41]);
    for (const y of [3, 5, 7, 15]) expect(Math.round(macrsTable(y, 'half_year').reduce((a, b) => a + b, 0) * 100)).toBe(10_000);
  });
  it('mid-quarter: 5-year in each quarter, 7-year Q1 and Q4, 15-year Q1 and Q4', () => {
    expect(macrsTable(5, 'mid_quarter', 1)).toEqual([35, 26, 15.6, 11.01, 11.01, 1.38]);
    expect(macrsTable(5, 'mid_quarter', 2)).toEqual([25, 30, 18, 11.37, 11.37, 4.26]);
    expect(macrsTable(5, 'mid_quarter', 3)).toEqual([15, 34, 20.4, 12.24, 11.3, 7.06]);
    expect(macrsTable(5, 'mid_quarter', 4)).toEqual([5, 38, 22.8, 13.68, 10.94, 9.58]);
    expect(macrsTable(7, 'mid_quarter', 1)).toEqual([25, 21.43, 15.31, 10.93, 8.75, 8.74, 8.75, 1.09]);
    expect(macrsTable(7, 'mid_quarter', 4)).toEqual([3.57, 27.55, 19.68, 14.06, 10.04, 8.73, 8.73, 7.64]);
    expect(macrsTable(15, 'mid_quarter', 1)).toEqual([8.75, 9.13, 8.21, 7.39, 6.65, 5.99, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 0.74]);
    expect(macrsTable(15, 'mid_quarter', 4)).toEqual([1.25, 9.88, 8.89, 8, 7.2, 6.48, 5.9, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.17]);
  });
  it('39-year nonresidential real property, mid-month', () => {
    const jan = slMidMonthTable(39, 1), feb = slMidMonthTable(39, 2), jul = slMidMonthTable(39, 7), dec = slMidMonthTable(39, 12);
    expect([jan[0], jan[1], jan[38], jan[39]]).toEqual([2.461, 2.564, 2.564, 0.107]);
    expect([feb[0], feb[39]]).toEqual([2.247, 0.321]);
    expect([jul[0], jul[39]]).toEqual([1.177, 1.391]);
    expect([dec[0], dec[39]]).toEqual([0.107, 2.461]);
    expect(jan).toHaveLength(40);
    expect(Math.round(jan.reduce((a, b) => a + b, 0) * 1000)).toBe(100_000);
    expect(() => macrsTable(9, 'half_year')).toThrow();
    expect(slTable(5, 'half_year')).toEqual([10, 20, 20, 20, 20, 10]);
  });
});

// ── §179 and bonus ──────────────────────────────────────────────────────
describe('§179 and bonus', () => {
  it('takes §179 first, bonus on what is left, then MACRS on the rest; the schedule adds to cost', () => {
    const { s, b, cfo } = setup();
    const a = saveAsset(b, cfo, equip());
    saveAssetTax(b, cfo, a.id, { method: 'macrs', recoveryYears: 5, section179: 2_000_000, bonusPct: 50, convention: 'half_year' });
    const sch = taxSchedule(s, a);
    expect(sch[0]).toMatchObject({ year: 2026, section179: 2_000_000, bonus: 4_000_000, regular: 800_000, total: 6_800_000 });
    expect(sch.map((r) => r.regular)).toEqual([800_000, 1_280_000, 768_000, 460_800, 460_800, 230_400]);
    expect(sch.at(-1)!.accumulated).toBe(10_000_000);
    expect(sch.at(-1)!.taxBasisLeft).toBe(0);
  });
  it('refuses §179 over cost or on a building, bonus on 39-year property, and roles without tax.edit', () => {
    const { b, cfo, u } = setup();
    const a = saveAsset(b, cfo, equip());
    const bl = saveAsset(b, cfo, equip({ name: 'Building', class: 'building', costAccountId: 'acct_buildings', lifeMonths: 468 }));
    expect(() => saveAssetTax(b, cfo, a.id, { method: 'macrs', section179: 20_000_000 })).toThrow(ValidationError);
    expect(() => saveAssetTax(b, cfo, bl.id, { method: 'macrs', section179: 100_000 })).toThrow(/not allowed on buildings/);
    expect(() => saveAssetTax(b, cfo, bl.id, { method: 'macrs', bonusPct: 100 })).toThrow(/Bonus is not allowed/);
    expect(() => saveAssetTax(b, cfo, a.id, { method: 'macrs', recoveryYears: 6 })).toThrow(/recovery period/);
    expect(() => saveAssetTax(b, u('owner'), a.id, { method: 'macrs', bonusPct: 100 })).toThrow(PermissionError);
    // QIP is 15-year and bonus-eligible.
    saveAssetTax(b, cfo, bl.id, { method: 'macrs', qip: true, bonusPct: 100 });
  });
  it('a 39-year building is straight line mid-month; land is not depreciated', () => {
    const { s, b, cfo } = setup();
    const bl = saveAsset(b, cfo, equip({ name: 'Building', class: 'building', costAccountId: 'acct_buildings', lifeMonths: 468, cost: 39_000_000, inService: '2026-01-10' }));
    expect(taxSchedule(s, bl)[0].total).toBe(Math.round(39_000_000 * 0.02461));
    const land = saveAsset(b, cfo, equip({ name: 'Land', class: 'land', costAccountId: 'acct_buildings', lifeMonths: 0, method: 'none' }));
    expect(taxSchedule(s, land)).toEqual([]);
  });
  it('the mid-quarter test: over 40% of the year\'s basis in Q4 moves every asset that year to mid-quarter', () => {
    const { s, b, cfo } = setup();
    const a = saveAsset(b, cfo, equip({ cost: 3_000_000, inService: '2026-02-01' }));
    const c = saveAsset(b, cfo, equip({ cost: 7_000_000, inService: '2026-11-01' }));
    const mq = midQuarterTest(s, 'ent_corp', 2026);
    expect(mq.share).toBeCloseTo(0.7);
    expect(mq.applies).toBe(true);
    expect(taxSchedule(s, a)[0].regular).toBe(1_050_000); // 35% (Q1)
    expect(taxSchedule(s, c)[0].regular).toBe(350_000); // 5% (Q4)
    // §179 on the Q4 asset takes it out of the test.
    saveAssetTax(b, cfo, c.id, { method: 'macrs', section179: 7_000_000 });
    expect(midQuarterTest(s, 'ent_corp', 2026).applies).toBe(false);
    expect(taxSchedule(s, a)[0].regular).toBe(600_000); // 20% half-year
  });
});

// ── Book vs tax and the M-1 ─────────────────────────────────────────────
describe('book vs tax and Schedule M-1', () => {
  it('the depreciation difference is book − tax and feeds the M-1; M-1 line 8 ties book income to taxable income', () => {
    const { s, b, cfo } = setup();
    const a = saveAsset(b, cfo, equip({ inService: '2026-01-01' }));
    saveAssetTax(b, cfo, a.id, { method: 'macrs', recoveryYears: 5, bonusPct: 0, convention: 'half_year' });
    b.createTransaction(cfo, { date: '2026-06-30', kind: 'journal', description: 'Book depreciation Jan–Jun', lines: [
      { accountId: 'acct_depreciation', storeId: 'st_hm11', debit: 500_000, credit: 0 }, { accountId: 'acct_accum_dep', storeId: 'st_hm11', debit: 0, credit: 500_000 }] });
    const bt = bookVsTax(s, { year: 2026, asOf: '2026-07-15' });
    expect(bt[0].book).toBe(500_000); // 6 months of 120
    expect(bt[0].tax.total).toBe(2_000_000);
    expect(bt[0].difference).toBe(-1_500_000);
    // Meals, a penalty and some sales.
    b.createTransaction(cfo, { date: '2026-03-02', kind: 'money_out', description: 'Meal', lines: [{ accountId: 'acct_meals', storeId: 'st_corp', debit: 100_001, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 100_001 }] });
    b.createTransaction(cfo, { date: '2026-03-03', kind: 'money_out', description: 'Penalty', lines: [{ accountId: 'acct_penalties', storeId: 'st_corp', debit: 25_000, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 25_000 }] });
    sale(b, cfo, '2026-03-04', 'st_hm11', 5_000_000, 350_000);
    setPriorIncome(b, cfo, { entityId: 'ent_corp', year: 2026, priorIncome: 1_000_000 });
    saveAdjustment(b, cfo, { entityId: 'ent_corp', year: 2026, kind: 'other', mode: 'manual', label: 'Officer life insurance', amount: 40_000, workpaper: 'Premiums on a policy the company benefits from: not deductible.' });
    const r = bookToTax(s, 'ent_hm11', 2026, '2026-07-15'); // a disregarded store resolves to the CORP return
    expect(r.unit.entity.id).toBe('ent_corp');
    const byKind = Object.fromEntries(r.adjustments.map((x) => [x.kind, x.amount]));
    expect(byKind).toMatchObject({ depreciation: -1_500_000, meals: 50_001, penalties: 25_000, owner: 0, accrual_to_cash: 0, other: 40_000 });
    expect(r.ytdBook).toBe(5_000_000 - 500_000 - 100_001 - 25_000);
    expect(r.bookIncome).toBe(r.ytdBook + 1_000_000);
    expect(r.tbNetIncome).toBe(r.ytdBook);
    expect(r.m1.line3a).toBe(0);
    expect(r.m1.line6a).toBe(1_500_000);
    expect(r.m1.line3b).toBe(50_001);
    expect(r.m1.line3c).toBe(65_000);
    expect(r.m1.line8).toBe(r.bookIncome + 50_001 + 65_000 - 1_500_000);
    expect(r.m1Ties).toBe(true);
    expect(r.taxableIncome).toBe(r.m1.line8);
    expect(r.depTie.ok).toBe(true);
  });
  it('owner withdrawals booked to expense come back out; a cash-method return carries the accrual-to-cash adjustment', () => {
    const { s, b, cfo } = setup();
    b.createTransaction(cfo, { date: '2026-04-01', kind: 'money_out', description: 'Owner A', partyId: 'pt_owner_a', lines: [{ accountId: 'acct_misc', storeId: 'st_corp', debit: 300_000, credit: 0, partyId: 'pt_owner_a' }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 300_000 }] });
    expect(adjustments(s, 'ent_corp', 2026, T).find((x) => x.kind === 'owner')!.amount).toBe(300_000);
    saveTaxProfile(b, cfo, { entityId: 'ent_corp', owners: [], states: [], fiscalYearEndMonth: 12, priorReturns: [], method: 'cash', inventoryMethod: 'fifo' });
    expect(adjustments(s, 'ent_corp', 2026, T).find((x) => x.kind === 'accrual_to_cash')!.basis).toMatch(/Cash-basis income/);
  });
  it('workpapers: manual ones need a label, amount and notes; review clears on edit; removal is soft and needs a reason', () => {
    const { s, b, cfo, u } = setup();
    expect(() => saveAdjustment(b, cfo, { entityId: 'ent_corp', year: 2026, kind: 'other', mode: 'manual', workpaper: '' })).toThrow(ValidationError);
    const x = saveAdjustment(b, cfo, { entityId: 'ent_corp', year: 2026, kind: 'other', mode: 'manual', label: 'Tax-exempt interest', amount: -10_000, m1Line: 'income_not_taxed', workpaper: 'Municipal bond interest.' });
    expect(() => reviewAdjustment(b, cfo, 'ent_corp', 2026, x.id)).toThrow(/other than the preparer/);
    reviewAdjustment(b, u('bookkeeper'), 'ent_corp', 2026, x.id);
    expect(x.reviewed?.by).toBe('usr_bk');
    expect(bookToTax(s, 'ent_corp', 2026, T).m1.line5).toBe(10_000);
    saveAdjustment(b, cfo, { id: x.id, entityId: 'ent_corp', year: 2026, kind: 'other', mode: 'manual', label: 'Tax-exempt interest', amount: -12_000, m1Line: 'income_not_taxed', workpaper: 'Corrected.' });
    expect(x.reviewed).toBeUndefined();
    expect(() => removeAdjustment(b, cfo, x.id, '')).toThrow(ValidationError);
    removeAdjustment(b, cfo, x.id, 'Not ours');
    expect(adjustments(s, 'ent_corp', 2026, T).some((r) => r.key === x.id)).toBe(false);
    expect(s.tax!.adjustments.find((a) => a.id === x.id)?.removed?.reason).toBe('Not ours');
    expect(() => saveAdjustment(b, u('reviewer'), { entityId: 'ent_corp', year: 2026, kind: 'meals', mode: 'auto', workpaper: 'x' })).toThrow(PermissionError);
  });
});

// ── Sales tax ────────────────────────────────────────────────────────────
describe('sales tax', () => {
  it('taxable POS sales (fuel excluded) × rate vs 2200 collected vs remitted; flags the variance and ties to 2200', () => {
    const { s, b, cfo } = setup();
    sale(b, cfo, '2026-10-02', 'st_hm11', 1_000_000, 70_000, 2_000_000);
    sale(b, cfo, '2026-10-03', 'st_hm11', 500_000, 35_000);
    b.createTransaction(cfo, { date: '2026-11-19', kind: 'money_out', description: 'ACH STATE SALES TAX', memo: 'Sales tax for 2026-10', tags: ['sales tax'], lines: [
      { accountId: 'acct_sales_tax', storeId: 'st_hm11', debit: 100_000, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 100_000 }] });
    const p = salesTaxPeriod(s, '2026-10', { today: '2026-11-25' });
    const r = p.rows.find((x) => x.storeId === 'st_hm11')!;
    expect(r).toMatchObject({ posSales: 3_500_000, fuelSales: 2_000_000, taxableSales: 1_500_000, expectedTax: 105_000, collected: 105_000, variance: 0, remitted: 100_000, unremitted: 5_000 });
    expect(p.settled).toBe(true); // past the 20th
    expect(p.remitFlag).toBe(true);
    expect(p.varianceFlag).toBe(false);
    expect(salesTaxTie(s, T)).toMatchObject({ collected: 105_000, remitted: 100_000, ledger: 5_000, ok: true });
    // Fuel taxable is configurable.
    saveTaxRates(b, cfo, { fuelTaxable: true });
    expect(salesTaxPeriod(s, '2026-10', { today: T }).rows[0].taxableSales).toBe(3_500_000);
    // Before the due date nothing is expected to be remitted.
    expect(salesTaxPeriod(s, '2026-10', { today: '2026-11-05' }).remitFlag).toBe(false);
  });
  it('a remittance pays the month named in its memo, else the month before it', () => {
    const t = { memo: 'Sales tax for 2026-09', description: 'ACH', date: '2026-10-19' } as never;
    expect(remitPeriod(t)).toBe('2026-09');
    expect(remitPeriod({ description: 'ACH', date: '2026-01-19' } as never)).toBe('2025-12');
  });
});

// ── Methods ──────────────────────────────────────────────────────────────
describe('gross-receipts test and methods', () => {
  it('averages the three prior years (entered + books) across every entity against the threshold', () => {
    const { s, b, cfo, u } = setup();
    setReceipts(b, cfo, { entityId: 'ent_corp', year: 2023, receipts: 2_000_000_000 });
    setReceipts(b, cfo, { entityId: 'ent_hm14', year: 2023, receipts: 100_000_000 });
    setReceipts(b, cfo, { entityId: 'ent_corp', year: 2024, receipts: 3_000_000_000 });
    setReceipts(b, cfo, { entityId: 'ent_corp', year: 2025, receipts: 4_000_000_000 });
    const t = grossReceiptsTest(s, 2026);
    expect(t.average).toBe(Math.round((2_100_000_000 + 3_000_000_000 + 4_000_000_000) / 3));
    expect(t.passes).toBe(true);
    expect(methodsPanel(s, 2026).rows.find((r) => r.entity.id === 'ent_corp')!.unicap).toMatch(/Exempt/);
    saveTaxRates(b, cfo, { grossReceiptsThreshold: 2_500_000_000 });
    expect(grossReceiptsTest(s, 2026).passes).toBe(false);
    expect(methodsPanel(s, 2026).rows.find((r) => r.entity.id === 'ent_corp')!.unicap).toMatch(/Applies/);
    expect(grossReceiptsTest(s, 2030).missing).toEqual([2027, 2028, 2029]);
    expect(() => setReceipts(b, u('store_manager'), { entityId: 'ent_corp', year: 2025, receipts: 1 })).toThrow(PermissionError);
  });
});

// ── Estimates ────────────────────────────────────────────────────────────
describe('estimated taxes', () => {
  const plan = (b: Books, cfo: User, over: Record<string, unknown> = {}) => saveEstimatePlan(b, cfo, {
    payer: 'owner', partyId: 'pt_owner_a', jurisdiction: 'federal', year: 2026, dueDates: ['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15'], priorYearTax: 4_000_000, highIncome: false, entityIds: ['ent_corp'], ...over,
  });
  it('the required payment is the smaller of 90% of this year and 100% / 110% of last year, in four installments', () => {
    const { s, b, cfo } = setup();
    saveTaxProfile(b, cfo, { entityId: 'ent_corp', owners: [{ partyId: 'pt_owner_a', pctBps: 10_000 }], states: [], fiscalYearEndMonth: 12, priorReturns: [], method: 'accrual', inventoryMethod: 'fifo' });
    sale(b, cfo, '2026-03-01', 'st_hm11', 50_000_000, 3_500_000);
    const p = plan(b, cfo);
    const st = estimateStatus(s, p, '2026-06-30');
    const proj = projectTaxable(s, 'ent_corp', 2026, '2026-06-30').projected;
    expect(st.projectedIncome).toBe(proj);
    expect(st.projectedTax).toBe(Math.round(proj * 0.37));
    expect(st.safeHarbor).toBe(4_000_000);
    expect(st.required).toBe(Math.min(st.currentYearBasis, 4_000_000));
    expect(st.installments.map((i) => i.required).reduce((a, x) => a + x, 0)).toBe(st.required);
    const hi = estimateStatus(s, plan(b, cfo, { highIncome: true }), '2026-06-30');
    expect(hi.safeHarbor).toBe(4_400_000);
    expect(hi.safeHarborPct).toBe(110);
  });
  it('payments carry forward; due within 14 days reaches the list; entity payments post through the ledger', () => {
    const { s, b, cfo, u } = setup();
    saveTaxProfile(b, cfo, { entityId: 'ent_corp', owners: [{ partyId: 'pt_owner_a', pctBps: 10_000 }], states: [], fiscalYearEndMonth: 12, priorReturns: [], method: 'accrual', inventoryMethod: 'fifo' });
    sale(b, cfo, '2026-02-01', 'st_hm11', 10_000_000, 700_000);
    const p = plan(b, cfo, { priorYearTax: 400_000 }); // $1,000 a quarter on the safe harbor
    expect(estimateStatus(s, p, '2026-04-05').installments[0].required).toBe(100_000);
    expect(estimateStatus(s, p, '2026-04-05').method).toBe('safe_harbor');
    recordEstimatePayment(b, cfo, { planId: p.id, quarter: 1, date: '2026-04-10', amount: 200_000, paidBy: 'owner' });
    const st = estimateStatus(s, p, '2026-06-05');
    expect(st.installments[0].done && st.installments[1].done).toBe(true); // Q1 overpayment covers Q2
    expect(estimatesDueSoon(s, '2026-09-05').map((d) => d.inst.quarter)).toEqual([3]);
    expect(estimatesDueSoon(s, '2026-08-01')).toEqual([]);
    expect(s.transactions).toHaveLength(2); // paid personally: nothing posted
    const pay = recordEstimatePayment(b, cfo, { planId: p.id, quarter: 3, date: '2026-09-14', amount: 100_000, paidBy: 'entity', entityId: 'ent_corp', confirmation: 'EFT-1' });
    const tx = s.transactions.find((t) => t.id === pay.txnId)!;
    expect(tx.tags).toContain('tax distribution');
    expect(tx.lines.find((l) => l.debit)).toMatchObject({ accountId: 'acct_misc', partyId: 'pt_owner_a', debit: 100_000 });
    expect(ownerDraws(s, { from: '2026-01-01', to: T }).byOwner.get('pt_owner_a')).toBe(100_000);
    expect(balanceAsOf(s, 'acct_trustmark', T)).toBe(50_000_000 - 100_000);
    // Under the draw policy it posts to 3100; an entity's own estimate posts to 6250.
    s.settings.ownerWithdrawalPolicy = 'draw';
    const p2 = recordEstimatePayment(b, cfo, { planId: p.id, quarter: 4, date: '2026-12-01', amount: 100_000, paidBy: 'entity' });
    expect(s.transactions.find((t) => t.id === p2.txnId)!.lines.find((l) => l.debit)!.accountId).toBe('acct_owner_draws');
    const pe = saveEstimatePlan(b, cfo, { payer: 'entity', entityId: 'ent_corp', jurisdiction: 'state', year: 2026, dueDates: ['2026-04-15', '2026-06-15', '2026-09-15', '2026-12-15'], priorYearTax: 0, highIncome: false, entityIds: ['ent_corp'] });
    const p3 = recordEstimatePayment(b, cfo, { planId: pe.id, quarter: 1, date: '2026-04-15', amount: 50_000, paidBy: 'entity' });
    expect(s.transactions.find((t) => t.id === p3.txnId)!.lines.find((l) => l.debit)!.accountId).toBe('acct_income_taxes');
    expect(() => recordEstimatePayment(b, cfo, { planId: pe.id, quarter: 2, date: '2026-06-15', amount: 50_000, paidBy: 'owner' })).toThrow(ValidationError);
    expect(() => recordEstimatePayment(b, cfo, { planId: p.id, quarter: 5, date: 'x', amount: 0, paidBy: 'owner' })).toThrow(ValidationError);
    expect(() => recordEstimatePayment(b, u('reviewer'), { planId: p.id, quarter: 1, date: '2026-04-10', amount: 1, paidBy: 'owner' })).toThrow(PermissionError);
    expect(() => saveEstimatePlan(b, cfo, { payer: 'owner', partyId: 'pt_owner_a', jurisdiction: 'federal', year: 2026, dueDates: ['2026-04-15'], priorYearTax: -1, highIncome: false, entityIds: [] })).toThrow(ValidationError);
  });
});

// ── K-1, basis, tax distributions ────────────────────────────────────────
describe('K-1 and owner tax', () => {
  it('ownership must add to 100%; income splits by % and the cents add back', () => {
    const { s, b, cfo } = setup();
    expect(() => saveTaxProfile(b, cfo, { entityId: 'ent_corp', owners: [{ partyId: 'pt_owner_a', pctBps: 6000 }], states: [], fiscalYearEndMonth: 12, priorReturns: [], method: 'accrual', inventoryMethod: 'fifo' })).toThrow(/add to exactly 100%/);
    expect(() => saveTaxProfile(b, cfo, { entityId: 'ent_corp', owners: [{ partyId: 'pt_cpa', pctBps: 10_000 }], states: [], fiscalYearEndMonth: 12, priorReturns: [], method: 'accrual', inventoryMethod: 'fifo' })).toThrow(/type Owner/);
    saveTaxProfile(b, cfo, { entityId: 'ent_corp', owners: [{ partyId: 'pt_owner_a', pctBps: 6667 }, { partyId: 'pt_owner_b', pctBps: 3333 }], states: [], fiscalYearEndMonth: 12, priorReturns: [], method: 'accrual', inventoryMethod: 'fifo' });
    sale(b, cfo, '2026-05-01', 'st_hm11', 1_000_001, 70_000);
    const k = k1Allocation(s, 'ent_corp', 2026, T);
    expect(k.rows.map((r) => r.income)).toEqual([666_701, 333_300]); // largest remainder: the cents add back
    expect(k.rows.reduce((a, r) => a + r.income, 0)).toBe(k.taxableIncome);
    expect(k.ties).toBe(true);
  });
  it('basis rolls forward in order: income and contributions, distributions (excess is gain), non-deductibles, then losses (suspended beyond basis)', () => {
    expect(basisRollForward({ start: 100_000, contributions: 0, income: 50_000, distributions: 30_000, nondeductible: 1_000 })).toMatchObject({ end: 119_000, suspended: 0, excess: 0 });
    expect(basisRollForward({ start: 10_000, contributions: 0, income: 0, distributions: 15_000, nondeductible: 0 })).toMatchObject({ end: 0, excess: 5_000 });
    expect(basisRollForward({ start: 10_000, contributions: 5_000, income: -40_000, distributions: 0, nondeductible: 2_000 })).toMatchObject({ end: 0, suspended: 27_000 });
  });
  it('K-1 rows roll basis and capital from the entered start; M-2 is the sum; distributions come from owner draws', () => {
    const { s, b, cfo } = setup();
    saveTaxProfile(b, cfo, { entityId: 'ent_corp', owners: [{ partyId: 'pt_owner_a', pctBps: 5000 }, { partyId: 'pt_owner_b', pctBps: 5000 }], states: [], fiscalYearEndMonth: 12, priorReturns: [], method: 'accrual', inventoryMethod: 'fifo' });
    setOwnerStart(b, cfo, { entityId: 'ent_corp', partyId: 'pt_owner_a', year: 2026, basis: 1_000_000, capital: 800_000, contributions: 0 });
    sale(b, cfo, '2026-05-01', 'st_hm11', 2_000_000, 140_000);
    b.createTransaction(cfo, { date: '2026-06-01', kind: 'money_out', description: 'Owner A draw', partyId: 'pt_owner_a', lines: [{ accountId: 'acct_owner_draws', storeId: 'st_corp', debit: 300_000, credit: 0, partyId: 'pt_owner_a' }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 300_000 }] });
    const k = k1Allocation(s, 'ent_corp', 2026, T);
    const a = k.rows.find((r) => r.partyId === 'pt_owner_a')!;
    expect(a.income).toBe(1_000_000);
    expect(a.distributions).toBe(300_000);
    expect(a.basisEnd).toBe(1_000_000 + 1_000_000 - 300_000);
    expect(a.capitalEnd).toBe(800_000 + 1_000_000 - 300_000);
    expect(k.disproportionate).toBe(true); // S corp: only Owner A took a distribution
    const m = m2(s, 'ent_corp', 2026, T);
    expect(m.kind).toBe('aaa');
    expect(m.ending).toBe(k.rows.reduce((x, r) => x + r.capitalEnd, 0));
    expect(ownerBasis(s, { year: 2026, asOf: T }).find((r) => r.partyId === 'pt_owner_a')!.end).toBe(a.basisEnd);
  });
  it('tax distributions = projected taxable share × owner rate', () => {
    const { s, b, cfo } = setup();
    saveTaxProfile(b, cfo, { entityId: 'ent_corp', owners: [{ partyId: 'pt_owner_a', pctBps: 10_000 }], states: [], fiscalYearEndMonth: 12, priorReturns: [], method: 'accrual', inventoryMethod: 'fifo' });
    sale(b, cfo, '2026-05-01', 'st_hm11', 2_000_000, 140_000);
    const td = taxDistributions(s, { year: 2026, asOf: T });
    const corp = td.rows.find((r) => r.entityId === 'ent_corp')!;
    const proj = projectTaxable(s, 'ent_corp', 2026, T).projected;
    expect(corp.projectedShare).toBe(proj);
    expect(corp.rateBps).toBe(3700 + 440);
    expect(corp.taxDistribution).toBe(Math.round(proj * 0.414));
    saveTaxRates(b, cfo, { ownerFederalBps: 3500, ownerStateBps: 500 });
    expect(taxDistributions(s, { year: 2026, asOf: T }).rows.find((r) => r.entityId === 'ent_corp')!.taxDistribution).toBe(Math.round(proj * 0.4));
    expect(distributionCapacity(s, { year: 2026, asOf: T }).floor).toBe(3_000_000);
  });
});

// ── Planning ─────────────────────────────────────────────────────────────
describe('planning levers', () => {
  it('estimates tax saved per lever at the owner rate; salary changes FICA for an S corporation', () => {
    const { s, b, cfo, u } = setup();
    sale(b, cfo, '2026-05-01', 'st_hm11', 20_000_000, 1_400_000);
    setLever(b, cfo, 'ent_corp', 2026, 'equipment', 10_000_000);
    setLever(b, cfo, 'ent_corp', 2026, 'retirement', 2_000_000);
    setLever(b, cfo, 'ent_corp', 2026, 'salary', 1_000_000);
    const p = planning(s, 'ent_corp', 2026, T);
    const get = (k: string) => p.levers.find((l) => l.key === k)!;
    expect(get('equipment').deduction).toBe(10_000_000); // 100% bonus
    expect(get('equipment').taxSaved).toBe(Math.round(10_000_000 * 0.414));
    expect(get('retirement').taxSaved).toBe(Math.round(2_000_000 * 0.414));
    expect(get('salary').taxSaved).toBe(-Math.round(1_000_000 * 0.153));
    expect(p.totalSaved).toBe(get('equipment').taxSaved + get('retirement').taxSaved + get('salary').taxSaved + get('elect_bonus').taxSaved);
    expect(p.afterLevers).toBe(p.projection.projected - 12_000_000);
    expect(() => setLever(b, u('owner'), 'ent_corp', 2026, 'equipment', 1)).toThrow(PermissionError);
    expect(() => setLever(b, cfo, 'ent_corp', 2026, 'equipment', -5)).toThrow(ValidationError);
  });
});

// ── CPA package ──────────────────────────────────────────────────────────
describe('CPA package', () => {
  it('zips every schedule with a printable index, and needs the export permission', () => {
    const s = buildDemo();
    const cfo = s.users.find((x) => x.id === CFO_ID)!;
    const mgr = s.users.find((x) => x.role === 'store_manager')!;
    const files = unzip(cpaPackageZip(s, cfo, { year: 2026, asOf: T }));
    const names = [...files.keys()];
    for (const n of ['index.html', 'index.csv', '00-entity-map.csv', '01-trial-balance-CORP.csv', '01-trial-balance-HM14.csv', '02-fixed-assets-book-and-tax.csv', '03-loan-schedules.csv', '04-payroll-summary.csv', '05-1099-vendors.csv', '06-owner-draws.csv', '07-intercompany-balances.csv', '08-inventory.csv', '09-tax-workpapers.csv', '10-sales-tax.csv', '11-estimated-taxes.csv', '12-k1-owner-support.csv']) expect(names).toContain(n);
    const index = new TextDecoder().decode(files.get('index.html'));
    expect(index).toMatch(/CPA package 2026/);
    expect(index).toMatch(/not tax advice/);
    const tb = new TextDecoder().decode(files.get('01-trial-balance-HM11.csv'));
    const rows = tb.trim().split('\n');
    const total = rows.find((r) => r.startsWith(',Total'))!.split(',');
    expect(total[2]).toBe(total[3]); // debits = credits
    expect(new TextDecoder().decode(files.get('00-entity-map.csv'))).not.toMatch(/00-0000001/); // EINs masked
    expect(cpaPackage(s, { year: 2026, asOf: T }).files.length).toBe(names.length - 2);
    expect(() => cpaPackageZip(s, mgr, { year: 2026, asOf: T })).toThrow(PermissionError);
    const reviewer = s.users.find((x) => x.role === 'reviewer')!;
    expect(cpaPackageZip(s, reviewer, { year: 2026, asOf: T }).length).toBeGreaterThan(1000);
  });
});

// ── Permissions ──────────────────────────────────────────────────────────
describe('permissions', () => {
  it('only the CFO and bookkeeper change tax records; owners, reviewers and store managers read only', () => {
    const { b, u } = setup();
    for (const role of ['owner', 'reviewer', 'store_manager'] as const) {
      const x = u(role);
      expect(() => saveTaxProfile(b, x, { entityId: 'ent_corp', owners: [], states: [], fiscalYearEndMonth: 12, priorReturns: [], method: 'accrual', inventoryMethod: 'fifo' })).toThrow(PermissionError);
      expect(() => saveTaxRates(b, x, { salesTaxBps: 800 })).toThrow(PermissionError);
      expect(() => setPriorIncome(b, x, { entityId: 'ent_corp', year: 2026, priorIncome: 1 })).toThrow(PermissionError);
      expect(() => setOwnerStart(b, x, { entityId: 'ent_corp', partyId: 'pt_owner_a', year: 2026, basis: 1, capital: 1, contributions: 0 })).toThrow(PermissionError);
    }
    saveTaxRates(b, u('bookkeeper'), { salesTaxBps: 800 });
    expect(() => saveTaxRates(b, u('cfo'), { salesTaxBps: 20_000 })).toThrow(ValidationError);
    expect(taxInbox(b.state, new Set(['st_hm11']), T)).toEqual([]); // a store manager sees no company tax alerts
    expect(maskEin('00-0000123')).toBe('••-•••0123');
  });
});

// ── Demo ─────────────────────────────────────────────────────────────────
describe('Phase 11 demo data', () => {
  const s = buildDemo();
  const all = new Set(s.stores.map((x) => x.id));
  it('owners and % per entity; the store entities file on the S corporation; HM14 files a 1065', () => {
    const units = returnUnits(s);
    expect(units.map((x) => [x.entity.code, x.form])).toEqual([['CORP', 'Form 1120-S'], ['HM14', 'Form 1065']]);
    expect(units[0].members).toEqual(expect.arrayContaining(['ent_hm11', 'ent_hm13', 'ent_hm15', 'ent_hm17']));
    for (const u of units) expect(k1Allocation(s, u.entity.id, 2026, T).ties).toBe(true);
    expect(s.entities.every((e) => /^00-0{6}\d$/.test(e.ein ?? ''))).toBe(true);
  });
  it('every return ties: TB balanced, book depreciation = register = 6400, M-1 line 8 = taxable income', () => {
    for (const u of returnUnits(s)) {
      const r = bookToTax(s, u.entity.id, 2026, T);
      expect(r.tbBalanced).toBe(true);
      expect(r.tbNetIncome).toBe(r.ytdBook);
      expect(r.depTie.ok).toBe(true);
      expect(r.m1Ties).toBe(true);
    }
    const corp = bookToTax(s, 'ent_corp', 2026, T);
    const sumTb = corp.unit.members.reduce((a, m) => a + trialBalance(s, { asOf: T, entityId: m }).netIncome, 0);
    expect(corp.ytdBook).toBe(sumTb);
    const k = Object.fromEntries(corp.adjustments.map((x) => [x.kind, x.amount]));
    expect(k.meals).toBe(68_000); // 50% of $1,360
    expect(k.penalties).toBe(15_000);
    expect(k.owner).toBe(1_350_000);
    expect(k.depreciation).toBeLessThan(0); // bonus on HM17 runs tax ahead of book
    expect(corp.adjustments.find((x) => x.kind === 'penalties')!.reviewed).toBeDefined();
  });
  it('tax depreciation: bonus on HM17, §179 on some, mid-quarter for 2026, HM14 pending cost segregation', () => {
    const bt = bookVsTax(s, { year: 2026, asOf: T });
    const hm17disp = bt.find((r) => r.a.id === 'fa_hm17_disp')!;
    expect(hm17disp.tax.bonus).toBe(hm17disp.a.cost);
    expect(hm17disp.convention).toBe('mid_quarter');
    expect(midQuarterTest(s, 'ent_corp', 2026).applies).toBe(true);
    expect(s.assets!.assets.find((a) => a.id === 'fa_hm15_truck')!.tax!.section179).toBe(4_000_000);
    expect(bt.find((r) => r.a.id === 'fa_hm14_bldg')!.flags.join(' ')).toMatch(/cost segregation/);
    expect(bt.find((r) => r.a.id === 'fa_hm17_canopy')!.tax.total).toBe(Math.round(8_100_000 * 0.0125));
  });
  it('sales tax: September ties; October collected $105 more than POS tax and than remitted; ties to 2200', () => {
    const sep = salesTaxPeriod(s, '2026-09', { today: T });
    expect(sep.flags).toEqual([]);
    expect(sep.total.collected).toBe(sep.total.remitted);
    const oct = salesTaxPeriod(s, '2026-10', { today: T });
    expect(oct.total.unremitted).toBe(10_500);
    expect(oct.total.variance).toBeGreaterThanOrEqual(10_500 - 100);
    expect(oct.remitFlag && oct.varianceFlag).toBe(true);
    expect(salesTaxPeriod(s, '2026-11', { today: T }).remitFlag).toBe(false); // not due yet
    expect(salesTaxTie(s, T).ok).toBe(true);
    expect(salesTaxTie(s, T).ledger).toBe(balanceAsOf(s, 'acct_sales_tax', T)); // credit-positive, as the balance sheet shows it
  });
  it('calendar, estimates and the inbox: a return due in 30 days, an estimate due in 14, sales tax collected ≠ remitted', () => {
    const cal = taxCalendar(s, { from: T, to: '2026-12-27', today: T });
    expect(cal.some((r) => r.title.startsWith('Tobacco') && !r.done)).toBe(true);
    const due = estimatesDueSoon(s, T);
    expect(due.map((d) => [d.status.payerName, d.inst.quarter, d.inst.dueDate])).toEqual([['CORP', 4, '2026-12-10']]);
    const pte = s.tax!.payments.filter((p) => p.planId === 'est_corp_pte' && p.txnId);
    expect(pte).toHaveLength(1);
    expect(s.transactions.find((t) => t.id === pte[0].txnId)!.lines.some((l) => l.accountId === 'acct_income_taxes')).toBe(true);
    const inbox = Object.fromEntries(taxInbox(s, all, T).map((i) => [i.key, i.count]));
    expect(inbox).toEqual({ taxest: 1, taxreturn: 2, salestaxvar: 1 });
    expect(grossReceiptsTest(s, 2026).passes).toBe(true);
    const a = estimateStatus(s, s.tax!.plans.find((p) => p.id === 'est_owner_a')!, T);
    expect(a.safeHarbor).toBe(3_960_000);
    expect(a.installments.slice(0, 3).every((i) => i.done)).toBe(true);
  });
  it('the S corporation\'s distributions are flagged as not pro rata; the CPA package builds', () => {
    expect(k1Allocation(s, 'ent_corp', 2026, T).disproportionate).toBe(true);
    expect(planning(s, 'ent_corp', 2026, T).levers.find((l) => l.key === 'equipment')!.amount).toBe(5_000_000);
    expect(cpaPackage(s, { year: 2026, asOf: T }).files.find((f) => f.name === '02-fixed-assets-book-and-tax.csv')!.rows).toBe(24);
  });
});
