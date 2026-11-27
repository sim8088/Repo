import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import {
  checkNotice, clearingLedger, commitComdataImport, commitInvoiceImport, commitNoticeImport, costTable, craddockReceivable, deliveredCpg, fuelCostOfSales,
  fuelInbox, fuelMargin, invoiceFlags, ledgerFuelRevenue, nextBusinessDay, noticeLineDate, noticeNet, orderingPlan, payDashInvoicesDue, postNotice,
  previewNoticeImport, pricingBoard, recordFuelSales, recordMudflap, recordReading, saveInvoice, saveNotice, saveTank, storeBalance, tankBook, tankStatus, unpostNotice,
  type InvoiceInput,
} from './fuel';
import { parseComdataFile, parseInvoiceFile, parseNoticeFile } from './fuelio';
import { trialBalance } from './reports';
import { reconcileStatus } from './bank';
import { findDuplicates } from './duplicates';
import { PermissionError } from './permissions';
import type { BooksState, User } from './types';

const setup = () => {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  const cfo = s.users.find((u) => u.id === CFO_ID)!;
  return { s, b, cfo };
};
const role = (s: BooksState, r: User['role']) => s.users.find((u) => u.role === r)!;
/** A POS close that puts card sales into the Craddock receivable and fuel revenue in the books. */
const pos = (b: Books, cfo: User, date: string, card: number, storeId = 'st_hm11', acct = 'acct_craddock') =>
  b.createTransaction(cfo, { date, kind: 'journal', description: `POS daily close ${date}`, tags: ['pos'], lines: [
    { accountId: acct, storeId, debit: card, credit: 0 }, { accountId: 'acct_fuel_regular', storeId, debit: 0, credit: card },
  ] });
const inv = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({
  supplier: 'craddock', storeId: 'st_hm11', invoiceNo: 'C-1', bolNo: 'B-1', deliveredOn: '2026-11-02', dueOn: '2026-11-05',
  lines: [{ grade: 'regular', grossGallons: 6_020, netGallons: 6_000, cost: 1_248_000 }, { grade: 'premium', grossGallons: 2_005, netGallons: 2_000, cost: 540_000 }],
  freight: 36_000, taxes: 291_200, ...over,
});

describe('dating rules (SPEC §6.2)', () => {
  it('card batches on the sales day, invoices and network fees on the notice date, the draft on the next business day', () => {
    const n = { noticeDate: '2026-11-09' };
    expect(noticeLineDate(n, { type: 'CC_PROCEEDS', processingDate: '2026-11-03' })).toBe('2026-11-02');
    expect(noticeLineDate(n, { type: 'CC_FEE', processingDate: '2026-11-03' })).toBe('2026-11-02');
    expect(noticeLineDate(n, { type: 'FUEL_INVOICE' })).toBe('2026-11-09');
    expect(noticeLineDate(n, { type: 'OTHER' })).toBe('2026-11-09');
    expect(noticeLineDate(n, { type: 'BANK_DRAFT' })).toBe('2026-11-10');
    expect(noticeLineDate({ noticeDate: '2026-11-13' }, { type: 'DEPOSIT' })).toBe('2026-11-16'); // Friday → Monday
    expect(nextBusinessDay('2026-11-25')).toBe('2026-11-27'); // Thanksgiving skipped
    expect(nextBusinessDay('2026-11-10')).toBe('2026-11-12'); // Veterans Day skipped
    expect(nextBusinessDay('2026-09-04')).toBe('2026-09-08'); // Labor Day weekend
  });
});

