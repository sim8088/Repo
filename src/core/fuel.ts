import type { Books } from './books';
import { ValidationError } from './books';
import type { BooksState, ID, Store, Transaction, User } from './types';
import type {
  ComdataDay, CompetitorPrice, DashSettlement, FuelGrade, FuelImportBatch, FuelInvoice, FuelInvoiceLine, FuelNotice, FuelSale,
  FuelState, FuelTargets, FuelVendor, MudflapEntry, NoticeLine, NoticeLineType, PostedPrice, Tank, TankReading,
} from './fuelTypes';
import { validateDraft, type DraftLine, type TxnDraft } from './ledger';
import { addDays, dayOfWeek, isValidDate, lastDayOfPeriod, periodOf } from './dates';
import { allocate, formatMoney } from './money';
import { bankStoreId, matchIndex, reconciledThrough } from './bank';
import { can, PermissionError } from './permissions';
import type { ParsedComdataRow, ParsedInvoiceRow, ParsedNoticeLine } from './fuelio';

/**
 * Phase 3 — the fuel subledger.
 *
 * Craddock (HM11, HM13) settles by weekly EFT notice: card proceeds in, card fees, host discounts, network
 * fees and fuel invoices out, netted into one bank draft or deposit, and every notice nets to zero.
 * Dash Oil (HM15, HM17) pays our fuel invoices on their due date out of the card proceeds it holds for us
 * (the Dash clearing account), and remits or drafts the rest weekly.
 *
 * Ledger postings (SPEC §6):
 *   card fees → 6000, network fees (Cybera / POS) → 6010, host discounts → 4920 contra revenue,
 *   fuel invoices → 5000 (paid fuel, the cash-basis cost; accrual COGS comes from fuelCostOfSales),
 *   the draft or deposit → Trustmark, all against 1100 (Craddock) or 1110 (Dash).
 * Dating: card batch = processing date − 1 (the sales day); invoices and network fees = the notice date;
 * draft or deposit = the next business day.
 */

export const GRADES: FuelGrade[] = ['regular', 'plus', 'premium', 'diesel'];
export const TANK_GRADES: Exclude<FuelGrade, 'plus'>[] = ['regular', 'premium', 'diesel'];
export const GRADE_LABEL: Record<FuelGrade, string> = { regular: 'Regular', plus: 'Plus', premium: 'Premium', diesel: 'Diesel' };
export const VENDOR_LABEL: Record<FuelVendor, string> = { craddock: 'Craddock', dash: 'Dash Oil' };
export const NOTICE_TYPES: NoticeLineType[] = ['CC_PROCEEDS', 'CC_FEE', 'HOST_DISCOUNT', 'FUEL_INVOICE', 'OTHER', 'BANK_DRAFT', 'DEPOSIT'];
export const NOTICE_TYPE_LABEL: Record<NoticeLineType, string> = {
  CC_PROCEEDS: 'Card proceeds', CC_FEE: 'Card fee', HOST_DISCOUNT: 'Host discount / rewards', FUEL_INVOICE: 'Fuel invoice',
  OTHER: 'Network fee / other', BANK_DRAFT: 'Bank draft', DEPOSIT: 'Deposit',
};

export const FUEL_ACCT = {
  craddock: 'acct_craddock', dash: 'acct_dash', fiserv: 'acct_fiserv', bank: 'acct_trustmark', cogs: 'acct_cogs_fuel', inventory: 'acct_inv_fuel',
  cardFees: 'acct_card_fees', network: 'acct_network_fees', host: 'acct_host_discounts', mudflap: 'acct_mudflap', discounts: 'acct_fuel_discounts',
} as const;
export const FUEL_PARTY: Record<FuelVendor, ID> = { craddock: 'pt_craddock', dash: 'pt_dash' };
export const REVENUE_ACCT: Record<FuelGrade, ID> = { regular: 'acct_fuel_regular', plus: 'acct_fuel_plus', premium: 'acct_fuel_premium', diesel: 'acct_fuel_diesel' };

export const DEFAULT_TARGETS: FuelTargets = {
  cpgMin: 18, cpgMax: 45, priceOutlierPct: 5, waterInches: 1, variancePct: 1, varianceAllowanceGal: 130, reorderDays: 2.5, loadGallons: 8_800, safeFillPct: 90,
};

export function emptyFuel(): FuelState {
  return { invoices: [], notices: [], dashSettlements: [], sales: [], comdata: [], mudflap: [], tanks: [], readings: [], prices: [], competitors: [], batches: [], targets: { ...DEFAULT_TARGETS } };
}

/** The fuel slice. Books saved before phase 3 have none; they get an empty one. */
export function fuelOf(state: BooksState): FuelState {
  if (!state.fuel) state.fuel = emptyFuel();
  return state.fuel;
}

const errText = (xs: string[]) => new ValidationError(xs);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const storeOf = (state: BooksState, id: ID) => state.stores.find((s) => s.id === id);
const codeOf = (state: BooksState, id: ID) => storeOf(state, id)?.code ?? id;
const vendorOf = (s: Store | undefined): FuelVendor | null => (s?.fuelSupplier === 'craddock' || s?.fuelSupplier === 'dash' ? s.fuelSupplier : null);

function assertStore(actor: User, storeId: ID): void {
  if (!can(actor, 'view.all_stores') && !(actor.storeIds ?? []).includes(storeId)) throw new PermissionError('You can only work on your own store.');
}

// ── Dates ────────────────────────────────────────────────────────────────
function nthWeekday(y: number, month: number, dow: number, n: number): string {
  const first = `${y}-${String(month).padStart(2, '0')}-01`;
  const shift = (dow - dayOfWeek(first) + 7) % 7;
  return addDays(first, shift + (n - 1) * 7);
}
function lastWeekday(y: number, month: number, dow: number): string {
  const last = lastDayOfPeriod(`${y}-${String(month).padStart(2, '0')}`);
  return addDays(last, -((dayOfWeek(last) - dow + 7) % 7));
}

/** Federal Reserve bank holidays (a Sunday holiday is observed Monday). */
export function bankHolidays(year: number): Set<string> {
  const fixed = [`${year}-01-01`, `${year}-06-19`, `${year}-07-04`, `${year}-11-11`, `${year}-12-25`].map((d) => (dayOfWeek(d) === 0 ? addDays(d, 1) : d));
  return new Set([
    ...fixed, nthWeekday(year, 1, 1, 3), nthWeekday(year, 2, 1, 3), lastWeekday(year, 5, 1), nthWeekday(year, 9, 1, 1),
    nthWeekday(year, 10, 1, 2), nthWeekday(year, 11, 4, 4),
  ]);
}

export function isBusinessDay(date: string): boolean {
  const dow = dayOfWeek(date);
  return dow !== 0 && dow !== 6 && !bankHolidays(Number(date.slice(0, 4))).has(date);
}

/** The first business day after `date`. */
export function nextBusinessDay(date: string): string {
  let d = addDays(date, 1);
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return d;
}

/**
 * The date a notice line belongs to in the books (SPEC §6.2): card proceeds, fees and host discounts on the
 * sales day (processing date − 1); invoices and network fees on the notice date; the draft or deposit on the
 * next business day.
 */
export function noticeLineDate(n: Pick<FuelNotice, 'noticeDate'>, l: Pick<NoticeLine, 'type' | 'processingDate'>): string {
  switch (l.type) {
    case 'CC_PROCEEDS':
    case 'CC_FEE':
    case 'HOST_DISCOUNT':
      return l.processingDate ? addDays(l.processingDate, -1) : n.noticeDate;
    case 'BANK_DRAFT':
    case 'DEPOSIT':
      return nextBusinessDay(n.noticeDate);
    default:
      return n.noticeDate;
  }
}

// ── Ledger helpers ───────────────────────────────────────────────────────
/** Balance of one account at one store through a date (debit − credit). */
export function storeBalance(state: BooksState, accountId: ID, storeIds: ID | ID[] | null, asOf: string): number {
  const set = storeIds === null ? null : new Set(Array.isArray(storeIds) ? storeIds : [storeIds]);
  let n = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf) continue;
    for (const l of t.lines) if (l.accountId === accountId && (!set || set.has(l.storeId))) n += l.debit - l.credit;
  }
  return n;
}

/** One line per account: debit when amount > 0, credit when < 0. Zero amounts are dropped. */
function legs(entries: [ID, ID, number, string?][]): DraftLine[] {
  const m = new Map<string, { accountId: ID; storeId: ID; amount: number; memo?: string }>();
  for (const [accountId, storeId, amount, memo] of entries) {
    const k = `${accountId}|${storeId}`;
    const e = m.get(k) ?? { accountId, storeId, amount: 0, memo };
    e.amount += amount;
    m.set(k, e);
  }
  return [...m.values()].filter((e) => e.amount !== 0).map((e) => ({ accountId: e.accountId, storeId: e.storeId, debit: e.amount > 0 ? e.amount : 0, credit: e.amount < 0 ? -e.amount : 0, memo: e.memo }));
}

function postAll(books: Books, actor: User, drafts: TxnDraft[], source: Transaction['source'], batchId?: string): Transaction[] {
  const errs = drafts.flatMap((d) => validateDraft(books.state, d).map((e) => `${d.description}: ${e}`));
  if (errs.length) throw errText([...new Set(errs)]);
  return drafts.map((d) => books.createTransaction(actor, d, { source, batchId }));
}

function newBatch(books: Books, actor: User, kind: FuelImportBatch['kind'], fileName: string, added: number, skipped: number): FuelImportBatch {
  const b: FuelImportBatch = { id: books.nextId('fimp'), kind, fileName, importedAt: books.clock(), by: actor.id, added, skipped };
  fuelOf(books.state).batches.push(b);
  return b;
}

// ── Fuel invoices / BOLs ─────────────────────────────────────────────────
export interface InvoiceInput {
  id?: ID;
  supplier: FuelVendor;
  storeId: ID;
  invoiceNo?: string;
  bolNo: string;
  deliveredOn: string;
  dueOn: string;
  lines: FuelInvoiceLine[];
  freight: number;
  taxes: number;
  /** Defaults to Σ cost + freight + taxes. When given it must agree. */
  total?: number;
}

export function invoiceTotal(i: Pick<FuelInvoice, 'lines' | 'freight' | 'taxes'>): number {
  return i.lines.reduce((a, l) => a + l.cost, 0) + i.freight + i.taxes;
}

export function invoiceGallons(i: Pick<FuelInvoice, 'lines'>): number {
  return r3(i.lines.reduce((a, l) => a + l.netGallons, 0));
}

