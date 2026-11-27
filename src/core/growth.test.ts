import { describe, expect, it } from 'vitest';
import { Books, ValidationError } from './books';
import { buildDemo } from '../data/seed';
import {
  addFixPlan, analyzeAcquisition, acquisitionProForma, capitalAllocation, closeOnTime, companyValuation, compareOptions, DEFAULT_GROWTH_SETTINGS, distributionTie,
  distributionsByOwner, evaluateDeal, expansionScorecard, factorScores, growthInbox, growthOf, inputsFromStore, irr, npv, overallOf, payback, proFormaMonths,
  proFormaResult, quarterlyReview, rampCheck, recordDistribution, recordScorecard, returnsByStore, reviewWorkbook, safeDistribution, safeDistributionHistory,
  saveGrowthSettings, saveProForma, saveProject, saveSite, scorecardChange, sensitivity, setDdItem, siteScore, siteScorecard, sumMonths, taxDistributionCover,
  tweak, valuationTrend, deploySuggestion, DEFAULT_WEIGHTS, type Flow,
} from './growth';
import { basisEntries, balanceSheet, statement } from './statements';
import { salesRows } from './fuel';
import { reserveTarget, paydownPlan } from './debt';
import { taxDistributions } from './tax';
import { ownerDraws } from './intercompany';
import { vaultIndex } from './compliance';
import { balanceAsOf } from './reports';
import type { BooksState, ProForma, SiteProfile } from './types';

const T = '2026-11-26';
const demo = buildDemo();
const fresh = () => { const s = structuredClone(demo); return { s, b: new Books(s, () => '2026-11-26T17:00:00.000Z') }; };
const user = (s: BooksState, id: string) => s.users.find((u) => u.id === id)!;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const flows = (xs: number[]): Flow[] => xs.map((amount, t) => ({ t, amount }));
const pfOf = (s: BooksState, mode: ProForma['mode']) => growthOf(s).proFormas.find((p) => p.mode === mode)!;

// ── Investment math ──────────────────────────────────────────────────────
describe('IRR, NPV and payback', () => {
  it('match known values', () => {
    expect(irr(flows([-100, 110]))).toBeCloseTo(0.1, 10);
    expect(irr(flows([-70_000, 12_000, 15_000, 18_000, 21_000, 26_000]))!).toBeCloseTo(0.086631, 5); // spreadsheet IRR 8.66%
    expect(irr(flows([-100, 39, 59, 55, 20]))!).toBeCloseTo(0.2809, 4); // 28.09%
    expect(irr(flows([-1000, 0, 0, 1331]))!).toBeCloseTo(0.1, 9);
    expect(npv(0.1, flows([-10_000, 3_000, 4_200, 6_800]))).toBeCloseTo(1_307.29, 2); // spreadsheet NPV() discounts the first flow a period: 1,188.44 × 1.1
    expect(npv(0.1, [{ t: 1, amount: -10_000 }, { t: 2, amount: 3_000 }, { t: 3, amount: 4_200 }, { t: 4, amount: 6_800 }])).toBeCloseTo(1_188.44, 2);
    expect(npv(0, flows([-5, 2, 3]))).toBe(0);
    expect(payback(flows([-1000, 300, 400, 500]))).toBeCloseTo(2.6, 10);
    expect(payback(flows([-1000, 100, 100]))).toBeNull();
  });
  it('is robust: no sign change has no IRR, a loss gives a negative rate, fractional times, and NPV at the IRR is zero', () => {
    expect(irr(flows([100, 200]))).toBeNull();
    expect(irr(flows([-100, -50]))).toBeNull();
    expect(irr(flows([-100, 50]))!).toBeCloseTo(-0.5, 9);
    const r = irr([{ t: 0, amount: -1000 }, { t: 0.5, amount: 200 }, { t: 1.5, amount: 1000 }])!;
    expect(npv(r, [{ t: 0, amount: -1000 }, { t: 0.5, amount: 200 }, { t: 1.5, amount: 1000 }])).toBeCloseTo(0, 6);
    expect(irr(flows([-1, 30]))!).toBeCloseTo(29, 6); // high returns widen the bracket
  });
});

