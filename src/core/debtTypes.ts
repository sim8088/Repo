import type { AccountSubtype, Attachment, ID, ReportBasis } from './types';
import type { Cents } from './money';
import type { LoanKind } from './assetTypes';

// ── Debt, treasury & capital structure (phase 12) ───────────────────────
export type CovenantKind = 'dscr' | 'leverage' | 'min_liquidity' | 'fcc';

/** A financial covenant in a loan agreement, tested monthly from the statements. */
export interface Covenant {
  id: ID;
  loanId: ID;
  kind: CovenantKind;
  /**
   * dscr / fcc: the minimum ratio in hundredths (125 = 1.25x). leverage: the maximum debt ÷ EBITDA in hundredths
   * (350 = 3.50x). min_liquidity: the minimum balance in cents.
   */
  threshold: number;
  /** The covenant as the agreement words it. */
  text?: string;
  active: boolean;
}

/** A market rate quote, kept as a small history: the latest one on or before a date is the market. */
export interface MarketRate {
  id: ID;
  date: string;
  kind: LoanKind;
  rateType: 'fixed' | 'variable';
  rateBps: number;
  termMonths?: number;
  source?: string;
}

/** An appraisal, broker opinion or estimate of a store property's value (for LTV). */
export interface PropertyValue {
  id: ID;
  storeId: ID;
  date: string;
  value: Cents;
  source: string;
}

/** A saved refinance scenario: the current loan vs a proposed one. */
export interface RefiScenario {
  id: ID;
  name: string;
  loanId: ID;
  rateBps: number;
  termMonths: number;
  amortizationMonths: number;
  /** Lender, legal, appraisal and title fees. */
  fees: Cents;
  /** The current loan's prepayment penalty, paid at payoff. */
  prepaymentPenalty: Cents;
  /** Extra borrowed on top of the payoff (cash to us at closing). */
  cashOut: Cents;
  /** Fees and penalty financed in the new loan instead of paid in cash. */
  rollInCosts: boolean;
  note?: string;
  createdBy: ID;
  createdAt: string;
}

export type AlternativeKind = 'new_store' | 'equipment' | 'inventory' | 'cash_reserve' | 'other';

/** Somewhere cash could go instead of paying down debt, with its expected return. */
export interface InvestAlternative {
  id: ID;
  name: string;
  kind: AlternativeKind;
  /** How much it can absorb. */
  amount: Cents;
  /** Expected annual return before tax, in basis points. */
  returnBps: number;
  /** Whether the return is taxed (interest on a reserve account is; a saved cost is too). */
  taxable: boolean;
  note?: string;
}

/** Documented terms of a related-party loan, in either direction. */
export interface RelatedPartyTerms {
  id: ID;
  partyId: ID;
  /** lent: we lent to them (an asset, 1910). borrowed: they lent to us (a liability, e.g. 2400). */
  direction: 'lent' | 'borrowed';
  accountId: ID;
  /** Stated annual rate in basis points (0 = interest free). */
  rateBps: number;
  /** Repayment terms as agreed, e.g. "Monthly $1,000 from Dec 2026" or "On demand". */
  schedule: string;
  monthlyPayment?: Cents;
  start: string;
  maturity?: string;
  /** A signed note or written agreement is on file. */
  documented: boolean;
  note?: string;
  attachments: Attachment[];
}

/** A month-end balance agreed with the related party. */
export interface RelatedPartyAck {
  id: ID;
  termsId: ID;
  period: string;
  /** What our books said at the month end. */
  bookBalance: Cents;
  /** What the related party confirmed. */
  confirmedBalance: Cents;
  confirmedBy: string;
  by: ID;
  at: string;
  note?: string;
}

export interface ReservePolicy {
  /** N weeks of fixed costs (from the P&L). */
  weeksFixed: number;
  /** Months of P&L history to average fixed costs over (complete months only). */
  lookbackMonths: number;
  /** Add one typical fuel load per fuel-selling store. */
  fuelLoad: boolean;
  /** Add one week's payroll. */
  payroll: boolean;
  /** A fixed cushion on top. */
  cushion: Cents;
  /** Which balances count as cash on hand for the reserve. */
  cashSubtypes: AccountSubtype[];
}

export interface DebtSettings {
  /** Basis for EBITDA in the covenant tests. */
  ratioBasis: ReportBasis;
  /** Trailing months for the ratios (12 = TTM). */
  ttmMonths: number;
  /** With fewer months on the books than ttmMonths, scale EBITDA and debt service to a year. */
  annualize: boolean;
  /** Test the current month as well (provisional). Off: the latest complete month is the headline. */
  includeCurrentMonth: boolean;
  /** Combined tax rate on pass-through income, in basis points: interest is deductible at this rate. */
  taxRateBps: number;
  /** Discount rate for refinance NPVs, in basis points. */
  costOfCapitalBps: number;
  /** Applicable federal rate for related-party loans, in basis points. */
  afrBps: number;
  /** A covenant within this % of its threshold is "near". */
  nearPct: number;
  /** Forecast a breach this far ahead (2 quarters = 182 days). */
  horizonDays: number;
  /** Company DSCR target when no covenant sets one, in hundredths. */
  dscrTarget: number;
  /** Refinance triggers. */
  refiGapBps: number;
  refiBreakEvenMonths: number;
  refiFeeBps: number;
  ltvTargetPct: number;
  maturityMonths: number;
  /** Equity the next store needs (for months-to-fund). */
  nextStoreEquity: Cents;
  reserve: ReservePolicy;
}

export interface DebtState {
  settings: DebtSettings;
  covenants: Covenant[];
  marketRates: MarketRate[];
  propertyValues: PropertyValue[];
  scenarios: RefiScenario[];
  alternatives: InvestAlternative[];
  rpTerms: RelatedPartyTerms[];
  rpAcks: RelatedPartyAck[];
}
