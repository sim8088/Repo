import type { Books } from './books';
import { ValidationError } from './books';
import type { BooksState, ID, User } from './types';
import type { InsideBatch, KitchenState, MenuItemSale, SupplierInvoiceLine, WasteEntry, WasteReason } from './insideTypes';
import { daysBetween, isValidDate, lastDayOfPeriod, periodOf } from './dates';
import { formatMoney, parseMoney, type Cents } from './money';
import { parseDate } from './bankio';
import { D, assertStore, countAdjustments, csvCell, findHeader, insideOf, ledgerDeptSales, newInsideBatch, num, periodFrom, postedCounts, purchaseLines, purchasesByDept, tableRows } from './inside';
import { empCost, empHours, employee, weekIndex } from './payroll';

/**
 * Phase 7 — the kitchen.
 *
 * Food sales are the POS daily close on 4200. Food cost % = (purchases ± inventory change) ÷ food sales, where purchases
 * are what the inside-store mapping assigns to the Kitchen department (Sysco etc. on 5200) and the inventory change is
 * the Kitchen line of the store's inventory counts, which posts to 5200 too. So food cost always equals 5200 in the
 * ledger, and a month is only "measured" once it has a kitchen count near its end. Waste is already inside purchases:
 * the waste log explains how much of the cost % it is. Kitchen labor reads payroll's Kitchen department.
 */

export const FOOD_SALES = 'acct_sales_kitchen';
export const FOOD_COGS = 'acct_cogs_food';
export const DEFAULT_FOOD_TARGET_BPS = 3600;
export const WASTE_REASON_LABEL: Record<WasteReason, string> = { expired: 'Expired / out of date', overcooked: 'Overcooked / burnt', dropped: 'Dropped / spilled', quality: 'Quality (returned, off)', overproduction: 'Overproduction (end of day)', other: 'Other' };

export function emptyKitchen(): KitchenState {
  return { targets: {}, toleranceBps: 200, priceAlertBps: 500, topItems: 15, menu: [], waste: [], invoiceLines: [], batches: [], ackedPrices: {} };
}

/** The kitchen slice. Books saved before phase 7 have none; they get an empty one. */
export function kitchenOf(state: BooksState): KitchenState {
  if (!state.kitchen) state.kitchen = emptyKitchen();
  return state.kitchen;
}

