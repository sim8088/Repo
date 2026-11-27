import type { Account, BooksState, ID, Party, Store } from './types';
import { addDays, dayOfWeek, isValidDate, lastDayOfPeriod, periodLabel, periodOf, shortDate } from './dates';
import { formatMoney } from './money';
import { normalSign } from './ledger';
import { bankStoreId } from './bank';
import { liveInvoices, invoiceFlags, salesRows } from './fuel';
import { apState, billTotal, isOpenAt, vendorName } from './payables';
import { icSummary } from './intercompany';

/**
 * Ask: plain-English questions answered straight from the books, with the rows that make up the answer as proof.
 * There is no language model here. A small set of patterns is recognised; the answer is always the sum of its proof
 * rows (so no number can appear that the data doesn't hold), and anything not understood or not on file comes back
 * as "missing" with what is needed and a phrasing that works.
 */

export type AskUnit = 'money' | 'gallons';

export interface ProofRow {
  date: string;
  ref?: string;
  txnId?: ID;
  /** Where the row opens (a transaction, bill, invoice or statement). */
  to?: string;
  description: string;
  store?: string;
  amount: number;
}

export interface AskAnswer {
  ok: true;
  intent: AskIntent;
  question: string;
  /** How the question was read: the filters actually applied. */
  reading: string;
  /** The answer in one sentence. */
  headline: string;
  figure: number;
  unit: AskUnit;
  amountLabel: string;
  proof: ProofRow[];
  /** The proof rows add to the figure (always true by construction; shown as the tie-out). */
  ties: boolean;
  notes: string[];
}

export interface AskMissing {
  ok: false;
  intent?: AskIntent;
  question: string;
  /** What is missing, in one sentence. */
  reason: string;
  missing: string[];
  suggestions: string[];
}

export type AskResult = AskAnswer | AskMissing;
export type AskIntent = 'paid' | 'outstanding' | 'gallons' | 'balance' | 'sales' | 'owes_us' | 'intercompany' | 'bills_due' | 'bills_past_due';

export const EXAMPLES = [
  'What did we pay Entergy for HM11 in October?',
  'Outstanding Craddock invoices as of yesterday',
  'Gallons sold this month at HM15 including Comdata',
  'Trustmark balance as of Oct 31',
  'Sales at HM13 last week',
  'Who owes us?',
  'Intercompany balances',
  'Bills due this week',
];

export interface AskContext {
  today: string;
  /** Store ids the person may see. Questions about other stores are refused, not answered. */
  visible?: Set<ID>;
}

// ── Reading the question ─────────────────────────────────────────────────
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthNo = (s: string) => MONTHS.findIndex((m) => m.startsWith(s.slice(0, 3))) + 1;
const pad = (n: number) => String(n).padStart(2, '0');

export interface DateRange { from: string; to: string; label: string }

/** Monday-to-Sunday week containing the date. */
export function weekOf(date: string): DateRange {
  const dow = dayOfWeek(date);
  const from = addDays(date, dow === 0 ? -6 : 1 - dow);
  const to = addDays(from, 6);
  return { from, to, label: `the week of ${shortDate(from)} – ${shortDate(to)}` };
}

function monthRange(p: string): DateRange {
  return { from: `${p}-01`, to: lastDayOfPeriod(p), label: periodLabel(p) };
}

/** The most recent year in which month `m` has started by `today`. */
function yearFor(m: number, today: string): number {
  const y = Number(today.slice(0, 4));
  return m <= Number(today.slice(5, 7)) ? y : y - 1;
}

/** A period phrase: this/last week, this/last month, a month name (with optional year), today, yesterday, YTD. */
export function parseRange(q: string, today: string): DateRange | null {
  const s = q.toLowerCase();
  if (/\bthis week\b/.test(s)) return { ...weekOf(today), label: `this week (${shortDate(weekOf(today).from)} – ${shortDate(weekOf(today).to)})` };
  if (/\blast week\b/.test(s)) { const w = weekOf(addDays(weekOf(today).from, -1)); return { ...w, label: `last week (${shortDate(w.from)} – ${shortDate(w.to)})` }; }
  if (/\bnext week\b/.test(s)) { const w = weekOf(addDays(weekOf(today).to, 1)); return { ...w, label: `next week (${shortDate(w.from)} – ${shortDate(w.to)})` }; }
  if (/\b(this month|month to date|mtd)\b/.test(s)) { const p = periodOf(today); return { from: `${p}-01`, to: today, label: `this month (${periodLabel(p)} to ${shortDate(today)})` }; }
  if (/\blast month\b/.test(s)) { const p = periodOf(addDays(`${periodOf(today)}-01`, -1)); return { ...monthRange(p), label: `last month (${periodLabel(p)})` }; }
  if (/\b(this year|year to date|ytd)\b/.test(s)) return { from: `${today.slice(0, 4)}-01-01`, to: today, label: `this year to ${shortDate(today)}` };
  if (/\byesterday\b/.test(s)) { const d = addDays(today, -1); return { from: d, to: d, label: `yesterday (${shortDate(d)})` }; }
  if (/\btoday\b/.test(s)) return { from: today, to: today, label: `today (${shortDate(today)})` };
  const iso = s.match(/\b(\d{4})-(\d{2})\b(?!-)/);
  if (iso) return monthRange(`${iso[1]}-${iso[2]}`);
  const mm = s.match(new RegExp(`\\b(?:in|for|during|of)?\\s*${MON_RE}\\b(?:\\s+(\\d{4}))?(?!\\s*\\d{1,2}\\b)`));
  if (mm) {
    const m = monthNo(mm[1]);
    const y = mm[2] ? Number(mm[2]) : yearFor(m, today);
    return monthRange(`${y}-${pad(m)}`);
  }
  return null;
}

