import type { SeedCtx } from './seed';
import type { Attachment, DdItem, ProFormaInputs, SiteProfile } from '../core/types';
import {
  DEFAULT_QOE, addFixPlan, ensureGrowth, recordDistribution, recordScorecard, saveAcquisition, saveGrowthSettings, saveProForma, saveProject, saveRampPlan,
  saveSite, saveValuationSnapshot, setPriorDistributions,
} from '../core/growth';

const c = (dollars: number) => Math.round(dollars * 100);

/**
 * Phase 13 demo: two site prospects (one strong, one weak) and our four stores' site profiles, an HM19-style build
 * pro forma and a lease option on the strong site, one acquisition target with a seller P&L and diligence partly done,
 * capital projects, quarterly valuations, HM17's ramp targets, the scorecard history and two owner distributions in
 * November (the only entries that post). Generic names and illustrative figures only. Nothing posts into September or
 * October (closed).
 */
export function seedGrowth({ books, cfo, setClock }: SeedCtx): void {
  ensureGrowth(books);
  setClock('2026-09-03');

  // Site profiles: our stores (for comparison) and two prospects.
  const site = (s: Omit<SiteProfile, 'id'>) => saveSite(books, cfo, s);
  const base = { competitors: [], note: undefined } as Pick<SiteProfile, 'competitors' | 'note'>;
  site({ ...base, name: 'HM11 Gluckstadt', kind: 'existing', storeId: 'st_hm11', area: 'Interstate exit, north', status: 'open', aadt: 21_000, visibility: 4, access: 4, competitors: [{ name: 'Branded station', brand: 'Major brand', distanceMi: 1.4, priceCpg: 299, amenities: 'Car wash' }], population: 12_500, growthBps: 150, trucksPerDay: 450, zoning: 'permitted', environmental: 'clean', utilities: 'all', medianIncome: c(68_000) });
  site({ ...base, name: 'HM13 Meadville', kind: 'existing', storeId: 'st_hm13', area: 'Rural highway', status: 'open', aadt: 9_500, visibility: 4, access: 3, competitors: [{ name: 'Independent store', brand: 'Unbranded', distanceMi: 0.8, priceCpg: 289, amenities: 'None' }], population: 5_200, growthBps: 20, trucksPerDay: 160, zoning: 'permitted', environmental: 'clean', utilities: 'all', medianIncome: c(46_000) });
  site({ ...base, name: 'HM15 Crystal Springs', kind: 'existing', storeId: 'st_hm15', area: 'Interstate exit with truck lane', status: 'open', aadt: 23_000, visibility: 5, access: 5, competitors: [{ name: 'Travel center', brand: 'Truck stop chain', distanceMi: 2.6, priceCpg: 305, amenities: 'Showers, scales' }], population: 8_000, growthBps: 80, trucksPerDay: 1_100, zoning: 'permitted', environmental: 'recs', utilities: 'all', medianIncome: c(52_000) });
  site({ ...base, name: 'HM17 Centreville', kind: 'existing', storeId: 'st_hm17', area: 'Town center', status: 'open', aadt: 11_000, visibility: 4, access: 3, competitors: [{ name: 'Dollar store fuel', brand: 'Unbranded', distanceMi: 1.8, priceCpg: 285, amenities: 'None' }], population: 6_400, growthBps: 60, trucksPerDay: 140, zoning: 'permitted', environmental: 'clean', utilities: 'all', medianIncome: c(49_000) });
  const strong = site({
    name: 'Prospect A – Highway 49 corner', kind: 'prospect', area: 'Growing suburb on the state highway', status: 'pursuing', aadt: 26_500, visibility: 5, access: 4,
    competitors: [{ name: 'Branded station', brand: 'Major brand', distanceMi: 2.4, priceCpg: 302, amenities: 'Car wash, hot food' }, { name: 'Grocery fuel center', brand: 'Grocer', distanceMi: 3.0, priceCpg: 295, amenities: 'Loyalty discount' }],
    population: 16_800, growthBps: 210, trucksPerDay: 650, zoning: 'permitted', environmental: 'clean', utilities: 'all', medianIncome: c(74_000), note: 'Signalized corner; 2.6 acres; seller will carve out a pad.',
  });
  site({
    name: 'Prospect B – Old Mill Road', kind: 'prospect', area: 'County road, declining corridor', status: 'reviewing', aadt: 6_200, visibility: 2, access: 2,
    competitors: [{ name: 'Independent store', brand: 'Unbranded', distanceMi: 0.6, priceCpg: 279, amenities: 'None' }, { name: 'Branded station', brand: 'Regional brand', distanceMi: 1.2, priceCpg: 284, amenities: 'Deli' }, { name: 'Dollar store fuel', brand: 'Unbranded', distanceMi: 1.9, priceCpg: 281, amenities: 'None' }],
    population: 4_100, growthBps: -30, trucksPerDay: 70, zoning: 'rezoning', environmental: 'recs', utilities: 'partial', medianIncome: c(39_000), note: 'Former station on the parcel; needs rezoning and a sewer extension.',
  });

  // HM19-style build on Prospect A, and a lease of an existing building as the alternative.
  setClock('2026-10-20');
  const ramp = [55, 62, 68, 73, 78, 82, 86, 89, 92, 95, 97, 99];
  const ops: ProFormaInputs = {
    gallons: 90_000, cpg: 32, retailCpg: 300, insideSales: c(130_000), insideMarginPct: 33, kitchenSales: c(30_000), foodCostPct: 38, otherIncome: c(2_000),
    labor: c(30_000), occupancy: 0, utilities: c(5_500), cardFeePct: 2, repairs: c(2_000), insurance: c(2_200), propertyTax: c(1_800), otherExpense: c(3_000), ramp, growthBps: 200,
  };
  const build = saveProForma(books, cfo, {
    name: 'HM19 build – Prospect A', mode: 'build', siteId: strong.id, monthsToOpen: 14, inputs: ops,
    capital: [
      { label: 'Land (2.6 acres)', kind: 'land', amount: c(600_000) }, { label: 'Building, canopy and site work', kind: 'construction', amount: c(1_750_000) },
      { label: 'Tanks, dispensers and kitchen equipment', kind: 'equipment', amount: c(420_000) }, { label: 'POS and back office', kind: 'pos', amount: c(55_000) },
      { label: 'Signage and price sign', kind: 'signage', amount: c(85_000) }, { label: 'Opening inventory', kind: 'inventory', amount: c(110_000) },
      { label: 'Working capital', kind: 'working_capital', amount: c(75_000) }, { label: 'Opening costs and training', kind: 'opening', amount: c(60_000) },
    ],
    incentives: [{ label: 'Brand image incentive', kind: 'upfront', amount: c(100_000) }, { label: 'Supplier volume rebate', kind: 'cpg', amount: 0, cpg: 2, months: 36 }],
    financing: { loanAmount: c(2_400_000), rateBps: 700, termMonths: 120, amortizationMonths: 240 },
    realEstateValue: c(2_350_000), appreciationBps: 200, overrunPct: 12,
    risks: ['Permits and utility taps can push the opening date', 'Ramp depends on the new subdivision filling in'],
    note: 'Illustrative: stabilized volumes between HM11 and HM15.',
  });
  saveProForma(books, cfo, {
    name: 'Prospect A area – lease an existing building', mode: 'lease', siteId: strong.id, monthsToOpen: 5,
    inputs: { ...ops, gallons: 70_000, insideSales: c(105_000), kitchenSales: c(18_000), occupancy: c(13_000), propertyTax: 0, labor: c(27_000) },
    capital: [
      { label: 'Tenant improvements and kitchen', kind: 'construction', amount: c(320_000) }, { label: 'Dispensers and equipment', kind: 'equipment', amount: c(260_000) },
      { label: 'POS and back office', kind: 'pos', amount: c(55_000) }, { label: 'Signage', kind: 'signage', amount: c(60_000) }, { label: 'Opening inventory', kind: 'inventory', amount: c(95_000) },
      { label: 'Working capital', kind: 'working_capital', amount: c(60_000) }, { label: 'Opening costs and training', kind: 'opening', amount: c(45_000) },
    ],
    incentives: [{ label: 'Supplier volume rebate', kind: 'cpg', amount: 0, cpg: 2, months: 36 }],
    financing: { loanAmount: c(600_000), rateBps: 800, termMonths: 84, amortizationMonths: 84 },
    realEstateValue: 0, appreciationBps: 0, overrunPct: 0,
    risks: ['Ten-year lease with two five-year renewals; rent steps 2% a year after year 5 (not modeled)', 'Older tanks: landlord keeps UST liability'],
  });
  saveGrowthSettings(books, cfo, { dealProFormaId: build.id, managerReady: true, managerNote: 'HM13 store manager, cross-trained at the HM17 opening' });

  // One acquisition target, diligence partly done.
  setClock('2026-11-02');
  const doc = (id: string, name: string, at: string): Attachment => ({ id, name, mime: 'application/pdf', size: 240_000, addedAt: at + 'T15:00:00.000Z', addedBy: cfo.id });
  const dd: DdItem[] = [
    { id: 'dd1', area: 'phase1', title: 'Phase I environmental site assessment', status: 'done', owner: 'Environmental consultant', due: '2026-11-10', note: 'Two RECs: the former tank pit and the old dispenser island.', attachments: [doc('att_dd_phase1', 'Target C Phase I ESA (demo).pdf', '2026-11-09')] },
    { id: 'dd2', area: 'phase2', title: 'Phase II sampling at the two RECs', status: 'in_progress', owner: 'Environmental consultant', due: '2026-12-10', attachments: [] },
    { id: 'dd3', area: 'ust', title: 'UST registration, tank and line tests, release history', status: 'in_progress', owner: 'CFO', due: '2026-12-01', attachments: [] },
    { id: 'dd4', area: 'title', title: 'Title commitment, survey and easements', status: 'done', owner: 'Closing attorney', due: '2026-11-15', attachments: [doc('att_dd_title', 'Target C title commitment (demo).pdf', '2026-11-13')] },
    { id: 'dd5', area: 'permits', title: 'Permits and licenses transfer (beer, tobacco, food, fire)', status: 'not_started', owner: 'Bookkeeper', due: '2026-12-15', attachments: [] },
    { id: 'dd6', area: 'supply', title: 'Fuel supply contract: term, volume commitments, rebranding costs', status: 'in_progress', owner: 'CFO', due: '2026-11-20', note: 'Asked the supplier for the debranding cost if we switch.', attachments: [] },
  ];
  saveAcquisition(books, cfo, {
    name: 'Target C – Riverside food mart', area: 'River crossing on the US highway', status: 'diligence', askingPrice: c(2_200_000), offerPrice: c(1_850_000),
    sellerPnl: [
      { label: 'Fuel sales', section: 'revenue', amount: c(4_500_000) }, { label: 'Inside sales', section: 'revenue', amount: c(1_500_000) }, { label: 'Other income (ATM, lottery)', section: 'revenue', amount: c(30_000) },
      { label: 'Fuel cost', section: 'cogs', amount: c(4_125_000) }, { label: 'Inside cost of goods', section: 'cogs', amount: c(1_020_000) },
      { label: 'Payroll', section: 'expense', amount: c(300_000) }, { label: 'Utilities', section: 'expense', amount: c(55_000) }, { label: 'Repairs', section: 'expense', amount: c(22_000) },
      { label: 'Insurance', section: 'expense', amount: c(26_000) }, { label: 'Property tax', section: 'expense', amount: c(18_000) }, { label: 'Card fees', section: 'expense', amount: c(120_000) },
      { label: 'Owner salary', section: 'expense', amount: c(95_000) }, { label: 'Owner vehicle and phone', section: 'expense', amount: c(16_000) }, { label: 'Depreciation', section: 'expense', amount: c(70_000) },
      { label: 'Interest', section: 'expense', amount: c(52_000) }, { label: 'Other', section: 'expense', amount: c(35_000) },
    ],
    addBacks: [
      { label: 'Depreciation', kind: 'addback', amount: c(70_000) }, { label: 'Interest on the seller\'s loan', kind: 'addback', amount: c(52_000) },
      { label: 'One-time tank repair', kind: 'addback', amount: c(18_000), note: 'Invoice seen; not recurring.' },
      { label: 'Owner salary', kind: 'perk', amount: c(95_000) }, { label: 'Owner vehicle and phone', kind: 'perk', amount: c(16_000) },
      { label: 'Market-rate store manager', kind: 'normalize', amount: c(58_000), note: 'Replaces the owner working the store.' },
      { label: 'Insurance at our program rates', kind: 'normalize', amount: c(8_000) },
    ],
    sellerGallons: 1_500_000,
    gallonChecks: [{ period: '2026-07', seller: 125_000, supplier: 120_500 }, { period: '2026-08', seller: 128_000, supplier: 123_100 }, { period: '2026-09', seller: 122_000, supplier: 121_200 }, { period: '2026-10', seller: 126_000, supplier: 120_800 }],
    realEstateValue: c(1_500_000), marketRent: c(110_000), insideInventoryAtCost: c(140_000), fuelGallonsInTank: 18_000, fuelCostCpg: 265,
    qoe: DEFAULT_QOE.map((q, i) => ({ ...q, done: i < 4, note: i === 1 ? 'Seller gallons run about 4% above the supplier statements in three of four months.' : undefined })),
    dd, financing: { loanAmount: c(1_400_000), rateBps: 700, termMonths: 120, amortizationMonths: 300 },
    note: 'Seller retiring. LOI signed 28 Oct; 60-day diligence period.',
  });

  // Capital projects competing for cash.
  saveProject(books, cfo, { name: 'Next store: HM19 build', kind: 'next_store', cost: c(655_000), annualReturn: 0, risk: 'high', strategic: 5, start: '2027-03-01', status: 'idea', proFormaId: build.id, note: 'Equity for the build; the pro forma sets the return.' });
  saveProject(books, cfo, { name: 'HM13 kitchen upgrade', kind: 'kitchen', storeId: 'st_hm13', cost: c(85_000), annualReturn: c(26_000), risk: 'medium', strategic: 3, start: '2027-03-15', status: 'approved', note: 'New fryers, hood and a hot case; contractor quote.' });
  saveProject(books, cfo, { name: 'HM15 express car wash', kind: 'car_wash', storeId: 'st_hm15', cost: c(420_000), annualReturn: c(95_000), risk: 'high', strategic: 4, status: 'idea', note: 'Tunnel wash on the truck-lane side; needs a site plan.' });
  saveProject(books, cfo, { name: 'HM11 EV chargers (2 DC fast)', kind: 'ev', storeId: 'st_hm11', cost: c(160_000), annualReturn: c(14_000), risk: 'high', strategic: 2, status: 'idea', note: 'Grant covers part; utility make-ready not priced yet.' });

  // HM17's ramp targets from its opening pro forma, and fix plans for stores below break-even.
  saveRampPlan(books, cfo, {
    storeId: 'st_hm17', targets: [
      ['2026-11', 26_000, 42_000, 0], ['2026-12', 29_000, 46_000, 1_500], ['2027-01', 31_000, 48_000, 3_000], ['2027-02', 33_000, 50_000, 4_000],
      ['2027-03', 35_000, 53_000, 5_500], ['2027-04', 37_000, 55_000, 6_500], ['2027-05', 38_000, 57_000, 7_500], ['2027-06', 39_000, 58_000, 8_000],
    ].map(([period, gallons, inside, ebitda]) => ({ period: period as string, gallons: gallons as number, insideSales: c(inside as number), ebitda: c(ebitda as number) })),
  });
  setClock('2026-11-06');
  addFixPlan(books, cfo, { storeId: 'st_hm15', text: 'Raise diesel margin 2¢ on the truck lane, cut kitchen overtime, and renegotiate the Mudflap discount; review in January.' });
  addFixPlan(books, cfo, { storeId: 'st_hm11', text: 'Tighten fuel pricing against the branded competitor and move two kitchen shifts to part time; owner: store manager, by 31 Dec.' });

  // Distributions before these books, and November's distributions (60 / 40, as owned).
  setPriorDistributions(books, cfo, { partyId: 'pt_owner_a', year: 2026, ytd: c(36_000), lifetime: c(410_000), through: '2026-08-31' });
  setPriorDistributions(books, cfo, { partyId: 'pt_owner_b', year: 2026, ytd: c(24_000), lifetime: c(275_000), through: '2026-08-31' });
  setClock('2026-11-20');
  recordDistribution(books, cfo, { date: '2026-11-20', partyId: 'pt_owner_a', amount: c(12_000), note: 'Q4 distribution approved by the owners.' });
  recordDistribution(books, cfo, { date: '2026-11-20', partyId: 'pt_owner_b', amount: c(8_000), note: 'Q4 distribution approved by the owners.' });

  // Quarterly valuations: two from the prior system, Q3 from these books.
  const entered = (quarter: string, date: string, ebitda: number, re: number, debt: number, low: number, mid: number, high: number) => saveValuationSnapshot(books, cfo, date, {
    entered: { quarter, date, ebitda: c(ebitda), annualized: false, multipleLow: 400, multipleHigh: 600, gallons: 0, perGallonLow: 60, perGallonHigh: 110, realEstate: c(re), debt: c(debt), equityLow: c(low), equityMid: c(mid), equityHigh: c(high), note: 'Entered from the prior system’s quarterly pack.' },
  });
  setClock('2026-10-07');
  entered('2026-Q1', '2026-03-31', 1_050_000, 11_400_000, 8_950_000, 6_650_000, 7_700_000, 8_750_000);
  entered('2026-Q2', '2026-06-30', 1_120_000, 11_500_000, 8_870_000, 7_110_000, 8_230_000, 9_350_000);
  saveValuationSnapshot(books, cfo, '2026-09-30', { note: 'First quarter on these books: September only, annualized.' });

  // The scorecard, recorded monthly.
  setClock('2026-10-08');
  recordScorecard(books, cfo, '2026-10-08');
  setClock('2026-11-09');
  recordScorecard(books, cfo, '2026-11-09');
}
