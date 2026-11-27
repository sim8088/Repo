import { describe, expect, it } from 'vitest';
import { Books } from './books';
import { buildDemo, emptyState, CFO_ID } from '../data/seed';
import {
  acknowledgeBalance, addMarketRate, addPropertyValue, analyzeRefi, bookDebtAt, breachForecast, covenantMetrics, covenantMonitor, debtDashboard, debtInbox, debtOf,
  defaultProposal, dscrWithNewDebt, FIXED_EXCLUDE, headlineMetrics, liquidityAt, maturityLadder, monthsToFund, onePayroll, paydownPlan, projectSchedule, pv, refinance,
  refinanceTriggers, relatedPartyLoans, reserveHistory, reserveTarget, saveAlternative, saveCovenant, saveDebtSettings, saveRpTerms, saveScenario, suggestedPenalty,
  testCovenant, trendLine, typicalLoadCost, weighted, capitalSnapshot,
} from './debt';
import { amortization, levelPayment, loanStatus, loansOf, saveLoan, postLoanOpening, type LoanDraft } from './loans';
import { basisEntries, statement } from './statements';
import { forecast } from './forecast';
import { balanceAsOf } from './reports';
import { liveInvoices } from './fuel';
import { payWeeks, storeWeeks } from './payroll';
import type { Covenant, DebtSettings } from './types';
import { addDays } from './dates';

const TODAY = '2026-11-27';
const demo = buildDemo();
const user = (s: ReturnType<typeof buildDemo>, id: string) => s.users.find((u) => u.id === id)!;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const note = (over: Partial<LoanDraft> = {}): LoanDraft => ({
  name: 'Note', kind: 'equipment_note', lender: 'Lender', lenderPartyId: 'pt_trustmark', heldBy: 'company', storeId: 'st_hm15', liabilityAccountId: 'acct_notes_equipment',
  interestAccountId: 'acct_interest', payFromAccountId: 'acct_trustmark', original: 1_200_000, rateBps: 600, rateType: 'fixed', termMonths: 12, amortizationMonths: 12,
  payment: levelPayment(1_200_000, 600, 12), start: '2026-08-01', firstPayment: '2026-09-01', maturity: '2027-08-01', collateral: '', guarantor: '', prepaymentPenalty: 'None', covenants: [], ...over,
});

describe('weighted-average cost of debt', () => {
  it('weights each rate by its balance', () => {
    expect(weighted([{ balance: 100_000, rateBps: 600 }, { balance: 300_000, rateBps: 800 }])).toBe(750);
    expect(weighted([])).toBeNull();
  });
  it('demo: company WACD from the two loans on our books, after tax at the configured rate', () => {
    const d = debtDashboard(demo, TODAY);
    const [eq, loc] = ['loan_hm15_equip', 'loan_loc'].map((id) => d.rows.find((r) => r.loan.id === id)!);
    expect(d.wacdBps).toBeCloseTo((eq.balance * 725 + loc.balance * 850) / (eq.balance + loc.balance), 9);
    expect(d.afterTaxWacdBps).toBeCloseTo(d.wacdBps! * 0.75, 9);
    expect(d.wacdAllBps).toBeCloseTo(sum(d.rows.map((r) => r.balance * r.rateBps)) / sum(d.rows.map((r) => r.balance)), 9);
  });
});

describe('maturity ladder', () => {
  it('buckets each year\'s principal and puts the balance due at maturity (or the balloon) in its year; buckets add to the balance', () => {
    const l = { ...note({ termMonths: 18, amortizationMonths: 36, payment: levelPayment(1_200_000, 600, 36), maturity: '2028-02-01' }), id: 'x', payments: {}, draws: [], attachments: [] };
    const status = loanStatus(emptyState(), l, '2026-08-31');
    const ladder = maturityLadder([{ status, loan: l }], '2026-08-31');
    const rows = amortization(l);
    expect(sum(ladder.map((b) => b.total))).toBe(1_200_000);
    expect(ladder[0].maturities).toBe(0);
    expect(ladder[0].amortization).toBe(sum(rows.filter((r) => r.date <= '2027-08-31').map((r) => r.principal)));
    expect(ladder[1].maturities).toBe(rows.at(-1)!.principal);
    expect(ladder[1].loans).toEqual(['Note']);
  });
  it('demo: ties to the company balances, with the line of credit maturing within 12 months', () => {
    const d = debtDashboard(demo, TODAY);
    expect(sum(d.ladder.map((b) => b.total))).toBe(d.companyDebt);
    expect(d.ladder[0].loans).toContain('Corporate line of credit');
    expect(d.ladder[0].maturities).toBe(d.rows.find((r) => r.loan.id === 'loan_loc')!.balance);
  });
});

