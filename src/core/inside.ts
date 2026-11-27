import type { Books } from './books';
import { ValidationError } from './books';
import type { BooksState, ID, Transaction, User } from './types';
import type {
  AgeCheck, CountLine, InsideBatch, InsideDept, InsideState, InventoryCount, LotteryWeek, PosDaySummary, PosDeptSale, PurchaseBudget, ScanProgram, VendorMapping,
} from './insideTypes';
import { addDays, isValidDate, lastDayOfPeriod, periodOf } from './dates';
import { allocate, formatMoney, parseMoney, type Cents } from './money';
import { can, PermissionError } from './permissions';
import { parseDate, splitCsv } from './bankio';
import { arState, itemStatus, saveReceivable } from './receivables';

/**
 * Phase 7 — the inside-store subledger.
 *
 * Department sales come from the POS daily close already in the ledger (4100–4150); the POS department export
 * adds units and the customer count, and must tie to that close. Purchases post straight to cost of goods
 * (5100/5110/5120/5200) when they are paid or billed; vendor mappings assign them to departments. Inventory is
 * periodic: each count posts the change in counted inventory (1310) against the department's cost-of-goods
 * account, so cost of goods = purchases − inventory increase. Book inventory between counts = last count +
 * purchases − sales at the department's expected cost %, and shrink = book − counted.
 */

export const INV_ACCT = 'acct_inv_merch';
export const D = {
  beer: 'dept_beer', tobacco: 'dept_tobacco', grocery: 'dept_grocery', bev: 'dept_bev', other: 'dept_other', lottery: 'dept_lottery', kitchen: 'dept_kitchen',
} as const;

const dept = (id: ID, name: string, rev: ID, cogs: ID | undefined, costBps: number, shrinkBps: number, aliases: string[], extra: Partial<InsideDept> = {}): InsideDept => ({
  id, name, revenueAccountIds: [rev], cogsAccountId: cogs, inventoryAccountId: cogs ? INV_ACCT : undefined, costBps, shrinkBps, counted: !!cogs, inPosClose: true, posAliases: aliases, active: true, ...extra,
});

export function defaultDepartments(): InsideDept[] {
  return [
    dept(D.beer, 'Beer & wine', 'acct_sales_beer', 'acct_cogs_beer', 7400, 150, ['beer', 'wine', 'beer & wine', 'beer/wine', 'alcohol']),
    dept(D.tobacco, 'Tobacco', 'acct_sales_tobacco', 'acct_cogs_tobacco', 8200, 150, ['cigarettes', 'cigs', 'tobacco', 'otp', 'other tobacco', 'vapor', 'cigars']),
    dept(D.grocery, 'Grocery & snacks', 'acct_sales_grocery', 'acct_cogs_grocery', 6600, 150, ['grocery', 'snacks', 'snacks & candy', 'candy', 'chips', 'grocery & snacks', 'dairy', 'frozen']),
    dept(D.bev, 'Beverages', 'acct_sales_bev', 'acct_cogs_grocery', 6600, 150, ['beverages', 'packaged beverage', 'cold drinks', 'soft drinks', 'fountain', 'fountain & coffee', 'coffee', 'water', 'energy drinks']),
    dept(D.other, 'Other merchandise', 'acct_sales_merch_other', 'acct_cogs_grocery', 6600, 150, ['general merchandise', 'other', 'other merchandise', 'automotive', 'health & beauty', 'ice']),
    dept(D.lottery, 'Lottery', 'acct_sales_lottery', undefined, 0, 0, ['lottery', 'lotto', 'scratch-off', 'scratchers'], { inPosClose: false }),
    dept(D.kitchen, 'Kitchen', 'acct_sales_kitchen', 'acct_cogs_food', 3600, 500, ['hot food', 'kitchen', 'deli', 'food service', 'prepared food', 'bbq'], { kitchen: true }),
  ];
}

export function emptyInside(): InsideState {
  return { departments: defaultDepartments(), vendorMaps: [], posSales: [], posDays: [], counts: [], budgets: [], scanPrograms: [], lottery: [], ageChecks: [], batches: [] };
}

/** The inside slice. Books saved before phase 7 have none; they get the defaults. */
export function insideOf(state: BooksState): InsideState {
  if (!state.inside) state.inside = emptyInside();
  return state.inside;
}

const errs = (xs: string[]) => new ValidationError(xs);
const codeOf = (state: BooksState, id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function assertStore(actor: User, storeId: ID): void {
  if (!can(actor, 'view.all_stores') && !(actor.storeIds ?? []).includes(storeId)) throw new PermissionError('You can only work on your own store.');
}

export function departments(state: BooksState, opts: { counted?: boolean } = {}): InsideDept[] {
  return insideOf(state).departments.filter((d) => d.active && (!opts.counted || d.counted));
}
export function deptName(state: BooksState, id: ID): string {
  return insideOf(state).departments.find((d) => d.id === id)?.name ?? id;
}
export function deptById(state: BooksState, id: ID): InsideDept | undefined {
  return insideOf(state).departments.find((d) => d.id === id);
}

/** Match a POS department name to one of ours: its aliases, then its own name. */
export function deptForPos(state: BooksState, posDept: string): InsideDept | undefined {
  const n = norm(posDept);
  const ds = departments(state);
  return ds.find((d) => d.posAliases.some((a) => norm(a) === n)) ?? ds.find((d) => norm(d.name) === n);
}

export const periodFrom = (period: string) => `${period}-01`;
export const quarterOf = (date: string) => `${date.slice(0, 4)}Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
export function quarterRange(q: string): { from: string; to: string } {
  const y = q.slice(0, 4);
  const n = Number(q.slice(5));
  const m1 = String((n - 1) * 3 + 1).padStart(2, '0');
  const m3 = `${y}-${String(n * 3).padStart(2, '0')}`;
  return { from: `${y}-${m1}-01`, to: lastDayOfPeriod(m3) };
}

// ── Ledger reads ─────────────────────────────────────────────────────────
function revIndex(state: BooksState): Map<ID, ID> {
  const m = new Map<ID, ID>();
  for (const d of departments(state)) for (const a of d.revenueAccountIds) if (!m.has(a)) m.set(a, d.id);
  return m;
}
export function cogsAccounts(state: BooksState): Set<ID> {
  return new Set(departments(state).map((d) => d.cogsAccountId).filter((x): x is ID => !!x));
}
const isInventoryTxn = (t: Transaction) => t.tags.includes('inventory count');

/** Department sales in the ledger (credit − debit on the department's revenue accounts), keyed store|dept. */
export function ledgerDeptSales(state: BooksState, opts: { storeIds?: Set<ID> | ID[]; from: string; to: string; posOnly?: boolean }): Map<string, Cents> {
  const ids = opts.storeIds ? new Set(opts.storeIds) : null;
  const rev = revIndex(state);
  const out = new Map<string, Cents>();
  for (const t of state.transactions) {
    if (t.deleted || t.date < opts.from || t.date > opts.to || (opts.posOnly && !t.tags.includes('pos'))) continue;
    for (const l of t.lines) {
      const d = rev.get(l.accountId);
      if (!d || (ids && !ids.has(l.storeId))) continue;
      const k = `${l.storeId}|${d}`;
      out.set(k, (out.get(k) ?? 0) + l.credit - l.debit);
    }
  }
  return out;
}

/** The POS daily close revenue for one store and day, by department (only departments on the close). */
export function posCloseByDept(state: BooksState, storeId: ID, date: string): { byDept: Map<ID, Cents>; found: boolean } {
  const rev = revIndex(state);
  const byDept = new Map<ID, Cents>();
  let found = false;
  for (const t of state.transactions) {
    if (t.deleted || t.date !== date || !t.tags.includes('pos')) continue;
    if (!t.lines.some((l) => l.storeId === storeId)) continue;
    found = true;
    for (const l of t.lines) {
      const d = rev.get(l.accountId);
      if (!d || l.storeId !== storeId) continue;
      byDept.set(d, (byDept.get(d) ?? 0) + l.credit - l.debit);
    }
  }
  return { byDept, found };
}

// ── POS department sales import ──────────────────────────────────────────
export interface ParsedPosRow { row: number; date: string; storeCode: string; posDept: string; sales: Cents; units: number }
export interface ParsedPosTotal { storeCode: string; date: string; sales?: Cents; transactions?: number }
export interface ParsedPos { rows: ParsedPosRow[]; totals: ParsedPosTotal[]; problems: string[] }

const POS_COLS: Record<string, RegExp> = {
  date: /^(date|business date|sales date|day|report date)$/i,
  store: /^(store|site|location|store ?#|store code|store no\.?|store number)$/i,
  dept: /^(department|dept|dept name|department name|category|dept description)$/i,
  sales: /^(sales|net sales|amount|sales \$|total sales|net|net amount|sales amount)$/i,
  units: /^(units|qty|quantity|items|items sold|qty sold|units sold|item count)$/i,
  transactions: /^(transactions|trans|customers|customer count|trans count|txn count|tickets)$/i,
};
const TOTAL_ROW = /^(grand )?totals?:?$|^store total|^day total/i;
const COUNT_ROW = /^(customer count|customers|transactions|transaction count|trans count|ticket count)$/i;

function rowsOf(text: string): string[][] {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  if (first.includes('\t') && !first.includes(',')) return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t'));
  return splitCsv(text);
}
function headerOf(rows: string[][], cols: Record<string, RegExp>, required: string[]): { idx: Record<string, number>; at: number } | null {
  const at = rows.findIndex((r) => required.every((k) => r.some((c) => cols[k].test(c.trim()))));
  if (at < 0) return null;
  const h = rows[at].map((c) => c.trim());
  const idx: Record<string, number> = {};
  for (const k of Object.keys(cols)) idx[k] = h.findIndex((x) => cols[k].test(x));
  return { idx, at };
}
export const csvCell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
export function num(s: string): number | null {
  const t = s.replace(/[,\s$]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
export { rowsOf as tableRows, headerOf as findHeader };

/**
 * Read a POS department sales export (PDI C-Store Essentials "Department Sales", CStorePro "Department Report",
 * or any CSV with Department and Sales columns). Date and Store columns are optional: the form supplies them.
 * A Total row is the file's own total; a "Customer count" row (or the Total row's transactions) is the day's traffic.
 */
export function parsePosFile(text: string, fallback: { storeCode?: string; date?: string } = {}): ParsedPos {
  const rows = rowsOf(text);
  const h = headerOf(rows, POS_COLS, ['dept', 'sales']);
  if (!h) return { rows: [], totals: [], problems: ['No header row found. The department sales export needs Department and Sales columns (Units and Transactions are optional).'] };
  const { idx } = h;
  const out: ParsedPosRow[] = [];
  const totals = new Map<string, ParsedPosTotal>();
  const problems: string[] = [];
  const total = (storeCode: string, date: string) => {
    const k = `${storeCode}|${date}`;
    if (!totals.has(k)) totals.set(k, { storeCode, date });
    return totals.get(k)!;
  };
  for (let r = h.at + 1; r < rows.length; r++) {
    const row = rows[r];
    const n = r + 1;
    const name = csvCell(row, idx.dept) || (row.find((c) => TOTAL_ROW.test(c.trim())) ?? '').trim();
    if (!name) continue;
    const date = idx.date >= 0 && csvCell(row, idx.date) ? parseDate(csvCell(row, idx.date)) : fallback.date ?? null;
    const storeCode = (csvCell(row, idx.store) || fallback.storeCode || '').toUpperCase();
    if (!date) { problems.push(`Row ${n}: no business date. Add a Date column or pick the date above.`); continue; }
    if (!storeCode) { problems.push(`Row ${n}: no store. Add a Store column or pick the store above.`); continue; }
    if (COUNT_ROW.test(name)) {
      const v = num(csvCell(row, idx.transactions)) ?? num(csvCell(row, idx.units)) ?? num(csvCell(row, idx.sales));
      if (v !== null) total(storeCode, date).transactions = Math.round(v);
      continue;
    }
    const sales = parseMoney(csvCell(row, idx.sales));
    if (TOTAL_ROW.test(name)) {
      const t = total(storeCode, date);
      if (sales !== null) t.sales = sales;
      const tx = num(csvCell(row, idx.transactions));
      if (tx !== null) t.transactions = Math.round(tx);
      continue;
    }
    if (sales === null) { problems.push(`Row ${n}: "${csvCell(row, idx.sales)}" isn't an amount.`); continue; }
    const units = num(csvCell(row, idx.units));
    out.push({ row: n, date, storeCode, posDept: name, sales, units: units === null ? 0 : Math.round(units) });
  }
  return { rows: out, totals: [...totals.values()], problems };
}