// ── Pro forma ────────────────────────────────────────────────────────────
describe('new store pro forma', () => {
  const build = pfOf(demo, 'build');
  const r = proFormaResult(build, DEFAULT_GROWTH_SETTINGS);
  it('10 years of months; every annual total is the sum of its months', () => {
    expect(r.months).toHaveLength(120);
    expect(r.ties).toBe(true);
    for (const y of r.years) {
      const s = sumMonths(r.months.filter((m) => m.year === y.year));
      expect(y.ebitda).toBe(s.ebitda);
      expect(y.cashAfterDebt).toBe(y.ebitda - y.debtService);
    }
    expect(sum(r.years.map((y) => y.ebitda))).toBe(sum(r.months.map((m) => m.ebitda)));
  });
  it('ramps volumes, then grows them; costs grow with inflation; EBITDA = gross profit − opex', () => {
    const m = r.months;
    expect(m[0].rampPct).toBe(55);
    expect(m[0].gallons).toBe(Math.round(90_000 * 0.55));
    expect(m[11].rampPct).toBe(99);
    expect(m[12].rampPct).toBe(100);
    expect(m[12].gallons).toBe(Math.round(90_000 * 1.02));
    expect(m[0].labor).toBe(3_000_000);
    expect(m[12].labor).toBe(Math.round(3_000_000 * 1.02));
    for (const x of m.slice(0, 24)) {
      expect(x.fuelGp).toBe(Math.round(x.gallons * 32));
      expect(x.ebitda).toBe(x.grossProfit - x.opex);
      expect(x.incentive).toBe(x.n <= 36 ? Math.round(x.gallons * 2) : 0);
    }
    expect(m[36].incentive).toBe(0);
  });
  it('capital, equity, financing and the IRR cash flows', () => {
    expect(r.capitalTotal).toBe(sum(build.capital.map((c) => c.amount)));
    expect(r.equity).toBe(r.capitalTotal - 10_000_000 - 240_000_000);
    expect(r.unleveredFlows[0].amount).toBe(-(r.capitalTotal - 10_000_000));
    expect(r.leveredFlows[0].amount).toBe(-r.equity - r.preOpeningDebtService);
    expect(r.preOpeningDebtService).toBeGreaterThan(0); // 14 months of payments before opening
    expect(r.leveredFlows.at(-1)!.amount).toBe(r.years[9].cashAfterDebt + r.residual - r.loanBalanceAtExit);
    expect(r.unleveredFlows[1].t).toBeCloseTo(14 / 12 + 1, 10);
    expect(npv(r.leveredIrr!, r.leveredFlows)).toBeCloseTo(0, 0);
    expect(r.leveredIrr!).toBeGreaterThan(r.unleveredIrr!); // positive leverage
    expect(r.cashOnCash).toBeCloseTo(r.years[r.stabilizedYear - 1].cashAfterDebt / r.equity, 12);
    for (const y of r.years) expect(y.dscr).toBeCloseTo(y.ebitda / y.debtService, 12);
  });
  it('break-even gallons and inside sales at stabilized volumes', () => {
    const be = r.breakEven;
    const y = r.years[be.year - 1];
    const i = build.inputs;
    const perGal = i.cpg - (i.cardFeePct / 100) * i.retailCpg;
    const fixed = (y.opex - y.cardFees) / 12, ds = y.debtService / 12;
    const insideC = i.insideMarginPct / 100 - i.cardFeePct / 100, kitchenC = 1 - i.foodCostPct / 100 - i.cardFeePct / 100;
    const other = (y.otherIncome + y.incentive) / 12;
    expect(be.gallonsAfterDebt).toBe(Math.max(0, Math.round((fixed + ds - insideC * (y.insideSales / 12) - kitchenC * (y.kitchenSales / 12) - other) / perGal)));
    expect(be.insideAfterDebt).toBe(Math.max(0, Math.round((fixed + ds - perGal * (y.gallons / 12) - kitchenC * (y.kitchenSales / 12) - other) / insideC)));
    // At the break-even inside sales, cash after debt service is about zero.
    const at = proFormaResult({ ...build, inputs: { ...i, insideSales: Math.round(be.insideAfterDebt! / Math.pow(1.02, be.year - 1)) } });
    expect(Math.abs(at.years[be.year - 1].cashAfterDebt)).toBeLessThan(12 * 100 * 50);
  });
  it('sensitivity: ±2¢ margin × ±10% gallons and ±1% rate move the returns the right way', () => {
    const x = sensitivity(build);
    expect(x.irrGrid[2][2]).toBeCloseTo(r.leveredIrr!, 12);
    expect(x.npvGrid[2][2]).toBe(r.leveredNpv);
    for (const row of x.irrGrid) for (let j = 1; j < row.length; j++) expect(row[j]!).toBeGreaterThan(row[j - 1]!);
    for (let k = 1; k < x.irrGrid.length; k++) expect(x.irrGrid[k][2]!).toBeGreaterThan(x.irrGrid[k - 1][2]!);
    expect(x.rateRows.map((q) => q.rateBps)).toEqual([600, 650, 700, 750, 800]);
    for (let k = 1; k < x.rateRows.length; k++) { expect(x.rateRows[k].leveredIrr!).toBeLessThan(x.rateRows[k - 1].leveredIrr!); expect(x.rateRows[k].dscr!).toBeLessThan(x.rateRows[k - 1].dscr!); }
    expect(proFormaResult(tweak(build, { cpgDelta: 2 })).years[2].fuelGp - r.years[2].fuelGp).toBe(sum(proFormaMonths(build).filter((m) => m.year === 3).map((m) => m.gallons * 2)));
  });
  it('prefills from a store\'s actual statements (start from HM15)', () => {
    const entries = basisEntries(demo);
    const x = inputsFromStore(demo, 'st_hm15', { from: '2026-09', to: '2026-10', entries });
    const st = statement(demo, { basis: 'accrual', from: '2026-09', to: '2026-10', storeIds: ['st_hm15'], entries });
    const gal = salesRows(demo, { storeIds: ['st_hm15'], from: '2026-09-01', to: '2026-10-31' }).reduce((a, q) => a + q.gallons, 0);
    expect(x.months).toBe(2);
    expect(x.inputs.gallons).toBe(Math.round(gal / 2));
    expect(x.inputs.insideSales).toBe(Math.round(st.salesByLob.inside.total / 2));
    expect(x.inputs.cpg).toBeCloseTo(st.gpByLob.fuel.total / gal, 2);
    expect(x.inputs.kitchenSales).toBeGreaterThan(0);
    expect(x.source).toContain('HM15');
    const labor = st.rows.filter((q) => q.account.id === 'acct_wages' || q.account.id === 'acct_payroll_taxes').reduce((a, q) => a + q.total, 0);
    expect(x.inputs.labor).toBe(Math.round(labor / 2));
  });
  it('validates and saves; needs growth.edit', () => {
    const { s, b } = fresh();
    const pf = pfOf(s, 'build');
    expect(() => saveProForma(b, user(s, 'usr_owner'), { ...pf, id: undefined })).toThrow(/permission|role|can't|not allowed/i);
    try { saveProForma(b, user(s, 'usr_cfo'), { ...pf, id: undefined, name: '', financing: { ...pf.financing, loanAmount: 999_999_999_99 } }); throw new Error('saved'); } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).errors).toEqual(expect.arrayContaining(['Name the pro forma.', 'The loan can\'t be more than the capital needed.']));
    }
    const saved = saveProForma(b, user(s, 'usr_bk'), { ...pf, id: undefined, name: 'Copy' });
    expect(growthOf(s).proFormas.some((p) => p.id === saved.id)).toBe(true);
  });
});