const errs = (xs: string[]) => new ValidationError(xs);
const codeOf = (state: BooksState, id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;

export function kitchenStoreIds(state: BooksState, visible?: Set<ID>): ID[] {
  return state.stores.filter((s) => !s.deleted && s.kind === 'operating' && s.hasKitchen && (!visible || visible.has(s.id))).map((s) => s.id);
}
export function foodTarget(state: BooksState, storeId: ID): number {
  return kitchenOf(state).targets[storeId] ?? DEFAULT_FOOD_TARGET_BPS;
}
export function setFoodTarget(books: Books, actor: User, storeId: ID, bps: number): void {
  books.require(actor, 'inside.edit', 'set food cost targets');
  if (!Number.isInteger(bps) || bps <= 0 || bps >= 10000) throw errs(['Enter the target as a percent of food sales between 0 and 100, e.g. 34.5.']);
  const k = kitchenOf(books.state);
  const before = k.targets[storeId];
  k.targets[storeId] = bps;
  books.audit(actor, { action: 'update', objectType: 'kitchen', objectId: storeId, summary: `Food cost target ${codeOf(books.state, storeId)}: ${(bps / 100).toFixed(1)}%`, before, after: bps });
  books.changed();
}

// ── Food sales ───────────────────────────────────────────────────────────
export interface FoodDay { date: string; storeId: ID; sales: Cents; pos: Cents | null }

/** Food sales by store and day from the POS daily close (4200), with the POS import's kitchen department beside it. */
export function foodSalesByDay(state: BooksState, storeIds: ID[], from: string, to: string): FoodDay[] {
  const ids = new Set(storeIds);
  const m = new Map<string, FoodDay>();
  for (const t of state.transactions) {
    if (t.deleted || !t.tags.includes('pos') || t.date < from || t.date > to) continue;
    for (const l of t.lines) {
      if (l.accountId !== FOOD_SALES || !ids.has(l.storeId)) continue;
      const k = `${l.storeId}|${t.date}`;
      const d = m.get(k) ?? { date: t.date, storeId: l.storeId, sales: 0, pos: null };
      d.sales += l.credit - l.debit;
      m.set(k, d);
    }
  }
  for (const p of insideOf(state).posSales) {
    if (p.departmentId !== D.kitchen || !ids.has(p.storeId) || p.date < from || p.date > to) continue;
    const k = `${p.storeId}|${p.date}`;
    const d = m.get(k) ?? { date: p.date, storeId: p.storeId, sales: 0, pos: null };
    d.pos = (d.pos ?? 0) + p.sales;
    m.set(k, d);
  }
  return [...m.values()].sort((a, b) => b.date.localeCompare(a.date) || a.storeId.localeCompare(b.storeId));
}

export function ledgerFoodSales(state: BooksState, storeIds: ID[], from: string, to: string): Cents {
  const s = ledgerDeptSales(state, { storeIds, from, to });
  return storeIds.reduce((a, id) => a + (s.get(`${id}|${D.kitchen}`) ?? 0), 0);
}

// ── Menu mix (item-level import) ─────────────────────────────────────────
export interface ParsedMenuRow { row: number; storeCode: string; from: string; to: string; item: string; qty: number; sales: Cents }
const MENU_COLS: Record<string, RegExp> = {
  store: /^(store|site|location|store code)$/i,
  from: /^(from|start|period start|start date|date)$/i,
  to: /^(to|end|period end|end date|through)$/i,
  item: /^(item|menu item|item name|description|plu description)$/i,
  qty: /^(qty|quantity|sold|units|count|qty sold)$/i,
  sales: /^(sales|net sales|amount|total)$/i,
};

/** Read a POS item sales report: Item, Qty, Sales; Store / From / To columns optional (the form supplies them). */
export function parseMenuFile(text: string, fallback: { storeCode?: string; from?: string; to?: string } = {}): { rows: ParsedMenuRow[]; problems: string[] } {
  const rows = tableRows(text);
  const h = findHeader(rows, MENU_COLS, ['item', 'qty', 'sales']);
  if (!h) return { rows: [], problems: ['No header row found. The item report needs Item, Qty and Sales columns.'] };
  const { idx } = h;
  const out: ParsedMenuRow[] = [];
  const problems: string[] = [];
  for (let r = h.at + 1; r < rows.length; r++) {
    const row = rows[r];
    const item = csvCell(row, idx.item);
    if (!item || /^(grand )?totals?:?$/i.test(item)) continue;
    const from = (idx.from >= 0 && parseDate(csvCell(row, idx.from))) || fallback.from || '';
    const to = (idx.to >= 0 && parseDate(csvCell(row, idx.to))) || fallback.to || from;
    const storeCode = (csvCell(row, idx.store) || fallback.storeCode || '').toUpperCase();
    const qty = num(csvCell(row, idx.qty));
    const sales = parseMoney(csvCell(row, idx.sales));
    if (!from || !to) { problems.push(`Row ${r + 1}: no period. Add From/To columns or pick the dates above.`); continue; }
    if (!storeCode) { problems.push(`Row ${r + 1}: no store.`); continue; }
    if (qty === null || sales === null) { problems.push(`Row ${r + 1}: qty and sales must be numbers.`); continue; }
    out.push({ row: r + 1, storeCode, from, to, item, qty: Math.round(qty), sales });
  }
  return { rows: out, problems };
}

export const menuHash = (storeId: ID, from: string, to: string, item: string) => `${storeId}|${from}|${to}|${item.trim().toLowerCase()}`;

export interface MenuPreview {
  rows: (ParsedMenuRow & { storeId: ID; hash: string; status: 'new' | 'duplicate' | 'problem'; problem?: string })[];
  periods: { storeId: ID; from: string; to: string; file: Cents; ledger: Cents; ties: boolean }[];
  added: number;
  skipped: number;
}

export function previewMenuImport(state: BooksState, rows: ParsedMenuRow[]): MenuPreview {
  const have = new Set(kitchenOf(state).menu.map((m) => m.hash));
  const seen = new Set<string>();
  const out = rows.map((r) => {
    const s = state.stores.find((x) => x.code.toUpperCase() === r.storeCode && !x.deleted);
    const hash = menuHash(s?.id ?? r.storeCode, r.from, r.to, r.item);
    const problem = !s ? `Store "${r.storeCode}" isn't set up.` : !s.hasKitchen ? `${s.code} has no kitchen.` : r.to < r.from ? 'The period ends before it starts.' : seen.has(hash) ? 'Same item twice in this file.' : undefined;
    seen.add(hash);
    return { ...r, storeId: s?.id ?? '', hash, status: (problem ? 'problem' : have.has(hash) ? 'duplicate' : 'new') as 'new' | 'duplicate' | 'problem', problem };
  });
  const keys = [...new Set(out.filter((r) => r.storeId).map((r) => `${r.storeId}|${r.from}|${r.to}`))];
  const periods = keys.map((k) => {
    const [storeId, from, to] = k.split('|');
    const file = out.filter((r) => r.storeId === storeId && r.from === from && r.to === to).reduce((a, r) => a + r.sales, 0);
    const ledger = ledgerFoodSales(state, [storeId], from, to);
    return { storeId, from, to, file, ledger, ties: file === ledger };
  });
  const fresh = out.filter((r) => r.status === 'new');
  return { rows: out, periods, added: fresh.length, skipped: out.length - fresh.length };
}

/** Import the item sales report. Idempotent per store + period + item; batch id on every row. Nothing posts. */
export function commitMenuImport(books: Books, actor: User, file: { name: string; rows: ParsedMenuRow[] }, opts: { source?: InsideBatch['source'] } = {}): { batch: InsideBatch; rows: MenuItemSale[] } {
  books.require(actor, 'inside.edit', 'import menu mix');
  const k = kitchenOf(books.state);
  const p = previewMenuImport(books.state, file.rows);
  const batch = newInsideBatch(books, actor, k.batches, 'menu', file.name, p.added, p.skipped, opts.source ?? 'import');
  const rows = p.rows.filter((r) => r.status === 'new').map((r): MenuItemSale => ({ id: books.nextId('mi'), storeId: r.storeId, from: r.from, to: r.to, item: r.item.trim(), qty: r.qty, sales: r.sales, hash: r.hash, batchId: batch.id }));
  k.menu.push(...rows);
  books.audit(actor, { action: 'import', objectType: 'kitchen', objectId: batch.id, summary: `Imported ${file.name}: ${p.added} menu items, ${p.skipped} skipped` });
  books.changed();
  return { batch, rows };
}

export interface MenuMixRow { item: string; qty: number; sales: Cents; qtyShare: number; salesShare: number; avgPrice: Cents | null }
/** Items whose import period falls inside the range, ranked by sales. */
export function menuMix(state: BooksState, storeIds: ID[], from: string, to: string): { rows: MenuMixRow[]; sales: Cents; qty: number; periods: { storeId: ID; from: string; to: string; sales: Cents }[] } {
  const ids = new Set(storeIds);
  const xs = kitchenOf(state).menu.filter((m) => ids.has(m.storeId) && m.from >= from && m.to <= to);
  const by = new Map<string, { item: string; qty: number; sales: Cents }>();
  for (const m of xs) {
    const k = m.item.toLowerCase();
    const r = by.get(k) ?? { item: m.item, qty: 0, sales: 0 };
    r.qty += m.qty; r.sales += m.sales;
    by.set(k, r);
  }
  const sales = xs.reduce((a, m) => a + m.sales, 0);
  const qty = xs.reduce((a, m) => a + m.qty, 0);
  const pk = new Map<string, { storeId: ID; from: string; to: string; sales: Cents }>();
  for (const m of xs) {
    const k = `${m.storeId}|${m.from}|${m.to}`;
    const r = pk.get(k) ?? { storeId: m.storeId, from: m.from, to: m.to, sales: 0 };
    r.sales += m.sales;
    pk.set(k, r);
  }
  return {
    rows: [...by.values()].map((r) => ({ ...r, qtyShare: qty ? r.qty / qty : 0, salesShare: sales ? r.sales / sales : 0, avgPrice: r.qty ? Math.round(r.sales / r.qty) : null })).sort((a, b) => b.sales - a.sales),
    sales, qty, periods: [...pk.values()],
  };
}

// ── Waste log ────────────────────────────────────────────────────────────
export function logWaste(books: Books, actor: User, x: Omit<WasteEntry, 'id' | 'by' | 'at' | 'removed'>): WasteEntry {
  books.require(actor, 'inside.log', 'log kitchen waste');
  assertStore(actor, x.storeId);
  const e: string[] = [];
  if (!books.state.stores.some((s) => s.id === x.storeId && s.hasKitchen)) e.push('Choose a store with a kitchen.');
  if (!isValidDate(x.date)) e.push('Enter the date as YYYY-MM-DD.');
  if (!x.item.trim()) e.push('Say what was thrown away.');
  if (!(x.qty > 0)) e.push('Enter the quantity.');
  if (!Number.isSafeInteger(x.cost) || x.cost <= 0) e.push('Enter what it cost, in dollars.');
  if (!WASTE_REASON_LABEL[x.reason]) e.push('Choose a reason.');
  if (e.length) throw errs(e);
  const w: WasteEntry = { ...x, item: x.item.trim(), unit: x.unit.trim() || 'each', note: x.note?.trim() || undefined, id: books.nextId('wst'), by: actor.id, at: books.clock() };
  kitchenOf(books.state).waste.push(w);
  books.audit(actor, { action: 'create', objectType: 'kitchen', objectId: w.id, summary: `Waste ${codeOf(books.state, w.storeId)} ${w.date}: ${w.qty} ${w.unit} ${w.item}, ${formatMoney(w.cost, { dollarSign: true })}`, after: structuredClone(w) });
  books.changed();
  return w;
}

export function removeWaste(books: Books, actor: User, id: ID, reason: string): void {
  books.require(actor, 'inside.log', 'change the waste log');
  const w = kitchenOf(books.state).waste.find((x) => x.id === id);
  if (!w || w.removed) throw errs(['That entry is not in the log.']);
  assertStore(actor, w.storeId);
  if (!reason.trim()) throw errs(['Say why you are removing it.']);
  w.removed = { by: actor.id, at: books.clock(), reason: reason.trim() };
  books.audit(actor, { action: 'delete', objectType: 'kitchen', objectId: id, summary: `Removed waste entry ${w.item} ${w.date}`, reason });
  books.changed();
}

export function wasteEntries(state: BooksState, storeIds: ID[], from: string, to: string): WasteEntry[] {
  const ids = new Set(storeIds);
  return kitchenOf(state).waste.filter((w) => !w.removed && ids.has(w.storeId) && w.date >= from && w.date <= to).sort((a, b) => b.date.localeCompare(a.date));
}

// ── Kitchen labor ────────────────────────────────────────────────────────
/** Kitchen-department labor cost (gross + employer taxes + cash/check) for pay weeks whose Friday pay date is in the range. */
export function kitchenLabor(state: BooksState, storeIds: ID[], from: string, to: string, idx = weekIndex(state)): { cost: Cents; hours: number; people: number } {
  const ids = new Set(storeIds);
  let cost = 0;
  let hours = 0;
  const people = new Set<ID>();
  for (const [wk, m] of idx) {
    if (wk < from || wk > to) continue;
    for (const w of m.values()) {
      const e = employee(state, w.employeeId);
      if (!e || e.department !== 'kitchen' || !ids.has(e.storeId)) continue;
      cost += empCost(w);
      hours += empHours(w);
      people.add(e.id);
    }
  }
  return { cost, hours: Math.round(hours * 100) / 100, people: people.size };
}

// ── Food cost ────────────────────────────────────────────────────────────
export interface FoodCostRow {
  storeId: ID;
  period: string;
  from: string;
  to: string;
  sales: Cents;
  purchases: Cents;
  /** Kitchen inventory change from counts in the month (+ up, which lowers cost). */
  invChange: Cents;
  cost: Cents;
  pct: number | null;
  /** 5200 in the ledger for the store and month. */
  ledger: Cents;
  waste: Cents;
  wastePct: number | null;
  /** Food cost % with the logged waste taken out: what the menu would run at without it. */
  pctExWaste: number | null;
  /** A kitchen count was posted on or after the 25th, so the month's cost is measured, not just purchases. */
  counted: boolean;
  countDate: string | null;
  targetBps: number;
  outside: boolean;
  labor: Cents;
  laborHours: number;
  primePct: number | null;
}

export function foodCost(state: BooksState, storeId: ID, period: string, idx = weekIndex(state)): FoodCostRow {
  const from = periodFrom(period);
  const to = lastDayOfPeriod(period);
  const sales = ledgerFoodSales(state, [storeId], from, to);
  const purchases = purchasesByDept(purchaseLines(state, { storeIds: [storeId], from, to })).get(`${storeId}|${D.kitchen}`) ?? 0;
  const invChange = countAdjustments(state, from, to, [storeId]).get(`${storeId}|${D.kitchen}`) ?? 0;
  const cost = purchases - invChange;
  let ledger = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date < from || t.date > to) continue;
    for (const l of t.lines) if (l.accountId === FOOD_COGS && l.storeId === storeId) ledger += l.debit - l.credit;
  }
  const waste = wasteEntries(state, [storeId], from, to).reduce((a, w) => a + w.cost, 0);
  const count = postedCounts(state, storeId).filter((c) => c.date >= `${period}-25` && c.date <= to && c.lines.some((l) => l.departmentId === D.kitchen)).at(-1);
  const targetBps = foodTarget(state, storeId);
  const pct = sales > 0 ? cost / sales : null;
  const tol = kitchenOf(state).toleranceBps;
  const lab = kitchenLabor(state, [storeId], from, to, idx);
  return {
    storeId, period, from, to, sales, purchases, invChange, cost, pct, ledger, waste, wastePct: sales > 0 ? waste / sales : null, pctExWaste: sales > 0 ? (cost - waste) / sales : null,
    counted: !!count, countDate: count?.date ?? null, targetBps, outside: !!count && pct !== null && Math.abs(pct * 10000 - targetBps) > tol,
    labor: lab.cost, laborHours: lab.hours, primePct: sales > 0 ? (cost + lab.cost) / sales : null,
  };
}

