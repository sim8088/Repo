import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import {
  actualCells, addVarianceComment, breakEven, budgetCells, budgetsOf, budgetStatement, buildBudget, bva, cellKey, createBudgetVersion, fillAcross, fyPeriods,
  isOver, kitchenLaborShare, parseKey, pricePerGallon, rollingForecast, runScenario, saveScenario, setActiveVersion, setBudgetCells, setVarianceThreshold,
  uncommentedVariances, validateScenario, varianceCells, versionTotals, weekdayShare,
} from './budgets';
import { basisEntries, scorecards, statement } from './statements';
import { PermissionError } from './permissions';
import type { BooksState, User } from './types';

const TODAY = '2026-11-27';
const user = (s: BooksState, role: User['role']) => s.users.find((u) => u.role === role)!;
let demo: BooksState | null = null;
const fresh = () => buildDemo();
const shared = () => (demo ??= buildDemo());
const all = (s: BooksState) => s.stores.map((x) => x.id);

describe('building a budget', () => {
  it('annualizes the complete months on file when there is no prior year, and says so', () => {
    const s = shared();
    const b = buildBudget(s, { fiscalYear: 2026, method: 'prior_actuals', growthPct: 0, asOf: '2026-11-26' });
    expect(b.sourceMonths).toEqual(['2026-09', '2026-10']);
    expect(b.note).toMatch(/annualized from September 2026 – October 2026/);
    expect(b.note).toMatch(/no prior year/);
    // A cell = the store's Sep + Oct average for that line, rounded to whole dollars, the same every month.
    const act = actualCells(s, { basis: 'accrual' });
    const k = (p: string) => cellKey('st_hm13', 'acct_sales_tobacco', p);
    const avg = ((act.get(k('2026-09')) ?? 0) + (act.get(k('2026-10')) ?? 0)) / 2;
    expect(b.lines[k('2026-01')]).toBe(Math.round(avg / 100) * 100);
    expect(b.lines[k('2026-12')]).toBe(b.lines[k('2026-01')]);
    // Growth scales it.
    const g = buildBudget(s, { fiscalYear: 2026, method: 'prior_actuals', growthPct: 10, asOf: '2026-11-26' });
    expect(g.lines[k('2026-01')]).toBe(Math.round((avg * 1.1) / 100) * 100);
  });

  it('a store that opened this month is scaled up from its days so far; nothing before it opens', () => {
    const s = shared();
    const b = buildBudget(s, { fiscalYear: 2026, method: 'prior_actuals', growthPct: 0, asOf: '2026-11-26' });
    expect(b.storesFromPartial).toEqual(['st_hm17']);
    expect(b.lines[cellKey('st_hm17', 'acct_fuel_regular', '2026-10')]).toBeUndefined();
    const act = actualCells(s, { basis: 'accrual' }).get(cellKey('st_hm17', 'acct_fuel_regular', '2026-11'))!;
    expect(b.lines[cellKey('st_hm17', 'acct_fuel_regular', '2026-11')]).toBe(Math.round((act * 30) / 26 / 100) * 100);
  });

  it('uses last year\'s same month when the books reach back; zero-based starts empty', () => {
    const s = shared();
    const b = buildBudget(s, { fiscalYear: 2027, method: 'prior_actuals', growthPct: 0, asOf: '2026-11-26' });
    const act = actualCells(s, { basis: 'accrual' });
    const k = cellKey('st_hm11', 'acct_sales_beer', '2026-09');
    expect(b.lines[cellKey('st_hm11', 'acct_sales_beer', '2027-09')]).toBe(Math.round(act.get(k)! / 100) * 100);
    expect(b.note).toMatch(/2 months from the same month last year/);
    expect(buildBudget(s, { fiscalYear: 2026, method: 'zero', growthPct: 0 }).lines).toEqual({});
  });

  it('versions: the first is active, one active per year; edits, copy and spread add up; permissions and validation', () => {
    const s = emptyState();
    const b = new Books(s, () => `${TODAY}T12:00:00.000Z`);
    const cfo = s.users.find((u) => u.id === CFO_ID)!;
    expect(() => createBudgetVersion(b, user(s, 'owner'), { fiscalYear: 2026, name: 'x', method: 'zero', growthPct: 0 })).toThrow(PermissionError);
    const v1 = createBudgetVersion(b, cfo, { fiscalYear: 2026, name: 'Plan', method: 'zero', growthPct: 0 });
    expect(v1.active).toBe(true);
    expect(() => createBudgetVersion(b, cfo, { fiscalYear: 2026, name: 'plan', method: 'zero', growthPct: 0 })).toThrow(ValidationError);
    expect(() => createBudgetVersion(b, cfo, { fiscalYear: 2026, name: 'Big', method: 'zero', growthPct: 500 })).toThrow(/Growth/);
    setBudgetCells(b, cfo, v1.id, [{ storeId: 'st_hm11', accountId: 'acct_sales_kitchen', period: '2026-01', amount: 1_000_00 }]);
    fillAcross(b, cfo, v1.id, { storeId: 'st_hm11', accountId: 'acct_sales_kitchen', mode: 'copy', from: '2026-01' });
    expect(fyPeriods(s, 2026).every((p) => v1.lines[cellKey('st_hm11', 'acct_sales_kitchen', p)] === 1_000_00)).toBe(true);
    fillAcross(b, cfo, v1.id, { storeId: 'st_hm11', accountId: 'acct_utilities', mode: 'spread', annual: 1_000_01 });
    const parts = fyPeriods(s, 2026).map((p) => v1.lines[cellKey('st_hm11', 'acct_utilities', p)]);
    expect(parts.reduce((a, x) => a + x, 0)).toBe(1_000_01);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
    expect(versionTotals(s, v1).net).toBe(12 * 1_000_00 - 1_000_01);
    expect(() => setBudgetCells(b, cfo, v1.id, [{ storeId: 'st_hm11', accountId: 'acct_trustmark', period: '2026-01', amount: 1 }])).toThrow(/P&L lines only/);
    expect(() => setBudgetCells(b, cfo, v1.id, [{ storeId: 'st_hm11', accountId: 'acct_rent', period: '2027-01', amount: 1 }])).toThrow(/isn't in FY2026/);
    expect(() => setBudgetCells(b, user(s, 'reviewer'), v1.id, [])).toThrow(PermissionError);
    const v2 = createBudgetVersion(b, cfo, { fiscalYear: 2026, name: 'Copy', method: 'prior_actuals', growthPct: 0, copyFromId: v1.id });
    expect(v2.active).toBe(false);
    expect(v2.lines).toEqual(v1.lines);
    setActiveVersion(b, cfo, v2.id);
    expect(budgetsOf(s).versions.filter((v) => v.active).map((v) => v.id)).toEqual([v2.id]);
    expect(s.audit.some((a) => a.objectType === 'budget' && a.action === 'activate')).toBe(true);
  });
});

describe('budget vs actual', () => {
  it('actuals tie to the P&L on every basis; the budget ties to the grid; variance = actual − budget', () => {
    const s = shared();
    const entries = basisEntries(s);
    for (const basis of ['accrual', 'cash', 'booked'] as const) {
      const r = bva(s, { from: '2026-09', to: '2026-11', storeIds: all(s), basis, entries });
      const pnl = statement(s, { basis, from: '2026-09', to: '2026-11', storeIds: all(s), entries });
      expect(r.actual.netIncome.total).toBe(pnl.netIncome.total);
      expect(r.actualTiesToPnl).toBe(true);
      expect(r.budgetTiesToCells).toBe(true);
      expect(r.compare.available && r.compare.budgetNet).toBe(r.budget.netIncome.total);
      for (const row of r.rows) expect(row.variance).toBe(row.actual - row.budget);
    }
    // One store, one month: the row equals the P&L line and the budget cell.
    const r = bva(s, { from: '2026-10', to: '2026-10', storeIds: ['st_hm13'], entries });
    const util = r.rows.find((x) => x.account.id === 'acct_utilities')!;
    expect(util.budget).toBe(budgetCells(s).get(cellKey('st_hm13', 'acct_utilities', '2026-10')));
    expect(util.actual).toBe(statement(s, { basis: 'accrual', from: '2026-10', to: '2026-10', storeIds: ['st_hm13'], entries }).rows.find((x) => x.account.id === 'acct_utilities')!.total);
  });

  it('the demo budget has lines set off on purpose, and the threshold flags them', () => {
    const s = shared();
    const cells = varianceCells(s, { from: '2026-10', to: '2026-10', storeIds: all(s) });
    const util = cells.find((c) => c.storeId === 'st_hm13' && c.account.id === 'acct_utilities')!;
    expect(util.over).toBe(true);
    expect(util.effect).toBeLessThan(0); // a cost over budget hurts profit
    const diesel = cells.find((c) => c.storeId === 'st_hm15' && c.account.id === 'acct_fuel_diesel')!;
    expect(diesel.over && diesel.effect < 0).toBe(true);
    expect(isOver(s, 99_99, 0)).toBe(false);
    expect(isOver(s, 1_000_00, 0)).toBe(true);
    expect(isOver(s, 1_000_00, 100_000_00)).toBe(false);
  });

  it('comments clear a variance from the to-explain list; September is fully explained; permissions', () => {
    const s = fresh();
    const b = new Books(s, () => `${TODAY}T12:00:00.000Z`);
    const cfo = s.users.find((u) => u.id === CFO_ID)!;
    const open = uncommentedVariances(s, { storeIds: all(s), today: TODAY });
    expect(open.some((c) => c.period === '2026-09')).toBe(false);
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((c) => c.period === '2026-10')).toBe(true); // November isn't over
    const c = open[0];
    expect(() => addVarianceComment(b, cfo, { period: c.period, storeId: c.storeId, accountId: c.account.id, text: ' ' })).toThrow(ValidationError);
    expect(() => addVarianceComment(b, user(s, 'owner'), { period: c.period, storeId: c.storeId, accountId: c.account.id, text: 'x' })).toThrow(PermissionError);
    addVarianceComment(b, cfo, { period: c.period, storeId: c.storeId, accountId: c.account.id, text: 'Timing.' });
    expect(uncommentedVariances(s, { storeIds: all(s), today: TODAY }).length).toBe(open.length - 1);
    setVarianceThreshold(b, cfo, { pct: 100, minCents: 100_000_00 });
    expect(uncommentedVariances(s, { storeIds: all(s), today: TODAY })).toEqual([]);
    expect(() => setVarianceThreshold(b, cfo, { pct: 120, minCents: 0 })).toThrow(ValidationError);
  });
});

