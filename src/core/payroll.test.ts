import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID, FEED_END } from '../data/seed';
import {
  change, commitRun, compareByEmployeeWeek, confirmExtraPay, currentRate, decideRateChange, laborPct, newHiresToConfirm, parseGustoCsv, payWeek, payWeeks,
  payoutAllocations, peopleOf, pendingRateChanges, postRun, postWeek, postingCheck, previewRun, quarterDue, quarterOf, rateFlags, recordOffPayroll,
  recordTaxDeposit, requestRateChange, runTies, saveEmployee, setLaborTarget, taxTracker, terminateEmployee, totalsOf, weeklyReview, markChecklist, ytdGustoTie,
} from './payroll';
import { recordPayout } from './cash';
import { checksRegister, reconcileStatus } from './bank';
import { PermissionError } from './permissions';
import type { BooksState, Role } from './types';

const setup = () => {
  const s = emptyState();
  const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
  return { s, b, cfo: s.users.find((u) => u.id === CFO_ID)! };
};
const as = (s: BooksState, role: Role) => s.users.find((u) => u.role === role)!;

const CSV = [
  'Pay date,Employee,Employee ID,Location,Department,Regular hours,Overtime hours,Gross pay,Employee taxes,Employer taxes,State taxes,Net pay,Payment method,Check #',
  '12/04/2026,Test Person A,G-1,HM13,Front,40,2,"$560.00",85.68,61.60,29.46,474.32,Direct deposit,',
  '12/04/2026,Test Person B,G-2,HM13,Kitchen,30,0,390.00,59.67,42.90,20.51,330.33,Check,4501',
  '12/04/2026,Test Person C,G-3,HM15,Truck lane,38,0,513.00,78.49,56.43,26.98,434.51,Direct deposit,',
  'Total,,,,,,,"1,463.00",223.84,160.93,,"1,239.16",,',
].join('\n');

