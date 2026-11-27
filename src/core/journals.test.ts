import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import {
  JE_TEMPLATES, approveJournal, createJournal, fromTemplate, generateRecurring, glOf, isAdjusting, jeTotal, nextRecurringDate, pendingJournals, postReversals,
  recurringDue, rejectJournal, reversalsDue, saveRecurring, schedulePeriods, tbColumns, type JeDraft,
} from './journals';
import { approvalQueue } from './approvals';
import { PermissionError } from './permissions';
import { balanceAsOf, trialBalance } from './reports';
import type { User } from './types';

const setup = () => {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  const u = (role: User['role']) => s.users.find((x) => x.role === role)!;
  b.createTransaction(s.users[0], { date: '2026-09-01', kind: 'opening', description: 'Opening', lines: [
    { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 10_000_000, credit: 0 }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: 0, credit: 10_000_000 }] });
  return { s, b, cfo: s.users.find((x) => x.id === CFO_ID)!, bk: u('bookkeeper'), owner: u('owner'), reviewer: u('reviewer'), mgr: u('store_manager') };
};
const je = (amount: number, over: Partial<JeDraft> = {}): JeDraft => ({
  date: '2026-10-31', description: 'Accrued utilities HM11', memo: 'October power estimate',
  lines: [{ accountId: 'acct_utilities', storeId: 'st_hm11', debit: amount, credit: 0 }, { accountId: 'acct_accrued_exp', storeId: 'st_hm11', debit: 0, credit: amount }], ...over,
});