function validateInvoice(state: BooksState, x: InvoiceInput): string[] {
  const errs: string[] = [];
  const s = storeOf(state, x.storeId);
  if (!s) errs.push('Choose the store the fuel was delivered to.');
  else if (vendorOf(s) !== x.supplier) errs.push(`${s.code} buys fuel from ${s.fuelSupplier === 'none' ? 'nobody' : VENDOR_LABEL[s.fuelSupplier as FuelVendor]}, not ${VENDOR_LABEL[x.supplier]}. Check the store on the invoice.`);
  if (!x.bolNo.trim()) errs.push('Enter the BOL number from the driver\'s bill of lading.');
  if (!isValidDate(x.deliveredOn)) errs.push('Enter the delivered date as YYYY-MM-DD.');
  if (!isValidDate(x.dueOn)) errs.push('Enter the due date as YYYY-MM-DD.');
  else if (isValidDate(x.deliveredOn) && x.dueOn < x.deliveredOn) errs.push('The due date can\'t be before the delivery.');
  if (!x.lines.length) errs.push('Add at least one grade with its gallons.');
  x.lines.forEach((l, i) => {
    if (!TANK_GRADES.includes(l.grade)) errs.push(`Line ${i + 1}: Plus is blended at the pump; invoices carry Regular, Premium or Diesel.`);
    if (!(l.netGallons > 0) || !(l.grossGallons > 0)) errs.push(`Line ${i + 1}: gross and net gallons must be above zero.`);
    if (!Number.isSafeInteger(l.cost) || l.cost < 0) errs.push(`Line ${i + 1}: cost must be an amount in dollars and cents.`);
    if (x.invoiceNo?.trim() && l.cost === 0) errs.push(`Line ${i + 1}: an invoice needs the cost for each grade. Leave the invoice # blank to log only the BOL.`);
  });
  if (!Number.isSafeInteger(x.freight) || x.freight < 0 || !Number.isSafeInteger(x.taxes) || x.taxes < 0) errs.push('Freight and taxes must be amounts of zero or more.');
  const sum = x.lines.reduce((a, l) => a + (Number.isSafeInteger(l.cost) ? l.cost : 0), 0) + x.freight + x.taxes;
  if (x.total !== undefined && x.total !== sum) errs.push(`The lines, freight and taxes add up to ${formatMoney(sum, { dollarSign: true })} but the invoice total is ${formatMoney(x.total, { dollarSign: true })}. Check each line against the paper invoice.`);
  return errs;
}

/** Log a delivery (BOL) and its invoice, or update one that hasn't been settled. Duplicates and outliers are flagged, not blocked. */
export function saveInvoice(books: Books, actor: User, x: InvoiceInput, opts: { source?: FuelInvoice['source']; batchId?: string } = {}): FuelInvoice {
  books.require(actor, 'fuel.edit', 'record fuel invoices');
  const errs = validateInvoice(books.state, x);
  const fuel = fuelOf(books.state);
  const existing = x.id ? fuel.invoices.find((i) => i.id === x.id) : undefined;
  if (existing?.settlement) errs.push('This invoice is already settled. Unpost the notice that netted it before changing it.');
  if (errs.length) throw errText(errs);
  const lines = x.lines.map((l) => ({ ...l, grossGallons: r3(l.grossGallons), netGallons: r3(l.netGallons) }));
  const inv: FuelInvoice = {
    id: existing?.id ?? books.nextId('finv'), supplier: x.supplier, storeId: x.storeId, invoiceNo: x.invoiceNo?.trim() || undefined, bolNo: x.bolNo.trim(),
    deliveredOn: x.deliveredOn, dueOn: x.dueOn, lines, freight: x.freight, taxes: x.taxes, total: invoiceTotal({ lines, freight: x.freight, taxes: x.taxes }),
    attachments: existing?.attachments ?? [], batchId: existing?.batchId ?? opts.batchId ?? `manual-${books.state.seq + 1}`, source: existing?.source ?? opts.source ?? 'manual',
    createdAt: existing?.createdAt ?? books.clock(), createdBy: existing?.createdBy ?? actor.id,
  };
  const before = existing ? structuredClone(existing) : undefined;
  if (existing) Object.assign(existing, inv);
  else fuel.invoices.push(inv);
  books.audit(actor, { action: existing ? 'update' : 'create', objectType: 'fuel', objectId: inv.id, summary: `${existing ? 'Updated' : 'Logged'} ${VENDOR_LABEL[inv.supplier]} ${inv.invoiceNo ? 'invoice ' + inv.invoiceNo : 'delivery'} (BOL ${inv.bolNo}) for ${codeOf(books.state, inv.storeId)}: ${formatMoney(inv.total, { dollarSign: true })}`, before, after: inv });
  books.changed();
  return existing ?? inv;
}

/** Soft-delete an unsettled invoice (e.g. the second copy of a duplicate). */
export function removeInvoice(books: Books, actor: User, id: ID, reason: string): void {
  books.require(actor, 'fuel.edit', 'remove fuel invoices');
  const inv = fuelOf(books.state).invoices.find((i) => i.id === id);
  if (!inv || inv.deleted) return;
  if (!reason.trim()) throw errText(['Say why you are removing this invoice, e.g. "duplicate of the copy emailed on the 12th".']);
  if (inv.settlement) throw errText(['This invoice is already settled, so it stays. Unpost the notice that netted it first.']);
  inv.deleted = { at: books.clock(), by: actor.id, reason: reason.trim() };
  books.audit(actor, { action: 'delete', objectType: 'fuel', objectId: id, summary: `Removed fuel invoice ${inv.invoiceNo ?? 'BOL ' + inv.bolNo}`, reason });
  books.changed();
}

export function attachToInvoice(books: Books, actor: User, id: ID, att: FuelInvoice['attachments'][number]): void {
  books.require(actor, 'fuel.edit', 'attach invoice documents');
  const inv = fuelOf(books.state).invoices.find((i) => i.id === id);
  if (!inv) throw errText(['That invoice no longer exists.']);
  inv.attachments.push(att);
  books.audit(actor, { action: 'attach', objectType: 'fuel', objectId: id, summary: `Attached ${att.name} to fuel invoice ${inv.invoiceNo ?? 'BOL ' + inv.bolNo}` });
  books.changed();
}

export function liveInvoices(state: BooksState): FuelInvoice[] {
  return fuelOf(state).invoices.filter((i) => !i.deleted);
}

export interface InvoiceFlags {
  /** The earlier invoice this one repeats (same supplier and invoice #, or same BOL). */
  duplicateOf?: ID;
  /** A BOL with no invoice yet. */
  missingInvoice: boolean;
  outliers: { grade: FuelGrade; cpg: number; monthCpg: number; pct: number }[];
  /** Due, not settled, and not waiting on an unposted notice. */
  unsettledPastDue: boolean;
  /** Netted by a notice that isn't posted yet. */
  onUnpostedNotice?: ID;
}

/** Product cost per net gallon for one invoice line, in cents. */
const lineCpg = (l: FuelInvoiceLine) => (l.netGallons > 0 ? l.cost / l.netGallons : 0);

export function invoiceFlags(state: BooksState, today: string): Map<ID, InvoiceFlags> {
  const live = liveInvoices(state);
  const out = new Map<ID, InvoiceFlags>();
  const seenNo = new Map<string, ID>();
  const seenBol = new Map<string, ID>();
  const unposted = new Map<string, ID>();
  for (const n of fuelOf(state).notices) if (n.status === 'unposted') for (const l of n.lines) if (l.type === 'FUEL_INVOICE' && l.invoiceNo) unposted.set(`${n.storeId}|${l.invoiceNo}`, n.id);
  for (const i of live) {
    const f: InvoiceFlags = { missingInvoice: !i.invoiceNo, outliers: [], unsettledPastDue: false };
    const kNo = i.invoiceNo ? `${i.supplier}|${i.invoiceNo.toUpperCase()}` : '';
    // A blank BOL matches nothing: only a BOL number that is actually there can be a duplicate.
    const kBol = i.bolNo.trim() ? `${i.supplier}|${i.bolNo.trim().toUpperCase()}` : '';
    f.duplicateOf = (kNo && seenNo.get(kNo)) || (kBol ? seenBol.get(kBol) : undefined);
    if (kNo && !seenNo.has(kNo)) seenNo.set(kNo, i.id);
    if (kBol && !seenBol.has(kBol)) seenBol.set(kBol, i.id);
    f.onUnpostedNotice = i.invoiceNo ? unposted.get(`${i.storeId}|${i.invoiceNo}`) : undefined;
    f.unsettledPastDue = !i.settlement && !f.duplicateOf && !!i.invoiceNo && !f.onUnpostedNotice && i.dueOn < today;
    out.set(i.id, f);
  }
  // Price outliers: product cost/gal vs the month's average for that grade from the same supplier (other invoices only).
  const basis = live.filter((i) => i.invoiceNo && !out.get(i.id)!.duplicateOf);
  const pct = fuelOf(state).targets.priceOutlierPct;
  for (const i of basis) {
    for (const l of i.lines) {
      const peers = basis.filter((o) => o.id !== i.id && o.supplier === i.supplier && periodOf(o.deliveredOn) === periodOf(i.deliveredOn)).flatMap((o) => o.lines.filter((x) => x.grade === l.grade));
      if (peers.length < 2) continue;
      const gal = peers.reduce((a, x) => a + x.netGallons, 0);
      const avg = peers.reduce((a, x) => a + x.cost, 0) / gal;
      const cpg = lineCpg(l);
      const dev = ((cpg - avg) / avg) * 100;
      if (Math.abs(dev) > pct) out.get(i.id)!.outliers.push({ grade: l.grade, cpg, monthCpg: avg, pct: dev });
    }
  }
  return out;
}

/** Freight and taxes spread over the lines by net gallons, so each grade carries its full delivered cost. */
export function deliveredLines(i: FuelInvoice): { grade: Exclude<FuelGrade, 'plus'>; netGallons: number; cost: number }[] {
  const extra = i.freight + i.taxes;
  const shares = extra && i.lines.length ? allocate(extra, i.lines.map((l) => l.netGallons)) : i.lines.map(() => 0);
  return i.lines.map((l, k) => ({ grade: l.grade, netGallons: l.netGallons, cost: l.cost + shares[k] }));
}

// ── Invoice import ───────────────────────────────────────────────────────
export interface InvoiceImportPreview {
  invoices: (InvoiceInput & { key: string; storeCode: string; duplicate: boolean; problems: string[] })[];
  added: number;
  skipped: number;
  total: number;
  gallons: number;
}

export const invoiceKey = (x: { supplier: string; storeId: ID; invoiceNo?: string; bolNo: string }) => `${x.supplier}|${x.storeId}|${(x.invoiceNo ?? '').toUpperCase()}|${x.bolNo.toUpperCase()}`;

export function previewInvoiceImport(state: BooksState, rows: ParsedInvoiceRow[]): InvoiceImportPreview {
  const byKey = new Map<string, InvoiceImportPreview['invoices'][number]>();
  for (const r of rows) {
    const s = state.stores.find((x) => x.code.toUpperCase() === r.storeCode && !x.deleted);
    const storeId = s?.id ?? '';
    const key = invoiceKey({ supplier: r.supplier, storeId: storeId || r.storeCode, invoiceNo: r.invoiceNo, bolNo: r.bolNo });
    let inv = byKey.get(key);
    if (!inv) {
      inv = { key, storeCode: r.storeCode, supplier: r.supplier, storeId, invoiceNo: r.invoiceNo, bolNo: r.bolNo, deliveredOn: r.deliveredOn, dueOn: r.dueOn, lines: [], freight: 0, taxes: 0, duplicate: false, problems: [] };
      if (!s) inv.problems.push(`Store "${r.storeCode}" isn't set up. Use a store code such as HM11.`);
      byKey.set(key, inv);
    }
    inv.lines.push({ grade: r.grade, grossGallons: r.grossGallons, netGallons: r.netGallons, cost: r.cost });
    inv.freight += r.freight;
    inv.taxes += r.taxes;
  }
  const existing = new Set(liveInvoices(state).map((i) => invoiceKey(i)));
  const invoices = [...byKey.values()].map((i) => {
    const problems = [...i.problems, ...(i.storeId ? validateInvoice(state, i) : [])];
    return { ...i, problems, duplicate: existing.has(i.key) };
  });
  const fresh = invoices.filter((i) => !i.duplicate && !i.problems.length);
  return {
    invoices, added: fresh.length, skipped: invoices.length - fresh.length,
    total: fresh.reduce((a, i) => a + invoiceTotal(i), 0), gallons: r3(fresh.reduce((a, i) => a + invoiceGallons(i), 0)),
  };
}

