/**
 * Phase 8 — the month-end close: a checklist per month and store with owners, due dates and status, evidence the
 * data can prove on its own, and the lock gate.
 *
 * Twelve steps (SPEC §4.13). Company-wide steps (bank, intercompany, accruals, lock) sit in the "Company" column
 * (store id `*`); the rest run per store, and a step that doesn't apply to a store (no fuel, no payroll, no rent
 * pass-through) is "not applicable".
 *
 * Status: where the data can prove a step, the status is computed — done when the proof holds, otherwise in
 * progress (or blocked, if someone said so). Nobody can mark a proved step done by hand; fix the data instead.
 * Manual steps (accruals, inventory until phase 7 plugs in) take the status people set. Lock is the last step:
 * only enabled when every other step is done, unless the CFO overrides it with a reason.
 */
import type { Books } from './books';
import { ValidationError } from './books';
import type { Attachment, BooksState, CloseItem, CloseState, CloseStatus, CloseStepKey, ID, Store, User } from './types';
import { addDays, lastDayOfPeriod, periodLabel, periodOf, shortDate, todayInChicago } from './dates';
import { formatMoney } from './money';
import { reconciledThrough } from './bank';
import { bagFlagged, bagOverdue, event } from './cash';
import { checkNotice, fuelOf, invoiceFlags, isBusinessDay, liveInvoices, noticeNet } from './fuel';
import { peopleOf, runStores } from './payroll';
import { eliminations, icState, icSummary, rentDescription } from './intercompany';
import { activeVersion, fiscalYearOf, varianceCells, type VarianceCell } from './budgets';
import { basisEntries, type BasisEntry } from './statements';

export const COMPANY = '*';
export const STATUS_LABEL: Record<CloseStatus | 'na', string> = { not_started: 'Not started', in_progress: 'In progress', done: 'Done', blocked: 'Blocked', na: 'Not applicable' };

export interface StepDef {
  key: CloseStepKey;
  n: number;
  label: string;
  scope: 'company' | 'store';
  /** The data proves it (no manual "done"). */
  auto: boolean;
  /** Screen that does the work. */
  screen: string;
  dueDays: number;
  ownerRole: 'cfo' | 'bookkeeper';
  hint: string;
}

export const STEPS: StepDef[] = [
  { key: 'sales', n: 1, label: 'Sales posted', scope: 'store', auto: true, screen: 'Books › Transactions', dueDays: 2, ownerRole: 'bookkeeper', hint: 'A POS daily close for every day the store was open, and no uncategorized income.' },
  { key: 'fuel_invoices', n: 2, label: 'Fuel invoices tied to settlement', scope: 'store', auto: true, screen: 'Fuel › Invoices & BOLs', dueDays: 5, ownerRole: 'bookkeeper', hint: 'Every delivery has its invoice, no duplicates, and each is settled (notice or Dash clearing) or not yet due.' },
  { key: 'card_fees', n: 3, label: 'Card fees posted', scope: 'store', auto: true, screen: 'Fuel › Supplier settlement', dueDays: 5, ownerRole: 'bookkeeper', hint: 'Craddock: every notice posted and netting to zero. Dash: the weekly statements posted.' },
  { key: 'bank', n: 4, label: 'Bank reconciled', scope: 'company', auto: true, screen: 'Bank › Reconcile', dueDays: 5, ownerRole: 'bookkeeper', hint: 'Every bank account reconciled through the last day of the month at a $0.00 difference.' },
  { key: 'cash', n: 5, label: 'Cash chain balanced', scope: 'store', auto: true, screen: 'Bank & cash › Cash chain', dueDays: 3, ownerRole: 'bookkeeper', hint: 'Every bag deposited, nothing overdue, and every variance reviewed.' },
  { key: 'payroll', n: 6, label: 'Payroll posted', scope: 'store', auto: true, screen: 'People › Payroll runs', dueDays: 3, ownerRole: 'bookkeeper', hint: 'Every Gusto run paid in the month posted (cash payroll: pay posted to 6100).' },
  { key: 'intercompany', n: 7, label: 'Intercompany agreed', scope: 'company', auto: true, screen: 'Intercompany › Related parties', dueDays: 7, ownerRole: 'cfo', hint: 'Each related party agreed its month-end balance with us, and the group due-to / due-from lines eliminate.' },
  { key: 'accruals', n: 8, label: 'Accruals booked', scope: 'company', auto: false, screen: 'Books › New entry', dueDays: 7, ownerRole: 'bookkeeper', hint: 'Payroll, utilities, fuel received not invoiced, interest. Manual until the GL toolkit (phase 10) adds accrual templates.' },
  { key: 'inventory', n: 9, label: 'Inventory counted', scope: 'store', auto: false, screen: 'Books › New entry', dueDays: 2, ownerRole: 'bookkeeper', hint: 'Inside and kitchen counts entered and the adjustment booked. Manual until Inside store (phase 7) plugs its counts in.' },
  { key: 'rent', n: 10, label: 'Rent pass-throughs', scope: 'store', auto: true, screen: 'Intercompany › Rent pass-throughs', dueDays: 1, ownerRole: 'bookkeeper', hint: 'The month\'s rent pass-through generated for every active template at the store.' },
  { key: 'variances', n: 11, label: 'Review P&L variances', scope: 'store', auto: true, screen: 'Budgets › Budget vs actual', dueDays: 8, ownerRole: 'cfo', hint: 'Every budget variance over the threshold has a comment.' },
  { key: 'lock', n: 12, label: 'Lock', scope: 'company', auto: true, screen: 'Close › Periods', dueDays: 10, ownerRole: 'cfo', hint: 'Lock the month once every other step is done. Unlocking needs a reason.' },
];
export const stepDef = (k: CloseStepKey) => STEPS.find((s) => s.key === k)!;

