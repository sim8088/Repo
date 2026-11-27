import type { Books } from './books';
import { ValidationError } from './books';
import type {
  AdjKind, AssetClass, BooksState, Entity, EntityTaxProfile, EstimatePayment, EstimatePlan, FixedAsset, ID, InventoryMethod, M1Line, MethodChange,
  OwnerStart, ReceiptsYear, TaxAdjustment, TaxClass, TaxDepreciation, TaxRates, TaxState, TaxYearInput, Transaction, User, ComplianceKind, LeverKey,
} from './types';
import { allocate, formatMoney, type Cents } from './money';
import { addDays, daysBetween, isValidDate, lastDayOfPeriod, periodOf } from './dates';
import { isPnl } from './ledger';
import { trialBalance } from './reports';
import { assetsOf, ensureAssets, scheduledAccum, lastClosedPeriod } from './assets';
import { ownerDraws } from './intercompany';
import { bankStoreId } from './bank';
import { departments, D } from './inside';
import { statement } from './statements';
import { complianceOf, dueDates, occurrences, STATUS_LABEL, KIND_LABEL, type OccurrenceRow } from './compliance';

/**
 * Phase 11 — tax working papers. This is a working-papers tool for the CPA, not tax advice: every rate, life and
 * threshold is a configurable table with a current-law default, labeled "verify with your CPA". Nothing is filed.
 */
export const DISCLAIMER = 'Working papers only, not tax advice. Rates, lives and thresholds are configurable defaults: verify every one with your CPA. Nothing here files a return.';

export const CLASS_FORM: Record<TaxClass, string> = {
  partnership_1065: 'Form 1065', s_corp_1120s: 'Form 1120-S', c_corp_1120: 'Form 1120', disregarded: 'Disregarded (on the parent return)',
};
export const CLASS_LABEL_TAX: Record<TaxClass, string> = {
  partnership_1065: 'Partnership', s_corp_1120s: 'S corporation', c_corp_1120: 'C corporation', disregarded: 'Disregarded entity',
};
export const INVENTORY_LABEL: Record<InventoryMethod, string> = {
  fifo: 'FIFO at cost', lifo: 'LIFO', average: 'Average cost', retail: 'Retail method', books_471c: 'Per books (§471(c) small business)',
};
export const ADJ_LABEL: Record<AdjKind, string> = {
  depreciation: 'Depreciation: book vs tax', meals: 'Meals: 50% not deductible', penalties: 'Penalties & fines: not deductible', owner: 'Owner items booked as expense',
  accrual_to_cash: 'Accrual to cash (cash-method returns)', other: 'Other',
};
export const M1_LABEL: Record<M1Line, string> = {
  income_not_booked: 'Income on the return not recorded on the books (line 2)',
  expense_not_deducted: 'Expenses on the books not deducted on the return (line 3)',
  income_not_taxed: 'Income on the books not on the return (line 5)',
  deduction_not_booked: 'Deductions on the return not charged against book income (line 6)',
};
export const LEVER_LABEL: Record<LeverKey, string> = {
  equipment: 'Buy equipment before year end (bonus / §179)', elect_bonus: 'Elect bonus on this year\'s assets that don\'t have it', retirement: 'Retirement plan contributions (employer)',
  salary: 'Owner salary change (S corporation, + raises, − lowers)', restructure: 'Entity restructuring (C corporation comparison, information only)',
};

/** Current-law defaults (2026 tax year, as understood when this was built). Verify with your CPA. */
export const DEFAULT_MACRS_YEARS: Record<AssetClass, number> = {
  dispensers: 5, canopy: 15, tanks: 15, coolers: 5, kitchen: 5, pos: 5, equipment: 7, fixtures: 5, building_improvements: 15, building: 39, land: 0,
};
export const DEFAULT_TAX_RATES: TaxRates = {
  ownerFederalBps: 3700, ownerStateBps: 440, cCorpBps: 2100, pteBps: 440, ficaBps: 1530,
  salesTaxBps: 700, taxableDeptIds: [], fuelTaxable: false,
  grossReceiptsThreshold: 3_100_000_000, section179Limit: 250_000_000, section179Phaseout: 400_000_000, bonusPct: 100,
  mealsDisallowBps: 5000, safeHarborAgi: 15_000_000, macrsYears: DEFAULT_MACRS_YEARS,
};
/** Where each tax default comes from, shown beside the table. */
export const RATE_NOTES: Partial<Record<keyof TaxRates, string>> = {
  ownerFederalBps: 'Top individual bracket; use each owner\'s marginal rate.',
  ownerStateBps: 'State individual rate (demo default).',
  cCorpBps: 'Federal corporate rate.',
  pteBps: 'Elective pass-through entity tax rate (demo default).',
  ficaBps: 'Employer + employee Social Security and Medicare below the wage base.',
  salesTaxBps: 'State sales tax rate on inside-store and kitchen sales (local add-ons not modeled).',
  grossReceiptsThreshold: '§448(c) 3-year average; indexed for inflation each year.',
  section179Limit: '§179 expensing limit; indexed.',
  section179Phaseout: 'The limit phases out dollar for dollar above this much property placed in service.',
  bonusPct: 'Bonus depreciation % for qualified property acquired and placed in service this year.',
  mealsDisallowBps: 'Business meals: 50% not deductible.',
  safeHarborAgi: 'Prior-year AGI above this: the estimate safe harbor is 110% of last year\'s tax.',
};

export const TAX_KINDS: ComplianceKind[] = ['income_tax', 'state_income', 'estimated_tax', 'payroll', 'sales_tax', 'fuel_excise', 'tobacco_excise', 'property_tax', 'info_1099', 'w2', 'annual_report'];
/** Where each kind's detail lives in the portal. */
export const KIND_LINK: Partial<Record<ComplianceKind, { to: string; label: string }>> = {
  payroll: { to: '/people/taxes', label: 'Payroll tax tracker' }, w2: { to: '/people/taxes', label: 'W-2 checklist' }, info_1099: { to: '/payables/1099', label: '1099 vendors' },
  sales_tax: { to: '/tax/sales-tax', label: 'Sales tax worksheet' }, estimated_tax: { to: '/tax/estimates', label: 'Estimates' },
  income_tax: { to: '/tax/book-to-tax', label: 'Book-to-tax' }, state_income: { to: '/tax/book-to-tax', label: 'Book-to-tax' }, property_tax: { to: '/assets/prepaids', label: 'Prepaids' },
};

export const MEALS_ACCT = 'acct_meals';
export const PENALTY_ACCT = 'acct_penalties';
export const ENTITY_TAX_ACCT = 'acct_income_taxes';
export const SALES_TAX_ACCT = 'acct_sales_tax';

// ── Slice ────────────────────────────────────────────────────────────────
export function emptyTax(): TaxState {
  return { profiles: [], rates: {}, adjustments: [], years: [], owners: [], plans: [], payments: [], methodChanges: [], receipts: [], levers: {} };
}

/** Books saved before phase 11 have no tax slice: read it as empty. */
export function taxOf(state: BooksState): TaxState {
  return { ...emptyTax(), ...(state.tax ?? {}) };
}

function ensureTax(books: Books): TaxState {
  if (!books.state.tax) books.state.tax = emptyTax();
  const t = books.state.tax;
  for (const k of ['profiles', 'adjustments', 'years', 'owners', 'plans', 'payments', 'methodChanges', 'receipts'] as const) if (!t[k]) (t as unknown as Record<string, unknown[]>)[k] = [];
  if (!t.rates) t.rates = {};
  if (!t.levers) t.levers = {};
  return t;
}

export function ratesOf(state: BooksState): TaxRates {
  const o = taxOf(state).rates;
  const defaultDepts = departments(state).filter((d) => d.inPosClose && d.id !== D.lottery).map((d) => d.id);
  return {
    ...DEFAULT_TAX_RATES, ...o,
    taxableDeptIds: o.taxableDeptIds ?? defaultDepts,
    macrsYears: { ...DEFAULT_MACRS_YEARS, ...(o.macrsYears ?? {}) },
  };
}

const errs = (xs: string[]) => new ValidationError(xs);
const money = (c: Cents) => formatMoney(c, { dollarSign: true });
const pctOf = (c: Cents, bps: number) => Math.round((c * bps) / 10_000);
const hub = (state: BooksState) => state.entities.find((e) => e.isHub && !e.deleted) ?? state.entities[0];

/** An EIN shown masked: the last four digits only. */
export function maskEin(ein?: string): string {
  if (!ein) return 'Not entered';
  const d = ein.replace(/\D/g, '');
  return d.length >= 4 ? `••-•••${d.slice(-4)}` : '••-•••••••';
}

// ── Entity map ───────────────────────────────────────────────────────────
export function profileOf(state: BooksState, entityId: ID): EntityTaxProfile {
  const p = taxOf(state).profiles.find((x) => x.entityId === entityId);
  const e = state.entities.find((x) => x.id === entityId);
  const base: EntityTaxProfile = {
    entityId, owners: [], states: [], fiscalYearEndMonth: 12, priorReturns: [], method: 'accrual', inventoryMethod: 'fifo',
    parentEntityId: e?.taxClass === 'disregarded' && !e.isHub ? hub(state)?.id : undefined,
  };
  return p ? { ...base, ...p } : base;
}

/** The entity whose return carries this entity's income: itself, or the parent of a disregarded entity. */
export function returnEntityOf(state: BooksState, entityId: ID): ID {
  const e = state.entities.find((x) => x.id === entityId);
  if (!e || e.taxClass !== 'disregarded') return entityId;
  const parent = profileOf(state, entityId).parentEntityId;
  if (!parent || parent === entityId) return entityId;
  return returnEntityOf(state, parent);
}

export interface ReturnUnit { entity: Entity; members: ID[]; storeIds: ID[]; form: string }

/** Every return: entities that file, each with the disregarded entities on it. */
export function returnUnits(state: BooksState): ReturnUnit[] {
  const live = state.entities.filter((e) => !e.deleted);
  const m = new Map<ID, ID[]>();
  for (const e of live) { const r = returnEntityOf(state, e.id); m.set(r, [...(m.get(r) ?? []), e.id]); }
  return [...m].map(([rid, members]) => {
    const entity = live.find((e) => e.id === rid)!;
    const storeIds = state.stores.filter((s) => !s.deleted && members.includes(s.entityId)).map((s) => s.id);
    return { entity, members, storeIds, form: CLASS_FORM[entity.taxClass] };
  }).filter((u) => u.entity).sort((a, b) => (b.entity.isHub ? 1 : 0) - (a.entity.isHub ? 1 : 0) || a.entity.code.localeCompare(b.entity.code));
}

export function returnUnit(state: BooksState, entityId: ID): ReturnUnit {
  const rid = returnEntityOf(state, entityId);
  return returnUnits(state).find((u) => u.entity.id === rid) ?? returnUnits(state)[0];
}

export function validateProfile(state: BooksState, p: EntityTaxProfile): string[] {
  const out: string[] = [];
  const e = state.entities.find((x) => x.id === p.entityId);
  if (!e) out.push('That entity no longer exists.');
  const owners = new Set(state.parties.filter((x) => x.type === 'owner' && !x.deleted).map((x) => x.id));
  if (p.owners.some((o) => !owners.has(o.partyId))) out.push('Each owner must be a party of type Owner (Setup › Vendors & parties).');
  if (new Set(p.owners.map((o) => o.partyId)).size !== p.owners.length) out.push('List each owner once.');
  if (p.owners.some((o) => !Number.isInteger(o.pctBps) || o.pctBps <= 0)) out.push('Give every owner a percentage above zero.');
  const total = p.owners.reduce((a, o) => a + o.pctBps, 0);
  if (p.owners.length && total !== 10_000) out.push(`Ownership adds to ${(total / 100).toFixed(2)}%. Make it add to exactly 100%.`);
  if (p.parentEntityId && !state.entities.some((x) => x.id === p.parentEntityId)) out.push('Choose the parent entity, or leave it blank.');
  if (p.parentEntityId === p.entityId) out.push('An entity cannot be its own parent.');
  if (p.parentEntityId && e?.taxClass !== 'disregarded') out.push('Only a disregarded entity has a parent return. Change the classification in Setup › Entities first.');
  if (!(p.fiscalYearEndMonth >= 1 && p.fiscalYearEndMonth <= 12)) out.push('Pick the month the fiscal year ends.');
  if (p.states.some((s) => !s.state.trim())) out.push('Each state registration needs the state.');
  if (p.priorReturns.some((r) => !(r.year > 1900) || (!r.location.trim() && !r.docId))) out.push('Each prior return needs a year and where it is kept (a vault document or a note).');
  return out;
}

