import type { Books } from './books';
import { ValidationError } from './books';
import type { Account, AccountRecon, Attachment, BooksState, ID, User } from './types';
import { normalSign, SYS } from './ledger';
import { addDays, daysBetween, lastDayOfPeriod, periodOf } from './dates';
import { flatLines, type FlatLine } from './reports';
import { craddockReceivable } from './fuel';
import { fuelOf } from './fuel';
import { partyAccountTotals } from './intercompany';
import { billTotal, openBills, vendorName } from './payables';
import { peopleOf, payWeek, weekStart } from './payroll';
import { glOf, glWrite } from './journals';
import { formatMoney, type Cents } from './money';

export type SupportKind = 'bank' | 'craddock' | 'dash' | 'party' | 'entity' | 'ap' | 'payroll' | 'manual';

export const SUPPORT_LABEL: Record<SupportKind, string> = {
  bank: 'Bank reconciliation', craddock: 'Craddock notices (fuel)', dash: 'Dash clearing (fuel)', party: 'Related-party ledgers', entity: 'Entity due-to / due-from',
  ap: 'Open bills (payables)', payroll: 'Payroll accrual from pay runs', manual: 'Entered by hand with its document',
};

export const PAYROLL_ACCTS = { wages: 'acct_accrued_payroll', taxes: 'acct_payroll_tax' } as const;

/** Accounts reconciled every month: every active balance-sheet account except retained earnings (it rolls forward from the P&L). */
export function reconAccounts(state: BooksState): Account[] {
  return state.accounts.filter((a) => a.active && ['asset', 'liability', 'equity'].includes(a.type) && a.id !== SYS.retained)
    .sort((a, b) => a.number.localeCompare(b.number));
}

/** Where an account's support comes from: a subledger where one exists, otherwise a balance entered by hand. */
export function supportKind(a: Account): SupportKind {
  if (a.subtype === 'bank') return 'bank';
  if (a.id === 'acct_craddock') return 'craddock';
  if (a.id === 'acct_dash') return 'dash';
  if (a.id === SYS.dueFrom || a.id === SYS.dueTo) return 'entity';
  if (a.id === 'acct_loans_related' || a.id === 'acct_paid_for_related' || a.id === 'acct_due_related') return 'party';
  if (a.id === 'acct_ap') return 'ap';
  if (a.id === PAYROLL_ACCTS.wages || a.id === PAYROLL_ACCTS.taxes) return 'payroll';
  return 'manual';
}

export interface SupportDetail { label: string; amount: Cents }
export interface Support {
  kind: SupportKind;
  /** Natural sign, like the GL balance. Null when it isn't available yet (no bank rec, nothing entered). */
  amount: Cents | null;
  detail: SupportDetail[];
  /** What to do when the amount is missing, or where the support lives. */
  note?: string;
  to?: string;
}

/** Payroll earned by `asOf` but paid on the next Friday: the days of the pay week worked so far ÷ 7 × that week's pay, per store. */
export function payrollAccrual(state: BooksState, asOf: string): { storeId: ID; wages: Cents; taxes: Cents; days: number; week: string }[] {
  const week = payWeek(asOf);
  if (week === asOf) return [];
  const days = daysBetween(weekStart(week), asOf) + 1;
  const ppl = peopleOf(state);
  const weeks = [...new Set(ppl.runs.map((r) => payWeek(r.payDate)))].filter((w) => w <= week).sort();
  const basis = weeks.includes(week) ? week : weeks.at(-1);
  if (!basis) return [];
  const by = new Map<ID, { wages: number; taxes: number }>();
  const get = (s: ID) => { let x = by.get(s); if (!x) { x = { wages: 0, taxes: 0 }; by.set(s, x); } return x; };
  for (const r of ppl.runs) {
    if (payWeek(r.payDate) !== basis) continue;
    for (const l of r.lines) { const x = get(l.storeId); x.wages += l.net; x.taxes += l.employeeTaxes + l.employerTaxes; }
  }
  for (const o of ppl.offPayroll) {
    if (payWeek(o.payDate) !== basis) continue;
    const e = ppl.employees.find((x) => x.id === o.employeeId);
    if (e) get(e.storeId).wages += o.amount;
  }
  return [...by].map(([storeId, x]) => ({ storeId, wages: Math.round((x.wages * days) / 7), taxes: Math.round((x.taxes * days) / 7), days, week: basis }))
    .filter((x) => x.wages || x.taxes).sort((a, b) => a.storeId.localeCompare(b.storeId));
}

function code(state: BooksState, storeId: ID): string {
  return state.stores.find((s) => s.id === storeId)?.code ?? storeId;
}