// ── Slice ────────────────────────────────────────────────────────────────
export function emptyClose(): CloseState {
  return { items: {}, config: {}, acks: [], overrides: {} };
}
const EMPTY = emptyClose();
export function closeOf(state: BooksState): CloseState {
  return state.close ?? EMPTY;
}
function ensure(books: Books): CloseState {
  if (!books.state.close) books.state.close = emptyClose();
  return books.state.close;
}
export const itemKey = (period: string, storeId: ID, step: CloseStepKey) => `${period}|${storeId}|${step}`;

// ── Evidence hooks (phase 7 plugs inventory counts in here) ──────────────
export interface Proof { ok: boolean; evidence: string[]; missing: string[]; to: string }
export type ProofHook = (state: BooksState, storeId: ID, period: string) => Proof | null;
const HOOKS: Partial<Record<CloseStepKey, ProofHook>> = {};
/** Let another module prove a manual step (e.g. inventory counts). Return null to leave the step manual. */
export function registerCloseEvidence(step: CloseStepKey, hook: ProofHook | null): void {
  if (hook) HOOKS[step] = hook; else delete HOOKS[step];
}

// ── Owners and due dates ─────────────────────────────────────────────────
export function businessDaysAfter(date: string, n: number): string {
  let d = date;
  let left = n;
  while (left > 0) { d = addDays(d, 1); if (isBusinessDay(d)) left -= 1; }
  return d;
}
export function stepConfig(state: BooksState, step: CloseStepKey): { ownerId?: ID; dueDays: number } {
  const def = stepDef(step);
  const c = closeOf(state).config[step];
  const owner = c?.ownerId ?? state.users.find((u) => u.active && u.role === def.ownerRole)?.id ?? state.users.find((u) => u.active && u.role === 'cfo')?.id;
  return { ownerId: owner, dueDays: c?.dueDays ?? def.dueDays };
}
export function dueDate(state: BooksState, period: string, step: CloseStepKey): string {
  return businessDaysAfter(lastDayOfPeriod(period), stepConfig(state, step).dueDays);
}

// ── Applicability ────────────────────────────────────────────────────────
const openIn = (s: Store, period: string) => !s.openedOn || s.openedOn <= lastDayOfPeriod(period);
export function applies(state: BooksState, step: CloseStepKey, storeId: ID, period: string, ctx?: Ctx): boolean {
  const def = stepDef(step);
  if (def.scope === 'company') return storeId === COMPANY;
  if (storeId === COMPANY) return false;
  const s = state.stores.find((x) => x.id === storeId);
  if (!s || s.deleted || !openIn(s, period)) return false;
  const op = s.kind === 'operating';
  switch (step) {
    case 'sales': case 'cash': case 'inventory': return op;
    case 'fuel_invoices': case 'card_fees': return op && s.fuelSupplier !== 'none';
    case 'payroll': return s.payroll !== 'none';
    case 'rent': return icState(state).rentTemplates.some((t) => t.storeId === storeId && t.active && t.startPeriod <= period && (!t.endPeriod || t.endPeriod >= period));
    case 'variances': return !!(ctx ?? context(state, period)).variances.some((c) => c.storeId === storeId);
    default: return false;
  }
}

