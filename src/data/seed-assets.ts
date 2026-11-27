import type { SeedCtx } from './seed';
import type { AssetClass, AssetsState, FixedAsset, Loan } from '../core/types';
import { emptyAssets, logMaintenance } from '../core/assets';
import { savePrepaid, amortizePrepaids } from '../core/prepaids';
import { saveLoan, postLoanOpening, postLoanPayment, recordDraw } from '../core/loans';

const c = (dollars: number) => Math.round(dollars * 100);

/**
 * The demo asset register. Costs add to the opening fixed-asset balances (1500/1510) by store, and the straight-line
 * schedules reproduce the opening accumulated depreciation ($96,000 at each older store on 31 Aug 2026) and the
 * monthly depreciation the demo has always booked (HM11 $2,600, HM13 $2,100, HM15 $2,950). HM17 opened 1 Nov 2026,
 * so its first month posts on 30 Nov. Illustrative figures only.
 */
export function assetRegister(): AssetsState {
  let n = 0;
  const a = (store: string, key: string, name: string, cls: AssetClass, cost: number, salvage: number, life: number, inService: string, extra: Partial<FixedAsset> = {}): FixedAsset => {
    n += 1;
    return {
      id: `fa_${store}_${key}`, tag: 'FA-' + String(n).padStart(4, '0'), name, class: cls, storeId: `st_${store}`, costAccountId: 'acct_equipment',
      cost: c(cost), salvage: c(salvage), lifeMonths: life, inService, method: 'straight_line', attachments: [], posted: {}, ...extra,
    };
  };
  const assets: FixedAsset[] = [
    a('hm11', 'disp', 'Dispensers 1–4 (MPD)', 'dispensers', 108_000, 0, 120, '2023-05-01', { vendor: 'Petroleum equipment repair', warrantyEnds: '2026-05-01' }),
    a('hm11', 'canopy', 'Canopy & LED lighting', 'canopy', 72_000, 0, 180, '2021-09-01'),
    a('hm11', 'ust', 'Tanks & piping (UST)', 'tanks', 63_000, 0, 180, '2021-09-01'),
    a('hm11', 'cooler', 'Walk-in cooler & reach-ins', 'coolers', 39_000, 1_200, 84, '2025-01-01', { warrantyEnds: '2027-01-01' }),
    a('hm11', 'kitchen', 'Kitchen smoker & fryers', 'kitchen', 20_800, 2_800, 60, '2025-11-01', { warrantyEnds: '2026-11-01' }),
    a('hm11', 'pos', 'POS registers & cameras', 'pos', 7_200, 0, 36, '2025-06-01'),
    a('hm13', 'disp', 'Dispensers 1–4 (MPD)', 'dispensers', 106_000, 10_000, 120, '2022-07-01'),
    a('hm13', 'canopy', 'Canopy & lighting', 'canopy', 80_000, 8_000, 180, '2021-09-01'),
    a('hm13', 'ust', 'Tanks & piping (UST)', 'tanks', 72_000, 0, 240, '2021-09-01'),
    a('hm13', 'cooler', 'Coolers & ice merchandiser', 'coolers', 32_000, 2_600, 84, '2024-03-01'),
    a('hm13', 'kitchen', 'Kitchen hood & fryers', 'kitchen', 20_000, 5_000, 60, '2025-07-01'),
    a('hm15', 'disp', 'Dispensers 1–6 (car side)', 'dispensers', 84_000, 0, 120, '2022-09-01'),
    a('hm15', 'truck', 'Truck-lane diesel dispensers & DEF', 'dispensers', 84_000, 0, 120, '2025-03-01', { warrantyEnds: '2026-12-15', notes: 'Financed by the equipment note.' }),
    a('hm15', 'canopy', 'Canopies (car & truck)', 'canopy', 72_000, 0, 180, '2021-09-01'),
    a('hm15', 'cooler', 'Walk-in cooler & beer cave', 'coolers', 37_800, 0, 84, '2023-09-01'),
    a('hm15', 'kitchen', 'Kitchen equipment', 'kitchen', 25_000, 1_000, 60, '2025-06-01'),
    a('hm15', 'pos', 'POS & truck-lane card readers', 'pos', 7_200, 0, 24, '2025-09-01'),
    a('hm17', 'disp', 'Dispensers 1–4 (MPD)', 'dispensers', 96_000, 0, 120, '2026-11-01', { warrantyEnds: '2027-11-01' }),
    a('hm17', 'canopy', 'Canopy & lighting', 'canopy', 81_000, 0, 180, '2026-11-01'),
    a('hm17', 'ust', 'Tanks & piping (UST)', 'tanks', 60_000, 0, 240, '2026-11-01'),
    a('hm17', 'cooler', 'Coolers', 'coolers', 25_200, 0, 84, '2026-11-01', { warrantyEnds: '2027-11-01' }),
    a('hm17', 'pos', 'POS & cameras', 'pos', 7_200, 0, 36, '2026-11-01'),
    a('hm17', 'fixtures', 'Shelving & store fixtures', 'fixtures', 10_600, 1_000, 96, '2026-11-01'),
    a('hm14', 'bldg', 'Gulfport land & building (leased out)', 'building', 640_000, 0, 0, '2018-01-01', {
      costAccountId: 'acct_buildings', method: 'none', notes: 'Land and building not yet split (cost segregation pending), so no book depreciation is posted yet.',
    }),
  ];
  return { ...emptyAssets(), assets, depreciationFrom: '2026-09' };
}

