import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID, FEED_END } from '../data/seed';
import { parseCsv, parseOfx, parseBankFile } from './bankio';
import {
  autoMatch, candidates, checksRegister, commitImport, createFromBankLine, matchBankLine, matchIndex, isMatched,
  previewImport, reconcileStatus, saveReconciliation, reconciledThrough, unmatchBankLine,
} from './bank';
import { recordCashStep, depositBags, recordPayout, bagVariances, bagOverdue, poolBalance, posExpectedCash } from './cash';
import { forecast, detectRecurring } from './forecast';
import { balanceAsOf, trialBalance, pnl } from './reports';
import { PermissionError } from './permissions';
import type { BooksState } from './types';

const setup = () => {
  const s = emptyState();
  s.bank.openings.acct_trustmark = { date: '2026-10-31', balance: 1_000_000 };
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  return { s, b, cfo: s.users.find((u) => u.id === CFO_ID)! };
};
const pay = (b: Books, cfo: BooksState['users'][0], date: string, amount: number, desc: string, checkNo?: string) =>
  b.createTransaction(cfo, { date, kind: 'money_out', description: desc, checkNo, lines: [
    { accountId: 'acct_utilities', storeId: 'st_hm11', debit: amount, credit: 0 },
    { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: amount },
  ] });

describe('bank file parsing', () => {
  it('reads CSV with debit/credit columns, quotes and US dates', () => {
    const f = parseCsv('Posted Date,Description,Debit,Credit,Check Number,Balance\n11/02/2026,"ENTERGY, MS",312.48,,,9687.52\n11/03/2026,DEPOSIT,,"1,200.00",,10887.52\n11/04/2026,CHECK 4130,500.00,,4130,10387.52\n');
    expect(f.problems).toEqual([]);
    expect(f.lines.map((l) => l.amount)).toEqual([-31248, 120000, -50000]);
    expect(f.lines[0].description).toBe('ENTERGY, MS');
    expect(f.lines[2].checkNo).toBe('4130');
    expect(f.statementBalance).toBe(1038752);
  });
  it('reads OFX/QFX transactions and the ledger balance', () => {
    const f = parseBankFile('stmt.qfx', '<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261124120000<TRNAMT>-25.00<FITID>A1<NAME>WIRE FEE</STMTTRN><STMTTRN><DTPOSTED>20261125<TRNAMT>1875.00<FITID>A2<NAME>DEPOSIT<MEMO>BRANCH 7734</STMTTRN><LEDGERBAL><BALAMT>12345.67<DTASOF>20261125</LEDGERBAL></OFX>');
    expect(f.format).toBe('ofx');
    expect(f.lines).toHaveLength(2);
    expect(f.lines[1]).toMatchObject({ date: '2026-11-25', amount: 187500, fitId: 'A2', description: 'DEPOSIT BRANCH 7734' });
    expect(f.statementBalance).toBe(1234567);
    expect(parseOfx('nothing').problems.length).toBeGreaterThan(0);
  });
  it('explains a file it cannot read', () => {
    expect(parseCsv('foo,bar\n1,2').problems[0]).toMatch(/Date column/);
  });
});

describe('import', () => {
  const csv = 'Date,Description,Amount,Balance\n2026-11-02,ENTERGY MS,-312.48,9687.52\n2026-11-02,ENTERGY MS,-312.48,9375.04\n2026-11-03,DEPOSIT,1200.00,10575.04\n';
  it('is idempotent: re-importing the same file adds nothing, but identical lines in one file both count', () => {
    const { s, b, cfo } = setup();
    const f = parseCsv(csv);
    expect(previewImport(s, 'acct_trustmark', f.lines)).toMatchObject({ added: 3, skipped: 0, totalIn: 120000, totalOut: 62496, runningBalanceTies: true });
    const r1 = commitImport(b, cfo, 'acct_trustmark', { name: 'a.csv', format: 'csv', lines: f.lines });
    expect(r1.batch.added).toBe(3);
    const r2 = commitImport(b, cfo, 'acct_trustmark', { name: 'a.csv', format: 'csv', lines: f.lines });
    expect(r2.batch).toMatchObject({ added: 0, skipped: 3 });
    expect(s.bank.lines).toHaveLength(3);
    expect(s.bank.lines.every((l) => l.batchId)).toBe(true);
    expect(s.bank.lines[2].source).toBe('store_cash');
  });
  it('flags a running balance that does not tie', () => {
    const { s } = setup();
    const p = previewImport(s, 'acct_trustmark', parseCsv(csv.replace('10575.04', '10575.00')).lines);
    expect(p.runningBalanceTies).toBe(false);
    expect(p.runningBalanceBreaks[0]).toMatch(/should be 10,575.04/);
  });
  it('only store managers with the right role can import', () => {
    const { s, b } = setup();
    const mgr = s.users.find((u) => u.role === 'store_manager')!;
    expect(() => commitImport(b, mgr, 'acct_trustmark', { name: 'x', format: 'csv', lines: [] })).toThrow(PermissionError);
  });
});