// ── Proof ────────────────────────────────────────────────────────────────
interface Ctx { period: string; today: string; d0: string; d1: string; variances: VarianceCell[]; hasBudget: boolean }
function context(state: BooksState, period: string, today = todayInChicago(), entries?: BasisEntry[]): Ctx {
  const hasBudget = !!activeVersion(state, fiscalYearOf(state, period));
  return {
    period, today, d0: `${period}-01`, d1: lastDayOfPeriod(period), hasBudget,
    variances: hasBudget ? varianceCells(state, { from: period, to: period, storeIds: state.stores.map((s) => s.id), entries: entries ?? basisEntries(state) }) : [],
  };
}
const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
const $ = (c: number) => formatMoney(c, { dollarSign: true });

export function proveStep(state: BooksState, step: CloseStepKey, storeId: ID, period: string, ctx: Ctx = context(state, period)): Proof | null {
  const hook = HOOKS[step];
  if (hook) { const p = hook(state, storeId, period); if (p) return p; }
  const { d0, d1 } = ctx;
  const store = state.stores.find((s) => s.id === storeId);
  switch (step) {
    case 'sales': {
      const from = store?.openedOn && store.openedOn > d0 ? store.openedOn : d0;
      const yesterday = addDays(ctx.today, -1);
      const to = d1 < yesterday ? d1 : yesterday;
      const days: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
      const posted = new Set(state.transactions.filter((t) => !t.deleted && t.tags.includes('pos') && t.date >= d0 && t.date <= d1 && t.lines.some((l) => l.storeId === storeId)).map((t) => t.date));
      const missingDays = days.filter((d) => !posted.has(d));
      const uncat = state.transactions.filter((t) => !t.deleted && t.date >= d0 && t.date <= d1 && t.lines.some((l) => l.storeId === storeId && l.accountId === 'acct_uncat_income')).length;
      const missing = [
        ...(missingDays.length ? [`No POS close for ${missingDays.length > 3 ? `${missingDays.length} days (first ${shortDate(missingDays[0])})` : missingDays.map(shortDate).join(', ')}.`] : []),
        ...(uncat ? [`${n(uncat, 'entry')} with uncategorized income.`] : []),
      ];
      return { ok: !missing.length && days.length > 0, evidence: [`${posted.size} of ${days.length} days have a POS daily close.`], missing, to: `/books/transactions?store=${storeId}&from=${d0}&to=${d1}&q=POS` };
    }
    case 'fuel_invoices': {
      const flags = invoiceFlags(state, ctx.today);
      const inv = liveInvoices(state).filter((i) => i.storeId === storeId && i.deliveredOn >= d0 && i.deliveredOn <= d1);
      const noInvoice = inv.filter((i) => flags.get(i.id)?.missingInvoice);
      const dups = inv.filter((i) => flags.get(i.id)?.duplicateOf);
      const good = inv.filter((i) => !noInvoice.includes(i) && !dups.includes(i));
      const settled = good.filter((i) => i.settlement);
      const notDue = good.filter((i) => !i.settlement && i.dueOn > d1);
      const open = good.filter((i) => !i.settlement && i.dueOn <= d1);
      const notices = fuelOf(state).notices.filter((x) => x.storeId === storeId && x.noticeDate >= d0 && x.noticeDate <= d1);
      const noticeMissing = notices.flatMap((x) => checkNotice(state, x).invoices.filter((c) => !c.invoice));
      const missing = [
        ...(noInvoice.length ? [`${n(noInvoice.length, 'delivery')} with no invoice (BOL ${noInvoice.map((i) => i.bolNo).join(', ')}).`] : []),
        ...(dups.length ? [`${n(dups.length, 'possible duplicate')} to clear.`] : []),
        ...(open.length ? [`${n(open.length, 'invoice')} due in the month but not settled (${open.map((i) => i.invoiceNo).join(', ')}).`] : []),
        ...(noticeMissing.length ? [`${n(noticeMissing.length, 'notice line')} with no invoice on file.`] : []),
      ];
      return { ok: !missing.length, evidence: [`${n(inv.length, 'delivery')}: ${settled.length} settled, ${notDue.length} due after month end.`], missing, to: `/fuel/invoices${missing.length ? '?show=flagged' : ''}` };
    }
    case 'card_fees': {
      const fees = state.transactions.filter((t) => !t.deleted && t.date >= d0 && t.date <= d1).reduce((a, t) => a + t.lines.filter((l) => l.storeId === storeId && (l.accountId === 'acct_card_fees' || l.accountId === 'acct_network_fees')).reduce((x, l) => x + l.debit - l.credit, 0), 0);
      if (store?.fuelSupplier === 'craddock') {
        const notices = fuelOf(state).notices.filter((x) => x.storeId === storeId && x.noticeDate >= d0 && x.noticeDate <= d1);
        const unposted = notices.filter((x) => x.status !== 'posted');
        const off = notices.filter((x) => noticeNet(x) !== 0);
        const missing = [
          ...(!notices.length ? ['No Craddock notice for the month yet.'] : []),
          ...(unposted.length ? [`${n(unposted.length, 'notice')} not posted (${unposted.map((x) => x.noticeNo).join(', ')}).`] : []),
          ...(off.length ? [`${n(off.length, 'notice')} not netting to zero.`] : []),
        ];
        return { ok: !missing.length, evidence: [`${notices.length - unposted.length} of ${n(notices.length, 'notice')} posted, each netting to zero; ${$(fees)} card and network fees.`], missing, to: '/fuel/settlement' };
      }
      const st = fuelOf(state).dashSettlements.filter((x) => x.storeId === storeId && x.date >= d0 && x.date <= d1);
      const missing = st.length ? [] : ['No Dash statement posted for the month yet.'];
      return { ok: !missing.length, evidence: [`${n(st.length, 'Dash statement')} posted; ${$(fees)} card and network fees.`], missing, to: '/fuel/settlement?tab=dash' };
    }
    case 'bank': {
      const accts = state.accounts.filter((a) => a.subtype === 'bank' && a.active && (state.bank.lines.some((b) => b.accountId === a.id) || a.id === 'acct_trustmark'));
      const rows = accts.map((a) => ({ a, through: reconciledThrough(state, a.id) }));
      const behind = rows.filter((r) => !r.through || r.through < d1);
      return {
        ok: !behind.length,
        evidence: rows.map((r) => `${r.a.name} reconciled through ${r.through ? shortDate(r.through) : 'never'}${r.through && r.through >= d1 ? ' at a $0.00 difference' : ''}.`),
        missing: behind.map((r) => `${r.a.name} not reconciled through ${shortDate(d1)}.`), to: '/bank?tab=reconcile',
      };
    }
    case 'cash': {
      const bags = state.cash.bags.filter((b) => b.storeId === storeId && b.businessDate >= d0 && b.businessDate <= d1);
      const flagged = bags.filter((b) => bagFlagged(state, b));
      const unreviewed = flagged.filter((b) => !b.reviewed);
      const overdue = bags.filter((b) => bagOverdue(state, b, ctx.today));
      const undeposited = bags.filter((b) => !event(b, 'deposit'));
      const missing = [
        ...(unreviewed.length ? [`${n(unreviewed.length, 'variance')} not reviewed (${unreviewed.map((b) => shortDate(b.businessDate)).join(', ')}).`] : []),
        ...(overdue.length ? [`${n(overdue.length, 'bag')} picked up but not deposited in time.`] : []),
        ...(undeposited.length && !overdue.length ? [`${n(undeposited.length, 'bag')} not deposited yet.`] : []),
      ];
      return { ok: !missing.length && bags.length > 0, evidence: [`${n(bags.length, 'bag')}, ${bags.length - undeposited.length} deposited; ${flagged.length - unreviewed.length} of ${n(flagged.length, 'variance')} reviewed.`], missing: bags.length ? missing : ['No cash counted in the month.'], to: `/cash?show=${unreviewed.length ? 'flagged' : overdue.length ? 'overdue' : 'flagged'}` };
    }
    case 'payroll': {
      const runs = peopleOf(state).runs.filter((r) => r.payDate >= d0 && r.payDate <= d1 && runStores(r).includes(storeId));
      const unposted = runs.filter((r) => r.status !== 'posted');
      if (store?.payroll === 'cash' || (!runs.length && store?.payroll === 'mixed')) {
        const wages = state.transactions.filter((t) => !t.deleted && t.date >= d0 && t.date <= d1).reduce((a, t) => a + t.lines.filter((l) => l.storeId === storeId && l.accountId === 'acct_wages').reduce((x, l) => x + l.debit - l.credit, 0), 0);
        return { ok: wages > 0, evidence: [`${$(wages)} cash payroll posted to 6100.`], missing: wages > 0 ? [] : ['No cash payroll posted for the month.'], to: '/people/cash-pay' };
      }
      const missing = [
        ...(!runs.length ? ['No Gusto run paid in the month.'] : []),
        ...(unposted.length ? [`${n(unposted.length, 'run')} imported but not posted (${unposted.map((r) => shortDate(r.payDate)).join(', ')}).`] : []),
      ];
      return { ok: !missing.length, evidence: [`${runs.length - unposted.length} of ${n(runs.length, 'Gusto run')} posted${runs.length ? ` (${runs.map((r) => shortDate(r.payDate).replace(/, \d{4}$/, '')).join(', ')})` : ''}.`], missing, to: unposted.length ? `/people/review` : '/people/runs' };
    }
    case 'intercompany': {
      const ic = intercompanyAgreement(state, period);
      const missing = [
        ...ic.rows.filter((r) => !r.agreed).map((r) => `${r.name}: ${$(r.balance)} ${r.ack ? `changed since agreed at ${$(r.ack.balance)}` : 'not agreed yet'}.`),
        ...(ic.eliminates ? [] : ['Group due-to / due-from lines do not eliminate; see the elimination view.']),
      ];
      return { ok: !missing.length, evidence: [`${ic.rows.filter((r) => r.agreed).length} of ${n(ic.rows.length, 'related-party balance')} agreed${ic.eliminates ? '; group due-to / due-from eliminate to $0.00' : ''}.`], missing, to: '/intercompany/parties' };
    }
    case 'rent': {
      const ts = icState(state).rentTemplates.filter((t) => t.storeId === storeId && t.active && t.startPeriod <= period && (!t.endPeriod || t.endPeriod >= period));
      const live = (id?: ID) => { const tx = id ? state.transactions.find((x) => x.id === id) : undefined; return tx && !tx.deleted ? tx : undefined; };
      const done = ts.filter((t) => live(t.generated[period]));
      return {
        ok: done.length === ts.length && ts.length > 0,
        evidence: done.map((t) => `${rentDescription(state, t)}: ${$(t.amount)} (${live(t.generated[period])!.ref}).`),
        missing: ts.filter((t) => !done.includes(t)).map((t) => `${rentDescription(state, t)} not generated.`), to: '/intercompany/rent',
      };
    }
    case 'variances': {
      if (!ctx.hasBudget) return null;
      const mine = ctx.variances.filter((c) => c.storeId === storeId && c.over);
      const open = mine.filter((c) => !c.comments.length);
      return { ok: !open.length, evidence: [`${n(mine.length, 'variance')} over the threshold, ${mine.length - open.length} explained.`], missing: open.map((c) => `${c.account.name}: ${$(c.variance)} vs budget, no comment.`), to: `/budgets/bva?month=${period}&store=${storeId}` };
    }
    case 'lock': {
      const locked = state.periods[period]?.status === 'locked';
      const o = closeOf(state).overrides[period];
      return { ok: locked, evidence: locked ? [`Locked ${state.periods[period].lockedAt ? shortDate(state.periods[period].lockedAt!.slice(0, 10)) : ''}${o ? ` with an override: ${o.reason}` : ''}.`] : [], missing: locked ? [] : ['Not locked.'], to: '/close/periods' };
    }
    default: return null;
  }
}

