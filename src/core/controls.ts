import type { Books } from './books';
import { ValidationError } from './books';
import type {
  ApprovalLimit, AuditEntry, BooksState, CashBag, CashControlSettings, CashStage, ControlsState, CoverageNeed, DriveOff, ID, InsuranceClaim, InsurancePolicy, LimitKind,
  PolicyKind, PosException, PosExceptionBatch, PosExceptionKind, Risk, Role, SignalDismissal, SignalEscalation, SodAck, UstRecord, UstTestKind, User,
} from './types';
import { can, permissionsFor, PermissionError, ROLE_LABEL, visibleStoreIds, type Permission } from './permissions';
import { formatMoney, parseMoney, type Cents } from './money';
import { addDays, daysBetween, isValidDate, lastDayOfPeriod, periodOf, periodsBetween } from './dates';
import { DEFAULT_CASH_CONTROLS, LIMIT_KINDS, LIMIT_LABEL, NEVER_APPROVE, cashControlsOf, limitFor, needsSecondCount } from './limits';
import { STAGE_LABEL, bagOverdue, bagVariances, event } from './cash';
import { apState, billTotal, vendorName } from './payables';
import { glOf, jeLimitKind, jeTotal } from './journals';
import { employee, peopleOf, rateChangeAnnual } from './payroll';
import { insideOf, isShortage, lotteryMath } from './inside';
import { fuelOf, postedPriceOn, tankBook, tankStatus } from './fuel';
import { complianceOf, POLICY_LABEL } from './compliance';
import { checksRegister, bankStoreId } from './bank';
import { splitCsv } from './bankio';

export * from './limits';

// ── State ────────────────────────────────────────────────────────────────
export function emptyControls(): ControlsState {
  return {
    limits: [], sodAcks: [], dismissals: [], escalations: [], cash: { ...DEFAULT_CASH_CONTROLS }, driveOffs: [], posExceptions: [], posBatches: [],
    risks: [], coverage: [], claims: [], ust: [], ustIntervals: {}, bankChanges: [],
  };
}

/** Books saved before phase 14 have no controls slice: read it as empty. */
export function controlsOf(state: BooksState): ControlsState {
  const c = state.controls;
  if (!c) return emptyControls();
  return { ...emptyControls(), ...c, cash: cashControlsOf(state) };
}

function ensure(books: Books): ControlsState {
  if (!books.state.controls) books.state.controls = emptyControls();
  const c = books.state.controls;
  const e = emptyControls();
  for (const k of Object.keys(e) as (keyof ControlsState)[]) if (c[k] === undefined) (c as unknown as Record<string, unknown>)[k] = e[k];
  return c;
}

/** One row of proof behind a signal or conflict. The signal's amount is always the sum of its rows. */
export interface EvidenceRow { id: string; label: string; date?: string; amount: Cents; to?: string; storeId?: ID; detail?: string }

