import type { Attachment, ID } from './types';
import type { Cents } from './money';

// ── Growth & owners (phase 13) ──────────────────────────────────────────
export type Rag = 'green' | 'amber' | 'red' | 'na';

export interface GrowthSettings {
  /** Company DSCR the next deal must keep, in hundredths (125 = 1.25x). */
  dscrTarget: number;
  /** Maximum debt ÷ EBITDA after the deal, in hundredths (350 = 3.50x). */
  leverageTarget: number;
  /** Discount rate for NPVs, in basis points. */
  discountRateBps: number;
  /** Minimum levered IRR for a "go", in basis points. */
  hurdleIrrBps: number;
  /** Same-store profit counts as stable when it falls by no more than this % a quarter. */
  stableDropPct: number;
  /** A manager is ready to promote to run the next store (manual). */
  managerReady: boolean;
  managerNote?: string;
  /** Months the books must have closed on time. */
  closeOnTimeMonths: number;
  /** The pro forma the scorecard tests the new debt and leverage against. */
  dealProFormaId?: ID;
  /** Company valuation: EBITDA multiple range, in hundredths (450 = 4.5x). */
  multipleLow: number;
  multipleHigh: number;
  /** Per-gallon method: value per annual gallon, in cents, low and high. */
  perGallonLow: Cents;
  perGallonHigh: Cents;
  /** Safe distribution: capex starting within this many days, and tax estimates due within it. */
  capexWindowDays: number;
  taxWindowDays: number;
  /** Months of company debt service held back as a cushion. */
  debtCushionMonths: number;
}

// ── Site scorecard ───────────────────────────────────────────────────────
export type SiteFactor = 'aadt' | 'visibility' | 'access' | 'competition' | 'population' | 'growth' | 'truck' | 'zoning' | 'environmental' | 'utilities' | 'income';
export type ZoningStatus = 'permitted' | 'conditional' | 'rezoning' | 'unknown';
export type EnvStatus = 'clean' | 'recs' | 'phase2' | 'contaminated' | 'unknown';
export type UtilityStatus = 'all' | 'partial' | 'none';

export interface Competitor { name: string; brand: string; distanceMi: number; /** Regular price, cents per gallon. */ priceCpg?: number; amenities: string }

/** A site's profile: a prospect, or an existing store entered for comparison. */
export interface SiteProfile {
  id: ID;
  name: string;
  /** prospect: a site we might open. existing: one of our stores, for comparison. */
  kind: 'prospect' | 'existing';
  storeId?: ID;
  area: string;
  status: 'reviewing' | 'pursuing' | 'passed' | 'open';
  /** Average annual daily traffic. */
  aadt: number;
  /** 1 (hidden) – 5 (corner, seen from both directions). */
  visibility: number;
  /** Ingress / egress, 1 (one awkward curb cut) – 5 (signalized, both directions). */
  access: number;
  competitors: Competitor[];
  /** Population within 3 miles. */
  population: number;
  /** Annual population growth, basis points. */
  growthBps: number;
  /** Trucks a day past the site. */
  trucksPerDay: number;
  zoning: ZoningStatus;
  environmental: EnvStatus;
  utilities: UtilityStatus;
  /** Median household income within 3 miles. */
  medianIncome: Cents;
  note?: string;
}

// ── Pro forma ────────────────────────────────────────────────────────────
export type DealMode = 'buy' | 'build' | 'lease';
export type CapitalKind = 'land' | 'building' | 'construction' | 'equipment' | 'pos' | 'signage' | 'inventory' | 'working_capital' | 'opening' | 'other';

/** Stabilized monthly operating assumptions (after the ramp). */
export interface ProFormaInputs {
  gallons: number;
  /** Fuel margin, cents per gallon (hundredths of a cent allowed: 28.5). */
  cpg: number;
  /** Average retail price, cents per gallon (for card fees on fuel). */
  retailCpg: number;
  insideSales: Cents;
  /** Inside gross margin, % (32 = 32%). */
  insideMarginPct: number;
  kitchenSales: Cents;
  foodCostPct: number;
  otherIncome: Cents;
  labor: Cents;
  /** Rent (lease) or ground rent; zero when owned. */
  occupancy: Cents;
  utilities: Cents;
  /** Card fees as % of all sales. */
  cardFeePct: number;
  repairs: Cents;
  insurance: Cents;
  propertyTax: Cents;
  otherExpense: Cents;
  /** Ramp: % of stabilized volume in months 1, 2, … (100 after the last entry). */
  ramp: number[];
  /** Volume and cost growth a year after year 1, basis points. */
  growthBps: number;
}

export interface CapitalLine { label: string; kind: CapitalKind; amount: Cents }
export interface Incentive { label: string; /** upfront: cash at opening (reduces equity). cpg: per gallon for N months. */ kind: 'upfront' | 'cpg'; amount: Cents; cpg?: number; months?: number }
export interface Financing { loanAmount: Cents; rateBps: number; termMonths: number; amortizationMonths: number }