/** Link to the screen that does the step. */
export function stepLink(step: CloseStepKey, storeId: ID, period: string, proof: Proof | null): string {
  if (proof) return proof.to;
  if (step === 'accruals' || step === 'inventory') return `/books/new?kind=journal&date=${lastDayOfPeriod(period)}`;
  if (step === 'variances') return `/budgets/bva?month=${period}${storeId !== COMPANY ? `&store=${storeId}` : ''}`;
  return '/close';
}

// ── Intercompany agreement ───────────────────────────────────────────────
export interface IcAgreeRow { id: ID; name: string; balance: number; ack?: { balance: number; by: ID; at: string; note?: string }; agreed: boolean }
export function intercompanyAgreement(state: BooksState, period: string): { rows: IcAgreeRow[]; eliminates: boolean } {
  const asOf = lastDayOfPeriod(period);
  const sum = icSummary(state, asOf);
  const acks = closeOf(state).acks.filter((a) => a.period === period);
  const rows = sum.parties.filter((p) => p.balance !== 0).map((p) => {
    const ack = acks.filter((a) => a.counterpartyId === p.id).at(-1);
    return { id: p.id, name: p.name, balance: p.balance, ack: ack && { balance: ack.balance, by: ack.by, at: ack.at, note: ack.note }, agreed: !!ack && ack.balance === p.balance };
  });
  return { rows, eliminates: eliminations(state, asOf).ok };
}