describe('buy vs build vs lease', () => {
  it('side by side: IRR, NPV, upfront cash, time to open, residual real estate, risks', () => {
    const g = growthOf(demo);
    const acq = acquisitionProForma(demo, g.acquisitions[0]);
    const cmp = compareOptions([...g.proFormas, acq]);
    const by = (m: string) => cmp.rows.find((r) => r.pf.mode === m)!;
    expect(cmp.rows).toHaveLength(3);
    expect(by('lease').residualRealEstate).toBe(0);
    expect(by('build').residualRealEstate).toBeGreaterThan(by('build').pf.realEstateValue);
    expect(by('build').irrWithOverrun!).toBeLessThan(by('build').r.leveredIrr!);
    expect(by('build').risks.join(' ')).toMatch(/overrun/i);
    expect(by('buy').risks.join(' ')).toMatch(/environmental/i);
    expect(by('lease').timeToOpen).toBeLessThan(by('build').timeToOpen);
    for (const r of cmp.rows) expect(r.upfrontCash).toBe(r.r.equity);
    expect(cmp.leastCash).toBe(cmp.rows.reduce((a, r) => (r.upfrontCash < a.upfrontCash ? r : a)).pf.id);
    expect(cmp.bestIrr).toBe(by('build').pf.id);
  });
});

