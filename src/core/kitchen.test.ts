import { beforeAll, describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import { D, postCount, saveCount } from './inside';
import {
  ackPriceAlert, commitInvoiceLines, commitMenuImport, foodCost, foodCostAlerts, foodMonths, foodSalesByDay, invoiceSummaries, kitchenInbox, kitchenLabor, kitchenOf, logWaste,
  menuMix, parseInvoiceLines, parseMenuFile, previewInvoiceLines, previewMenuImport, priceItems, removeWaste, setFoodTarget, wasteEntries,
} from './kitchen';
import { PermissionError } from './permissions';
import { weekIndex } from './payroll';
import type { BooksState, User } from './types';
import type { DraftLine } from './ledger';

const dr = (accountId: string, storeId: string, cents: number): DraftLine => ({ accountId, storeId, debit: cents, credit: 0 });
const cr = (accountId: string, storeId: string, cents: number): DraftLine => ({ accountId, storeId, debit: 0, credit: cents });

/** HM13: $10,000 of October food sales and $3,500 of Sysco purchases, opening kitchen inventory $2,000. */
function setup() {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  const cfo = s.users.find((x) => x.id === CFO_ID)!;
  const u = (role: User['role']) => s.users.find((x) => x.role === role)!;
  b.createTransaction(cfo, { date: '2026-08-31', kind: 'opening', description: 'Opening', lines: [dr('acct_trustmark', 'st_corp', 10_000_000), dr('acct_inv_merch', 'st_hm13', 200_000), cr('acct_owner_capital', 'st_corp', 10_000_000), cr('acct_owner_capital', 'st_hm13', 200_000)] });
  for (const date of ['2026-10-05', '2026-10-20']) b.createTransaction(cfo, { date, kind: 'journal', description: 'POS daily close HM13', tags: ['pos'], lines: [dr('acct_cash_registers', 'st_hm13', 500_000), cr('acct_sales_kitchen', 'st_hm13', 500_000)] });
  b.createTransaction(cfo, { date: '2026-10-08', kind: 'money_out', description: 'SYSCO HM13', partyId: 'pt_sysco', lines: [dr('acct_cogs_food', 'st_hm13', 200_000), cr('acct_trustmark', 'st_corp', 200_000)] });
  b.createTransaction(cfo, { date: '2026-10-22', kind: 'money_out', description: 'SYSCO HM13', partyId: 'pt_sysco', lines: [dr('acct_cogs_food', 'st_hm13', 150_000), cr('acct_trustmark', 'st_corp', 150_000)] });
  return { s, b, cfo, u };
}

describe('food sales and menu mix', () => {
  it('reads food sales from 4200; the item import ties to the ledger and is idempotent', () => {
    const { s, b, cfo } = setup();
    expect(foodSalesByDay(s, ['st_hm13'], '2026-10-01', '2026-10-31').map((d) => d.sales)).toEqual([500_000, 500_000]);
    const text = 'Item,Qty,Sales\nFried chicken 2 pc,800,5600.00\nWings 6 pc,550,4400.00\nTotal,1350,10000.00';
    const parsed = parseMenuFile(text, { storeCode: 'HM13', from: '2026-10-01', to: '2026-10-31' });
    expect(parsed.rows).toHaveLength(2);
    const pv = previewMenuImport(s, parsed.rows);
    expect(pv.periods[0]).toMatchObject({ file: 1_000_000, ledger: 1_000_000, ties: true });
    const r = commitMenuImport(b, cfo, { name: 'items.csv', rows: parsed.rows });
    expect(r.rows.every((x) => x.batchId === r.batch.id)).toBe(true);
    expect(previewMenuImport(s, parsed.rows).added).toBe(0);
    const mix = menuMix(s, ['st_hm13'], '2026-10-01', '2026-10-31');
    expect(mix.rows[0]).toMatchObject({ item: 'Fried chicken 2 pc', salesShare: 0.56, avgPrice: 700 });
    expect(previewMenuImport(s, parseMenuFile('Item,Qty,Sales\nX,1,5.00', { storeCode: 'HM17', from: '2026-11-01', to: '2026-11-02' }).rows).rows[0].problem).toMatch(/no kitchen/);
  });
});

describe('food cost', () => {
  it('(purchases ± inventory change) ÷ food sales, measured once a kitchen count closes the month, and it equals 5200', () => {
    const { s, b, cfo } = setup();
    const before = foodCost(s, 'st_hm13', '2026-10');
    expect(before).toMatchObject({ sales: 1_000_000, purchases: 350_000, invChange: 0, cost: 350_000, counted: false, outside: false });
    postCount(b, cfo, saveCount(b, cfo, { storeId: 'st_hm13', date: '2026-08-31', lines: [{ departmentId: D.kitchen, counted: 200_000 }] }).id);
    // Kitchen inventory falls from $2,000 to $1,500: $500 more food cost.
    postCount(b, cfo, saveCount(b, cfo, { storeId: 'st_hm13', date: '2026-10-31', lines: [{ departmentId: D.kitchen, counted: 150_000 }] }).id);
    const r = foodCost(s, 'st_hm13', '2026-10');
    expect(r).toMatchObject({ purchases: 350_000, invChange: -50_000, cost: 400_000, ledger: 400_000, counted: true, countDate: '2026-10-31' });
    expect(r.pct).toBeCloseTo(0.4);
    // Default target 36% ± 2 points: 40% is outside.
    expect(r.outside).toBe(true);
    expect(foodCostAlerts(s, ['st_hm13']).map((x) => x.period)).toEqual(['2026-10']);
    setFoodTarget(b, cfo, 'st_hm13', 3_900);
    expect(foodCost(s, 'st_hm13', '2026-10').outside).toBe(false);
    expect(() => setFoodTarget(b, cfo, 'st_hm13', 0)).toThrow(ValidationError);
    // An inventory increase lowers food cost.
    postCount(b, cfo, saveCount(b, cfo, { storeId: 'st_hm13', date: '2026-11-28', lines: [{ departmentId: D.kitchen, counted: 180_000 }] }).id);
    expect(foodCost(s, 'st_hm13', '2026-11')).toMatchObject({ purchases: 0, invChange: 30_000, cost: -30_000, ledger: -30_000 });
    expect(foodMonths(s, ['st_hm13'])).toEqual(['2026-10']);
  });

  it('waste is part of food cost: its points + cost without waste = food cost %', () => {
    const { s, b, cfo } = setup();
    logWaste(b, cfo, { storeId: 'st_hm13', date: '2026-10-10', item: 'Wings', qty: 20, unit: 'lb', cost: 20_000, reason: 'overcooked' });
    const w = logWaste(b, cfo, { storeId: 'st_hm13', date: '2026-10-11', item: 'Biscuits', qty: 40, unit: 'each', cost: 10_000, reason: 'expired' });
    const r = foodCost(s, 'st_hm13', '2026-10');
    expect(r.waste).toBe(30_000);
    expect(r.wastePct).toBeCloseTo(0.03);
    expect(r.pctExWaste! + r.wastePct!).toBeCloseTo(r.pct!);
    expect(r.pctExWaste).toBeCloseTo(0.32);
    removeWaste(b, cfo, w.id, 'Duplicate');
    expect(wasteEntries(s, ['st_hm13'], '2026-10-01', '2026-10-31')).toHaveLength(1);
    expect(() => logWaste(b, cfo, { storeId: 'st_hm17', date: '2026-10-10', item: 'X', qty: 1, unit: 'each', cost: 100, reason: 'other' })).toThrow(/kitchen/);
    expect(() => logWaste(b, cfo, { storeId: 'st_hm13', date: '2026-10-10', item: 'X', qty: 1, unit: 'each', cost: 0, reason: 'other' })).toThrow(ValidationError);
  });
});

describe('supplier prices', () => {
  const CSV = (price: string, inv: string, date: string, qty = 2) => `Vendor,Store,Invoice,Date,Item code,Description,Pack,Qty,Price,Extended\nSysco,HM13,${inv},${date},1004417,Chicken wings,40 lb,${qty},${price},${(qty * Number(price)).toFixed(2)}\nSysco,HM13,${inv},${date},,Fuel surcharge,,1,25.00,25.00`;

  it('imports invoice lines idempotently, matches each invoice to its purchase, and alerts on a top item moving over 5%', () => {
    const { s, b, cfo } = setup();
    const p1 = parseInvoiceLines(CSV('987.50', 'S-1', '2026-10-08'));
    expect(p1.rows).toHaveLength(2);
    const pv = previewInvoiceLines(s, p1.rows);
    expect(pv.invoices[0]).toMatchObject({ total: 200_000, lines: 2 });
    expect(pv.invoices[0].txnId).toBeTruthy();
    commitInvoiceLines(b, cfo, { name: 'a.csv', rows: p1.rows });
    expect(previewInvoiceLines(s, p1.rows).added).toBe(0);
    // Second invoice: same item, 1,462.50 total for 1 case + surcharge → 1,437.50 (+45.6%: well over 5%).
    const p2 = parseInvoiceLines(CSV('1437.50', 'S-2', '2026-10-22', 1).replace('25.00,25.00', '62.50,62.50'));
    expect(previewInvoiceLines(s, p2.rows).invoices[0].total).toBe(150_000);
    commitInvoiceLines(b, cfo, { name: 'b.csv', rows: p2.rows });
    const items = priceItems(s);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ itemCode: '1004417', top: true, alert: true, acked: false, changedOn: '2026-10-22' });
    expect(items[0].change).toBeCloseTo(0.4557, 3);
    expect(invoiceSummaries(s, new Set(['st_hm13'])).every((i) => i.txnId)).toBe(true);
    expect(kitchenInbox(s, new Set(['st_hm13'])).find((i) => i.key === 'pricejump')!.count).toBe(1);
    ackPriceAlert(b, cfo, items[0].key, items[0].changedOn);
    expect(priceItems(s)[0].acked).toBe(true);
    expect(kitchenInbox(s, new Set(['st_hm13'])).find((i) => i.key === 'pricejump')!.count).toBe(0);
    // A change under the threshold does not alert.
    kitchenOf(s).priceAlertBps = 5_000;
    expect(priceItems(s)[0].alert).toBe(false);
  });

  it('refuses lines whose qty × price is not the extended amount and unknown vendors', () => {
    const { s } = setup();
    const bad = parseInvoiceLines('Vendor,Store,Invoice,Date,Item code,Description,Qty,Price,Extended\nSysco,HM13,S-9,2026-10-08,1,Oil,2,10.00,25.00\nNobody,HM13,S-9,2026-10-08,2,Oil,1,1.00,1.00');
    const pv = previewInvoiceLines(s, bad.rows);
    expect(pv.rows[0].problem).toMatch(/extended/);
    expect(pv.rows[1].problem).toMatch(/isn't set up/);
    expect(parseInvoiceLines('a,b\n1,2').problems[0]).toMatch(/Invoice, Description, Qty and Price/);
  });
});

