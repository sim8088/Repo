import type { SeedCtx } from './seed';
import type { Department, Employee, PayrollLine, PayrollRun, RateChange } from '../core/types';
import { allocate } from '../core/money';
import { addDays } from '../core/dates';
import { currentRate, isActiveOn, lineHashes, payWeek, quarterOf, recordOffPayroll, round2, totalsOf, weekStart } from '../core/payroll';

/**
 * People & payroll demo (phase 6). Employees are generic first names with an initial; every figure is invented.
 * - Each weekly "GUSTO PAYROLL <store>" entry the core demo posted gets a Gusto run whose employee lines add
 *   exactly to that entry's net pay and taxes, so the bank feed and reconciliations are unchanged.
 * - HM11's weekly cash payroll payout is split per employee, linked to the payout (nothing new posts).
 * - The 27 Nov runs are imported but not posted: that week is the one waiting for review, with a pending
 *   raise already paid in Gusto, a new hire on a paper check, a final check for a termination and a >15% jump at HM15.
 */

interface Spec { name: string; dept: Department; pay: 'hourly' | 'salary'; rate: number; base: number; hired?: string; paidBy?: Employee['paidBy'] }

const H = (name: string, dept: Department, rate: number, base: number, extra: Partial<Spec> = {}): Spec => ({ name, dept, pay: 'hourly', rate, base, ...extra });
const S = (name: string, dept: Department, weekly: number, extra: Partial<Spec> = {}): Spec => ({ name, dept, pay: 'salary', rate: weekly, base: 45, ...extra });

const ROSTER: Record<string, Spec[]> = {
  st_hm11: [
    S('Avery B.', 'front', 900, { paidBy: 'cash' }), H('Blake C.', 'front', 11.5, 38, { paidBy: 'cash' }), H('Cameron D.', 'front', 11, 34, { paidBy: 'cash' }),
    H('Dakota E.', 'front', 11, 30, { paidBy: 'cash' }), H('Emerson F.', 'front', 12, 36, { paidBy: 'cash' }), H('Finley G.', 'kitchen', 13, 40, { paidBy: 'cash' }),
    H('Gray H.', 'kitchen', 12, 36, { paidBy: 'cash' }), H('Harper J.', 'kitchen', 11.5, 30, { paidBy: 'cash' }), H('Indigo K.', 'front', 11, 26, { paidBy: 'cash' }),
    H('Jesse L.', 'kitchen', 12.5, 34, { paidBy: 'cash' }),
  ],
  st_hm13: [
    S('Kai M.', 'front', 950), H('Logan N.', 'front', 12, 38), H('Casey L.', 'front', 11.5, 36), H('Morgan T.', 'front', 12, 36, { paidBy: 'mixed' }),
    H('Noel P.', 'front', 11.5, 32), H('Oakley R.', 'kitchen', 13, 40), H('Parker S.', 'kitchen', 12.5, 38), H('Quincy V.', 'kitchen', 12, 34), H('Rowan W.', 'front', 11.5, 30),
  ],
  st_hm15: [
    S('Sage A.', 'front', 1050), H('Tatum B.', 'truck_lane', 13.5, 46), H('Umber C.', 'truck_lane', 13.5, 46), H('Vale D.', 'truck_lane', 13, 44),
    H('Wren E.', 'front', 12, 36), H('Xen F.', 'front', 12, 34), H('Yael G.', 'front', 11.5, 32), H('Reese K.', 'kitchen', 13, 38, { paidBy: 'mixed' }),
    H('Zion H.', 'kitchen', 12.5, 36), H('Arden J.', 'kitchen', 12, 30), H('Bellamy L.', 'front', 11.5, 28), H('Quinn P.', 'kitchen', 12, 24, { hired: '2026-11-23' }),
  ],
  st_hm17: [
    S('Corin M.', 'front', 900, { hired: '2026-10-26' }), H('Dallas N.', 'front', 12, 34, { hired: '2026-10-26' }), H('Ellis O.', 'front', 11.5, 30, { hired: '2026-10-26' }),
    H('Frankie P.', 'front', 11.5, 28, { hired: '2026-10-26' }), H('Greer Q.', 'front', 12, 32, { hired: '2026-10-26' }), H('Hollis R.', 'front', 11, 24, { hired: '2026-10-26' }),
    H('Ira S.', 'front', 11, 26, { hired: '2026-10-26' }), H('Jules T.', 'front', 11.5, 22, { hired: '2026-10-26' }),
  ],
  st_corp: [S('Kendall U.', 'office', 1500), S('Lennox V.', 'office', 1300), H('Marlowe W.', 'office', 17, 40), H('Nico X.', 'office', 16, 40)],
};