/** A single date: today, yesterday, ISO, m/d[/y], "Oct 31[, 2026]", "31 October", "end of October", "end of last month". */
export function parseDate(q: string, today: string): { date: string; label: string } | null {
  const s = q.toLowerCase();
  if (/\byesterday\b/.test(s)) return { date: addDays(today, -1), label: `yesterday (${shortDate(addDays(today, -1))})` };
  if (/\b(today|now|right now)\b/.test(s)) return { date: today, label: `today (${shortDate(today)})` };
  if (/\bend of last month\b/.test(s)) { const d = addDays(`${periodOf(today)}-01`, -1); return { date: d, label: shortDate(d) }; }
  const iso = s.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && isValidDate(iso[1])) return { date: iso[1], label: shortDate(iso[1]) };
  const us = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (us) {
    const m = Number(us[1]); const d = Number(us[2]);
    const y = us[3] ? (us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3])) : yearFor(m, today);
    const date = `${y}-${pad(m)}-${pad(d)}`;
    if (isValidDate(date)) return { date, label: shortDate(date) };
  }
  const md = s.match(new RegExp(`\\b${MON_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`));
  if (md) {
    const m = monthNo(md[1]);
    const date = `${md[3] ? Number(md[3]) : yearFor(m, today)}-${pad(m)}-${pad(Number(md[2]))}`;
    if (isValidDate(date)) return { date, label: shortDate(date) };
  }
  const dm = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON_RE}(?:,?\\s+(\\d{4}))?\\b`));
  if (dm) {
    const m = monthNo(dm[2]);
    const date = `${dm[3] ? Number(dm[3]) : yearFor(m, today)}-${pad(m)}-${pad(Number(dm[1]))}`;
    if (isValidDate(date)) return { date, label: shortDate(date) };
  }
  const eom = s.match(new RegExp(`\\bend of ${MON_RE}(?:\\s+(\\d{4}))?\\b`));
  if (eom) {
    const m = monthNo(eom[1]);
    const d = lastDayOfPeriod(`${eom[2] ? Number(eom[2]) : yearFor(m, today)}-${pad(m)}`);
    return { date: d, label: shortDate(d) };
  }
  return null;
}

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9&' ]+/g, ' ').split(/\s+/).filter(Boolean);
}

/** Stores named in the question, by code (HM11) or name (Gluckstadt). */
export function findStores(state: BooksState, q: string): Store[] {
  const s = ` ${q.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `;
  return state.stores.filter((x) => !x.deleted && (s.includes(` ${x.code.toLowerCase()} `) || s.includes(` ${x.name.toLowerCase()} `) || (x.kind === 'corporate' && / corporate /.test(s))));
}

const STOP = new Set(['the', 'a', 'an', 'we', 'us', 'our', 'did', 'do', 'does', 'what', 'how', 'much', 'pay', 'paid', 'to', 'for', 'in', 'at', 'of', 'on', 'from', 'by', 'company', 'inc', 'llc', 'co', 'and']);

/** The best-matching party for a phrase: every significant word of the phrase in the name, or the name's first word in the phrase. */
export function findParty(state: BooksState, phrase: string): Party | null {
  const ws = words(phrase).filter((w) => !STOP.has(w) && w.length > 1);
  if (!ws.length) return null;
  let best: { p: Party; score: number } | null = null;
  for (const p of state.parties) {
    if (p.deleted) continue;
    const name = words(p.name);
    const hits = ws.filter((w) => name.some((n) => n === w || (w.length >= 4 && n.startsWith(w)) || (n.length >= 4 && w.startsWith(n)))).length;
    if (!hits) continue;
    const score = hits / ws.length + hits / name.length;
    if (!best || score > best.score) best = { p, score };
  }
  return best && best.score >= 0.6 ? best.p : null;
}

const ACCOUNT_ALIASES: [RegExp, ID][] = [
  [/\b(bank|operating account|checking)\b/, 'acct_trustmark'],
  [/\b(ap|a\/p|accounts payable|payables)\b/, 'acct_ap'],
  [/\b(prepaids?|prepaid expenses)\b/, 'acct_prepaid'],
  [/\b(loc|line of credit|credit line)\b/, 'acct_loc'],
  [/\b(sales tax)\b/, 'acct_sales_tax'],
  [/\b(accumulated depreciation)\b/, 'acct_accum_dep'],
  [/\b(cash at hq|cash in transit)\b/, 'acct_cash_transit'],
  [/\b(cash on hand|register cash)\b/, 'acct_cash_registers'],
];

/** The account a question names: by number, by an alias, or by the words of its name. */
export function findAccount(state: BooksState, phrase: string): Account | null {
  const s = phrase.toLowerCase();
  const num = s.match(/\b(\d{4})\b/);
  if (num) { const a = state.accounts.find((x) => x.number === num[1]); if (a) return a; }
  const ws = words(s).filter((w) => !STOP.has(w) && !['balance', 'as', 'what', 'is', 'whats', "what's", 'account', 'show', 'me', 'current', 'end', 'yesterday', 'today', ...MONTHS].includes(w) && !/^\d+$/.test(w));
  let best: { a: Account; score: number } | null = null;
  for (const a of state.accounts) {
    if (!a.active) continue;
    const name = words(a.name);
    const hits = ws.filter((w) => w.length > 2 && name.some((n) => n === w || (w.length >= 4 && n.startsWith(w)))).length;
    if (!hits) continue;
    const score = hits / Math.max(ws.length, 1) + hits / name.length;
    if (!best || score > best.score) best = { a, score };
  }
  if (best && best.score >= 0.75) return best.a;
  for (const [re, id] of ACCOUNT_ALIASES) if (re.test(s)) return state.accounts.find((a) => a.id === id) ?? null;
  return best?.a ?? null;
}

// ── Answers ──────────────────────────────────────────────────────────────
const money = (c: number) => formatMoney(c, { dollarSign: true });
const gal = (n: number) => `${n.toLocaleString('en-US')} gal`;

function answer(intent: AskIntent, question: string, x: Omit<AskAnswer, 'ok' | 'intent' | 'question' | 'figure' | 'ties' | 'headline'> & { headline: (figure: number) => string }): AskAnswer {
  const figure = x.proof.reduce((a, r) => a + r.amount, 0);
  return { ok: true, intent, question, ...x, figure, headline: x.headline(figure), ties: true, notes: x.notes };
}

function missing(question: string, reason: string, missingList: string[], suggestions: string[], intent?: AskIntent): AskMissing {
  return { ok: false, intent, question, reason, missing: missingList, suggestions: suggestions.length ? suggestions : EXAMPLES.slice(0, 3) };
}

/** First and last dates the ledger has activity on (opening balances aside). */
function ledgerBounds(state: BooksState): { first: string; last: string } | null {
  let first = '';
  let last = '';
  for (const t of state.transactions) {
    if (t.deleted || t.kind === 'opening') continue;
    if (!first || t.date < first) first = t.date;
    if (!last || t.date > last) last = t.date;
  }
  return first ? { first, last } : null;
}

function outOfRange(state: BooksState, r: DateRange): string | null {
  const b = ledgerBounds(state);
  if (!b) return 'There are no transactions in the books yet.';
  if (r.from > b.last) return `The books run through ${shortDate(b.last)}; nothing is recorded for ${r.label} yet.`;
  if (r.to < b.first) return `The books start on ${shortDate(b.first)}; ${r.label} is before them.`;
  return null;
}

const MONEY_SUBTYPES = new Set(['bank', 'cash']);

function storeCode(state: BooksState, id: ID): string {
  return state.stores.find((s) => s.id === id)?.code ?? '';
}

function deniedStores(ctx: AskContext, stores: Store[]): Store[] {
  return ctx.visible ? stores.filter((s) => !ctx.visible!.has(s.id)) : [];
}

function seesCorp(state: BooksState, ctx: AskContext): boolean {
  return !ctx.visible || ctx.visible.has(bankStoreId(state));
}

function askPaid(state: BooksState, q: string, ctx: AskContext): AskResult {
  const m = q.match(/\b(?:pay|paid)\s+(?:to\s+)?(.+?)(?=\s+(?:for|at|in|during|on|this|last|from|between)\b|[?.!]|$)/i);
  const phrase = m?.[1] ?? '';
  const party = findParty(state, phrase);
  const stores = findStores(state, q).filter((s) => !new RegExp(`\\b${s.code}\\b`, 'i').test(phrase));
  const range = parseRange(q, ctx.today);
  const sugg = ['What did we pay Entergy for HM11 in October?', 'What did we pay Sysco in November?'];
  if (!party) return missing(q, phrase ? `I can't find a vendor or party called "${phrase.trim()}".` : 'I need to know who was paid.', [phrase ? `A vendor or party matching "${phrase.trim()}" (add it in Setup › Vendors & parties, or check the spelling)` : 'The vendor or party'], sugg, 'paid');
  if (!range) return missing(q, `I need the period: which month or week did we pay ${party.name}?`, ['A period, such as "in October", "last month" or "this week"'], [`What did we pay ${party.name} last month?`], 'paid');
  const denied = deniedStores(ctx, stores);
  if (denied.length) return missing(q, `Your role doesn't include ${denied.map((s) => s.code).join(', ')}.`, ['Access to that store'], [], 'paid');
  if (!seesCorp(state, ctx)) return missing(q, "Payments go out of the company bank account, which your role doesn't include.", ['Access to Corporate banking'], [], 'paid');
  const oor = outOfRange(state, range);
  if (oor) return missing(q, oor, [`Transactions for ${range.label}`], sugg, 'paid');
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const want = new Set(stores.map((s) => s.id));
  const proof: ProofRow[] = [];
  let total = 0;
  const elsewhere = new Map<string, number>();
  for (const t of state.transactions) {
    if (t.deleted || t.date < range.from || t.date > range.to) continue;
    if (t.partyId !== party.id && !t.lines.some((l) => l.partyId === party.id)) continue;
    const out = t.lines.filter((l) => !l.system && MONEY_SUBTYPES.has(acc.get(l.accountId)?.subtype ?? '')).reduce((a, l) => a + l.credit - l.debit, 0);
    if (out <= 0) continue;
    total += out;
    const cat = t.lines.filter((l) => !l.system && !MONEY_SUBTYPES.has(acc.get(l.accountId)?.subtype ?? ''));
    if (!want.size) {
      proof.push({ date: t.date, ref: t.ref, txnId: t.id, to: `/books/transactions/${t.id}`, description: t.description, store: [...new Set(cat.map((l) => storeCode(state, l.storeId)))].join(', '), amount: out });
      continue;
    }
    const here = cat.filter((l) => want.has(l.storeId)).reduce((a, l) => a + l.debit - l.credit, 0);
    for (const l of cat.filter((x) => !want.has(x.storeId))) elsewhere.set(storeCode(state, l.storeId), (elsewhere.get(storeCode(state, l.storeId)) ?? 0) + l.debit - l.credit);
    if (here) proof.push({ date: t.date, ref: t.ref, txnId: t.id, to: `/books/transactions/${t.id}`, description: t.description, store: stores.map((s) => s.code).join(', '), amount: here });
  }
  proof.sort((a, b) => a.date.localeCompare(b.date));
  const where = stores.length ? ` for ${stores.map((s) => s.code).join(' and ')}` : '';
  const notes: string[] = [];
  if (stores.length && total) {
    const other = [...elsewhere].filter(([, v]) => v).map(([k, v]) => `${k} ${money(v)}`);
    notes.push(`All payments to ${party.name} in ${range.label}: ${money(total)}.${other.length ? ` The rest was charged to ${other.join(', ')}.` : ''}`);
  }
  if (!total) notes.push(`No money went out to ${party.name} in ${range.label}.`);
  return answer('paid', q, {
    reading: `Money out of the bank or cash to ${party.name}${where}, dated ${shortDate(range.from)} – ${shortDate(range.to)}${stores.length ? `, counting only the lines charged to ${stores.map((s) => s.code).join(' and ')}` : ''}.`,
    headline: (f) => (proof.length ? `We paid ${party.name} ${money(f)}${where} in ${range.label}, in ${proof.length} payment${proof.length === 1 ? '' : 's'}.` : `We paid ${party.name} nothing${where} in ${range.label}.`),
    unit: 'money', amountLabel: 'Paid', proof, notes,
  });
}

