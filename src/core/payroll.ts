import type { Books } from './books';
import { ValidationError } from './books';
import type {
  BooksState, CashPayout, Department, Employee, ID, OffPayrollPay, PayMethod, PayrollLine, PayrollRun, PayrollTotals, PeopleState,
  RateChange, TaxAgency, TaxDeposit, Transaction, User,
} from './types';
import type { DraftLine } from './ledger';
import { addDays, dayOfWeek, isValidDate, periodOf } from './dates';
import { formatMoney, parseMoney } from './money';
import { bankStoreId } from './bank';
import { parseDate, splitCsv } from './bankio';
import { recordPayout } from './cash';

export const ACCT = { wages: 'acct_wages', taxes: 'acct_payroll_taxes', bank: 'acct_trustmark' } as const;
export const WOW_THRESHOLD = 0.15;
export const DEPT_LABEL: Record<Department, string> = { front: 'Front', kitchen: 'Kitchen', office: 'Office', truck_lane: 'Truck lane' };
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { gusto: 'Gusto', cash: 'Cash', check: 'Check', mixed: 'Gusto + cash/check' };

export function emptyPeople(): PeopleState {
  return { employees: [], rateChanges: [], runs: [], offPayroll: [], taxDeposits: [], laborTargets: {}, checklist: {} };
}

const EMPTY: PeopleState = emptyPeople();
/** The people slice, or an empty one for books saved before phase 6 (read-only; writes go through `ensure`). */
export function peopleOf(state: BooksState): PeopleState {
  return state.people ?? EMPTY;
}
function ensure(books: Books): PeopleState {
  if (!books.state.people) books.state.people = emptyPeople();
  return books.state.people;
}

const fmt$ = (c: number) => formatMoney(c, { dollarSign: true });
const code = (state: BooksState, id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
export const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Dates ────────────────────────────────────────────────────────────────
/** Pay weeks run Saturday to Friday and are named by their Friday pay date. */
export function payWeek(date: string): string {
  return addDays(date, (5 - dayOfWeek(date) + 7) % 7);
}
export function weekStart(payDate: string): string {
  return addDays(payWeek(payDate), -6);
}
export function quarterOf(date: string): string {
  return `${date.slice(0, 4)}Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
}
export function quarterEnd(q: string): string {
  const y = Number(q.slice(0, 4));
  const m = Number(q.slice(5)) * 3;
  return new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10);
}
/** Quarterly payroll returns are due the last day of the month after the quarter. */
export function quarterDue(q: string): string {
  const end = quarterEnd(q);
  const [y, m] = end.split('-').map(Number);
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 0, 12)).toISOString().slice(0, 10);
}

// ── Employees and rates ──────────────────────────────────────────────────
export function employee(state: BooksState, id: ID): Employee | undefined {
  return peopleOf(state).employees.find((e) => e.id === id);
}

/** Rate on a date: the starting rate plus every approved change effective by then. */
export function currentRate(state: BooksState, emp: Employee, asOf: string): number {
  const ch = peopleOf(state).rateChanges.filter((r) => r.employeeId === emp.id && r.status === 'approved' && r.effective <= asOf)
    .sort((a, b) => a.effective.localeCompare(b.effective) || (a.decidedAt ?? '').localeCompare(b.decidedAt ?? ''));
  return ch.at(-1)?.toCents ?? emp.rateCents;
}

export function rateHistory(state: BooksState, employeeId: ID): RateChange[] {
  return peopleOf(state).rateChanges.filter((r) => r.employeeId === employeeId).sort((a, b) => b.effective.localeCompare(a.effective) || b.requestedAt.localeCompare(a.requestedAt));
}

export function pendingRateChanges(state: BooksState, visible?: Set<ID>): RateChange[] {
  return peopleOf(state).rateChanges.filter((r) => r.status === 'pending' && (!visible || visible.has(employee(state, r.employeeId)?.storeId ?? '')));
}

export function newHiresToConfirm(state: BooksState, visible?: Set<ID>): Employee[] {
  return peopleOf(state).employees.filter((e) => !e.hireReviewed && e.status === 'active' && (!visible || visible.has(e.storeId)));
}

export function isActiveOn(e: Employee, date: string): boolean {
  return e.hiredOn <= date && (!e.terminatedOn || e.terminatedOn >= date);
}

export interface EmployeeInput {
  id?: ID;
  name: string;
  storeId: ID;
  department: Department;
  payType: Employee['payType'];
  rateCents: number;
  hiredOn: string;
  gustoId?: string;
  paidBy: PayMethod;
  notes?: string;
}

/** Add an employee, or edit one's details. Rates change only through an approved rate change. */
export function saveEmployee(books: Books, actor: User, input: EmployeeInput): Employee {
  books.require(actor, 'payroll.edit', 'add or edit employees');
  const p = ensure(books);
  const existing = input.id ? p.employees.find((e) => e.id === input.id) : undefined;
  const errs: string[] = [];
  if (!input.name.trim()) errs.push('Give the employee a name.');
  const store = books.store(input.storeId);
  if (!store || store.deleted || store.kind === 'leased_out') errs.push('Choose the store they work at (CORP for office staff).');
  if (!isValidDate(input.hiredOn)) errs.push('Enter the hire date as YYYY-MM-DD.');
  if (!existing && (!Number.isSafeInteger(input.rateCents) || input.rateCents <= 0)) errs.push('Enter their starting pay rate.');
  if (existing && input.rateCents !== existing.rateCents) errs.push('To change a pay rate, use "Change rate" so it goes through approval with a reason and effective date.');
  const gid = input.gustoId?.trim();
  if (gid && p.employees.some((e) => e.gustoId === gid && e.id !== input.id)) errs.push(`Gusto id ${gid} already belongs to someone else.`);
  if (errs.length) throw new ValidationError(errs);
  const before = existing ? structuredClone(existing) : undefined;
  const e: Employee = existing ?? { id: books.nextId('emp'), name: '', storeId: '', department: 'front', payType: 'hourly', rateCents: input.rateCents, status: 'active', hiredOn: input.hiredOn, paidBy: 'gusto' };
  Object.assign(e, { name: input.name.trim(), storeId: input.storeId, department: input.department, payType: input.payType, hiredOn: input.hiredOn, gustoId: gid || undefined, paidBy: input.paidBy, notes: input.notes?.trim() || undefined });
  if (!existing) p.employees.push(e);
  books.audit(actor, { action: existing ? 'update' : 'create', objectType: 'people', objectId: e.id, summary: `${existing ? 'Updated' : 'Added'} employee ${e.name} (${code(books.state, e.storeId)})`, before, after: structuredClone(e) });
  books.changed();
  return e;
}

export function terminateEmployee(books: Books, actor: User, id: ID, date: string, reason: string): Employee {
  books.require(actor, 'payroll.edit', 'record terminations');
  const e = ensure(books).employees.find((x) => x.id === id);
  const errs: string[] = [];
  if (!e) errs.push('That employee no longer exists.');
  if (!isValidDate(date)) errs.push('Enter the last day worked as YYYY-MM-DD.');
  if (e && date < e.hiredOn) errs.push('The last day worked is before the hire date.');
  if (!reason.trim()) errs.push('Say why they left (resigned, let go, seasonal). It goes in the audit log.');
  if (errs.length) throw new ValidationError(errs);
  const before = structuredClone(e!);
  e!.status = 'terminated';
  e!.terminatedOn = date;
  books.audit(actor, { action: 'terminate', objectType: 'people', objectId: e!.id, summary: `Terminated ${e!.name}, last day ${date}`, before, after: structuredClone(e!), reason: reason.trim() });
  books.changed();
  return e!;
}

/** The CFO checked the new hire's paperwork (W-4, I-9, rate). */
export function confirmHire(books: Books, actor: User, id: ID): void {
  books.require(actor, 'payroll.edit', 'confirm new hires');
  const e = ensure(books).employees.find((x) => x.id === id);
  if (!e) throw new ValidationError(['That employee no longer exists.']);
  e.hireReviewed = { by: actor.id, at: books.clock() };
  books.audit(actor, { action: 'confirm_hire', objectType: 'people', objectId: e.id, summary: `Confirmed new hire ${e.name}` });
  books.changed();
}

/** Ask for a raise or rate change. It doesn't apply until someone with approval rights approves it. */
export function requestRateChange(books: Books, actor: User, input: { employeeId: ID; toCents: number; effective: string; reason: string }): RateChange {
  books.require(actor, 'payroll.edit', 'request rate changes');
  const p = ensure(books);
  const e = p.employees.find((x) => x.id === input.employeeId);
  const errs: string[] = [];
  if (!e) errs.push('Choose an employee.');
  if (!Number.isSafeInteger(input.toCents) || input.toCents <= 0) errs.push('Enter the new rate.');
  if (!isValidDate(input.effective)) errs.push('Enter the effective date as YYYY-MM-DD.');
  if (!input.reason.trim()) errs.push('Give a reason (e.g. "90-day review", "promoted to shift lead").');
  if (e && p.rateChanges.some((r) => r.employeeId === e.id && r.status === 'pending')) errs.push(`${e.name} already has a rate change waiting for approval. Approve or reject it first.`);
  const from = e && isValidDate(input.effective) ? currentRate(books.state, e, input.effective) : 0;
  if (e && from === input.toCents) errs.push(`${e.name} is already paid ${fmt$(from)} on that date.`);
  if (errs.length) throw new ValidationError(errs);
  const r: RateChange = { id: books.nextId('rc'), employeeId: e!.id, fromCents: from, toCents: input.toCents, effective: input.effective, reason: input.reason.trim(), requestedBy: actor.id, requestedAt: books.clock(), status: 'pending' };
  p.rateChanges.push(r);
  books.audit(actor, { action: 'request_rate', objectType: 'people', objectId: r.id, summary: `Requested rate change for ${e!.name}: ${fmt$(from)} → ${fmt$(input.toCents)} from ${input.effective}`, after: r, reason: r.reason });
  books.changed();
  return r;
}

/** Approve or reject a pending rate change. Needs the approve permission (CFO or owner). */
export function decideRateChange(books: Books, actor: User, id: ID, decision: 'approved' | 'rejected', note?: string): RateChange {
  books.require(actor, 'approve', 'approve rate changes');
  const r = ensure(books).rateChanges.find((x) => x.id === id);
  if (!r) throw new ValidationError(['That rate change no longer exists.']);
  if (r.status !== 'pending') throw new ValidationError([`This rate change was already ${r.status}.`]);
  if (decision === 'rejected' && !note?.trim()) throw new ValidationError(['Say why you are rejecting it, so the requester knows what to change.']);
  const before = structuredClone(r);
  r.status = decision;
  r.decidedBy = actor.id;
  r.decidedAt = books.clock();
  r.decisionNote = note?.trim() || undefined;
  const e = employee(books.state, r.employeeId);
  books.audit(actor, { action: decision === 'approved' ? 'approve_rate' : 'reject_rate', objectType: 'people', objectId: r.id, summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} rate change for ${e?.name}: ${fmt$(r.fromCents)} → ${fmt$(r.toCents)}`, before, after: structuredClone(r), reason: r.decisionNote });
  books.changed();
  return r;
}

