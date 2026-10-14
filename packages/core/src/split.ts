import { MAX_AMOUNT_MINOR, assertMinor } from './money';

/**
 * Owenil expense-splitting engine.
 *
 * Every function here is pure and deterministic. Given the same input the
 * engine always returns the same allocation, and allocations ALWAYS sum
 * exactly to the expense total. Rounding remainders (e.g. ₹100 / 3) are
 * distributed one minor unit at a time using the largest-remainder method;
 * ties are broken by user id so the result never depends on UI ordering.
 */

export type SplitMethod = 'equal' | 'exact' | 'percentage' | 'shares' | 'adjustment' | 'itemized';

export const SPLIT_METHODS: readonly SplitMethod[] = ['equal', 'exact', 'percentage', 'shares', 'adjustment', 'itemized'];

export const SPLIT_METHOD_LABELS: Record<SplitMethod, string> = {
  equal: 'Equally',
  exact: 'Exact amounts',
  percentage: 'Percentages',
  shares: 'Weighted shares',
  adjustment: 'Equal + adjustments',
  itemized: 'Itemized receipt',
};

/** Percentages are stored as integer hundredths of a percent (basis points × 1): 100% = 10000. */
export const PERCENT_SCALE = 10_000;
/** Share weights are stored as integer hundredths: weight 1.5 = 150. */
export const WEIGHT_SCALE = 100;

export interface Allocation {
  userId: string;
  amountMinor: number;
}

export interface ParticipantInput {
  userId: string;
  /** Excluded participants receive no allocation but are kept for the record. */
  included?: boolean;
  /** exact: minor units. percentage: hundredths of a percent. shares: hundredths of a share. adjustment: minor units (may be negative). */
  value?: number;
}

export interface ItemInput {
  id?: string;
  name: string;
  amountMinor: number;
  kind?: 'item' | 'tax' | 'tip' | 'discount';
  /** Users sharing this item, with optional relative weights (default 1 each). */
  assignees: { userId: string; weight?: number }[];
}

export interface SplitRequest {
  method: SplitMethod;
  totalMinor: number;
  participants: ParticipantInput[];
  /** Only for itemized splits. Tax/tip/discount lines are spread pro-rata to item subtotals. */
  items?: ItemInput[];
}

export type SplitErrorCode =
  | 'INVALID_TOTAL'
  | 'NO_PARTICIPANTS'
  | 'DUPLICATE_PARTICIPANT'
  | 'INVALID_VALUE'
  | 'EXACT_MISMATCH'
  | 'PERCENT_MISMATCH'
  | 'ZERO_WEIGHT'
  | 'NEGATIVE_SHARE'
  | 'ITEMS_MISMATCH'
  | 'ITEM_UNASSIGNED'
  | 'UNKNOWN_ASSIGNEE';

export class SplitError extends Error {
  constructor(
    public readonly code: SplitErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'SplitError';
  }
}

export type SplitResult = { ok: true; allocations: Allocation[] } | { ok: false; error: SplitError };

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Distribute `total` minor units proportionally to integer `weights` using the
 * largest-remainder method. Deterministic; result sums exactly to `total`.
 */
export function allocateProportional(total: number, weighted: { userId: string; weight: number }[]): Allocation[] {
  assertMinor(total, 'total');
  if (weighted.length === 0) throw new SplitError('NO_PARTICIPANTS', 'Nobody to allocate to');
  let weightSum = 0n;
  for (const w of weighted) {
    if (!Number.isSafeInteger(w.weight) || w.weight < 0) {
      throw new SplitError('INVALID_VALUE', 'Weights must be non-negative integers', { userId: w.userId });
    }
    weightSum += BigInt(w.weight);
  }
  if (weightSum === 0n) throw new SplitError('ZERO_WEIGHT', 'At least one participant needs a share greater than zero');

  const negative = total < 0;
  const absTotal = BigInt(Math.abs(total));
  const rows = weighted.map((w, index) => {
    const product = absTotal * BigInt(w.weight);
    return { userId: w.userId, index, base: product / weightSum, rem: product % weightSum };
  });
  let leftover = absTotal - rows.reduce((acc, r) => acc + r.base, 0n);
  const order = [...rows].sort((a, b) => (a.rem === b.rem ? compareIds(a.userId, b.userId) : a.rem > b.rem ? -1 : 1));
  for (let i = 0; leftover > 0n; i = (i + 1) % order.length) {
    const row = order[i]!;
    if (BigInt(weighted[row.index]!.weight) === 0n) continue;
    row.base += 1n;
    leftover -= 1n;
  }
  return rows.map((r) => ({ userId: r.userId, amountMinor: Number(negative ? -r.base : r.base) }));
}