function askOutstanding(state: BooksState, q: string, ctx: AskContext): AskResult {
  const asOf = parseDate(q, ctx.today) ?? { date: ctx.today, label: `today (${shortDate(ctx.today)})` };
  const m = q.match(/(?:outstanding|open|unpaid)\s+(.+?)\s+(?:invoices?|bills?)/i) ?? q.match(/(?:invoices?|bills?)\s+(?:from|for|to)\s+(.+?)(?=\s+(?:as of|at|on|outstanding|open|unpaid)\b|[?.!]|$)/i);
  const phrase = m?.[1] ?? '';
  const sugg = ['Outstanding Craddock invoices as of yesterday', 'Outstanding Dash invoices as of Nov 20'];
  const vendor = /craddock/i.test(phrase) ? 'craddock' : /\bdash\b/i.test(phrase) ? 'dash' : null;
  const fuelVis = (storeId: ID) => !ctx.visible || ctx.visible.has(storeId);
  if (vendor) {
    const flags = invoiceFlags(state, asOf.date);
    const list = liveInvoices(state).filter((i) => i.supplier === vendor && fuelVis(i.storeId) && i.deliveredOn <= asOf.date && !flags.get(i.id)?.duplicateOf);
    const open = list.filter((i) => i.invoiceNo && (!i.settlement || i.settlement.on > asOf.date));
    const bolOnly = list.filter((i) => !i.invoiceNo);
    const name = vendor === 'craddock' ? 'Craddock' : 'Dash Oil';
    if (!list.length) return missing(q, `No ${name} deliveries are on file through ${asOf.label}.`, [`${name} invoices or BOLs dated on or before ${shortDate(asOf.date)}`], sugg, 'outstanding');
    const proof = open.sort((a, b) => a.deliveredOn.localeCompare(b.deliveredOn)).map((i): ProofRow => ({
      date: i.deliveredOn, ref: i.invoiceNo, to: `/fuel/invoices?q=${encodeURIComponent(i.invoiceNo!)}`, description: `Invoice ${i.invoiceNo} · BOL ${i.bolNo} · due ${shortDate(i.dueOn)}`, store: storeCode(state, i.storeId), amount: i.total,
    }));
    const notes = [vendor === 'craddock' ? 'Craddock invoices are paid when an EFT notice nets them; Dash invoices from Dash clearing on their due date.' : 'Dash invoices are paid out of Dash clearing on their due date.'];
    if (bolOnly.length) notes.push(`${bolOnly.length} deliver${bolOnly.length === 1 ? 'y has' : 'ies have'} a BOL but no invoice yet (${bolOnly.map((i) => `BOL ${i.bolNo}`).join(', ')}), so ${bolOnly.length === 1 ? 'it is' : 'they are'} not counted.`);
    return answer('outstanding', q, {
      reading: `${name} fuel invoices delivered on or before ${shortDate(asOf.date)} and not yet settled by then (duplicates left out).`,
      headline: (f) => (proof.length ? `${proof.length} ${name} invoice${proof.length === 1 ? '' : 's'} totalling ${money(f)} ${proof.length === 1 ? 'was' : 'were'} outstanding as of ${asOf.label}.` : `No ${name} invoices were outstanding as of ${asOf.label}.`),
      unit: 'money', amountLabel: 'Invoice total', proof, notes,
    });
  }
  const party = findParty(state, phrase);
  if (!party) return missing(q, phrase ? `I can't find a supplier called "${phrase.trim()}".` : 'I need to know whose invoices.', ['A supplier name (Craddock, Dash, or a vendor in Setup › Vendors & parties)'], sugg, 'outstanding');
  const bills = apState(state).bills.filter((b) => b.vendorId === party.id && (!ctx.visible || ctx.visible.has(b.storeId)));
  if (!bills.length) return missing(q, `No bills from ${party.name} are entered in Payables.`, [`${party.name} bills (enter them in Payables › Bills)`], sugg, 'outstanding');
  const open = bills.filter((b) => isOpenAt(b, asOf.date)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const drafts = bills.filter((b) => b.status === 'draft' && b.billDate <= asOf.date);
  const proof = open.map((b): ProofRow => ({ date: b.billDate, ref: b.ref, txnId: b.approved?.txnId, to: `/payables/bills/${b.id}`, description: `${vendorName(state, b.vendorId)} ${b.invoiceNo} · due ${shortDate(b.dueDate)}`, store: storeCode(state, b.storeId), amount: billTotal(b) }));
  return answer('outstanding', q, {
    reading: `Approved ${party.name} bills dated on or before ${shortDate(asOf.date)} and not paid by then.`,
    headline: (f) => (proof.length ? `${proof.length} ${party.name} bill${proof.length === 1 ? '' : 's'} totalling ${money(f)} ${proof.length === 1 ? 'was' : 'were'} outstanding as of ${asOf.label}.` : `Nothing from ${party.name} was outstanding as of ${asOf.label}.`),
    unit: 'money', amountLabel: 'Bill total', proof,
    notes: drafts.length ? [`${drafts.length} more ${drafts.length === 1 ? 'bill is' : 'bills are'} awaiting approval and not counted.`] : [],
  });
}

function askGallons(state: BooksState, q: string, ctx: AskContext): AskResult {
  const stores = findStores(state, q);
  const range = parseRange(q, ctx.today);
  const sugg = ['Gallons sold this month at HM15 including Comdata', 'Gallons sold last month at HM11'];
  if (!range) return missing(q, 'I need the period for the gallons.', ['A period, such as "this month", "last week" or "in October"'], sugg, 'gallons');
  const denied = deniedStores(ctx, stores);
  if (denied.length) return missing(q, `Your role doesn't include ${denied.map((s) => s.code).join(', ')}.`, ['Access to that store'], [], 'gallons');
  const excl = /\b(excluding|without|not including|minus)\s+(the\s+)?(comdata|truck)/i.test(q);
  const ids = stores.length ? stores.map((s) => s.id) : state.stores.filter((s) => s.kind === 'operating' && (!ctx.visible || ctx.visible.has(s.id))).map((s) => s.id);
  const all = salesRows(state, { storeIds: ids });
  if (!all.length) return missing(q, `No fuel sales are recorded for ${stores.map((s) => s.code).join(', ') || 'any store'}.`, ['Daily fuel sales from the POS'], sugg, 'gallons');
  const lastDay = all.reduce((a, r) => (r.date > a ? r.date : a), '');
  const firstDay = all.reduce((a, r) => (!a || r.date < a ? r.date : a), '');
  if (range.from > lastDay) return missing(q, `Fuel sales on file run through ${shortDate(lastDay)}; nothing is recorded for ${range.label} yet.`, [`Fuel sales for ${range.label}`], sugg, 'gallons');
  if (range.to < firstDay) return missing(q, `Fuel sales on file start ${shortDate(firstDay)}; ${range.label} is before them.`, [`Fuel sales for ${range.label}`], sugg, 'gallons');
  const rows = all.filter((r) => r.date >= range.from && r.date <= range.to && (!excl || r.lane === 'store'));
  const sales = state.fuel?.sales ?? [];
  const byKey = new Map<string, ProofRow>();
  for (const r of rows) {
    const k = `${r.date}|${r.storeId}|${r.lane}`;
    let p = byKey.get(k);
    if (!p) {
      const txnId = r.lane === 'store' ? sales.find((s) => s.storeId === r.storeId && s.date === r.date && s.txnId)?.txnId : undefined;
      const t = txnId ? state.transactions.find((x) => x.id === txnId) : undefined;
      p = { date: r.date, ref: t?.ref, txnId, to: t ? `/books/transactions/${t.id}` : r.lane === 'truck' ? '/fuel/truck' : '/fuel?view=day', description: r.lane === 'truck' ? 'Comdata truck-lane summary (diesel)' : t ? `${t.description} (fuel by grade)` : 'POS fuel sales', store: storeCode(state, r.storeId), amount: 0 };
      byKey.set(k, p);
    }
    p.amount += r.gallons;
  }
  const proof = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.store ?? '').localeCompare(b.store ?? ''));
  const truck = rows.filter((r) => r.lane === 'truck').reduce((a, r) => a + r.gallons, 0);
  const hasTruckLane = ids.some((id) => state.stores.find((s) => s.id === id)?.hasTruckLane);
  const notes: string[] = [];
  if (!excl && hasTruckLane) notes.push(`Includes ${gal(truck)} of truck-lane diesel from the Comdata summary (kept apart from the POS).`);
  if (excl) notes.push('Truck-lane (Comdata) gallons are left out, as asked.');
  if (range.to > lastDay) notes.push(`Fuel sales on file run through ${shortDate(lastDay)}.`);
  const where = stores.length ? ` at ${stores.map((s) => s.code).join(' and ')}` : ' across all stores';
  return answer('gallons', q, {
    reading: `Gallons sold${where}, ${shortDate(range.from)} – ${shortDate(range.to)}: store POS fuel sales by day${excl ? '' : ' plus the Comdata truck lane'}.`,
    headline: (f) => `${gal(f)} sold${where} ${range.label}${!excl && hasTruckLane ? ', including Comdata' : ''}.`,
    unit: 'gallons', amountLabel: 'Gallons', proof, notes,
  });
}