export const posHash = (storeId: ID, date: string, posDept: string) => `${storeId}|${date}|${norm(posDept)}`;

export interface PosPreviewRow extends ParsedPosRow { storeId: ID; departmentId?: ID; hash: string; status: 'new' | 'duplicate' | 'problem'; problem?: string }
export interface PosPreviewDay {
  storeId: ID;
  date: string;
  /** Sum of the file's department rows. */
  fileSales: Cents;
  /** The file's own Total row, when it has one. */
  reportedTotal?: Cents;
  tiesFile: boolean;
  /** Whether the books have a POS daily close for this store and day. */
  closeFound: boolean;
  /** File vs POS close, departments on the close only (lottery is left out). */
  fileInClose: Cents;
  ledgerInClose: Cents;
  tiesLedger: boolean;
  byDept: { departmentId: ID; file: Cents; ledger: Cents }[];
  transactions?: number;
}
export interface PosPreview { rows: PosPreviewRow[]; days: PosPreviewDay[]; added: number; skipped: number; problems: number; sales: Cents }

export function previewPosImport(state: BooksState, parsed: ParsedPos): PosPreview {
  const ins = insideOf(state);
  const have = new Map(ins.posSales.map((p) => [p.hash, p]));
  const seen = new Set<string>();
  const rows: PosPreviewRow[] = parsed.rows.map((r) => {
    const s = state.stores.find((x) => x.code.toUpperCase() === r.storeCode && !x.deleted);
    const d = deptForPos(state, r.posDept);
    const hash = posHash(s?.id ?? r.storeCode, r.date, r.posDept);
    let problem: string | undefined;
    if (!s) problem = `Store "${r.storeCode}" isn't set up.`;
    else if (s.kind !== 'operating') problem = `${s.code} isn't an operating store.`;
    else if (!d) problem = `POS department "${r.posDept}" isn't mapped. Add it to a department's POS names.`;
    else if (seen.has(hash)) problem = 'Same store, day and department twice in this file.';
    seen.add(hash);
    const prior = have.get(hash);
    if (!problem && prior && prior.sales !== r.sales) problem = `Already imported for this day as ${formatMoney(prior.sales, { dollarSign: true })}. Undo that import first if the POS corrected it.`;
    return { ...r, storeId: s?.id ?? '', departmentId: d?.id, hash, status: problem ? 'problem' : prior ? 'duplicate' : 'new', problem };
  });
  const dayKeys = [...new Set(rows.filter((r) => r.storeId).map((r) => `${r.storeId}|${r.date}`))].sort();
  const closeDepts = new Set(departments(state).filter((d) => d.inPosClose).map((d) => d.id));
  const days: PosPreviewDay[] = dayKeys.map((k) => {
    const [storeId, date] = k.split('|');
    const mine = rows.filter((r) => r.storeId === storeId && r.date === date);
    const fileSales = mine.reduce((a, r) => a + r.sales, 0);
    const tot = parsed.totals.find((t) => t.date === date && t.storeCode === codeOf(state, storeId));
    const close = posCloseByDept(state, storeId, date);
    const fileBy = new Map<ID, Cents>();
    for (const r of mine) if (r.departmentId) fileBy.set(r.departmentId, (fileBy.get(r.departmentId) ?? 0) + r.sales);
    const byDept = [...closeDepts].filter((d) => fileBy.has(d) || close.byDept.has(d)).map((d) => ({ departmentId: d, file: fileBy.get(d) ?? 0, ledger: close.byDept.get(d) ?? 0 }));
    const fileInClose = byDept.reduce((a, x) => a + x.file, 0);
    const ledgerInClose = byDept.reduce((a, x) => a + x.ledger, 0);
    return {
      storeId, date, fileSales, reportedTotal: tot?.sales, tiesFile: tot?.sales === undefined || tot.sales === fileSales, closeFound: close.found,
      fileInClose, ledgerInClose, tiesLedger: close.found && byDept.every((x) => x.file === x.ledger), byDept, transactions: tot?.transactions,
    };
  });
  const fresh = rows.filter((r) => r.status === 'new');
  return { rows, days, added: fresh.length, skipped: rows.length - fresh.length, problems: rows.filter((r) => r.status === 'problem').length, sales: fresh.reduce((a, r) => a + r.sales, 0) };
}

function newBatch(books: Books, actor: User, list: InsideBatch[], kind: InsideBatch['kind'], fileName: string, added: number, skipped: number, source: InsideBatch['source']): InsideBatch {
  const b: InsideBatch = { id: books.nextId('ib'), kind, fileName, importedAt: books.clock(), by: actor.id, added, skipped, source };
  list.push(b);
  return b;
}
export { newBatch as newInsideBatch };

