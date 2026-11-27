import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import { computeSupport, lastClosedPeriod, payrollAccrual, prepareRecon, reconList, reconRow, reviewRecon, setManualSupport, supportKind, unsignedRecons } from './recons';
import { consolidate, recordConsolidation } from './consolidation';
import { createJournal, fromTemplate, glOf } from './journals';
import { saveBill, approveBill } from './payables';
import { PermissionError } from './permissions';
import { craddockReceivable } from './fuel';
import { partyAccountTotals } from './intercompany';
import type { Attachment, User } from './types';

const setup = () => {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  const u = (role: User['role']) => s.users.find((x) => x.role === role)!;
  b.createTransaction(s.users[0], { date: '2026-09-01', kind: 'opening', description: 'Opening', lines: [
    { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 10_000_000, credit: 0 }, { accountId: 'acct_prepaid', storeId: 'st_corp', debit: 1_200_000, credit: 0 },
    { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: 0, credit: 11_200_000 }] });
  return { s, b, cfo: s.users.find((x) => x.id === CFO_ID)!, bk: u('bookkeeper'), owner: u('owner'), reviewer: u('reviewer') };
};
const att = (by: string): Attachment[] => [{ id: 'att_x', name: 'schedule.pdf', mime: 'application/pdf', size: 10, addedAt: '2026-11-01T00:00:00Z', addedBy: by }];