function askBalance(state: BooksState, q: string, ctx: AskContext): AskResult {
  const asOf = parseDate(q, ctx.today) ?? { date: ctx.today, label: `today (${shortDate(ctx.today)})` };
  const head = q.replace(/\b(as of|as at|at|on)\b.*$/i, ' ').replace(/\bbalance\b/i, ' ');
  const acct = findAccount(state, head) ?? findAccount(state, q);
  const sugg = ['Trustmark balance as of Oct 31', '1400 balance as of end of October', 'Accounts payable balance as of yesterday'];
  if (!acct) return missing(q, "I can't tell which account you mean.", ['An account name or number from the chart of accounts (Books › Chart of accounts)'], sugg, 'balance');
  const stores = findStores(state, q.replace(new RegExp(acct.name, 'i'), ''));
  const denied = deniedStores(ctx, stores);
  if (denied.length) return missing(q, `Your role doesn't include ${denied.map((s) => s.code).join(', ')}.`, ['Access to that store'], [], 'balance');
  if (!stores.length && ctx.visible && state.stores.some((s) => !ctx.visible!.has(s.id))) return missing(q, "Your role sees only some stores, so I can't give a company-wide balance. Name your store.", ['A store you can see'], [], 'balance');
  const b = ledgerBounds(state);
  if (b && asOf.date > ctx.today) return missing(q, `${asOf.label} is in the future; the books run through ${shortDate(b.last)}.`, ['A date on or before today'], sugg, 'balance');
  const want = new Set(stores.map((s) => s.id));
  const sign = normalSign(acct);
  const proof: ProofRow[] = [];
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf.date) continue;
    let v = 0;
    let store = '';
    for (const l of t.lines) if (l.accountId === acct.id && (!want.size || want.has(l.storeId))) { v += l.debit - l.credit; store = storeCode(state, l.storeId); }
    if (v) proof.push({ date: t.date, ref: t.ref, txnId: t.id, to: `/books/transactions/${t.id}`, description: t.description, store, amount: sign * v });
  }
  proof.sort((a, x) => a.date.localeCompare(x.date) || (a.ref ?? '').localeCompare(x.ref ?? ''));
  const where = stores.length ? ` at ${stores.map((s) => s.code).join(' and ')}` : '';
  return answer('balance', q, {
    reading: `${acct.number} ${acct.name}${where}: every posted line through ${shortDate(asOf.date)}, in the account's natural sign (${sign > 0 ? 'debits' : 'credits'} positive).`,
    headline: (f) => `${acct.number} ${acct.name}${where} was ${money(f)} as of ${asOf.label}.`,
    unit: 'money', amountLabel: 'Change', proof,
    notes: proof.length ? [`${proof.length} transactions make up the balance; export the CSV for every row.`] : [`Nothing is posted to ${acct.number} ${acct.name}${where} through ${shortDate(asOf.date)}.`],
  });
}