const ER_SHARE = 0.42; // employer share of the taxes on a run
const STATE_SHARE = 0.2; // state withholding + unemployment share of the taxes
const EE_RATE = 0.153; // employee taxes as a share of gross (pending week only)
const ER_RATE = 0.11; // employer taxes as a share of gross (pending week only)

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Split hourly pay into regular and overtime hours at time and a half over 40. */
function hoursFor(gross: number, rate: number): { hours: number; otHours: number } {
  const paid = gross / rate;
  if (paid <= 40) return { hours: round2(paid), otHours: 0 };
  return { hours: 40, otHours: round2((paid - 40) / 1.5) };
}

export function seedPayroll(ctx: SeedCtx): void {
  const { state, books, cfo, setClock } = ctx;
  // Own random stream: the shared one feeds the bank feed's check-clearing dates, which must not move.
  const rand = rng(6_2026);
  const p = state.people;
  const bk = state.users.find((u) => u.role === 'bookkeeper') ?? cfo;
  const specOf = new Map<string, Spec>();
  let gid = 7100;
  for (const [storeId, list] of Object.entries(ROSTER)) {
    for (const s of list) {
      const hired = s.hired ?? addDays('2026-08-31', -Math.round(60 + rand() * 900));
      const e: Employee = {
        id: books.nextId('emp'), name: s.name, storeId, department: s.dept, payType: s.pay, rateCents: Math.round(s.rate * 100), status: 'active', hiredOn: hired,
        gustoId: (s.paidBy ?? 'gusto') === 'cash' ? undefined : `G-${(gid += 7)}`, paidBy: s.paidBy ?? 'gusto',
        hireReviewed: s.name === 'Quinn P.' ? undefined : { by: cfo.id, at: addDays(hired, 3) + 'T15:00:00.000Z' },
      };
      p.employees.push(e);
      specOf.set(e.id, s);
    }
  }
  const emp = (name: string) => p.employees.find((e) => e.name === name)!;

  // Rate history: approved changes, one rejected request and one raise still waiting for approval.
  const rc = (name: string, from: number, to: number, effective: string, reason: string, status: RateChange['status'], decided?: string, note?: string): RateChange => ({
    id: books.nextId('rc'), employeeId: emp(name).id, fromCents: Math.round(from * 100), toCents: Math.round(to * 100), effective, reason, requestedBy: bk.id, requestedAt: addDays(effective, -4) + 'T15:00:00.000Z',
    status, decidedBy: decided ? cfo.id : undefined, decidedAt: decided ? decided + 'T16:00:00.000Z' : undefined, decisionNote: note,
  });
  p.rateChanges.push(
    rc('Blake C.', 11.5, 12, '2026-09-21', 'One-year review', 'approved', '2026-09-18'),
    rc('Tatum B.', 13.5, 14.25, '2026-10-05', 'Annual review; covers the truck lane overnight', 'approved', '2026-10-02'),
    rc('Marlowe W.', 17, 18, '2026-10-19', 'Took over bank reconciliations', 'approved', '2026-10-16'),
    rc('Noel P.', 11.5, 13.5, '2026-11-02', 'Asked for a raise', 'rejected', '2026-10-30', 'Wait for the 90-day review in January.'),
    rc('Oakley R.', 13, 14, '2026-11-23', 'Promoted to kitchen lead after 90-day review', 'pending'),
  );

  const casey = emp('Casey L.');
  casey.status = 'terminated';
  casey.terminatedOn = '2026-11-21';
  casey.notes = 'Resigned; final check on the 27 Nov run.';

  // ── Gusto runs for every weekly Gusto entry already in the books.
  const gustoTxns = state.transactions.filter((t) => t.description.startsWith('GUSTO PAYROLL ') && t.tags.includes('payroll') && !t.deleted).sort((a, b) => a.date.localeCompare(b.date));
  const lastLine = new Map<string, PayrollLine>();
  for (const t of gustoTxns) {
    const storeId = t.lines.find((l) => l.accountId === 'acct_wages')!.storeId;
    const net = t.lines.filter((l) => l.accountId === 'acct_wages').reduce((a, l) => a + l.debit, 0);
    const tax = t.lines.filter((l) => l.accountId === 'acct_payroll_taxes').reduce((a, l) => a + l.debit, 0);
    const er = Math.round(tax * ER_SHARE);
    const ee = tax - er;
    const from = weekStart(t.date);
    const crew = p.employees.filter((e) => e.storeId === storeId && e.paidBy !== 'cash' && e.hiredOn <= t.date && (!e.terminatedOn || e.terminatedOn >= from));
    const salaried = crew.filter((e) => e.payType === 'salary');
    const hourly = crew.filter((e) => e.payType === 'hourly');
    const eeRate = ee / (net + ee);
    const erRate = er / (net + ee);
    const lines: Omit<PayrollLine, 'hash' | 'id' | 'batchId'>[] = [];
    let netLeft = net, eeLeft = ee, erLeft = er;
    for (const e of salaried) {
      const gross = e.rateCents;
      const lee = Math.round(gross * eeRate);
      const ler = Math.round(gross * erRate);
      lines.push({ employeeId: e.id, storeId, department: e.department, hours: 45, otHours: 0, gross, employeeTaxes: lee, employerTaxes: ler, net: gross - lee, stateTaxes: 0 });
      netLeft -= gross - lee; eeLeft -= lee; erLeft -= ler;
    }
    const w = hourly.map((e) => currentRate(state, e, t.date) * specOf.get(e.id)!.base * (1 + (rand() * 2 - 1) * 0.03));
    const nets = allocate(netLeft, w);
    const ees = allocate(eeLeft, w);
    const ers = allocate(erLeft, w);
    hourly.forEach((e, i) => {
      const gross = nets[i] + ees[i];
      lines.push({ employeeId: e.id, storeId, department: e.department, ...hoursFor(gross, currentRate(state, e, t.date)), gross, employeeTaxes: ees[i], employerTaxes: ers[i], net: nets[i], stateTaxes: 0 });
    });
    for (const l of lines) l.stateTaxes = Math.round((l.employeeTaxes + l.employerTaxes) * STATE_SHARE);
    const run = makeRun(state.people.employees, books.nextId('run'), t.date, `Gusto payroll ${t.date} ${storeId.replace('st_', '').toUpperCase()} (demo).csv`, lines, () => books.nextId('pl'), books.nextId('gst'));
    run.status = 'posted';
    run.txnIds = [t.id];
    run.postedBy = cfo.id;
    run.postedAt = t.date + 'T17:00:00.000Z';
    run.importedAt = addDays(t.date, -2) + 'T15:00:00.000Z';
    t.batchId = run.batchId;
    t.source = 'import';
    p.runs.push(run);
    for (const l of run.lines) lastLine.set(l.employeeId, l);
    // Gusto deposits federal taxes on the pay date (semiweekly depositor).
    const fed = run.lines.reduce((a, l) => a + l.employeeTaxes + l.employerTaxes - l.stateTaxes, 0);
    p.taxDeposits.push({ id: books.nextId('td'), date: t.date, storeId, agency: 'federal', quarter: quarterOf(t.date), amount: fed, note: 'EFTPS via Gusto', by: cfo.id });
  }
  // State taxes are deposited monthly, on the 15th of the next month (November's are due 15 Dec).
  const stateBy = new Map<string, number>();
  for (const r of p.runs) for (const l of r.lines) stateBy.set(`${l.storeId}|${r.payDate.slice(0, 7)}`, (stateBy.get(`${l.storeId}|${r.payDate.slice(0, 7)}`) ?? 0) + l.stateTaxes);
  for (const [k, amt] of stateBy) {
    const [storeId, month] = k.split('|');
    if (month >= '2026-11') continue;
    const due = month === '2026-09' ? '2026-10-15' : '2026-11-13';
    p.taxDeposits.push({ id: books.nextId('td'), date: due, storeId, agency: 'state', quarter: quarterOf(month + '-01'), amount: amt, note: `State withholding + unemployment for ${month} via Gusto`, by: cfo.id });
  }
  for (const k of ['2026Q3:941', '2026Q3:state_wh', '2026Q3:state_ui']) p.checklist[k] = { by: cfo.id, at: '2026-10-28T15:00:00.000Z', confirmation: 'Filed by Gusto (demo)' };
  p.checklist['2026:w2:addresses'] = { by: bk.id, at: '2026-11-20T15:00:00.000Z' };

  // ── HM11 cash payroll: split each weekly payout per employee and link it (no new posting).
  const hm11 = p.employees.filter((e) => e.storeId === 'st_hm11');
  for (const po of state.cash.payouts.filter((x) => x.kind === 'payroll' && x.payee.startsWith('HM11')).sort((a, b) => a.date.localeCompare(b.date))) {
    setClock(po.date);
    const crew = hm11.filter((e) => isActiveOn(e, po.date));
    const w = crew.map((e) => currentRate(state, e, po.date) * (e.payType === 'salary' ? 1 : specOf.get(e.id)!.base) * (1 + (rand() * 2 - 1) * 0.03));
    const amts = allocate(po.amount, w);
    crew.forEach((e, i) => {
      const hours = e.payType === 'salary' ? 45 : round2(amts[i] / currentRate(state, e, po.date));
      recordOffPayroll(books, cfo, { employeeId: e.id, payDate: po.date, method: 'cash', amount: amts[i], hours, payoutId: po.id, note: 'Weekly cash payroll' });
    });
  }

  // ── Extra cash pay outside Gusto (shown next to the same week's Gusto pay; never assumed a duplicate).
  setClock('2026-10-30');
  const reese = recordOffPayroll(books, cfo, { employeeId: emp('Reese K.').id, payDate: '2026-10-30', method: 'cash', amount: 15_000, hours: 8, fromStoreId: 'st_hm15', person: 'HM15 manager', note: 'Saturday catering order' });
  reese.confirmed = { by: cfo.id, at: '2026-11-02T15:00:00.000Z', note: 'Catering order on a Saturday, paid in cash by agreement' };
  setClock('2026-11-20');
  recordOffPayroll(books, cfo, { employeeId: emp('Morgan T.').id, payDate: '2026-11-20', method: 'cash', amount: 12_000, hours: 6, fromStoreId: 'st_hm13', person: 'HM13 manager', note: 'Covered extra shifts' });

  // ── The week waiting for review: 27 Nov runs imported, not posted.
  const pay = '2026-11-27';
  const from = weekStart(pay);
  const raise = p.rateChanges.find((r) => r.status === 'pending')!;
  for (const storeId of ['st_hm13', 'st_hm15', 'st_hm17', 'st_corp']) {
    const crew = p.employees.filter((e) => e.storeId === storeId && e.paidBy !== 'cash' && e.hiredOn <= pay && (!e.terminatedOn || e.terminatedOn >= from));
    const lines: Omit<PayrollLine, 'hash' | 'id' | 'batchId'>[] = crew.map((e) => {
      let gross: number;
      let hours = 45, otHours = 0;
      if (e.payType === 'salary') gross = e.rateCents;
      else {
        const rate = e.id === raise.employeeId ? raise.toCents : currentRate(state, e, pay);
        const prev = lastLine.get(e.id);
        let paid = prev ? (prev.hours + 1.5 * prev.otHours) * (1 + (rand() * 2 - 1) * 0.02) : specOf.get(e.id)!.base;
        if (e.terminatedOn) paid = 8;
        if (storeId === 'st_hm15' && e.department === 'truck_lane') paid += 18; // 12 extra overtime hours: holiday truck traffic
        if (storeId === 'st_hm15' && e.department === 'kitchen' && e.name !== 'Quinn P.') paid += 9;
        gross = Math.round(rate * paid);
        ({ hours, otHours } = hoursFor(gross, rate));
      }
      const ee = Math.round(gross * EE_RATE);
      const er = Math.round(gross * ER_RATE);
      return { employeeId: e.id, storeId, department: e.department, hours, otHours, gross, employeeTaxes: ee, employerTaxes: er, net: gross - ee, stateTaxes: Math.round((ee + er) * STATE_SHARE), check: e.name === 'Quinn P.' ? { checkNo: '4127' } : undefined };
    });
    const run = makeRun(state.people.employees, books.nextId('run'), pay, `Gusto payroll ${pay} ${storeId.replace('st_', '').toUpperCase()} (demo).csv`, lines, () => books.nextId('pl'), books.nextId('gst'));
    run.importedAt = '2026-11-25T15:00:00.000Z';
    run.importedBy = bk.id;
    p.runs.push(run);
  }

  p.laborTargets = { st_hm11: 650, st_hm13: 950, st_hm15: 750, st_hm17: 1200 };
}

function makeRun(employees: Employee[], id: string, payDate: string, fileName: string, lines: Omit<PayrollLine, 'hash' | 'id' | 'batchId'>[], lineId: () => string, batchId: string): PayrollRun {
  const names = lines.map((l) => { const e = employees.find((x) => x.id === l.employeeId)!; return { gustoId: e.gustoId, name: e.name, gross: l.gross, net: l.net }; });
  const hashes = lineHashes(payDate, names);
  const full: PayrollLine[] = lines.map((l, i) => ({ ...l, id: lineId(), hash: hashes[i], batchId }));
  return {
    id, payDate, periodStart: weekStart(payDate), periodEnd: payWeek(payDate), fileName, batchId, importedAt: payDate + 'T15:00:00.000Z', importedBy: 'usr_cfo',
    lines: full, reported: totalsOf(full), status: 'imported', txnIds: [],
  };
}
