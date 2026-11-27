import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo } from '../data/seed';
import {
  DEFAULT_COMPASS_SETTINGS, STAGE_ORDER, addMonthsDate, assumptions, capitalOf, compassChange, compassInbox, compassInputs, compassOf, compassRows, compassSensitivity,
  compassVerdict, evaluateGates, growthCompass, nopat, rankMoves, recordCompass, roicOf, saveCompassSettings, shockInputs, validateCompassSettings, waccOf,
  type CompassInputs, type StoreInput,
} from './compass';
import { balanceSheet, basisEntries, cashFlow, statement } from './statements';
import { covenantMetrics, debtOf, headlineMetrics, reserveTarget, debtDashboard } from './debt';
import { ownerRateBps } from './tax';
import type { BalanceSheet } from './statements';
import type { BooksState, CompassSettings } from './types';
import { importStationBooks, type SBSnapshot } from '../data/stationbooks';

const T = '2026-11-27';
const demo = buildDemo();
const fresh = () => { const s = structuredClone(demo); return { s, b: new Books(s, () => '2026-11-27T17:00:00.000Z') }; };
const user = (s: BooksState, id: string) => s.users.find((u) => u.id === id)!;
const S: CompassSettings = { ...DEFAULT_COMPASS_SETTINGS };
const GT = { dscr: 125, leverage: 350 };

// ── Hand-built inputs ────────────────────────────────────────────────────
function store(x: Partial<StoreInput> & { code: string }): StoreInput {
  return {
    storeId: `st_${x.code.toLowerCase()}`, name: x.code, monthsOpen: null, sales: 20_000_000, netIncome: 0, interest: 0, depreciation: 0, ebitda: 0, labor: 1_600_000,
    insideSales: 5_000_000, insideGp: 1_500_000, hasSales: true, gallons: 0, fuelMargin: 0, fuelCpg: 30, fuelSource: 'fuel', laborTargetPct: 10, breakEvenSafety: 0.1,
    capital: { fixed: 0, inventory: 0, workingCapital: 0, total: 0 }, monthly: [], budget: null, traffic: null, ...x,
  };
}
const cap = (total: number) => ({ fixed: total, inventory: 0, workingCapital: 0, total });
/** One month (× 12), everything passing up to Replicate; no history, so the stage is Replicate. */
function base(): CompassInputs {
  return {
    asOf: '2026-11-27', ready: true, basis: 'booked', period: '2026-10', from: '2026-10', months: 1, factor: 12, annualized: true, date: '2026-10-31',
    company: { sales: 100_000_000, netIncome: 5_000_000, interest: 500_000, depreciation: 1_000_000, ebitda: 6_500_000, gallons: 100_000, fuelMargin: 3_000_000, capital: cap(300_000_000), otherBasis: 'accrual', otherNetIncome: 4_000_000, corporateNet: -1_000_000 },
    stores: [
      store({ code: 'A', netIncome: 3_500_000, ebitda: 4_000_000, depreciation: 500_000, gallons: 70_000, fuelMargin: 2_100_000, capital: cap(100_000_000), monthly: [{ period: '2026-09', sales: 19_000_000, net: 3_000_000, gallons: 66_000 }, { period: '2026-10', sales: 20_000_000, net: 3_500_000, gallons: 70_000 }] }),
      store({ code: 'B', netIncome: 1_100_000, ebitda: 1_500_000, depreciation: 400_000, gallons: 30_000, fuelMargin: 900_000, capital: cap(60_000_000), monthly: [{ period: '2026-09', sales: 20_000_000, net: 1_000_000, gallons: 30_000 }, { period: '2026-10', sales: 20_000_000, net: 1_100_000, gallons: 30_000 }] }),
      store({ code: 'D', monthsOpen: 2, openedOn: '2026-09-15', netIncome: -500_000, ebitda: -500_000, capital: cap(10_000_000) }),
    ],
    firstPeriod: '2026-10', hasPriorYear: false,
    bank: { known: true, balance: 50_000_000, floor: 3_000_000, lastDate: '2026-11-26', accounts: [{ id: 'acct_bank', name: 'Operating', balance: 50_000_000, floor: 3_000_000 }] },
    fees: { count: 0, total: 0, accounts: [] },
    monthlyCompany: [{ period: '2026-10', ebitda: 6_500_000, net: 5_000_000, sales: 100_000_000 }],
    tax: { rateBps: 2500, source: 'test' },
    capitalStructure: { debt: 100_000_000, equity: 200_000_000, wacdBps: 800, loans: [] },
    cash: { operating: 5_000_000, capex: -1_000_000, fcf: 4_000_000, reserveTarget: 20_000_000, cash: 60_000_000, deployable: 40_000_000, equityNeed: 30_000_000, equitySource: 'test deal', known: true, placeholder: 0, reserveGaps: [], equityKnown: true },
    covenants: [{ key: 'c1', kind: 'dscr', label: 'Note: DSCR', loan: 'Note', name: 'DSCR', status: 'ok', actual: '3.90x', limit: '≥ 1.25x', forecastDate: null, within: false }],
    capacity: { dscr: 3.9, ebitdaAnnual: 78_000_000, debtServiceAnnual: 20_000_000, debt: 100_000_000, addedDebtService: 15_000_000, addedEbitda: 20_000_000, newLoan: 150_000_000, dealName: 'Deal', dealId: 'pf1' },
    ramp: { code: 'D', rows: [{ period: '2026-10', gallonsPct: 1.05, insidePct: 1.02, days: 31, daysInMonth: 31 }] },
    paydown: { label: 'line of credit', balance: 10_000_000, rateBps: 800, afterTaxBps: 600 },
    project: { label: 'Car wash', amount: 20_000_000, expectedReturn: 0.2, status: 'approved', to: '/growth/capital' },
    proForma: { id: 'pf1', name: 'Store E build', npv: 50_000_000, irr: 0.2, equity: 30_000_000, stabilizedCash: 30_000_000, stabilizedYear: 3 },
    targets: { fuelCpg: 25, insideGmPct: 28 },
    nextStoreNumber: 5,
    history: [],
    evidence: { loans: 2, cashFlowDetail: 5, hasDeal: true },
    ties: { ebitda: true, storesAddUp: true, capital: true, debt: true, balanceSheet: true, cashFlow: true, cashFlowNetIncome: true },
    tieDetail: { ebitdaStatement: 0, ebitdaMetric: 0, capitalEntities: 0, capitalConsolidated: 0, debtBs: 0, debtMetric: 0, cfNetIncome: 0, bookedNetIncome: 0 },
  };
}
const rec = (period: string, ready: boolean) => ({ period, stage: ready ? 'replicate' as const : 'optimize' as const, gates: {}, replicateReady: ready, roicPct: null, waccPct: null, at: '', by: 'u' });
const weakStore = () => store({ code: 'C', netIncome: 100_000, ebitda: 500_000, depreciation: 400_000, gallons: 50_000, fuelMargin: 1_050_000, fuelCpg: 21, sales: 20_000_000, labor: 2_400_000, capital: cap(80_000_000) });
const verdict = (i: CompassInputs, s: Partial<CompassSettings> = {}) => compassVerdict(i, { ...S, ...s }, GT);