/** The support balance for an account at a month end, computed from its subledger, or the manual entry. */
export function computeSupport(state: BooksState, a: Account, period: string, recon?: AccountRecon): Support {
  const asOf = lastDayOfPeriod(period);
  const kind = supportKind(a);
  const sign = normalSign(a);
  switch (kind) {
    case 'bank': {
      const rec = state.bank.reconciliations.find((r) => r.accountId === a.id && r.statementDate === asOf);
      if (!rec) return { kind, amount: null, detail: [], note: `No bank reconciliation saved at ${asOf}. Reconcile the statement first.`, to: '/bank?tab=reconcile' };
      return { kind, amount: rec.statementBalance + rec.bookOnly - rec.bankOnly, to: '/bank?tab=reconcile', detail: [
        { label: `Statement balance ${asOf}`, amount: rec.statementBalance },
        { label: 'Book-only items (outstanding checks, deposits in transit)', amount: rec.bookOnly },
        { label: 'Bank-only items (not in the books at the date)', amount: -rec.bankOnly },
      ] };
    }
    case 'craddock': {
      const stores = state.stores.filter((s) => s.fuelSupplier === 'craddock' && !s.deleted);
      const ties = stores.map((s) => craddockReceivable(state, s.id, asOf));
      return { kind, amount: ties.reduce((x, t) => x + t.explained, 0), to: '/fuel/settlement', detail: ties.map((t) => ({ label: `${code(state, t.storeId)}: opening + card sales − posted notices (${t.openBatches.length} open batches)`, amount: t.explained })) };
    }
    case 'dash': {
      const f = fuelOf(state);
      const by = new Map<ID, number>();
      const add = (s: ID, v: number) => by.set(s, (by.get(s) ?? 0) + v);
      for (const t of state.transactions) {
        if (t.deleted || t.date > asOf) continue;
        if (t.kind !== 'opening' && !t.tags.includes('pos')) continue;
        for (const l of t.lines) if (l.accountId === a.id) add(l.storeId, l.debit - l.credit);
      }
      const live = new Set(state.transactions.filter((t) => !t.deleted).map((t) => t.id));
      for (const i of f.invoices) if (!i.deleted && i.settlement?.kind === 'dash_clearing' && i.settlement.on <= asOf && live.has(i.settlement.txnId)) add(i.storeId, -i.total);
      for (const d of f.dashSettlements) if (d.date <= asOf && live.has(d.txnId)) add(d.storeId, -(d.cardFees + d.networkFees + d.remit));
      return { kind, amount: [...by.values()].reduce((x, v) => x + v, 0), to: '/fuel/settlement?tab=dash', detail: [...by].sort().map(([s, v]) => ({ label: `${code(state, s)}: card proceeds in − invoices paid − weekly statements`, amount: v })) };
    }
    case 'party': {
      const row = partyAccountTotals(state, asOf).find((r) => r.accountId === a.id);
      return { kind, amount: sign * (row?.parties ?? 0), to: '/intercompany/parties', detail: [{ label: 'Party ledgers on this account', amount: sign * (row?.parties ?? 0) }],
        note: row?.untagged ? `${formatMoney(sign * row.untagged, { dollarSign: true })} on this account has no related party. Tag the lines with their party.` : undefined };
    }
    case 'entity': {
      const entOf = new Map(state.stores.map((s) => [s.id, s.entityId]));
      const ents = new Map(state.entities.map((e) => [e.id, e.code]));
      const by = new Map<string, number>();
      for (const t of state.transactions) {
        if (t.deleted || t.date > asOf) continue;
        for (const l of t.lines) {
          if (l.accountId !== a.id || l.system !== 'intercompany' || !l.counterEntityId) continue;
          const k = `${ents.get(entOf.get(l.storeId) ?? '')} with ${ents.get(l.counterEntityId)}`;
          by.set(k, (by.get(k) ?? 0) + sign * (l.debit - l.credit));
        }
      }
      return { kind, amount: [...by.values()].reduce((x, v) => x + v, 0), to: '/intercompany/eliminations', detail: [...by].sort().map(([label, amount]) => ({ label, amount })) };
    }
    case 'ap': {
      const bills = openBills(state, asOf);
      const by = new Map<string, number>();
      for (const b of bills) by.set(vendorName(state, b.vendorId), (by.get(vendorName(state, b.vendorId)) ?? 0) + billTotal(b));
      return { kind, amount: bills.reduce((x, b) => x + billTotal(b), 0), to: '/payables/aging', detail: [...by].sort().map(([label, amount]) => ({ label: `${label} (open bills)`, amount })) };
    }
    case 'payroll': {
      const acc = payrollAccrual(state, asOf);
      const k = a.id === PAYROLL_ACCTS.wages ? 'wages' : 'taxes';
      return { kind, amount: acc.reduce((x, r) => x + r[k], 0), to: '/people/runs',
        note: acc.length ? `${acc[0].days} of 7 days of the pay week ending ${acc[0].week} were worked by ${asOf}.` : `${asOf} is a pay date, so nothing is owed for the week.`,
        detail: acc.map((r) => ({ label: `${code(state, r.storeId)}: ${r.days}/7 of week ${r.week} ${k === 'wages' ? 'net pay' : 'payroll taxes'}`, amount: r[k] })) };
    }
    default: {
      if (!recon?.manual) return { kind, amount: null, detail: [], note: a.subtype === 'loan' || a.subtype === 'fixed_asset' ? 'Enter the balance from the loan statement or the asset register, and attach it. (Computed from the schedules once Phase 9 merges.)' : 'Enter the balance from the supporting document and attach it.' };
      return { kind, amount: recon.manual.amount, detail: [{ label: recon.manual.note, amount: recon.manual.amount }] };
    }
  }
}