// ── Gusto import ─────────────────────────────────────────────────────────
export interface GustoRow {
  row: number;
  payDate: string | null;
  name: string;
  gustoId?: string;
  store: string;
  department?: string;
  hours: number;
  otHours: number;
  gross: number;
  employeeTaxes: number;
  employerTaxes: number;
  net: number;
  stateTaxes: number;
  check: boolean;
  checkNo?: string;
}

export interface ParsedGusto {
  rows: GustoRow[];
  /** The report's own totals row, when it has one. */
  totals?: Partial<PayrollTotals>;
  periodStart?: string;
  periodEnd?: string;
  problems: string[];
}

const GCOL: Record<string, RegExp> = {
  payDate: /^(pay|check|payment) date$/i,
  periodStart: /^(pay )?period (start|begin)/i,
  periodEnd: /^(pay )?period end/i,
  name: /^(employee|employee name|name)$/i,
  gustoId: /^(employee id|gusto id|id)$/i,
  store: /^(location|store|work location)$/i,
  department: /^department$/i,
  hours: /^(regular hours|reg\.? hours|hours)$/i,
  ot: /^(overtime hours|ot hours|overtime)$/i,
  gross: /^(gross pay|gross earnings|gross)$/i,
  ee: /^employee taxes$/i,
  er: /^employer taxes$/i,
  net: /^net pay$/i,
  state: /^state taxes$/i,
  method: /^(payment method|payment type|paid by)$/i,
  checkNo: /^check ?(#|no\.?|number)$/i,
  debit: /^(total )?company debit$/i,
};

/**
 * Read a Gusto payroll report saved as CSV: one row per employee, plus an optional "Total" row.
 * Needed columns: Pay date, Employee, Location, Gross pay, Employee taxes, Employer taxes, Net pay.
 */
export function parseGustoCsv(text: string): ParsedGusto {
  const rows = splitCsv(text);
  const problems: string[] = [];
  const hi = rows.findIndex((r) => r.some((c) => GCOL.gross.test(c.trim())) && r.some((c) => GCOL.net.test(c.trim())));
  if (hi < 0) return { rows: [], problems: ['No header row found. The report needs Employee, Location, Gross pay, Employee taxes, Employer taxes and Net pay columns.'] };
  const header = rows[hi].map((c) => c.trim());
  const ix = (k: string) => header.findIndex((h) => GCOL[k].test(h));
  const ci = Object.fromEntries(Object.keys(GCOL).map((k) => [k, ix(k)])) as Record<keyof typeof GCOL, number>;
  for (const k of ['name', 'store', 'ee', 'er'] as const) if (ci[k] < 0) problems.push(`The report has no ${({ name: 'Employee', store: 'Location', ee: 'Employee taxes', er: 'Employer taxes' })[k]} column.`);
  if (problems.length) return { rows: [], problems };
  const cell = (r: string[], k: keyof typeof GCOL) => (ci[k] >= 0 ? (r[ci[k]] ?? '').trim() : '');
  const money = (r: string[], k: keyof typeof GCOL) => { const v = cell(r, k); return v ? parseMoney(v) : 0; };
  const num = (s: string) => (s ? Number(s.replace(/,/g, '')) : 0);
  const out: GustoRow[] = [];
  let totals: Partial<PayrollTotals> | undefined;
  let periodStart: string | undefined;
  let periodEnd: string | undefined;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = cell(r, 'name');
    const first = (r[0] ?? '').trim();
    if (/^totals?$/i.test(name) || /^totals?$/i.test(first)) {
      totals = { gross: money(r, 'gross') ?? undefined, employeeTaxes: money(r, 'ee') ?? undefined, employerTaxes: money(r, 'er') ?? undefined, net: money(r, 'net') ?? undefined };
      if (ci.debit >= 0 && cell(r, 'debit')) totals.companyDebit = money(r, 'debit') ?? undefined;
      continue;
    }
    if (!name) continue;
    const vals = { gross: money(r, 'gross'), ee: money(r, 'ee'), er: money(r, 'er'), net: money(r, 'net'), st: money(r, 'state') };
    if (Object.values(vals).some((v) => v === null)) { problems.push(`Row ${i + 1} (${name}): an amount isn't a number; skipped.`); continue; }
    const hours = num(cell(r, 'hours'));
    const ot = num(cell(r, 'ot'));
    if (Number.isNaN(hours) || Number.isNaN(ot)) { problems.push(`Row ${i + 1} (${name}): hours aren't a number; skipped.`); continue; }
    periodStart ??= parseDate(cell(r, 'periodStart')) ?? undefined;
    periodEnd ??= parseDate(cell(r, 'periodEnd')) ?? undefined;
    const method = cell(r, 'method');
    out.push({
      row: i + 1, payDate: parseDate(cell(r, 'payDate')), name, gustoId: cell(r, 'gustoId') || undefined, store: cell(r, 'store'), department: cell(r, 'department') || undefined,
      hours: round2(hours), otHours: round2(ot), gross: vals.gross!, employeeTaxes: vals.ee!, employerTaxes: vals.er!, net: vals.net!, stateTaxes: vals.st!,
      check: /check/i.test(method), checkNo: cell(r, 'checkNo') || undefined,
    });
  }
  if (!out.length && !problems.length) problems.push('No employee rows found under the header.');
  return { rows: out, totals, periodStart, periodEnd, problems };
}