/** Import invoices from a file: one batch, idempotent (an invoice already on file is skipped), batch id on every record. */
export function commitInvoiceImport(books: Books, actor: User, file: { name: string; rows: ParsedInvoiceRow[] }, opts: { source?: FuelInvoice['source'] } = {}): { batch: FuelImportBatch; invoices: FuelInvoice[] } {
  books.require(actor, 'fuel.edit', 'import fuel invoices');
  const p = previewInvoiceImport(books.state, file.rows);
  const batch = newBatch(books, actor, 'invoices', file.name, p.added, p.skipped);
  const invoices = p.invoices.filter((i) => !i.duplicate && !i.problems.length).map((i) => saveInvoice(books, actor, i, { source: opts.source ?? 'import', batchId: batch.id }));
  books.audit(actor, { action: 'import', objectType: 'fuel', objectId: batch.id, summary: `Imported ${file.name}: ${p.added} fuel invoices, ${p.skipped} skipped` });
  books.changed();
  return { batch, invoices };
}

// ── Craddock EFT notices ─────────────────────────────────────────────────
export interface NoticeInput {
  storeId: ID;
  noticeNo: string;
  noticeDate: string;
  lines: Omit<NoticeLine, 'id' | 'batchId'>[];
}

/** A notice line before it is stored (no batch yet). */
export type NoticeLineLike = Omit<NoticeLine, 'batchId'>;

export const noticeNet = (n: { lines: { amount: number }[] }) => n.lines.reduce((a, l) => a + l.amount, 0);
export const noticeKey = (storeId: ID, noticeNo: string) => `craddock|${storeId}|${noticeNo.trim().toUpperCase()}`;

function validateNotice(state: BooksState, x: NoticeInput, ignoreId?: ID): string[] {
  const errs: string[] = [];
  const s = storeOf(state, x.storeId);
  if (!s) errs.push('Choose the store this notice is for.');
  else if (s.fuelSupplier !== 'craddock') errs.push(`${s.code} isn't a Craddock store. Dash stores settle through the Dash clearing account instead.`);
  if (!x.noticeNo.trim()) errs.push('Enter the notice number printed on the EFT notice.');
  if (!isValidDate(x.noticeDate)) errs.push('Enter the notice date as YYYY-MM-DD.');
  if (!x.lines.length) errs.push('A notice needs its lines: card proceeds, fees, invoices and the draft or deposit.');
  x.lines.forEach((l, i) => {
    if (!Number.isSafeInteger(l.amount)) errs.push(`Line ${i + 1}: the amount must be dollars and cents.`);
    if (l.processingDate && !isValidDate(l.processingDate)) errs.push(`Line ${i + 1}: the processing date must be YYYY-MM-DD.`);
  });
  if (x.lines.filter((l) => l.type === 'BANK_DRAFT' || l.type === 'DEPOSIT').length > 1) errs.push('A notice settles with one draft or one deposit. Combine the bank lines.');
  if (s && x.noticeNo.trim() && fuelOf(state).notices.some((n) => n.id !== ignoreId && noticeKey(n.storeId, n.noticeNo) === noticeKey(x.storeId, x.noticeNo))) errs.push(`Notice ${x.noticeNo} for ${s.code} is already on file.`);
  return errs;
}

/** Enter a notice by hand (or from an import). It is saved unposted; post it with postNotice. */
export function saveNotice(books: Books, actor: User, x: NoticeInput, opts: { source?: FuelNotice['source']; batchId?: string } = {}): FuelNotice {
  books.require(actor, 'fuel.edit', 'enter supplier notices');
  const errs = validateNotice(books.state, x);
  if (errs.length) throw errText(errs);
  const n: FuelNotice = {
    id: books.nextId('fnot'), supplier: 'craddock', storeId: x.storeId, noticeNo: x.noticeNo.trim(), noticeDate: x.noticeDate,
    lines: [], status: 'unposted', txnIds: [], batchId: opts.batchId ?? `manual-${books.state.seq + 1}`, source: opts.source ?? 'manual', attachments: [],
  };
  n.lines = x.lines.map((l) => ({ ...l, id: books.nextId('fnl'), description: l.description.trim() || NOTICE_TYPE_LABEL[l.type], invoiceNo: l.invoiceNo?.trim() || undefined, batchId: n.batchId }));
  fuelOf(books.state).notices.push(n);
  books.audit(actor, { action: 'create', objectType: 'fuel', objectId: n.id, summary: `Entered Craddock notice #${n.noticeNo} for ${codeOf(books.state, n.storeId)} (${n.lines.length} lines, nets to ${formatMoney(noticeNet(n), { dollarSign: true })})`, after: n });
  books.changed();
  return n;
}

export interface NoticeCheck {
  net: number;
  netsToZero: boolean;
  bankLine?: NoticeLineLike;
  /** Each invoice line against the invoice on file. */
  invoices: { line: NoticeLineLike; invoice?: FuelInvoice; problem?: string }[];
  /** Card proceeds per sales day vs the card sales the POS put into the receivable that day. */
  proceeds: { salesDate: string; proceeds: number; pos: number; diff: number }[];
  problems: string[];
  canPost: boolean;
}

/** Card sales the POS (or the opening balance) debited to a clearing account for one store and day. */
export function cardIntoClearing(state: BooksState, accountId: ID, storeId: ID, date: string): number {
  let n = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date !== date || !(t.tags.includes('pos') || t.kind === 'opening')) continue;
    for (const l of t.lines) if (l.accountId === accountId && l.storeId === storeId) n += l.debit - l.credit;
  }
  return n;
}

export function checkNotice(state: BooksState, n: Pick<FuelNotice, 'storeId' | 'noticeDate'> & { id?: ID; lines: NoticeLineLike[] }): NoticeCheck {
  const net = noticeNet(n);
  const problems: string[] = [];
  const bank = n.lines.filter((l) => l.type === 'BANK_DRAFT' || l.type === 'DEPOSIT');
  if (net !== 0) problems.push(`The lines net to ${formatMoney(net, { dollarSign: true })}, not zero. Check every line against the paper notice; the draft or deposit should equal everything else.`);
  if (bank.length > 1) problems.push('A notice settles with one draft or one deposit.');
  if (bank.some((l) => (l.type === 'BANK_DRAFT' ? l.amount < 0 : l.amount > 0))) problems.push('A draft takes money from our bank (+ on the notice); a deposit pays us (−). Check the line type.');
  const invs = liveInvoices(state);
  const flags = invoiceFlags(state, '9999-12-31');
  const invoices = n.lines.filter((l) => l.type === 'FUEL_INVOICE').map((line) => {
    const invoice = invs.find((i) => i.supplier === 'craddock' && i.storeId === n.storeId && i.invoiceNo && line.invoiceNo && i.invoiceNo.toUpperCase() === line.invoiceNo.toUpperCase() && !flags.get(i.id)?.duplicateOf);
    let problem: string | undefined;
    if (!line.invoiceNo) problem = 'No invoice number on this line.';
    else if (!invoice) problem = `Invoice ${line.invoiceNo} isn't on file. It posts to fuel cost now; log the invoice when it arrives.`;
    else if (invoice.total !== -line.amount) { problem = `On file at ${formatMoney(invoice.total, { dollarSign: true })}, on the notice at ${formatMoney(-line.amount, { dollarSign: true })}.`; problems.push(`Invoice ${line.invoiceNo}: ${problem} Fix the invoice or ask Craddock for a corrected notice.`); }
    else if (invoice.settlement && !(invoice.settlement.kind === 'notice' && invoice.settlement.noticeId === n.id)) { problem = 'Already settled on another notice.'; problems.push(`Invoice ${line.invoiceNo} was already netted on another notice. Remove the line or call Craddock.`); }
    return { line, invoice, problem };
  });
  const byDay = new Map<string, number>();
  for (const l of n.lines) if (l.type === 'CC_PROCEEDS') { const d = noticeLineDate(n, l); byDay.set(d, (byDay.get(d) ?? 0) + l.amount); }
  const proceeds = [...byDay].sort().map(([salesDate, p]) => {
    const pos = cardIntoClearing(state, FUEL_ACCT.craddock, n.storeId, salesDate);
    return { salesDate, proceeds: p, pos, diff: p - pos };
  });
  return { net, netsToZero: net === 0, bankLine: bank[0], invoices, proceeds, problems, canPost: problems.length === 0 && n.lines.length > 0 };
}

/**
 * Post a Craddock notice to the ledger. One entry per sales day for card fees and host discounts, one on
 * the notice date for fuel invoices and network fees, and the draft or deposit on the next business day.
 * Every entry is validated before any is posted, so a notice posts completely or not at all.
 */
export function postNotice(books: Books, actor: User, noticeId: ID): Transaction[] {
  books.require(actor, 'fuel.post', 'post supplier notices');
  const state = books.state;
  const n = fuelOf(state).notices.find((x) => x.id === noticeId);
  if (!n) throw errText(['That notice no longer exists.']);
  if (n.status === 'posted') throw errText([`Notice #${n.noticeNo} is already posted.`]);
  const chk = checkNotice(state, n);
  if (!chk.canPost) throw errText(chk.problems.length ? chk.problems : ['This notice has no lines to post.']);
  const store = n.storeId;
  const code = codeOf(state, store);
  const rec = FUEL_ACCT.craddock;
  const corp = bankStoreId(state);
  const party = FUEL_PARTY.craddock;
  const drafts: TxnDraft[] = [];
  let invoiceDraft = -1;
  // Card fees and host discounts, one entry per sales day.
  const byDay = new Map<string, NoticeLine[]>();
  const noticeDay: NoticeLine[] = [];
  for (const l of n.lines) {
    if (l.type === 'CC_FEE' || l.type === 'HOST_DISCOUNT') {
      const d = noticeLineDate(n, l);
      if (d === n.noticeDate) noticeDay.push(l);
      else byDay.set(d, [...(byDay.get(d) ?? []), l]);
    } else if (l.type === 'FUEL_INVOICE' || l.type === 'OTHER') noticeDay.push(l);
  }
  const acctFor = (l: NoticeLine) => (l.type === 'CC_FEE' ? FUEL_ACCT.cardFees : l.type === 'HOST_DISCOUNT' ? FUEL_ACCT.host : l.type === 'FUEL_INVOICE' ? FUEL_ACCT.cogs : FUEL_ACCT.network);
  const memoFor = (l: NoticeLine) => (l.type === 'FUEL_INVOICE' ? `Invoice ${l.invoiceNo ?? '(no number)'}` : l.description);
  for (const [d, ls] of [...byDay].sort()) {
    drafts.push({ date: d, kind: 'journal', description: `Craddock notice #${n.noticeNo} ${code} · card fees ${d}`, docNo: n.noticeNo, tags: ['fuel', 'card fees'],
      lines: legs([...ls.map((l): [ID, ID, number, string] => [acctFor(l), store, -l.amount, memoFor(l)]), [rec, store, ls.reduce((a, l) => a + l.amount, 0), `Notice #${n.noticeNo}`]]) });
  }
  if (noticeDay.length) {
    const invoiceLines = noticeDay.filter((l) => l.type === 'FUEL_INVOICE');
    const lines: DraftLine[] = [];
    // Invoices stay one line each so every invoice traces to its own ledger line.
    for (const l of invoiceLines) lines.push(...legs([[FUEL_ACCT.cogs, store, -l.amount, memoFor(l)]]).map((x) => ({ ...x, partyId: party })));
    lines.push(...legs(noticeDay.filter((l) => l.type !== 'FUEL_INVOICE').map((l): [ID, ID, number, string] => [acctFor(l), store, -l.amount, memoFor(l)])));
    lines.push(...legs([[rec, store, noticeDay.reduce((a, l) => a + l.amount, 0), `Notice #${n.noticeNo}`]]));
    if (lines.length >= 2) invoiceDraft = drafts.push({ date: n.noticeDate, kind: 'journal', description: `Craddock notice #${n.noticeNo} ${code} · fuel invoices & network fees`, docNo: n.noticeNo, partyId: party, tags: ['fuel'], lines }) - 1;
  }
  const bank = chk.bankLine;
  if (bank && bank.amount !== 0) {
    const d = noticeLineDate(n, bank);
    // Draft (+): Craddock pulls from our bank, which pays down what we owe. Deposit (−): Craddock pays us.
    drafts.push({ date: d, kind: 'transfer', description: `Craddock EFT notice #${n.noticeNo} ${code}`, docNo: n.noticeNo, partyId: party, tags: ['fuel', 'settlement'],
      lines: bank.amount > 0
        ? [{ accountId: rec, storeId: store, debit: bank.amount, credit: 0, memo: 'Draft' }, { accountId: FUEL_ACCT.bank, storeId: corp, debit: 0, credit: bank.amount, memo: 'Draft' }]
        : [{ accountId: FUEL_ACCT.bank, storeId: corp, debit: -bank.amount, credit: 0, memo: 'Deposit' }, { accountId: rec, storeId: store, debit: 0, credit: -bank.amount, memo: 'Deposit' }] });
  }
  const txns = postAll(books, actor, drafts, n.source === 'demo' ? 'demo' : 'import', n.batchId);
  const invTxn = txns[invoiceDraft] ?? txns[0];
  for (const c of chk.invoices) if (c.invoice) c.invoice.settlement = { kind: 'notice', noticeId: n.id, on: n.noticeDate, txnId: invTxn.id };
  n.status = 'posted';
  n.postedAt = books.clock();
  n.postedBy = actor.id;
  n.txnIds = txns.map((t) => t.id);
  books.audit(actor, { action: 'post', objectType: 'fuel', objectId: n.id, summary: `Posted Craddock notice #${n.noticeNo} ${code}: ${txns.length} entries, ${bank ? (bank.amount > 0 ? 'draft' : 'deposit') + ' ' + formatMoney(Math.abs(bank.amount), { dollarSign: true }) : 'no bank movement'}`, after: { txnIds: n.txnIds } });
  books.changed();
  return txns;
}