const sum = (rows: { amount: Cents }[]) => rows.reduce((a, r) => a + r.amount, 0);
const money = (c: Cents) => formatMoney(c, { dollarSign: true });
const userName = (state: BooksState, id?: ID) => state.users.find((u) => u.id === id)?.name ?? id ?? '—';
const codeOf = (state: BooksState, id?: ID) => state.stores.find((s) => s.id === id)?.code ?? '';
/** A short stable fingerprint of record ids: a new record makes a new key, so a dismissed signal comes back when it grows. */
function fp(ids: string[]): string {
  let h = 2166136261;
  for (const ch of [...ids].sort().join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// ── 1. Approval limits ───────────────────────────────────────────────────
export const LIMIT_ROLES: Role[] = ['cfo', 'owner', 'bookkeeper', 'store_manager', 'reviewer'];

/** Every role × kind with the limit in force (recorded, or the default from the role's `approve` permission). */
export function limitTable(state: BooksState): (ApprovalLimit & { recorded: boolean })[] {
  return LIMIT_ROLES.flatMap((role) => LIMIT_KINDS.map((kind) => ({ role, kind, maxCents: limitFor(state, role, kind), recorded: !!state.controls?.limits?.some((l) => l.role === role && l.kind === kind) })));
}

export function validateLimits(state: BooksState, rows: ApprovalLimit[]): string[] {
  const errs: string[] = [];
  for (const r of rows) {
    if (r.maxCents !== null && (!Number.isSafeInteger(r.maxCents) || r.maxCents < 0)) errs.push(`Enter the ${ROLE_LABEL[r.role].toLowerCase()} limit for ${LIMIT_LABEL[r.kind].toLowerCase()} in dollars, or leave it as no limit.`);
    if (NEVER_APPROVE.includes(r.role) && r.maxCents !== 0) errs.push(`${ROLE_LABEL[r.role]}s can't approve anything (SPEC §10).`);
  }
  const probe: BooksState = { ...state, controls: { ...controlsOf(state), limits: rows } };
  for (const kind of LIMIT_KINDS) {
    const top = state.users.filter((u) => u.active && limitFor(probe, u.role, kind) === null);
    if (!top.length) errs.push(`Somebody active needs no limit for ${LIMIT_LABEL[kind].toLowerCase()}, or large ones could never be approved. Leave the CFO or the owner at no limit.`);
  }
  return errs;
}

/** Replace the approval limits. CFO only; audited with before and after. */
export function saveApprovalLimits(books: Books, actor: User, rows: ApprovalLimit[]): void {
  books.require(actor, 'controls.edit', 'change approval limits');
  const errs = validateLimits(books.state, rows);
  if (errs.length) throw new ValidationError(errs);
  const c = ensure(books);
  const before = structuredClone(c.limits);
  c.limits = rows.map((r) => ({ role: r.role, kind: r.kind, maxCents: r.maxCents }));
  books.audit(actor, { action: 'limits', objectType: 'controls', objectId: 'limits', summary: 'Changed approval limits', before, after: structuredClone(c.limits) });
  books.changed();
}

/** Approvals given, by kind: who approved what and whether it was inside the limit in force today. */
export interface ApprovalRow { id: string; kind: LimitKind; ref: string; to: string; amount: Cents; date: string; by: ID; enteredBy: ID; within: boolean }

export function approvalHistory(state: BooksState): ApprovalRow[] {
  const rows: ApprovalRow[] = [];
  const within = (by: ID, kind: LimitKind, amount: Cents) => { const u = state.users.find((x) => x.id === by); if (!u) return false; const l = limitFor(state, u.role, kind); return l === null || (l > 0 && amount <= l); };
  for (const b of apState(state).bills) if (b.approved) rows.push({ id: b.id, kind: 'bill', ref: `${b.ref} · ${vendorName(state, b.vendorId)}`, to: `/payables/bills/${b.id}`, amount: billTotal(b), date: b.approved.at.slice(0, 10), by: b.approved.by, enteredBy: b.createdBy, within: within(b.approved.by, 'bill', billTotal(b)) });
  for (const j of glOf(state).entries) if (j.approved) { const k = jeLimitKind(j); rows.push({ id: j.id, kind: k, ref: `${j.ref} · ${j.description}`, to: `/books/journals/${j.id}`, amount: jeTotal(j.lines), date: j.approved.at.slice(0, 10), by: j.approved.by, enteredBy: j.preparedBy, within: within(j.approved.by, k, jeTotal(j.lines)) }); }
  const p = peopleOf(state);
  for (const r of p.rateChanges) if (r.status === 'approved' && r.decidedBy) { const e = employee(state, r.employeeId); const a = rateChangeAnnual(r, e); rows.push({ id: r.id, kind: 'rate_change', ref: `Rate change · ${e?.name ?? ''}`, to: `/people/employees?q=${encodeURIComponent(e?.name ?? '')}`, amount: a, date: (r.decidedAt ?? r.requestedAt).slice(0, 10), by: r.decidedBy, enteredBy: r.requestedBy, within: within(r.decidedBy, 'rate_change', a) }); }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

// ── 2. Segregation of duties ─────────────────────────────────────────────
export type SodArea = 'bill' | 'journal' | 'writeoff' | 'rate_change' | 'cash';
export const SOD_AREAS: { area: SodArea; label: string; steps: [string, string, string | null] }[] = [
  { area: 'bill', label: 'Bills', steps: ['Enter', 'Approve', 'Pay'] },
  { area: 'journal', label: 'Journal entries', steps: ['Prepare', 'Approve', null] },
  { area: 'writeoff', label: 'Write-offs', steps: ['Prepare', 'Approve', null] },
  { area: 'rate_change', label: 'Rate changes & payroll', steps: ['Request', 'Approve', 'Post payroll'] },
  { area: 'cash', label: 'Cash', steps: ['Count at the store', 'Receive at HQ', 'Deposit'] },
];
const ENTER: Record<SodArea, Permission> = { bill: 'bills.enter', journal: 'journal.create', writeoff: 'journal.create', rate_change: 'payroll.edit', cash: 'cash.count' };
const PAY: Partial<Record<SodArea, Permission>> = { bill: 'bills.pay', rate_change: 'payroll.edit', cash: 'cash.handle' };

export interface SodCell { role: Role; area: SodArea; enter: boolean; approve: boolean; approveLimit: Cents | null; pay: boolean | null }

/** What each role can do in each area, from the permission matrix and the approval limits. */
export function sodMatrix(state: BooksState): SodCell[] {
  return LIMIT_ROLES.flatMap((role) => SOD_AREAS.map(({ area, steps }) => {
    const perms = permissionsFor(role);
    const lim = area === 'cash' ? (perms.includes('cash.handle') ? null : 0) : limitFor(state, role, area);
    return { role, area, enter: perms.includes(ENTER[area]), approve: lim === null || lim > 0, approveLimit: lim, pay: steps[2] ? perms.includes(PAY[area]!) : null };
  }));
}

/** What each person actually did, from the records (who entered, approved, paid) and the audit log. */
export interface SodActivity { who: string; userId?: ID; area: SodArea; enter: number; approve: number; pay: number }

export function sodActivity(state: BooksState): SodActivity[] {
  const m = new Map<string, SodActivity>();
  const bump = (area: SodArea, who: string, step: 'enter' | 'approve' | 'pay', userId?: ID) => {
    if (!who) return;
    const k = `${area}|${userId ?? who.trim().toLowerCase()}`;
    const r = m.get(k) ?? { who: userId ? userName(state, userId) : who.trim(), userId, area, enter: 0, approve: 0, pay: 0 };
    r[step] += 1;
    m.set(k, r);
  };
  for (const b of apState(state).bills) {
    bump('bill', b.createdBy, 'enter', b.createdBy);
    if (b.approved) bump('bill', b.approved.by, 'approve', b.approved.by);
    if (b.payment) bump('bill', b.payment.by, 'pay', b.payment.by);
  }
  for (const j of glOf(state).entries) {
    const a = jeLimitKind(j);
    bump(a, j.preparedBy, 'enter', j.preparedBy);
    if (j.approved) bump(a, j.approved.by, 'approve', j.approved.by);
  }
  const p = peopleOf(state);
  for (const r of p.rateChanges) {
    bump('rate_change', r.requestedBy, 'enter', r.requestedBy);
    if (r.decidedBy && r.status === 'approved') bump('rate_change', r.decidedBy, 'approve', r.decidedBy);
  }
  for (const r of p.runs) if (r.postedBy) bump('rate_change', r.postedBy, 'pay', r.postedBy);
  for (const bag of state.cash.bags) {
    const c = event(bag, 'count'), h = event(bag, 'hq_receipt'), d = event(bag, 'deposit');
    if (c) bump('cash', c.person, 'enter');
    if (h) bump('cash', h.person, 'approve');
    if (d) bump('cash', d.person, 'pay');
  }
  // Audit entries for records the slices above don't hold (e.g. an approval logged before a record was removed).
  const seen = new Set([...apState(state).bills.map((b) => b.id), ...glOf(state).entries.map((j) => j.id)]);
  for (const a of state.audit) {
    if (seen.has(a.objectId)) continue;
    if (a.objectType === 'bill') bump('bill', a.userId, a.action === 'approve' ? 'approve' : a.action === 'pay' ? 'pay' : 'enter', a.userId);
  }
  return [...m.values()].sort((a, b) => a.area.localeCompare(b.area) || a.who.localeCompare(b.who));
}

export interface SodConflict {
  key: string;
  type: 'config' | 'activity';
  area: SodArea;
  title: string;
  detail: string;
  role?: Role;
  userId?: ID;
  person?: string;
  storeId?: ID;
  amount: Cents;
  date?: string;
  evidence: EvidenceRow[];
  ack?: SodAck;
  /** Covered by the role's acknowledged compensating control. */
  covered?: SodAck;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Conflicts in configuration (a role that can do every step) and in activity (one person did two steps on the same record). */
export function sodConflicts(state: BooksState): SodConflict[] {
  const c = controlsOf(state);
  const acks = new Map(c.sodAcks.map((a) => [a.key, a]));
  const out: SodConflict[] = [];
  for (const cell of sodMatrix(state)) {
    const all = cell.enter && cell.approve && (cell.pay === null || cell.pay);
    if (!all) continue;
    const a = SOD_AREAS.find((x) => x.area === cell.area)!;
    const key = `cfg:${cell.role}:${cell.area}`;
    const users = state.users.filter((u) => u.active && u.role === cell.role);
    if (!users.length) continue;
    out.push({
      key, type: 'config', area: cell.area, role: cell.role, amount: 0, ack: acks.get(key),
      title: `${ROLE_LABEL[cell.role]} can ${a.steps.filter(Boolean).map((s) => s!.toLowerCase()).join(', ')} ${a.label.toLowerCase()}`,
      detail: `${users.map((u) => u.name).join(', ')} could carry ${a.label.toLowerCase()} from start to finish alone${cell.approveLimit ? ` (approvals up to ${money(cell.approveLimit)})` : ''}.`,
      evidence: users.map((u) => ({ id: u.id, label: `${u.name} · ${ROLE_LABEL[u.role]}`, amount: 0, to: '/setup/users' })),
    });
  }
  const roleAck = (userId: ID | undefined, area: SodArea) => {
    const role = state.users.find((u) => u.id === userId)?.role;
    const a = role ? acks.get(`cfg:${role}:${area}`) : undefined;
    return a?.coversActivity ? a : undefined;
  };
  const act = (x: Omit<SodConflict, 'type' | 'ack' | 'covered'>) => out.push({ ...x, type: 'activity', ack: acks.get(x.key), covered: roleAck(x.userId, x.area) });
  for (const b of apState(state).bills) {
    const v = vendorName(state, b.vendorId);
    const ev = (label: string): EvidenceRow => ({ id: b.id, label: `${b.ref} · ${v} ${b.invoiceNo}`, date: b.billDate, amount: billTotal(b), to: `/payables/bills/${b.id}`, storeId: b.storeId, detail: label });
    if (b.approved && b.approved.by === b.createdBy) act({ key: `act:bill:${b.id}:enter_approve`, area: 'bill', userId: b.createdBy, storeId: b.storeId, amount: billTotal(b), date: b.approved.at.slice(0, 10), title: `${userName(state, b.createdBy)} entered and approved ${b.ref}`, detail: `${v} ${money(billTotal(b))}: nobody else looked at it before it posted.`, evidence: [ev('Entered and approved by the same person')] });
    if (b.approved && b.payment && b.approved.by === b.payment.by) act({ key: `act:bill:${b.id}:approve_pay`, area: 'bill', userId: b.payment.by, storeId: b.storeId, amount: billTotal(b), date: b.payment.date, title: `${userName(state, b.payment.by)} approved and paid ${b.ref}`, detail: `${v} ${money(billTotal(b))} was approved and paid by one person.`, evidence: [ev('Approved and paid by the same person')] });
  }
  for (const j of glOf(state).entries) {
    if (j.approved && j.approved.by === j.preparedBy) {
      const a = jeLimitKind(j);
      act({ key: `act:${a}:${j.id}:enter_approve`, area: a, userId: j.preparedBy, amount: jeTotal(j.lines), date: j.approved.at.slice(0, 10), title: `${userName(state, j.preparedBy)} prepared and approved ${j.ref}`, detail: j.description, evidence: [{ id: j.id, label: `${j.ref} · ${j.description}`, date: j.date, amount: jeTotal(j.lines), to: `/books/journals/${j.id}` }] });
    }
  }
  for (const r of peopleOf(state).rateChanges) {
    if (r.status === 'approved' && r.decidedBy === r.requestedBy) {
      const e = employee(state, r.employeeId);
      const a = rateChangeAnnual(r, e);
      act({ key: `act:rate_change:${r.id}:enter_approve`, area: 'rate_change', userId: r.requestedBy, storeId: e?.storeId, amount: a, date: (r.decidedAt ?? r.requestedAt).slice(0, 10), title: `${userName(state, r.requestedBy)} requested and approved a rate change for ${e?.name}`, detail: `${money(r.fromCents)} → ${money(r.toCents)} from ${r.effective}.`, evidence: [{ id: r.id, label: `Rate change · ${e?.name}`, date: r.effective, amount: a, to: `/people/employees?q=${encodeURIComponent(e?.name ?? '')}` }] });
    }
  }
  for (const bag of state.cash.bags) {
    const cnt = event(bag, 'count'), hq = event(bag, 'hq_receipt');
    if (cnt && hq && norm(cnt.person) === norm(hq.person)) {
      act({ key: `act:cash:${bag.id}:count_receive`, area: 'cash', person: cnt.person, storeId: bag.storeId, amount: hq.amount, date: bag.businessDate, title: `${cnt.person} counted and received ${codeOf(state, bag.storeId)} ${bag.businessDate}`, detail: 'The same person counted the bag at the store and received it at HQ.', evidence: [{ id: bag.id, label: `${codeOf(state, bag.storeId)} bag ${bag.businessDate}`, date: bag.businessDate, amount: hq.amount, to: `/cash?date=${bag.businessDate}`, storeId: bag.storeId }] });
    }
  }
  return out;
}

export const isOpenConflict = (c: SodConflict) => !c.ack && !c.covered;

/** Accept a conflict with the reason (a compensating control). Configuration acknowledgments can cover the role's activity too. */
export function acknowledgeSod(books: Books, actor: User, key: string, reason: string, opts: { coversActivity?: boolean } = {}): SodAck {
  books.require(actor, 'controls.edit', 'acknowledge segregation-of-duties conflicts');
  if (!reason.trim()) throw new ValidationError(['Say why this is acceptable, e.g. "The owner reviews every bill the CFO approves each month".']);
  if (!sodConflicts(books.state).some((x) => x.key === key)) throw new ValidationError(['That conflict is no longer there.']);
  const c = ensure(books);
  const before = c.sodAcks.find((a) => a.key === key);
  const ack: SodAck = { key, reason: reason.trim(), coversActivity: key.startsWith('cfg:') ? !!opts.coversActivity : undefined, by: actor.id, at: books.clock() };
  c.sodAcks = [...c.sodAcks.filter((a) => a.key !== key), ack];
  books.audit(actor, { action: 'acknowledge', objectType: 'controls', objectId: key, summary: `Acknowledged segregation-of-duties conflict ${key}`, before, after: ack, reason: ack.reason });
  books.changed();
  return ack;
}

// ── 3. Cash controls ─────────────────────────────────────────────────────
export function saveCashControls(books: Books, actor: User, x: CashControlSettings): void {
  books.require(actor, 'controls.edit', 'change cash controls');
  const errs: string[] = [];
  if (!Number.isSafeInteger(x.dualCountAboveCents) || x.dualCountAboveCents <= 0) errs.push('Enter the amount above which a second count is needed.');
  if (!isValidDate(x.dualFrom)) errs.push('Enter the date second counts start, as YYYY-MM-DD.');
  if (!Number.isInteger(x.patternMin) || x.patternMin < 2) errs.push('A pattern needs at least 2 shortages.');
  if (!Number.isInteger(x.patternWindowDays) || x.patternWindowDays < 7) errs.push('Look at a window of at least 7 days.');
  if (errs.length) throw new ValidationError(errs);
  const c = ensure(books);
  const before = structuredClone(c.cash);
  c.cash = { ...x };
  books.audit(actor, { action: 'cash_controls', objectType: 'controls', objectId: 'cash', summary: `Cash controls: second count from ${money(x.dualCountAboveCents)}${x.enforceDual ? ' (enforced)' : ''}; blind HQ counts ${x.blindHq ? 'on' : 'off'}`, before, after: structuredClone(c.cash) });
  books.changed();
}

export type DualStatus = 'ok' | 'missing' | 'mismatch' | 'same_person';
export interface DualRow { bagId: ID; storeId: ID; businessDate: string; stage: 'count' | 'hq_receipt'; person: string; amount: Cents; second?: { person: string; amount: Cents }; status: DualStatus }

/** Counts and HQ receipts that need a second counter, and how each one stands. */
export function dualCountRows(state: BooksState, visible?: Set<ID>): DualRow[] {
  const rows: DualRow[] = [];
  for (const bag of state.cash.bags) {
    if (visible && !visible.has(bag.storeId)) continue;
    for (const stage of ['count', 'hq_receipt'] as const) {
      const e = event(bag, stage);
      if (!e || !needsSecondCount(state, stage, e.amount, bag.businessDate)) continue;
      const s = e.second;
      const status: DualStatus = !s ? 'missing' : norm(s.person) === norm(e.person) ? 'same_person' : s.amount !== e.amount ? 'mismatch' : 'ok';
      rows.push({ bagId: bag.id, storeId: bag.storeId, businessDate: bag.businessDate, stage, person: e.person, amount: e.amount, second: s ? { person: s.person, amount: s.amount } : undefined, status });
    }
  }
  return rows.sort((a, b) => b.businessDate.localeCompare(a.businessDate) || codeOf(state, a.storeId).localeCompare(codeOf(state, b.storeId)));
}

/** Record who did the second count on a step already recorded. A different amount is kept and flagged; nothing posts. */
export function recordSecondCount(books: Books, actor: User, x: { bagId: ID; stage: 'count' | 'hq_receipt'; person: string; amount: Cents }): void {
  const bag = books.state.cash.bags.find((b) => b.id === x.bagId);
  if (!bag) throw new ValidationError(['That cash bag no longer exists.']);
  if (x.stage === 'count') {
    books.require(actor, 'cash.count', 'record cash counts');
    if (!can(actor, 'view.all_stores') && !(actor.storeIds ?? []).includes(bag.storeId)) throw new PermissionError('You can only count cash for your own store.');
  } else books.require(actor, 'cash.handle', 'record HQ receipts');
  const e = event(bag, x.stage);
  if (!e) throw new ValidationError([`Record the ${STAGE_LABEL[x.stage].toLowerCase()} first.`]);
  const errs: string[] = [];
  if (!x.person.trim()) errs.push('Say who did the second count.');
  else if (norm(x.person) === norm(e.person)) errs.push(`${e.person} did the first count. The second count has to be someone else.`);
  if (!Number.isSafeInteger(x.amount) || x.amount < 0) errs.push('Enter the amount the second counter counted.');
  if (errs.length) throw new ValidationError(errs);
  const before = e.second;
  e.second = { person: x.person.trim(), amount: x.amount, at: books.clock(), by: actor.id };
  books.audit(actor, { action: 'second_count', objectType: 'cash', objectId: bag.id, summary: `Second count ${STAGE_LABEL[x.stage].toLowerCase()} ${codeOf(books.state, bag.storeId)} ${bag.businessDate}: ${money(x.amount)} by ${x.person.trim()}${x.amount !== e.amount ? ` (first count ${money(e.amount)})` : ''}`, before, after: e.second });
  books.changed();
}

/** Blind HQ count: while on, HQ doesn't see the pickup amount for a bag until it records what it counted. */
export function blindHidden(state: BooksState, bag: CashBag | undefined): boolean {
  return !!bag && cashControlsOf(state).blindHq && !!event(bag, 'pickup') && !event(bag, 'hq_receipt');
}

/** One handoff's variance, attributed to the person who handled that step. */
export interface VarianceRow { bagId: ID; storeId: ID; date: string; stage: CashStage; person: string; diff: Cents; flagged: boolean }

export function varianceRows(state: BooksState, opts: { from?: string; to?: string; visible?: Set<ID> } = {}): VarianceRow[] {
  const rows: VarianceRow[] = [];
  for (const bag of state.cash.bags) {
    if (opts.visible && !opts.visible.has(bag.storeId)) continue;
    if ((opts.from && bag.businessDate < opts.from) || (opts.to && bag.businessDate > opts.to)) continue;
    for (const v of bagVariances(state, bag)) {
      if (v.diff === 0) continue;
      rows.push({ bagId: bag.id, storeId: bag.storeId, date: bag.businessDate, stage: v.stage, person: event(bag, v.stage)?.person ?? '', diff: v.diff, flagged: v.flagged });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export interface PersonVariance { person: string; stores: ID[]; handoffs: number; shortages: number; shortTotal: Cents; overTotal: Cents; net: Cents; small: number; flagged: number }

/** Variance by person: how often each person's handoffs come up short, and by how much. */
export function varianceByPerson(state: BooksState, rows: VarianceRow[], opts: { visible?: Set<ID>; from?: string; to?: string } = {}): PersonVariance[] {
  const m = state.settings.materialityCents;
  const handoffs = new Map<string, number>();
  for (const bag of state.cash.bags) {
    if (opts.visible && !opts.visible.has(bag.storeId)) continue;
    if ((opts.from && bag.businessDate < opts.from) || (opts.to && bag.businessDate > opts.to)) continue;
    for (const e of bag.events) if (e.stage !== 'deposit') handoffs.set(norm(e.person), (handoffs.get(norm(e.person)) ?? 0) + 1);
  }
  const by = new Map<string, PersonVariance>();
  for (const r of rows) {
    const k = norm(r.person);
    const p = by.get(k) ?? { person: r.person, stores: [], handoffs: handoffs.get(k) ?? 0, shortages: 0, shortTotal: 0, overTotal: 0, net: 0, small: 0, flagged: 0 };
    if (!p.stores.includes(r.storeId)) p.stores.push(r.storeId);
    if (r.diff < 0) { p.shortages += 1; p.shortTotal += r.diff; if (-r.diff < m) p.small += 1; } else p.overTotal += r.diff;
    p.net += r.diff;
    if (r.flagged) p.flagged += 1;
    by.set(k, p);
  }
  return [...by.values()].sort((a, b) => a.net - b.net);
}

/** Variance by store and month: the trend over time. */
export function varianceByStore(rows: VarianceRow[]): { storeId: ID; period: string; shortages: number; net: Cents; small: number }[] {
  const m = new Map<string, { storeId: ID; period: string; shortages: number; net: Cents; small: number }>();
  for (const r of rows) {
    const k = `${r.storeId}|${periodOf(r.date)}`;
    const x = m.get(k) ?? { storeId: r.storeId, period: periodOf(r.date), shortages: 0, net: 0, small: 0 };
    if (r.diff < 0) x.shortages += 1;
    if (r.diff < 0 && Math.abs(r.diff) < 500) x.small += 1;
    x.net += r.diff;
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => a.storeId.localeCompare(b.storeId) || a.period.localeCompare(b.period));
}

export interface ShortagePattern { person: string; storeIds: ID[]; count: number; total: Cents; from: string; to: string; rows: VarianceRow[] }

/**
 * Repeated small shortages (SPEC §6.8): under materiality each is ignored, but `patternMin` or more by the same person
 * within `patternWindowDays` is flagged as a pattern. Reports the busiest window for each person.
 */
export function shortagePatterns(state: BooksState, opts: { visible?: Set<ID>; to?: string } = {}): ShortagePattern[] {
  const cc = cashControlsOf(state);
  const m = state.settings.materialityCents;
  const small = varianceRows(state, { visible: opts.visible, to: opts.to }).filter((r) => r.diff < 0 && -r.diff < m);
  const by = new Map<string, VarianceRow[]>();
  for (const r of small) by.set(norm(r.person), [...(by.get(norm(r.person)) ?? []), r]);
  const out: ShortagePattern[] = [];
  for (const rows of by.values()) {
    let best: VarianceRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const end = addDays(rows[i].date, cc.patternWindowDays - 1);
      const win = rows.slice(i).filter((r) => r.date <= end);
      if (win.length > best.length) best = win;
    }
    if (best.length >= cc.patternMin) out.push({ person: best[0].person, storeIds: [...new Set(best.map((r) => r.storeId))], count: best.length, total: best.reduce((a, r) => a + r.diff, 0), from: best[0].date, to: best.at(-1)!.date, rows: best });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** Deposit within N days (phase 2): every bag picked up, how long it took to reach the bank. */
export function depositTimeliness(state: BooksState, today: string, visible?: Set<ID>): { bagId: ID; storeId: ID; businessDate: string; pickedUp: string; deposited?: string; days: number; overdue: boolean }[] {
  const rows = [];
  for (const b of state.cash.bags) {
    if (visible && !visible.has(b.storeId)) continue;
    const p = event(b, 'pickup');
    if (!p) continue;
    const d = event(b, 'deposit');
    const pickedUp = p.at.slice(0, 10);
    rows.push({ bagId: b.id, storeId: b.storeId, businessDate: b.businessDate, pickedUp, deposited: d?.at.slice(0, 10), days: daysBetween(pickedUp, d?.at.slice(0, 10) ?? today), overdue: bagOverdue(state, b, today) });
  }
  return rows.sort((a, b) => b.businessDate.localeCompare(a.businessDate));
}

// ── 4. Fraud signals ─────────────────────────────────────────────────────
export type SignalKind = 'duplicate_vendor' | 'round_dollar' | 'under_limit' | 'pos_exceptions' | 'drive_off' | 'lottery_short' | 'terminated_pay' | 'ghost_employee' | 'rate_spike' | 'check_sequence' | 'bank_change';
export const SIGNAL_LABEL: Record<SignalKind, string> = {
  duplicate_vendor: 'Duplicate vendors', round_dollar: 'Round-dollar payments', under_limit: 'Just under an approval limit', pos_exceptions: 'Voids & refunds by cashier',
  drive_off: 'Fuel drive-offs & tank shortfalls', lottery_short: 'Lottery shortages', terminated_pay: 'Pay after termination', ghost_employee: 'Ghost employees',
  rate_spike: 'Sudden rate changes', check_sequence: 'Checks out of sequence', bank_change: 'Vendor bank account changed',
};
/** Where each signal reads from, in plain words (shown on the screen). */
export const SIGNAL_SOURCE: Record<SignalKind, string> = {
  duplicate_vendor: 'Vendors with similar names, or the same address or bank account.',
  round_dollar: 'Payments to vendors of a whole $100 multiple, $500 or more.',
  under_limit: 'Bills, journal entries and rate changes within 5% under an approval limit or the journal-entry approval threshold.',
  pos_exceptions: 'Cashier-level voids and refunds from an imported POS exception report. The POS daily close has no cashier detail, so this needs the import.',
  drive_off: 'The drive-off log, plus tanks whose 30-day book-to-physical shortfall is over the variance threshold (Fuel › Tanks).',
  lottery_short: 'Lottery weeks where the register is short of the lottery report (Inside › Lottery), not yet reviewed.',
  terminated_pay: 'Gusto lines for a pay period that starts after the termination date, or cash/check pay more than a week after it.',
  ghost_employee: 'Hourly pay with no hours on the line, or an employee recorded with no address or W-4 on file.',
  rate_spike: 'Approved or pending rate changes of 15% or more.',
  check_sequence: 'Gaps (up to 5 numbers) and repeats in the check numbers on the bank account, and checks written more than a month out of number order.',
  bank_change: 'A vendor bank account changed in the last 90 days, with the payments since.',
};

export interface FraudSignal {
  key: string;
  kind: SignalKind;
  title: string;
  detail: string;
  amount: Cents;
  evidence: EvidenceRow[];
  storeId?: ID;
  date: string;
  severity: 'high' | 'medium' | 'low';
  dismissed?: SignalDismissal;
  escalated?: SignalEscalation;
}
type RawSignal = Omit<FraudSignal, 'amount' | 'dismissed' | 'escalated'>;
const finish = (s: RawSignal): FraudSignal => ({ ...s, amount: sum(s.evidence) });

export interface SignalOpts { today: string; from?: string }
const SIGNAL_WINDOW_DAYS = 90;
const fromOf = (o: SignalOpts) => o.from ?? addDays(o.today, -SIGNAL_WINDOW_DAYS);

const moneyAccts = (state: BooksState) => new Set(state.accounts.filter((a) => a.subtype === 'bank' || a.subtype === 'cash').map((a) => a.id));
/** Vendor payments in a window: money out of bank or cash naming a vendor party. */
function vendorPayments(state: BooksState, from: string, to: string) {
  const accts = moneyAccts(state);
  const vendors = new Set(state.parties.filter((p) => p.type === 'vendor' && !p.deleted).map((p) => p.id));
  const out: { txnId: ID; ref: string; partyId: ID; date: string; amount: Cents; description: string; checkNo?: string; storeId?: ID }[] = [];
  for (const t of state.transactions) {
    if (t.deleted || !t.partyId || !vendors.has(t.partyId) || t.date < from || t.date > to || t.tags.includes('payroll')) continue;
    const amount = t.lines.filter((l) => accts.has(l.accountId) && !l.system).reduce((a, l) => a + l.credit - l.debit, 0);
    if (amount > 0) out.push({ txnId: t.id, ref: t.ref, partyId: t.partyId, date: t.date, amount, description: t.description, checkNo: t.checkNo, storeId: t.lines.find((l) => !accts.has(l.accountId) && !l.system)?.storeId });
  }
  return out;
}

const SUFFIX = /\b(inc|llc|ltd|co|corp|company|the|demo|of|and|&)\b/g;
export function vendorKey(name: string): string {
  return name.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9& ]/g, ' ').replace(SUFFIX, ' ').replace(/(ies)\b/g, 'y').replace(/s\b/g, '').replace(/\s+/g, ' ').trim();
}
function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** Names that read the same once suffixes, punctuation and plurals are dropped, or are one or two letters apart. */
export function similarNames(a: string, b: string): boolean {
  const x = vendorKey(a), y = vendorKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const long = Math.max(x.length, y.length);
  return long >= 6 && lev(x, y) <= (long >= 12 ? 2 : 1);
}

export function duplicateVendorSignals(state: BooksState, o: SignalOpts): FraudSignal[] {
  const vendors = state.parties.filter((p) => p.type === 'vendor' && !p.deleted);
  const paid = new Map<ID, Cents>();
  for (const p of vendorPayments(state, '0000-01-01', o.today)) paid.set(p.partyId, (paid.get(p.partyId) ?? 0) + p.amount);
  const out: FraudSignal[] = [];
  for (let i = 0; i < vendors.length; i++) for (let j = i + 1; j < vendors.length; j++) {
    const a = vendors[i], b = vendors[j];
    const why: string[] = [];
    if (similarNames(a.name, b.name)) why.push('similar names');
    if (a.address && b.address && a.address.toLowerCase().replace(/[^a-z0-9]/g, '') === b.address.toLowerCase().replace(/[^a-z0-9]/g, '')) why.push('same address');
    if (a.bankAccount && b.bankAccount && a.bankAccount.replace(/\W/g, '') === b.bankAccount.replace(/\W/g, '')) why.push('same bank account');
    if (!why.length) continue;
    out.push(finish({
      key: `duplicate_vendor:${[a.id, b.id].sort().join('+')}`, kind: 'duplicate_vendor', date: o.today, severity: why.includes('same bank account') ? 'high' : 'medium',
      title: `${a.name} and ${b.name}`, detail: `Possible duplicate vendor: ${why.join(', ')}. Amounts are everything paid to each.`,
      evidence: [a, b].map((p) => ({ id: p.id, label: p.name, amount: paid.get(p.id) ?? 0, to: `/setup/parties?q=${encodeURIComponent(p.name)}`, detail: [p.address, p.bankAccount ? `bank ${p.bankAccount}` : ''].filter(Boolean).join(' · ') || undefined })),
    }));
  }
  return out;
}

export const ROUND_MIN = 50_000;
export function roundDollarSignals(state: BooksState, o: SignalOpts): FraudSignal[] {
  const by = new Map<ID, ReturnType<typeof vendorPayments>>();
  for (const p of vendorPayments(state, fromOf(o), o.today)) if (p.amount >= ROUND_MIN && p.amount % 10_000 === 0) by.set(p.partyId, [...(by.get(p.partyId) ?? []), p]);
  return [...by].map(([partyId, pays]) => finish({
    key: `round_dollar:${partyId}:${fp(pays.map((p) => p.txnId))}`, kind: 'round_dollar', date: pays.at(-1)!.date, severity: pays.length >= 3 ? 'medium' : 'low', storeId: pays[0].storeId,
    title: `${vendorName(state, partyId)}: ${pays.length} round-dollar payment${pays.length === 1 ? '' : 's'}`, detail: 'Invoices rarely come to whole hundreds. Check each against its invoice or agreement (a retainer is fine).',
    evidence: pays.map((p) => ({ id: p.txnId, label: `${p.ref} · ${p.description}${p.checkNo ? ` · check ${p.checkNo}` : ''}`, date: p.date, amount: p.amount, to: `/books/transactions/${p.txnId}`, storeId: p.storeId })),
  }));
}

export const UNDER_PCT = 5;
const isJustUnder = (amount: Cents, limit: Cents) => limit > 0 && amount <= limit && amount >= limit * (1 - UNDER_PCT / 100);
export function underLimitSignals(state: BooksState, o: SignalOpts): FraudSignal[] {
  const from = fromOf(o);
  const out: FraudSignal[] = [];
  const limits = (kind: LimitKind) => [...new Set(LIMIT_ROLES.map((r) => limitFor(state, r, kind)).filter((l): l is number => l !== null && l > 0))];
  for (const b of apState(state).bills) {
    if (!b.approved || b.status === 'void' || b.billDate < from) continue;
    const t = billTotal(b);
    const l = limits('bill').find((x) => isJustUnder(t, x));
    if (l === undefined) continue;
    out.push(finish({ key: `under_limit:${b.id}`, kind: 'under_limit', date: b.billDate, severity: b.approved.by === b.createdBy ? 'high' : 'medium', storeId: b.storeId, title: `${b.ref} · ${vendorName(state, b.vendorId)} ${money(t)}`, detail: `Within ${UNDER_PCT}% under the ${money(l)} bill limit; approved by ${userName(state, b.approved.by)}, entered by ${userName(state, b.createdBy)}.`, evidence: [{ id: b.id, label: `${b.ref} · ${vendorName(state, b.vendorId)} ${b.invoiceNo}`, date: b.billDate, amount: t, to: `/payables/bills/${b.id}`, storeId: b.storeId }] }));
  }
  const th = state.settings.jeApprovalLimitCents;
  for (const j of glOf(state).entries) {
    if (j.status !== 'posted' || j.date < from || j.source === 'recurring') continue;
    const t = jeTotal(j.lines);
    const ls = [...limits(jeLimitKind(j)), ...(j.needsApproval ? [] : [th])];
    const l = ls.find((x) => isJustUnder(t, x));
    if (l === undefined) continue;
    out.push(finish({ key: `under_limit:${j.id}`, kind: 'under_limit', date: j.date, severity: 'medium', storeId: j.lines[0]?.storeId, title: `${j.ref} · ${j.description} ${money(t)}`, detail: l === th ? `Within ${UNDER_PCT}% under the ${money(th)} approval threshold, so it posted without approval.` : `Within ${UNDER_PCT}% under a ${money(l)} approval limit.`, evidence: [{ id: j.id, label: `${j.ref} · ${j.description}`, date: j.date, amount: t, to: `/books/journals/${j.id}` }] }));
  }
  for (const r of peopleOf(state).rateChanges) {
    if (r.status === 'rejected') continue;
    const e = employee(state, r.employeeId);
    const a = rateChangeAnnual(r, e);
    const l = limits('rate_change').find((x) => isJustUnder(a, x));
    if (l === undefined) continue;
    out.push(finish({ key: `under_limit:${r.id}`, kind: 'under_limit', date: r.effective, severity: 'low', storeId: e?.storeId, title: `Rate change · ${e?.name}`, detail: `A year's cost of ${money(a)} is within ${UNDER_PCT}% under the ${money(l)} rate-change limit.`, evidence: [{ id: r.id, label: `Rate change · ${e?.name}`, date: r.effective, amount: a, to: `/people/employees?q=${encodeURIComponent(e?.name ?? '')}` }] }));
  }
  return out;
}

// POS exceptions (optional import).
export const POS_KIND_LABEL: Record<PosExceptionKind, string> = { void: 'Void', refund: 'Refund', no_sale: 'No sale', discount: 'Discount' };
export interface PosExceptionRow { row: number; date: string | null; store: string; storeId?: ID; cashier: string; kind: PosExceptionKind | null; count: number; amount: Cents | null; hash: string; errors: string[] }

/** Read a POS exception report: Date, Store, Cashier, Type (void/refund/no sale/discount), Count, Amount. */
export function parsePosExceptions(state: BooksState, text: string): PosExceptionRow[] {
  const lines = splitCsv(text);
  if (!lines.length) return [];
  const head = lines[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const ci = { date: col('date'), store: col('store', 'location'), cashier: col('cashier', 'employee', 'clerk'), type: col('type', 'kind', 'exception'), count: col('count', 'qty'), amount: col('amount', 'total', 'value') };
  return lines.slice(1).map((f, i) => {
    const get = (k: keyof typeof ci) => (ci[k] >= 0 ? (f[ci[k]] ?? '').trim() : '');
    const raw = get('date');
    const date = isValidDate(raw) ? raw : /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw) ? `${raw.split('/')[2]}-${raw.split('/')[0].padStart(2, '0')}-${raw.split('/')[1].padStart(2, '0')}` : null;
    const t = get('type').toLowerCase();
    const kind: PosExceptionKind | null = t.startsWith('void') ? 'void' : t.startsWith('ref') || t.startsWith('return') ? 'refund' : t.includes('no') && t.includes('sale') ? 'no_sale' : t.startsWith('disc') ? 'discount' : null;
    const store = state.stores.find((s) => s.code.toUpperCase() === get('store').toUpperCase());
    const amount = parseMoney(get('amount') || '0');
    const count = Number(get('count') || '1');
    const errors: string[] = [];
    if (!date) errors.push('date');
    if (!store) errors.push('store');
    if (!get('cashier')) errors.push('cashier');
    if (!kind) errors.push('type');
    if (amount === null) errors.push('amount');
    return { row: i + 2, date, store: get('store'), storeId: store?.id, cashier: get('cashier'), kind, count: Number.isFinite(count) ? count : 1, amount: amount === null ? null : Math.abs(amount), hash: `pos:${date}|${store?.id}|${norm(get('cashier'))}|${kind}|${amount}|${count}`, errors };
  });
}

/** Import the rows that read cleanly. Re-importing the same report adds nothing. */
export function importPosExceptions(books: Books, actor: User, fileName: string, rows: PosExceptionRow[]): PosExceptionBatch {
  books.require(actor, 'risk.edit', 'import POS exception reports');
  const c = ensure(books);
  const seen = new Set(c.posExceptions.map((x) => x.hash));
  const ok = rows.filter((r) => !r.errors.length);
  if (!ok.length) throw new ValidationError(['No row could be read. The report needs Date, Store, Cashier, Type, Count and Amount columns.']);
  const id = books.nextId('posx');
  const fresh = ok.filter((r) => !seen.has(r.hash));
  for (const r of fresh) c.posExceptions.push({ id: books.nextId('pex'), hash: r.hash, batchId: id, storeId: r.storeId!, date: r.date!, cashier: r.cashier, kind: r.kind!, count: r.count, amount: r.amount! });
  const batch: PosExceptionBatch = { id, fileName, importedAt: books.clock(), by: actor.id, added: fresh.length, skipped: ok.length - fresh.length, total: fresh.reduce((a, r) => a + r.amount!, 0) };
  c.posBatches.push(batch);
  books.audit(actor, { action: 'import', objectType: 'controls', objectId: id, summary: `Imported POS exceptions ${fileName}: ${batch.added} new, ${batch.skipped} already imported`, after: batch });
  books.changed();
  return batch;
}

export function posExceptionSignals(state: BooksState, o: SignalOpts): FraudSignal[] {
  const from = addDays(o.today, -30);
  const rows = controlsOf(state).posExceptions.filter((x) => x.date >= from && x.date <= o.today && (x.kind === 'void' || x.kind === 'refund'));
  const out: FraudSignal[] = [];
  for (const storeId of new Set(rows.map((r) => r.storeId))) {
    const at = rows.filter((r) => r.storeId === storeId);
    const per = new Map<string, PosException[]>();
    for (const r of at) per.set(norm(r.cashier), [...(per.get(norm(r.cashier)) ?? []), r]);
    for (const [k, mine] of per) {
      const total = sum(mine);
      const others = [...per].filter(([x]) => x !== k).map(([, v]) => sum(v));
      const avg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0;
      if (total < 10_000 || (others.length && total < 2 * avg)) continue;
      out.push(finish({ key: `pos_exceptions:${storeId}:${k}:${fp(mine.map((m) => m.id))}`, kind: 'pos_exceptions', date: mine.at(-1)!.date, severity: 'medium', storeId,
        title: `${mine[0].cashier} at ${codeOf(state, storeId)}: ${mine.reduce((a, r) => a + r.count, 0)} voids and refunds`,
        detail: others.length ? `${money(total)} in 30 days, more than twice the other cashiers' average (${money(Math.round(avg))}).` : `${money(total)} in 30 days.`,
        evidence: mine.map((r) => ({ id: r.id, label: `${POS_KIND_LABEL[r.kind]} × ${r.count}`, date: r.date, amount: r.amount, storeId, to: '/controls/fraud?tab=pos' })) }));
    }
  }
  return out;
}

export function saveDriveOff(books: Books, actor: User, x: Omit<DriveOff, 'id' | 'by' | 'at'>): DriveOff {
  books.require(actor, 'fuel.readings', 'log drive-offs');
  if (!can(actor, 'view.all_stores') && !(actor.storeIds ?? []).includes(x.storeId)) throw new PermissionError('You can only log drive-offs for your own store.');
  const errs: string[] = [];
  if (!books.store(x.storeId)) errs.push('Choose the store.');
  if (!isValidDate(x.date)) errs.push('Enter the date as YYYY-MM-DD.');
  if (!Number.isSafeInteger(x.amount) || x.amount <= 0) errs.push('Enter the amount of fuel taken.');
  if (!(x.gallons > 0)) errs.push('Enter the gallons from the pump.');
  if (errs.length) throw new ValidationError(errs);
  const d: DriveOff = { ...x, id: books.nextId('dro'), note: x.note?.trim() || undefined, pump: x.pump?.trim() || undefined, by: actor.id, at: books.clock() };
  ensure(books).driveOffs.push(d);
  books.audit(actor, { action: 'drive_off', objectType: 'controls', objectId: d.id, summary: `Drive-off ${codeOf(books.state, d.storeId)} ${d.date}: ${d.gallons} gal, ${money(d.amount)}`, after: d });
  books.changed();
  return d;
}

export function driveOffSignals(state: BooksState, o: SignalOpts): FraudSignal[] {
  const from = addDays(o.today, -30);
  const f = fuelOf(state);
  const logs = controlsOf(state).driveOffs.filter((d) => d.date >= from && d.date <= o.today);
  const out: FraudSignal[] = [];
  for (const storeId of new Set([...logs.map((d) => d.storeId), ...f.tanks.map((t) => t.storeId)])) {
    const ev: EvidenceRow[] = logs.filter((d) => d.storeId === storeId).map((d) => ({ id: d.id, label: `Drive-off${d.pump ? ` pump ${d.pump}` : ''} · ${d.gallons} gal${d.grade ? ` ${d.grade}` : ''}`, date: d.date, amount: d.amount, storeId, to: '/controls/fraud?tab=driveoffs', detail: d.note }));
    for (const t of f.tanks.filter((x) => x.storeId === storeId && x.active)) {
      const st = tankStatus(state, t.id, o.today);
      if (!st || !st.varianceFlag || st.variance30 >= 0) continue;
      const cpg = postedPriceOn(state, storeId, t.grade, o.today) ?? 0;
      ev.push({ id: t.id, label: `Tank ${t.label} (${t.grade}): ${Math.round(-st.variance30).toLocaleString('en-US')} gal short over 30 days, threshold ${st.threshold.toLocaleString('en-US')}`, date: o.today, amount: Math.round(-st.variance30 * cpg), storeId, to: '/fuel/tanks', detail: `At the posted price of ${(cpg / 100).toFixed(3)} a gallon. A steady shortfall can be a leak as well as theft: check the UST release detection.` });
    }
    if (!ev.length) continue;
    out.push(finish({ key: `drive_off:${storeId}:${fp(ev.map((e) => e.id))}`, kind: 'drive_off', date: ev.map((e) => e.date ?? '').sort().at(-1)!, severity: ev.some((e) => e.id.startsWith('tank') || !e.id.startsWith('dro')) ? 'high' : 'low', storeId,
      title: `${codeOf(state, storeId)}: fuel unaccounted for`, detail: 'Drive-offs logged at the store and tanks short of their book inventory, valued at the posted price.', evidence: ev }));
  }
  return out;
}

export function lotteryShortSignals(state: BooksState, o: SignalOpts): FraudSignal[] {
  const from = fromOf(o);
  const weeks = insideOf(state).lottery.filter((w) => w.weekEnding >= from && w.weekEnding <= o.today && isShortage(state, w) && !w.reviewed);
  return [...new Set(weeks.map((w) => w.storeId))].map((storeId) => {
    const mine = weeks.filter((w) => w.storeId === storeId).sort((a, b) => a.weekEnding.localeCompare(b.weekEnding));
    return finish({ key: `lottery_short:${storeId}:${fp(mine.map((w) => w.id))}`, kind: 'lottery_short', date: mine.at(-1)!.weekEnding, severity: mine.length > 1 ? 'high' : 'medium', storeId,
      title: `${codeOf(state, storeId)}: lottery short ${mine.length} week${mine.length === 1 ? '' : 's'}`, detail: 'The register took in less lottery cash than the lottery report says it sold, net of payouts.',
      evidence: mine.map((w) => ({ id: w.id, label: `Week ending ${w.weekEnding}`, date: w.weekEnding, amount: -lotteryMath(w).variance, storeId, to: '/inside/lottery?show=short' })) });
  });
}

export function terminatedPaySignals(state: BooksState, _o: SignalOpts): FraudSignal[] {
  const p = peopleOf(state);
  const out: FraudSignal[] = [];
  for (const e of p.employees.filter((x) => x.terminatedOn)) {
    const t = e.terminatedOn!;
    const ev: EvidenceRow[] = [];
    for (const r of p.runs) for (const l of r.lines) {
      if (l.employeeId !== e.id) continue;
      const after = r.periodStart ? r.periodStart > t : r.payDate > addDays(t, 14);
      if (after) ev.push({ id: l.id, label: `Gusto run ${r.payDate}${r.periodStart ? ` (period from ${r.periodStart})` : ''} · gross`, date: r.payDate, amount: l.gross, storeId: l.storeId, to: `/people/runs?run=${r.id}` });
    }
    for (const x of p.offPayroll) if (x.employeeId === e.id && x.payDate > addDays(t, 7)) ev.push({ id: x.id, label: `${x.method === 'cash' ? 'Cash' : 'Check'} pay ${x.payDate}`, date: x.payDate, amount: x.amount, storeId: e.storeId, to: '/people/cash-pay?all=1' });
    if (ev.length) out.push(finish({ key: `terminated_pay:${e.id}:${fp(ev.map((x) => x.id))}`, kind: 'terminated_pay', date: ev.map((x) => x.date!).sort().at(-1)!, severity: 'high', storeId: e.storeId, title: `${e.name}: paid after leaving on ${t}`, detail: 'A final check for the last period worked is normal; pay for a later period is not.', evidence: ev }));
  }
  return out;
}

export function ghostEmployeeSignals(state: BooksState, _o: SignalOpts): FraudSignal[] {
  const p = peopleOf(state);
  const out: FraudSignal[] = [];
  for (const e of p.employees) {
    const ev: EvidenceRow[] = [];
    const why: string[] = [];
    if (e.payType === 'hourly') for (const r of p.runs) for (const l of r.lines) if (l.employeeId === e.id && l.gross > 0 && l.hours + l.otHours === 0) ev.push({ id: l.id, label: `Gusto run ${r.payDate}: paid with no hours`, date: r.payDate, amount: l.gross, storeId: l.storeId, to: `/people/runs?run=${r.id}` });
    if (ev.length) why.push('hourly pay with no hours');
    const missing = [e.addressOnFile === false ? 'address' : '', e.w4OnFile === false ? 'W-4' : ''].filter(Boolean);
    if (missing.length) {
      why.push(`no ${missing.join(' or ')} on file`);
      if (!ev.length) {
        for (const r of p.runs) for (const l of r.lines) if (l.employeeId === e.id) ev.push({ id: l.id, label: `Gusto run ${r.payDate} · gross`, date: r.payDate, amount: l.gross, storeId: l.storeId, to: `/people/runs?run=${r.id}` });
        for (const x of p.offPayroll) if (x.employeeId === e.id) ev.push({ id: x.id, label: `${x.method === 'cash' ? 'Cash' : 'Check'} pay ${x.payDate}`, date: x.payDate, amount: x.amount, storeId: e.storeId, to: '/people/cash-pay?all=1' });
        if (!ev.length) ev.push({ id: e.id, label: `No pay yet; ${missing.join(' and ')} missing`, amount: 0, storeId: e.storeId, to: `/people/employees?q=${encodeURIComponent(e.name)}` });
      }
    }
    if (!why.length) continue;
    out.push(finish({ key: `ghost_employee:${e.id}:${fp(ev.map((x) => x.id))}`, kind: 'ghost_employee', date: ev.map((x) => x.date ?? '').sort().at(-1) || e.hiredOn, severity: why.length > 1 ? 'high' : 'medium', storeId: e.storeId, title: `${e.name}: ${why.join('; ')}`, detail: 'Confirm the person exists and works here: ID, W-4, address and the schedule that shows their shifts.', evidence: ev }));
  }
  return out;
}

export const RATE_SPIKE_PCT = 15;
export function rateSpikeSignals(state: BooksState, _o: SignalOpts): FraudSignal[] {
  return peopleOf(state).rateChanges.filter((r) => r.status !== 'rejected' && r.fromCents > 0 && (r.toCents - r.fromCents) / r.fromCents >= RATE_SPIKE_PCT / 100).map((r) => {
    const e = employee(state, r.employeeId);
    const pct = ((r.toCents - r.fromCents) / r.fromCents) * 100;
    return finish({ key: `rate_spike:${r.id}`, kind: 'rate_spike', date: r.effective, severity: pct >= 25 ? 'high' : 'medium', storeId: e?.storeId,
      title: `${e?.name}: +${pct.toFixed(0)}% rate change (${r.status})`, detail: `${money(r.fromCents)} → ${money(r.toCents)} ${e?.payType === 'salary' ? 'a week' : 'an hour'} from ${r.effective}: "${r.reason}". Requested by ${userName(state, r.requestedBy)}${r.decidedBy ? `, approved by ${userName(state, r.decidedBy)}` : ''}.`,
      evidence: [{ id: r.id, label: `A year's cost of the change`, date: r.effective, amount: rateChangeAnnual(r, e), storeId: e?.storeId, to: `/people/employees?q=${encodeURIComponent(e?.name ?? '')}` }] });
  });
}

export const OUT_OF_ORDER_DAYS = 30;
export function checkSequenceSignals(state: BooksState, o: SignalOpts): FraudSignal[] {
  // Like every other signal, only the signal window: older breaks were seen (or not) when they happened.
  const from = fromOf(o);
  const rows = checksRegister(state, o.today).filter((r) => r.status !== 'not_in_books' && /^\d+$/.test(r.checkNo) && r.date >= from);
  const nums = [...rows].sort((a, b) => Number(a.checkNo) - Number(b.checkNo) || a.date.localeCompare(b.date));
  const out: FraudSignal[] = [];
  const row = (r: (typeof rows)[number], note?: string): EvidenceRow => ({ id: r.txnId ?? r.checkNo, label: `Check #${r.checkNo} · ${r.payee}${r.status === 'void' ? ' (void)' : ''}`, date: r.date, amount: r.status === 'void' ? 0 : r.amount, to: r.txnId ? `/books/transactions/${r.txnId}` : '/bank/checks', detail: note });
  for (let i = 1; i < nums.length; i++) {
    const a = nums[i - 1], b = nums[i];
    const gap = Number(b.checkNo) - Number(a.checkNo);
    if (gap === 0) out.push(finish({ key: `check_sequence:dup:${a.checkNo}`, kind: 'check_sequence', date: b.date, severity: 'high', title: `Check #${a.checkNo} used twice`, detail: 'Two payments carry the same check number. One of them is misnumbered, or a check was written twice.', evidence: [row(a), row(b)] }));
    else if (gap > 1 && gap <= 6) {
      const missing = Array.from({ length: gap - 1 }, (_, k) => String(Number(a.checkNo) + k + 1));
      out.push(finish({ key: `check_sequence:gap:${missing.join(',')}`, kind: 'check_sequence', date: b.date, severity: 'medium', title: `Check${missing.length === 1 ? '' : 's'} #${missing.join(', #')} missing`, detail: 'A gap in the sequence: find the stub, or void the check in the register so it is accounted for.',
        evidence: [{ ...row(a, `Before the gap (${money(a.amount)}, not counted)`), amount: 0 }, ...missing.map((n) => ({ id: `missing:${n}`, label: `Check #${n}: not in the books or the bank`, amount: 0, to: '/bank/checks' })), { ...row(b, `After the gap (${money(b.amount)}, not counted)`), amount: 0 }] }));
    }
  }
  // Written out of number order by more than a month (within the same book of checks). A few days either way is normal.
  for (let i = 1; i < nums.length; i++) {
    const a = nums[i - 1], b = nums[i];
    if (Number(b.checkNo) - Number(a.checkNo) > 0 && Number(b.checkNo) - Number(a.checkNo) <= 6 && daysBetween(b.date, a.date) > OUT_OF_ORDER_DAYS) {
      out.push(finish({ key: `check_sequence:order:${a.checkNo}:${b.checkNo}`, kind: 'check_sequence', date: a.date, severity: 'low', title: `Check #${b.checkNo} written before #${a.checkNo}`, detail: `#${b.checkNo} is dated ${b.date}, ${daysBetween(b.date, a.date)} days before #${a.checkNo} (${a.date}). Checks out of order can mean a stub was skipped and used later.`, evidence: [row(a), row(b)] }));
    }
  }
  return out;
}

/** Change a vendor's bank account, logged for the bank-change signal. */
export function setVendorBankAccount(books: Books, actor: User, partyId: ID, account: string, note?: string): void {
  books.require(actor, 'setup.edit', "change a vendor's bank account");
  const p = books.state.parties.find((x) => x.id === partyId);
  if (!p) throw new ValidationError(['Choose the vendor.']);
  const to = account.trim() || undefined;
  if (to === p.bankAccount) return;
  const ch = { id: books.nextId('bac'), partyId, from: p.bankAccount, to, at: books.clock(), by: actor.id, note: note?.trim() || undefined };
  books.saveParty(actor, { ...p, bankAccount: to });
  ensure(books).bankChanges.push(ch);
  books.changed();
}

export function bankChangeSignals(state: BooksState, o: SignalOpts): FraudSignal[] {
  const from = fromOf(o);
  const changes = new Map<ID, { at: string; from?: string; to?: string; by: ID; id: string }>();
  for (const c of controlsOf(state).bankChanges) if (c.at.slice(0, 10) >= from) changes.set(c.partyId, c);
  for (const a of state.audit as AuditEntry[]) {
    if (a.objectType !== 'party' || a.at.slice(0, 10) < from || changes.has(a.objectId)) continue;
    const b = (a.before as { bankAccount?: string } | undefined)?.bankAccount, f = (a.after as { bankAccount?: string } | undefined)?.bankAccount;
    if (a.before && b !== f) changes.set(a.objectId, { at: a.at, from: b, to: f, by: a.userId, id: a.id });
  }
  const pays = vendorPayments(state, from, o.today);
  return [...changes].map(([partyId, c]) => {
    const since = pays.filter((p) => p.partyId === partyId && p.date >= c.at.slice(0, 10));
    return finish({ key: `bank_change:${partyId}:${c.id}`, kind: 'bank_change', date: c.at.slice(0, 10), severity: since.length ? 'high' : 'medium',
      title: `${vendorName(state, partyId)}: bank account changed ${c.at.slice(0, 10)}`, detail: `${c.from ?? 'none'} → ${c.to ?? 'none'} by ${userName(state, c.by)}. Call the vendor on a number you already had to confirm the change.`,
      evidence: [{ id: c.id, label: 'Bank account changed', date: c.at.slice(0, 10), amount: 0, to: `/setup/parties?q=${encodeURIComponent(vendorName(state, partyId))}` }, ...since.map((p) => ({ id: p.txnId, label: `${p.ref} · paid since the change`, date: p.date, amount: p.amount, to: `/books/transactions/${p.txnId}`, storeId: p.storeId }))] });
  });
}

export const SIGNAL_FNS: Record<SignalKind, (state: BooksState, o: SignalOpts) => FraudSignal[]> = {
  duplicate_vendor: duplicateVendorSignals, round_dollar: roundDollarSignals, under_limit: underLimitSignals, pos_exceptions: posExceptionSignals, drive_off: driveOffSignals,
  lottery_short: lotteryShortSignals, terminated_pay: terminatedPaySignals, ghost_employee: ghostEmployeeSignals, rate_spike: rateSpikeSignals, check_sequence: checkSequenceSignals, bank_change: bankChangeSignals,
};

/** Every signal with its dismissal or escalation attached. Store-level signals are filtered by `visible`; company-wide ones need Corporate. */
export function fraudSignals(state: BooksState, o: SignalOpts & { visible?: Set<ID> }): FraudSignal[] {
  const c = controlsOf(state);
  const dis = new Map(c.dismissals.map((d) => [d.key, d]));
  const esc = new Map(c.escalations.map((d) => [d.key, d]));
  const corp = bankStoreId(state);
  return (Object.keys(SIGNAL_FNS) as SignalKind[]).flatMap((k) => SIGNAL_FNS[k](state, o))
    .filter((s) => !o.visible || o.visible.has(s.storeId ?? corp))
    .map((s) => ({ ...s, dismissed: dis.get(s.key), escalated: esc.get(s.key) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export const isNewSignal = (s: FraudSignal) => !s.dismissed && !s.escalated;

export function dismissSignal(books: Books, actor: User, key: string, reason: string): SignalDismissal {
  books.require(actor, 'controls.edit', 'dismiss fraud signals');
  if (!reason.trim()) throw new ValidationError(['Say what you found, e.g. "Monthly retainer per the engagement letter". The reason goes in the audit log.']);
  const c = ensure(books);
  const d: SignalDismissal = { key, reason: reason.trim(), by: actor.id, at: books.clock() };
  c.dismissals = [...c.dismissals.filter((x) => x.key !== key), d];
  books.audit(actor, { action: 'dismiss_signal', objectType: 'controls', objectId: key, summary: `Dismissed fraud signal ${key}`, after: d, reason: d.reason });
  books.changed();
  return d;
}

export function reopenSignal(books: Books, actor: User, key: string): void {
  books.require(actor, 'controls.edit', 'reopen fraud signals');
  const c = ensure(books);
  const before = c.dismissals.find((x) => x.key === key);
  if (!before) return;
  c.dismissals = c.dismissals.filter((x) => x.key !== key);
  books.audit(actor, { action: 'reopen_signal', objectType: 'controls', objectId: key, summary: `Reopened fraud signal ${key}`, before });
  books.changed();
}

/** Pass a signal on for follow-up: a note kept with it (CFO or owner). */
export function escalateSignal(books: Books, actor: User, key: string, note: string): SignalEscalation {
  if (!can(actor, 'controls.edit') && !can(actor, 'approve')) throw new PermissionError("Your role can't escalate fraud signals. Ask the CFO or an owner.");
  if (!note.trim()) throw new ValidationError(['Write the note: what to look at and who should look.']);
  const c = ensure(books);
  const e: SignalEscalation = { key, note: note.trim(), by: actor.id, at: books.clock() };
  c.escalations = [...c.escalations.filter((x) => x.key !== key), e];
  books.audit(actor, { action: 'escalate_signal', objectType: 'controls', objectId: key, summary: `Escalated fraud signal ${key}`, after: e, reason: e.note });
  books.changed();
  return e;
}

// ── 5. Insurance & risk register ─────────────────────────────────────────
export const RISK_CATEGORY_LABEL: Record<Risk['category'], string> = { operational: 'Operational', financial: 'Financial', compliance: 'Compliance', environmental: 'Environmental', safety: 'Safety', technology: 'Technology', people: 'People' };
export const riskScore = (r: Pick<Risk, 'likelihood' | 'impact'>) => r.likelihood * r.impact;
export const riskLevel = (r: Pick<Risk, 'likelihood' | 'impact'>): 'high' | 'medium' | 'low' => (riskScore(r) >= 15 ? 'high' : riskScore(r) >= 8 ? 'medium' : 'low');
export const REVIEW_SOON_DAYS = 14;

export type RiskDraft = Omit<Risk, 'id' | 'updatedBy' | 'updatedAt'> & { id?: ID };
export function validateRisk(d: RiskDraft): string[] {
  const e: string[] = [];
  if (!d.title.trim()) e.push('Name the risk.');
  for (const k of ['likelihood', 'impact'] as const) if (!Number.isInteger(d[k]) || d[k] < 1 || d[k] > 5) e.push(`Rate the ${k} from 1 to 5.`);
  if (!d.owner.trim()) e.push('Say who owns the risk.');
  if (!d.mitigation.trim()) e.push('Say how the risk is managed.');
  if (!isValidDate(d.reviewDate)) e.push('Enter the next review date as YYYY-MM-DD.');
  return e;
}

export function saveRisk(books: Books, actor: User, d: RiskDraft): Risk {
  books.require(actor, 'risk.edit', 'edit the risk register');
  const errs = validateRisk(d);
  if (errs.length) throw new ValidationError(errs);
  const c = ensure(books);
  const before = d.id ? c.risks.find((r) => r.id === d.id) : undefined;
  const r: Risk = { ...d, id: before?.id ?? books.nextId('risk'), title: d.title.trim(), owner: d.owner.trim(), mitigation: d.mitigation.trim(), updatedBy: actor.id, updatedAt: books.clock() };
  c.risks = before ? c.risks.map((x) => (x.id === r.id ? r : x)) : [...c.risks, r];
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'controls', objectId: r.id, summary: `${before ? 'Updated' : 'Added'} risk "${r.title}" (score ${riskScore(r)})`, before, after: structuredClone(r) });
  books.changed();
  return r;
}

export function risksDue(state: BooksState, today: string): Risk[] {
  return controlsOf(state).risks.filter((r) => r.status === 'open' && r.reviewDate <= addDays(today, REVIEW_SOON_DAYS)).sort((a, b) => a.reviewDate.localeCompare(b.reviewDate));
}

export const COVERAGE_KINDS: PolicyKind[] = ['property', 'general_liability', 'liquor', 'pollution', 'workers_comp', 'umbrella', 'cyber', 'auto'];
export type CoverageStatus = 'covered' | 'gap' | 'under_limit' | 'expiring' | 'not_required';
export interface CoverageRow { kind: PolicyKind; need: CoverageNeed; policies: InsurancePolicy[]; status: CoverageStatus; premium: Cents; limit?: Cents; expires?: string; missingStores: ID[]; detail: string }

const inForce = (p: InsurancePolicy, today: string) => p.effective <= today && p.expires > today;

/** Coverage checklist by policy type: what we carry against what we should, with gaps flagged. */
export function coverageChecklist(state: BooksState, today: string): CoverageRow[] {
  const c = controlsOf(state);
  const policies = complianceOf(state).policies;
  const tankStores = [...new Set(fuelOf(state).tanks.filter((t) => t.active).map((t) => t.storeId))];
  const beerStores = [...new Set(complianceOf(state).licenses.filter((l) => l.kind === 'beer' && l.expiresOn >= today).map((l) => l.storeId))];
  return COVERAGE_KINDS.map((kind) => {
    const need = c.coverage.find((x) => x.kind === kind) ?? { kind, required: true };
    const mine = policies.filter((p) => inForce(p, today) && (p.kind === kind || need.policyIds?.includes(p.id)));
    const limit = mine.map((p) => p.limit ?? 0).reduce((a, b) => Math.max(a, b), 0) || undefined;
    const expires = mine.map((p) => p.expires).sort()[0];
    const storesNeeded = kind === 'pollution' ? tankStores : kind === 'liquor' ? beerStores : [];
    const covered = new Set(mine.flatMap((p) => p.storeIds));
    const missingStores = storesNeeded.filter((s) => !covered.has(s));
    let status: CoverageStatus = 'covered';
    let detail = mine.map((p) => `${p.carrier} ${p.policyNo}${p.kind !== kind ? ` (${POLICY_LABEL[p.kind].toLowerCase()} policy)` : ''}`).join('; ');
    if (!need.required && !mine.length) { status = 'not_required'; detail = need.note ?? 'Not required.'; }
    else if (!mine.length) { status = 'gap'; detail = need.note ? `No policy in force. ${need.note}` : 'No policy in force.'; }
    else if (missingStores.length) { status = 'gap'; detail += `. Not covered: ${missingStores.map((s) => codeOf(state, s)).join(', ')}.`; }
    else if (need.minLimitCents && (limit ?? 0) < need.minLimitCents) { status = 'under_limit'; detail += `. Limit ${money(limit ?? 0)} is under the ${money(need.minLimitCents)} we want.`; }
    else if (expires && daysBetween(today, expires) <= 60) { status = 'expiring'; detail += `. Renews ${expires}.`; }
    return { kind, need, policies: mine, status, premium: mine.filter((p) => p.kind === kind).reduce((a, p) => a + p.premium, 0), limit, expires, missingStores, detail };
  });
}

export const coverageGaps = (state: BooksState, today: string) => coverageChecklist(state, today).filter((r) => r.status === 'gap' || r.status === 'under_limit');

export function saveCoverageNeed(books: Books, actor: User, need: CoverageNeed): void {
  books.require(actor, 'risk.edit', 'change the coverage checklist');
  if (need.minLimitCents !== undefined && (!Number.isSafeInteger(need.minLimitCents) || need.minLimitCents < 0)) throw new ValidationError(['Enter the minimum limit in dollars.']);
  const c = ensure(books);
  const before = c.coverage.find((x) => x.kind === need.kind);
  c.coverage = [...c.coverage.filter((x) => x.kind !== need.kind), { ...need }];
  books.audit(actor, { action: 'coverage', objectType: 'controls', objectId: need.kind, summary: `Coverage checklist: ${POLICY_LABEL[need.kind]} ${need.required ? 'required' : 'not required'}`, before, after: need });
  books.changed();
}

export type ClaimDraft = Omit<InsuranceClaim, 'id' | 'by' | 'at'> & { id?: ID };
export function saveClaim(books: Books, actor: User, d: ClaimDraft): InsuranceClaim {
  books.require(actor, 'risk.edit', 'record insurance claims');
  const e: string[] = [];
  if (!books.store(d.storeId)) e.push('Choose the store.');
  if (!isValidDate(d.date)) e.push('Enter the date of loss as YYYY-MM-DD.');
  if (!d.description.trim()) e.push('Describe the loss.');
  if (!Number.isSafeInteger(d.amount) || d.amount <= 0) e.push('Enter the amount claimed.');
  if (!Number.isSafeInteger(d.paid) || d.paid < 0) e.push('Enter what the carrier paid (0 if nothing yet).');
  if (e.length) throw new ValidationError(e);
  const c = ensure(books);
  const before = d.id ? c.claims.find((x) => x.id === d.id) : undefined;
  const cl: InsuranceClaim = { ...d, id: before?.id ?? books.nextId('clm'), description: d.description.trim(), by: actor.id, at: books.clock() };
  c.claims = before ? c.claims.map((x) => (x.id === cl.id ? cl : x)) : [...c.claims, cl];
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'controls', objectId: cl.id, summary: `${before ? 'Updated' : 'Recorded'} claim: ${cl.description} ${money(cl.amount)}`, before, after: cl });
  books.changed();
  return cl;
}

// ── 6. Environmental / UST compliance ────────────────────────────────────
export const UST_LABEL: Record<UstTestKind, string> = {
  tank_tightness: 'Tank tightness test', line_tightness: 'Line tightness test', line_leak_detector: 'Line leak detector test', cathodic_protection: 'Cathodic protection test',
  spill_overfill: 'Spill bucket & overfill test', inspection: 'Facility inspection', financial_responsibility: 'Financial responsibility',
};
/** Standard intervals in months (illustrative; set your state's rules under ustIntervals). */
export const UST_INTERVAL: Record<UstTestKind, number> = { tank_tightness: 60, line_tightness: 12, line_leak_detector: 12, cathodic_protection: 36, spill_overfill: 36, inspection: 12, financial_responsibility: 12 };
export const UST_TANK_KINDS: UstTestKind[] = ['tank_tightness', 'line_tightness', 'line_leak_detector', 'cathodic_protection', 'spill_overfill'];
export const UST_SITE_KINDS: UstTestKind[] = ['inspection', 'financial_responsibility'];
export const UST_SOON_DAYS = 30;

const addMonths = (date: string, n: number) => {
  let y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)) + n;
  while (m > 12) { m -= 12; y += 1; }
  const p = `${y}-${String(m).padStart(2, '0')}`;
  const last = lastDayOfPeriod(p);
  return `${p}-${String(Math.min(Number(date.slice(8, 10)), Number(last.slice(8, 10)))).padStart(2, '0')}`;
};

export type UstStatus = 'ok' | 'due_soon' | 'overdue' | 'never' | 'failed';
export interface UstRow { storeId: ID; tankId?: ID; label: string; kind: UstTestKind; last?: UstRecord; nextDue?: string; status: UstStatus }

/** Every required test per tank and per site, its last record, next due date and status. */
export function ustSchedule(state: BooksState, today: string, visible?: Set<ID>): UstRow[] {
  const c = controlsOf(state);
  const months = (k: UstTestKind) => c.ustIntervals[k] ?? UST_INTERVAL[k];
  const latest = (storeId: ID, tankId: ID | undefined, kind: UstTestKind) => c.ust.filter((r) => r.storeId === storeId && (r.tankId ?? '') === (tankId ?? '') && r.kind === kind).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const row = (storeId: ID, tankId: ID | undefined, label: string, kind: UstTestKind): UstRow => {
    const last = latest(storeId, tankId, kind);
    const nextDue = last ? last.nextDue ?? addMonths(last.date, months(kind)) : undefined;
    const status: UstStatus = !last ? 'never' : last.result === 'fail' ? 'failed' : nextDue! < today ? 'overdue' : daysBetween(today, nextDue!) <= UST_SOON_DAYS ? 'due_soon' : 'ok';
    return { storeId, tankId, label, kind, last, nextDue, status };
  };
  const tanks = fuelOf(state).tanks.filter((t) => t.active && (!visible || visible.has(t.storeId)));
  const out: UstRow[] = [];
  for (const storeId of [...new Set(tanks.map((t) => t.storeId))]) {
    for (const t of tanks.filter((x) => x.storeId === storeId)) for (const k of UST_TANK_KINDS) out.push(row(storeId, t.id, `${codeOf(state, storeId)} ${t.label} (${t.grade})`, k));
    for (const k of UST_SITE_KINDS) out.push(row(storeId, undefined, `${codeOf(state, storeId)} site`, k));
  }
  return out;
}

export const ustOverdue = (state: BooksState, today: string, visible?: Set<ID>) => ustSchedule(state, today, visible).filter((r) => r.status === 'overdue' || r.status === 'never' || r.status === 'failed');

export interface ReleaseMonth { tankId: ID; storeId: ID; label: string; period: string; method: 'ATG' | 'manual inventory'; days: number; readings: number; throughput: number; variance: number; allowed: number; result: 'pass' | 'fail' | 'incomplete' }

/**
 * Monthly release detection from the tank readings (Phase 3): inventory control passes when the month's
 * book-to-physical variance is within 1% of throughput + 130 gallons, with a reading on most days.
 */
export function releaseDetection(state: BooksState, today: string, opts: { months?: number; visible?: Set<ID> } = {}): ReleaseMonth[] {
  const f = fuelOf(state);
  const to = today;
  const periods = periodsBetween(periodOf(addDays(to, -31 * ((opts.months ?? 3) - 1))), periodOf(to));
  const out: ReleaseMonth[] = [];
  for (const t of f.tanks.filter((x) => x.active && (!opts.visible || opts.visible.has(x.storeId)))) {
    const atg = f.readings.some((r) => r.tankId === t.id && r.method === 'atg');
    for (const p of periods) {
      const end = lastDayOfPeriod(p) < to ? lastDayOfPeriod(p) : addDays(to, -1);
      const start = `${p}-01`;
      if (end < start) continue;
      const days = tankBook(state, t.id, start, end);
      const withReading = days.filter((d) => d.physical !== null);
      if (!withReading.length) continue;
      const throughput = Math.round(days.reduce((a, d) => a + d.sales, 0));
      const variance = Math.round(days.reduce((a, d) => a + (d.variance ?? 0), 0));
      const allowed = Math.round(throughput * 0.01 + 130);
      const enough = withReading.length >= Math.min(20, Math.floor(days.length * 0.8));
      out.push({ tankId: t.id, storeId: t.storeId, label: `${codeOf(state, t.storeId)} ${t.label} (${t.grade})`, period: p, method: atg ? 'ATG' : 'manual inventory', days: days.length, readings: withReading.length, throughput, variance, allowed, result: !enough ? 'incomplete' : Math.abs(variance) > allowed ? 'fail' : 'pass' });
    }
  }
  return out;
}

/** Financial responsibility per site with tanks: an in-force pollution / UST policy covering the store. */
export function financialResponsibility(state: BooksState, today: string, visible?: Set<ID>): { storeId: ID; policy?: InsurancePolicy; ok: boolean; detail: string }[] {
  const stores = [...new Set(fuelOf(state).tanks.filter((t) => t.active && (!visible || visible.has(t.storeId))).map((t) => t.storeId))];
  return stores.map((storeId) => {
    const policy = complianceOf(state).policies.find((p) => p.kind === 'pollution' && p.storeIds.includes(storeId) && inForce(p, today));
    return { storeId, policy, ok: !!policy, detail: policy ? `${policy.carrier} ${policy.policyNo}, ${money(policy.limit ?? 0)} per occurrence, through ${policy.expires}` : 'No pollution / UST liability policy in force for this site.' };
  });
}

export type UstDraft = Omit<UstRecord, 'id' | 'by' | 'at' | 'attachments'> & { id?: ID; attachments?: UstRecord['attachments'] };
export function saveUstRecord(books: Books, actor: User, d: UstDraft): UstRecord {
  books.require(actor, 'risk.edit', 'record UST tests');
  const e: string[] = [];
  if (!books.store(d.storeId)) e.push('Choose the site.');
  if (d.tankId && !fuelOf(books.state).tanks.some((t) => t.id === d.tankId && t.storeId === d.storeId)) e.push('That tank is not at this site.');
  if (UST_TANK_KINDS.includes(d.kind) && !d.tankId) e.push(`${UST_LABEL[d.kind]} is per tank: choose the tank.`);
  if (!isValidDate(d.date)) e.push('Enter the test date as YYYY-MM-DD.');
  if (d.nextDue && !isValidDate(d.nextDue)) e.push('Enter the next due date as YYYY-MM-DD, or leave it blank for the standard interval.');
  if (e.length) throw new ValidationError(e);
  const c = ensure(books);
  const before = d.id ? c.ust.find((x) => x.id === d.id) : undefined;
  const r: UstRecord = { ...d, id: before?.id ?? books.nextId('ust'), attachments: d.attachments ?? before?.attachments ?? [], vendor: d.vendor?.trim() || undefined, note: d.note?.trim() || undefined, by: actor.id, at: books.clock() };
  c.ust = before ? c.ust.map((x) => (x.id === r.id ? r : x)) : [...c.ust, r];
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'controls', objectId: r.id, summary: `UST ${UST_LABEL[r.kind].toLowerCase()} ${codeOf(books.state, r.storeId)} ${r.date}: ${r.result}`, before, after: r });
  books.changed();
  return r;
}

export function attachToUst(books: Books, actor: User, id: ID, att: UstRecord['attachments'][number]): void {
  books.require(actor, 'risk.edit', 'attach UST documents');
  const r = ensure(books).ust.find((x) => x.id === id);
  if (!r) throw new ValidationError(['That UST record no longer exists.']);
  r.attachments.push(att);
  books.audit(actor, { action: 'attach', objectType: 'controls', objectId: r.id, summary: `Attached ${att.name} to UST ${UST_LABEL[r.kind].toLowerCase()} ${codeOf(books.state, r.storeId)}` });
  books.changed();
}

// ── 7. Security & backups ────────────────────────────────────────────────
export const BACKUP_FORMAT = 'cfo-portal-backup';
export interface BackupFile { format: typeof BACKUP_FORMAT; schema: number; exportedAt: string; exportedBy: string; company: string; counts: Record<string, number>; state: BooksState }

export function stateCounts(s: BooksState): Record<string, number> {
  return {
    Transactions: s.transactions.length, 'Bank lines': s.bank.lines.length, 'Cash bags': s.cash.bags.length, Bills: s.payables?.bills.length ?? 0,
    Employees: s.people?.employees.length ?? 0, 'Journal entries': s.gl?.entries.length ?? 0, 'Audit log entries': s.audit.length, Users: s.users.length,
  };
}

/** The full books as one JSON file. Logged as an export before it is written, so the file carries its own log line. */
export function exportBackup(books: Books, actor: User): { fileName: string; json: string } {
  books.require(actor, 'export', 'export a backup');
  const at = books.clock();
  books.logExport(actor, `full books backup (JSON) ${at.slice(0, 10)}`);
  const file: BackupFile = { format: BACKUP_FORMAT, schema: books.state.schema, exportedAt: at, exportedBy: actor.name, company: books.state.settings.companyName, counts: stateCounts(books.state), state: books.state };
  return { fileName: `cfo-portal-backup-${at.slice(0, 10)}.json`, json: JSON.stringify(file) };
}

export interface BackupPreview { exportedAt: string; exportedBy: string; company: string; schema: number; rows: { label: string; current: number; backup: number }[] }

/** Read a backup file and say what restoring it would change. Nothing changes until restoreBackup. */
export function parseBackup(text: string, current: BooksState): { ok: true; backup: BackupFile; preview: BackupPreview } | { ok: false; errors: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, errors: ['This file is not a portal backup (it is not JSON). Choose a file saved from Security & backups.'] }; }
  const b = raw as Partial<BackupFile>;
  const errors: string[] = [];
  if (b.format !== BACKUP_FORMAT) errors.push('This JSON file is not a portal backup.');
  const s = b.state as BooksState | undefined;
  if (!s || !Array.isArray(s.transactions) || !Array.isArray(s.accounts) || !Array.isArray(s.users) || !s.settings) errors.push('The backup is missing parts of the books (transactions, accounts, users or settings).');
  if (s && s.schema !== current.schema) errors.push(`The backup is schema ${s.schema}; this portal reads schema ${current.schema}. It can't be restored here.`);
  if (s && !s.users.some((u) => u.role === 'cfo' && u.active)) errors.push('The backup has no active CFO, so nobody could manage it after restoring.');
  if (errors.length) return { ok: false, errors };
  const now = stateCounts(current), then = stateCounts(s!);
  return { ok: true, backup: b as BackupFile, preview: { exportedAt: b.exportedAt ?? '', exportedBy: b.exportedBy ?? '', company: b.company ?? '', schema: s!.schema, rows: Object.keys(now).map((label) => ({ label, current: now[label], backup: then[label] })) } };
}