describe('matching', () => {
  it('auto-matches by check number and by amount + date, and leaves ties for a person', () => {
    const { s, b, cfo } = setup();
    const chk = pay(b, cfo, '2026-11-02', 50_000, 'Repair co', '4130');
    pay(b, cfo, '2026-11-05', 12_345, 'Entergy HM11');
    pay(b, cfo, '2026-11-06', 7_700, 'Supplies A');
    pay(b, cfo, '2026-11-06', 7_700, 'Supplies B');
    const f = parseCsv('Date,Description,Amount,Check\n2026-11-09,CHECK 4130,-500.00,4130\n2026-11-06,ACH ENTERGY,-123.45,\n2026-11-07,POS SUPPLY,-77.00,\n');
    const { matched } = commitImport(b, cfo, 'acct_trustmark', { name: 'f.csv', format: 'csv', lines: f.lines });
    expect(matched).toBe(2);
    const idx = matchIndex(s);
    expect(idx.get(chk.lines.find((l) => l.accountId === 'acct_trustmark')!.id)?.checkNo).toBe('4130');
    const amb = s.bank.lines.find((l) => l.amount === -7_700)!;
    expect(isMatched(amb, idx)).toBe(false);
    expect(candidates(s, amb)).toHaveLength(2);
  });
  it('manual match must add up exactly; one bank deposit can clear several entries', () => {
    const { s, b, cfo } = setup();
    const dep = (amt: number) => b.createTransaction(cfo, { date: '2026-11-10', kind: 'money_in', description: 'Rent', lines: [
      { accountId: 'acct_trustmark', storeId: 'st_corp', debit: amt, credit: 0 }, { accountId: 'acct_rent_income', storeId: 'st_hm11', debit: 0, credit: amt }] });
    const a = dep(280_000);
    const c = dep(65_000);
    commitImport(b, cfo, 'acct_trustmark', { name: 'g', format: 'csv', lines: parseCsv('Date,Description,Amount\n2026-11-10,DEPOSIT RENT,3450.00\n').lines });
    const bl = s.bank.lines[0];
    const ids = [a, c].map((t) => t.lines.find((l) => l.accountId === 'acct_trustmark')!.id);
    expect(() => matchBankLine(b, cfo, bl.id, [ids[0]])).toThrow(/add up/);
    matchBankLine(b, cfo, bl.id, ids);
    expect(isMatched(bl, matchIndex(s))).toBe(true);
    unmatchBankLine(b, cfo, bl.id);
    expect(isMatched(bl, matchIndex(s))).toBe(false);
  });
  it('books a bank-only line from the feed, matches it and learns a rule', () => {
    const { s, b, cfo } = setup();
    commitImport(b, cfo, 'acct_trustmark', { name: 'h', format: 'csv', lines: parseCsv('Date,Description,Amount\n2026-11-24,WIRE TRANSFER FEE 0091,-25.00\n').lines });
    const t = createFromBankLine(b, cfo, s.bank.lines[0].id, { accountId: 'acct_bank_fees', storeId: 'st_corp' });
    expect(t.kind).toBe('money_out');
    expect(isMatched(s.bank.lines[0], matchIndex(s))).toBe(true);
    expect(s.rules.some((r) => r.contains === 'WIRE FEE' && r.accountId === 'acct_bank_fees')).toBe(true);
  });
  it('transfers can never touch the P&L', () => {
    const { b, cfo } = setup();
    expect(() => b.createTransaction(cfo, { date: '2026-11-10', kind: 'transfer', description: 'x', lines: [
      { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 100, credit: 0 }, { accountId: 'acct_rent_income', storeId: 'st_corp', debit: 0, credit: 100 }] })).toThrow(/balance-sheet/);
  });
});

