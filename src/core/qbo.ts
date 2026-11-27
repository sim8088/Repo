import type { Books } from './books';
import { ValidationError } from './books';
import type {
  Account, BooksState, Entity, ID, QboAccount, QboConnection, QboConnectorKind, QboLogEntry, QboPulledRow, QboPushRecord, QboState, QboTbRow, QboTrialBalance, Transaction, User,
} from './types';
import { splitCsv, parseDate } from './bankio';
import { addDays, lastDayOfPeriod, periodOf } from './dates';
import { formatMoney, parseMoney, type Cents } from './money';
import { flatLines, trialBalance, type FlatLine } from './reports';
import { txnTotal } from './duplicates';
import { glOf } from './journals';

// ── State ────────────────────────────────────────────────────────────────
export function emptyQbo(): QboState {
  return { connections: [], lists: { accounts: [], classes: [], vendors: [], customers: [] }, mappings: { accounts: {}, classes: {}, parties: {} }, pulled: [], trialBalances: [], pushes: [], log: [], seq: 0 };
}

/** Books saved before phase 10 have no `qbo` slice: read it as empty. */
export function qboOf(state: BooksState): QboState {
  return state.qbo ?? emptyQbo();
}

function qboWrite(state: BooksState): QboState {
  if (!state.qbo) state.qbo = emptyQbo();
  return state.qbo;
}

function log(books: Books, actor: User, e: Omit<QboLogEntry, 'id' | 'at' | 'by'>): QboLogEntry {
  const entry: QboLogEntry = { id: books.nextId('qlog'), at: books.clock(), by: actor.id, ...e };
  qboWrite(books.state).log.push(entry);
  return entry;
}

const ent = (state: BooksState, id: ID): Entity | undefined => state.entities.find((e) => e.id === id);
const entCode = (state: BooksState, id: ID) => ent(state, id)?.code ?? id;
const money = (c: number) => formatMoney(c, { dollarSign: true });

// ── Connectors ───────────────────────────────────────────────────────────
export interface ParsedQboTxn { date: string; type: string; num?: string; name?: string; memo?: string; account: string; split?: string; className?: string; amount: Cents }
export interface ParsedQboTxns { rows: ParsedQboTxn[]; problems: string[] }
export interface ParsedQboTb { asOf?: string; rows: QboTbRow[]; totalDebit: Cents; totalCredit: Cents; reported?: { debit: Cents; credit: Cents }; problems: string[] }

/**
 * How the portal talks to QuickBooks. The file connector works today: import QBO's CSV exports and
 * export a journal CSV that QBO imports. The API connector needs OAuth and the hosted back end.
 */
export interface QboConnector {
  kind: QboConnectorKind;
  label: string;
  /** Talks to QBO directly (needs the hosted back end). */
  live: boolean;
  describe: string;
  parseTransactions(text: string): ParsedQboTxns;
  parseTrialBalance(text: string): ParsedQboTb;
  exportJournal(state: BooksState, payloads: QboPayload[]): string;
}

const NEEDS_BACKEND = 'The live QuickBooks connection needs the hosted back end (OAuth sign-in and API calls can\'t run in the browser). Use the file connector: import QBO exports and export the journal CSV.';

export const FILE_CONNECTOR: QboConnector = {
  kind: 'file', label: 'File (CSV import / export)', live: false,
  describe: 'Import QBO exports (transactions, checks, bills, bill payments and the trial balance) and export journal entries as a CSV QBO imports.',
  parseTransactions: (t) => parseQboTransactions(t),
  parseTrialBalance: (t) => parseQboTb(t),
  exportJournal: (s, p) => journalCsv(s, p),
};

export const API_CONNECTOR: QboConnector = {
  kind: 'api', label: 'QuickBooks Online API (OAuth)', live: true, describe: NEEDS_BACKEND,
  parseTransactions: () => { throw new ValidationError([NEEDS_BACKEND]); },
  parseTrialBalance: () => { throw new ValidationError([NEEDS_BACKEND]); },
  exportJournal: () => { throw new ValidationError([NEEDS_BACKEND]); },
};

export const CONNECTORS: Record<QboConnectorKind, QboConnector> = { file: FILE_CONNECTOR, api: API_CONNECTOR };

export function connection(state: BooksState, entityId: ID): QboConnection {
  return qboOf(state).connections.find((c) => c.entityId === entityId) ?? { entityId, connector: 'file' };
}

export interface ConnectionStatus { entity: Entity; conn: QboConnection; live: boolean; label: string; detail: string }

export function connectionStatus(state: BooksState): ConnectionStatus[] {
  return state.entities.filter((e) => !e.deleted).map((e) => {
    const conn = connection(state, e.id);
    return { entity: e, conn, live: false, label: 'Not connected — needs hosted back end', detail: conn.connector === 'file' ? 'Syncing by file: import QBO exports here, push by exporting the journal CSV and importing it in QBO.' : NEEDS_BACKEND };
  });
}

export function saveConnection(books: Books, actor: User, entityId: ID, patch: Partial<Omit<QboConnection, 'entityId'>>): QboConnection {
  books.require(actor, 'qbo.sync', 'change QuickBooks connections');
  if (!ent(books.state, entityId)) throw new ValidationError(['Pick an entity.']);
  if (patch.closedThrough && !parseDate(patch.closedThrough)) throw new ValidationError(['Enter QBO\'s closing date as YYYY-MM-DD, or leave it blank.']);
  const q = qboWrite(books.state);
  let c = q.connections.find((x) => x.entityId === entityId);
  const before = c ? structuredClone(c) : undefined;
  if (!c) { c = { entityId, connector: 'file' }; q.connections.push(c); }
  Object.assign(c, patch);
  if (!c.closedThrough) delete c.closedThrough;
  log(books, actor, { kind: 'connection', entityId, summary: `Updated the ${entCode(books.state, entityId)} QuickBooks connection${c.companyName ? ` (${c.companyName})` : ''}${c.closedThrough ? `, QBO closed through ${c.closedThrough}` : ''}` });
  books.audit(actor, { action: 'connection', objectType: 'qbo', objectId: entityId, summary: `Updated QBO connection for ${entCode(books.state, entityId)}`, before, after: structuredClone(c) });
  books.changed();
  return c;
}

// ── Mapping ──────────────────────────────────────────────────────────────
export function nameTokens(s: string): string[] {
  return s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((w) => w && !['the', 'of', 'and', 'a', 'inc', 'llc', 'co', 'demo', 'tenant'].includes(w));
}