export function totalsOf(lines: Pick<PayrollLine, 'gross' | 'employeeTaxes' | 'employerTaxes' | 'net' | 'check'>[]): PayrollTotals {
  const t: PayrollTotals = { gross: 0, employeeTaxes: 0, employerTaxes: 0, net: 0, companyDebit: 0, checkPaid: 0 };
  for (const l of lines) {
    t.gross += l.gross; t.employeeTaxes += l.employeeTaxes; t.employerTaxes += l.employerTaxes; t.net += l.net;
    if (l.check) t.checkPaid += l.net;
  }
  t.companyDebit = t.net - t.checkPaid + t.employeeTaxes + t.employerTaxes;
  return t;
}

export function lineHashes(payDate: string, rows: { gustoId?: string; name: string; gross: number; net: number }[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `gusto|${payDate}|${(r.gustoId ?? r.name).toUpperCase().replace(/[^A-Z0-9]/g, '')}|${r.gross}|${r.net}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}

function matchStore(state: BooksState, s: string): ID | null {
  const t = s.trim().toUpperCase();
  if (!t) return null;
  const st = state.stores.find((x) => !x.deleted && x.kind !== 'leased_out' && (x.code.toUpperCase() === t || x.name.toUpperCase() === t || t.startsWith(x.code.toUpperCase() + ' ') || t.includes(`(${x.code.toUpperCase()})`)));
  return st?.id ?? null;
}
function matchDept(s: string | undefined, fallback: Department): Department {
  if (!s) return fallback;
  if (/kitchen|cook|food/i.test(s)) return 'kitchen';
  if (/office|admin|corporate/i.test(s)) return 'office';
  if (/truck|diesel/i.test(s)) return 'truck_lane';
  if (/front|cashier|store|register/i.test(s)) return 'front';
  return fallback;
}
function matchEmployee(state: BooksState, r: { gustoId?: string; name: string }): Employee | undefined {
  const emps = peopleOf(state).employees;
  return (r.gustoId ? emps.find((e) => e.gustoId === r.gustoId) : undefined) ?? emps.find((e) => e.name.toLowerCase() === r.name.toLowerCase());
}

export interface RunPreviewRow extends GustoRow {
  hash: string;
  duplicate: boolean;
  storeId: ID | null;
  employeeId: ID | null;
  /** Gross = net pay + employee taxes. */
  rowTies: boolean;
}

export interface RunPreview {
  payDate: string | null;
  rows: RunPreviewRow[];
  added: number;
  skipped: number;
  /** Totals of the new rows. */
  totals: PayrollTotals;
  /** Totals of every employee row in the file, compared with the report's totals row. */
  fileTotals: PayrollTotals;
  checks: { label: string; ok: boolean; detail?: string }[];
  newEmployees: string[];
  /** Blocking problems: the run can't be imported until they are fixed. */
  errors: string[];
}

/** What importing this report would do, with every total tied to the report's own totals. */
export function previewRun(state: BooksState, parsed: ParsedGusto): RunPreview {
  const errors: string[] = [];
  const dates = [...new Set(parsed.rows.map((r) => r.payDate))];
  if (dates.includes(null)) errors.push('Every row needs a pay date. Export the report with the Pay date column.');
  const real = dates.filter((d): d is string => !!d).sort();
  if (real.length > 1) errors.push(`The report has more than one pay date (${real.join(', ')}). Import one payroll run at a time.`);
  const payDate = real[0] ?? null;
  const hashes = lineHashes(payDate ?? '', parsed.rows);
  const existing = new Set(peopleOf(state).runs.flatMap((r) => r.lines.map((l) => l.hash)));
  const rows: RunPreviewRow[] = parsed.rows.map((r, i) => {
    const storeId = matchStore(state, r.store);
    if (!storeId) errors.push(`Row ${r.row} (${r.name}): "${r.store || 'blank'}" isn't a store. Use the store code (e.g. HM13) in the Location column, or add the store in Setup.`);
    const rowTies = r.gross === r.net + r.employeeTaxes;
    if (!rowTies) errors.push(`Row ${r.row} (${r.name}): gross ${fmt$(r.gross)} isn't net ${fmt$(r.net)} + employee taxes ${fmt$(r.employeeTaxes)}. Re-export the report; deductions are not supported yet.`);
    if (r.stateTaxes > r.employeeTaxes + r.employerTaxes) errors.push(`Row ${r.row} (${r.name}): state taxes are more than all taxes on the line.`);
    return { ...r, hash: hashes[i], duplicate: existing.has(hashes[i]), storeId, employeeId: matchEmployee(state, r)?.id ?? null, rowTies };
  });
  const fresh = rows.filter((r) => !r.duplicate);
  const asLine = (r: RunPreviewRow) => ({ gross: r.gross, employeeTaxes: r.employeeTaxes, employerTaxes: r.employerTaxes, net: r.net, check: r.check ? {} : undefined });
  const totals = totalsOf(fresh.map(asLine));
  const fileTotals = totalsOf(rows.map(asLine));
  const checks: RunPreview['checks'] = [];
  const t = parsed.totals;
  if (t) {
    for (const [k, label] of [['gross', 'Gross'], ['employeeTaxes', 'Employee taxes'], ['employerTaxes', 'Employer taxes'], ['net', 'Net pay'], ['companyDebit', 'Total company debit']] as const) {
      const v = t[k];
      if (v === undefined) continue;
      const ok = v === fileTotals[k];
      checks.push({ label: `${label} ties to the report total`, ok, detail: ok ? fmt$(v) : `lines add to ${fmt$(fileTotals[k])}, report says ${fmt$(v)}` });
      if (!ok) errors.push(`${label}: the employee lines add to ${fmt$(fileTotals[k])} but the report's total row says ${fmt$(v)}. Check for missing or extra rows.`);
    }
  } else checks.push({ label: 'No totals row in the report', ok: false, detail: 'add the Total row so the import can tie to it' });
  checks.push({ label: 'Gross = net + employee taxes on every line', ok: rows.every((r) => r.rowTies) });
  if (rows.length && !fresh.length) checks.push({ label: 'Already imported', ok: true, detail: 'every line is in an earlier run; nothing to add' });
  const newEmployees = [...new Set(fresh.filter((r) => !r.employeeId).map((r) => r.name))];
  return { payDate, rows, added: fresh.length, skipped: rows.length - fresh.length, totals, fileTotals, checks, newEmployees, errors: [...new Set(errors)] };
}

/**
 * Store a Gusto run (idempotent: lines already imported are skipped). Unknown employees are added
 * and land in the new-hire queue. Nothing posts until the run is reviewed and posted.
 */
