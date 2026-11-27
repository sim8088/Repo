/**
 * StationBooks importer: turn a StationBooks database export (the CFO's existing single-entry P&L
 * portal) into this portal's double-entry books.
 *
 * - Stores are matched by code (HM11, HM13, …, CORP). Ledgers for other businesses (personal,
 *   related companies) are left out of the company books and listed in the import report.
 * - Every StationBooks category becomes an account with its own name; categories the KPIs depend on
 *   (payroll, rent, utilities, insurance, property tax, card and bank fees, fuel discounts, fuel sales
 *   by grade) map onto the standard accounts so labor %, card fee % and EBITDA compute.
 * - Each SALE / EXPENSE posts as a balanced entry against "Settlement clearing (StationBooks)" at the
 *   same store, because StationBooks records the P&L side only.
 * - Fuel cost stays exactly as booked (its own account), so the accrual basis doesn't swap it out
 *   for an accrual fuel cost the fuel subledger can't compute without invoices and tank data.
 * - Gallons on fuel sales feed the fuel module (Diesel – COMDATA as the truck lane).
 * - Bank: when the export carries the operating account's bank lines (`bank`), each line posts as a
 *   Trustmark movement against settlement clearing at its store, is stored as a bank-feed line matched
 *   to that posting, and every complete month whose running balance ties is reconciled. Without bank
 *   lines, the latest bank balance snapshot sets the Trustmark balance on its date.
 *
 * No real data lives in the repo: the snapshot is supplied at runtime (a file the CFO loads, or a
 * private preview build).
 */
import { Books } from '../core/books';
import type { Account, AccountType, BooksState, LineOfBusiness, Party, PartyType } from '../core/types';
import type { FuelGrade, FuelInvoice, FuelInvoiceLine } from '../core/fuelTypes';
import { fuelOf } from '../core/fuel';
import { guessDepositSource, saveReconciliation } from '../core/bank';
import type { BankLine, DepositSource, ImportBatch, User } from '../core/types';
import { emptyState, CFO_ID } from './seed';

export interface SBTxn {
  id: string;
  type: 'SALE' | 'EXPENSE';
  amountCents: number;
  categoryId: string;
  storeId: string;
  date: string;
  description?: string;
  notes?: string | null;
  vendorId?: string | null;
  checkNumber?: string | null;
  invoiceNumber?: string | null;
  referenceNumber?: string | null;
  paymentMethod?: string | null;
  settlementDate?: string | null;
  gallons?: number | null;
  costPerGallon?: number | null;
  deletedAt?: string | null;
}

export interface SBSnapshot {
  format: 'stationbooks-export';
  exportedAt: string;
  meta: {
    stores: { items: { id: string; code: string; name: string; isCorporate?: boolean }[] };
    categories: { items: { id: string; name: string; classification: string; parentId: string | null; isFuel?: boolean }[] };
    vendors?: { items: { id: string; name: string; isActive?: boolean }[] };
    settings?: { company?: { name?: string; fiscalYearStartMonth?: number } };
  };
  ledger: { storeId: string; month: string; txns: SBTxn[] }[];
  accounts?: { items: { id: string; kind: string; name: string }[] };
  balances?: { items: { accountId: string; balanceCents: number; date: string; notes?: string }[] };
  parties?: { items: { id: string; name: string; kind: string; notes?: string | null }[] };
  /** The operating bank account's statement lines, oldest first (same-day order as on the statement). */
  bank?: { name?: string; lines: SBBankLine[] };
}

/** One bank statement line. Amount is signed from the bank's view: + in, − out. */
export interface SBBankLine {
  date: string;
  description: string;
  amountCents: number;
  checkNo?: string;
  /** Running balance after this line, when the statement shows one. */
  balanceCents?: number;
  /** How the bookkeeper classified it (e.g. "Store operating", "Owner / family"). */
  bucket?: string;
  /** Store code it belongs to; anything else posts at CORP. */
  store?: string;
  counterparty?: string;
}

export interface ImportReport {
  exportedAt: string;
  posted: number;
  skippedOtherBusinesses: { code: string; txns: number }[];
  skippedOther: string[];
  from: string;
  to: string;
  accountsCreated: number;
  fuelSaleRows: number;
  fuelInvoices: number;
  bankBalance?: { date: string; cents: number };
  bankFeed?: { lines: number; from: string; to: string; opening: number; closing: number; reconciledThrough?: string; skipped: number };
}