function loanBase(x: Partial<Loan> & Pick<Loan, 'id' | 'name' | 'kind' | 'lender' | 'heldBy' | 'storeId' | 'original' | 'rateBps' | 'termMonths' | 'amortizationMonths' | 'payment' | 'start' | 'firstPayment' | 'maturity'>) {
  return {
    rateType: 'fixed' as const, interestAccountId: 'acct_interest', payFromAccountId: 'acct_trustmark', collateral: '', guarantor: '', prepaymentPenalty: 'None', covenants: [], ...x,
  };
}

/** Prepaids, maintenance and loans. Runs after the main loop (which posted depreciation from the register). */
export function seedAssets({ state, books, cfo, setClock }: SeedCtx): void {
  // ── Prepaids: the opening 1400 balance ($18,400 at Corporate) is these four schedules' unamortized months.
  setClock('2026-09-01');
  const pp = (id: string, label: string, kind: 'insurance' | 'property_tax' | 'annual_fee' | 'license', expenseAccountId: string, amount: number, startPeriod: string, policyId?: string) =>
    savePrepaid(books, cfo, { id, label, kind, storeId: 'st_corp', expenseAccountId, amount: c(amount), startPeriod, months: 12, amortizedThrough: '2026-08', active: true, policyId });
  pp('ppd_umbrella', 'Umbrella liability policy 2026–27', 'insurance', 'acct_insurance', 14_400, '2026-05', 'pol_umbrella');
  pp('ppd_proptax', 'Property tax 2026 (all stores)', 'property_tax', 'acct_property_tax', 7_200, '2026-01');
  pp('ppd_fees', 'Annual reports & registered agent 2026', 'annual_fee', 'acct_licenses', 2_400, '2026-01');
  pp('ppd_pollution', 'Pollution / UST liability policy 2026–27', 'insurance', 'acct_insurance', 6_720, '2026-07', 'pol_pollution');
  setClock('2026-11-03');
  savePrepaid(books, cfo, { id: 'ppd_hm17_permits', label: 'HM17 beer & tobacco permits (annual)', kind: 'license', storeId: 'st_hm17', expenseAccountId: 'acct_licenses', amount: c(1_200), startPeriod: '2026-11', months: 12, active: true }, { date: '2026-11-03' });
  for (const p of ['2026-09', '2026-10']) { setClock(p === '2026-09' ? '2026-09-30' : '2026-10-31'); amortizePrepaids(books, cfo, p); }

  // ── Maintenance: each dispenser repair the demo paid is logged against the store's dispensers, plus inspections.
  const repairs = state.transactions.filter((t) => !t.deleted && t.description.startsWith('DISPENSER REPAIR '));
  for (const t of repairs) {
    const line = t.lines.find((l) => l.accountId === 'acct_repairs')!;
    const store = line.storeId.replace('st_', '');
    setClock(t.date);
    logMaintenance(books, cfo, { assetId: `fa_${store}_disp`, storeId: line.storeId, date: t.date, kind: 'repair', description: 'Dispenser repair: meter, nozzle and hose', vendor: 'Petroleum equipment repair', cost: line.debit, txnId: t.id });
  }
  const m = (assetId: string | undefined, storeId: string, date: string, kind: 'service' | 'inspection' | 'calibration', description: string, nextDue: string, cost?: number) => {
    setClock(date);
    logMaintenance(books, cfo, { assetId, storeId, date, kind, description, vendor: 'Service contractor (demo)', cost: cost === undefined ? undefined : c(cost), nextDue });
  };
  m('fa_hm13_ust', 'st_hm13', '2026-09-10', 'inspection', 'Annual line leak detector and tank tightness test', '2026-12-10');
  m('fa_hm11_kitchen', 'st_hm11', '2026-09-05', 'inspection', 'Hood and fire-suppression inspection (semiannual)', '2027-03-05');
  m('fa_hm15_truck', 'st_hm15', '2026-09-20', 'calibration', 'Diesel meter calibration (weights & measures)', '2026-11-20');
  m('fa_hm11_cooler', 'st_hm11', '2026-10-14', 'service', 'Walk-in compressor service and coil cleaning', '2027-04-14');

  // ── Loans.
  // HM15 equipment note: financed the truck-lane dispensers in March 2025; brought onto the books at its 31 Aug 2026 balance.
  state.parties.push({ id: 'pt_equip_finance', name: 'Equipment finance co. (demo)', type: 'lender', notes: 'HM15 truck-lane equipment note.' });
  setClock('2026-08-31');
  const note = saveLoan(books, cfo, loanBase({
    id: 'loan_hm15_equip', name: 'HM15 truck-lane equipment note', kind: 'equipment_note', lender: 'Equipment finance co. (demo)', lenderPartyId: 'pt_equip_finance', heldBy: 'company',
    storeId: 'st_hm15', liabilityAccountId: 'acct_notes_equipment', original: c(80_000), rateBps: 725, termMonths: 60, amortizationMonths: 60, payment: c(1_593.55),
    start: '2025-03-01', firstPayment: '2025-04-01', maturity: '2030-03-01', collateral: 'HM15 truck-lane diesel dispensers and DEF system (FA-0013)', guarantor: 'Owner A and Owner B (personal guarantees)',
    prepaymentPenalty: '2% of principal prepaid in the first three years', covenants: ['Annual financial statements within 120 days of year end', 'Keep the equipment insured with the lender as loss payee'],
  }));
  postLoanOpening(books, cfo, note.id, { date: '2026-08-31' });
  // Corporate line of credit with Trustmark: variable, interest only, monthly on the 25th.
  setClock('2026-09-01');
  const loc = saveLoan(books, cfo, loanBase({
    id: 'loan_loc', name: 'Corporate line of credit', kind: 'line_of_credit', lender: 'Trustmark', lenderPartyId: 'pt_trustmark', heldBy: 'company', storeId: 'st_corp',
    liabilityAccountId: 'acct_loc', original: c(75_000), creditLimit: c(75_000), rateType: 'variable', index: 'Prime', marginBps: 100, rateBps: 850, interestOnly: true,
    termMonths: 24, amortizationMonths: 0, payment: 0, start: '2025-06-30', firstPayment: '2026-09-25', maturity: '2027-06-30', booksFrom: '2026-09-01',
    collateral: 'Blanket lien on inventory and receivables', guarantor: 'Owner A and Owner B', prepaymentPenalty: 'None',
    covenants: ['Minimum liquidity of $30,000 in the operating account', 'Annual clean-up: balance at zero for 30 consecutive days', 'Debt service coverage of at least 1.25x, tested annually'],
  }));
  // Store mortgages are carried by Dhunna Development and SKD Properties and reimbursed through the rent pass-throughs:
  // on our books only as rent, so they are recorded here for information and never post.
  const mortgage = (id: string, store: string, holder: string, lender: string, original: number, rateBps: number, amortMonths: number, termMonths: number, payment: number, start: string, firstPayment: string, maturity: string) =>
    saveLoan(books, cfo, loanBase({
      id, name: `${store} store mortgage`, kind: 'mortgage', lender, heldBy: 'related_party', holderPartyId: holder, storeId: `st_${store.toLowerCase()}`, original: c(original), rateBps,
      termMonths, amortizationMonths: amortMonths, payment: c(payment), start, firstPayment, maturity, collateral: `${store} land and building (first mortgage)`, guarantor: 'Owner A and Owner B',
      prepaymentPenalty: 'Step-down 3/2/1% in years 1–3', covenants: ['Property taxes and insurance kept current', 'Annual rent roll and operating statement to the lender'],
      notes: 'Carried by the related party; reimbursed through the monthly rent pass-through. Information only: nothing posts from here.',
    }));
  mortgage('loan_mtg_hm11', 'HM11', 'pt_dhunna', 'Mortgage bank A (demo)', 4_030_000, 625, 240, 120, 29_500, '2019-06-01', '2019-07-01', '2029-06-01');
  mortgage('loan_mtg_hm13', 'HM13', 'pt_dhunna', 'Mortgage bank A (demo)', 1_500_000, 650, 240, 84, 11_250, '2021-03-01', '2021-04-01', '2028-03-01');
  mortgage('loan_mtg_hm15', 'HM15', 'pt_skd', 'Mortgage bank B (demo)', 4_800_000, 600, 300, 120, 31_000, '2022-01-01', '2022-02-01', '2032-01-01');

  // Payments and draws through the demo period, in date order.
  const events: [string, () => void][] = [
    ['2026-09-01', () => postLoanPayment(books, cfo, note.id, '2026-09-01')],
    ['2026-09-08', () => recordDraw(books, cfo, loc.id, { date: '2026-09-08', amount: c(25_000) })],
    ['2026-09-25', () => postLoanPayment(books, cfo, loc.id, '2026-09-25')],
    ['2026-10-01', () => postLoanPayment(books, cfo, note.id, '2026-10-01')],
    ['2026-10-25', () => postLoanPayment(books, cfo, loc.id, '2026-10-25')],
    ['2026-11-01', () => postLoanPayment(books, cfo, note.id, '2026-11-01')],
    ['2026-11-10', () => recordDraw(books, cfo, loc.id, { date: '2026-11-10', amount: -c(10_000) })],
    ['2026-11-25', () => postLoanPayment(books, cfo, loc.id, '2026-11-25')],
  ];
  for (const [d, fn] of events) { setClock(d); fn(); }
}