describe('Gusto import', () => {
  it('reads the report, ties every line and the totals row, and is idempotent on re-import', () => {
    const { s, b, cfo } = setup();
    const f = parseGustoCsv(CSV);
    expect(f.problems).toEqual([]);
    expect(f.rows).toHaveLength(3);
    expect(f.rows[1]).toMatchObject({ check: true, checkNo: '4501', hours: 30, gross: 39000 });
    const pv = previewRun(s, f);
    expect(pv.errors).toEqual([]);
    expect(pv.payDate).toBe('2026-12-04');
    expect(pv.checks.every((c) => c.ok)).toBe(true);
    expect(pv.totals).toMatchObject({ gross: 146300, employeeTaxes: 22384, employerTaxes: 16093, net: 123916, checkPaid: 33033, companyDebit: 123916 - 33033 + 22384 + 16093 });
    expect(pv.newEmployees).toHaveLength(3);
    const run = commitRun(b, cfo, 'gusto-dec4.csv', f);
    expect(run.lines.every((l) => l.batchId === run.batchId)).toBe(true);
    expect(runTies(run).every((t) => t.ok)).toBe(true);
    expect(newHiresToConfirm(s)).toHaveLength(3);
    expect(peopleOf(s).employees.find((e) => e.name === 'Test Person C')).toMatchObject({ storeId: 'st_hm15', department: 'truck_lane', rateCents: 1350, gustoId: 'G-3' });

    const again = previewRun(s, parseGustoCsv(CSV));
    expect(again).toMatchObject({ added: 0, skipped: 3 });
    expect(() => commitRun(b, cfo, 'gusto-dec4.csv', parseGustoCsv(CSV))).toThrow(/already imported/);
    expect(peopleOf(s).runs).toHaveLength(1);
    expect(peopleOf(s).employees).toHaveLength(3);
  });
  it('refuses a report whose lines do not tie to its totals, rows that do not add up, and unknown stores', () => {
    const { s } = setup();
    const off = previewRun(s, parseGustoCsv(CSV.replace('"1,463.00"', '"1,464.00"')));
    expect(off.errors.join(' ')).toMatch(/Gross: the employee lines add to \$1,463.00 but the report's total row says \$1,464.00/);
    const row = previewRun(s, parseGustoCsv(CSV.replace('474.32', '474.00').replace('"1,239.16"', '"1,238.84"')));
    expect(row.errors.join(' ')).toMatch(/isn't net/);
    const store = previewRun(s, parseGustoCsv(CSV.replace(',HM15,', ',HM99,')));
    expect(store.errors.join(' ')).toMatch(/"HM99" isn't a store/);
    expect(parseGustoCsv('a,b\n1,2').problems[0]).toMatch(/No header row/);
  });
  it('only payroll roles can import', () => {
    const { s, b } = setup();
    expect(() => commitRun(b, as(s, 'reviewer'), 'x.csv', parseGustoCsv(CSV))).toThrow(PermissionError);
    expect(() => commitRun(b, as(s, 'store_manager'), 'x.csv', parseGustoCsv(CSV))).toThrow(PermissionError);
  });
});

describe('posting (SPEC §6.7)', () => {
  it('net pay to 6100 and all taxes to 6110 by store on the pay date, crediting Trustmark; ties to the company debit', () => {
    const { s, b, cfo } = setup();
    const run = commitRun(b, cfo, 'gusto-dec4.csv', parseGustoCsv(CSV));
    const txns = postRun(b, cfo, run.id);
    expect(txns).toHaveLength(3); // Gusto debit HM13, paper check HM13, Gusto debit HM15
    expect(txns.every((t) => t.date === '2026-12-04' && t.batchId === run.batchId)).toBe(true);
    const hm13 = txns.find((t) => t.description === 'GUSTO PAYROLL HM13')!;
    const amt = (t: typeof hm13, acct: string, side: 'debit' | 'credit') => t.lines.filter((l) => l.accountId === acct && !l.system).reduce((a, l) => a + l[side], 0);
    expect(amt(hm13, 'acct_wages', 'debit')).toBe(47432);
    expect(amt(hm13, 'acct_payroll_taxes', 'debit')).toBe(8568 + 6160 + 5967 + 4290);
    expect(hm13.lines.find((l) => l.accountId === 'acct_trustmark')).toMatchObject({ storeId: 'st_corp', credit: 47432 + 8568 + 6160 + 5967 + 4290 });
    const chk = txns.find((t) => t.checkNo === '4501')!;
    expect(amt(chk, 'acct_wages', 'debit')).toBe(33033);
    const pc = postingCheck(s, run);
    expect(pc).toMatchObject({ ok: true, wages: 123916, taxes: 22384 + 16093, gustoDebit: run.reported.companyDebit, checks: 33033 });
    expect(checksRegister(s, '2026-12-05').find((c) => c.checkNo === '4501')?.status).toBe('outstanding');
    expect(() => postRun(b, cfo, run.id)).toThrow(/already posted/);
  });
  it('refuses to post into a locked month or a run that no longer ties', () => {
    const { s, b, cfo } = setup();
    const run = commitRun(b, cfo, 'gusto-dec4.csv', parseGustoCsv(CSV));
    run.reported.net += 1;
    expect(() => postRun(b, cfo, run.id)).toThrow(/doesn't tie/);
    run.reported.net -= 1;
    b.lockPeriod(cfo, '2026-12');
    expect(() => postRun(b, cfo, run.id)).toThrow(/locked/);
    expect(s.transactions).toHaveLength(0);
    expect(() => postRun(b, as(s, 'owner'), run.id)).toThrow(PermissionError);
  });
});

describe('rate changes', () => {
  const hire = () => {
    const x = setup();
    const e = saveEmployee(x.b, x.cfo, { name: 'Test Cook', storeId: 'st_hm13', department: 'kitchen', payType: 'hourly', rateCents: 1300, hiredOn: '2026-10-01', paidBy: 'gusto', gustoId: 'G-9' });
    return { ...x, e };
  };
  it('need a reason and effective date, and only the approve permission can approve', () => {
    const { s, b, e } = hire();
    const bk = as(s, 'bookkeeper');
    expect(() => requestRateChange(b, bk, { employeeId: e.id, toCents: 1400, effective: '2026-11-23', reason: '' })).toThrow(ValidationError);
    const r = requestRateChange(b, bk, { employeeId: e.id, toCents: 1400, effective: '2026-11-23', reason: '90-day review' });
    expect(r).toMatchObject({ status: 'pending', fromCents: 1300 });
    expect(pendingRateChanges(s)).toHaveLength(1);
    expect(() => requestRateChange(b, bk, { employeeId: e.id, toCents: 1450, effective: '2026-11-30', reason: 'again' })).toThrow(/already has a rate change waiting/);
    expect(currentRate(s, e, '2026-11-30')).toBe(1300);
    expect(() => decideRateChange(b, bk, r.id, 'approved')).toThrow(PermissionError);
    expect(() => requestRateChange(b, as(s, 'owner'), { employeeId: e.id, toCents: 1400, effective: '2026-11-23', reason: 'x' })).toThrow(PermissionError);
    expect(() => decideRateChange(b, as(s, 'owner'), r.id, 'rejected')).toThrow(/why you are rejecting/);
    decideRateChange(b, as(s, 'owner'), r.id, 'approved');
    expect(currentRate(s, e, '2026-11-22')).toBe(1300);
    expect(currentRate(s, e, '2026-11-23')).toBe(1400);
    expect(() => decideRateChange(b, as(s, 'cfo'), r.id, 'rejected', 'no')).toThrow(/already approved/);
    expect(s.audit.some((a) => a.action === 'approve_rate')).toBe(true);
  });
  it('a rate cannot be changed by editing the employee', () => {
    const { b, cfo, e } = hire();
    expect(() => saveEmployee(b, cfo, { ...e, rateCents: 1500 })).toThrow(/Change rate/);
    expect(() => terminateEmployee(b, cfo, e.id, '2026-11-20', '')).toThrow(/why they left/);
    expect(terminateEmployee(b, cfo, e.id, '2026-11-20', 'Resigned')).toMatchObject({ status: 'terminated', terminatedOn: '2026-11-20' });
  });
});

describe('cash and check pay outside Gusto', () => {
  it('links to an existing cash payout without posting again, posts new cash and checks, and never caps over the payout', () => {
    const { s, b, cfo } = setup();
    const e = saveEmployee(b, cfo, { name: 'Test Cashier', storeId: 'st_hm11', department: 'front', payType: 'hourly', rateCents: 1200, hiredOn: '2026-09-01', paidBy: 'cash' });
    const po = recordPayout(b, cfo, { date: '2026-11-20', fromStoreId: 'st_corp', kind: 'payroll', payee: 'HM11 crew', amount: 50_000, person: 'HQ', accountId: 'acct_wages', storeId: 'st_hm11' });
    const n = s.transactions.length;
    recordOffPayroll(b, cfo, { employeeId: e.id, payDate: '2026-11-20', method: 'cash', amount: 30_000, hours: 25, payoutId: po.id });
    expect(s.transactions).toHaveLength(n);
    expect(() => recordOffPayroll(b, cfo, { employeeId: e.id, payDate: '2026-11-20', method: 'cash', amount: 30_000, payoutId: po.id })).toThrow(/Only \$200.00 of that payout is left/);
    expect(() => recordOffPayroll(b, cfo, { employeeId: e.id, payDate: '2026-11-27', method: 'cash', amount: 1_000, payoutId: po.id })).toThrow(/different pay week/);
    expect(payoutAllocations(s)[0]).toMatchObject({ allocated: 30_000, storeId: 'st_hm11' });
    const chk = recordOffPayroll(b, cfo, { employeeId: e.id, payDate: '2026-11-18', method: 'check', amount: 5_000, checkNo: '4600' });
    expect(chk.payDate).toBe('2026-11-20');
    expect(s.transactions.find((t) => t.id === chk.txnId)).toMatchObject({ checkNo: '4600', kind: 'money_out' });
    const cash = recordOffPayroll(b, cfo, { employeeId: e.id, payDate: '2026-11-27', method: 'cash', amount: 2_000, fromStoreId: 'st_hm11' });
    expect(s.cash.payouts.find((p) => p.id === cash.payoutId)).toMatchObject({ fromStoreId: 'st_hm11', kind: 'payroll', amount: 2_000 });
    expect(() => recordOffPayroll(b, as(s, 'reviewer'), { employeeId: e.id, payDate: '2026-11-27', method: 'cash', amount: 100 })).toThrow(PermissionError);
  });
  it('compares by employee and week and shows both when someone is paid by Gusto and in cash; never assumes a duplicate', () => {
    const { s, b, cfo } = setup();
    commitRun(b, cfo, 'gusto-dec4.csv', parseGustoCsv(CSV));
    const a = peopleOf(s).employees.find((e) => e.name === 'Test Person A')!;
    recordOffPayroll(b, cfo, { employeeId: a.id, payDate: '2026-12-03', method: 'cash', amount: 8_000, hours: 4, fromStoreId: 'st_hm13' });
    const rows = compareByEmployeeWeek(s);
    const row = rows.find((r) => r.employeeId === a.id)!;
    expect(row).toMatchObject({ payDate: '2026-12-04', status: 'both', gustoNet: 47432, cash: 8_000 });
    expect(rows.find((r) => r.employeeId !== a.id && r.storeId === 'st_hm13')?.status).toBe('gusto');
    expect(weeklyReview(s, '2026-12-04').employees.find((r) => r.employeeId === a.id)?.flags).toContain('both');
    expect(() => confirmExtraPay(b, cfo, a.id, '2026-12-04', '')).toThrow(ValidationError);
    confirmExtraPay(b, cfo, a.id, '2026-12-04', 'Extra Saturday shift paid in cash');
    expect(compareByEmployeeWeek(s).find((r) => r.employeeId === a.id)?.status).toBe('both_confirmed');
  });
});

describe('weekly review, labor % and taxes', () => {
  it('flags week-over-week changes over 15%, not at or under', () => {
    expect(change(11_600, 10_000)).toMatchObject({ flagged: true, status: 'flag' });
    expect(change(11_500, 10_000).flagged).toBe(false);
    expect(change(8_400, 10_000).flagged).toBe(true);
    expect(change(0, 10_000).status).toBe('missing');
    expect(change(10_000, 0).status).toBe('new');
    expect(payWeek('2026-11-21')).toBe('2026-11-27');
    expect(payWeek('2026-11-27')).toBe('2026-11-27');
  });
  it('computes labor % of sales and sales per labor hour against the target', () => {
    const { s, b, cfo } = setup();
    s.transactions.push({ id: 'tx_pos', ref: 'TX-1', date: '2026-12-02', kind: 'journal', description: 'POS daily close HM13', tags: ['pos'], attachments: [], source: 'demo', createdAt: '', createdBy: cfo.id, updatedAt: '', updatedBy: cfo.id,
      lines: [{ id: 'l1', accountId: 'acct_cash_registers', storeId: 'st_hm13', debit: 1_070_000, credit: 0 }, { id: 'l2', accountId: 'acct_sales_grocery', storeId: 'st_hm13', debit: 0, credit: 1_000_000 }, { id: 'l3', accountId: 'acct_sales_tax', storeId: 'st_hm13', debit: 0, credit: 70_000 }] });
    const run = commitRun(b, cfo, 'gusto-dec4.csv', parseGustoCsv(CSV));
    setLaborTarget(b, cfo, 'st_hm13', 1000);
    expect(() => setLaborTarget(b, cfo, 'st_hm13', 0)).toThrow(ValidationError);
    const [r] = laborPct(s, ['2026-12-04'], ['st_hm13']);
    const cost = 56000 + 6160 + 39000 + 4290; // gross + employer taxes for both HM13 lines
    expect(r).toMatchObject({ sales: 1_000_000, cost, hours: 72, over: true, targetBps: 1000, salesPerHour: Math.round(1_000_000 / 72), salesDays: 1, ledger: 0 });
    expect(r.pct).toBeCloseTo(cost / 1_000_000);
    postRun(b, cfo, run.id);
    expect(laborPct(s, ['2026-12-04'], ['st_hm13'])[0].ledger).toBe(cost);
  });
  it('tracks liabilities vs deposits by quarter', () => {
    const { s, b, cfo } = setup();
    commitRun(b, cfo, 'gusto-dec4.csv', parseGustoCsv(CSV));
    const t = totalsOf(peopleOf(s).runs[0].lines);
    recordTaxDeposit(b, cfo, { date: '2026-12-04', storeId: 'st_hm13', agency: 'federal', quarter: '2026Q4', amount: 10_000 });
    expect(() => recordTaxDeposit(b, cfo, { date: '2026-12-04', storeId: 'st_hm13', agency: 'state', quarter: 'Q4', amount: 1 })).toThrow(/quarter/);
    const [q] = taxTracker(s);
    expect(q.stateLiability).toBe(2946 + 2051 + 2698);
    expect(q.fedLiability + q.stateLiability).toBe(t.employeeTaxes + t.employerTaxes);
    expect(q).toMatchObject({ quarter: '2026Q4', fedDeposits: 10_000, fedDiff: q.fedLiability - 10_000, due: '2027-01-31', pendingRuns: 1 });
    expect(quarterOf('2026-09-30')).toBe('2026Q3');
    expect(quarterDue('2026Q3')).toBe('2026-10-31');
    markChecklist(b, cfo, '2026Q4:941', true, 'ABC123');
    expect(peopleOf(s).checklist['2026Q4:941']).toMatchObject({ confirmation: 'ABC123' });
    markChecklist(b, cfo, '2026Q4:941', false);
    expect(peopleOf(s).checklist['2026Q4:941']).toBeUndefined();
  });
  it('works on books saved before phase 6 (no people slice)', () => {
    const s = emptyState() as Partial<BooksState>;
    delete s.people;
    expect(weeklyReview(s as BooksState, '2026-11-27').employees).toEqual([]);
    expect(taxTracker(s as BooksState)).toEqual([]);
  });
});

describe('demo payroll', () => {
  const s = buildDemo();
  const p = s.people;
  it('has 8–14 employees per operating store, generic names, one pending raise, one new hire and one termination', () => {
    for (const st of s.stores.filter((x) => x.kind === 'operating')) {
      const n = p.employees.filter((e) => e.storeId === st.id).length;
      expect(n, st.code).toBeGreaterThanOrEqual(8);
      expect(n, st.code).toBeLessThanOrEqual(14);
    }
    expect(p.employees.every((e) => /^[A-Z][a-z]+ [A-Z]\.$/.test(e.name))).toBe(true);
    expect(pendingRateChanges(s)).toHaveLength(1);
    expect(newHiresToConfirm(s).map((e) => e.name)).toEqual(['Quinn P.']);
    expect(p.employees.filter((e) => e.status === 'terminated')).toHaveLength(1);
  });
  it('every weekly GUSTO PAYROLL entry has a run whose employee lines add to it exactly', () => {
    const gusto = s.transactions.filter((t) => t.description.startsWith('GUSTO PAYROLL'));
    expect(gusto.length).toBe(39); // 12 Fridays × HM13, HM15, CORP, plus HM17 from November
    for (const t of gusto) {
      const runs = p.runs.filter((r) => r.txnIds.includes(t.id));
      expect(runs, t.ref).toHaveLength(1);
      const tot = totalsOf(runs[0].lines);
      const sum = (acct: string) => t.lines.filter((l) => l.accountId === acct).reduce((a, l) => a + l.debit - l.credit, 0);
      expect(tot.net).toBe(sum('acct_wages'));
      expect(tot.employeeTaxes + tot.employerTaxes).toBe(sum('acct_payroll_taxes'));
      expect(-sum('acct_trustmark')).toBe(tot.companyDebit);
      expect(postingCheck(s, runs[0]).ok).toBe(true);
      expect(runs[0].lines.every((l) => l.gross === l.net + l.employeeTaxes)).toBe(true);
    }
  });
  it('HM11 cash payroll per employee adds to every weekly cash payout', () => {
    const allocs = payoutAllocations(s).filter((a) => a.storeId === 'st_hm11');
    expect(allocs.length).toBeGreaterThanOrEqual(12);
    for (const a of allocs) {
      expect(a.allocated).toBe(a.payout.amount);
      expect(a.entries.length).toBeGreaterThanOrEqual(9);
    }
  });
  it('the bank side is unchanged: September and October reconciled, November fully explained', () => {
    expect(s.bank.reconciliations.map((r) => r.statementDate)).toEqual(['2026-09-30', '2026-10-31']);
    const st = reconcileStatus(s, 'acct_trustmark', FEED_END);
    expect(st.expectedStatement).toBe(st.feedBalance);
  });
  it('the week to review: HM15 is up more than 15%, the others are not; the pending raise is already paid in Gusto', () => {
    expect(payWeeks(s)[0]).toBe('2026-11-27');
    const r = weeklyReview(s, '2026-11-27');
    const by = (code: string) => r.stores.find((x) => x.storeId === `st_${code}`)!;
    expect(by('hm15').cost.flagged).toBe(true);
    expect(by('hm15').cost.pct!).toBeGreaterThan(0.15);
    for (const c of ['hm13', 'hm17', 'corp']) expect(by(c).cost.flagged, c).toBe(false);
    expect(by('hm11').cost.status).toBe('missing'); // HM11's cash payroll for the week isn't recorded yet
    expect(r.toPost).toHaveLength(4);
    expect(r.total.otHours).toBeGreaterThan(0);
    expect(by('hm15').newHires.map((e) => e.name)).toEqual(['Quinn P.']);
    expect(by('hm13').terminations.map((e) => e.name)).toEqual(['Casey L.']);
    expect(r.rateFlags.map((f) => f.employee.name)).toEqual(['Oakley R.']);
    for (const w of payWeeks(s).slice(1)) for (const x of weeklyReview(s, w).stores) expect(x.cost.flagged, `${x.storeId} ${w}`).toBe(false);
    const cmp = compareByEmployeeWeek(s).filter((x) => x.status === 'both');
    expect(cmp).toHaveLength(1);
  });
  it('approving the raise clears the rate flag, and posting the week ties to Gusto', () => {
    const d = buildDemo();
    const b = new Books(d, () => '2026-11-27T12:00:00.000Z');
    const cfo = d.users[0];
    decideRateChange(b, cfo, pendingRateChanges(d)[0].id, 'approved');
    expect(weeklyReview(d, '2026-11-27').rateFlags).toEqual([]);
    const txns = postWeek(b, cfo, '2026-11-27');
    expect(txns.map((t) => t.description).sort()).toEqual(['GUSTO PAYROLL CORP', 'GUSTO PAYROLL HM13', 'GUSTO PAYROLL HM15', 'GUSTO PAYROLL HM17', 'PAYROLL CHECK Quinn P.']);
    for (const r of d.people.runs.filter((x) => x.payDate === '2026-11-27')) expect(postingCheck(d, r).ok).toBe(true);
    expect(checksRegister(d, '2026-11-27').find((c) => c.checkNo === '4127')?.status).toBe('outstanding');
    expect(() => postWeek(b, cfo, '2026-11-27')).toThrow(/Nothing to post/);
    const ytd = ytdGustoTie(d, '2026');
    expect(ytd.runs).toBe(ytd.ledger);
  });
  it('labor % uses POS sales and ties to the ledger for posted weeks; tax deposits cover Q3', () => {
    const weeks = payWeeks(s).slice(1, 9);
    const rows = laborPct(s, weeks, ['st_hm11', 'st_hm13', 'st_hm15', 'st_hm17']);
    for (const r of rows) expect(r.cost, `${r.storeId} ${r.week}`).toBe(r.ledger);
    expect(rows.some((r) => r.over)).toBe(true);
    expect(rows.some((r) => r.pct !== null && !r.over)).toBe(true);
    const q3 = taxTracker(s).find((q) => q.quarter === '2026Q3')!;
    expect(q3).toMatchObject({ fedDiff: 0, stateDiff: 0 });
    expect(taxTracker(s).find((q) => q.quarter === '2026Q4')!.stateDiff).toBeGreaterThan(0);
    expect(rateFlags(s, p.runs[0])).toEqual([]);
  });
});