const STD: [RegExp, string][] = [
  [/^wages|^bonuses$|^other payroll$/i, 'acct_wages'],
  [/^payroll taxes$/i, 'acct_payroll_taxes'],
  [/^rent$/i, 'acct_rent'],
  [/^(utilities|electricity|water|gas)$/i, 'acct_utilities'],
  [/^insurance$/i, 'acct_insurance'],
  [/^property tax$/i, 'acct_property_tax'],
  [/credit card|merchant fee/i, 'acct_card_fees'],
  [/^bank fees$/i, 'acct_bank_fees'],
  [/^fuel discounts$/i, 'acct_fuel_discounts'],
  [/^depreciation/i, 'acct_depreciation'],
  [/^interest/i, 'acct_interest'],
  // Fuel purchases carry gallons: they become fuel invoices, so their cost sits on 5000 like any fuel invoice.
  [/^fuel purchases/i, 'acct_cogs_fuel'],
];
const GRADE: Record<string, { acct: string; grade: FuelGrade | null; truck?: boolean }> = {
  regular: { acct: 'acct_fuel_regular', grade: 'regular' },
  conventional: { acct: 'acct_fuel_regular', grade: 'regular' },
  plus: { acct: 'acct_fuel_plus', grade: 'plus' },
  premium: { acct: 'acct_fuel_premium', grade: 'premium' },
  supreme: { acct: 'acct_fuel_premium', grade: 'premium' },
  diesel: { acct: 'acct_fuel_diesel', grade: 'diesel' },
  'diesel - comdata': { acct: 'acct_fuel_diesel', grade: 'diesel', truck: true },
};

function lobOf(group: string): LineOfBusiness {
  if (/fuel/i.test(group)) return 'fuel';
  if (/food|kitchen/i.test(group)) return 'kitchen';
  if (/inside|department|merchandise/i.test(group)) return 'inside';
  return 'other';
}

const PARTY_KIND: Record<string, PartyType> = { RELATED_COMPANY: 'related_company', OWNER: 'owner', TENANT: 'tenant', LENDER: 'lender', VENDOR: 'vendor', CUSTOMER: 'customer' };

export function isSnapshot(x: unknown): x is SBSnapshot {
  return !!x && typeof x === 'object' && (x as SBSnapshot).format === 'stationbooks-export' && Array.isArray((x as SBSnapshot).ledger);
}