describe('account reconciliations', () => {
  it('lists every balance-sheet account except retained earnings; zero accounts need nothing', () => {
    const { s } = setup();
    const rows = reconList(s, '2026-10');
    expect(rows.every((r) => ['asset', 'liability', 'equity'].includes(r.account.type))).toBe(true);
    expect(rows.some((r) => r.account.id === 'acct_retained')).toBe(false);
    expect(rows.find((r) => r.account.id === 'acct_ap')!.status).toBe('not_needed');
    expect(rows.find((r) => r.account.id === 'acct_prepaid')).toMatchObject({ status: 'open', gl: 1_200_000, difference: null });
  });
  it('support from subledgers: AP from open bills, related parties from party ledgers', () => {
    const { s, b, cfo } = setup();
    const bill = saveBill(b, cfo, { vendorId: 'pt_entergy', storeId: 'st_corp', invoiceNo: 'E-1', billDate: '2026-10-10', dueDate: '2026-11-10', lines: [{ accountId: 'acct_utilities', storeId: 'st_hm11', amount: 45_000 }] });
    approveBill(b, cfo, bill.id);
    expect(supportKind(s.accounts.find((a) => a.id === 'acct_ap')!)).toBe('ap');
    expect(reconRow(s, 'acct_ap', '2026-10')).toMatchObject({ gl: 45_000, difference: 0 });
    expect(reconRow(s, 'acct_ap', '2026-10')!.support.amount).toBe(45_000);
    // A related-party loan tagged with its party ties; an untagged one shows as a difference.
    b.createTransaction(cfo, { date: '2026-10-12', kind: 'transfer', description: 'Loan', partyId: 'pt_bullseye', lines: [{ accountId: 'acct_loans_related', storeId: 'st_corp', debit: 80_000, credit: 0, partyId: 'pt_bullseye' }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 80_000 }] });
    expect(reconRow(s, 'acct_loans_related', '2026-10')).toMatchObject({ gl: 80_000, difference: 0 });
    b.createTransaction(cfo, { date: '2026-10-13', kind: 'transfer', description: 'Loan, no party', lines: [{ accountId: 'acct_loans_related', storeId: 'st_corp', debit: 5_000, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 5_000 }] });
    const r = reconRow(s, 'acct_loans_related', '2026-10')!;
    expect(r.difference).toBe(5_000);
    expect(r.support.note).toMatch(/no related party/);
  });
  it('bank support comes from the saved bank reconciliation; without one it is not available', () => {
    const { s } = setup();
    expect(reconRow(s, 'acct_trustmark', '2026-10')!.support).toMatchObject({ kind: 'bank', amount: null });
    s.bank.reconciliations.push({ id: 'r', accountId: 'acct_trustmark', statementDate: '2026-10-31', statementBalance: 10_050_000, bookBalance: 10_000_000, bookOnly: -50_000, bankOnly: 0, difference: 0, by: 'x', at: 'x', outstandingLineIds: [], bankOnlyIds: [] });
    expect(reconRow(s, 'acct_trustmark', '2026-10')).toMatchObject({ gl: 10_000_000, difference: 0 });
  });
  it('manual support needs a note and an attachment, and only where no subledger exists', () => {
    const { b, bk } = setup();
    expect(() => setManualSupport(b, bk, 'acct_prepaid', '2026-10', { amount: 1_200_000, note: 'x', attachments: [] })).toThrow(/Attach/);
    expect(() => setManualSupport(b, bk, 'acct_prepaid', '2026-10', { amount: 1_200_000, note: '', attachments: att(bk.id) })).toThrow(/Say what/);
    expect(() => setManualSupport(b, bk, 'acct_ap', '2026-10', { amount: 1, note: 'x', attachments: att(bk.id) })).toThrow(/by hand/);
    setManualSupport(b, bk, 'acct_prepaid', '2026-10', { amount: 1_150_000, note: 'Prepaid schedule', attachments: att(bk.id) });
    expect(reconRow(b.state, 'acct_prepaid', '2026-10')!.difference).toBe(50_000);
  });
  it('preparer and reviewer sign off; a difference needs an explanation; reviewer ≠ preparer', () => {
    const { s, b, bk, cfo, reviewer } = setup();
    setManualSupport(b, bk, 'acct_prepaid', '2026-10', { amount: 1_150_000, note: 'Prepaid schedule', attachments: att(bk.id) });
    expect(() => prepareRecon(b, bk, 'acct_prepaid', '2026-10')).toThrow(/Explain/);
    expect(() => prepareRecon(b, bk, 'acct_trustmark', '2026-10')).toThrow(/Reconcile the statement/);
    prepareRecon(b, bk, 'acct_prepaid', '2026-10', 'October amortization not booked');
    expect(reconRow(s, 'acct_prepaid', '2026-10')!.status).toBe('prepared');
    expect(() => reviewRecon(b, bk, 'acct_prepaid', '2026-10')).toThrow(PermissionError);
    expect(() => reviewRecon(b, reviewer, 'acct_prepaid', '2026-10')).toThrow(PermissionError);
    expect(() => prepareRecon(b, cfo, 'acct_owner_capital', '2026-10')).toThrow(/Enter the balance/);
  });
  it('signs off, then the GL changes: the sign-off is invalidated until prepared again', () => {
    const { s, b, bk, cfo } = setup();
    setManualSupport(b, bk, 'acct_prepaid', '2026-10', { amount: 1_200_000, note: 'Prepaid schedule', attachments: att(bk.id) });
    prepareRecon(b, cfo, 'acct_prepaid', '2026-10');
    expect(() => reviewRecon(b, cfo, 'acct_prepaid', '2026-10')).toThrow(/someone else/);
    prepareRecon(b, bk, 'acct_prepaid', '2026-10');
    reviewRecon(b, cfo, 'acct_prepaid', '2026-10');
    expect(reconRow(s, 'acct_prepaid', '2026-10')!.status).toBe('reviewed');
    expect(unsignedRecons(s, '2026-11-27').some((r) => r.account.id === 'acct_prepaid')).toBe(false);
    createJournal(b, cfo, fromTemplate(s, 'prepaid_insurance', { date: '2026-10-31', stores: ['st_corp'], amounts: [100_000] }));
    const r = reconRow(s, 'acct_prepaid', '2026-10')!;
    expect(r.status).toBe('stale');
    expect(r.gl).toBe(1_100_000);
    expect(() => reviewRecon(b, cfo, 'acct_prepaid', '2026-10')).toThrow(/changed after/);
    expect(unsignedRecons(s, '2026-11-27').some((x) => x.account.id === 'acct_prepaid')).toBe(true);
    // A later month's entry doesn't touch October's sign-off.
    setManualSupport(b, bk, 'acct_prepaid', '2026-10', { amount: 1_100_000, note: 'Prepaid schedule v2', attachments: att(bk.id) });
    prepareRecon(b, bk, 'acct_prepaid', '2026-10');
    reviewRecon(b, cfo, 'acct_prepaid', '2026-10');
    createJournal(b, cfo, fromTemplate(s, 'prepaid_insurance', { date: '2026-11-30', stores: ['st_corp'], amounts: [100_000] }));
    expect(reconRow(s, 'acct_prepaid', '2026-10')!.status).toBe('reviewed');
    expect(s.audit.filter((a) => a.objectType === 'recon').length).toBeGreaterThanOrEqual(6);
  });
  it('payroll accrual: the days of the pay week worked by month end', () => {
    const { s } = setup();
    expect(payrollAccrual(s, '2026-10-31')).toEqual([]);
    s.people.runs.push({ id: 'r', payDate: '2026-11-06', fileName: 'x', batchId: 'b', importedAt: 'x', importedBy: 'x', status: 'posted', txnIds: [],
      reported: { gross: 0, employeeTaxes: 0, employerTaxes: 0, net: 0, companyDebit: 0, checkPaid: 0 },
      lines: [{ id: 'l', employeeId: 'e', storeId: 'st_hm13', department: 'front', hours: 40, otHours: 0, gross: 80_000, employeeTaxes: 7_000, employerTaxes: 7_000, net: 70_000, stateTaxes: 0, hash: 'h', batchId: 'b' }] });
    expect(payrollAccrual(s, '2026-10-31')).toEqual([{ storeId: 'st_hm13', wages: 10_000, taxes: 2_000, days: 1, week: '2026-11-06' }]);
    expect(payrollAccrual(s, '2026-11-06')).toEqual([]);
    expect(computeSupport(s, s.accounts.find((a) => a.id === 'acct_accrued_payroll')!, '2026-10').amount).toBe(10_000);
  });
  it('last closed period', () => {
    expect(lastClosedPeriod('2026-11-27')).toBe('2026-10');
    expect(lastClosedPeriod('2027-01-03')).toBe('2026-12');
  });
});