// ── Sites ────────────────────────────────────────────────────────────────
describe('site scorecard', () => {
  it('weighted score from factor scores; the strong prospect beats our stores, the weak one does not', () => {
    const sc = siteScorecard(demo);
    const a = sc.rows.find((r) => r.site.name.startsWith('Prospect A'))!;
    const bb = sc.rows.find((r) => r.site.name.startsWith('Prospect B'))!;
    expect(sc.rows.filter((r) => r.site.kind === 'existing')).toHaveLength(4);
    expect(a.rating).toBe('strong');
    expect(bb.rating).toBe('weak');
    expect(a.score).toBeGreaterThan(sc.existingAvg!);
    const f = factorScores(a.site);
    const w = DEFAULT_WEIGHTS;
    expect(a.score).toBeCloseTo(sum(Object.keys(w).map((k) => f[k as keyof typeof w] * w[k as keyof typeof w])) / sum(Object.values(w)), 1);
    expect(factorScores({ ...a.site, competitors: [{ name: 'x', brand: '', distanceMi: 0.5, amenities: '' }, { name: 'y', brand: '', distanceMi: 1.5, amenities: '' }] }).competition).toBe(55);
  });
  it('weights are editable: all weight on traffic gives the traffic score', () => {
    const a = siteScorecard(demo).rows.find((r) => r.site.name.startsWith('Prospect A'))!.site;
    const only = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, k === 'aadt' ? 1 : 0])) as typeof DEFAULT_WEIGHTS;
    expect(siteScore(a, only)).toBe(factorScores(a).aadt);
  });
  it('validates a site', () => {
    const { s, b } = fresh();
    const bad = { name: '', kind: 'prospect', area: '', status: 'reviewing', aadt: -1, visibility: 7, access: 3, competitors: [], population: 0, growthBps: 0, trucksPerDay: 0, zoning: 'unknown', environmental: 'unknown', utilities: 'all', medianIncome: 0 } as Omit<SiteProfile, 'id'>;
    expect(() => saveSite(b, user(s, 'usr_cfo'), bad)).toThrow(ValidationError);
  });
});

// ── Acquisitions ─────────────────────────────────────────────────────────
describe('acquisition model', () => {
  const acq = growthOf(demo).acquisitions[0];
  const a = analyzeAcquisition(acq, DEFAULT_GROWTH_SETTINGS);
  it('normalizes the seller\'s financials with add-backs and owner perks', () => {
    expect(a.reportedEbitda).toBe(a.revenue - a.cogs - a.expenses);
    expect(a.reportedEbitda).toBe(7_600_000);
    expect(a.addBacks).toBe(14_000_000);
    expect(a.perks).toBe(11_100_000);
    expect(a.normalizations).toBe(6_600_000);
    expect(a.normalizedEbitda).toBe(a.reportedEbitda + a.addBacks + a.perks - a.normalizations);
    expect(a.normalizedEbitda).toBe(26_100_000);
  });
  it('verifies fuel volume against supplier statements and flags variances over 2%', () => {
    expect(a.gallons.verified).toBe(true);
    expect(a.gallons.flagged).toBe(3);
    expect(a.gallons.annual).toBe(Math.round(((120_500 + 123_100 + 121_200 + 120_800) * 12) / 4));
    expect(analyzeAcquisition({ ...acq, gallonChecks: [] }).gallons).toMatchObject({ verified: false, annual: 1_500_000 });
  });
  it('values by EBITDA multiple, per gallon, and real estate + business', () => {
    expect(a.valuation.multiple).toEqual({ low: 26_100_000 * 4, high: 26_100_000 * 6 });
    expect(a.valuation.perGallon).toEqual({ low: a.gallons.annual * 60, high: a.gallons.annual * 110 });
    expect(a.valuation.realEstatePlusBusiness.businessEbitda).toBe(26_100_000 - 11_000_000);
    expect(a.valuation.realEstatePlusBusiness.low).toBe(150_000_000 + 15_100_000 * 4);
    expect(a.valuation.low).toBe(Math.min(a.valuation.multiple.low, a.valuation.perGallon.low, a.valuation.realEstatePlusBusiness.low));
    expect(a.valuation.high).toBe(Math.max(a.valuation.multiple.high, a.valuation.perGallon.high, a.valuation.realEstatePlusBusiness.high));
  });
  it('purchase: price + inventory + fuel in the tanks; equity after the loan', () => {
    expect(a.purchase.fuelInTank).toBe(18_000 * 265);
    expect(a.purchase.total).toBe(185_000_000 + 14_000_000 + 4_770_000);
    expect(a.purchase.equity).toBe(a.purchase.total - 140_000_000);
  });
  it('due diligence: status with owner and documents; done needs a document; an issue needs a note; in the vault', () => {
    expect(a.dd).toMatchObject({ total: 6, done: 2, issues: 0 });
    const { s, b } = fresh();
    const cfo = user(s, 'usr_cfo');
    const id = growthOf(s).acquisitions[0].id;
    expect(() => setDdItem(b, cfo, id, 'dd2', { status: 'done' })).toThrow(/Attach/);
    expect(() => setDdItem(b, cfo, id, 'dd3', { status: 'issue', note: '' })).toThrow(/Describe/);
    setDdItem(b, cfo, id, 'dd3', { status: 'issue', note: 'Line test failed on the diesel tank.' });
    expect(analyzeAcquisition(growthOf(s).acquisitions[0]).dd.issues).toBe(1);
    const ev = evaluateDeal(s, T, { kind: 'acquisition', id })!;
    expect(ev.decision).toBe('no_go');
    expect(ev.reasons.join(' ')).toMatch(/due-diligence/);
    const v = vaultIndex(demo).filter((e) => e.sources.some((x) => x.kind === 'due_diligence'));
    expect(v.map((e) => e.name).sort()).toEqual(['Target C Phase I ESA (demo).pdf', 'Target C title commitment (demo).pdf']);
  });
});

