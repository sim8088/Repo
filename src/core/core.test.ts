import { describe, expect, it } from 'vitest';
import { allocate, formatMoney, parseMoney } from './money';
import { Books, ValidationError } from './books';
import { emptyState, buildDemo, CFO_ID } from '../data/seed';
import { trialBalance, pnl, accountDetail, flatLines, balanceAsOf, latestSalesPeriod, uncategorized } from './reports';
import { SYS, type TxnDraft } from './ledger';
import { findDuplicates } from './duplicates';
import { ruleKey, suggest } from './rules';
import { PermissionError, can } from './permissions';
import type { BooksState, User } from './types';

const fresh = () => {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  return { s, b, cfo: s.users.find((u) => u.id === CFO_ID)! };
};
const user = (s: BooksState, role: User['role']) => s.users.find((u) => u.role === role)!;
const bill = (over: Partial<TxnDraft> = {}): TxnDraft => ({
  date: '2026-11-10', kind: 'money_out', description: 'ACH DEBIT ENTERGY MS', lines: [
    { accountId: 'acct_utilities', storeId: 'st_hm11', debit: 50_000, credit: 0 },
    { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 50_000 },
  ], ...over,
});

describe('money', () => {
  it('parses and formats in accounting style', () => {
    expect(parseMoney('$4,077.40')).toBe(407740);
    expect(parseMoney('(12.5)')).toBe(-1250);
    expect(parseMoney('-0.07')).toBe(-7);
    expect(parseMoney('abc')).toBeNull();
    expect(formatMoney(-123456)).toBe('(1,234.56)');
    expect(formatMoney(5, { dollarSign: true })).toBe('$0.05');
  });
  it('allocates so the parts always add back to the total', () => {
    expect(allocate(10_000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
    expect(allocate(-101, [50, 50])).toEqual([-51, -50]);
    for (const t of [1, 99, 123457, 999_999]) expect(allocate(t, [33.3, 33.3, 33.4, 7]).reduce((a, b) => a + b)).toBe(t);
    expect(() => allocate(100, [0, 0])).toThrow();
  });
});

describe('ledger posting', () => {
  it('rejects an unbalanced entry and explains the fix', () => {
    const { b, cfo } = fresh();
    const d = bill();
    d.lines[1].credit = 49_000;
    expect(() => b.createTransaction(cfo, d)).toThrow(/off by \$10\.00/);
  });
  it('rejects a line with both debit and credit', () => {
    const { b, cfo } = fresh();
    const d = bill();
    d.lines[0].credit = 1;
    d.lines[1].credit = 50_001;
    expect(() => b.createTransaction(cfo, d)).toThrow(ValidationError);
  });
  it('adds intercompany lines so every entity balances when Corporate pays a store bill', () => {
    const { s, b, cfo } = fresh();
    const t = b.createTransaction(cfo, bill());
    const sys = t.lines.filter((l) => l.system);
    expect(sys).toHaveLength(2);
    for (const e of s.entities) {
      const tb = trialBalance(s, { asOf: '2026-11-30', entityId: e.id });
      expect(tb.difference).toBe(0);
    }
    const hm11 = trialBalance(s, { asOf: '2026-11-30', entityId: 'ent_hm11' });
    expect(hm11.rows.find((r) => r.account.id === SYS.dueTo)?.credit).toBe(50_000);
  });
  it('locks a period, refuses edits, and requires a reason to unlock', () => {
    const { s, b, cfo } = fresh();
    const t = b.createTransaction(cfo, bill());
    b.lockPeriod(cfo, '2026-11');
    expect(() => b.createTransaction(cfo, bill())).toThrow(/locked/);
    expect(() => b.updateTransaction(cfo, t.id, bill({ description: 'x' }))).toThrow(/locked/);
    expect(() => b.deleteTransaction(cfo, t.id, 'oops')).toThrow(/locked/);
    expect(() => b.unlockPeriod(cfo, '2026-11', ' ')).toThrow(/reason/);
    b.unlockPeriod(cfo, '2026-11', 'Late Entergy bill');
    expect(s.periods['2026-11'].status).toBe('open');
    expect(s.audit.at(-1)?.reason).toBe('Late Entergy bill');
  });
  it('bookkeepers cannot lock; store managers only enter for their store; reviewers change nothing', () => {
    const { s, b } = fresh();
    expect(() => b.lockPeriod(user(s, 'bookkeeper'), '2026-11')).toThrow(PermissionError);
    const mgr = user(s, 'store_manager');
    expect(() => b.createTransaction(mgr, bill({ lines: [
      { accountId: 'acct_utilities', storeId: 'st_hm13', debit: 100, credit: 0 },
      { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 100 },
    ] }))).toThrow(PermissionError);
    expect(b.createTransaction(mgr, bill()).id).toBeTruthy();
    expect(() => b.createTransaction(user(s, 'reviewer'), bill())).toThrow(PermissionError);
    expect(can(user(s, 'owner'), 'approve')).toBe(true);
  });
  it('soft-deletes with a reason, keeps the row, and logs before/after on edit', () => {
    const { s, b, cfo } = fresh();
    const t = b.createTransaction(cfo, bill());
    b.updateTransaction(cfo, t.id, bill({ description: 'Entergy HM11 Nov' }), 'Clearer name');
    const upd = s.audit.at(-1)!;
    expect((upd.before as { description: string }).description).toBe('ACH DEBIT ENTERGY MS');
    expect((upd.after as { description: string }).description).toBe('Entergy HM11 Nov');
    expect(() => b.deleteTransaction(cfo, t.id, '')).toThrow(/why/);
    b.deleteTransaction(cfo, t.id, 'Duplicate of bank import');
    expect(s.transactions).toHaveLength(1);
    expect(flatLines(s)).toHaveLength(0);
    b.restoreTransaction(cfo, t.id);
    expect(flatLines(s).length).toBeGreaterThan(0);
  });
});

describe('rules and duplicates', () => {
  it('builds stable keys and learns from corrections', () => {
    expect(ruleKey('POS PURCHASE HOME DEPOT 4471 BRANDON MS')).toBe('HOME DEPOT');
    const { s, b, cfo } = fresh();
    const t = b.createTransaction(cfo, bill({ description: 'ACH DEBIT ATMOS ENERGY 7781', lines: [
      { accountId: SYS.uncatExpense, storeId: 'st_corp', debit: 21840, credit: 0 },
      { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 21840 },
    ] }));
    b.categorizeLine(cfo, t.id, t.lines[0].id, 'acct_utilities', 'st_hm13');
    const m = suggest(s, 'ACH DEBIT ATMOS ENERGY 9999');
    expect(m?.rule.accountId).toBe('acct_utilities');
    expect(m?.rule.storeId).toBe('st_hm13');
    expect(uncategorized(s)).toHaveLength(0);
  });
  it('flags same amount + party within 3 days, not 4', () => {
    const { s, b, cfo } = fresh();
    b.createTransaction(cfo, bill({ partyId: 'pt_entergy' }));
    b.createTransaction(cfo, bill({ partyId: 'pt_entergy', date: '2026-11-13' }));
    b.createTransaction(cfo, bill({ partyId: 'pt_entergy', date: '2026-11-20' }));
    const d = findDuplicates(s.transactions);
    expect(d).toHaveLength(1);
    expect(d[0].days).toBe(3);
  });
});

describe('demo dataset and reports', () => {
  const s = buildDemo();
  const lines = flatLines(s);
  const operating = s.stores.filter((x) => x.kind !== 'leased_out' || true).map((x) => x.id);

  it('every entity trial balance ties (debits = credits)', () => {
    expect(trialBalance(s, { asOf: '2026-11-30', lines }).difference).toBe(0);
    for (const e of s.entities) expect(trialBalance(s, { asOf: '2026-11-30', entityId: e.id, lines }).difference).toBe(0);
  });
  it('P&L store columns add to the total and tie to the ledger', () => {
    for (const p of ['2026-09', '2026-10', '2026-11']) {
      const r = pnl(s, { from: p, to: p, storeIds: operating, lines });
      expect(r.difference).toBe(0);
      expect(operating.reduce((a, id) => a + r.netIncome[id], 0)).toBe(r.netIncome.total);
      expect(r.netSales.total).toBeGreaterThan(0);
    }
  });
  it('P&L year-to-date ties to the trial balance net income', () => {
    const r = pnl(s, { from: '2026-01', to: '2026-11', storeIds: s.stores.map((x) => x.id), lines });
    expect(r.netIncome.total).toBe(trialBalance(s, { asOf: '2026-11-30', lines }).netIncome);
  });
  it('account detail rolls opening + activity to closing, matching the balance', () => {
    const gl = accountDetail(s, 'acct_trustmark', { from: '2026-10-01', to: '2026-10-31', lines });
    const sum = gl.rows.reduce((a, r) => a + r.change, 0);
    expect(gl.opening + sum).toBe(gl.closing);
    expect(gl.closing).toBe(balanceAsOf(s, 'acct_trustmark', '2026-10-31', lines));
  });
  it('the bank never goes below the $30k floor in the demo', () => {
    for (let d = '2026-09-01'; d <= '2026-11-26'; d = new Date(Date.parse(d + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10)) {
      expect(balanceAsOf(s, 'acct_trustmark', d, lines)).toBeGreaterThan(3_000_000);
    }
  });
  it('has the inbox items the demo promises', () => {
    expect(latestSalesPeriod(s, lines)).toBe('2026-11');
    expect(uncategorized(s, lines)).toHaveLength(6);
    expect(findDuplicates(s.transactions).length).toBeGreaterThanOrEqual(1);
    expect(s.periods['2026-09'].status).toBe('locked');
  });
});