// ── Math ─────────────────────────────────────────────────────────────────
describe('cost of capital and returns', () => {
  it('WACC blends the after-tax cost of debt with the cost of equity by balance-sheet weights', () => {
    const w = waccOf({ debt: 40_000_000, equity: 60_000_000, wacdBps: 800, taxRateBps: 2500, costOfEquityBps: 1500 });
    expect(w.afterTaxDebt).toBeCloseTo(0.06, 12);
    expect(w.debtWeight).toBeCloseTo(0.4, 12);
    expect(w.equityWeight).toBeCloseTo(0.6, 12);
    expect(w.wacc).toBeCloseTo(0.114, 12); // 0.6 × 15% + 0.4 × 6%
    expect(waccOf({ debt: 40_000_000, equity: -5, wacdBps: 800, taxRateBps: 2500, costOfEquityBps: 1500 }).wacc).toBe(0.15); // no positive equity: Ke alone
    const none = waccOf({ debt: 0, equity: 60_000_000, wacdBps: null, taxRateBps: 2500, costOfEquityBps: 1200 });
    expect(none.wacc).toBe(0.12);
    expect(none.debtWeight).toBe(0);
  });
  it('NOPAT = (EBITDA − depreciation) less tax when positive, annualized; ROIC = NOPAT ÷ capital', () => {
    expect(nopat(1_000_000, 200_000, 4000, 6)).toBe(2_880_000); // 800,000 × 0.6 × 6
    expect(nopat(100_000, 300_000, 4000, 2)).toBe(-400_000); // a loss carries no tax
    expect(roicOf(2_880_000, 24_000_000)).toBeCloseTo(0.12, 12);
    expect(roicOf(1, 0)).toBeNull();
  });
  it('invested capital = net fixed assets + inventory + operating working capital (no bank cash, no intercompany)', () => {
    const g = (key: string, total: number) => ({ key, label: key, lines: [], total });
    const bs = { sections: [
      { key: 'assets', label: '', total: 0, groups: [g('bank', 999), g('cash', 10), g('clearing', 20), g('receivable', 5), g('inventory', 50), g('prepaid', 5), g('intercompany', 777), g('fixed_asset', 100)] },
      { key: 'liabilities', label: '', total: 0, groups: [g('payable', 15), g('accrued', 10), g('loan', 500), g('intercompany', 88)] },
    ] } as unknown as BalanceSheet;
    expect(capitalOf(bs)).toEqual({ fixed: 100, inventory: 50, workingCapital: 15, total: 165 });
  });
  it('the base fixture by hand: ROIC 16.5%, WACC 12%, spread +4.5 pts', () => {
    const r = evaluateGates(base(), S, GT);
    expect(r.company.nopatAnnual).toBe(49_500_000); // (6.5M − 1M) × 0.75 × 12
    expect(r.company.roic).toBeCloseTo(0.165, 12);
    expect(r.wacc.wacc).toBeCloseTo(0.12, 12); // ⅔ × 15% + ⅓ × 6%
    expect(r.company.spread).toBeCloseTo(0.045, 12);
    expect(r.cash.conversion).toBeCloseTo(4 / 6.5, 12);
    expect(r.capacity.dscrAfter).toBeCloseTo(98 / 35, 12);
    expect(r.capacity.leverageAfter).toBeCloseTo(250 / 98, 12);
    expect(addMonthsDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsDate('2026-11-27', 3)).toBe('2027-02-27');
  });
});