function validateCommon(req: SplitRequest): ParticipantInput[] {
  if (!Number.isSafeInteger(req.totalMinor) || req.totalMinor <= 0 || req.totalMinor > MAX_AMOUNT_MINOR) {
    throw new SplitError('INVALID_TOTAL', 'Enter an amount greater than zero');
  }
  const seen = new Set<string>();
  for (const p of req.participants) {
    if (seen.has(p.userId)) throw new SplitError('DUPLICATE_PARTICIPANT', 'A participant was listed twice', { userId: p.userId });
    seen.add(p.userId);
  }
  const included = req.participants.filter((p) => p.included !== false);
  if (included.length === 0 && req.method !== 'itemized') {
    throw new SplitError('NO_PARTICIPANTS', 'Choose at least one person to split with');
  }
  return included;
}

function requireValue(p: ParticipantInput, allowNegative = false): number {
  const v = p.value ?? 0;
  if (!Number.isSafeInteger(v) || (!allowNegative && v < 0)) {
    throw new SplitError('INVALID_VALUE', 'Values must be whole, non-negative numbers', { userId: p.userId });
  }
  return v;
}

function splitEqual(total: number, included: ParticipantInput[]): Allocation[] {
  return allocateProportional(total, included.map((p) => ({ userId: p.userId, weight: 1 })));
}

function splitExact(total: number, included: ParticipantInput[]): Allocation[] {
  const allocations = included.map((p) => ({ userId: p.userId, amountMinor: requireValue(p) }));
  const sum = allocations.reduce((a, b) => a + b.amountMinor, 0);
  if (sum !== total) {
    throw new SplitError('EXACT_MISMATCH', 'The amounts must add up to the total', { sum, total, difference: total - sum });
  }
  return allocations;
}

function splitPercentage(total: number, included: ParticipantInput[]): Allocation[] {
  const weights = included.map((p) => ({ userId: p.userId, weight: requireValue(p) }));
  const sum = weights.reduce((a, b) => a + b.weight, 0);
  if (sum !== PERCENT_SCALE) {
    throw new SplitError('PERCENT_MISMATCH', 'Percentages must add up to 100%', { sum, difference: PERCENT_SCALE - sum });
  }
  return allocateProportional(total, weights);
}

function splitShares(total: number, included: ParticipantInput[]): Allocation[] {
  return allocateProportional(total, included.map((p) => ({ userId: p.userId, weight: requireValue(p) })));
}

/** Equal split of (total − Σadjustments), then each person's adjustment is added back. */
function splitAdjustment(total: number, included: ParticipantInput[]): Allocation[] {
  const adjustments = included.map((p) => requireValue(p, true));
  const adjSum = adjustments.reduce((a, b) => a + b, 0);
  const remaining = total - adjSum;
  if (remaining < 0) {
    throw new SplitError('NEGATIVE_SHARE', 'Adjustments exceed the total', { adjustmentTotal: adjSum, total });
  }
  const base = allocateProportional(remaining, included.map((p) => ({ userId: p.userId, weight: 1 })));
  const result = base.map((a, i) => ({ userId: a.userId, amountMinor: a.amountMinor + adjustments[i]! }));
  const negative = result.find((r) => r.amountMinor < 0);
  if (negative) throw new SplitError('NEGATIVE_SHARE', 'An adjustment makes someone’s share negative', { userId: negative.userId });
  return result;
}

/**
 * Itemized receipt split. Each item is shared among its assignees (by weight).
 * Tax, tip and discount lines are allocated pro-rata to each person's item
 * subtotal. Items (+tax +tip −discount) must reconcile exactly with the total.
 */
export function splitItemized(total: number, items: ItemInput[], knownUsers?: Set<string>): Allocation[] {
  const regular = items.filter((i) => (i.kind ?? 'item') === 'item');
  const extras = items.filter((i) => (i.kind ?? 'item') !== 'item');
  let reconciled = 0;
  for (const item of items) {
    if (!Number.isSafeInteger(item.amountMinor) || item.amountMinor < 0) {
      throw new SplitError('INVALID_VALUE', `“${item.name}” has an invalid amount`);
    }
    reconciled += item.kind === 'discount' ? -item.amountMinor : item.amountMinor;
  }
  if (reconciled !== total) {
    throw new SplitError('ITEMS_MISMATCH', 'Receipt lines do not add up to the total', { sum: reconciled, total, difference: total - reconciled });
  }
  const subtotals = new Map<string, number>();
  for (const item of regular) {
    if (item.assignees.length === 0) throw new SplitError('ITEM_UNASSIGNED', `Assign “${item.name}” to at least one person`);
    for (const a of item.assignees) {
      if (knownUsers && !knownUsers.has(a.userId)) throw new SplitError('UNKNOWN_ASSIGNEE', 'An item is assigned to someone outside this expense');
    }
    const parts = allocateProportional(
      item.amountMinor,
      item.assignees.map((a) => ({ userId: a.userId, weight: a.weight ?? 1 })),
    );
    for (const p of parts) subtotals.set(p.userId, (subtotals.get(p.userId) ?? 0) + p.amountMinor);
  }
  if (subtotals.size === 0) throw new SplitError('NO_PARTICIPANTS', 'Add at least one item and assign it');
  const people = [...subtotals.keys()].sort(compareIds);
  const itemTotal = [...subtotals.values()].reduce((a, b) => a + b, 0);
  for (const extra of extras) {
    const signed = extra.kind === 'discount' ? -extra.amountMinor : extra.amountMinor;
    if (signed === 0) continue;
    const weights = itemTotal === 0 ? people.map((u) => ({ userId: u, weight: 1 })) : people.map((u) => ({ userId: u, weight: subtotals.get(u)! }));
    for (const p of allocateProportional(signed, weights)) subtotals.set(p.userId, subtotals.get(p.userId)! + p.amountMinor);
  }
  const result = people.map((u) => ({ userId: u, amountMinor: subtotals.get(u)! }));
  if (result.some((r) => r.amountMinor < 0)) throw new SplitError('NEGATIVE_SHARE', 'A discount makes someone’s share negative');
  return result;
}