/** Months with food sales for the stores, oldest first. */
export function foodMonths(state: BooksState, storeIds: ID[]): string[] {
  const ids = new Set(storeIds);
  const s = new Set<string>();
  for (const t of state.transactions) if (!t.deleted && t.tags.includes('pos') && t.lines.some((l) => l.accountId === FOOD_SALES && ids.has(l.storeId))) s.add(periodOf(t.date));
  return [...s].sort();
}

/** Stores whose latest measured (counted) month is outside target. */
export function foodCostAlerts(state: BooksState, storeIds: ID[]): FoodCostRow[] {
  const idx = weekIndex(state);
  const out: FoodCostRow[] = [];
  for (const id of storeIds) {
    const last = foodMonths(state, [id]).map((p) => foodCost(state, id, p, idx)).filter((r) => r.counted).at(-1);
    if (last?.outside) out.push(last);
  }
  return out;
}

// ── Supplier invoice lines and price alerts ──────────────────────────────
export interface ParsedInvoiceLine { row: number; vendor: string; storeCode: string; invoiceNo: string; date: string; itemCode?: string; description: string; unit?: string; qty: number; unitPrice: Cents; extended: Cents }
const LINE_COLS: Record<string, RegExp> = {
  vendor: /^(vendor|supplier|distributor)$/i,
  store: /^(store|ship to|location|store code|customer)$/i,
  invoice: /^(invoice|invoice ?#|invoice no\.?|inv ?#|invoice number)$/i,
  date: /^(date|invoice date|delivery date)$/i,
  code: /^(item ?#|item code|sku|supc|product code|item no\.?|code)$/i,
  description: /^(description|item description|product|product description|item)$/i,
  unit: /^(unit|pack|pack ?size|uom|pack\/size|size)$/i,
  qty: /^(qty|quantity|qty shipped|cases|shipped)$/i,
  price: /^(unit price|price|case price|each)$/i,
  extended: /^(extended|ext|extended price|amount|line total|total)$/i,
};

/** Read supplier invoice detail (Sysco, US Foods or any CSV with Invoice, Description, Qty, Price and Extended). */
export function parseInvoiceLines(text: string, fallback: { vendor?: string; storeCode?: string } = {}): { rows: ParsedInvoiceLine[]; problems: string[] } {
  const rows = tableRows(text);
  const h = findHeader(rows, LINE_COLS, ['invoice', 'description', 'qty', 'price']);
  if (!h) return { rows: [], problems: ['No header row found. Invoice detail needs Invoice, Description, Qty and Price columns (Extended, Item code, Date and Store help).'] };
  const { idx } = h;
  const out: ParsedInvoiceLine[] = [];
  const problems: string[] = [];
  for (let r = h.at + 1; r < rows.length; r++) {
    const row = rows[r];
    const n = r + 1;
    const invoiceNo = csvCell(row, idx.invoice);
    const description = csvCell(row, idx.description);
    if (!invoiceNo && !description) continue;
    if (/^(grand )?totals?:?$/i.test(invoiceNo) || /^(invoice )?totals?:?$/i.test(description)) continue;
    const date = parseDate(csvCell(row, idx.date));
    const qty = num(csvCell(row, idx.qty));
    const unitPrice = parseMoney(csvCell(row, idx.price));
    const ext = idx.extended >= 0 ? parseMoney(csvCell(row, idx.extended)) : null;
    if (!invoiceNo) { problems.push(`Row ${n}: no invoice number.`); continue; }
    if (!date) { problems.push(`Row ${n}: "${csvCell(row, idx.date)}" isn't a date.`); continue; }
    if (qty === null || unitPrice === null) { problems.push(`Row ${n}: qty and price must be numbers.`); continue; }
    const extended = ext ?? Math.round(qty * unitPrice);
    out.push({ row: n, vendor: csvCell(row, idx.vendor) || fallback.vendor || '', storeCode: (csvCell(row, idx.store) || fallback.storeCode || '').toUpperCase(), invoiceNo, date, itemCode: csvCell(row, idx.code) || undefined, description, unit: csvCell(row, idx.unit) || undefined, qty, unitPrice, extended });
  }
  return { rows: out, problems };
}

export function vendorByName(state: BooksState, name: string): ID | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  const ps = state.parties.filter((p) => !p.deleted && p.type !== 'owner');
  return (ps.find((p) => p.name.toLowerCase() === n) ?? ps.find((p) => p.name.toLowerCase().startsWith(n) || n.startsWith(p.name.toLowerCase())))?.id;
}

/** The ledger purchase that is this invoice: same vendor and store, the invoice total, within 7 days (nearest first). */
export function matchInvoiceTxn(state: BooksState, vendorId: ID, storeId: ID, date: string, total: Cents, taken = new Set<ID>()): ID | undefined {
  const name = state.parties.find((p) => p.id === vendorId)?.name.toUpperCase() ?? '';
  const cands = state.transactions.filter((t) => {
    if (t.deleted || taken.has(t.id) || Math.abs(daysBetween(t.date, date)) > 7) return false;
    if (t.partyId !== vendorId && !(name && t.description.toUpperCase().includes(name))) return false;
    const amt = t.lines.filter((l) => l.storeId === storeId && l.accountId.startsWith('acct_cogs')).reduce((a, l) => a + l.debit - l.credit, 0);
    return amt === total;
  });
  return cands.sort((a, b) => Math.abs(daysBetween(a.date, date)) - Math.abs(daysBetween(b.date, date)))[0]?.id;
}

export interface InvoiceLinePreview {
  rows: (ParsedInvoiceLine & { vendorId: ID; storeId: ID; hash: string; status: 'new' | 'duplicate' | 'problem'; problem?: string })[];
  invoices: { vendorId: ID; storeId: ID; invoiceNo: string; date: string; lines: number; total: Cents; txnId?: ID }[];
  added: number;
  skipped: number;
}

export const lineHash = (vendorId: ID, invoiceNo: string, n: number, code: string) => `${vendorId}|${invoiceNo.trim().toUpperCase()}|${n}|${code.trim().toLowerCase()}`;

export function previewInvoiceLines(state: BooksState, rows: ParsedInvoiceLine[]): InvoiceLinePreview {
  const have = new Set(kitchenOf(state).invoiceLines.map((l) => l.hash));
  const nth = new Map<string, number>();
  const out = rows.map((r) => {
    const vendorId = vendorByName(state, r.vendor) ?? '';
    const s = state.stores.find((x) => x.code.toUpperCase() === r.storeCode && !x.deleted);
    const ik = `${vendorId}|${r.invoiceNo.toUpperCase()}`;
    const n = (nth.get(ik) ?? 0) + 1;
    nth.set(ik, n);
    const hash = lineHash(vendorId || r.vendor, r.invoiceNo, n, r.itemCode ?? r.description);
    const problem = !vendorId ? `Vendor "${r.vendor}" isn't set up. Add it under Setup › Vendors & parties.` : !s ? `Store "${r.storeCode}" isn't set up.`
      : Math.abs(Math.round(r.qty * r.unitPrice) - r.extended) > 1 ? `Qty × price (${formatMoney(Math.round(r.qty * r.unitPrice), { dollarSign: true })}) doesn't equal the extended amount.` : undefined;
    return { ...r, vendorId, storeId: s?.id ?? '', hash, status: (problem ? 'problem' : have.has(hash) ? 'duplicate' : 'new') as 'new' | 'duplicate' | 'problem', problem };
  });
  const groups = new Map<string, InvoiceLinePreview['invoices'][number]>();
  for (const r of out) {
    if (!r.vendorId || !r.storeId) continue;
    const k = `${r.vendorId}|${r.storeId}|${r.invoiceNo}`;
    const g = groups.get(k) ?? { vendorId: r.vendorId, storeId: r.storeId, invoiceNo: r.invoiceNo, date: r.date, lines: 0, total: 0 };
    g.lines += 1; g.total += r.extended;
    groups.set(k, g);
  }
  const taken = new Set<ID>();
  for (const g of groups.values()) {
    g.txnId = matchInvoiceTxn(state, g.vendorId, g.storeId, g.date, g.total, taken);
    if (g.txnId) taken.add(g.txnId);
  }
  const fresh = out.filter((r) => r.status === 'new');
  return { rows: out, invoices: [...groups.values()], added: fresh.length, skipped: out.length - fresh.length };
}

export function commitInvoiceLines(books: Books, actor: User, file: { name: string; rows: ParsedInvoiceLine[] }, opts: { source?: InsideBatch['source'] } = {}): { batch: InsideBatch; lines: SupplierInvoiceLine[] } {
  books.require(actor, 'inside.edit', 'import supplier invoice detail');
  const k = kitchenOf(books.state);
  const p = previewInvoiceLines(books.state, file.rows);
  const batch = newInsideBatch(books, actor, k.batches, 'invoice_lines', file.name, p.added, p.skipped, opts.source ?? 'import');
  const lines = p.rows.filter((r) => r.status === 'new').map((r): SupplierInvoiceLine => ({
    id: books.nextId('sil'), vendorId: r.vendorId, storeId: r.storeId, invoiceNo: r.invoiceNo, date: r.date, itemCode: r.itemCode, description: r.description, unit: r.unit, qty: r.qty, unitPrice: r.unitPrice, extended: r.extended, hash: r.hash, batchId: batch.id,
  }));
  k.invoiceLines.push(...lines);
  books.audit(actor, { action: 'import', objectType: 'kitchen', objectId: batch.id, summary: `Imported ${file.name}: ${p.added} invoice lines, ${p.skipped} skipped` });
  books.changed();
  return { batch, lines };
}

export interface InvoiceSummary { vendorId: ID; storeId: ID; invoiceNo: string; date: string; lines: number; total: Cents; txnId?: ID }
/** Imported invoices with their totals and the ledger purchase each one is. */
export function invoiceSummaries(state: BooksState, storeIds: Set<ID>): InvoiceSummary[] {
  const groups = new Map<string, InvoiceSummary>();
  for (const l of kitchenOf(state).invoiceLines) {
    if (!storeIds.has(l.storeId)) continue;
    const k = `${l.vendorId}|${l.storeId}|${l.invoiceNo}`;
    const g = groups.get(k) ?? { vendorId: l.vendorId, storeId: l.storeId, invoiceNo: l.invoiceNo, date: l.date, lines: 0, total: 0 };
    g.lines += 1; g.total += l.extended;
    groups.set(k, g);
  }
  const xs = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
  const taken = new Set<ID>();
  for (const g of xs) {
    g.txnId = matchInvoiceTxn(state, g.vendorId, g.storeId, g.date, g.total, taken);
    if (g.txnId) taken.add(g.txnId);
  }
  return xs.reverse();
}

export interface PriceItem {
  key: string;
  vendorId: ID;
  itemCode: string;
  description: string;
  unit?: string;
  spend: Cents;
  qty: number;
  history: { date: string; invoiceNo: string; storeId: ID; unitPrice: Cents }[];
  latest: { date: string; unitPrice: Cents };
  /** First invoice at the current price. */
  changedOn: string;
  prior: { date: string; unitPrice: Cents } | null;
  change: number | null;
  top: boolean;
  alert: boolean;
  acked: boolean;
}

/** Price history per supplier item; the top items by spend alert when the latest price moved more than the threshold vs the price before. */
export function priceItems(state: BooksState, storeIds?: Set<ID>): PriceItem[] {
  const k = kitchenOf(state);
  const by = new Map<string, SupplierInvoiceLine[]>();
  for (const l of k.invoiceLines) {
    if (!l.itemCode || (storeIds && !storeIds.has(l.storeId))) continue;
    const key = `${l.vendorId}|${l.itemCode}`;
    by.set(key, [...(by.get(key) ?? []), l]);
  }
  const items: PriceItem[] = [...by].map(([key, ls]) => {
    const hist = [...ls].sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNo.localeCompare(b.invoiceNo));
    const last = hist.at(-1)!;
    // The price before the current one: the last invoice at a different price. The change dates from the first invoice at today's price.
    const pi = hist.map((h) => h.unitPrice !== last.unitPrice).lastIndexOf(true);
    const prior = pi >= 0 ? hist[pi] : null;
    const changedOn = pi >= 0 ? hist[pi + 1].date : hist[0].date;
    const change = prior && prior.unitPrice ? (last.unitPrice - prior.unitPrice) / prior.unitPrice : null;
    return {
      key, vendorId: last.vendorId, itemCode: last.itemCode!, description: last.description, unit: last.unit, spend: ls.reduce((a, l) => a + l.extended, 0), qty: ls.reduce((a, l) => a + l.qty, 0),
      history: hist.map((h) => ({ date: h.date, invoiceNo: h.invoiceNo, storeId: h.storeId, unitPrice: h.unitPrice })), latest: { date: last.date, unitPrice: last.unitPrice }, changedOn,
      prior: prior ? { date: prior.date, unitPrice: prior.unitPrice } : null, change, top: false, alert: false, acked: !!k.ackedPrices[`${key}|${changedOn}`],
    };
  }).sort((a, b) => b.spend - a.spend);
  items.forEach((it, i) => {
    it.top = i < k.topItems;
    it.alert = it.top && it.change !== null && Math.abs(it.change) * 10000 > k.priceAlertBps;
  });
  return items;
}

