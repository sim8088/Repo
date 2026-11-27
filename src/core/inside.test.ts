import { beforeAll, describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import {
  D, budgetStatus, claimScanPeriod, commitPosImport, deptMargin, insideInbox, insideOf, inventoryTie, isShortage, lotteryCommissionTie, lotteryMath, parsePosFile, postCount,
  postedCounts, previewPosImport, purchaseLines, reviewCount, saveCount, saveLotteryWeek, saveScanProgram, saveVendorMapping, scanPeriods, setBudget, shrinkAlerts, storeTraffic,
  undoPosBatch, voidCount, logAgeCheck, resolveAgeCheck, ledgerDeptSales,
} from './inside';
import { itemStatus, saveReceivable, recordReceivableReceipt } from './receivables';
import { balanceAsOf } from './reports';
import { reconcileStatus } from './bank';
import { PermissionError } from './permissions';
import type { BooksState, User } from './types';
import type { DraftLine } from './ledger';

const dr = (accountId: string, storeId: string, cents: number, partyId?: string): DraftLine => ({ accountId, storeId, debit: cents, credit: 0, partyId });
const cr = (accountId: string, storeId: string, cents: number): DraftLine => ({ accountId, storeId, debit: 0, credit: cents });

/** A small set of books: an opening inventory at HM11, two POS closes and two purchases. */
function setup() {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  const cfo = s.users.find((x) => x.id === CFO_ID)!;
  const u = (role: User['role']) => s.users.find((x) => x.role === role)!;
  b.createTransaction(cfo, { date: '2026-08-31', kind: 'opening', description: 'Opening', lines: [dr('acct_trustmark', 'st_corp', 10_000_000), cr('acct_owner_capital', 'st_corp', 10_000_000)] });
  b.createTransaction(cfo, { date: '2026-08-31', kind: 'opening', description: 'Opening HM11', lines: [dr('acct_inv_merch', 'st_hm11', 2_000_000), cr('acct_owner_capital', 'st_hm11', 2_000_000)] });
  for (const date of ['2026-10-01', '2026-10-02']) {
    b.createTransaction(cfo, { date, kind: 'journal', description: 'POS daily close HM11', tags: ['pos'], lines: [
      dr('acct_cash_registers', 'st_hm11', 300_000), cr('acct_sales_tobacco', 'st_hm11', 100_000), cr('acct_sales_grocery', 'st_hm11', 60_000), cr('acct_sales_bev', 'st_hm11', 40_000),
      cr('acct_sales_kitchen', 'st_hm11', 50_000), cr('acct_sales_beer', 'st_hm11', 50_000),
    ] });
  }
  b.createTransaction(cfo, { date: '2026-10-02', kind: 'money_out', description: 'TOBACCO WHOLESALER HM11', partyId: 'pt_tobacco', lines: [dr('acct_cogs_tobacco', 'st_hm11', 150_000), cr('acct_trustmark', 'st_corp', 150_000)] });
  b.createTransaction(cfo, { date: '2026-10-02', kind: 'money_out', description: 'GROCERY WHOLESALER HM11', partyId: 'pt_grocery', checkNo: '5001', lines: [dr('acct_cogs_grocery', 'st_hm11', 100_000), cr('acct_trustmark', 'st_corp', 100_000)] });
  return { s, b, cfo, u };
}

const POS_FILE = 'Department,Net Sales,Qty Sold,Transactions\nCigarettes,800.00,95,\nOther tobacco,200.00,48,\nGrocery,600.00,250,\nPackaged beverage,400.00,180,\nBeer & wine,500.00,52,\nHot food,500.00,64,\nLottery,90.00,30,\nCustomer count,,,240\nTotal,3090.00,719,';

describe('POS department import', () => {
  it('reads PDI-style files, ties the preview to the file total and to the POS close, and is idempotent with batch ids', () => {
    const { s, b, cfo } = setup();
    const parsed = parsePosFile(POS_FILE, { storeCode: 'HM11', date: '2026-10-01' });
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toHaveLength(7);
    expect(parsed.totals[0]).toMatchObject({ sales: 309_000, transactions: 240 });
    const pv = previewPosImport(s, parsed);
    expect(pv.days).toHaveLength(1);
    expect(pv.days[0]).toMatchObject({ tiesFile: true, closeFound: true, tiesLedger: true, fileInClose: 300_000, ledgerInClose: 300_000, transactions: 240 });
    expect(pv.added).toBe(7);
    const r = commitPosImport(b, cfo, { name: 'dept-oct1.csv', parsed });
    expect(r.rows.every((x) => x.batchId === r.batch.id)).toBe(true);
    expect(r.days[0]).toMatchObject({ transactions: 240, batchId: r.batch.id });
    // Same file again: nothing new.
    const again = previewPosImport(s, parsePosFile(POS_FILE, { storeCode: 'HM11', date: '2026-10-01' }));
    expect(again.added).toBe(0);
    expect(again.rows.every((x) => x.status === 'duplicate')).toBe(true);
    commitPosImport(b, cfo, { name: 'dept-oct1.csv', parsed });
    expect(insideOf(s).posSales).toHaveLength(7);
    expect(insideOf(s).posDays).toHaveLength(1);
    // Traffic: inside + kitchen sales on the close ÷ customers.
    expect(storeTraffic(s, ['st_hm11'], '2026-10-01', '2026-10-31')).toMatchObject({ days: 1, transactions: 240, avgTicket: 1250 });
  });

  it('flags a file that does not tie, a changed amount and an unmapped department', () => {
    const { s, b, cfo } = setup();
    const off = previewPosImport(s, parsePosFile('Department,Sales\nCigarettes,900.00\nTotal,950.00', { storeCode: 'HM11', date: '2026-10-02' }));
    expect(off.days[0].tiesFile).toBe(false);
    expect(off.days[0].tiesLedger).toBe(false);
    commitPosImport(b, cfo, { name: 'a.csv', parsed: parsePosFile('Department,Sales\nCigarettes,800.00', { storeCode: 'HM11', date: '2026-10-02' }) });
    const changed = previewPosImport(s, parsePosFile('Department,Sales\nCigarettes,810.00\nWidgets,5.00', { storeCode: 'HM11', date: '2026-10-02' }));
    expect(changed.rows[0]).toMatchObject({ status: 'problem' });
    expect(changed.rows[0].problem).toMatch(/Already imported/);
    expect(changed.rows[1].problem).toMatch(/isn't mapped/);
    expect(parsePosFile('Item,Amount\nx,1').problems[0]).toMatch(/Department and Sales/);
    // Undo removes the batch so a corrected file can go in.
    const batch = insideOf(s).batches[0].id;
    expect(undoPosBatch(b, cfo, batch)).toBe(1);
    expect(previewPosImport(s, parsePosFile('Department,Sales\nCigarettes,810.00', { storeCode: 'HM11', date: '2026-10-02' })).added).toBe(1);
  });
});

describe('vendor purchases and department margin', () => {
  it('maps purchases to departments, splitting a multi-department vendor by sales, and the margin ties to the ledger', () => {
    const { s, b, cfo } = setup();
    saveVendorMapping(b, cfo, { partyId: 'pt_grocery', accountId: 'acct_cogs_grocery', departmentIds: [D.grocery, D.bev] });
    const lines = purchaseLines(s, { from: '2026-10-01', to: '2026-10-31' });
    const groc = lines.find((l) => l.partyId === 'pt_grocery')!;
    // Grocery 1,200 vs beverages 800 in sales: 60 / 40.
    expect(groc.alloc).toEqual([{ departmentId: D.grocery, amount: 60_000 }, { departmentId: D.bev, amount: 40_000 }]);
    expect(groc.method).toBe('check');
    expect(lines.find((l) => l.partyId === 'pt_tobacco')!.method).toBe('eft');
    const m = deptMargin(s, { storeIds: ['st_hm11'], from: '2026-10-01', to: '2026-10-31' });
    const tob = m.rows.find((r) => r.departmentId === D.tobacco)!;
    expect(tob).toMatchObject({ sales: 200_000, purchases: 150_000, cogs: 150_000, margin: 50_000 });
    expect(tob.marginPct).toBeCloseTo(0.25);
    expect(m.cogs).toBe(m.ledgerCogs);
    expect(m.sales).toBe(600_000);
    expect(() => saveVendorMapping(b, cfo, { partyId: 'pt_grocery', accountId: 'acct_cogs_grocery', departmentIds: [D.grocery] })).toThrow(ValidationError);
  });
});

describe('inventory counts and shrink', () => {
  it('an opening count that agrees with the books posts nothing; the next count shows shrink and posts the adjustment', () => {
    const { s, b, cfo } = setup();
    const open = saveCount(b, cfo, { storeId: 'st_hm11', date: '2026-08-31', lines: [{ departmentId: D.tobacco, counted: 1_200_000 }, { departmentId: D.grocery, counted: 800_000 }] });
    expect(reviewCount(s, open).adjustment).toBe(0);
    postCount(b, cfo, open.id);
    expect(open.posted?.txnId).toBeUndefined();
    // Tobacco: 12,000 + 1,500 purchases − 2,000 sales × 82% = 11,860 book. Counted 11,800: 60 short = 3% of sales.
    const next = saveCount(b, cfo, { storeId: 'st_hm11', date: '2026-10-31', lines: [{ departmentId: D.tobacco, counted: 1_180_000 }, { departmentId: D.grocery, counted: 800_000 }] });
    const r = reviewCount(s, next);
    const tob = r.lines.find((l) => l.departmentId === D.tobacco)!;
    expect(tob).toMatchObject({ previous: 1_200_000, purchases: 150_000, sales: 200_000, salesAtCost: 164_000, book: 1_186_000, shrink: 6_000, adjustment: -20_000 });
    expect(tob.shrinkPct).toBeCloseTo(0.03);
    expect(tob.over).toBe(true);
    postCount(b, cfo, next.id);
    const t = s.transactions.find((x) => x.id === next.posted!.txnId)!;
    expect(t.tags).toContain('inventory count');
    expect(t.lines.find((l) => l.accountId === 'acct_inv_merch')).toMatchObject({ credit: 20_000 });
    expect(t.lines.find((l) => l.accountId === 'acct_cogs_tobacco')).toMatchObject({ debit: 20_000 });
    expect(balanceAsOf(s, 'acct_inv_merch', '2026-10-31')).toBe(1_980_000);
    expect(inventoryTie(s, 'st_hm11', '2026-10-31')).toMatchObject({ ok: true, ledger: 1_980_000, counted: 1_980_000 });
    expect(shrinkAlerts(s, new Set(['st_hm11'])).map((x) => x.departmentId)).toEqual([D.tobacco]);
    // Department margin now includes the inventory change; it still ties to the ledger.
    const m = deptMargin(s, { storeIds: ['st_hm11'], from: '2026-10-01', to: '2026-10-31' });
    expect(m.rows.find((x) => x.departmentId === D.tobacco)).toMatchObject({ invChange: -20_000, cogs: 170_000 });
    expect(m.cogs).toBe(m.ledgerCogs);
    // Purchases leave the count adjustment out.
    expect(purchaseLines(s, { from: '2026-10-31', to: '2026-10-31' })).toHaveLength(0);
  });

  it('counts post in date order, never into a locked month, and only the latest can be voided', () => {
    const { s, b, cfo } = setup();
    const a = saveCount(b, cfo, { storeId: 'st_hm11', date: '2026-10-15', lines: [{ departmentId: D.tobacco, counted: 2_000_000 }] });
    postCount(b, cfo, a.id);
    expect(() => saveCount(b, cfo, { storeId: 'st_hm11', date: '2026-10-10', lines: [{ departmentId: D.tobacco, counted: 1 }] })).toThrow(/date order/);
    expect(() => saveCount(b, cfo, { storeId: 'st_hm11', date: '2026-10-20', lines: [{ departmentId: D.lottery, counted: 1 }] })).toThrow(/counted department/);
    expect(() => saveCount(b, cfo, { storeId: 'st_hm11', date: '2026-10-20', lines: [{ departmentId: D.tobacco, counted: -5 }] })).toThrow(ValidationError);
    const later = saveCount(b, cfo, { storeId: 'st_hm11', date: '2026-10-25', lines: [{ departmentId: D.tobacco, counted: 1_900_000 }] });
    postCount(b, cfo, later.id);
    expect(() => voidCount(b, cfo, a.id, 'wrong')).toThrow(/latest/);
    voidCount(b, cfo, later.id, 'Miscounted');
    expect(s.transactions.find((t) => t.id === later.posted!.txnId)!.deleted).toBeTruthy();
    expect(balanceAsOf(s, 'acct_inv_merch', '2026-10-31')).toBe(2_000_000);
    b.lockPeriod(cfo, '2026-08');
    expect(() => saveCount(b, cfo, { storeId: 'st_hm11', date: '2026-08-31', lines: [{ departmentId: D.tobacco, counted: 1 }] })).toThrow(/locked|date order/);
  });

  it('a count of one department leaves the others at their last count', () => {
    const { s, b, cfo } = setup();
    postCount(b, cfo, saveCount(b, cfo, { storeId: 'st_hm11', date: '2026-08-31', lines: [{ departmentId: D.tobacco, counted: 1_200_000 }, { departmentId: D.grocery, counted: 800_000 }] }).id);
    const c = saveCount(b, cfo, { storeId: 'st_hm11', date: '2026-10-31', lines: [{ departmentId: D.grocery, counted: 790_000 }] });
    expect(reviewCount(s, c).adjustment).toBe(-10_000);
    postCount(b, cfo, c.id);
    expect(inventoryTie(s, 'st_hm11', '2026-10-31')).toMatchObject({ ok: true, ledger: 1_990_000 });
  });

  it('store managers enter counts for their own store; only the CFO or bookkeeper posts them', () => {
    const { s, b, u } = setup();
    const mgr = u('store_manager');
    const c = saveCount(b, mgr, { storeId: 'st_hm11', date: '2026-10-31', lines: [{ departmentId: D.tobacco, counted: 1_000 }] });
    expect(c.status).toBe('draft');
    expect(() => saveCount(b, mgr, { storeId: 'st_hm13', date: '2026-10-31', lines: [{ departmentId: D.tobacco, counted: 1_000 }] })).toThrow(PermissionError);
    expect(() => postCount(b, mgr, c.id)).toThrow(PermissionError);
    expect(() => saveCount(b, u('owner'), { storeId: 'st_hm11', date: '2026-10-31', lines: [] })).toThrow(PermissionError);
    postCount(b, u('bookkeeper'), c.id);
    expect(postedCounts(s, 'st_hm11')).toHaveLength(1);
  });
});

describe('purchasing budgets', () => {
  it('remaining = budget − spent − bills awaiting approval, and over budget is flagged', () => {
    const { s, b, cfo, u } = setup();
    setBudget(b, cfo, { storeId: 'st_hm11', period: '2026-10', departmentId: D.tobacco, amount: 200_000 });
    setBudget(b, cfo, { storeId: 'st_hm11', period: '2026-10', departmentId: D.grocery, amount: 50_000 });
    s.payables.bills.push({ id: 'bl1', ref: 'BILL-0001', vendorId: 'pt_tobacco', storeId: 'st_hm11', invoiceNo: 'T1', billDate: '2026-10-20', dueDate: '2026-11-20', lines: [{ id: 'x', accountId: 'acct_cogs_tobacco', storeId: 'st_hm11', amount: 30_000 }], status: 'draft', autopay: false, attachments: [], source: 'manual', createdAt: '', createdBy: cfo.id });
    const rows = budgetStatus(s, '2026-10', ['st_hm11']);
    expect(rows.find((r) => r.departmentId === D.tobacco)).toMatchObject({ budget: 200_000, spent: 150_000, committed: 30_000, remaining: 20_000, over: false });
    expect(rows.find((r) => r.departmentId === D.grocery)).toMatchObject({ budget: 50_000, spent: 60_000, remaining: -10_000, over: true }); // 5120 splits grocery / beverages by sales
    setBudget(b, cfo, { storeId: 'st_hm11', period: '2026-10', departmentId: D.tobacco, amount: 100_000 });
    expect(insideOf(s).budgets).toHaveLength(2);
    expect(budgetStatus(s, '2026-10', ['st_hm11']).find((r) => r.departmentId === D.tobacco)!.over).toBe(true);
    expect(() => setBudget(b, u('store_manager'), { storeId: 'st_hm11', period: '2026-10', departmentId: D.tobacco, amount: 1 })).toThrow(PermissionError);
    expect(() => setBudget(b, cfo, { storeId: 'st_hm11', period: '2026-10', departmentId: D.lottery, amount: 1 })).toThrow(ValidationError);
  });
});

describe('scan-data rebates', () => {
  it('expected = units × share × rate; claiming puts it on Receivables; a smaller payment is short-paid', () => {
    const { s, b, cfo } = setup();
    commitPosImport(b, cfo, { name: 'p.csv', parsed: parsePosFile(POS_FILE, { storeCode: 'HM11', date: '2026-10-01' }) });
    saveScanProgram(b, cfo, { id: 'sp1', manufacturer: 'Maker A', departmentId: D.tobacco, rateCentsPerUnit: 50, shareBps: 5_000, cadence: 'monthly', storeIds: ['st_hm11'], payDays: 15, active: true });
    // 143 tobacco units × 50% = 72 qualifying (rounded) × 50¢ = $36.00.
    const p = scanPeriods(s, 'sp1', '2026-11-20');
    expect(p[0]).toMatchObject({ key: '2026-10', units: 143, qualifying: 72, expected: 3_600, status: 'to_claim', due: '2026-11-15' });
    const itemId = claimScanPeriod(b, cfo, 'sp1', '2026-10', '2026-11-20');
    expect(s.receivables.items.find((i) => i.id === itemId)).toMatchObject({ kind: 'rebate', payer: 'Maker A', expected: 3_600 });
    expect(scanPeriods(s, 'sp1', '2026-11-20')[0].status).toBe('overdue');
    recordReceivableReceipt(b, cfo, itemId, { date: '2026-11-21', amount: 3_000 });
    expect(scanPeriods(s, 'sp1', '2026-11-25')[0]).toMatchObject({ received: 3_000, short: 600, status: 'short' });
    // Linking an existing rebate instead of creating a second one.
    saveReceivable(b, cfo, { id: 'ar_x', kind: 'rebate', payer: 'Maker B', storeId: 'st_corp', description: 'Q4', expected: 100, expectedBy: '2027-01-15', incomeAccountId: 'acct_rebates', receipts: [], createdAt: 'x' });
    saveScanProgram(b, cfo, { id: 'sp2', manufacturer: 'Maker B', departmentId: D.tobacco, rateCentsPerUnit: 10, shareBps: 10_000, cadence: 'quarterly', storeIds: ['st_hm11'], payDays: 30, receivables: { '2026Q4': 'ar_x' }, active: true });
    expect(claimScanPeriod(b, cfo, 'sp2', '2026Q4', '2027-01-05')).toBe('ar_x');
    expect(s.receivables.items.filter((i) => i.payer === 'Maker B')).toHaveLength(1);
    expect(s.receivables.items.find((i) => i.id === 'ar_x')!.expected).toBe(1_430);
    expect(() => saveScanProgram(b, cfo, { manufacturer: '', departmentId: D.tobacco, rateCentsPerUnit: 0, shareBps: 0, cadence: 'monthly', storeIds: [], payDays: 1, active: true })).toThrow(ValidationError);
  });
});

describe('lottery', () => {
  it('settlement = sales − payouts − commission; a register short of the lottery report is a shortage; commissions tie to 4140', () => {
    const { s, b, cfo, u } = setup();
    const w = saveLotteryWeek(b, cfo, { storeId: 'st_hm11', weekEnding: '2026-10-03', instantSales: 400_000, onlineSales: 150_000, instantCashes: 240_000, onlinePayouts: 70_000, commission: 30_000, settlement: 210_000, posNet: 225_000 });
    const m = lotteryMath(w);
    expect(m).toMatchObject({ sales: 550_000, payouts: 310_000, due: 210_000, settlementDiff: 0, expectedCash: 240_000, variance: -15_000 });
    expect(isShortage(s, w)).toBe(true);
    // Re-entering the same store and week updates it.
    saveLotteryWeek(b, cfo, { ...w, posNet: 240_000 });
    expect(insideOf(s).lottery).toHaveLength(1);
    expect(isShortage(s, insideOf(s).lottery[0])).toBe(false);
    expect(lotteryCommissionTie(s, ['st_hm11'], '2026-10')).toMatchObject({ weeks: 30_000, ledger: 0, ok: false });
    b.createTransaction(cfo, { date: '2026-10-20', kind: 'money_in', description: 'MS LOTTERY COMMISSION HM11', lines: [dr('acct_trustmark', 'st_corp', 30_000), cr('acct_sales_lottery', 'st_hm11', 30_000)] });
    expect(lotteryCommissionTie(s, ['st_hm11'], '2026-10').ok).toBe(true);
    expect(() => saveLotteryWeek(b, u('store_manager'), { ...w, storeId: 'st_hm13' })).toThrow(PermissionError);
    expect(() => saveLotteryWeek(b, cfo, { ...w, instantSales: -1 })).toThrow(ValidationError);
  });
});

describe('age-check audits', () => {
  it('a failure needs a follow-up; store managers log for their store', () => {
    const { s, b, cfo, u } = setup();
    expect(() => logAgeCheck(b, cfo, { date: '2026-11-01', storeId: 'st_hm11', product: 'tobacco', result: 'fail', checkedBy: 'State' })).toThrow(/follow-up/);
    const a = logAgeCheck(b, u('store_manager'), { date: '2026-11-01', storeId: 'st_hm11', product: 'tobacco', result: 'fail', checkedBy: 'State', followUp: 'Retrain' });
    expect(() => logAgeCheck(b, u('store_manager'), { date: '2026-11-01', storeId: 'st_hm13', product: 'tobacco', result: 'pass', checkedBy: 'State' })).toThrow(PermissionError);
    resolveAgeCheck(b, cfo, a.id, 'Done');
    expect(insideOf(s).ageChecks[0].resolved?.note).toBe('Done');
  });
});

describe('demo data', () => {
  let s: BooksState;
  beforeAll(() => { s = buildDemo(); });
  const ops = ['st_hm11', 'st_hm13', 'st_hm15', 'st_hm17'];

  it('POS department detail ties to every imported POS close and department margin ties to 5100–5200', () => {
    for (const p of ['2026-09', '2026-10', '2026-11']) {
      const m = deptMargin(s, { storeIds: ops, from: `${p}-01`, to: p === '2026-11' ? '2026-11-30' : `${p}-${p === '2026-09' ? 30 : 31}` });
      expect(m.posOff).toEqual([]);
      expect(m.cogs).toBe(m.ledgerCogs);
      expect(m.unassigned).toBe(0);
    }
    const ins = insideOf(s);
    const imported = ins.posSales.reduce((a, x) => a + x.sales, 0);
    const ledger = [...ledgerDeptSales(s, { storeIds: ops, from: '2026-09-01', to: '2026-11-25', posOnly: true }).entries()].filter(([k]) => !k.endsWith(D.lottery)).reduce((a, [, v]) => a + v, 0);
    expect(imported).toBe(ledger);
    expect(ins.posSales.every((x) => ins.batches.some((bt) => bt.id === x.batchId))).toBe(true);
    // 26 Nov is left for the import workflow.
    expect(ins.posSales.some((x) => x.date === '2026-11-26')).toBe(false);
  });

  it('counts tie 1310 at every store; HM13 tobacco shrink is high; HM15 tobacco is over budget; scan-data and lottery as designed', () => {
    for (const st of ops) expect(inventoryTie(s, st, '2026-11-26').ok).toBe(true);
    expect(shrinkAlerts(s, new Set(ops)).map((r) => `${r.storeId} ${r.departmentId}`)).toEqual(['st_hm13 dept_tobacco']);
    expect(budgetStatus(s, '2026-11', ops).filter((r) => r.over).map((r) => `${r.storeId} ${r.departmentId}`)).toEqual(['st_hm15 dept_tobacco']);
    const rey = scanPeriods(s, 'scan_reynolds', '2026-11-26').find((x) => x.key === '2026Q3')!;
    expect(rey.status).toBe('short');
    expect(rey.received).toBe(324_060);
    expect(scanPeriods(s, 'scan_itg', '2026-11-26').find((x) => x.key === '2026Q3')!.status).toBe('overdue');
    expect(itemStatus(s, s.receivables.items.find((i) => i.id === 'ar_reynolds_q3')!, '2026-11-26').outstanding).toBe(rey.short);
    const short = insideOf(s).lottery.filter((w) => isShortage(s, w));
    expect(short.map((w) => `${w.storeId} ${w.weekEnding}`)).toEqual(['st_hm13 2026-11-14']);
    for (const p of ['2026-09', '2026-10', '2026-11']) expect(lotteryCommissionTie(s, ops, p).ok).toBe(true);
    const all = new Set(s.stores.map((x) => x.id));
    expect(insideInbox(s, all, '2026-11-27').map((i) => [i.key, i.count])).toEqual([['shrink', 1], ['budget', 1], ['lottery', 1], ['scanshort', 1]]);
  });

  it('leaves the bank feed and reconciliations as they were', () => {
    expect(s.transactions.some((t) => t.tags.includes('inventory count') && t.lines.some((l) => l.accountId === 'acct_trustmark'))).toBe(false);
    const st = reconcileStatus(s, 'acct_trustmark', '2026-10-31');
    expect(st.expectedStatement).toBe(st.feedBalance);
    expect(s.bank.reconciliations.map((r) => r.statementDate)).toEqual(['2026-09-30', '2026-10-31']);
  });
});
