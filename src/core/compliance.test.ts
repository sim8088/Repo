import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import {
  complianceInbox, complianceReminders, coveredPeriod, dueDates, expiryStatus, isDone, linkDoc, occurrences, renewLicense, saveComplianceItem, saveLicense,
  saveNotice, searchVault, updateOccurrence, uploadToVault, vaultIndex,
} from './compliance';
import { amortizePrepaids, prepaidSchedule, prepaidStatus, prepaidTie, savePrepaid, unpostedPrepaidMonths } from './prepaids';
import { balanceAsOf, trialBalance } from './reports';
import { PermissionError } from './permissions';
import type { Attachment, User } from './types';

const setup = () => {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  const cfo = s.users.find((x) => x.id === CFO_ID)!;
  const u = (role: User['role']) => s.users.find((x) => x.role === role)!;
  b.createTransaction(cfo, { date: '2026-08-31', kind: 'opening', description: 'Opening', lines: [
    { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 10_000_000, credit: 0 }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: 0, credit: 10_000_000 }] });
  return { s, b, cfo, u };
};
const att = (id: string, name = id + '.pdf'): Attachment => ({ id, name, mime: 'application/pdf', size: 1000, addedAt: '2026-11-01T00:00:00Z', addedBy: CFO_ID });

describe('recurrence', () => {
  it('monthly keeps the day and clamps short months; quarterly steps 3 months; once is one date; until stops it', () => {
    expect(dueDates({ every: 'monthly', firstDue: '2026-01-31' }, '2026-01-01', '2026-05-31')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
    expect(dueDates({ every: 'quarterly', firstDue: '2026-01-31' }, '2026-01-01', '2026-12-31')).toEqual(['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
    expect(dueDates({ every: 'annual', firstDue: '2024-02-29' }, '2024-01-01', '2026-12-31')).toEqual(['2024-02-29', '2025-02-28', '2026-02-28']);
    expect(dueDates({ every: 'once', firstDue: '2026-12-15' }, '2026-01-01', '2026-12-31')).toEqual(['2026-12-15']);
    expect(dueDates({ every: 'monthly', firstDue: '2026-09-20', until: '2026-11-30' }, '2026-01-01', '2027-12-31')).toEqual(['2026-09-20', '2026-10-20', '2026-11-20']);
  });
  it('names the period covered', () => {
    const { b, cfo } = setup();
    const st = saveComplianceItem(b, cfo, { kind: 'sales_tax', title: 'Sales tax', agency: 'State', needsPayment: true, active: true, recurrence: { every: 'monthly', firstDue: '2026-10-20', coversMonthsBefore: 1 } });
    const q = saveComplianceItem(b, cfo, { kind: 'payroll', title: '941', agency: 'IRS', needsPayment: false, active: true, recurrence: { every: 'quarterly', firstDue: '2026-10-31', coversMonthsBefore: 1 } });
    expect(coveredPeriod(st, '2026-12-20')).toBe('November 2026');
    expect(coveredPeriod(q, '2026-10-31')).toBe('Q3 2026');
    expect(coveredPeriod(q, '2027-01-31')).toBe('Q4 2026');
  });
});

describe('status and reminders', () => {
  it('done needs filing, plus payment when the item needs one; reminders are overdue or due within 30 days', () => {
    const { s, b, cfo } = setup();
    const item = saveComplianceItem(b, cfo, { kind: 'fuel_excise', title: 'UST fee', agency: 'State', needsPayment: true, active: true, recurrence: { every: 'quarterly', firstDue: '2026-10-31', coversMonthsBefore: 1 } });
    const today = '2026-11-27';
    let rem = complianceReminders(s, today);
    expect(rem.map((r) => r.dueDate)).toEqual(['2026-10-31']);
    expect(rem[0].overdue).toBe(true);
    expect(() => updateOccurrence(b, cfo, item.id, '2026-10-31', { status: 'filed', filedOn: '2026-11-20' })).toThrow(/confirmation/);
    expect(() => updateOccurrence(b, cfo, item.id, '2026-10-30', { status: 'in_prep' })).toThrow(/isn't due/);
    updateOccurrence(b, cfo, item.id, '2026-10-31', { status: 'filed', filedOn: '2026-11-20', confirmation: 'C-1' });
    expect(isDone(item, item.occurrences['2026-10-31'])).toBe(false);
    expect(complianceReminders(s, today)).toHaveLength(1);
    expect(() => updateOccurrence(b, cfo, item.id, '2026-10-31', { status: 'paid', paidOn: '2026-11-21', confirmation: 'C-1' })).toThrow(/amount paid/);
    updateOccurrence(b, cfo, item.id, '2026-10-31', { status: 'paid', filedOn: '2026-11-20', paidOn: '2026-11-21', paidAmount: 12_000, confirmation: 'C-1' });
    rem = complianceReminders(s, today);
    expect(rem).toHaveLength(0);
    // The next one comes into the 30-day window as the date approaches.
    expect(complianceReminders(s, '2027-01-05').map((r) => r.dueDate)).toEqual(['2027-01-31']);
    expect(s.audit.some((a) => a.objectType === 'compliance' && a.action === 'status')).toBe(true);
  });
  it('only the CFO and bookkeeper can change the calendar', () => {
    const { b, u } = setup();
    expect(() => saveComplianceItem(b, u('owner'), { kind: 'other', title: 'X', agency: 'Y', needsPayment: false, active: true, recurrence: { every: 'once', firstDue: '2026-12-01' } })).toThrow(PermissionError);
    expect(() => saveComplianceItem(b, u('bookkeeper'), { kind: 'other', title: '', agency: '', needsPayment: false, active: true, recurrence: { every: 'once', firstDue: 'soon' } })).toThrow(ValidationError);
  });
  it('licenses expire, renew with history; notices need an outcome to close', () => {
    const { b, cfo } = setup();
    const l = saveLicense(b, cfo, { kind: 'beer', name: 'Beer permit', storeId: 'st_hm13', issuer: 'State', number: 'B-1', expiresOn: '2026-12-15' });
    expect(expiryStatus(l.expiresOn, '2026-11-27')).toBe('expiring');
    expect(expiryStatus(l.expiresOn, '2026-12-16')).toBe('expired');
    expect(expiryStatus(l.expiresOn, '2026-10-01')).toBe('current');
    expect(() => renewLicense(b, cfo, l.id, { expiresOn: '2026-12-01', renewedOn: '2026-11-27' })).toThrow(/after the current one/);
    renewLicense(b, cfo, l.id, { expiresOn: '2027-12-15', renewedOn: '2026-11-27' });
    expect(l.history).toHaveLength(1);
    expect(l.expiresOn).toBe('2027-12-15');
    const n = saveNotice(b, cfo, { agency: 'IRS', noticeType: 'CP', received: '2026-11-01', deadline: '2026-12-01', summary: 'Letter', status: 'open' });
    expect(() => saveNotice(b, cfo, { ...n, status: 'closed' })).toThrow(/outcome/);
    saveNotice(b, cfo, { ...n, status: 'closed', outcome: 'No change' });
  });
});

describe('document vault', () => {
  it('indexes attachments once across records, searches metadata, and linking to a transaction attaches the file', () => {
    const { s, b, cfo } = setup();
    const t = b.createTransaction(cfo, { date: '2026-11-03', kind: 'money_out', description: 'ICE SUPPLIER', partyId: 'pt_grocery', lines: [
      { accountId: 'acct_supplies', storeId: 'st_hm11', debit: 50_000, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 50_000 }] }, { attachments: [att('a1', 'ice invoice.pdf')] });
    uploadToVault(b, cfo, att('u1', 'Craddock statement.pdf'), { docType: 'Statement', tags: ['Fuel', 'fuel '], month: '2026-11' });
    let idx = vaultIndex(s);
    expect(idx.map((e) => e.id).sort()).toEqual(['a1', 'u1']);
    expect(idx.find((e) => e.id === 'u1')).toMatchObject({ unlinked: false, tags: ['fuel'], months: ['2026-11'] });
    expect(searchVault(s, idx, { text: 'ice HM11' }).map((e) => e.id)).toEqual(['a1']);
    expect(searchVault(s, idx, { tag: 'fuel' }).map((e) => e.id)).toEqual(['u1']);
    expect(searchVault(s, idx, { storeId: 'st_hm11', month: '2026-11' }).map((e) => e.id)).toEqual(['a1']);
    linkDoc(b, cfo, 'u1', { kind: 'transaction', id: t.id });
    expect(t.attachments.map((a) => a.id)).toEqual(['a1', 'u1']);
    idx = vaultIndex(s);
    expect(idx).toHaveLength(2); // still one entry per file
    expect(idx.find((e) => e.id === 'u1')!.sources.map((x) => x.kind).sort()).toEqual(['transaction', 'upload']);
    expect(() => linkDoc(b, cfo, 'u1', { kind: 'month', id: '2026-13' })).toThrow(/YYYY-MM/);
    // A store manager only sees documents for their store.
    expect(vaultIndex(s, new Set(['st_hm13'])).map((e) => e.id)).toEqual([]);
  });
});

describe('prepaid amortization', () => {
  it('spreads the amount evenly to the cent, posts each month once (1400 → expense), and ties to 1400', () => {
    const { s, b, cfo } = setup();
    const p = savePrepaid(b, cfo, { label: 'Property insurance', kind: 'insurance', storeId: 'st_hm11', expenseAccountId: 'acct_insurance', amount: 1_000_001, startPeriod: '2026-09', months: 12, active: true }, { date: '2026-09-01' });
    const sched = prepaidSchedule(p);
    expect(sched).toHaveLength(12);
    expect(sched.reduce((a, m) => a + m.amount, 0)).toBe(1_000_001);
    expect(balanceAsOf(s, 'acct_prepaid', '2026-09-01')).toBe(1_000_001);
    expect(unpostedPrepaidMonths(s, '2026-11-27')).toEqual(['2026-09', '2026-10']);
    const before = prepaidTie(s, '2026-11-27');
    expect(before.difference).toBe(0); // the books agree with what's been posted…
    expect(before.scheduledByMath).toBe(before.schedules - sched[0].amount - sched[1].amount); // …but two months are still to amortize
    const t = amortizePrepaids(b, cfo, '2026-09')!;
    expect(t.date).toBe('2026-09-30');
    expect(t.lines.find((l) => l.accountId === 'acct_insurance')!.debit).toBe(sched[0].amount);
    expect(amortizePrepaids(b, cfo, '2026-09')).toBeNull(); // idempotent
    amortizePrepaids(b, cfo, '2026-10');
    const st = prepaidStatus(s, p, '2026-11-27');
    expect(st.unposted).toHaveLength(0);
    expect(st.remaining).toBe(1_000_001 - sched[0].amount - sched[1].amount);
    expect(prepaidTie(s, '2026-11-27').difference).toBe(0);
    expect(trialBalance(s, { asOf: '2026-11-30' }).difference).toBe(0);
  });
  it('the demo prepaids tie to 1400 and September and October are posted', () => {
    const s = buildDemo();
    const tie = prepaidTie(s, '2026-11-27');
    expect(tie.difference).toBe(0);
    expect(tie.ledger).toBe(1_448_000); // $18,400 opening − 2 × $2,560 + $1,200 HM17 permits
    expect(unpostedPrepaidMonths(s, '2026-11-27')).toEqual([]);
  });
});

describe('compliance demo', () => {
  it('has one overdue filing, items due within 30 days, one license expiring and one notice open', () => {
    const s = buildDemo();
    const today = '2026-11-27';
    const all = new Set(s.stores.map((x) => x.id));
    const rows = occurrences(s, { from: '2026-08-01', to: '2026-12-27', today });
    expect(rows.filter((r) => r.overdue).map((r) => r.item.title)).toEqual(['UST environmental fee report']);
    expect(rows.filter((r) => !r.done && !r.overdue).length).toBeGreaterThanOrEqual(2);
    const inbox = Object.fromEntries(complianceInbox(s, all, today).map((i) => [i.key, i.count]));
    expect(inbox).toMatchObject({ cmpoverdue: 1, licexp: 1, notices: 1 });
    expect(inbox.cmpdue).toBeGreaterThanOrEqual(2);
    // Sales tax remitted for September ties to its payment in the books.
    const sep = rows.find((r) => r.item.kind === 'sales_tax' && r.dueDate === '2026-10-20')!;
    const tx = s.transactions.find((t) => t.id === sep.occ!.txnId)!;
    expect(tx.lines.filter((l) => l.accountId === 'acct_trustmark').reduce((a, l) => a + l.credit, 0)).toBe(sep.occ!.paidAmount);
  });
});