/**
 * Import the POS department sales. Idempotent per store + day + POS department; every row carries the batch id.
 * Nothing posts: the POS daily close already put these sales in the books, and the preview proves they agree.
 */
export function commitPosImport(books: Books, actor: User, file: { name: string; parsed: ParsedPos }, opts: { source?: InsideBatch['source'] } = {}): { batch: InsideBatch; rows: PosDeptSale[]; days: PosDaySummary[] } {
  books.require(actor, 'inside.edit', 'import POS department sales');
  const ins = insideOf(books.state);
  const p = previewPosImport(books.state, file.parsed);
  for (const r of p.rows) if (r.storeId) assertStore(actor, r.storeId);
  const batch = newBatch(books, actor, ins.batches, 'pos', file.name, p.added, p.skipped, opts.source ?? 'import');
  const rows = p.rows.filter((r) => r.status === 'new').map((r): PosDeptSale => ({ id: books.nextId('ps'), storeId: r.storeId, date: r.date, posDept: r.posDept.trim(), departmentId: r.departmentId!, sales: r.sales, units: r.units, hash: r.hash, batchId: batch.id }));
  ins.posSales.push(...rows);
  const haveDays = new Set(ins.posDays.map((d) => d.hash));
  const days: PosDaySummary[] = [];
  for (const d of p.days) {
    const hash = `${d.storeId}|${d.date}`;
    if (d.transactions === undefined || haveDays.has(hash)) continue;
    days.push({ id: books.nextId('pd'), storeId: d.storeId, date: d.date, transactions: d.transactions, hash, batchId: batch.id });
  }
  ins.posDays.push(...days);
  books.audit(actor, { action: 'import', objectType: 'inside', objectId: batch.id, summary: `Imported ${file.name}: ${p.added} department rows (${formatMoney(p.sales, { dollarSign: true })}), ${p.skipped} skipped` });
  books.changed();
  return { batch, rows, days };
}

/** Undo one POS import: its rows and day counts come out, so a corrected file can go in. */
export function undoPosBatch(books: Books, actor: User, batchId: ID): number {
  books.require(actor, 'inside.edit', 'undo a POS import');
  const ins = insideOf(books.state);
  const before = ins.posSales.length;
  ins.posSales = ins.posSales.filter((p) => p.batchId !== batchId);
  ins.posDays = ins.posDays.filter((p) => p.batchId !== batchId);
  const n = before - ins.posSales.length;
  books.audit(actor, { action: 'undo import', objectType: 'inside', objectId: batchId, summary: `Removed ${n} POS department rows from batch ${batchId}` });
  books.changed();
  return n;
}

/** Add a POS department name to one of our departments. */
export function addPosAlias(books: Books, actor: User, departmentId: ID, alias: string): void {
  books.require(actor, 'inside.edit', 'map POS departments');
  const d = deptById(books.state, departmentId);
  if (!d) throw errs(['Choose a department.']);
  if (!alias.trim()) throw errs(['Enter the POS department name.']);
  const other = deptForPos(books.state, alias);
  if (other && other.id !== d.id) throw errs([`"${alias}" already maps to ${other.name}.`]);
  if (!d.posAliases.some((a) => norm(a) === norm(alias))) d.posAliases.push(alias.trim());
  books.audit(actor, { action: 'map', objectType: 'inside', objectId: d.id, summary: `POS department "${alias.trim()}" → ${d.name}` });
  books.changed();
}

export function saveDepartment(books: Books, actor: User, d: InsideDept): InsideDept {
  books.require(actor, 'inside.edit', 'change departments');
  const e: string[] = [];
  if (!d.name.trim()) e.push('Name the department.');
  if (!d.revenueAccountIds.length || d.revenueAccountIds.some((a) => !books.account(a))) e.push('Choose the revenue account its sales post to.');
  if (d.cogsAccountId && !books.account(d.cogsAccountId)) e.push('Choose the cost-of-goods account its purchases post to.');
  if (!Number.isInteger(d.costBps) || d.costBps < 0 || d.costBps >= 10000) e.push('Enter the expected cost as a percent of retail between 0 and 100.');
  if (!Number.isInteger(d.shrinkBps) || d.shrinkBps < 0 || d.shrinkBps > 10000) e.push('Enter the shrink threshold as a percent of sales.');
  if (e.length) throw errs(e);
  const ins = insideOf(books.state);
  const i = ins.departments.findIndex((x) => x.id === d.id);
  const before = i >= 0 ? structuredClone(ins.departments[i]) : undefined;
  if (i >= 0) ins.departments[i] = d; else ins.departments.push(d);
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'inside', objectId: d.id, summary: `${before ? 'Updated' : 'Added'} department ${d.name}`, before, after: structuredClone(d) });
  books.changed();
  return d;
}

// ── Traffic: transactions per day and average ticket ─────────────────────
export interface Traffic { days: number; transactions: number; perDay: number | null; sales: Cents; avgTicket: Cents | null }

/** From the imported POS days: customer count and inside + kitchen sales on the days that have one. */
export function storeTraffic(state: BooksState, storeIds: ID[], from: string, to: string): Traffic {
  const ids = new Set(storeIds);
  const ins = insideOf(state);
  const days = ins.posDays.filter((d) => ids.has(d.storeId) && d.date >= from && d.date <= to);
  const have = new Set(days.map((d) => d.hash));
  const closeDepts = new Set(departments(state).filter((d) => d.inPosClose).map((d) => d.id));
  const sales = ins.posSales.filter((p) => have.has(`${p.storeId}|${p.date}`) && closeDepts.has(p.departmentId)).reduce((a, p) => a + p.sales, 0);
  const transactions = days.reduce((a, d) => a + d.transactions, 0);
  return { days: days.length, transactions, perDay: days.length ? transactions / days.length : null, sales, avgTicket: transactions ? Math.round(sales / transactions) : null };
}

// ── Vendor purchases → departments ───────────────────────────────────────
export type PurchaseMethod = 'bill' | 'check' | 'cash' | 'eft';
export const METHOD_LABEL: Record<PurchaseMethod, string> = { bill: 'Bill (AP)', check: 'Check', cash: 'Cash', eft: 'EFT / ACH' };

export interface PurchaseLine {
  txnId: ID;
  ref: string;
  date: string;
  storeId: ID;
  accountId: ID;
  partyId?: ID;
  description: string;
  amount: Cents;
  method: PurchaseMethod;
  /** How the purchase was assigned: a vendor mapping, or the account's default department(s). */
  mappedBy: 'vendor' | 'account';
  alloc: { departmentId: ID; amount: Cents }[];
}

/** Which departments a purchase on this account from this vendor belongs to. */
export function mappingFor(state: BooksState, partyId: ID | undefined, accountId: ID): { departmentIds: ID[]; mappedBy: 'vendor' | 'account' } {
  const maps = insideOf(state).vendorMaps;
  const m = (partyId && maps.find((x) => x.partyId === partyId && x.accountId === accountId))
    ?? (partyId && maps.find((x) => x.partyId === partyId && !x.accountId))
    ?? maps.find((x) => !x.partyId && x.accountId === accountId);
  if (m && m.departmentIds.length) return { departmentIds: m.departmentIds, mappedBy: m.partyId ? 'vendor' : 'account' };
  return { departmentIds: departments(state).filter((d) => d.cogsAccountId === accountId).map((d) => d.id), mappedBy: 'account' };
}

/**
 * Merchandise and food purchases in the ledger (department cost-of-goods accounts, inventory-count adjustments left out),
 * each split to departments. A purchase that covers several departments is split by that store's sales of them that month.
 */
