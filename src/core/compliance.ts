import type { Books } from './books';
import { ValidationError } from './books';
import type {
  Attachment, BooksState, ComplianceItem, ComplianceKind, ComplianceOccurrence, ComplianceState, ComplianceStatus, DocLinkKind, ID, InsurancePolicy,
  Lease, License, LicenseKind, NoticeStatus, PolicyKind, Recurrence, TaxNotice, User, VaultDoc,
} from './types';
import { addDays, daysBetween, isValidDate, lastDayOfPeriod, periodLabel, periodOf } from './dates';
import { bankStoreId } from './bank';

export const KIND_LABEL: Record<ComplianceKind, string> = {
  sales_tax: 'Sales tax', fuel_excise: 'Fuel excise', payroll: 'Payroll filing', income_tax: 'Income tax', property_tax: 'Property tax', annual_report: 'Annual report', other: 'Other',
  state_income: 'State income / franchise', estimated_tax: 'Estimated tax', tobacco_excise: 'Tobacco excise', info_1099: '1099s', w2: 'W-2s',
};
export const STATUS_LABEL: Record<ComplianceStatus, string> = { not_started: 'Not started', in_prep: 'In prep', filed: 'Filed', paid: 'Paid', accepted: 'Accepted' };
export const LICENSE_LABEL: Record<LicenseKind, string> = {
  beer: 'Beer & light wine', tobacco: 'Tobacco', food_service: 'Food service', ust: 'UST / environmental', business: 'Business license', lottery: 'Lottery retailer', other: 'Other',
};
export const POLICY_LABEL: Record<PolicyKind, string> = {
  property: 'Property', general_liability: 'General liability', pollution: 'Pollution / UST liability', workers_comp: "Workers' comp", auto: 'Auto', umbrella: 'Umbrella', liquor: 'Liquor liability', other: 'Other',
};
export const NOTICE_STATUS_LABEL: Record<NoticeStatus, string> = { open: 'Open', in_progress: 'Working on it', responded: 'Responded', closed: 'Closed' };
/** Reminders reach the inbox this many days before the due date. */
export const REMINDER_DAYS = 30;

export function emptyCompliance(): ComplianceState {
  return { items: [], licenses: [], policies: [], leases: [], notices: [], docs: [] };
}

/** Books saved before phase 9 have no compliance slice: read it as empty. */
export function complianceOf(state: BooksState): ComplianceState {
  const c = state.compliance;
  if (!c) return emptyCompliance();
  return { ...emptyCompliance(), ...c };
}

function ensure(books: Books): ComplianceState {
  if (!books.state.compliance) books.state.compliance = emptyCompliance();
  const c = books.state.compliance;
  for (const k of ['items', 'licenses', 'policies', 'leases', 'notices', 'docs'] as const) if (!c[k]) (c as unknown as Record<string, unknown[]>)[k] = [];
  return c;
}

/** Store-scoped records need the store; company-wide ones need Corporate (the bank's store). */
export function canSee(state: BooksState, visible: Set<ID>, storeId?: ID): boolean {
  return visible.has(storeId ?? bankStoreId(state));
}

// ── Recurrence ───────────────────────────────────────────────────────────
const STEP: Record<Recurrence['every'], number> = { once: 0, monthly: 1, quarterly: 3, annual: 12 };