export function commitRun(books: Books, actor: User, fileName: string, parsed: ParsedGusto): PayrollRun {
  books.require(actor, 'payroll.edit', 'import payroll runs');
  const p = ensure(books);
  const pv = previewRun(books.state, parsed);
  if (pv.errors.length) throw new ValidationError(pv.errors);
  if (!pv.added) throw new ValidationError(['Every line in this report is already imported. Nothing to add.']);
  const batchId = books.nextId('gst');
  const lines: PayrollLine[] = [];
  for (const r of pv.rows) {
    if (r.duplicate) continue;
    let emp = r.employeeId ? p.employees.find((e) => e.id === r.employeeId) : undefined;
    if (!emp) {
      const paid = r.hours + 1.5 * r.otHours;
      emp = { id: books.nextId('emp'), name: r.name, storeId: r.storeId!, department: matchDept(r.department, 'front'), payType: paid > 0 ? 'hourly' : 'salary', rateCents: paid > 0 ? Math.round(r.gross / paid) : r.gross, status: 'active', hiredOn: parsed.periodStart ?? pv.payDate!, gustoId: r.gustoId, paidBy: 'gusto', notes: `Added from Gusto import ${fileName}` };
      p.employees.push(emp);
      books.audit(actor, { action: 'create', objectType: 'people', objectId: emp.id, summary: `Added employee ${emp.name} from Gusto import`, after: structuredClone(emp) });
    }
    lines.push({ id: books.nextId('pl'), employeeId: emp.id, storeId: r.storeId!, department: matchDept(r.department, emp.department), hours: r.hours, otHours: r.otHours, gross: r.gross, employeeTaxes: r.employeeTaxes, employerTaxes: r.employerTaxes, net: r.net, stateTaxes: r.stateTaxes, check: r.check ? { checkNo: r.checkNo } : undefined, hash: r.hash, batchId });
  }
  const full = pv.skipped === 0 && parsed.totals;
  const sum = totalsOf(lines);
  const run: PayrollRun = {
    id: books.nextId('run'), payDate: pv.payDate!, periodStart: parsed.periodStart, periodEnd: parsed.periodEnd, fileName, batchId, importedAt: books.clock(), importedBy: actor.id, lines,
    reported: full ? { ...sum, ...Object.fromEntries(Object.entries(parsed.totals!).filter(([, v]) => v !== undefined)) } : sum, status: 'imported', txnIds: [],
  };
  p.runs.push(run);
  books.audit(actor, { action: 'import', objectType: 'people', objectId: run.id, summary: `Imported Gusto run ${run.payDate}: ${lines.length} lines, company debit ${fmt$(sum.companyDebit)} (batch ${batchId})${pv.skipped ? `, ${pv.skipped} already imported` : ''}` });
  books.changed();
  return run;
}

export function runStores(run: PayrollRun): ID[] {
  return [...new Set(run.lines.map((l) => l.storeId))];
}

/** Does the run's employee detail add up to the report's totals? */
export function runTies(run: PayrollRun): { label: string; ok: boolean; detail?: string }[] {
  const s = totalsOf(run.lines);
  return (['gross', 'employeeTaxes', 'employerTaxes', 'net', 'companyDebit'] as const).map((k) => ({
    label: { gross: 'Gross', employeeTaxes: 'Employee taxes', employerTaxes: 'Employer taxes', net: 'Net pay', companyDebit: 'Company debit' }[k],
    ok: s[k] === run.reported[k],
    detail: s[k] === run.reported[k] ? fmt$(s[k]) : `lines ${fmt$(s[k])} vs report ${fmt$(run.reported[k])}`,
  }));
}

export interface PostingCheck {
  wages: number;
  taxes: number;
  gustoDebit: number;
  checks: number;
  ok: boolean;
  problems: string[];
}

/** Compare what the ledger carries for a posted run with the run: net pay, taxes, Gusto debit and checks. */
export function postingCheck(state: BooksState, run: PayrollRun): PostingCheck {
  const ids = new Set(run.txnIds);
  let wages = 0, taxes = 0, gustoDebit = 0, checks = 0;
  for (const t of state.transactions) {
    if (!ids.has(t.id) || t.deleted) continue;
    for (const l of t.lines) {
      if (l.accountId === ACCT.wages) wages += l.debit - l.credit;
      if (l.accountId === ACCT.taxes) taxes += l.debit - l.credit;
      if (l.accountId === ACCT.bank) { if (t.checkNo || t.tags.includes('check')) checks += l.credit - l.debit; else gustoDebit += l.credit - l.debit; }
    }
  }
  const tot = totalsOf(run.lines);
  const problems: string[] = [];
  if (run.status === 'posted') {
    if (wages !== tot.net) problems.push(`Net pay in the books ${fmt$(wages)} vs run ${fmt$(tot.net)}`);
    if (taxes !== tot.employeeTaxes + tot.employerTaxes) problems.push(`Payroll taxes in the books ${fmt$(taxes)} vs run ${fmt$(tot.employeeTaxes + tot.employerTaxes)}`);
    if (gustoDebit !== tot.companyDebit) problems.push(`Gusto debit in the books ${fmt$(gustoDebit)} vs company debit ${fmt$(tot.companyDebit)}`);
    if (checks !== tot.checkPaid) problems.push(`Paper checks in the books ${fmt$(checks)} vs run ${fmt$(tot.checkPaid)}`);
  }
  return { wages, taxes, gustoDebit, checks, ok: run.status === 'posted' && problems.length === 0, problems };
}

/**
 * Post a run (SPEC §6.7): net pay to 6100 and employee + employer taxes to 6110, by store, on the pay date.
 * One Gusto debit per store credits Trustmark (CORP) for direct-deposit net + taxes; each paper check posts on its own.
 */
export function postRun(books: Books, actor: User, runId: ID): Transaction[] {
  books.require(actor, 'payroll.edit', 'post payroll');
  const run = ensure(books).runs.find((r) => r.id === runId);
  if (!run) throw new ValidationError(['That payroll run no longer exists.']);
  if (run.status === 'posted') throw new ValidationError(['This run is already posted.']);
  const bad = runTies(run).filter((x) => !x.ok);
  if (bad.length) throw new ValidationError([`The run doesn't tie to the Gusto report (${bad.map((b) => `${b.label}: ${b.detail}`).join('; ')}). Re-import the report.`]);
  if (books.isLocked(periodOf(run.payDate))) throw new ValidationError([`${periodOf(run.payDate)} is locked. Unlock it from Close › Periods (with a reason) before posting this run.`]);
  const corp = bankStoreId(books.state);
  const txns: Transaction[] = [];
  for (const storeId of runStores(run)) {
    const ls = run.lines.filter((l) => l.storeId === storeId);
    const dd = ls.filter((l) => !l.check).reduce((a, l) => a + l.net, 0);
    const tax = ls.reduce((a, l) => a + l.employeeTaxes + l.employerTaxes, 0);
    const lines: DraftLine[] = [];
    if (dd) lines.push({ accountId: ACCT.wages, storeId, debit: dd, credit: 0, memo: 'Net pay (direct deposit)' });
    if (tax) lines.push({ accountId: ACCT.taxes, storeId, debit: tax, credit: 0, memo: 'Employee + employer taxes' });
    if (dd + tax) {
      lines.push({ accountId: ACCT.bank, storeId: corp, debit: 0, credit: dd + tax, memo: 'Gusto company debit' });
      txns.push(books.createTransaction(actor, { date: run.payDate, kind: 'money_out', description: `GUSTO PAYROLL ${code(books.state, storeId)}`, partyId: 'pt_gusto', memo: `Gusto run ${run.payDate} (${run.fileName})`, tags: ['payroll', 'gusto'], lines }, { source: 'import', batchId: run.batchId }));
    }
    for (const l of ls.filter((x) => x.check)) {
      const e = employee(books.state, l.employeeId);
      txns.push(books.createTransaction(actor, { date: run.payDate, kind: 'money_out', description: `PAYROLL CHECK ${e?.name ?? ''}`.trim(), checkNo: l.check?.checkNo, partyId: 'pt_gusto', memo: `Paper check on Gusto run ${run.payDate}`, tags: ['payroll', 'check'], lines: [
        { accountId: ACCT.wages, storeId, debit: l.net, credit: 0, memo: 'Net pay (paper check)' }, { accountId: ACCT.bank, storeId: corp, debit: 0, credit: l.net },
      ] }, { source: 'import', batchId: run.batchId }));
    }
  }
  run.txnIds = txns.map((t) => t.id);
  run.status = 'posted';
  run.postedBy = actor.id;
  run.postedAt = books.clock();
  books.audit(actor, { action: 'post', objectType: 'people', objectId: run.id, summary: `Posted Gusto run ${run.payDate}: ${txns.map((t) => t.ref).join(', ')}` });
  books.changed();
  return txns;
}