export function saveTaxProfile(books: Books, actor: User, p: EntityTaxProfile): EntityTaxProfile {
  books.require(actor, 'tax.edit', 'change the entity tax map');
  const problems = validateProfile(books.state, p);
  if (problems.length) throw errs(problems);
  const t = ensureTax(books);
  const i = t.profiles.findIndex((x) => x.entityId === p.entityId);
  const before = i >= 0 ? structuredClone(t.profiles[i]) : undefined;
  const clean: EntityTaxProfile = { ...p, preparer: p.preparer?.trim() || undefined, notes: p.notes?.trim() || undefined, states: p.states.map((s) => ({ state: s.state.trim(), kind: s.kind.trim(), accountNo: s.accountNo.trim() })) };
  if (i >= 0) t.profiles[i] = clean; else t.profiles.push(clean);
  const code = books.state.entities.find((e) => e.id === p.entityId)?.code;
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'tax', objectId: p.entityId, summary: `Updated the tax profile for ${code}`, before, after: structuredClone(clean) });
  books.changed();
  return clean;
}

// ── MACRS percentage tables ──────────────────────────────────────────────
export type Convention = 'half_year' | 'mid_quarter' | 'mid_month';
const roundHalfUp = (x: number) => Math.floor(x + 0.5 + 1e-9);

/**
 * GDS percentage table, as published in IRS Pub 946 (Tables A-1 to A-5): 200% declining balance for 3/5/7/10-year
 * property, 150% for 15/20-year, switching to straight line when that is larger. Each year's rate is rounded to
 * 0.01% on what is left (the way the published tables are built), and the last year takes the remainder.
 * `placed` is the quarter (1–4) for mid-quarter; ignored for half-year. Returns percents (e.g. 14.29).
 */
export function macrsTable(years: number, conv: 'half_year' | 'mid_quarter', placed = 1): number[] {
  if (![3, 5, 7, 10, 15, 20].includes(years)) throw new Error(`No GDS table for ${years}-year property.`);
  const factor = years >= 15 ? 1.5 : 2;
  const first = conv === 'half_year' ? 0.5 : (4 - placed + 0.5) / 4;
  const out: number[] = [];
  let rem = 10_000;
  out.push(roundHalfUp((rem * factor * first) / years));
  rem -= out[0];
  for (let k = 2; rem > 0; k++) {
    const remLife = years - (first + (k - 2));
    if (remLife <= 1) { out.push(rem); rem = 0; break; }
    const amt = Math.min(rem, roundHalfUp(Math.max((rem * factor) / years, rem / remLife)));
    out.push(amt);
    rem -= amt;
  }
  return out.map((v) => v / 100);
}

/**
 * Straight line, mid-month (nonresidential real property, Table A-7a for 39 years). Middle years are 100/N rounded
 * to 0.001%; the first year is the half month plus each full month left (each rounded the same way); the last
 * year takes the remainder. `placed` is the month (1–12). Returns percents (e.g. 2.461).
 */
export function slMidMonthTable(years: number, placed: number): number[] {
  const r = Math.round(100_000 / years); // thousandths of a percent
  const half = Math.round((r * 0.5) / 12);
  const month = Math.round(r / 12);
  const first = half + (12 - placed) * month;
  const middle = Math.floor(years) - (Number.isInteger(years) ? 1 : 0);
  const out = [first, ...Array.from({ length: middle }, () => r)];
  out.push(100_000 - out.reduce((a, b) => a + b, 0));
  return out.filter((v, i) => v > 0 || i < out.length - 1).map((v) => v / 1000);
}

/** Straight line with the half-year or mid-quarter convention over N years (an election instead of declining balance). */
export function slTable(years: number, conv: 'half_year' | 'mid_quarter', placed = 1): number[] {
  const first = conv === 'half_year' ? 0.5 : (4 - placed + 0.5) / 4;
  const out: number[] = [roundHalfUp((10_000 * first) / years)];
  let rem = 10_000 - out[0];
  for (let k = 2; rem > 0; k++) {
    const remLife = years - (first + (k - 2));
    const amt = remLife <= 1 ? rem : Math.min(rem, roundHalfUp(rem / remLife));
    out.push(amt);
    rem -= amt;
  }
  return out.map((v) => v / 100);
}

// ── Tax depreciation per asset ───────────────────────────────────────────
export interface TaxSetup {
  method: 'macrs' | 'straight_line' | 'none';
  years: number;
  /** 'auto' = half-year, or mid-quarter when the 40% test applies; real property is mid-month. */
  convention: Convention | 'auto';
  section179: Cents;
  bonusPct: number;
  qip: boolean;
  costSeg: boolean;
  /** True when the asset has no elections recorded (defaults by class). */
  defaulted: boolean;
  notes?: string;
}

const isRealYears = (y: number) => y >= 27.5;

/** The asset's tax setup: its recorded elections over the class defaults. */
export function taxSetup(state: BooksState, a: FixedAsset): TaxSetup {
  const rates = ratesOf(state);
  const t: TaxDepreciation | undefined = a.tax;
  const qip = !!t?.qip;
  const classYears = qip ? 15 : rates.macrsYears[a.class] ?? 7;
  const years = t?.recoveryYears ?? classYears;
  let method: TaxSetup['method'] = years <= 0 || a.class === 'land' ? 'none' : isRealYears(years) ? 'straight_line' : 'macrs';
  if (t?.method === 'none') method = 'none';
  else if (t?.method === 'straight_line') method = 'straight_line';
  const bonusPct = t?.bonusPct ?? (t?.method === 'bonus' ? rates.bonusPct : 0);
  return {
    method, years, convention: t?.convention ?? (isRealYears(years) ? 'mid_month' : 'auto'),
    section179: Math.min(t?.section179 ?? 0, a.cost), bonusPct, qip, costSeg: !!t?.costSegFlag || a.class === 'building' || a.class === 'land',
    defaulted: !t, notes: t?.notes,
  };
}

const yearOf = (d: string) => Number(d.slice(0, 4));
const quarterOfDate = (d: string) => Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;

/** The return an asset's depreciation is claimed on. */
export function assetReturn(state: BooksState, a: FixedAsset): ID {
  const ent = state.stores.find((s) => s.id === a.storeId)?.entityId ?? hub(state).id;
  return returnEntityOf(state, ent);
}

/**
 * The mid-quarter test (§168(d)(3)): when more than 40% of the depreciable basis of personal property placed in
 * service during the year (after §179, before bonus) went in during the last quarter, every such asset that year
 * uses the mid-quarter convention.
 */
export function midQuarterTest(state: BooksState, returnId: ID, year: number): { q4: Cents; total: Cents; share: number; applies: boolean } {
  let q4 = 0, total = 0;
  for (const a of assetsOf(state).assets) {
    if (yearOf(a.inService) !== year || assetReturn(state, a) !== returnId) continue;
    const s = taxSetup(state, a);
    if (s.method === 'none' || isRealYears(s.years)) continue;
    const basis = a.cost - s.section179;
    total += basis;
    if (quarterOfDate(a.inService) === 4) q4 += basis;
  }
  const share = total ? q4 / total : 0;
  return { q4, total, share, applies: share > 0.4 };
}

export function resolvedConvention(state: BooksState, a: FixedAsset, s = taxSetup(state, a)): Convention {
  if (s.convention !== 'auto') return s.convention;
  if (isRealYears(s.years)) return 'mid_month';
  return midQuarterTest(state, assetReturn(state, a), yearOf(a.inService)).applies ? 'mid_quarter' : 'half_year';
}

/** The percentage table that applies to this asset (percent per year from the year placed in service). */
export function assetTable(state: BooksState, a: FixedAsset, s = taxSetup(state, a)): number[] {
  if (s.method === 'none') return [];
  const conv = resolvedConvention(state, a, s);
  if (conv === 'mid_month' || isRealYears(s.years)) return slMidMonthTable(s.years, Number(a.inService.slice(5, 7)));
  const q = quarterOfDate(a.inService);
  if (s.method === 'straight_line' || ![3, 5, 7, 10, 15, 20].includes(s.years)) return slTable(s.years, conv === 'mid_quarter' ? 'mid_quarter' : 'half_year', q);
  return macrsTable(s.years, conv === 'mid_quarter' ? 'mid_quarter' : 'half_year', q);
}

export interface TaxYearRow { year: number; section179: Cents; bonus: Cents; regular: Cents; total: Cents; accumulated: Cents; taxBasisLeft: Cents }

/** The tax depreciation schedule, year by year: §179 and bonus in the first year, then MACRS on what is left. */
export function taxSchedule(state: BooksState, a: FixedAsset): TaxYearRow[] {
  const s = taxSetup(state, a);
  if (s.method === 'none') return [];
  const y0 = yearOf(a.inService);
  const s179 = s.section179;
  const bonus = Math.round(((a.cost - s179) * s.bonusPct) / 100);
  const basis = a.cost - s179 - bonus;
  const table = assetTable(state, a, s);
  const conv = resolvedConvention(state, a, s);
  const rows: TaxYearRow[] = [];
  let cumPct = 0, acc = 0, prevRegCum = 0;
  const dispYear = a.disposal ? yearOf(a.disposal.date) : Infinity;
  const n = Math.max(table.length, 1);
  for (let i = 0; i < n; i++) {
    const year = y0 + i;
    if (year > dispYear) break;
    cumPct += table[i] ?? 0;
    const regCum = Math.round((basis * Math.min(cumPct, 100)) / 100);
    let regular = regCum - prevRegCum;
    prevRegCum = regCum;
    let first179 = i === 0 ? s179 : 0;
    let firstBonus = i === 0 ? bonus : 0;
    if (year === dispYear) {
      if (i === 0) { regular = 0; first179 = 0; firstBonus = 0; }
      else {
        const d = a.disposal!.date;
        const frac = conv === 'mid_month' ? (Number(d.slice(5, 7)) - 0.5) / 12 : conv === 'mid_quarter' ? (quarterOfDate(d) - 0.5) / 4 : 0.5;
        regular = Math.round(regular * frac);
      }
    }
    const total = first179 + firstBonus + regular;
    acc += total;
    rows.push({ year, section179: first179, bonus: firstBonus, regular, total, accumulated: acc, taxBasisLeft: a.cost - acc });
  }
  return rows;
}

export function taxDepForYear(state: BooksState, a: FixedAsset, year: number): TaxYearRow {
  return taxSchedule(state, a).find((r) => r.year === year) ?? { year, section179: 0, bonus: 0, regular: 0, total: 0, accumulated: taxSchedule(state, a).filter((r) => r.year < year).reduce((x, r) => x + r.total, 0), taxBasisLeft: 0 };
}

/** Book depreciation for a calendar year from the register, through `throughPeriod` (YYYY-MM). */
export function bookDepForYear(a: FixedAsset, year: number, throughPeriod = `${year}-12`): Cents {
  const end = throughPeriod < `${year}-12` ? throughPeriod : `${year}-12`;
  if (end < `${year}-01`) return 0;
  return scheduledAccum(a, end) - scheduledAccum(a, `${year - 1}-12`);
}

export interface BookTaxRow {
  a: FixedAsset;
  setup: TaxSetup;
  convention: Convention | null;
  returnId: ID;
  /** Book depreciation this year through the last closed month. */
  book: Cents;
  /** Book depreciation for the whole year by the schedule (projection). */
  bookFullYear: Cents;
  tax: TaxYearRow;
  /** book − tax: + raises taxable income. */
  difference: Cents;
  bookAccum: Cents;
  taxAccum: Cents;
  flags: string[];
}