export interface ProForma {
  id: ID;
  name: string;
  mode: DealMode;
  siteId?: ID;
  acquisitionId?: ID;
  /** Where the inputs came from (e.g. "Prefilled from HM15, Sep–Oct 2026"). */
  source?: string;
  /** Months from today until the store opens (construction, permits, closing). */
  monthsToOpen: number;
  inputs: ProFormaInputs;
  capital: CapitalLine[];
  incentives: Incentive[];
  financing: Financing;
  /** Real estate value at opening (buy / build), growing at appreciationBps a year; zero for a lease. */
  realEstateValue: Cents;
  appreciationBps: number;
  /** Build: contingency risk of an overrun, % of construction (used in the comparison). */
  overrunPct: number;
  risks: string[];
  note?: string;
  updatedAt: string;
  updatedBy: ID;
}

// ── Acquisitions ─────────────────────────────────────────────────────────
export interface SellerLine { label: string; section: 'revenue' | 'cogs' | 'expense'; amount: Cents }
export interface AddBack { label: string; /** addback: added to EBITDA. perk: owner perk added back. normalize: a cost the seller didn't carry (negative effect). */ kind: 'addback' | 'perk' | 'normalize'; amount: Cents; note?: string }
export interface GallonCheck { period: string; seller: number; supplier?: number }
export type DdArea = 'phase1' | 'phase2' | 'ust' | 'title' | 'permits' | 'supply' | 'other';
export type DdStatus = 'not_started' | 'in_progress' | 'done' | 'issue' | 'na';
export interface DdItem { id: ID; area: DdArea; title: string; status: DdStatus; owner: string; due?: string; note?: string; attachments: Attachment[] }
export interface QoeItem { key: string; label: string; done: boolean; note?: string }

export interface Acquisition {
  id: ID;
  name: string;
  area: string;
  status: 'reviewing' | 'loi' | 'diligence' | 'closed' | 'passed';
  askingPrice: Cents;
  offerPrice: Cents;
  /** The seller's last twelve months, as they presented them. */
  sellerPnl: SellerLine[];
  addBacks: AddBack[];
  /** Annual gallons the seller reports. */
  sellerGallons: number;
  gallonChecks: GallonCheck[];
  realEstateValue: Cents;
  /** Market rent for the property, a year (for the business-only value). */
  marketRent: Cents;
  insideInventoryAtCost: Cents;
  fuelGallonsInTank: number;
  /** Delivered cost, cents per gallon. */
  fuelCostCpg: number;
  qoe: QoeItem[];
  dd: DdItem[];
  financing: Financing;
  note?: string;
}

// ── Capital allocation ──────────────────────────────────────────────────
export type ProjectKind = 'next_store' | 'remodel' | 'kitchen' | 'ev' | 'car_wash' | 'other';
export type Risk = 'low' | 'medium' | 'high';
export interface CapitalProject {
  id: ID;
  name: string;
  kind: ProjectKind;
  storeId?: ID;
  cost: Cents;
  /** Added cash flow a year once running. */
  annualReturn: Cents;
  risk: Risk;
  /** 1 (nice to have) – 5 (core to the plan). */
  strategic: number;
  /** When the spend starts (near-term capex for the safe distribution). */
  start?: string;
  status: 'idea' | 'approved' | 'in_progress' | 'done' | 'declined';
  proFormaId?: ID;
  note?: string;
}

// ── Valuation ────────────────────────────────────────────────────────────
export interface ValuationSnapshot {
  id: ID;
  /** 2026-Q3 */
  quarter: string;
  date: string;
  ebitda: Cents;
  annualized: boolean;
  multipleLow: number;
  multipleHigh: number;
  gallons: number;
  perGallonLow: Cents;
  perGallonHigh: Cents;
  realEstate: Cents;
  debt: Cents;
  equityLow: Cents;
  equityMid: Cents;
  equityHigh: Cents;
  /** Entered from an earlier system (not computed from these books). */
  entered?: boolean;
  note?: string;
  by: ID;
  at: string;
}

// ── Scorecard, ramp, distributions ───────────────────────────────────────
export interface ScoreRecord { period: string; overall: Rag; checks: Record<string, Rag>; at: string; by: ID }
export interface FixPlan { id: ID; storeId: ID; text: string; by: ID; at: string }
export interface RampTarget { period: string; gallons: number; insideSales: Cents; ebitda: Cents }
export interface RampPlan { storeId: ID; proFormaId?: ID; targets: RampTarget[] }

export interface Distribution {
  id: ID;
  date: string;
  partyId: ID;
  /** The paying store (the hub by default). */
  storeId: ID;
  amount: Cents;
  kind: 'regular' | 'tax';
  bankAccountId: ID;
  txnId: ID;
  /** Recorded above the safe distribution amount: why. */
  override?: string;
  note?: string;
  by: ID;
  at: string;
}

/** Distributions before these books (for lifetime and year-to-date totals). */
export interface PriorDistributions { partyId: ID; year: number; ytd: Cents; lifetime: Cents; through: string }

export interface GrowthState {
  settings: GrowthSettings;
  sites: SiteProfile[];
  weights: Record<SiteFactor, number>;
  proFormas: ProForma[];
  acquisitions: Acquisition[];
  projects: CapitalProject[];
  valuations: ValuationSnapshot[];
  scoreHistory: ScoreRecord[];
  fixPlans: FixPlan[];
  ramps: RampPlan[];
  distributions: Distribution[];
  priorDistributions: PriorDistributions[];
}