// ── Stage gates, one fixture per stage ───────────────────────────────────
describe('stage gates', () => {
  it('Scale: replicate gates held three months and the store after next funds within six', () => {
    const i = base();
    i.history = [rec('2026-09', true), rec('2026-08', true)];
    const v = verdict(i);
    expect(v.stage).toBe('scale');
    expect(v.heldMonths).toBe(3);
    expect(v.gates.every((g) => g.status === 'pass')).toBe(true);
    expect(v.gates.find((g) => g.key === 'fund')!.value).toBe('5 months'); // (30M − (40M − 30M)) ÷ 4M a month
    // A gap in the history breaks the run.
    i.history = [rec('2026-09', true), rec('2026-08', false)];
    expect(verdict(i).stage).toBe('replicate');
  });
  it('Replicate: every gate to add a store passes; no months of history yet', () => {
    const v = verdict(base());
    expect(v.stage).toBe('replicate');
    expect(v.replicateReady).toBe(true);
    expect(v.gates.find((g) => g.key === 'held')!.status).toBe('fail');
    expect(v.sentence).toMatch(/^Replicate: the replicate gates have held 1 of 3 months/);
  });
  it('Optimize: ROIC beats WACC company-wide, but too few stores do, or the equity or ramp is missing', () => {
    const i = base();
    i.stores.push(weakStore());
    let v = verdict(i);
    expect(v.stage).toBe('optimize');
    expect(v.gates.find((g) => g.key === 'stores')!.value).toBe('2 of 3 stores'); // 67% < 75%
    expect(verdict(i, { valueStoreSharePct: 60 }).stage).toBe('replicate');
    const j = base(); j.cash.equityNeed = 50_000_000;
    v = verdict(j);
    expect(v.stage).toBe('optimize');
    expect(v.gates.find((g) => g.key === 'equity')!.status).toBe('fail');
    const k = base(); k.ramp!.rows[0].insidePct = 0.9;
    expect(verdict(k).stage).toBe('optimize');
    const n = base(); n.ramp = null; // no ramp targets: not enough data, which doesn't pass
    expect(verdict(n).gates.find((g) => g.key === 'ramp')!.status).toBe('na');
    expect(verdict(n).stage).toBe('optimize');
  });
  it('Stabilize: profitable, but ROIC below WACC, weak cash conversion or a thin reserve', () => {
    const i = base(); i.company.capital = cap(600_000_000); // ROIC 8.25%
    expect(verdict(i).stage).toBe('stabilize');
    expect(verdict(i).sentence).toContain('below the 12.0% cost of capital');
    const j = base(); j.cash.fcf = 2_000_000; // 30.8% conversion
    expect(verdict(j).stage).toBe('stabilize');
    const k = base(); k.cash.deployable = 1_000_000; // 5% of the reserve
    expect(verdict(k).stage).toBe('stabilize');
    expect(verdict(k, { reserveCushionPct: 5 }).gates.find((g) => g.key === 'cushion')!.status).toBe('pass');
    // A higher cost of equity alone moves the verdict down.
    expect(verdict(base(), { costOfEquityBps: 2500 }).stage).toBe('stabilize');
  });
  it('Fix: losing money, a covenant broken or forecast to break, or cash under the reserve', () => {
    const i = base(); i.company.netIncome = -1_000_000;
    expect(verdict(i).stage).toBe('fix');
    expect(verdict(i).sentence).toBe('Fix: the company is losing $120,000 a year.');
    const j = base(); j.covenants.push({ key: 'c2', kind: 'min_liquidity', label: 'Line: Minimum liquidity', loan: 'Line', name: 'Minimum liquidity', status: 'near', actual: '$40,000', limit: '≥ $30,000', forecastDate: '2026-12-15', within: true, lowAmount: 2_000_000, limitCents: 3_000_000 });
    expect(verdict(j).stage).toBe('fix');
    expect(verdict(j).sentence).toBe('Fix: the minimum liquidity covenant on the line is forecast to break on Dec 15, 2026.');
    const k = base(); k.cash.deployable = -100;
    expect(verdict(k).stage).toBe('fix');
    const none = base(); none.ready = false; none.company.netIncome = 0;
    expect(verdict(none).gates.find((g) => g.key === 'profit')!.status).toBe('na');
    expect(verdict(none).stage).toBe('fix');
    expect(STAGE_ORDER).toEqual(['fix', 'stabilize', 'optimize', 'replicate', 'scale']);
  });
});

// ── Store roles ──────────────────────────────────────────────────────────
describe('store roles', () => {
  it('Grow, Harvest, Fix (with its main lever and its value) and Watch', () => {
    const i = base(); i.stores.push(weakStore());
    const v = verdict(i);
    const role = (c: string) => v.stores.find((s) => s.input.code === c)!;
    expect(role('A').role).toBe('grow'); // spread +19.5 pts, gallons +6.1%
    expect(role('A').roic).toBeCloseTo(0.315, 12);
    expect(role('B').role).toBe('harvest'); // spread +4.5 pts, below the 10-point Grow line
    expect(role('D').role).toBe('watch');
    const c = role('C');
    expect(c.role).toBe('fix');
    expect(c.roic).toBeCloseTo(0.01125, 12);
    expect(c.mainLever!.kind).toBe('labor'); // 2 pts × $200,000 × 12 beats 4¢ × 50,000 × 12
    expect(c.mainLever!.gap).toBe(4_800_000);
    expect(c.mainLever!.label).toBe('labor 2.0 pts over the 10.0% target');
    expect(c.levers.find((l) => l.kind === 'fuel')!.gap).toBe(2_400_000);
    expect(c.levers.find((l) => l.kind === 'fuel')!.label).toBe('fuel margin 4.0¢ below the 25.0¢ target');
    // Volume flat: A drops to Harvest.
    const j = base(); j.stores[0].monthly[0].gallons = 70_000;
    expect(verdict(j).stores[0].role).toBe('harvest');
    expect(verdict(j, { growVolumePct: 0 }).stores[0].role).toBe('grow');
  });
});

