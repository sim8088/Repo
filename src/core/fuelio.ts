import { parseMoney } from './money';
import { parseDate, splitCsv } from './bankio';
import type { FuelGrade, FuelVendor, NoticeLineType } from './fuelTypes';

/**
 * File-upload fallbacks for the fuel importers: Craddock EFT notices, fuel invoices / BOLs and the
 * Comdata truck-stop summary. Each parser returns rows plus plain-sentence problems for rows it skipped.
 * Tab-separated text pasted from a spreadsheet works as well as CSV.
 */

function rowsOf(text: string): string[][] {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  if (first.includes('\t') && !first.includes(',')) return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t'));
  return splitCsv(text);
}

function header(rows: string[][], cols: Record<string, RegExp>, required: string[]): { idx: Record<string, number>; at: number } | null {
  const at = rows.findIndex((r) => required.every((k) => r.some((c) => cols[k].test(c.trim()))));
  if (at < 0) return null;
  const h = rows[at].map((c) => c.trim());
  const idx: Record<string, number> = {};
  for (const k of Object.keys(cols)) idx[k] = h.findIndex((x) => cols[k].test(x));
  return { idx, at };
}

const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');

function num(s: string): number | null {
  const t = s.replace(/[,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

// ── Craddock EFT notices ─────────────────────────────────────────────────
export interface ParsedNoticeLine {
  noticeNo: string;
  storeCode: string;
  noticeDate: string;
  type: NoticeLineType;
  processingDate?: string;
  description: string;
  invoiceNo?: string;
  amount: number;
}

const NOTICE_COLS: Record<string, RegExp> = {
  notice: /^(notice|notice ?#|notice no\.?|notice number|eft notice)$/i,
  store: /^(store|site|location|store code)$/i,
  noticeDate: /^(notice date|date)$/i,
  type: /^(type|line type|code)$/i,
  processing: /^(processing date|processed|batch date|process date)$/i,
  description: /^(description|memo|detail|details)$/i,
  invoice: /^(invoice|invoice ?#|invoice no\.?|reference)$/i,
  amount: /^(amount|net|net amount)$/i,
};

const TYPE_ALIASES: [RegExp, NoticeLineType][] = [
  [/^(cc_?proceeds|card proceeds|proceeds|credit card|card batch|batch)$/i, 'CC_PROCEEDS'],
  [/^(cc_?fee|card fees?|fees?|processing fee|discount fee)$/i, 'CC_FEE'],
  [/^(host_?discount|host discounts?|rewards?|loyalty)$/i, 'HOST_DISCOUNT'],
  [/^(fuel_?invoice|invoice|fuel)$/i, 'FUEL_INVOICE'],
  [/^(other|network|network fee|cybera|pos fee|pos network)$/i, 'OTHER'],
  [/^(bank_?draft|draft|ach draft|debit)$/i, 'BANK_DRAFT'],
  [/^(deposit|ach deposit|credit|payment)$/i, 'DEPOSIT'],
];

export function noticeType(s: string): NoticeLineType | null {
  const t = s.trim();
  for (const [re, ty] of TYPE_ALIASES) if (re.test(t)) return ty;
  return null;
}

/**
 * Sign rules: amounts are from our side (+ Craddock owes us, − we owe Craddock). Proceeds and drafts are
 * always +, fees, host discounts, invoices and deposits always −, whatever sign the file uses. OTHER keeps
 * the file's sign: a charge such as a Cybera fee is negative; a positive OTHER is a credit to us.
 */
export function signedNoticeAmount(type: NoticeLineType, raw: number): number {
  const a = Math.abs(raw);
  switch (type) {
    case 'CC_PROCEEDS':
    case 'BANK_DRAFT':
      return a;
    case 'OTHER':
      return raw;
    default:
      return -a;
  }
}

export function parseNoticeFile(text: string, fallback: { storeCode?: string; noticeNo?: string; noticeDate?: string } = {}): { lines: ParsedNoticeLine[]; problems: string[] } {
  const rows = rowsOf(text);
  const h = header(rows, NOTICE_COLS, ['type', 'amount']);
  if (!h) return { lines: [], problems: ['No header row found. The notice needs at least Type and Amount columns (and Notice, Store and Notice date, unless you fill them in above).'] };
  const { idx } = h;
  const problems: string[] = [];
  const lines: ParsedNoticeLine[] = [];
  for (let r = h.at + 1; r < rows.length; r++) {
    const row = rows[r];
    const n = r + 1;
    const type = noticeType(cell(row, idx.type));
    if (!type) { problems.push(`Row ${n}: "${cell(row, idx.type)}" isn't a line type. Use CC_PROCEEDS, CC_FEE, HOST_DISCOUNT, FUEL_INVOICE, OTHER, BANK_DRAFT or DEPOSIT.`); continue; }
    const raw = parseMoney(cell(row, idx.amount));
    if (raw === null) { problems.push(`Row ${n}: the amount isn't a number.`); continue; }
    const noticeNo = cell(row, idx.notice) || fallback.noticeNo || '';
    const storeCode = (cell(row, idx.store) || fallback.storeCode || '').toUpperCase();
    const dateRaw = cell(row, idx.noticeDate);
    const noticeDate = (dateRaw ? parseDate(dateRaw) : null) ?? fallback.noticeDate ?? '';
    if (!noticeNo || !storeCode || !noticeDate) { problems.push(`Row ${n}: needs a notice number, store and notice date.`); continue; }
    const procRaw = cell(row, idx.processing);
    const processingDate = procRaw ? parseDate(procRaw) ?? undefined : undefined;
    if (procRaw && !processingDate) { problems.push(`Row ${n}: "${procRaw}" isn't a processing date.`); continue; }
    lines.push({
      noticeNo, storeCode, noticeDate, type, processingDate, amount: signedNoticeAmount(type, raw),
      description: cell(row, idx.description) || type, invoiceNo: cell(row, idx.invoice) || undefined,
    });
  }
  if (!lines.length && !problems.length) problems.push('No notice lines found under the header.');
  return { lines, problems };
}

// ── Fuel invoices / BOLs ─────────────────────────────────────────────────
export interface ParsedInvoiceRow {
  supplier: FuelVendor;
  storeCode: string;
  invoiceNo?: string;
  bolNo: string;
  deliveredOn: string;
  dueOn: string;
  grade: Exclude<FuelGrade, 'plus'>;
  grossGallons: number;
  netGallons: number;
  cost: number;
  freight: number;
  taxes: number;
}

const INV_COLS: Record<string, RegExp> = {
  supplier: /^(supplier|vendor)$/i,
  store: /^(store|site|location|store code)$/i,
  invoice: /^(invoice|invoice ?#|invoice no\.?|invoice number)$/i,
  bol: /^(bol|bol ?#|bol no\.?|bill of lading)$/i,
  delivered: /^(delivered|delivery date|delivered on|date)$/i,
  due: /^(due|due date|due on)$/i,
  grade: /^(grade|product)$/i,
  gross: /^(gross|gross gal(lons)?)$/i,
  net: /^(net|net gal(lons)?)$/i,
  cost: /^(cost|product cost|amount)$/i,
  freight: /^(freight)$/i,
  taxes: /^(taxes|tax|excise)$/i,
};

export function gradeOf(s: string): FuelGrade | null {
  const t = s.trim().toLowerCase();
  if (/^(reg|regular|unl|unleaded|87)/.test(t)) return 'regular';
  if (/^(plus|mid|midgrade|89)/.test(t)) return 'plus';
  if (/^(prem|premium|super|91|93)/.test(t)) return 'premium';
  if (/^(diesel|ulsd|dsl|#2)/.test(t)) return 'diesel';
  return null;
}

export function parseInvoiceFile(text: string): { rows: ParsedInvoiceRow[]; problems: string[] } {
  const rows = rowsOf(text);
  const h = header(rows, INV_COLS, ['bol', 'grade', 'net']);
  if (!h) return { rows: [], problems: ['No header row found. Invoices need at least BOL, Grade and Net gallons columns, plus Supplier, Store, Invoice, Delivered, Due and Cost.'] };
  const { idx } = h;
  const out: ParsedInvoiceRow[] = [];
  const problems: string[] = [];
  for (let r = h.at + 1; r < rows.length; r++) {
    const row = rows[r];
    const n = r + 1;
    const sup = cell(row, idx.supplier).toLowerCase();
    const supplier: FuelVendor | null = /cradd/.test(sup) ? 'craddock' : /dash/.test(sup) ? 'dash' : null;
    if (!supplier) { problems.push(`Row ${n}: supplier must be Craddock or Dash.`); continue; }
    const grade = gradeOf(cell(row, idx.grade));
    if (!grade || grade === 'plus') { problems.push(`Row ${n}: grade must be Regular, Premium or Diesel (Plus is blended at the pump and is never delivered).`); continue; }
    const deliveredOn = parseDate(cell(row, idx.delivered));
    const dueOn = parseDate(cell(row, idx.due));
    if (!deliveredOn || !dueOn) { problems.push(`Row ${n}: needs a delivered date and a due date.`); continue; }
    const net = num(cell(row, idx.net));
    const gross = num(cell(row, idx.gross)) ?? net;
    if (net === null || net <= 0) { problems.push(`Row ${n}: net gallons must be a positive number.`); continue; }
    const money = (k: string) => { const v = cell(row, idx[k]); return v ? parseMoney(v) : 0; };
    const cost = money('cost');
    const freight = money('freight');
    const taxes = money('taxes');
    if (cost === null || freight === null || taxes === null) { problems.push(`Row ${n}: cost, freight and taxes must be amounts like 21,480.00.`); continue; }
    const bolNo = cell(row, idx.bol);
    if (!bolNo) { problems.push(`Row ${n}: every delivery needs its BOL number.`); continue; }
    out.push({ supplier, storeCode: cell(row, idx.store).toUpperCase(), invoiceNo: cell(row, idx.invoice) || undefined, bolNo, deliveredOn, dueOn, grade, grossGallons: gross ?? net, netGallons: net, cost, freight, taxes });
  }
  return { rows: out, problems };
}

// ── Comdata truck-stop summary ───────────────────────────────────────────
export interface ParsedComdataRow {
  date: string;
  storeCode: string;
  gallons: number;
  sales: number;
  transactions: number;
}

const COMDATA_COLS: Record<string, RegExp> = {
  date: /^(date|business date|sales date)$/i,
  store: /^(store|site|location|store code)$/i,
  gallons: /^(gallons|diesel gallons|gal)$/i,
  sales: /^(sales|amount|diesel sales|total)$/i,
  transactions: /^(transactions|count|txns|tickets)$/i,
};

export function parseComdataFile(text: string, fallbackStore = ''): { rows: ParsedComdataRow[]; problems: string[] } {
  const rows = rowsOf(text);
  const h = header(rows, COMDATA_COLS, ['date', 'gallons', 'sales']);
  if (!h) return { rows: [], problems: ['No header row found. The Comdata summary needs Date, Gallons and Sales columns.'] };
  const { idx } = h;
  const out: ParsedComdataRow[] = [];
  const problems: string[] = [];
  for (let r = h.at + 1; r < rows.length; r++) {
    const row = rows[r];
    const n = r + 1;
    const date = parseDate(cell(row, idx.date));
    const gallons = num(cell(row, idx.gallons));
    const sales = parseMoney(cell(row, idx.sales));
    if (!date) { problems.push(`Row ${n}: "${cell(row, idx.date)}" isn't a date.`); continue; }
    if (gallons === null || gallons < 0 || sales === null) { problems.push(`Row ${n}: gallons and sales must be numbers.`); continue; }
    out.push({ date, storeCode: (cell(row, idx.store) || fallbackStore).toUpperCase(), gallons, sales, transactions: Math.max(0, Math.round(num(cell(row, idx.transactions)) ?? 0)) });
  }
  return { rows: out, problems };
}
