import { describe, expect, it } from 'vitest';
import {
  convertMinor,
  dueOccurrences,
  evaluateBudgets,
  expensePayloadSchema,
  formatMoney,
  minorToDecimalString,
  occurrenceDate,
  parseCSV,
  parseMoney,
  percentChange,
  toCSV,
  totalsBy,
  totalsByMonth,
  totalsByWeek,
  upcomingOccurrences,
  weekStart,
  type SpendingRow,
} from '../src';

describe('money parsing and formatting', () => {
  it('parses decimal strings without floating point error', () => {
    expect(parseMoney('0.1', 'INR')).toBe(10);
    expect(parseMoney('0.29', 'INR')).toBe(29);
    expect(parseMoney('1,234.56', 'INR')).toBe(123456);
    expect(parseMoney('3000', 'INR')).toBe(300000);
    expect(parseMoney('.5', 'USD')).toBe(50);
    expect(parseMoney('10.500', 'INR')).toBe(1050);
    expect(parseMoney('1.234', 'KWD')).toBe(1234);
  });
  it('enforces currency precision', () => {
    expect(parseMoney('1.234', 'INR')).toBeNull();
    expect(parseMoney('100.5', 'JPY')).toBeNull();
    expect(parseMoney('100', 'JPY')).toBe(100);
    expect(parseMoney('abc', 'INR')).toBeNull();
    expect(parseMoney('', 'INR')).toBeNull();
    expect(parseMoney('1.2.3', 'INR')).toBeNull();
    expect(parseMoney('99999999999999999', 'INR')).toBeNull();
  });
  it('converts minor units to decimal strings', () => {
    expect(minorToDecimalString(123456, 'INR')).toBe('1234.56');
    expect(minorToDecimalString(5, 'INR')).toBe('0.05');
    expect(minorToDecimalString(-5, 'USD')).toBe('-0.05');
    expect(minorToDecimalString(1234, 'JPY')).toBe('1234');
    expect(minorToDecimalString(1234, 'KWD')).toBe('1.234');
  });
  it('formats with the Indian grouping by default', () => {
    expect(formatMoney(300000, 'INR')).toBe('₹3,000.00');
    expect(formatMoney(1234567890, 'INR')).toBe('₹1,23,45,678.90');
    expect(formatMoney(300000, 'INR', { trimZeroFraction: true })).toBe('₹3,000');
    expect(formatMoney(1500, 'JPY', { locale: 'en-US' })).toBe('¥1,500');
    expect(formatMoney(-2550, 'USD', { locale: 'en-US' })).toBe('-$25.50');
  });
  it('converts between currencies with an explicit rate snapshot', () => {
    expect(convertMinor(10000, 'USD', 'INR', '83.25')).toBe(832500); // $100 → ₹8,325
    expect(convertMinor(100, 'INR', 'USD', '0.012')).toBe(1); // ₹1 → $0.012 → 1¢
    expect(convertMinor(1000, 'JPY', 'INR', '0.5612')).toBe(56120); // ¥1,000 → ₹561.20
    expect(convertMinor(105, 'INR', 'JPY', '1.7')).toBe(2); // ₹1.05 → ¥1.785 → ¥2
    expect(convertMinor(5000, 'INR', 'INR', '2')).toBe(5000);
    expect(() => convertMinor(100, 'USD', 'INR', '0')).toThrow();
    expect(() => convertMinor(100, 'USD', 'INR', '-1')).toThrow();
  });
});

describe('recurrence', () => {
  it('keeps month-end anchors without drifting', () => {
    expect([0, 1, 2, 3].map((n) => occurrenceDate('2026-01-31', 'monthly', n))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrenceDate('2028-01-31', 'monthly', 1)).toBe('2028-02-29');
  });
  it('supports weekly, quarterly and yearly', () => {
    expect(occurrenceDate('2026-10-14', 'weekly', 2)).toBe('2026-10-28');
    expect(occurrenceDate('2026-11-30', 'quarterly', 1)).toBe('2027-02-28');
    expect(occurrenceDate('2028-02-29', 'yearly', 1)).toBe('2029-02-28');
    expect(occurrenceDate('2028-02-29', 'yearly', 4)).toBe('2032-02-29');
  });
  it('lists due and upcoming occurrences', () => {
    expect(dueOccurrences('2026-08-01', 'monthly', '2026-10-14')).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(dueOccurrences('2026-08-01', 'monthly', '2026-10-14', '2026-09-15')).toEqual(['2026-08-01', '2026-09-01']);
    expect(upcomingOccurrences('2026-08-01', 'monthly', '2026-10-14', 2)).toEqual(['2026-11-01', '2026-12-01']);
  });
});

