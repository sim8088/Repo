import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import {
  addScorecardNote, balanceSheet, basisEntries, bridge, budgetCompare, cashFlow, commandCenter, DEFAULT_THRESHOLDS, deleteReport, drill, priorRange, rate,
  reportsOf, runReport, saveReport, scorecards, setThreshold, statement, summaryLetter, thresholdsOf,
} from './statements';
import { pnl, trialBalance } from './reports';
import { approveBill, payBill, saveBill } from './payables';
import { fuelCostOfSales } from './fuel';
import { colName, crc32, sheetName, unzip, xlsx } from './xlsx';
import { PermissionError } from './permissions';
import { periodsBetween } from './dates';
import type { BooksState, User } from './types';

const HM11 = 'st_hm11';

/** A tiny book with one of each kind of timing difference, all at HM11 in September. */
function small() {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  const cfo = s.users.find((x) => x.id === CFO_ID)!;
  b.createTransaction(cfo, { date: '2026-09-01', kind: 'opening', description: 'Opening', lines: [
    { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 10_000_000, credit: 0 }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: 0, credit: 10_000_000 }] });
  const check = b.createTransaction(cfo, { date: '2026-09-10', kind: 'money_out', description: 'Check to plumber', checkNo: '101', lines: [
    { accountId: 'acct_repairs', storeId: HM11, debit: 50_000, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 50_000 }] });
  const ach = b.createTransaction(cfo, { date: '2026-09-28', kind: 'money_out', description: 'ACH utility', lines: [
    { accountId: 'acct_utilities', storeId: HM11, debit: 30_000, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 30_000 }] });
  const bankLine = ach.lines.find((l) => l.accountId === 'acct_trustmark')!;
  s.bank.lines.push({ id: 'bl_1', accountId: 'acct_trustmark', date: '2026-10-02', description: 'ACH UTILITY', amount: -30_000, hash: 'h1', batchId: 'b1', matchedLineIds: [bankLine.id] });
  b.createTransaction(cfo, { date: '2026-09-15', kind: 'money_in', description: 'Lottery commission', lines: [
    { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 100_000, credit: 0 }, { accountId: 'acct_sales_lottery', storeId: HM11, debit: 0, credit: 100_000 }] });
  b.createTransaction(cfo, { date: '2026-09-12', kind: 'journal', description: 'Dash pays fuel invoice', lines: [
    { accountId: 'acct_cogs_fuel', storeId: HM11, debit: 200_000, credit: 0 }, { accountId: 'acct_dash', storeId: HM11, debit: 0, credit: 200_000 }] });
  const bill = saveBill(b, cfo, { vendorId: 'pt_entergy', storeId: HM11, invoiceNo: 'S-1', billDate: '2026-09-20', dueDate: '2026-10-05', lines: [{ accountId: 'acct_supplies', storeId: HM11, amount: 20_000 }] });
  approveBill(b, cfo, bill.id);
  payBill(b, cfo, bill.id, { date: '2026-10-05', method: 'ach', confirmation: 'ACH-9' });
  return { s, b, cfo, check };
}

const net = (s: BooksState, basis: 'cash' | 'accrual' | 'booked', from: string, to = from, storeIds = [HM11]) => statement(s, { basis, from, to, storeIds }).netIncome.total;