describe('reconciliation', () => {
  it('explains statement vs book line by line, and refuses to save with a difference', () => {
    const { s, b, cfo } = setup();
    pay(b, cfo, '2026-11-02', 50_000, 'Repair co', '4130'); // outstanding check
    pay(b, cfo, '2026-11-05', 12_345, 'Entergy HM11');
    b.createTransaction(cfo, { date: '2026-10-31', kind: 'opening', description: 'Opening', lines: [
      { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 1_000_000, credit: 0 }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: 0, credit: 1_000_000 }] });
    commitImport(b, cfo, 'acct_trustmark', { name: 'n', format: 'csv', lines: parseCsv('Date,Description,Amount\n2026-11-05,ACH ENTERGY,-123.45\n2026-11-20,SERVICE CHARGE,-45.00\n').lines });
    const st = reconcileStatus(s, 'acct_trustmark', '2026-11-30');
    expect(st.bookBalance).toBe(1_000_000 - 50_000 - 12_345);
    expect(st.bookOnly.map((x) => x.amount)).toEqual([-50_000]);
    expect(st.bankOnly.map((x) => x.amount)).toEqual([-4_500]);
    expect(st.feedBalance).toBe(1_000_000 - 12_345 - 4_500);
    expect(st.expectedStatement).toBe(st.feedBalance);
    expect(() => saveReconciliation(b, cfo, 'acct_trustmark', '2026-11-30', st.feedBalance! + 1)).toThrow(/off by \$0\.01/);
    saveReconciliation(b, cfo, 'acct_trustmark', '2026-11-30', st.feedBalance!);
    expect(reconciledThrough(s, 'acct_trustmark')).toBe('2026-11-30');
    expect(() => unmatchBankLine(b, cfo, s.bank.lines[0].id)).toThrow(ValidationError);
  });
});

describe('cash chain', () => {
  const day = (s: BooksState, b: Books, cfo: BooksState['users'][0]) => {
    b.createTransaction(cfo, { date: '2026-11-10', kind: 'journal', description: 'POS daily close HM11', tags: ['pos'], lines: [
      { accountId: 'acct_cash_registers', storeId: 'st_hm11', debit: 400_000, credit: 0 }, { accountId: 'acct_sales_grocery', storeId: 'st_hm11', debit: 0, credit: 400_000 }] });
    return s;
  };
  it('posts count variance, pickup, HQ receipt and a pooled deposit; every entity still balances', () => {
    const { s, b, cfo } = setup();
    day(s, b, cfo);
    expect(posExpectedCash(s, 'st_hm11', '2026-11-10')).toBe(400_000);
    recordCashStep(b, cfo, { storeId: 'st_hm11', businessDate: '2026-11-10', stage: 'count', amount: 398_000, person: 'Mgr' });
    expect(() => recordCashStep(b, cfo, { storeId: 'st_hm11', businessDate: '2026-11-10', stage: 'hq_receipt', amount: 1, person: 'HQ' })).toThrow(/pickup first/);
    recordCashStep(b, cfo, { storeId: 'st_hm11', businessDate: '2026-11-10', stage: 'pickup', amount: 398_000, person: 'Op', date: '2026-11-11' });
    recordCashStep(b, cfo, { storeId: 'st_hm11', businessDate: '2026-11-10', stage: 'hq_receipt', amount: 397_700, person: 'HQ', date: '2026-11-11' });
    const bag = s.cash.bags[0];
    const v = bagVariances(s, bag);
    expect(v.map((x) => [x.stage, x.diff, x.flagged])).toEqual([['count', -2_000, true], ['pickup', 0, false], ['hq_receipt', -300, false]]);
    expect(poolBalance(s, '2026-11-11')).toBe(397_700);
    expect(bagOverdue(s, bag, '2026-11-14')).toBe(true);
    recordPayout(b, cfo, { date: '2026-11-12', fromStoreId: 'st_corp', kind: 'payroll', payee: 'Crew', amount: 100_000, person: 'HQ', accountId: 'acct_wages', storeId: 'st_hm11' });
    expect(() => depositBags(b, cfo, { bagIds: [bag.id], date: '2026-11-12', amount: 397_700, person: 'HQ' })).toThrow(/more than the cash at HQ/);
    depositBags(b, cfo, { bagIds: [bag.id], date: '2026-11-12', amount: 297_700, person: 'HQ' });
    expect(poolBalance(s, '2026-11-12')).toBe(0);
    expect(balanceAsOf(s, 'acct_trustmark', '2026-11-12')).toBe(297_700);
    expect(bagOverdue(s, bag, '2026-11-20')).toBe(false);
    const p = pnl(s, { from: '2026-11', to: '2026-11', storeIds: ['st_hm11', 'st_corp'] });
    expect(p.rows.find((r) => r.account.id === 'acct_over_short')?.total).toBe(2_300);
    for (const e of s.entities) expect(trialBalance(s, { asOf: '2026-11-30', entityId: e.id }).difference).toBe(0);
  });
  it('store managers count only their own store and cannot pick up', () => {
    const { s, b } = setup();
    const mgr = s.users.find((u) => u.role === 'store_manager')!;
    expect(() => recordCashStep(b, mgr, { storeId: 'st_hm13', businessDate: '2026-11-10', stage: 'count', amount: 1, person: 'x' })).toThrow(PermissionError);
    recordCashStep(b, mgr, { storeId: 'st_hm11', businessDate: '2026-11-10', stage: 'count', amount: 1, person: 'x' });
    expect(() => recordCashStep(b, mgr, { storeId: 'st_hm11', businessDate: '2026-11-10', stage: 'pickup', amount: 1, person: 'x' })).toThrow(PermissionError);
  });
});