function askSales(state: BooksState, q: string, ctx: AskContext): AskResult {
  const stores = findStores(state, q);
  const range = parseRange(q, ctx.today);
  const sugg = ['Sales at HM13 last week', 'Sales at HM11 last month'];
  if (!range) return missing(q, 'I need the period for the sales.', ['A period, such as "last week", "last month" or "in October"'], sugg, 'sales');
  const denied = deniedStores(ctx, stores);
  if (denied.length) return missing(q, `Your role doesn't include ${denied.map((s) => s.code).join(', ')}.`, ['Access to that store'], [], 'sales');
  const oor = outOfRange(state, range);
  if (oor) return missing(q, oor, [`Sales for ${range.label}`], sugg, 'sales');
  const ids = new Set(stores.length ? stores.map((s) => s.id) : state.stores.filter((s) => s.kind === 'operating' && (!ctx.visible || ctx.visible.has(s.id))).map((s) => s.id));
  const rev = new Set(state.accounts.filter((a) => a.type === 'revenue' && (a.lob === 'fuel' || a.lob === 'inside' || a.lob === 'kitchen')).map((a) => a.id));
  const proof: ProofRow[] = [];
  for (const t of state.transactions) {
    if (t.deleted || t.date < range.from || t.date > range.to) continue;
    const by = new Map<ID, number>();
    for (const l of t.lines) if (rev.has(l.accountId) && ids.has(l.storeId)) by.set(l.storeId, (by.get(l.storeId) ?? 0) + l.credit - l.debit);
    for (const [s, v] of by) if (v) proof.push({ date: t.date, ref: t.ref, txnId: t.id, to: `/books/transactions/${t.id}`, description: t.description, store: storeCode(state, s), amount: v });
  }
  proof.sort((a, b) => a.date.localeCompare(b.date) || (a.store ?? '').localeCompare(b.store ?? ''));
  const where = stores.length ? ` at ${stores.map((s) => s.code).join(' and ')}` : ' across all stores';
  const notOpen = stores.filter((s) => s.openedOn && s.openedOn > range.to);
  if (!proof.length) return missing(q, `No sales are posted${where} for ${range.label}${notOpen.length ? ` (${notOpen.map((s) => `${s.code} opened ${shortDate(s.openedOn!)}`).join(', ')})` : ''}.`, [`POS daily closes${where} for ${range.label}`], sugg, 'sales');
  const b = ledgerBounds(state)!;
  return answer('sales', q, {
    reading: `Fuel, inside-store and kitchen sales${where} posted ${shortDate(range.from)} – ${shortDate(range.to)}, before discounts and excluding sales tax, rent, ATM and rebates.`,
    headline: (f) => `Sales${where} were ${money(f)} ${range.label}.`,
    unit: 'money', amountLabel: 'Sales', proof,
    notes: range.to > b.last ? [`The books run through ${shortDate(b.last)}.`] : [],
  });
}