describe('cash and accrual bases', () => {
  it('cash: clear date for bank items, uncleared checks out, bills when paid; accrual: book date, paid fuel out', () => {
    const { s } = small();
    // Cash Sep: lottery +1,000 − fuel paid from Dash clearing 2,000 (clearing is a cash equivalent).
    expect(net(s, 'cash', '2026-09')).toBe(100_000 - 200_000);
    // Cash Oct: the ACH cleared 2 Oct, the bill was paid 5 Oct.
    expect(net(s, 'cash', '2026-10')).toBe(-30_000 - 20_000);
    // Accrual Sep: everything on its date, the paid fuel invoice taken out (no fuel sales here, so no accrual COGS).
    expect(net(s, 'accrual', '2026-09')).toBe(100_000 - 50_000 - 30_000 - 20_000);
    expect(net(s, 'accrual', '2026-10')).toBe(0);
    // Booked = the ledger.
    expect(net(s, 'booked', '2026-09')).toBe(pnl(s, { from: '2026-09', to: '2026-09', storeIds: [HM11] }).netIncome.total);
  });

  it('an uncleared check enters the cash basis on the day it clears', () => {
    const { s, check } = small();
    const l = check.lines.find((x) => x.accountId === 'acct_trustmark')!;
    s.bank.lines.push({ id: 'bl_2', accountId: 'acct_trustmark', date: '2026-10-08', description: 'CHECK 101', amount: -50_000, checkNo: '101', hash: 'h2', batchId: 'b1', matchedLineIds: [l.id] });
    expect(net(s, 'cash', '2026-10')).toBe(-30_000 - 20_000 - 50_000);
    const e = basisEntries(s).find((x) => x.txn?.id === check.id)!;
    expect(e).toMatchObject({ cashDate: '2026-10-08', accrualDate: '2026-09-10', reason: 'clear_timing' });
  });

  it('the bridge explains cash → accrual line by line and ties', () => {
    const { s } = small();
    const sep = bridge(s, { from: '2026-09', to: '2026-09', storeIds: [HM11] });
    const by = Object.fromEntries(sep.lines.map((l) => [l.reason, l.amount]));
    expect(by).toEqual({ uncleared_check: -50_000, clear_timing: -30_000, bill_timing: -20_000, fuel_paid: 200_000, fuel_accrual: 0 });
    expect(sep.ties).toBe(true);
    expect(sep.cash + sep.total).toBe(sep.accrual);
    expect(sep.fuel).toMatchObject({ paid: 200_000, accrualCogs: 0 });
    const oct = bridge(s, { from: '2026-10', to: '2026-10', storeIds: [HM11] });
    expect(Object.fromEntries(oct.lines.map((l) => [l.reason, l.amount]))).toMatchObject({ clear_timing: 30_000, bill_timing: 20_000 });
    expect(oct.ties).toBe(true);
    // Over both months the timing differences wash out; only the uncleared check and the fuel remain.
    const both = bridge(s, { from: '2026-09', to: '2026-10', storeIds: [HM11] });
    expect(Object.fromEntries(both.lines.map((l) => [l.reason, l.amount]))).toMatchObject({ clear_timing: 0, bill_timing: 0, uncleared_check: -50_000, fuel_paid: 200_000 });
  });

  it('drill-down returns exactly the entries behind a figure', () => {
    const { s } = small();
    const entries = basisEntries(s);
    const st = statement(s, { basis: 'cash', from: '2026-10', to: '2026-10', storeIds: [HM11], entries });
    const d = drill(entries, { basis: 'cash', from: '2026-10', to: '2026-10', storeIds: [HM11] });
    expect(d.reduce((a, e) => a + e.amount, 0)).toBe(st.netIncome.total);
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ accountId: 'acct_utilities', cashDate: '2026-10-02', bookDate: '2026-09-28' });
    expect(d[1]).toMatchObject({ accountId: 'acct_supplies', cashDate: '2026-10-05', reason: 'bill_timing' });
  });

  it('demo: booked statement equals the ledger P&L; accrual = booked − paid fuel + accrual fuel COGS; bridge ties every month', () => {
    const s = buildDemo();
    const entries = basisEntries(s);
    const stores = s.stores.map((x) => x.id);
    for (const p of ['2026-09', '2026-10', '2026-11']) {
      const booked = statement(s, { basis: 'booked', from: p, to: p, storeIds: stores, entries });
      const ledger = pnl(s, { from: p, to: p, storeIds: stores });
      expect(booked.netIncome).toEqual(ledger.netIncome);
      expect(booked.difference).toBe(0);
      const accrual = statement(s, { basis: 'accrual', from: p, to: p, storeIds: stores, entries });
      const paidFuel = ledger.rows.find((r) => r.account.id === 'acct_cogs_fuel')?.total ?? 0;
      const accrualFuel = stores.reduce((a, st) => a + fuelCostOfSales(s, st, p).cogs, 0);
      expect(accrualFuel).toBeGreaterThan(0);
      expect(accrual.netIncome.total).toBe(ledger.netIncome.total + paidFuel - accrualFuel);
      expect(accrual.rows.find((r) => r.account.id === 'acct_cogs_fuel')!.total).toBe(accrualFuel);
      const br = bridge(s, { from: p, to: p, storeIds: stores, entries });
      expect(br.ties).toBe(true);
      expect(br.accrual).toBe(accrual.netIncome.total);
      expect(br.cash).toBe(statement(s, { basis: 'cash', from: p, to: p, storeIds: stores, entries }).netIncome.total);
      expect(br.fuel.inventoryChange - br.fuel.payableChange).toBe(br.fuel.paid - br.fuel.accrualCogs);
      // Fuel lines of the bridge = paid − accrual.
      const fuelLines = br.lines.filter((l) => l.reason === 'fuel_paid' || l.reason === 'fuel_accrual').reduce((a, l) => a + l.amount, 0);
      expect(fuelLines).toBe(br.fuel.paid - br.fuel.accrualCogs);
    }
    // November has uncleared checks (cash basis leaves them out).
    const nov = bridge(s, { from: '2026-11', to: '2026-11', storeIds: stores, entries });
    expect(nov.lines.find((l) => l.reason === 'uncleared_check')!.count).toBeGreaterThan(0);
  });

  it('by-month columns add to the range total, and prior range is the same length just before', () => {
    const s = buildDemo();
    const stores = s.stores.map((x) => x.id);
    const st = statement(s, { basis: 'accrual', from: '2026-09', to: '2026-11', storeIds: stores, cols: 'month' });
    expect(st.cols).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(st.cols.reduce((a, c) => a + st.netIncome[c], 0)).toBe(st.netIncome.total);
    expect(priorRange('2026-11', '2026-11')).toEqual({ from: '2026-10', to: '2026-10' });
    expect(priorRange('2026-10', '2026-11')).toEqual({ from: '2026-08', to: '2026-09' });
    expect(priorRange('2026-01', '2026-02')).toEqual({ from: '2025-11', to: '2025-12' });
  });

  it('budget hook: no figures says phase 8; figures give variances', () => {
    const { s } = small();
    const st = statement(s, { basis: 'accrual', from: '2026-09', to: '2026-09', storeIds: [HM11] });
    expect(budgetCompare(st)).toEqual({ available: false, message: 'Budgets arrive in phase 8.' });
    const c = budgetCompare(st, { byAccount: { acct_repairs: 40_000 } });
    expect(c.available && c.rows.find((r) => r.accountId === 'acct_repairs')).toMatchObject({ actual: 50_000, budget: 40_000, variance: 10_000 });
  });
});