export interface RateFlag { line: PayrollLine; employee: Employee; paidRate: number; approvedRate: number; pending?: RateChange }

/** Hourly lines whose paid rate (gross ÷ paid hours) differs from the approved rate on the pay date. */
export function rateFlags(state: BooksState, run: PayrollRun): RateFlag[] {
  const out: RateFlag[] = [];
  for (const l of run.lines) {
    const e = employee(state, l.employeeId);
    const paidHours = l.hours + 1.5 * l.otHours;
    if (!e || e.payType !== 'hourly' || paidHours <= 0) continue;
    const paidRate = Math.round(l.gross / paidHours);
    const approvedRate = currentRate(state, e, run.payDate);
    if (Math.abs(paidRate - approvedRate) > Math.max(5, approvedRate * 0.005)) {
      const pending = peopleOf(state).rateChanges.find((r) => r.employeeId === e.id && r.status === 'pending');
      out.push({ line: l, employee: e, paidRate, approvedRate, pending });
    }
  }
  return out;
}

// ── Cash and check pay outside Gusto ─────────────────────────────────────
export interface OffPayrollInput {
  employeeId: ID;
  payDate: string;
  method: 'cash' | 'check';
  amount: number;
  hours?: number;
  note?: string;
  /** Part of an existing cash-chain payroll payout: nothing new posts. */
  payoutId?: ID;
  /** For new cash: which cash it came from (a store's registers or the HQ pool). */
  fromStoreId?: ID;
  checkNo?: string;
  person?: string;
}

/** Payroll payouts recorded in the cash chain, with how much is already assigned to employees. */
export function payoutAllocations(state: BooksState): { payout: CashPayout; storeId: ID; allocated: number; entries: OffPayrollPay[] }[] {
  const entries = peopleOf(state).offPayroll;
  return state.cash.payouts.filter((p) => p.kind === 'payroll').map((p) => {
    const t = state.transactions.find((x) => x.id === p.txnId);
    const storeId = t?.lines.find((l) => l.accountId === ACCT.wages)?.storeId ?? p.fromStoreId;
    const mine = entries.filter((e) => e.payoutId === p.id);
    return { payout: p, storeId, allocated: mine.reduce((a, e) => a + e.amount, 0), entries: mine };
  });
}

/**
 * Record cash or check pay outside Gusto for one employee and week. Link it to a cash-chain payout
 * that already carries it (no double posting), or post it: cash as a payout, a check as money out.
 */
export function recordOffPayroll(books: Books, actor: User, input: OffPayrollInput): OffPayrollPay {
  books.require(actor, 'payroll.edit', 'record cash and check pay');
  const p = ensure(books);
  const e = p.employees.find((x) => x.id === input.employeeId);
  const errs: string[] = [];
  if (!e) errs.push('Choose the employee.');
  if (!isValidDate(input.payDate)) errs.push('Enter the pay date as YYYY-MM-DD.');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) errs.push('Enter the amount paid.');
  if (input.hours !== undefined && (!(input.hours >= 0) || input.hours > 120)) errs.push('Hours should be between 0 and 120 for one week.');
  const payDate = isValidDate(input.payDate) ? payWeek(input.payDate) : input.payDate;
  if (input.payoutId) {
    const a = payoutAllocations(books.state).find((x) => x.payout.id === input.payoutId);
    if (!a) errs.push('That cash payout no longer exists.');
    else {
      if (input.method !== 'cash') errs.push('A cash payout can only carry cash pay.');
      if (payWeek(a.payout.date) !== payDate) errs.push(`That payout was on ${a.payout.date}, a different pay week.`);
      if (Number.isSafeInteger(input.amount) && a.allocated + input.amount > a.payout.amount) errs.push(`Only ${fmt$(a.payout.amount - a.allocated)} of that payout is left to assign.`);
    }
  }
  if (errs.length) throw new ValidationError(errs);
  let txnId: ID | undefined;
  let payoutId = input.payoutId;
  if (!payoutId) {
    if (input.method === 'cash') {
      const from = input.fromStoreId ?? bankStoreId(books.state);
      const po = recordPayout(books, actor, { date: input.payDate, fromStoreId: from, kind: 'payroll', payee: e!.name, amount: input.amount, person: input.person?.trim() || actor.name, accountId: ACCT.wages, storeId: e!.storeId });
      payoutId = po.id;
    } else {
      const t = books.createTransaction(actor, { date: input.payDate, kind: 'money_out', description: `PAYROLL CHECK ${e!.name}`, checkNo: input.checkNo, tags: ['payroll', 'check'], memo: input.note, lines: [
        { accountId: ACCT.wages, storeId: e!.storeId, debit: input.amount, credit: 0, memo: 'Pay outside Gusto (check)' },
        { accountId: ACCT.bank, storeId: bankStoreId(books.state), debit: 0, credit: input.amount },
      ] });
      txnId = t.id;
    }
  }
  const rec: OffPayrollPay = { id: books.nextId('op'), employeeId: e!.id, payDate, method: input.method, amount: input.amount, hours: input.hours, note: input.note?.trim() || undefined, payoutId, txnId, checkNo: input.checkNo?.trim() || undefined, by: actor.id, at: books.clock() };
  p.offPayroll.push(rec);
  books.audit(actor, { action: 'off_payroll', objectType: 'people', objectId: rec.id, summary: `${input.method === 'cash' ? 'Cash' : 'Check'} pay ${fmt$(input.amount)} to ${e!.name} for week of ${payDate}${input.payoutId ? ' (part of an existing cash payout)' : ''}`, after: rec });
  books.changed();
  return rec;
}

/** Confirm cash/check pay is extra on top of Gusto that week, not the same pay twice. */
export function confirmExtraPay(books: Books, actor: User, employeeId: ID, payDate: string, note: string): void {
  books.require(actor, 'payroll.edit', 'confirm extra pay');
  if (!note.trim()) throw new ValidationError(['Say what the extra pay was for (e.g. "covered two extra shifts, cash").']);
  const recs = ensure(books).offPayroll.filter((o) => o.employeeId === employeeId && o.payDate === payWeek(payDate));
  if (!recs.length) throw new ValidationError(['There is no cash or check pay for that employee and week.']);
  for (const r of recs) r.confirmed = { by: actor.id, at: books.clock(), note: note.trim() };
  books.audit(actor, { action: 'confirm_extra', objectType: 'people', objectId: employeeId, summary: `Confirmed extra pay for ${employee(books.state, employeeId)?.name}, week of ${payWeek(payDate)}`, reason: note.trim() });
  books.changed();
}

export interface EmpWeek {
  employeeId: ID;
  storeId: ID;
  gross: number;
  net: number;
  employeeTaxes: number;
  employerTaxes: number;
  hours: number;
  otHours: number;
  cash: number;
  check: number;
  offHours: number;
  /** Gusto runs this employee is on this week. */
  runIds: ID[];
  offIds: ID[];
}