function addMonthsKeepDay(date: string, months: number, day: number): string {
  let y = Number(date.slice(0, 4));
  let m = Number(date.slice(5, 7)) + months;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  const p = `${y}-${String(m).padStart(2, '0')}`;
  const last = Number(lastDayOfPeriod(p).slice(8, 10));
  return `${p}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** Due dates of a recurrence between two dates (inclusive). The day of the first due date is kept, clamped to short months. */
export function dueDates(r: Recurrence, from: string, to: string): string[] {
  if (!isValidDate(r.firstDue)) return [];
  if (r.every === 'once') return r.firstDue >= from && r.firstDue <= to ? [r.firstDue] : [];
  const day = Number(r.firstDue.slice(8, 10));
  const out: string[] = [];
  for (let i = 0; i < 600; i++) {
    const d = addMonthsKeepDay(r.firstDue, i * STEP[r.every], day);
    if (d > to || (r.until && d > r.until)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** The period an occurrence covers, e.g. "October 2026" or "Q3 2026" or "2025". */
export function coveredPeriod(item: ComplianceItem, dueDate: string): string {
  const back = item.recurrence.coversMonthsBefore;
  if (back === undefined) return '';
  const end = addMonthsKeepDay(dueDate, -back, 1).slice(0, 7);
  if (item.recurrence.every === 'monthly') return periodLabel(end);
  if (item.recurrence.every === 'quarterly') return `Q${Math.ceil(Number(end.slice(5, 7)) / 3)} ${end.slice(0, 4)}`;
  if (item.recurrence.every === 'annual') return end.slice(0, 4);
  return periodLabel(end);
}

/** Done means filed (and paid, when the item needs a payment), or accepted. */
export function isDone(item: Pick<ComplianceItem, 'needsPayment'>, o?: Pick<ComplianceOccurrence, 'status' | 'paidOn'>): boolean {
  if (!o) return false;
  if (o.status === 'accepted' || o.status === 'paid') return true;
  return o.status === 'filed' && (!item.needsPayment || !!o.paidOn);
}

export interface OccurrenceRow {
  item: ComplianceItem;
  dueDate: string;
  covers: string;
  occ?: ComplianceOccurrence;
  status: ComplianceStatus;
  done: boolean;
  overdue: boolean;
  /** Negative when overdue. */
  daysLeft: number;
}

/** Every occurrence due in the window, plus any recorded ones in it, newest status first. */
export function occurrences(state: BooksState, opts: { from: string; to: string; today: string; visible?: Set<ID> }): OccurrenceRow[] {
  const rows: OccurrenceRow[] = [];
  for (const item of complianceOf(state).items) {
    if (!item.active) continue;
    if (opts.visible && !canSee(state, opts.visible, item.storeId)) continue;
    const dates = new Set(dueDates(item.recurrence, opts.from, opts.to));
    for (const d of Object.keys(item.occurrences)) if (d >= opts.from && d <= opts.to) dates.add(d);
    for (const d of dates) {
      const occ = item.occurrences[d];
      const done = isDone(item, occ);
      const daysLeft = daysBetween(opts.today, d);
      rows.push({ item, dueDate: d, covers: coveredPeriod(item, d), occ, status: occ?.status ?? 'not_started', done, overdue: !done && daysLeft < 0, daysLeft });
    }
  }
  return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.item.title.localeCompare(b.item.title));
}

/** Reminders for the inbox: everything not done that is overdue or due within 30 days. Looks back a year for overdue items. */
export function complianceReminders(state: BooksState, today: string, visible?: Set<ID>): OccurrenceRow[] {
  return occurrences(state, { from: addDays(today, -366), to: addDays(today, REMINDER_DAYS), today, visible }).filter((r) => !r.done);
}

// ── Editing the calendar ─────────────────────────────────────────────────
export type ItemDraft = Omit<ComplianceItem, 'id' | 'occurrences'> & { id?: ID };

export function validateItem(state: BooksState, d: ItemDraft): string[] {
  const errs: string[] = [];
  if (!d.title.trim()) errs.push('Give the obligation a title, like "Sales tax return – HM11".');
  if (!d.agency.trim()) errs.push('Say which agency it is filed with (IRS, the state revenue department, the county).');
  if (!isValidDate(d.recurrence.firstDue)) errs.push('Enter the first due date as YYYY-MM-DD.');
  if (d.recurrence.until && !isValidDate(d.recurrence.until)) errs.push('Enter the end date as YYYY-MM-DD, or leave it blank.');
  if (d.storeId && !state.stores.some((s) => s.id === d.storeId && !s.deleted)) errs.push('Choose a store, or leave it company-wide.');
  if (d.entityId && !state.entities.some((e) => e.id === d.entityId)) errs.push('Choose an entity, or leave it blank.');
  return errs;
}

export function saveComplianceItem(books: Books, actor: User, d: ItemDraft): ComplianceItem {
  books.require(actor, 'compliance.edit', 'change the compliance calendar');
  const errs = validateItem(books.state, d);
  if (errs.length) throw new ValidationError(errs);
  const c = ensure(books);
  const existing = d.id ? c.items.find((x) => x.id === d.id) : undefined;
  const fields = { ...d, title: d.title.trim(), agency: d.agency.trim(), form: d.form?.trim() || undefined, notes: d.notes?.trim() || undefined };
  if (existing) {
    const before = structuredClone(existing);
    Object.assign(existing, fields, { id: existing.id });
    books.audit(actor, { action: 'update', objectType: 'compliance', objectId: existing.id, summary: `Edited ${existing.title}`, before, after: structuredClone(existing) });
    books.changed();
    return existing;
  }
  const item: ComplianceItem = { ...fields, id: d.id ?? books.nextId('cmp'), occurrences: {} };
  c.items.push(item);
  books.audit(actor, { action: 'create', objectType: 'compliance', objectId: item.id, summary: `Added ${item.title} to the compliance calendar`, after: structuredClone(item) });
  books.changed();
  return item;
}

export interface OccurrenceInput {
  status: ComplianceStatus;
  filedOn?: string;
  paidOn?: string;
  paidAmount?: number;
  confirmation?: string;
  txnId?: ID;
  note?: string;
  attachments?: Attachment[];
}

/** Record where one filing stands: in prep, filed (date + confirmation), paid (date + amount), accepted. */
export function updateOccurrence(books: Books, actor: User, itemId: ID, dueDate: string, x: OccurrenceInput): ComplianceOccurrence {
  books.require(actor, 'compliance.edit', 'update compliance filings');
  const c = ensure(books);
  const item = c.items.find((i) => i.id === itemId);
  if (!item) throw new ValidationError(['That obligation no longer exists.']);
  const isDue = dueDates(item.recurrence, dueDate, dueDate).length > 0 || !!item.occurrences[dueDate];
  if (!isDue) throw new ValidationError([`${item.title} isn't due on ${dueDate}. Pick a due date from the calendar.`]);
  const prev = item.occurrences[dueDate];
  const atts = [...(prev?.attachments ?? []), ...(x.attachments ?? [])];
  const errs: string[] = [];
  const filedLike = x.status === 'filed' || x.status === 'accepted' || x.status === 'paid';
  if ((x.status === 'filed' || x.status === 'accepted') && !(x.filedOn && isValidDate(x.filedOn))) errs.push('Enter the date it was filed (YYYY-MM-DD).');
  if (x.filedOn && !isValidDate(x.filedOn)) errs.push('Enter the filed date as YYYY-MM-DD.');
  if (x.status === 'paid' || x.paidOn || x.paidAmount) {
    if (!(x.paidOn && isValidDate(x.paidOn))) errs.push('Enter the date it was paid (YYYY-MM-DD).');
    if (!(Number.isSafeInteger(x.paidAmount) && (x.paidAmount ?? 0) > 0)) errs.push('Enter the amount paid, above zero.');
  }
  if (filedLike && !x.confirmation?.trim() && !atts.length) errs.push('Enter the confirmation number, or attach the filing confirmation.');
  if (x.txnId && !books.state.transactions.some((t) => t.id === x.txnId && !t.deleted)) errs.push('That payment transaction no longer exists. Pick another or leave it blank.');
  if (errs.length) throw new ValidationError(errs);
  const occ: ComplianceOccurrence = {
    dueDate, status: x.status, filedOn: x.filedOn || undefined, paidOn: x.paidOn || undefined, paidAmount: x.paidAmount || undefined,
    confirmation: x.confirmation?.trim() || undefined, txnId: x.txnId || undefined, note: x.note?.trim() || undefined, attachments: atts,
    updatedBy: actor.id, updatedAt: books.clock(),
  };
  item.occurrences[dueDate] = occ;
  books.audit(actor, { action: 'status', objectType: 'compliance', objectId: item.id, summary: `${item.title} due ${dueDate}: ${STATUS_LABEL[occ.status]}${occ.confirmation ? ` (#${occ.confirmation})` : ''}`, before: prev, after: structuredClone(occ) });
  books.changed();
  return occ;
}

// ── Licenses, policies, leases: expiry ───────────────────────────────────
export type ExpiryStatus = 'expired' | 'expiring' | 'current';
export const EXPIRY_LABEL: Record<ExpiryStatus, string> = { expired: 'Expired', expiring: 'Expiring soon', current: 'Current' };

export function expiryStatus(expires: string, today: string, window = REMINDER_DAYS): ExpiryStatus {
  if (expires < today) return 'expired';
  return daysBetween(today, expires) <= window ? 'expiring' : 'current';
}

function upsert<T extends { id: ID }>(books: Books, actor: User, list: T[], item: T, label: string): T {
  const i = list.findIndex((x) => x.id === item.id);
  const before = i >= 0 ? structuredClone(list[i]) : undefined;
  if (i >= 0) list[i] = item; else list.push(item);
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'compliance', objectId: item.id, summary: `${before ? 'Updated' : 'Added'} ${label}`, before, after: structuredClone(item) });
  books.changed();
  return item;
}

export function saveLicense(books: Books, actor: User, l: Omit<License, 'id' | 'attachments' | 'history'> & { id?: ID; attachments?: Attachment[] }): License {
  books.require(actor, 'compliance.edit', 'change licenses');
  const errs: string[] = [];
  if (!l.name.trim()) errs.push('Name the license or permit.');
  if (!books.state.stores.some((s) => s.id === l.storeId && !s.deleted)) errs.push('Choose the store it is for.');
  if (!l.issuer.trim()) errs.push('Say who issues it (city, county, state agency).');
  if (!l.number.trim()) errs.push('Enter the license or permit number.');
  if (!isValidDate(l.expiresOn)) errs.push('Enter the expiry date as YYYY-MM-DD.');
  if (l.issuedOn && !isValidDate(l.issuedOn)) errs.push('Enter the issue date as YYYY-MM-DD, or leave it blank.');
  if (errs.length) throw new ValidationError(errs);
  const c = ensure(books);
  const existing = l.id ? c.licenses.find((x) => x.id === l.id) : undefined;
  const item: License = { ...l, name: l.name.trim(), issuer: l.issuer.trim(), number: l.number.trim(), id: existing?.id ?? l.id ?? books.nextId('lic'), attachments: l.attachments ?? existing?.attachments ?? [], history: existing?.history ?? [] };
  return upsert(books, actor, c.licenses, item, `license ${item.name}`);
}

/** Renew: the new expiry replaces the old one, which is kept in the license's history. */
export function renewLicense(books: Books, actor: User, id: ID, x: { expiresOn: string; renewedOn: string; attachment?: Attachment }): License {
  books.require(actor, 'compliance.edit', 'renew licenses');
  const l = ensure(books).licenses.find((i) => i.id === id);
  if (!l) throw new ValidationError(['That license no longer exists.']);
  const errs: string[] = [];
  if (!isValidDate(x.renewedOn)) errs.push('Enter the date it was renewed as YYYY-MM-DD.');
  if (!isValidDate(x.expiresOn)) errs.push('Enter the new expiry date as YYYY-MM-DD.');
  else if (x.expiresOn <= l.expiresOn) errs.push(`The new expiry must be after the current one (${l.expiresOn}).`);
  if (errs.length) throw new ValidationError(errs);
  const before = structuredClone(l);
  l.history.push({ expiresOn: l.expiresOn, renewedOn: x.renewedOn, by: actor.id });
  l.expiresOn = x.expiresOn;
  if (x.attachment) l.attachments.push(x.attachment);
  books.audit(actor, { action: 'renew', objectType: 'compliance', objectId: l.id, summary: `Renewed ${l.name} to ${l.expiresOn}`, before, after: structuredClone(l) });
  books.changed();
  return l;
}

export function savePolicy(books: Books, actor: User, p: Omit<InsurancePolicy, 'id' | 'attachments'> & { id?: ID; attachments?: Attachment[] }): InsurancePolicy {
  books.require(actor, 'compliance.edit', 'change insurance policies');
  const errs: string[] = [];
  if (!p.carrier.trim()) errs.push('Enter the carrier.');
  if (!p.policyNo.trim()) errs.push('Enter the policy number.');
  if (!isValidDate(p.effective) || !isValidDate(p.expires)) errs.push('Enter the effective and expiry dates as YYYY-MM-DD.');
  else if (p.expires <= p.effective) errs.push('The expiry date must be after the effective date.');
  if (!Number.isSafeInteger(p.premium) || p.premium < 0) errs.push('Enter the premium.');
  if (!p.storeIds.length) errs.push('Pick at least one store the policy covers (CORP for company-wide).');
  if (errs.length) throw new ValidationError(errs);
  const c = ensure(books);
  const existing = p.id ? c.policies.find((x) => x.id === p.id) : undefined;
  const item: InsurancePolicy = { ...p, carrier: p.carrier.trim(), policyNo: p.policyNo.trim(), id: existing?.id ?? p.id ?? books.nextId('pol'), attachments: p.attachments ?? existing?.attachments ?? [] };
  return upsert(books, actor, c.policies, item, `policy ${item.carrier} ${item.policyNo}`);
}

export function saveLease(books: Books, actor: User, l: Omit<Lease, 'id' | 'attachments'> & { id?: ID; attachments?: Attachment[] }): Lease {
  books.require(actor, 'compliance.edit', 'change leases');
  const errs: string[] = [];
  if (!l.counterparty.trim()) errs.push(l.side === 'we_rent' ? 'Enter the lessor (who we rent from).' : 'Enter the tenant.');
  if (!books.state.stores.some((s) => s.id === l.storeId && !s.deleted)) errs.push('Choose the store.');
  if (!isValidDate(l.start) || !isValidDate(l.end)) errs.push('Enter the start and end dates as YYYY-MM-DD.');
  else if (l.end <= l.start) errs.push('The end date must be after the start date.');
  if (!Number.isSafeInteger(l.monthlyRent) || l.monthlyRent < 0) errs.push('Enter the monthly rent.');
  if (errs.length) throw new ValidationError(errs);
  const c = ensure(books);
  const existing = l.id ? c.leases.find((x) => x.id === l.id) : undefined;
  const item: Lease = { ...l, counterparty: l.counterparty.trim(), id: existing?.id ?? l.id ?? books.nextId('lse'), attachments: l.attachments ?? existing?.attachments ?? [] };
  return upsert(books, actor, c.leases, item, `lease ${item.premises}`);
}

// ── Notices ──────────────────────────────────────────────────────────────
export type NoticeDraft = Omit<TaxNotice, 'id' | 'attachments' | 'updatedAt' | 'updatedBy'> & { id?: ID; attachments?: Attachment[] };

export function saveNotice(books: Books, actor: User, n: NoticeDraft): TaxNotice {
  books.require(actor, 'compliance.edit', 'record notices');
  const errs: string[] = [];
  if (!n.agency.trim()) errs.push('Say who sent it (IRS, the state).');
  if (!n.noticeType.trim()) errs.push('Enter the notice type or number printed on the letter (e.g. CP2000).');
  if (!isValidDate(n.received)) errs.push('Enter the date it was received as YYYY-MM-DD.');
  if (!isValidDate(n.deadline)) errs.push('Enter the response deadline as YYYY-MM-DD.');
  else if (isValidDate(n.received) && n.deadline < n.received) errs.push('The deadline is before the date received. Check both dates on the letter.');
  if (!n.summary.trim()) errs.push('Write one line on what the letter says.');
  if (n.status === 'responded' && (!n.response?.trim() || !n.respondedOn || !isValidDate(n.respondedOn))) errs.push('To mark it responded, enter what was sent and the date (YYYY-MM-DD).');
  if (n.status === 'closed' && !n.outcome?.trim()) errs.push('To close it, record the outcome (e.g. "No change; IRS accepted our explanation").');
  if (n.amount !== undefined && (!Number.isSafeInteger(n.amount) || n.amount < 0)) errs.push('Enter the amount on the notice, or leave it blank.');
  if (errs.length) throw new ValidationError(errs);
  const c = ensure(books);
  const existing = n.id ? c.notices.find((x) => x.id === n.id) : undefined;
  const item: TaxNotice = {
    ...n, agency: n.agency.trim(), noticeType: n.noticeType.trim(), summary: n.summary.trim(), response: n.response?.trim() || undefined, outcome: n.outcome?.trim() || undefined,
    id: existing?.id ?? n.id ?? books.nextId('ntc'), attachments: n.attachments ?? existing?.attachments ?? [], updatedAt: books.clock(), updatedBy: actor.id,
  };
  return upsert(books, actor, c.notices, item, `notice ${item.agency} ${item.noticeType}`);
}

export function openNotices(state: BooksState, visible?: Set<ID>): TaxNotice[] {
  return complianceOf(state).notices.filter((n) => n.status !== 'closed' && (!visible || canSee(state, visible, n.storeId))).sort((a, b) => a.deadline.localeCompare(b.deadline));
}

// ── Attachments on compliance records ────────────────────────────────────
export type ComplianceTarget = { kind: 'license' | 'policy' | 'lease' | 'notice'; id: ID } | { kind: 'occurrence'; id: ID; dueDate: string };

export function attachToCompliance(books: Books, actor: User, target: ComplianceTarget, att: Attachment): void {
  books.require(actor, 'compliance.edit', 'attach documents to compliance records');
  const c = ensure(books);
  let list: Attachment[] | undefined;
  let label = '';
  if (target.kind === 'occurrence') {
    const item = c.items.find((i) => i.id === target.id);
    if (!item) throw new ValidationError(['That obligation no longer exists.']);
    const occ = item.occurrences[target.dueDate] ?? (item.occurrences[target.dueDate] = { dueDate: target.dueDate, status: 'not_started', attachments: [], updatedBy: actor.id, updatedAt: books.clock() });
    list = occ.attachments;
    label = `${item.title} due ${target.dueDate}`;
  } else {
    const rec = (target.kind === 'license' ? c.licenses : target.kind === 'policy' ? c.policies : target.kind === 'lease' ? c.leases : c.notices).find((x) => x.id === target.id);
    if (!rec) throw new ValidationError(['That record no longer exists.']);
    list = rec.attachments;
    label = target.kind;
  }
  list.push(att);
  books.audit(actor, { action: 'attach', objectType: 'compliance', objectId: target.id, summary: `Attached ${att.name} to ${label}` });
  books.changed();
}

// ── Document vault ───────────────────────────────────────────────────────
export interface VaultSource {
  kind: 'transaction' | 'bill' | 'fuel_invoice' | 'fuel_notice' | 'license' | 'policy' | 'lease' | 'notice' | 'filing' | 'asset' | 'loan' | 'maintenance' | 'due_diligence' | 'upload';
  id: ID;
  label: string;
  to: string;
}

export interface VaultEntry {
  id: ID;
  name: string;
  mime: string;
  size: number;
  addedAt: string;
  docType: string;
  sources: VaultSource[];
  storeIds: ID[];
  months: string[];
  partyIds: ID[];
  tags: string[];
  note?: string;
  /** A standalone upload not yet linked to any record. */
  unlinked: boolean;
}

/** A best guess at the document type from where it lives and its name. Vault metadata overrides it. */
function guessType(name: string, source: VaultSource['kind']): string {
  const n = name.toLowerCase();
  if (source === 'license') return 'License / permit';
  if (source === 'policy') return 'Insurance policy';
  if (source === 'lease') return 'Lease';
  if (source === 'notice') return 'Tax notice';
  if (source === 'filing') return 'Filing confirmation';
  if (source === 'fuel_invoice') return 'Fuel invoice / BOL';
  if (source === 'fuel_notice') return 'Supplier notice';
  if (source === 'bill') return 'Bill / invoice';
  if (/statement/.test(n)) return 'Statement';
  if (/receipt/.test(n)) return 'Receipt';
  if (/invoice|inv[-_ ]/.test(n)) return 'Bill / invoice';
  if (/check/.test(n)) return 'Check image';
  if (source === 'asset' || source === 'maintenance') return 'Asset record';
  if (source === 'loan') return 'Loan document';
  if (source === 'due_diligence') return 'Due diligence';
  return 'Other';
}

/**
 * One index of every document: transaction, bill, fuel invoice and notice attachments, compliance and asset
 * records, and standalone uploads. The same file on two records (a bill's invoice copied onto its posting) is one entry
 * with both sources. Only documents on records the viewer may see are listed.
 */
function growthAcquisitions(state: BooksState) { return state.growth?.acquisitions ?? []; }

export function vaultIndex(state: BooksState, visible?: Set<ID>): VaultEntry[] {
  const map = new Map<ID, VaultEntry>();
  const see = (storeIds: ID[]) => !visible || storeIds.some((s) => visible.has(s));
  const corp = bankStoreId(state);
  const add = (a: Attachment, src: VaultSource, ctx: { storeIds: ID[]; month?: string; partyId?: ID }) => {
    if (!see(ctx.storeIds)) return;
    const e = map.get(a.id) ?? { id: a.id, name: a.name, mime: a.mime, size: a.size, addedAt: a.addedAt, docType: guessType(a.name, src.kind), sources: [], storeIds: [], months: [], partyIds: [], tags: [], unlinked: false };
    if (!e.sources.some((s) => s.kind === src.kind && s.id === src.id)) e.sources.push(src);
    for (const s of ctx.storeIds) if (!e.storeIds.includes(s)) e.storeIds.push(s);
    if (ctx.month && !e.months.includes(ctx.month)) e.months.push(ctx.month);
    if (ctx.partyId && !e.partyIds.includes(ctx.partyId)) e.partyIds.push(ctx.partyId);
    map.set(a.id, e);
  };
  for (const t of state.transactions) {
    if (t.deleted || !t.attachments.length) continue;
    const stores = [...new Set(t.lines.filter((l) => !l.system).map((l) => l.storeId))];
    for (const a of t.attachments) add(a, { kind: 'transaction', id: t.id, label: `${t.ref} · ${t.description}`, to: `/books/transactions/${t.id}` }, { storeIds: stores, month: periodOf(t.date), partyId: t.partyId });
  }
  for (const b of state.payables?.bills ?? []) {
    const vendor = state.parties.find((p) => p.id === b.vendorId)?.name ?? '';
    const stores = [...new Set([b.storeId, ...b.lines.map((l) => l.storeId)])];
    for (const a of [...b.attachments, ...(b.payment?.attachments ?? [])]) add(a, { kind: 'bill', id: b.id, label: `${b.ref} · ${vendor} ${b.invoiceNo}`, to: `/payables/bills/${b.id}` }, { storeIds: stores, month: periodOf(b.billDate), partyId: b.vendorId });
  }
  for (const i of state.fuel?.invoices ?? []) {
    if (i.deleted) continue;
    const party = i.supplier === 'craddock' ? 'pt_craddock' : 'pt_dash';
    for (const a of i.attachments) add(a, { kind: 'fuel_invoice', id: i.id, label: `${i.invoiceNo ? 'Invoice ' + i.invoiceNo : 'BOL ' + i.bolNo}`, to: `/fuel/invoices?q=${encodeURIComponent(i.invoiceNo ?? i.bolNo)}` }, { storeIds: [i.storeId], month: periodOf(i.deliveredOn), partyId: party });
  }
  for (const n of state.fuel?.notices ?? []) {
    for (const a of n.attachments) add(a, { kind: 'fuel_notice', id: n.id, label: `Craddock notice #${n.noticeNo}`, to: '/fuel/settlement' }, { storeIds: [n.storeId], month: periodOf(n.noticeDate), partyId: 'pt_craddock' });
  }
  const c = complianceOf(state);
  for (const l of c.licenses) for (const a of l.attachments) add(a, { kind: 'license', id: l.id, label: l.name, to: '/compliance/licenses' }, { storeIds: [l.storeId] });
  for (const p of c.policies) for (const a of p.attachments) add(a, { kind: 'policy', id: p.id, label: `${p.carrier} ${p.policyNo}`, to: '/compliance/insurance' }, { storeIds: p.storeIds });
  for (const l of c.leases) for (const a of l.attachments) add(a, { kind: 'lease', id: l.id, label: l.premises, to: '/compliance/insurance?tab=leases' }, { storeIds: [l.storeId], partyId: l.partyId });
  for (const n of c.notices) for (const a of n.attachments) add(a, { kind: 'notice', id: n.id, label: `${n.agency} ${n.noticeType}`, to: '/compliance/notices' }, { storeIds: [n.storeId ?? corp], month: periodOf(n.received) });
  for (const i of c.items) for (const o of Object.values(i.occurrences)) for (const a of o.attachments) add(a, { kind: 'filing', id: i.id, label: `${i.title} due ${o.dueDate}`, to: '/compliance/calendar' }, { storeIds: [i.storeId ?? corp], month: periodOf(o.dueDate) });
  const as = state.assets;
  for (const x of as?.assets ?? []) for (const a of x.attachments) add(a, { kind: 'asset', id: x.id, label: `${x.tag} ${x.name}`, to: `/assets?q=${x.tag}` }, { storeIds: [x.storeId] });
  for (const m of as?.maintenance ?? []) for (const a of m.attachments) add(a, { kind: 'maintenance', id: m.id, label: m.description, to: '/assets/maintenance' }, { storeIds: [m.storeId], month: periodOf(m.date) });
  for (const l of as?.loans ?? []) for (const a of l.attachments) add(a, { kind: 'loan', id: l.id, label: l.name, to: `/assets/loans/${l.id}` }, { storeIds: [l.storeId] });
  // Phase 13: acquisition due-diligence documents (read from the growth slice directly to keep imports one way).
  for (const q of growthAcquisitions(state)) for (const d of q.dd) for (const a of d.attachments) add(a, { kind: 'due_diligence', id: `${q.id}:${d.id}`, label: `${q.name}: ${d.title}`, to: `/growth/acquisitions?id=${q.id}` }, { storeIds: [corp] });
  // Vault metadata: standalone uploads, tags, types and extra links.
  for (const d of c.docs) {
    const linkStores = d.links.filter((l) => l.kind === 'store').map((l) => l.id);
    if (d.attachment) {
      const linked = d.links.length > 0;
      add(d.attachment, { kind: 'upload', id: d.id, label: 'Uploaded to the vault', to: `/compliance/vault?doc=${d.id}` }, { storeIds: linkStores.length ? linkStores : [corp] });
      const e = map.get(d.id);
      if (e) e.unlinked = !linked;
    }
    const e = map.get(d.id);
    if (!e) continue;
    if (d.docType) e.docType = d.docType;
    e.tags = [...d.tags];
    e.note = d.note;
    for (const l of d.links) {
      if (l.kind === 'store' && !e.storeIds.includes(l.id)) e.storeIds.push(l.id);
      if (l.kind === 'month' && !e.months.includes(l.id)) e.months.push(l.id);
      if (l.kind === 'party' && !e.partyIds.includes(l.id)) e.partyIds.push(l.id);
      if (l.kind === 'transaction') {
        const t = state.transactions.find((x) => x.id === l.id);
        if (t && !e.sources.some((s) => s.kind === 'transaction' && s.id === t.id)) e.sources.push({ kind: 'transaction', id: t.id, label: `${t.ref} · ${t.description}`, to: `/books/transactions/${t.id}` });
        if (t && !e.months.includes(periodOf(t.date))) e.months.push(periodOf(t.date));
      }
    }
  }
  return [...map.values()].sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.name.localeCompare(b.name));
}