/** Reverse a posted notice: its entries are soft-deleted with the reason, and its invoices are open again. */
export function unpostNotice(books: Books, actor: User, noticeId: ID, reason: string): void {
  books.require(actor, 'fuel.post', 'unpost supplier notices');
  const n = fuelOf(books.state).notices.find((x) => x.id === noticeId);
  if (!n || n.status !== 'posted') return;
  if (!reason.trim()) throw errText(['Say why you are unposting this notice. It goes in the audit log.']);
  const idx = matchIndex(books.state);
  for (const id of n.txnIds) {
    const t = books.getTransaction(id);
    for (const l of t?.lines ?? []) {
      const b = idx.get(l.id);
      const thru = b ? reconciledThrough(books.state, b.accountId) : null;
      if (b && thru && b.date <= thru) throw errText([`The draft or deposit is in the bank reconciliation through ${thru}. Undo that reconciliation first.`]);
    }
  }
  for (const id of n.txnIds) books.deleteTransaction(actor, id, `Unposted Craddock notice #${n.noticeNo}: ${reason.trim()}`);
  for (const i of fuelOf(books.state).invoices) if (i.settlement?.kind === 'notice' && i.settlement.noticeId === n.id) delete i.settlement;
  n.status = 'unposted';
  n.txnIds = [];
  books.audit(actor, { action: 'unpost', objectType: 'fuel', objectId: n.id, summary: `Unposted Craddock notice #${n.noticeNo}`, reason });
  books.changed();
}

// ── Notice import ────────────────────────────────────────────────────────
export interface NoticeImportPreview {
  notices: { key: string; noticeNo: string; storeCode: string; storeId: ID; noticeDate: string; lines: Omit<NoticeLine, 'id' | 'batchId'>[]; net: number; duplicate: boolean; problems: string[]; check?: NoticeCheck }[];
  added: number;
  skipped: number;
  lineCount: number;
}

export function previewNoticeImport(state: BooksState, lines: ParsedNoticeLine[]): NoticeImportPreview {
  const groups = new Map<string, NoticeImportPreview['notices'][number]>();
  for (const l of lines) {
    const s = state.stores.find((x) => x.code.toUpperCase() === l.storeCode && !x.deleted);
    const key = noticeKey(s?.id ?? l.storeCode, l.noticeNo);
    let g = groups.get(key);
    if (!g) {
      g = { key, noticeNo: l.noticeNo, storeCode: l.storeCode, storeId: s?.id ?? '', noticeDate: l.noticeDate, lines: [], net: 0, duplicate: false, problems: [] };
      if (!s) g.problems.push(`Store "${l.storeCode}" isn't set up.`);
      groups.set(key, g);
    }
    if (l.noticeDate !== g.noticeDate) g.problems.push(`Notice ${l.noticeNo} has more than one notice date in the file.`);
    g.lines.push({ type: l.type, amount: l.amount, description: l.description, processingDate: l.processingDate, invoiceNo: l.invoiceNo });
  }
  const existing = new Set(fuelOf(state).notices.map((n) => noticeKey(n.storeId, n.noticeNo)));
  const notices = [...groups.values()].map((g) => {
    const duplicate = existing.has(g.key);
    const problems = [...new Set(g.problems)];
    if (g.storeId && !duplicate) problems.push(...validateNotice(state, { storeId: g.storeId, noticeNo: g.noticeNo, noticeDate: g.noticeDate, lines: g.lines }));
    const check = g.storeId ? checkNotice(state, { storeId: g.storeId, noticeDate: g.noticeDate, lines: g.lines.map((l, i) => ({ ...l, id: String(i) })) }) : undefined;
    return { ...g, net: noticeNet(g), duplicate, problems, check };
  });
  const fresh = notices.filter((n) => !n.duplicate && !n.problems.length);
  return { notices, added: fresh.length, skipped: notices.length - fresh.length, lineCount: fresh.reduce((a, n) => a + n.lines.length, 0) };
}

/** Import notices from a file in one batch. Idempotent: a notice already on file is skipped. Optionally post each one that nets to zero. */
export function commitNoticeImport(books: Books, actor: User, file: { name: string; lines: ParsedNoticeLine[] }, opts: { post?: boolean; source?: FuelNotice['source'] } = {}): { batch: FuelImportBatch; notices: FuelNotice[]; posted: number; notPosted: string[] } {
  books.require(actor, 'fuel.edit', 'import supplier notices');
  if (opts.post) books.require(actor, 'fuel.post', 'post supplier notices');
  const p = previewNoticeImport(books.state, file.lines);
  const batch = newBatch(books, actor, 'notices', file.name, p.added, p.skipped);
  const notices = p.notices.filter((n) => !n.duplicate && !n.problems.length).map((n) => saveNotice(books, actor, { storeId: n.storeId, noticeNo: n.noticeNo, noticeDate: n.noticeDate, lines: n.lines }, { source: opts.source ?? 'import', batchId: batch.id }));
  let posted = 0;
  const notPosted: string[] = [];
  if (opts.post) {
    for (const n of notices) {
      try { postNotice(books, actor, n.id); posted++; } catch (e) { notPosted.push(`#${n.noticeNo}: ${(e as Error).message}`); }
    }
  }
  books.audit(actor, { action: 'import', objectType: 'fuel', objectId: batch.id, summary: `Imported ${file.name}: ${p.added} Craddock notices (${p.lineCount} lines), ${p.skipped} skipped, ${posted} posted` });
  books.changed();
  return { batch, notices, posted, notPosted };
}

// ── Craddock receivable ──────────────────────────────────────────────────
export interface ReceivableTie {
  storeId: ID;
  asOf: string;
  ledger: number;
  opening: number;
  posCard: number;
  /** Relief from posted notices dated on or before asOf (fees, invoices, network fees, the draft or deposit). */
  relief: number;
  explained: number;
  difference: number;
  /** Card sales days not yet on a posted notice. */
  openBatches: { salesDate: string; amount: number }[];
}

/**
 * The Craddock receivable (1100) for a store at any date, explained from the subledger:
 * opening + card sales from the POS − what posted notices relieved = the ledger balance.
 */
export function craddockReceivable(state: BooksState, storeId: ID, asOf: string): ReceivableTie {
  const acct = FUEL_ACCT.craddock;
  let ledger = 0;
  let opening = 0;
  let posCard = 0;
  const cardDays = new Map<string, number>();
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf) continue;
    for (const l of t.lines) {
      if (l.accountId !== acct || l.storeId !== storeId) continue;
      const v = l.debit - l.credit;
      ledger += v;
      if (t.kind === 'opening') { opening += v; cardDays.set(t.date, (cardDays.get(t.date) ?? 0) + v); }
      else if (t.tags.includes('pos')) { posCard += v; cardDays.set(t.date, (cardDays.get(t.date) ?? 0) + v); }
    }
  }
  let relief = 0;
  const covered = new Set<string>();
  for (const n of fuelOf(state).notices) {
    if (n.storeId !== storeId || n.status !== 'posted') continue;
    for (const l of n.lines) {
      const d = noticeLineDate(n, l);
      if (l.type === 'CC_PROCEEDS') { if (n.noticeDate <= asOf) covered.add(d); continue; }
      if (d <= asOf) relief -= l.amount;
    }
  }
  const openBatches = [...cardDays].filter(([d]) => !covered.has(d)).sort().map(([salesDate, amount]) => ({ salesDate, amount }));
  const explained = opening + posCard - relief;
  return { storeId, asOf, ledger, opening, posCard, relief, explained, difference: ledger - explained, openBatches };
}

// ── Dash clearing ────────────────────────────────────────────────────────
/** Pay every open Dash invoice due on or before `through` out of Dash clearing, each dated its own due date. */
export function payDashInvoicesDue(books: Books, actor: User, opts: { through: string; storeId?: ID }): Transaction[] {
  books.require(actor, 'fuel.post', 'post Dash invoice payments');
  const state = books.state;
  const flags = invoiceFlags(state, opts.through);
  const due = liveInvoices(state).filter((i) => i.supplier === 'dash' && !i.settlement && i.invoiceNo && !flags.get(i.id)?.duplicateOf && i.dueOn <= opts.through && (!opts.storeId || i.storeId === opts.storeId))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const drafts: TxnDraft[] = due.map((i) => ({
    date: i.dueOn, kind: 'journal', description: `Dash Oil fuel invoice ${i.invoiceNo} ${codeOf(state, i.storeId)} · paid from clearing`, docNo: i.invoiceNo, partyId: FUEL_PARTY.dash, tags: ['fuel'],
    lines: [
      { accountId: FUEL_ACCT.cogs, storeId: i.storeId, debit: i.total, credit: 0, memo: `BOL ${i.bolNo} · ${invoiceGallons(i).toLocaleString('en-US')} gal` },
      { accountId: FUEL_ACCT.dash, storeId: i.storeId, debit: 0, credit: i.total, memo: 'Paid from Dash clearing on due date' },
    ],
  }));
  const txns = postAll(books, actor, drafts, 'manual');
  txns.forEach((t, k) => { due[k].settlement = { kind: 'dash_clearing', on: due[k].dueOn, txnId: t.id }; });
  if (txns.length) {
    books.audit(actor, { action: 'post', objectType: 'fuel', objectId: 'dash', summary: `Paid ${txns.length} Dash invoice${txns.length === 1 ? '' : 's'} from clearing through ${opts.through}` });
    books.changed();
  }
  return txns;
}