export function importStationBooks(snap: SBSnapshot): { state: BooksState; report: ImportReport } {
  if (!isSnapshot(snap)) throw new Error('This file is not a StationBooks export. Export it from StationBooks again and load that file.');
  const state = emptyState();
  const clock = { at: snap.exportedAt };
  const books = new Books(state, () => clock.at);
  const cfo = state.users.find((u) => u.id === CFO_ID)!;
  state.settings.companyName = snap.meta.settings?.company?.name ?? state.settings.companyName;
  state.settings.fiscalYearStartMonth = snap.meta.settings?.company?.fiscalYearStartMonth ?? 1;

  // Stores by code.
  const ourByCode = new Map(state.stores.map((s) => [s.code, s.id]));
  const storeMap = new Map<string, string>();
  const otherBusiness = new Map<string, string>();
  for (const s of snap.meta.stores.items) {
    const ours = ourByCode.get(s.code);
    if (ours) storeMap.set(s.id, ours);
    else otherBusiness.set(s.id, s.code);
  }

  // Accounts: standard ones for the KPI-bearing categories, one of their own for the rest.
  const cats = new Map(snap.meta.categories.items.map((c) => [c.id, c]));
  const groupOf = (id: string): string => { let c = cats.get(id); while (c?.parentId && cats.get(c.parentId)) c = cats.get(c.parentId); return c?.name ?? ''; };
  const used = new Set(state.accounts.map((a) => a.number));
  const nextNo: Record<string, number> = { revenue: 41001, contra_revenue: 49001, cogs: 51001, expense: 61001, other_income: 43001, other_expense: 71001 };
  const acctFor = new Map<string, string>();
  let created = 0;
  const accountFor = (catId: string): string => {
    const hit = acctFor.get(catId);
    if (hit) return hit;
    const c = cats.get(catId);
    if (!c) throw new Error(`A transaction uses category ${catId}, which isn't in the export's category list.`);
    const group = groupOf(catId);
    const g = GRADE[c.name.toLowerCase()];
    let id: string | undefined = group === 'Fuel Sales' && g ? g.acct : STD.find(([re]) => re.test(c.name))?.[1];
    if (!id) {
      const kind = c.classification;
      const type: AccountType = kind === 'REVENUE' || kind === 'OTHER_INCOME' ? 'revenue' : kind === 'COGS' ? 'cogs' : 'expense';
      const bucket = kind === 'OTHER_INCOME' ? 'other_income' : kind === 'OTHER_EXPENSE' ? 'other_expense' : type;
      let no = nextNo[bucket];
      while (used.has(String(no))) no += 1;
      nextNo[bucket] = no + 1;
      used.add(String(no));
      id = `acct_sb_${c.id}`;
      const a: Account = { id, number: String(no), name: group && group !== c.name ? `${c.name} (${group})` : c.name, type, subtype: 'general', lob: type === 'expense' ? undefined : kind === 'OTHER_INCOME' ? 'other' : lobOf(group), active: true, description: 'From StationBooks' };
      state.accounts.push(a);
      created += 1;
    }
    acctFor.set(catId, id);
    return id;
  };
  state.accounts.push({ id: 'acct_sb_settlement', number: '1095', name: 'Settlement clearing (StationBooks)', type: 'asset', subtype: 'clearing', active: true, system: true, description: 'The other side of every imported StationBooks sale and expense: StationBooks records the P&L side only.' });

  // Parties: vendors plus related parties.
  const parties: Party[] = [];
  for (const v of snap.meta.vendors?.items ?? []) parties.push({ id: `sb_v_${v.id}`, name: v.name, type: 'vendor', deleted: v.isActive === false || undefined });
  for (const p of snap.parties?.items ?? []) parties.push({ id: `sb_p_${p.id}`, name: p.name, type: PARTY_KIND[p.kind] ?? 'related_company', notes: p.notes ?? undefined });
  state.parties = [...state.parties.filter((p) => p.id === 'pt_trustmark'), ...parties];

  // Transactions.
  const report: ImportReport = { exportedAt: snap.exportedAt, posted: 0, skippedOtherBusinesses: [], skippedOther: [], from: '', to: '', accountsCreated: 0, fuelSaleRows: 0, fuelInvoices: 0 };
  const purchases: { t: SBTxn; storeId: string; txnId: string }[] = [];
  const skippedBiz = new Map<string, number>();
  const all = snap.ledger.flatMap((d) => d.txns).filter((t) => !t.deletedAt).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const fuel = fuelOf(state);
  for (const t of all) {
    const storeId = storeMap.get(t.storeId);
    if (!storeId) { const code = otherBusiness.get(t.storeId) ?? t.storeId; skippedBiz.set(code, (skippedBiz.get(code) ?? 0) + 1); continue; }
    if (!Number.isSafeInteger(t.amountCents) || t.amountCents === 0) { report.skippedOther.push(`${t.date} ${t.description ?? t.id}: amount is zero or not whole cents`); continue; }
    let acct: string;
    try { acct = accountFor(t.categoryId); } catch (e) { report.skippedOther.push(`${t.date} ${t.description ?? t.id}: ${(e as Error).message}`); continue; }
    // SALE: money in (credit the category); EXPENSE: money out (debit it). A negative amount flips sides.
    const inflow = (t.type === 'SALE') === (t.amountCents > 0);
    const amt = Math.abs(t.amountCents);
    clock.at = `${t.date}T12:00:00.000Z`;
    const memo = [t.notes, t.settlementDate && t.settlementDate !== t.date ? `Settled ${t.settlementDate}` : '', t.paymentMethod ? `Paid by ${t.paymentMethod}` : ''].filter(Boolean).join(' · ') || undefined;
    const tx = books.createTransaction(cfo, {
      date: t.date, kind: inflow ? 'money_in' : 'money_out', description: t.description?.trim() || cats.get(t.categoryId)?.name || 'StationBooks entry',
      memo, partyId: t.vendorId ? `sb_v_${t.vendorId}` : undefined, checkNo: t.checkNumber ?? undefined, docNo: t.invoiceNumber ?? t.referenceNumber ?? undefined,
      tags: ['stationbooks'],
      lines: inflow
        ? [{ accountId: 'acct_sb_settlement', storeId, debit: amt, credit: 0 }, { accountId: acct, storeId, debit: 0, credit: amt }]
        : [{ accountId: acct, storeId, debit: amt, credit: 0 }, { accountId: 'acct_sb_settlement', storeId, debit: 0, credit: amt }],
    }, { source: 'import', batchId: `stationbooks-${snap.exportedAt.slice(0, 10)}` });
    report.posted += 1;
    if (acct === 'acct_cogs_fuel' && t.type === 'EXPENSE' && t.amountCents > 0 && t.gallons && t.gallons > 0) purchases.push({ t, storeId, txnId: tx.id });
    if (!report.from || t.date < report.from) report.from = t.date;
    if (!report.to || t.date > report.to) report.to = t.date;
    const g = GRADE[(cats.get(t.categoryId)?.name ?? '').toLowerCase()];
    if (t.type === 'SALE' && g?.grade && t.gallons && t.gallons > 0 && groupOf(t.categoryId) === 'Fuel Sales') {
      if (g.truck) fuel.comdata.push({ id: books.nextId('cd'), storeId, date: t.date, gallons: t.gallons, sales: amt, transactions: 0, batchId: 'stationbooks', key: `${storeId}|${t.date}|${tx.id}` });
      else fuel.sales.push({ id: books.nextId('fs'), storeId, date: t.date, grade: g.grade, gallons: t.gallons, retail: amt, txnId: tx.id, batchId: 'stationbooks' });
      report.fuelSaleRows += 1;
    }
  }
  // Fuel invoices from the purchases. StationBooks keeps one blended cost per load, so each load is split across
  // grades in the store's gallon mix for that month, all at the load's blended cost per gallon: store-level fuel
  // margin is exact; per-grade margins are approximate.
  const mix = new Map<string, Record<'regular' | 'premium' | 'diesel', number>>();
  const addMix = (storeId: string, month: string, grade: FuelGrade, gal: number) => {
    const k = `${storeId}|${month}`;
    const m = mix.get(k) ?? { regular: 0, premium: 0, diesel: 0 };
    if (grade === 'plus') { m.regular += gal / 2; m.premium += gal / 2; } else m[grade] += gal;
    mix.set(k, m);
  };
  for (const s of fuel.sales) addMix(s.storeId, s.date.slice(0, 7), s.grade, s.gallons);
  for (const c of fuel.comdata) addMix(c.storeId, c.date.slice(0, 7), 'diesel', c.gallons);
  const storeCode = new Map(state.stores.map((s) => [s.id, s.code]));
  for (const { t, storeId, txnId } of purchases) {
    const month = t.date.slice(0, 7);
    const m = mix.get(`${storeId}|${month}`) ?? [...mix.entries()].filter(([k]) => k.startsWith(`${storeId}|`) && k.split('|')[1] < month).sort().at(-1)?.[1] ?? { regular: 1, premium: 0, diesel: 0 };
    const totalMix = m.regular + m.premium + m.diesel || 1;
    const grades = (['regular', 'premium', 'diesel'] as const).filter((g) => m[g] > 0);
    let galLeft = t.gallons!;
    let costLeft = t.amountCents;
    const lines: FuelInvoiceLine[] = grades.map((g, i) => {
      const last = i === grades.length - 1;
      const gal = last ? galLeft : Math.round((t.gallons! * m[g]) / totalMix);
      const cost = last ? costLeft : Math.round((t.amountCents * m[g]) / totalMix);
      galLeft -= gal;
      costLeft -= cost;
      return { grade: g, grossGallons: gal, netGallons: gal, cost };
    });
    const delivered = /Delivered (\d{4}-\d{2}-\d{2})/.exec(t.notes ?? '')?.[1] ?? t.date;
    const inv: FuelInvoice = {
      id: books.nextId('fi'), supplier: /^HM1[13]$/.test(storeCode.get(storeId) ?? '') ? 'craddock' : 'dash', storeId,
      invoiceNo: t.invoiceNumber ?? undefined, bolNo: t.referenceNumber ?? '', deliveredOn: delivered < t.date ? delivered : t.date, dueOn: t.date,
      lines, freight: 0, taxes: 0, total: t.amountCents, attachments: [], settlement: { kind: 'imported', on: t.date, txnId },
      batchId: 'stationbooks', source: 'import', createdAt: snap.exportedAt, createdBy: cfo.id,
    };
    fuel.invoices.push(inv);
    report.fuelInvoices += 1;
  }

  report.skippedOtherBusinesses = [...skippedBiz].map(([code, txns]) => ({ code, txns }));
  report.accountsCreated = created;

  if (snap.bank?.lines.length) importBank(books, cfo, snap, ourByCode, report);
  else {
    // Bank: the latest balance snapshot on the operating account sets Trustmark on that date.
    const bankAcct = snap.accounts?.items.find((a) => a.kind === 'BANK');
    const snapBal = (snap.balances?.items ?? []).filter((b) => b.accountId === bankAcct?.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (snapBal) {
      clock.at = `${snapBal.date}T12:00:00.000Z`;
      books.createTransaction(cfo, {
        date: snapBal.date, kind: 'opening', description: 'Trustmark balance per StationBooks bank snapshot', memo: snapBal.notes ?? undefined, tags: ['stationbooks'],
        lines: [{ accountId: 'acct_trustmark', storeId: 'st_corp', debit: Math.max(snapBal.balanceCents, 0), credit: Math.max(-snapBal.balanceCents, 0) }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: Math.max(-snapBal.balanceCents, 0), credit: Math.max(snapBal.balanceCents, 0) }],
      }, { source: 'import' });
      report.bankBalance = { date: snapBal.date, cents: snapBal.balanceCents };
    }
  }

  state.audit = [{ id: books.nextId('aud'), at: snap.exportedAt, userId: cfo.id, action: 'data', objectType: 'data', objectId: 'stationbooks', summary: `Loaded the StationBooks export of ${snap.exportedAt.slice(0, 10)}: ${report.posted} transactions ${report.from} – ${report.to}` }];
  state.source = { kind: 'stationbooks', exportedAt: snap.exportedAt, report };
  // StationBooks never tracked month-end closes: the checklist starts with the month of the export.
  state.settings.closeFrom = snap.exportedAt.slice(0, 7);
  return { state, report };
}

