import type { Books } from './books';
import { ValidationError } from './books';
import type { Account, Attachment, BooksState, GlState, ID, JeFrequency, JeLine, JournalEntry, RecurringJe, Transaction, User } from './types';
import { validateDraft, type TxnDraft } from './ledger';
import { can } from './permissions';
import { addDays, isValidDate, lastDayOfPeriod, periodOf, periodsBetween } from './dates';
import { formatMoney, type Cents } from './money';
import { flatLines, trialBalance, type FlatLine } from './reports';

// ── State ────────────────────────────────────────────────────────────────
export function emptyGl(): GlState {
  return { entries: [], recurring: [], recons: [], consolidations: [] };
}

/** Books saved before phase 10 have no `gl` slice: read it as empty. */
export function glOf(state: BooksState): GlState {
  return state.gl ?? emptyGl();
}

/** The slice for writing; created on the first phase 10 change. */
export function glWrite(state: BooksState): GlState {
  if (!state.gl) state.gl = emptyGl();
  return state.gl;
}

export const ADJUSTING_TAG = 'adjusting';
export const JE_TAG = 'je';

export const JE_STATUS_LABEL: Record<JournalEntry['status'], string> = { pending: 'Awaiting approval', posted: 'Posted', rejected: 'Rejected' };

export function jeTotal(lines: Pick<JeLine, 'debit'>[]): Cents {
  return lines.reduce((a, l) => a + (Number.isFinite(l.debit) ? l.debit : 0), 0);
}

export function approvalLimit(state: BooksState): Cents {
  return state.settings.jeApprovalLimitCents;
}

/** Over the limit (strictly) an entry waits for approval. */
export function needsApprovalFor(state: BooksState, total: Cents): boolean {
  return total > approvalLimit(state);
}

export function getJournal(state: BooksState, id: ID): JournalEntry | undefined {
  return glOf(state).entries.find((j) => j.id === id || j.ref === id);
}

/** The journal entry (if any) behind a ledger transaction: posted from it, or its reversal. */
export function journalForTxn(state: BooksState, txnId: ID): { je: JournalEntry; reversal: boolean } | undefined {
  for (const je of glOf(state).entries) {
    if (je.txnId === txnId) return { je, reversal: false };
    if (je.reversal?.txnId === txnId) return { je, reversal: true };
  }
  return undefined;
}

// ── Drafts and validation ────────────────────────────────────────────────
export interface JeDraft {
  date: string;
  description: string;
  memo: string;
  lines: Omit<JeLine, 'id'>[];
  adjusting?: boolean;
  reverseOn?: string;
  templateKey?: string;
  partyId?: ID;
  attachments?: Attachment[];
}

function txnDraft(d: Pick<JeDraft, 'date' | 'description' | 'memo' | 'lines' | 'partyId'>, opts: { tags: string[]; docNo?: string }): TxnDraft {
  return {
    date: d.date, kind: 'journal', description: d.description, memo: d.memo, partyId: d.partyId, docNo: opts.docNo, tags: opts.tags,
    lines: d.lines.map((l) => ({ accountId: l.accountId, storeId: l.storeId, debit: l.debit, credit: l.credit, memo: l.memo, partyId: l.partyId })),
  };
}

/** Everything wrong with a draft, as sentences that say how to fix it. Ledger rules (balance, accounts, stores, locked months) included. */
export function validateJe(state: BooksState, d: JeDraft): string[] {
  const errs: string[] = [];
  if (!d.memo?.trim()) errs.push('Add a memo: why this entry exists, so the reviewer and the CPA can follow it.');
  errs.push(...validateDraft(state, txnDraft(d, { tags: [] })));
  if (d.reverseOn) {
    if (!isValidDate(d.reverseOn)) errs.push('Enter the auto-reverse date as YYYY-MM-DD.');
    else if (d.reverseOn <= d.date) errs.push('The auto-reverse date has to be after the entry date (usually the 1st of the next month).');
    else if (state.periods[periodOf(d.reverseOn)]?.status === 'locked') errs.push(`${periodOf(d.reverseOn)} is locked, so the reversal couldn't post. Pick a reverse date in an open month.`);
  }
  return [...new Set(errs)];
}