describe('balance sheet', () => {
  it('balances and agrees to the trial balance at several dates, by entity and consolidated', () => {
    const s = buildDemo();
    for (const asOf of ['2026-08-31', '2026-09-30', '2026-10-15', '2026-11-26', '2026-12-31']) {
      for (const entityId of [undefined, ...s.entities.map((e) => e.id)]) {
        const bs = balanceSheet(s, { asOf, entityId });
        expect(bs.difference, `${asOf} ${entityId}`).toBe(0);
        expect(bs.agreesToTb, `${asOf} ${entityId} ${bs.tbMismatches}`).toBe(true);
        expect(bs.currentEarnings).toBe(trialBalance(s, { asOf, entityId }).netIncome);
      }
      expect(balanceSheet(s, { asOf }).groupNet).toBe(0);
    }
  });

  it('breaks intercompany out by party, and the parties add to the account', () => {
    const s = buildDemo();
    const bs = balanceSheet(s, { asOf: '2026-11-26' });
    const ic = bs.sections[0].groups.find((g) => g.key === 'intercompany')!;
    const loans = ic.lines.find((l) => l.account.id === 'acct_loans_related')!;
    expect(loans.children!.map((c) => c.label)).toContain('Southern Eagle');
    expect(loans.children!.reduce((a, c) => a + c.amount, 0)).toBe(loans.amount);
    expect(bs.sections[1].groups.map((g) => g.key)).toContain('accrued');
  });
});