/** Book and tax side by side for every asset, for one tax year. */
export function bookVsTax(state: BooksState, opts: { year: number; asOf: string; returnId?: ID; visible?: Set<ID> }): BookTaxRow[] {
  const through = lastClosedPeriod(opts.asOf);
  const rates = ratesOf(state);
  return assetsOf(state).assets.filter((a) => (!opts.visible || opts.visible.has(a.storeId)) && (!opts.returnId || assetReturn(state, a) === opts.returnId) && yearOf(a.inService) <= opts.year).map((a) => {
    const setup = taxSetup(state, a);
    const tax = taxDepForYear(state, a, opts.year);
    const book = bookDepForYear(a, opts.year, through);
    const flags: string[] = [];
    if (setup.defaulted) flags.push('No elections recorded: class defaults used. Confirm against the prior returns.');
    if (a.class === 'building' && a.method === 'none') flags.push('Pending cost segregation: split land (not depreciable) from building (39-year, or 15-year as a retail motor fuels outlet), and pull canopies, USTs and site work out to 15-year.');
    else if (setup.costSeg) flags.push('Cost-segregation candidate: confirm the shorter lives with the study.');
    if (['canopy', 'tanks'].includes(a.class) && setup.years > 15) flags.push(`${a.class === 'canopy' ? 'Canopies' : 'USTs'} are usually 15-year property; this one is set to ${setup.years}.`);
    if (setup.bonusPct > 0 && isRealYears(setup.years) && !setup.qip) flags.push('Bonus is not allowed on 39-year real property (QIP excepted).');
    if (setup.section179 && (a.class === 'building' || a.class === 'land') && !setup.qip) flags.push('§179 is not allowed on buildings or land.');
    if (setup.bonusPct && setup.bonusPct !== rates.bonusPct && yearOf(a.inService) === opts.year) flags.push(`Bonus ${setup.bonusPct}% differs from the table's ${rates.bonusPct}%.`);
    return {
      a, setup, convention: setup.method === 'none' ? null : resolvedConvention(state, a, setup), returnId: assetReturn(state, a),
      book, bookFullYear: bookDepForYear(a, opts.year), tax, difference: book - tax.total,
      bookAccum: scheduledAccum(a, through < `${opts.year}-12` ? through : `${opts.year}-12`), taxAccum: tax.accumulated, flags,
    };
  });
}

export function validateAssetTax(state: BooksState, a: FixedAsset, t: TaxDepreciation): string[] {
  const out: string[] = [];
  const rates = ratesOf(state);
  if (t.recoveryYears !== undefined && !(t.recoveryYears === 0 || [3, 5, 7, 10, 15, 20, 27.5, 39].includes(t.recoveryYears))) out.push('Pick a recovery period from the MACRS classes: 3, 5, 7, 10, 15, 20, 27.5 or 39 years.');
  if (t.section179 !== undefined && (!Number.isSafeInteger(t.section179) || t.section179 < 0)) out.push('Enter the §179 amount as zero or more.');
  if ((t.section179 ?? 0) > a.cost) out.push(`§179 can't exceed the asset's cost (${money(a.cost)}).`);
  if ((t.section179 ?? 0) > rates.section179Limit) out.push(`§179 is over the limit in the tax tables (${money(rates.section179Limit)}).`);
  if (t.bonusPct !== undefined && !(t.bonusPct >= 0 && t.bonusPct <= 100)) out.push('Bonus is a percentage from 0 to 100.');
  const years = t.recoveryYears ?? (t.qip ? 15 : rates.macrsYears[a.class]);
  if ((a.class === 'building' || a.class === 'land') && !t.qip && ((t.section179 ?? 0) > 0)) out.push('§179 is not allowed on buildings or land. Mark it QIP if it is an interior improvement.');
  if ((t.bonusPct ?? 0) > 0 && (years >= 27.5 || a.class === 'land') && !t.qip) out.push('Bonus is not allowed on 39-year real property or land (QIP is 15-year and eligible).');
  return out;
}

/** Record the tax elections on a Phase 9 asset (`asset.tax`). */
export function saveAssetTax(books: Books, actor: User, assetId: ID, t: TaxDepreciation): FixedAsset {
  books.require(actor, 'tax.edit', 'change tax depreciation elections');
  const a = ensureAssets(books).assets.find((x) => x.id === assetId);
  if (!a) throw errs(['That asset no longer exists.']);
  const problems = validateAssetTax(books.state, a, t);
  if (problems.length) throw errs(problems);
  const before = a.tax ? structuredClone(a.tax) : undefined;
  a.tax = { ...t, notes: t.notes?.trim() || undefined };
  books.audit(actor, { action: 'update', objectType: 'asset', objectId: a.id, summary: `Tax elections for ${a.tag} ${a.name}: ${a.tax.recoveryYears ?? 'class'}-year${a.tax.section179 ? `, §179 ${money(a.tax.section179)}` : ''}${a.tax.bonusPct ? `, bonus ${a.tax.bonusPct}%` : ''}`, before, after: structuredClone(a.tax) });
  books.changed();
  return a;
}

/** The register's book depreciation for months in these books ties to 6400 in the ledger. */
export function bookDepTie(state: BooksState, year: number, asOf: string, storeIds?: Set<ID>): { register: Cents; ledger: Cents; ok: boolean } {
  const from = assetsOf(state).depreciationFrom ?? '0000-00';
  const through = lastClosedPeriod(asOf);
  let register = 0;
  for (const a of assetsOf(state).assets) {
    if (storeIds && !storeIds.has(a.storeId)) continue;
    const start = `${year}-01` > from ? `${year}-01` : from;
    if (start > through) continue;
    const prev = start.slice(5) === '01' ? `${Number(start.slice(0, 4)) - 1}-12` : `${start.slice(0, 4)}-${String(Number(start.slice(5)) - 1).padStart(2, '0')}`;
    register += scheduledAccum(a, through < `${year}-12` ? through : `${year}-12`) - scheduledAccum(a, prev);
  }
  const ledger = acctNet(state, ['acct_depreciation'], storeIds, `${year}-01-01`, minDate(asOf, `${year}-12-31`));
  return { register, ledger, ok: register === ledger };
}

// ── Ledger reads ─────────────────────────────────────────────────────────
const minDate = (a: string, b: string) => (a < b ? a : b);

/** Debits − credits on the accounts, for the stores, between two dates. */
export function acctNet(state: BooksState, accountIds: ID[], storeIds: Set<ID> | undefined, from: string, to: string): Cents {
  const ids = new Set(accountIds);
  let n = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date < from || t.date > to) continue;
    for (const l of t.lines) if (ids.has(l.accountId) && (!storeIds || storeIds.has(l.storeId))) n += l.debit - l.credit;
  }
  return n;
}

/** Book net income (credit-positive) for the stores between two dates. */
export function bookIncome(state: BooksState, storeIds: Set<ID>, from: string, to: string): Cents {
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  let n = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date < from || t.date > to) continue;
    for (const l of t.lines) { const a = acc.get(l.accountId); if (a && isPnl(a) && storeIds.has(l.storeId)) n += l.credit - l.debit; }
  }
  return n;
}

const yearEnd = (y: number) => `${y}-12-31`;
const yearStart = (y: number) => `${y}-01-01`;

export function priorIncomeOf(state: BooksState, entityId: ID, year: number): TaxYearInput | undefined {
  return taxOf(state).years.find((y) => y.entityId === entityId && y.year === year);
}

// ── Book-to-tax workpapers ───────────────────────────────────────────────
export interface AdjRow {
  key: string;
  kind: AdjKind;
  label: string;
  mode: 'auto' | 'manual';
  amount: Cents;
  m1Line: M1Line;
  /** What the amount is made of, in words. */
  basis: string;
  source?: string;
  workpaper: string;
  reviewed?: { by: ID; at: string };
  record?: TaxAdjustment;
  /** The source transactions, where the amount comes from lines. */
  txns: Transaction[];
}

const AUTO_KINDS: AdjKind[] = ['depreciation', 'meals', 'penalties', 'owner', 'accrual_to_cash'];

function lineTxns(state: BooksState, accountIds: ID[], storeIds: Set<ID>, from: string, to: string, pred?: (t: Transaction) => boolean): Transaction[] {
  const ids = new Set(accountIds);
  return state.transactions.filter((t) => !t.deleted && t.date >= from && t.date <= to && t.lines.some((l) => ids.has(l.accountId) && storeIds.has(l.storeId)) && (!pred || pred(t)));
}

/** Every book-to-tax adjustment for a return and year: the standard ones computed from the books, plus manual ones. */
export function adjustments(state: BooksState, entityId: ID, year: number, asOf: string): AdjRow[] {
  const unit = returnUnit(state, entityId);
  const rid = unit.entity.id;
  const stores = new Set(unit.storeIds);
  const from = yearStart(year), to = minDate(asOf, yearEnd(year));
  const rates = ratesOf(state);
  const stored = taxOf(state).adjustments.filter((x) => x.entityId === rid && x.year === year && !x.removed);
  const rec = (kind: AdjKind) => stored.find((x) => x.mode === 'auto' && x.kind === kind);
  const place = (amount: Cents, pos: M1Line, neg: M1Line): M1Line => (amount >= 0 ? pos : neg);
  const rows: AdjRow[] = [];
  const profile = profileOf(state, rid);
  // Depreciation: register book (whole year through the last closed month, so it matches book income incl. the prior system) vs tax.
  const bt = bookVsTax(state, { year, asOf, returnId: rid });
  const book = bt.reduce((a, r) => a + r.book, 0), tax = bt.reduce((a, r) => a + r.tax.total, 0);
  rows.push({ key: 'depreciation', kind: 'depreciation', label: ADJ_LABEL.depreciation, mode: 'auto', amount: book - tax, m1Line: place(book - tax, 'expense_not_deducted', 'deduction_not_booked'),
    basis: `Book ${money(book)} − tax ${money(tax)} (${bt.length} assets)`, source: '/tax/depreciation', workpaper: rec('depreciation')?.workpaper ?? '', reviewed: rec('depreciation')?.reviewed, record: rec('depreciation'), txns: [] });
  const srcTxns = (a: ID[]) => lineTxns(state, a, stores, from, to);
  const meals = acctNet(state, [MEALS_ACCT], stores, from, to);
  const mealsPct = rec('meals')?.pctBps ?? rates.mealsDisallowBps;
  rows.push({ key: 'meals', kind: 'meals', label: ADJ_LABEL.meals, mode: 'auto', amount: pctOf(meals, mealsPct), m1Line: 'expense_not_deducted',
    basis: `${(mealsPct / 100).toFixed(0)}% of ${money(meals)} in 6355 Meals`, source: '/books/accounts/acct_meals', workpaper: rec('meals')?.workpaper ?? '', reviewed: rec('meals')?.reviewed, record: rec('meals'), txns: srcTxns([MEALS_ACCT]) });
  const pen = acctNet(state, [PENALTY_ACCT], stores, from, to);
  rows.push({ key: 'penalties', kind: 'penalties', label: ADJ_LABEL.penalties, mode: 'auto', amount: pen, m1Line: 'expense_not_deducted',
    basis: `${money(pen)} in 6360 Penalties & fines`, source: '/books/accounts/acct_penalties', workpaper: rec('penalties')?.workpaper ?? '', reviewed: rec('penalties')?.reviewed, record: rec('penalties'), txns: srcTxns([PENALTY_ACCT]) });
  const draws = ownerDraws(state, { from, to }).rows.filter((r) => r.via === 'expense' && stores.has(r.l.storeId));
  const ownerAmt = draws.reduce((a, r) => a + r.amount, 0);
  rows.push({ key: 'owner', kind: 'owner', label: ADJ_LABEL.owner, mode: 'auto', amount: ownerAmt, m1Line: 'expense_not_deducted',
    basis: `${draws.length} owner withdrawal(s) booked to expense under the withdrawal policy: distributions, not deductions`, source: '/intercompany/draws', workpaper: rec('owner')?.workpaper ?? '', reviewed: rec('owner')?.reviewed, record: rec('owner'), txns: [...new Set(draws.map((r) => r.t))] });
  let a2c = 0;
  let a2cBasis = 'Accrual method: no adjustment.';
  if (profile.method === 'cash') {
    const p0 = periodOf(from), p1 = periodOf(to);
    const ids = [...stores];
    const cash = statement(state, { basis: 'cash', from: p0, to: p1, storeIds: ids }).netIncome.total;
    const booked = statement(state, { basis: 'booked', from: p0, to: p1, storeIds: ids }).netIncome.total;
    a2c = cash - booked;
    a2cBasis = `Cash-basis income ${money(cash)} − booked ${money(booked)}`;
  }
  rows.push({ key: 'accrual_to_cash', kind: 'accrual_to_cash', label: ADJ_LABEL.accrual_to_cash, mode: 'auto', amount: a2c, m1Line: place(a2c, 'income_not_booked', 'income_not_taxed'),
    basis: a2cBasis, source: '/reports/pnl?basis=compare', workpaper: rec('accrual_to_cash')?.workpaper ?? '', reviewed: rec('accrual_to_cash')?.reviewed, record: rec('accrual_to_cash'), txns: [] });
  for (const m of stored.filter((x) => x.mode === 'manual')) {
    const amount = m.amount ?? 0;
    rows.push({ key: m.id, kind: m.kind, label: m.label, mode: 'manual', amount, m1Line: m.m1Line ?? place(amount, 'expense_not_deducted', 'deduction_not_booked'), basis: 'Entered on the workpaper', source: m.source, workpaper: m.workpaper, reviewed: m.reviewed, record: m, txns: [] });
  }
  return rows;
}