// ── Moves ────────────────────────────────────────────────────────────────
describe('next three moves', () => {
  it('rank what clears a failing gate first, then by annual value', () => {
    const i = base(); i.stores.push(weakStore());
    const v = verdict(i); // optimize, the stores gate fails
    expect(v.moves.map((m) => m.key)).toEqual(['lever:st_c', 'project', 'paydown']);
    expect(v.moves[0].clears).toBe('stores');
    expect(v.moves[0].value).toBe(4_800_000);
    expect(v.moves[1].value).toBe(4_000_000); // 20% × $200,000
    expect(v.moves[2].value).toBe(600_000); // $100,000 × 6% after tax
    expect(v.moves.some((m) => m.key === 'store')).toBe(false); // the stage doesn't allow a new store yet
  });
  it('open the next store only once the stage allows it', () => {
    const v = verdict(base());
    expect(v.moves[0].key).toBe('store');
    expect(v.moves[0].title).toBe('Open store #5: Store E build');
  });
  it('a covenant forecast to break comes first even when worth less', () => {
    const i = base(); i.covenants.push({ key: 'c2', kind: 'min_liquidity', label: 'Line: Minimum liquidity', loan: 'Line', name: 'Minimum liquidity', status: 'near', actual: '$40,000', limit: '≥ $30,000', forecastDate: '2026-12-15', within: true, lowAmount: 2_000_000, limitCents: 3_000_000 });
    const v = verdict(i);
    expect(v.moves[0].key).toBe('cov:c2');
    expect(v.moves[0].value).toBe(1_000_000);
    expect(v.moves[0].valueKind).toBe('risk');
    const r = evaluateGates(i, S, GT);
    expect(rankMoves(i, S, r).map((m) => m.key)).toEqual(['cov:c2', 'project', 'paydown']); // no new store while in Fix
  });
  it('a cash shortfall adds "rebuild the reserve"; no paydown without cash above the reserve', () => {
    const i = base(); i.cash.deployable = -5_000_000;
    const v = verdict(i);
    expect(v.moves[0].key).toBe('reserve');
    expect(v.moves[0].value).toBe(5_000_000);
    expect(v.moves.some((m) => m.key === 'paydown')).toBe(false);
  });
});

// ── Triggers ─────────────────────────────────────────────────────────────
describe('triggers', () => {
  it('equity: months at the current pace and the date', () => {
    const i = base(); i.cash.equityNeed = 50_000_000;
    const t = verdict(i).triggers;
    expect(t.map((x) => x.gate)).toEqual(['equity']);
    expect(t[0].eta).toBe('about 3 months at the current pace ($40,000 free cash flow a month)'); // (50M − 40M) ÷ 4M, rounded up
    expect(t[0].etaDate).toBe('2027-02-27');
    expect(t[0].now).toBe('$400,000 deployable');
  });
  it('ROIC: from the monthly EBITDA trend when three months exist, else says why not', () => {
    const i = base(); i.company.capital = cap(600_000_000);
    let t = verdict(i).triggers.find((x) => x.gate === 'roic')!;
    expect(t.etaDate).toBeNull();
    expect(t.eta).toBe('no estimate: a trend needs 3 complete months and the books have 1');
    i.monthlyCompany = [4_000_000, 5_000_000, 6_000_000].map((ebitda, k) => ({ period: `2026-0${8 + k}`, ebitda, net: 0, sales: 0 }));
    // Needs NOPAT ≥ 12% × 600M = 72M → EBITDA ≥ 108M a year = 9M a month; the trend (+1M a month from 6M) gets there in 3.
    t = verdict(i).triggers.find((x) => x.gate === 'roic')!;
    expect(t.etaDate).toBe('2027-02-27');
    expect(t.eta).toContain('about 3 months on the EBITDA trend');
  });
  it('ramp needs two months; once ready, the triggers are for Scale', () => {
    const i = base(); i.ramp!.rows[0].insidePct = 0.9;
    expect(verdict(i).triggers.find((x) => x.gate === 'ramp')!.eta).toBe('no estimate: 1 ramp month on file (a trend needs two)');
    i.ramp!.rows.unshift({ period: '2026-09', gallonsPct: 0.8, insidePct: 0.8, days: 30, daysInMonth: 30 });
    const t = verdict(i).triggers.find((x) => x.gate === 'ramp')!;
    expect(t.eta).toBe("about 1 month at the last month's improvement"); // 80% → 90%, needs 100%
    expect(t.etaDate).toBe('2026-12-27');
    expect(verdict(base()).triggers.map((x) => x.gate)).toEqual(['held']);
  });
});

// ── Sensitivity ──────────────────────────────────────────────────────────
describe('sensitivity', () => {
  it('a fuel margin or gallons shock flows to profit and cash; the first gate to flip is found', () => {
    const i = base(); i.company.netIncome = 100_000;
    const sh = shockInputs(i, { cpg: -2 });
    expect(sh.company.netIncome).toBe(-100_000); // 100,000 gallons × −2¢
    expect(sh.company.ebitda).toBe(6_300_000);
    expect(sh.cash.fcf).toBe(3_800_000);
    expect(sh.capacity.ebitdaAnnual).toBe(78_000_000 - 2_400_000);
    expect(shockInputs(i, { gallonsPct: -10 }).company.netIncome).toBe(-200_000); // −10% of $30,000 fuel margin
    const r = compassSensitivity(i, S, GT);
    const down = r.scenarios.find((x) => x.key === 'cpg-')!;
    expect(down.stage).toBe('fix');
    expect(down.flips.map((f) => f.key)).toContain('profit');
    expect(r.scenarios.find((x) => x.key === 'cpg+')!.flips).toEqual([]);
    expect(r.flipPoints.find((f) => f.key === 'profit')!.cpg).toBe(-1); // 100,000 gal × −1¢ wipes out $1,000
    expect(r.flipPoints.find((f) => f.key === 'profit')!.gallonsPct).toBe(-4); // −4% of $30,000 > $1,000
    expect(r.firstFlip!.key).toBe('profit');
    expect(r.flipPoints.find((f) => f.key === 'conversion')!.cpg).toBe(-2.6); // (4M + d) ÷ (6.5M + d) < 60% once d < −250,000
  });
});