/** Dash's weekly statement: card and network fees out of clearing, and the surplus remitted (+) or a shortfall drafted (−). */
export function postDashSettlement(books: Books, actor: User, x: { storeId: ID; date: string; cardFees: number; networkFees: number; remit: number }): DashSettlement {
  books.require(actor, 'fuel.post', 'post Dash settlements');
  const s = storeOf(books.state, x.storeId);
  const errs: string[] = [];
  if (s?.fuelSupplier !== 'dash') errs.push('Choose a Dash store (HM15 or HM17).');
  if (!isValidDate(x.date)) errs.push('Enter the statement date as YYYY-MM-DD.');
  if (![x.cardFees, x.networkFees, x.remit].every(Number.isSafeInteger) || x.cardFees < 0 || x.networkFees < 0) errs.push('Fees are amounts of zero or more; the remittance is + when Dash pays us and − when Dash drafts us.');
  if (!x.cardFees && !x.networkFees && !x.remit) errs.push('Nothing to post: enter the fees or the remittance.');
  if (errs.length) throw errText(errs);
  const corp = bankStoreId(books.state);
  const acct = FUEL_ACCT.dash;
  const lines: DraftLine[] = [];
  if (x.cardFees) lines.push({ accountId: FUEL_ACCT.cardFees, storeId: x.storeId, debit: x.cardFees, credit: 0, memo: 'Dash card fees' }, { accountId: acct, storeId: x.storeId, debit: 0, credit: x.cardFees });
  if (x.networkFees) lines.push({ accountId: FUEL_ACCT.network, storeId: x.storeId, debit: x.networkFees, credit: 0, memo: 'Network fee' }, { accountId: acct, storeId: x.storeId, debit: 0, credit: x.networkFees });
  if (x.remit > 0) lines.push({ accountId: FUEL_ACCT.bank, storeId: corp, debit: x.remit, credit: 0, memo: 'Remittance' }, { accountId: acct, storeId: x.storeId, debit: 0, credit: x.remit });
  if (x.remit < 0) lines.push({ accountId: FUEL_ACCT.bank, storeId: corp, debit: 0, credit: -x.remit, memo: 'Draft' }, { accountId: acct, storeId: x.storeId, debit: -x.remit, credit: 0 });
  const t = books.createTransaction(actor, { date: x.date, kind: x.cardFees || x.networkFees ? 'journal' : 'transfer', description: `Dash Oil settlement ${s!.code}`, partyId: FUEL_PARTY.dash, tags: ['fuel', 'settlement'], lines }, { source: 'manual' });
  const rec: DashSettlement = { id: books.nextId('dset'), storeId: x.storeId, date: x.date, cardFees: x.cardFees, networkFees: x.networkFees, remit: x.remit, txnId: t.id };
  fuelOf(books.state).dashSettlements.push(rec);
  books.audit(actor, { action: 'post', objectType: 'fuel', objectId: rec.id, summary: `Posted Dash settlement ${s!.code} ${x.date}: remit ${formatMoney(x.remit, { dollarSign: true })}` });
  books.changed();
  return rec;
}

export interface ClearingRow {
  date: string;
  cardIn: number;
  invoicesOut: number;
  fees: number;
  bank: number;
  other: number;
  balance: number;
  txnIds: ID[];
}

/**
 * The clearing ledger by date for one store: card proceeds in, invoices out on their due date, fees, money
 * to or from the bank, and the running balance (+ the supplier holds our money, − we owe the supplier).
 */
export function clearingLedger(state: BooksState, accountId: ID, storeId: ID, from: string, to: string): { opening: number; rows: ClearingRow[]; closing: number } {
  const opening = storeBalance(state, accountId, storeId, addDays(from, -1));
  const byDate = new Map<string, ClearingRow>();
  const txns = state.transactions.filter((t) => !t.deleted && t.date >= from && t.date <= to && t.lines.some((l) => l.accountId === accountId && l.storeId === storeId)).sort((a, b) => a.date.localeCompare(b.date));
  for (const t of txns) {
    const r = byDate.get(t.date) ?? { date: t.date, cardIn: 0, invoicesOut: 0, fees: 0, bank: 0, other: 0, balance: 0, txnIds: [] };
    r.txnIds.push(t.id);
    const mine = t.lines.filter((l) => l.accountId === accountId && l.storeId === storeId).reduce((a, l) => a + l.debit - l.credit, 0);
    if (t.tags.includes('pos')) r.cardIn += mine;
    else {
      const others = t.lines.filter((l) => !l.system && !(l.accountId === accountId && l.storeId === storeId));
      let placed = 0;
      for (const l of others) {
        const v = -(l.debit - l.credit);
        if (l.accountId === FUEL_ACCT.cogs) r.invoicesOut += v;
        else if (l.accountId === FUEL_ACCT.cardFees || l.accountId === FUEL_ACCT.network || l.accountId === FUEL_ACCT.host) r.fees += v;
        else if (l.accountId === FUEL_ACCT.bank) r.bank += v;
        else r.other += v;
        placed += v;
      }
      r.other += mine - placed;
    }
    byDate.set(t.date, r);
  }
  let bal = opening;
  const rows = [...byDate.values()].map((r) => { bal += r.cardIn + r.invoicesOut + r.fees + r.bank + r.other; return { ...r, balance: bal }; });
  return { opening, rows, closing: bal };
}

