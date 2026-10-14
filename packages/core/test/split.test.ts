import { describe, expect, it } from 'vitest';
import {
  PERCENT_SCALE,
  SplitError,
  allocateProportional,
  attributeExpense,
  computeSplit,
  equalPayers,
  expenseNetEffect,
  percentToUnits,
  trySplit,
  validatePayers,
  weightToUnits,
  type Allocation,
  type SplitMethod,
} from '../src';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const D = '00000000-0000-0000-0000-00000000000d';

const sum = (xs: Allocation[]) => xs.reduce((a, x) => a + x.amountMinor, 0);
const byUser = (xs: Allocation[]) => Object.fromEntries(xs.map((x) => [x.userId, x.amountMinor]));

// Small deterministic PRNG so randomized tests are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('required example: ₹3,000 shared equally by three, one payer', () => {
  it('gives each person a ₹1,000 share and correct net balances', () => {
    const total = 300000; // ₹3,000.00 in paise
    const allocations = computeSplit({ method: 'equal', totalMinor: total, participants: [{ userId: A }, { userId: B }, { userId: C }] });
    expect(byUser(allocations)).toEqual({ [A]: 100000, [B]: 100000, [C]: 100000 });
    const net = expenseNetEffect([{ userId: A, amountMinor: total }], allocations);
    expect(Object.fromEntries(net)).toEqual({ [A]: 200000, [B]: -100000, [C]: -100000 });
    expect(attributeExpense([{ userId: A, amountMinor: total }], allocations)).toEqual([
      { debtorId: B, creditorId: A, amountMinor: 100000 },
      { debtorId: C, creditorId: A, amountMinor: 100000 },
    ]);
  });
});

describe('equal split', () => {
  it('distributes remainders deterministically by user id', () => {
    const r = computeSplit({ method: 'equal', totalMinor: 10000, participants: [{ userId: C }, { userId: A }, { userId: B }] });
    expect(byUser(r)).toEqual({ [A]: 3334, [B]: 3333, [C]: 3333 });
    // Same people in a different order → identical result.
    const r2 = computeSplit({ method: 'equal', totalMinor: 10000, participants: [{ userId: B }, { userId: C }, { userId: A }] });
    expect(byUser(r2)).toEqual(byUser(r));
  });

  it('respects excluded participants', () => {
    const r = computeSplit({
      method: 'equal',
      totalMinor: 900,
      participants: [{ userId: A }, { userId: B, included: false }, { userId: C }],
    });
    expect(byUser(r)).toEqual({ [A]: 450, [C]: 450 });
  });

  it('handles 1 minor unit across many people', () => {
    const r = computeSplit({ method: 'equal', totalMinor: 1, participants: [{ userId: A }, { userId: B }, { userId: C }] });
    expect(sum(r)).toBe(1);
    expect(byUser(r)[A]).toBe(1);
  });

  it('works for zero-decimal currencies (JPY amounts are whole yen)', () => {
    const r = computeSplit({ method: 'equal', totalMinor: 1000, participants: [{ userId: A }, { userId: B }, { userId: C }] });
    expect(r.map((x) => x.amountMinor).sort()).toEqual([333, 333, 334]);
  });

  it('rejects empty participants and bad totals', () => {
    expect(() => computeSplit({ method: 'equal', totalMinor: 100, participants: [] })).toThrow(SplitError);
    expect(() => computeSplit({ method: 'equal', totalMinor: 0, participants: [{ userId: A }] })).toThrow(/greater than zero/);
    expect(() => computeSplit({ method: 'equal', totalMinor: 1.5, participants: [{ userId: A }] })).toThrow(SplitError);
    expect(() => computeSplit({ method: 'equal', totalMinor: 100, participants: [{ userId: A }, { userId: A }] })).toThrow(/twice/);
  });
});

