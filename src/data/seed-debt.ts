import type { SeedCtx } from './seed';
import type { LoanKind } from '../core/types';
import { acknowledgeBalance, addMarketRate, addPropertyValue, ensureDebt, saveAlternative, saveCovenant, saveDebtSettings, saveRpTerms, saveScenario } from '../core/debt';

const c = (dollars: number) => Math.round(dollars * 100);

/**
 * Phase 12 demo: market rates, property values, covenants, a refinance scenario, investment alternatives, the reserve
 * policy and related-party loan terms. Nothing here posts to the ledger: it is information about loans that already
 * exist (Phase 9) and balances the books already hold. Illustrative figures only.
 */
export function seedDebt({ books, cfo, setClock }: SeedCtx): void {
  ensureDebt(books);
  setClock('2026-09-02');
  saveDebtSettings(books, cfo, {
    nextStoreEquity: c(250_000),
    reserve: { weeksFixed: 4, lookbackMonths: 3, fuelLoad: true, payroll: true, cushion: c(10_000), cashSubtypes: ['bank', 'cash', 'clearing'] },
  });

  // Covenants: the equipment note's DSCR and leverage, the line of credit's DSCR, fixed-charge coverage and minimum liquidity.
  const cov = (loanId: string, kind: 'dscr' | 'leverage' | 'min_liquidity' | 'fcc', threshold: number, text: string) => saveCovenant(books, cfo, { loanId, kind, threshold, text, active: true });
  cov('loan_hm15_equip', 'dscr', 125, 'Debt service coverage of at least 1.25x, trailing twelve months, tested quarterly');
  cov('loan_hm15_equip', 'leverage', 300, 'Funded debt no more than 3.0x EBITDA');
  cov('loan_loc', 'dscr', 125, 'Debt service coverage of at least 1.25x, tested annually');
  cov('loan_loc', 'fcc', 115, 'Fixed-charge coverage (EBITDAR ÷ debt service + rent) of at least 1.15x');
  cov('loan_loc', 'min_liquidity', c(30_000), 'Minimum liquidity of $30,000 in the operating account at all times');

  // Market rate history: a quote a month for each kind of loan we carry.
  const rate = (date: string, kind: LoanKind, rateType: 'fixed' | 'variable', pct: number, termMonths: number, source: string) => {
    setClock(date);
    addMarketRate(books, cfo, { date, kind, rateType, rateBps: Math.round(pct * 100), termMonths, source });
  };
  for (const [date, eq, mtg, term, loc] of [['2026-09-15', 7.1, 6.4, 7.9, 8.5], ['2026-10-15', 6.9, 6.1, 7.75, 8.5], ['2026-11-16', 6.5, 5.5, 7.6, 8.5]] as const) {
    rate(date, 'equipment_note', 'fixed', eq, 48, 'Equipment lender quote (demo)');
    rate(date, 'mortgage', 'fixed', mtg, 120, 'Community bank term sheet (demo)');
    rate(date, 'term_loan', 'fixed', term, 60, 'Operating bank quote (demo)');
    rate(date, 'line_of_credit', 'variable', loc, 24, 'Prime + 1.00% (demo)');
  }

  // Property values behind the store mortgages (carried by the related parties).
  const val = (storeId: string, date: string, dollars: number, source: string) => { setClock(date > '2026-08-31' ? date : '2026-09-02'); addPropertyValue(books, cfo, { storeId, date, value: c(dollars), source }); };
  val('st_hm11', '2024-06-20', 4_000_000, 'Lender appraisal');
  val('st_hm11', '2026-10-05', 4_100_000, 'Broker opinion of value');
  val('st_hm13', '2021-02-15', 1_900_000, 'Lender appraisal');
  val('st_hm13', '2025-12-01', 1_700_000, 'Broker opinion of value');
  val('st_hm15', '2021-12-10', 5_800_000, 'Lender appraisal');
  val('st_hm15', '2026-11-10', 6_400_000, 'Broker opinion of value');

  // One saved refinance scenario: the HM13 mortgage at the November fixed quote.
  setClock('2026-11-18');
  saveScenario(books, cfo, {
    name: 'HM13 mortgage: 10-year fixed at 5.50%', loanId: 'loan_mtg_hm13', rateBps: 550, termMonths: 120, amortizationMonths: 172,
    fees: c(12_500), prepaymentPenalty: 0, cashOut: 0, rollInCosts: false, note: 'Community bank term sheet; the related party would refinance and the rent pass-through would fall with the payment.',
  });

  // Where deployable cash could go instead of paying down debt.
  const alt = (name: string, kind: 'new_store' | 'equipment' | 'inventory' | 'cash_reserve', amount: number, pct: number, note: string) => saveAlternative(books, cfo, { name, kind, amount: c(amount), returnBps: Math.round(pct * 100), taxable: true, note });
  alt('Next store fund (site under review)', 'new_store', 250_000, 18, 'Equity for the next store; expected cash-on-cash return.');
  alt('HM13 cooler and LED upgrade', 'equipment', 40_000, 14, 'Energy and shrink savings per the contractor quote.');
  alt('Holiday inside inventory build', 'inventory', 25_000, 10, 'Deal buys on beverages and tobacco ahead of price increases.');
  alt('Reserve money market', 'cash_reserve', 100_000, 4.25, 'Operating bank money market sweep.');

  // Related-party loan terms. Southern Eagle borrows interest free (flags imputed interest); Bullseye pays 8%.
  setClock('2026-10-06');
  const se = saveRpTerms(books, cfo, { partyId: 'pt_southern_eagle', direction: 'lent', accountId: 'acct_loans_related', rateBps: 0, schedule: 'On demand; no fixed repayment schedule', start: '2026-10-06', documented: true, note: 'Demand note signed by both owners.' });
  setClock('2026-10-02');
  const be = saveRpTerms(books, cfo, { partyId: 'pt_bullseye', direction: 'lent', accountId: 'acct_loans_related', rateBps: 800, schedule: 'Monthly $2,000 from November 2026', monthlyPayment: c(2_000), start: '2026-10-02', maturity: '2027-02-28', documented: true, note: 'Short-term working capital loan.' });
  setClock('2026-11-06');
  acknowledgeBalance(books, cfo, { termsId: se.id, period: '2026-10', confirmedBalance: c(15_000), confirmedBy: 'Southern Eagle bookkeeper (demo)' });
  acknowledgeBalance(books, cfo, { termsId: be.id, period: '2026-10', confirmedBalance: c(8_000), confirmedBy: 'Bullseye owner (demo)' });
}
