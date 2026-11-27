import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID, FEED_END } from '../data/seed';
import {
  apAging, approveBill, awaitingApproval, billEvents, extractBill, isJump, parseDate, pastDue, payBill, paymentCalendar, reconcileStatement, rejectBill,
  saveBill, saveVendorStatement, scheduleBill, ten99, unscheduledDueSoon, utilityRows, voidBill, type BillDraft,
} from './payables';
import { approvalQueue } from './approvals';
import { closeReceivable, itemStatus, lateRent, linkReceipt, recordRentReceipt, rentRoll, saveReceivable, saveRentSchedule } from './receivables';
import { forecast } from './forecast';
import { balanceAsOf, trialBalance } from './reports';
import { reconcileStatus } from './bank';
import { findDuplicates } from './duplicates';
import { PermissionError } from './permissions';
import type { BooksState, User } from './types';

const setup = () => {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  const u = (role: User['role']) => s.users.find((x) => x.role === role)!;
  b.createTransaction(s.users[0], { date: '2026-09-01', kind: 'opening', description: 'Opening', lines: [
    { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 10_000_000, credit: 0 }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: 0, credit: 10_000_000 }] });
  return { s, b, cfo: s.users.find((x) => x.id === CFO_ID)!, u };
};
const draft = (over: Partial<BillDraft> = {}): BillDraft => ({
  vendorId: 'pt_entergy', storeId: 'st_corp', invoiceNo: 'INV-1', billDate: '2026-11-02', dueDate: '2026-11-20',
  lines: [{ accountId: 'acct_utilities', storeId: 'st_hm11', amount: 30_000 }, { accountId: 'acct_utilities', storeId: 'st_hm13', amount: 20_000 }], ...over,
});
const ap = (s: BooksState, d = '2026-11-30') => balanceAsOf(s, 'acct_ap', d) || 0;

