import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import {
  acknowledgeSod, approvalHistory, blindHidden, bankChangeSignals, checkSequenceSignals, controlHealth, controlsOf, coverageChecklist, coverageGaps, dismissSignal,
  driveOffSignals, dualCountErrors, dualCountRows, duplicateVendorSignals, escalateSignal, exportBackup, exportLog, financialResponsibility, fraudSignals, ghostEmployeeSignals,
  importPosExceptions, isOpenConflict, limitFor, lotteryShortSignals, parseBackup, parsePosExceptions, posExceptionSignals, rateSpikeSignals, recordSecondCount,
  releaseDetection, requireApproval, restoreBackup, riskLevel, risksDue, roundDollarSignals, saveApprovalLimits, saveCashControls, saveClaim, saveCoverageNeed,
  saveDriveOff, saveRisk, saveUstRecord, setVendorBankAccount, shortagePatterns, similarNames, sodConflicts, sodMatrix, terminatedPaySignals, underLimitSignals,
  ustOverdue, ustSchedule, varianceByPerson, varianceByStore, varianceRows, whoCanApprove, accessReview, DEFAULT_CASH_CONTROLS, SIGNAL_FNS, type FraudSignal, type SignalKind,
} from './controls';
import { approveBill, payBill, saveBill, type BillDraft } from './payables';
import { approveJournal, createJournal, type JeDraft } from './journals';
import { decideRateChange, requestRateChange, saveEmployee } from './payroll';
import { recordCashStep } from './cash';
import { saveLotteryWeek } from './inside';
import { PermissionError, can } from './permissions';
import type { ApprovalLimit, BooksState, PayrollRun, User } from './types';

const TODAY = '2026-11-27';
const setup = () => {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  const u = (role: User['role']) => s.users.find((x) => x.role === role)!;
  b.createTransaction(s.users[0], { date: '2026-09-01', kind: 'opening', description: 'Opening', lines: [
    { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 10_000_000, credit: 0 }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: 0, credit: 10_000_000 }] });
  return { s, b, cfo: s.users.find((x) => x.id === CFO_ID)!, bk: u('bookkeeper'), owner: u('owner'), reviewer: u('reviewer'), mgr: u('store_manager') };
};
const LIMITS: ApprovalLimit[] = [
  { role: 'cfo', kind: 'bill', maxCents: null }, { role: 'owner', kind: 'bill', maxCents: null }, { role: 'bookkeeper', kind: 'bill', maxCents: 250_000 },
  { role: 'bookkeeper', kind: 'journal', maxCents: 2_500_000 }, { role: 'bookkeeper', kind: 'writeoff', maxCents: 0 }, { role: 'bookkeeper', kind: 'rate_change', maxCents: 0 },
];
const bill = (amount: number, over: Partial<BillDraft> = {}): BillDraft => ({ vendorId: 'pt_entergy', storeId: 'st_corp', invoiceNo: `INV-${amount}`, billDate: '2026-11-02', dueDate: '2026-11-20', lines: [{ accountId: 'acct_utilities', storeId: 'st_hm11', amount }], ...over });
const je = (amount: number, over: Partial<JeDraft> = {}): JeDraft => ({ date: '2026-10-31', description: 'Accrued utilities', memo: 'Estimate', lines: [{ accountId: 'acct_utilities', storeId: 'st_hm11', debit: amount, credit: 0 }, { accountId: 'acct_accrued_exp', storeId: 'st_hm11', debit: 0, credit: amount }], ...over });
const sumEv = (s: FraudSignal) => s.evidence.reduce((a, r) => a + r.amount, 0);