export const RESTORE_WORD = 'RESTORE';

/** Replace the books with the backup (CFO only, typed confirmation). The restore is written to the restored audit log. */
export function restoreBackup(books: Books, actor: User, backup: BackupFile, confirm: string): void {
  books.require(actor, 'backup.restore', 'restore a backup');
  if (confirm.trim().toUpperCase() !== RESTORE_WORD) throw new ValidationError([`Type ${RESTORE_WORD} to confirm. Restoring replaces everything on this device.`]);
  const check = parseBackup(JSON.stringify(backup), books.state);
  if (!check.ok) throw new ValidationError(check.errors);
  const before = stateCounts(books.state);
  books.state = structuredClone(backup.state);
  books.audit(actor, { action: 'restore', objectType: 'data', objectId: 'books', summary: `Restored the books from the backup of ${backup.exportedAt.slice(0, 10)} (exported by ${backup.exportedBy})`, before, after: stateCounts(backup.state) });
  books.changed();
}

export function exportLog(state: BooksState): AuditEntry[] {
  return state.audit.filter((a) => a.action === 'export').sort((a, b) => b.at.localeCompare(a.at));
}

export function lastBackup(state: BooksState): AuditEntry | undefined {
  return exportLog(state).find((a) => /backup/i.test(a.objectId));
}