describe('cash flow statement', () => {
  it('net income + working capital + investing + financing = change in cash and equivalents', () => {
    const s = buildDemo();
    const ranges: [string, string][] = [['2026-09-01', '2026-09-30'], ['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-26'], ['2026-09-01', '2026-11-30']];
    for (const [from, to] of ranges) {
      for (const entityId of [undefined, ...s.entities.map((e) => e.id)]) {
        const cf = cashFlow(s, { from, to, entityId });
        expect(cf.ties, `${from} ${entityId}`).toBe(true);
        expect(cf.openingCash + cf.netChange).toBe(cf.closingCash);
        expect(cf.netIncome).toBe(trialBalance(s, { asOf: to, entityId }).netIncome - (from > '2026-01-01' ? trialBalance(s, { asOf: dayBefore(from), entityId }).netIncome : 0));
      }
    }
    const sep = cashFlow(s, { from: '2026-09-01', to: '2026-09-30' });
    expect(sep.sections[0].lines.some((l) => l.accountId === 'acct_accum_dep' && l.amount > 0)).toBe(true);
    expect(sep.sections[2].lines.find((l) => l.key === 'group')).toBeUndefined(); // group entities net out consolidated
    expect(cashFlow(s, { from: '2026-09-01', to: '2026-09-30', entityId: 'ent_hm11' }).sections[2].lines.find((l) => l.key === 'group')).toBeDefined();
  });
});

const dayBefore = (d: string) => new Date(Date.parse(d + 'T12:00:00Z') - 86_400_000).toISOString().slice(0, 10);

describe('command center', () => {
  it('one row per store with activity; rows add to the company total, which ties to the P&L', () => {
    const s = buildDemo();
    const stores = s.stores.map((x) => x.id);
    for (const basis of ['booked', 'cash', 'accrual'] as const) {
      const cc = commandCenter(s, { period: '2026-11', basis, storeIds: stores });
      expect(cc.rowsAddUp).toBe(true);
      expect(cc.tiesToPnl).toBe(true);
      expect(cc.total.net).toBe(statement(s, { basis, from: '2026-11', to: '2026-11', storeIds: stores }).netIncome.total);
      expect(cc.rows.map((r) => r.key)).toContain('st_hm17');
    }
    const sep = commandCenter(s, { period: '2026-09', basis: 'accrual', storeIds: stores });
    expect(sep.rows.map((r) => r.key)).not.toContain('st_hm17'); // opened in November, no activity in September
    const oct = commandCenter(s, { period: '2026-10', basis: 'accrual', storeIds: stores });
    const hm11 = oct.rows.find((r) => r.key === HM11)!;
    expect(hm11.laborPct).toBeCloseTo(hm11.labor / hm11.sales, 10);
  });
});

