import type { BooksState, ID } from '../core/types';
import type { InboxItem } from './inbox';
import { POLICY_LABEL } from '../core/compliance';
import { UST_LABEL, coverageGaps, fraudSignals, isNewSignal, isOpenConflict, risksDue, sodConflicts, ustOverdue } from '../core/controls';

/**
 * Phase 14 inbox: new fraud signals, segregation-of-duties conflicts not acknowledged, UST tests overdue,
 * risk reviews due and coverage gaps. Company-wide items (duty conflicts, coverage) need Corporate access.
 */
export function controlsInbox(state: BooksState, visible: Set<ID>, today: string, seesBank: boolean): InboxItem[] {
  const fresh = fraudSignals(state, { today, visible }).filter(isNewSignal);
  const ust = ustOverdue(state, today, visible);
  const items: InboxItem[] = [
    { key: 'ctl_signals', count: fresh.length, title: 'New fraud signals', detail: fresh.length ? `${fresh.slice(0, 2).map((s) => s.title).join('; ')}${fresh.length > 2 ? '…' : ''}: look at the evidence, then dismiss with a reason or escalate.` : 'No new signal.', to: '/controls/fraud', action: 'Review' },
    { key: 'ctl_ust', count: ust.length, title: 'UST tests or inspections overdue', detail: ust.length ? ust.slice(0, 3).map((r) => `${r.label}: ${UST_LABEL[r.kind].toLowerCase()}${r.nextDue ? ` due ${r.nextDue}` : ' (no record)'}`).join('; ') : 'Every tank test is current.', to: '/controls/ust', action: 'Schedule' },
  ];
  if (!seesBank) return items;
  const sod = sodConflicts(state).filter(isOpenConflict);
  const risks = risksDue(state, today);
  const gaps = coverageGaps(state, today);
  return [
    ...items,
    { key: 'ctl_sod', count: sod.length, title: 'Duty conflicts not acknowledged', detail: sod.length ? `${sod.slice(0, 2).map((c) => c.title).join('; ')}${sod.length > 2 ? '…' : ''}.` : 'Every conflict has a compensating control.', to: '/controls/sod', action: 'Review' },
    { key: 'ctl_risk', count: risks.length, title: 'Risk reviews due', detail: risks.length ? risks.map((r) => `${r.title} (${r.reviewDate})`).join('; ') : 'No risk review due in the next 14 days.', to: '/controls/risk', action: 'Review' },
    { key: 'ctl_cover', count: gaps.length, title: 'Insurance coverage gaps', detail: gaps.length ? `${gaps.map((g) => POLICY_LABEL[g.kind]).join(', ')}: no policy in force, a site left out, or a limit under the minimum.` : 'Every required coverage is in force.', to: '/controls/risk?tab=coverage', action: 'Insure' },
  ];
}