describe('exact split', () => {
  it('accepts amounts that add up', () => {
    const r = computeSplit({ method: 'exact', totalMinor: 1000, participants: [{ userId: A, value: 250 }, { userId: B, value: 750 }] });
    expect(byUser(r)).toEqual({ [A]: 250, [B]: 750 });
  });
  it('reports the difference when amounts do not add up', () => {
    const res = trySplit({ method: 'exact', totalMinor: 1000, participants: [{ userId: A, value: 250 }, { userId: B, value: 700 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('EXACT_MISMATCH');
      expect(res.error.details.difference).toBe(50);
    }
  });
  it('rejects negative amounts', () => {
    expect(() => computeSplit({ method: 'exact', totalMinor: 100, participants: [{ userId: A, value: 150 }, { userId: B, value: -50 }] })).toThrow(SplitError);
  });
});

describe('percentage split', () => {
  it('splits 33.33/33.33/33.34 of ₹100', () => {
    const r = computeSplit({
      method: 'percentage',
      totalMinor: 10000,
      participants: [{ userId: A, value: 3333 }, { userId: B, value: 3333 }, { userId: C, value: 3334 }],
    });
    expect(byUser(r)).toEqual({ [A]: 3333, [B]: 3333, [C]: 3334 });
  });
  it('rounds and still sums to the total', () => {
    const r = computeSplit({ method: 'percentage', totalMinor: 999, participants: [{ userId: A, value: 5000 }, { userId: B, value: 5000 }] });
    expect(sum(r)).toBe(999);
    expect(byUser(r)).toEqual({ [A]: 500, [B]: 499 });
  });
  it('requires exactly 100%', () => {
    const res = trySplit({ method: 'percentage', totalMinor: 1000, participants: [{ userId: A, value: 5000 }, { userId: B, value: 4000 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('PERCENT_MISMATCH');
  });
  it('parses percentage strings', () => {
    expect(percentToUnits('33.33')).toBe(3333);
    expect(percentToUnits('100')).toBe(PERCENT_SCALE);
    expect(percentToUnits('12.5')).toBe(1250);
    expect(percentToUnits('101')).toBeNull();
    expect(percentToUnits('1.234')).toBeNull();
    expect(percentToUnits('abc')).toBeNull();
  });
});

describe('weighted shares', () => {
  it('splits 2:1:1', () => {
    const r = computeSplit({ method: 'shares', totalMinor: 4000, participants: [{ userId: A, value: 200 }, { userId: B, value: 100 }, { userId: C, value: 100 }] });
    expect(byUser(r)).toEqual({ [A]: 2000, [B]: 1000, [C]: 1000 });
  });
  it('supports fractional weights (1.5 : 1)', () => {
    expect(weightToUnits('1.5')).toBe(150);
    const r = computeSplit({ method: 'shares', totalMinor: 1000, participants: [{ userId: A, value: 150 }, { userId: B, value: 100 }] });
    expect(byUser(r)).toEqual({ [A]: 600, [B]: 400 });
  });
  it('rejects all-zero weights', () => {
    expect(() => computeSplit({ method: 'shares', totalMinor: 1000, participants: [{ userId: A, value: 0 }, { userId: B, value: 0 }] })).toThrow(/greater than zero/);
  });
  it('gives zero-weight people nothing', () => {
    const r = computeSplit({ method: 'shares', totalMinor: 1001, participants: [{ userId: A, value: 0 }, { userId: B, value: 100 }, { userId: C, value: 100 }] });
    expect(byUser(r)[A]).toBe(0);
    expect(sum(r)).toBe(1001);
  });
});

describe('adjustment (custom unequal) split', () => {
  it('adds per-person adjustments on top of an equal split', () => {
    // ₹1,000 dinner, A had an extra ₹100 drink: remaining ₹900 equally.
    const r = computeSplit({
      method: 'adjustment',
      totalMinor: 100000,
      participants: [{ userId: A, value: 10000 }, { userId: B, value: 0 }, { userId: C, value: 0 }],
    });
    expect(byUser(r)).toEqual({ [A]: 40000, [B]: 30000, [C]: 30000 });
  });
  it('supports negative adjustments (discounts)', () => {
    const r = computeSplit({ method: 'adjustment', totalMinor: 1000, participants: [{ userId: A, value: -100 }, { userId: B, value: 0 }] });
    expect(byUser(r)).toEqual({ [A]: 450, [B]: 550 });
  });
  it('rejects adjustments that make a share negative', () => {
    expect(() => computeSplit({ method: 'adjustment', totalMinor: 100, participants: [{ userId: A, value: -200 }, { userId: B, value: 0 }] })).toThrow(SplitError);
    expect(() => computeSplit({ method: 'adjustment', totalMinor: 100, participants: [{ userId: A, value: 200 }, { userId: B, value: 0 }] })).toThrow(/exceed/);
  });
});

describe('itemized split', () => {
  it('assigns items and spreads tax/tip pro-rata', () => {
    // Pizza ₹600 shared A,B; Salad ₹300 for C; tax ₹90; tip ₹60 → total ₹1,050.
    const r = computeSplit({
      method: 'itemized',
      totalMinor: 105000,
      participants: [{ userId: A }, { userId: B }, { userId: C }],
      items: [
        { name: 'Pizza', amountMinor: 60000, assignees: [{ userId: A }, { userId: B }] },
        { name: 'Salad', amountMinor: 30000, assignees: [{ userId: C }] },
        { name: 'Tax', amountMinor: 9000, kind: 'tax', assignees: [] },
        { name: 'Tip', amountMinor: 6000, kind: 'tip', assignees: [] },
      ],
    });
    // Subtotals 300/300/300 → each gets a third of tax and tip.
    expect(byUser(r)).toEqual({ [A]: 35000, [B]: 35000, [C]: 35000 });
  });
  it('handles discounts and uneven pro-rata rounding', () => {
    const r = computeSplit({
      method: 'itemized',
      totalMinor: 1000,
      participants: [{ userId: A }, { userId: B }],
      items: [
        { name: 'X', amountMinor: 701, assignees: [{ userId: A }] },
        { name: 'Y', amountMinor: 400, assignees: [{ userId: B }] },
        { name: 'Coupon', amountMinor: 101, kind: 'discount', assignees: [] },
      ],
    });
    expect(sum(r)).toBe(1000);
    expect(r.every((x) => x.amountMinor >= 0)).toBe(true);
  });
  it('requires receipt lines to reconcile with the total', () => {
    const res = trySplit({
      method: 'itemized',
      totalMinor: 1000,
      participants: [{ userId: A }],
      items: [{ name: 'X', amountMinor: 900, assignees: [{ userId: A }] }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ITEMS_MISMATCH');
  });
  it('requires every item to be assigned to known participants', () => {
    expect(() =>
      computeSplit({ method: 'itemized', totalMinor: 100, participants: [{ userId: A }], items: [{ name: 'X', amountMinor: 100, assignees: [] }] }),
    ).toThrow(/Assign/);
    expect(() =>
      computeSplit({ method: 'itemized', totalMinor: 100, participants: [{ userId: A }], items: [{ name: 'X', amountMinor: 100, assignees: [{ userId: D }] }] }),
    ).toThrow(/outside/);
  });
});

describe('multiple payers', () => {
  it('validates payer totals separately from allocations', () => {
    expect(validatePayers(1000, [{ userId: A, amountMinor: 600 }, { userId: B, amountMinor: 400 }])).toEqual({ ok: true });
    const bad = validatePayers(1000, [{ userId: A, amountMinor: 600 }, { userId: B, amountMinor: 300 }]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.difference).toBe(100);
    expect(validatePayers(1000, []).ok).toBe(false);
    expect(validatePayers(1000, [{ userId: A, amountMinor: 1000 }, { userId: A, amountMinor: 0 }]).ok).toBe(false);
  });
  it('splits a payment equally across payers', () => {
    expect(byUser(equalPayers(1001, [B, A]))).toEqual({ [A]: 501, [B]: 500 });
  });
  it('attributes debts with two payers and preserves every contribution', () => {
    // ₹1,200: A paid 800, B paid 400; split equally among A, B, C, D (300 each).
    const payers = [{ userId: A, amountMinor: 800 }, { userId: B, amountMinor: 400 }];
    const allocations = computeSplit({ method: 'equal', totalMinor: 1200, participants: [A, B, C, D].map((userId) => ({ userId })) });
    const obligations = attributeExpense(payers, allocations);
    // A covers own 300 → 500 credit; B covers own 300 → 100 credit; C, D owe 300 each.
    expect(obligations).toEqual([
      { debtorId: C, creditorId: A, amountMinor: 300 },
      { debtorId: D, creditorId: A, amountMinor: 200 },
      { debtorId: D, creditorId: B, amountMinor: 100 },
    ]);
    const net = expenseNetEffect(payers, allocations);
    expect(Object.fromEntries(net)).toEqual({ [A]: 500, [B]: 100, [C]: -300, [D]: -300 });
  });
});

describe('invariants under randomized input', () => {
  const methods: SplitMethod[] = ['equal', 'exact', 'percentage', 'shares', 'adjustment'];
  it('allocations always sum to the total and attribution preserves net effect', () => {
    const rand = rng(42);
    const people = [A, B, C, D, '00000000-0000-0000-0000-00000000000e'];
    for (let iter = 0; iter < 3000; iter++) {
      const n = 1 + Math.floor(rand() * people.length);
      const ids = people.slice(0, n);
      const total = 1 + Math.floor(rand() * 5_000_000);
      const method = methods[Math.floor(rand() * methods.length)]!;
      let participants;
      if (method === 'exact') {
        const parts = allocateProportional(total, ids.map((u) => ({ userId: u, weight: 1 + Math.floor(rand() * 10) })));
        participants = parts.map((p) => ({ userId: p.userId, value: p.amountMinor }));
      } else if (method === 'percentage') {
        const parts = allocateProportional(PERCENT_SCALE, ids.map((u) => ({ userId: u, weight: 1 + Math.floor(rand() * 10) })));
        participants = parts.map((p) => ({ userId: p.userId, value: p.amountMinor }));
      } else if (method === 'shares') {
        participants = ids.map((u) => ({ userId: u, value: 1 + Math.floor(rand() * 500) }));
      } else if (method === 'adjustment') {
        participants = ids.map((u) => ({ userId: u, value: Math.floor(rand() * Math.floor(total / (n * 2))) }));
      } else {
        participants = ids.map((u) => ({ userId: u }));
      }
      const allocations = computeSplit({ method, totalMinor: total, participants });
      expect(sum(allocations)).toBe(total);
      expect(allocations.every((a) => Number.isInteger(a.amountMinor) && a.amountMinor >= 0)).toBe(true);

      const payerIds = people.slice(0, 1 + Math.floor(rand() * 3));
      const payers = equalPayers(total, payerIds).filter((p) => p.amountMinor > 0);
      const obligations = attributeExpense(payers, allocations);
      const fromObligations = new Map<string, number>();
      for (const o of obligations) {
        expect(o.amountMinor).toBeGreaterThan(0);
        fromObligations.set(o.creditorId, (fromObligations.get(o.creditorId) ?? 0) + o.amountMinor);
        fromObligations.set(o.debtorId, (fromObligations.get(o.debtorId) ?? 0) - o.amountMinor);
      }
      const net = expenseNetEffect(payers, allocations);
      for (const [u, v] of net) expect(fromObligations.get(u) ?? 0).toBe(v);
    }
  });
});