// ── Scorecard ────────────────────────────────────────────────────────────
describe('expansion readiness scorecard', () => {
  const sc = expansionScorecard(demo, T);
  const get = (k: string) => sc.checks.find((c) => c.key === k)!;
  it('overall: red if any check is red, green only if all are green, else amber', () => {
    expect(overallOf(['green', 'green'])).toBe('green');
    expect(overallOf(['green', 'na'])).toBe('amber');
    expect(overallOf(['amber', 'red', 'green'])).toBe('red');
    expect(sc.checks).toHaveLength(8);
    expect(sc.overall).toBe(overallOf(sc.checks.map((c) => c.status)));
  });
  it('demo: each check follows its rule', () => {
    expect(sc.period).toBe('2026-10');
    expect(get('ebitda').detail).toMatch(/Annualized from 2 months/);
    expect(get('samestore').status).toBe('na');
    expect(get('samestore').detail).toMatch(/Not enough history/);
    expect(get('breakeven').status).toBe('amber'); // HM11 and HM15 below, both with fix plans
    expect(get('reserve').status).toBe('amber'); // reserve met, equity short
    expect(get('dscr').status).toBe('green');
    expect(get('management').status).toBe('amber'); // manager ready, October not closed on time
    expect(get('ramp').status).toBe('amber');
    expect(closeOnTime(demo, T, 3)).toMatchObject({ onTime: 1, needed: 3 });
    const rc = rampCheck(demo, 'st_hm17', T).latest!;
    expect(rc.target.gallons).toBe(Math.round(26_000 * rc.days / 30));
  });
  it('a store below break-even without a fix plan is red; adding one makes it amber', () => {
    const { s, b } = fresh();
    growthOf(s); s.growth!.fixPlans = s.growth!.fixPlans.filter((f) => f.storeId !== 'st_hm11');
    expect(expansionScorecard(s, T).checks.find((c) => c.key === 'breakeven')!.status).toBe('red');
    addFixPlan(b, user(s, 'usr_cfo'), { storeId: 'st_hm11', text: 'Reprice fuel against the competitor weekly.' });
    expect(expansionScorecard(s, T).checks.find((c) => c.key === 'breakeven')!.status).toBe('amber');
  });
  it('keeps a history and alerts when the overall turns green or drops to red', () => {
    expect(growthOf(demo).scoreHistory.map((h) => h.period)).toEqual(['2026-09', '2026-10']);
    expect(scorecardChange(demo, sc).changed).toBe(false);
    expect(scorecardChange(demo, { overall: 'green', period: '2026-11' })).toMatchObject({ changed: true, to: 'green' });
    expect(scorecardChange(demo, { overall: 'amber', period: '2026-11' }).changed).toBe(false);
    const { s, b } = fresh();
    saveGrowthSettings(b, user(s, 'usr_cfo'), { leverageTarget: 100 }); // 1.00x: the deal breaks it
    const live = expansionScorecard(s, T);
    expect(live.overall).toBe('red');
    const ch = scorecardChange(s, live);
    expect(ch.changed).toBe(true);
    expect(ch.message).toMatch(/dropped to red/);
    expect(growthInbox(s, T).find((i) => i.key === 'growth_score')!.count).toBe(1);
    recordScorecard(b, user(s, 'usr_cfo'), T); // re-recording October compares with September
    expect(scorecardChange(s, live).previous!.period).toBe('2026-09');
  });
});