export interface M1 {
  bookIncome: Cents;
  line2: Cents; line3: Cents; line4: Cents; line5: Cents; line6: Cents; line7: Cents; line8: Cents;
  /** Line 3 broken out: depreciation, meals (travel & entertainment), other. */
  line3a: Cents; line3b: Cents; line3c: Cents;
  line6a: Cents;
}

export interface BookToTax {
  unit: ReturnUnit;
  year: number;
  asOf: string;
  ytdBook: Cents;
  priorIncome: Cents;
  bookIncome: Cents;
  adjustments: AdjRow[];
  totalAdjustments: Cents;
  taxableIncome: Cents;
  m1: M1;
  /** Trial balance net income for the members (independent of bookIncome above). */
  tbNetIncome: Cents;
  tbBalanced: boolean;
  /** M-1 line 8 equals book income + every adjustment. */
  m1Ties: boolean;
  depTie: { register: Cents; ledger: Cents; ok: boolean };
}

/** Year-end trial balance → adjustments → taxable income for one return, with the Schedule M-1 layout. */
export function bookToTax(state: BooksState, entityId: ID, year: number, asOf: string): BookToTax {
  const unit = returnUnit(state, entityId);
  const stores = new Set(unit.storeIds);
  const to = minDate(asOf, yearEnd(year));
  const ytdBook = bookIncome(state, stores, yearStart(year), to);
  const priorIncome = priorIncomeOf(state, unit.entity.id, year)?.priorIncome ?? 0;
  const adj = adjustments(state, unit.entity.id, year, asOf);
  const total = adj.reduce((a, r) => a + r.amount, 0);
  const bi = ytdBook + priorIncome;
  const by = (l: M1Line, pred: (r: AdjRow) => boolean = () => true) => adj.filter((r) => r.m1Line === l && pred(r)).reduce((a, r) => a + Math.abs(r.amount), 0);
  const line2 = by('income_not_booked');
  const line3a = by('expense_not_deducted', (r) => r.kind === 'depreciation');
  const line3b = by('expense_not_deducted', (r) => r.kind === 'meals');
  const line3c = by('expense_not_deducted', (r) => r.kind !== 'depreciation' && r.kind !== 'meals');
  const line3 = line3a + line3b + line3c;
  const line5 = by('income_not_taxed');
  const line6a = by('deduction_not_booked', (r) => r.kind === 'depreciation');
  const line6 = by('deduction_not_booked');
  const line4 = bi + line2 + line3;
  const line7 = line5 + line6;
  const line8 = line4 - line7;
  // Independent: the members' trial balances.
  let tbNet = 0, tbBal = true;
  for (const m of unit.members) {
    const tb = trialBalance(state, { asOf: to, entityId: m });
    tbNet += tb.netIncome;
    if (tb.difference !== 0) tbBal = false;
  }
  return {
    unit, year, asOf, ytdBook, priorIncome, bookIncome: bi, adjustments: adj, totalAdjustments: total, taxableIncome: bi + total,
    m1: { bookIncome: bi, line2, line3, line4, line5, line6, line7, line8, line3a, line3b, line3c, line6a },
    tbNetIncome: tbNet, tbBalanced: tbBal, m1Ties: line8 === bi + total,
    depTie: bookDepTie(state, year, asOf, stores),
  };
}

export interface AdjustmentDraft {
  id?: ID;
  entityId: ID;
  year: number;
  kind: AdjKind;
  label?: string;
  mode: 'auto' | 'manual';
  amount?: Cents;
  pctBps?: number;
  m1Line?: M1Line;
  workpaper: string;
  source?: string;
}

/** Save a workpaper: the notes (and %, for meals) on a standard adjustment, or a manual adjustment with its amount. */
export function saveAdjustment(books: Books, actor: User, d: AdjustmentDraft): TaxAdjustment {
  books.require(actor, 'tax.edit', 'edit tax workpapers');
  const problems: string[] = [];
  if (!books.state.entities.some((e) => e.id === d.entityId)) problems.push('Choose the return the adjustment belongs to.');
  if (!(d.year >= 2000 && d.year <= 2100)) problems.push('Enter the tax year.');
  if (d.mode === 'manual') {
    if (!d.label?.trim()) problems.push('Describe the adjustment, like "Officer life insurance premiums".');
    if (!Number.isSafeInteger(d.amount) || !d.amount) problems.push('Enter the amount: positive raises taxable income, negative lowers it.');
  } else if (!AUTO_KINDS.includes(d.kind)) problems.push('That standard adjustment does not exist.');
  if (d.pctBps !== undefined && !(d.pctBps >= 0 && d.pctBps <= 10_000)) problems.push('The non-deductible share is a percentage from 0 to 100.');
  if (!d.workpaper.trim() && d.mode === 'manual') problems.push('Write the workpaper: what it is, where the number comes from, and the authority.');
  if (problems.length) throw errs(problems);
  const t = ensureTax(books);
  const rid = returnEntityOf(books.state, d.entityId);
  let x = d.id ? t.adjustments.find((a) => a.id === d.id) : d.mode === 'auto' ? t.adjustments.find((a) => a.mode === 'auto' && a.kind === d.kind && a.entityId === rid && a.year === d.year && !a.removed) : undefined;
  const before = x ? structuredClone(x) : undefined;
  const fields = { entityId: rid, year: d.year, kind: d.kind, mode: d.mode, label: d.mode === 'manual' ? d.label!.trim() : ADJ_LABEL[d.kind], amount: d.mode === 'manual' ? d.amount : undefined, pctBps: d.pctBps, m1Line: d.m1Line, workpaper: d.workpaper.trim(), source: d.source?.trim() || undefined, preparedBy: actor.id, updatedAt: books.clock() };
  if (x) Object.assign(x, fields, { reviewed: undefined });
  else { x = { id: books.nextId('tadj'), ...fields }; t.adjustments.push(x); }
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'tax', objectId: x.id, summary: `Workpaper ${x.label} (${x.year})${x.amount ? ` ${money(x.amount)}` : ''}`, before, after: structuredClone(x) });
  books.changed();
  return x;
}

/** Sign off a workpaper as reviewed. A new edit clears the sign-off. */
export function reviewAdjustment(books: Books, actor: User, entityId: ID, year: number, key: string): TaxAdjustment {
  books.require(actor, 'tax.edit', 'review tax workpapers');
  const t = ensureTax(books);
  const rid = returnEntityOf(books.state, entityId);
  let x = t.adjustments.find((a) => !a.removed && a.entityId === rid && a.year === year && (a.id === key || (a.mode === 'auto' && a.kind === key)));
  if (!x) {
    if (!AUTO_KINDS.includes(key as AdjKind)) throw errs(['That adjustment no longer exists.']);
    x = { id: books.nextId('tadj'), entityId: rid, year, kind: key as AdjKind, mode: 'auto', label: ADJ_LABEL[key as AdjKind], workpaper: '', preparedBy: actor.id, updatedAt: books.clock() };
    t.adjustments.push(x);
  }
  if (x.preparedBy === actor.id && x.workpaper && x.mode === 'manual') throw errs(['Someone other than the preparer signs off a manual adjustment.']);
  x.reviewed = { by: actor.id, at: books.clock() };
  books.audit(actor, { action: 'review', objectType: 'tax', objectId: x.id, summary: `Reviewed workpaper ${x.label} (${x.year})`, after: structuredClone(x) });
  books.changed();
  return x;
}

export function removeAdjustment(books: Books, actor: User, id: ID, reason: string): void {
  books.require(actor, 'tax.edit', 'remove tax adjustments');
  const x = ensureTax(books).adjustments.find((a) => a.id === id && !a.removed);
  if (!x) throw errs(['That adjustment no longer exists.']);
  if (x.mode !== 'manual') throw errs(['Standard adjustments come from the books; change the books or the workpaper instead.']);
  if (!reason.trim()) throw errs(['Say why the adjustment is being removed.']);
  x.removed = { by: actor.id, at: books.clock(), reason: reason.trim() };
  books.audit(actor, { action: 'delete', objectType: 'tax', objectId: x.id, summary: `Removed adjustment ${x.label}`, reason: reason.trim() });
  books.changed();
}

export function setPriorIncome(books: Books, actor: User, x: { entityId: ID; year: number; priorIncome: Cents; note?: string }): TaxYearInput {
  books.require(actor, 'tax.edit', 'enter prior-system income');
  if (!Number.isSafeInteger(x.priorIncome)) throw errs(['Enter the book income before these books as an amount (negative for a loss).']);
  const t = ensureTax(books);
  const rid = returnEntityOf(books.state, x.entityId);
  const i = t.years.findIndex((y) => y.entityId === rid && y.year === x.year);
  const before = i >= 0 ? structuredClone(t.years[i]) : undefined;
  const rec: TaxYearInput = { entityId: rid, year: x.year, priorIncome: x.priorIncome, note: x.note?.trim() || undefined };
  if (i >= 0) t.years[i] = rec; else t.years.push(rec);
  books.audit(actor, { action: 'update', objectType: 'tax', objectId: `${rid}:${x.year}`, summary: `Book income before these books for ${x.year}: ${money(x.priorIncome)}`, before, after: rec });
  books.changed();
  return rec;
}

/** Schedule M-2: AAA for an S corporation, partners' capital for a partnership. */
export interface M2 { kind: 'aaa' | 'capital' | 'retained'; beginning: Cents; income: Cents; contributions: Cents; nondeductible: Cents; distributions: Cents; ending: Cents }

export function m2(state: BooksState, entityId: ID, year: number, asOf: string): M2 {
  const k = k1Allocation(state, entityId, year, asOf);
  const sum = (f: (r: K1Row) => number) => k.rows.reduce((a, r) => a + f(r), 0);
  const cls = k.unit.entity.taxClass;
  const beginning = sum((r) => r.capitalStart), income = k.taxableIncome, contributions = sum((r) => r.contributions), nondeductible = sum((r) => r.nondeductible), distributions = sum((r) => r.distributions);
  return { kind: cls === 's_corp_1120s' ? 'aaa' : cls === 'partnership_1065' ? 'capital' : 'retained', beginning, income, contributions: cls === 's_corp_1120s' ? 0 : contributions, nondeductible, distributions, ending: beginning + income + (cls === 's_corp_1120s' ? 0 : contributions) - nondeductible - distributions };
}

// ── Accounting methods & the gross-receipts test ─────────────────────────
/** Gross receipts in the books for a year: revenue less returns and allowances (contra revenue), all entities. */
export function bookReceipts(state: BooksState, year: number, entityIds?: ID[]): Cents {
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const ent = new Map(state.stores.map((s) => [s.id, s.entityId]));
  const want = entityIds ? new Set(entityIds) : null;
  let n = 0;
  for (const t of state.transactions) {
    if (t.deleted || !t.date.startsWith(String(year))) continue;
    for (const l of t.lines) {
      const a = acc.get(l.accountId);
      if (!a || (a.type !== 'revenue' && a.type !== 'contra_revenue')) continue;
      if (want && !want.has(ent.get(l.storeId) ?? '')) continue;
      n += l.credit - l.debit;
    }
  }
  return n;
}

export interface ReceiptsTest {
  year: number;
  rows: { year: number; entered: Cents; books: Cents; total: Cents }[];
  average: Cents;
  threshold: Cents;
  passes: boolean;
  /** Years with nothing entered or booked. */
  missing: number[];
}