export type ReconStatus = 'not_needed' | 'open' | 'prepared' | 'reviewed' | 'stale';
export const RECON_STATUS_LABEL: Record<ReconStatus, string> = { not_needed: 'Nothing to reconcile', open: 'To prepare', prepared: 'Awaiting review', reviewed: 'Signed off', stale: 'GL changed after sign-off' };

export interface ReconRow {
  account: Account;
  period: string;
  asOf: string;
  gl: Cents;
  activity: number;
  support: Support;
  difference: Cents | null;
  recon?: AccountRecon;
  status: ReconStatus;
}

export function getRecon(state: BooksState, accountId: ID, period: string): AccountRecon | undefined {
  return glOf(state).recons.find((r) => r.accountId === accountId && r.period === period);
}

/** Natural-sign GL balances at a date and line counts in the month, for every account. */
function glBalances(period: string, lines: FlatLine[]): { bal: Map<ID, number>; act: Map<ID, number> } {
  const asOf = lastDayOfPeriod(period);
  const bal = new Map<ID, number>();
  const act = new Map<ID, number>();
  for (const f of lines) {
    if (f.date > asOf) continue;
    bal.set(f.l.accountId, (bal.get(f.l.accountId) ?? 0) + f.l.debit - f.l.credit);
    if (f.period === period) act.set(f.l.accountId, (act.get(f.l.accountId) ?? 0) + 1);
  }
  return { bal, act };
}

function statusOf(gl: number, activity: number, support: Support, recon?: AccountRecon): ReconStatus {
  if (recon?.prepared) {
    if (recon.prepared.gl !== gl || (support.amount !== null && support.amount !== recon.prepared.support)) return 'stale';
    if (recon.reviewed && recon.reviewed.gl === gl) return 'reviewed';
    return 'prepared';
  }
  if (gl === 0 && activity === 0 && (support.amount === null || support.amount === 0)) return 'not_needed';
  return 'open';
}

/** Every balance-sheet account for a month: GL, support, difference and sign-off status. */
export function reconList(state: BooksState, period: string, opts: { lines?: FlatLine[] } = {}): ReconRow[] {
  const lines = opts.lines ?? flatLines(state);
  const { bal, act } = glBalances(period, lines);
  return reconAccounts(state).map((a) => {
    const gl = normalSign(a) * (bal.get(a.id) ?? 0);
    const recon = getRecon(state, a.id, period);
    const support = computeSupport(state, a, period, recon);
    const activity = act.get(a.id) ?? 0;
    return { account: a, period, asOf: lastDayOfPeriod(period), gl, activity, support, difference: support.amount === null ? null : gl - support.amount, recon, status: statusOf(gl, activity, support, recon) };
  });
}

export function reconRow(state: BooksState, accountId: ID, period: string, lines?: FlatLine[]): ReconRow | undefined {
  return reconList(state, period, { lines }).find((r) => r.account.id === accountId);
}

function reconFor(books: Books, accountId: ID, period: string): AccountRecon {
  const gl = glWrite(books.state);
  let r = gl.recons.find((x) => x.accountId === accountId && x.period === period);
  if (!r) { r = { id: books.nextId('arec'), accountId, period }; gl.recons.push(r); }
  return r;
}

function check(books: Books, accountId: ID, period: string): Account {
  const a = books.account(accountId);
  if (!a || !reconAccounts(books.state).some((x) => x.id === accountId)) throw new ValidationError(['Pick a balance-sheet account.']);
  if (!/^\d{4}-\d{2}$/.test(period)) throw new ValidationError(['Pick the month as YYYY-MM.']);
  return a;
}