describe('manual journal entries', () => {
  it('validates: memo required, balanced, accounts and stores, reverse date after the entry date', () => {
    const { b, bk } = setup();
    expect(() => createJournal(b, bk, je(10_000, { memo: ' ' }))).toThrow(/memo/);
    expect(() => createJournal(b, bk, je(10_000, { lines: [je(10_000).lines[0], { ...je(10_000).lines[1], credit: 9_000 }] }))).toThrow(/off by \$10\.00/);
    expect(() => createJournal(b, bk, je(10_000, { reverseOn: '2026-10-31' }))).toThrow(/after the entry date/);
    expect(() => createJournal(b, bk, je(10_000, { lines: [je(10_000).lines[0]] }))).toThrow(ValidationError);
  });
  it('multi-line with entity per line: the ledger adds due-to / due-from so each entity balances', () => {
    const { s, b, bk } = setup();
    const j = createJournal(b, bk, je(30_000, { lines: [
      { accountId: 'acct_utilities', storeId: 'st_hm11', debit: 10_000, credit: 0 }, { accountId: 'acct_utilities', storeId: 'st_hm13', debit: 20_000, credit: 0 },
      { accountId: 'acct_accrued_exp', storeId: 'st_corp', debit: 0, credit: 30_000 }] }));
    const t = s.transactions.find((x) => x.id === j.txnId)!;
    expect(t.lines.filter((l) => l.system).length).toBe(4);
    for (const e of ['ent_hm11', 'ent_hm13', 'ent_corp']) expect(trialBalance(s, { asOf: '2026-10-31', entityId: e }).difference).toBe(0);
    expect(t.docNo).toBe(j.ref);
  });
  it('at or under the limit posts at once; over the limit stays pending and posts nothing', () => {
    const { s, b, bk } = setup();
    const limit = s.settings.jeApprovalLimitCents;
    const n = s.transactions.length;
    const a = createJournal(b, bk, je(limit));
    expect(a).toMatchObject({ status: 'posted', needsApproval: false });
    expect(s.transactions.length).toBe(n + 1);
    const p = createJournal(b, bk, je(limit + 1));
    expect(p).toMatchObject({ status: 'pending', needsApproval: true });
    expect(p.txnId).toBeUndefined();
    expect(s.transactions.length).toBe(n + 1);
    expect(balanceAsOf(s, 'acct_accrued_exp', '2026-12-31')).toBe(limit);
    expect(pendingJournals(s).map((x) => x.id)).toEqual([p.id]);
    expect(approvalQueue(s).filter((i) => i.kind === 'journal').map((i) => i.id)).toEqual([p.id]);
  });
  it('preparer ≠ approver; approval needs the approve permission; an owner approves and it posts under the preparer', () => {
    const { s, b, bk, cfo, owner, reviewer } = setup();
    const p = createJournal(b, cfo, je(2_000_000));
    expect(() => approveJournal(b, cfo, p.id)).toThrow(/someone else/);
    expect(() => approveJournal(b, bk, p.id)).toThrow(PermissionError);
    expect(() => approveJournal(b, reviewer, p.id)).toThrow(PermissionError);
    approveJournal(b, owner, p.id, 'Checked the estimate');
    expect(p).toMatchObject({ status: 'posted', approved: { by: owner.id, note: 'Checked the estimate' } });
    const t = s.transactions.find((x) => x.id === p.txnId)!;
    expect(t.createdBy).toBe(cfo.id);
    expect(() => approveJournal(b, owner, p.id)).toThrow(/already posted/);
    const q = createJournal(b, bk, je(2_000_000));
    approveJournal(b, cfo, q.id);
    expect(s.transactions.find((x) => x.id === q.txnId)!.createdBy).toBe(cfo.id);
  });
  it('rejecting needs a reason and posts nothing; store managers and accountants cannot prepare', () => {
    const { s, b, bk, owner, mgr, reviewer } = setup();
    const p = createJournal(b, bk, je(2_000_000));
    expect(() => rejectJournal(b, owner, p.id, '')).toThrow(/why/);
    expect(() => rejectJournal(b, bk, p.id, 'no')).toThrow(PermissionError);
    rejectJournal(b, owner, p.id, 'Use the actual bill');
    expect(p.status).toBe('rejected');
    expect(p.txnId).toBeUndefined();
    expect(() => approveJournal(b, owner, p.id)).toThrow(/already rejected/);
    expect(() => createJournal(b, mgr, je(100))).toThrow(PermissionError);
    expect(() => createJournal(b, reviewer, je(100))).toThrow(PermissionError);
    expect(s.audit.some((a) => a.objectType === 'journal' && a.action === 'reject')).toBe(true);
  });
  it('locked months refuse the entry and its reversal date', () => {
    const { s, b, bk, cfo } = setup();
    b.lockPeriod(cfo, '2026-09');
    expect(() => createJournal(b, bk, je(100, { date: '2026-09-30' }))).toThrow(/locked/);
    b.lockPeriod(cfo, '2026-11');
    expect(() => createJournal(b, bk, je(100, { reverseOn: '2026-11-01' }))).toThrow(/reversal couldn't post/);
    expect(s.transactions.length).toBe(1);
  });
});

describe('reversing entries', () => {
  it('post on their date, swapped, once: running again does nothing', () => {
    const { s, b, bk } = setup();
    const j = createJournal(b, bk, je(12_345, { reverseOn: '2026-11-01' }));
    expect(reversalsDue(s, '2026-10-31')).toEqual([]);
    expect(reversalsDue(s, '2026-11-01').map((x) => x.id)).toEqual([j.id]);
    const r1 = postReversals(b, bk, '2026-11-30');
    expect(r1.posted.length).toBe(1);
    const t = s.transactions.find((x) => x.id === j.reversal!.txnId)!;
    expect(t.date).toBe('2026-11-01');
    expect(t.tags).toContain('reversal');
    expect(balanceAsOf(s, 'acct_accrued_exp', '2026-10-31')).toBe(12_345);
    expect(balanceAsOf(s, 'acct_accrued_exp', '2026-11-01') || 0).toBe(0);
    const n = s.transactions.length;
    expect(postReversals(b, bk, '2026-11-30').posted).toEqual([]);
    expect(s.transactions.length).toBe(n);
  });
  it('a pending entry is not reversed until approved; a locked reverse month is reported, not posted', () => {
    const { s, b, bk, owner, cfo } = setup();
    const p = createJournal(b, bk, je(2_000_000, { reverseOn: '2026-11-01' }));
    expect(postReversals(b, bk, '2026-11-30').posted).toEqual([]);
    approveJournal(b, owner, p.id);
    b.lockPeriod(cfo, '2026-11');
    const r = postReversals(b, bk, '2026-11-30');
    expect(r.posted).toEqual([]);
    expect(r.skipped[0]).toMatch(/locked/);
    b.unlockPeriod(cfo, '2026-11', 'post the reversal');
    expect(postReversals(b, bk, '2026-11-30').posted.length).toBe(1);
    expect(s.transactions.filter((t) => t.tags.includes('reversal')).length).toBe(1);
  });
});

describe('recurring entries', () => {
  const sched = (over = {}) => ({
    name: 'Interest accrual', description: 'Accrued interest', memo: 'Per loan statement', frequency: 'monthly' as const, day: 31, start: '2026-09', end: '2027-02',
    lines: [{ accountId: 'acct_interest', storeId: 'st_corp', debit: 85_000, credit: 0 }, { accountId: 'acct_accrued_exp', storeId: 'st_corp', debit: 0, credit: 85_000 }], ...over,
  });
  it('monthly and quarterly periods, days clamped to the month end', () => {
    expect(schedulePeriods({ start: '2026-09', end: '2027-02', frequency: 'monthly' }, '2026-11-15')).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(schedulePeriods({ start: '2026-09', frequency: 'quarterly' }, '2027-06-30')).toEqual(['2026-09', '2026-12', '2027-03', '2027-06']);
    const { s, b, cfo } = setup();
    const r = saveRecurring(b, cfo, sched());
    expect(recurringDue(s, '2026-11-29').map((d) => d.date)).toEqual(['2026-09-30', '2026-10-31']);
    expect(nextRecurringDate(r, '2026-11-15')).toBe('2026-11-30');
  });
  it('generates each period once: idempotent, and over-limit runs are created pending', () => {
    const { s, b, cfo } = setup();
    const r = saveRecurring(b, cfo, sched());
    const g1 = generateRecurring(b, cfo, '2026-11-30');
    expect(g1.created.map((j) => j.date)).toEqual(['2026-09-30', '2026-10-31', '2026-11-30']);
    expect(Object.keys(r.generated)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(generateRecurring(b, cfo, '2026-11-30').created).toEqual([]);
    expect(glOf(s).entries.length).toBe(3);
    expect(balanceAsOf(s, 'acct_accrued_exp', '2026-11-30')).toBe(255_000);
    const big = saveRecurring(b, cfo, sched({ name: 'Big', lines: [{ accountId: 'acct_interest', storeId: 'st_corp', debit: 2_000_000, credit: 0 }, { accountId: 'acct_accrued_exp', storeId: 'st_corp', debit: 0, credit: 2_000_000 }] }));
    const g2 = generateRecurring(b, cfo, '2026-09-30', [big.id]);
    expect(g2.created[0].status).toBe('pending');
  });
  it('validates the schedule', () => {
    const { b, cfo } = setup();
    expect(() => saveRecurring(b, cfo, sched({ name: '', start: '2026-9', day: 0 }))).toThrow(ValidationError);
    expect(() => saveRecurring(b, cfo, sched({ memo: '' }))).toThrow(/memo/);
  });
});

describe('templates', () => {
  it('every template fills a balanced, valid entry from amounts, stores and a date', () => {
    const { s, b, cfo } = setup();
    for (const t of JE_TEMPLATES) {
      const d = fromTemplate(s, t.key, { date: '2026-10-31', stores: t.stores.map(() => 'st_hm11'), amounts: t.amounts.map((_, i) => 10_000 + i * 2_500), partyId: t.partyType === 'owner' ? 'pt_owner_a' : undefined });
      expect(d.lines.reduce((a, l) => a + l.debit - l.credit, 0), t.key).toBe(0);
      expect(jeTotal(d.lines), t.key).toBeGreaterThan(0);
      expect(d.adjusting).toBe(t.adjusting);
      if (t.autoReverse) expect(d.reverseOn).toBe('2026-11-01');
      const j = createJournal(b, cfo, d);
      expect(j.status).toBe('posted');
      expect(isAdjusting(s.transactions.find((x) => x.id === j.txnId)!)).toBe(t.adjusting);
    }
  });
  it('signed templates swap sides for a negative amount; others refuse it; the intercompany fee lands at Corporate', () => {
    const { s } = setup();
    const gain = fromTemplate(s, 'inv_fuel', { date: '2026-10-31', stores: ['st_hm13'], amounts: [-5_000] });
    expect(gain.lines.find((l) => l.accountId === 'acct_inv_fuel')!.debit).toBe(5_000);
    expect(() => fromTemplate(s, 'accr_utilities', { date: '2026-10-31', stores: ['st_hm13'], amounts: [-5_000] })).toThrow(/positive/);
    const fee = fromTemplate(s, 'ic_mgmt_fee', { date: '2026-10-15', stores: ['st_hm13'], amounts: [150_000] });
    expect(fee.lines.map((l) => l.storeId)).toEqual(['st_hm13', 'st_corp']);
  });
});

describe('trial balance columns', () => {
  it('unadjusted + adjusting = adjusted on every row; each column balances; prior is the previous month end', () => {
    const { s, b, cfo } = setup();
    b.createTransaction(cfo, { date: '2026-10-05', kind: 'money_out', description: 'Power', lines: [{ accountId: 'acct_utilities', storeId: 'st_hm11', debit: 40_000, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 40_000 }] });
    createJournal(b, cfo, je(12_000));
    createJournal(b, cfo, { ...je(3_000), date: '2026-09-30', adjusting: true });
    createJournal(b, cfo, { ...je(500), adjusting: false, description: 'Not adjusting' });
    const c = tbColumns(s, { asOf: '2026-10-31' });
    expect(c.rowsTie).toBe(true);
    expect(c.balanced).toBe(true);
    expect(c.priorAsOf).toBe('2026-09-30');
    const ut = c.rows.find((r) => r.account.id === 'acct_utilities')!;
    expect(ut).toMatchObject({ adjusting: 0, adjusted: 55_500, unadjusted: 55_500, prior: 3_000 });
    createJournal(b, cfo, { ...je(7_000), adjusting: true });
    const c2 = tbColumns(s, { asOf: '2026-10-31' });
    expect(c2.rows.find((r) => r.account.id === 'acct_utilities')).toMatchObject({ adjusting: 7_000, adjusted: 62_500, unadjusted: 55_500 });
    expect(c2.adjustingCount).toBe(1);
    expect(c2.totals.adjusting.debit).toBe(7_000);
    const hm11 = tbColumns(s, { asOf: '2026-10-31', entityId: 'ent_hm11' });
    expect(hm11.balanced && hm11.rowsTie).toBe(true);
  });
});

describe('demo journals', () => {
  const s = buildDemo();
  const gl = glOf(s);
  it('loads: templates used, one recurring accrual with November due, reversals posted, one entry pending', () => {
    expect(gl.entries.filter((j) => j.templateKey).length).toBeGreaterThanOrEqual(5);
    expect(gl.recurring.length).toBe(1);
    expect(Object.keys(gl.recurring[0].generated)).toEqual(['2026-09', '2026-10']);
    expect(recurringDue(s, '2026-11-27').map((d) => d.period)).toEqual(['2026-11']);
    expect(gl.entries.filter((j) => j.reversal).map((j) => j.reversal!.date)).toEqual(['2026-11-01', '2026-11-01', '2026-11-01']);
    expect(reversalsDue(s, '2026-11-27')).toEqual([]);
    expect(pendingJournals(s).length).toBe(1);
    expect(pendingJournals(s)[0].needsApproval).toBe(true);
    const approved = gl.entries.find((j) => j.approved)!;
    expect(approved.approved!.by).not.toBe(approved.preparedBy);
  });
  it('the October trial balance columns tie for every entity and in total', () => {
    for (const e of [undefined, ...s.entities.map((x) => x.id)]) {
      const c = tbColumns(s, { asOf: '2026-10-31', entityId: e });
      expect(c.rowsTie && c.balanced, e ?? 'all').toBe(true);
    }
    const c = tbColumns(s, { asOf: '2026-10-31' });
    expect(c.adjustingCount).toBeGreaterThanOrEqual(4);
  });
});
