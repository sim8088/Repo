import type { Cents } from './money';
import type { Attachment, ID } from './types';

// ── Fuel (phase 3) ───────────────────────────────────────────────────────
/** Plus has no tank of its own: the dispenser blends it 50/50 from the Regular and Premium tanks. */
export type FuelGrade = 'regular' | 'plus' | 'premium' | 'diesel';
export type FuelVendor = 'craddock' | 'dash';

/** One grade on a fuel invoice / BOL. Gallons may carry decimals (thousandths). */
export interface FuelInvoiceLine {
  grade: Exclude<FuelGrade, 'plus'>;
  grossGallons: number;
  /** Temperature-corrected gallons: what we are billed for and what goes in the tank. */
  netGallons: number;
  /** Extended product cost for this grade, before freight and taxes. */
  cost: Cents;
}

/**
 * A fuel delivery: the BOL (bill of lading the driver leaves) and the supplier's invoice for it.
 * A BOL with no invoice number yet is a delivery we're still waiting to be billed for ("missing invoice").
 */
export interface FuelInvoice {
  id: ID;
  supplier: FuelVendor;
  storeId: ID;
  /** Blank until the invoice arrives; the BOL alone is enough to log the delivery. */
  invoiceNo?: string;
  bolNo: string;
  deliveredOn: string;
  dueOn: string;
  lines: FuelInvoiceLine[];
  freight: Cents;
  taxes: Cents;
  /** Must equal Σ line cost + freight + taxes. */
  total: Cents;
  attachments: Attachment[];
  /** How it was paid: netted on a Craddock notice, or out of Dash clearing on its due date. */
  settlement?: { kind: 'notice'; noticeId: ID; on: string; txnId: ID } | { kind: 'dash_clearing'; on: string; txnId: ID } | { kind: 'imported'; on: string; txnId: ID };
  batchId: string;
  source: 'manual' | 'import' | 'demo';
  createdAt: string;
  createdBy: ID;
  deleted?: { at: string; by: ID; reason: string };
}

/**
 * Craddock EFT notice line types. Amounts are signed from our side: + Craddock owes us, − we owe Craddock.
 * BANK_DRAFT (+) is Craddock pulling the net from our bank; DEPOSIT (−) is Craddock paying it to us.
 */
export type NoticeLineType = 'CC_PROCEEDS' | 'CC_FEE' | 'HOST_DISCOUNT' | 'FUEL_INVOICE' | 'OTHER' | 'BANK_DRAFT' | 'DEPOSIT';

export interface NoticeLine {
  id: ID;
  type: NoticeLineType;
  amount: Cents;
  description: string;
  /** Card lines: the date Craddock processed the batch. The sales day is the day before. */
  processingDate?: string;
  /** FUEL_INVOICE lines: the invoice the notice nets. */
  invoiceNo?: string;
  /** The import batch (or manual entry) this line came from. */
  batchId: string;
}

export interface FuelNotice {
  id: ID;
  supplier: 'craddock';
  storeId: ID;
  noticeNo: string;
  noticeDate: string;
  lines: NoticeLine[];
  status: 'unposted' | 'posted';
  postedAt?: string;
  postedBy?: ID;
  /** Every ledger entry the posting created (card-fee batches, the notice-day entry, the draft or deposit). */
  txnIds: ID[];
  batchId: string;
  source: 'manual' | 'import' | 'demo';
  attachments: Attachment[];
}

/** Dash's weekly statement: card fees and network fees out of clearing, and the surplus remitted (or a shortfall drafted). */
export interface DashSettlement {
  id: ID;
  storeId: ID;
  date: string;
  cardFees: Cents;
  networkFees: Cents;
  /** + Dash sent us money, − Dash drafted our bank. */
  remit: Cents;
  txnId: ID;
}

/** Structured daily fuel sales from the store POS. */
export interface FuelSale {
  id: ID;
  storeId: ID;
  date: string;
  grade: FuelGrade;
  gallons: number;
  retail: Cents;
  /** The POS close that posted the revenue. */
  txnId?: ID;
  batchId: string;
}

/** HM15 truck lane: the Comdata truck-stop summary, kept apart from the store POS. Diesel only. */
export interface ComdataDay {
  id: ID;
  storeId: ID;
  date: string;
  gallons: number;
  sales: Cents;
  transactions: number;
  batchId: string;
  /** Idempotency key: store + date. */
  key: string;
}

/** Mudflap fuel-code discounts and card true-ups. + is a cost to us (contra revenue), − gives some back. */
export interface MudflapEntry {
  id: ID;
  storeId: ID;
  date: string;
  kind: 'discount' | 'true_up';
  amount: Cents;
  gallons?: number;
  note?: string;
  txnId: ID;
}

export interface Tank {
  id: ID;
  storeId: ID;
  label: string;
  grade: Exclude<FuelGrade, 'plus'>;
  capacity: number;
  active: boolean;
}

/** End-of-day tank reading: a stick reading or the ATG (automatic tank gauge). */
export interface TankReading {
  id: ID;
  tankId: ID;
  date: string;
  gallons: number;
  waterInches: number;
  method: 'stick' | 'atg';
  by: ID;
}

/** Our posted street price, in cents per gallon (may carry a tenth: 289.9). */
export interface PostedPrice {
  id: ID;
  storeId: ID;
  grade: FuelGrade;
  effective: string;
  cpg: number;
}

/** A competitor's street price seen on a date. Names are generic. */
export interface CompetitorPrice {
  id: ID;
  storeId: ID;
  competitor: string;
  grade: FuelGrade;
  date: string;
  cpg: number;
}

export interface FuelImportBatch {
  id: ID;
  kind: 'notices' | 'invoices' | 'comdata';
  fileName: string;
  importedAt: string;
  by: ID;
  added: number;
  skipped: number;
}

export interface FuelTargets {
  /** Store cpg margin (all grades, month to date) should sit inside this band. */
  cpgMin: number;
  cpgMax: number;
  /** An invoice's cost per gallon this far from the month's average for that grade is flagged. */
  priceOutlierPct: number;
  /** Water above this many inches in a tank is an alert. */
  waterInches: number;
  /** Book-to-physical over the last 30 days beyond (this % of gallons sold + allowance) is flagged (the EPA inventory-control test). */
  variancePct: number;
  varianceAllowanceGal: number;
  /** Reorder when a tank has fewer than this many days of supply. */
  reorderDays: number;
  /** A transport load, in gallons. */
  loadGallons: number;
  /** Safe fill: tanks are filled to this share of capacity. */
  safeFillPct: number;
}

export interface FuelState {
  invoices: FuelInvoice[];
  notices: FuelNotice[];
  dashSettlements: DashSettlement[];
  sales: FuelSale[];
  comdata: ComdataDay[];
  mudflap: MudflapEntry[];
  tanks: Tank[];
  readings: TankReading[];
  prices: PostedPrice[];
  competitors: CompetitorPrice[];
  batches: FuelImportBatch[];
  targets: FuelTargets;
}