/** Enter the support balance by hand, with the document behind it (statement, schedule, count sheet). */
export function setManualSupport(books: Books, actor: User, accountId: ID, period: string, x: { amount: Cents; note: string; attachments: Attachment[] }): AccountRecon {
  books.require(actor, 'bank.reconcile', 'prepare account reconciliations');
  const a = check(books, accountId, period);
  const errs: string[] = [];
  if (supportKind(a) !== 'manual') errs.push(`${a.number} ${a.name} is supported by ${SUPPORT_LABEL[supportKind(a)].toLowerCase()}, so nothing is entered by hand.`);
  if (!Number.isSafeInteger(x.amount)) errs.push('Enter the support balance as an amount like 18,400.00.');
  if (!x.note.trim()) errs.push('Say what the support is, e.g. "Loan statement 31 Oct".');
  if (!x.attachments.length) errs.push('Attach the supporting document (statement, schedule or count sheet).');
  if (errs.length) throw new ValidationError(errs);
  const r = reconFor(books, accountId, period);
  const before = structuredClone(r);
  r.manual = { amount: x.amount, note: x.note.trim(), attachments: x.attachments, by: actor.id, at: books.clock() };
  books.audit(actor, { action: 'support', objectType: 'recon', objectId: r.id, summary: `Entered support for ${a.number} ${a.name} ${period}: ${formatMoney(x.amount, { dollarSign: true })}`, before, after: structuredClone(r) });
  books.changed();
  return r;
}

/** Preparer sign-off. A difference needs an explanation. Signing again replaces the earlier sign-off and clears the review. */
export function prepareRecon(books: Books, actor: User, accountId: ID, period: string, note?: string): AccountRecon {
  books.require(actor, 'bank.reconcile', 'prepare account reconciliations');
  const a = check(books, accountId, period);
  const row = reconRow(books.state, accountId, period)!;
  if (row.support.amount === null) throw new ValidationError([row.support.note ?? 'Enter the support balance first.']);
  if (row.difference !== 0 && !note?.trim()) throw new ValidationError([`GL and support differ by ${formatMoney(row.difference ?? 0, { dollarSign: true })}. Explain the difference in the note, or fix it first.`]);
  const r = reconFor(books, accountId, period);
  const before = structuredClone(r);
  r.prepared = { by: actor.id, at: books.clock(), gl: row.gl, support: row.support.amount, difference: row.difference ?? 0, note: note?.trim() || undefined };
  delete r.reviewed;
  books.audit(actor, { action: 'prepare', objectType: 'recon', objectId: r.id, summary: `Prepared ${a.number} ${a.name} ${period}: GL ${formatMoney(row.gl, { dollarSign: true })}, difference ${formatMoney(row.difference ?? 0, { dollarSign: true })}`, before, after: structuredClone(r), reason: note });
  books.changed();
  return r;
}

/** Reviewer sign-off: someone other than the preparer, with `approve`, while the GL still equals what was prepared. */
export function reviewRecon(books: Books, actor: User, accountId: ID, period: string, note?: string): AccountRecon {
  books.require(actor, 'approve', 'review account reconciliations');
  const a = check(books, accountId, period);
  const row = reconRow(books.state, accountId, period)!;
  const r = row.recon;
  if (!r?.prepared) throw new ValidationError(['Nobody has prepared this reconciliation yet.']);
  if (r.prepared.by === actor.id) throw new ValidationError(['You prepared this reconciliation, so someone else has to review it.']);
  if (row.status === 'stale') throw new ValidationError(['The GL balance (or its support) changed after it was prepared. The preparer has to sign it again first.']);
  if (row.status === 'reviewed') throw new ValidationError(['This reconciliation is already signed off.']);
  const before = structuredClone(r);
  r.reviewed = { by: actor.id, at: books.clock(), gl: row.gl, note: note?.trim() || undefined };
  books.audit(actor, { action: 'review', objectType: 'recon', objectId: r.id, summary: `Reviewed ${a.number} ${a.name} ${period}`, before, after: structuredClone(r), reason: note });
  books.changed();
  return r;
}

/** The last month that has ended before `today`. */
export function lastClosedPeriod(today: string): string {
  return periodOf(addDays(`${periodOf(today)}-01`, -1));
}

/** Recs for months already ended that still need someone: not signed off, or invalidated. */
export function unsignedRecons(state: BooksState, today: string, lines?: FlatLine[]): ReconRow[] {
  return reconList(state, lastClosedPeriod(today), { lines }).filter((r) => r.status === 'open' || r.status === 'prepared' || r.status === 'stale');
}