/** Every employee's pay for each pay week: Gusto lines plus cash/check pay, kept side by side. */
export function weekIndex(state: BooksState): Map<string, Map<ID, EmpWeek>> {
  const idx = new Map<string, Map<ID, EmpWeek>>();
  const get = (week: string, employeeId: ID, storeId: ID) => {
    let m = idx.get(week);
    if (!m) idx.set(week, (m = new Map()));
    let w = m.get(employeeId);
    if (!w) m.set(employeeId, (w = { employeeId, storeId, gross: 0, net: 0, employeeTaxes: 0, employerTaxes: 0, hours: 0, otHours: 0, cash: 0, check: 0, offHours: 0, runIds: [], offIds: [] }));
    return w;
  };
  const p = peopleOf(state);
  for (const r of p.runs) {
    const wk = payWeek(r.payDate);
    for (const l of r.lines) {
      const w = get(wk, l.employeeId, l.storeId);
      w.gross += l.gross; w.net += l.net; w.employeeTaxes += l.employeeTaxes; w.employerTaxes += l.employerTaxes;
      w.hours = round2(w.hours + l.hours); w.otHours = round2(w.otHours + l.otHours);
      if (!w.runIds.includes(r.id)) w.runIds.push(r.id);
    }
  }
  for (const o of p.offPayroll) {
    const e = employee(state, o.employeeId);
    const w = get(o.payDate, o.employeeId, e?.storeId ?? '');
    if (o.method === 'cash') w.cash += o.amount; else w.check += o.amount;
    w.offHours = round2(w.offHours + (o.hours ?? 0));
    w.offIds.push(o.id);
  }
  return idx;
}

export const empPay = (w: EmpWeek) => w.gross + w.cash + w.check;
/** What the week cost the company: gross + employer taxes + cash/check pay (= net + all taxes + cash/check). */
export const empCost = (w: EmpWeek) => w.gross + w.employerTaxes + w.cash + w.check;
export const empHours = (w: EmpWeek) => round2(w.hours + w.otHours + w.offHours);

export type CompareStatus = 'gusto' | 'off' | 'both' | 'both_confirmed';
export interface CompareRow { employeeId: ID; storeId: ID; payDate: string; gustoNet: number; gustoHours: number; cash: number; check: number; offHours: number; status: CompareStatus; note?: string }

/**
 * Gusto vs cash/check pay by employee and week, shown side by side. When someone is paid both ways
 * in a week it is never assumed to be a duplicate: it waits for a person to confirm.
 */
export function compareByEmployeeWeek(state: BooksState, opts: { from?: string; to?: string; visible?: Set<ID>; onlyOff?: boolean } = {}): CompareRow[] {
  const out: CompareRow[] = [];
  const offs = peopleOf(state).offPayroll;
  for (const [wk, m] of weekIndex(state)) {
    if ((opts.from && wk < opts.from) || (opts.to && wk > opts.to)) continue;
    for (const w of m.values()) {
      const e = employee(state, w.employeeId);
      const storeId = e?.storeId ?? w.storeId;
      if (opts.visible && !opts.visible.has(storeId)) continue;
      const hasG = w.runIds.length > 0;
      const hasO = w.offIds.length > 0;
      if (opts.onlyOff && !hasO) continue;
      const mine = offs.filter((o) => w.offIds.includes(o.id));
      const confirmed = mine.length > 0 && mine.every((o) => o.confirmed);
      out.push({ employeeId: w.employeeId, storeId, payDate: wk, gustoNet: w.net, gustoHours: round2(w.hours + w.otHours), cash: w.cash, check: w.check, offHours: w.offHours,
        status: hasG && hasO ? (confirmed ? 'both_confirmed' : 'both') : hasG ? 'gusto' : 'off', note: mine.find((o) => o.confirmed)?.confirmed?.note });
    }
  }
  return out.sort((a, b) => b.payDate.localeCompare(a.payDate) || a.storeId.localeCompare(b.storeId) || (employee(state, a.employeeId)?.name ?? '').localeCompare(employee(state, b.employeeId)?.name ?? ''));
}

// ── Weekly review ────────────────────────────────────────────────────────
/** Pay weeks that have any payroll: Gusto runs, cash/check pay or payroll payouts. Newest first. */
export function payWeeks(state: BooksState): string[] {
  const s = new Set<string>();
  for (const r of peopleOf(state).runs) s.add(payWeek(r.payDate));
  for (const o of peopleOf(state).offPayroll) s.add(o.payDate);
  for (const p of state.cash.payouts) if (p.kind === 'payroll') s.add(payWeek(p.date));
  return [...s].sort().reverse();
}

export interface StoreWeek {
  storeId: ID;
  cost: number;
  gross: number;
  employerTaxes: number;
  cash: number;
  check: number;
  /** Payroll payouts not yet assigned to employees. */
  unassigned: number;
  hours: number;
  otHours: number;
  headcount: number;
}

export function storeWeeks(state: BooksState, week: string, idx = weekIndex(state)): Map<ID, StoreWeek> {
  const out = new Map<ID, StoreWeek>();
  const get = (storeId: ID) => {
    let r = out.get(storeId);
    if (!r) out.set(storeId, (r = { storeId, cost: 0, gross: 0, employerTaxes: 0, cash: 0, check: 0, unassigned: 0, hours: 0, otHours: 0, headcount: 0 }));
    return r;
  };
  for (const w of idx.get(week)?.values() ?? []) {
    const r = get(w.storeId);
    r.cost += empCost(w); r.gross += w.gross; r.employerTaxes += w.employerTaxes; r.cash += w.cash; r.check += w.check;
    r.hours = round2(r.hours + empHours(w)); r.otHours = round2(r.otHours + w.otHours); r.headcount += 1;
  }
  for (const a of payoutAllocations(state)) {
    if (payWeek(a.payout.date) !== week || a.allocated >= a.payout.amount) continue;
    const r = get(a.storeId);
    r.unassigned += a.payout.amount - a.allocated;
    r.cost += a.payout.amount - a.allocated;
  }
  return out;
}

export interface Change { now: number; prev: number; pct: number | null; flagged: boolean; status: 'ok' | 'flag' | 'missing' | 'new' | 'none' }
export function change(now: number, prev: number): Change {
  if (!now && !prev) return { now, prev, pct: null, flagged: false, status: 'none' };
  if (!prev) return { now, prev, pct: null, flagged: false, status: 'new' };
  if (!now) return { now, prev, pct: null, flagged: false, status: 'missing' };
  const pct = (now - prev) / prev;
  const flagged = Math.abs(pct) > WOW_THRESHOLD;
  return { now, prev, pct, flagged, status: flagged ? 'flag' : 'ok' };
}

export type EmpFlag = 'new_hire' | 'terminated' | 'rate_change' | 'rate_mismatch' | 'overtime' | 'wow' | 'paid_after_termination' | 'both';
export const EMP_FLAG_LABEL: Record<EmpFlag, string> = {
  new_hire: 'New hire', terminated: 'Terminated', rate_change: 'Rate change', rate_mismatch: 'Paid rate ≠ approved', overtime: 'Overtime', wow: 'Over 15% change', paid_after_termination: 'Paid after termination', both: 'Gusto + cash/check',
};

export interface EmpReviewRow { employeeId: ID; storeId: ID; now?: EmpWeek; prev?: EmpWeek; pay: Change; hours: Change; flags: EmpFlag[] }
export interface StoreReviewRow { storeId: ID; now?: StoreWeek; prev?: StoreWeek; cost: Change; hours: Change; newHires: Employee[]; terminations: Employee[]; rateChanges: RateChange[] }

export interface WeeklyReview {
  week: string;
  prevWeek: string;
  stores: StoreReviewRow[];
  employees: EmpReviewRow[];
  total: { cost: Change; hours: Change; headcount: Change; otHours: number };
  runs: PayrollRun[];
  toPost: PayrollRun[];
  rateFlags: RateFlag[];
  pending: RateChange[];
}