// ── Demo ─────────────────────────────────────────────────────────────────
describe('the demo verdict', () => {
  const entries = basisEntries(demo);
  const v = growthCompass(demo, T, { entries });
  const i = v.inputs;
  it('reads Fix: the line of credit’s minimum liquidity is forecast to break', () => {
    expect(v.stage).toBe('fix');
    expect(v.sentence).toBe('Fix: the minimum liquidity covenant on the corporate line of credit is forecast to break on Dec 15, 2026.');
    const st = (k: string) => v.gates.find((g) => g.key === k)!.status;
    expect(['profit', 'reserve', 'roic', 'conversion', 'cushion', 'stores', 'dscrAfter', 'leverageAfter'].map(st)).toEqual(Array(8).fill('pass'));
    expect(['covenants', 'equity', 'ramp', 'held', 'fund'].map(st)).toEqual(Array(5).fill('fail'));
    expect(v.moves).toHaveLength(3);
    expect(v.moves[0].key).toMatch(/^cov:/);
    expect(v.stores.find((s) => s.input.code === 'HM17')!.role).toBe('watch');
    expect(v.stores.filter((s) => s.role !== 'watch').map((s) => s.input.code)).toEqual(['HM11', 'HM13', 'HM15']);
    expect(i.annualized).toBe(true);
    expect(i.months).toBe(2);
    expect(i.nextStoreNumber).toBe(6);
  });
  it('ROIC and WACC tie to the statements, the balance sheet and the debt dashboard', () => {
    const ds = debtOf(demo).settings;
    const m = headlineMetrics(covenantMetrics(demo, T, { entries, settings: ds }), ds)!;
    expect(i.company.ebitda).toBe(m.ebitda);
    const st = statement(demo, { basis: 'booked', from: m.from, to: m.period, storeIds: demo.stores.map((s) => s.id), entries });
    expect(i.company.netIncome).toBe(st.netIncome.total);
    const rate = ownerRateBps(demo);
    expect(i.tax.rateBps).toBe(rate);
    expect(v.company.nopatAnnual).toBe(Math.round((m.ebitda - m.depreciation) * (1 - rate / 10_000) * m.factor));
    const bs = balanceSheet(demo, { asOf: m.date });
    expect(i.company.capital).toEqual(capitalOf(bs));
    expect(v.company.roic).toBeCloseTo(v.company.nopatAnnual / i.company.capital.total, 12);
    expect(i.capitalStructure.debt).toBe(m.debt);
    expect(i.capitalStructure.equity).toBe(bs.totalEquity);
    expect(i.capitalStructure.wacdBps).toBe(debtDashboard(demo, T).wacdBps);
    const e = bs.totalEquity, d = m.debt, kd = (i.capitalStructure.wacdBps! / 10_000) * (1 - rate / 10_000);
    expect(v.wacc.wacc).toBeCloseTo((e / (d + e)) * 0.15 + (d / (d + e)) * kd, 12);
    expect(v.company.spread).toBeCloseTo(v.company.roic! - v.wacc.wacc, 12);
    // Each store: ROIC from its own entity's balance sheet.
    const hm11 = v.stores.find((s) => s.input.code === 'HM11')!;
    expect(hm11.input.capital).toEqual(capitalOf(balanceSheet(demo, { asOf: m.date, entityId: 'ent_hm11' })));
    expect(hm11.nopatAnnual).toBe(nopat(hm11.input.ebitda, hm11.input.depreciation, rate, m.factor));
    expect(Object.values(i.ties).every(Boolean)).toBe(true);
  });
  it('free cash flow ties to the cash flow statement; the reserve to the reserve policy', () => {
    const cf = cashFlow(demo, { from: `${i.from}-01`, to: `${i.period}-31` });
    expect(i.cash.operating).toBe(cf.sections.find((s) => s.key === 'operating')!.total);
    expect(i.cash.fcf).toBe(i.cash.operating + i.cash.capex);
    const r = reserveTarget(demo, T, { entries });
    expect(i.cash.deployable).toBe(r.deployable);
    expect(v.cash.monthsToFund).toBe(Math.ceil((i.cash.equityNeed - r.deployable) / v.cash.fcfMonthly!));
    const t = v.triggers.find((x) => x.gate === 'equity')!;
    expect(t.etaDate).toBe(addMonthsDate(T, v.cash.monthsToFund!));
  });
  it('sensitivity: a 2¢ cut in fuel margin takes company ROIC under the cost of capital', () => {
    const r = compassSensitivity(i, v.settings, { dscr: 125, leverage: 350 });
    expect(r.scenarios.find((x) => x.key === 'cpg-')!.flips.map((f) => f.key)).toEqual(['roic']);
    expect(r.firstFlip!.key).toBe('roic');
    expect(r.firstFlip!.cpg!).toBeLessThan(0);
  });
  it('has no NaN or Infinity anywhere; HM17 (opened after the window) is on Watch', () => {
    expect(badNumbers({ v, sens: compassSensitivity(i, v.settings, GT), a: assumptions(v), rows: compassRows(v) })).toEqual([]);
    expect(v.stores.find((s) => s.input.code === 'HM17')!.roleWhy).toBe('Opened Nov 1, 2026, under 12 months: judged on its ramp, not its returns (no sales in the window yet).');
    expect(v.gates.find((g) => g.key === 'floor')!.status).toBe('pass');
    expect(v.missing).toEqual([]);
    expect(v.provisional).toBe(false);
  });
  it('explains every formula, exports every section, and records the month', () => {
    const a = assumptions(v);
    expect(a.find((x) => x.key === 'window')!.formula).toContain('no prior year');
    expect(a.filter((x) => x.setting).length).toBeGreaterThan(10);
    const rows = compassRows(v);
    expect(rows[0]).toEqual(['Verdict', 'Stage', 'Fix', v.sentence, '']);
    expect(rows.filter((r) => r[0] === 'Gate')).toHaveLength(v.gates.length);
  });
});

