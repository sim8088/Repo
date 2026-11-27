import type { SeedCtx } from './seed';
import { cellKey, createBudgetVersion, fyPeriods, saveScenario, setBudgetCells, versionById } from '../core/budgets';

/**
 * Phase 8 demo budgets: the FY2026 budget built from the demo's own actuals (Sep–Oct 2026 annualized, +3%), with a
 * handful of lines set deliberately off so the budget-vs-actual screens have variances to explain; an inactive
 * "stretch" version; and one saved FY2027 scenario. Figures are illustrative.
 */
export function seedBudgets(ctx: SeedCtx): void {
  const { books, cfo, setClock, state } = ctx;
  setClock('2026-11-05');
  const v = createBudgetVersion(books, cfo, { fiscalYear: 2026, name: 'FY2026 budget', method: 'prior_actuals', growthPct: 3, activate: true }, { asOf: '2026-11-26' });
  // Lines set off on purpose (the plan expected more, or less, than the stores did).
  const months = fyPeriods(state, 2026);
  const off: [store: string, account: string, factor: number, from: string][] = [
    ['st_hm11', 'acct_sales_kitchen', 1.18, '2026-09'], // a catering push that didn't happen
    ['st_hm13', 'acct_repairs', 0.35, '2026-09'], // repairs budgeted low
    ['st_hm15', 'acct_fuel_diesel', 1.22, '2026-10'], // truck lane growth planned from October
    ['st_hm13', 'acct_utilities', 0.6, '2026-10'], // the new rate wasn't in the plan
    ['st_corp', 'acct_professional', 0.5, '2026-09'], // year-end CPA work started early
  ];
  const cells = off.flatMap(([storeId, accountId, f, from]) => months.filter((p) => p >= from).map((period) => ({ storeId, accountId, period, amount: Math.round(((versionById(state, v.id)!.lines[cellKey(storeId, accountId, period)] ?? 0) * f) / 100) * 100 })));
  setBudgetCells(books, cfo, v.id, cells.filter((c) => c.amount));
  setClock('2026-11-06');
  createBudgetVersion(books, cfo, { fiscalYear: 2026, name: 'Stretch plan (+8%)', method: 'prior_actuals', growthPct: 8 }, { asOf: '2026-11-26' });
  setClock('2026-11-20');
  saveScenario(books, cfo, {
    name: 'Tighter fuel, HM19 opens March',
    fiscalYear: 2027,
    note: 'What next year looks like if street prices squeeze fuel margin, the next store opens in March on the Crystal Springs profile, and Meadville stops Sunday kitchen service.',
    adjustments: [
      { kind: 'fuel_margin', cpg: -2 },
      { kind: 'new_store', code: 'HM19', copyOf: 'st_hm15', opens: '2027-03', rampMonths: 6, rampStartPct: 55 },
      { kind: 'close_kitchen', weekday: 0, storeId: 'st_hm13' },
    ],
  });
}