export function acknowledgeBalance(books: Books, actor: User, x: { period: string; counterpartyId: ID; note?: string }): void {
  books.require(actor, 'close.edit', 'record intercompany agreements');
  assertOpen(books.state, x.period);
  const row = intercompanyAgreement(books.state, x.period).rows.find((r) => r.id === x.counterpartyId);
  if (!row) throw new ValidationError(['That party has no balance at month end; nothing to agree.']);
  const ack = { id: books.nextId('ack'), period: x.period, counterpartyId: x.counterpartyId, balance: row.balance, note: x.note?.trim() || undefined, by: actor.id, at: books.clock() };
  ensure(books).acks.push(ack);
  books.audit(actor, { action: 'agree', objectType: 'close', objectId: `${x.period}|${x.counterpartyId}`, summary: `${row.name} agreed ${$(row.balance)} at ${shortDate(lastDayOfPeriod(x.period))}`, after: ack });
  books.changed();
}

// ── The checklist ────────────────────────────────────────────────────────
export type CellStatus = CloseStatus | 'na';
export interface ChecklistCell {
  step: CloseStepKey;
  storeId: ID;
  status: CellStatus;
  /** Status comes from the data. */
  auto: boolean;
  proof: Proof | null;
  item?: CloseItem;
  ownerId?: ID;
  due: string;
  overdue: boolean;
  to: string;
}
export interface Checklist {
  period: string;
  columns: { id: ID; label: string; title: string }[];
  rows: { def: StepDef; cells: ChecklistCell[] }[];
  counts: Record<CellStatus, number>;
  /** Cells (other than lock) that are applicable and not done. */
  open: ChecklistCell[];
  ready: boolean;
  locked: boolean;
  lockDue: string;
  override?: { by: ID; at: string; reason: string; open: string[] };
}

