import type { ID } from './types';

// ── Growth compass ───────────────────────────────────────────────────────
export type CompassStage = 'fix' | 'stabilize' | 'optimize' | 'replicate' | 'scale';

/** Every threshold the verdict uses. Percentages are whole percent unless the name says bps. */
export interface CompassSettings {
  /** Cost of equity: what the owners could earn elsewhere for this risk. A judgement call. */
  costOfEquityBps: number;
  /** Tax rate for NOPAT and the debt tax shield. Left out: the owner rate from the tax tables (federal + state). */
  taxRateBps?: number;
  /** The P&L basis the verdict reads. Left out: the covenant basis (Debt settings). */
  basis?: 'booked' | 'accrual';
  /** Free cash flow ÷ EBITDA at or above this counts as healthy cash conversion. */
  cashConversionMinPct: number;
  /** Cash above the reserve target, as % of the target, below which the reserve counts as thin. */
  reserveCushionPct: number;
  /** Share of measured stores (not new / ramping) that must earn more than the cost of capital to replicate. */
  valueStoreSharePct: number;
  /** DSCR after the new-store loan, hundredths (135 = 1.35x). Left out: the growth DSCR target. */
  dscrAfterTarget?: number;
  /** Debt ÷ EBITDA after the deal, hundredths. Left out: the growth leverage target. */
  leverageAfterTarget?: number;
  /** The newest store must reach this % of its ramp targets (gallons and inside). */
  rampMinPct: number;
  /** Replicate gates must hold this many months in a row before scaling. */
  scaleMonths: number;
  /** To scale, deployable cash plus free cash flow must fund the next store's equity within this many months. */
  scaleFundMonths: number;
  /** Store roles: a spread at or above this many points, with volume rising, is Grow. */
  growSpreadPts: number;
  /** Store roles: gallons up at least this % on the month before counts as rising. */
  growVolumePct: number;
  /** Store roles: a store open fewer than this many months is Watch. */
  watchMonths: number;
  /** Sensitivity shocks. */
  shockCpg: number;
  shockGallonsPct: number;
}

/** One month's verdict, kept so the inbox can say when the stage changes and so Scale can count months in a row. */
export interface CompassRecord {
  period: string;
  stage: CompassStage;
  /** Gate key → passed. */
  gates: Record<string, boolean>;
  /** All the gates up to Replicate passed this month. */
  replicateReady: boolean;
  roicPct: number | null;
  waccPct: number | null;
  at: string;
  by: ID;
}

export interface CompassState {
  settings: CompassSettings;
  history: CompassRecord[];
}