function nextRef(state: BooksState): string {
  const n = glOf(state).entries.length + 1;
  return 'JE-' + String(n).padStart(4, '0');
}

function tagsFor(je: Pick<JournalEntry, 'adjusting' | 'templateKey'>, extra: string[] = []): string[] {
  return [JE_TAG, ...(je.adjusting ? [ADJUSTING_TAG] : []), ...(je.templateKey ? ['template:' + je.templateKey] : []), ...extra];
}

/** Post a journal entry's lines through the ledger (validated, balanced, period-locked). */
function postEntry(books: Books, poster: User, je: JournalEntry): Transaction {
  const t = books.createTransaction(poster, txnDraft(je, { tags: tagsFor(je), docNo: je.ref }), { source: je.source === 'demo' ? 'demo' : 'manual', attachments: je.attachments.map((a) => ({ ...a })) });
  je.txnId = t.id;
  je.status = 'posted';
  return t;
}

/**
 * Prepare a manual journal entry. At or under the approval limit it posts at once; over it, it waits
 * as pending (nothing touches the books) until someone else with `approve` approves it.
 */
export function createJournal(books: Books, actor: User, d: JeDraft, opts: { source?: JournalEntry['source']; recurring?: JournalEntry['recurring'] } = {}): JournalEntry {
  books.require(actor, 'journal.create', 'prepare journal entries');
  const errs = validateJe(books.state, d);
  if (errs.length) throw new ValidationError(errs);
  const gl = glWrite(books.state);
  const total = jeTotal(d.lines);
  const je: JournalEntry = {
    id: books.nextId('je'),
    ref: nextRef(books.state),
    date: d.date,
    description: d.description.trim(),
    memo: d.memo.trim(),
    lines: d.lines.map((l) => ({ id: books.nextId('jl'), accountId: l.accountId, storeId: l.storeId, debit: l.debit, credit: l.credit, memo: l.memo?.trim() || undefined, partyId: l.partyId || undefined })),
    attachments: d.attachments ?? [],
    adjusting: !!d.adjusting,
    templateKey: d.templateKey,
    partyId: d.partyId || undefined,
    reverseOn: d.reverseOn || undefined,
    recurring: opts.recurring,
    status: 'pending',
    needsApproval: needsApprovalFor(books.state, total),
    preparedBy: actor.id,
    preparedAt: books.clock(),
    source: opts.source ?? (d.templateKey ? 'template' : 'manual'),
  };
  if (!je.needsApproval) postEntry(books, actor, je);
  gl.entries.push(je);
  const money = formatMoney(total, { dollarSign: true });
  books.audit(actor, {
    action: je.needsApproval ? 'prepare' : 'post', objectType: 'journal', objectId: je.id,
    summary: je.needsApproval ? `Prepared ${je.ref} · ${je.description} ${money}: over the ${formatMoney(approvalLimit(books.state), { dollarSign: true })} limit, waiting for approval` : `Posted ${je.ref} · ${je.description} ${money}`,
    after: structuredClone(je),
  });
  books.changed();
  return je;
}

/** Approve a pending entry: it posts on its own date. The approver can't be the preparer. */
export function approveJournal(books: Books, actor: User, id: ID, note?: string): JournalEntry {
  books.require(actor, 'approve', 'approve journal entries');
  const je = getJournal(books.state, id);
  if (!je) throw new ValidationError(['That journal entry no longer exists.']);
  if (je.status !== 'pending') throw new ValidationError([`${je.ref} is already ${JE_STATUS_LABEL[je.status].toLowerCase()}.`]);
  if (je.preparedBy === actor.id) throw new ValidationError([`You prepared ${je.ref}, so someone else has to approve it. Ask the CFO or an owner.`]);
  const errs = validateJe(books.state, je);
  if (errs.length) throw new ValidationError(errs);
  const preparer = books.state.users.find((u) => u.id === je.preparedBy);
  const poster = can(actor, 'journal.create') ? actor : preparer && can(preparer, 'journal.create') ? preparer : null;
  if (!poster) throw new ValidationError(['Nobody on this entry can post to the books. Ask the bookkeeper or CFO to prepare it again.']);
  const before = structuredClone(je);
  postEntry(books, poster, je);
  je.approved = { by: actor.id, at: books.clock(), note: note?.trim() || undefined };
  books.audit(actor, { action: 'approve', objectType: 'journal', objectId: je.id, summary: `Approved ${je.ref} · ${je.description} ${formatMoney(jeTotal(je.lines), { dollarSign: true })}; posted ${books.getTransaction(je.txnId!)?.ref}`, before, after: structuredClone(je), reason: note });
  books.changed();
  return je;
}

