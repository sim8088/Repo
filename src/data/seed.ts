import { Books } from '../core/books';
import { recordCashStep, depositBags, recordPayout, poolBalance, posExpectedCash, bagFlagged } from '../core/cash';
import { guessDepositSource, reconcileStatus, saveReconciliation } from '../core/bank';
import type { BankLine, DepositSource } from '../core/types';
import { defaultChartOfAccounts } from '../core/coa';
import { addDays, dayOfWeek, lastDayOfPeriod } from '../core/dates';
import type { DraftLine, TxnDraft } from '../core/ledger';
import { SYS } from '../core/ledger';
import type { BooksState, Entity, Party, Rule, Store, User } from '../core/types';
import { emptyPeople } from '../core/payroll';
import { seedPayroll } from './seed-payroll';
import { emptyFuel } from '../core/fuel';
import { FuelDemo, addUnpostedNoticeBankLines } from './seed-fuel';
import { generateRent } from '../core/intercompany';
import { rentTemplates, seedIntercompany } from './seed-intercompany';
import { seedPayables } from './seed-payables';
import { seedReceivables } from './seed-receivables';
import { seedReports } from './seed-reports';
import { emptyReports } from '../core/statements';
import { emptyBudgets } from '../core/budgets';
import { emptyClose } from '../core/close';
import { seedBudgets } from './seed-budgets';
import { seedClose } from './seed-close';

/**
 * Demo dataset: four operating stores, Gulfport (leased out) and Corporate, 1 Sep – 26 Nov 2026.
 * Every transaction is posted through the real ledger, so it is validated and balanced
 * exactly like a manual entry. Amounts are illustrative, not real figures.
 */
export const DEMO_START = '2026-09-01';
export const DEMO_END = '2026-11-26';
export const SCHEMA = 2;
/** The demo bank feed runs through this date; later checks are still outstanding. */
export const FEED_END = '2026-11-25';

export const CFO_ID = 'usr_cfo';

/** What a module's demo seeder gets. Post through `books` so every entry is validated and balanced. */
export interface SeedCtx {
  state: BooksState;
  books: Books;
  cfo: User;
  /** Deterministic random in [0, 1). */
  rand: () => number;
  /** Set the clock entries are stamped with (YYYY-MM-DD). */
  setClock: (date: string) => void;
}

/**
 * Module seeders, run in order after the core demo (POS, fuel loads, settlements, payroll, cash chain)
 * and before the bank feed is built, so anything they post to Trustmark shows up on the statement.
 * Periods are still open when they run.
 */
export const MODULE_SEEDS: ((ctx: SeedCtx) => void)[] = [
  seedPayroll,
  seedIntercompany, seedPayables, seedReceivables,
  seedReports,
  seedBudgets, seedClose,
];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ENTITIES: Entity[] = [
  { id: 'ent_corp', code: 'CORP', name: 'Corporate / Management (demo)', taxClass: 's_corp_1120s', isHub: true },
  { id: 'ent_hm11', code: 'HM11', name: 'Gluckstadt store entity (demo)', taxClass: 'disregarded' },
  { id: 'ent_hm13', code: 'HM13', name: 'Meadville store entity (demo)', taxClass: 'disregarded' },
  { id: 'ent_hm14', code: 'HM14', name: 'Gulfport property entity (demo)', taxClass: 'disregarded' },
  { id: 'ent_hm15', code: 'HM15', name: 'Crystal Springs store entity (demo)', taxClass: 'disregarded' },
  { id: 'ent_hm17', code: 'HM17', name: 'Centreville store entity (demo)', taxClass: 'disregarded' },
];

const STORES: Store[] = [
  { id: 'st_hm11', code: 'HM11', name: 'Gluckstadt', entityId: 'ent_hm11', kind: 'operating', fuelSupplier: 'craddock', payroll: 'cash', hasKitchen: true, hasTruckLane: false, notes: 'Craddock (Exxon). BBQ & fried kitchen. Payroll all cash. Tenant rent income.' },
  { id: 'st_hm13', code: 'HM13', name: 'Meadville', entityId: 'ent_hm13', kind: 'operating', fuelSupplier: 'craddock', payroll: 'gusto', hasKitchen: true, hasTruckLane: false, notes: 'Craddock. Kitchen. Gusto payroll.' },
  { id: 'st_hm15', code: 'HM15', name: 'Crystal Springs', entityId: 'ent_hm15', kind: 'operating', fuelSupplier: 'dash', payroll: 'gusto', hasKitchen: true, hasTruckLane: true, notes: 'Dash Oil. Truck lane: Comdata, Mudflap, Fiserv/AccessOne. Kitchen. Gusto payroll.' },
  { id: 'st_hm17', code: 'HM17', name: 'Centreville', entityId: 'ent_hm17', kind: 'operating', fuelSupplier: 'dash', payroll: 'gusto', hasKitchen: false, hasTruckLane: false, openedOn: '2026-11-01', notes: 'Dash Oil. Opened Nov 2026. Gusto payroll.' },
  { id: 'st_hm14', code: 'HM14', name: 'Gulfport', entityId: 'ent_hm14', kind: 'leased_out', fuelSupplier: 'none', payroll: 'none', hasKitchen: false, hasTruckLane: false, notes: 'Leased to an operator. Rent income only; out of operating scope.' },
  { id: 'st_corp', code: 'CORP', name: 'Corporate', entityId: 'ent_corp', kind: 'corporate', fuelSupplier: 'none', payroll: 'gusto', hasKitchen: false, hasTruckLane: false, notes: 'Office payroll, shared costs, intercompany hub. Owns the shared Trustmark account.' },
];