const row = (p: Partial<SpendingRow>): SpendingRow => ({
  expenseId: Math.random().toString(36),
  date: '2026-10-01',
  description: 'x',
  currency: 'INR',
  categoryId: null,
  groupId: null,
  totalMinor: 0,
  myShareMinor: 0,
  myPaidMinor: 0,
  isRecurring: false,
  payers: [],
  ...p,
});

describe('analytics', () => {
  const rows = [
    row({ date: '2026-08-03', categoryId: 'food', myShareMinor: 1000, totalMinor: 3000 }),
    row({ date: '2026-10-05', categoryId: 'food', myShareMinor: 500, totalMinor: 500 }),
    row({ date: '2026-10-06', categoryId: 'rent', myShareMinor: 20000, totalMinor: 60000 }),
  ];
  it('aggregates by month with gaps filled', () => {
    expect(totalsByMonth(rows, 'myShareMinor')).toEqual([
      { period: '2026-08', amountMinor: 1000 },
      { period: '2026-09', amountMinor: 0 },
      { period: '2026-10', amountMinor: 20500 },
    ]);
  });
  it('aggregates by Monday-based week', () => {
    expect(weekStart('2026-10-14')).toBe('2026-10-12');
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    expect(weekStart('2026-10-18')).toBe('2026-10-12');
    const w = totalsByWeek(rows, 'myShareMinor', 2, '2026-10-14');
    expect(w).toEqual([
      { period: '2026-10-05', amountMinor: 20500 },
      { period: '2026-10-12', amountMinor: 0 },
    ]);
  });
  it('aggregates by category, largest first', () => {
    expect(totalsBy(rows, 'categoryId', 'myShareMinor')).toEqual([
      { key: 'rent', amountMinor: 20000 },
      { key: 'food', amountMinor: 1500 },
    ]);
  });
  it('refuses to mix currencies', () => {
    expect(() => totalsByMonth([...rows, row({ currency: 'USD' })], 'myShareMinor')).toThrow(/single currency/);
  });
  it('evaluates budgets against the current period', () => {
    const [s] = evaluateBudgets(
      [{ id: 'b', categoryId: 'food', groupId: null, amountMinor: 600, currency: 'INR', period: 'monthly', alertThresholdPct: 80 }],
      rows,
      '2026-10-14',
    );
    expect(s!.spentMinor).toBe(500);
    expect(s!.state).toBe('warning');
    expect(percentChange(1000, 1500)).toBe(50);
    expect(percentChange(0, 10)).toBeNull();
  });
});

describe('exports', () => {
  it('escapes CSV and blocks formula injection', () => {
    const csv = toCSV(['desc', 'amount'], [['Dinner, "fancy"', 12.5], ['=HYPERLINK("x")', -3], ['line\nbreak', null]]);
    const parsed = parseCSV(csv);
    expect(parsed[0]).toEqual(['desc', 'amount']);
    expect(parsed[1]).toEqual(['Dinner, "fancy"', '12.5']);
    expect(parsed[2]).toEqual(['\'=HYPERLINK("x")', '-3']);
    expect(parsed[3]).toEqual(['line\nbreak', '']);
  });
});

describe('expense payload validation', () => {
  const base = {
    group_id: null,
    description: 'Dinner',
    amount_minor: 300000,
    currency: 'INR',
    expense_date: '2026-10-14',
    category_id: null,
    notes: null,
    tags: [],
    split_method: 'equal',
    payers: [{ user_id: '11111111-1111-4111-8111-111111111111', amount_minor: 300000 }],
    participants: [{ user_id: '11111111-1111-4111-8111-111111111111', included: true, value: null }],
    splits: [{ user_id: '11111111-1111-4111-8111-111111111111', amount_minor: 300000 }],
    items: [],
    receipt_id: null,
  };
  it('accepts a consistent payload', () => {
    expect(expensePayloadSchema.safeParse(base).success).toBe(true);
  });
  it('rejects payer or split totals that do not match', () => {
    expect(expensePayloadSchema.safeParse({ ...base, payers: [{ ...base.payers[0]!, amount_minor: 1 }] }).success).toBe(false);
    expect(expensePayloadSchema.safeParse({ ...base, splits: [{ ...base.splits[0]!, amount_minor: 1 }] }).success).toBe(false);
    expect(expensePayloadSchema.safeParse({ ...base, currency: 'XXX' }).success).toBe(false);
  });
});