describe('scorecards', () => {
  it('rates green / amber / red against thresholds in the right direction', () => {
    expect(rate(30, { better: 'higher' }, { green: 25, amber: 18 })).toBe('green');
    expect(rate(25, { better: 'higher' }, { green: 25, amber: 18 })).toBe('green');
    expect(rate(20, { better: 'higher' }, { green: 25, amber: 18 })).toBe('amber');
    expect(rate(17.9, { better: 'higher' }, { green: 25, amber: 18 })).toBe('red');
    expect(rate(1.9, { better: 'lower' }, { green: 2, amber: 2.5 })).toBe('green');
    expect(rate(2.5, { better: 'lower' }, { green: 2, amber: 2.5 })).toBe('amber');
    expect(rate(2.6, { better: 'lower' }, { green: 2, amber: 2.5 })).toBe('red');
    expect(rate(null, { better: 'lower' }, { green: 2, amber: 2.5 })).toBe('na');
  });

  it('demo November: every operating store scored; HM17\'s low fuel margin is not green; thresholds are configurable and validated', () => {
    const s = buildDemo();
    const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
    const cfo = s.users.find((x) => x.id === CFO_ID)!;
    const stores = s.stores.map((x) => x.id);
    const rows = scorecards(s, { period: '2026-11', storeIds: stores });
    expect(rows.map((r) => r.storeId).sort()).toEqual(['st_hm11', 'st_hm13', 'st_hm15', 'st_hm17']);
    const hm17 = rows.find((r) => r.storeId === 'st_hm17')!;
    expect(hm17.kpis.find((k) => k.key === 'fuelCpg')!.status).not.toBe('green');
    expect(hm17.notes).toHaveLength(1);
    for (const r of rows) expect(Object.values(r.counts).reduce((a, n) => a + n, 0)).toBe(r.kpis.length);
    const cpg = rows.find((r) => r.storeId === HM11)!.kpis.find((k) => k.key === 'fuelCpg')!.value!;
    setThreshold(b, cfo, 'fuelCpg', { green: cpg + 1, amber: cpg - 1 });
    expect(scorecards(s, { period: '2026-11', storeIds: [HM11] })[0].kpis.find((k) => k.key === 'fuelCpg')!.status).toBe('amber');
    expect(thresholdsOf(s).fuelCpg).toEqual({ green: cpg + 1, amber: cpg - 1 });
    expect(() => setThreshold(b, cfo, 'fuelCpg', { green: 10, amber: 20 })).toThrow(ValidationError);
    expect(() => setThreshold(b, cfo, 'cardFee', { green: 3, amber: 2 })).toThrow(/amber line must be at or above/);
    setThreshold(b, cfo, 'fuelCpg', null);
    expect(thresholdsOf(s).fuelCpg).toEqual(DEFAULT_THRESHOLDS.fuelCpg);
    const owner = s.users.find((x) => x.role === 'owner') as User;
    expect(() => setThreshold(b, owner, 'fuelCpg', { green: 30, amber: 20 })).toThrow(PermissionError);
    const n = addScorecardNote(b, owner, { storeId: HM11, period: '2026-11', text: 'Looks good' });
    expect(reportsOf(s).notes).toContain(n);
    expect(() => addScorecardNote(b, owner, { storeId: HM11, period: '2026-11', text: ' ' })).toThrow(ValidationError);
  });
});

