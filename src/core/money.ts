/** All money is integer cents. Never store or add floating dollars. */
export type Cents = number;

export function assertCents(v: number, label = 'amount'): void {
  if (!Number.isSafeInteger(v)) throw new Error(`${label} must be a whole number of cents (got ${v}).`);
}

/** Parse "$4,077.40", "(12.50)", "-12.5", "1200" into cents. Returns null when it isn't a number. */
export function parseMoney(input: string): Cents | null {
  let s = input.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (!/^\d+(\.\d{0,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  return neg ? -cents : cents;
}

const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Accounting format: negatives in parentheses, no minus signs. */
export function formatMoney(c: Cents, opts: { dollarSign?: boolean; whole?: boolean } = {}): string {
  const abs = Math.abs(c) / 100;
  const body = (opts.dollarSign ? '$' : '') + (opts.whole ? fmt0.format(Math.round(abs)) : fmt.format(abs));
  return c < 0 ? `(${body})` : body;
}

export function sum(values: Cents[]): Cents {
  let t = 0;
  for (const v of values) t += v;
  return t;
}

/**
 * Split an amount by weights so the parts always add back to the exact total
 * (largest-remainder method). Weights can be percentages or any positive numbers.
 */
export function allocate(total: Cents, weights: number[]): Cents[] {
  assertCents(total);
  if (weights.length === 0) throw new Error('Allocation needs at least one share.');
  if (weights.some((w) => !(w >= 0))) throw new Error('Allocation shares cannot be negative.');
  const wsum = weights.reduce((a, b) => a + b, 0);
  if (wsum <= 0) throw new Error('Allocation shares must add up to more than zero.');
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / wsum);
  const floors = raw.map(Math.floor);
  let left = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) { if (left <= 0) break; floors[i] += 1; left -= 1; }
  return floors.map((f) => f * sign);
}