export function purchaseLines(state: BooksState, opts: { storeIds?: Set<ID> | ID[]; from: string; to: string }): PurchaseLine[] {
  const ids = opts.storeIds ? new Set(opts.storeIds) : null;
  const cogs = cogsAccounts(state);
  const cashAccts = new Set(state.accounts.filter((a) => a.subtype === 'cash').map((a) => a.id));
  const salesCache = new Map<string, Map<string, Cents>>();
  const salesOf = (period: string) => {
    if (!salesCache.has(period)) salesCache.set(period, ledgerDeptSales(state, { from: periodFrom(period), to: lastDayOfPeriod(period) }));
    return salesCache.get(period)!;
  };
  const out: PurchaseLine[] = [];
  for (const t of state.transactions) {
    if (t.deleted || t.date < opts.from || t.date > opts.to || isInventoryTxn(t)) continue;
    const method: PurchaseMethod = t.tags.includes('bill') ? 'bill' : t.checkNo ? 'check' : t.lines.some((l) => cashAccts.has(l.accountId)) ? 'cash' : 'eft';
    for (const l of t.lines) {
      if (!cogs.has(l.accountId) || (ids && !ids.has(l.storeId))) continue;
      const amount = l.debit - l.credit;
      if (!amount) continue;
      const partyId = l.partyId ?? t.partyId;
      const { departmentIds, mappedBy } = mappingFor(state, partyId, l.accountId);
      let alloc: PurchaseLine['alloc'];
      if (departmentIds.length <= 1) alloc = departmentIds.length ? [{ departmentId: departmentIds[0], amount }] : [];
      else {
        const s = salesOf(periodOf(t.date));
        const w = departmentIds.map((d) => Math.max(0, s.get(`${l.storeId}|${d}`) ?? 0));
        const parts = allocate(amount, w.some((x) => x > 0) ? w : departmentIds.map(() => 1));
        alloc = departmentIds.map((d, i) => ({ departmentId: d, amount: parts[i] }));
      }
      out.push({ txnId: t.id, ref: t.ref, date: t.date, storeId: l.storeId, accountId: l.accountId, partyId, description: t.description, amount, method, mappedBy, alloc });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.ref.localeCompare(b.ref));
}

/** Purchases by store|dept. */
export function purchasesByDept(lines: PurchaseLine[]): Map<string, Cents> {
  const m = new Map<string, Cents>();
  for (const p of lines) for (const a of p.alloc) m.set(`${p.storeId}|${a.departmentId}`, (m.get(`${p.storeId}|${a.departmentId}`) ?? 0) + a.amount);
  return m;
}

export function saveVendorMapping(books: Books, actor: User, m: Omit<VendorMapping, 'id'> & { id?: ID }): VendorMapping {
  books.require(actor, 'inside.edit', 'map vendors to departments');
  const e: string[] = [];
  if (!m.partyId && !m.accountId) e.push('Choose the vendor, the account, or both.');
  if (m.partyId && !books.state.parties.some((p) => p.id === m.partyId)) e.push('That vendor is not set up.');
  if (m.accountId && !cogsAccounts(books.state).has(m.accountId)) e.push('Choose a department cost-of-goods account (5100–5200).');
  if (!m.departmentIds.length || m.departmentIds.some((d) => !deptById(books.state, d))) e.push('Choose at least one department.');
  if (e.length) throw errs(e);
  const ins = insideOf(books.state);
  const dupe = ins.vendorMaps.find((x) => x.id !== m.id && x.partyId === m.partyId && x.accountId === m.accountId);
  if (dupe) throw errs(['That vendor and account already have a mapping. Change it instead.']);
  const rec: VendorMapping = { id: m.id ?? books.nextId('vm'), partyId: m.partyId || undefined, accountId: m.accountId || undefined, departmentIds: [...m.departmentIds], note: m.note?.trim() || undefined };
  const i = ins.vendorMaps.findIndex((x) => x.id === rec.id);
  const before = i >= 0 ? structuredClone(ins.vendorMaps[i]) : undefined;
  if (i >= 0) ins.vendorMaps[i] = rec; else ins.vendorMaps.push(rec);
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'inside', objectId: rec.id, summary: `Vendor mapping: ${books.state.parties.find((p) => p.id === rec.partyId)?.name ?? 'any vendor'} → ${rec.departmentIds.map((d) => deptName(books.state, d)).join(', ')}`, before, after: structuredClone(rec) });
  books.changed();
  return rec;
}

export function removeVendorMapping(books: Books, actor: User, id: ID): void {
  books.require(actor, 'inside.edit', 'map vendors to departments');
  const ins = insideOf(books.state);
  const m = ins.vendorMaps.find((x) => x.id === id);
  if (!m) return;
  ins.vendorMaps = ins.vendorMaps.filter((x) => x.id !== id);
  books.audit(actor, { action: 'delete', objectType: 'inside', objectId: id, summary: 'Removed a vendor mapping', before: m });
  books.changed();
}

// ── Inventory counts and shrink ──────────────────────────────────────────
const live = (c: InventoryCount) => c.status === 'posted';
export const countTotal = (c: Pick<InventoryCount, 'lines'>) => c.lines.reduce((a, l) => a + l.counted, 0);

export function postedCounts(state: BooksState, storeId?: ID): InventoryCount[] {
  return insideOf(state).counts.filter((c) => live(c) && (!storeId || c.storeId === storeId)).sort((a, b) => a.date.localeCompare(b.date) || a.enteredAt.localeCompare(b.enteredAt));
}

/** The last posted count of a department at a store before a date (or before a given count). */
export function previousCount(state: BooksState, storeId: ID, departmentId: ID, before: string, excludeId?: ID): { date: string; counted: Cents; countId: ID } | null {
  const xs = postedCounts(state, storeId).filter((c) => c.id !== excludeId && c.date < before && c.lines.some((l) => l.departmentId === departmentId));
  const c = xs.at(-1);
  return c ? { date: c.date, counted: c.lines.find((l) => l.departmentId === departmentId)!.counted, countId: c.id } : null;
}

/** Ledger balance of one account at one store through a date, optionally leaving one transaction out. */
export function acctBalance(state: BooksState, accountId: ID, storeId: ID, asOf: string, excludeTxn?: ID): Cents {
  let n = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf || t.id === excludeTxn) continue;
    for (const l of t.lines) if (l.accountId === accountId && l.storeId === storeId) n += l.debit - l.credit;
  }
  return n;
}

export interface CountReviewLine {
  departmentId: ID;
  counted: Cents;
  previous: Cents | null;
  previousDate: string | null;
  purchases: Cents;
  sales: Cents;
  salesAtCost: Cents;
  /** Book inventory: last count + purchases − sales at cost. Null with no earlier count. */
  book: Cents | null;
  /** Book − counted (+ = missing). */
  shrink: Cents | null;
  shrinkPct: number | null;
  over: boolean;
  /** What posting this count moves 1310 by for the department (+ up). */
  adjustment: Cents;
}
export interface CountReview { lines: CountReviewLine[]; ledgerBefore: Cents; counted: Cents; adjustment: Cents; shrink: Cents; sales: Cents; baseline: boolean }

/**
 * Book vs counted for each department, and the adjustment the count posts. The adjustment brings 1310 at the store to
 * the counted total: per department, counted − last count; anything else in 1310 the counts don't explain (an opening
 * balance, a manual entry) is spread across departments by counted value.
 */
export function reviewCount(state: BooksState, c: Pick<InventoryCount, 'storeId' | 'date' | 'lines'> & { id?: ID; posted?: InventoryCount['posted'] }): CountReview {
  const excludeTxn = c.posted?.txnId;
  const lines0 = c.lines.map((l) => {
    const prev = previousCount(state, c.storeId, l.departmentId, c.date, c.id);
    return { l, prev };
  });
  const purch = new Map<ID, Map<string, Cents>>();
  const purchFor = (from: string) => {
    if (!purch.has(from)) purch.set(from, purchasesByDept(purchaseLines(state, { storeIds: [c.storeId], from, to: c.date })));
    return purch.get(from)!;
  };
  const salesCache = new Map<string, Map<string, Cents>>();
  const salesFor = (from: string) => {
    if (!salesCache.has(from)) salesCache.set(from, ledgerDeptSales(state, { storeIds: [c.storeId], from, to: c.date }));
    return salesCache.get(from)!;
  };
  const ledgerBefore = acctBalance(state, INV_ACCT, c.storeId, c.date, excludeTxn);
  // What 1310 holds that no department's latest count explains (departments left off this count keep their last value).
  const prevSum = departments(state, { counted: true }).reduce((a, d) => a + (previousCount(state, c.storeId, d.id, c.date, c.id)?.counted ?? 0), 0);
  const residual = ledgerBefore - prevSum;
  const weights = c.lines.map((l) => l.counted);
  const spread = residual && weights.some((w) => w > 0) ? allocate(residual, weights) : c.lines.map(() => 0);
  const lines: CountReviewLine[] = lines0.map(({ l, prev }, i) => {
    const d = deptById(state, l.departmentId);
    const from = prev ? addDays(prev.date, 1) : c.date;
    const purchases = prev ? purchFor(from).get(`${c.storeId}|${l.departmentId}`) ?? 0 : 0;
    const sales = prev ? salesFor(from).get(`${c.storeId}|${l.departmentId}`) ?? 0 : 0;
    const salesAtCost = Math.round((sales * (d?.costBps ?? 0)) / 10000);
    const book = prev ? prev.counted + purchases - salesAtCost : null;
    const shrink = book === null ? null : book - l.counted;
    const shrinkPct = shrink === null || sales <= 0 ? null : shrink / sales;
    return {
      departmentId: l.departmentId, counted: l.counted, previous: prev?.counted ?? null, previousDate: prev?.date ?? null, purchases, sales, salesAtCost, book, shrink, shrinkPct,
      over: shrinkPct !== null && shrinkPct * 10000 > (d?.shrinkBps ?? 10000), adjustment: l.counted - (prev?.counted ?? 0) - spread[i],
    };
  });
  const counted = countTotal(c);
  return {
    lines, ledgerBefore, counted, adjustment: lines.reduce((a, l) => a + l.adjustment, 0), shrink: lines.reduce((a, l) => a + (l.shrink ?? 0), 0),
    sales: lines.reduce((a, l) => a + l.sales, 0), baseline: lines.every((l) => l.previous === null),
  };
}