// ── Owners ───────────────────────────────────────────────────────────────
describe('owner returns & distributions', () => {
  it('safe distribution = cash above the reserve − near-term capex − tax due − debt-service cushion', () => {
    const x = safeDistribution(demo, T);
    expect(x.aboveReserve).toBe(reserveTarget(demo, T).deployable);
    expect(x.raw).toBe(x.aboveReserve - x.capexTotal - x.taxTotal - x.cushion);
    expect(x.safe).toBe(Math.max(0, x.raw));
    expect(x.taxDue.map((t) => t.dueDate)).toEqual(['2026-12-10']);
    expect(x.cushion).toBeGreaterThan(0);
    expect(x.capex).toEqual([]); // the kitchen upgrade starts after the 90-day window
    const { s, b } = fresh();
    saveProject(b, user(s, 'usr_cfo'), { name: 'Pump replacement', kind: 'remodel', cost: 2_000_000, annualReturn: 0, risk: 'low', strategic: 3, start: '2026-12-15', status: 'approved' });
    expect(safeDistribution(s, T).safe).toBe(Math.max(0, x.raw - 2_000_000));
    saveProject(b, user(s, 'usr_cfo'), { name: 'Big remodel', kind: 'remodel', cost: 50_000_000, annualReturn: 0, risk: 'low', strategic: 3, start: '2026-12-15', status: 'in_progress' });
    expect(safeDistribution(s, T).safe).toBe(0);
    const h = safeDistributionHistory(demo, T);
    expect(h.map((p) => p.date)).toEqual(['2026-09-30', '2026-10-31', T]);
    expect(h.at(-1)!.safe).toBe(x.safe);
  });
  it('tax distributions pass through from Phase 11', () => {
    const td = taxDistributions(demo, { year: 2026, asOf: T });
    const cover = taxDistributionCover(demo, T, 0);
    expect(cover.rows).toEqual(td.rows);
    expect(cover.still).toBe(sum(td.rows.map((r) => r.remaining)));
    expect(cover.covered).toBe(cover.still === 0);
  });
  it('distributions by owner, YTD and lifetime, tie to the ledger', () => {
    const d = distributionsByOwner(demo, T);
    const a = d.rows.find((r) => r.partyId === 'pt_owner_a')!;
    expect(a.distributionsYtd).toBe(1_200_000);
    expect(a.drawsYtd).toBe(1_000_000);
    expect(a.ytd).toBe(1_200_000 + 1_000_000 + 3_600_000);
    expect(a.lifetime).toBe(a.booksLifetime + 41_000_000);
    const draws = ownerDraws(demo, { from: '2026-01-01', to: T });
    expect(sum(d.rows.map((r) => r.drawsYtd + r.distributionsYtd))).toBe(draws.total);
    const tie = distributionTie(demo);
    expect(tie).toMatchObject({ recorded: 2_000_000, ledger: 2_000_000, ok: true });
    const dist = demo.transactions.filter((t) => t.tags.includes('distribution'));
    expect(dist.every((t) => t.date.startsWith('2026-11'))).toBe(true);
  });
  it('recording a distribution posts Dr owner draws / Cr bank; above the safe amount needs a reason; locked months refuse', () => {
    const { s, b } = fresh();
    const cfo = user(s, 'usr_cfo');
    const bank0 = balanceAsOf(s, 'acct_trustmark', T);
    const safe = safeDistribution(s, T).safe;
    const d = recordDistribution(b, cfo, { date: T, partyId: 'pt_owner_b', amount: 100_000 });
    const t = s.transactions.find((x) => x.id === d.txnId)!;
    expect(t.lines.find((l) => l.accountId === 'acct_owner_draws')!.debit).toBe(100_000);
    expect(balanceAsOf(s, 'acct_trustmark', T)).toBe(bank0 - 100_000);
    expect(distributionTie(s).ok).toBe(true);
    expect(() => recordDistribution(b, cfo, { date: T, partyId: 'pt_owner_a', amount: safe + 10_000_000 })).toThrow(/above the safe distribution/);
    const o = recordDistribution(b, cfo, { date: T, partyId: 'pt_owner_a', amount: safe + 10_000_000, override: 'Owners approved, funded by the line of credit.' });
    expect(o.override).toMatch(/Owners approved/);
    expect(() => recordDistribution(b, cfo, { date: '2026-09-15', partyId: 'pt_owner_a', amount: 1_000, override: 'x' })).toThrow(/locked/);
    expect(() => recordDistribution(b, user(s, 'usr_bk'), { date: T, partyId: 'pt_owner_a', amount: 1_000 })).toThrow();
    expect(() => recordDistribution(b, cfo, { date: T, partyId: 'pt_dash', amount: 1_000 })).toThrow(/owner/);
  });
  it('ROE and ROIC by store from each store entity\'s balance sheet', () => {
    const rows = returnsByStore(demo, T);
    expect(rows.map((r) => r.code)).toEqual(['HM11', 'HM13', 'HM15']); // HM17 has no complete month yet
    for (const r of rows) {
      const bs = balanceSheet(demo, { asOf: '2026-10-31', entityId: r.entityId });
      expect(r.equity).toBe(bs.totalEquity);
      expect(r.annualNet).toBe(Math.round(r.netIncome * 12 / r.months));
      expect(r.roe).toBeCloseTo(r.annualNet / r.equity, 12);
      expect(r.roic).toBeCloseTo(r.annualNopat / (r.equity + r.debt), 12);
    }
    expect(rows.find((r) => r.code === 'HM15')!.debt).toBeGreaterThan(0); // the equipment note
  });
});