/**
 * §448(c) gross-receipts test for a tax year: the average of the three prior years' gross receipts, aggregated
 * across entities under common control (every entity here), against the configurable threshold.
 */
export function grossReceiptsTest(state: BooksState, year: number): ReceiptsTest {
  const rates = ratesOf(state);
  const rows = [year - 3, year - 2, year - 1].map((y) => {
    const entered = taxOf(state).receipts.filter((r) => r.year === y).reduce((a, r) => a + r.receipts, 0);
    const books = bookReceipts(state, y);
    return { year: y, entered, books, total: entered + books };
  });
  const missing = rows.filter((r) => !r.total).map((r) => r.year);
  const counted = rows.filter((r) => r.total);
  const average = counted.length ? Math.round(counted.reduce((a, r) => a + r.total, 0) / counted.length) : 0;
  return { year, rows, average, threshold: rates.grossReceiptsThreshold, passes: average <= rates.grossReceiptsThreshold, missing };
}

export interface MethodRow {
  entity: Entity;
  profile: EntityTaxProfile;
  smallBusiness: boolean;
  cashAllowed: boolean;
  cashNote: string;
  unicap: string;
  inventoryNote: string;
}

export function methodsPanel(state: BooksState, year: number): { test: ReceiptsTest; rows: MethodRow[] } {
  const test = grossReceiptsTest(state, year);
  const rows = returnUnits(state).map((u): MethodRow => {
    const profile = profileOf(state, u.entity.id);
    const small = test.passes;
    const cls = u.entity.taxClass;
    const cashAllowed = cls === 's_corp_1120s' || small;
    return {
      entity: u.entity, profile, smallBusiness: small, cashAllowed,
      cashNote: cls === 's_corp_1120s' ? 'S corporations may use cash unless a tax shelter; inventory rules still apply.' : small ? 'Passes the gross-receipts test: cash method allowed (§448(b)(3)).' : 'Fails the gross-receipts test: accrual method required.',
      unicap: small ? 'Exempt: small-business exception (§263A(i)).' : 'Applies: capitalize direct and allocable indirect costs into inventory (§263A).',
      inventoryNote: small ? 'May treat inventory as non-incidental materials or follow its books (§471(c)).' : 'Must keep inventories under §471; LIFO needs Form 970.',
    };
  });
  return { test, rows };
}

export function setReceipts(books: Books, actor: User, r: ReceiptsYear): void {
  books.require(actor, 'tax.edit', 'enter prior-year gross receipts');
  if (!books.state.entities.some((e) => e.id === r.entityId)) throw errs(['Choose the entity.']);
  if (!(r.year > 1990 && r.year < 2100)) throw errs(['Enter the year.']);
  if (!Number.isSafeInteger(r.receipts) || r.receipts < 0) throw errs(['Enter gross receipts as zero or more.']);
  const t = ensureTax(books);
  const i = t.receipts.findIndex((x) => x.entityId === r.entityId && x.year === r.year);
  const before = i >= 0 ? t.receipts[i] : undefined;
  if (i >= 0) t.receipts[i] = { ...r }; else t.receipts.push({ ...r });
  books.audit(actor, { action: 'update', objectType: 'tax', objectId: `${r.entityId}:${r.year}:receipts`, summary: `Gross receipts ${r.year}: ${money(r.receipts)}`, before, after: r });
  books.changed();
}

export function saveMethodChange(books: Books, actor: User, m: Omit<MethodChange, 'id'> & { id?: ID }): MethodChange {
  books.require(actor, 'tax.edit', 'track accounting method changes');
  const problems: string[] = [];
  if (!books.state.entities.some((e) => e.id === m.entityId)) problems.push('Choose the entity.');
  if (!m.description.trim()) problems.push('Describe the change, like "Switch HM14 to the cash method".');
  if (!(m.year > 2000 && m.year < 2100)) problems.push('Enter the year of change.');
  if (m.filedOn && !isValidDate(m.filedOn)) problems.push('Enter the filed date as YYYY-MM-DD.');
  if ((m.status === 'filed' || m.status === 'accepted') && !m.filedOn) problems.push('Enter the date Form 3115 was filed.');
  if (m.adj481 !== undefined && !Number.isSafeInteger(m.adj481)) problems.push('Enter the §481(a) adjustment as an amount.');
  if (problems.length) throw errs(problems);
  const t = ensureTax(books);
  const existing = m.id ? t.methodChanges.find((x) => x.id === m.id) : undefined;
  const rec: MethodChange = { ...m, id: existing?.id ?? books.nextId('m3115'), description: m.description.trim(), dcn: m.dcn?.trim() || undefined, notes: m.notes?.trim() || undefined };
  if (existing) Object.assign(existing, rec); else t.methodChanges.push(rec);
  books.audit(actor, { action: existing ? 'update' : 'create', objectType: 'tax', objectId: rec.id, summary: `Form 3115: ${rec.description} (${rec.status})`, after: structuredClone(rec) });
  books.changed();
  return rec;
}

// ── Projection ───────────────────────────────────────────────────────────
export interface Projection {
  unit: ReturnUnit;
  year: number;
  monthsElapsed: number;
  ytdTaxable: Cents;
  /** Taxable income before depreciation to date (book income + every non-depreciation adjustment + book depreciation). */
  beforeDepreciation: Cents;
  /** That, annualized. */
  annualized: Cents;
  /** The full year's tax depreciation (an annual allowance, not annualized). */
  taxDepreciation: Cents;
  projected: Cents;
}

export function monthsElapsed(year: number, asOf: string): number {
  if (asOf >= yearEnd(year)) return 12;
  if (asOf < yearStart(year)) return 0;
  const m = Number(asOf.slice(5, 7)), d = Number(asOf.slice(8, 10));
  const days = Number(lastDayOfPeriod(asOf.slice(0, 7)).slice(8, 10));
  return m - 1 + d / days;
}

/**
 * Projected year-end taxable income for a return: income before depreciation to date, annualized, less the full
 * year's tax depreciation (which is an annual allowance and does not scale with the months).
 */
export function projectTaxable(state: BooksState, entityId: ID, year: number, asOf: string): Projection {
  const b = bookToTax(state, entityId, year, asOf);
  const months = monthsElapsed(year, asOf);
  const bt = bookVsTax(state, { year, asOf, returnId: b.unit.entity.id });
  const bookYtd = bt.reduce((a, r) => a + r.book, 0);
  const taxDepreciation = bt.reduce((a, r) => a + r.tax.total, 0);
  const dep = b.adjustments.find((r) => r.kind === 'depreciation')?.amount ?? 0;
  const beforeDepreciation = b.bookIncome + b.totalAdjustments - dep + bookYtd;
  const annualized = months > 0 ? Math.round((beforeDepreciation * 12) / months) : 0;
  return { unit: b.unit, year, monthsElapsed: months, ytdTaxable: b.taxableIncome, beforeDepreciation, annualized, taxDepreciation, projected: annualized - taxDepreciation };
}

// ── K-1 and owner basis ──────────────────────────────────────────────────
export interface K1Row {
  partyId: ID;
  name: string;
  pctBps: number;
  /** Share of taxable income (ordinary business income) to date. */
  income: Cents;
  bookIncome: Cents;
  projected: Cents;
  distributions: Cents;
  contributions: Cents;
  /** Share of non-deductible expenses (meals disallowed, penalties): reduce basis, not income. */
  nondeductible: Cents;
  basisStart: Cents;
  basisEnd: Cents;
  /** Losses beyond basis, carried forward. */
  suspendedLoss: Cents;
  /** Distributions beyond basis: taxed as gain. */
  excessDistribution: Cents;
  capitalStart: Cents;
  capitalEnd: Cents;
  /** Actual share of distributions vs ownership share. */
  distributionShare: number | null;
}

export interface K1Allocation {
  unit: ReturnUnit;
  year: number;
  taxableIncome: Cents;
  bookIncome: Cents;
  projected: Cents;
  rows: K1Row[];
  /** Owner shares add back to the return's income. */
  ties: boolean;
  /** S corporation distributions not in proportion to stock owned. */
  disproportionate: boolean;
  ownersSet: boolean;
}

export function ownerStartOf(state: BooksState, entityId: ID, partyId: ID, year: number): OwnerStart | undefined {
  return taxOf(state).owners.find((o) => o.entityId === entityId && o.partyId === partyId && o.year === year);
}

/** Owner distributions from a return this year: owner draws (either policy) on its members' stores. */
export function distributionsBy(state: BooksState, entityId: ID, year: number, asOf: string): Map<ID, Cents> {
  const unit = returnUnit(state, entityId);
  const stores = new Set(unit.storeIds);
  const m = new Map<ID, Cents>();
  for (const r of ownerDraws(state, { from: yearStart(year), to: minDate(asOf, yearEnd(year)) }).rows) {
    if (!r.ownerId || !stores.has(r.l.storeId)) continue;
    m.set(r.ownerId, (m.get(r.ownerId) ?? 0) + r.amount);
  }
  return m;
}

/** Each owner's share of income by ownership %, distributions, and the basis and capital roll-forward. */
export function k1Allocation(state: BooksState, entityId: ID, year: number, asOf: string): K1Allocation {
  const b = bookToTax(state, entityId, year, asOf);
  const proj = projectTaxable(state, entityId, year, asOf);
  const owners = profileOf(state, b.unit.entity.id).owners;
  const weights = owners.map((o) => o.pctBps);
  const split = (v: Cents) => (owners.length ? allocate(v, weights) : []);
  const inc = split(b.taxableIncome), book = split(b.bookIncome), pro = split(proj.projected);
  const nd = split(b.adjustments.filter((r) => r.kind === 'meals' || r.kind === 'penalties').reduce((a, r) => a + r.amount, 0));
  const dist = distributionsBy(state, b.unit.entity.id, year, asOf);
  const totalDist = [...dist.values()].reduce((a, v) => a + v, 0);
  const rows = owners.map((o, i): K1Row => {
    const start = ownerStartOf(state, b.unit.entity.id, o.partyId, year);
    const basisStart = start?.basis ?? 0, capitalStart = start?.capital ?? 0, contributions = start?.contributions ?? 0;
    const distributions = dist.get(o.partyId) ?? 0;
    const r = basisRollForward({ start: basisStart, contributions, income: inc[i], distributions, nondeductible: nd[i] });
    return {
      partyId: o.partyId, name: state.parties.find((p) => p.id === o.partyId)?.name ?? o.partyId, pctBps: o.pctBps,
      income: inc[i], bookIncome: book[i], projected: pro[i], distributions, contributions, nondeductible: nd[i],
      basisStart, basisEnd: r.end, suspendedLoss: r.suspended, excessDistribution: r.excess,
      capitalStart, capitalEnd: capitalStart + contributions + inc[i] - nd[i] - distributions,
      distributionShare: totalDist ? distributions / totalDist : null,
    };
  });
  const disproportionate = b.unit.entity.taxClass === 's_corp_1120s' && totalDist > 0 && rows.some((r) => Math.abs((r.distributionShare ?? 0) - r.pctBps / 10_000) > 0.005);
  return {
    unit: b.unit, year, taxableIncome: b.taxableIncome, bookIncome: b.bookIncome, projected: proj.projected, rows,
    ties: !owners.length || rows.reduce((a, r) => a + r.income, 0) === b.taxableIncome, disproportionate, ownersSet: owners.length > 0,
  };
}

/**
 * Basis roll-forward in the order the regulations use (§1367 / §1368 for S corporations; §705 / §733 for partners,
 * ignoring the share of partnership liabilities): add income and contributions; take distributions (any excess over
 * basis is gain); then non-deductible expenses; then losses, which can't take basis below zero (the rest is suspended).
 */
export function basisRollForward(x: { start: Cents; contributions: Cents; income: Cents; distributions: Cents; nondeductible: Cents; suspendedIn?: Cents }): { end: Cents; suspended: Cents; excess: Cents; steps: { label: string; amount: Cents; basis: Cents }[] } {
  const steps: { label: string; amount: Cents; basis: Cents }[] = [];
  let basis = x.start;
  steps.push({ label: 'Beginning basis', amount: x.start, basis });
  basis += x.contributions; steps.push({ label: 'Contributions', amount: x.contributions, basis });
  const income = Math.max(0, x.income);
  basis += income; steps.push({ label: 'Share of income', amount: income, basis });
  const dist = Math.min(x.distributions, Math.max(0, basis));
  const excess = x.distributions - dist;
  basis -= dist; steps.push({ label: 'Distributions', amount: -dist, basis });
  const nd = Math.min(x.nondeductible, Math.max(0, basis));
  basis -= nd; steps.push({ label: 'Non-deductible expenses', amount: -nd, basis });
  const loss = Math.max(0, -x.income) + (x.suspendedIn ?? 0);
  const allowed = Math.min(loss, Math.max(0, basis));
  basis -= allowed; steps.push({ label: 'Share of losses allowed', amount: -allowed, basis });
  return { end: basis, suspended: loss - allowed, excess, steps };
}