export const HOSTED_ITEMS: { item: string; plan: string }[] = [
  { item: 'Two-factor sign-in (2FA)', plan: 'Needs sign-in accounts on the hosted back end. Plan: passkeys or an authenticator app for every user, required for the CFO, bookkeeper and owner.' },
  { item: 'Encryption at rest', plan: 'Needs the hosted database. Plan: encrypted storage and encrypted nightly snapshots; on this device the books sit in the browser\'s IndexedDB, protected only by the device login.' },
  { item: 'Daily automatic backups', plan: 'Needs the hosted back end. Plan: nightly snapshots kept 30 days plus month-end snapshots kept 7 years. Until then, download a backup file below (weekly at least) and keep it off this device.' },
  { item: 'Sign-in audit and sessions', plan: 'Needs real accounts. Today "Acting as" switches roles on one device with no password, so the audit log records the role chosen, not a verified person.' },
];
export const IN_PLACE: { item: string; how: string }[] = [
  { item: 'No bank credentials stored', how: 'Bank, Gusto and QuickBooks data arrive as files you import. The portal never asks for or keeps a bank password.' },
  { item: 'Row-level store access', how: 'Store managers see and enter only their own stores; checked on every write (see the access review below).' },
  { item: 'Every export logged', how: 'Each CSV, Excel, binder or backup download writes an audit entry with who and when.' },
  { item: 'Local backup and restore', how: 'Download the full books as one JSON file; restore after a preview and typed confirmation (CFO only, audited).' },
];