// ── Cash protection, missing evidence, no sales ──────────────────────────
describe('cash protection and missing evidence', () => {
  it('the bank under its floor is Fix, and protecting cash is the first move with a date to get back', () => {
    const i = base(); i.bank = { ...i.bank, balance: 2_000_000, accounts: [{ ...i.bank.accounts[0], balance: 2_000_000 }] };
    const v = verdict(i);
    expect(v.stage).toBe('fix');
    expect(v.gates.find((g) => g.key === 'floor')!.status).toBe('fail');
    expect(v.sentence).toBe('Fix: the bank is $10,000 below its $30,000 floor.');
    expect(v.moves[0]).toMatchObject({ key: 'cash', clears: 'floor', value: 1_000_000, valueKind: 'risk', to: '/cash/forecast' });
    const t = v.triggers.find((x) => x.gate === 'floor')!;
    expect(t.eta).toBe('about 1 month if free cash flow ($40,000 a month) stays in the bank'); // $10,000 gap ÷ $40,000 a month
    expect(t.etaDate).toBe('2026-12-27');
  });
  it('bank and overdraft fees are counted, annualized and become a move', () => {
    const i = base(); i.fees = { count: 3, total: 10_500, accounts: ['Overdraft Fees'] };
    const v = verdict(i);
    const m = rankMoves(i, S, evaluateGates(i, S, GT)).find((x) => x.key === 'cash')!;
    expect(m.title).toBe('Stop the bank and overdraft fees');
    expect(m.value).toBe(126_000); // $105 in one month × 12
    expect(m.why).toContain('3 bank / overdraft fee charges ($105)');
    expect(v.gates.find((g) => g.key === 'floor')!.detail).toContain('3 bank / overdraft fee charges ($105)');
  });
  it("a gate without its input can't pass: the stage stops on that rung, provisionally, and says what is missing", () => {
    const i = base(); i.covenants = []; i.evidence = { ...i.evidence, loans: 0 };
    const v = verdict(i);
    expect(v.stage).toBe('fix');
    expect(v.provisional).toBe(true);
    const g = v.gates.find((x) => x.key === 'covenants')!;
    expect(g.status).toBe('na');
    expect(g.value).toBe("Can't tell yet: needs the loans and their covenants (Assets › Loans, Debt › Covenants)");
    expect(v.sentence).toBe("Fix, provisionally: nothing on the books fails here, but the covenants can't be judged yet, so the evidence goes no further. 3 gates can't be judged on these books yet; what each needs is listed below.");
    expect(v.missing.map((x) => x.key)).toEqual(['covenants', 'dscrAfter', 'leverageAfter']); // no loans: no debt service today either
    expect(v.moves.some((x) => x.key === 'evidence:covenants')).toBe(true);
    // No fixed assets: ROIC can't be judged, so the verdict claims nothing beyond Stabilize.
    const j = base(); j.company.capital = { fixed: 0, inventory: 0, workingCapital: 5_000_000, total: 5_000_000 };
    const w = verdict(j);
    expect(w.gates.find((x) => x.key === 'roic')!.status).toBe('na');
    expect(w.company.roic).toBeNull();
    expect(w.stage).toBe('stabilize');
    expect(w.provisional).toBe(true);
    // Cash that is really single-entry profit: conversion and the scale funding can't be judged.
    const k = base(); k.cash.known = false; k.cash.placeholder = 4_000_000;
    const x = verdict(k);
    expect(x.gates.find((g) => g.key === 'conversion')!.status).toBe('na');
    expect(x.cash.fcfAnnual).toBeNull();
    expect(x.stage).toBe('stabilize');
    // A reserve the books can only partly size can't be judged either.
    const r = base(); r.cash.reserveGaps = ['payroll runs to size one payroll (People › Payroll)'];
    expect(['reserve', 'cushion', 'equity'].map((key) => verdict(r).gates.find((g) => g.key === key)!.status)).toEqual(['na', 'na', 'na']);
  });
  it('a store with no sales is on Watch, never judged on zeros', () => {
    const i = base();
    i.stores.push(store({ code: 'Z', sales: 0, hasSales: false, labor: 0, insideSales: 0, insideGp: 0, capital: cap(50_000_000) }));
    const z = verdict(i).stores.find((s) => s.input.code === 'Z')!;
    expect(z.role).toBe('watch');
    expect(z.roleWhy).toBe('No sales recorded in the window: nothing to judge yet.');
    expect(z.roic).toBeNull();
    expect(z.profitPerMonth).toBeNull();
    expect(verdict(i).company.profitPerStoreMonth).toBe(Math.round((3_500_000 + 1_100_000 - 500_000) / 3));
  });
});