// ── Capital allocation, valuation, deals ─────────────────────────────────
describe('capital allocation', () => {
  it('ranks every use by risk-adjusted return and allocates deployable cash down it', () => {
    const p = capitalAllocation(demo, T);
    for (let i = 1; i < p.uses.length; i++) expect(p.uses[i].riskAdjusted).toBeLessThanOrEqual(p.uses[i - 1].riskAdjusted);
    expect(p.uses.map((u) => u.kind)).toEqual(expect.arrayContaining(['project', 'debt', 'distribution', 'reserve']));
    expect(p.uses.find((u) => u.kind === 'debt')!.expectedReturn).toBeCloseTo(paydownPlan(demo, T).debts[0].afterTaxBps / 10000, 12);
    const kitchen = p.uses.find((u) => u.label === 'HM13 kitchen upgrade')!;
    expect(kitchen.riskAdjusted).toBeCloseTo((2_600_000 / 8_500_000) * 0.75, 12);
    expect(kitchen.paybackYears).toBeCloseTo(8_500_000 / 2_600_000, 12);
    expect(sum(p.allocations.map((a) => a.amount)) + p.unallocated).toBe(Math.max(0, p.deployable));
    expect(p.allocations.every((a) => a.use.status !== 'idea')).toBe(true);
    expect(p.deployable).toBe(reserveTarget(demo, T).deployable);
    expect(deploySuggestion(demo, T)).toMatch(/kitchen/);
  });
});