export function closeChecklist(state: BooksState, period: string, opts: { today?: string; storeIds?: ID[]; entries?: BasisEntry[] } = {}): Checklist {
  const today = opts.today ?? todayInChicago();
  const ctx = context(state, period, today, opts.entries);
  const want = opts.storeIds ? new Set(opts.storeIds) : null;
  const stores = state.stores.filter((s) => !s.deleted && (!want || want.has(s.id)));
  const columns = [{ id: COMPANY, label: 'Company', title: 'Company-wide' }, ...stores.map((s) => ({ id: s.id, label: s.code, title: s.name }))];
  const c = closeOf(state);
  const locked = state.periods[period]?.status === 'locked';
  const rows = STEPS.map((def) => ({
    def,
    cells: columns.map((col): ChecklistCell => {
      const item = c.items[itemKey(period, col.id, def.key)];
      const due = dueDate(state, period, def.key);
      const ownerId = item?.ownerId ?? stepConfig(state, def.key).ownerId;
      if (!applies(state, def.key, col.id, period, ctx)) return { step: def.key, storeId: col.id, status: 'na', auto: false, proof: null, item, ownerId, due, overdue: false, to: '' };
      const proof = def.key === 'lock' ? null : proveStep(state, def.key, col.id, period, ctx);
      let status: CloseStatus;
      if (proof) status = proof.ok ? 'done' : item?.status === 'blocked' ? 'blocked' : 'in_progress';
      else status = item?.status ?? 'not_started';
      return { step: def.key, storeId: col.id, status, auto: !!proof, proof, item, ownerId, due, overdue: status !== 'done' && due < today, to: stepLink(def.key, col.id, period, proof) };
    }),
  }));
  const open = rows.filter((r) => r.def.key !== 'lock').flatMap((r) => r.cells.filter((x) => x.status !== 'na' && x.status !== 'done'));
  const lockRow = rows.find((r) => r.def.key === 'lock')!;
  const lockCell = lockRow.cells[0];
  const lockProof = proveStep(state, 'lock', COMPANY, period, ctx);
  lockCell.proof = lockProof;
  lockCell.auto = true;
  lockCell.status = locked ? 'done' : !open.length ? 'in_progress' : lockCell.item?.status === 'blocked' ? 'blocked' : 'not_started';
  lockCell.overdue = !locked && lockCell.due < today;
  lockCell.to = '/close/periods';
  const counts: Record<CellStatus, number> = { not_started: 0, in_progress: 0, done: 0, blocked: 0, na: 0 };
  for (const r of rows) for (const x of r.cells) counts[x.status] += 1;
  return { period, columns, rows, counts, open, ready: !open.length, locked, lockDue: lockCell.due, override: c.overrides[period] };
}