describe('bill lifecycle', () => {
  it('draft posts nothing; approval accrues expense → 2000; payment posts 2000 → Trustmark with the check number', () => {
    const { s, b, cfo } = setup();
    const n = s.transactions.length;
    const bill = saveBill(b, cfo, draft());
    expect(bill).toMatchObject({ ref: 'BILL-0001', status: 'draft' });
    expect(s.transactions.length).toBe(n);
    const acc = approveBill(b, cfo, bill.id, 'OK');
    expect(bill.status).toBe('approved');
    expect(acc).toMatchObject({ date: '2026-11-02', kind: 'journal', docNo: 'INV-1', partyId: 'pt_entergy' });
    expect(acc.lines.filter((l) => !l.system).map((l) => [l.accountId, l.storeId, l.debit, l.credit])).toEqual([
      ['acct_utilities', 'st_hm11', 30_000, 0], ['acct_utilities', 'st_hm13', 20_000, 0], ['acct_ap', 'st_corp', 0, 50_000]]);
    expect(ap(s)).toBe(50_000);
    scheduleBill(b, cfo, bill.id, { date: '2026-11-19', method: 'check' });
    expect(bill.status).toBe('scheduled');
    expect(() => payBill(b, cfo, bill.id, { date: '2026-11-19', method: 'check' })).toThrow(/check number/);
    const pay = payBill(b, cfo, bill.id, { date: '2026-11-19', method: 'check', checkNo: '5100' });
    expect(pay.lines.filter((l) => !l.system).map((l) => [l.accountId, l.debit, l.credit])).toEqual([['acct_ap', 50_000, 0], ['acct_trustmark', 0, 50_000]]);
    expect(pay.checkNo).toBe('5100');
    expect(bill.status).toBe('paid');
    expect(ap(s)).toBe(0);
    expect(balanceAsOf(s, 'acct_trustmark', '2026-11-30')).toBe(10_000_000 - 50_000);
    for (const e of s.entities) expect(trialBalance(s, { asOf: '2026-11-30', entityId: e.id }).difference).toBe(0);
    expect(() => payBill(b, cfo, bill.id, { date: '2026-11-20', method: 'ach', confirmation: 'x' })).toThrow(/already paid/);
    // The same check number can't be used twice.
    const b2 = saveBill(b, cfo, draft({ invoiceNo: 'INV-2' }));
    approveBill(b, cfo, b2.id);
    expect(() => payBill(b, cfo, b2.id, { date: '2026-11-21', method: 'check', checkNo: '5100' })).toThrow(/already used/);
  });

  it('autopay bills are scheduled for the due date on approval', () => {
    const { b, cfo } = setup();
    const bill = saveBill(b, cfo, draft({ autopay: true }));
    approveBill(b, cfo, bill.id);
    expect(bill.status).toBe('scheduled');
    expect(bill.scheduled).toMatchObject({ date: '2026-11-20', method: 'autopay' });
  });

  it('validates the bill and says how to fix it', () => {
    const { b, cfo } = setup();
    saveBill(b, cfo, draft());
    const err = (d: BillDraft) => { try { saveBill(b, cfo, d); return []; } catch (e) { return (e as ValidationError).errors; } };
    expect(err(draft())[0]).toMatch(/already entered/);
    expect(err(draft({ invoiceNo: 'X', dueDate: '2026-11-01' }))).toContain('The due date is before the bill date. Check both dates on the bill.');
    expect(err(draft({ invoiceNo: 'X', lines: [{ accountId: 'acct_trustmark', storeId: 'st_hm11', amount: 100 }] }))[0]).toMatch(/can't be categorized/);
    expect(err(draft({ invoiceNo: 'X', lines: [{ accountId: 'acct_utilities', storeId: 'st_hm11', amount: 0 }] }))[0]).toMatch(/above zero/);
    expect(err(draft({ invoiceNo: '' }))[0]).toMatch(/invoice number/);
  });

  it('reject and void: a rejected draft never posts; voiding an approved bill reverses its accrual', () => {
    const { s, b, cfo } = setup();
    const a = saveBill(b, cfo, draft());
    expect(() => rejectBill(b, cfo, a.id, ' ')).toThrow(ValidationError);
    rejectBill(b, cfo, a.id, 'Not ours');
    expect(a.status).toBe('void');
    expect(() => approveBill(b, cfo, a.id)).toThrow(/already void/);
    const c = saveBill(b, cfo, draft({ invoiceNo: 'INV-9' }));
    approveBill(b, cfo, c.id);
    expect(ap(s)).toBe(50_000);
    voidBill(b, cfo, c.id, 'Entered twice');
    expect(ap(s)).toBe(0);
    expect(s.transactions.find((t) => t.id === c.approved!.txnId)?.deleted?.reason).toMatch(/Entered twice/);
  });
});

describe('permissions', () => {
  it('approval needs the approve permission; owners approve and the entry posts under whoever entered it', () => {
    const { s, b, u } = setup();
    const bk = u('bookkeeper');
    const bill = saveBill(b, bk, draft());
    expect(() => approveBill(b, bk, bill.id)).toThrow(PermissionError);
    const t = approveBill(b, u('owner'), bill.id);
    expect(t.createdBy).toBe(bk.id);
    expect(bill.approved?.by).toBe('usr_owner');
    expect(() => payBill(b, u('owner'), bill.id, { date: '2026-11-20', method: 'ach', confirmation: 'x' })).toThrow(PermissionError);
    expect(s.audit.some((a) => a.objectType === 'bill' && a.action === 'approve' && a.userId === 'usr_owner')).toBe(true);
  });
  it('store managers enter bills for their own store only; reviewers cannot enter', () => {
    const { b, u } = setup();
    const mgr = u('store_manager');
    expect(() => saveBill(b, mgr, draft())).toThrow(PermissionError);
    const ok = saveBill(b, mgr, draft({ storeId: 'st_hm11', lines: [{ accountId: 'acct_repairs', storeId: 'st_hm11', amount: 5_000 }] }));
    expect(ok.status).toBe('draft');
    expect(() => approveBill(b, mgr, ok.id)).toThrow(PermissionError);
    expect(() => saveBill(b, u('reviewer'), draft({ invoiceNo: 'R' }))).toThrow(PermissionError);
  });
});

describe('AP aging', () => {
  it('buckets by days past due and ties to the 2000 balance, manual entries included', () => {
    const { s, b, cfo } = setup();
    const mk = (inv: string, due: string, amt: number) => { const x = saveBill(b, cfo, draft({ invoiceNo: inv, billDate: '2026-08-01', dueDate: due, lines: [{ accountId: 'acct_repairs', storeId: 'st_corp', amount: amt }] })); approveBill(b, cfo, x.id); return x; };
    mk('A', '2026-12-01', 100); mk('B', '2026-11-20', 200); mk('C', '2026-10-20', 300); mk('D', '2026-09-20', 400); mk('E', '2026-08-15', 500);
    const paid = mk('F', '2026-11-01', 600);
    payBill(b, cfo, paid.id, { date: '2026-11-02', method: 'ach', confirmation: 'c1' });
    let a = apAging(s, '2026-11-27');
    expect(a.buckets).toEqual([100, 200, 300, 400, 500]);
    expect(a.total).toBe(1_500);
    expect(a.ties).toBe(true);
    // As of before the payment, F is still open (current at 10-31).
    expect(apAging(s, '2026-10-31').total).toBe(2_100);
    b.createTransaction(cfo, { date: '2026-11-25', kind: 'journal', description: 'Accrue legal fees', lines: [
      { accountId: 'acct_professional', storeId: 'st_corp', debit: 999, credit: 0 }, { accountId: 'acct_ap', storeId: 'st_corp', debit: 0, credit: 999 }] });
    a = apAging(s, '2026-11-27');
    expect(a.unlinked).toBe(999);
    expect(a.total + a.unlinked).toBe(a.glBalance);
    expect(a.ties).toBe(true);
  });
});

describe('utilities, 1099s, statements, inbox extraction', () => {
  it('flags a jump of more than 25% over the bill before', () => {
    expect(isJump(10_000, 12_500)).toBe(false);
    expect(isJump(10_000, 12_501)).toBe(true);
    expect(isJump(0, 5_000)).toBe(false);
  });
  it('1099s flag at $600 paid in the year', () => {
    const { s, b, cfo } = setup();
    const pay = (amt: number, date = '2026-11-01') => b.createTransaction(cfo, { date, kind: 'money_out', description: 'Repair', partyId: 'pt_repair', lines: [
      { accountId: 'acct_repairs', storeId: 'st_hm11', debit: amt, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: amt }] });
    pay(59_999);
    expect(ten99(s, 2026, '2026-11-27').find((r) => r.partyId === 'pt_repair')).toMatchObject({ paid: 59_999, flagged: false });
    pay(1);
    expect(ten99(s, 2026, '2026-11-27').find((r) => r.partyId === 'pt_repair')).toMatchObject({ paid: 60_000, flagged: true, count: 2 });
  });
  it('vendor statement differences are explained to the cent', () => {
    const { s, b, cfo } = setup();
    const x = saveBill(b, cfo, draft({ vendorId: 'pt_sysco', invoiceNo: 'S1', lines: [{ accountId: 'acct_cogs_food', storeId: 'st_hm11', amount: 10_000 }] }));
    approveBill(b, cfo, x.id);
    const y = saveBill(b, cfo, draft({ vendorId: 'pt_sysco', invoiceNo: 'S2', lines: [{ accountId: 'acct_cogs_food', storeId: 'st_hm11', amount: 20_000 }] }));
    approveBill(b, cfo, y.id);
    const z = saveBill(b, cfo, draft({ vendorId: 'pt_sysco', invoiceNo: 'S3', lines: [{ accountId: 'acct_cogs_food', storeId: 'st_hm11', amount: 5_000 }] }));
    approveBill(b, cfo, z.id);
    payBill(b, cfo, z.id, { date: '2026-11-10', method: 'ach', confirmation: 'c' });
    const st = saveVendorStatement(b, cfo, { vendorId: 'pt_sysco', date: '2026-11-15', balance: 40_550, lines: [
      { invoiceNo: 's1', date: '2026-11-02', amount: 12_000 }, { invoiceNo: 'S3', date: '2026-11-02', amount: 5_000 }, { invoiceNo: 'S4', date: '2026-11-12', amount: 23_000 }] });
    const r = reconcileStatement(s, st);
    expect(r.apBalance).toBe(30_000);
    expect(r.difference).toBe(10_550);
    expect(r.items.map((i) => [i.kind, i.effect])).toEqual([['amount_diff', 2_000], ['in_transit', 5_000], ['not_entered', 23_000], ['not_on_statement', -20_000], ['unexplained', 550]]);
    expect(r.items.reduce((a, i) => a + i.effect, 0)).toBe(r.difference);
  });
  it('reads amounts, dates, invoice # and vendor from pasted text or a file name', () => {
    const s = buildDemo();
    const x = extractBill(s, 'Municipal water & sewer\nAccount number: DEMO-W-2013\nStatement date: Nov 6, 2026\nInvoice # W2013-1226\nAmount due: $1,402.10\nDue date: 12/01/2026\nFINAL DISCONNECT NOTICE');
    expect(x).toMatchObject({ amount: 140_210, invoiceNo: 'W2013-1226', billDate: '2026-11-06', dueDate: '2026-12-01', disconnect: true, utilityAccountId: 'ua_wat_hm13', vendorId: 'pt_water', storeId: 'st_hm13' });
    const f = extractBill(s, '', 'Sysco_invoice_88231_HM15_2026-11-20.pdf');
    expect(f).toMatchObject({ vendorId: 'pt_sysco', storeId: 'st_hm15', invoiceNo: '88231', billDate: '2026-11-20' });
    expect(extractBill(s, 'Thanks for your business! Total $12.00 and $40.50').amount).toBe(1_200);
    expect([parseDate('2026-02-30'), parseDate('11/5/26'), parseDate('December 1, 2026')]).toEqual([undefined, '2026-11-05', '2026-12-01']);
  });
});

describe('payment calendar and the forecast hook', () => {
  it('approved bills are forecast events on their pay date and stand in for the matching recurring payment', () => {
    const { s, b, cfo } = setup();
    for (const d of ['2026-08-30', '2026-09-30', '2026-10-30']) b.createTransaction(cfo, { date: d, kind: 'money_out', description: 'WATER', partyId: 'pt_entergy', lines: [
      { accountId: 'acct_utilities', storeId: 'st_hm11', debit: 40_000, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 40_000 }] });
    const before = forecast(s, 'acct_trustmark', '2026-11-27');
    const pat = before.weeks.flatMap((w) => w.events).filter((e) => e.source === 'pattern' && e.key === 'p:pt_entergy|out');
    expect(pat.map((e) => e.date)).toContain('2026-11-30');
    const bill = saveBill(b, cfo, draft({ dueDate: '2026-12-02' }));
    approveBill(b, cfo, bill.id);
    const after = forecast(s, 'acct_trustmark', '2026-11-27');
    const ev = after.weeks.flatMap((w) => w.events);
    expect(ev.filter((e) => e.source === 'bill')).toEqual([expect.objectContaining({ date: '2026-12-02', amount: -50_000, key: bill.id })]);
    expect(ev.filter((e) => e.key === 'p:pt_entergy|out').length).toBe(pat.length - 1);
    expect(billEvents(s, 'acct_other', '2026-11-27', '2027-03-01')).toEqual([]);
    const cal = paymentCalendar(s, 'acct_trustmark', '2026-11-27', 35);
    expect(cal.calendarBills).toBe(50_000);
    expect(cal.forecastBills).toBe(cal.calendarBills);
    expect(cal.days.find((d) => d.date === '2026-12-02')?.bills.map((x) => x.id)).toEqual([bill.id]);
  });
});

describe('receivables', () => {
  it('rent roll: due vs received, oldest month first, late after the grace days', () => {
    const { s, b, cfo } = setup();
    saveRentSchedule(b, cfo, { id: 'rs1', tenantId: 'pt_mavs', storeId: 'st_hm11', amount: 65_000, dueDay: 1, graceDays: 5, startPeriod: '2026-09', active: true });
    recordRentReceipt(b, cfo, { tenantId: 'pt_mavs', date: '2026-09-03', amount: 65_000 });
    recordRentReceipt(b, cfo, { tenantId: 'pt_mavs', date: '2026-10-20', amount: 65_000 });
    recordRentReceipt(b, cfo, { tenantId: 'pt_mavs', date: '2026-11-02', amount: 30_000 });
    const r = rentRoll(s, '2026-11-27');
    expect(r.charges.map((c) => [c.period, c.status, c.paid])).toEqual([['2026-09', 'paid', 65_000], ['2026-10', 'paid_late', 65_000], ['2026-11', 'partial', 30_000]]);
    expect(lateRent(s, '2026-11-27').map((c) => c.period)).toEqual(['2026-11']);
    expect(lateRent(s, '2026-11-04')).toEqual([]);
    expect(() => saveRentSchedule(b, cfo, { id: 'rs2', tenantId: 'pt_sysco', storeId: 'st_hm11', amount: 1, dueDay: 1, graceDays: 0, startPeriod: '2026-09', active: true })).toThrow(/tenant/);
  });
  it('items: expected = received + outstanding; a deposit applies once', () => {
    const { s, b, cfo, u } = setup();
    const dep = b.createTransaction(cfo, { date: '2026-11-10', kind: 'money_in', description: 'ITG REBATE', lines: [
      { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 40_000, credit: 0 }, { accountId: 'acct_rebates', storeId: 'st_corp', debit: 0, credit: 40_000 }] });
    const it = saveReceivable(b, cfo, { id: 'ar1', kind: 'rebate', payer: 'ITG', storeId: 'st_corp', description: 'Q3', expected: 100_000, expectedBy: '2026-11-15', incomeAccountId: 'acct_rebates', receipts: [], createdAt: 'x' });
    linkReceipt(b, cfo, it.id, dep.id);
    expect(() => linkReceipt(b, cfo, it.id, dep.id)).toThrow(/already applied/);
    const st = itemStatus(s, it, '2026-11-27');
    expect([st.received, st.outstanding, st.status]).toEqual([40_000, 60_000, 'overdue']);
    closeReceivable(b, cfo, it.id, 'Program ended');
    expect(itemStatus(s, it, '2026-11-27')).toMatchObject({ outstanding: 0, status: 'closed' });
    expect(() => closeReceivable(b, u('owner'), it.id, 'x')).toThrow(PermissionError);
  });
});

describe('Phase 5 payables demo data', () => {
  const s = buildDemo();
  const T = '2026-11-27';
  it('AP aging ties to the 2000 balance; one past-due vendor bill, one due in 3 days unscheduled, one awaiting approval', () => {
    const a = apAging(s, T);
    expect(a.ties).toBe(true);
    expect(a.unlinked).toBe(0);
    expect(a.total).toBeGreaterThan(0);
    expect(unscheduledDueSoon(s, T).map((b) => b.invoiceNo)).toEqual(['SM-7874']);
    expect(pastDue(s, T).map((b) => b.invoiceNo).sort()).toEqual(['IC-2364', 'W2013-1026', 'W2013-1126']);
    expect(awaitingApproval(s).map((b) => b.invoiceNo)).toEqual(['KS-3318']);
    expect(approvalQueue(s).filter((i) => i.kind === 'bill').map((i) => i.kind)).toEqual(['bill']);
  });
  it('utilities: HM15 water jumps, HM13 water is past due with a disconnect notice', () => {
    const rows = utilityRows(s, T);
    const by = Object.fromEntries(rows.map((r) => [r.ua.id, r]));
    expect(by.ua_wat_hm15.jump).toBe(true);
    expect(by.ua_wat_hm13).toMatchObject({ disconnect: true });
    expect(by.ua_wat_hm13.pastDue.length).toBe(2);
    expect(rows.filter((r) => r.jump).map((r) => r.ua.id)).toEqual(['ua_wat_hm15']);
    expect(by.ua_ent_hm11.history.length).toBe(3); // autopay drafts straight from the bank
  });
  it('1099s, vendor statement and tenant rent behave as the demo promises', () => {
    const t = Object.fromEntries(ten99(s, 2026, T).map((r) => [r.partyId, r]));
    expect(t.pt_cpa.flagged).toBe(true);
    expect(t.pt_signs.flagged).toBe(true);
    expect(t.pt_pest.flagged).toBe(false);
    const r = reconcileStatement(s, s.payables.statements[0]);
    expect(r.explained).toBe(r.difference);
    expect(r.unexplained).toBe(675);
    expect(lateRent(s, T).map((c) => c.tenantId)).toEqual(['pt_laundry']);
  });
  it('the Phase 2 bank feed still reconciles with the bill payments in it', () => {
    const st = reconcileStatus(s, 'acct_trustmark', FEED_END);
    expect(st.expectedStatement).toBe(st.feedBalance);
    expect(s.bank.reconciliations.map((x) => x.statementDate)).toEqual(['2026-09-30', '2026-10-31']);
    expect(s.bank.lines.some((l) => l.checkNo === '4202')).toBe(true);
    // Bills and their payments don't add false duplicate flags: only the Phase 1 Sysco pair remains.
    expect(findDuplicates(s.transactions).map((d) => d.a.partyId)).toEqual(['pt_sysco']);
    for (const e of s.entities) expect(trialBalance(s, { asOf: '2026-11-30', entityId: e.id }).difference).toBe(0);
  });
});