/** Open Dash invoices that will come out of clearing on their due dates. */
export function dashUpcoming(state: BooksState, storeId: ID, after: string): FuelInvoice[] {
  const flags = invoiceFlags(state, after);
  return liveInvoices(state).filter((i) => i.supplier === 'dash' && i.storeId === storeId && !i.settlement && !flags.get(i.id)?.duplicateOf).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

// ── Structured fuel sales ────────────────────────────────────────────────
/** Record daily fuel sales by grade. Idempotent per store + date + grade: a day already on file is skipped. */
export function recordFuelSales(books: Books, actor: User, rows: Omit<FuelSale, 'id' | 'batchId'>[], batchId: string): FuelSale[] {
  books.require(actor, 'fuel.edit', 'record fuel sales');
  const fuel = fuelOf(books.state);
  const have = new Set(fuel.sales.map((s) => `${s.storeId}|${s.date}|${s.grade}`));
  const out: FuelSale[] = [];
  for (const r of rows) {
    if (!(r.gallons >= 0) || !Number.isSafeInteger(r.retail)) throw errText([`${r.date} ${r.grade}: gallons and retail must be numbers.`]);
    const k = `${r.storeId}|${r.date}|${r.grade}`;
    if (have.has(k)) continue;
    have.add(k);
    const s: FuelSale = { ...r, gallons: r3(r.gallons), id: books.nextId('fs'), batchId };
    fuel.sales.push(s);
    out.push(s);
  }
  return out;
}

// ── Truck lane: Comdata, Mudflap, Fiserv ─────────────────────────────────
export const comdataKey = (storeId: ID, date: string) => `${storeId}|${date}`;

export interface ComdataPreview {
  rows: (ParsedComdataRow & { storeId: ID; key: string; duplicate: boolean; problem?: string })[];
  added: number;
  skipped: number;
  gallons: number;
  sales: number;
}

export function previewComdataImport(state: BooksState, rows: ParsedComdataRow[]): ComdataPreview {
  const have = new Set(fuelOf(state).comdata.map((c) => c.key));
  const seen = new Set<string>();
  const out = rows.map((r) => {
    const s = state.stores.find((x) => x.code.toUpperCase() === r.storeCode && !x.deleted);
    const key = comdataKey(s?.id ?? r.storeCode, r.date);
    const problem = !s ? `Store "${r.storeCode}" isn't set up.` : !s.hasTruckLane ? `${s.code} has no truck lane.` : seen.has(key) ? 'Same store and date twice in this file.' : undefined;
    seen.add(key);
    return { ...r, storeId: s?.id ?? '', key, duplicate: have.has(key), problem };
  });
  const fresh = out.filter((r) => !r.duplicate && !r.problem);
  return { rows: out, added: fresh.length, skipped: out.length - fresh.length, gallons: r3(fresh.reduce((a, r) => a + r.gallons, 0)), sales: fresh.reduce((a, r) => a + r.sales, 0) };
}

/** Import the Comdata truck-stop summary. Idempotent per store + date; batch id on every row. Kept apart from the store POS. */
export function commitComdataImport(books: Books, actor: User, file: { name: string; rows: ParsedComdataRow[] }): { batch: FuelImportBatch; rows: ComdataDay[] } {
  books.require(actor, 'fuel.edit', 'import the Comdata summary');
  const p = previewComdataImport(books.state, file.rows);
  const batch = newBatch(books, actor, 'comdata', file.name, p.added, p.skipped);
  const rows = p.rows.filter((r) => !r.duplicate && !r.problem).map((r): ComdataDay => ({ id: books.nextId('cd'), storeId: r.storeId, date: r.date, gallons: r3(r.gallons), sales: r.sales, transactions: r.transactions, batchId: batch.id, key: r.key }));
  fuelOf(books.state).comdata.push(...rows);
  books.audit(actor, { action: 'import', objectType: 'fuel', objectId: batch.id, summary: `Imported ${file.name}: ${p.added} Comdata days, ${p.skipped} skipped` });
  books.changed();
  return { batch, rows };
}

/** Mudflap fuel-code discounts (+) and card true-ups (±) post to 4910 contra revenue against the merchant clearing (1120). */
export function recordMudflap(books: Books, actor: User, x: { storeId: ID; date: string; kind: MudflapEntry['kind']; amount: number; gallons?: number; note?: string }): MudflapEntry {
  books.require(actor, 'fuel.post', 'post Mudflap discounts');
  const s = storeOf(books.state, x.storeId);
  const errs: string[] = [];
  if (!s?.hasTruckLane) errs.push('Mudflap runs on the truck lane. Choose HM15.');
  if (!isValidDate(x.date)) errs.push('Enter the date as YYYY-MM-DD.');
  if (!Number.isSafeInteger(x.amount) || x.amount === 0) errs.push('Enter the amount: + for a discount or a true-up we owe, − for a true-up in our favour.');
  if (x.kind === 'discount' && x.amount < 0) errs.push('A fuel-code discount is a cost to us; enter it as a positive amount.');
  if (errs.length) throw errText(errs);
  const a = x.amount;
  const label = x.kind === 'discount' ? 'Mudflap fuel-code discounts' : 'Mudflap card true-up';
  const t = books.createTransaction(actor, { date: x.date, kind: 'journal', description: `${label} ${s!.code}`, memo: x.note, tags: ['fuel', 'truck lane', 'mudflap'], lines: [
    { accountId: FUEL_ACCT.mudflap, storeId: x.storeId, debit: a > 0 ? a : 0, credit: a < 0 ? -a : 0, memo: x.gallons ? `${x.gallons.toLocaleString('en-US')} gal` : undefined },
    { accountId: FUEL_ACCT.fiserv, storeId: x.storeId, debit: a < 0 ? -a : 0, credit: a > 0 ? a : 0, memo: 'Netted from merchant deposits' },
  ] }, { source: 'manual' });
  const e: MudflapEntry = { id: books.nextId('mf'), storeId: x.storeId, date: x.date, kind: x.kind, amount: a, gallons: x.gallons, note: x.note?.trim() || undefined, txnId: t.id };
  fuelOf(books.state).mudflap.push(e);
  books.audit(actor, { action: 'post', objectType: 'fuel', objectId: e.id, summary: `${label} ${s!.code} ${formatMoney(a, { dollarSign: true })}` });
  books.changed();
  return e;
}

export interface FiservMonth {
  period: string;
  deposits: number;
  depositCount: number;
  /** Fees the merchant debited the following month for this month's volume. */
  fees: number;
  feeDate?: string;
  feeRate: number | null;
  truckCard: number;
  mudflap: number;
}

/** Fiserv / AccessOne: merchant deposits ("MER BNKCD DEPOSIT") by month, and the fees debited the month after. */
export function fiservMonths(state: BooksState, storeId: ID): FiservMonth[] {
  const m = new Map<string, FiservMonth>();
  const get = (p: string) => { let x = m.get(p); if (!x) { x = { period: p, deposits: 0, depositCount: 0, fees: 0, feeRate: null, truckCard: 0, mudflap: 0 }; m.set(p, x); } return x; };
  for (const t of state.transactions) {
    if (t.deleted) continue;
    const bank = t.lines.find((l) => l.accountId === FUEL_ACCT.bank && !l.system);
    if (bank && /^MER BNKCD DEPOSIT/i.test(t.description)) { const x = get(periodOf(t.date)); x.deposits += bank.debit - bank.credit; x.depositCount++; }
    const fee = /^MER BNKCD FEE (\d{4}-\d{2})/i.exec(t.description);
    if (bank && fee) { const x = get(fee[1]); x.fees += bank.credit - bank.debit; x.feeDate = t.date; }
    for (const l of t.lines) {
      if (l.accountId !== FUEL_ACCT.fiserv || l.storeId !== storeId) continue;
      if (t.tags.includes('pos')) get(periodOf(t.date)).truckCard += l.debit - l.credit;
      if (t.tags.includes('mudflap')) get(periodOf(t.date)).mudflap += l.credit - l.debit;
    }
  }
  for (const x of m.values()) x.feeRate = x.fees && x.deposits ? x.fees / x.deposits : null;
  return [...m.values()].sort((a, b) => a.period.localeCompare(b.period));
}

// ── Costs, gallons and margin ────────────────────────────────────────────
export type CostSource = 'month' | 'prior_month' | 'company_month' | 'none';
interface CostCell { gallons: number; cost: number }

/** Delivered cost per gallon for each store, grade and month, from the invoices (freight and taxes included). */
export function costTable(state: BooksState): Map<string, CostCell> {
  const flags = invoiceFlags(state, '9999-12-31');
  const t = new Map<string, CostCell>();
  const add = (k: string, g: number, c: number) => { const e = t.get(k) ?? { gallons: 0, cost: 0 }; e.gallons += g; e.cost += c; t.set(k, e); };
  for (const i of liveInvoices(state)) {
    if (!i.invoiceNo || flags.get(i.id)?.duplicateOf) continue;
    const p = periodOf(i.deliveredOn);
    for (const l of deliveredLines(i)) {
      add(`${i.storeId}|${p}|${l.grade}`, l.netGallons, l.cost);
      add(`*|${p}|${l.grade}`, l.netGallons, l.cost);
    }
  }
  return t;
}

/**
 * Delivered cost per gallon (cents) for a store, grade and month. Plus is blended 50/50 Regular/Premium.
 * With no delivery of that grade in the month it falls back to the store's latest earlier month, then to the
 * company-wide month; `source` says which was used.
 */
export function deliveredCpg(state: BooksState, storeId: ID, period: string, grade: FuelGrade, table = costTable(state)): { cpg: number | null; source: CostSource } {
  if (grade === 'plus') {
    const r = deliveredCpg(state, storeId, period, 'regular', table);
    const p = deliveredCpg(state, storeId, period, 'premium', table);
    if (r.cpg === null || p.cpg === null) return { cpg: null, source: 'none' };
    const order: CostSource[] = ['month', 'prior_month', 'company_month', 'none'];
    return { cpg: (r.cpg + p.cpg) / 2, source: order[Math.max(order.indexOf(r.source), order.indexOf(p.source))] };
  }
  const own = table.get(`${storeId}|${period}|${grade}`);
  if (own && own.gallons > 0) return { cpg: own.cost / own.gallons, source: 'month' };
  const prior = [...table.keys()].filter((k) => k.startsWith(`${storeId}|`) && k.endsWith(`|${grade}`) && k.split('|')[1] < period).sort().at(-1);
  if (prior) { const e = table.get(prior)!; return { cpg: e.cost / e.gallons, source: 'prior_month' }; }
  const co = table.get(`*|${period}|${grade}`);
  if (co && co.gallons > 0) return { cpg: co.cost / co.gallons, source: 'company_month' };
  return { cpg: null, source: 'none' };
}

export interface SaleRow {
  storeId: ID;
  date: string;
  grade: FuelGrade;
  gallons: number;
  retail: number;
  lane: 'store' | 'truck';
}

/** Every gallon sold: the store POS plus the Comdata truck lane (diesel). */
export function salesRows(state: BooksState, opts: { storeIds?: Set<ID> | ID[]; from?: string; to?: string } = {}): SaleRow[] {
  const ids = opts.storeIds ? new Set(opts.storeIds) : null;
  const ok = (s: ID, d: string) => (!ids || ids.has(s)) && (!opts.from || d >= opts.from) && (!opts.to || d <= opts.to);
  const f = fuelOf(state);
  return [
    ...f.sales.filter((s) => ok(s.storeId, s.date)).map((s): SaleRow => ({ storeId: s.storeId, date: s.date, grade: s.grade, gallons: s.gallons, retail: s.retail, lane: 'store' })),
    ...f.comdata.filter((c) => ok(c.storeId, c.date)).map((c): SaleRow => ({ storeId: c.storeId, date: c.date, grade: 'diesel', gallons: c.gallons, retail: c.sales, lane: 'truck' })),
  ];
}

export interface FuelCostOfSales {
  storeId: ID;
  period: string;
  byGrade: { grade: FuelGrade; gallons: number; retail: number; costPerGallon: number | null; cogs: number; source: CostSource }[];
  gallons: number;
  retail: number;
  /** Accrual fuel COGS: Σ over grades of gallons sold × that month's delivered cost per gallon. */
  cogs: number;
  /** Grades sold with no cost basis at all (cogs counted as zero for them). */
  missingCost: FuelGrade[];
}

/**
 * Accrual fuel cost of sales for one store and month — the figure the Phase 4 accrual P&L uses in place of
 * paid fuel (account 5000).
 *
 * - Gallons sold by grade come from the structured fuel sales (store POS) plus the Comdata truck-lane summary.
 * - Cost per gallon is that month's delivered cost at the store: invoice product cost plus freight and taxes,
 *   spread over net gallons, divided by net gallons delivered (see deliveredCpg for the fallbacks). Plus is
 *   blended 50/50 Regular/Premium.
 * - COGS per grade = round(gallons × cost per gallon) in cents; the total is the sum of the rounded grades, so
 *   the grade rows always add to the total.
 * Duplicate invoices and BOLs with no invoice yet are left out of the cost basis.
 */
export function fuelCostOfSales(state: BooksState, storeId: ID, period: string, table = costTable(state)): FuelCostOfSales {
  const rows = salesRows(state, { storeIds: [storeId], from: `${period}-01`, to: lastDayOfPeriod(period) });
  const byGrade = GRADES.map((grade) => {
    const mine = rows.filter((r) => r.grade === grade);
    const gallons = r3(mine.reduce((a, r) => a + r.gallons, 0));
    const retail = mine.reduce((a, r) => a + r.retail, 0);
    const c = deliveredCpg(state, storeId, period, grade, table);
    return { grade, gallons, retail, costPerGallon: c.cpg, cogs: c.cpg === null ? 0 : Math.round(gallons * c.cpg), source: c.source };
  }).filter((g) => g.gallons > 0);
  return {
    storeId, period, byGrade, gallons: r3(byGrade.reduce((a, g) => a + g.gallons, 0)), retail: byGrade.reduce((a, g) => a + g.retail, 0),
    cogs: byGrade.reduce((a, g) => a + g.cogs, 0), missingCost: byGrade.filter((g) => g.costPerGallon === null).map((g) => g.grade),
  };
}

export interface MarginRow {
  storeId: ID;
  grade: FuelGrade;
  bucket: string;
  gallons: number;
  retail: number;
  cogs: number;
  margin: number;
  retailCpg: number;
  costCpg: number | null;
  marginCpg: number;
}

export interface StoreFuelSummary {
  storeId: ID;
  gallons: number;
  truckGallons: number;
  retail: number;
  cogs: number;
  margin: number;
  marginCpg: number;
  discounts: number;
  cardFees: number;
  discountsCpg: number;
  cardFeeCpg: number;
  /** Discounts + card fees per gallon: the cpg margin fuel needs before it earns anything. */
  breakEvenCpg: number;
  netCpg: number;
}

const DISCOUNT_ACCTS: ID[] = [FUEL_ACCT.discounts, FUEL_ACCT.mudflap, FUEL_ACCT.host];
const FEE_ACCTS: ID[] = [FUEL_ACCT.cardFees, FUEL_ACCT.network];

function ledgerSum(state: BooksState, accts: ID[], storeId: ID, from: string, to: string, sign: 1 | -1): number {
  const set = new Set(accts);
  let n = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date < from || t.date > to) continue;
    for (const l of t.lines) if (set.has(l.accountId) && l.storeId === storeId) n += sign * (l.debit - l.credit);
  }
  return n;
}

/** Fuel revenue in the ledger (4000–4030) for stores and dates: what the structured sales must tie to. */
export function ledgerFuelRevenue(state: BooksState, storeIds: ID[], from: string, to: string): number {
  return storeIds.reduce((a, s) => a + ledgerSum(state, Object.values(REVENUE_ACCT), s, from, to, -1), 0);
}

/** Gallons and margin by store and grade, by day or by month, with each store's discounts, card fees and break-even. */
export function fuelMargin(state: BooksState, opts: { storeIds: ID[]; from: string; to: string; by: 'day' | 'month' }) {
  const table = costTable(state);
  const rows = salesRows(state, { storeIds: opts.storeIds, from: opts.from, to: opts.to });
  const m = new Map<string, MarginRow>();
  const cpgCache = new Map<string, number | null>();
  const cpgOf = (s: ID, p: string, g: FuelGrade) => {
    const k = `${s}|${p}|${g}`;
    if (!cpgCache.has(k)) cpgCache.set(k, deliveredCpg(state, s, p, g, table).cpg);
    return cpgCache.get(k)!;
  };
  for (const r of rows) {
    const bucket = opts.by === 'day' ? r.date : periodOf(r.date);
    const k = `${r.storeId}|${r.grade}|${bucket}`;
    const cpg = cpgOf(r.storeId, periodOf(r.date), r.grade);
    const x = m.get(k) ?? { storeId: r.storeId, grade: r.grade, bucket, gallons: 0, retail: 0, cogs: 0, margin: 0, retailCpg: 0, costCpg: cpg, marginCpg: 0 };
    x.gallons += r.gallons;
    x.retail += r.retail;
    m.set(k, x);
  }
  // COGS is rounded once per bucket (gallons × that month's cost), the same way fuelCostOfSales does it.
  const out = [...m.values()].map((x) => {
    const gallons = r3(x.gallons);
    const cogs = x.costCpg === null ? 0 : Math.round(gallons * x.costCpg);
    const margin = x.retail - cogs;
    return { ...x, gallons, cogs, margin, retailCpg: gallons ? x.retail / gallons : 0, costCpg: gallons ? x.cogs / gallons : x.costCpg, marginCpg: gallons ? margin / gallons : 0 };
  }).sort((a, b) => a.bucket.localeCompare(b.bucket) || a.storeId.localeCompare(b.storeId) || GRADES.indexOf(a.grade) - GRADES.indexOf(b.grade));
  const stores: StoreFuelSummary[] = opts.storeIds.map((storeId) => {
    const mine = out.filter((r) => r.storeId === storeId);
    const gallons = r3(mine.reduce((a, r) => a + r.gallons, 0));
    const retail = mine.reduce((a, r) => a + r.retail, 0);
    const cogs = mine.reduce((a, r) => a + r.cogs, 0);
    const discounts = ledgerSum(state, DISCOUNT_ACCTS, storeId, opts.from, opts.to, 1);
    const cardFees = ledgerSum(state, FEE_ACCTS, storeId, opts.from, opts.to, 1);
    const per = (v: number) => (gallons ? v / gallons : 0);
    const truckGallons = r3(rows.filter((r) => r.storeId === storeId && r.lane === 'truck').reduce((a, r) => a + r.gallons, 0));
    return { storeId, gallons, truckGallons, retail, cogs, margin: retail - cogs, marginCpg: per(retail - cogs), discounts, cardFees, discountsCpg: per(discounts), cardFeeCpg: per(cardFees), breakEvenCpg: per(discounts + cardFees), netCpg: per(retail - cogs - discounts - cardFees) };
  }).filter((s) => s.gallons > 0);
  return { rows: out, stores };
}

