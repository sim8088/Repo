import type { Cents } from './money';

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
  objectType: 'transaction' | 'account' | 'store' | 'entity' | 'party' | 'period' | 'user' | 'rule' | 'settings' | 'export' | 'data';
  objectId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
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
  /** Duplicate pairs the CFO marked "not a duplicate". */
  dismissedDuplicates: string[];
  seq: number;
}
