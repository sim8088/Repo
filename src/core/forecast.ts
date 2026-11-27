import type { BooksState, ForecastItem, ID } from './types';
import { addDays, daysBetween, dayOfWeek } from './dates';
import { ruleKey } from './rules';
import { poolBalance } from './cash';
import { balanceAsOf } from './reports';

/** A cash movement the history says will happen again. */
export interface RecurringPattern {
  key: string;
  label: string;
  cadence: 'weekly' | 'monthly' | 'weekly_total';
  /** Signed average: + in, − out. For weekly_total, the average weekly total. */
  amount: number;
  /** weekly: day of week (0 = Sunday); monthly: day of month. */
  anchor: number;
  occurrences: number;
  lastDate: string;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mode(xs: number[]): number {
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/**
 * Find recurring movements on a bank account from the last `lookbackDays` of the books.
 * Lines are grouped by party (or by the stable part of the description) and direction; each group is
 * weekly (gaps of 6–8 days), monthly (27–32 days), or frequent (gaps ≤ 4: projected as a weekly total).
 */
export function detectRecurring(state: BooksState, accountId: ID, asOf: string, lookbackDays = 91): RecurringPattern[] {
  const from = addDays(asOf, -lookbackDays);
  const groups = new Map<string, { label: string; byDate: Map<string, number> }>();
  for (const t of state.transactions) {
    if (t.deleted || t.kind === 'opening' || t.date <= from || t.date > asOf) continue;
    for (const l of t.lines) {
      if (l.accountId !== accountId || l.system) continue;
      const amt = l.debit - l.credit;
      if (!amt) continue;
      const party = t.partyId ? state.parties.find((p) => p.id === t.partyId) : undefined;
      const base = party ? `p:${party.id}` : `d:${ruleKey(t.description) || t.description.toUpperCase()}`;
      const key = `${base}|${amt > 0 ? 'in' : 'out'}`;
      const g = groups.get(key) ?? { label: party?.name ?? (ruleKey(t.description) || t.description), byDate: new Map() };
      g.byDate.set(t.date, (g.byDate.get(t.date) ?? 0) + amt);
      groups.set(key, g);
    }
  }
  const out: RecurringPattern[] = [];
  for (const [key, g] of groups) {
    const dates = [...g.byDate.keys()].sort();
    if (dates.length < 3) continue;
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
    const gap = median(gaps);
    const amounts = dates.map((d) => g.byDate.get(d)!);
    const last = dates.at(-1)!;
    const recent = amounts.slice(-4);
    const avg = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
    if (gap >= 6 && gap <= 8) {
      out.push({ key, label: g.label, cadence: 'weekly', amount: avg, anchor: mode(dates.map(dayOfWeek)), occurrences: dates.length, lastDate: last });
    } else if (gap >= 27 && gap <= 32) {
      out.push({ key, label: g.label, cadence: 'monthly', amount: avg, anchor: mode(dates.map((d) => Number(d.slice(8, 10)))), occurrences: dates.length, lastDate: last });
    } else if (gap <= 4 && dates.length >= 8) {
      // Frequent (deposits several times a week): average of the last four full weeks.
      const weeks = [0, 1, 2, 3].map((w) => {
        const end = addDays(asOf, -7 * w);
        const start = addDays(end, -6);
        return dates.filter((d) => d >= start && d <= end).reduce((a, d) => a + g.byDate.get(d)!, 0);
      });
      out.push({ key, label: g.label, cadence: 'weekly_total', amount: Math.round(weeks.reduce((a, b) => a + b, 0) / 4), anchor: 3, occurrences: dates.length, lastDate: last });
    }
  }
  return out.sort((a, b) => Math.abs(b.amount) * (b.cadence === 'monthly' ? 1 : 4) - Math.abs(a.amount) * (a.cadence === 'monthly' ? 1 : 4));
}

export interface ForecastEvent {
  date: string;
  label: string;
  amount: number;
  source: 'pattern' | 'manual' | 'cash_in_transit' | 'bill';
  key: string;
  /** A known item (e.g. an approved bill) that stands in for the nearest occurrence of this detected pattern. */
  replaces?: string;
}

/** Cash events another module knows about ahead of time (phase 5: approved and scheduled bills). */
export type ForecastSource = (state: BooksState, accountId: ID, asOf: string, end: string) => ForecastEvent[];
const SOURCES: ForecastSource[] = [];
export function addForecastSource(fn: ForecastSource): void {
  if (!SOURCES.includes(fn)) SOURCES.push(fn);
}

export interface ForecastWeek {
  start: string;
  end: string;
  inflows: number;
  outflows: number;
  ending: number;
  belowFloor: boolean;
  events: ForecastEvent[];
}

export interface Forecast {
  asOf: string;
  opening: number;
  floor: number;
  weeks: ForecastWeek[];
  /** Projected balance at the end of day asOf + n. */
  at: (days: number) => number;
  minBalance: number;
  minDate: string;
  patterns: RecurringPattern[];
}

function monthlyDates(anchor: number, from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (let i = 0; i < 5; i++) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const d = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(anchor, last)).padStart(2, '0')}`;
    if (d > from && d <= to) out.push(d);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * 13-week rolling cash forecast for one bank account, starting from the book balance today.
 * Book balance already reflects checks written but not cleared, so they aren't added again.
 */
export function forecast(state: BooksState, accountId: ID, asOf: string, opts: { weeks?: number; disabled?: Set<string>; items?: ForecastItem[]; sources?: ForecastSource[] } = {}): Forecast {
  const nWeeks = opts.weeks ?? 13;
  const end = addDays(asOf, nWeeks * 7);
  const opening = balanceAsOf(state, accountId, asOf);
  const floor = state.accounts.find((a) => a.id === accountId)?.floorCents ?? 0;
  const disabled = opts.disabled ?? new Set(state.settings.forecastDisabled);
  const patterns = detectRecurring(state, accountId, asOf);
  const events: ForecastEvent[] = [];
  for (const p of patterns) {
    if (disabled.has(p.key)) continue;
    if (p.cadence === 'monthly') {
      for (const d of monthlyDates(p.anchor, asOf, end)) events.push({ date: d, label: p.label, amount: p.amount, source: 'pattern', key: p.key });
    } else {
      let d = addDays(asOf, 1);
      while (dayOfWeek(d) !== p.anchor) d = addDays(d, 1);
      for (; d <= end; d = addDays(d, 7)) events.push({ date: d, label: p.label + (p.cadence === 'weekly_total' ? ' (weekly total)' : ''), amount: p.amount, source: 'pattern', key: p.key });
    }
  }
  for (const it of opts.items ?? state.forecastItems) {
    if (!it.active) continue;
    const step = it.cadence === 'weekly' ? 7 : it.cadence === 'biweekly' ? 14 : 0;
    if (it.cadence === 'monthly') {
      for (const d of monthlyDates(Number(it.start.slice(8, 10)), addDays(it.start, -1) > asOf ? addDays(it.start, -1) : asOf, it.end && it.end < end ? it.end : end)) events.push({ date: d, label: it.label, amount: it.amount, source: 'manual', key: it.id });
    } else if (step) {
      for (let d = it.start; d <= end && (!it.end || d <= it.end); d = addDays(d, step)) if (d > asOf) events.push({ date: d, label: it.label, amount: it.amount, source: 'manual', key: it.id });
    } else if (it.start > asOf && it.start <= end) events.push({ date: it.start, label: it.label, amount: it.amount, source: 'manual', key: it.id });
  }
  for (const src of opts.sources ?? SOURCES) {
    for (const e of src(state, accountId, asOf, end)) {
      if (e.replaces) {
        // Drop the detected occurrence this known item replaces, so it isn't counted twice.
        const i = events.findIndex((x) => x.source === 'pattern' && x.key === e.replaces && Math.abs(daysBetween(x.date, e.date)) <= 10);
        if (i >= 0) events.splice(i, 1);
      }
      events.push(e);
    }
  }
  // Cash already at HQ gets deposited in the first week (unless the deposit pattern is switched off).
  const pool = poolBalance(state, asOf);
  if (pool > 0 && !disabled.has('cash_in_transit')) events.push({ date: addDays(asOf, 1), label: 'Cash at HQ waiting to be deposited', amount: pool, source: 'cash_in_transit', key: 'cash_in_transit' });
  events.sort((a, b) => a.date.localeCompare(b.date));

  const weeks: ForecastWeek[] = [];
  let bal = opening;
  let minBalance = opening;
  let minDate = asOf;
  const daily = new Map<string, number>();
  for (let w = 0; w < nWeeks; w++) {
    const start = addDays(asOf, 1 + w * 7);
    const wEnd = addDays(start, 6);
    const ev = events.filter((e) => e.date >= start && e.date <= wEnd);
    let inflows = 0;
    let outflows = 0;
    for (let d = start; d <= wEnd; d = addDays(d, 1)) {
      for (const e of ev) if (e.date === d) { bal += e.amount; if (e.amount > 0) inflows += e.amount; else outflows -= e.amount; }
      daily.set(d, bal);
      if (bal < minBalance) { minBalance = bal; minDate = d; }
    }
    weeks.push({ start, end: wEnd, inflows, outflows, ending: bal, belowFloor: bal < floor, events: ev });
  }
  return {
    asOf, opening, floor, weeks, minBalance, minDate, patterns,
    at: (n: number) => (n <= 0 ? opening : daily.get(addDays(asOf, n)) ?? bal),
  };
}

// ── Editing forecast inputs ──────────────────────────────────────────────
import type { Books } from './books';
import { ValidationError } from './books';
import type { User } from './types';

export function saveForecastItem(books: Books, actor: User, item: ForecastItem): void {
  books.require(actor, 'bank.reconcile', 'edit the cash forecast');
  const errs: string[] = [];
  if (!item.label.trim()) errs.push('Name the item, e.g. "Property tax HM13".');
  if (!Number.isSafeInteger(item.amount) || item.amount === 0) errs.push('Enter an amount.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.start)) errs.push('Pick a start date.');
  if (errs.length) throw new ValidationError(errs);
  const list = books.state.forecastItems;
  const i = list.findIndex((x) => x.id === item.id);
  const before = i >= 0 ? { ...list[i] } : undefined;
  if (i >= 0) list[i] = item; else list.push(item);
  books.audit(actor, { action: before ? 'update' : 'create', objectType: 'forecast', objectId: item.id, summary: `${before ? 'Updated' : 'Added'} forecast item ${item.label}`, before, after: item });
  books.changed();
}

export function setPatternIncluded(books: Books, actor: User, key: string, label: string, included: boolean): void {
  books.require(actor, 'bank.reconcile', 'edit the cash forecast');
  const d = new Set(books.state.settings.forecastDisabled);
  if (included) d.delete(key); else d.add(key);
  books.state.settings.forecastDisabled = [...d];
  books.audit(actor, { action: included ? 'include' : 'exclude', objectType: 'forecast', objectId: key, summary: `${included ? 'Included' : 'Left out'} recurring item “${label}” in the forecast` });
  books.changed();
}