export interface VaultQuery { text?: string; docType?: string; storeId?: ID; month?: string; tag?: string; partyId?: ID }

/** Metadata search: every word of the text must appear in the name, type, tags, note, sources, store codes or party names. */
export function searchVault(state: BooksState, entries: VaultEntry[], q: VaultQuery): VaultEntry[] {
  const words = (q.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? '';
  const pname = (id: ID) => state.parties.find((p) => p.id === id)?.name ?? '';
  return entries.filter((e) => {
    if (q.docType && e.docType !== q.docType) return false;
    if (q.storeId && !e.storeIds.includes(q.storeId)) return false;
    if (q.month && !e.months.includes(q.month)) return false;
    if (q.tag && !e.tags.includes(q.tag)) return false;
    if (q.partyId && !e.partyIds.includes(q.partyId)) return false;
    if (!words.length) return true;
    const hay = [e.name, e.docType, ...e.tags, e.note ?? '', ...e.sources.map((s) => s.label), ...e.storeIds.map(code), ...e.partyIds.map(pname), ...e.months].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

function docMeta(books: Books, actor: User, id: ID): VaultDoc {
  const c = ensure(books);
  let d = c.docs.find((x) => x.id === id);
  if (!d) {
    d = { id, tags: [], links: [], updatedAt: books.clock(), updatedBy: actor.id };
    c.docs.push(d);
  }
  return d;
}

/** Upload a document straight to the vault. It can be linked to a transaction, party, store or month now or later. */
export function uploadToVault(books: Books, actor: User, att: Attachment, meta: { docType?: string; tags?: string[]; storeId?: ID; month?: string; partyId?: ID; note?: string } = {}): VaultDoc {
  books.require(actor, 'docs.upload', 'upload documents');
  if (!att.name.trim()) throw new ValidationError(['The file needs a name.']);
  if (meta.month && !/^\d{4}-\d{2}$/.test(meta.month)) throw new ValidationError(['Enter the month as YYYY-MM.']);
  if (meta.storeId && !books.state.stores.some((s) => s.id === meta.storeId)) throw new ValidationError(['Choose a store, or leave it blank.']);
  const c = ensure(books);
  if (c.docs.some((d) => d.id === att.id)) throw new ValidationError(['That file is already in the vault.']);
  const links: VaultDoc['links'] = [];
  if (meta.storeId) links.push({ kind: 'store', id: meta.storeId });
  if (meta.month) links.push({ kind: 'month', id: meta.month });
  if (meta.partyId) links.push({ kind: 'party', id: meta.partyId });
  const d: VaultDoc = { id: att.id, attachment: att, docType: meta.docType?.trim() || undefined, tags: cleanTags(meta.tags ?? []), links, note: meta.note?.trim() || undefined, updatedAt: books.clock(), updatedBy: actor.id };
  c.docs.push(d);
  books.audit(actor, { action: 'upload', objectType: 'document', objectId: d.id, summary: `Uploaded ${att.name} to the document vault`, after: structuredClone(d) });
  books.changed();
  return d;
}

export function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort();
}

/** Change the type, tags or note of any document in the vault. */
export function updateDocMeta(books: Books, actor: User, id: ID, meta: { docType?: string; tags?: string[]; note?: string }): VaultDoc {
  books.require(actor, 'docs.upload', 'tag documents');
  const d = docMeta(books, actor, id);
  const before = structuredClone(d);
  if (meta.docType !== undefined) d.docType = meta.docType.trim() || undefined;
  if (meta.tags) d.tags = cleanTags(meta.tags);
  if (meta.note !== undefined) d.note = meta.note.trim() || undefined;
  d.updatedAt = books.clock();
  d.updatedBy = actor.id;
  books.audit(actor, { action: 'tag', objectType: 'document', objectId: id, summary: `Updated document details${d.tags.length ? ` (tags: ${d.tags.join(', ')})` : ''}`, before, after: structuredClone(d) });
  books.changed();
  return d;
}

/**
 * Link a document to a transaction, party, store or month. Linking to a transaction also attaches the file to it,
 * so the transaction no longer counts as "no document".
 */
export function linkDoc(books: Books, actor: User, id: ID, link: { kind: DocLinkKind; id: string }, entries?: VaultEntry[]): VaultDoc {
  books.require(actor, 'docs.upload', 'link documents');
  const errs: string[] = [];
  const s = books.state;
  if (link.kind === 'transaction' && !s.transactions.some((t) => t.id === link.id && !t.deleted)) errs.push('Pick a transaction that exists (search by TX-ref).');
  if (link.kind === 'party' && !s.parties.some((p) => p.id === link.id)) errs.push('Pick a vendor or party.');
  if (link.kind === 'store' && !s.stores.some((x) => x.id === link.id)) errs.push('Pick a store.');
  if (link.kind === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(link.id)) errs.push('Enter the month as YYYY-MM.');
  if (errs.length) throw new ValidationError(errs);
  const entry = (entries ?? vaultIndex(s)).find((e) => e.id === id);
  if (!entry) throw new ValidationError(['That document is not in the vault.']);
  const d = docMeta(books, actor, id);
  if (d.links.some((l) => l.kind === link.kind && l.id === link.id)) return d;
  const before = structuredClone(d);
  d.links.push(link);
  d.updatedAt = books.clock();
  d.updatedBy = actor.id;
  if (link.kind === 'transaction') {
    const t = s.transactions.find((x) => x.id === link.id)!;
    if (!t.attachments.some((a) => a.id === id)) {
      const att = d.attachment ?? { id, name: entry.name, mime: entry.mime, size: entry.size, addedAt: entry.addedAt, addedBy: actor.id };
      books.addAttachment(actor, t.id, { ...att });
    }
  }
  books.audit(actor, { action: 'link', objectType: 'document', objectId: id, summary: `Linked ${entry.name} to ${link.kind} ${link.id}`, before, after: structuredClone(d) });
  books.changed();
  return d;
}

export function unlinkDoc(books: Books, actor: User, id: ID, link: { kind: DocLinkKind; id: string }): void {
  books.require(actor, 'docs.upload', 'unlink documents');
  const d = ensure(books).docs.find((x) => x.id === id);
  if (!d) return;
  const before = structuredClone(d);
  d.links = d.links.filter((l) => !(l.kind === link.kind && l.id === link.id));
  books.audit(actor, { action: 'unlink', objectType: 'document', objectId: id, summary: `Unlinked document from ${link.kind} ${link.id}`, before, after: structuredClone(d) });
  books.changed();
}

/** Inbox lines for compliance (phase 9). */
export interface ComplianceInboxItem { key: string; count: number; title: string; detail: string; to: string; action: string }

export function complianceInbox(state: BooksState, visible: Set<ID>, today: string): ComplianceInboxItem[] {
  const rem = complianceReminders(state, today, visible);
  const overdue = rem.filter((r) => r.overdue);
  const soon = rem.filter((r) => !r.overdue);
  const code = (id?: ID) => (id ? state.stores.find((s) => s.id === id)?.code ?? '' : '');
  const c = complianceOf(state);
  const lic = c.licenses.filter((l) => visible.has(l.storeId) && expiryStatus(l.expiresOn, today) !== 'current');
  const pol = c.policies.filter((p) => p.storeIds.some((s) => visible.has(s)) && expiryStatus(p.expires, today) !== 'current');
  const leases = c.leases.filter((l) => visible.has(l.storeId) && expiryStatus(l.end, today, 90) !== 'current');
  const notices = openNotices(state, visible);
  const lbl = (r: OccurrenceRow) => `${r.item.title}${r.covers ? ` (${r.covers})` : ''} ${r.overdue ? `was due ${r.dueDate}` : `due ${r.dueDate}`}`;
  return [
    { key: 'cmpoverdue', count: overdue.length, title: 'Compliance filings overdue', detail: overdue.length ? overdue.slice(0, 3).map(lbl).join('; ') + (overdue.length > 3 ? '…' : '') : 'Nothing on the compliance calendar is overdue.', to: '/compliance/calendar?show=open', action: 'File' },
    { key: 'cmpdue', count: soon.length, title: 'Compliance due in the next 30 days', detail: soon.length ? soon.slice(0, 3).map(lbl).join('; ') + (soon.length > 3 ? '…' : '') : 'Nothing due in the next 30 days.', to: '/compliance/calendar?show=open', action: 'Prepare' },
    { key: 'licexp', count: lic.length + pol.length, title: 'Licenses or policies expiring within 30 days', detail: lic.length + pol.length ? [...lic.map((l) => `${l.name.startsWith(code(l.storeId)) ? "" : code(l.storeId) + " "}${l.name} ${l.expiresOn < today ? 'expired' : 'expires'} ${l.expiresOn}`), ...pol.map((p) => `${p.carrier} ${POLICY_LABEL[p.kind].toLowerCase()} expires ${p.expires}`)].join('; ') : 'Every license and policy is current.', to: lic.length ? '/compliance/licenses?show=expiring' : '/compliance/insurance', action: 'Renew' },
    ...(leases.length ? [{ key: 'leaseexp', count: leases.length, title: 'Leases ending within 90 days', detail: leases.map((l) => `${code(l.storeId)} ${l.premises} ends ${l.end}`).join('; '), to: '/compliance/insurance?tab=leases', action: 'Review' }] : []),
    { key: 'notices', count: notices.length, title: 'Tax notices open', detail: notices.length ? notices.map((n) => `${n.agency} ${n.noticeType}: answer by ${n.deadline}${daysBetween(today, n.deadline) < 0 ? ' (past the deadline)' : ''}`).join('; ') : 'No IRS or state letters waiting on us.', to: '/compliance/notices', action: 'Respond' },
  ];
}