/** A sentence naming one checklist cell. */
export function cellName(state: BooksState, x: Pick<ChecklistCell, 'step' | 'storeId'>): string {
  const d = stepDef(x.step);
  return `${d.n}. ${d.label}${x.storeId === COMPANY ? '' : ` · ${state.stores.find((s) => s.id === x.storeId)?.code ?? x.storeId}`}`;
}

// ── Writes ───────────────────────────────────────────────────────────────
function assertOpen(state: BooksState, period: string): void {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new ValidationError(['Pick the month to close, as YYYY-MM.']);
  if (state.periods[period]?.status === 'locked') throw new ValidationError([`${periodLabel(period)} is locked. Unlock it from Close › Periods (with a reason) before changing its checklist.`]);
}

export function setCloseStep(books: Books, actor: User, x: { period: string; storeId: ID; step: CloseStepKey; status?: CloseStatus; ownerId?: ID; note?: string }): CloseItem {
  books.require(actor, 'close.edit', 'work the close checklist');
  const state = books.state;
  assertOpen(state, x.period);
  const errs: string[] = [];
  if (!applies(state, x.step, x.storeId, x.period)) errs.push(`${cellName(state, x)} doesn't apply to this ${x.storeId === COMPANY ? 'column' : 'store'}.`);
  if (x.step === 'lock' && x.status === 'done') errs.push('Lock the month with the Lock button; it checks every other step first.');
  if (x.ownerId && !state.users.some((u) => u.id === x.ownerId && u.active)) errs.push('Pick an active user as the owner.');
  if (x.status === 'blocked' && !(x.note ?? closeOf(state).items[itemKey(x.period, x.storeId, x.step)]?.note)?.trim()) errs.push('Say what the step is waiting on in the note, so the owner knows how to unblock it.');
  if (x.status === 'done' && x.step !== 'lock') {
    const p = proveStep(state, x.step, x.storeId, x.period);
    if (p && !p.ok) errs.push(`The data doesn't show this yet: ${p.missing.join(' ')} Fix it on ${stepDef(x.step).screen}, or mark the step blocked with a note.`);
  }
  if (errs.length) throw new ValidationError(errs);
  const c = ensure(books);
  const k = itemKey(x.period, x.storeId, x.step);
  const before = c.items[k] ? structuredClone(c.items[k]) : undefined;
  const item: CloseItem = c.items[k] ?? { period: x.period, storeId: x.storeId, step: x.step, status: 'not_started', attachments: [] };
  if (x.status) item.status = x.status;
  if (x.ownerId !== undefined) item.ownerId = x.ownerId || undefined;
  if (x.note !== undefined) item.note = x.note.trim() || undefined;
  item.updatedBy = actor.id;
  item.updatedAt = books.clock();
  c.items[k] = item;
  books.audit(actor, { action: 'update', objectType: 'close', objectId: k, summary: `${periodLabel(x.period)} close: ${cellName(state, x)}${x.status ? ` → ${STATUS_LABEL[x.status]}` : ''}`, before, after: structuredClone(item) });
  books.changed();
  return item;
}