/** This week vs last, by store and by employee: pay, hours, headcount, hires, terminations, rate changes, overtime. */
export function weeklyReview(state: BooksState, week: string, visible?: Set<ID>): WeeklyReview {
  const wk = payWeek(week);
  const prevWeek = addDays(wk, -7);
  const from = addDays(wk, -6);
  const idx = weekIndex(state);
  const sNow = storeWeeks(state, wk, idx);
  const sPrev = storeWeeks(state, prevWeek, idx);
  const vis = (id: ID) => !visible || visible.has(id);
  const p = peopleOf(state);
  const inWeek = (d?: string) => !!d && d >= from && d <= wk;
  // A rate change belongs to the week it takes effect; one still waiting for approval stays in play every week after.
  const rateInPlay = (r: RateChange) => r.status !== 'rejected' && (inWeek(r.effective) || (r.status === 'pending' && r.effective <= wk));
  const runs = p.runs.filter((r) => payWeek(r.payDate) === wk && runStores(r).some(vis));
  const flags = runs.flatMap((r) => rateFlags(state, r));
  const storeIds = [...new Set([...sNow.keys(), ...sPrev.keys()])].filter(vis);
  const order = new Map(state.stores.map((s, i) => [s.id, i]));
  storeIds.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const stores: StoreReviewRow[] = storeIds.map((storeId) => {
    const now = sNow.get(storeId);
    const prev = sPrev.get(storeId);
    return {
      storeId, now, prev, cost: change(now?.cost ?? 0, prev?.cost ?? 0), hours: change(now?.hours ?? 0, prev?.hours ?? 0),
      newHires: p.employees.filter((e) => e.storeId === storeId && inWeek(e.hiredOn)),
      terminations: p.employees.filter((e) => e.storeId === storeId && inWeek(e.terminatedOn)),
      rateChanges: p.rateChanges.filter((r) => employee(state, r.employeeId)?.storeId === storeId && rateInPlay(r)),
    };
  });
  const empIds = [...new Set([...(idx.get(wk)?.keys() ?? []), ...(idx.get(prevWeek)?.keys() ?? [])])];
  const employees: EmpReviewRow[] = [];
  for (const id of empIds) {
    const e = employee(state, id);
    const now = idx.get(wk)?.get(id);
    const prev = idx.get(prevWeek)?.get(id);
    const storeId = now?.storeId ?? prev?.storeId ?? e?.storeId ?? '';
    if (!vis(storeId)) continue;
    const pay = change(now ? empPay(now) : 0, prev ? empPay(prev) : 0);
    const hours = change(now ? empHours(now) : 0, prev ? empHours(prev) : 0);
    const f: EmpFlag[] = [];
    if (e && inWeek(e.hiredOn)) f.push('new_hire');
    if (e && inWeek(e.terminatedOn)) f.push('terminated');
    if (p.rateChanges.some((r) => r.employeeId === id && rateInPlay(r))) f.push('rate_change');
    if (flags.some((x) => x.employee.id === id)) f.push('rate_mismatch');
    if ((now?.otHours ?? 0) > 0) f.push('overtime');
    if (pay.flagged) f.push('wow');
    if (e?.terminatedOn && now && addDays(e.terminatedOn, 14) < wk) f.push('paid_after_termination');
    if (now && now.runIds.length && now.offIds.length) f.push('both');
    employees.push({ employeeId: id, storeId, now, prev, pay, hours, flags: f });
  }
  employees.sort((a, b) => (order.get(a.storeId) ?? 0) - (order.get(b.storeId) ?? 0) || (employee(state, a.employeeId)?.name ?? '').localeCompare(employee(state, b.employeeId)?.name ?? ''));
  const sum = (m: Map<ID, StoreWeek>, k: 'cost' | 'hours' | 'headcount' | 'otHours') => [...m.values()].filter((r) => vis(r.storeId)).reduce((a, r) => a + r[k], 0);
  return {
    week: wk, prevWeek, stores, employees,
    total: { cost: change(sum(sNow, 'cost'), sum(sPrev, 'cost')), hours: change(round2(sum(sNow, 'hours')), round2(sum(sPrev, 'hours'))), headcount: change(sum(sNow, 'headcount'), sum(sPrev, 'headcount')), otHours: round2(sum(sNow, 'otHours')) },
    runs, toPost: runs.filter((r) => r.status === 'imported'), rateFlags: flags,
    pending: pendingRateChanges(state, visible).filter((r) => storeIds.includes(employee(state, r.employeeId)?.storeId ?? '') || !visible),
  };
}

/** Post every imported run in the week. Returns the entries created. */
export function postWeek(books: Books, actor: User, week: string, visible?: Set<ID>): Transaction[] {
  const r = weeklyReview(books.state, week, visible);
  if (!r.toPost.length) throw new ValidationError(['Nothing to post for this week: every run is already posted. Import the Gusto report first if it is missing.']);
  return r.toPost.flatMap((run) => postRun(books, actor, run.id));
}

/** Ledger payroll (6100 + 6110) per store and pay week, to tie payroll records to the books. */
export function ledgerPayroll(state: BooksState): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of state.transactions) {
    if (t.deleted) continue;
    for (const l of t.lines) {
      if (l.accountId !== ACCT.wages && l.accountId !== ACCT.taxes) continue;
      const k = `${l.storeId}|${payWeek(t.date)}`;
      m.set(k, (m.get(k) ?? 0) + l.debit - l.credit);
    }
  }
  return m;
}

// ── Labor % of sales ─────────────────────────────────────────────────────
/** POS daily-close revenue (fuel, inside, kitchen; not sales tax) per store and pay week. */
export function salesByWeek(state: BooksState): Map<string, number> {
  return salesIndex(state).sales;
}

function salesIndex(state: BooksState): { sales: Map<string, number>; days: Map<string, Set<string>> } {
  const rev = new Set(state.accounts.filter((a) => a.type === 'revenue' || a.type === 'contra_revenue').map((a) => a.id));
  const sales = new Map<string, number>();
  const days = new Map<string, Set<string>>();
  for (const t of state.transactions) {
    if (t.deleted || !t.tags.includes('pos')) continue;
    for (const l of t.lines) {
      if (!rev.has(l.accountId)) continue;
      const k = `${l.storeId}|${payWeek(t.date)}`;
      sales.set(k, (sales.get(k) ?? 0) + l.credit - l.debit);
      if (!days.has(k)) days.set(k, new Set());
      days.get(k)!.add(t.date);
    }
  }
  return { sales, days };
}

export const DEFAULT_LABOR_TARGET_BPS = 1200;
export function laborTarget(state: BooksState, storeId: ID): number {
  return peopleOf(state).laborTargets[storeId] ?? DEFAULT_LABOR_TARGET_BPS;
}

export interface LaborRow {
  storeId: ID; week: string; sales: number; cost: number; hours: number; pct: number | null; targetBps: number; over: boolean; salesPerHour: number | null;
  /** 6100 + 6110 in the ledger for the store and week. */
  ledger: number;
  /** Days with a POS close in the week (7 = full week). */
  salesDays: number;
}

/** Labor % of sales and sales per labor hour by store and week, against each store's target. */
export function laborPct(state: BooksState, weeks: string[], storeIds: ID[]): LaborRow[] {
  const { sales, days } = salesIndex(state);
  const idx = weekIndex(state);
  const led = ledgerPayroll(state);
  const out: LaborRow[] = [];
  for (const week of weeks) {
    const sw = storeWeeks(state, week, idx);
    for (const storeId of storeIds) {
      const s = sales.get(`${storeId}|${week}`) ?? 0;
      const w = sw.get(storeId);
      const cost = w?.cost ?? 0;
      const hours = w?.hours ?? 0;
      const targetBps = laborTarget(state, storeId);
      const pct = s > 0 ? cost / s : null;
      out.push({ storeId, week, sales: s, cost, hours, pct, targetBps, over: pct !== null && pct * 10000 > targetBps, salesPerHour: hours > 0 ? Math.round(s / hours) : null, ledger: led.get(`${storeId}|${week}`) ?? 0, salesDays: days.get(`${storeId}|${week}`)?.size ?? 0 });
    }
  }
  return out;
}

