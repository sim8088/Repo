import type { Attachment, ID } from './types';
import type { Cents } from './money';

// ── Compliance & documents (phase 9) ───────────────────────────────────
/** What an obligation is. Phase 11 (Tax) adds kinds and kind-specific detail without changing the model. */
export type ComplianceKind = 'sales_tax' | 'fuel_excise' | 'payroll' | 'income_tax' | 'property_tax' | 'annual_report' | 'other'
  // Phase 11 (Tax) kinds.
  | 'state_income' | 'estimated_tax' | 'tobacco_excise' | 'info_1099' | 'w2';
export type ComplianceStatus = 'not_started' | 'in_prep' | 'filed' | 'paid' | 'accepted';
export type RecurrenceEvery = 'once' | 'monthly' | 'quarterly' | 'annual';

export interface Recurrence {
  every: RecurrenceEvery;
  /** The first due date. Later ones keep its day of the month (clamped to the month's last day). */
  firstDue: string;
  /** No occurrences after this date. */
  until?: string;
  /** The period covered ends this many months before the due month (sales tax due the 20th covers the month before: 1). */
  coversMonthsBefore?: number;
}

/** One filing or payment of an obligation, keyed by its due date. */
export interface ComplianceOccurrence {
  dueDate: string;
  status: ComplianceStatus;
  filedOn?: string;
  paidOn?: string;
  paidAmount?: Cents;
  confirmation?: string;
  /** The payment in the books, when there is one. */
  txnId?: ID;
  note?: string;
  attachments: Attachment[];
  updatedBy: ID;
  updatedAt: string;
}

/** A dated obligation with recurrence: a return, a payment, an annual report. */
export interface ComplianceItem {
  id: ID;
  kind: ComplianceKind;
  title: string;
  agency: string;
  /** Form or return name, e.g. "Form 941". */
  form?: string;
  entityId?: ID;
  storeId?: ID;
  recurrence: Recurrence;
  /** Done needs a payment as well as the filing. */
  needsPayment: boolean;
  owner?: string;
  notes?: string;
  active: boolean;
  /** Kind-specific detail (Phase 11 adds structured fields per kind). */
  details?: Record<string, string>;
  /** Due date → what happened. Occurrences with no record are "not started". */
  occurrences: Record<string, ComplianceOccurrence>;
}

export type LicenseKind = 'beer' | 'tobacco' | 'food_service' | 'ust' | 'business' | 'lottery' | 'other';

export interface License {
  id: ID;
  kind: LicenseKind;
  name: string;
  storeId: ID;
  issuer: string;
  number: string;
  issuedOn?: string;
  expiresOn: string;
  renewalFee?: Cents;
  notes?: string;
  attachments: Attachment[];
  history: { expiresOn: string; renewedOn: string; by: ID }[];
}

export type PolicyKind = 'property' | 'general_liability' | 'pollution' | 'workers_comp' | 'auto' | 'umbrella' | 'liquor' | 'other';

export interface InsurancePolicy {
  id: ID;
  kind: PolicyKind;
  carrier: string;
  policyNo: string;
  storeIds: ID[];
  effective: string;
  expires: string;
  premium: Cents;
  deductible?: Cents;
  /** Per-occurrence limit. */
  limit?: Cents;
  /** The prepaid schedule that amortizes the premium, if any. */
  prepaidId?: ID;
  notes?: string;
  attachments: Attachment[];
}

export interface Lease {
  id: ID;
  /** We rent the premises (we are the tenant), or we let them to someone else (we are the landlord). */
  side: 'we_rent' | 'we_let';
  counterparty: string;
  partyId?: ID;
  storeId: ID;
  premises: string;
  start: string;
  end: string;
  monthlyRent: Cents;
  escalation?: string;
  renewalOptions?: string;
  noticeDays?: number;
  notes?: string;
  attachments: Attachment[];
}

export type NoticeStatus = 'open' | 'in_progress' | 'responded' | 'closed';

/** A letter from the IRS or the state: what it says, when to answer, what happened. */
export interface TaxNotice {
  id: ID;
  agency: string;
  noticeType: string;
  entityId?: ID;
  storeId?: ID;
  taxPeriod?: string;
  received: string;
  deadline: string;
  amount?: Cents;
  summary: string;
  status: NoticeStatus;
  response?: string;
  respondedOn?: string;
  outcome?: string;
  attachments: Attachment[];
  updatedAt: string;
  updatedBy: ID;
}

export type DocLinkKind = 'transaction' | 'party' | 'store' | 'month';

/** Vault metadata for any document: a standalone upload (with `attachment`) or one already on a record. Keyed by attachment id. */
export interface VaultDoc {
  id: ID;
  attachment?: Attachment;
  docType?: string;
  tags: string[];
  links: { kind: DocLinkKind; id: string }[];
  note?: string;
  updatedAt: string;
  updatedBy: ID;
}

export interface ComplianceState {
  items: ComplianceItem[];
  licenses: License[];
  policies: InsurancePolicy[];
  leases: Lease[];
  notices: TaxNotice[];
  docs: VaultDoc[];
}