describe('rolling forecast', () => {
  it('actual months tie to the accrual P&L; this month is actual-to-date + the rest of the plan; later months are the budget', () => {
    const s = shared();
    const fc = rollingForecast(s, { fiscalYear: 2026, storeIds: all(s), today: TODAY });
    expect(fc.months.map((m) => m.source)).toEqual([...Array(8).fill('budget_before_books'), 'actual', 'actual', 'mtd', 'forecast']);
    expect(fc.ties).toBe(true);
    const acc = statement(s, { basis: 'accrual', from: '2026-09', to: '2026-10', storeIds: all(s) });
    expect(fc.actualToDate).toBe(acc.netIncome.total);
    const nov = fc.months.find((m) => m.period === '2026-11')!;
    expect(nov.remaining).toBeCloseTo(4 / 30);
    const k = cellKey('st_hm13', 'acct_rent', '2026-11');
    const act = actualCells(s).get(k) ?? 0;
    expect(fc.cells.get(k)).toBe(act + Math.round((budgetCells(s).get(k) ?? 0) * nov.remaining));
    const dec = cellKey('st_hm13', 'acct_utilities', '2026-12');
    expect(fc.cells.get(dec)).toBe(budgetCells(s).get(dec));
    expect(fc.budget.netIncome.total).toBe(budgetStatement(s, { from: '2026-01', to: '2026-12', storeIds: all(s) }).netIncome.total);
  });

  it('overrides and the run rate replace the plan for months to come; a year with no budget gets a stand-in', () => {
    const s = fresh();
    const b = new Books(s, () => `${TODAY}T12:00:00.000Z`);
    const cfo = s.users.find((u) => u.id === CFO_ID)!;
    const v = budgetsOf(s).versions.find((x) => x.active)!;
    setBudgetCells(b, cfo, v.id, [{ storeId: 'st_hm13', accountId: 'acct_utilities', period: '2026-12', amount: 7_777_00 }], 'forecast');
    let fc = rollingForecast(s, { fiscalYear: 2026, storeIds: all(s), today: TODAY });
    expect(fc.cells.get(cellKey('st_hm13', 'acct_utilities', '2026-12'))).toBe(7_777_00);
    v.forecastMode = 'run_rate';
    fc = rollingForecast(s, { fiscalYear: 2026, storeIds: all(s), today: TODAY });
    const act = actualCells(s);
    const rr = Math.round(((act.get(cellKey('st_hm11', 'acct_rent', '2026-09')) ?? 0) + (act.get(cellKey('st_hm11', 'acct_rent', '2026-10')) ?? 0)) / 2);
    expect(fc.cells.get(cellKey('st_hm11', 'acct_rent', '2026-12'))).toBe(rr);
    const f27 = rollingForecast(s, { fiscalYear: 2027, storeIds: all(s), today: TODAY });
    expect(f27.version).toBeUndefined();
    expect(f27.budgetNote).toMatch(/No FY2027 budget yet/);
    expect(f27.months.every((m) => m.source === 'forecast')).toBe(true);
  });
});

