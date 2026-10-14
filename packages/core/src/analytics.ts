import { addDays, parseISODate, toISODate } from './recurrence';

/**
 * Analytics aggregations. All functions take rows for a SINGLE currency;
 * callers must filter (or explicitly convert with a recorded rate snapshot)
 * before aggregating — different currencies are never summed implicitly.
 */
export interface SpendingRow {
  expenseId: string;
  date: string; // YYYY-MM-DD
  description: string;
  currency: string;
  categoryId: string | null;
  groupId: string | null;
  totalMinor: number;
  /** The viewer's share of the expense (their consumption). */
  myShareMinor: number;
  /** What the viewer paid. */
  myPaidMinor: number;
  isRecurring: boolean;
  payers: { userId: string; amountMinor: number }[];
}

export type Measure = 'myShareMinor' | 'myPaidMinor' | 'totalMinor';

export interface PeriodTotal {
  period: string;
  amountMinor: number;
}

function assertSingleCurrency(rows: SpendingRow[]): void {
  const set = new Set(rows.map((r) => r.currency));
  if (set.size > 1) throw new Error('Analytics rows must be in a single currency; convert or filter first');
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** Monday-based week start for a date. */
export function weekStart(date: string): string {
  const { y, m, d } = parseISODate(date);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

function monthRange(fromMonth: string, toMonth: string): string[] {
  const out: string[] = [];
  let [y, m] = fromMonth.split('-').map(Number) as [number, number];
  const [ty, tm] = toMonth.split('-').map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function totalsByMonth(rows: SpendingRow[], measure: Measure, fromMonth?: string, toMonth?: string): PeriodTotal[] {
  assertSingleCurrency(rows);
  const map = new Map<string, number>();
  for (const r of rows) map.set(monthKey(r.date), (map.get(monthKey(r.date)) ?? 0) + r[measure]);
  const keys = [...map.keys()].sort();
  const from = fromMonth ?? keys[0];
  const to = toMonth ?? keys[keys.length - 1];
  if (!from || !to) return [];
  return monthRange(from, to).map((period) => ({ period, amountMinor: map.get(period) ?? 0 }));
}

export function totalsByWeek(rows: SpendingRow[], measure: Measure, weeks: number, endDate: string): PeriodTotal[] {
  assertSingleCurrency(rows);
  const lastStart = weekStart(endDate);
  const starts: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) starts.push(addDays(lastStart, -7 * i));
  const map = new Map<string, number>(starts.map((s) => [s, 0]));
  for (const r of rows) {
    const k = weekStart(r.date);
    if (map.has(k)) map.set(k, map.get(k)! + r[measure]);
  }
  return starts.map((period) => ({ period, amountMinor: map.get(period)! }));
}

export function totalsByYear(rows: SpendingRow[], measure: Measure): PeriodTotal[] {
  assertSingleCurrency(rows);
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.date.slice(0, 4), (map.get(r.date.slice(0, 4)) ?? 0) + r[measure]);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, amountMinor]) => ({ period, amountMinor }));
}

export function totalsBy<K extends 'categoryId' | 'groupId'>(rows: SpendingRow[], key: K, measure: Measure): { key: string | null; amountMinor: number }[] {
  assertSingleCurrency(rows);
  const map = new Map<string | null, number>();
  for (const r of rows) map.set(r[key], (map.get(r[key]) ?? 0) + r[measure]);
  return [...map.entries()].map(([k, amountMinor]) => ({ key: k, amountMinor })).filter((x) => x.amountMinor !== 0).sort((a, b) => b.amountMinor - a.amountMinor);
}

export function contributionsByPayer(rows: SpendingRow[]): { userId: string; amountMinor: number }[] {
  assertSingleCurrency(rows);
  const map = new Map<string, number>();
  for (const r of rows) for (const p of r.payers) map.set(p.userId, (map.get(p.userId) ?? 0) + p.amountMinor);
  return [...map.entries()].map(([userId, amountMinor]) => ({ userId, amountMinor })).sort((a, b) => b.amountMinor - a.amountMinor);
}

export function largestExpenses(rows: SpendingRow[], n = 5, measure: Measure = 'totalMinor'): SpendingRow[] {
  return [...rows].sort((a, b) => b[measure] - a[measure] || a.date.localeCompare(b.date)).slice(0, n);
}

export function sumMeasure(rows: SpendingRow[], measure: Measure): number {
  assertSingleCurrency(rows);
  return rows.reduce((a, r) => a + r[measure], 0);
}

/** Percentage change from previous to current, or null when previous is zero. */
export function percentChange(previous: number, current: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export interface BudgetDef {
  id: string;
  categoryId: string | null;
  groupId: string | null;
  amountMinor: number;
  currency: string;
  period: 'monthly' | 'yearly';
  alertThresholdPct: number;
}

export interface BudgetStatus {
  budget: BudgetDef;
  periodStart: string;
  periodEnd: string;
  spentMinor: number;
  remainingMinor: number;
  ratio: number;
  state: 'ok' | 'warning' | 'over';
}

export function budgetPeriod(period: 'monthly' | 'yearly', today: string): { start: string; end: string } {
  const { y, m } = parseISODate(today);
  if (period === 'yearly') return { start: toISODate(y, 1, 1), end: toISODate(y, 12, 31) };
  const end = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: toISODate(y, m, 1), end: toISODate(y, m, end) };
}

/** Budget vs actual, measured on the viewer's own share of spending. */
export function evaluateBudgets(budgets: BudgetDef[], rows: SpendingRow[], today: string): BudgetStatus[] {
  return budgets.map((budget) => {
    const { start, end } = budgetPeriod(budget.period, today);
    const spent = rows
      .filter(
        (r) =>
          r.currency === budget.currency &&
          r.date >= start &&
          r.date <= end &&
          (budget.categoryId === null || r.categoryId === budget.categoryId) &&
          (budget.groupId === null || r.groupId === budget.groupId),
      )
      .reduce((a, r) => a + r.myShareMinor, 0);
    const ratio = budget.amountMinor > 0 ? spent / budget.amountMinor : 0;
    const state: BudgetStatus['state'] = ratio > 1 ? 'over' : ratio * 100 >= budget.alertThresholdPct ? 'warning' : 'ok';
    return { budget, periodStart: start, periodEnd: end, spentMinor: spent, remainingMinor: budget.amountMinor - spent, ratio, state };
  });
}