export interface AccessRow { user: User; stores: string[]; storeCount: number; permissions: Permission[]; approvals: string; lastActivity?: string; actions: number; exports: number; flags: string[] }

/** Row-level access review by user: who sees which stores, what they can do, and what they did. */
export function accessReview(state: BooksState): AccessRow[] {
  const stores = state.stores.filter((s) => !s.deleted);
  return state.users.map((u) => {
    const vis = visibleStoreIds(u, stores);
    const mine = state.audit.filter((a) => a.userId === u.id);
    const perms = u.active ? permissionsFor(u.role) : [];
    const lim = LIMIT_KINDS.map((k) => ({ k, l: u.active ? limitFor(state, u.role, k) : 0 })).filter((x) => x.l !== 0);
    const flags: string[] = [];
    if (!u.active && mine.length) flags.push('Inactive: check nothing was done after they left');
    if (u.role === 'store_manager' && (u.storeIds?.length ?? 0) > 1) flags.push('Store manager with more than one store');
    if (u.role === 'store_manager' && (u.storeIds ?? []).some((s) => stores.find((x) => x.id === s)?.kind !== 'operating')) flags.push('Store manager with a non-operating location');
    if (perms.includes('export') && u.role !== 'cfo') flags.push('Can export data');
    if (lim.some((x) => x.l === null) && u.role !== 'cfo' && u.role !== 'owner') flags.push('Approves with no limit');
    return {
      user: u, stores: stores.filter((s) => vis.has(s.id)).map((s) => s.code), storeCount: vis.size, permissions: perms,
      approvals: lim.length ? lim.map((x) => `${LIMIT_LABEL[x.k]} ${x.l === null ? 'no limit' : `≤ ${money(x.l)}`}`).join(', ') : 'None',
      lastActivity: mine.map((a) => a.at).sort().at(-1), actions: mine.length, exports: mine.filter((a) => a.action === 'export').length, flags,
    };
  });
}

