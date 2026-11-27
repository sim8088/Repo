import type { Cents } from './money';
import type { ID } from './types';

// ── Inside store (phase 7) ─────────────────────────────────────────────

/** A store department: where its sales post, where its purchases post, and how it is counted. */
export interface InsideDept {
  id: ID;
  name: string;
  /** Revenue accounts whose sales belong to this department (e.g. 4110 Tobacco). */
  revenueAccountIds: ID[];
  /** Purchases and count adjustments post here. Several departments may share one account (5120). */
  cogsAccountId?: ID;
  /** Counted inventory sits here (1310). */
  inventoryAccountId?: ID;
  /** Expected cost as a share of retail, in basis points (6600 = 66%). Book inventory relieves sales at this rate. */
  costBps: number;
  /** Shrink above this share of the department's sales is flagged, in basis points. */
  shrinkBps: number;
  /** Counted at inventory counts. */
  counted: boolean;
  /** Its sales arrive on the POS daily close (lottery commissions don't). */
  inPosClose: boolean;
  /** The kitchen's food department: food cost reads its count. */
  kitchen?: boolean;
  /** POS department names that map here, matched case-insensitively (e.g. "Cigarettes", "OTP"). */
  posAliases: string[];
  active: boolean;
}

/** Where a vendor's purchases go. Several departments split the purchase by that store's sales that month. */
export interface VendorMapping {
  id: ID;
  partyId?: ID;
  accountId?: ID;
  departmentIds: ID[];
  note?: string;
}

/** One department's sales for one store and day, from the POS department sales export. */
export interface PosDeptSale {
  id: ID;
  storeId: ID;
  date: string;
  /** The department name as the POS printed it. */
  posDept: string;
  departmentId: ID;
  sales: Cents;
  units: number;
  /** Idempotency key: store + date + POS department. */
  hash: string;
  batchId: string;
}

/** Store traffic for a day from the same export: the customer (transaction) count. */
export interface PosDaySummary {
  id: ID;
  storeId: ID;
  date: string;
  transactions: number;
  hash: string;
  batchId: string;
}

export interface InsideBatch {
  id: ID;
  kind: 'pos' | 'menu' | 'invoice_lines';
  fileName: string;
  importedAt: string;
  by: ID;
  added: number;
  skipped: number;
  source: 'import' | 'demo';
}

export interface CountLine {
  departmentId: ID;
  /** Counted inventory at cost. */
  counted: Cents;
}

export interface InventoryCount {
  id: ID;
  storeId: ID;
  date: string;
  lines: CountLine[];
  status: 'draft' | 'posted' | 'void';
  note?: string;
  enteredBy: ID;
  enteredAt: string;
  posted?: {
    by: ID;
    at: string;
    /** The inventory adjustment entry (none when the count agreed with the books to the cent). */
    txnId?: ID;
    /** Per department: + inventory went up (cost of goods down), − it went down. */
    adjustments: { departmentId: ID; amount: Cents }[];
  };
  voided?: { by: ID; at: string; reason: string };
}

/** Monthly purchasing budget for one store and department. Purchasing control, not the P&L budget. */
export interface PurchaseBudget {
  id: ID;
  storeId: ID;
  /** YYYY-MM */
  period: string;
  departmentId: ID;
  amount: Cents;
}

/** A manufacturer's scan-data or loyalty program: a rate per qualifying unit sold. */
export interface ScanProgram {
  id: ID;
  manufacturer: string;
  departmentId: ID;
  /** Cents per qualifying unit; fractions allowed (e.g. 7.5). */
  rateCentsPerUnit: number;
  /** Share of the department's units that are this manufacturer's qualifying products, in basis points. */
  shareBps: number;
  cadence: 'monthly' | 'quarterly';
  storeIds: ID[];
  /** Days after the period ends that the money is due. */
  payDays: number;
  /** Period key (2026Q3 or 2026-10) → the Receivables item tracking the money. */
  receivables: Record<string, ID>;
  active: boolean;
}

/** One store's lottery week: what the lottery's report says vs what the register took. */
export interface LotteryWeek {
  id: ID;
  storeId: ID;
  /** The Saturday the lottery week ends. */
  weekEnding: string;
  instantSales: Cents;
  onlineSales: Cents;
  instantCashes: Cents;
  onlinePayouts: Cents;
  commission: Cents;
  /** What the lottery swept (or will sweep) from the bank for the week. */
  settlement: Cents;
  /** Lottery net in the register (POS lottery sales − payouts rung up). */
  posNet: Cents;
  note?: string;
  reviewed?: { by: ID; at: string; note: string };
  by: ID;
  at: string;
}

export interface AgeCheck {
  id: ID;
  date: string;
  storeId: ID;
  product: 'tobacco' | 'alcohol' | 'both';
  result: 'pass' | 'fail';
  /** Who ran it: state compliance check, mystery shopper, internal. */
  checkedBy: string;
  clerk?: string;
  note?: string;
  followUp?: string;
  followUpDue?: string;
  resolved?: { by: ID; at: string; note: string };
  by: ID;
  at: string;
}

export interface InsideState {
  departments: InsideDept[];
  vendorMaps: VendorMapping[];
  posSales: PosDeptSale[];
  posDays: PosDaySummary[];
  counts: InventoryCount[];
  budgets: PurchaseBudget[];
  scanPrograms: ScanProgram[];
  lottery: LotteryWeek[];
  ageChecks: AgeCheck[];
  batches: InsideBatch[];
}

// ── Kitchen (phase 7) ──────────────────────────────────────────────────

/** Menu mix: one item's quantity and sales for a store over a period, from the POS item report. */
export interface MenuItemSale {
  id: ID;
  storeId: ID;
  from: string;
  to: string;
  item: string;
  qty: number;
  sales: Cents;
  hash: string;
  batchId: string;
}

export type WasteReason = 'expired' | 'overcooked' | 'dropped' | 'quality' | 'overproduction' | 'other';

export interface WasteEntry {
  id: ID;
  storeId: ID;
  date: string;
  item: string;
  qty: number;
  unit: string;
  /** Cost of what was thrown away. */
  cost: Cents;
  reason: WasteReason;
  note?: string;
  by: ID;
  at: string;
  removed?: { by: ID; at: string; reason: string };
}

/** One line of a supplier invoice (Sysco etc.), for price tracking. */
export interface SupplierInvoiceLine {
  id: ID;
  vendorId: ID;
  storeId: ID;
  invoiceNo: string;
  date: string;
  /** Lines without an item code (freight, surcharges) are not price-tracked. */
  itemCode?: string;
  description: string;
  unit?: string;
  qty: number;
  unitPrice: Cents;
  extended: Cents;
  hash: string;
  batchId: string;
}

export interface KitchenState {
  /** Food cost target per store, basis points of food sales. */
  targets: Record<ID, number>;
  /** Food cost is "outside target" when it is more than this many basis points from the target. */
  toleranceBps: number;
  /** Price change (either way) that raises an alert, basis points. */
  priceAlertBps: number;
  /** How many items by spend count as top items. */
  topItems: number;
  menu: MenuItemSale[];
  waste: WasteEntry[];
  invoiceLines: SupplierInvoiceLine[];
  batches: InsideBatch[];
  /** Price changes someone reviewed: item key + the date the new price started. */
  ackedPrices: Record<string, { by: ID; at: string; note?: string }>;
}