export function setOwnerStart(books: Books, actor: User, o: OwnerStart): OwnerStart {
  books.require(actor, 'tax.edit', 'enter owner basis and capital');
  const problems: string[] = [];
  if (!books.state.entities.some((e) => e.id === o.entityId)) problems.push('Choose the return.');
  if (!books.state.parties.some((p) => p.id === o.partyId && p.type === 'owner')) problems.push('Choose an owner.');
  for (const [k, v] of [['basis', o.basis], ['capital', o.capital], ['contributions', o.contributions]] as const) if (!Number.isSafeInteger(v)) problems.push(`Enter ${k} as an amount.`);
  if (o.basis < 0) problems.push('Basis can\'t start below zero; carry losses as suspended instead.');
  if (o.contributions < 0) problems.push('Contributions are zero or more.');
  if (problems.length) throw errs(problems);
  const t = ensureTax(books);
  const rid = returnEntityOf(books.state, o.entityId);
  const i = t.owners.findIndex((x) => x.entityId === rid && x.partyId === o.partyId && x.year === o.year);
  const before = i >= 0 ? structuredClone(t.owners[i]) : undefined;
  const rec = { ...o, entityId: rid };
  if (i >= 0) t.owners[i] = rec; else t.owners.push(rec);
  books.audit(actor, { action: 'update', objectType: 'tax', objectId: `${rid}:${o.partyId}:${o.year}`, summary: `Beginning basis ${money(o.basis)} and capital ${money(o.capital)} for ${books.state.parties.find((p) => p.id === o.partyId)?.name}`, before, after: rec });
  books.changed();
  return rec;
}

/** Owner rate for pass-through income: federal + state, from the tables. */
export function ownerRateBps(state: BooksState): number {
  const r = ratesOf(state);
  return r.ownerFederalBps + r.ownerStateBps;
}

export interface TaxDistributionRow { entityId: ID; partyId: ID; name: string; projectedShare: Cents; rateBps: number; taxDistribution: Cents; paid: Cents; remaining: Cents }

/**
 * Tax distributions (SPEC §4.21): projected taxable income × owner rate, per owner and return, against what has been
 * distributed this year. Phase 13 builds the safe-distribution figure on this.
 */
export function taxDistributions(state: BooksState, opts: { year: number; asOf: string }): { rows: TaxDistributionRow[]; total: Cents; paid: Cents } {
  const rate = ownerRateBps(state);
  const rows: TaxDistributionRow[] = [];
  for (const u of returnUnits(state)) {
    if (u.entity.taxClass === 'c_corp_1120') continue;
    const k = k1Allocation(state, u.entity.id, opts.year, opts.asOf);
    for (const r of k.rows) {
      const td = Math.max(0, pctOf(r.projected, rate));
      rows.push({ entityId: u.entity.id, partyId: r.partyId, name: r.name, projectedShare: r.projected, rateBps: rate, taxDistribution: td, paid: r.distributions, remaining: Math.max(0, td - r.distributions) });
    }
  }
  return { rows, total: rows.reduce((a, r) => a + r.taxDistribution, 0), paid: rows.reduce((a, r) => a + r.paid, 0) };
}

/** Owner basis for every return (Phase 13 reads this). */
export function ownerBasis(state: BooksState, opts: { year: number; asOf: string }): { entityId: ID; partyId: ID; name: string; start: Cents; end: Cents; suspended: Cents; excess: Cents; capitalEnd: Cents }[] {
  return returnUnits(state).flatMap((u) => k1Allocation(state, u.entity.id, opts.year, opts.asOf).rows.map((r) => ({ entityId: u.entity.id, partyId: r.partyId, name: r.name, start: r.basisStart, end: r.basisEnd, suspended: r.suspendedLoss, excess: r.excessDistribution, capitalEnd: r.capitalEnd })));
}

/** Cash available for distributions vs the tax still to distribute: shared bank above its floor less entity estimates due in 90 days.
 * @deprecated Phase 13: screens use `safeDistribution` in growth.ts (reserve, capex, tax and debt-service cushion). Kept for its tests. */
export function distributionCapacity(state: BooksState, opts: { year: number; asOf: string }): { bank: Cents; floor: Cents; estimatesDue: Cents; capacity: Cents; taxStillToDistribute: Cents; covered: boolean } {
  const banks = state.accounts.filter((a) => a.subtype === 'bank' && a.active);
  const bank = banks.reduce((a, acct) => a + acctNet(state, [acct.id], undefined, '0000-01-01', opts.asOf), 0);
  const floor = banks.reduce((a, acct) => a + (acct.floorCents ?? 0), 0);
  const estimatesDue = estimates(state, opts.asOf).filter((e) => e.plan.payer === 'entity').flatMap((e) => e.installments).filter((i) => !i.done && daysBetween(opts.asOf, i.dueDate) <= 90).reduce((a, i) => a + i.short, 0);
  const capacity = Math.max(0, bank - floor - estimatesDue);
  const td = taxDistributions(state, opts);
  const still = td.rows.reduce((a, r) => a + r.remaining, 0);
  return { bank, floor, estimatesDue, capacity, taxStillToDistribute: still, covered: capacity >= still };
}

// ── Estimated taxes ──────────────────────────────────────────────────────
export interface Installment { quarter: number; dueDate: string; required: Cents; paid: Cents; short: Cents; done: boolean; overdue: boolean; daysLeft: number; payments: EstimatePayment[] }

export interface EstimateStatus {
  plan: EstimatePlan;
  payerName: string;
  projectedIncome: Cents;
  rateBps: number;
  projectedTax: Cents;
  /** 90% of this year's projected tax. */
  currentYearBasis: Cents;
  /** 100% (or 110%) of last year's tax. */
  safeHarbor: Cents;
  safeHarborPct: number;
  /** The smaller of the two, less other credits: what the four installments must reach. */
  required: Cents;
  method: 'safe_harbor' | 'current_year';
  installments: Installment[];
  paid: Cents;
}

export function planPayerName(state: BooksState, p: EstimatePlan): string {
  if (p.payer === 'owner') return state.parties.find((x) => x.id === p.partyId)?.name ?? 'Owner';
  return state.entities.find((x) => x.id === p.entityId)?.code ?? 'Entity';
}

export function estimateStatus(state: BooksState, plan: EstimatePlan, asOf: string): EstimateStatus {
  const rates = ratesOf(state);
  let projectedIncome = 0;
  if (plan.payer === 'owner') {
    for (const eid of plan.entityIds) {
      const k = k1Allocation(state, eid, plan.year, asOf);
      projectedIncome += k.rows.find((r) => r.partyId === plan.partyId)?.projected ?? 0;
    }
  } else if (plan.entityId) projectedIncome = projectTaxable(state, plan.entityId, plan.year, asOf).projected;
  const cls = state.entities.find((e) => e.id === plan.entityId)?.taxClass;
  const rateBps = plan.rateBps ?? (plan.payer === 'owner' ? (plan.jurisdiction === 'federal' ? rates.ownerFederalBps : rates.ownerStateBps) : cls === 'c_corp_1120' && plan.jurisdiction === 'federal' ? rates.cCorpBps : rates.pteBps);
  const projectedTax = Math.max(0, pctOf(projectedIncome, rateBps));
  const currentYearBasis = plan.payer === 'owner' ? Math.round(projectedTax * 0.9) : projectedTax;
  const safeHarborPct = plan.payer === 'owner' && plan.highIncome ? 110 : 100;
  const safeHarbor = Math.round((plan.priorYearTax * safeHarborPct) / 100);
  const useSafe = plan.priorYearTax > 0 && safeHarbor < currentYearBasis;
  const required = Math.max(0, (useSafe ? safeHarbor : currentYearBasis) - (plan.otherCredits ?? 0));
  const parts = allocate(required, [1, 1, 1, 1]);
  const pays = taxOf(state).payments.filter((p) => p.planId === plan.id);
  // Overpayments carry forward: an installment is met when payments so far reach the installments so far.
  let cumReq = 0, cumPaid = 0;
  const installments = plan.dueDates.slice(0, 4).map((dueDate, i): Installment => {
    const q = i + 1;
    const mine = pays.filter((p) => p.quarter === q);
    const paid = mine.reduce((a, p) => a + p.amount, 0);
    cumReq += parts[i];
    cumPaid += paid;
    const short = Math.max(0, Math.min(parts[i], cumReq - cumPaid));
    const daysLeft = daysBetween(asOf, dueDate);
    return { quarter: q, dueDate, required: parts[i], paid, short, done: short === 0, overdue: short > 0 && daysLeft < 0, daysLeft, payments: mine };
  });
  return {
    plan, payerName: planPayerName(state, plan), projectedIncome, rateBps, projectedTax, currentYearBasis, safeHarbor, safeHarborPct, required,
    method: useSafe ? 'safe_harbor' : 'current_year', installments, paid: pays.reduce((a, p) => a + p.amount, 0),
  };
}

export function estimates(state: BooksState, asOf: string, year?: number): EstimateStatus[] {
  return taxOf(state).plans.filter((p) => !year || p.year === year).map((p) => estimateStatus(state, p, asOf));
}

/** Unpaid installments due within `days` (or overdue): the inbox alert. */
export function estimatesDueSoon(state: BooksState, asOf: string, days = 14): { status: EstimateStatus; inst: Installment }[] {
  return estimates(state, asOf).flatMap((s) => s.installments.filter((i) => !i.done && i.daysLeft <= days && i.daysLeft >= -366).map((inst) => ({ status: s, inst })));
}

export function validatePlan(state: BooksState, p: Omit<EstimatePlan, 'id'>): string[] {
  const out: string[] = [];
  if (p.payer === 'owner' && !state.parties.some((x) => x.id === p.partyId && x.type === 'owner')) out.push('Choose the owner who pays.');
  if (p.payer === 'entity' && !state.entities.some((x) => x.id === p.entityId)) out.push('Choose the entity that pays.');
  if (p.dueDates.length !== 4 || p.dueDates.some((d) => !isValidDate(d))) out.push('Enter the four due dates as YYYY-MM-DD.');
  if (!Number.isSafeInteger(p.priorYearTax) || p.priorYearTax < 0) out.push('Enter last year\'s total tax (zero if none) for the safe harbor.');
  if (p.payer === 'owner' && !p.entityIds.length) out.push('Pick the returns whose income counts toward this owner\'s estimate.');
  if (p.rateBps !== undefined && !(p.rateBps >= 0 && p.rateBps <= 10_000)) out.push('The rate is a percentage from 0 to 100.');
  return out;
}

export function saveEstimatePlan(books: Books, actor: User, p: Omit<EstimatePlan, 'id'> & { id?: ID }): EstimatePlan {
  books.require(actor, 'tax.edit', 'set up estimated taxes');
  const problems = validatePlan(books.state, p);
  if (problems.length) throw errs(problems);
  const t = ensureTax(books);
  const existing = p.id ? t.plans.find((x) => x.id === p.id) : undefined;
  const before = existing ? structuredClone(existing) : undefined;
  const rec: EstimatePlan = { ...p, id: existing?.id ?? p.id ?? books.nextId('est'), note: p.note?.trim() || undefined };
  if (existing) Object.assign(existing, rec); else t.plans.push(rec);
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'tax', objectId: rec.id, summary: `Estimated tax plan: ${planPayerName(books.state, rec)} ${rec.jurisdiction} ${rec.year}, prior-year tax ${money(rec.priorYearTax)}`, before, after: structuredClone(rec) });
  books.changed();
  return rec;
}