export interface CountInput { storeId: ID; date: string; lines: CountLine[]; note?: string }

function validateCount(state: BooksState, x: CountInput): string[] {
  const e: string[] = [];
  const s = state.stores.find((st) => st.id === x.storeId);
  if (!s || s.kind !== 'operating') e.push('Choose the store you counted.');
  if (!isValidDate(x.date)) e.push('Enter the count date as YYYY-MM-DD.');
  if (!x.lines.length) e.push('Enter at least one department count.');
  const seen = new Set<ID>();
  for (const l of x.lines) {
    const d = deptById(state, l.departmentId);
    if (!d || !d.counted) e.push('Each line needs a counted department.');
    else if (seen.has(d.id)) e.push(`${d.name} is on the count twice.`);
    else if (!Number.isSafeInteger(l.counted) || l.counted < 0) e.push(`Enter ${d.name} at cost, in dollars and cents, zero or more.`);
    if (d) seen.add(d.id);
  }
  if (s && isValidDate(x.date) && postedCounts(state, s.id).some((c) => c.date >= x.date)) e.push(`A count on or after ${x.date} is already posted for ${s.code}. Counts post in date order.`);
  if (state.periods[periodOf(x.date)]?.status === 'locked') e.push(`${periodOf(x.date)} is locked. Date the count in an open month.`);
  return e;
}

/** Enter a count (store managers can, for their store). It posts nothing until someone posts it. */
export function saveCount(books: Books, actor: User, x: CountInput, id?: ID): InventoryCount {
  books.require(actor, 'inside.log', 'enter inventory counts');
  assertStore(actor, x.storeId);
  const e = validateCount(books.state, x);
  if (e.length) throw errs(e);
  const ins = insideOf(books.state);
  const existing = id ? ins.counts.find((c) => c.id === id) : undefined;
  if (existing && existing.status !== 'draft') throw errs(['That count is already posted. Void it and enter a new one.']);
  const c: InventoryCount = existing ?? { id: books.nextId('cnt'), storeId: x.storeId, date: x.date, lines: [], status: 'draft', enteredBy: actor.id, enteredAt: books.clock() };
  const before = existing ? structuredClone(existing) : undefined;
  Object.assign(c, { storeId: x.storeId, date: x.date, lines: x.lines.map((l) => ({ departmentId: l.departmentId, counted: l.counted })), note: x.note?.trim() || undefined });
  if (!existing) ins.counts.push(c);
  books.audit(actor, { action: existing ? 'update' : 'create', objectType: 'inside', objectId: c.id, summary: `Inventory count ${codeOf(books.state, c.storeId)} ${c.date}: ${formatMoney(countTotal(c), { dollarSign: true })} at cost`, before, after: structuredClone(c) });
  books.changed();
  return c;
}

/** Post a count: the inventory adjustment goes through the ledger (1310 against each department's cost of goods). */
export function postCount(books: Books, actor: User, id: ID): InventoryCount {
  books.require(actor, 'inside.edit', 'post inventory counts');
  const ins = insideOf(books.state);
  const c = ins.counts.find((x) => x.id === id);
  if (!c) throw errs(['That count no longer exists.']);
  if (c.status !== 'draft') throw errs(['That count is already posted.']);
  const e = validateCount(books.state, c);
  if (e.length) throw errs(e);
  const r = reviewCount(books.state, c);
  const code = codeOf(books.state, c.storeId);
  const legs = r.lines.filter((l) => l.adjustment !== 0).flatMap((l) => {
    const d = deptById(books.state, l.departmentId)!;
    const a = l.adjustment;
    return [
      { accountId: d.inventoryAccountId ?? INV_ACCT, storeId: c.storeId, debit: a > 0 ? a : 0, credit: a < 0 ? -a : 0, memo: `${d.name} counted ${formatMoney(l.counted, { dollarSign: true })}` },
      { accountId: d.cogsAccountId!, storeId: c.storeId, debit: a < 0 ? -a : 0, credit: a > 0 ? a : 0, memo: `${d.name} inventory ${a > 0 ? 'increase' : 'decrease'}` },
    ];
  });
  let txnId: ID | undefined;
  if (legs.length) {
    const t = books.createTransaction(actor, { date: c.date, kind: 'journal', description: `Inventory count ${code} ${c.date}`, memo: c.note, tags: ['inventory count', 'inside'], lines: legs }, { source: 'manual' });
    txnId = t.id;
  }
  const before = structuredClone(c);
  c.status = 'posted';
  c.posted = { by: actor.id, at: books.clock(), txnId, adjustments: r.lines.map((l) => ({ departmentId: l.departmentId, amount: l.adjustment })) };
  books.audit(actor, { action: 'post', objectType: 'inside', objectId: c.id, summary: `Posted count ${code} ${c.date}: adjustment ${formatMoney(r.adjustment, { dollarSign: true })}, shrink ${formatMoney(r.shrink, { dollarSign: true })}`, before, after: structuredClone(c) });
  books.changed();
  return c;
}

/** Void a count. A posted count can only be voided when it is the store's latest; its adjustment is soft-deleted. */
export function voidCount(books: Books, actor: User, id: ID, reason: string): void {
  books.require(actor, 'inside.edit', 'void inventory counts');
  const c = insideOf(books.state).counts.find((x) => x.id === id);
  if (!c || c.status === 'void') throw errs(['That count is not open.']);
  if (!reason.trim()) throw errs(['Say why you are voiding the count.']);
  if (c.status === 'posted') {
    const last = postedCounts(books.state, c.storeId).at(-1);
    if (last?.id !== c.id) throw errs(['Only the latest posted count can be voided. Void the later ones first.']);
    if (c.posted?.txnId) books.deleteTransaction(actor, c.posted.txnId, `Count voided: ${reason.trim()}`);
  }
  const before = structuredClone(c);
  c.status = 'void';
  c.voided = { by: actor.id, at: books.clock(), reason: reason.trim() };
  books.audit(actor, { action: 'void', objectType: 'inside', objectId: c.id, summary: `Voided count ${codeOf(books.state, c.storeId)} ${c.date}`, before, reason });
  books.changed();
}

/** Inventory adjustments posted by counts, per store|dept, dated inside the range. */
export function countAdjustments(state: BooksState, from: string, to: string, storeIds?: Set<ID> | ID[]): Map<string, Cents> {
  const ids = storeIds ? new Set(storeIds) : null;
  const m = new Map<string, Cents>();
  for (const c of postedCounts(state)) {
    if (c.date < from || c.date > to || (ids && !ids.has(c.storeId))) continue;
    for (const a of c.posted?.adjustments ?? []) m.set(`${c.storeId}|${a.departmentId}`, (m.get(`${c.storeId}|${a.departmentId}`) ?? 0) + a.amount);
  }
  return m;
}

/** 1310 at a store in the ledger vs the latest posted count of every department. */
export function inventoryTie(state: BooksState, storeId: ID, asOf: string): { ledger: Cents; counted: Cents; ok: boolean; hasCounts: boolean } {
  const counted = departments(state, { counted: true }).reduce((a, d) => a + (previousCount(state, storeId, d.id, addDays(asOf, 1))?.counted ?? 0), 0);
  const ledger = acctBalance(state, INV_ACCT, storeId, asOf);
  const hasCounts = postedCounts(state, storeId).some((c) => c.date <= asOf);
  return { ledger, counted, ok: !hasCounts || ledger === counted, hasCounts };
}

