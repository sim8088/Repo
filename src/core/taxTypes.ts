import type { AssetClass, ID } from './types';
import type { Cents } from './money';

// ── Tax working papers (phase 11) ───────────────────────────────────────
// A working-papers tool, not tax advice: every rate, life and threshold is a configurable table with current-law
// defaults that the CPA should verify. Nothing here files anything.

export type TaxMethod = 'cash' | 'accrual';
export type InventoryMethod = 'fifo' | 'lifo' | 'average' | 'retail' | 'books_471c';

/** One owner's share of an entity, in basis points (6000 = 60%). */
export interface OwnerShare { partyId: ID; pctBps: number }

export interface StateRegistration { state: string; kind: string; accountNo: string }

/** Where a prior year's return is kept: a vault document, or a note on where the paper lives. */
export interface PriorReturn { year: number; docId?: ID; location: string }

/** The tax side of an entity. Its classification and EIN stay on the entity (Setup › Entities). */
export interface EntityTaxProfile {
  entityId: ID;
  owners: OwnerShare[];
  /** Disregarded entities: the entity whose return carries their income (default: the hub). */
  parentEntityId?: ID;
  states: StateRegistration[];
  /** 12 = calendar year. */
  fiscalYearEndMonth: number;
  preparer?: string;
  priorReturns: PriorReturn[];
  method: TaxMethod;
  inventoryMethod: InventoryMethod;
  notes?: string;
}

/** Configurable rates, lives and thresholds. Overrides of DEFAULT_TAX_RATES; every one says "verify with your CPA". */
export interface TaxRates {
  ownerFederalBps: number;
  ownerStateBps: number;
  cCorpBps: number;
  /** Elective pass-through entity tax (state), when an entity pays it. */
  pteBps: number;
  /** Employer + employee FICA on owner salary below the wage base. */
  ficaBps: number;
  salesTaxBps: number;
  /** Inside-store departments whose POS sales are taxable. Fuel is never a department. */
  taxableDeptIds: ID[];
  /** Fuel sales are taxable at retail (default no: fuel excise is collected upstream). */
  fuelTaxable: boolean;
  /** §448(c) gross-receipts test threshold (3-year average). */
  grossReceiptsThreshold: Cents;
  section179Limit: Cents;
  section179Phaseout: Cents;
  bonusPct: number;
  /** Share of meals that is not deductible. */
  mealsDisallowBps: number;
  /** Prior-year AGI above this needs 110% for the safe harbor. */
  safeHarborAgi: Cents;
  /** MACRS recovery period by asset class (0 = not depreciable for tax). */
  macrsYears: Record<AssetClass, number>;
}

export type AdjKind = 'depreciation' | 'meals' | 'penalties' | 'owner' | 'accrual_to_cash' | 'other';
/** Where an adjustment lands on Schedule M-1. */
export type M1Line = 'income_not_booked' | 'expense_not_deducted' | 'income_not_taxed' | 'deduction_not_booked';

/** A book-to-tax adjustment and its workpaper. Auto ones recompute from the books; manual ones carry an amount. */
export interface TaxAdjustment {
  id: ID;
  /** The return the adjustment belongs to (an entity that files). */
  entityId: ID;
  year: number;
  kind: AdjKind;
  label: string;
  mode: 'auto' | 'manual';
  /** Manual: + raises taxable income, − lowers it. */
  amount?: Cents;
  /** Source accounts the auto amount reads (meals 6355, penalties 6360). */
  accountIds?: ID[];
  /** The non-deductible share of the source, in basis points. */
  pctBps?: number;
  /** Manual: where it goes on the M-1. Auto adjustments place themselves by sign. */
  m1Line?: M1Line;
  workpaper: string;
  /** A link to the source: a route in the portal, or a TX-ref. */
  source?: string;
  preparedBy: ID;
  updatedAt: string;
  reviewed?: { by: ID; at: string };
  /** Soft delete (manual adjustments only). */
  removed?: { by: ID; at: string; reason: string };
}

/** Per return and year: book income from before these books began (the prior system), entered. */
export interface TaxYearInput { entityId: ID; year: number; priorIncome: Cents; note?: string }

/** Beginning-of-year amounts per owner and return, entered from last year's K-1. */
export interface OwnerStart {
  entityId: ID;
  partyId: ID;
  year: number;
  basis: Cents;
  capital: Cents;
  contributions: Cents;
}

/** Quarterly estimates for one payer: an owner (personal) or an entity (C corp or elective PTE tax). */
export interface EstimatePlan {
  id: ID;
  payer: 'owner' | 'entity';
  partyId?: ID;
  entityId?: ID;
  jurisdiction: 'federal' | 'state';
  year: number;
  /** Four due dates, configurable. */
  dueDates: string[];
  /** Last year's total tax for this payer and jurisdiction, entered (the safe harbor base). */
  priorYearTax: Cents;
  /** Prior-year AGI over the threshold: the safe harbor is 110%. */
  highIncome: boolean;
  /** Overrides the rate from the tax tables. */
  rateBps?: number;
  /** Returns whose income counts (an owner's share of each). */
  entityIds: ID[];
  /** Tax already covered outside this plan (withholding, other income), entered. */
  otherCredits?: Cents;
  note?: string;
}

export interface EstimatePayment {
  id: ID;
  planId: ID;
  quarter: number;
  date: string;
  amount: Cents;
  /** Paid by an entity (posted through the ledger) or by the owner personally (recorded only). */
  paidBy: 'entity' | 'owner';
  entityId?: ID;
  bankAccountId?: ID;
  txnId?: ID;
  confirmation?: string;
  by: ID;
  at: string;
}

/** Form 3115 accounting-method change tracking. */
export interface MethodChange {
  id: ID;
  entityId: ID;
  year: number;
  description: string;
  dcn?: string;
  status: 'considering' | 'filed' | 'accepted' | 'dropped';
  filedOn?: string;
  /** §481(a) adjustment, + increases income. */
  adj481?: Cents;
  notes?: string;
}

/** Gross receipts for years before these books, entered per entity. */
export interface ReceiptsYear { entityId: ID; year: number; receipts: Cents }

/** Planning lever amounts per return and year, keyed `${entityId}:${year}:${lever}`. */
export type LeverKey = 'equipment' | 'elect_bonus' | 'retirement' | 'salary' | 'restructure';

export interface TaxState {
  profiles: EntityTaxProfile[];
  rates: Partial<TaxRates>;
  adjustments: TaxAdjustment[];
  years: TaxYearInput[];
  owners: OwnerStart[];
  plans: EstimatePlan[];
  payments: EstimatePayment[];
  methodChanges: MethodChange[];
  receipts: ReceiptsYear[];
  levers: Record<string, Cents>;
}