const PARTIES: Party[] = [
  { id: 'pt_craddock', name: 'Craddock Oil', type: 'vendor' },
  { id: 'pt_dash', name: 'Dash Oil', type: 'related_company', notes: 'Fuel supplier owned by the same owners.' },
  { id: 'pt_dhunna', name: 'Dhunna Development', type: 'related_company', notes: 'Pays store mortgages; reimbursed through Corporate.' },
  { id: 'pt_skd', name: 'SKD Properties', type: 'related_company', notes: 'Pays store mortgages; reimbursed through Corporate.' },
  { id: 'pt_cheers', name: 'Cheers', type: 'related_company', notes: 'Liquor store next door.' },
  { id: 'pt_southern_eagle', name: 'Southern Eagle', type: 'related_company', notes: 'Payments out are loans; deposits in are repayments.' },
  { id: 'pt_rowdys', name: "Rowdy's", type: 'related_company' },
  { id: 'pt_bullseye', name: 'Bullseye', type: 'related_company' },
  { id: 'pt_five_rivers', name: 'Five Rivers', type: 'related_company' },
  { id: 'pt_owner_a', name: 'Owner A', type: 'owner' },
  { id: 'pt_owner_b', name: 'Owner B', type: 'owner' },
  { id: 'pt_entergy', name: 'Entergy Mississippi', type: 'vendor', defaultAccountId: 'acct_utilities' },
  { id: 'pt_sysco', name: 'Sysco', type: 'vendor', defaultAccountId: 'acct_cogs_food' },
  { id: 'pt_tobacco', name: 'Tobacco wholesaler', type: 'vendor', defaultAccountId: 'acct_cogs_tobacco' },
  { id: 'pt_grocery', name: 'Grocery wholesaler', type: 'vendor', defaultAccountId: 'acct_cogs_grocery' },
  { id: 'pt_beer', name: 'Beer distributor', type: 'vendor', defaultAccountId: 'acct_cogs_beer' },
  { id: 'pt_gusto', name: 'Gusto', type: 'vendor', defaultAccountId: 'acct_wages' },
  { id: 'pt_insurer', name: 'Property & liability insurer', type: 'vendor', defaultAccountId: 'acct_insurance' },
  { id: 'pt_cpa', name: 'Outside CPA firm', type: 'vendor', defaultAccountId: 'acct_professional', is1099: true },
  { id: 'pt_repair', name: 'Petroleum equipment repair', type: 'vendor', defaultAccountId: 'acct_repairs', is1099: true },
  { id: 'pt_taco_feliz', name: 'Taco Feliz (tenant)', type: 'tenant', defaultStoreId: 'st_hm11' },
  { id: 'pt_mavs', name: 'Mavs Booster Club (tenant)', type: 'tenant', defaultStoreId: 'st_hm11' },
  { id: 'pt_gulfport_op', name: 'Gulfport operator (tenant)', type: 'tenant', defaultStoreId: 'st_hm14' },
  { id: 'pt_trustmark', name: 'Trustmark', type: 'lender' },
];

const USERS: User[] = [
  { id: CFO_ID, name: 'CFO', role: 'cfo', active: true },
  { id: 'usr_bk', name: 'Bookkeeper (demo)', role: 'bookkeeper', active: true },
  { id: 'usr_mgr11', name: 'HM11 manager (demo)', role: 'store_manager', storeIds: ['st_hm11'], active: true },
  { id: 'usr_owner', name: 'Owner (demo)', role: 'owner', active: true },
  { id: 'usr_cpa', name: 'Outside accountant (demo)', role: 'reviewer', active: true },
];

export function emptyState(): BooksState {
  return {
    schema: SCHEMA,
    settings: {
      companyName: 'Hotspot stores',
      timezone: 'America/Chicago',
      fiscalYearStartMonth: 1,
      materialityCents: 500,
      ownerWithdrawalPolicy: 'expense',
      ownerWithdrawalExpenseAccountId: 'acct_misc',
      jeApprovalLimitCents: 1_000_000,
      depositWithinDays: 2,
      staleCheckDays: 60,
      forecastDisabled: [],
    },
    entities: structuredClone(ENTITIES),
    stores: structuredClone(STORES),
    accounts: defaultChartOfAccounts(),
    parties: structuredClone(PARTIES),
    users: structuredClone(USERS),
    rules: [],
    transactions: [],
    periods: {},
    audit: [],
    dismissedDuplicates: [],
    bank: { lines: [], batches: [], reconciliations: [], openings: {} },
    cash: { bags: [], payouts: [] },
    forecastItems: [],
    people: emptyPeople(),
    fuel: emptyFuel(),
    intercompany: { limits: {}, rentTemplates: [] },
    payables: { bills: [], utilities: [], statements: [] },
    receivables: { rent: [], items: [] },
    reports: emptyReports(),
    budgets: emptyBudgets(),
    close: emptyClose(),
    seq: 0,
  };
}

const c = (dollars: number) => Math.round(dollars * 100);
const dr = (accountId: string, storeId: string, cents: number, memo?: string, partyId?: string): DraftLine => ({ accountId, storeId, debit: cents, credit: 0, memo, partyId });
const cr = (accountId: string, storeId: string, cents: number, memo?: string, partyId?: string): DraftLine => ({ accountId, storeId, debit: 0, credit: cents, memo, partyId });