export interface EstimatePaymentInput {
  planId: ID;
  quarter: number;
  date: string;
  amount: Cents;
  paidBy: 'entity' | 'owner';
  /** Entity-paid: the entity that pays (default: the plan's entity, or the hub). */
  entityId?: ID;
  bankAccountId?: ID;
  confirmation?: string;
  /** Entity-paid before these books began: record it without posting (it is in the opening balance). */
  post?: boolean;
}

/**
 * Record an estimate payment. When an entity pays, it posts through the ledger from the bank: an owner's personal
 * estimate is a distribution to that owner (under the owner-withdrawal policy), an entity's own estimate is entity
 * income or franchise tax (6250). When the owner pays personally it is recorded only.
 */
export function recordEstimatePayment(books: Books, actor: User, x: EstimatePaymentInput): EstimatePayment {
  books.require(actor, 'tax.edit', 'record estimated tax payments');
  const state = books.state;
  const plan = taxOf(state).plans.find((p) => p.id === x.planId);
  const problems: string[] = [];
  if (!plan) problems.push('That estimate plan no longer exists.');
  if (!(x.quarter >= 1 && x.quarter <= 4)) problems.push('Pick the quarter the payment is for.');
  if (!isValidDate(x.date)) problems.push('Enter the payment date as YYYY-MM-DD.');
  if (!Number.isSafeInteger(x.amount) || x.amount <= 0) problems.push('Enter the amount paid, above zero.');
  if (plan?.payer === 'entity' && x.paidBy === 'owner') problems.push('An entity\'s own estimate is paid by the entity.');
  const payEntity = x.entityId ?? plan?.entityId ?? (plan ? returnEntityOf(state, plan.entityIds[0] ?? hub(state).id) : hub(state).id);
  if (x.paidBy === 'entity' && !state.entities.some((e) => e.id === payEntity)) problems.push('Choose the entity that paid.');
  if (problems.length) throw errs(problems);
  const t = ensureTax(books);
  let txnId: ID | undefined;
  const label = `${planPayerName(state, plan!)} ${plan!.jurisdiction} estimate Q${x.quarter} ${plan!.year}`;
  if (x.paidBy === 'entity' && x.post !== false) {
    const bank = x.bankAccountId ?? 'acct_trustmark';
    const bankStore = bankStoreId(state);
    const store = state.stores.find((s) => s.entityId === payEntity && !s.deleted && s.kind === 'corporate') ?? state.stores.find((s) => s.entityId === payEntity && !s.deleted);
    if (!store) throw errs(['The paying entity has no store to book the payment to. Add one in Setup › Stores.']);
    const isOwner = plan!.payer === 'owner';
    const policy = state.settings.ownerWithdrawalPolicy;
    const debitAcct = isOwner ? (policy === 'draw' ? 'acct_owner_draws' : state.settings.ownerWithdrawalExpenseAccountId ?? 'acct_misc') : ENTITY_TAX_ACCT;
    const party = isOwner ? plan!.partyId : undefined;
    const tx = books.createTransaction(actor, {
      date: x.date, kind: 'money_out', description: `${plan!.jurisdiction === 'federal' ? 'IRS' : 'STATE'} ESTIMATED TAX ${label.toUpperCase()}`, partyId: party,
      tags: isOwner ? ['tax', 'estimate', 'draw', 'tax distribution'] : ['tax', 'estimate'], docNo: x.confirmation?.trim() || undefined,
      memo: isOwner ? `Paid for ${planPayerName(state, plan!)}: a tax distribution` : `Entity-level estimated tax`,
      lines: [
        { accountId: debitAcct, storeId: store.id, debit: x.amount, credit: 0, memo: isOwner ? 'Owner withdrawal (tax distribution)' : label, partyId: party },
        { accountId: bank, storeId: bankStore, debit: 0, credit: x.amount },
      ],
    }, { source: 'manual' });
    txnId = tx.id;
  }
  const pay: EstimatePayment = { id: books.nextId('estp'), planId: plan!.id, quarter: x.quarter, date: x.date, amount: x.amount, paidBy: x.paidBy, entityId: x.paidBy === 'entity' ? payEntity : undefined, bankAccountId: txnId ? x.bankAccountId ?? 'acct_trustmark' : undefined, txnId, confirmation: x.confirmation?.trim() || undefined, by: actor.id, at: books.clock() };
  t.payments.push(pay);
  books.audit(actor, { action: 'create', objectType: 'tax', objectId: pay.id, summary: `Recorded ${label} ${money(x.amount)}${txnId ? ' (posted)' : ' (paid personally)'}`, after: structuredClone(pay) });
  books.changed();
  return pay;
}

// ── Sales tax ────────────────────────────────────────────────────────────
export interface SalesTaxRow {
  storeId: ID;
  /** Every revenue line on the POS daily close. */
  posSales: Cents;
  fuelSales: Cents;
  nonTaxable: Cents;
  taxableSales: Cents;
  /** Taxable sales × the rate. */
  expectedTax: Cents;
  collectedPos: Cents;
  collectedOther: Cents;
  collected: Cents;
  /** collected − expected. */
  variance: Cents;
  remitted: Cents;
  /** collected − remitted. */
  unremitted: Cents;
}

export interface SalesTaxPeriod {
  period: string;
  rows: SalesTaxRow[];
  total: SalesTaxRow;
  rateBps: number;
  dueDate: string;
  occurrence?: OccurrenceRow;
  /** The return is due or has been filed, so collected should equal remitted. */
  settled: boolean;
  varianceFlag: boolean;
  remitFlag: boolean;
  flags: string[];
}

/** The period a 2200 debit pays: a YYYY-MM in its memo, description or doc #, else the month before its date. */
export function remitPeriod(t: Transaction): string {
  const m = `${t.memo ?? ''} ${t.description} ${t.docNo ?? ''}`.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (m) return `${m[1]}-${m[2]}`;
  const p = periodOf(t.date);
  const [y, mo] = p.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
}

/** Taxable sales from the POS close (inside + kitchen departments; fuel excluded unless set taxable) vs 2200 collected vs remitted. */
export function salesTaxPeriod(state: BooksState, period: string, opts: { today: string; visible?: Set<ID> }): SalesTaxPeriod {
  const rates = ratesOf(state);
  const from = `${period}-01`, to = lastDayOfPeriod(period);
  const acc = new Map(state.accounts.map((a) => [a.id, a]));
  const taxableRev = new Set<ID>();
  for (const d of departments(state)) if (rates.taxableDeptIds.includes(d.id)) for (const a of d.revenueAccountIds) taxableRev.add(a);
  const stores = state.stores.filter((s) => !s.deleted && s.kind === 'operating' && (!opts.visible || opts.visible.has(s.id)));
  const m = new Map<ID, SalesTaxRow>(stores.map((s) => [s.id, { storeId: s.id, posSales: 0, fuelSales: 0, nonTaxable: 0, taxableSales: 0, expectedTax: 0, collectedPos: 0, collectedOther: 0, collected: 0, variance: 0, remitted: 0, unremitted: 0 }]));
  for (const t of state.transactions) {
    if (t.deleted) continue;
    const inPeriod = t.date >= from && t.date <= to;
    const pos = t.tags.includes('pos');
    for (const l of t.lines) {
      const r = m.get(l.storeId);
      if (!r) continue;
      const a = acc.get(l.accountId);
      if (!a) continue;
      if (inPeriod && pos && (a.type === 'revenue' || a.type === 'contra_revenue')) {
        const v = l.credit - l.debit;
        r.posSales += v;
        if (a.lob === 'fuel') { r.fuelSales += v; if (rates.fuelTaxable) r.taxableSales += v; }
        else if (taxableRev.has(a.id)) r.taxableSales += v;
        else r.nonTaxable += v;
      }
      if (a.id === SALES_TAX_ACCT) {
        if (inPeriod && l.credit) { if (pos) r.collectedPos += l.credit; else r.collectedOther += l.credit; }
        if (l.debit && remitPeriod(t) === period) r.remitted += l.debit;
      }
    }
  }
  const rows = [...m.values()].map((r) => {
    r.expectedTax = Math.round((r.taxableSales * rates.salesTaxBps) / 10_000);
    r.collected = r.collectedPos + r.collectedOther;
    r.variance = r.collected - r.expectedTax;
    r.unremitted = r.collected - r.remitted;
    return r;
  }).filter((r) => r.posSales || r.collected || r.remitted);
  const total = rows.reduce<SalesTaxRow>((a, r) => {
    for (const k of Object.keys(a) as (keyof SalesTaxRow)[]) if (k !== 'storeId') (a[k] as number) += r[k] as number;
    return a;
  }, { storeId: '', posSales: 0, fuelSales: 0, nonTaxable: 0, taxableSales: 0, expectedTax: 0, collectedPos: 0, collectedOther: 0, collected: 0, variance: 0, remitted: 0, unremitted: 0 });
  // The return that covers it: the sales-tax item's due date in the following month.
  const next = addDays(lastDayOfPeriod(period), 1).slice(0, 7);
  const item = complianceOf(state).items.find((i) => i.kind === 'sales_tax' && i.active);
  const due = item ? dueDates(item.recurrence, `${next}-01`, lastDayOfPeriod(next))[0] : undefined;
  const dueDate = due ?? `${next}-20`;
  const occRow = item ? occurrences(state, { from: dueDate, to: dueDate, today: opts.today }).find((o) => o.item.id === item.id) : undefined;
  const filed = !!occRow?.occ && ['filed', 'paid', 'accepted'].includes(occRow.occ.status);
  const settled = filed || opts.today > dueDate;
  const mat = state.settings.materialityCents;
  const flags: string[] = [];
  const varianceFlag = rows.some((r) => Math.abs(r.variance) >= mat);
  const remitFlag = settled && rows.some((r) => Math.abs(r.unremitted) >= mat);
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  for (const r of rows) {
    if (Math.abs(r.variance) >= mat) flags.push(`${code(r.storeId)}: tax collected ${money(r.collected)} vs ${(rates.salesTaxBps / 100).toFixed(2)}% of POS taxable sales ${money(r.expectedTax)} (${money(r.variance)}${r.collectedOther ? `; ${money(r.collectedOther)} collected outside the POS` : ''}).`);
    if (settled && Math.abs(r.unremitted) >= mat) flags.push(`${code(r.storeId)}: collected ${money(r.collected)} but remitted ${money(r.remitted)} (${money(r.unremitted)} ${r.unremitted > 0 ? 'not remitted' : 'over-remitted'}).`);
  }
  return { period, rows, total, rateBps: rates.salesTaxBps, dueDate, occurrence: occRow, settled, varianceFlag, remitFlag, flags };
}

/** Every 2200 credit less every debit through the date ties to the 2200 balance (credit-positive). */
export function salesTaxTie(state: BooksState, asOf: string, visible?: Set<ID>): { collected: Cents; remitted: Cents; ledger: Cents; ok: boolean } {
  let collected = 0, remitted = 0;
  for (const t of state.transactions) {
    if (t.deleted || t.date > asOf) continue;
    for (const l of t.lines) if (l.accountId === SALES_TAX_ACCT && (!visible || visible.has(l.storeId))) { collected += l.credit; remitted += l.debit; }
  }
  const ledger = -acctNet(state, [SALES_TAX_ACCT], visible, '0000-01-01', asOf);
  return { collected, remitted, ledger, ok: collected - remitted === ledger };
}

/** Months with 2200 activity, newest first. */
export function salesTaxPeriods(state: BooksState): string[] {
  const s = new Set<string>();
  for (const t of state.transactions) if (!t.deleted && t.lines.some((l) => l.accountId === SALES_TAX_ACCT && l.credit)) s.add(periodOf(t.date));
  return [...s].sort().reverse();
}

/** The filing worksheet as rows (CSV / print). */
export function salesTaxWorksheet(state: BooksState, p: SalesTaxPeriod): (string | number)[][] {
  const code = (id: ID) => state.stores.find((s) => s.id === id)?.code ?? id;
  const d = (c: Cents) => (c / 100).toFixed(2);
  const rows: (string | number)[][] = [['Store', 'POS sales', 'Fuel (excluded)', 'Other non-taxable', 'Taxable sales', 'Rate %', 'Tax on taxable sales', 'Tax collected (2200)', 'Collected outside POS', 'Variance', 'Remitted', 'Not remitted']];
  for (const r of [...p.rows, { ...p.total, storeId: 'TOTAL' }]) rows.push([r.storeId === 'TOTAL' ? 'Total' : code(r.storeId), d(r.posSales), d(r.fuelSales), d(r.nonTaxable), d(r.taxableSales), (p.rateBps / 100).toFixed(2), d(r.expectedTax), d(r.collected), d(r.collectedOther), d(r.variance), d(r.remitted), d(r.unremitted)]);
  return rows;
}

