import type { Attachment, ID } from './types';
import type { Cents } from './money';

// ── Fixed assets, prepaids & loans (phase 9) ────────────────────────────
export type AssetClass = 'dispensers' | 'canopy' | 'tanks' | 'coolers' | 'kitchen' | 'pos' | 'equipment' | 'fixtures' | 'building_improvements' | 'building' | 'land';

/** Room for the Phase 11 tax schedule alongside book depreciation. */
export interface TaxDepreciation {
  method: 'macrs' | 'section_179' | 'bonus' | 'straight_line' | 'none';
  recoveryYears?: number;
  convention?: 'half_year' | 'mid_quarter' | 'mid_month';
  section179?: Cents;
  bonusPct?: number;
  costSegFlag?: boolean;
  /** Phase 11: qualified improvement property (15-year, bonus-eligible). */
  qip?: boolean;
  notes?: string;
}

export interface FixedAsset {
  id: ID;
  /** Human tag: FA-0001 */
  tag: string;
  name: string;
  class: AssetClass;
  storeId: ID;
  costAccountId: ID;
  cost: Cents;
  salvage: Cents;
  /** Book depreciation starts in the month placed in service (full-month convention). */
  inService: string;
  lifeMonths: number;
  method: 'straight_line' | 'none';
  vendor?: string;
  serial?: string;
  warrantyEnds?: string;
  notes?: string;
  attachments: Attachment[];
  /** Period → the depreciation entry that carried this asset's month. */
  posted: Record<string, ID>;
  /** The entry that put the cost on the books, when it was bought inside these books. */
  purchaseTxnId?: ID;
  disposal?: { date: string; proceeds: Cents; reason: string; txnId: ID; gainLoss: Cents; by: ID; at: string };
  /** Phase 11 adds the tax schedule here; book and tax sit side by side. */
  tax?: TaxDepreciation;
}

export interface MaintenanceEntry {
  id: ID;
  assetId?: ID;
  storeId: ID;
  date: string;
  kind: 'repair' | 'service' | 'inspection' | 'calibration';
  description: string;
  vendor?: string;
  cost?: Cents;
  /** The payment or bill entry for this work. */
  txnId?: ID;
  /** When the next service or inspection is due. */
  nextDue?: string;
  by: ID;
  attachments: Attachment[];
}

export type PrepaidKind = 'insurance' | 'property_tax' | 'annual_fee' | 'license' | 'other';

/** A prepaid cost spread evenly over its months (SPEC §6.10): 1400 Prepaid → expense on each month's last day. */
export interface PrepaidSchedule {
  id: ID;
  label: string;
  kind: PrepaidKind;
  storeId: ID;
  expenseAccountId: ID;
  prepaidAccountId: ID;
  amount: Cents;
  /** First month covered, YYYY-MM. */
  startPeriod: string;
  months: number;
  /** Months through this one (YYYY-MM) were amortized before these books began; they are already out of the opening balance. */
  amortizedThrough?: string;
  /** The payment that put it in 1400, when it was paid inside these books. */
  paidTxnId?: ID;
  policyId?: ID;
  posted: Record<string, ID>;
  active: boolean;
}

export type LoanKind = 'mortgage' | 'equipment_note' | 'line_of_credit' | 'term_loan';

export interface Loan {
  id: ID;
  name: string;
  kind: LoanKind;
  lender: string;
  /** The lender as a party: loan lines carry it so the lender's ledger and the party tie-outs work. */
  lenderPartyId?: ID;
  /** company: on our books and paid by us. related_party: carried by a related party, shown for information only. */
  heldBy: 'company' | 'related_party';
  holderPartyId?: ID;
  storeId: ID;
  liabilityAccountId?: ID;
  interestAccountId: ID;
  payFromAccountId: ID;
  original: Cents;
  /** Annual rate in basis points (725 = 7.25%). */
  rateBps: number;
  rateType: 'fixed' | 'variable';
  index?: string;
  marginBps?: number;
  termMonths: number;
  amortizationMonths: number;
  /** Scheduled monthly payment (a line of credit pays interest only). */
  payment: Cents;
  interestOnly?: boolean;
  creditLimit?: Cents;
  start: string;
  firstPayment: string;
  maturity: string;
  collateral: string;
  guarantor: string;
  prepaymentPenalty: string;
  /** Just a list for now; Phase 12 builds the covenant monitor on top. */
  covenants: string[];
  /** Payments before this date are already in the opening balance. */
  booksFrom?: string;
  openingTxnId?: ID;
  /** Line of credit: draws (+) and paydowns (−). */
  draws: { date: string; amount: Cents; txnId?: ID }[];
  /** Due date → the payment entry. */
  payments: Record<string, { txnId: ID; principal: Cents; interest: Cents; date: string }>;
  notes?: string;
  attachments: Attachment[];
}

export interface AssetsState {
  assets: FixedAsset[];
  maintenance: MaintenanceEntry[];
  prepaids: PrepaidSchedule[];
  loans: Loan[];
  /** Book depreciation is posted in these books from this month (earlier months are in the opening balance). */
  depreciationFrom?: string;
}
