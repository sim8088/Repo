import type { Rule, BooksState } from './types';

const NOISE = new Set([
  'ACH', 'DEBIT', 'CREDIT', 'POS', 'PURCHASE', 'PMT', 'PAYMENT', 'WEB', 'ONLINE', 'CHECKCARD', 'CHECK', 'CARD',
  'DBT', 'CRD', 'ELECTRONIC', 'BILL', 'PAY', 'TRANSFER', 'XFER', 'ID', 'CO', 'INC', 'LLC', 'THE', 'RECURRING', 'AUTOPAY',
]);

/** Turn a raw bank description into the stable key a learned rule matches on. */
export function ruleKey(description: string): string {
  const words = description
    .toUpperCase()
    .replace(/[^A-Z ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NOISE.has(w));
  return words.slice(0, 2).join(' ');
}

export function ruleConfidence(r: Pick<Rule, 'hits' | 'overrides' | 'origin'>): number {
  // Manual rules start trusted; learned rules earn trust with use (Laplace-smoothed).
  const prior = r.origin === 'manual' ? 4 : 1;
  return (r.hits + prior) / (r.hits + r.overrides + prior + 1);
}

export interface RuleMatch {
  rule: Rule;
  confidence: number;
}

/** The best active rule for a description: the longest matching text wins, then confidence. */
export function suggest(state: Pick<BooksState, 'rules'>, description: string): RuleMatch | null {
  const d = description.toUpperCase();
  let best: RuleMatch | null = null;
  for (const r of state.rules) {
    if (!r.active || !r.contains.trim()) continue;
    if (!d.includes(r.contains.toUpperCase())) continue;
    const m = { rule: r, confidence: ruleConfidence(r) };
    if (!best || r.contains.length > best.rule.contains.length || (r.contains.length === best.rule.contains.length && m.confidence > best.confidence)) {
      best = m;
    }
  }
  return best;
}
