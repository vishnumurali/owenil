/**
 * Recurring schedule maths on calendar dates ("YYYY-MM-DD", no time zone).
 *
 * Occurrence n is always computed from the start date (never by chaining from
 * the previous occurrence), so a schedule anchored on the 31st yields
 * Jan 31 → Feb 28/29 → Mar 31 rather than drifting to the 28th. This matches
 * PostgreSQL's `date + n * interval '1 month'`, which the server-side
 * generator (`public.generate_due_recurring_expenses`) uses.
 */
export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  yearly: 'Yearly',
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISODate(s: string): { y: number; m: number; d: number } {
  const m = DATE_RE.exec(s);
  if (!m) throw new Error(`Invalid date: ${s}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) throw new Error(`Invalid date: ${s}`);
  return { y, m: mo, d };
}

export function toISODate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parseISODate(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return toISODate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function addMonthsClamped(date: string, months: number): string {
  const { y, m, d } = parseISODate(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toISODate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** The n-th occurrence (n = 0 is the start date). */
export function occurrenceDate(start: string, frequency: Frequency, n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error('n must be a non-negative integer');
  switch (frequency) {
    case 'weekly':
      return addDays(start, 7 * n);
    case 'monthly':
      return addMonthsClamped(start, n);
    case 'quarterly':
      return addMonthsClamped(start, 3 * n);
    case 'yearly':
      return addMonthsClamped(start, 12 * n);
  }
}

/** Occurrences on or after `from`, up to `count`, not past `endDate`. */
export function upcomingOccurrences(start: string, frequency: Frequency, from: string, count: number, endDate?: string | null): string[] {
  const out: string[] = [];
  for (let n = 0; out.length < count && n < 5000; n++) {
    const d = occurrenceDate(start, frequency, n);
    if (endDate && d > endDate) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** All occurrence dates in [start, today] (inclusive) not past endDate — what the server would generate. */
export function dueOccurrences(start: string, frequency: Frequency, today: string, endDate?: string | null): string[] {
  const out: string[] = [];
  for (let n = 0; n < 5000; n++) {
    const d = occurrenceDate(start, frequency, n);
    if (d > today || (endDate && d > endDate)) break;
    out.push(d);
  }
  return out;
}

/** Today's date in a given IANA time zone as YYYY-MM-DD. */
export function todayInTimeZone(timeZone = 'UTC', now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