export function setLaborTarget(books: Books, actor: User, storeId: ID, bps: number): void {
  books.require(actor, 'setup.edit', 'set labor targets');
  if (!Number.isInteger(bps) || bps <= 0 || bps >= 10000) throw new ValidationError(['Enter the target as a percent of sales between 0 and 100, e.g. 12.5.']);
  const p = ensure(books);
  const before = p.laborTargets[storeId];
  p.laborTargets[storeId] = bps;
  books.audit(actor, { action: 'labor_target', objectType: 'people', objectId: storeId, summary: `Labor target for ${code(books.state, storeId)} set to ${(bps / 100).toFixed(2)}%`, before, after: bps });
  books.changed();
}

// ── Payroll taxes ────────────────────────────────────────────────────────
export interface TaxQuarterRow { quarter: string; fedLiability: number; stateLiability: number; fedDeposits: number; stateDeposits: number; fedDiff: number; stateDiff: number; due: string; pendingRuns: number }

/** Liabilities from Gusto runs (by pay date) against recorded deposits, by quarter. */
export function taxTracker(state: BooksState, visible?: Set<ID>): TaxQuarterRow[] {
  const m = new Map<string, TaxQuarterRow>();
  const get = (q: string) => {
    let r = m.get(q);
    if (!r) m.set(q, (r = { quarter: q, fedLiability: 0, stateLiability: 0, fedDeposits: 0, stateDeposits: 0, fedDiff: 0, stateDiff: 0, due: quarterDue(q), pendingRuns: 0 }));
    return r;
  };
  const p = peopleOf(state);
  for (const run of p.runs) {
    const r = get(quarterOf(run.payDate));
    let any = false;
    for (const l of run.lines) {
      if (visible && !visible.has(l.storeId)) continue;
      any = true;
      r.stateLiability += l.stateTaxes;
      r.fedLiability += l.employeeTaxes + l.employerTaxes - l.stateTaxes;
    }
    if (any && run.status !== 'posted') r.pendingRuns += 1;
  }
  for (const d of p.taxDeposits) {
    if (visible && !visible.has(d.storeId)) continue;
    const r = get(d.quarter);
    if (d.agency === 'federal') r.fedDeposits += d.amount; else r.stateDeposits += d.amount;
  }
  for (const r of m.values()) { r.fedDiff = r.fedLiability - r.fedDeposits; r.stateDiff = r.stateLiability - r.stateDeposits; }
  return [...m.values()].sort((a, b) => b.quarter.localeCompare(a.quarter));
}

export function recordTaxDeposit(books: Books, actor: User, input: { date: string; storeId: ID; agency: TaxAgency; quarter: string; amount: number; note?: string }): TaxDeposit {
  books.require(actor, 'payroll.edit', 'record payroll tax deposits');
  const errs: string[] = [];
  if (!isValidDate(input.date)) errs.push('Enter the deposit date as YYYY-MM-DD.');
  if (!/^\d{4}Q[1-4]$/.test(input.quarter)) errs.push('Choose the quarter the deposit pays, e.g. 2026Q4.');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) errs.push('Enter the amount deposited.');
  if (!books.store(input.storeId)) errs.push('Choose the store (employer) the deposit is for.');
  if (errs.length) throw new ValidationError(errs);
  const d: TaxDeposit = { id: books.nextId('td'), date: input.date, storeId: input.storeId, agency: input.agency, quarter: input.quarter, amount: input.amount, note: input.note?.trim() || undefined, by: actor.id };
  ensure(books).taxDeposits.push(d);
  books.audit(actor, { action: 'tax_deposit', objectType: 'people', objectId: d.id, summary: `Recorded ${input.agency} payroll tax deposit ${fmt$(input.amount)} for ${code(books.state, input.storeId)} ${input.quarter}`, after: d });
  books.changed();
  return d;
}

export interface ChecklistItem { key: string; label: string; due: string; detail?: string }

/** The quarterly returns: 941 plus the state withholding and unemployment reports (Gusto files; we keep the confirmation). */
export function quarterChecklist(q: string): ChecklistItem[] {
  const due = quarterDue(q);
  const items: ChecklistItem[] = [
    { key: `${q}:941`, label: 'Form 941 (federal quarterly return)', due },
    { key: `${q}:state_wh`, label: 'State withholding return', due },
    { key: `${q}:state_ui`, label: 'State unemployment wage report', due },
  ];
  if (q.endsWith('Q4')) items.push({ key: `${q.slice(0, 4)}:940`, label: 'Form 940 (federal unemployment, annual)', due });
  return items;
}

/** Year-end W-2 and 1099 season. */
export function seasonChecklist(year: string): ChecklistItem[] {
  const due = `${Number(year) + 1}-01-31`;
  return [
    { key: `${year}:w2:addresses`, label: 'Employee addresses and SSNs checked in Gusto', due: `${Number(year)}-12-31` },
    { key: `${year}:w2:cash`, label: 'Cash wages (HM11 and extra cash pay) reviewed with the CPA for W-2 reporting', due: `${Number(year)}-12-31` },
    { key: `${year}:w2:review`, label: 'W-2 preview in Gusto ties to the year\'s payroll register', due },
    { key: `${year}:w2:sent`, label: 'W-2s delivered to employees', due },
    { key: `${year}:w3`, label: 'W-3 and state copies filed', due },
    { key: `${year}:1099:list`, label: '1099 vendor list confirmed (vendors marked 1099 in Setup)', due },
    { key: `${year}:1099:w9`, label: 'W-9 on file for every 1099 vendor', due },
    { key: `${year}:1099:filed`, label: '1099-NEC filed and sent to vendors', due },
  ];
}

export function markChecklist(books: Books, actor: User, key: string, done: boolean, confirmation?: string): void {
  books.require(actor, 'payroll.edit', 'update the payroll tax checklist');
  const p = ensure(books);
  const before = p.checklist[key];
  if (done) p.checklist[key] = { by: actor.id, at: books.clock(), confirmation: confirmation?.trim() || undefined };
  else delete p.checklist[key];
  books.audit(actor, { action: done ? 'check' : 'uncheck', objectType: 'people', objectId: key, summary: `${done ? 'Marked done' : 'Reopened'}: ${key}${confirmation ? ` (confirmation ${confirmation.trim()})` : ''}`, before, after: p.checklist[key] });
  books.changed();
}

/** Year-to-date Gusto payroll (net + all taxes) from runs vs the ledger entries carrying them. */
export function ytdGustoTie(state: BooksState, year: string, visible?: Set<ID>): { runs: number; ledger: number } {
  let runs = 0;
  let ledger = 0;
  for (const r of peopleOf(state).runs) {
    if (!r.payDate.startsWith(year) || r.status !== 'posted') continue;
    for (const l of r.lines) if (!visible || visible.has(l.storeId)) runs += l.net + l.employeeTaxes + l.employerTaxes;
    const pc = postingCheck(state, r);
    if (!visible) ledger += pc.wages + pc.taxes;
    else for (const t of state.transactions) if (r.txnIds.includes(t.id) && !t.deleted) for (const l of t.lines) if ((l.accountId === ACCT.wages || l.accountId === ACCT.taxes) && visible.has(l.storeId)) ledger += l.debit - l.credit;
  }
  return { runs, ledger };
}