// ── Tax calendar ─────────────────────────────────────────────────────────
export interface TaxCalRow {
  key: string;
  dueDate: string;
  title: string;
  kindLabel: string;
  agency: string;
  covers: string;
  status: string;
  done: boolean;
  overdue: boolean;
  daysLeft: number;
  link?: { to: string; label: string };
  occ?: OccurrenceRow;
  estimate?: { status: EstimateStatus; inst: Installment };
  isReturn: boolean;
}

const RETURN_KINDS: ComplianceKind[] = ['income_tax', 'state_income', 'tobacco_excise', 'fuel_excise', 'info_1099', 'w2', 'property_tax', 'sales_tax', 'payroll', 'annual_report'];

/** The compliance calendar's tax items plus every estimate installment, in one list. */
export function taxCalendar(state: BooksState, opts: { from: string; to: string; today: string; visible?: Set<ID> }): TaxCalRow[] {
  const rows: TaxCalRow[] = occurrences(state, opts).filter((o) => TAX_KINDS.includes(o.item.kind)).map((o) => ({
    key: o.item.id + o.dueDate, dueDate: o.dueDate, title: o.item.title, kindLabel: KIND_LABEL[o.item.kind], agency: o.item.agency + (o.item.form ? ` · ${o.item.form}` : ''), covers: o.covers,
    status: STATUS_LABEL[o.status], done: o.done, overdue: o.overdue, daysLeft: o.daysLeft, link: KIND_LINK[o.item.kind] ?? (o.item.form?.includes('1099') ? KIND_LINK.info_1099 : undefined), occ: o,
    isReturn: RETURN_KINDS.includes(o.item.kind),
  }));
  if (!opts.visible || opts.visible.has(bankStoreId(state))) {
    for (const s of estimates(state, opts.today)) for (const i of s.installments) {
      if (i.dueDate < opts.from || i.dueDate > opts.to) continue;
      rows.push({
        key: s.plan.id + i.quarter, dueDate: i.dueDate, title: `${s.payerName} ${s.plan.jurisdiction} estimate Q${i.quarter} ${s.plan.year}`, kindLabel: KIND_LABEL.estimated_tax,
        agency: s.plan.jurisdiction === 'federal' ? 'IRS · Form 1040-ES' : 'State revenue department', covers: String(s.plan.year),
        status: i.done ? 'Paid' : i.paid ? `Part paid (${money(i.paid)})` : 'Not paid', done: i.done, overdue: i.overdue, daysLeft: i.daysLeft, link: KIND_LINK.estimated_tax, estimate: { status: s, inst: i }, isReturn: false,
      });
    }
  }
  return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
}

/** Notices from tax agencies: the Phase 9 tracker, filtered. */
export function taxNotices(state: BooksState, visible?: Set<ID>) {
  return complianceOf(state).notices.filter((n) => /irs|revenue|tax|treasury|comptroller/i.test(`${n.agency} ${n.noticeType}`) && (!visible || visible.has(n.storeId ?? bankStoreId(state))));
}

// ── Planning ─────────────────────────────────────────────────────────────
export interface LeverRow { key: LeverKey; label: string; amount: Cents; deduction: Cents; taxSaved: Cents; note: string; info?: boolean }

export function leverKey(entityId: ID, year: number, k: LeverKey): string { return `${entityId}:${year}:${k}`; }

export function planning(state: BooksState, entityId: ID, year: number, asOf: string): { projection: Projection; rateBps: number; projectedTax: Cents; levers: LeverRow[]; totalSaved: Cents; afterLevers: Cents } {
  const projection = projectTaxable(state, entityId, year, asOf);
  const rates = ratesOf(state);
  const rid = projection.unit.entity.id;
  const cls = projection.unit.entity.taxClass;
  const rate = cls === 'c_corp_1120' ? rates.cCorpBps : ownerRateBps(state);
  const lv = taxOf(state).levers;
  const amt = (k: LeverKey) => lv[leverKey(rid, year, k)] ?? 0;
  const rows: LeverRow[] = [];
  // Equipment bought and placed in service before year end: bonus, then 5-year MACRS on the rest (mid-quarter if Q4-heavy).
  const eq = amt('equipment');
  const eqDed = Math.round((eq * rates.bonusPct) / 100) + Math.round((eq * (100 - rates.bonusPct) / 100) * (macrsTable(5, 'mid_quarter', 4)[0] / 100));
  rows.push({ key: 'equipment', label: LEVER_LABEL.equipment, amount: eq, deduction: eqDed, taxSaved: pctOf(eqDed, rate), note: `${rates.bonusPct}% bonus, the rest 5-year MACRS. Must be placed in service by 31 Dec; a Q4-heavy year triggers mid-quarter.` });
  // Bonus on this year's assets that don't have it.
  const cur = bookVsTax(state, { year, asOf, returnId: rid }).filter((r) => r.a.inService.startsWith(String(year)) && r.setup.method === 'macrs' && r.setup.bonusPct < rates.bonusPct);
  const bonusDed = cur.reduce((a, r) => {
    const base = r.a.cost - r.setup.section179;
    const newBonus = Math.round((base * rates.bonusPct) / 100);
    const oldFirst = r.tax.total - r.setup.section179;
    const rest = base - newBonus;
    const newFirst = newBonus + Math.round(rest * (assetTable(state, r.a)[0] ?? 0) / 100);
    return a + Math.max(0, newFirst - oldFirst);
  }, 0);
  rows.push({ key: 'elect_bonus', label: LEVER_LABEL.elect_bonus, amount: cur.reduce((a, r) => a + r.a.cost, 0), deduction: bonusDed, taxSaved: pctOf(bonusDed, rate), note: cur.length ? `${cur.length} asset(s) placed in ${year} without full bonus. Electing it pulls deductions forward (less later).` : `Every ${year} asset already takes the bonus in the tables.` });
  const ret = amt('retirement');
  rows.push({ key: 'retirement', label: LEVER_LABEL.retirement, amount: ret, deduction: ret, taxSaved: pctOf(ret, rate), note: 'Employer contributions are deductible and not subject to FICA. Plan limits and deadlines apply.' });
  const sal = amt('salary');
  rows.push({ key: 'salary', label: LEVER_LABEL.salary, amount: sal, deduction: 0, taxSaved: cls === 's_corp_1120s' ? -pctOf(sal, rates.ficaBps) : 0, note: cls === 's_corp_1120s' ? 'Salary moves income from distributions to wages: income tax is about the same; FICA changes. Salary must stay reasonable for the work done.' : 'Applies to S corporations only.' });
  const pass = pctOf(projection.projected, ownerRateBps(state));
  const cTax = pctOf(projection.projected, rates.cCorpBps);
  rows.push({ key: 'restructure', label: LEVER_LABEL.restructure, amount: 0, deduction: 0, taxSaved: cls === 'c_corp_1120' ? 0 : pass - cTax, note: `As a C corporation the entity would pay ${money(cTax)} at ${(rates.cCorpBps / 100).toFixed(0)}% vs ${money(pass)} on the owners now, before tax on dividends and state tax. Information only; talk to the CPA.`, info: true });
  const counted = rows.filter((r) => !r.info);
  const totalSaved = counted.reduce((a, r) => a + r.taxSaved, 0);
  const afterLevers = projection.projected - counted.reduce((a, r) => a + r.deduction, 0);
  return { projection, rateBps: rate, projectedTax: Math.max(0, pctOf(projection.projected, rate)), levers: rows, totalSaved, afterLevers };
}

export function setLever(books: Books, actor: User, entityId: ID, year: number, k: LeverKey, amount: Cents): void {
  books.require(actor, 'tax.edit', 'change planning levers');
  if (!Number.isSafeInteger(amount)) throw errs(['Enter the lever amount in dollars.']);
  if (k !== 'salary' && amount < 0) throw errs(['Enter zero or more.']);
  const t = ensureTax(books);
  const key = leverKey(returnEntityOf(books.state, entityId), year, k);
  const before = t.levers[key];
  if (amount) t.levers[key] = amount; else delete t.levers[key];
  books.audit(actor, { action: 'update', objectType: 'tax', objectId: key, summary: `Planning lever ${LEVER_LABEL[k]}: ${money(amount)}`, before, after: amount });
  books.changed();
}

export function saveTaxRates(books: Books, actor: User, r: Partial<TaxRates>): void {
  books.require(actor, 'tax.edit', 'change the tax tables');
  const problems: string[] = [];
  for (const k of ['ownerFederalBps', 'ownerStateBps', 'cCorpBps', 'pteBps', 'ficaBps', 'salesTaxBps', 'mealsDisallowBps'] as const) {
    const v = r[k];
    if (v !== undefined && !(Number.isInteger(v) && v >= 0 && v <= 10_000)) problems.push(`${k.replace('Bps', '')} must be a percentage from 0 to 100.`);
  }
  if (r.bonusPct !== undefined && !(r.bonusPct >= 0 && r.bonusPct <= 100)) problems.push('Bonus is a percentage from 0 to 100.');
  for (const k of ['grossReceiptsThreshold', 'section179Limit', 'section179Phaseout', 'safeHarborAgi'] as const) {
    const v = r[k];
    if (v !== undefined && !(Number.isSafeInteger(v) && v >= 0)) problems.push(`Enter ${k} as an amount of zero or more.`);
  }
  if (r.macrsYears) for (const [cls, y] of Object.entries(r.macrsYears)) if (!(y === 0 || [3, 5, 7, 10, 15, 20, 27.5, 39].includes(y))) problems.push(`${cls}: pick a MACRS recovery period (3, 5, 7, 10, 15, 20, 27.5 or 39), or 0.`);
  if (problems.length) throw errs(problems);
  const t = ensureTax(books);
  const before = structuredClone(t.rates);
  t.rates = { ...t.rates, ...r };
  books.audit(actor, { action: 'update', objectType: 'tax', objectId: 'rates', summary: 'Changed the tax tables', before, after: structuredClone(t.rates) });
  books.changed();
}

// ── Inbox (SPEC §9 tax alerts) ───────────────────────────────────────────
export interface TaxInboxItem { key: string; count: number; title: string; detail: string; to: string; action: string }

export function taxInbox(state: BooksState, visible: Set<ID>, today: string): TaxInboxItem[] {
  if (!visible.has(bankStoreId(state))) return [];
  const due = estimatesDueSoon(state, today, 14);
  const returns = taxCalendar(state, { from: today, to: addDays(today, 30), today, visible }).filter((r) => r.isReturn && !r.done && ['income_tax', 'state_income', 'tobacco_excise', 'info_1099', 'w2', 'property_tax'].includes(r.occ?.item.kind ?? ''));
  const periods = salesTaxPeriods(state).slice(0, 12).map((p) => salesTaxPeriod(state, p, { today, visible })).filter((p) => p.remitFlag);
  return [
    { key: 'taxest', count: due.length, title: 'Estimated tax due within 14 days', detail: due.length ? due.map((d) => `${d.status.payerName} ${d.status.plan.jurisdiction} Q${d.inst.quarter} ${money(d.inst.short)} ${d.inst.overdue ? `was due ${d.inst.dueDate}` : `due ${d.inst.dueDate}`}`).join('; ') : 'No estimate is due in the next 14 days.', to: '/tax/estimates', action: 'Pay' },
    { key: 'taxreturn', count: returns.length, title: 'Tax returns due within 30 days', detail: returns.length ? returns.map((r) => `${r.title} due ${r.dueDate}`).join('; ') : 'No income, excise or information return due in the next 30 days.', to: '/tax/calendar', action: 'Prepare' },
    { key: 'salestaxvar', count: periods.length, title: 'Sales tax collected ≠ remitted', detail: periods.length ? periods.map((p) => `${p.period}: ${money(p.total.unremitted)} ${p.total.unremitted > 0 ? 'not remitted' : 'over-remitted'}`).join('; ') : 'Every filed month remitted what was collected.', to: periods[0] ? `/tax/sales-tax?period=${periods[0].period}` : '/tax/sales-tax', action: 'Review' },
  ];
}