export interface ShrinkRow extends CountReviewLine { countId: ID; storeId: ID; date: string }
/** Every posted count's shrink by department, newest first. */
export function shrinkHistory(state: BooksState, storeIds: Set<ID>): ShrinkRow[] {
  const out: ShrinkRow[] = [];
  for (const c of postedCounts(state)) {
    if (!storeIds.has(c.storeId)) continue;
    for (const l of reviewCount(state, c).lines) out.push({ ...l, countId: c.id, storeId: c.storeId, date: c.date });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.storeId.localeCompare(b.storeId));
}

/** Departments over their shrink threshold on each store's latest posted count. */
export function shrinkAlerts(state: BooksState, storeIds: Set<ID>): ShrinkRow[] {
  const out: ShrinkRow[] = [];
  for (const id of storeIds) {
    const c = postedCounts(state, id).at(-1);
    if (!c) continue;
    for (const l of reviewCount(state, c).lines) if (l.over && !deptById(state, l.departmentId)?.kitchen) out.push({ ...l, countId: c.id, storeId: id, date: c.date });
  }
  return out;
}

// ── Department sales and margin ──────────────────────────────────────────
export interface DeptMarginRow {
  departmentId: ID;
  sales: Cents;
  posSales: Cents;
  units: number;
  purchases: Cents;
  /** Inventory change from counts in the period (+ up). */
  invChange: Cents;
  cogs: Cents;
  margin: Cents;
  marginPct: number | null;
  share: number;
}
export interface DeptMargin { rows: DeptMarginRow[]; sales: Cents; cogs: Cents; margin: Cents; ledgerCogs: Cents; unassigned: Cents; posDays: number; closeDays: number; posOff: { storeId: ID; date: string; diff: Cents }[] }

/** Department sales (ledger), units (POS import), purchases mapped to departments and the count adjustments: true department margin. */
export function deptMargin(state: BooksState, opts: { storeIds: ID[]; from: string; to: string }): DeptMargin {
  const ids = new Set(opts.storeIds);
  const sales = ledgerDeptSales(state, { storeIds: ids, from: opts.from, to: opts.to });
  const pl = purchaseLines(state, { storeIds: ids, from: opts.from, to: opts.to });
  const purch = purchasesByDept(pl);
  const adj = countAdjustments(state, opts.from, opts.to, ids);
  const ins = insideOf(state);
  const pos = ins.posSales.filter((p) => ids.has(p.storeId) && p.date >= opts.from && p.date <= opts.to);
  const sumBy = (m: Map<string, number>, d: ID) => [...ids].reduce((a, s) => a + (m.get(`${s}|${d}`) ?? 0), 0);
  const ds = departments(state);
  const total = ds.reduce((a, d) => a + sumBy(sales, d.id), 0);
  const rows = ds.map((d): DeptMarginRow => {
    const s = sumBy(sales, d.id);
    const purchases = sumBy(purch, d.id);
    const invChange = sumBy(adj, d.id);
    const cogs = purchases - invChange;
    return {
      departmentId: d.id, sales: s, posSales: pos.filter((p) => p.departmentId === d.id).reduce((a, p) => a + p.sales, 0), units: pos.filter((p) => p.departmentId === d.id).reduce((a, p) => a + p.units, 0),
      purchases, invChange, cogs, margin: s - cogs, marginPct: s ? (s - cogs) / s : null, share: total ? s / total : 0,
    };
  }).filter((r) => r.sales || r.purchases || r.invChange);
  // Ledger cost of goods on the department accounts for the same stores and dates.
  const cogsSet = cogsAccounts(state);
  let ledgerCogs = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date < opts.from || t.date > opts.to) continue;
    for (const l of t.lines) if (cogsSet.has(l.accountId) && ids.has(l.storeId)) ledgerCogs += l.debit - l.credit;
  }
  const unassigned = pl.filter((p) => !p.alloc.length).reduce((a, p) => a + p.amount, 0);
  // POS import vs POS close, day by day.
  const days = new Set(pos.map((p) => `${p.storeId}|${p.date}`));
  const closeDays = new Set<string>();
  for (const t of state.transactions) if (!t.deleted && t.tags.includes('pos') && t.date >= opts.from && t.date <= opts.to) for (const l of t.lines) if (ids.has(l.storeId)) closeDays.add(`${l.storeId}|${t.date}`);
  const closeDepts = new Set(ds.filter((d) => d.inPosClose).map((d) => d.id));
  const posOff: DeptMargin['posOff'] = [];
  for (const k of days) {
    const [storeId, date] = k.split('|');
    const close = posCloseByDept(state, storeId, date);
    const file = pos.filter((p) => p.storeId === storeId && p.date === date && closeDepts.has(p.departmentId)).reduce((a, p) => a + p.sales, 0);
    const led = [...close.byDept].filter(([d]) => closeDepts.has(d)).reduce((a, [, v]) => a + v, 0);
    if (file !== led) posOff.push({ storeId, date, diff: file - led });
  }
  const sum = (f: (r: DeptMarginRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return { rows, sales: sum((r) => r.sales), cogs: sum((r) => r.cogs), margin: sum((r) => r.margin), ledgerCogs, unassigned, posDays: days.size, closeDays: closeDays.size, posOff };
}

// ── Purchasing budgets ───────────────────────────────────────────────────
export function setBudget(books: Books, actor: User, x: { storeId: ID; period: string; departmentId: ID; amount: Cents }): PurchaseBudget {
  books.require(actor, 'inside.edit', 'set purchasing budgets');
  const e: string[] = [];
  if (!books.state.stores.some((s) => s.id === x.storeId && s.kind === 'operating')) e.push('Choose the store.');
  if (!/^\d{4}-\d{2}$/.test(x.period)) e.push('Choose the month (YYYY-MM).');
  if (!deptById(books.state, x.departmentId)?.cogsAccountId) e.push('Choose a department that buys stock.');
  if (!Number.isSafeInteger(x.amount) || x.amount < 0) e.push('Enter the budget in dollars, zero or more.');
  if (e.length) throw errs(e);
  const ins = insideOf(books.state);
  let b = ins.budgets.find((y) => y.storeId === x.storeId && y.period === x.period && y.departmentId === x.departmentId);
  const before = b ? structuredClone(b) : undefined;
  if (b) b.amount = x.amount;
  else ins.budgets.push((b = { id: books.nextId('pb'), ...x }));
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'inside', objectId: b.id, summary: `Purchasing budget ${codeOf(books.state, x.storeId)} ${deptName(books.state, x.departmentId)} ${x.period}: ${formatMoney(x.amount, { dollarSign: true })}`, before, after: structuredClone(b) });
  books.changed();
  return b;
}

export interface BudgetRow { storeId: ID; departmentId: ID; budget: Cents | null; spent: Cents; committed: Cents; remaining: Cents | null; used: number | null; over: boolean }

/** Budget vs purchases to date (posted purchases and approved bills) plus bills awaiting approval (committed). */
export function budgetStatus(state: BooksState, period: string, storeIds: ID[]): BudgetRow[] {
  const ids = new Set(storeIds);
  const from = periodFrom(period);
  const to = lastDayOfPeriod(period);
  const spent = purchasesByDept(purchaseLines(state, { storeIds: ids, from, to }));
  const committed = new Map<string, Cents>();
  const cogs = cogsAccounts(state);
  const sales = ledgerDeptSales(state, { storeIds: ids, from, to });
  for (const b of state.payables?.bills ?? []) {
    if (b.status !== 'draft' || b.billDate < from || b.billDate > to) continue;
    for (const l of b.lines) {
      if (!cogs.has(l.accountId) || !ids.has(l.storeId)) continue;
      const { departmentIds } = mappingFor(state, b.vendorId, l.accountId);
      if (!departmentIds.length) continue;
      const w = departmentIds.map((d) => Math.max(0, sales.get(`${l.storeId}|${d}`) ?? 0));
      const parts = allocate(l.amount, w.some((x) => x > 0) ? w : departmentIds.map(() => 1));
      departmentIds.forEach((d, i) => committed.set(`${l.storeId}|${d}`, (committed.get(`${l.storeId}|${d}`) ?? 0) + parts[i]));
    }
  }
  const budgets = insideOf(state).budgets.filter((b) => b.period === period && ids.has(b.storeId));
  const keys = new Set([...budgets.map((b) => `${b.storeId}|${b.departmentId}`), ...spent.keys(), ...committed.keys()]);
  return [...keys].map((k) => {
    const [storeId, departmentId] = k.split('|');
    const b = budgets.find((x) => x.storeId === storeId && x.departmentId === departmentId);
    const s = spent.get(k) ?? 0;
    const c = committed.get(k) ?? 0;
    const budget = b ? b.amount : null;
    return { storeId, departmentId, budget, spent: s, committed: c, remaining: budget === null ? null : budget - s - c, used: budget ? (s + c) / budget : null, over: budget !== null && s + c > budget };
  }).sort((a, b) => a.storeId.localeCompare(b.storeId) || departments(state).findIndex((d) => d.id === a.departmentId) - departments(state).findIndex((d) => d.id === b.departmentId));
}