describe('report builder', () => {
  it('rows × columns: accounts, groups and net profit, with every row adding to its total', () => {
    const { s } = small();
    const r = runReport(s, { rows: ['acct:acct_repairs', 'group:expense', 'group:sales', 'group:net', 'acct:acct_trustmark'], columns: 'month', basis: 'accrual', from: '2026-09', to: '2026-10', storeIds: [] }, { visible: s.stores.map((x) => x.id) });
    expect(r.cols.map((c) => c.key)).toEqual(['2026-09', '2026-10']);
    const row = (k: string) => r.rows.find((x) => x.key === k)!;
    expect(row('acct:acct_repairs').by).toEqual({ '2026-09': 50_000, '2026-10': 0 });
    expect(row('group:expense').total).toBe(50_000 + 30_000 + 20_000);
    expect(row('group:sales').total).toBe(100_000);
    expect(row('group:net').total).toBe(0);
    expect(r.netTies).toBe(true);
    expect(r.rowsTie).toBe(true);
    // Balance-sheet rows show booked activity in natural sign.
    expect(row('acct:acct_trustmark').by['2026-09']).toBe(10_000_000 - 50_000 - 30_000 + 100_000);
    const byStore = runReport(s, { rows: ['group:net'], columns: 'store', basis: 'cash', from: '2026-09', to: '2026-10', storeIds: [HM11] }, { visible: s.stores.map((x) => x.id) });
    expect(byStore.cols.map((c) => c.label)).toEqual(['HM11']);
    expect(byStore.rows[0].total).toBe(-100_000 - 50_000);
    // A store the viewer can't see is never included.
    expect(runReport(s, { rows: ['group:net'], columns: 'store', basis: 'cash', from: '2026-09', to: '2026-10', storeIds: [HM11] }, { visible: ['st_hm13'] }).cols).toEqual([]);
  });

  it('saved reports persist with an optional cadence and are validated', () => {
    const { s, b, cfo } = small();
    const r = saveReport(b, cfo, { name: ' Monthly ', rows: ['group:net'], columns: 'month', basis: 'accrual', from: '2026-09', to: '2026-10', storeIds: [], schedule: { cadence: 'monthly' } });
    expect(reportsOf(s).saved).toEqual([r]);
    expect(r.name).toBe('Monthly');
    saveReport(b, cfo, { ...r, name: 'Renamed', schedule: undefined }, r.id);
    expect(reportsOf(s).saved[0]).toMatchObject({ name: 'Renamed', schedule: undefined });
    expect(() => saveReport(b, cfo, { name: '', rows: [], columns: 'month', basis: 'accrual', from: '2026-10', to: '2026-09', storeIds: [] })).toThrow(ValidationError);
    expect(() => saveReport(b, cfo, { name: 'x', rows: ['group:nope'], columns: 'month', basis: 'accrual', from: '2026-09', to: '2026-09', storeIds: [] })).toThrow(/isn't an account or group/);
    deleteReport(b, cfo, r.id);
    expect(reportsOf(s).saved).toEqual([]);
    expect(s.audit.filter((a) => a.objectType === 'report')).toHaveLength(3);
  });

  it('demo report builder agrees with the P&L across all saved reports', () => {
    const s = buildDemo();
    const vis = s.stores.map((x) => x.id);
    expect(reportsOf(s).saved.length).toBeGreaterThanOrEqual(2);
    for (const def of reportsOf(s).saved) {
      const r = runReport(s, def, { visible: vis });
      expect(r.rowsTie).toBe(true);
      if (r.netTies !== null) expect(r.netTies).toBe(true);
      expect(r.cols.length).toBe(def.columns === 'month' ? periodsBetween(def.from, def.to).length : vis.length);
    }
  });
});

describe('board pack letter', () => {
  it('is written from the numbers', () => {
    const s = buildDemo();
    const stores = s.stores.map((x) => x.id);
    const cc = commandCenter(s, { period: '2026-11', basis: 'accrual', storeIds: stores });
    const text = summaryLetter(s, { period: '2026-11', periodName: 'November 2026', cc, bs: balanceSheet(s, { asOf: '2026-11-30' }), cashFlow: cashFlow(s, { from: '2026-11-01', to: '2026-11-30' }), issues: 3 });
    expect(text).toContain('November 2026 summary');
    expect(text).toContain('3 open items');
    expect(text).toMatch(/Net profit on the accrual basis was \(?\$/);
  });
});

describe('xlsx export', () => {
  it('writes a valid zip with the workbook, the named sheet and the cells', () => {
    const bytes = xlsx([{ name: 'P&L Nov 2026', rows: [['Account', 'HM11', 'Total'], ['Fuel sales – Regular', '1234.50', 1234.5], ['Note <a & b>', '', null]] }]);
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const files = unzip(bytes);
    expect([...files.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
    const dec = (n: string) => new TextDecoder().decode(files.get(n));
    expect(dec('xl/workbook.xml')).toContain('<sheet name="P&amp;L Nov 2026" sheetId="1" r:id="rId1"/>');
    const sheet = dec('xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<c r="B2"><v>1234.5</v></c>');
    expect(sheet).toContain('<c r="C2"><v>1234.5</v></c>');
    expect(sheet).toContain('Fuel sales – Regular');
    expect(sheet).toContain('Note &lt;a &amp; b&gt;');
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1">');
    expect(dec('[Content_Types].xml')).toContain('/xl/worksheets/sheet1.xml');
  });

  it('helpers: CRC-32, column letters and safe, unique sheet names', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect([0, 25, 26, 51, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
    const used = new Set<string>();
    expect(sheetName('A/B: [x]?', used)).toBe('A B   x');
    expect(sheetName('a/b: [x]?', used)).toBe('a b   x (2)');
    expect(sheetName('x'.repeat(40), used)).toHaveLength(31);
  });
});