/** Compute participant allocations. Throws SplitError on invalid input. */
export function computeSplit(req: SplitRequest): Allocation[] {
  const included = validateCommon(req);
  let allocations: Allocation[];
  switch (req.method) {
    case 'equal':
      allocations = splitEqual(req.totalMinor, included);
      break;
    case 'exact':
      allocations = splitExact(req.totalMinor, included);
      break;
    case 'percentage':
      allocations = splitPercentage(req.totalMinor, included);
      break;
    case 'shares':
      allocations = splitShares(req.totalMinor, included);
      break;
    case 'adjustment':
      allocations = splitAdjustment(req.totalMinor, included);
      break;
    case 'itemized': {
      const known = new Set(req.participants.map((p) => p.userId));
      allocations = splitItemized(req.totalMinor, req.items ?? [], req.participants.length ? known : undefined);
      break;
    }
    default: {
      const never: never = req.method;
      throw new SplitError('INVALID_VALUE', `Unknown split method ${String(never)}`);
    }
  }
  // Invariant: allocations sum to the expense total. A failure here is a bug.
  const sum = allocations.reduce((a, b) => a + b.amountMinor, 0);
  if (sum !== req.totalMinor) throw new Error(`Invariant violated: allocations ${sum} ≠ total ${req.totalMinor}`);
  return allocations;
}

/** Non-throwing variant for form previews. */
export function trySplit(req: SplitRequest): SplitResult {
  try {
    return { ok: true, allocations: computeSplit(req) };
  } catch (e) {
    if (e instanceof SplitError) return { ok: false, error: e };
    throw e;
  }
}

export interface PayerInput {
  userId: string;
  amountMinor: number;
}

/** Validate payer contributions: positive, unique, and summing exactly to the total. */
export function validatePayers(totalMinor: number, payers: PayerInput[]): { ok: true } | { ok: false; message: string; difference?: number } {
  if (payers.length === 0) return { ok: false, message: 'Choose who paid' };
  const seen = new Set<string>();
  let sum = 0;
  for (const p of payers) {
    if (seen.has(p.userId)) return { ok: false, message: 'A payer was listed twice' };
    seen.add(p.userId);
    if (!Number.isSafeInteger(p.amountMinor) || p.amountMinor <= 0) return { ok: false, message: 'Each payer must pay more than zero' };
    sum += p.amountMinor;
  }
  if (sum !== totalMinor) return { ok: false, message: 'Payer amounts must add up to the total', difference: totalMinor - sum };
  return { ok: true };
}

/** Split a paid total equally across several payers (used by the "split payment equally" helper). */
export function equalPayers(totalMinor: number, userIds: string[]): PayerInput[] {
  return allocateProportional(totalMinor, userIds.map((u) => ({ userId: u, weight: 1 })));
}

/**
 * Net effect of a single expense on each person: paid − owed.
 * Positive = others owe this person; negative = this person owes.
 * The values always sum to zero.
 */
export function expenseNetEffect(payers: PayerInput[], allocations: Allocation[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const p of payers) net.set(p.userId, (net.get(p.userId) ?? 0) + p.amountMinor);
  for (const a of allocations) net.set(a.userId, (net.get(a.userId) ?? 0) - a.amountMinor);
  return net;
}

/** Convert a UI percentage string ("33.33") to hundredths of a percent (3333). */
export function percentToUnits(input: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{0,2}))?\s*$/.exec(input);
  if (!m) return null;
  const v = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return v <= PERCENT_SCALE ? v : null;
}

/** Convert a UI share weight string ("1.5") to hundredths (150). */
export function weightToUnits(input: string): number | null {
  const m = /^\s*(\d{1,6})(?:\.(\d{0,2}))?\s*$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
}

export function unitsToPercentString(units: number): string {
  return (units / 100).toFixed(2).replace(/\.00$/, '');
}