// ── Tanks ────────────────────────────────────────────────────────────────
export function saveTank(books: Books, actor: User, t: Omit<Tank, 'id'> & { id?: ID }): Tank {
  books.require(actor, 'fuel.edit', 'set up tanks');
  const errs: string[] = [];
  if (!storeOf(books.state, t.storeId)) errs.push('Choose the store.');
  if (!t.label.trim()) errs.push('Give the tank a label, e.g. T1.');
  if (!TANK_GRADES.includes(t.grade)) errs.push('Tanks hold Regular, Premium or Diesel. Plus is blended at the pump.');
  if (!(t.capacity > 0)) errs.push('Enter the tank capacity in gallons.');
  if (errs.length) throw errText(errs);
  const fuel = fuelOf(books.state);
  const existing = t.id ? fuel.tanks.find((x) => x.id === t.id) : undefined;
  const tank: Tank = { id: existing?.id ?? books.nextId('tank'), storeId: t.storeId, label: t.label.trim(), grade: t.grade, capacity: Math.round(t.capacity), active: t.active };
  const before = existing ? structuredClone(existing) : undefined;
  if (existing) Object.assign(existing, tank);
  else fuel.tanks.push(tank);
  books.audit(actor, { action: existing ? 'update' : 'create', objectType: 'fuel', objectId: tank.id, summary: `${existing ? 'Updated' : 'Added'} tank ${codeOf(books.state, tank.storeId)} ${tank.label} (${GRADE_LABEL[tank.grade]}, ${tank.capacity.toLocaleString('en-US')} gal)`, before, after: tank });
  books.changed();
  return existing ?? tank;
}

/** Record (or correct) a tank's end-of-day reading. Store managers can record their own store's tanks. */
export function recordReading(books: Books, actor: User, x: { tankId: ID; date: string; gallons: number; waterInches: number; method: TankReading['method'] }): TankReading {
  books.require(actor, 'fuel.readings', 'record tank readings');
  const fuel = fuelOf(books.state);
  const tank = fuel.tanks.find((t) => t.id === x.tankId);
  if (!tank) throw errText(['Choose a tank.']);
  assertStore(actor, tank.storeId);
  const errs: string[] = [];
  if (!isValidDate(x.date)) errs.push('Enter the reading date as YYYY-MM-DD.');
  if (!(x.gallons >= 0)) errs.push('Enter the gallons in the tank.');
  else if (x.gallons > tank.capacity) errs.push(`${tank.label} holds ${tank.capacity.toLocaleString('en-US')} gallons; ${x.gallons.toLocaleString('en-US')} is more than it can hold. Recheck the stick chart.`);
  if (!(x.waterInches >= 0)) errs.push('Enter the water reading in inches (0 if none).');
  if (errs.length) throw errText(errs);
  const existing = fuel.readings.find((r) => r.tankId === x.tankId && r.date === x.date);
  const r: TankReading = { id: existing?.id ?? books.nextId('trd'), tankId: x.tankId, date: x.date, gallons: r3(x.gallons), waterInches: Math.round(x.waterInches * 100) / 100, method: x.method, by: actor.id };
  const before = existing ? structuredClone(existing) : undefined;
  if (existing) Object.assign(existing, r);
  else fuel.readings.push(r);
  books.audit(actor, { action: existing ? 'update' : 'create', objectType: 'fuel', objectId: r.id, summary: `Tank reading ${codeOf(books.state, tank.storeId)} ${tank.label} ${x.date}: ${r.gallons.toLocaleString('en-US')} gal, ${r.waterInches}" water`, before, after: r });
  books.changed();
  return existing ?? r;
}

/** How a store's sales draw on one tank: Plus pulls 50/50 from Regular and Premium; tanks of one grade share by capacity. */
function drawShare(tanks: Tank[], tank: Tank, grade: FuelGrade): number {
  const same = (g: Exclude<FuelGrade, 'plus'>) => tanks.filter((t) => t.active && t.grade === g);
  const share = (g: Exclude<FuelGrade, 'plus'>) => { const s = same(g); const cap = s.reduce((a, t) => a + t.capacity, 0); return s.includes(tank) && cap ? tank.capacity / cap : 0; };
  if (grade === 'plus') return tank.grade === 'regular' || tank.grade === 'premium' ? 0.5 * share(tank.grade) : 0;
  return grade === tank.grade ? share(tank.grade) : 0;
}

export interface TankDay {
  date: string;
  opening: number;
  deliveries: number;
  sales: number;
  book: number;
  physical: number | null;
  variance: number | null;
  water: number | null;
}

/** Daily book-to-physical for one tank: opening (yesterday's reading) + deliveries (BOL net gallons) − sales = book; reading − book = variance. */
export function tankBook(state: BooksState, tankId: ID, from: string, to: string): TankDay[] {
  const f = fuelOf(state);
  const tank = f.tanks.find((t) => t.id === tankId);
  if (!tank) return [];
  const tanks = f.tanks.filter((t) => t.storeId === tank.storeId);
  const readings = new Map(f.readings.filter((r) => r.tankId === tankId).map((r) => [r.date, r]));
  const flags = invoiceFlags(state, '9999-12-31');
  const deliveries = new Map<string, number>();
  for (const i of liveInvoices(state)) {
    if (i.storeId !== tank.storeId || flags.get(i.id)?.duplicateOf || i.deliveredOn < addDays(from, -1) || i.deliveredOn > to) continue;
    for (const l of i.lines) { const sh = drawShare(tanks, tank, l.grade); if (sh) deliveries.set(i.deliveredOn, (deliveries.get(i.deliveredOn) ?? 0) + l.netGallons * sh); }
  }
  const sales = new Map<string, number>();
  for (const s of salesRows(state, { storeIds: [tank.storeId], from, to })) { const sh = drawShare(tanks, tank, s.grade); if (sh) sales.set(s.date, (sales.get(s.date) ?? 0) + s.gallons * sh); }
  const out: TankDay[] = [];
  let level: number | null = readings.get(addDays(from, -1))?.gallons ?? null;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const rd = readings.get(d);
    if (level === null) { if (rd) level = rd.gallons; out.push({ date: d, opening: 0, deliveries: 0, sales: 0, book: rd?.gallons ?? 0, physical: rd?.gallons ?? null, variance: rd ? 0 : null, water: rd?.waterInches ?? null }); continue; }
    const del = r3(deliveries.get(d) ?? 0);
    const sold = r3(sales.get(d) ?? 0);
    const book = r3(level + del - sold);
    out.push({ date: d, opening: r3(level), deliveries: del, sales: sold, book, physical: rd?.gallons ?? null, variance: rd ? r3(rd.gallons - book) : null, water: rd?.waterInches ?? null });
    level = rd ? rd.gallons : book;
  }
  return out;
}

export interface TankStatus {
  tank: Tank;
  asOf: string;
  lastReading?: TankReading;
  gallons: number;
  fillPct: number;
  /** Average daily draw over the last 7 days. */
  velocity: number;
  daysOfSupply: number | null;
  variance30: number;
  throughput30: number;
  /** Allowed: variancePct of gallons sold + the allowance. */
  threshold: number;
  varianceFlag: boolean;
  waterFlag: boolean;
  reorder: boolean;
  ullage: number;
}

export function tankStatus(state: BooksState, tankId: ID, asOf: string): TankStatus | null {
  const f = fuelOf(state);
  const tank = f.tanks.find((t) => t.id === tankId);
  if (!tank) return null;
  const tg = f.targets;
  const days = tankBook(state, tankId, addDays(asOf, -29), asOf);
  const last = f.readings.filter((r) => r.tankId === tankId && r.date <= asOf).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const gallons = last?.gallons ?? 0;
  const tracked = days.slice(days.findIndex((d) => d.physical !== null) + 1);
  const week = tracked.slice(-7);
  const velocity = week.length ? week.reduce((a, d) => a + d.sales, 0) / week.length : 0;
  const variance30 = r3(tracked.reduce((a, d) => a + (d.variance ?? 0), 0));
  const throughput30 = r3(tracked.reduce((a, d) => a + d.sales, 0));
  const threshold = Math.round((tg.variancePct / 100) * throughput30 + tg.varianceAllowanceGal);
  const daysOfSupply = velocity > 0 ? gallons / velocity : null;
  return {
    tank, asOf, lastReading: last, gallons, fillPct: tank.capacity ? (gallons / tank.capacity) * 100 : 0, velocity, daysOfSupply,
    variance30, throughput30, threshold, varianceFlag: Math.abs(variance30) > threshold, waterFlag: (last?.waterInches ?? 0) > tg.waterInches,
    reorder: daysOfSupply !== null && daysOfSupply <= tg.reorderDays, ullage: Math.max(0, Math.round((tank.capacity * tg.safeFillPct) / 100 - gallons)),
  };
}

export interface LoadPlan {
  storeId: ID;
  asOf: string;
  deliverOn: string | null;
  reason: string;
  byTank: { tankId: ID; grade: Exclude<FuelGrade, 'plus'>; gallons: number; daysOfSupplyAtDelivery: number | null }[];
  total: number;
}

/**
 * Suggested next load for a store from sales velocity and tank room: deliver when a full transport fits in
 * the tanks (safe fill), or earlier if any tank would reach its reorder point first. Split by each tank's room
 * on the delivery day, in 100-gallon compartments, up to one transport.
 */
export function orderingPlan(state: BooksState, storeId: ID, asOf: string): LoadPlan {
  const f = fuelOf(state);
  const tg = f.targets;
  const st = f.tanks.filter((t) => t.storeId === storeId && t.active).map((t) => tankStatus(state, t.id, asOf)!).filter((s) => s.lastReading);
  if (!st.length) return { storeId, asOf, deliverOn: null, reason: 'No tank readings yet.', byTank: [], total: 0 };
  const room = (s: TankStatus, days: number) => Math.max(0, (s.tank.capacity * tg.safeFillPct) / 100 - Math.max(0, s.gallons - s.velocity * days));
  let fit: number | null = null;
  for (let k = 0; k <= 14; k++) if (st.reduce((a, s) => a + room(s, k), 0) >= tg.loadGallons) { fit = k; break; }
  const reorderIn = st.filter((s) => s.velocity > 0).map((s) => Math.max(0, (s.gallons - s.velocity * tg.reorderDays) / s.velocity));
  const urgent = reorderIn.length ? Math.floor(Math.min(...reorderIn)) : null;
  let k: number;
  let reason: string;
  if (fit === null && urgent === null) return { storeId, asOf, deliverOn: null, reason: 'No sales in the last week to plan from.', byTank: [], total: 0 };
  if (urgent !== null && (fit === null || urgent < fit)) { k = urgent; reason = `A tank reaches ${tg.reorderDays} days of supply before a full load fits; deliver what fits.`; }
  else { k = fit!; reason = 'A full transport fits in the tanks.'; }
  const rooms = st.map((s) => room(s, k));
  const totalRoom = rooms.reduce((a, b) => a + b, 0);
  const scale = totalRoom > tg.loadGallons ? tg.loadGallons / totalRoom : 1;
  const byTank = st.map((s, i) => {
    const gallons = Math.floor((rooms[i] * scale) / 100) * 100;
    const left = Math.max(0, s.gallons - s.velocity * k);
    return { tankId: s.tank.id, grade: s.tank.grade, gallons, daysOfSupplyAtDelivery: s.velocity > 0 ? left / s.velocity : null };
  });
  return { storeId, asOf, deliverOn: addDays(asOf, k), reason, byTank, total: byTank.reduce((a, t) => a + t.gallons, 0) };
}