// ── Scan-data and loyalty rebates ────────────────────────────────────────
export function saveScanProgram(books: Books, actor: User, p: Omit<ScanProgram, 'id' | 'receivables'> & { id?: ID; receivables?: Record<string, ID> }): ScanProgram {
  books.require(actor, 'inside.edit', 'set up scan-data programs');
  const e: string[] = [];
  if (!p.manufacturer.trim()) e.push('Name the manufacturer.');
  if (!deptById(books.state, p.departmentId)) e.push('Choose the department whose units qualify.');
  if (!(p.rateCentsPerUnit > 0) || !Number.isFinite(p.rateCentsPerUnit)) e.push('Enter the rate per qualifying unit, e.g. 8.5 cents.');
  if (!Number.isInteger(p.shareBps) || p.shareBps <= 0 || p.shareBps > 10000) e.push("Enter the manufacturer's share of the department's units, between 0 and 100%.");
  if (!p.storeIds.length) e.push('Choose the stores in the program.');
  if (!Number.isInteger(p.payDays) || p.payDays < 0) e.push('Enter how many days after the period the money is due.');
  if (e.length) throw errs(e);
  const ins = insideOf(books.state);
  const rec: ScanProgram = { ...p, id: p.id ?? books.nextId('scan'), manufacturer: p.manufacturer.trim(), receivables: p.receivables ?? ins.scanPrograms.find((x) => x.id === p.id)?.receivables ?? {} };
  const i = ins.scanPrograms.findIndex((x) => x.id === rec.id);
  const before = i >= 0 ? structuredClone(ins.scanPrograms[i]) : undefined;
  if (i >= 0) ins.scanPrograms[i] = rec; else ins.scanPrograms.push(rec);
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'inside', objectId: rec.id, summary: `Scan-data program ${rec.manufacturer}`, before, after: structuredClone(rec) });
  books.changed();
  return rec;
}

export interface ScanPeriod {
  key: string;
  from: string;
  to: string;
  due: string;
  ended: boolean;
  units: number;
  qualifying: number;
  expected: Cents;
  itemId?: ID;
  /** What the Receivables item says is expected (it may differ from the scan-data figure until it is updated). */
  itemExpected?: Cents;
  received: Cents;
  short: Cents;
  status: 'accruing' | 'to_claim' | 'open' | 'overdue' | 'received' | 'short' | 'closed';
}

/** The program's periods from the first POS units on file through `asOf`: expected (units × share × rate) vs received. */
export function scanPeriods(state: BooksState, programId: ID, asOf: string): ScanPeriod[] {
  const ins = insideOf(state);
  const p = ins.scanPrograms.find((x) => x.id === programId);
  if (!p) return [];
  const ids = new Set(p.storeIds);
  const sales = ins.posSales.filter((s) => s.departmentId === p.departmentId && ids.has(s.storeId) && s.date <= asOf);
  const first = sales.reduce((m, s) => (!m || s.date < m ? s.date : m), '');
  const keys = new Set<string>(Object.keys(p.receivables));
  if (first) for (let d = first; d <= asOf; d = addDays(lastDayOfPeriod(periodOf(d)), 1)) keys.add(p.cadence === 'quarterly' ? quarterOf(d) : periodOf(d));
  const mat = state.settings.materialityCents;
  return [...keys].sort().map((key): ScanPeriod => {
    const { from, to } = key.includes('Q') ? quarterRange(key) : { from: periodFrom(key), to: lastDayOfPeriod(key) };
    const units = sales.filter((s) => s.date >= from && s.date <= to).reduce((a, s) => a + s.units, 0);
    const qualifying = Math.round((units * p.shareBps) / 10000);
    const expected = Math.round(qualifying * p.rateCentsPerUnit);
    const itemId = p.receivables[key];
    const item = itemId ? arState(state).items.find((i) => i.id === itemId) : undefined;
    const st = item ? itemStatus(state, item, asOf) : null;
    const received = st?.received ?? 0;
    const short = received > 0 && expected - received >= mat ? expected - received : 0;
    const ended = to < asOf;
    const status: ScanPeriod['status'] = !ended && !item ? 'accruing' : !item ? 'to_claim' : st!.status === 'closed' ? 'closed' : short ? 'short' : received >= expected ? 'received' : st!.status === 'overdue' ? 'overdue' : 'open';
    return { key, from, to, due: addDays(to, p.payDays), ended, units, qualifying, expected, itemId, itemExpected: item?.expected, received, short, status };
  });
}

/** Claim a period: create (or update) the Receivables rebate item with the scan-data expected amount. */
export function claimScanPeriod(books: Books, actor: User, programId: ID, key: string, asOf: string): ID {
  books.require(actor, 'inside.edit', 'claim scan-data rebates');
  const p = insideOf(books.state).scanPrograms.find((x) => x.id === programId);
  if (!p) throw errs(['That program no longer exists.']);
  const per = scanPeriods(books.state, programId, asOf).find((x) => x.key === key);
  if (!per) throw errs(['That period has no scan data.']);
  if (per.expected <= 0) throw errs(['Nothing qualifies in that period yet.']);
  const existing = per.itemId ? arState(books.state).items.find((i) => i.id === per.itemId) : undefined;
  const item = existing
    ? { ...existing, expected: per.expected }
    : { id: books.nextId('ar'), kind: 'rebate' as const, payer: p.manufacturer, storeId: p.storeIds.length === 1 ? p.storeIds[0] : books.state.stores.find((s) => s.kind === 'corporate')!.id, description: `${key} scan-data rebate`, expected: per.expected, expectedBy: per.due, incomeAccountId: 'acct_rebates', receipts: [], createdAt: books.clock() };
  saveReceivable(books, actor, item);
  p.receivables[key] = item.id;
  books.audit(actor, { action: 'claim', objectType: 'inside', objectId: p.id, summary: `${p.manufacturer} ${key}: expected ${formatMoney(per.expected, { dollarSign: true })} (receivable ${item.id})` });
  books.changed();
  return item.id;
}

/** Link a period to a rebate already on Receivables (instead of creating a second one). */
export function linkScanReceivable(books: Books, actor: User, programId: ID, key: string, itemId: ID): void {
  books.require(actor, 'inside.edit', 'link scan-data rebates');
  const p = insideOf(books.state).scanPrograms.find((x) => x.id === programId);
  if (!p) throw errs(['That program no longer exists.']);
  if (!arState(books.state).items.some((i) => i.id === itemId && i.kind === 'rebate')) throw errs(['Choose a rebate on Receivables.']);
  if (insideOf(books.state).scanPrograms.some((x) => Object.entries(x.receivables).some(([k, v]) => v === itemId && !(x.id === programId && k === key)))) throw errs(['That rebate is already linked to another period.']);
  p.receivables[key] = itemId;
  books.audit(actor, { action: 'link', objectType: 'inside', objectId: p.id, summary: `${p.manufacturer} ${key} linked to receivable ${itemId}` });
  books.changed();
}

// ── Lottery ──────────────────────────────────────────────────────────────
export type LotteryInput = Omit<LotteryWeek, 'id' | 'by' | 'at' | 'reviewed'>;

export function lotteryMath(w: Pick<LotteryWeek, 'instantSales' | 'onlineSales' | 'instantCashes' | 'onlinePayouts' | 'commission' | 'settlement' | 'posNet'>) {
  const sales = w.instantSales + w.onlineSales;
  const payouts = w.instantCashes + w.onlinePayouts;
  const due = sales - payouts - w.commission;
  const expectedCash = sales - payouts;
  return { sales, payouts, due, settlementDiff: w.settlement - due, expectedCash, variance: w.posNet - expectedCash };
}

export function isShortage(state: BooksState, w: LotteryWeek): boolean {
  return lotteryMath(w).variance <= -state.settings.materialityCents;
}

