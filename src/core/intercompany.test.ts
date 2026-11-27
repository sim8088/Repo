import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import { rentTemplates } from '../data/seed-intercompany';
import {
  drawsYtd, eliminations, entityLedger, fifoAging, generateRent, icSummary, nextRentRun, overLimit, ownerDraws, partyAccountTotals, partyLedger,
  recordPartyMovement, rentDue, saveRentTemplate, setPartyLimit,
} from './intercompany';
import { recordPayout } from './cash';
import { trialBalance, pnl } from './reports';
import { PermissionError } from './permissions';
import type { BooksState, User } from './types';

const setup = () => {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  const u = (role: User['role']) => s.users.find((x) => x.role === role)!;
  return { s, b, cfo: s.users.find((x) => x.id === CFO_ID)!, u };
};
const fund = (b: Books, cfo: User) => b.createTransaction(cfo, { date: '2026-09-01', kind: 'opening', description: 'Opening', lines: [
  { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 10_000_000, credit: 0 }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: 0, credit: 10_000_000 }] });

describe('party ledgers', () => {
  it('runs money out, money in and the balance, and ages it oldest-paid-first', () => {
    const { s, b, cfo } = setup();
    fund(b, cfo);
    recordPartyMovement(b, cfo, { partyId: 'pt_cheers', kind: 'paid_bill', date: '2026-09-10', amount: 100_000, payee: 'Beer distributor' });
    recordPartyMovement(b, cfo, { partyId: 'pt_cheers', kind: 'loan_out', date: '2026-10-20', amount: 50_000 });
    recordPartyMovement(b, cfo, { partyId: 'pt_cheers', kind: 'repayment', date: '2026-11-01', amount: 30_000 });
    const l = partyLedger(s, 'pt_cheers', { to: '2026-11-27' });
    expect([l.totalOut, l.totalIn, l.balance]).toEqual([150_000, 30_000, 120_000]);
    expect(l.movements.map((m) => m.balance)).toEqual([100_000, 150_000, 120_000]);
    // The repayment settles the oldest item (the September bill) first; October's loan is still fully open.
    expect(l.aging).toEqual([0, 50_000, 70_000, 0, 0]);
    // A repayment with bills-paid-for-them open settles 1920 first.
    const t = s.transactions.at(-1)!;
    expect(t.lines.find((x) => x.credit > 0)?.accountId).toBe('acct_paid_for_related');
    // Statement with a from date carries an opening balance.
    const st = partyLedger(s, 'pt_cheers', { from: '2026-10-01', to: '2026-11-27' });
    expect(st.opening).toBe(100_000);
    expect(st.opening + st.totalOut - st.totalIn).toBe(st.balance);
  });

  it('paying another business\'s bill hits their receivable, not store expenses or the P&L', () => {
    const { s, b, cfo } = setup();
    fund(b, cfo);
    const t = recordPartyMovement(b, cfo, { partyId: 'pt_rowdys', kind: 'paid_bill', date: '2026-11-02', amount: 186_000, payee: 'Propane supplier', checkNo: '5001' });
    expect(t.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([['acct_paid_for_related', 186_000, 0], ['acct_trustmark', 0, 186_000]]);
    expect(t.lines[0].partyId).toBe('pt_rowdys');
    expect(pnl(s, { from: '2026-11', to: '2026-11', storeIds: s.stores.map((x) => x.id) }).rows).toHaveLength(0);
  });

  it('a bill they paid for us is our expense and a payable to them', () => {
    const { s, b, cfo } = setup();
    recordPartyMovement(b, cfo, { partyId: 'pt_five_rivers', kind: 'they_paid_for_us', date: '2026-11-04', amount: 120_000, payee: 'Supplies', expenseAccountId: 'acct_supplies', storeId: 'st_hm17' });
    expect(partyLedger(s, 'pt_five_rivers', { to: '2026-11-30' }).balance).toBe(-120_000);
    for (const e of s.entities) expect(trialBalance(s, { asOf: '2026-11-30', entityId: e.id }).difference).toBe(0);
  });

  it('validates, and needs a role that sees Corporate', () => {
    const { b, cfo, u } = setup();
    expect(() => recordPartyMovement(b, cfo, { partyId: 'pt_sysco', kind: 'loan_out', date: '2026-11-01', amount: 1 })).toThrow(/vendor/);
    expect(() => recordPartyMovement(b, cfo, { partyId: 'pt_cheers', kind: 'paid_bill', date: '2026-11-01', amount: 0 })).toThrow(ValidationError);
    try { recordPartyMovement(b, cfo, { partyId: 'pt_cheers', kind: 'paid_bill', date: '2026-11-01', amount: 100 }); } catch (e) { expect((e as ValidationError).errors).toContain('Say whose bill it was (the vendor paid).'); }
    expect(() => recordPartyMovement(b, u('store_manager'), { partyId: 'pt_cheers', kind: 'loan_out', date: '2026-11-01', amount: 100 })).toThrow(PermissionError);
    expect(() => recordPartyMovement(b, u('reviewer'), { partyId: 'pt_cheers', kind: 'loan_out', date: '2026-11-01', amount: 100 })).toThrow(PermissionError);
  });

  it('limits: alert above the limit; only setup roles set them', () => {
    const { s, b, cfo, u } = setup();
    fund(b, cfo);
    recordPartyMovement(b, cfo, { partyId: 'pt_bullseye', kind: 'loan_out', date: '2026-11-01', amount: 800_000 });
    expect(overLimit(s, '2026-11-27')).toEqual([]);
    setPartyLimit(b, cfo, 'pt_bullseye', 500_000);
    expect(overLimit(s, '2026-11-27').map((p) => p.id)).toEqual(['pt_bullseye']);
    setPartyLimit(b, cfo, 'pt_bullseye', 800_000);
    expect(overLimit(s, '2026-11-27')).toEqual([]);
    expect(() => setPartyLimit(b, u('owner'), 'pt_bullseye', 1)).toThrow(PermissionError);
    expect(() => setPartyLimit(b, cfo, 'pt_bullseye', -5)).toThrow(ValidationError);
  });

  it('fifoAging ages a payable (negative) balance too', () => {
    expect(fifoAging([{ date: '2026-07-01', amount: -500 }, { date: '2026-11-20', amount: -300 }, { date: '2026-11-21', amount: 200 }], '2026-11-27')).toEqual([-300, 0, 0, 0, -300]);
    expect(fifoAging([{ date: '2026-11-01', amount: 100 }, { date: '2026-11-02', amount: -100 }], '2026-11-27')).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('entity due-to / due-from and eliminations', () => {
  it('Corporate paying a store bill shows on the entity ledger and eliminates to zero', () => {
    const { s, b, cfo } = setup();
    fund(b, cfo);
    b.createTransaction(cfo, { date: '2026-11-05', kind: 'money_out', description: 'Entergy HM11', lines: [
      { accountId: 'acct_utilities', storeId: 'st_hm11', debit: 40_000, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 40_000 }] });
    b.createTransaction(cfo, { date: '2026-11-06', kind: 'money_in', description: 'Rent HM14', lines: [
      { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 10_000, credit: 0 }, { accountId: 'acct_rent_income', storeId: 'st_hm14', debit: 0, credit: 10_000 }] });
    expect(entityLedger(s, 'ent_hm11', { to: '2026-11-30' }).balance).toBe(40_000);
    expect(entityLedger(s, 'ent_hm14', { to: '2026-11-30' }).balance).toBe(-10_000);
    const e = eliminations(s, '2026-11-30');
    expect(e.dueFrom).toBe(e.dueTo);
    expect(e.pairs).toHaveLength(2);
    expect(e.pairs.every((p) => p.net === 0)).toBe(true);
    expect(e.eliminationNet).toBe(0);
    expect(e.consolidatedDifference).toBe(0);
    expect(e.rows.find((r) => r.account.id === 'acct_due_from')?.consolidated).toBe(0);
    expect(e.ok).toBe(true);
  });
});

describe('rent pass-through templates', () => {
  it('generate monthly, idempotently, as store rent against Corporate\'s payable to the party', () => {
    const { s, b, cfo, u } = setup();
    s.intercompany.rentTemplates = rentTemplates();
    expect(rentDue(s, '2026-10-15').map((d) => d.period)).toEqual(['2026-09', '2026-09', '2026-09', '2026-10', '2026-10', '2026-10']);
    const out = generateRent(b, cfo, '2026-10');
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ date: '2026-10-01', kind: 'journal', description: 'Rent pass-through HM11 via Dhunna Development', partyId: 'pt_dhunna' });
    expect(out[0].lines.filter((l) => !l.system).map((l) => [l.accountId, l.storeId, l.debit, l.credit])).toEqual([['acct_rent', 'st_hm11', 2_950_000, 0], ['acct_due_related', 'st_corp', 0, 2_950_000]]);
    expect(generateRent(b, cfo, '2026-10')).toHaveLength(0);
    expect(partyLedger(s, 'pt_dhunna', { to: '2026-10-31' }).balance).toBe(-(2_950_000 + 1_125_000));
    // A deleted entry can be regenerated.
    b.deleteTransaction(cfo, out[0].id, 'test');
    expect(generateRent(b, cfo, '2026-10')).toHaveLength(1);
    expect(() => generateRent(b, u('owner'), '2026-11')).toThrow(PermissionError);
    expect(nextRentRun(s, s.intercompany.rentTemplates[0], '2026-10-15')).toBe('2026-09-01');
    expect(() => saveRentTemplate(b, cfo, { ...s.intercompany.rentTemplates[0], partyId: 'pt_sysco' })).toThrow(/related company/);
  });
});

describe('owner draws', () => {
  it('finds withdrawals under the expense policy and under the draw policy', () => {
    const { s, b, cfo } = setup();
    fund(b, cfo);
    b.createTransaction(cfo, { date: '2026-10-01', kind: 'money_out', description: 'CHECK OWNER A', partyId: 'pt_owner_a', lines: [
      { accountId: 'acct_misc', storeId: 'st_corp', debit: 500_000, credit: 0, partyId: 'pt_owner_a' }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 500_000 }] });
    b.createTransaction(cfo, { date: '2026-10-05', kind: 'money_out', description: 'Office supplies', lines: [
      { accountId: 'acct_misc', storeId: 'st_corp', debit: 1_000, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 1_000 }] });
    s.settings.ownerWithdrawalPolicy = 'draw';
    b.createTransaction(cfo, { date: '2026-11-01', kind: 'transfer', description: 'Cash in for HQ', lines: [
      { accountId: 'acct_cash_transit', storeId: 'st_corp', debit: 100_000, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 100_000 }] });
    recordPayout(b, cfo, { date: '2026-11-02', fromStoreId: 'st_corp', kind: 'draw', payee: 'Owner B', amount: 20_000, person: 'HQ', partyId: 'pt_owner_b' });
    const d = ownerDraws(s, { from: '2026-01-01', to: '2026-11-30' });
    expect(d.rows.map((r) => [r.via, r.ownerId, r.amount])).toEqual([['expense', 'pt_owner_a', 500_000], ['draw', 'pt_owner_b', 20_000]]);
    expect(d.total).toBe(520_000);
    expect(d.byOwner.get('pt_owner_a')).toBe(500_000);
  });
});

describe('Phase 5 intercompany demo data', () => {
  const s: BooksState = buildDemo();
  const T = '2026-11-27';
  it('gives each related party a sensible balance and Southern Eagle is over its limit', () => {
    const sum = icSummary(s, T);
    const bal = Object.fromEntries(sum.parties.map((p) => [p.id, p.balance]));
    expect(bal.pt_cheers).toBe(263_000);
    expect(bal.pt_southern_eagle).toBe(1_000_000);
    expect(bal.pt_bullseye).toBe(600_000);
    expect(bal.pt_rowdys).toBe(94_000);
    expect(bal.pt_five_rivers).toBe(-120_000);
    expect(bal.pt_dhunna).toBeLessThan(0);
    expect(bal.pt_laundry).toBe(110_000); // November rent late
    expect(overLimit(s, T).map((p) => p.id)).toEqual(['pt_southern_eagle']);
  });
  it('rent pass-throughs came from the templates, one per store per month, none due yet', () => {
    for (const t of s.intercompany.rentTemplates) expect(Object.keys(t.generated).sort()).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(s.transactions.filter((t) => t.description.startsWith('Rent pass-through')).length).toBe(9);
    expect(rentDue(s, T)).toEqual([]);
    expect(rentDue(s, '2026-12-01')).toHaveLength(3);
  });
  it('ties out: party ledgers = party accounts, every line names a party, eliminations net to zero', () => {
    const tot = partyAccountTotals(s, T);
    expect(tot.every((t) => t.untagged === 0 && t.parties === t.ledger)).toBe(true);
    const e = eliminations(s, T);
    expect(e.ok).toBe(true);
    expect(e.dueFrom).toBeGreaterThan(0);
    for (const ent of s.entities) expect(trialBalance(s, { asOf: '2026-11-30', entityId: ent.id }).difference).toBe(0);
  });
  it('owner draws year to date find the withdrawals booked as Corporate · Miscellaneous', () => {
    const d = drawsYtd(s, T);
    // Phase 13's recorded owner distributions post to 3100 Owner draws (tagged 'distribution'); the withdrawals stay expense.
    const withdrawals = d.rows.filter((r) => !r.t.tags.includes('distribution'));
    expect(withdrawals.every((r) => r.via === 'expense')).toBe(true);
    expect(withdrawals.reduce((a, r) => a + r.amount, 0)).toBe(1_350_000);
    expect(d.rows.filter((r) => r.t.tags.includes('distribution')).every((r) => r.via === 'draw')).toBe(true);
  });
});