export function ackPriceAlert(books: Books, actor: User, key: string, changedOn: string, note?: string): void {
  books.require(actor, 'inside.edit', 'clear price alerts');
  kitchenOf(books.state).ackedPrices[`${key}|${changedOn}`] = { by: actor.id, at: books.clock(), note: note?.trim() || undefined };
  books.audit(actor, { action: 'review', objectType: 'kitchen', objectId: key, summary: `Price change on ${key} reviewed`, reason: note });
  books.changed();
}

export function setPriceAlert(books: Books, actor: User, x: { priceAlertBps: number; topItems: number }): void {
  books.require(actor, 'inside.edit', 'change price alert settings');
  if (!Number.isInteger(x.priceAlertBps) || x.priceAlertBps <= 0 || x.priceAlertBps > 10000) throw errs(['Enter the price change that alerts as a percent, e.g. 5.']);
  if (!Number.isInteger(x.topItems) || x.topItems < 1) throw errs(['Enter how many top items to watch.']);
  const k = kitchenOf(books.state);
  const before = { priceAlertBps: k.priceAlertBps, topItems: k.topItems };
  Object.assign(k, x);
  books.audit(actor, { action: 'update', objectType: 'kitchen', objectId: 'prices', summary: `Price alerts: over ${(x.priceAlertBps / 100).toFixed(1)}% on the top ${x.topItems} items`, before, after: x });
  books.changed();
}