function askOwesUs(state: BooksState, q: string, ctx: AskContext, all: boolean): AskResult {
  if (!seesCorp(state, ctx)) return missing(q, "Related-party balances are Corporate's, which your role doesn't include.", ['Access to Corporate'], [], all ? 'intercompany' : 'owes_us');
  const asOf = parseDate(q, ctx.today) ?? { date: ctx.today, label: `today (${shortDate(ctx.today)})` };
  const sum = icSummary(state, asOf.date);
  const name = (id: ID) => state.parties.find((p) => p.id === id)?.name ?? id;
  if (!all) {
    const owing = sum.parties.filter((p) => p.balance > 0).sort((a, b) => b.balance - a.balance);
    const proof: ProofRow[] = [];
    for (const p of owing) for (const m of p.movements.filter((x) => !x.memoOnly || true)) {
      proof.push({ date: m.date, ref: m.ref, txnId: m.txnId, to: m.txnId ? `/books/transactions/${m.txnId}` : `/intercompany/parties/${p.id}`, description: `${name(p.id)}: ${m.description}${m.memoOnly ? ' (rent due, memo)' : ''}`, store: '', amount: m.out - m.in });
    }
    return answer('owes_us', q, {
      reading: `Every related company, owner, tenant and lender whose running balance is owed to us as of ${shortDate(asOf.date)} (loans made, bills paid for them, rent due), with each movement that makes up the balance.`,
      headline: (f) => (owing.length ? `${owing.length} part${owing.length === 1 ? 'y owes' : 'ies owe'} us ${money(f)}: ${owing.map((p) => `${p.name} ${money(p.balance)}`).join(', ')}.` : 'Nobody owes us anything.'),
      unit: 'money', amountLabel: 'Out − in', proof,
      notes: ['Store entities owing Corporate are internal to the group; ask "intercompany balances" to see them.', 'Each party\'s statement (Intercompany › Related parties) ties to the ledger.'],
    });
  }
  const rows = [...sum.parties.filter((p) => p.balance !== 0), ...sum.entities.filter((e) => e.balance !== 0)];
  const proof = rows.map((p): ProofRow => ({ date: p.lastDate ?? asOf.date, to: `/intercompany/parties/${p.id}`, description: `${p.name} · ${p.typeLabel} · statement of ${p.movements.length} movement${p.movements.length === 1 ? '' : 's'} (${p.balance > 0 ? 'owed to us' : 'we owe'})`, amount: p.balance }));
  const owed = rows.filter((r) => r.balance > 0).reduce((a, r) => a + r.balance, 0);
  const owe = rows.filter((r) => r.balance < 0).reduce((a, r) => a - r.balance, 0);
  return answer('intercompany', q, {
    reading: `Running due-to / due-from balance with each related party, owner, tenant and lender, and each store entity's position with Corporate, as of ${shortDate(asOf.date)}. + owed to us, − we owe.`,
    headline: (f) => `Net intercompany position ${money(f)} as of ${asOf.label}: ${money(owed)} owed to us, ${money(owe)} we owe, across ${rows.length} balances.`,
    unit: 'money', amountLabel: 'Balance (+ owed to us)', proof,
    notes: ['Open a row for the party statement; each one ties to the ledger.'],
  });
}