describe('approval limits', () => {
  it('defaults follow the approve permission, so books from before phase 14 behave as before', () => {
    const { s } = setup();
    expect(limitFor(s, 'cfo', 'bill')).toBeNull();
    expect(limitFor(s, 'owner', 'journal')).toBeNull();
    expect(limitFor(s, 'bookkeeper', 'bill')).toBe(0);
    expect(limitFor(s, 'store_manager', 'bill')).toBe(0);
  });
  it('allowed within the limit; refused above it, naming who can approve', () => {
    const { s, b, cfo, bk } = setup();
    saveApprovalLimits(b, cfo, LIMITS);
    const small = saveBill(b, bk, bill(240_000));
    approveBill(b, bk, small.id);
    expect(small.status).toBe('approved');
    const big = saveBill(b, bk, bill(300_000));
    let msg = '';
    try { approveBill(b, bk, big.id); } catch (e) { expect(e).toBeInstanceOf(PermissionError); msg = (e as Error).message; }
    expect(msg).toMatch(/over your \$2,500\.00 limit for bills/);
    expect(msg).toMatch(/CFO \(CFO \/ admin\)/);
    expect(msg).toMatch(/Owner \(demo\) \(Owner\)/);
    expect(msg).not.toMatch(/Bookkeeper \(demo\)/);
    expect(big.status).toBe('draft');
    expect(whoCanApprove(s, 'bill', 300_000).map((u) => u.role)).toEqual(['cfo', 'owner']);
    approveBill(b, cfo, big.id);
    expect(big.status).toBe('approved');
  });
  it('a role with no limit for a kind is refused with who can; journal approvers exclude the preparer', () => {
    const { b, cfo, bk, owner } = setup();
    saveApprovalLimits(b, cfo, LIMITS);
    const p = createJournal(b, cfo, je(2_000_000));
    approveJournal(b, bk, p.id); // $20,000 within the bookkeeper's $25,000
    expect(p.status).toBe('posted');
    const q = createJournal(b, cfo, je(3_000_000));
    expect(() => approveJournal(b, bk, q.id)).toThrow(/over your \$25,000\.00 limit for journal entries\. Who can approve it: Owner \(demo\)/);
    const w = createJournal(b, cfo, je(1_500_000, { templateKey: 'bad_debt' }));
    expect(() => approveJournal(b, bk, w.id)).toThrow(/can't approve write-offs/);
    approveJournal(b, owner, w.id);
    expect(w.status).toBe('posted');
  });
  it('rate changes count at their yearly cost', () => {
    const { s, b, cfo, bk } = setup();
    saveApprovalLimits(b, cfo, [...LIMITS, { role: 'owner', kind: 'rate_change', maxCents: 200_000 }]);
    const e = saveEmployee(b, cfo, { name: 'Test Cook', storeId: 'st_hm13', department: 'kitchen', payType: 'hourly', rateCents: 1300, hiredOn: '2026-10-01', paidBy: 'gusto', gustoId: 'G-9' });
    const r = requestRateChange(b, bk, { employeeId: e.id, toCents: 1400, effective: '2026-12-07', reason: 'Review' });
    expect(() => decideRateChange(b, s.users.find((u) => u.role === 'owner')!, r.id, 'approved')).toThrow(/\$2,080\.00, over your \$2,000\.00 limit for rate changes\. Who can approve it: CFO/);
    expect(() => decideRateChange(b, bk, r.id, 'approved')).toThrow(PermissionError);
    decideRateChange(b, cfo, r.id, 'approved');
    expect(r.status).toBe('approved');
  });
  it('validation and permissions: CFO only; store managers never approve; someone keeps no limit', () => {
    const { b, cfo, bk } = setup();
    expect(() => saveApprovalLimits(b, bk, LIMITS)).toThrow(PermissionError);
    expect(() => saveApprovalLimits(b, cfo, [{ role: 'store_manager', kind: 'bill', maxCents: 10_000 }])).toThrow(/can't approve anything/);
    expect(() => saveApprovalLimits(b, cfo, [{ role: 'cfo', kind: 'bill', maxCents: 100 }, { role: 'owner', kind: 'bill', maxCents: 100 }])).toThrow(/needs no limit for bills/);
    expect(() => saveApprovalLimits(b, cfo, [{ role: 'bookkeeper', kind: 'bill', maxCents: -5 }])).toThrow(ValidationError);
  });
  it('requireApproval is the one central check', () => {
    const { b, cfo, mgr } = setup();
    expect(() => requireApproval(b, mgr, 'bill', 100, 'X')).toThrow(/Your role can't approve bills/);
    expect(() => requireApproval(b, cfo, 'bill', 10 ** 12, 'X')).not.toThrow();
  });
});

describe('segregation of duties', () => {
  it('configuration: a role that can enter, approve and pay is flagged', () => {
    const { s, b, cfo } = setup();
    const cfg = sodConflicts(s).filter((c) => c.type === 'config').map((c) => c.key);
    expect(cfg).toContain('cfg:cfo:bill');
    expect(cfg).not.toContain('cfg:bookkeeper:bill'); // can't approve by default
    saveApprovalLimits(b, cfo, LIMITS);
    expect(sodConflicts(s).map((c) => c.key)).toContain('cfg:bookkeeper:bill');
    expect(sodMatrix(s).find((m) => m.role === 'owner' && m.area === 'bill')).toMatchObject({ enter: false, approve: true, pay: false });
  });
  it('activity: entered and approved, approved and paid, counted and received; acknowledgments and role cover', () => {
    const { s, b, cfo, bk } = setup();
    saveApprovalLimits(b, cfo, LIMITS);
    const x = saveBill(b, bk, bill(100_000));
    approveBill(b, bk, x.id);
    const y = saveBill(b, bk, bill(120_000));
    approveBill(b, cfo, y.id);
    payBill(b, cfo, y.id, { date: '2026-11-20', method: 'ach', confirmation: 'C1' });
    b.createTransaction(cfo, { date: '2026-11-03', kind: 'journal', description: 'POS daily close HM11', tags: ['pos'], lines: [{ accountId: 'acct_cash_registers', storeId: 'st_hm11', debit: 50_000, credit: 0 }, { accountId: 'acct_sales_grocery', storeId: 'st_hm11', debit: 0, credit: 50_000 }] });
    for (const stage of ['count', 'pickup', 'hq_receipt'] as const) recordCashStep(b, cfo, { storeId: 'st_hm11', businessDate: '2026-11-03', stage, amount: 50_000, person: stage === 'pickup' ? 'Route operator' : 'Pat Q.' });
    const act = sodConflicts(s).filter((c) => c.type === 'activity');
    expect(act.map((c) => c.key).sort()).toEqual([`act:bill:${x.id}:enter_approve`, `act:bill:${y.id}:approve_pay`, `act:cash:${s.cash.bags[0].id}:count_receive`].sort());
    expect(() => acknowledgeSod(b, cfo, act[0].key, '')).toThrow(/Say why/);
    expect(() => acknowledgeSod(b, bk, act[0].key, 'x')).toThrow(PermissionError);
    acknowledgeSod(b, cfo, 'cfg:cfo:bill', 'Owner reviews monthly', { coversActivity: true });
    const after = sodConflicts(s);
    expect(after.find((c) => c.key === `act:bill:${y.id}:approve_pay`)?.covered?.reason).toBe('Owner reviews monthly');
    expect(after.find((c) => c.key === `act:bill:${x.id}:enter_approve`)?.covered).toBeUndefined(); // the bookkeeper's isn't covered
    acknowledgeSod(b, cfo, `act:bill:${x.id}:enter_approve`, 'Small utility bill, checked later');
    expect(sodConflicts(s).filter((c) => c.type === 'activity' && isOpenConflict(c)).map((c) => c.area)).toEqual(['cash']);
    expect(s.audit.some((a) => a.action === 'acknowledge' && a.reason === 'Owner reviews monthly')).toBe(true);
  });
});

describe('cash controls', () => {
  const day = (b: Books, cfo: User, amount: number, date = '2026-11-20') => b.createTransaction(cfo, { date, kind: 'journal', description: 'POS daily close HM13', tags: ['pos'], lines: [{ accountId: 'acct_cash_registers', storeId: 'st_hm13', debit: amount, credit: 0 }, { accountId: 'acct_sales_grocery', storeId: 'st_hm13', debit: 0, credit: amount }] });
  it('dual counts: needed above the amount, recorded on the step, enforced when switched on', () => {
    const { s, b, cfo, bk } = setup();
    day(b, cfo, 300_000);
    recordCashStep(b, cfo, { storeId: 'st_hm13', businessDate: '2026-11-20', stage: 'count', amount: 300_000, person: 'HM13 manager' });
    expect(dualCountRows(s).map((r) => r.status)).toEqual(['missing']);
    expect(() => recordSecondCount(b, cfo, { bagId: s.cash.bags[0].id, stage: 'count', person: 'hm13 manager', amount: 300_000 })).toThrow(/someone else/);
    recordSecondCount(b, cfo, { bagId: s.cash.bags[0].id, stage: 'count', person: 'HM13 assistant', amount: 299_000 });
    expect(dualCountRows(s)[0].status).toBe('mismatch');
    expect(() => saveCashControls(b, bk, DEFAULT_CASH_CONTROLS)).toThrow(PermissionError);
    saveCashControls(b, cfo, { ...DEFAULT_CASH_CONTROLS, enforceDual: true });
    day(b, cfo, 400_000, '2026-11-21');
    expect(() => recordCashStep(b, cfo, { storeId: 'st_hm13', businessDate: '2026-11-21', stage: 'count', amount: 400_000, person: 'HM13 manager' })).toThrow(/need a second counter/);
    recordCashStep(b, cfo, { storeId: 'st_hm13', businessDate: '2026-11-21', stage: 'count', amount: 400_000, person: 'HM13 manager', second: { person: 'HM13 assistant', amount: 400_000 } });
    expect(dualCountRows(s).find((r) => r.businessDate === '2026-11-21')?.status).toBe('ok');
    expect(dualCountErrors(s, { stage: 'count', amount: 100_000, businessDate: '2026-11-21', person: 'A' })).toEqual([]); // under the amount
    expect(dualCountErrors(s, { stage: 'pickup', amount: 900_000, businessDate: '2026-11-21', person: 'A' })).toEqual([]); // pickups are sealed bags
  });
  it('blind HQ counts hide the pickup amount until HQ records its count', () => {
    const { s, b, cfo } = setup();
    day(b, cfo, 100_000);
    recordCashStep(b, cfo, { storeId: 'st_hm13', businessDate: '2026-11-20', stage: 'count', amount: 100_000, person: 'M' });
    recordCashStep(b, cfo, { storeId: 'st_hm13', businessDate: '2026-11-20', stage: 'pickup', amount: 100_000, person: 'R' });
    const bag = s.cash.bags[0];
    expect(blindHidden(s, bag)).toBe(false);
    saveCashControls(b, cfo, { ...DEFAULT_CASH_CONTROLS, blindHq: true });
    expect(blindHidden(s, bag)).toBe(true);
    recordCashStep(b, cfo, { storeId: 'st_hm13', businessDate: '2026-11-20', stage: 'hq_receipt', amount: 99_000, person: 'HQ' });
    expect(blindHidden(s, bag)).toBe(false);
  });
  it('small shortages under $5 are ignored alone but flagged as a pattern; by person and by store tie', () => {
    const { s, b, cfo } = setup();
    for (const [i, d] of ['2026-11-02', '2026-11-05', '2026-11-09', '2026-11-12', '2026-11-25'].entries()) {
      day(b, cfo, 50_000, d);
      recordCashStep(b, cfo, { storeId: 'st_hm13', businessDate: d, stage: 'count', amount: 50_000 - 200 - i * 10, person: 'Night clerk K.' });
    }
    const rows = varianceRows(s);
    expect(rows.every((r) => !r.flagged)).toBe(true);
    expect(shortagePatterns(s)).toHaveLength(1);
    expect(shortagePatterns(s)[0]).toMatchObject({ person: 'Night clerk K.', count: 5, from: '2026-11-02', to: '2026-11-25' });
    const net = rows.reduce((a, r) => a + r.diff, 0);
    expect(varianceByPerson(s, rows).reduce((a, p) => a + p.net, 0)).toBe(net);
    expect(varianceByStore(rows).reduce((a, p) => a + p.net, 0)).toBe(net);
    saveCashControls(b, cfo, { ...DEFAULT_CASH_CONTROLS, patternMin: 6 });
    expect(shortagePatterns(s)).toEqual([]);
  });
});

describe('fraud signals on hand-built data', () => {
  it('duplicate vendors: similar names, same address or bank account', () => {
    const { s, b, cfo } = setup();
    expect(similarNames('Ice supplier (demo)', 'Ice Supplier Co.')).toBe(true);
    expect(similarNames('Acme Fuel LLC', 'Acme Fuels')).toBe(true);
    expect(similarNames('Sysco', 'Gusto')).toBe(false);
    b.saveParty(cfo, { id: 'pt_a', name: 'Northside Plumbing', type: 'vendor', bankAccount: 'DEMO-1' });
    b.saveParty(cfo, { id: 'pt_b', name: 'Quick Pipe Repair', type: 'vendor', bankAccount: 'DEMO 1' });
    b.createTransaction(cfo, { date: '2026-11-10', kind: 'money_out', description: 'Plumbing', partyId: 'pt_b', lines: [{ accountId: 'acct_repairs', storeId: 'st_hm11', debit: 12_345, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 12_345 }] });
    const sig = duplicateVendorSignals(s, { today: TODAY });
    expect(sig).toHaveLength(1);
    expect(sig[0]).toMatchObject({ severity: 'high', amount: 12_345 });
    expect(sig[0].detail).toMatch(/same bank account/);
    expect(sumEv(sig[0])).toBe(sig[0].amount);
  });
  it('round-dollar payments: whole $100s of $500+ to vendors, owners and payroll excluded', () => {
    const { s, b, cfo } = setup();
    const pay = (partyId: string, cents: number, date = '2026-11-10') => b.createTransaction(cfo, { date, kind: 'money_out', description: 'Pay', partyId, lines: [{ accountId: 'acct_repairs', storeId: 'st_hm11', debit: cents, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: cents }] });
    pay('pt_repair', 150_000); pay('pt_repair', 200_000, '2026-11-12'); pay('pt_repair', 123_456); pay('pt_repair', 40_000); pay('pt_owner_a', 500_000);
    const sig = roundDollarSignals(s, { today: TODAY });
    expect(sig).toHaveLength(1);
    expect(sig[0].evidence.map((e) => e.amount)).toEqual([150_000, 200_000]);
    expect(sig[0].amount).toBe(350_000);
  });
  it('just under a limit: bills within 5% of a role limit, entries just under the approval threshold', () => {
    const { s, b, cfo, bk } = setup();
    saveApprovalLimits(b, cfo, LIMITS);
    const x = saveBill(b, bk, bill(245_000)); approveBill(b, bk, x.id);
    const y = saveBill(b, bk, bill(200_000)); approveBill(b, bk, y.id);
    createJournal(b, bk, je(990_000));
    createJournal(b, bk, je(500_000));
    const sig = underLimitSignals(s, { today: TODAY });
    expect(sig.map((g) => g.amount).sort()).toEqual([245_000, 990_000]);
    expect(sig.find((g) => g.amount === 245_000)?.severity).toBe('high'); // the approver entered it
  });
  it('voids and refunds by cashier from a POS exception import (idempotent)', () => {
    const { s, b, cfo } = setup();
    const csv = 'Date,Store,Cashier,Type,Count,Amount\n2026-11-20,HM13,Pat Q.,Void,9,412.50\n2026-11-21,HM13,Pat Q.,Refund,3,96.00\n2026-11-20,HM13,Lee R.,Void,1,12.00\n2026-11-20,HM13,Sam T.,Void,2,30.00\n11/22/2026,HMXX,Bad,Void,1,5\n';
    const rows = parsePosExceptions(s, csv);
    expect(rows.filter((r) => r.errors.length).map((r) => r.row)).toEqual([6]);
    const batch = importPosExceptions(b, cfo, 'pos.csv', rows);
    expect(batch).toMatchObject({ added: 4, skipped: 0, total: 55_050 });
    expect(importPosExceptions(b, cfo, 'pos.csv', rows)).toMatchObject({ added: 0, skipped: 4 });
    const sig = posExceptionSignals(s, { today: TODAY });
    expect(sig).toHaveLength(1);
    expect(sig[0]).toMatchObject({ amount: 50_850 });
    expect(sig[0].title).toMatch(/Pat Q\. at HM13: 12 voids and refunds/);
  });
  it('drive-offs from the log', () => {
    const { s, b, cfo, mgr } = setup();
    saveDriveOff(b, cfo, { storeId: 'st_hm15', date: '2026-11-19', gallons: 12, amount: 3_300 });
    expect(() => saveDriveOff(b, mgr, { storeId: 'st_hm15', date: '2026-11-19', gallons: 12, amount: 3_300 })).toThrow(PermissionError);
    expect(() => saveDriveOff(b, cfo, { storeId: 'st_hm15', date: 'x', gallons: 0, amount: 0 })).toThrow(ValidationError);
    const sig = driveOffSignals(s, { today: TODAY });
    expect(sig).toHaveLength(1);
    expect(sig[0].amount).toBe(3_300);
  });
  it('lottery shortages not yet reviewed', () => {
    const { s, b, cfo } = setup();
    saveLotteryWeek(b, cfo, { storeId: 'st_hm13', weekEnding: '2026-11-21', instantSales: 100_000, onlineSales: 50_000, instantCashes: 20_000, onlinePayouts: 10_000, commission: 7_500, settlement: 112_500, posNet: 118_000 });
    const sig = lotteryShortSignals(s, { today: TODAY });
    expect(sig).toHaveLength(1);
    expect(sig[0].amount).toBe(2_000);
  });
  it('payroll: pay after termination, ghost employees, rate spikes', () => {
    const { s, b, cfo, bk } = setup();
    const e = saveEmployee(b, cfo, { name: 'Left Early', storeId: 'st_hm13', department: 'front', payType: 'hourly', rateCents: 1200, hiredOn: '2026-09-01', paidBy: 'gusto', gustoId: 'G-1' });
    const g = saveEmployee(b, cfo, { name: 'No Hours', storeId: 'st_hm13', department: 'front', payType: 'hourly', rateCents: 1200, hiredOn: '2026-09-01', paidBy: 'gusto', gustoId: 'G-2' });
    const w = saveEmployee(b, cfo, { name: 'No Papers', storeId: 'st_hm13', department: 'front', payType: 'hourly', rateCents: 1200, hiredOn: '2026-09-01', paidBy: 'gusto', gustoId: 'G-3' });
    e.status = 'terminated'; e.terminatedOn = '2026-11-01';
    w.w4OnFile = false;
    const line = (employeeId: string, gross: number, hours: number) => ({ id: `pl_${employeeId}_${gross}`, employeeId, storeId: 'st_hm13', department: 'front' as const, hours, otHours: 0, gross, employeeTaxes: 0, employerTaxes: 0, net: gross, stateTaxes: 0, hash: `h${employeeId}${gross}`, batchId: 'x' });
    const run = (id: string, payDate: string, periodStart: string, lines: ReturnType<typeof line>[]): PayrollRun => ({ id, payDate, periodStart, fileName: 'f', batchId: 'x', importedAt: '', importedBy: cfo.id, lines, reported: { gross: 0, employeeTaxes: 0, employerTaxes: 0, net: 0, companyDebit: 0, checkPaid: 0 }, status: 'imported', txnIds: [] });
    s.people.runs.push(run('r1', '2026-11-06', '2026-10-31', [line(e.id, 40_000, 30), line(g.id, 45_000, 0)]), run('r2', '2026-11-13', '2026-11-07', [line(e.id, 40_000, 30), line(w.id, 30_000, 25)]));
    const term = terminatedPaySignals(s, { today: TODAY });
    expect(term).toHaveLength(1);
    expect(term[0].evidence.map((x) => x.date)).toEqual(['2026-11-13']); // the 6 Nov run covers days worked before leaving
    const ghost = ghostEmployeeSignals(s, { today: TODAY });
    expect(ghost.map((x) => x.title).sort()).toEqual(['No Hours: hourly pay with no hours', 'No Papers: no W-4 on file']);
    expect(ghost.find((x) => x.title.startsWith('No Hours'))!.amount).toBe(45_000);
    const r = requestRateChange(b, bk, { employeeId: g.id, toCents: 1500, effective: '2026-12-07', reason: 'x' });
    expect(rateSpikeSignals(s, { today: TODAY }).map((x) => x.key)).toEqual([`rate_spike:${r.id}`]);
    decideRateChange(b, cfo, r.id, 'rejected', 'no');
    expect(rateSpikeSignals(s, { today: TODAY })).toEqual([]);
  });
  it('checks: gaps, repeats and out of order', () => {
    const { s, b, cfo } = setup();
    const chk = (no: string, date: string, amt = 10_000) => b.createTransaction(cfo, { date, kind: 'money_out', description: 'Check', checkNo: no, partyId: 'pt_repair', lines: [{ accountId: 'acct_repairs', storeId: 'st_hm11', debit: amt, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: amt }] });
    chk('5001', '2026-09-01'); chk('5002', '2026-09-03'); chk('5004', '2026-09-05'); chk('5005', '2026-11-01'); chk('5006', '2026-09-20'); chk('5006', '2026-09-21', 20_000); chk('7000', '2026-11-02');
    const sig = checkSequenceSignals(s, { today: TODAY });
    expect(sig.map((x) => x.key).sort()).toEqual(['check_sequence:dup:5006', 'check_sequence:gap:5003', 'check_sequence:order:5005:5006']);
    expect(sig.find((x) => x.key.includes('gap'))!.amount).toBe(0);
    expect(sig.find((x) => x.key.includes('dup'))!.amount).toBe(30_000);
  });
  it('vendor bank account changed recently, with the payments since', () => {
    const { s, b, cfo, reviewer } = setup();
    expect(() => setVendorBankAccount(b, reviewer, 'pt_repair', 'X')).toThrow(PermissionError);
    setVendorBankAccount(b, cfo, 'pt_repair', 'DEMO-NEW-1');
    b.createTransaction(cfo, { date: '2026-11-27', kind: 'money_out', description: 'Repair', partyId: 'pt_repair', lines: [{ accountId: 'acct_repairs', storeId: 'st_hm11', debit: 7_700, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 7_700 }] });
    const sig = bankChangeSignals(s, { today: TODAY });
    expect(sig).toHaveLength(1);
    expect(sig[0]).toMatchObject({ amount: 7_700, severity: 'high' });
  });
  it('dismissal needs a reason and is audited; escalation keeps a note; owners escalate, reviewers cannot', () => {
    const { s, b, cfo, owner, reviewer } = setup();
    saveDriveOff(b, cfo, { storeId: 'st_hm15', date: '2026-11-19', gallons: 12, amount: 3_300 });
    const [sig] = fraudSignals(s, { today: TODAY });
    expect(() => dismissSignal(b, cfo, sig.key, ' ')).toThrow(/Say what you found/);
    expect(() => dismissSignal(b, owner, sig.key, 'x')).toThrow(PermissionError);
    expect(() => escalateSignal(b, reviewer, sig.key, 'x')).toThrow(PermissionError);
    escalateSignal(b, owner, sig.key, 'Ask the manager for the camera footage');
    expect(fraudSignals(s, { today: TODAY })[0].escalated?.note).toMatch(/camera/);
    dismissSignal(b, cfo, sig.key, 'Reported to the sheriff; customer paid the next day');
    expect(fraudSignals(s, { today: TODAY })[0].dismissed?.reason).toMatch(/sheriff/);
    expect(s.audit.find((a) => a.action === 'dismiss_signal')).toMatchObject({ userId: cfo.id, objectId: sig.key, reason: 'Reported to the sheriff; customer paid the next day' });
    saveDriveOff(b, cfo, { storeId: 'st_hm15', date: '2026-11-20', gallons: 10, amount: 2_800 });
    const again = fraudSignals(s, { today: TODAY }).filter((x) => x.kind === 'drive_off');
    expect(again.map((x) => !!x.dismissed)).toEqual([false]); // a new row raises it again under a new key
  });
});

describe('risk, insurance and UST', () => {
  it('risk register validation, scoring and reviews due', () => {
    const { s, b, cfo, reviewer } = setup();
    expect(() => saveRisk(b, cfo, { title: '', category: 'operational', likelihood: 6, impact: 0, owner: '', mitigation: '', reviewDate: 'x', status: 'open' })).toThrow(ValidationError);
    expect(() => saveRisk(b, reviewer, { title: 'x', category: 'operational', likelihood: 1, impact: 1, owner: 'a', mitigation: 'b', reviewDate: TODAY, status: 'open' })).toThrow(PermissionError);
    const r = saveRisk(b, cfo, { title: 'Robbery', category: 'safety', likelihood: 3, impact: 5, owner: 'CFO', mitigation: 'Drop safe', reviewDate: '2026-12-05', status: 'open' });
    expect(riskLevel(r)).toBe('high');
    expect(risksDue(s, TODAY).map((x) => x.id)).toEqual([r.id]);
    saveRisk(b, cfo, { ...r, reviewDate: '2027-06-01' });
    expect(risksDue(s, TODAY)).toEqual([]);
  });
  it('coverage gaps: no policy, a site left out, under the minimum limit', () => {
    const { s, b, cfo } = setup();
    expect(coverageGaps(s, TODAY).length).toBe(8); // nothing on file
    s.compliance!.policies.push({ id: 'p1', kind: 'cyber', carrier: 'C', policyNo: 'CY-1', storeIds: ['st_corp'], effective: '2026-01-01', expires: '2027-06-01', premium: 120_000, limit: 50_000_000, attachments: [] });
    expect(coverageChecklist(s, TODAY).find((r) => r.kind === 'cyber')!.status).toBe('covered');
    saveCoverageNeed(b, cfo, { kind: 'cyber', required: true, minLimitCents: 100_000_000 });
    expect(coverageChecklist(s, TODAY).find((r) => r.kind === 'cyber')!.status).toBe('under_limit');
    saveCoverageNeed(b, cfo, { kind: 'auto', required: false });
    expect(coverageChecklist(s, TODAY).find((r) => r.kind === 'auto')!.status).toBe('not_required');
    expect(() => saveClaim(b, cfo, { storeId: 'st_hm11', date: 'x', description: '', amount: 0, paid: -1, status: 'open' })).toThrow(ValidationError);
  });
  it('UST overdue items and release detection', () => {
    const { s, b, cfo } = setup();
    s.fuel.tanks.push({ id: 'tk1', storeId: 'st_hm11', label: 'T1', grade: 'regular', capacity: 10_000, active: true });
    expect(ustOverdue(s, TODAY)).toHaveLength(7); // five tank tests and two site items, none on file
    for (const kind of ['tank_tightness', 'line_tightness', 'line_leak_detector', 'cathodic_protection', 'spill_overfill'] as const) saveUstRecord(b, cfo, { storeId: 'st_hm11', tankId: 'tk1', kind, date: '2026-06-01', result: 'pass' });
    saveUstRecord(b, cfo, { storeId: 'st_hm11', kind: 'inspection', date: '2025-11-01', result: 'pass' });
    saveUstRecord(b, cfo, { storeId: 'st_hm11', kind: 'financial_responsibility', date: '2026-07-01', result: 'pass' });
    expect(ustOverdue(s, TODAY).map((r) => r.kind)).toEqual(['inspection']);
    expect(ustSchedule(s, TODAY).find((r) => r.kind === 'line_leak_detector')!.nextDue).toBe('2027-06-01');
    expect(() => saveUstRecord(b, cfo, { storeId: 'st_hm11', kind: 'line_tightness', date: TODAY, result: 'pass' })).toThrow(/per tank/);
    saveUstRecord(b, cfo, { storeId: 'st_hm11', tankId: 'tk1', kind: 'line_tightness', date: '2026-11-20', result: 'fail' });
    expect(ustOverdue(s, TODAY).map((r) => r.status).sort()).toEqual(['failed', 'overdue']);
    expect(financialResponsibility(s, TODAY)[0].ok).toBe(false);
  });
});

describe('security & backups', () => {
  it('export → restore yields an identical state (plus the audit line for the restore)', () => {
    const { s, b, cfo } = setup();
    saveRisk(b, cfo, { title: 'Robbery', category: 'safety', likelihood: 3, impact: 5, owner: 'CFO', mitigation: 'Drop safe', reviewDate: '2026-12-05', status: 'open' });
    const { json, fileName } = exportBackup(b, cfo);
    expect(fileName).toBe('cfo-portal-backup-2026-11-27.json');
    expect(exportLog(s)[0].objectId).toMatch(/full books backup/);
    const snapshot = JSON.parse(JSON.stringify(b.state)) as BooksState;
    const parsed = parseBackup(json, b.state);
    if (!parsed.ok) throw new Error(parsed.errors.join(' '));
    expect(parsed.preview.rows.every((r) => r.current === r.backup)).toBe(true);
    // Change the books, then restore.
    saveRisk(b, cfo, { title: 'Second', category: 'safety', likelihood: 1, impact: 1, owner: 'CFO', mitigation: 'x', reviewDate: '2026-12-05', status: 'open' });
    b.createTransaction(cfo, { date: '2026-11-20', kind: 'money_out', description: 'After backup', lines: [{ accountId: 'acct_repairs', storeId: 'st_hm11', debit: 100, credit: 0 }, { accountId: 'acct_trustmark', storeId: 'st_corp', debit: 0, credit: 100 }] });
    expect(() => restoreBackup(b, cfo, parsed.backup, 'yes')).toThrow(/Type RESTORE/);
    restoreBackup(b, cfo, parsed.backup, 'RESTORE');
    const restored = JSON.parse(JSON.stringify(b.state)) as BooksState;
    const last = restored.audit.pop()!;
    expect(last).toMatchObject({ action: 'restore', objectType: 'data' });
    restored.seq -= 1;
    expect(restored).toEqual(snapshot);
  });
  it('restore is CFO only; bad files are refused with a reason', () => {
    const { b, cfo, bk, owner } = setup();
    const { json } = exportBackup(b, bk);
    const p = parseBackup(json, b.state);
    if (!p.ok) throw new Error('parse');
    expect(() => restoreBackup(b, bk, p.backup, 'RESTORE')).toThrow(PermissionError);
    expect(() => restoreBackup(b, owner, p.backup, 'RESTORE')).toThrow(PermissionError);
    expect(parseBackup('not json', b.state)).toMatchObject({ ok: false });
    expect(parseBackup('{"format":"other"}', b.state)).toMatchObject({ ok: false });
    expect(parseBackup(json.replaceAll('"schema":2', '"schema":1'), b.state)).toMatchObject({ ok: false });
    expect(() => exportBackup(b, b.state.users.find((u) => u.role === 'store_manager')!)).toThrow(PermissionError);
    expect(can(cfo, 'backup.restore')).toBe(true);
  });
  it('access review by user flags what to look at', () => {
    const { s } = setup();
    const rows = accessReview(s);
    expect(rows.find((r) => r.user.role === 'store_manager')).toMatchObject({ stores: ['HM11'], approvals: 'None' });
    expect(rows.find((r) => r.user.role === 'reviewer')!.flags).toContain('Can export data');
  });
});

describe('permissions', () => {
  it('controls.edit is CFO only, risk.edit CFO and bookkeeper, backup.restore CFO only', () => {
    const { cfo, bk, owner, reviewer, mgr } = setup();
    expect([cfo, bk, owner, reviewer, mgr].map((u) => can(u, 'controls.edit'))).toEqual([true, false, false, false, false]);
    expect([cfo, bk, owner, reviewer, mgr].map((u) => can(u, 'risk.edit'))).toEqual([true, true, false, false, false]);
    expect([cfo, bk, owner, reviewer, mgr].map((u) => can(u, 'backup.restore'))).toEqual([true, false, false, false, false]);
  });
  it('store managers record second counts only for their own store', () => {
    const { s, b, cfo, mgr } = setup();
    b.createTransaction(cfo, { date: '2026-11-20', kind: 'journal', description: 'POS daily close HM13', tags: ['pos'], lines: [{ accountId: 'acct_cash_registers', storeId: 'st_hm13', debit: 300_000, credit: 0 }, { accountId: 'acct_sales_grocery', storeId: 'st_hm13', debit: 0, credit: 300_000 }] });
    recordCashStep(b, cfo, { storeId: 'st_hm13', businessDate: '2026-11-20', stage: 'count', amount: 300_000, person: 'M' });
    expect(() => recordSecondCount(b, mgr, { bagId: s.cash.bags[0].id, stage: 'count', person: 'X', amount: 300_000 })).toThrow(PermissionError);
  });
});

describe('the demo', () => {
  const s = buildDemo();
  const sig = fraudSignals(s, { today: TODAY });
  const byKind = (k: SignalKind) => sig.filter((x) => x.kind === k);
  it('limits per role are recorded and every past approval is within them', () => {
    expect(limitFor(s, 'bookkeeper', 'bill')).toBe(250_000);
    expect(limitFor(s, 'bookkeeper', 'rate_change')).toBe(0);
    expect(limitFor(s, 'owner', 'bill')).toBeNull();
    expect(approvalHistory(s).filter((h) => !h.within)).toEqual([]);
  });
  it('one open activity conflict: the bookkeeper entered and approved the lookalike vendor bill', () => {
    const open = sodConflicts(s).filter(isOpenConflict);
    expect(open.filter((c) => c.type === 'activity').map((c) => c.title)).toEqual([expect.stringMatching(/Bookkeeper \(demo\) entered and approved BILL-/)]);
    expect(open.filter((c) => c.type === 'config').map((c) => c.key)).toEqual(['cfg:bookkeeper:bill']);
    expect(sodConflicts(s).filter((c) => c.covered).length).toBeGreaterThan(20); // the CFO's own activity, covered by the owner's review
  });
  it('every signal kind runs; the demo shows the ones it promises; evidence always adds up', () => {
    for (const k of Object.keys(SIGNAL_FNS) as SignalKind[]) expect(() => SIGNAL_FNS[k](s, { today: TODAY }), k).not.toThrow();
    for (const x of sig) expect(sumEv(x), x.key).toBe(x.amount);
    expect(byKind('duplicate_vendor').map((x) => x.title)).toEqual(['Ice supplier (demo) and Ice Supplier Co. (demo)']);
    expect(byKind('duplicate_vendor')[0].detail).toMatch(/similar names, same address/);
    expect(byKind('round_dollar').map((x) => x.amount).sort()).toEqual([350_000, 750_000]);
    expect(byKind('under_limit').map((x) => x.amount)).toEqual([245_000]);
    expect(byKind('rate_spike').map((x) => x.title)).toEqual(['Dallas N.: +25% rate change (approved)']);
    expect(byKind('drive_off').map((x) => s.stores.find((st) => st.id === x.storeId)!.code).sort()).toEqual(['HM13', 'HM15']);
    expect(byKind('drive_off').find((x) => x.storeId === 'st_hm15')!.amount).toBe(5_113);
    expect(byKind('lottery_short')).toHaveLength(1);
    expect(byKind('bank_change').map((x) => x.amount)).toEqual([245_000]);
    expect(byKind('check_sequence').some((x) => x.key === 'check_sequence:gap:4108')).toBe(true);
    expect(byKind('terminated_pay')).toEqual([]); // Casey L.'s final check covers the week she worked
    expect(byKind('ghost_employee')).toEqual([]);
    expect(byKind('pos_exceptions')).toEqual([]); // no POS exception report imported yet
  });
  it('cash: a repeated small-shortage pattern, second counts with two missing, deposits timed', () => {
    expect(shortagePatterns(s, { to: TODAY }).map((p) => p.person)).toEqual(['HM13 manager']);
    const dual = dualCountRows(s);
    expect(dual.filter((d) => d.status === 'missing')).toHaveLength(2);
    expect(dual.filter((d) => d.status === 'ok').length).toBeGreaterThan(30);
    expect(controlsOf(s).cash.blindHq).toBe(false);
  });
  it('risk register, coverage gap (cyber), claims and UST with one overdue', () => {
    const c = controlsOf(s);
    expect(c.risks.length).toBeGreaterThanOrEqual(6);
    expect(c.risks.length).toBeLessThanOrEqual(8);
    expect(coverageGaps(s, TODAY).map((g) => g.kind)).toEqual(['cyber']);
    expect(c.claims).toHaveLength(2);
    expect(ustOverdue(s, TODAY).map((r) => `${r.label} ${r.kind}`)).toEqual(['HM11 T3 (diesel) line_leak_detector']);
    expect(ustSchedule(s, TODAY)).toHaveLength(12 * 5 + 4 * 2);
    expect(financialResponsibility(s, TODAY).every((x) => x.ok)).toBe(true);
    expect(releaseDetection(s, TODAY).filter((r) => r.result === 'fail').map((r) => `${r.label} ${r.period}`)).toEqual(['HM13 T2 (premium) 2026-11']);
    expect(controlHealth(s, TODAY).map((h) => h.key)).toEqual(['limits', 'sod', 'cash', 'fraud', 'risk', 'ust', 'backup']);
  });
  it('the demo still ties: no new duplicate flags, the bank feed explained', async () => {
    const { findDuplicates } = await import('./duplicates');
    const { reconcileStatus } = await import('./bank');
    expect(findDuplicates(s.transactions).map((d) => d.a.partyId)).toEqual(['pt_sysco']);
    const st = reconcileStatus(s, 'acct_trustmark', '2026-11-25');
    expect(st.expectedStatement).toBe(st.feedBalance);
  });
});