// ── Inbox ────────────────────────────────────────────────────────────────
export function kitchenInbox(state: BooksState, visible: Set<ID>): { key: string; count: number; title: string; detail: string; to: string; action: string; review?: boolean }[] {
  const k = kitchenOf(state);
  const ids = kitchenStoreIds(state, visible);
  if (!ids.length || (!k.invoiceLines.length && !postedCounts(state).length)) return [];
  const fc = foodCostAlerts(state, ids);
  const jumps = priceItems(state, new Set(ids)).filter((i) => i.alert && !i.acked);
  const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);
  return [
    { key: 'foodcost', count: fc.length, title: 'Food cost outside target', detail: fc.length ? fc.map((r) => `${codeOf(state, r.storeId)} ${pct(r.pct)} in ${r.period} vs ${(r.targetBps / 100).toFixed(1)}% target`).join(', ') + '.' : 'Every kitchen is inside its food cost target for its latest counted month.', to: '/kitchen/food-cost', action: 'Review' },
    { key: 'pricejump', count: jumps.length, title: 'Supplier price changes', detail: jumps.length ? jumps.map((i) => `${i.description} ${i.change! > 0 ? '+' : ''}${(i.change! * 100).toFixed(1)}%`).join(', ') + ` vs the price before (over ${(k.priceAlertBps / 100).toFixed(0)}%).` : 'No top item moved more than the alert threshold.', to: '/kitchen/prices?show=alerts', action: 'Review' },
  ];
}

export const kitchenAsOf = (state: BooksState, today: string): string => {
  let last = '';
  for (const t of state.transactions) if (!t.deleted && t.tags.includes('pos') && t.date <= today && t.date > last) last = t.date;
  return last || today;
};