describe('scenarios', () => {
  const base = (s: BooksState) => rollingForecast(s, { fiscalYear: 2027, storeIds: all(s), today: TODAY });

  it('fuel margin ± N¢ a gallon = forecast gallons × N', () => {
    const s = shared();
    const fc = base(s);
    const r = runScenario(s, { name: 'x', fiscalYear: 2027, adjustments: [{ kind: 'fuel_margin', cpg: -2, storeId: 'st_hm11' }] }, { storeIds: all(s), base: fc, today: TODAY });
    const ppg = pricePerGallon(s, 'st_hm11')!;
    let gallons = 0;
    for (const [k, v] of fc.cells) { const x = parseKey(k); if (x.storeId === 'st_hm11' && ['acct_fuel_regular', 'acct_fuel_plus', 'acct_fuel_premium', 'acct_fuel_diesel'].includes(x.accountId)) gallons += v / ppg; }
    expect(Math.abs(r.effects[0].net - -2 * gallons)).toBeLessThan(12); // rounding per month
    expect(r.ties).toBe(true);
    expect(r.net - r.baseNet).toBe(r.effects[0].net);
  });

  it('new store: copies a store with a ramp on variable lines; fixed costs in full', () => {
    const s = shared();
    const fc = base(s);
    const r = runScenario(s, { name: 'x', fiscalYear: 2027, adjustments: [{ kind: 'new_store', code: 'hm19', copyOf: 'st_hm13', opens: '2027-03', rampMonths: 4, rampStartPct: 50 }] }, { storeIds: all(s), base: fc, today: TODAY });
    expect(r.storeIds).toContain('new:HM19');
    const get = (acct: string, p: string) => r.cells.get(cellKey('new:HM19', acct, p)) ?? 0;
    const src = (acct: string, p: string) => fc.cells.get(cellKey('st_hm13', acct, p)) ?? 0;
    expect(get('acct_sales_tobacco', '2027-02')).toBe(0);
    expect(get('acct_sales_tobacco', '2027-03')).toBe(Math.round(src('acct_sales_tobacco', '2027-03') * 0.5));
    expect(get('acct_sales_tobacco', '2027-05')).toBe(Math.round(src('acct_sales_tobacco', '2027-05') * 0.75));
    expect(get('acct_sales_tobacco', '2027-08')).toBe(src('acct_sales_tobacco', '2027-08'));
    expect(get('acct_rent', '2027-03')).toBe(src('acct_rent', '2027-03'));
    expect(r.statement.netIncome['2027-03']).not.toBe(fc.statement.netIncome['2027-03']);
    expect(r.ties).toBe(true);
  });

  it('close the kitchen on a weekday: removes that share of kitchen sales, food cost and kitchen labor', () => {
    const s = shared();
    const fc = base(s);
    const r = runScenario(s, { name: 'x', fiscalYear: 2027, adjustments: [{ kind: 'close_kitchen', weekday: 0, storeId: 'st_hm13' }] }, { storeIds: all(s), base: fc, today: TODAY });
    const ws = weekdayShare(s, 'st_hm13', 0, '2027-01');
    expect(ws).toBeGreaterThan(0.08);
    expect(ws).toBeLessThan(0.25);
    const ls = kitchenLaborShare(s, 'st_hm13');
    expect(ls).toBeGreaterThan(0);
    const k = (a: string) => cellKey('st_hm13', a, '2027-01');
    expect(r.effects[0].cells.get(k('acct_sales_kitchen'))).toBe(Math.round(-fc.cells.get(k('acct_sales_kitchen'))! * ws));
    expect(r.effects[0].cells.get(k('acct_cogs_food'))).toBe(Math.round(-fc.cells.get(k('acct_cogs_food'))! * ws));
    expect(r.effects[0].cells.get(k('acct_wages'))).toBe(Math.round(-fc.cells.get(k('acct_wages'))! * ws * ls));
    expect(r.effects[0].cells.get(k('acct_sales_tobacco'))).toBeUndefined();
    expect(r.ties).toBe(true);
  });

  it('% change to a group; only months to come change; saved scenarios validate', () => {
    const s = fresh();
    const fc = rollingForecast(s, { fiscalYear: 2026, storeIds: all(s), today: TODAY });
    const r = runScenario(s, { name: 'x', fiscalYear: 2026, adjustments: [{ kind: 'account_pct', target: 'group:labor', pct: 10 }] }, { storeIds: all(s), base: fc, today: TODAY });
    const labor = (p: string) => ['acct_wages', 'acct_payroll_taxes'].reduce((a, id) => a + (fc.statement.rows.find((x) => x.account.id === id)?.by[p] ?? 0), 0);
    expect(Math.abs(r.effects[0].net - -0.1 * labor('2026-12') - -0.1 * labor('2026-11') * (4 / 30))).toBeLessThan(20);
    expect(r.statement.netIncome['2026-10']).toBe(fc.statement.netIncome['2026-10']);
    expect(validateScenario(s, { name: '', fiscalYear: 2026, adjustments: [] })).toHaveLength(2);
    expect(validateScenario(s, { name: 'y', fiscalYear: 2026, adjustments: [{ kind: 'account_pct', target: 'group:net', pct: 5 }] }).join()).toMatch(/not a profit line/);
    expect(validateScenario(s, { name: 'y', fiscalYear: 2026, adjustments: [{ kind: 'new_store', code: 'HM11', copyOf: 'st_hm13', opens: '2026-12', rampMonths: 3, rampStartPct: 50 }] }).join()).toMatch(/already a store/);
    expect(validateScenario(s, { name: 'y', fiscalYear: 2026, adjustments: [{ kind: 'close_kitchen', weekday: 0, storeId: 'st_hm17' }] }).join()).toMatch(/no kitchen/);
    const b = new Books(s, () => `${TODAY}T12:00:00.000Z`);
    expect(() => saveScenario(b, user(s, 'reviewer'), { name: 'z', fiscalYear: 2026, adjustments: [{ kind: 'fuel_margin', cpg: 1 }] })).toThrow(PermissionError);
    const sc = saveScenario(b, s.users[0], { name: 'z', fiscalYear: 2026, adjustments: [{ kind: 'fuel_margin', cpg: 1 }] });
    expect(budgetsOf(s).scenarios.map((x) => x.id)).toContain(sc.id);
  });

  it('the demo scenario ties and every change has an effect', () => {
    const s = shared();
    const sc = budgetsOf(s).scenarios[0];
    const r = runScenario(s, sc, { storeIds: all(s), today: TODAY });
    expect(r.ties).toBe(true);
    expect(r.effects).toHaveLength(3);
    expect(r.effects.every((e) => e.net !== 0)).toBe(true);
  });
});

describe('break-even', () => {
  it('fixed ÷ contribution margin; contribution − fixed = net; agrees with the scorecards', () => {
    const s = shared();
    const ops = s.stores.filter((x) => x.kind === 'operating').map((x) => x.id);
    const rows = breakEven(s, { from: '2026-10', to: '2026-10', storeIds: ops });
    const cards = scorecards(s, { period: '2026-10', storeIds: ops });
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.contribution - r.fixed).toBe(r.net);
      expect(r.breakEvenSales).toBe(Math.round(r.fixed / (r.contribution / r.sales)));
      expect(r.breakEvenGallons! / r.gallons).toBeCloseTo(r.breakEvenSales! / r.sales);
      const k = cards.find((c) => c.storeId === r.storeId)!.kpis.find((x) => x.key === 'breakEven')!;
      expect(k.value).toBeCloseTo(r.safety! * 100, 9);
    }
    const bud = breakEven(s, { from: '2026-10', to: '2026-10', storeIds: ops, source: 'budget' });
    for (const r of bud) expect(r.contribution - r.fixed).toBe(r.net);
  });
});