const dayBefore = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const monthEnd = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);

/**
 * Post the bank lines: opening balance the day before the first line, then one Trustmark movement per line
 * against settlement clearing at its store, each stored as a matched bank-feed line. Complete months whose
 * running balance ties are reconciled at their month-end balance.
 */
function importBank(books: Books, cfo: User, snap: SBSnapshot, byCode: Map<string, string>, report: ImportReport) {
  const state = books.state;
  const acct = 'acct_trustmark';
  const src = snap.bank!.lines.map((l, i) => ({ l, i })).filter(({ l }) => Number.isSafeInteger(l.amountCents) && l.amountCents !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(l.date));
  src.sort((a, b) => a.l.date.localeCompare(b.l.date) || a.i - b.i);
  const lines = src.map((x) => x.l);
  const first = lines[0];
  const opening = first.balanceCents !== undefined ? first.balanceCents - first.amountCents : 0;
  const openDate = dayBefore(first.date);
  const at = (d: string) => { books.clock = () => `${d}T12:00:00.000Z`; };
  at(openDate);
  if (opening) {
    books.createTransaction(cfo, {
      date: openDate, kind: 'opening', description: `${snap.bank!.name ?? 'Trustmark'} opening balance per bank statement`, tags: ['stationbooks', 'bank'],
      lines: [{ accountId: acct, storeId: 'st_corp', debit: Math.max(opening, 0), credit: Math.max(-opening, 0) }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: Math.max(-opening, 0), credit: Math.max(opening, 0) }],
    }, { source: 'import' });
  }
  state.bank.openings[acct] = { date: openDate, balance: opening };
  const batches = new Map<string, ImportBatch>();
  const feed: BankLine[] = [];
  let running = opening;
  const monthBal = new Map<string, { computed: number; stated?: number }>();
  for (const l of lines) {
    const m = l.date.slice(0, 7);
    let batch = batches.get(m);
    if (!batch) {
      batch = { id: books.nextId('imp'), accountId: acct, fileName: `${snap.bank!.name ?? 'Trustmark'} ${m} (bank bookkeeping)`, format: 'csv', importedAt: snap.exportedAt, by: cfo.id, added: 0, skipped: 0, totalIn: 0, totalOut: 0, from: l.date, to: l.date };
      batches.set(m, batch);
    }
    at(l.date);
    const storeId = (l.store && byCode.get(l.store)) || 'st_corp';
    const inflow = l.amountCents > 0;
    const amt = Math.abs(l.amountCents);
    const memo = [l.bucket, l.counterparty && !/^see /i.test(l.counterparty) ? l.counterparty : ''].filter(Boolean).join(' · ') || undefined;
    const tx = books.createTransaction(cfo, {
      date: l.date, kind: inflow ? 'money_in' : 'money_out', description: l.checkNo ? `CHECK ${l.checkNo}` : l.description.trim() || 'Bank line', memo, checkNo: l.checkNo || undefined,
      tags: ['stationbooks', 'bank'],
      lines: inflow
        ? [{ accountId: acct, storeId: 'st_corp', debit: amt, credit: 0 }, { accountId: 'acct_sb_settlement', storeId, debit: 0, credit: amt }]
        : [{ accountId: 'acct_sb_settlement', storeId, debit: amt, credit: 0 }, { accountId: acct, storeId: 'st_corp', debit: 0, credit: amt }],
    }, { source: 'import', batchId: batch.id });
    const bankSide = tx.lines.find((x) => x.accountId === acct && !x.system)!;
    feed.push({
      id: books.nextId('bl'), accountId: acct, date: l.date, description: l.description.trim(), amount: l.amountCents, checkNo: l.checkNo || undefined,
      hash: `sb:${l.date}:${l.amountCents}:${l.checkNo ?? ''}:${feed.length}`, batchId: batch.id, source: inflow ? guessDepositSource(l.description) ?? sourceFromBucket(l.bucket) : undefined, matchedLineIds: [bankSide.id],
    });
    batch.added += 1;
    if (inflow) batch.totalIn += amt; else batch.totalOut += amt;
    batch.to = l.date;
    running += l.amountCents;
    monthBal.set(m, { computed: running, stated: l.balanceCents });
  }
  state.bank.lines.push(...feed);
  state.bank.batches.push(...batches.values());
  for (const b of batches.values()) b.statementBalance = monthBal.get(b.from.slice(0, 7))?.stated;
  // Reconcile each complete month whose last stated balance agrees with the lines (same-day order can
  // differ from the bank's, so only the month-end balance is compared).
  const lastMonth = lines.at(-1)!.date.slice(0, 7);
  let through: string | undefined;
  for (const [m, b] of monthBal) {
    if (m >= lastMonth || (b.stated !== undefined && b.stated !== b.computed)) continue;
    const date = monthEnd(m);
    at(date);
    try { saveReconciliation(books, cfo, acct, date, b.computed); through = date; } catch { break; }
  }
  report.bankFeed = { lines: feed.length, from: first.date, to: lines.at(-1)!.date, opening, closing: running, reconciledThrough: through, skipped: snap.bank!.lines.length - lines.length };
  report.bankBalance = { date: lines.at(-1)!.date, cents: running };
}

/** Where a deposit came from, from the bookkeeper's bucket when the bank description doesn't say. */
function sourceFromBucket(bucket?: string): DepositSource {
  const b = bucket ?? '';
  if (/sales settlement/i.test(b)) return 'card_settlement';
  if (/^deposit/i.test(b)) return 'store_cash';
  if (/between own|transfer/i.test(b)) return 'transfer';
  if (/owner|family/i.test(b)) return 'owner_contribution';
  if (/bounced|money back|refund/i.test(b)) return 'refund';
  if (/dhunna|non-store|related/i.test(b)) return 'related_repayment';
  return 'other';
}
