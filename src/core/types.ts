import type { Cents } from './money';
import type { FuelState } from './fuelTypes';
import type { ComplianceState } from './complianceTypes';
import type { AssetsState } from './assetTypes';
export type * from './complianceTypes';
export type * from './assetTypes';

export type ID = string;

export type TaxClass = 'partnership_1065' | 's_corp_1120s' | 'c_corp_1120' | 'disregarded';

export interface Entity {
  id: ID;
  code: string;
  name: string;
  taxClass: TaxClass;
  ein?: string;
  /** The entity other entities settle through (Corporate). Exactly one. */
  isHub?: boolean;
  deleted?: boolean;
}

export type FuelSupplier = 'craddock' | 'dash' | 'none';
export type PayrollMode = 'gusto' | 'cash' | 'mixed' | 'none';

export interface Store {
  id: ID;
  code: string;
  name: string;
  entityId: ID;
  /** Operating stores appear in sales reports; leased-out or corporate do not. */
  kind: 'operating' | 'leased_out' | 'corporate';
  fuelSupplier: FuelSupplier;
  payroll: PayrollMode;
  hasKitchen: boolean;
  hasTruckLane: boolean;
  openedOn?: string;
  notes?: string;
  deleted?: boolean;
}

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'contra_revenue' | 'cogs' | 'expense';
export type LineOfBusiness = 'fuel' | 'inside' | 'kitchen' | 'other';
export type AccountSubtype =
  | 'bank' | 'cash' | 'clearing' | 'receivable' | 'inventory' | 'prepaid' | 'fixed_asset' | 'intercompany'
  | 'payable' | 'accrued' | 'loan' | 'equity' | 'draws' | 'retained' | 'uncategorized' | 'general';

export interface Account {
  id: ID;
  number: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  lob?: LineOfBusiness;
  /** Bank and cash accounts: alert when the balance drops below this. */
  floorCents?: Cents;
  active: boolean;
  description?: string;
  /** System accounts (intercompany, retained earnings, uncategorized) cannot be removed. */
  system?: boolean;
}

export type PartyType = 'related_company' | 'owner' | 'tenant' | 'lender' | 'vendor' | 'customer';

export interface Party {
  id: ID;
  name: string;
  type: PartyType;
  /** Default expense / income account when this party is chosen. */
  defaultAccountId?: ID;
  defaultStoreId?: ID;
  is1099?: boolean;
  notes?: string;
  deleted?: boolean;
}

export interface Line {
  id: ID;
  accountId: ID;
  storeId: ID;
  /** Exactly one of debit / credit is above zero. */
  debit: Cents;
  credit: Cents;
  memo?: string;
  partyId?: ID;
  /** Intercompany lines the ledger added so each entity balances on its own. */
  system?: 'intercompany';
  counterEntityId?: ID;
}

export interface Attachment {
  id: ID;
  name: string;
  mime: string;
  size: number;
  addedAt: string;
  addedBy: ID;
}

export type TxnKind = 'money_out' | 'money_in' | 'journal' | 'transfer' | 'opening';

export interface Transaction {
  id: ID;
  /** Human reference: TX-000123 */
  ref: string;
  date: string;
  kind: TxnKind;
  description: string;
  memo?: string;
  tags: string[];
  partyId?: ID;
  checkNo?: string;
  docNo?: string;
  lines: Line[];
  attachments: Attachment[];
  source: 'manual' | 'demo' | 'import' | 'rule';
  batchId?: string;
  createdAt: string;
  createdBy: ID;
  updatedAt: string;
  updatedBy: ID;
  deleted?: { at: string; by: ID; reason: string };
}

export interface Period {
  id: string; // YYYY-MM
  status: 'open' | 'locked';
  lockedAt?: string;
  lockedBy?: ID;
  unlockReason?: string;
}

export type Role = 'cfo' | 'bookkeeper' | 'store_manager' | 'owner' | 'reviewer';

export interface User {
  id: ID;
  name: string;
  role: Role;
  /** Store managers only see and enter for these stores. */
  storeIds?: ID[];
  active: boolean;
}

export interface Rule {
  id: ID;
  /** Case-insensitive text the bank description must contain. */
  contains: string;
  partyId?: ID;
  accountId: ID;
  storeId: ID;
  origin: 'manual' | 'learned';
  hits: number;
  overrides: number;
  createdAt: string;
  active: boolean;
}