describe('Craddock notices', () => {
  const notice = (_s: BooksState, b: Books, cfo: User, extra: { amount?: number } = {}) => {
    pos(b, cfo, '2026-11-02', 1_000_000);
    pos(b, cfo, '2026-11-03', 600_000);
    saveInvoice(b, cfo, inv());
    const lines = [
      { type: 'CC_PROCEEDS' as const, amount: 1_000_000, processingDate: '2026-11-03', description: 'Batch' },
      { type: 'CC_FEE' as const, amount: -21_500, processingDate: '2026-11-03', description: 'Fee' },
      { type: 'HOST_DISCOUNT' as const, amount: -4_000, processingDate: '2026-11-03', description: 'Rewards' },
      { type: 'CC_PROCEEDS' as const, amount: 600_000, processingDate: '2026-11-04', description: 'Batch' },
      { type: 'CC_FEE' as const, amount: -12_900, processingDate: '2026-11-04', description: 'Fee' },
      { type: 'FUEL_INVOICE' as const, amount: -2_115_200, invoiceNo: 'C-1', description: 'Invoice' },
      { type: 'OTHER' as const, amount: -8_650, description: 'Cybera' },
    ];
    const net = lines.reduce((a, l) => a + l.amount, 0); // −562,250: we owe → draft
    lines.push({ type: 'BANK_DRAFT' as never, amount: -net + (extra.amount ?? 0), description: 'Draft' } as never);
    return saveNotice(b, cfo, { storeId: 'st_hm11', noticeNo: '5001', noticeDate: '2026-11-09', lines });
  };

  it('refuses to post a notice that does not net to zero, and says by how much', () => {
    const { s, b, cfo } = setup();
    const n = notice(s, b, cfo, { amount: 100 });
    expect(checkNotice(s, n).netsToZero).toBe(false);
    expect(() => postNotice(b, cfo, n.id)).toThrow(/net to \$1\.00/);
    expect(s.transactions).toHaveLength(2);
  });

  it('posts fees to 6000, host discounts to 4920, network fees to 6010, the invoice to 5000 and the draft to Trustmark, each on its own date', () => {
    const { s, b, cfo } = setup();
    const n = notice(s, b, cfo);
    expect(noticeNet(n)).toBe(0);
    const txns = postNotice(b, cfo, n.id);
    expect(txns.map((t) => t.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-09', '2026-11-10']);
    const amt = (acct: string) => s.transactions.flatMap((t) => t.lines).filter((l) => l.accountId === acct).reduce((a, l) => a + l.debit - l.credit, 0);
    expect(amt('acct_card_fees')).toBe(34_400);
    expect(amt('acct_host_discounts')).toBe(4_000);
    expect(amt('acct_network_fees')).toBe(8_650);
    expect(amt('acct_cogs_fuel')).toBe(2_115_200);
    expect(amt('acct_trustmark')).toBe(-562_250);
    // The receivable is cleared of exactly the proceeds; the invoice is settled.
    expect(storeBalance(s, 'acct_craddock', 'st_hm11', '2026-11-30')).toBe(0);
    expect(s.fuel.invoices[0].settlement).toMatchObject({ kind: 'notice', noticeId: n.id, on: '2026-11-09' });
    const rec = craddockReceivable(s, 'st_hm11', '2026-11-30');
    expect(rec.difference).toBe(0);
    expect(rec.openBatches).toEqual([]);
    // Mid-way (after the notice, before the draft) the receivable still ties.
    expect(craddockReceivable(s, 'st_hm11', '2026-11-09').difference).toBe(0);
    for (const e of s.entities) expect(trialBalance(s, { asOf: '2026-11-30', entityId: e.id }).difference).toBe(0);
    expect(() => postNotice(b, cfo, n.id)).toThrow(/already posted/);
  });

  it('rejects an invoice line that disagrees with the invoice on file, and flags one that is not on file', () => {
    const { s, b, cfo } = setup();
    saveInvoice(b, cfo, inv());
    const base = { storeId: 'st_hm11', noticeDate: '2026-11-09' };
    const wrong = checkNotice(s, { ...base, lines: [{ id: '1', type: 'FUEL_INVOICE', amount: -100, invoiceNo: 'C-1', description: '' }, { id: '2', type: 'BANK_DRAFT', amount: 100, description: '' }] });
    expect(wrong.canPost).toBe(false);
    expect(wrong.problems[0]).toMatch(/C-1/);
    const missing = checkNotice(s, { ...base, lines: [{ id: '1', type: 'FUEL_INVOICE', amount: -100, invoiceNo: 'C-404', description: '' }, { id: '2', type: 'BANK_DRAFT', amount: 100, description: '' }] });
    expect(missing.canPost).toBe(true);
    expect(missing.invoices[0].problem).toMatch(/isn't on file/);
  });

  it('unposts with a reason: entries soft-deleted, invoice open again', () => {
    const { s, b, cfo } = setup();
    const n = notice(s, b, cfo);
    postNotice(b, cfo, n.id);
    expect(() => unpostNotice(b, cfo, n.id, ' ')).toThrow(/why/);
    unpostNotice(b, cfo, n.id, 'Wrong store');
    expect(n.status).toBe('unposted');
    expect(s.fuel.invoices[0].settlement).toBeUndefined();
    expect(storeBalance(s, 'acct_craddock', 'st_hm11', '2026-11-30')).toBe(1_600_000);
  });

  it('only Craddock stores take notices; store managers and reviewers cannot post', () => {
    const { s, b, cfo } = setup();
    expect(() => saveNotice(b, cfo, { storeId: 'st_hm15', noticeNo: '1', noticeDate: '2026-11-09', lines: [{ type: 'OTHER', amount: 0, description: '' }] })).toThrow(/isn't a Craddock store/);
    const n = notice(s, b, cfo);
    expect(() => postNotice(b, role(s, 'store_manager'), n.id)).toThrow(PermissionError);
    expect(() => postNotice(b, role(s, 'reviewer'), n.id)).toThrow(PermissionError);
  });
});

describe('notice import', () => {
  const csv = [
    'Notice,Store,Notice date,Type,Processing date,Description,Invoice,Amount',
    '7001,HM11,2026-11-09,Card proceeds,11/03/2026,Batch,,"10,000.00"',
    '7001,HM11,2026-11-09,CC_FEE,2026-11-03,Fee,,215.00',
    '7001,HM11,2026-11-09,OTHER,,Cybera,,-86.50',
    '7001,HM11,2026-11-09,DEPOSIT,,ACH,,9698.50',
    '7002,HM13,2026-11-09,CC_PROCEEDS,2026-11-03,Batch,,500.00',
    '7002,HM13,2026-11-09,DEPOSIT,,ACH,,-499.00',
  ].join('\n');

  it('parses, normalizes signs by type, groups by notice and previews which nets to zero', () => {
    const p = parseNoticeFile(csv);
    expect(p.problems).toEqual([]);
    expect(p.lines.map((l) => l.amount)).toEqual([1_000_000, -21_500, -8_650, -969_850, 50_000, -49_900]);
    const { s } = setup();
    const pv = previewNoticeImport(s, p.lines);
    expect(pv.notices.map((n) => [n.noticeNo, n.net, n.check?.netsToZero])).toEqual([['7001', 0, true], ['7002', 100, false]]);
  });

  it('is idempotent: re-importing adds nothing, and every line keeps its batch id; only notices that net post', () => {
    const { s, b, cfo } = setup();
    const lines = parseNoticeFile(csv).lines;
    const r1 = commitNoticeImport(b, cfo, { name: 'n.csv', lines }, { post: true });
    expect(r1.notices).toHaveLength(2);
    expect(r1.posted).toBe(1);
    expect(r1.notPosted[0]).toMatch(/7002/);
    expect(s.fuel.notices.flatMap((n) => n.lines).every((l) => l.batchId === r1.batch.id)).toBe(true);
    const r2 = commitNoticeImport(b, cfo, { name: 'n.csv', lines });
    expect(r2.batch).toMatchObject({ added: 0, skipped: 2 });
    expect(s.fuel.notices).toHaveLength(2);
  });

  it('explains unreadable rows', () => {
    expect(parseNoticeFile('Type,Amount\nNONSENSE,1\n').problems[0]).toMatch(/isn't a line type/);
    expect(parseNoticeFile('foo\n1').problems[0]).toMatch(/header/);
  });
});

describe('fuel invoices', () => {
  it('flags duplicates (same invoice # or BOL), BOLs with no invoice, and price outliers', () => {
    const { s, b, cfo } = setup();
    saveInvoice(b, cfo, inv());
    saveInvoice(b, cfo, inv({ invoiceNo: 'C-2', bolNo: 'B-2', deliveredOn: '2026-11-06', dueOn: '2026-11-09' }));
    saveInvoice(b, cfo, inv({ invoiceNo: 'C-3', bolNo: 'B-3', deliveredOn: '2026-11-10', dueOn: '2026-11-13', lines: [{ grade: 'regular', grossGallons: 6_000, netGallons: 6_000, cost: 1_248_000 * 1.1 }] }));
    const dupNo = saveInvoice(b, cfo, inv({ bolNo: 'B-9' }));
    const dupBol = saveInvoice(b, cfo, inv({ invoiceNo: 'C-9', bolNo: 'B-2' }));
    const bol = saveInvoice(b, cfo, { ...inv({ invoiceNo: undefined, bolNo: 'B-4' }), lines: [{ grade: 'diesel', grossGallons: 3_000, netGallons: 3_000, cost: 0 }], freight: 0, taxes: 0 });
    const f = invoiceFlags(s, '2026-11-27');
    expect(f.get(dupNo.id)!.duplicateOf).toBe(s.fuel.invoices[0].id);
    expect(f.get(dupBol.id)!.duplicateOf).toBe(s.fuel.invoices[1].id);
    expect(f.get(bol.id)!.missingInvoice).toBe(true);
    const out = f.get(s.fuel.invoices[2].id)!.outliers;
    expect(out[0].grade).toBe('regular');
    expect(out[0].pct).toBeCloseTo(10, 0);
  });

  it('checks the total adds up and the supplier matches the store', () => {
    const { b, cfo } = setup();
    expect(() => saveInvoice(b, cfo, inv({ total: 1 }))).toThrow(/add up to \$21,152\.00/);
    expect(() => saveInvoice(b, cfo, inv({ supplier: 'dash' }))).toThrow(/Craddock, not Dash/);
    expect(() => saveInvoice(b, cfo, inv({ dueOn: '2026-11-01' }))).toThrow(ValidationError);
  });

  it('imports grade rows as invoices, idempotently, with the batch id on each', () => {
    const { s, b, cfo } = setup();
    const csv = 'Supplier,Store,Invoice,BOL,Delivered,Due,Grade,Gross,Net,Cost,Freight,Taxes\nCraddock,HM11,C-7,77,2026-11-02,2026-11-05,Regular,6020,6000,"12,480.00",270.00,2184.00\nCraddock,HM11,C-7,77,2026-11-02,2026-11-05,Prem,2005,2000,5400.00,90.00,728.00\n';
    const rows = parseInvoiceFile(csv).rows;
    const r1 = commitInvoiceImport(b, cfo, { name: 'i.csv', rows });
    expect(r1.invoices).toHaveLength(1);
    expect(r1.invoices[0]).toMatchObject({ total: 2_115_200, batchId: r1.batch.id });
    expect(r1.invoices[0].lines).toHaveLength(2);
    expect(commitInvoiceImport(b, cfo, { name: 'i.csv', rows }).batch).toMatchObject({ added: 0, skipped: 1 });
    expect(s.fuel.invoices).toHaveLength(1);
  });
});

describe('Dash clearing', () => {
  it('pays each invoice on its due date out of clearing, not the bank, and shows who owes whom', () => {
    const { s, b, cfo } = setup();
    pos(b, cfo, '2026-11-02', 500_000, 'st_hm15', 'acct_dash');
    saveInvoice(b, cfo, inv({ supplier: 'dash', storeId: 'st_hm15', invoiceNo: 'D-1', dueOn: '2026-11-12' }));
    saveInvoice(b, cfo, inv({ supplier: 'dash', storeId: 'st_hm15', invoiceNo: 'D-2', bolNo: 'B-2', dueOn: '2026-11-30' }));
    const paid = payDashInvoicesDue(b, cfo, { through: '2026-11-20' });
    expect(paid).toHaveLength(1);
    expect(paid[0].date).toBe('2026-11-12');
    expect(paid[0].lines.some((l) => l.accountId === 'acct_trustmark')).toBe(false);
    const led = clearingLedger(s, 'acct_dash', 'st_hm15', '2026-11-01', '2026-11-30');
    expect(led.rows.map((r) => [r.date, r.cardIn, r.invoicesOut])).toEqual([['2026-11-02', 500_000, 0], ['2026-11-12', 0, -2_115_200]]);
    expect(led.closing).toBe(500_000 - 2_115_200); // negative: we owe Dash
    expect(led.closing).toBe(storeBalance(s, 'acct_dash', 'st_hm15', '2026-11-30'));
    expect(payDashInvoicesDue(b, cfo, { through: '2026-11-20' })).toHaveLength(0);
  });
});

describe('accrual fuel cost of sales (phase 4 export)', () => {
  it('gallons sold × that month\'s delivered cost per gallon, Plus blended 50/50, grades adding to the total', () => {
    const { s, b, cfo } = setup();
    // Regular delivered: (1,248,000 + share of freight/taxes) / 6,000; premium likewise over 2,000.
    saveInvoice(b, cfo, inv());
    recordFuelSales(b, cfo, [
      { storeId: 'st_hm11', date: '2026-11-03', grade: 'regular', gallons: 1_000, retail: 289_900 },
      { storeId: 'st_hm11', date: '2026-11-03', grade: 'plus', gallons: 100, retail: 32_990 },
      { storeId: 'st_hm11', date: '2026-11-03', grade: 'premium', gallons: 200, retail: 71_980 },
    ], 'b1');
    const t = costTable(s);
    const reg = deliveredCpg(s, 'st_hm11', '2026-11', 'regular', t);
    const prem = deliveredCpg(s, 'st_hm11', '2026-11', 'premium', t);
    // freight + taxes 327,200 split 6,000 : 2,000 → 245,400 / 81,800
    expect(reg).toEqual({ cpg: (1_248_000 + 245_400) / 6_000, source: 'month' });
    expect(prem.cpg).toBe((540_000 + 81_800) / 2_000);
    const c = fuelCostOfSales(s, 'st_hm11', '2026-11');
    expect(c.byGrade.map((g) => g.grade)).toEqual(['regular', 'plus', 'premium']);
    expect(c.byGrade[1].costPerGallon).toBe((reg.cpg! + prem.cpg!) / 2);
    expect(c.byGrade[0].cogs).toBe(Math.round(1_000 * reg.cpg!));
    expect(c.cogs).toBe(c.byGrade.reduce((a, g) => a + g.cogs, 0));
    expect(c.gallons).toBe(1_300);
    expect(c.retail).toBe(394_870);
    // December has no delivery: falls back to the store's latest month.
    recordFuelSales(b, cfo, [{ storeId: 'st_hm11', date: '2026-12-01', grade: 'regular', gallons: 10, retail: 2_899 }], 'b2');
    expect(fuelCostOfSales(s, 'st_hm11', '2026-12').byGrade[0].source).toBe('prior_month');
    // No basis anywhere: says so rather than inventing a cost.
    recordFuelSales(b, cfo, [{ storeId: 'st_hm11', date: '2026-12-01', grade: 'diesel', gallons: 10, retail: 3_499 }], 'b2');
    expect(fuelCostOfSales(s, 'st_hm11', '2026-12').missingCost).toEqual(['diesel']);
  });
});

describe('tanks', () => {
  it('book = yesterday\'s reading + deliveries − sales; flags variance over 1% + 130 gal, water, and low supply', () => {
    const { s, b, cfo } = setup();
    const reg = saveTank(b, cfo, { storeId: 'st_hm11', label: 'T1', grade: 'regular', capacity: 12_000, active: true });
    saveTank(b, cfo, { storeId: 'st_hm11', label: 'T2', grade: 'premium', capacity: 6_000, active: true });
    expect(() => saveTank(b, cfo, { storeId: 'st_hm11', label: 'T9', grade: 'plus' as never, capacity: 1, active: true })).toThrow(/blended/);
    saveInvoice(b, cfo, inv({ deliveredOn: '2026-11-03', lines: [{ grade: 'regular', grossGallons: 6_000, netGallons: 6_000, cost: 1 }] }));
    recordReading(b, cfo, { tankId: reg.id, date: '2026-11-01', gallons: 8_000, waterInches: 0.2, method: 'atg' });
    for (const [d, g] of [['2026-11-02', 1_000], ['2026-11-03', 1_000], ['2026-11-04', 1_000]] as const) {
      recordFuelSales(b, cfo, [{ storeId: 'st_hm11', date: d, grade: 'regular', gallons: g, retail: 1 }, { storeId: 'st_hm11', date: d, grade: 'plus', gallons: 200, retail: 1 }], 'x');
    }
    recordReading(b, cfo, { tankId: reg.id, date: '2026-11-02', gallons: 6_900, waterInches: 0.2, method: 'atg' });
    recordReading(b, cfo, { tankId: reg.id, date: '2026-11-03', gallons: 11_800, waterInches: 0.2, method: 'atg' });
    recordReading(b, cfo, { tankId: reg.id, date: '2026-11-04', gallons: 10_500, waterInches: 1.5, method: 'stick' });
    const days = tankBook(s, reg.id, '2026-11-02', '2026-11-04');
    // Plus draws half from Regular: 1,000 + 100 per day.
    expect(days.map((d) => [d.opening, d.deliveries, d.sales, d.book, d.variance])).toEqual([
      [8_000, 0, 1_100, 6_900, 0], [6_900, 6_000, 1_100, 11_800, 0], [11_800, 0, 1_100, 10_700, -200],
    ]);
    const st = tankStatus(s, reg.id, '2026-11-04')!;
    expect(st.variance30).toBe(-200);
    expect(st.threshold).toBe(Math.round(0.01 * 3_300 + 130));
    expect(st.varianceFlag).toBe(true);
    expect(st.waterFlag).toBe(true);
    expect(st.daysOfSupply).toBeCloseTo(10_500 / 1_100, 5);
    expect(() => recordReading(b, cfo, { tankId: reg.id, date: '2026-11-05', gallons: 13_000, waterInches: 0, method: 'stick' })).toThrow(/more than it can hold/);
    expect(() => recordReading(b, role(s, 'store_manager'), { tankId: reg.id, date: '2026-11-05', gallons: 100, waterInches: 0, method: 'stick' })).not.toThrow();
    const plan = orderingPlan(s, 'st_hm11', '2026-11-04');
    expect(plan.total).toBeLessThanOrEqual(s.fuel.targets.loadGallons);
    expect(plan.byTank.every((t) => t.gallons % 100 === 0)).toBe(true);
  });
});

describe('truck lane', () => {
  it('imports Comdata idempotently per store and day, and Mudflap posts to 4910 against merchant clearing', () => {
    const { s, b, cfo } = setup();
    const rows = parseComdataFile('Date,Store,Gallons,Sales,Transactions\n2026-11-02,HM15,950,"3,315.50",11\n2026-11-02,HM11,10,30,1\n').rows;
    const r1 = commitComdataImport(b, cfo, { name: 'c.csv', rows });
    expect(r1.rows).toHaveLength(1); // HM11 has no truck lane
    expect(r1.rows[0]).toMatchObject({ gallons: 950, sales: 331_550, batchId: r1.batch.id });
    expect(commitComdataImport(b, cfo, { name: 'c.csv', rows }).rows).toHaveLength(0);
    recordMudflap(b, cfo, { storeId: 'st_hm15', date: '2026-11-09', kind: 'discount', amount: 1_596, gallons: 114 });
    recordMudflap(b, cfo, { storeId: 'st_hm15', date: '2026-11-09', kind: 'true_up', amount: -500 });
    expect(storeBalance(s, 'acct_mudflap', 'st_hm15', '2026-11-30')).toBe(1_096);
    expect(storeBalance(s, 'acct_fiserv', 'st_hm15', '2026-11-30')).toBe(-1_096);
    expect(() => recordMudflap(b, cfo, { storeId: 'st_hm11', date: '2026-11-09', kind: 'discount', amount: 1 })).toThrow(/truck lane/);
  });
});

describe('Phase 3 demo data', () => {
  const s = buildDemo();
  const all = new Set(s.stores.map((x) => x.id));
  const fuelStores = ['st_hm11', 'st_hm13', 'st_hm15', 'st_hm17'];

  it('every posted notice nets to zero and cleared exactly its card proceeds; the receivable ties for each store', () => {
    const posted = s.fuel.notices.filter((n) => n.status === 'posted');
    expect(posted.length).toBe(23);
    for (const n of posted) {
      expect(noticeNet(n)).toBe(0);
      const relief = n.txnIds.flatMap((id) => s.transactions.find((t) => t.id === id)!.lines).filter((l) => l.accountId === 'acct_craddock').reduce((a, l) => a + l.debit - l.credit, 0);
      expect(relief).toBe(-n.lines.filter((l) => l.type === 'CC_PROCEEDS').reduce((a, l) => a + l.amount, 0));
      expect(checkNotice(s, n).proceeds.every((p) => p.diff === 0)).toBe(true);
    }
    for (const st of ['st_hm11', 'st_hm13']) for (const d of ['2026-09-30', '2026-10-31', '2026-11-26']) expect(craddockReceivable(s, st, d).difference).toBe(0);
  });

  it('structured fuel sales (POS + Comdata) tie to fuel revenue in the ledger every month', () => {
    for (const p of ['2026-09', '2026-10', '2026-11']) {
      const from = `${p}-01`;
      const to = p === '2026-11' ? '2026-11-30' : p === '2026-09' ? '2026-09-30' : '2026-10-31';
      const m = fuelMargin(s, { storeIds: fuelStores, from, to, by: 'month' });
      expect(m.rows.reduce((a, r) => a + r.retail, 0)).toBe(ledgerFuelRevenue(s, fuelStores, from, to));
      for (const st of fuelStores) {
        const c = fuelCostOfSales(s, st, p);
        expect(c.cogs).toBe(m.rows.filter((r) => r.storeId === st).reduce((a, r) => a + r.cogs, 0));
        if (c.gallons) expect(c.missingCost).toEqual([]);
      }
    }
  });

  it('Dash clearing ties to the ledger and every due Dash invoice was paid on its due date', () => {
    for (const st of ['st_hm15', 'st_hm17']) {
      const led = clearingLedger(s, 'acct_dash', st, '2026-09-01', '2026-11-26');
      expect(led.closing).toBe(storeBalance(s, 'acct_dash', st, '2026-11-26'));
    }
    const flags = invoiceFlags(s, '2026-11-27');
    for (const i of s.fuel.invoices.filter((x) => x.supplier === 'dash' && !flags.get(x.id)!.duplicateOf)) {
      if (i.dueOn <= '2026-11-26') expect(i.settlement).toMatchObject({ kind: 'dash_clearing', on: i.dueOn });
    }
  });

  it('has one missing invoice, one duplicate, one price outlier, one unposted notice, one tank variance, one water alert and one store off its cpg target', () => {
    const inbox = Object.fromEntries(fuelInbox(s, all, '2026-11-27').map((i) => [i.key, i.count]));
    expect(inbox).toMatchObject({ fuel_missing: 1, fuel_dup: 1, fuel_outlier: 1, fuel_notice: 1, fuel_tank: 2, fuel_cpg: 1, fuel_unsettled: 0 });
    const tanks = s.fuel.tanks.map((t) => tankStatus(s, t.id, '2026-11-26')!);
    expect(tanks.filter((t) => t.varianceFlag).map((t) => `${t.tank.storeId} ${t.tank.grade}`)).toEqual(['st_hm13 premium']);
    expect(tanks.filter((t) => t.waterFlag).map((t) => `${t.tank.storeId} ${t.tank.grade}`)).toEqual(['st_hm11 regular']);
  });

  it('the waiting notice posts cleanly and its draft or deposit matches the bank line already in the feed', () => {
    const b = new Books(structuredClone(s));
    const n = b.state.fuel.notices.find((x) => x.status === 'unposted')!;
    expect(checkNotice(b.state, n).canPost).toBe(true);
    const txns = postNotice(b, b.state.users[0], n.id);
    const bankLine = txns.at(-1)!.lines.find((l) => l.accountId === 'acct_trustmark')!;
    const fed = b.state.bank.lines.find((l) => l.description.includes(`#${n.noticeNo}`))!;
    expect(fed.amount).toBe(bankLine.debit - bankLine.credit);
    expect(fed.date).toBe(txns.at(-1)!.date);
    expect(craddockReceivable(b.state, n.storeId, '2026-11-26').difference).toBe(0);
  });

  it('keeps the Phase 2 bank promises: statement explained, every entity balanced, one duplicate pair', () => {
    const st = reconcileStatus(s, 'acct_trustmark', '2026-11-25');
    expect(st.expectedStatement).toBe(st.feedBalance);
    for (const e of s.entities) expect(trialBalance(s, { asOf: '2026-11-30', entityId: e.id }).difference).toBe(0);
    expect(findDuplicates(s.transactions)).toHaveLength(1);
    expect(s.fuel.comdata.every((c) => c.batchId) && s.fuel.sales.every((x) => x.batchId)).toBe(true);
  });

  it('pricing board and ordering plan have something to say for every fuel store', () => {
    for (const st of fuelStores) {
      const board = pricingBoard(s, st, '2026-11-26');
      expect(board.find((r) => r.grade === 'regular')!.competitors.length).toBe(2);
      expect(orderingPlan(s, st, '2026-11-26').deliverOn).not.toBeNull();
    }
  });
});

describe('fuel margin rows', () => {
  it('each grade row reports its delivered cost per gallon (cogs ÷ gallons), not zero', async () => {
    const { buildDemo } = await import('../data/seed');
    const { fuelMargin } = await import('./fuel');
    const s = buildDemo();
    const m = fuelMargin(s, { storeIds: s.stores.map((x) => x.id), from: '2026-10-01', to: '2026-10-31', by: 'month' });
    for (const r of m.rows.filter((x) => x.gallons > 0 && x.cogs > 0)) expect(r.costCpg!).toBeCloseTo(r.cogs / r.gallons, 6);
    expect(m.rows.some((r) => (r.costCpg ?? 0) > 0)).toBe(true);
  });
});