export function saveLotteryWeek(books: Books, actor: User, x: LotteryInput): LotteryWeek {
  books.require(actor, 'inside.log', 'enter lottery settlements');
  assertStore(actor, x.storeId);
  const e: string[] = [];
  if (!books.state.stores.some((s) => s.id === x.storeId && s.kind === 'operating')) e.push('Choose the store.');
  if (!isValidDate(x.weekEnding)) e.push('Enter the week-ending date as YYYY-MM-DD.');
  for (const [k, label] of [['instantSales', 'instant sales'], ['onlineSales', 'online sales'], ['instantCashes', 'instant cashes'], ['onlinePayouts', 'online payouts'], ['commission', 'commission']] as const) {
    if (!Number.isSafeInteger(x[k]) || x[k] < 0) e.push(`Enter ${label} in dollars, zero or more.`);
  }
  if (!Number.isSafeInteger(x.settlement)) e.push('Enter the settlement the lottery swept (negative if it paid us).');
  if (!Number.isSafeInteger(x.posNet)) e.push('Enter the lottery net from the register report.');
  if (e.length) throw errs(e);
  const ins = insideOf(books.state);
  let w = ins.lottery.find((y) => y.storeId === x.storeId && y.weekEnding === x.weekEnding);
  const before = w ? structuredClone(w) : undefined;
  if (w) Object.assign(w, x, { by: actor.id, at: books.clock(), reviewed: undefined });
  else ins.lottery.push((w = { ...x, id: books.nextId('lot'), by: actor.id, at: books.clock() }));
  const m = lotteryMath(w);
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'inside', objectId: w.id, summary: `Lottery ${codeOf(books.state, w.storeId)} week ending ${w.weekEnding}: settlement ${formatMoney(w.settlement, { dollarSign: true })}, register ${m.variance < 0 ? 'short' : 'over'} ${formatMoney(Math.abs(m.variance), { dollarSign: true })}`, before, after: structuredClone(w) });
  books.changed();
  return w;
}

export function reviewLotteryWeek(books: Books, actor: User, id: ID, note: string): void {
  books.require(actor, 'inside.edit', 'sign off lottery shortages');
  const w = insideOf(books.state).lottery.find((x) => x.id === id);
  if (!w) throw errs(['That lottery week no longer exists.']);
  if (!note.trim()) throw errs(['Say what you found (e.g. cashier short, written up).']);
  w.reviewed = { by: actor.id, at: books.clock(), note: note.trim() };
  books.audit(actor, { action: 'review', objectType: 'inside', objectId: w.id, summary: `Signed off lottery ${codeOf(books.state, w.storeId)} ${w.weekEnding}`, reason: note });
  books.changed();
}

/** Lottery commissions on the weeks ending in a month vs 4140 Lottery commissions in the ledger. */
export function lotteryCommissionTie(state: BooksState, storeIds: ID[], period: string): { weeks: Cents; ledger: Cents; ok: boolean } {
  const ids = new Set(storeIds);
  const weeks = insideOf(state).lottery.filter((w) => ids.has(w.storeId) && periodOf(w.weekEnding) === period).reduce((a, w) => a + w.commission, 0);
  const s = ledgerDeptSales(state, { storeIds: ids, from: periodFrom(period), to: lastDayOfPeriod(period) });
  const ledger = [...ids].reduce((a, id) => a + (s.get(`${id}|${D.lottery}`) ?? 0), 0);
  return { weeks, ledger, ok: weeks === ledger };
}

// ── Age-check audits ─────────────────────────────────────────────────────
export function logAgeCheck(books: Books, actor: User, x: Omit<AgeCheck, 'id' | 'by' | 'at' | 'resolved'>): AgeCheck {
  books.require(actor, 'inside.log', 'log age-check audits');
  assertStore(actor, x.storeId);
  const e: string[] = [];
  if (!isValidDate(x.date)) e.push('Enter the audit date as YYYY-MM-DD.');
  if (!books.state.stores.some((s) => s.id === x.storeId && s.kind === 'operating')) e.push('Choose the store.');
  if (!x.checkedBy.trim()) e.push('Say who ran the check (state compliance, mystery shopper, internal).');
  if (x.result === 'fail' && !x.followUp?.trim()) e.push('A failed check needs a follow-up (e.g. retrain the clerk, written warning).');
  if (x.followUpDue && !isValidDate(x.followUpDue)) e.push('Enter the follow-up due date as YYYY-MM-DD.');
  if (e.length) throw errs(e);
  const a: AgeCheck = { ...x, checkedBy: x.checkedBy.trim(), clerk: x.clerk?.trim() || undefined, note: x.note?.trim() || undefined, followUp: x.followUp?.trim() || undefined, id: books.nextId('age'), by: actor.id, at: books.clock() };
  insideOf(books.state).ageChecks.push(a);
  books.audit(actor, { action: 'create', objectType: 'inside', objectId: a.id, summary: `Age-check ${a.result} at ${codeOf(books.state, a.storeId)} ${a.date}`, after: structuredClone(a) });
  books.changed();
  return a;
}

export function resolveAgeCheck(books: Books, actor: User, id: ID, note: string): void {
  books.require(actor, 'inside.log', 'close age-check follow-ups');
  const a = insideOf(books.state).ageChecks.find((x) => x.id === id);
  if (!a) throw errs(['That audit no longer exists.']);
  assertStore(actor, a.storeId);
  if (!note.trim()) throw errs(['Say what was done.']);
  a.resolved = { by: actor.id, at: books.clock(), note: note.trim() };
  books.audit(actor, { action: 'resolve', objectType: 'inside', objectId: a.id, summary: `Follow-up done for age-check ${codeOf(books.state, a.storeId)} ${a.date}`, reason: note });
  books.changed();
}

export const openFollowUps = (state: BooksState, visible: Set<ID>) => insideOf(state).ageChecks.filter((a) => a.result === 'fail' && !a.resolved && visible.has(a.storeId));

// ── Inbox ────────────────────────────────────────────────────────────────
export interface InsideInboxItem { key: string; count: number; title: string; detail: string; to: string; action: string; review?: boolean }

/** The latest month with purchases or sales on or before today (the demo ends before today). */
export function insideMonth(state: BooksState, today: string): string {
  let last = '';
  for (const p of insideOf(state).posSales) if (p.date <= today && p.date > last) last = p.date;
  for (const t of state.transactions) if (!t.deleted && t.tags.includes('pos') && t.date <= today && t.date > last) last = t.date;
  return periodOf(last || today);
}

export function insideInbox(state: BooksState, visible: Set<ID>, today: string): InsideInboxItem[] {
  const ins = insideOf(state);
  if (!ins.counts.length && !ins.budgets.length && !ins.lottery.length && !ins.scanPrograms.length) return [];
  const ops = new Set(state.stores.filter((s) => s.kind === 'operating' && visible.has(s.id)).map((s) => s.id));
  const money = (n: number) => formatMoney(n, { dollarSign: true });
  const shrink = shrinkAlerts(state, ops);
  const month = insideMonth(state, today);
  const over = budgetStatus(state, month, [...ops]).filter((r) => r.over);
  const lottery = ins.lottery.filter((w) => ops.has(w.storeId) && !w.reviewed && isShortage(state, w));
  const seesCorp = visible.has(state.stores.find((s) => s.kind === 'corporate')?.id ?? '');
  const short = seesCorp ? ins.scanPrograms.flatMap((p) => scanPeriods(state, p.id, today).filter((x) => x.status === 'short').map((x) => ({ p, x }))) : [];
  const code = (id: ID) => codeOf(state, id);
  return [
    { key: 'shrink', count: shrink.length, title: 'Shrink over threshold', detail: shrink.length ? shrink.map((r) => `${code(r.storeId)} ${deptName(state, r.departmentId)} ${((r.shrinkPct ?? 0) * 100).toFixed(1)}% of sales (${money(r.shrink ?? 0)})`).join(', ') + ' on the latest count.' : 'Every department is inside its shrink threshold.', to: '/inside/inventory', action: 'Review' },
    { key: 'budget', count: over.length, title: 'Purchasing budget exceeded', detail: over.length ? over.map((r) => `${code(r.storeId)} ${deptName(state, r.departmentId)} over by ${money(-(r.remaining ?? 0))}`).join(', ') + '.' : 'Every store is inside its purchasing budget.', to: `/inside/budgets?month=${month}`, action: 'Review' },
    { key: 'lottery', count: lottery.length, title: 'Lottery shortages', detail: lottery.length ? lottery.map((w) => `${code(w.storeId)} week ending ${w.weekEnding} short ${money(-lotteryMath(w).variance)}`).join(', ') + '.' : 'Every lottery week balances.', to: '/inside/lottery?show=short', action: 'Review' },
    ...(seesCorp ? [{ key: 'scanshort', count: short.length, title: 'Scan-data rebates short-paid', detail: short.length ? short.map(({ p, x }) => `${p.manufacturer} ${x.key} short ${money(x.short)}`).join(', ') + '.' : 'Every scan-data payment matches the scan data.', to: '/inside/rebates', action: 'Follow up' }] : []),
  ];
}