function askBills(state: BooksState, q: string, ctx: AskContext, pastDue: boolean): AskResult {
  const vis = (b: { storeId: ID }) => !ctx.visible || ctx.visible.has(b.storeId);
  const range: DateRange = pastDue ? { from: '0000-01-01', to: addDays(ctx.today, -1), label: 'before today' } : (parseRange(q, ctx.today) ?? { ...weekOf(ctx.today), label: `this week (${shortDate(weekOf(ctx.today).from)} – ${shortDate(weekOf(ctx.today).to)})` });
  const bills = apState(state).bills.filter((b) => vis(b) && b.status !== 'void' && b.status !== 'paid' && !(b.payment && b.payment.date <= ctx.today));
  const inRange = bills.filter((b) => b.dueDate >= range.from && b.dueDate <= range.to).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const proof = inRange.map((b): ProofRow => ({
    date: b.dueDate, ref: b.ref, txnId: b.approved?.txnId, to: `/payables/bills/${b.id}`,
    description: `${vendorName(state, b.vendorId)} ${b.invoiceNo}${b.status === 'draft' ? ' · awaiting approval' : b.autopay ? ' · autopay' : b.scheduled ? ` · scheduled ${shortDate(b.scheduled.date)}` : ' · not scheduled'}`,
    store: storeCode(state, b.storeId), amount: billTotal(b),
  }));
  const notes: string[] = [];
  if (!pastDue) {
    const late = bills.filter((b) => b.dueDate < ctx.today);
    if (late.length) notes.push(`${late.length} more bill${late.length === 1 ? ' is' : 's are'} already past due (${money(late.reduce((a, b) => a + billTotal(b), 0))}); ask "bills past due".`);
  }
  return answer(pastDue ? 'bills_past_due' : 'bills_due', q, {
    reading: pastDue ? `Unpaid bills with a due date before ${shortDate(ctx.today)}.` : `Unpaid bills (including ones awaiting approval) due ${shortDate(range.from)} – ${shortDate(range.to)}.`,
    headline: (f) => (proof.length ? `${proof.length} bill${proof.length === 1 ? '' : 's'} totalling ${money(f)} ${pastDue ? (proof.length === 1 ? 'is' : 'are') + ' past due' : 'due ' + range.label}.` : pastDue ? 'No bill is past due.' : `No bills are due ${range.label}.`),
    unit: 'money', amountLabel: 'Amount', proof, notes,
  });
}