describe('consolidation', () => {
  it('eliminates due-to / due-from and intercompany fees; eliminations net to zero', () => {
    const { s, b, cfo } = setup();
    b.createTransaction(cfo, { date: '2026-10-05', kind: 'money_out', description: 'Corp pays HM11 bill', lines: [{ accountId: 'acct_utilities', storeId: 'st_hm11', debit: 40_000, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 40_000 }] });
    createJournal(b, cfo, fromTemplate(s, 'ic_mgmt_fee', { date: '2026-10-15', stores: ['st_hm13'], amounts: [150_000] }));
    const c = consolidate(s, { asOf: '2026-10-31' });
    expect(c.ok).toBe(true);
    expect(c.eliminationNet).toBe(0);
    expect(c.entriesBalance).toBe(true);
    expect(c.entries.map((e) => e.key)).toEqual(['pair:ent_corp|ent_hm11', 'pair:ent_corp|ent_hm13', 'icpnl']);
    const row = (id: string) => c.rows.find((r) => r.account.id === id)!;
    expect(row('acct_due_from').combined).toBe(190_000);
    expect(row('acct_due_from').consolidated).toBe(0);
    expect(row('acct_due_to').consolidated).toBe(0);
    expect(row('acct_ic_fee_income')).toMatchObject({ combined: -150_000, elimination: 150_000, consolidated: 0 });
    expect(c.netIncome.consolidated).toBe(c.netIncome.combined);
    expect(row('acct_utilities').byEntity.ent_hm11).toBe(40_000);
  });
  it('records the elimination entries in the log; nothing posts', () => {
    const { s, b, cfo, owner } = setup();
    const n = s.transactions.length;
    expect(() => recordConsolidation(b, owner, '2026-10-31')).toThrow(PermissionError);
    const r = recordConsolidation(b, cfo, '2026-10-31', 'October close');
    expect(glOf(s).consolidations).toEqual([r]);
    expect(s.transactions.length).toBe(n);
  });
});

describe('demo reconciliations and consolidation', () => {
  const s = buildDemo();
  const rows = reconList(s, '2026-10');
  const by = (id: string) => rows.find((r) => r.account.id === id)!;
  it('October: subledger support ties; several signed off; sales tax awaits review; prepaid has an explained difference', () => {
    for (const id of ['acct_trustmark', 'acct_craddock', 'acct_dash', 'acct_due_from', 'acct_due_to', 'acct_loans_related', 'acct_paid_for_related', 'acct_due_related', 'acct_ap', 'acct_accrued_payroll', 'acct_payroll_tax']) {
      expect(by(id).difference, id).toBe(0);
    }
    expect(rows.filter((r) => r.status === 'reviewed').length).toBeGreaterThanOrEqual(10);
    expect(by('acct_sales_tax').status).toBe('prepared');
    expect(by('acct_prepaid')).toMatchObject({ status: 'prepared', difference: 145_000 });
    expect(by('acct_prepaid').recon!.prepared!.note).toMatch(/amortization/);
    for (const r of rows.filter((x) => x.recon?.reviewed)) expect(r.recon!.reviewed!.by).not.toBe(r.recon!.prepared!.by);
    expect(by('acct_trustmark').status).toBe('open');
    const cr = s.stores.filter((x) => x.fuelSupplier === 'craddock').reduce((a, x) => a + craddockReceivable(s, x.id, '2026-10-31').ledger, 0);
    expect(by('acct_craddock').gl).toBe(cr);
    expect(by('acct_due_related').support.amount).toBe(-(partyAccountTotals(s, '2026-10-31').find((r) => r.accountId === 'acct_due_related')!.parties));
    expect(unsignedRecons(s, '2026-11-27').length).toBeGreaterThan(0);
  });
  it('the consolidated trial balance eliminates to zero at every month end', () => {
    for (const asOf of ['2026-09-30', '2026-10-31', '2026-11-26']) {
      const c = consolidate(s, { asOf });
      expect(c.ok, asOf).toBe(true);
      expect(c.eliminationNet).toBe(0);
    }
    expect(consolidate(s, { asOf: '2026-10-31' }).entries.some((e) => e.key === 'icpnl')).toBe(true);
  });
  it('fails validation errors as sentences', () => {
    const { b, bk } = setup();
    expect(() => prepareRecon(b, bk, 'acct_utilities', '2026-10')).toThrow(ValidationError);
  });
});