describe('permissions', () => {
  it('imports and targets need inside.edit; store managers log waste for their own store only', () => {
    const { b, u } = setup();
    const mgr = u('store_manager');
    expect(() => commitMenuImport(b, mgr, { name: 'x', rows: [] })).toThrow(PermissionError);
    expect(() => commitInvoiceLines(b, u('reviewer'), { name: 'x', rows: [] })).toThrow(PermissionError);
    expect(() => setFoodTarget(b, u('owner'), 'st_hm13', 3_500)).toThrow(PermissionError);
    expect(() => logWaste(b, mgr, { storeId: 'st_hm13', date: '2026-10-10', item: 'X', qty: 1, unit: 'each', cost: 100, reason: 'other' })).toThrow(PermissionError);
    expect(logWaste(b, mgr, { storeId: 'st_hm11', date: '2026-10-10', item: 'X', qty: 1, unit: 'each', cost: 100, reason: 'other' }).by).toBe(mgr.id);
    expect(() => logWaste(b, u('owner'), { storeId: 'st_hm11', date: '2026-10-10', item: 'X', qty: 1, unit: 'each', cost: 100, reason: 'other' })).toThrow(PermissionError);
  });
});

describe('demo data', () => {
  let s: BooksState;
  beforeAll(() => { s = buildDemo(); });
  const ks = ['st_hm11', 'st_hm13', 'st_hm15'];

  it('menu mix adds to each month\'s food sales; food cost ties to 5200 every month; HM15 October is over target', () => {
    for (const st of ks) {
      for (const p of ['2026-09', '2026-10', '2026-11']) {
        const r = foodCost(s, st, p);
        expect(r.cost).toBe(r.ledger);
        const mix = menuMix(s, [st], `${p}-01`, `${p}-31`);
        expect(mix.periods).toHaveLength(1);
        expect(mix.sales).toBe(foodSalesByDay(s, [st], mix.periods[0].from, mix.periods[0].to).reduce((a, d) => a + d.sales, 0));
      }
    }
    expect(foodCostAlerts(s, ks).map((r) => `${r.storeId} ${r.period}`)).toEqual(['st_hm15 2026-10']);
    const oct = foodCost(s, 'st_hm15', '2026-10');
    expect(oct.waste).toBeGreaterThan(foodCost(s, 'st_hm13', '2026-10').waste);
  });

  it('every Sysco invoice matches its purchase; the wings price jump is the one alert', () => {
    const inv = invoiceSummaries(s, new Set(ks));
    expect(inv.length).toBeGreaterThan(30);
    expect(inv.every((i) => i.txnId)).toBe(true);
    const alerts = priceItems(s, new Set(ks)).filter((i) => i.alert);
    expect(alerts.map((i) => i.description)).toEqual(['Chicken wings jumbo']);
    expect(alerts[0].change).toBeGreaterThan(0.05);
    expect(kitchenInbox(s, new Set(s.stores.map((x) => x.id))).map((i) => [i.key, i.count])).toEqual([['foodcost', 1], ['pricejump', 1]]);
  });

  it('kitchen labor comes from payroll\'s kitchen department and fits inside store payroll', () => {
    const idx = weekIndex(s);
    for (const st of ks) {
      const lab = kitchenLabor(s, [st], '2026-10-01', '2026-10-31', idx);
      expect(lab.cost).toBeGreaterThan(0);
      expect(lab.people).toBeGreaterThan(0);
      const fc = foodCost(s, st, '2026-10', idx);
      expect(fc.labor).toBe(lab.cost);
      expect(fc.primePct).toBeCloseTo((fc.cost + lab.cost) / fc.sales);
    }
  });
});
