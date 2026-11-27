/** Dates are plain 'YYYY-MM-DD' strings in America/Chicago. Periods are 'YYYY-MM'. */
export const TIMEZONE = 'America/Chicago';

export function todayInChicago(now = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return p; // en-CA gives YYYY-MM-DD
}

export function periodOf(date: string): string {
  return date.slice(0, 7);
}

export function isValidDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const dt = new Date(d + 'T12:00:00Z');
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}

export function addDays(date: string, n: number): string {
  const dt = new Date(date + 'T12:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

export function dayOfWeek(date: string): number {
  return new Date(date + 'T12:00:00Z').getUTCDay();
}

export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function shortDate(date: string): string {
  const dt = new Date(date + 'T12:00:00Z');
  return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function lastDayOfPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10);
}

export function periodsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