describe('forecast', () => {
  it('detects weekly and monthly items and projects the balance week by week', () => {
    const { s, b, cfo } = setup();
    b.createTransaction(cfo, { date: '2026-08-31', kind: 'opening', description: 'Opening', lines: [
      { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 5_000_000, credit: 0 }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: 0, credit: 5_000_000 }] });
    for (const d of ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13', '2026-11-20']) pay(b, cfo, d, 100_000, 'GUSTO PAYROLL HM13');
    for (const d of ['2026-09-15', '2026-10-15', '2026-11-15']) pay(b, cfo, d, 500_000, 'ACH DEBIT ENTERGY MS');
    const pats = detectRecurring(s, 'acct_trustmark', '2026-11-26');
    expect(pats.find((p) => p.label.includes('GUSTO'))).toMatchObject({ cadence: 'weekly', amount: -100_000, anchor: 5 });
    expect(pats.find((p) => p.label.includes('ENTERGY'))).toMatchObject({ cadence: 'monthly', amount: -500_000, anchor: 15 });
    const f = forecast(s, 'acct_trustmark', '2026-11-26');
    expect(f.weeks).toHaveLength(13);
    expect(f.opening).toBe(5_000_000 - 800_000 - 1_500_000);
    const out = f.weeks.reduce((a, w) => a + w.outflows, 0);
    expect(out).toBe(13 * 100_000 + 3 * 500_000);
    expect(f.weeks.at(-1)!.ending).toBe(f.opening - out);
    expect(f.at(7)).toBe(f.opening - 100_000);
    const off = forecast(s, 'acct_trustmark', '2026-11-26', { disabled: new Set(pats.map((p) => p.key)) });
    expect(off.weeks.at(-1)!.ending).toBe(f.opening);
  });
});

describe('Phase 2 demo data', () => {
  const s = buildDemo();
  it('reconciles September and October to the cent, and November is fully explained', () => {
    expect(s.bank.reconciliations.map((r) => r.statementDate)).toEqual(['2026-09-30', '2026-10-31']);
    const st = reconcileStatus(s, 'acct_trustmark', FEED_END);
    expect(st.expectedStatement).toBe(st.feedBalance);
    expect(st.bankOnly.length).toBeGreaterThanOrEqual(3);
    expect(st.bookOnly.some((x) => x.description.includes('CHEERS'))).toBe(true);
  });
  it('has a stale check, outstanding checks, unmatched lines, flagged bags and an overdue bag', () => {
    const checks = checksRegister(s, '2026-11-26');
    expect(checks.find((c) => c.checkNo === '4107')?.status).toBe('stale');
    expect(checks.some((c) => c.status === 'cleared')).toBe(true);
    const idx = matchIndex(s);
    expect(s.bank.lines.filter((l) => !isMatched(l, idx)).length).toBeGreaterThan(10);
    expect(s.cash.bags.some((b) => bagVariances(s, b).some((v) => v.flagged))).toBe(true);
    expect(s.cash.bags.some((b) => bagOverdue(s, b, '2026-11-26'))).toBe(true);
  });
  it('auto-match clears most of the unmatched November lines', () => {
    const b = new Books(structuredClone(s));
    const before = b.state.bank.lines.filter((l) => !isMatched(l, matchIndex(b.state))).length;
    const n = autoMatch(b, b.state.users[0]);
    expect(n).toBeGreaterThan(before / 2);
  });
  it('every entity still balances with the cash chain posted', () => {
    for (const e of s.entities) expect(trialBalance(s, { asOf: '2026-11-30', entityId: e.id }).difference).toBe(0);
  });
});
