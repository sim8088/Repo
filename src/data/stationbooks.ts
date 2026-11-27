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
 * - The latest bank balance snapshot sets the Trustmark balance on its date.
 *
 * No real data lives in the repo: the snapshot is supplied at runtime (a file the CFO loads, or a
 * private preview build).
 */
import { Books } from '../core/books';
import type { Account, AccountType, BooksState, LineOfBusiness, Party, PartyType } from '../core/types';
import type { FuelGrade } from '../core/fuelTypes';
import { fuelOf } from '../core/fuel';
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
  bankBalance?: { date: string; cents: number };
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
  const report: ImportReport = { exportedAt: snap.exportedAt, posted: 0, skippedOtherBusinesses: [], skippedOther: [], from: '', to: '', accountsCreated: 0, fuelSaleRows: 0 };
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
    if (!report.from || t.date < report.from) report.from = t.date;
    if (!report.to || t.date > report.to) report.to = t.date;
    const g = GRADE[(cats.get(t.categoryId)?.name ?? '').toLowerCase()];
    if (t.type === 'SALE' && g?.grade && t.gallons && t.gallons > 0 && groupOf(t.categoryId) === 'Fuel Sales') {
      if (g.truck) fuel.comdata.push({ id: books.nextId('cd'), storeId, date: t.date, gallons: t.gallons, sales: amt, transactions: 0, batchId: 'stationbooks', key: `${storeId}|${t.date}|${tx.id}` });
      else fuel.sales.push({ id: books.nextId('fs'), storeId, date: t.date, grade: g.grade, gallons: t.gallons, retail: amt, txnId: tx.id, batchId: 'stationbooks' });
      report.fuelSaleRows += 1;
    }
  }
  report.skippedOtherBusinesses = [...skippedBiz].map(([code, txns]) => ({ code, txns }));
  report.accountsCreated = created;

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

  state.audit = [{ id: books.nextId('aud'), at: snap.exportedAt, userId: cfo.id, action: 'data', objectType: 'data', objectId: 'stationbooks', summary: `Loaded the StationBooks export of ${snap.exportedAt.slice(0, 10)}: ${report.posted} transactions ${report.from} – ${report.to}` }];
  state.source = { kind: 'stationbooks', exportedAt: snap.exportedAt, report };
  // StationBooks never tracked month-end closes: the checklist starts with the month of the export.
  state.settings.closeFrom = snap.exportedAt.slice(0, 7);
  return { state, report };
}