// ── Pricing ──────────────────────────────────────────────────────────────
export function setPostedPrice(books: Books, actor: User, x: { storeId: ID; grade: FuelGrade; effective: string; cpg: number }): PostedPrice {
  books.require(actor, 'fuel.edit', 'change posted fuel prices');
  const errs: string[] = [];
  if (!storeOf(books.state, x.storeId)) errs.push('Choose the store.');
  if (!isValidDate(x.effective)) errs.push('Enter the date the price takes effect as YYYY-MM-DD.');
  if (!(x.cpg > 0)) errs.push('Enter the price per gallon, e.g. 2.899.');
  if (errs.length) throw errText(errs);
  const fuel = fuelOf(books.state);
  const existing = fuel.prices.find((p) => p.storeId === x.storeId && p.grade === x.grade && p.effective === x.effective);
  const p: PostedPrice = { id: existing?.id ?? books.nextId('fpr'), storeId: x.storeId, grade: x.grade, effective: x.effective, cpg: Math.round(x.cpg * 10) / 10 };
  if (existing) Object.assign(existing, p);
  else fuel.prices.push(p);
  books.audit(actor, { action: 'price', objectType: 'fuel', objectId: p.id, summary: `${codeOf(books.state, x.storeId)} ${GRADE_LABEL[x.grade]} posted at $${(p.cpg / 100).toFixed(3)} from ${x.effective}` });
  books.changed();
  return existing ?? p;
}

export function recordCompetitorPrice(books: Books, actor: User, x: Omit<CompetitorPrice, 'id'>): CompetitorPrice {
  books.require(actor, 'fuel.readings', 'log competitor prices');
  assertStore(actor, x.storeId);
  const errs: string[] = [];
  if (!x.competitor.trim()) errs.push('Name the competitor (a generic label like "Station A – Hwy 51" is fine).');
  if (!isValidDate(x.date)) errs.push('Enter the date you saw the price.');
  if (!(x.cpg > 0)) errs.push('Enter their price per gallon, e.g. 2.859.');
  if (errs.length) throw errText(errs);
  const c: CompetitorPrice = { ...x, competitor: x.competitor.trim(), cpg: Math.round(x.cpg * 10) / 10, id: books.nextId('fcp') };
  fuelOf(books.state).competitors.push(c);
  books.audit(actor, { action: 'price', objectType: 'fuel', objectId: c.id, summary: `${c.competitor} ${GRADE_LABEL[c.grade]} $${(c.cpg / 100).toFixed(3)} on ${c.date}` });
  books.changed();
  return c;
}

/** Our posted price (cents per gallon) for a store and grade on a date. */
export function postedPriceOn(state: BooksState, storeId: ID, grade: FuelGrade, date: string): number | null {
  return fuelOf(state).prices.filter((p) => p.storeId === storeId && p.grade === grade && p.effective <= date).sort((a, b) => a.effective.localeCompare(b.effective)).at(-1)?.cpg ?? null;
}

export interface PriceBoardRow {
  grade: FuelGrade;
  ours: number | null;
  competitors: { name: string; cpg: number; date: string }[];
  lowest: number | null;
  /** Ours − the lowest competitor, in cents per gallon. */
  spread: number | null;
  costCpg: number | null;
  marginCpg: number | null;
  weekGallons: number;
  /** Change in weekly margin $ if we matched the lowest competitor (gallons held flat). */
  matchImpact: number | null;
}

/** Our posted prices against nearby competitors (last 7 days of sightings), with what matching would do to margin. */
export function pricingBoard(state: BooksState, storeId: ID, asOf: string): PriceBoardRow[] {
  const f = fuelOf(state);
  const table = costTable(state);
  const week = salesRows(state, { storeIds: [storeId], from: addDays(asOf, -6), to: asOf });
  return GRADES.map((grade) => {
    const ours = postedPriceOn(state, storeId, grade, asOf);
    const seen = f.competitors.filter((c) => c.storeId === storeId && c.grade === grade && c.date <= asOf && c.date >= addDays(asOf, -7));
    const latest = new Map<string, CompetitorPrice>();
    for (const c of seen.sort((a, b) => a.date.localeCompare(b.date))) latest.set(c.competitor, c);
    const competitors = [...latest.values()].map((c) => ({ name: c.competitor, cpg: c.cpg, date: c.date }));
    const lowest = competitors.length ? Math.min(...competitors.map((c) => c.cpg)) : null;
    const costCpg = deliveredCpg(state, storeId, periodOf(asOf), grade, table).cpg;
    const weekGallons = r3(week.filter((r) => r.grade === grade && r.lane === 'store').reduce((a, r) => a + r.gallons, 0));
    return {
      grade, ours, competitors, lowest, spread: ours !== null && lowest !== null ? ours - lowest : null, costCpg, marginCpg: ours !== null && costCpg !== null ? ours - costCpg : null,
      weekGallons, matchImpact: ours !== null && lowest !== null ? Math.round((lowest - ours) * weekGallons) : null,
    };
  }).filter((r) => r.ours !== null || r.competitors.length);
}

// ── Inbox ────────────────────────────────────────────────────────────────
export interface FuelInboxItem { key: string; count: number; title: string; detail: string; to: string; action: string; review?: boolean }

/** The fuel lines on Today's inbox (SPEC §9): missing invoices, notices, tank variance and water, cpg margin. */
export function fuelInbox(state: BooksState, visible: Set<ID>, today: string): FuelInboxItem[] {
  const f = fuelOf(state);
  if (!f.tanks.length && !f.invoices.length && !f.notices.length && !f.sales.length) return [];
  const flags = invoiceFlags(state, today);
  const inv = liveInvoices(state).filter((i) => visible.has(i.storeId));
  const missingBol = inv.filter((i) => flags.get(i.id)!.missingInvoice);
  const noticeMissing = f.notices.filter((n) => visible.has(n.storeId)).flatMap((n) => checkNotice(state, n).invoices.filter((c) => !c.invoice));
  const dups = inv.filter((i) => flags.get(i.id)!.duplicateOf);
  const unsettled = inv.filter((i) => flags.get(i.id)!.unsettledPastDue);
  const outliers = inv.filter((i) => flags.get(i.id)!.outliers.length);
  const notices = f.notices.filter((n) => visible.has(n.storeId) && n.status === 'unposted');
  const off = notices.filter((n) => noticeNet(n) !== 0);
  const tanks = f.tanks.filter((t) => t.active && visible.has(t.storeId)).map((t) => tankStatus(state, t.id, today)!).filter((s) => s.lastReading);
  const varTanks = tanks.filter((s) => s.varianceFlag);
  const water = tanks.filter((s) => s.waterFlag);
  const period = periodOf(today);
  const opStores = state.stores.filter((s) => s.kind === 'operating' && visible.has(s.id)).map((s) => s.id);
  const lastSale = salesRows(state, { storeIds: opStores }).map((r) => r.date).filter((d) => d <= today).sort().at(-1);
  const month = lastSale && periodOf(lastSale) < period ? periodOf(lastSale) : period;
  const mtd = fuelMargin(state, { storeIds: opStores, from: `${month}-01`, to: today < lastDayOfPeriod(month) ? today : lastDayOfPeriod(month), by: 'month' }).stores;
  const outOfBand = mtd.filter((s) => s.marginCpg < f.targets.cpgMin || s.marginCpg > f.targets.cpgMax);
  const codes = (ids: ID[]) => [...new Set(ids)].map((id) => codeOf(state, id)).join(', ');
  return [
    { key: 'fuel_missing', count: missingBol.length + noticeMissing.length, title: 'Fuel deliveries with no invoice', detail: missingBol.length + noticeMissing.length ? `BOLs logged or invoices netted on a notice with no invoice on file${missingBol.length ? ` (${codes(missingBol.map((i) => i.storeId))})` : ''}. Log the invoice when it arrives.` : 'Every delivery has its invoice.', to: '/fuel/invoices?show=missing', action: 'Log invoice' },
    { key: 'fuel_notice', count: notices.length, title: 'Supplier notices not posted', detail: notices.length ? `${off.length ? `${off.length} do${off.length === 1 ? 'es' : ''} not net to zero. ` : ''}Post each one so card fees, invoices and the draft reach the books.` : 'Every Craddock notice is posted.', to: '/fuel/settlement', action: 'Post' },
    { key: 'fuel_tank', count: varTanks.length + water.length, title: 'Tank variance or water', detail: varTanks.length + water.length ? [varTanks.length ? `Book-to-physical over threshold: ${varTanks.map((s) => `${codeOf(state, s.tank.storeId)} ${s.tank.label}`).join(', ')}` : '', water.length ? `Water over ${f.targets.waterInches}": ${water.map((s) => `${codeOf(state, s.tank.storeId)} ${s.tank.label}`).join(', ')}` : ''].filter(Boolean).join('. ') + '.' : 'Every tank is within tolerance.', to: '/fuel/tanks', action: 'Review' },
    { key: 'fuel_cpg', count: outOfBand.length, title: 'Fuel margin outside target', detail: outOfBand.length ? `${outOfBand.map((s) => `${codeOf(state, s.storeId)} ${s.marginCpg.toFixed(1)}¢`).join(', ')} vs ${f.targets.cpgMin}–${f.targets.cpgMax}¢ a gallon this month.` : `Every store is inside ${f.targets.cpgMin}–${f.targets.cpgMax}¢ a gallon.`, to: '/fuel', action: 'Review' },
    { key: 'fuel_dup', count: dups.length, title: 'Possible duplicate fuel invoices', detail: 'Same invoice number or BOL entered twice.', to: '/fuel/invoices?show=flagged', action: 'Review' },
    { key: 'fuel_unsettled', count: unsettled.length, title: 'Fuel invoices past due with no settlement', detail: 'Due, but not netted on a notice or paid from Dash clearing.', to: '/fuel/invoices?show=open', action: 'Review', review: true },
    { key: 'fuel_outlier', count: outliers.length, title: 'Fuel invoice price outliers', detail: `Cost per gallon more than ${f.targets.priceOutlierPct}% from the month's average.`, to: '/fuel/invoices?show=flagged', action: 'Review', review: true },
  ];
}

/** Today's figure for the cash position: card money held by suppliers per store, net (+ owed to us). */
export function supplierPositions(state: BooksState, asOf: string): { storeId: ID; vendor: FuelVendor; balance: number }[] {
  return state.stores.filter((s) => vendorOf(s)).map((s) => ({ storeId: s.id, vendor: vendorOf(s)!, balance: storeBalance(state, vendorOf(s) === 'craddock' ? FUEL_ACCT.craddock : FUEL_ACCT.dash, s.id, asOf) }));
}