/** 0–1: how alike two names are (shared words over all words). */
export function nameScore(a: string, b: string): number {
  const x = new Set(nameTokens(a));
  const y = new Set(nameTokens(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / new Set([...x, ...y]).size;
}

export const SUGGEST_MIN = 0.5;

/** The QBO account most like a portal account: same number wins, then the closest name. */
export function suggestAccount(state: BooksState, a: Account): { name: string; score: number } | null {
  let best: { name: string; score: number } | null = null;
  for (const q of qboOf(state).lists.accounts) {
    const score = q.number && q.number === a.number ? 1 : nameScore(a.name, q.name);
    if (score >= SUGGEST_MIN && (!best || score > best.score)) best = { name: q.name, score };
  }
  return best;
}

export function suggestName(list: string[], name: string): { name: string; score: number } | null {
  let best: { name: string; score: number } | null = null;
  for (const q of list) {
    const score = nameScore(name, q);
    if (score >= SUGGEST_MIN && (!best || score > best.score)) best = { name: q, score };
  }
  return best;
}

export interface MapRow<T> { item: T; mapped?: string; suggestion: { name: string; score: number } | null }
export interface MappingStatus {
  accounts: MapRow<Account>[];
  classes: MapRow<{ id: ID; code: string; name: string }>[];
  parties: (MapRow<{ id: ID; name: string; kind: 'vendor' | 'customer' }>)[];
  unmappedAccounts: Account[];
  unmappedClasses: number;
  unmappedParties: number;
}

export const partyQboKind = (type: string): 'vendor' | 'customer' => (type === 'tenant' || type === 'customer' ? 'customer' : 'vendor');

export function mappingStatus(state: BooksState): MappingStatus {
  const q = qboOf(state);
  const accounts = state.accounts.filter((a) => a.active).sort((a, b) => a.number.localeCompare(b.number))
    .map((a) => ({ item: a, mapped: q.mappings.accounts[a.id], suggestion: q.mappings.accounts[a.id] ? null : suggestAccount(state, a) }));
  const classes = state.stores.filter((s) => !s.deleted).map((s) => ({ item: { id: s.id, code: s.code, name: s.name }, mapped: q.mappings.classes[s.id], suggestion: q.mappings.classes[s.id] ? null : suggestName(q.lists.classes, `${s.code} ${s.name}`) ?? suggestName(q.lists.classes, s.name) }));
  const parties = state.parties.filter((p) => !p.deleted && p.type !== 'owner').map((p) => {
    const kind = partyQboKind(p.type);
    return { item: { id: p.id, name: p.name, kind }, mapped: q.mappings.parties[p.id]?.name, suggestion: q.mappings.parties[p.id] ? null : suggestName(kind === 'customer' ? q.lists.customers : q.lists.vendors, p.name) };
  });
  return {
    accounts, classes, parties,
    unmappedAccounts: accounts.filter((r) => !r.mapped).map((r) => r.item),
    unmappedClasses: classes.filter((r) => !r.mapped).length,
    unmappedParties: parties.filter((r) => !r.mapped).length,
  };
}

/** Accounts that still need a QBO account (only once a QBO account list is loaded). */
export function unmappedAccounts(state: BooksState): Account[] {
  if (!qboOf(state).lists.accounts.length) return [];
  return mappingStatus(state).unmappedAccounts;
}

export type MapKind = 'accounts' | 'classes' | 'parties';

export function setMapping(books: Books, actor: User, kind: MapKind, id: ID, qboName: string | null): void {
  books.require(actor, 'qbo.sync', 'change QuickBooks mappings');
  const q = qboWrite(books.state);
  const name = qboName?.trim() || null;
  if (name) {
    const list = kind === 'accounts' ? q.lists.accounts.map((a) => a.name) : kind === 'classes' ? q.lists.classes : [...q.lists.vendors, ...q.lists.customers];
    if (list.length && !list.includes(name)) throw new ValidationError([`"${name}" isn't in the QBO list. Pick one from the list, or load the latest list from QBO.`]);
  }
  let label = id;
  let before: unknown;
  if (kind === 'accounts') {
    const a = books.account(id);
    if (!a) throw new ValidationError(['Pick an account.']);
    label = `${a.number} ${a.name}`;
    before = q.mappings.accounts[id];
    if (name) q.mappings.accounts[id] = name; else delete q.mappings.accounts[id];
  } else if (kind === 'classes') {
    const s = books.store(id);
    if (!s) throw new ValidationError(['Pick a store.']);
    label = s.code;
    before = q.mappings.classes[id];
    if (name) q.mappings.classes[id] = name; else delete q.mappings.classes[id];
  } else {
    const p = books.state.parties.find((x) => x.id === id);
    if (!p) throw new ValidationError(['Pick a vendor or party.']);
    label = p.name;
    before = q.mappings.parties[id];
    if (name) q.mappings.parties[id] = { name, kind: q.lists.customers.includes(name) ? 'customer' : 'vendor' }; else delete q.mappings.parties[id];
  }
  const fixed = !!name && before === undefined && kind === 'accounts';
  log(books, actor, { kind: fixed ? 'fix' : 'mapping', summary: name ? `Mapped ${label} → ${name}` : `Removed the QBO mapping for ${label}`, fix: fixed ? `Entries held for ${label} can be pushed now.` : undefined });
  books.audit(actor, { action: 'map', objectType: 'qbo', objectId: `${kind}:${id}`, summary: name ? `QBO mapping ${label} → ${name}` : `QBO mapping removed for ${label}`, before, after: name });
  books.changed();
}

/** Accept every suggestion of one kind. Returns how many were mapped. */
export function acceptSuggestions(books: Books, actor: User, kind: MapKind): number {
  books.require(actor, 'qbo.sync', 'change QuickBooks mappings');
  const st = mappingStatus(books.state);
  const rows = kind === 'accounts' ? st.accounts : kind === 'classes' ? st.classes : st.parties;
  const q = qboWrite(books.state);
  let n = 0;
  for (const r of rows) {
    if (r.mapped || !r.suggestion) continue;
    if (kind === 'accounts') q.mappings.accounts[r.item.id] = r.suggestion.name;
    else if (kind === 'classes') q.mappings.classes[r.item.id] = r.suggestion.name;
    else q.mappings.parties[r.item.id] = { name: r.suggestion.name, kind: q.lists.customers.includes(r.suggestion.name) ? 'customer' : 'vendor' };
    n++;
  }
  if (n) {
    log(books, actor, { kind: 'mapping', summary: `Accepted ${n} suggested ${kind === 'accounts' ? 'account' : kind === 'classes' ? 'class' : 'vendor / customer'} mapping${n === 1 ? '' : 's'}` });
    books.audit(actor, { action: 'map', objectType: 'qbo', objectId: kind, summary: `Accepted ${n} QBO ${kind} suggestions` });
    books.changed();
  }
  return n;
}

/** Load QBO's account list (Account List report CSV: Account, Type, optional Number) and the class, vendor and customer names. */
export function parseQboAccountList(text: string): QboAccount[] {
  const rows = splitCsv(text);
  const h = rows.findIndex((r) => r.some((c) => /^(account|account name|name)$/i.test(c.trim())) && r.some((c) => /^(type|account type)$/i.test(c.trim())));
  if (h < 0) return [];
  const head = rows[h].map((c) => c.trim().toLowerCase());
  const ni = head.findIndex((c) => ['account', 'account name', 'name'].includes(c));
  const ti = head.findIndex((c) => ['type', 'account type'].includes(c));
  const nu = head.findIndex((c) => ['number', 'account #', 'acct num'].includes(c));
  return rows.slice(h + 1).filter((r) => r[ni]?.trim()).map((r) => ({ name: r[ni].trim(), type: r[ti]?.trim() ?? '', number: nu >= 0 ? r[nu]?.trim() || undefined : undefined }));
}

export function loadQboLists(books: Books, actor: User, lists: Partial<QboState['lists']>, source = 'QBO lists'): void {
  books.require(actor, 'qbo.sync', 'load QuickBooks lists');
  const q = qboWrite(books.state);
  if (lists.accounts) q.lists.accounts = lists.accounts;
  if (lists.classes) q.lists.classes = lists.classes;
  if (lists.vendors) q.lists.vendors = lists.vendors;
  if (lists.customers) q.lists.customers = lists.customers;
  log(books, actor, { kind: 'mapping', summary: `Loaded ${source}: ${q.lists.accounts.length} accounts, ${q.lists.classes.length} classes, ${q.lists.vendors.length} vendors, ${q.lists.customers.length} customers` });
  books.changed();
}

// ── Push: payloads ───────────────────────────────────────────────────────
export type SummaryKind = 'sales' | 'fuel_cogs' | 'card_fees' | 'payroll';
export type PayloadKind = 'je' | 'reversal' | SummaryKind;
export const PAYLOAD_LABEL: Record<PayloadKind, string> = { je: 'Journal entry', reversal: 'Reversal', sales: 'Sales summary', fuel_cogs: 'Fuel COGS summary', card_fees: 'Card fees summary', payroll: 'Payroll summary' };
const SUMMARY_ORDER: SummaryKind[] = ['payroll', 'fuel_cogs', 'card_fees', 'sales'];
const SUMMARY_ACCTS: Record<Exclude<SummaryKind, 'sales'>, Set<ID>> = {
  payroll: new Set(['acct_wages', 'acct_payroll_taxes']),
  fuel_cogs: new Set(['acct_cogs_fuel']),
  card_fees: new Set(['acct_card_fees', 'acct_network_fees']),
};

export interface QboPayloadLine { accountId: ID; storeId: ID; qboAccount?: string; className?: string; name?: string; debit: Cents; credit: Cents; description: string }
export type PayloadStatus = 'ready' | 'pushed' | 'changed' | 'blocked';
export interface QboPayload {
  key: string;
  kind: PayloadKind;
  label: string;
  entityId: ID;
  period: string;
  date: string;
  docNumber: string;
  lines: QboPayloadLine[];
  total: Cents;
  sourceTxnIds: ID[];
  jeId?: ID;
  approvedBy?: ID;
  /** Blocking: an account with no QBO account. */
  errors: string[];
  /** Not blocking (e.g. a store with no class). */
  warnings: string[];
  hash: string;
  status: PayloadStatus;
  push?: QboPushRecord;
}

/** Which summary a transaction belongs in, by priority (payroll, fuel COGS, card fees, sales), or null. */
export function summaryKindOf(state: BooksState, t: Transaction, acc = new Map(state.accounts.map((a) => [a.id, a]))): SummaryKind | null {
  const ids = new Set(t.lines.map((l) => l.accountId));
  for (const k of SUMMARY_ORDER) {
    if (k === 'sales') {
      if ([...ids].some((id) => { const a = acc.get(id); return a && (a.type === 'revenue' || a.type === 'contra_revenue') && a.lob && a.lob !== 'other'; })) return 'sales';
    } else if ([...ids].some((id) => SUMMARY_ACCTS[k].has(id))) return k;
  }
  return null;
}

const isPulled = (t: Transaction) => t.source === 'import' && !!t.batchId?.startsWith('qbo');

/**
 * Everything the portal would push to one entity's QBO company: each posted journal entry (and its
 * reversal), plus monthly summary entries for sales, fuel COGS, card fees and payroll. Each payload is
 * the entity's own lines (including the automatic due-to / due-from), so it balances on its own.
 */
export function buildPayloads(state: BooksState, entityId: ID, opts: { periods?: string[]; lines?: FlatLine[] } = {}): QboPayload[] {
  const lines = opts.lines ?? flatLines(state);
  const want = opts.periods ? new Set(opts.periods) : null;
  const q = qboOf(state);
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const jeTxn = new Map<ID, { jeId: ID; ref: string; reversal: boolean; approvedBy?: ID }>();
  for (const je of glOf(state).entries) {
    if (je.txnId) jeTxn.set(je.txnId, { jeId: je.id, ref: je.ref, reversal: false, approvedBy: je.approved?.by ?? je.preparedBy });
    if (je.reversal) jeTxn.set(je.reversal.txnId, { jeId: je.id, ref: je.ref, reversal: true, approvedBy: je.approved?.by ?? je.preparedBy });
  }
  const code = entCode(state, entityId);
  const jeGroups = new Map<string, { info: { jeId: ID; ref: string; reversal: boolean; approvedBy?: ID }; t: Transaction; lines: FlatLine[] }>();
  const sumGroups = new Map<string, { kind: SummaryKind; period: string; lines: FlatLine[]; txns: Set<ID> }>();
  const kindCache = new Map<ID, SummaryKind | null>();
  for (const f of lines) {
    if (f.entityId !== entityId) continue;
    if (want && !want.has(f.period)) continue;
    const t = f.t;
    if (t.kind === 'opening' || isPulled(t)) continue;
    const info = jeTxn.get(t.id);
    if (info) {
      const k = `${info.reversal ? 'reversal' : 'je'}:${entityId}:${f.period}:${info.jeId}`;
      const g = jeGroups.get(k) ?? { info, t, lines: [] };
      g.lines.push(f);
      jeGroups.set(k, g);
      continue;
    }
    let kind = kindCache.get(t.id);
    if (kind === undefined) { kind = summaryKindOf(state, t, acc); kindCache.set(t.id, kind); }
    if (!kind) continue;
    const k = `${kind}:${entityId}:${f.period}`;
    const g = sumGroups.get(k) ?? { kind, period: f.period, lines: [], txns: new Set<ID>() };
    g.lines.push(f);
    g.txns.add(t.id);
    sumGroups.set(k, g);
  }
  const finish = (p: Omit<QboPayload, 'errors' | 'warnings' | 'hash' | 'status' | 'total' | 'push'>): QboPayload => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const missingAcct = new Set<ID>();
    const missingClass = new Set<ID>();
    for (const l of p.lines) {
      l.qboAccount = q.mappings.accounts[l.accountId];
      l.className = q.mappings.classes[l.storeId];
      if (!l.qboAccount) missingAcct.add(l.accountId);
      if (!l.className) missingClass.add(l.storeId);
    }
    for (const id of missingAcct) { const a = acc.get(id); errors.push(`Map ${a?.number} ${a?.name} to a QBO account.`); }
    for (const id of missingClass) warnings.push(`${state.stores.find((s) => s.id === id)?.code} has no QBO class; the lines go without one.`);
    const total = p.lines.reduce((a, l) => a + l.debit, 0);
    const hash = JSON.stringify([p.date, p.lines.map((l) => [l.accountId, l.storeId, l.debit, l.credit])]);
    const push = q.pushes.find((x) => x.key === p.key);
    const status: PayloadStatus = errors.length ? 'blocked' : push ? (push.hash === hash ? 'pushed' : 'changed') : 'ready';
    return { ...p, errors, warnings, total, hash, status, push };
  };
  const out: QboPayload[] = [];
  for (const [key, g] of jeGroups) {
    const period = g.lines[0].period;
    const many = new Set(g.t.lines.map((l) => state.stores.find((s) => s.id === l.storeId)?.entityId)).size > 1;
    out.push(finish({
      key, kind: g.info.reversal ? 'reversal' : 'je', label: `${g.info.reversal ? 'Reversal of ' : ''}${g.info.ref} · ${g.t.description}`, entityId, period, date: g.t.date,
      docNumber: `${g.info.ref}${g.info.reversal ? '-R' : ''}${many ? '-' + code : ''}`, jeId: g.info.jeId, approvedBy: g.info.approvedBy, sourceTxnIds: [g.t.id],
      lines: g.lines.map((f) => ({ accountId: f.l.accountId, storeId: f.l.storeId, debit: f.l.debit, credit: f.l.credit, description: f.l.memo ?? g.t.description, name: (f.l.partyId ?? g.t.partyId) ? q.mappings.parties[(f.l.partyId ?? g.t.partyId)!]?.name : undefined })),
    }));
  }
  for (const [key, g] of sumGroups) {
    const net = new Map<string, number>();
    for (const f of g.lines) { const k = `${f.l.accountId}|${f.l.storeId}`; net.set(k, (net.get(k) ?? 0) + f.l.debit - f.l.credit); }
    const plines: QboPayloadLine[] = [];
    for (const [k, v] of [...net].sort()) {
      if (!v) continue;
      const [accountId, storeId] = k.split('|');
      plines.push({ accountId, storeId, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0, description: `${PAYLOAD_LABEL[g.kind]} ${g.period}` });
    }
    if (!plines.length) continue;
    out.push(finish({
      key, kind: g.kind, label: `${PAYLOAD_LABEL[g.kind]} · ${code} · ${g.period} (${g.txns.size} entries)`, entityId, period: g.period, date: lastDayOfPeriod(g.period),
      docNumber: `${code}-${g.kind.replace('_', '').toUpperCase()}-${g.period}`, sourceTxnIds: [...g.txns], lines: plines,
    }));
  }
  const order: PayloadKind[] = ['sales', 'fuel_cogs', 'card_fees', 'payroll', 'je', 'reversal'];
  return out.sort((a, b) => a.period.localeCompare(b.period) || order.indexOf(a.kind) - order.indexOf(b.kind) || a.date.localeCompare(b.date) || a.docNumber.localeCompare(b.docNumber));
}

export function payloadBalances(p: Pick<QboPayload, 'lines'>): boolean {
  return p.lines.reduce((a, l) => a + l.debit - l.credit, 0) === 0;
}

/** Why a month can't be pushed, or null. Locked portal months and QBO's closing date both refuse. */
export function pushBlock(state: BooksState, entityId: ID, period: string): string | null {
  if (state.periods[period]?.status === 'locked') return `${period} is locked in the portal. QBO only gets entries for open months: push before you lock, or unlock the month (with a reason) first.`;
  const c = connection(state, entityId);
  if (c.closedThrough && lastDayOfPeriod(period) <= c.closedThrough) return `QBO's books for ${entCode(state, entityId)} are closed through ${c.closedThrough}. Nothing is pushed into a closed period.`;
  return null;
}

const qboDate = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;

/** A CSV QBO's journal-entry import accepts: one row per line, grouped by journal number. */
export function journalCsv(state: BooksState, payloads: QboPayload[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [['JournalNo', 'JournalDate', 'AccountName', 'Debits', 'Credits', 'Description', 'Name', 'Class']];
  for (const p of payloads) for (const l of p.lines) {
    rows.push([p.docNumber, qboDate(p.date), l.qboAccount ?? `UNMAPPED ${state.accounts.find((a) => a.id === l.accountId)?.number}`, l.debit ? (l.debit / 100).toFixed(2) : '', l.credit ? (l.credit / 100).toFixed(2) : '', l.description, l.name ?? '', l.className ?? '']);
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

export interface PushResult { pushed: QboPayload[]; blocked: QboPayload[]; csv: string; log: QboLogEntry }

/**
 * Push (by the file connector: record and export) every ready or changed payload for an entity and
 * month. Refuses a locked month. Each entry gets a QBO id (simulated until the API connector ships);
 * a changed entry keeps its id and is sent as an update. Re-pushing an unchanged entry does nothing.
 */
export function pushPeriod(books: Books, actor: User, entityId: ID, period: string, keys?: string[]): PushResult {
  books.require(actor, 'qbo.sync', 'push to QuickBooks');
  if (!ent(books.state, entityId)) throw new ValidationError(['Pick an entity.']);
  const block = pushBlock(books.state, entityId, period);
  if (block) {
    log(books, actor, { kind: 'error', entityId, period, summary: `Push refused for ${entCode(books.state, entityId)} ${period}`, errors: [block] });
    books.changed();
    throw new ValidationError([block]);
  }
  const all = buildPayloads(books.state, entityId, { periods: [period] }).filter((p) => !keys || keys.includes(p.key));
  const go = all.filter((p) => p.status === 'ready' || p.status === 'changed');
  const blocked = all.filter((p) => p.status === 'blocked');
  const q = qboWrite(books.state);
  const code = entCode(books.state, entityId);
  const items: { ref: string; qboId: string; detail: string }[] = [];
  for (const p of go) {
    if (!payloadBalances(p)) throw new ValidationError([`${p.docNumber} doesn't balance; nothing was pushed.`]);
  }
  for (const p of go) {
    const prior = q.pushes.find((x) => x.key === p.key);
    const qboId = prior?.qboId ?? `QBO-${code}-${String(++q.seq).padStart(5, '0')}`;
    const rec: QboPushRecord = { key: p.key, entityId, period, kind: p.kind, docNumber: p.docNumber, qboId, hash: p.hash, total: p.total, pushedAt: books.clock(), by: actor.id, approvedBy: p.approvedBy };
    if (prior) Object.assign(prior, rec); else q.pushes.push(rec);
    items.push({ ref: p.docNumber, qboId, detail: `${prior ? 'Updated' : 'Created'} · ${money(p.total)}` });
    p.status = 'pushed';
    p.push = rec;
  }
  const entry = log(books, actor, {
    kind: 'push', entityId, period, summary: go.length ? `Pushed ${go.length} entr${go.length === 1 ? 'y' : 'ies'} to ${code}'s QBO for ${period}${blocked.length ? `; ${blocked.length} held for mapping` : ''}` : `Nothing new to push for ${code} ${period}${blocked.length ? `; ${blocked.length} held for mapping` : ''}`,
    items, errors: blocked.flatMap((p) => p.errors.map((e) => `${p.docNumber}: ${e}`)),
    approvedBy: go.find((p) => p.approvedBy && p.approvedBy !== actor.id)?.approvedBy,
  });
  books.audit(actor, { action: 'push', objectType: 'qbo', objectId: `${entityId}:${period}`, summary: entry.summary });
  books.changed();
  return { pushed: go, blocked, csv: journalCsv(books.state, go), log: entry };
}

// ── Pull ─────────────────────────────────────────────────────────────────
const PULL_COL: Record<string, RegExp> = {
  date: /^(date|transaction date|txn date)$/i,
  type: /^(transaction type|type|txn type)$/i,
  num: /^(num|no\.?|number|ref no\.?|doc number)$/i,
  name: /^(name|payee|vendor|customer)$/i,
  memo: /^(memo\/description|memo|description|line description)$/i,
  account: /^(account|account name|account full name)$/i,
  split: /^(split|split account)$/i,
  className: /^(class|location)$/i,
  amount: /^(amount|total)$/i,
};

/** QBO "Transaction List" / "Transaction Detail" CSV: Date, Transaction Type, Num, Name, Memo/Description, Account, Split, Class, Amount. */
export function parseQboTransactions(text: string): ParsedQboTxns {
  const rows = splitCsv(text);
  const problems: string[] = [];
  const h = rows.findIndex((r) => r.some((c) => PULL_COL.date.test(c.trim())) && r.some((c) => PULL_COL.amount.test(c.trim())));
  if (h < 0) return { rows: [], problems: ['No header row with Date and Amount columns. Export the Transaction List by Date report from QBO as CSV.'] };
  const head = rows[h].map((c) => c.trim());
  const idx = Object.fromEntries(Object.entries(PULL_COL).map(([k, re]) => [k, head.findIndex((c) => re.test(c))])) as Record<keyof typeof PULL_COL, number>;
  if (idx.account < 0) problems.push('No Account column: each row needs the account the money moved in (the bank for checks, Accounts Payable for bills).');
  const out: ParsedQboTxn[] = [];
  rows.slice(h + 1).forEach((r, i) => {
    const cell = (k: keyof typeof PULL_COL) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
    const date = parseDate(cell('date'));
    if (!date) { if (cell('date') && !/^total/i.test(cell('date'))) problems.push(`Row ${h + i + 2}: "${cell('date')}" isn't a date; skipped.`); return; }
    const amount = parseMoney(cell('amount'));
    if (amount === null) { problems.push(`Row ${h + i + 2}: the amount isn't a number; skipped.`); return; }
    out.push({ date, type: cell('type') || 'Transaction', num: cell('num') || undefined, name: cell('name') || undefined, memo: cell('memo') || undefined, account: cell('account'), split: cell('split') || undefined, className: cell('className') || undefined, amount });
  });
  return { rows: out, problems };
}

export function pullHashes(entityId: ID, rows: ParsedQboTxn[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = ['qbo', entityId, r.date, r.type.toLowerCase(), r.num ?? '', (r.name ?? '').toLowerCase(), r.account.toLowerCase(), r.amount].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}

export type PullStatus = 'already' | 'duplicate' | 'new' | 'held';
export interface PullPreviewRow extends ParsedQboTxn {
  hash: string;
  status: PullStatus;
  /** The portal entry it duplicates. */
  txnId?: ID;
  reason?: string;
  /** What it would post as, when new. */
  post?: { debitAccountId: ID; creditAccountId: ID; storeId: ID; partyId?: ID };
}
export interface PullPreview { rows: PullPreviewRow[]; counts: Record<PullStatus, number>; totalIn: Cents; totalOut: Cents }

function reverseAccount(state: BooksState, qboName: string | undefined): ID | undefined {
  if (!qboName) return undefined;
  const m = qboOf(state).mappings.accounts;
  return Object.keys(m).filter((id) => m[id] === qboName).map((id) => state.accounts.find((a) => a.id === id)!).filter((a) => a && !a.system)
    .sort((a, b) => a.number.localeCompare(b.number))[0]?.id;
}

function partyFor(state: BooksState, name?: string): ID | undefined {
  if (!name) return undefined;
  const m = qboOf(state).mappings.parties;
  const byMap = Object.keys(m).find((id) => m[id].name.toLowerCase() === name.toLowerCase());
  if (byMap) return byMap;
  return state.parties.find((p) => !p.deleted && nameScore(p.name, name) >= 0.75)?.id;
}

function sameDayEntries(state: BooksState): Map<string, Transaction[]> {
  const m = new Map<string, Transaction[]>();
  for (const t of state.transactions) {
    if (t.deleted) continue;
    const k = `${t.date}|${txnTotal(t)}`;
    m.set(k, [...(m.get(k) ?? []), t]);
  }
  return m;
}

/** Preview a pull: each row already pulled, a duplicate of a portal entry (same date, amount and payee), new, or held for mapping. */
export function previewPull(state: BooksState, entityId: ID, rows: ParsedQboTxn[]): PullPreview {
  const hashes = pullHashes(entityId, rows);
  const have = new Set(qboOf(state).pulled.map((p) => p.hash));
  const idx = sameDayEntries(state);
  const used = new Set<ID>();
  const corp = state.stores.find((s) => s.entityId === entityId && !s.deleted && s.kind === 'corporate') ?? state.stores.find((s) => s.entityId === entityId && !s.deleted);
  const classes = qboOf(state).mappings.classes;
  const out = rows.map<PullPreviewRow>((r, i) => {
    const base = { ...r, hash: hashes[i] };
    if (have.has(hashes[i])) return { ...base, status: 'already' };
    const partyId = partyFor(state, r.name);
    const cands = (idx.get(`${r.date}|${Math.abs(r.amount)}`) ?? []).filter((t) => !used.has(t.id));
    const dup = cands.find((t) => (partyId && (t.partyId === partyId || t.lines.some((l) => l.partyId === partyId)))
      || (r.name && (nameScore(t.description, r.name) > 0 || nameTokens(r.name).every((w) => nameTokens(t.description).includes(w))))
      || (r.num && (t.checkNo === r.num || t.docNo === r.num)));
    if (dup) { used.add(dup.id); return { ...base, status: 'duplicate', txnId: dup.id, reason: `Same date, amount and payee as ${dup.ref}` }; }
    const acct = reverseAccount(state, r.account);
    const split = reverseAccount(state, r.split);
    if (!acct || !split) {
      const which = !acct ? r.account || '(blank)' : r.split || '(blank)';
      return { ...base, status: 'held', reason: r.split === '-Split-' ? 'A split transaction: enter it in the portal by hand.' : `Map the QBO account "${which}" to a portal account first.` };
    }
    const storeEntry = Object.entries(classes).find(([, v]) => r.className && v === r.className);
    const storeId = storeEntry?.[0] ?? corp?.id ?? '';
    const out = r.amount < 0;
    return { ...base, status: 'new', post: { debitAccountId: out ? split : acct, creditAccountId: out ? acct : split, storeId, partyId } };
  });
  const counts = { already: 0, duplicate: 0, new: 0, held: 0 } as Record<PullStatus, number>;
  for (const r of out) counts[r.status]++;
  return { rows: out, counts, totalIn: rows.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0), totalOut: rows.filter((r) => r.amount < 0).reduce((a, r) => a - r.amount, 0) };
}

/**
 * Pull a QBO export: duplicates are linked to the portal entry and skipped, new rows post with the
 * batch id, unmapped rows are held. Re-pulling the same file adds nothing.
 */
export function commitPull(books: Books, actor: User, entityId: ID, file: { name: string; rows: ParsedQboTxn[] }): { batchId: string; preview: PullPreview; posted: Transaction[] } {
  books.require(actor, 'qbo.sync', 'pull from QuickBooks');
  if (!ent(books.state, entityId)) throw new ValidationError(['Pick the entity this QBO company belongs to.']);
  if (!file.rows.length) throw new ValidationError(['The file has no transactions to pull.']);
  const preview = previewPull(books.state, entityId, file.rows);
  const q = qboWrite(books.state);
  const batchId = `qbo-pull-${books.nextId('qb')}`;
  const posted: Transaction[] = [];
  const bankish = new Set(books.state.accounts.filter((a) => a.subtype === 'bank' || a.subtype === 'cash').map((a) => a.id));
  const errors: string[] = [];
  for (const r of preview.rows) {
    if (r.status === 'already') continue;
    const row: QboPulledRow = { id: books.nextId('qpr'), hash: r.hash, batchId, entityId, date: r.date, type: r.type, num: r.num, name: r.name, memo: r.memo, account: r.account, split: r.split, className: r.className, amount: r.amount, status: r.status === 'new' ? 'posted' : r.status, txnId: r.txnId, reason: r.reason };
    if (r.status === 'new' && r.post) {
      const amt = Math.abs(r.amount);
      const p = r.post;
      try {
        const t = books.createTransaction(actor, {
          date: r.date, kind: bankish.has(p.creditAccountId) ? 'money_out' : bankish.has(p.debitAccountId) ? 'money_in' : 'journal',
          description: [r.type, r.num, r.name].filter(Boolean).join(' '), memo: r.memo ? `From QBO: ${r.memo}` : 'Pulled from QBO', partyId: p.partyId, checkNo: /check/i.test(r.type) ? r.num : undefined, docNo: r.num, tags: ['qbo'],
          lines: [{ accountId: p.debitAccountId, storeId: p.storeId, debit: amt, credit: 0, partyId: p.partyId }, { accountId: p.creditAccountId, storeId: p.storeId, debit: 0, credit: amt, partyId: p.partyId }],
        }, { source: 'import', batchId });
        row.txnId = t.id;
        posted.push(t);
      } catch (e) {
        row.status = 'held';
        row.reason = e instanceof ValidationError ? e.errors.join(' ') : (e as Error).message;
        errors.push(`${r.date} ${r.name ?? r.type} ${money(r.amount)}: ${row.reason}`);
      }
    }
    q.pulled.push(row);
  }
  const added = preview.rows.filter((r) => r.status !== 'already').length;
  const entry = log(books, actor, {
    kind: 'pull', entityId, batchId, summary: `Pulled ${file.name} for ${entCode(books.state, entityId)}: ${posted.length} posted, ${preview.counts.duplicate} duplicates skipped, ${preview.rows.filter((r) => r.status === 'held').length + errors.length} held, ${preview.counts.already} already pulled`,
    items: posted.map((t) => ({ ref: t.ref, detail: t.description })), errors,
  });
  books.audit(actor, { action: 'pull', objectType: 'qbo', objectId: batchId, summary: entry.summary });
  if (added || errors.length) books.changed(); else books.changed();
  return { batchId, preview, posted };
}

// ── QBO trial balance import ─────────────────────────────────────────────
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** QBO's Trial Balance report as CSV: title rows ("As of October 31, 2026"), a header with Debit and Credit, account rows, TOTAL. */
export function parseQboTb(text: string): ParsedQboTb {
  const rows = splitCsv(text);
  const problems: string[] = [];
  let asOf: string | undefined;
  for (const r of rows.slice(0, 8)) {
    const m = /as of\s+([a-z]+)\s+(\d{1,2}),\s*(\d{4})/i.exec(r.join(' '));
    if (m) {
      const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
      if (mo > 0) asOf = `${m[3]}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
  }
  const h = rows.findIndex((r) => r.some((c) => /^debit$/i.test(c.trim())) && r.some((c) => /^credit$/i.test(c.trim())));
  if (h < 0) return { asOf, rows: [], totalDebit: 0, totalCredit: 0, problems: ['No header row with Debit and Credit. Export QBO\'s Trial Balance report as CSV.'] };
  const head = rows[h].map((c) => c.trim().toLowerCase());
  const di = head.indexOf('debit');
  const ci = head.indexOf('credit');
  const ai = Math.max(0, head.findIndex((c) => c === 'account' || c === 'account name'));
  const out: QboTbRow[] = [];
  let reported: ParsedQboTb['reported'];
  for (const r of rows.slice(h + 1)) {
    const name = (r[ai] ?? '').trim();
    if (!name) continue;
    const d = (r[di] ?? '').trim() ? parseMoney(r[di]) : 0;
    const c = (r[ci] ?? '').trim() ? parseMoney(r[ci]) : 0;
    if (d === null || c === null) { problems.push(`"${name}": the amount isn't a number; skipped.`); continue; }
    if (/^total$/i.test(name)) { reported = { debit: d, credit: c }; continue; }
    if (/^(accrual|cash) basis/i.test(name)) continue;
    out.push({ account: name, debit: d, credit: c });
  }
  const totalDebit = out.reduce((a, r) => a + r.debit, 0);
  const totalCredit = out.reduce((a, r) => a + r.credit, 0);
  return { asOf, rows: out, totalDebit, totalCredit, reported, problems };
}

/** The current (not superseded) QBO trial balance for an entity and month. */
export function qboTb(state: BooksState, entityId: ID, period: string): QboTrialBalance | undefined {
  return qboOf(state).trialBalances.find((t) => t.entityId === entityId && t.period === period && !t.superseded);
}

/** Import a QBO trial balance. Idempotent: the same file again changes nothing; a new version for the month replaces the old one. */
export function importQboTb(books: Books, actor: User, x: { entityId: ID; period: string; fileName: string; parsed: ParsedQboTb }): { tb: QboTrialBalance; added: boolean } {
  books.require(actor, 'qbo.sync', 'import QuickBooks reports');
  const errs: string[] = [];
  if (!ent(books.state, x.entityId)) errs.push('Pick the entity whose QBO company this is.');
  if (!/^\d{4}-\d{2}$/.test(x.period)) errs.push('Pick the month the trial balance is for.');
  if (!x.parsed.rows.length) errs.push(...(x.parsed.problems.length ? x.parsed.problems : ['The file has no account rows.']));
  if (x.parsed.totalDebit !== x.parsed.totalCredit) errs.push(`The QBO trial balance doesn't balance (debits ${money(x.parsed.totalDebit)}, credits ${money(x.parsed.totalCredit)}). Export it again.`);
  if (x.parsed.reported && (x.parsed.reported.debit !== x.parsed.totalDebit || x.parsed.reported.credit !== x.parsed.totalCredit)) errs.push('The rows don\'t add to the TOTAL line. Export the report again without collapsing rows.');
  if (x.parsed.asOf && /^\d{4}-\d{2}$/.test(x.period) && periodOf(x.parsed.asOf) !== x.period) errs.push(`The file is as of ${x.parsed.asOf}, not ${x.period}. Pick the matching month.`);
  if (errs.length) throw new ValidationError(errs);
  const q = qboWrite(books.state);
  const hash = JSON.stringify([x.entityId, x.period, [...x.parsed.rows].sort((a, b) => a.account.localeCompare(b.account)).map((r) => [r.account, r.debit, r.credit])]);
  const current = qboTb(books.state, x.entityId, x.period);
  if (current?.hash === hash) return { tb: current, added: false };
  if (current) current.superseded = true;
  const batchId = `qbo-tb-${books.nextId('qb')}`;
  const tb: QboTrialBalance = { id: books.nextId('qtb'), entityId: x.entityId, period: x.period, asOf: x.parsed.asOf ?? lastDayOfPeriod(x.period), fileName: x.fileName, batchId, hash, rows: x.parsed.rows, importedAt: books.clock(), by: actor.id };
  q.trialBalances.push(tb);
  log(books, actor, { kind: 'tb_import', entityId: x.entityId, period: x.period, batchId, summary: `Imported the QBO trial balance for ${entCode(books.state, x.entityId)} ${x.period} (${tb.rows.length} accounts, ${money(x.parsed.totalDebit)})${current ? ', replacing the earlier import' : ''}` });
  books.audit(actor, { action: 'import', objectType: 'qbo', objectId: tb.id, summary: `Imported QBO trial balance ${entCode(books.state, x.entityId)} ${x.period}` });
  books.changed();
  return { tb, added: true };
}

// ── Differences report ───────────────────────────────────────────────────
export type DiffCause = 'unmapped' | 'not_pushed' | 'timing' | 'unexplained';
export const CAUSE_LABEL: Record<DiffCause, string> = { unmapped: 'Unmapped account', not_pushed: 'Entry not pushed', timing: 'Timing (dated across month end)', unexplained: 'Not explained' };

export interface DiffRow {
  key: string;
  /** The QBO account, or the portal account when unmapped. */
  label: string;
  qboAccount?: string;
  accountIds: ID[];
  /** Debit − credit. */
  portal: Cents;
  qbo: Cents;
  difference: Cents;
  over: boolean;
  cause: DiffCause | null;
  explanation: string;
  refs: string[];
}
export interface DiffReport {
  entityId: ID;
  period: string;
  asOf: string;
  tb?: QboTrialBalance;
  rows: DiffRow[];
  differences: DiffRow[];
  over: DiffRow[];
  portalTotal: { debit: Cents; credit: Cents };
  qboTotal: { debit: Cents; credit: Cents };
  byCause: Record<DiffCause, { count: number; amount: Cents }>;
  /** Every difference has a cause other than "not explained". */
  allExplained: boolean;
}

/**
 * The portal trial balance for one entity at a month end against QBO's, by QBO account. Each
 * difference gets its likely cause: an unmapped account, an entry not pushed (or changed since), or
 * timing (a portal entry within 3 days of the month end for the same amount).
 */
export function differencesReport(state: BooksState, entityId: ID, period: string, opts: { lines?: FlatLine[]; materiality?: Cents } = {}): DiffReport {
  const lines = opts.lines ?? flatLines(state);
  const asOf = lastDayOfPeriod(period);
  const mat = opts.materiality ?? state.settings.materialityCents;
  const tb = qboTb(state, entityId, period);
  const q = qboOf(state);
  const portalTb = trialBalance(state, { asOf, entityId, lines });
  const rows = new Map<string, DiffRow>();
  const row = (key: string, label: string, qboAccount?: string) => {
    let r = rows.get(key);
    if (!r) { r = { key, label, qboAccount, accountIds: [], portal: 0, qbo: 0, difference: 0, over: false, cause: null, explanation: '', refs: [] }; rows.set(key, r); }
    return r;
  };
  for (const r of portalTb.rows) {
    const m = q.mappings.accounts[r.account.id];
    const x = m ? row('q:' + m, m, m) : row('u:' + r.account.id, `${r.account.number} ${r.account.name}`);
    x.accountIds.push(r.account.id);
    x.portal += r.net;
  }
  for (const r of tb?.rows ?? []) row('q:' + r.account, r.account, r.account).qbo += r.debit - r.credit;
  // Unpushed (or changed) entries through this month: what QBO hasn't been told yet, by QBO account.
  const periods = [...new Set(lines.filter((f) => f.entityId === entityId && f.date <= asOf).map((f) => f.period))];
  const unpushed = new Map<string, { amount: number; refs: Set<string> }>();
  for (const p of buildPayloads(state, entityId, { periods, lines })) {
    if (p.status === 'pushed') continue;
    const prior = p.status === 'changed' && p.push ? JSON.parse(p.push.hash)[1] as [ID, ID, number, number][] : [];
    const add = (accountId: ID, v: number) => {
      const m = q.mappings.accounts[accountId];
      const k = m ? 'q:' + m : 'u:' + accountId;
      const u = unpushed.get(k) ?? { amount: 0, refs: new Set<string>() };
      u.amount += v;
      u.refs.add(p.docNumber);
      unpushed.set(k, u);
    };
    for (const l of p.lines) add(l.accountId, l.debit - l.credit);
    for (const [accountId, , d, c] of prior) add(accountId, -(d - c));
  }
  // Single portal entries near the month end, for timing.
  const near = new Map<string, Map<ID, { ref: string; amount: number; date: string }>>();
  for (const f of lines) {
    if (f.entityId !== entityId || f.date < addDays(asOf, -2) || f.date > addDays(asOf, 3)) continue;
    const m = q.mappings.accounts[f.l.accountId];
    const k = m ? 'q:' + m : 'u:' + f.l.accountId;
    const byT = near.get(k) ?? new Map();
    const e = byT.get(f.t.id) ?? { ref: f.t.ref, amount: 0, date: f.date };
    e.amount += f.l.debit - f.l.credit;
    byT.set(f.t.id, e);
    near.set(k, byT);
  }
  const unmappedSuggest = new Map<string, Account>();
  for (const a of state.accounts) if (!q.mappings.accounts[a.id]) { const s = suggestAccount(state, a); if (s) unmappedSuggest.set(s.name, a); }
  const mappedTargets = new Set(Object.values(q.mappings.accounts));
  const out = [...rows.values()];
  for (const r of out) {
    r.difference = r.portal - r.qbo;
    r.over = Math.abs(r.difference) > mat;
    if (!r.difference || !tb) continue;
    const u = unpushed.get(r.key);
    if (r.key.startsWith('u:')) {
      const a = state.accounts.find((x) => x.id === r.key.slice(2));
      const s = a ? suggestAccount(state, a) : null;
      r.cause = 'unmapped';
      r.explanation = `${r.label} has no QBO account, so the portal can't line it up.${s ? ` QBO has "${s.name}": map it there.` : ' Map it on the Mapping screen.'}`;
    } else if (!mappedTargets.has(r.qboAccount!)) {
      const a = unmappedSuggest.get(r.qboAccount!);
      r.cause = 'unmapped';
      r.explanation = `No portal account is mapped to "${r.qboAccount}".${a ? ` It's the likely home of ${a.number} ${a.name}, which is unmapped.` : ''}`;
    } else if (u && u.amount === r.difference) {
      r.cause = 'not_pushed';
      r.refs = [...u.refs];
      r.explanation = `${r.refs.join(', ')} ${r.refs.length === 1 ? 'is' : 'are'} in the portal but not pushed (or changed since the push). Push ${period} to clear it.`;
    } else {
      const hit = [...(near.get(r.key)?.values() ?? [])].find((e) => (e.date <= asOf && e.amount === r.difference) || (e.date > asOf && e.amount === -r.difference));
      if (hit) {
        r.cause = 'timing';
        r.refs = [hit.ref];
        r.explanation = `${hit.ref} is dated ${hit.date} in the portal; QBO probably has it in the ${hit.date <= asOf ? 'next' : 'earlier'} month. Agree the date with the CPA.`;
      } else {
        r.cause = 'unexplained';
        r.explanation = u?.amount ? `Partly unpushed entries (${[...u.refs].join(', ')}, ${money(u.amount)}); the rest isn't explained. Open the GL detail and compare with QBO.` : 'Not explained by mapping, pushes or timing. Open the GL detail and compare with QBO\'s account register.';
        if (u) r.refs = [...u.refs];
      }
    }
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  const differences = out.filter((r) => r.difference !== 0);
  const byCause = { unmapped: { count: 0, amount: 0 }, not_pushed: { count: 0, amount: 0 }, timing: { count: 0, amount: 0 }, unexplained: { count: 0, amount: 0 } } as DiffReport['byCause'];
  for (const r of differences) if (r.cause) { byCause[r.cause].count++; byCause[r.cause].amount += r.difference; }
  const tot = (k: 'portal' | 'qbo') => out.reduce((a, r) => ({ debit: a.debit + Math.max(r[k], 0), credit: a.credit + Math.max(-r[k], 0) }), { debit: 0, credit: 0 });
  return { entityId, period, asOf, tb, rows: out, differences, over: differences.filter((r) => r.over), portalTotal: tot('portal'), qboTotal: tot('qbo'), byCause, allExplained: differences.every((r) => r.cause && r.cause !== 'unexplained') };
}

/** Every entity's latest imported QBO trial balance, with its differences over $5. */
export function qboAlerts(state: BooksState, lines?: FlatLine[]): { entityId: ID; period: string; over: DiffRow[] }[] {
  const latest = new Map<ID, QboTrialBalance>();
  for (const t of qboOf(state).trialBalances) if (!t.superseded && (!latest.get(t.entityId) || t.period > latest.get(t.entityId)!.period)) latest.set(t.entityId, t);
  const fl = lines ?? flatLines(state);
  return [...latest.values()].map((t) => ({ entityId: t.entityId, period: t.period, over: differencesReport(state, t.entityId, t.period, { lines: fl }).over })).filter((x) => x.over.length);
}

/** A QBO-style trial balance CSV for an entity, from the portal mapped to QBO accounts (for testing the import, and the demo). */
export function portalTbCsv(state: BooksState, entityId: ID, period: string, adjust: (rows: Map<string, number>) => void = () => {}): string {
  const asOf = lastDayOfPeriod(period);
  const q = qboOf(state);
  const m = new Map<string, number>();
  for (const r of trialBalance(state, { asOf, entityId }).rows) {
    const k = q.mappings.accounts[r.account.id] ?? `${r.account.number} ${r.account.name}`;
    m.set(k, (m.get(k) ?? 0) + r.net);
  }
  adjust(m);
  const d = new Date(asOf + 'T12:00:00Z');
  const title = `As of ${d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [['Trial Balance'], [`${ent(state, entityId)?.name ?? ''}`], [title], [], ['', 'Debit', 'Credit']];
  let td = 0, tc = 0;
  for (const [k, v] of [...m].sort()) {
    if (!v) continue;
    rows.push([k, v > 0 ? formatMoney(v) : '', v < 0 ? formatMoney(-v) : '']);
    if (v > 0) td += v; else tc -= v;
  }
  rows.push(['TOTAL', formatMoney(td, { dollarSign: true }), formatMoney(tc, { dollarSign: true })]);
  return rows.map((r) => r.map((c) => esc(c)).join(',')).join('\n');
}