/** Answer a question from the books, or say exactly what is missing. */
export function ask(state: BooksState, question: string, ctx: AskContext): AskResult {
  const q = question.trim().replace(/\s+/g, ' ');
  const s = q.toLowerCase();
  if (!q) return missing(q, 'Type a question about payments, invoices, gallons, balances, sales, who owes us or bills due.', ['A question'], EXAMPLES);
  if (/\bbills?\b/.test(s) && /\b(past due|overdue|late)\b/.test(s)) return askBills(state, q, ctx, true);
  if (/\bbills?\b/.test(s) && /\b(due|coming up|owed)\b/.test(s) && !/\b(outstanding|unpaid|open)\b.*\b(as of)\b/.test(s)) return askBills(state, q, ctx, false);
  if (/\bwho owes us\b|\bowed to us\b|\bowe us\b/.test(s)) return askOwesUs(state, q, ctx, false);
  if (/\bintercompany\b|\brelated[- ]part(y|ies)\b.*\bbalances?\b|\bdue to\b.*\bdue from\b/.test(s)) return askOwesUs(state, q, ctx, true);
  if (/\b(outstanding|open|unpaid)\b/.test(s) && /\b(invoices?|bills?)\b/.test(s)) return askOutstanding(state, q, ctx);
  if (/\bgallons?\b|\bgal\b/.test(s)) return askGallons(state, q, ctx);
  if (/\b(pay|paid)\b/.test(s)) return askPaid(state, q, ctx);
  if (/\bbalance\b/.test(s)) return askBalance(state, q, ctx);
  if (/\b(sales|revenue|sold)\b/.test(s)) return askSales(state, q, ctx);
  return missing(q, "I couldn't match that to a question I know how to answer from the books.", ['A question in one of the forms below'], EXAMPLES);
}

/** Does the text look like a question (for the ⌘K "Ask: …" option)? */
export function looksLikeQuestion(text: string): boolean {
  const s = text.trim().toLowerCase();
  if (s.length < 8) return false;
  return /\?$/.test(s) || /^(what|how|who|which|when|show|list|outstanding|gallons|sales|bills|intercompany)\b/.test(s) || /\b(balance|paid|owes|gallons|due)\b/.test(s);
}

export function formatFigure(a: Pick<AskAnswer, 'unit'>, n: number): string {
  return a.unit === 'gallons' ? gal(n) : money(n);
}

/** The answer as plain text, for copying into an email or message. */
export function answerText(r: AskResult): string {
  if (!r.ok) return [`Q: ${r.question}`, `Not answered: ${r.reason}`, ...r.missing.map((m) => `Missing: ${m}`), `Try: ${r.suggestions.join(' | ')}`].join('\n');
  const lines = [`Q: ${r.question}`, `A: ${r.headline}`, `How I read it: ${r.reading}`, ...r.notes.map((n) => `Note: ${n}`), '', `Proof (${r.proof.length} rows, adding to ${formatFigure(r, r.figure)}):`];
  for (const p of r.proof.slice(0, 200)) lines.push(`${p.date}  ${p.ref ?? ''}  ${p.store ?? ''}  ${p.description}  ${formatFigure(r, p.amount)}`.replace(/\s{3,}/g, '  '));
  if (r.proof.length > 200) lines.push(`… and ${r.proof.length - 200} more rows (export the CSV for all of them).`);
  return lines.join('\n');
}

/** The proof rows as CSV cells (header + rows), with a total row that equals the answer. */
export function answerCsv(r: AskAnswer): { header: string[]; rows: (string | number)[][] } {
  const val = (n: number) => (r.unit === 'money' ? (n / 100).toFixed(2) : n);
  return {
    header: ['Date', 'Reference', 'Store', 'Description', r.amountLabel],
    rows: [...r.proof.map((p) => [p.date, p.ref ?? '', p.store ?? '', p.description, val(p.amount)]), ['', '', '', 'Total', val(r.figure)]],
  };
}