// ── Imported StationBooks books ──────────────────────────────────────────
/** The synthetic export from stationbooks.test.ts (no real data), plus an overdraft fee and a bank balance to vary. */
function sbSnap(bankCents = 4_500_000): SBSnapshot {
  return {
    format: 'stationbooks-export',
    exportedAt: '2026-11-27T12:00:00.000Z',
    meta: {
      stores: { items: [{ id: 'sA', code: 'HM11', name: 'Store A' }, { id: 'sC', code: 'CORP', name: 'Corp', isCorporate: true }, { id: 'sX', code: 'PERS', name: 'Personal', isCorporate: true }] },
      categories: { items: [
        { id: 'gFuel', name: 'Fuel Sales', classification: 'REVENUE', parentId: null },
        { id: 'cReg', name: 'Regular', classification: 'REVENUE', parentId: 'gFuel', isFuel: true },
        { id: 'cCom', name: 'Diesel - COMDATA', classification: 'REVENUE', parentId: 'gFuel', isFuel: true },
        { id: 'gIn', name: 'Inside Sales', classification: 'REVENUE', parentId: null },
        { id: 'cBeer', name: 'Beer', classification: 'REVENUE', parentId: 'gIn' },
        { id: 'gFc', name: 'Fuel COGS', classification: 'COGS', parentId: null },
        { id: 'cFc', name: 'Fuel Purchases', classification: 'COGS', parentId: 'gFc' },
        { id: 'gPay', name: 'Payroll', classification: 'OPERATING_EXPENSE', parentId: null },
        { id: 'cWag', name: 'Wages', classification: 'OPERATING_EXPENSE', parentId: 'gPay' },
        { id: 'gFin', name: 'Financial Expenses', classification: 'OPERATING_EXPENSE', parentId: null },
        { id: 'cCard', name: 'Credit Card / Merchant Fees', classification: 'OPERATING_EXPENSE', parentId: 'gFin' },
        { id: 'cOd', name: 'Overdraft Fees', classification: 'OPERATING_EXPENSE', parentId: 'gFin' },
      ] },
      vendors: { items: [{ id: 'v1', name: 'Fuel Supplier' }] },
      settings: { company: { name: 'Demo Co', fiscalYearStartMonth: 1 } },
    },
    ledger: [
      { storeId: 'sA', month: '2026-10', txns: [
        { id: 't1', type: 'SALE', amountCents: 1_000_000, categoryId: 'cReg', storeId: 'sA', date: '2026-10-31', gallons: 3000 },
        { id: 't2', type: 'SALE', amountCents: 200_000, categoryId: 'cCom', storeId: 'sA', date: '2026-10-31', gallons: 500 },
        { id: 't3', type: 'SALE', amountCents: 300_000, categoryId: 'cBeer', storeId: 'sA', date: '2026-10-31' },
        { id: 't4', type: 'EXPENSE', amountCents: 900_000, categoryId: 'cFc', storeId: 'sA', date: '2026-10-05', vendorId: 'v1', invoiceNumber: 'INV-1' },
        { id: 't5', type: 'EXPENSE', amountCents: 150_000, categoryId: 'cWag', storeId: 'sA', date: '2026-10-09', checkNumber: '1001' },
        { id: 't6', type: 'EXPENSE', amountCents: 25_000, categoryId: 'cCard', storeId: 'sA', date: '2026-10-12' },
        { id: 't7', type: 'EXPENSE', amountCents: -5_000, categoryId: 'cCard', storeId: 'sA', date: '2026-10-20', description: 'Fee refund' },
        { id: 't8', type: 'EXPENSE', amountCents: 3_500, categoryId: 'cOd', storeId: 'sA', date: '2026-10-14' },
        { id: 't9', type: 'EXPENSE', amountCents: 3_500, categoryId: 'cOd', storeId: 'sA', date: '2026-10-22' },
      ] },
      { storeId: 'sX', month: '2026-10', txns: [{ id: 'p1', type: 'EXPENSE', amountCents: 10_000, categoryId: 'cWag', storeId: 'sX', date: '2026-10-02' }] },
    ],
    accounts: { items: [{ id: 'b1', kind: 'BANK', name: 'Operating' }] },
    balances: { items: [{ accountId: 'b1', balanceCents: bankCents, date: '2026-10-31' }] },
    parties: { items: [{ id: 'r1', name: 'Related Co', kind: 'RELATED_COMPANY' }] },
  };
}
/** Every number anywhere in a value is finite. */
function badNumbers(x: unknown, path = '$', out: string[] = []): string[] {
  if (typeof x === 'number') { if (!Number.isFinite(x)) out.push(`${path} = ${x}`); }
  else if (typeof x === 'string') { if (/NaN|Infinity/.test(x)) out.push(`${path} = "${x}"`); }
  else if (Array.isArray(x)) x.forEach((v, k) => badNumbers(v, `${path}[${k}]`, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) badNumbers(v, `${path}.${k}`, out);
  return out;
}

describe('the compass on imported StationBooks books', () => {
  const { state } = importStationBooks(sbSnap());
  const v = growthCompass(state, T);
  const gate = (k: string) => v.gates.find((g) => g.key === k)!;
  it('gives a verdict on the evidence there is and names what is missing', () => {
    expect(v.stage).toBe('fix');
    expect(v.provisional).toBe(true);
    expect(gate('profit').status).toBe('pass'); // the booked P&L is there
    expect(gate('floor').status).toBe('pass'); // $45,000 snapshot ≥ $30,000
    expect(gate('floor').value).toBe('$45,000 in the bank (last bank entry Oct 31, 2026)');
    expect(v.sentence).toMatch(/^Fix, provisionally: nothing on the books fails here, but the covenants and the reserve can't be judged yet/);
    const missing = v.missing.map((m) => m.key);
    expect(missing).toEqual(expect.arrayContaining(['covenants', 'reserve', 'roic', 'conversion', 'cushion', 'stores', 'dscrAfter', 'leverageAfter', 'equity', 'ramp', 'fund']));
    for (const g of v.gates.filter((x) => x.status === 'na')) expect(g.value).toMatch(/^Can't tell yet: needs .+\(.+›.+\)/);
    expect(gate('reserve').needs).toContain('payroll runs');
    expect(gate('reserve').needs).toContain('fuel invoices for HM11');
    expect(gate('conversion').needs).toContain('bank activity');
  });
  it('has no NaN or Infinity anywhere, in the verdict, the sensitivity, the assumptions or the export', () => {
    const sens = compassSensitivity(v.inputs, v.settings, GT);
    expect(badNumbers({ v, sens, a: assumptions(v), rows: compassRows(v) })).toEqual([]);
  });
  it('reads the P&L as booked: fuel margin from the imported fuel cost, labor, and no invented cash', () => {
    const hm11 = v.stores.find((s) => s.input.code === 'HM11')!;
    expect(hm11.input.fuelSource).toBe('pnl');
    expect(hm11.input.fuelMargin).toBe(1_200_000 - 900_000);
    expect(hm11.input.gallons).toBe(3500);
    expect(hm11.input.labor).toBe(150_000);
    expect(hm11.role).toBe('watch'); // no asset register: no return to measure
    expect(hm11.roic).toBeNull();
    expect(v.stores.filter((s) => s.input.code !== 'HM11').every((s) => s.role === 'watch' && !s.input.hasSales)).toBe(true);
    // The 1095 settlement clearing is profit, not money: out of cash, the reserve and invested capital.
    expect(v.inputs.cash.placeholder).toBe(v.inputs.company.netIncome);
    expect(v.inputs.cash.cash).toBe(4_500_000);
    expect(v.inputs.company.capital.workingCapital).toBe(0);
    expect(v.inputs.cash.known).toBe(false);
    expect(v.cash.fcfAnnual).toBeNull();
    expect(v.wacc.wacc).toBe(0.15); // no loans on file: all equity
  });
  it('counts the overdraft fees and sizes them', () => {
    expect(v.inputs.fees).toEqual({ count: 2, total: 7_000, accounts: ['Overdraft Fees (Financial Expenses)'] });
    const m = v.moves.find((x) => x.key === 'cash')!;
    expect(m.title).toBe('Stop the bank and overdraft fees');
    expect(m.value).toBe(84_000); // $70 in one month × 12
  });
  it('a snapshot balance under $30,000 fails the bank floor gate, and protecting cash comes first', () => {
    const low = growthCompass(importStationBooks(sbSnap(2_500_000)).state, T);
    const g = low.gates.find((x) => x.key === 'floor')!;
    expect(g.status).toBe('fail');
    expect(g.value).toBe('$25,000 in the bank (last bank entry Oct 31, 2026)');
    expect(low.stage).toBe('fix');
    expect(low.provisional).toBe(false);
    expect(low.sentence).toMatch(/^Fix: the bank is \$5,000 below its \$30,000 floor\. \d+ gates can't be judged on these books yet/);
    expect(low.moves[0].key).toBe('cash');
    expect(low.moves[0].value).toBe(500_000 + 84_000);
    expect(low.triggers.find((t) => t.gate === 'floor')!.eta).toContain('free cash flow is not known');
    expect(badNumbers(low)).toEqual([]);
  });
});

// ── History, inbox, settings ─────────────────────────────────────────────
describe('snapshots, inbox and settings', () => {
  it('September was recorded from the books; October has moved, and the inbox says so', () => {
    expect(compassOf(demo).history.map((h) => [h.period, h.stage])).toEqual([['2026-09', 'optimize']]);
    const inbox = compassInbox(demo, T);
    expect(inbox.find((x) => x.key === 'compass_stage')).toMatchObject({ count: 1, detail: 'The growth compass moved down from Optimize (September 2026) to Fix (October 2026).' });
    expect(inbox.find((x) => x.key === 'compass_record')!.count).toBe(1);
    const { s, b } = fresh();
    const r = recordCompass(b, user(s, 'usr_cfo'), T);
    expect(r.period).toBe('2026-10');
    expect(r.stage).toBe('fix');
    expect(compassInbox(s, T).find((x) => x.key === 'compass_record')!.count).toBe(0);
    expect(compassChange(s, { stage: 'fix', period: '2026-10' }).changed).toBe(true);
    recordCompass(b, user(s, 'usr_cfo'), T);
    expect(compassOf(s).history).toHaveLength(2); // recording again replaces the month
    expect(s.audit.some((x) => x.objectId === 'compass:2026-10')).toBe(true);
  });
  it('books without the slice read defaults and raise no inbox item', () => {
    const s = structuredClone(demo); delete s.compass;
    expect(compassOf(s).settings).toEqual(DEFAULT_COMPASS_SETTINGS);
    expect(compassInbox(s, T)).toEqual([]);
  });
  it('the CFO edits the assumptions (validated, audited); the owner cannot', () => {
    const { s, b } = fresh();
    const before = growthCompass(s, T);
    saveCompassSettings(b, user(s, 'usr_cfo'), { costOfEquityBps: 2000 });
    const after = growthCompass(s, T);
    expect(after.wacc.wacc).toBeGreaterThan(before.wacc.wacc);
    expect(after.company.spread!).toBeLessThan(0);
    expect(after.gates.find((g) => g.key === 'roic')!.status).toBe('fail');
    expect(s.audit.at(-1)!.action).toBe('update compass settings');
    expect(() => saveCompassSettings(b, user(s, 'usr_cfo'), { costOfEquityBps: 0 })).toThrow(ValidationError);
    expect(() => saveCompassSettings(b, user(s, 'usr_owner'), { costOfEquityBps: 1600 })).toThrow();
    saveCompassSettings(b, user(s, 'usr_cfo'), { taxRateBps: 2500 });
    expect(growthCompass(s, T).inputs.tax.rateBps).toBe(2500);
    saveCompassSettings(b, user(s, 'usr_cfo'), { taxRateBps: undefined });
    expect(growthCompass(s, T).inputs.tax.rateBps).toBe(ownerRateBps(s));
    expect(validateCompassSettings({ ...DEFAULT_COMPASS_SETTINGS, scaleMonths: 0, shockCpg: -1 })).toHaveLength(2);
    saveCompassSettings(b, user(s, 'usr_cfo'), { basis: 'accrual' });
    const acc = growthCompass(s, T);
    expect(acc.inputs.basis).toBe('accrual');
    expect(acc.gates.find((g) => g.key === 'profit')!.status).toBe('fail'); // the accrual books ran a loss
  });
  it('inputs are deterministic and nothing posts', () => {
    const { s } = fresh();
    const n = s.transactions.length;
    const a = compassInputs(s, T), c = compassInputs(s, T);
    expect(a).toEqual(c);
    expect(s.transactions.length).toBe(n);
  });
});