// ── Overview ─────────────────────────────────────────────────────────────
export interface HealthLine { key: string; label: string; status: 'ok' | 'warn' | 'bad'; value: string; detail: string; to: string }

export function controlHealth(state: BooksState, today: string, visible?: Set<ID>): HealthLine[] {
  const sod = sodConflicts(state).filter(isOpenConflict);
  const dual = dualCountRows(state, visible).filter((r) => r.status !== 'ok');
  const overdue = state.cash.bags.filter((b) => (!visible || visible.has(b.storeId)) && bagOverdue(state, b, today));
  const patterns = shortagePatterns(state, { visible, to: today });
  const signals = fraudSignals(state, { today, visible }).filter((s) => !s.dismissed);
  const fresh = signals.filter((s) => !s.escalated);
  const risks = risksDue(state, today);
  const gaps = coverageGaps(state, today);
  const ust = ustOverdue(state, today, visible);
  const release = releaseDetection(state, today, { months: 1, visible }).filter((r) => r.result === 'fail');
  const backup = lastBackup(state);
  const backupAge = backup ? daysBetween(backup.at.slice(0, 10), today) : null;
  const limits = state.controls?.limits?.length ?? 0;
  const st = (n: number, bad = false): HealthLine['status'] => (n === 0 ? 'ok' : bad ? 'bad' : 'warn');
  return [
    { key: 'limits', label: 'Approval limits', status: limits ? 'ok' : 'warn', value: limits ? `${limits} set` : 'Defaults', detail: limits ? 'Approvals above a role\'s limit are refused and name who can approve.' : 'No limits recorded: anyone with approve rights approves any amount.', to: '/controls/limits' },
    { key: 'sod', label: 'Segregation of duties', status: st(sod.length, sod.some((c) => c.type === 'activity')), value: `${sod.length} open`, detail: sod.length ? sod.slice(0, 2).map((c) => c.title).join('; ') : 'Every conflict is acknowledged with a compensating control.', to: '/controls/sod' },
    { key: 'cash', label: 'Cash controls', status: st(dual.length + overdue.length + patterns.length, overdue.length > 0), value: `${dual.length + overdue.length + patterns.length} exceptions`, detail: `${dual.length} second count${dual.length === 1 ? '' : 's'} missing or off, ${overdue.length} deposit${overdue.length === 1 ? '' : 's'} overdue, ${patterns.length} shortage pattern${patterns.length === 1 ? '' : 's'}.`, to: '/controls/cash' },
    { key: 'fraud', label: 'Fraud signals', status: st(fresh.length, signals.some((s) => s.severity === 'high')), value: `${signals.length} open`, detail: `${fresh.length} new, ${signals.length - fresh.length} escalated.`, to: '/controls/fraud' },
    { key: 'risk', label: 'Risk register & insurance', status: st(risks.length + gaps.length, gaps.length > 0), value: `${gaps.length} gap${gaps.length === 1 ? '' : 's'}`, detail: `${gaps.length ? `Coverage gaps: ${gaps.map((g) => POLICY_LABEL[g.kind]).join(', ')}. ` : 'Every required coverage is in force. '}${risks.length} risk review${risks.length === 1 ? '' : 's'} due.`, to: '/controls/risk' },
    { key: 'ust', label: 'UST compliance', status: st(ust.length + release.length, true), value: `${ust.length} overdue`, detail: `${ust.length ? ust.slice(0, 2).map((r) => `${r.label} ${UST_LABEL[r.kind].toLowerCase()}`).join('; ') + '. ' : 'Every test is current. '}${release.length} tank-month${release.length === 1 ? '' : 's'} failing release detection.`, to: '/controls/ust' },
    { key: 'backup', label: 'Backups', status: backupAge === null || backupAge > 7 ? 'warn' : 'ok', value: backup ? `${backupAge} days ago` : 'Never', detail: 'Daily automatic backups need the hosted back end; download a backup file at least weekly until then.', to: '/controls/security' },
  ];
}

export { STAGE_LABEL };