interface Profile {
  store: string;
  gallons: number;
  diesel: number;
  inside: number;
  kitchen: number;
  alcohol: boolean;
  clearing: 'acct_craddock' | 'acct_dash';
  supplier: 'pt_craddock' | 'pt_dash';
  opened: string;
}

const PROFILES: Profile[] = [
  { store: 'st_hm11', gallons: 1900, diesel: 120, inside: 3400, kitchen: 950, alcohol: true, clearing: 'acct_craddock', supplier: 'pt_craddock', opened: DEMO_START },
  { store: 'st_hm13', gallons: 1350, diesel: 90, inside: 2600, kitchen: 700, alcohol: true, clearing: 'acct_craddock', supplier: 'pt_craddock', opened: DEMO_START },
  { store: 'st_hm15', gallons: 2500, diesel: 950, inside: 2900, kitchen: 620, alcohol: false, clearing: 'acct_dash', supplier: 'pt_dash', opened: DEMO_START },
  { store: 'st_hm17', gallons: 1050, diesel: 60, inside: 1500, kitchen: 0, alcohol: true, clearing: 'acct_dash', supplier: 'pt_dash', opened: '2026-11-01' },
];

export function buildDemo(): BooksState {
  const state = emptyState();
  let clockDate = '2026-08-31';
  const books = new Books(state, () => clockDate + 'T17:00:00.000Z');
  const cfo = state.users[0];
  const rand = rng(20261127);
  const jitter = (pct: number) => 1 + (rand() * 2 - 1) * pct;
  const post = (d: TxnDraft) => {
    clockDate = d.date;
    return books.createTransaction(cfo, d, { source: 'demo', batchId: 'demo-2026Q4' });
  };

  // Opening balances, one per entity so each entity balances on its own.
  post({ date: '2026-08-31', kind: 'opening', description: 'Opening balances – Corporate', lines: [
    dr('acct_trustmark', 'st_corp', c(142_500)), dr('acct_prepaid', 'st_corp', c(18_400)),
    cr('acct_due_related', 'st_corp', c(24_000), 'Owed to Dhunna / SKD', 'pt_dhunna'), cr('acct_owner_capital', 'st_corp', c(136_900)),
  ] });
  for (const p of PROFILES) {
    if (p.opened > DEMO_START) continue;
    post({ date: '2026-08-31', kind: 'opening', description: `Opening balances – ${state.stores.find((s) => s.id === p.store)!.code}`, lines: [
      dr('acct_cash_registers', p.store, c(6_500)), dr(p.clearing, p.store, c(14_000)), dr('acct_inv_fuel', p.store, c(38_000)),
      dr('acct_inv_merch', p.store, c(52_000)), dr('acct_equipment', p.store, c(310_000)), cr('acct_accum_dep', p.store, c(96_000)),
      cr('acct_owner_capital', p.store, c(324_500)),
    ] });
  }
  post({ date: '2026-08-31', kind: 'opening', description: 'Opening balances – HM14', lines: [
    dr('acct_buildings', 'st_hm14', c(640_000)), cr('acct_owner_capital', 'st_hm14', c(640_000)),
  ] });
  post({ date: '2026-11-01', kind: 'opening', description: 'Opening balances – HM17 (store opened)', lines: [
    dr('acct_cash_registers', 'st_hm17', c(4_000)), dr('acct_inv_merch', 'st_hm17', c(38_000)), dr('acct_equipment', 'st_hm17', c(280_000)),
    cr('acct_owner_capital', 'st_hm17', c(322_000)),
  ] });

  // Fuel: tanks, prices, deliveries, notices and settlements go through the fuel subledger (seed-fuel.ts).
  const setClock = (d: string) => { clockDate = d; };
  const fuelDemo = new FuelDemo(state, books, cfo, rand, setClock, Object.fromEntries(PROFILES.map((p) => [p.store, p.opened])));
  fuelDemo.init();
  const craddockStores = PROFILES.filter((p) => p.supplier === 'pt_craddock').map((p) => p.store);
  const dashStores = PROFILES.filter((p) => p.supplier === 'pt_dash').map((p) => p.store);
  state.intercompany.rentTemplates = rentTemplates();

  // Running subledger positions the generator needs.
  const fiserv = { bal: 0, monthCard: {} as Record<string, number> };
  const deptWeek: Record<string, { tobacco: number; grocery: number; beer: number; kitchen: number }> = {};
  for (const p of PROFILES) {
    deptWeek[p.store] = { tobacco: 0, grocery: 0, beer: 0, kitchen: 0 };
  }
  const code = (id: string) => state.stores.find((s) => s.id === id)!.code;

  for (let d = DEMO_START; d <= DEMO_END; d = addDays(d, 1)) {
    const dow = dayOfWeek(d);
    const dayOfMonth = Number(d.slice(8, 10));
    const wk = dow === 5 || dow === 6 ? 1.12 : dow === 0 ? 0.88 : 1;

    // ── Daily POS close per store
    for (const p of PROFILES) {
      if (d < p.opened) continue;
      const ramp = p.store === 'st_hm17' ? 0.6 + 0.4 * Math.min(1, (Number(d.slice(8, 10)) || 1) / 26) : 1;
      fuelDemo.morning(p.store, d, { regular: p.gallons * 0.815, premium: p.gallons * 0.185, diesel: p.diesel });
      const gal = p.gallons * wk * ramp * jitter(0.08);
      const g = { regular: Math.round(gal * 0.78), plus: Math.round(gal * 0.07), premium: Math.round(gal * 0.15) };
      const diesel = Math.round(p.diesel * wk * jitter(0.15));
      const price = (grade: 'regular' | 'plus' | 'premium' | 'diesel') => fuelDemo.price(p.store, grade, d);
      const fuel = {
        regular: Math.round(g.regular * price('regular')), plus: Math.round(g.plus * price('plus')), premium: Math.round(g.premium * price('premium')),
      };
      const dieselRetail = Math.round(diesel * price('diesel'));
      const inside = p.inside * wk * ramp * jitter(0.1);
      const dept = {
        beer: p.alcohol ? c(inside * 0.3) : 0,
        tobacco: c(inside * (p.alcohol ? 0.28 : 0.4)),
        grocery: c(inside * (p.alcohol ? 0.2 : 0.3)),
        bev: c(inside * 0.18),
        other: c(inside * 0.04),
      };
      const kitchen = p.kitchen ? c(p.kitchen * wk * jitter(0.12)) : 0;
      const taxable = dept.beer + dept.tobacco + dept.grocery + dept.bev + dept.other + kitchen;
      const salesTax = Math.round(taxable * 0.07);
      const fuelTotal = fuel.regular + fuel.plus + fuel.premium;
      // HM15 diesel is the truck lane, settled through Fiserv / Comdata, not Dash.
      const truck = p.store === 'st_hm15';
      const card = Math.round(fuelTotal * 0.72 + (taxable + salesTax) * 0.55 + (truck ? 0 : dieselRetail * 0.8));
      const truckCard = truck ? dieselRetail : 0;
      const total = fuelTotal + dieselRetail + taxable + salesTax;
      const cash = total - card - truckCard;
      const lines: DraftLine[] = [
        dr(p.clearing, p.store, card, 'Card sales'),
        dr('acct_cash_registers', p.store, cash, 'Register cash'),
        cr('acct_fuel_regular', p.store, fuel.regular, `${g.regular} gal`),
        cr('acct_fuel_plus', p.store, fuel.plus, `${g.plus} gal`),
        cr('acct_fuel_premium', p.store, fuel.premium, `${g.premium} gal`),
        cr('acct_fuel_diesel', p.store, dieselRetail, `${diesel} gal${truck ? ' (truck lane)' : ''}`),
        cr('acct_sales_tobacco', p.store, dept.tobacco),
        cr('acct_sales_grocery', p.store, dept.grocery),
        cr('acct_sales_bev', p.store, dept.bev),
        cr('acct_sales_merch_other', p.store, dept.other),
        cr('acct_sales_tax', p.store, salesTax, '7% on inside & kitchen'),
      ];
      if (truckCard) lines.splice(1, 0, dr('acct_fiserv', p.store, truckCard, 'Truck lane cards'));
      if (dept.beer) lines.push(cr('acct_sales_beer', p.store, dept.beer));
      if (kitchen) lines.push(cr('acct_sales_kitchen', p.store, kitchen));
      const pos = post({ date: d, kind: 'journal', description: `POS daily close ${code(p.store)}`, tags: ['pos'], lines });
      fuelDemo.recordDay(p.store, d, {
        txnId: pos.id, card,
        sales: [{ grade: 'regular', gallons: g.regular, retail: fuel.regular }, { grade: 'plus', gallons: g.plus, retail: fuel.plus }, { grade: 'premium', gallons: g.premium, retail: fuel.premium },
          ...(truck ? [] : [{ grade: 'diesel' as const, gallons: diesel, retail: dieselRetail }])],
        truck: truck ? { gallons: diesel, sales: dieselRetail } : undefined,
      });
      clockDate = d;
      {
        const r = rand();
        const variance = r < 0.035 ? -c(6 + Math.round(rand() * 40)) : r < 0.09 ? -Math.round(rand() * 400) : 0;
        const expected = posExpectedCash(state, p.store, d) ?? cash;
        recordCashStep(books, cfo, { storeId: p.store, businessDate: d, stage: 'count', amount: expected + variance, person: `${code(p.store)} manager` });
      }
      if (truck) {
        fiserv.bal += truckCard;
        fiserv.monthCard[d.slice(0, 7)] = (fiserv.monthCard[d.slice(0, 7)] ?? 0) + truckCard;
      }
      deptWeek[p.store].tobacco += dept.tobacco;
      deptWeek[p.store].grocery += dept.grocery + dept.bev + dept.other;
      deptWeek[p.store].beer += dept.beer;
      deptWeek[p.store].kitchen += kitchen;
    }

    // ── Cash chain. Yesterday's bags are picked up and recounted at HQ this morning;
    // today's are counted tonight after the POS close (below). Deposits go Mon / Wed / Fri.
    clockDate = d;
    for (const p of PROFILES) {
      const prev = addDays(d, -1);
      if (prev < p.opened) continue;
      const bag = state.cash.bags.find((b) => b.storeId === p.store && b.businessDate === prev);
      if (!bag) continue;
      const counted = bag.events[0].amount;
      const pickupShort = rand() < 0.015 ? c(20) : 0;
      recordCashStep(books, cfo, { storeId: p.store, businessDate: prev, stage: 'pickup', amount: counted - pickupShort, person: 'Route operator', date: d });
      recordCashStep(books, cfo, { storeId: p.store, businessDate: prev, stage: 'hq_receipt', amount: counted - pickupShort, person: 'HQ clerk', date: d });
    }
    if (dow === 5) {
      const hm11 = c(4_600 * jitter(0.05));
      recordPayout(books, cfo, { date: d, fromStoreId: 'st_corp', kind: 'payroll', payee: 'HM11 crew (weekly cash payroll)', amount: hm11, person: 'HQ clerk', accountId: 'acct_wages', storeId: 'st_hm11' });
    }
    if (dow === 1 || dow === 3 || dow === 5) {
      const ready = state.cash.bags.filter((b) => b.events.some((e) => e.stage === 'hq_receipt') && !b.events.some((e) => e.stage === 'deposit')
        && !(b.storeId === 'st_hm13' && b.businessDate === '2026-11-21')); // one bag held back: the inbox flags it overdue
      const amount = poolBalance(state, d) - c(3_000); // keep a float at HQ for payouts
      if (ready.length && amount > 0) depositBags(books, cfo, { bagIds: ready.map((b) => b.id), date: d, amount, person: 'HQ clerk', slipNo: `DS-${d.replace(/-/g, '').slice(2)}` });
    }

    // ── Supplier settlement: Craddock EFT notices (Mondays), Dash invoices on their due dates, Dash statements (Tuesdays).
    fuelDemo.settle(d, craddockStores, dashStores);
    fiserv.bal -= fuelDemo.mudflap(d);

    // ── Fiserv truck-lane deposits every other day; fees the following month.
    if (dow === 2 || dow === 4) {
      if (fiserv.bal > 0) {
        post({ date: d, kind: 'transfer', description: 'MER BNKCD DEPOSIT', tags: ['truck lane'], lines: [dr('acct_trustmark', 'st_corp', fiserv.bal), cr('acct_fiserv', 'st_hm15', fiserv.bal)] });
        fiserv.bal = 0;
      }
    }
    if (dayOfMonth === 4) {
      const prev = d.slice(0, 7) === '2026-10' ? '2026-09' : d.slice(0, 7) === '2026-11' ? '2026-10' : null;
      if (prev && fiserv.monthCard[prev]) {
        const fee = Math.round(fiserv.monthCard[prev] * 0.0245);
        post({ date: d, kind: 'money_out', description: `MER BNKCD FEE ${prev}`, tags: ['truck lane'], lines: [dr('acct_card_fees', 'st_hm15', fee, `Fiserv fees for ${prev}`), cr('acct_trustmark', 'st_corp', fee)] });
      }
    }

    // ── Weekly payroll on Fridays.
    if (dow === 5) {
      const gusto: [string, number][] = [['st_hm13', 4_150], ['st_hm15', 5_300], ['st_corp', 3_600]];
      if (d >= '2026-11-01') gusto.push(['st_hm17', 2_750]);
      for (const [s, net] of gusto) {
        const n = c(net * jitter(0.06));
        const tax = Math.round(n * 0.31);
        post({ date: d, kind: 'money_out', description: `GUSTO PAYROLL ${code(s)}`, partyId: 'pt_gusto', tags: ['payroll'], lines: [
          dr('acct_wages', s, n, 'Net pay'), dr('acct_payroll_taxes', s, tax, 'Employee + employer taxes'), cr('acct_trustmark', 'st_corp', n + tax),
        ] });
      }
    }

    // ── Weekly merchandise & kitchen purchases on Thursdays.
    if (dow === 4) {
      for (const p of PROFILES) {
        if (d < p.opened) continue;
        const w = deptWeek[p.store];
        const buys: [string, string, number][] = [
          ['pt_tobacco', 'acct_cogs_tobacco', Math.round(w.tobacco * 0.82)],
          ['pt_grocery', 'acct_cogs_grocery', Math.round(w.grocery * 0.66)],
        ];
        if (w.beer) buys.push(['pt_beer', 'acct_cogs_beer', Math.round(w.beer * 0.74)]);
        if (w.kitchen) buys.push(['pt_sysco', 'acct_cogs_food', Math.round(w.kitchen * 0.36)]);
        for (const [party, acct, amt] of buys) {
          if (amt <= 0) continue;
          const name = state.parties.find((x) => x.id === party)!.name;
          post({ date: d, kind: 'money_out', description: `${name.toUpperCase()} ${code(p.store)}`, partyId: party, tags: ['purchases'], lines: [dr(acct, p.store, amt), cr('acct_trustmark', 'st_corp', amt)] });
        }
        deptWeek[p.store] = { tobacco: 0, grocery: 0, beer: 0, kitchen: 0 };
      }
    }

    // ── Monthly items.
    if (dayOfMonth === 1) {
      // Rent pass-throughs: related party pays the mortgage → store rent + Corporate payable. Generated from the templates (Intercompany › Rent pass-throughs).
      clockDate = d;
      generateRent(books, cfo, d.slice(0, 7));
    }
    if (dayOfMonth === 3) {
      for (const [party, store, amt] of [['pt_taco_feliz', 'st_hm11', 2_800], ['pt_mavs', 'st_hm11', 650], ['pt_gulfport_op', 'st_hm14', 8_500]] as const) {
        const name = state.parties.find((x) => x.id === party)!.name.replace(' (tenant)', '');
        post({ date: d, kind: 'money_in', description: `DEPOSIT ${name.toUpperCase()} RENT`, partyId: party, tags: ['rent'], lines: [dr('acct_trustmark', 'st_corp', c(amt)), cr('acct_rent_income', store, c(amt))] });
      }
    }
    if (dayOfMonth === 12) {
      const reimb: [string, number][] = [['pt_dhunna', c(41_000)], ['pt_skd', c(31_042.79)]];
      for (const [party, amt] of reimb) {
        post({ date: d, kind: 'money_out', description: `ONLINE TRANSFER TO ${party === 'pt_skd' ? 'SKD PROPERTIES' : 'DHUNNA DEVELOPMENT'}`, partyId: party, tags: ['intercompany'], lines: [dr('acct_due_related', 'st_corp', amt, 'Mortgage reimbursement', party), cr('acct_trustmark', 'st_corp', amt)] });
      }
    }
    if (dayOfMonth === 15) {
      const util: [string, number][] = [['st_hm11', 5_420], ['st_hm13', 3_960], ['st_hm15', 6_180], ['st_corp', 640]];
      if (d >= '2026-11-01') util.push(['st_hm17', 2_310]);
      for (const [s, amt] of util) {
        post({ date: d, kind: 'money_out', description: `ACH DEBIT ENTERGY MS ${code(s)}`, partyId: 'pt_entergy', tags: ['utilities'], lines: [dr('acct_utilities', s, c(amt * jitter(0.08))), cr('acct_trustmark', 'st_corp', 0)].map((l, i, arr) => (i === 1 ? { ...l, credit: arr[0].debit } : l)) });
      }
      post({ date: d, kind: 'money_out', description: 'INSURANCE PREMIUM INSTALLMENT', partyId: 'pt_insurer', lines: [dr('acct_insurance', 'st_corp', c(6_840)), cr('acct_trustmark', 'st_corp', c(6_840))] });
    }
    if (dayOfMonth === 20) {
      post({ date: d, kind: 'money_out', description: 'CPA MONTHLY BOOKKEEPING', partyId: 'pt_cpa', checkNo: String(4100 + Number(d.slice(5, 7))), lines: [dr('acct_professional', 'st_corp', c(2_500)), cr('acct_trustmark', 'st_corp', c(2_500))] });
      for (const p of PROFILES) {
        if (d < p.opened) continue;
        const amt = c(880 * jitter(0.2));
        post({ date: d, kind: 'money_in', description: `MS LOTTERY COMMISSION ${code(p.store)}`, tags: ['lottery'], lines: [dr('acct_trustmark', 'st_corp', amt), cr('acct_sales_lottery', p.store, amt)] });
      }
      post({ date: d, kind: 'money_in', description: 'ATM INCOME SUPER FAST', lines: [dr('acct_trustmark', 'st_corp', c(640 * jitter(0.15))), cr('acct_atm_income', 'st_corp', 0)].map((l, i, arr) => (i === 1 ? { ...l, credit: arr[0].debit } : l)) });
    }
    if (dayOfMonth === 28) {
      post({ date: d, kind: 'money_out', description: 'SERVICE CHARGE', lines: [dr('acct_bank_fees', 'st_corp', c(45)), cr('acct_trustmark', 'st_corp', c(45))] });
      const rep = c(900 * jitter(0.5));
      const s = ['st_hm11', 'st_hm13', 'st_hm15'][Math.floor(rand() * 3)];
      post({ date: d, kind: 'money_out', description: `DISPENSER REPAIR ${code(s)}`, partyId: 'pt_repair', lines: [dr('acct_repairs', s, rep), cr('acct_trustmark', 'st_corp', rep)] });
    }
    if (d === lastDayOfPeriod(d.slice(0, 7))) {
      post({ date: d, kind: 'journal', description: `Depreciation ${d.slice(0, 7)}`, tags: ['depreciation'], lines: [
        dr('acct_depreciation', 'st_hm11', c(2_600)), dr('acct_depreciation', 'st_hm13', c(2_100)), dr('acct_depreciation', 'st_hm15', c(2_950)),
        cr('acct_accum_dep', 'st_hm11', c(2_600)), cr('acct_accum_dep', 'st_hm13', c(2_100)), cr('acct_accum_dep', 'st_hm15', c(2_950)),
      ] });
    }
  }

  // ── One-off related-party and owner items.
  const ownerExpense = state.settings.ownerWithdrawalExpenseAccountId ?? 'acct_misc';
  const oneOffs: TxnDraft[] = [
    { date: '2026-09-18', kind: 'money_out', description: 'CHECK 4107 CHEERS', checkNo: '4107', partyId: 'pt_cheers', tags: ['intercompany'], memo: "Paid Cheers' supplier bill from the shared account", lines: [dr('acct_loans_related', 'st_corp', c(2_150), 'Advance to Cheers', 'pt_cheers'), cr('acct_trustmark', 'st_corp', c(2_150))] },
    { date: '2026-10-06', kind: 'money_out', description: 'ONLINE TRANSFER SOUTHERN EAGLE', partyId: 'pt_southern_eagle', tags: ['intercompany'], lines: [dr('acct_loans_related', 'st_corp', c(15_000), 'Loan to Southern Eagle', 'pt_southern_eagle'), cr('acct_trustmark', 'st_corp', c(15_000))] },
    { date: '2026-11-12', kind: 'money_in', description: 'DEPOSIT SOUTHERN EAGLE', partyId: 'pt_southern_eagle', tags: ['intercompany'], lines: [dr('acct_trustmark', 'st_corp', c(5_000)), cr('acct_loans_related', 'st_corp', c(5_000), 'Repayment from Southern Eagle', 'pt_southern_eagle')] },
    { date: '2026-10-21', kind: 'money_in', description: 'ACH CREDIT REYNOLDS AMERICAN REBATE', tags: ['rebates'], lines: [dr('acct_trustmark', 'st_corp', c(3_240.6)), cr('acct_rebates', 'st_corp', c(3_240.6))] },
    { date: '2026-09-25', kind: 'money_out', description: 'CHECK 4111 OWNER A', checkNo: '4111', partyId: 'pt_owner_a', tags: ['owner'], lines: [dr(ownerExpense, 'st_corp', c(5_000), 'Owner withdrawal', 'pt_owner_a'), cr('acct_trustmark', 'st_corp', c(5_000))] },
    { date: '2026-10-24', kind: 'money_out', description: 'ACH OWNER B', partyId: 'pt_owner_b', tags: ['owner'], lines: [dr(ownerExpense, 'st_corp', c(3_500), 'Owner withdrawal', 'pt_owner_b'), cr('acct_trustmark', 'st_corp', c(3_500))] },
    { date: '2026-11-21', kind: 'money_out', description: 'CHECK 4126 OWNER A', checkNo: '4126', partyId: 'pt_owner_a', tags: ['owner'], lines: [dr(ownerExpense, 'st_corp', c(5_000), 'Owner withdrawal', 'pt_owner_a'), cr('acct_trustmark', 'st_corp', c(5_000))] },
    // A likely duplicate the inbox should catch.
    { date: '2026-11-10', kind: 'money_out', description: 'SYSCO INVOICE 77120419', partyId: 'pt_sysco', lines: [dr('acct_cogs_food', 'st_hm13', c(1_284.36)), cr('acct_trustmark', 'st_corp', c(1_284.36))] },
    { date: '2026-11-12', kind: 'money_out', description: 'SYSCO INV 77120419', partyId: 'pt_sysco', lines: [dr('acct_cogs_food', 'st_hm13', c(1_284.36)), cr('acct_trustmark', 'st_corp', c(1_284.36))] },
  ];
  // Bank lines nobody has categorized yet.
  const uncat: [string, string, number, 'out' | 'in'][] = [
    ['2026-11-17', 'POS PURCHASE HOME DEPOT 4471 BRANDON MS', 312.48, 'out'],
    ['2026-11-18', 'ACH DEBIT ATMOS ENERGY 7781', 218.4, 'out'],
    ['2026-11-19', 'ONLINE PMT VERIZON WIRELESS', 389.11, 'out'],
    ['2026-11-23', 'CHECKCARD AMAZON MKTPLACE PMTS', 86.17, 'out'],
    ['2026-11-24', 'POS PURCHASE HOME DEPOT 4471 BRANDON MS', 1_046.9, 'out'],
    ['2026-11-25', 'DEPOSIT MOBILE 0412', 1_240, 'in'],
  ];
  for (const [date, desc, amt, dir] of uncat) {
    oneOffs.push({ date, kind: dir === 'out' ? 'money_out' : 'money_in', description: desc, tags: ['bank'], lines: dir === 'out'
      ? [dr(SYS.uncatExpense, 'st_corp', c(amt)), cr('acct_trustmark', 'st_corp', c(amt))]
      : [dr('acct_trustmark', 'st_corp', c(amt)), cr(SYS.uncatIncome, 'st_corp', c(amt))] });
  }
  for (const t of oneOffs.sort((a, b) => a.date.localeCompare(b.date))) post(t);

  // Rules: a few manual ones plus one the system "learned" from two earlier fixes.
  const rules: Omit<Rule, 'id'>[] = [
    { contains: 'MER BNKCD DEPOSIT', accountId: 'acct_fiserv', storeId: 'st_hm15', origin: 'manual', hits: 22, overrides: 0, createdAt: '2026-09-02T15:00:00Z', active: true },
    { contains: 'GUSTO PAYROLL', accountId: 'acct_wages', storeId: 'st_corp', partyId: 'pt_gusto', origin: 'manual', hits: 48, overrides: 1, createdAt: '2026-09-02T15:00:00Z', active: true },
    { contains: 'HOME DEPOT', accountId: 'acct_repairs', storeId: 'st_hm11', origin: 'learned', hits: 2, overrides: 0, createdAt: '2026-10-14T15:00:00Z', active: true },
    { contains: 'VERIZON', accountId: 'acct_utilities', storeId: 'st_corp', origin: 'learned', hits: 1, overrides: 1, createdAt: '2026-10-19T15:00:00Z', active: true },
    { contains: 'SERVICE CHARGE', accountId: 'acct_bank_fees', storeId: 'st_corp', origin: 'manual', hits: 3, overrides: 0, createdAt: '2026-09-02T15:00:00Z', active: true },
  ];
  for (const r of rules) state.rules.push({ id: books.nextId('rule'), ...r });

  fuelDemo.finish(DEMO_END);
  for (const seed of MODULE_SEEDS) seed({ state, books, cfo, rand, setClock });
  buildBankFeed(state, books, cfo, rand);
  addUnpostedNoticeBankLines(state, books, FEED_END);
  // Older flagged variances were looked into at the weekly cash review; recent ones are still open.
  for (const b of state.cash.bags) if (b.businessDate < '2026-11-12' && bagFlagged(state, b)) b.reviewed = { by: cfo.id, at: addDays(b.businessDate, 4) + 'T15:00:00.000Z', note: 'Recounted with the store manager; cashier short, written up.' };
  for (const t of state.transactions) if (!t.batchId) { t.source = 'demo'; t.batchId = 'demo-2026Q4'; }
  for (const [date, at] of [['2026-09-30', '2026-10-06'], ['2026-10-31', '2026-11-05']]) {
    clockDate = at;
    const st = reconcileStatus(state, 'acct_trustmark', date);
    saveReconciliation(books, cfo, 'acct_trustmark', date, st.feedBalance!);
  }

  // August (opening balances) and September are closed and locked.
  clockDate = '2026-10-09';
  books.lockPeriod(cfo, '2026-08');
  books.lockPeriod(cfo, '2026-09');
  const count = state.transactions.length;
  // Keep the log readable: one entry for the whole demo load instead of thousands.
  state.audit = state.audit.filter((a) => a.objectType === 'period' || a.objectType === 'reconciliation');
  state.audit.unshift({ id: books.nextId('aud'), at: '2026-08-31T17:00:00.000Z', userId: cfo.id, action: 'data', objectType: 'data', objectId: 'demo', summary: `Loaded demo dataset: ${count} transactions, ${state.bank.lines.length} bank lines, ${state.cash.bags.length} cash bags, 1 Sep – 26 Nov 2026 (batch demo-2026Q4)` });
  return state;
}