/** Send a pending entry back. Nothing was ever posted. */
export function rejectJournal(books: Books, actor: User, id: ID, reason: string): JournalEntry {
  books.require(actor, 'approve', 'reject journal entries');
  const je = getJournal(books.state, id);
  if (!je) throw new ValidationError(['That journal entry no longer exists.']);
  if (je.status !== 'pending') throw new ValidationError(['Only entries awaiting approval can be rejected. Reverse a posted entry instead.']);
  if (je.preparedBy === actor.id) throw new ValidationError([`You prepared ${je.ref}, so someone else decides on it.`]);
  if (!reason.trim()) throw new ValidationError(['Say why the entry is rejected. The reason goes in the audit log.']);
  const before = structuredClone(je);
  je.status = 'rejected';
  je.rejected = { by: actor.id, at: books.clock(), reason: reason.trim() };
  books.audit(actor, { action: 'reject', objectType: 'journal', objectId: je.id, summary: `Rejected ${je.ref}`, before, reason });
  books.changed();
  return je;
}

export function pendingJournals(state: BooksState, visible?: Set<ID>): JournalEntry[] {
  return glOf(state).entries.filter((j) => j.status === 'pending' && (!visible || j.lines.some((l) => visible.has(l.storeId))));
}

// ── Reversing entries ────────────────────────────────────────────────────
/** Posted entries whose auto-reverse date has come (on or before `through`) and that aren't reversed yet. */
export function reversalsDue(state: BooksState, through: string): JournalEntry[] {
  return glOf(state).entries.filter((j) => j.status === 'posted' && j.reverseOn && j.reverseOn <= through && !j.reversal && j.txnId && !state.transactions.find((t) => t.id === j.txnId)?.deleted);
}

/** Posted entries with an auto-reverse date still ahead (or due), for the Reversing tab. */
export function reversingEntries(state: BooksState): JournalEntry[] {
  return glOf(state).entries.filter((j) => j.reverseOn && j.status !== 'rejected');
}

/**
 * Post every reversal that has come due, each on its own reverse date, debits and credits swapped.
 * Idempotent: an entry is reversed once. Reversals into a locked month are skipped and reported.
 */
export function postReversals(books: Books, actor: User, through: string): { posted: JournalEntry[]; skipped: string[] } {
  books.require(actor, 'journal.create', 'post reversing entries');
  const posted: JournalEntry[] = [];
  const skipped: string[] = [];
  for (const je of reversalsDue(books.state, through)) {
    const d = { date: je.reverseOn!, description: `Reversal of ${je.ref} · ${je.description}`, memo: `Auto-reverse of ${je.ref}. ${je.memo}`, partyId: je.partyId,
      lines: je.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) };
    const errs = validateDraft(books.state, txnDraft(d, { tags: [] }));
    if (errs.length) { skipped.push(`${je.ref}: ${errs.join(' ')}`); continue; }
    const t = books.createTransaction(actor, txnDraft(d, { tags: tagsFor(je, ['reversal']), docNo: je.ref + '-R' }), { source: je.source === 'demo' ? 'demo' : 'manual' });
    je.reversal = { date: je.reverseOn!, txnId: t.id, by: actor.id, at: books.clock() };
    books.audit(actor, { action: 'reverse', objectType: 'journal', objectId: je.id, summary: `Reversed ${je.ref} on ${je.reverseOn} (${t.ref})` });
    posted.push(je);
  }
  if (posted.length) books.changed();
  return { posted, skipped };
}

// ── Recurring entries ────────────────────────────────────────────────────
export function recurringDate(r: Pick<RecurringJe, 'day'>, period: string): string {
  const last = lastDayOfPeriod(period);
  const day = Math.min(Math.max(1, Math.round(r.day)), Number(last.slice(8)));
  return `${period}-${String(day).padStart(2, '0')}`;
}

