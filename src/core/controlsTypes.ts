import type { Attachment, ID, Role } from './types';
import type { Cents } from './money';
import type { PolicyKind } from './complianceTypes';

// ── Controls & risk (phase 14) ─────────────────────────────────────────
/** What an approval limit applies to. Write-offs are journal entries made from a write-off template. */
export type LimitKind = 'bill' | 'journal' | 'writeoff' | 'rate_change';

/** Who may approve how much: `maxCents` null = no limit, 0 = may not approve this kind. */
export interface ApprovalLimit { role: Role; kind: LimitKind; maxCents: Cents | null }

/** A segregation-of-duties conflict someone looked at and accepted, with the reason (a compensating control). */
export interface SodAck {
  /** `cfg:<role>:<area>` for a configuration conflict, `act:<area>:<record id>:<rule>` for an activity conflict. */
  key: string;
  reason: string;
  /** A configuration acknowledgment that also covers the activity of users with that role in that area. */
  coversActivity?: boolean;
  by: ID;
  at: string;
}

/** A fraud signal someone looked into and closed, with the reason. */
export interface SignalDismissal { key: string; reason: string; by: ID; at: string }
/** A fraud signal passed on for follow-up, as a note. */
export interface SignalEscalation { key: string; note: string; by: ID; at: string }

export interface CashControlSettings {
  /** A store count or HQ receipt at or above this needs a second counter. */
  dualCountAboveCents: Cents;
  /** Second counts are expected from this business date (the day the control started). */
  dualFrom: string;
  /** Refuse to record a count above the amount without a second counter. */
  enforceDual: boolean;
  /** HQ receipts are counted blind: the pickup amount stays hidden until HQ enters what it counted. */
  blindHq: boolean;
  /** Repeated small shortages: this many (each under materiality) by one person within the window is a pattern. */
  patternMin: number;
  patternWindowDays: number;
}

/** A drive-off someone wrote down at the store (pumped and left without paying). */
export interface DriveOff { id: ID; storeId: ID; date: string; grade?: string; gallons: number; amount: Cents; pump?: string; note?: string; by: ID; at: string }

export type PosExceptionKind = 'void' | 'refund' | 'no_sale' | 'discount';

/** One row of a POS exception report: a cashier's voids / refunds / no-sales for a day. */
export interface PosException { id: ID; hash: string; batchId: string; storeId: ID; date: string; cashier: string; kind: PosExceptionKind; count: number; amount: Cents }
export interface PosExceptionBatch { id: ID; fileName: string; importedAt: string; by: ID; added: number; skipped: number; total: Cents }

export interface Risk {
  id: ID;
  title: string;
  category: 'operational' | 'financial' | 'compliance' | 'environmental' | 'safety' | 'technology' | 'people';
  /** 1 (rare) – 5 (almost certain). */
  likelihood: number;
  /** 1 (minor) – 5 (severe). */
  impact: number;
  owner: string;
  mitigation: string;
  reviewDate: string;
  storeId?: ID;
  /** The policies that transfer some of this risk. */
  policyIds?: ID[];
  status: 'open' | 'closed';
  updatedBy: ID;
  updatedAt: string;
}

/** A coverage the business should carry, by policy type. Satisfied by an in-force policy of that kind or one listed in `policyIds`. */
export interface CoverageNeed {
  kind: PolicyKind;
  required: boolean;
  /** Minimum per-occurrence limit we want. */
  minLimitCents?: Cents;
  /** Policies of another kind that also give this cover (e.g. a package policy that includes general liability). */
  policyIds?: ID[];
  note?: string;
}

export interface InsuranceClaim {
  id: ID;
  policyId?: ID;
  storeId: ID;
  date: string;
  description: string;
  /** What we claimed (before deductible). */
  amount: Cents;
  /** What the carrier paid. */
  paid: Cents;
  status: 'open' | 'paid' | 'denied' | 'closed';
  /** The receivable that tracks the money owed to us, if any. */
  receivableId?: ID;
  note?: string;
  by: ID;
  at: string;
}

export type UstTestKind = 'tank_tightness' | 'line_tightness' | 'line_leak_detector' | 'cathodic_protection' | 'spill_overfill' | 'inspection' | 'financial_responsibility';

/** One UST test, inspection or document for a tank (or the whole site when tankId is empty). */
export interface UstRecord {
  id: ID;
  storeId: ID;
  /** Empty = the whole site (e.g. financial responsibility, the facility inspection). */
  tankId?: ID;
  kind: UstTestKind;
  date: string;
  result: 'pass' | 'fail' | 'n/a';
  vendor?: string;
  /** Overrides the standard interval. */
  nextDue?: string;
  note?: string;
  /** The Phase 9 maintenance entry this came from, if any. */
  maintenanceId?: ID;
  attachments: Attachment[];
  by: ID;
  at: string;
}

/** A change to a vendor's bank account (also read from the audit log). */
export interface BankAccountChange { id: ID; partyId: ID; from?: string; to?: string; at: string; by: ID; note?: string }

export interface ControlsState {
  limits: ApprovalLimit[];
  sodAcks: SodAck[];
  dismissals: SignalDismissal[];
  escalations: SignalEscalation[];
  cash: CashControlSettings;
  driveOffs: DriveOff[];
  posExceptions: PosException[];
  posBatches: PosExceptionBatch[];
  risks: Risk[];
  coverage: CoverageNeed[];
  claims: InsuranceClaim[];
  ust: UstRecord[];
  /** Months between UST tests by kind (overrides the standard intervals). */
  ustIntervals: Partial<Record<UstTestKind, number>>;
  bankChanges: BankAccountChange[];
}
