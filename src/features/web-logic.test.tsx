import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { computeSplit, parseCSV, type SpendingRow } from '@owenil/core';
import { draftToInputs } from './expenses/SplitEditor';
import { convertRows, pickRate } from './analytics/fx';
import { EXPENSE_CSV_HEADERS, expensesToCSV } from './settings/exporters';
import { Segmented } from '@/components/ui/segmented';
import { Money } from '@/components/ui/money';
import { QrCode } from '@/components/ui/qr-code';
import type { ExchangeRate, Expense } from '@/types/db';

describe('split editor input parsing', () => {
  const people = ['u1', 'u2', 'u3'];
  it('turns percentage strings into exact units and excludes unticked people', () => {
    const r = draftToInputs({ method: 'percentage', included: { u3: false }, values: { u1: '62.5', u2: '37.5' }, items: [] }, people, 'INR');
    expect(r.error).toBeUndefined();
    expect(r.participants).toEqual([
      { userId: 'u1', included: true, value: 6250 },
      { userId: 'u2', included: true, value: 3750 },
      { userId: 'u3', included: false, value: undefined },
    ]);
    const alloc = computeSplit({ method: 'percentage', totalMinor: 100001, participants: r.participants });
    expect(alloc.reduce((a, x) => a + x.amountMinor, 0)).toBe(100001);
  });
  it('rejects malformed values instead of guessing', () => {
    expect(draftToInputs({ method: 'exact', included: {}, values: { u1: '12.345' }, items: [] }, people, 'INR').error).toBeTruthy();
    expect(draftToInputs({ method: 'shares', included: {}, values: { u1: 'two' }, items: [] }, people, 'INR').error).toBeTruthy();
  });
  it('builds itemized inputs including tax lines', () => {
    const r = draftToInputs(
      { method: 'itemized', included: {}, values: {}, items: [
        { key: '1', name: 'Pizza', amount: '600', kind: 'item', assignees: ['u1', 'u2'] },
        { key: '2', name: 'Tax', amount: '60', kind: 'tax', assignees: [] },
      ] },
      people, 'INR',
    );
    expect(r.items).toEqual([
      { name: 'Pizza', amountMinor: 60000, kind: 'item', assignees: [{ userId: 'u1' }, { userId: 'u2' }] },
      { name: 'Tax', amountMinor: 6000, kind: 'tax', assignees: [] },
    ]);
  });
});

describe('currency conversion with recorded snapshots', () => {
  const rate = (base: string, quote: string, r: string, as_of: string): ExchangeRate => ({ id: as_of + base, user_id: 'u', base_currency: base, quote_currency: quote, rate: r, as_of, source: 'manual', note: null, created_at: as_of });
  const rates = [rate('USD', 'INR', '83', '2026-01-01'), rate('USD', 'INR', '84', '2026-06-01'), rate('INR', 'EUR', '0.0110', '2026-01-01')];
  it('uses the latest snapshot on or before the expense date', () => {
    expect(pickRate(rates, 'USD', 'INR', '2026-03-01')).toBe('83');
    expect(pickRate(rates, 'USD', 'INR', '2026-07-01')).toBe('84');
    expect(pickRate(rates, 'USD', 'INR', '2025-12-01')).toBe('83'); // falls back to the earliest later rate
  });
  it('can invert a pair and reports what it could not convert', () => {
    expect(Number(pickRate(rates, 'EUR', 'INR', '2026-02-01'))).toBeCloseTo(90.909, 2);
    const row = (currency: string, total: number): SpendingRow => ({ expenseId: currency, date: '2026-02-01', description: '', currency, categoryId: null, groupId: null, totalMinor: total, myShareMinor: total, myPaidMinor: 0, isRecurring: false, payers: [] });
    const out = convertRows([row('INR', 1000), row('USD', 100), row('GBP', 100)], 'INR', rates);
    expect(out.rows.map((r) => r.totalMinor)).toEqual([1000, 8300]);
    expect(out.excluded.get('GBP')).toBe(1);
  });
});

describe('CSV export', () => {
  it('writes exact decimal amounts and the viewer’s net', () => {
    const e = {
      id: 'e1', group_id: null, description: '=cmd|calc', amount_minor: 100001, currency: 'INR', expense_date: '2026-10-01', category_id: null, notes: null,
      tags: ['x'], split_method: 'equal', version: 2,
      expense_payers: [{ expense_id: 'e1', user_id: 'me', amount_minor: 100001 }],
      expense_splits: [{ expense_id: 'e1', user_id: 'me', amount_minor: 50001 }, { expense_id: 'e1', user_id: 'you', amount_minor: 50000 }],
    } as unknown as Expense;
    const rows = parseCSV(expensesToCSV([e], { me: 'me', name: (id) => id.toUpperCase(), category: () => '', group: () => 'Non-group' }));
    expect(rows[0]).toEqual(EXPENSE_CSV_HEADERS);
    const r = rows[1]!;
    expect(r[1]).toBe("'=cmd|calc"); // formula injection neutralised
    expect(r[5]).toBe('1000.01');
    expect(r[9]).toBe('500.01');
    expect(r[11]).toBe('500.00');
  });
});

describe('components', () => {
  it('Segmented is an accessible radio group', () => {
    const onChange = vi.fn();
    render(<Segmented value="a" onChange={onChange} ariaLabel="Pick" options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]} />);
    expect(screen.getByRole('radiogroup', { name: 'Pick' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
  it('Money formats minor units and colours by sign', () => {
    render(<Money amountMinor={-123456} currency="INR" tone="auto" />);
    const el = screen.getByText('-₹1,234.56');
    expect(el.className).toContain('text-negative');
  });
});

describe('UPI QR code', () => {
  it('renders a scannable dark-on-white code locally, sized to the data', () => {
    const uri = 'upi://pay?pa=asha.k%40okhdfcbank&pn=Asha&am=1000.00&cu=INR';
    const { container, rerender } = render(<QrCode value={uri} label="UPI QR code" />);
    const svg = screen.getByRole('img', { name: 'UPI QR code' });
    const size = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
    // Version 3–5 code for this length, plus a 4-module quiet zone each side.
    expect(size).toBeGreaterThanOrEqual(29 + 8);
    expect(size).toBeLessThanOrEqual(37 + 8);
    const modules = container.querySelector('path')!.getAttribute('d')!.match(/M/g)!.length;
    expect(modules).toBeGreaterThan(200);
    // A different amount produces a different code.
    const before = container.querySelector('path')!.getAttribute('d');
    rerender(<QrCode value={uri.replace('1000.00', '1000.50')} label="UPI QR code" />);
    expect(container.querySelector('path')!.getAttribute('d')).not.toBe(before);
  });
});