describe('covenant calculations against the statements', () => {
  const entries = basisEntries(demo);
  const metrics = covenantMetrics(demo, TODAY, { entries });
  const s = debtOf(demo).settings;
  const head = headlineMetrics(metrics, s)!;
  const stores = demo.stores.map((x) => x.id);
  it('one row per month in the books; the month in progress is provisional; the headline is the latest complete month', () => {
    expect(metrics.map((m) => m.period)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(metrics.map((m) => m.provisional)).toEqual([false, false, true]);
    expect(head.period).toBe('2026-10');
    expect(head).toMatchObject({ from: '2026-09', months: 2, factor: 6, annualized: true });
  });
  it('EBITDA = net income + interest (6500) + depreciation (6400/6410) from the P&L on the chosen basis', () => {
    const st = statement(demo, { basis: s.ratioBasis, from: '2026-09', to: '2026-10', storeIds: stores, entries });
    const row = (id: string) => st.rows.find((r) => r.account.id === id)?.total ?? 0;
    expect(head.netIncome).toBe(st.netIncome.total);
    expect(head.ebitda).toBe(st.netIncome.total + row('acct_interest') + row('acct_depreciation') + row('acct_disposal'));
    expect(head.rent).toBe(row('acct_rent'));
    expect(head.ebitdaAnnual).toBe(Math.round(head.ebitda * 6));
  });
  it('DSCR = EBITDA ÷ scheduled principal + interest on company loans; the scheduled interest is the 6500 booked', () => {
    const rows = loansOf(demo).filter((l) => l.heldBy === 'company').flatMap((l) => amortization(l)).filter((r) => r.date >= '2026-09-01' && r.date <= '2026-10-31');
    const ds = sum(rows.map((r) => r.principal + r.interest));
    expect(head.debtService).toBe(ds);
    expect(head.dscr).toBeCloseTo(head.ebitda / ds, 12);
    const booked6500 = sum(demo.transactions.filter((t) => !t.deleted && t.date >= '2026-09-01' && t.date <= '2026-10-31').flatMap((t) => t.lines).filter((l) => l.accountId === 'acct_interest').map((l) => l.debit - l.credit));
    expect(head.scheduledInterest).toBe(booked6500);
  });
  it('leverage = loan accounts at the month end ÷ annualized EBITDA; liquidity = the bank at the month end; FCC adds rent to both sides', () => {
    const debt = balanceAsOf(demo, 'acct_notes_equipment', '2026-10-31') + balanceAsOf(demo, 'acct_loc', '2026-10-31') + balanceAsOf(demo, 'acct_mortgages', '2026-10-31');
    expect(head.debt).toBe(debt);
    expect(head.leverage).toBeCloseTo(debt / Math.round(head.ebitda * 6), 12);
    expect(head.liquidity).toBe(balanceAsOf(demo, 'acct_trustmark', '2026-10-31'));
    expect(head.fcc).toBeCloseTo((head.ebitda + head.rent) / (head.debtService + head.rent), 12);
    expect(head.globalDscr).toBeCloseTo((head.ebitda + head.rent) / (head.debtService + head.relatedDebtService), 12);
  });
  it('the window is configurable: no annualizing leaves the factor at 1; a 1-month window uses only that month', () => {
    const one = covenantMetrics(demo, TODAY, { entries, settings: { ...s, ttmMonths: 1 } });
    expect(one[1]).toMatchObject({ from: '2026-10', months: 1, factor: 12 });
    const raw = covenantMetrics(demo, TODAY, { entries, settings: { ...s, annualize: false } });
    expect(raw[1].factor).toBe(1);
    expect(raw[1].ebitdaAnnual).toBe(raw[1].ebitda);
    expect(raw[1].dscr).toBeCloseTo(head.dscr!, 12); // annualizing scales both sides of DSCR alike
  });
  it('headroom and status against each covenant', () => {
    const mon = covenantMonitor(demo, TODAY, { entries });
    expect(mon.ties).toEqual({ ebitda: true, interest: true, debt: true });
    const dscr = mon.tests.find((t) => t.covenant.loanId === 'loan_hm15_equip' && t.covenant.kind === 'dscr')!;
    expect(dscr).toMatchObject({ limit: 1.25, pass: true, status: 'ok', period: '2026-10' });
    expect(dscr.headroom).toBeCloseTo(head.dscr! - 1.25, 12);
    const lev = mon.tests.find((t) => t.covenant.kind === 'leverage')!;
    expect(lev.headroom).toBeCloseTo(3 - head.leverage!, 12);
    const liq = mon.tests.find((t) => t.covenant.kind === 'min_liquidity')!;
    expect(liq.actual).toBe(liquidityAt(demo, TODAY)); // "at all times": read today
    expect(liq.headroom).toBe(liquidityAt(demo, TODAY) - 3_000_000);
    const tight = testCovenant(demo, { ...dscr.covenant, threshold: Math.round(head.dscr! * 100) - 1 }, mon.metrics, TODAY, mon.settings);
    expect(tight.status).toBe('near');
    const broken = testCovenant(demo, { ...dscr.covenant, threshold: Math.round(head.dscr! * 100) + 100 }, mon.metrics, TODAY, mon.settings);
    expect(broken).toMatchObject({ pass: false, status: 'breach', forecast: { method: 'now', within: true } });
    expect(dscrWithNewDebt(head, 0)).toBeCloseTo(head.dscr!, 12);
    expect(dscrWithNewDebt(head, head.debtServiceAnnual)).toBeCloseTo(head.dscr! / 2, 6);
  });
});

describe('breach forecast', () => {
  const s = debtOf(demo).settings;
  const dscr: Covenant = { id: 'c', loanId: 'loan_loc', kind: 'dscr', threshold: 125, active: true };
  it('a straight-line trend through three or more months finds the month end it crosses; two months are not enough', () => {
    expect(trendLine([2, 1.8, 1.6])).toEqual({ slope: expect.closeTo(-0.2, 9), last: expect.closeTo(1.6, 9) });
    const f = breachForecast(demo, dscr, [{ period: '2026-08', value: 2 }, { period: '2026-09', value: 1.8 }, { period: '2026-10', value: 1.6 }], '2026-11-01', s);
    expect(f).toMatchObject({ date: '2026-12-31', method: 'trend', within: true, value: 1.2 });
    expect(breachForecast(demo, dscr, [{ period: '2026-09', value: 1.8 }, { period: '2026-10', value: 1.6 }], '2026-11-01', s).date).toBeNull();
    const lev: Covenant = { ...dscr, kind: 'leverage', threshold: 300 };
    expect(breachForecast(demo, lev, [{ period: '2026-08', value: 2 }, { period: '2026-09', value: 2.5 }, { period: '2026-10', value: 2.8 }], '2026-11-01', s)).toMatchObject({ date: '2026-11-30', within: true });
    const far = breachForecast(demo, dscr, [{ period: '2026-08', value: 3 }, { period: '2026-09', value: 2.9 }, { period: '2026-10', value: 2.8 }], '2026-11-01', s);
    expect(far.within).toBe(false);
    expect(far.date! > addDays('2026-11-01', 182)).toBe(true);
  });
  it('minimum liquidity: the first day the 13-week cash forecast falls below it (the demo near-breach)', () => {
    const mon = covenantMonitor(demo, TODAY);
    const liq = mon.tests.find((t) => t.covenant.kind === 'min_liquidity')!;
    const f = forecast(demo, 'acct_trustmark', TODAY);
    let n = 1;
    while (n <= 91 && f.at(n) >= 3_000_000) n++;
    expect(n).toBeLessThanOrEqual(91);
    expect(liq.forecast).toMatchObject({ method: 'forecast', date: addDays(TODAY, n), within: true, value: f.at(n) });
    expect(liq.status).toBe('near');
    expect(liq.pass).toBe(true);
  });
});

describe('refinance math', () => {
  const cur = { balance: 1_000_000, payment: 110_000, rows: Array.from({ length: 10 }, () => ({ payment: 110_000, interest: 10_000 })) };
  const p = { rateBps: 0, termMonths: 10, amortizationMonths: 10, fees: 30_000, prepaymentPenalty: 0, cashOut: 0, rollInCosts: false };
  it('payment change, interest saved, break-even and NPV against hand-computed values', () => {
    const r = analyzeRefi(cur, p, 0);
    expect(r).toMatchObject({ newPrincipal: 1_000_000, newPayment: 100_000, paymentChange: -10_000, currentInterest: 100_000, newInterest: 0, interestSaved: 100_000, costs: 30_000, upfront: 30_000, breakEvenMonths: 3, cashFreedMonthly: 10_000, cashFreedFirstYear: 90_000 });
    expect(r.npv).toBe(70_000); // 10 × $100 saved − $300 fees, undiscounted
    // At 12% a year (1% a month): PV of $100 a month for 10 months = 100 × (1 − 1.01^−10) ÷ 0.01 = $947.13.
    expect(analyzeRefi(cur, p, 1200).npv).toBe(Math.round(10_000 * (1 - Math.pow(1.01, -10)) / 0.01) - 30_000);
    expect(analyzeRefi(cur, p, 1200).npv).toBe(64_713);
    expect(analyzeRefi(cur, { ...p, fees: 25_000, prepaymentPenalty: 6_000 }, 0).breakEvenMonths).toBe(4); // ceil(310 ÷ 100)
  });
  it('rolled-in costs and cash out raise the new principal; no saving means no break-even', () => {
    const r = analyzeRefi(cur, { ...p, rollInCosts: true, cashOut: 50_000 }, 0);
    expect(r).toMatchObject({ newPrincipal: 1_080_000, newPayment: 108_000, upfront: 0, cashFreedMonthly: 2_000, breakEvenMonths: 15 });
    expect(r.npv).toBe(1_100_000 - 1_080_000 + 50_000);
    expect(analyzeRefi(cur, { ...p, rateBps: 3000 }, 0).breakEvenMonths).toBeNull();
    expect(pv([10_000, 10_000], 0)).toBe(20_000);
  });
  it('projected schedule: level payment, 30/360 interest, the rest due at the end of a shorter term', () => {
    const rows = projectSchedule(1_200_000, 600, 12, 12);
    expect(rows[0]).toMatchObject({ payment: 103_280, interest: 6_000 });
    expect(sum(rows.map((r) => r.principal))).toBe(1_200_000);
    const b = projectSchedule(1_200_000, 600, 6, 12);
    expect(b).toHaveLength(6);
    expect(b.at(-1)!.balloon).toBe(true);
    expect(b.at(-1)!.closing).toBe(0);
    const io = projectSchedule(1_000_000, 1200, 3, 0);
    expect(io.map((r) => r.payment)).toEqual([10_000, 10_000, 1_010_000]);
  });
  it('prepayment penalty read from the loan wording', () => {
    expect(suggestedPenalty({ prepaymentPenalty: '2% of principal prepaid in the first three years', start: '2025-03-01' }, 5_000_000, TODAY)).toBe(100_000);
    expect(suggestedPenalty({ prepaymentPenalty: '2% of principal prepaid in the first three years', start: '2025-03-01' }, 5_000_000, '2028-04-01')).toBe(0);
    const step = { prepaymentPenalty: 'Step-down 3/2/1% in years 1–3', start: '2026-01-01' };
    expect(suggestedPenalty(step, 1_000_000, '2026-06-01')).toBe(30_000);
    expect(suggestedPenalty(step, 1_000_000, '2027-06-01')).toBe(20_000);
    expect(suggestedPenalty(step, 1_000_000, '2030-01-01')).toBe(0);
    expect(suggestedPenalty({ prepaymentPenalty: 'None', start: '2026-01-01' }, 1_000_000, TODAY)).toBe(0);
  });
  it('demo scenario: the HM13 mortgage at 5.50% — DSCR before and after on the group coverage, cash freed', () => {
    const sc = debtOf(demo).scenarios[0];
    const r = refinance(demo, sc, TODAY);
    const cur = loanStatus(demo, r.loan, TODAY);
    expect(r.balance).toBe(cur.scheduleBalance);
    expect(r.currentPayment).toBe(1_125_000);
    expect(r.newPayment).toBe(levelPayment(r.balance, 550, 172));
    expect(r.breakEvenMonths).toBe(Math.ceil(r.costs / (r.currentPayment - r.newPayment)));
    expect(r.dscrKind).toBe('global');
    expect(r.dscrAfter!).toBeGreaterThan(r.dscrBefore!);
    expect(r.cashFreedMonthly).toBe(r.currentPayment - r.newPayment);
    expect(r.sameMonths).toBe(r.remainingMonths);
  });
});

describe('refinance triggers', () => {
  it('demo: each trigger fires where the data says it should', () => {
    const t = refinanceTriggers(demo, TODAY);
    const by = (k: string) => t.filter((x) => x.kind === k).map((x) => x.loanId).sort();
    expect(by('maturity')).toEqual(['loan_loc']);
    expect(by('variable_above_fixed')).toEqual(['loan_loc']);
    expect(by('rate_gap')).toEqual(['loan_mtg_hm11', 'loan_mtg_hm13']); // the equipment note's 75 bp gap takes 88 months to pay back
    expect(by('ltv')).toEqual(['loan_mtg_hm15']);
    expect(by('covenant_forecast')).toEqual(['loan_loc']);
    const eq = refinance(demo, { ...defaultProposal(demo, loansOf(demo).find((l) => l.id === 'loan_hm15_equip')!, TODAY), loanId: 'loan_hm15_equip' }, TODAY);
    expect(eq.breakEvenMonths!).toBeGreaterThanOrEqual(36);
  });
  it('thresholds move the triggers: a shorter break-even, a lower value, a higher fixed quote', () => {
    const s = buildDemo();
    const b = new Books(s);
    const cfo = user(s, CFO_ID);
    saveDebtSettings(b, cfo, { refiBreakEvenMonths: 12, maturityMonths: 6 });
    addPropertyValue(b, cfo, { storeId: 'st_hm15', date: '2026-11-20', value: 600_000_000, source: 'Desk review' });
    addMarketRate(b, cfo, { date: '2026-11-20', kind: 'term_loan', rateType: 'fixed', rateBps: 900 });
    const t = refinanceTriggers(s, TODAY);
    expect(t.filter((x) => x.kind === 'rate_gap')).toEqual([]);
    expect(t.filter((x) => x.kind === 'maturity')).toEqual([]);
    expect(t.filter((x) => x.kind === 'ltv')).toEqual([]); // value fell: LTV above 70%
    expect(t.filter((x) => x.kind === 'variable_above_fixed')).toEqual([]);
  });
});

describe('cash reserve and deployable cash', () => {
  const entries = basisEntries(demo);
  const r = reserveTarget(demo, TODAY, { entries });
  it('target = N weeks of fixed costs + one fuel load per fuel store + one payroll + cushion', () => {
    expect(r.months).toEqual(['2026-09', '2026-10']);
    const st = statement(demo, { basis: 'booked', from: '2026-09', to: '2026-10', storeIds: demo.stores.map((x) => x.id), entries });
    const fixed = sum(st.rows.filter((x) => x.section === 'expense' && !FIXED_EXCLUDE.includes(x.account.id)).map((x) => x.total));
    expect(r.fixedCosts).toBe(fixed);
    expect(r.weeklyFixed).toBe(Math.round((fixed * 7) / 61));
    expect(r.fixedPart).toBe(r.weeklyFixed * 4);
    expect(r.fuelLoads.map((f) => f.storeId)).toEqual(['st_hm11', 'st_hm13', 'st_hm15', 'st_hm17']);
    const hm13 = liveInvoices(demo).filter((i) => i.storeId === 'st_hm13' && i.deliveredOn > addDays(TODAY, -90)).map((i) => i.total).sort((a, b) => a - b);
    const mid = Math.floor(hm13.length / 2);
    expect(typicalLoadCost(demo, 'st_hm13', TODAY).cost).toBe(hm13.length % 2 ? hm13[mid] : Math.round((hm13[mid - 1] + hm13[mid]) / 2));
    const weeks = payWeeks(demo).filter((w) => w <= TODAY).slice(0, 4);
    expect(onePayroll(demo, TODAY).amount).toBe(Math.round(sum(weeks.map((w) => sum([...storeWeeks(demo, w).values()].map((x) => x.cost)))) / 4));
    expect(r.target).toBe(r.fixedPart + r.fuelPart + r.payroll + 1_000_000);
  });
  it('cash = bank, cash on hand and clearing; deployable = cash − target; two month ends above → the alert', () => {
    const cashAccts = demo.accounts.filter((a) => a.type === 'asset' && ['bank', 'cash', 'clearing'].includes(a.subtype));
    expect(r.cash).toBe(sum(cashAccts.map((a) => balanceAsOf(demo, a.id, TODAY))));
    expect(r.deployable).toBe(r.cash - r.target);
    expect(r.deployable).toBeGreaterThan(0);
    const h = reserveHistory(demo, TODAY, { entries });
    expect(h.points.map((p) => p.date)).toEqual(['2026-09-30', '2026-10-31', TODAY]);
    expect(h.monthsAbove).toBe(2);
    expect(debtInbox(demo, TODAY).find((i) => i.key === 'debt_deployable')!.count).toBe(1);
  });
  it('a bigger cushion puts cash under the reserve: nothing is deployable and the alert clears', () => {
    const s = buildDemo();
    saveDebtSettings(new Books(s), user(s, CFO_ID), { reserve: { ...debtOf(s).settings.reserve, cushion: 50_000_000 } });
    expect(reserveTarget(s, TODAY).deployable).toBeLessThan(0);
    expect(reserveHistory(s, TODAY).monthsAbove).toBe(0);
    const plan = paydownPlan(s, TODAY);
    expect(plan.reserveMet).toBe(false);
    expect(plan.allocations).toEqual([]);
  });
});

describe('paydown vs invest', () => {
  it('ranks debts and alternatives by after-tax rate and allocates deployable cash down the list', () => {
    const plan = paydownPlan(demo, TODAY);
    expect(plan.ranked.map((u) => [u.label, u.afterTaxBps])).toEqual([
      ['Next store fund (site under review)', 1350], ['HM13 cooler and LED upgrade', 1050], ['Holiday inside inventory build', 750],
      ['Corporate line of credit', 638], ['HM15 truck-lane equipment note', 544], ['Reserve money market', 319],
    ]);
    expect(plan.debts.map((d) => d.label)).toEqual(['Corporate line of credit', 'HM15 truck-lane equipment note']);
    expect(plan.allocations).toEqual([{ use: plan.ranked[0], amount: plan.reserve.deployable }]);
    expect(plan.effects.liquidityAfter).toBe(plan.effects.liquidityBefore - plan.reserve.deployable);
  });
  it('avalanche: with no alternatives, the highest after-tax rate is paid first; the line of credit\'s interest falls at once', () => {
    const s = buildDemo();
    s.debt!.alternatives = [];
    const plan = paydownPlan(s, TODAY, { amount: 2_000_000 });
    const loc = plan.debts[0];
    expect(plan.allocations.map((a) => [a.use.key, a.amount])).toEqual([['loan_loc', loc.amount], ['loan_hm15_equip', 2_000_000 - loc.amount]]);
    const saved = Math.round((loc.amount * 850) / 10000);
    expect(plan.effects.interestSaved).toBe(saved + Math.round(((2_000_000 - loc.amount) * 725) / 10000));
    const m = headlineMetrics(covenantMetrics(s, TODAY), debtOf(s).settings)!;
    expect(plan.effects.monthlyFreeCashAfter).toBe(Math.round((m.ebitdaAnnual - (m.debtServiceAnnual - saved)) / 12));
    expect(plan.effects.dscrAfter!).toBeGreaterThan(plan.effects.dscrBefore!);
  });
  it('months to fund the next store', () => {
    expect(monthsToFund(25_000_000, 10_000_000, 5_000_000)).toBe(3);
    expect(monthsToFund(25_000_000, 30_000_000, 0)).toBe(0);
    expect(monthsToFund(25_000_000, 0, -1)).toBeNull();
  });
});

describe('related-party loans', () => {
  it('both directions, with the imputed-interest flag where the rate is below the AFR', () => {
    const rows = relatedPartyLoans(demo, TODAY);
    const se = rows.find((r) => r.partyId === 'pt_southern_eagle')!;
    expect(se).toMatchObject({ direction: 'lent', balance: 1_000_000, imputed: true, imputedAnnual: 40_000 });
    const be = rows.find((r) => r.partyId === 'pt_bullseye')!;
    expect(be).toMatchObject({ balance: 600_000, imputed: false });
    const cheers = rows.find((r) => r.partyId === 'pt_cheers')!;
    expect(cheers.terms).toBeUndefined(); // a balance with no documented terms
    expect(cheers).toMatchObject({ imputed: false, balance: 215_000 });
    expect(rows.some((r) => r.direction === 'borrowed')).toBe(true);
    expect(se.months.find((m) => m.period === '2026-10')).toMatchObject({ balance: 1_500_000, agreed: true });
    const s = buildDemo();
    saveDebtSettings(new Books(s), user(s, CFO_ID), { afrBps: 900 });
    expect(relatedPartyLoans(s, TODAY).find((r) => r.partyId === 'pt_bullseye')).toMatchObject({ imputed: true, imputedAnnual: 6_000 });
  });
  it('a confirmation that differs from the books needs a note', () => {
    const s = buildDemo();
    const b = new Books(s);
    const cfo = user(s, CFO_ID);
    const se = debtOf(s).rpTerms.find((t) => t.partyId === 'pt_southern_eagle')!;
    expect(() => acknowledgeBalance(b, cfo, { termsId: se.id, period: '2026-09', confirmedBalance: 100, confirmedBy: 'Them' })).toThrow(/Add a note/);
    const a = acknowledgeBalance(b, cfo, { termsId: se.id, period: '2026-09', confirmedBalance: 100, confirmedBy: 'Them', note: 'They count the October advance early' });
    expect(a.bookBalance).toBe(0);
    expect(relatedPartyLoans(s, TODAY).find((r) => r.partyId === 'pt_southern_eagle')!.months[0].agreed).toBe(false);
  });
});

describe('permissions and validation', () => {
  it('only the CFO and bookkeeper change debt data; owners, reviewers and managers read', () => {
    const s = buildDemo();
    const b = new Books(s);
    const cov = { loanId: 'loan_loc', kind: 'dscr' as const, threshold: 120, active: true };
    for (const id of ['usr_owner', 'usr_cpa', 'usr_mgr11']) {
      const u = user(s, id);
      expect(() => saveCovenant(b, u, cov)).toThrow(/permission|can't|not allowed/i);
      expect(() => saveDebtSettings(b, u, { afrBps: 500 })).toThrow();
      expect(() => saveScenario(b, u, { ...debtOf(s).scenarios[0], id: undefined, name: 'x' })).toThrow();
      expect(() => addMarketRate(b, u, { date: TODAY, kind: 'mortgage', rateType: 'fixed', rateBps: 500 })).toThrow();
      expect(() => saveRpTerms(b, u, { ...debtOf(s).rpTerms[0], id: undefined })).toThrow();
      expect(() => saveAlternative(b, u, { name: 'x', kind: 'other', amount: 100, returnBps: 100, taxable: true })).toThrow();
    }
    expect(saveCovenant(b, user(s, 'usr_bk'), cov).threshold).toBe(120);
    expect(s.audit.at(-1)).toMatchObject({ objectType: 'debt', userId: 'usr_bk' });
  });
  it('errors say how to fix them', () => {
    const s = buildDemo();
    const b = new Books(s);
    const cfo = user(s, CFO_ID);
    expect(() => saveScenario(b, cfo, { name: '', loanId: 'nope', rateBps: -1, termMonths: 0, amortizationMonths: 0, fees: -1, prepaymentPenalty: 0, cashOut: 0, rollInCosts: false })).toThrow();
    try { saveScenario(b, cfo, { name: 'x', loanId: 'loan_loc', rateBps: 600, termMonths: 60, amortizationMonths: 36, fees: 0, prepaymentPenalty: 0, cashOut: 0, rollInCosts: false }); } catch (e) { expect((e as { errors: string[] }).errors).toEqual(["Amortization can't be shorter than the term."]); }
    expect(() => saveDebtSettings(b, cfo, { ttmMonths: 0 })).toThrow(/Trailing months/);
    expect(() => addPropertyValue(b, cfo, { storeId: 'st_hm11', date: 'x', value: 0, source: '' })).toThrow();
  });
});

describe('older books and demo tie-outs', () => {
  it('books without the debt slice read defaults and compute without it', () => {
    const s = emptyState();
    delete s.debt;
    expect(debtOf(s).settings.ttmMonths).toBe(12);
    expect(covenantMetrics(s, TODAY)).toEqual([]);
    expect(debtInbox(s, TODAY)).toEqual([]);
    const b = new Books(s, () => '2026-11-27T12:00:00.000Z');
    const cfo = user(s, CFO_ID);
    b.createTransaction(cfo, { date: '2026-08-31', kind: 'opening', description: 'Opening', lines: [{ accountId: 'acct_trustmark', storeId: 'st_corp', debit: 10_000_000, credit: 0 }, { accountId: 'acct_owner_capital', storeId: 'st_corp', debit: 0, credit: 10_000_000 }] });
    const l = saveLoan(b, cfo, note());
    postLoanOpening(b, cfo, l.id, { date: '2026-08-31' });
    saveCovenant(b, cfo, { loanId: l.id, kind: 'min_liquidity', threshold: 5_000_000, active: true });
    expect(s.debt!.covenants).toHaveLength(1);
    expect(bookDebtAt(s, TODAY)).toBe(1_200_000);
  });
  it('dashboard balances tie to the GL loan accounts and the schedules; interest to date ties to 6500', () => {
    const d = debtDashboard(demo, TODAY);
    expect(d.ties).toBe(true);
    expect(d.companyDebt).toBe(bookDebtAt(demo, TODAY));
    expect(d.interestAttributed).toBe(d.interestLedger);
    expect(d.related.map((r) => r.carriedBy).sort()).toEqual(['Dhunna Development', 'Dhunna Development', 'SKD Properties']);
    for (const r of d.related) expect(r.interestToDate).toBeNull();
    expect(d.rows.find((r) => r.loan.id === 'loan_mtg_hm15')!.ltv).toBeCloseTo(d.rows.find((r) => r.loan.id === 'loan_mtg_hm15')!.balance / 640_000_000, 12);
  });
  it('the demo inbox: liquidity forecast breach, LOC maturity, refinance opportunities, variable above fixed, deployable cash; DSCR fine', () => {
    const ib = Object.fromEntries(debtInbox(demo, TODAY).map((i) => [i.key, i.count]));
    expect(ib).toEqual({ debt_covforecast: 1, debt_dscr: 0, debt_maturity: 1, debt_refi: 3, debt_varfixed: 1, debt_deployable: 1 });
  });
  it('capital snapshot for Phase 13', () => {
    const snap = capitalSnapshot(demo, TODAY);
    expect(snap.metrics!.period).toBe('2026-10');
    expect(snap.dscr).toBe(snap.metrics!.dscr);
    expect(snap.deployable).toBe(snap.reserve.cash - snap.reserve.target);
  });
  it('settings are typed and round-trip', () => {
    const s = buildDemo();
    const next = saveDebtSettings(new Books(s), user(s, CFO_ID), { taxRateBps: 3000 } as Partial<DebtSettings>);
    expect(debtOf(s).settings.taxRateBps).toBe(3000);
    expect(next.reserve.weeksFixed).toBe(4);
  });
});