/** The periods a schedule runs in, from its start to its end (or `through`). */
export function schedulePeriods(r: Pick<RecurringJe, 'start' | 'end' | 'frequency'>, through: string): string[] {
  const last = r.end && r.end < periodOf(through) ? r.end : periodOf(through);
  if (last < r.start) return [];
  const step = r.frequency === 'quarterly' ? 3 : 1;
  return periodsBetween(r.start, last).filter((_, i) => i % step === 0);
}

export interface RecurringDue { schedule: RecurringJe; period: string; date: string }

/** Every run that should exist by `through` and hasn't been generated. */
export function recurringDue(state: BooksState, through: string, visible?: Set<ID>): RecurringDue[] {
  const out: RecurringDue[] = [];
  for (const r of glOf(state).recurring) {
    if (!r.active) continue;
    if (visible && !r.lines.some((l) => visible.has(l.storeId))) continue;
    for (const p of schedulePeriods(r, through)) {
      const date = recurringDate(r, p);
      if (date <= through && !r.generated[p]) out.push({ schedule: r, period: p, date });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The next date a schedule will run after `today`, or null when it has ended. */
export function nextRecurringDate(r: RecurringJe, today: string): string | null {
  const far = `${Number(today.slice(0, 4)) + 3}-12-31`;
  for (const p of schedulePeriods(r, far)) {
    const d = recurringDate(r, p);
    if (d > today && !r.generated[p]) return d;
  }
  return null;
}

export interface RecurringDraft {
  name: string;
  description: string;
  memo: string;
  templateKey?: string;
  lines: Omit<JeLine, 'id'>[];
  adjusting?: boolean;
  autoReverse?: boolean;
  frequency: JeFrequency;
  day: number;
  start: string;
  end?: string;
  active?: boolean;
}

export function validateRecurring(state: BooksState, d: RecurringDraft): string[] {
  const errs: string[] = [];
  if (!d.name.trim()) errs.push('Name the schedule, e.g. "Monthly interest accrual".');
  if (!/^\d{4}-\d{2}$/.test(d.start)) errs.push('Enter the first month as YYYY-MM.');
  if (d.end && !/^\d{4}-\d{2}$/.test(d.end)) errs.push('Enter the last month as YYYY-MM, or leave it blank to run until stopped.');
  if (d.end && d.end < d.start) errs.push('The last month is before the first.');
  if (!(d.day >= 1 && d.day <= 31)) errs.push('Pick a day of the month from 1 to 31 (later days are moved to the month end).');
  const sample = /^\d{4}-\d{2}$/.test(d.start) ? recurringDate(d, d.start) : '2000-01-01';
  const lineErrs = validateJe({ ...state, periods: {} }, { date: sample, description: d.description, memo: d.memo, lines: d.lines });
  errs.push(...lineErrs);
  return [...new Set(errs)];
}

export function saveRecurring(books: Books, actor: User, d: RecurringDraft, id?: ID): RecurringJe {
  books.require(actor, 'journal.create', 'set up recurring entries');
  const errs = validateRecurring(books.state, d);
  if (errs.length) throw new ValidationError(errs);
  const gl = glWrite(books.state);
  const existing = id ? gl.recurring.find((r) => r.id === id) : undefined;
  const before = existing ? structuredClone(existing) : undefined;
  const r: RecurringJe = {
    id: existing?.id ?? books.nextId('rje'),
    name: d.name.trim(), description: d.description.trim(), memo: d.memo.trim(), templateKey: d.templateKey,
    lines: d.lines.map((l) => ({ ...l })), adjusting: !!d.adjusting, autoReverse: !!d.autoReverse,
    frequency: d.frequency, day: d.day, start: d.start, end: d.end || undefined, active: d.active ?? true,
    generated: existing?.generated ?? {}, createdBy: existing?.createdBy ?? actor.id, createdAt: existing?.createdAt ?? books.clock(),
  };
  if (existing) Object.assign(existing, r); else gl.recurring.push(r);
  books.audit(actor, { action: existing ? 'update' : 'create', objectType: 'journal', objectId: r.id, summary: `${existing ? 'Updated' : 'Set up'} recurring entry "${r.name}" (${r.frequency}, day ${r.day})`, before, after: structuredClone(r) });
  books.changed();
  return existing ?? r;
}

export function setRecurringActive(books: Books, actor: User, id: ID, active: boolean): void {
  books.require(actor, 'journal.create', 'change recurring entries');
  const r = glOf(books.state).recurring.find((x) => x.id === id);
  if (!r) throw new ValidationError(['That schedule no longer exists.']);
  r.active = active;
  books.audit(actor, { action: active ? 'resume' : 'pause', objectType: 'journal', objectId: id, summary: `${active ? 'Resumed' : 'Paused'} recurring entry "${r.name}"` });
  books.changed();
}

/**
 * Generate every recurring run due by `through` (optionally only some schedules). Idempotent per
 * schedule and period. Runs over the approval limit are created pending, like any other entry.
 */
export function generateRecurring(books: Books, actor: User, through: string, ids?: ID[]): { created: JournalEntry[]; errors: string[] } {
  books.require(actor, 'journal.create', 'generate recurring entries');
  const created: JournalEntry[] = [];
  const errors: string[] = [];
  for (const due of recurringDue(books.state, through)) {
    const r = due.schedule;
    if (ids && !ids.includes(r.id)) continue;
    const d: JeDraft = {
      date: due.date, description: `${r.description} · ${due.period}`, memo: r.memo, lines: r.lines, adjusting: r.adjusting, templateKey: r.templateKey,
      reverseOn: r.autoReverse ? addDays(lastDayOfPeriod(due.period), 1) : undefined,
    };
    try {
      const je = createJournal(books, actor, d, { source: 'recurring', recurring: { scheduleId: r.id, period: due.period } });
      r.generated[due.period] = je.id;
      created.push(je);
    } catch (e) {
      errors.push(`${r.name} ${due.period}: ${e instanceof ValidationError ? e.errors.join(' ') : (e as Error).message}`);
    }
  }
  if (created.length) books.changed();
  return { created, errors };
}

// ── Templates ────────────────────────────────────────────────────────────
export type TemplateGroup = 'accrual' | 'prepaid' | 'depreciation' | 'intercompany' | 'reclass' | 'owner' | 'inventory' | 'writeoff';
export const TEMPLATE_GROUP_LABEL: Record<TemplateGroup, string> = {
  accrual: 'Accruals', prepaid: 'Prepaids', depreciation: 'Depreciation', intercompany: 'Intercompany', reclass: 'Reclass',
  owner: 'Owner draw / contribution', inventory: 'Inventory adjustments', writeoff: 'Write-offs',
};

export interface TemplateLine {
  accountId: ID;
  side: 'debit' | 'credit';
  /** Which store input the line uses (0 = the first). The corporate store when `corp` is set. */
  store?: number;
  corp?: boolean;
  /** Which amount input the line uses (0 = the first). */
  amount?: number;
  memo?: string;
}

export interface JeTemplate {
  key: string;
  group: TemplateGroup;
  label: string;
  /** One line on what it records and when to use it. */
  detail: string;
  description: string;
  memo: string;
  /** Labels for the store inputs (most templates need one). */
  stores: string[];
  /** Labels for the amount inputs (most need one). */
  amounts: string[];
  lines: TemplateLine[];
  adjusting: boolean;
  /** Reverse on the 1st of the next month (accruals). */
  autoReverse?: boolean;
  /** A negative amount swaps the sides (e.g. an inventory gain instead of a loss). */
  signed?: boolean;
  partyType?: 'owner' | 'tenant';
}

const L = (accountId: ID, side: 'debit' | 'credit', x: Partial<TemplateLine> = {}): TemplateLine => ({ accountId, side, ...x });

/** Manual journal templates. Accounts and sides are filled in; the preparer gives amounts, stores and a date. */
export const JE_TEMPLATES: JeTemplate[] = [
  { key: 'accr_payroll', group: 'accrual', label: 'Accrue payroll', detail: 'Wages and payroll taxes earned by month end but paid next month.', description: 'Accrued payroll', memo: 'Wages and taxes earned through month end, paid on the next pay date. Reverses on the 1st.',
    stores: ['Store'], amounts: ['Net wages', 'Payroll taxes'], adjusting: true, autoReverse: true,
    lines: [L('acct_wages', 'debit', { amount: 0 }), L('acct_payroll_taxes', 'debit', { amount: 1 }), L('acct_accrued_payroll', 'credit', { amount: 0 }), L('acct_payroll_tax', 'credit', { amount: 1 })] },
  { key: 'accr_utilities', group: 'accrual', label: 'Accrue utilities', detail: 'Power, water or gas used this month, billed next month.', description: 'Accrued utilities', memo: 'Service used this month, bill not received yet; estimated from the last bill. Reverses on the 1st.',
    stores: ['Store'], amounts: ['Estimate'], adjusting: true, autoReverse: true, lines: [L('acct_utilities', 'debit'), L('acct_accrued_exp', 'credit')] },
  { key: 'accr_fuel_rni', group: 'accrual', label: 'Fuel received, not invoiced', detail: 'A load delivered (BOL on file) whose invoice hasn\'t arrived.', description: 'Fuel received, not invoiced', memo: 'Delivered per BOL; supplier invoice not received by month end. Reverses on the 1st.',
    stores: ['Store'], amounts: ['Delivered cost'], adjusting: true, autoReverse: true, lines: [L('acct_cogs_fuel', 'debit'), L('acct_fuel_rni', 'credit')] },
  { key: 'accr_interest', group: 'accrual', label: 'Accrue interest', detail: 'Interest owed on a loan for the month, paid later.', description: 'Accrued interest', memo: 'Interest for the month per the loan statement / amortization table.',
    stores: ['Borrower'], amounts: ['Interest'], adjusting: true, lines: [L('acct_interest', 'debit'), L('acct_accrued_exp', 'credit')] },
  { key: 'prepaid_insurance', group: 'prepaid', label: 'Amortize prepaid insurance', detail: 'One month of a prepaid premium. (Phase 9 schedules do this automatically.)', description: 'Insurance amortization', memo: 'One month of the prepaid premium (SPEC §6.10).',
    stores: ['Store'], amounts: ['Month\'s share'], adjusting: true, lines: [L('acct_insurance', 'debit'), L('acct_prepaid', 'credit')] },
  { key: 'prepaid_property_tax', group: 'prepaid', label: 'Amortize prepaid property tax', detail: 'One month of the year\'s property tax.', description: 'Property tax amortization', memo: 'One month of the prepaid property tax (SPEC §6.10).',
    stores: ['Store'], amounts: ['Month\'s share'], adjusting: true, lines: [L('acct_property_tax', 'debit'), L('acct_prepaid', 'credit')] },
  { key: 'prepaid_licenses', group: 'prepaid', label: 'Amortize prepaid licenses', detail: 'One month of an annual license or permit fee.', description: 'License amortization', memo: 'One month of the annual license / permit fee (SPEC §6.10).',
    stores: ['Store'], amounts: ['Month\'s share'], adjusting: true, lines: [L('acct_licenses', 'debit'), L('acct_prepaid', 'credit')] },
  { key: 'depreciation', group: 'depreciation', label: 'Depreciation', detail: 'A one-off depreciation entry. (Phase 9 runs the asset schedules.)', description: 'Depreciation', memo: 'Depreciation for the period.',
    stores: ['Store'], amounts: ['Depreciation'], adjusting: true, lines: [L('acct_depreciation', 'debit'), L('acct_accum_dep', 'credit')] },
  { key: 'ic_mgmt_fee', group: 'intercompany', label: 'Intercompany management fee', detail: 'Corporate charges a store for shared services. Eliminated in consolidation.', description: 'Management fee – intercompany', memo: 'Corporate shared-services charge for the month; eliminated in consolidation.',
    stores: ['Store charged'], amounts: ['Fee'], adjusting: false, lines: [L('acct_ic_fees', 'debit', { store: 0 }), L('acct_ic_fee_income', 'credit', { corp: true })] },
  { key: 'reclass_uncat', group: 'reclass', label: 'Reclass uncategorized expense', detail: 'Move an amount out of Uncategorized into the right account (change the debit account).', description: 'Reclass uncategorized expense', memo: 'Reclassified to the right account after review.',
    stores: ['Store'], amounts: ['Amount'], adjusting: true, lines: [L('acct_misc', 'debit'), L('acct_uncat_expense', 'credit')] },
  { key: 'owner_draw', group: 'owner', label: 'Owner draw', detail: 'An owner takes money out, recorded as an equity draw.', description: 'Owner draw', memo: 'Owner withdrawal recorded as a draw.',
    stores: ['Paid from'], amounts: ['Amount'], adjusting: false, partyType: 'owner', lines: [L('acct_owner_draws', 'debit', { corp: true }), L('acct_trustmark', 'credit', { corp: true })] },
  { key: 'owner_contribution', group: 'owner', label: 'Owner contribution', detail: 'An owner puts money in.', description: 'Owner contribution', memo: 'Capital contributed by the owner.',
    stores: ['Received by'], amounts: ['Amount'], adjusting: false, partyType: 'owner', lines: [L('acct_trustmark', 'debit', { corp: true }), L('acct_owner_capital', 'credit', { corp: true })] },
  { key: 'inv_fuel', group: 'inventory', label: 'Fuel book-to-physical', detail: 'Tank stick vs book: a loss (enter a negative amount for a gain).', description: 'Fuel inventory adjustment', memo: 'Book-to-physical variance at the tank (Fuel › Tanks).',
    stores: ['Store'], amounts: ['Loss at cost'], adjusting: true, signed: true, lines: [L('acct_cogs_fuel', 'debit'), L('acct_inv_fuel', 'credit')] },
  { key: 'inv_inside', group: 'inventory', label: 'Inside count adjustment', detail: 'Physical count vs book for inside merchandise (negative = count above book).', description: 'Inside inventory count adjustment', memo: 'Inside-store count vs book; shrink to cost of goods.',
    stores: ['Store'], amounts: ['Shrink at cost'], adjusting: true, signed: true, lines: [L('acct_cogs_grocery', 'debit'), L('acct_inv_merch', 'credit')] },
  { key: 'bad_debt', group: 'writeoff', label: 'Bad-debt write-off', detail: 'Write off a receivable that won\'t be collected.', description: 'Bad-debt write-off', memo: 'Uncollectible after follow-up; written off.',
    stores: ['Store'], amounts: ['Amount'], adjusting: true, partyType: 'tenant', lines: [L('acct_bad_debt', 'debit'), L('acct_ar_tenants', 'credit')] },
];

export function template(key: string): JeTemplate | undefined {
  return JE_TEMPLATES.find((t) => t.key === key);
}

export function corpStoreId(state: BooksState): ID {
  const hub = state.entities.find((e) => e.isHub && !e.deleted);
  return state.stores.find((s) => s.entityId === hub?.id && s.kind === 'corporate' && !s.deleted)?.id ?? state.stores.find((s) => s.kind === 'corporate')?.id ?? state.stores[0]?.id;
}

export interface TemplateInput { date: string; stores: ID[]; amounts: Cents[]; partyId?: ID; memo?: string; description?: string }

/** A template filled in: a balanced draft ready for createJournal (or the form). */
export function fromTemplate(state: BooksState, key: string, x: TemplateInput): JeDraft {
  const t = template(key);
  if (!t) throw new ValidationError(['Pick a template from the list.']);
  const corp = corpStoreId(state);
  const lines: Omit<JeLine, 'id'>[] = [];
  for (const tl of t.lines) {
    const amt = x.amounts[tl.amount ?? 0] ?? 0;
    if (!amt) continue;
    const storeId = tl.corp ? corp : x.stores[tl.store ?? 0] ?? x.stores[0] ?? corp;
    const neg = amt < 0;
    if (neg && !t.signed) throw new ValidationError([`${t.label} takes positive amounts.`]);
    const side = neg ? (tl.side === 'debit' ? 'credit' : 'debit') : tl.side;
    const v = Math.abs(amt);
    lines.push({ accountId: tl.accountId, storeId, debit: side === 'debit' ? v : 0, credit: side === 'credit' ? v : 0, memo: tl.memo, partyId: x.partyId });
  }
  const storeCode = state.stores.find((s) => s.id === (t.lines[0].corp ? corp : x.stores[0]))?.code ?? '';
  return {
    date: x.date,
    description: x.description?.trim() || `${t.description} ${storeCode} · ${periodOf(x.date)}`.trim(),
    memo: x.memo?.trim() || t.memo,
    lines,
    adjusting: t.adjusting,
    reverseOn: t.autoReverse ? addDays(lastDayOfPeriod(periodOf(x.date)), 1) : undefined,
    templateKey: t.key,
    partyId: x.partyId,
  };
}

// ── Trial balance: unadjusted / adjusting / adjusted ─────────────────────
export function isAdjusting(t: Pick<Transaction, 'tags'>): boolean {
  return t.tags.includes(ADJUSTING_TAG);
}

export interface TbColRow {
  account: Account;
  /** Debit − credit, per column. */
  unadjusted: number;
  adjusting: number;
  adjusted: number;
  prior: number;
}
export interface TbColTotals { debit: number; credit: number }
export interface TbColumns {
  asOf: string;
  from: string;
  priorAsOf: string;
  fyStart: string;
  rows: TbColRow[];
  totals: Record<'unadjusted' | 'adjusting' | 'adjusted' | 'prior', TbColTotals>;
  /** Every row: unadjusted + adjusting = adjusted. */
  rowsTie: boolean;
  /** Each column's debits equal its credits. */
  balanced: boolean;
  adjustingCount: number;
  netIncome: number;
  priorNetIncome: number;
}

/**
 * The trial balance in three columns plus the prior month end. The adjusting column holds entries
 * tagged `adjusting` dated in the reporting month (1st → asOf); unadjusted = adjusted − adjusting.
 */
export function tbColumns(state: BooksState, opts: { asOf: string; entityId?: ID; lines?: FlatLine[] }): TbColumns {
  const lines = opts.lines ?? flatLines(state);
  const from = `${periodOf(opts.asOf)}-01`;
  const priorAsOf = addDays(from, -1);
  const adjLines = lines.filter((f) => f.date >= from && f.date <= opts.asOf && isAdjusting(f.t));
  const adjusted = trialBalance(state, { asOf: opts.asOf, entityId: opts.entityId, lines });
  const adjusting = trialBalance(state, { asOf: opts.asOf, entityId: opts.entityId, lines: adjLines });
  const prior = trialBalance(state, { asOf: priorAsOf, entityId: opts.entityId, lines });
  const m = new Map<ID, TbColRow>();
  const row = (a: Account) => { let r = m.get(a.id); if (!r) { r = { account: a, unadjusted: 0, adjusting: 0, adjusted: 0, prior: 0 }; m.set(a.id, r); } return r; };
  for (const r of adjusted.rows) row(r.account).adjusted = r.net;
  for (const r of adjusting.rows) row(r.account).adjusting = r.net;
  for (const r of prior.rows) row(r.account).prior = r.net;
  const rows = [...m.values()].sort((a, b) => a.account.number.localeCompare(b.account.number));
  for (const r of rows) r.unadjusted = r.adjusted - r.adjusting;
  const tot = (k: keyof Pick<TbColRow, 'unadjusted' | 'adjusting' | 'adjusted' | 'prior'>): TbColTotals => rows.reduce((a, r) => ({ debit: a.debit + Math.max(r[k], 0), credit: a.credit + Math.max(-r[k], 0) }), { debit: 0, credit: 0 });
  const totals = { unadjusted: tot('unadjusted'), adjusting: tot('adjusting'), adjusted: tot('adjusted'), prior: tot('prior') };
  return {
    asOf: opts.asOf, from, priorAsOf, fyStart: adjusted.fyStart, rows, totals,
    rowsTie: rows.every((r) => r.unadjusted + r.adjusting === r.adjusted),
    balanced: Object.values(totals).every((t) => t.debit === t.credit),
    adjustingCount: new Set(adjLines.filter((f) => !opts.entityId || f.entityId === opts.entityId).map((f) => f.t.id)).size,
    netIncome: adjusted.netIncome,
    priorNetIncome: prior.netIncome,
  };
}