describe('company valuation', () => {
  it('EBITDA × multiple, per gallon, real estate at appraised value less debt = equity', () => {
    const v = companyValuation(demo, T);
    expect(v.multiple.low).toBe(Math.round(v.ebitda * 4));
    expect(v.equityMid).toBe(v.multiple.mid + v.realEstateTotal - v.debt);
    expect(v.realEstateTotal).toBe(410_000_000 + 170_000_000 + 640_000_000);
    expect(v.debt).toBe(v.companyDebt + sum(v.propertyDebt.map((x) => x.balance)));
    expect(v.noValue).toContain('st_hm17');
    expect(v.perGallonEquity.low).toBe(v.perGallon.low + v.realEstateTotal - v.debt);
  });
  it('quarterly snapshots with a trend', () => {
    const t = valuationTrend(demo);
    expect(t.map((x) => x.quarter)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3']);
    expect(t[0].entered).toBe(true);
    expect(t[2].entered).toBeFalsy();
    expect(t[1].change).toBe(t[1].equityMid - t[0].equityMid);
    // Recorded from the books as they stood on 30 Sep: a point-in-time snapshot of its own figures.
    expect(t[2].equityMid).toBe(Math.round((t[2].ebitda * (t[2].multipleLow + t[2].multipleHigh) / 2) / 100) + t[2].realEstate - t[2].debt);
    expect(t[2].annualized).toBe(true);
  });
});

describe('evaluate a deal', () => {
  it('pro forma → impact on company DSCR, leverage and cash → go / no-go with the reasons', () => {
    const build = pfOf(demo, 'build');
    const e = evaluateDeal(demo, T, { kind: 'proforma', id: build.id })!;
    expect(e.after.dscr).toBeCloseTo((e.before.ebitda + e.r.years[0].ebitda) / (e.before.debtService + e.r.years[0].debtService), 12);
    expect(e.after.debt).toBe(e.before.debt + build.financing.loanAmount);
    expect(e.after.cashAfter).toBe(e.before.deployable - e.r.equity - e.r.preOpeningDebtService);
    expect(e.decision).toBe('conditional'); // returns pass; the equity isn't on hand yet
    expect(e.reasons.join(' ')).toMatch(/Equity available/);
    const lease = evaluateDeal(demo, T, { kind: 'proforma', id: pfOf(demo, 'lease').id })!;
    expect(lease.decision).toBe('no_go');
    const cheap = evaluateDeal(demo, T, { kind: 'proforma', id: build.id }, { financing: { ...build.financing, rateBps: 300 } })!;
    expect(cheap.r.leveredIrr!).toBeGreaterThan(e.r.leveredIrr!);
    expect(evaluateDeal(demo, T, { kind: 'proforma', id: 'nope' })).toBeNull();
  });
});

describe('quarterly CFO review', () => {
  it('pulls results vs budget, KPI trend, covenants, paydown, scorecard, tax and distribution capacity; the workbook carries them', () => {
    const q = quarterlyReview(demo, T);
    expect(q.quarter).toBe('2026-Q4');
    expect(q.from).toBe('2026-10');
    expect(q.kpis.map((k) => k.period)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(q.kpis.at(-1)!.provisional).toBe(true);
    expect(q.safe.safe).toBe(safeDistribution(demo, T).safe);
    expect(q.scorecard.overall).toBe(expansionScorecard(demo, T).overall);
    const wb = reviewWorkbook(demo, q);
    expect(wb.map((s) => s.name)).toEqual(['Budget vs actual', 'KPI trend', 'Covenants', 'Refinance & paydown', 'Expansion scorecard', 'Tax & distributions', 'Valuation']);
    const taxSheet = wb.find((s) => s.name === 'Tax & distributions')!.rows;
    expect(taxSheet.find((r) => r[0] === 'Safe distribution')![2]).toBe(q.safe.safe / 100);
  });
});

describe('permissions and inbox', () => {
  it('owner and outside accountant read only; bookkeeper edits but cannot distribute', () => {
    const { s, b } = fresh();
    for (const id of ['usr_owner', 'usr_cpa', 'usr_mgr11']) {
      expect(() => saveGrowthSettings(b, user(s, id), { hurdleIrrBps: 1200 })).toThrow();
      expect(() => recordScorecard(b, user(s, id), T)).toThrow();
    }
    expect(saveGrowthSettings(b, user(s, 'usr_bk'), { hurdleIrrBps: 1200 }).hurdleIrrBps).toBe(1200);
    expect(() => recordDistribution(b, user(s, 'usr_bk'), { date: T, partyId: 'pt_owner_a', amount: 100 })).toThrow();
  });
  it('inbox: scorecard change, monthly record, and overdue diligence', () => {
    const items = growthInbox(demo, T);
    expect(items.map((i) => i.key)).toEqual(['growth_score', 'growth_record', 'growth_dd']);
    expect(items.find((i) => i.key === 'growth_record')!.count).toBe(0);
    expect(items.find((i) => i.key === 'growth_dd')!.count).toBe(1); // supply contract due 20 Nov
    const s0 = structuredClone(demo); delete s0.growth;
    expect(growthInbox(s0, T)).toEqual([]);
    expect(growthOf(s0).settings).toEqual(DEFAULT_GROWTH_SETTINGS);
  });
});