export interface AuditEntry {
  id: ID;
  at: string;
  userId: ID;
  action: string;
  objectType: 'transaction' | 'account' | 'store' | 'entity' | 'party' | 'period' | 'user' | 'rule' | 'settings' | 'export' | 'data' | 'bank' | 'reconciliation' | 'cash' | 'forecast' | 'people' | 'fuel'
    | 'bill' | 'intercompany' | 'receivable' | 'compliance' | 'document' | 'asset' | 'loan';
  objectId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

// ── Bank & cash (phase 2) ──────────────────────────────────────────────
export type DepositSource =
  | 'store_cash' | 'card_settlement' | 'mudflap' | 'fiserv' | 'tenant_rent' | 'rebate' | 'atm' | 'lottery'
  | 'related_repayment' | 'owner_contribution' | 'transfer' | 'refund' | 'other';

/** One line from a bank statement or feed. Amount is signed from the bank's view: + in, − out. */
export interface BankLine {
  id: ID;
  accountId: ID;
  date: string;
  description: string;
  amount: Cents;
  checkNo?: string;
  fitId?: string;
  /** Idempotency key: re-importing the same line never duplicates it. */
  hash: string;
  batchId: string;
  source?: DepositSource;
  /** Ledger line ids this bank line clears. */
  matchedLineIds: ID[];
  excluded?: { reason: string; by: ID; at: string };
}

export interface ImportBatch {
  id: ID;
  accountId: ID;
  fileName: string;
  format: 'csv' | 'ofx' | 'demo';
  importedAt: string;
  by: ID;
  added: number;
  skipped: number;
  totalIn: Cents;
  totalOut: Cents;
  from: string;
  to: string;
  statementBalance?: Cents;
}

export interface Reconciliation {
  id: ID;
  accountId: ID;
  statementDate: string;
  statementBalance: Cents;
  bookBalance: Cents;
  bookOnly: Cents;
  bankOnly: Cents;
  difference: Cents;
  by: ID;
  at: string;
  outstandingLineIds: ID[];
  bankOnlyIds: ID[];
}

export type CashStage = 'count' | 'pickup' | 'hq_receipt' | 'deposit';

export interface CashEvent {
  id: ID;
  stage: CashStage;
  amount: Cents;
  person: string;
  at: string;
  note?: string;
  /** The ledger transaction this step posted, if any. */
  txnId?: ID;
}

/** One store's register cash for one business day, followed from count to bank. */
export interface CashBag {
  id: ID;
  storeId: ID;
  businessDate: string;
  events: CashEvent[];
  /** A flagged variance the CFO looked into and signed off. */
  reviewed?: { by: ID; at: string; note: string };
}

export type PayoutKind = 'payroll' | 'vendor' | 'change' | 'draw' | 'other';

export interface CashPayout {
  id: ID;
  date: string;
  /** Where the cash came from: a store's registers, or the HQ pool (Corporate). */
  fromStoreId: ID;
  kind: PayoutKind;
  payee: string;
  amount: Cents;
  person: string;
  txnId: ID;
}

export interface ForecastItem {
  id: ID;
  label: string;
  /** + in, − out */
  amount: Cents;
  cadence: 'once' | 'weekly' | 'biweekly' | 'monthly';
  start: string;
  end?: string;
  active: boolean;
}

export interface BankState {
  lines: BankLine[];
  batches: ImportBatch[];
  reconciliations: Reconciliation[];
  /** Statement opening balance per bank account: lines before this date are not expected. */
  openings: Record<ID, { date: string; balance: Cents }>;
}

export interface CashState {
  bags: CashBag[];
  payouts: CashPayout[];
}

// ── Intercompany, payables & receivables (phase 5) ────────────────────
/** A recurring rent pass-through: a related party pays the store's mortgage, so the store books rent and Corporate owes the party. */
export interface RentTemplate {
  id: ID;
  storeId: ID;
  partyId: ID;
  amount: Cents;
  dayOfMonth: number;
  expenseAccountId: ID;
  payableAccountId: ID;
  /** First month to generate, YYYY-MM. */
  startPeriod: string;
  endPeriod?: string;
  active: boolean;
  /** Period → the transaction it generated. */
  generated: Record<string, ID>;
}

export interface IntercompanyState {
  /** Per-party limit on the balance either way; the inbox alerts above it. */
  limits: Record<ID, Cents>;
  rentTemplates: RentTemplate[];
}

export type BillStatus = 'draft' | 'approved' | 'scheduled' | 'paid' | 'void';
export type PayMethod = 'check' | 'ach' | 'autopay' | 'card' | 'cash';

export interface BillLine {
  id: ID;
  accountId: ID;
  storeId: ID;
  amount: Cents;
  memo?: string;
}

export interface Bill {
  id: ID;
  /** Human reference: BILL-0001 */
  ref: string;
  vendorId: ID;
  /** The store the bill is addressed to; the payable sits here. Lines can allocate the cost to other stores. */
  storeId: ID;
  invoiceNo: string;
  billDate: string;
  dueDate: string;
  lines: BillLine[];
  status: BillStatus;
  autopay: boolean;
  memo?: string;
  attachments: Attachment[];
  utilityAccountId?: ID;
  /** The bill carries a disconnect / shut-off notice. */
  disconnectNotice?: boolean;
  source: 'manual' | 'inbox' | 'demo';
  createdAt: string;
  createdBy: ID;
  approved?: { by: ID; at: string; note?: string; txnId: ID };
  scheduled?: { date: string; method: PayMethod; by: ID; at: string };
  payment?: { date: string; method: PayMethod; checkNo?: string; confirmation?: string; txnId: ID; by: ID; at: string; attachments: Attachment[] };
  voided?: { by: ID; at: string; reason: string };
}

export type UtilityService = 'electric' | 'water' | 'gas' | 'telecom' | 'waste';

export interface UtilityAccount {
  id: ID;
  vendorId: ID;
  storeId: ID;
  service: UtilityService;
  serviceAddress: string;
  accountNo: string;
  autopay: boolean;
  active: boolean;
}

/** A vendor's statement of what they think we owe, line by open invoice. */
export interface VendorStatement {
  id: ID;
  vendorId: ID;
  date: string;
  balance: Cents;
  lines: { invoiceNo: string; date: string; amount: Cents }[];
  note?: string;
  by: ID;
  at: string;
}

export interface PayablesState {
  bills: Bill[];
  utilities: UtilityAccount[];
  statements: VendorStatement[];
}

export interface RentSchedule {
  id: ID;
  tenantId: ID;
  storeId: ID;
  amount: Cents;
  dueDay: number;
  /** Days after the due day before the rent counts as late. */
  graceDays: number;
  startPeriod: string;
  endPeriod?: string;
  active: boolean;
}

export type ReceivableKind = 'rebate' | 'insurance' | 'refund' | 'other';

/** Money someone owes us outside tenant rent: rebates and programs, insurance claims, refunds. */
export interface ReceivableItem {
  id: ID;
  kind: ReceivableKind;
  /** Who pays: a program name or a party. */
  payer: string;
  partyId?: ID;
  storeId: ID;
  description: string;
  expected: Cents;
  expectedBy: string;
  /** Where the money posts when it arrives. */
  incomeAccountId: ID;
  /** Deposits (ledger transactions) applied to this item. */
  receipts: { txnId: ID; amount: Cents }[];
  closed?: { by: ID; at: string; reason: string };
  createdAt: string;
}

export interface ReceivablesState {
  rent: RentSchedule[];
  items: ReceivableItem[];
}

export interface Settings {
  companyName: string;
  timezone: 'America/Chicago';
  fiscalYearStartMonth: number; // 1 = January
  materialityCents: Cents;
  /** How owner withdrawals post: as an expense on Corporate, or as equity draws. */
  ownerWithdrawalPolicy: 'expense' | 'draw';
  ownerWithdrawalExpenseAccountId?: ID;
  /** Above this, a journal entry needs CFO approval (enforced from phase 10). */
  jeApprovalLimitCents: Cents;
  /** Cash chain: deposit expected within this many days of pickup. */
  depositWithinDays: number;
  /** Uncleared checks older than this are flagged stale. */
  staleCheckDays: number;
  /** Detected recurring cash items the CFO switched off in the forecast. */
  forecastDisabled: string[];
}

export interface BooksState {
  schema: number;
  settings: Settings;
  entities: Entity[];
  stores: Store[];
  accounts: Account[];
  parties: Party[];
  users: User[];
  rules: Rule[];
  transactions: Transaction[];
  periods: Record<string, Period>;
  audit: AuditEntry[];
  bank: BankState;
  cash: CashState;
  forecastItems: ForecastItem[];
  /** Phase 3: fuel subledger (invoices, notices, sales, tanks, prices). */
  fuel: FuelState;
  intercompany: IntercompanyState;
  payables: PayablesState;
  receivables: ReceivablesState;
  /** Duplicate pairs the CFO marked "not a duplicate". */
  dismissedDuplicates: string[];
  seq: number;
  /** People & payroll (phase 6). Books saved before phase 6 lack it: read it through `peopleOf(state)`. */
  people: PeopleState;
  /** Compliance & documents (phase 9). Books saved before phase 9 lack it: read it through `complianceOf(state)`. */
  compliance?: ComplianceState;
  /** Fixed assets, prepaids & loans (phase 9). Read it through `assetsOf(state)`. */
  assets?: AssetsState;
}

// ── People & payroll (phase 6) ─────────────────────────────────────────
export type Department = 'front' | 'kitchen' | 'office' | 'truck_lane';
export type PayType = 'hourly' | 'salary';
/** How the person is paid: through Gusto, cash, paper check, or a mix (Gusto plus some cash/check). */
export type EmployeePayMethod = 'gusto' | 'cash' | 'check' | 'mixed';

export interface Employee {
  id: ID;
  name: string;
  storeId: ID;
  department: Department;
  payType: PayType;
  /** Rate when added: per hour (hourly) or per week (salary), in cents. The current rate adds approved changes. */
  rateCents: Cents;
  status: 'active' | 'terminated';
  hiredOn: string;
  terminatedOn?: string;
  gustoId?: string;
  paidBy: EmployeePayMethod;
  /** The CFO confirmed the new-hire paperwork and rate. New hires without it sit in the inbox. */
  hireReviewed?: { by: ID; at: string };
  notes?: string;
}

export interface RateChange {
  id: ID;
  employeeId: ID;
  fromCents: Cents;
  toCents: Cents;
  effective: string;
  reason: string;
  requestedBy: ID;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: ID;
  decidedAt?: string;
  decisionNote?: string;
}

/** One employee's line on a Gusto payroll run. Hours are decimal hours (e.g. 38.25). */
export interface PayrollLine {
  id: ID;
  employeeId: ID;
  storeId: ID;
  department: Department;
  hours: number;
  otHours: number;
  gross: Cents;
  employeeTaxes: Cents;
  employerTaxes: Cents;
  net: Cents;
  /** The part of the taxes owed to the state (withholding + unemployment); the rest is federal. */
  stateTaxes: Cents;
  /** Paid by paper check instead of direct deposit: Gusto does not debit this net pay. */
  check?: { checkNo?: string };
  /** Idempotency key: re-importing the same report never duplicates a line. */
  hash: string;
  /** The import batch this line arrived in. */
  batchId: string;
}

export interface PayrollTotals {
  gross: Cents;
  employeeTaxes: Cents;
  employerTaxes: Cents;
  net: Cents;
  /** What Gusto debits from the bank: direct-deposit net pay + all taxes. */
  companyDebit: Cents;
  /** Net pay on paper checks (not in the company debit). */
  checkPaid: Cents;
}

export interface PayrollRun {
  id: ID;
  payDate: string;
  periodStart?: string;
  periodEnd?: string;
  fileName: string;
  batchId: string;
  importedAt: string;
  importedBy: ID;
  lines: PayrollLine[];
  /** Totals as printed on the report's totals row (or summed when it has none). */
  reported: PayrollTotals;
  status: 'imported' | 'posted';
  /** Ledger entries carrying this run: one Gusto debit per store plus one per paper check. */
  txnIds: ID[];
  postedBy?: ID;
  postedAt?: string;
}

/** Pay outside Gusto: HM11's cash crew, or extra cash/check pay for anyone else. One entry per employee and pay week. */
export interface OffPayrollPay {
  id: ID;
  employeeId: ID;
  /** The Friday pay date of the week it belongs to. */
  payDate: string;
  method: 'cash' | 'check';
  amount: Cents;
  hours?: number;
  note?: string;
  /** A cash-chain payroll payout this is part of (nothing new is posted when linked). */
  payoutId?: ID;
  /** Its own posting, when it isn't part of an existing payout. */
  txnId?: ID;
  checkNo?: string;
  /** Someone confirmed this is extra pay on top of Gusto for the same week, not a duplicate. */
  confirmed?: { by: ID; at: string; note: string };
  by: ID;
  at: string;
}

export type TaxAgency = 'federal' | 'state';

export interface TaxDeposit {
  id: ID;
  date: string;
  storeId: ID;
  agency: TaxAgency;
  /** Quarter the liability belongs to, e.g. 2026Q4. */
  quarter: string;
  amount: Cents;
  note?: string;
  by: ID;
}

export interface ChecklistMark { by: ID; at: string; confirmation?: string }

export interface PeopleState {
  employees: Employee[];
  rateChanges: RateChange[];
  runs: PayrollRun[];
  offPayroll: OffPayrollPay[];
  taxDeposits: TaxDeposit[];
  /** Labor % of sales target per store, in basis points (1250 = 12.5%). */
  laborTargets: Record<ID, number>;
  /** Filing checklist marks, keyed e.g. "2026Q3:941" or "2026:w2:sent". */
  checklist: Record<string, ChecklistMark>;
}