/**
 * The demo Trustmark statement lines: one per bank-side ledger line through FEED_END. Checks clear
 * 3–9 days after they are written (later ones are still outstanding); one old check never clears.
 * Lines from 22 Nov on are left unmatched so auto-match has work to do, and a few lines exist only
 * at the bank (a fee, an unexplained deposit, a rebate nobody booked yet).
 */
function buildBankFeed(state: BooksState, books: Books, cfo: User, rand: () => number) {
  const acct = 'acct_trustmark';
  state.bank.openings[acct] = { date: '2026-08-31', balance: c(142_500) };
  const batches = new Map<string, string>();
  const batchFor = (date: string) => {
    const m = date.slice(0, 7);
    if (!batches.has(m)) {
      const id = books.nextId('imp');
      batches.set(m, id);
      state.bank.batches.push({ id, accountId: acct, fileName: `Trustmark ${m} (demo).csv`, format: 'demo', importedAt: (m === '2026-11' ? FEED_END : lastDay(m)) + 'T14:00:00.000Z', by: cfo.id, added: 0, skipped: 0, totalIn: 0, totalOut: 0, from: '', to: '' });
    }
    return batches.get(m)!;
  };
  const lines: BankLine[] = [];
  const add = (date: string, description: string, amount: number, extra: Partial<BankLine> = {}) => {
    const batchId = batchFor(date);
    lines.push({ id: books.nextId('bl'), accountId: acct, date, description, amount, hash: `demo:${state.seq}`, batchId, matchedLineIds: [], ...extra });
  };
  for (const t of state.transactions) {
    if (t.deleted || t.kind === 'opening' || t.description === 'SYSCO INV 77120419') continue; // the duplicate never hit the bank
    for (const l of t.lines) {
      if (l.accountId !== acct || l.system) continue;
      const amount = l.debit - l.credit;
      let date = t.date;
      if (t.checkNo && amount < 0) {
        if (t.checkNo === '4107') continue; // never cleared: stale
        date = addDays(t.date, 3 + Math.floor(rand() * 7));
      }
      if (date > FEED_END) continue;
      const desc = t.checkNo && amount < 0 ? `CHECK ${t.checkNo}` : t.description.toUpperCase();
      const tagSource: DepositSource | undefined = amount <= 0 ? undefined
        : t.tags.includes('deposit') ? 'store_cash' : t.tags.includes('settlement') ? 'card_settlement' : t.tags.includes('rent') ? 'tenant_rent'
        : t.tags.includes('lottery') ? 'lottery' : t.tags.includes('rebates') ? 'rebate' : t.tags.includes('intercompany') ? 'related_repayment' : undefined;
      const source = amount > 0 ? guessDepositSource(desc) ?? tagSource : undefined;
      add(date, desc, amount, { checkNo: t.checkNo && amount < 0 ? t.checkNo : undefined, source, matchedLineIds: t.date < '2026-11-22' ? [l.id] : [] });
    }
  }
  add('2026-11-19', 'ACH CREDIT VICKSBURG REBATE', c(940.15), { source: 'rebate' });
  add('2026-11-24', 'WIRE TRANSFER FEE', -c(25));
  add('2026-11-25', 'DEPOSIT 7734', c(1_875));
  lines.sort((a, b) => a.date.localeCompare(b.date));
  for (const b of lines) b.hash = `demo:${b.batchId}:${b.id}`;
  state.bank.lines = lines;
  for (const bt of state.bank.batches) {
    const mine = lines.filter((b) => b.batchId === bt.id);
    bt.added = mine.length;
    bt.totalIn = mine.filter((b) => b.amount > 0).reduce((a, b) => a + b.amount, 0);
    bt.totalOut = mine.filter((b) => b.amount < 0).reduce((a, b) => a - b.amount, 0);
    bt.from = mine[0]?.date ?? '';
    bt.to = mine.at(-1)?.date ?? '';
  }
}

function lastDay(period: string): string {
  return lastDayOfPeriod(period);
}