export function addCloseEvidence(books: Books, actor: User, x: { period: string; storeId: ID; step: CloseStepKey; attachment: Attachment }): void {
  books.require(actor, 'close.edit', 'attach close evidence');
  assertOpen(books.state, x.period);
  const c = ensure(books);
  const k = itemKey(x.period, x.storeId, x.step);
  const item: CloseItem = c.items[k] ?? { period: x.period, storeId: x.storeId, step: x.step, status: 'not_started', attachments: [] };
  item.attachments.push(x.attachment);
  c.items[k] = item;
  books.audit(actor, { action: 'attach', objectType: 'close', objectId: k, summary: `Attached ${x.attachment.name} to ${cellName(books.state, x)} (${periodLabel(x.period)})` });
  books.changed();
}

export function setStepConfig(books: Books, actor: User, step: CloseStepKey, x: { ownerId?: ID; dueDays: number }): void {
  books.require(actor, 'close.edit', 'change close owners and due dates');
  if (!Number.isInteger(x.dueDays) || x.dueDays < 0 || x.dueDays > 30) throw new ValidationError(['Due dates are 0 to 30 business days after month end.']);
  if (x.ownerId && !books.state.users.some((u) => u.id === x.ownerId && u.active)) throw new ValidationError(['Pick an active user as the owner.']);
  const c = ensure(books);
  const before = c.config[step];
  c.config[step] = { ownerId: x.ownerId || undefined, dueDays: x.dueDays };
  books.audit(actor, { action: 'update', objectType: 'close', objectId: `config:${step}`, summary: `Close step "${stepDef(step).label}": due ${x.dueDays} business days after month end`, before, after: c.config[step] });
  books.changed();
}

/**
 * Lock a month through the gate: every other step must be done. The CFO can override with a reason, which is kept
 * with the month (and in the audit log) along with the steps that were still open.
 */
export function lockMonth(books: Books, actor: User, period: string, opts: { override?: string; today?: string } = {}): void {
  books.require(actor, 'period.lock', 'lock a month');
  const today = opts.today ?? todayInChicago();
  const state = books.state;
  if (state.periods[period]?.status === 'locked') return;
  if (period >= periodOf(today)) throw new ValidationError([`${periodLabel(period)} isn't over yet. Lock it once the month has ended.`]);
  const cl = closeChecklist(state, period, { today });
  if (!cl.ready) {
    if (!opts.override?.trim()) {
      throw new ValidationError([`${n(cl.open.length, 'step')} still open: ${cl.open.slice(0, 4).map((x) => cellName(state, x)).join('; ')}${cl.open.length > 4 ? '…' : ''}. Finish them on the checklist, or override with a reason.`]);
    }
    ensure(books).overrides[period] = { by: actor.id, at: books.clock(), reason: opts.override.trim(), open: cl.open.map((x) => cellName(state, x)) };
    books.audit(actor, { action: 'override', objectType: 'close', objectId: period, summary: `Locked ${periodLabel(period)} with ${n(cl.open.length, 'step')} open`, reason: opts.override.trim(), after: ensure(books).overrides[period] });
  }
  books.lockPeriod(actor, period);
}

export function unlockMonth(books: Books, actor: User, period: string, reason: string): void {
  books.unlockPeriod(actor, period, reason);
}

// ── Inbox ────────────────────────────────────────────────────────────────
/** Months to watch: past months with activity that aren't locked. */
export function openPastMonths(state: BooksState, today = todayInChicago()): string[] {
  const cur = periodOf(today);
  const ms = new Set<string>();
  for (const t of state.transactions) if (!t.deleted && t.kind !== 'opening') ms.add(periodOf(t.date));
  return [...ms].filter((p) => p < cur && state.periods[p]?.status !== 'locked').sort();
}

export interface CloseInbox { overdue: { period: string; cell: ChecklistCell }[]; pastDue: string[] }
export function closeInbox(state: BooksState, opts: { today?: string; storeIds?: ID[]; entries?: BasisEntry[] } = {}): CloseInbox {
  const today = opts.today ?? todayInChicago();
  const overdue: CloseInbox['overdue'] = [];
  const pastDue: string[] = [];
  for (const p of openPastMonths(state, today)) {
    const cl = closeChecklist(state, p, { today, storeIds: opts.storeIds, entries: opts.entries });
    for (const r of cl.rows) for (const cell of r.cells) if (cell.overdue && r.def.key !== 'lock') overdue.push({ period: p, cell });
    if (!cl.locked && cl.lockDue < today) pastDue.push(p);
  }
  return { overdue, pastDue };
}
