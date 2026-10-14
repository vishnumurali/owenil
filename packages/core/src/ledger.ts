import type { Allocation, PayerInput } from './split';

/**
 * Owenil's financial model is an append-only ledger of directed obligations:
 * a LedgerEntry says "debtor owes creditor amount (in currency)". Expenses,
 * expense edits (reversal + re-application), settlements and settlement
 * reversals all write entries; balances are always *derived* by summing them.
 *
 * The database function `public._expense_ledger_lines` implements exactly the
 * same attribution algorithm as `attributeExpense` below. The DB is
 * authoritative; this mirror powers previews and the consistency tests.
 */
export interface LedgerEntry {
  debtorId: string;
  creditorId: string;
  amountMinor: number;
  currency: string;
  groupId?: string | null;
}

export interface Obligation {
  debtorId: string;
  creditorId: string;
  amountMinor: number;
}

const byId = <T extends { userId: string }>(a: T, b: T) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);

/**
 * Turn one expense (payers + participant allocations) into pairwise
 * obligations. Each person first covers their own share from what they paid;
 * the remaining debts are matched to the remaining credits in user-id order
 * (a "north-west corner" fill). The result is deterministic, uses integers
 * only, and satisfies both invariants exactly:
 *   Σ obligations owed by X  = X's share − min(X paid, X's share)
 *   Σ obligations owed to Y  = Y paid    − min(Y paid, Y's share)
 */
export function attributeExpense(payers: PayerInput[], allocations: Allocation[]): Obligation[] {
  const paid = new Map<string, number>();
  const owed = new Map<string, number>();
  for (const p of payers) paid.set(p.userId, (paid.get(p.userId) ?? 0) + p.amountMinor);
  for (const a of allocations) owed.set(a.userId, (owed.get(a.userId) ?? 0) + a.amountMinor);
  const totalPaid = [...paid.values()].reduce((a, b) => a + b, 0);
  const totalOwed = [...owed.values()].reduce((a, b) => a + b, 0);
  if (totalPaid !== totalOwed) throw new Error(`Paid (${totalPaid}) and owed (${totalOwed}) totals differ`);

  const debtors: { userId: string; left: number }[] = [];
  const creditors: { userId: string; left: number }[] = [];
  for (const userId of new Set([...paid.keys(), ...owed.keys()])) {
    const c = paid.get(userId) ?? 0;
    const s = owed.get(userId) ?? 0;
    const self = Math.min(c, s);
    if (s - self > 0) debtors.push({ userId, left: s - self });
    if (c - self > 0) creditors.push({ userId, left: c - self });
  }
  debtors.sort(byId);
  creditors.sort(byId);

  const out: Obligation[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]!;
    const c = creditors[j]!;
    const amount = Math.min(d.left, c.left);
    if (amount > 0) out.push({ debtorId: d.userId, creditorId: c.userId, amountMinor: amount });
    d.left -= amount;
    c.left -= amount;
    if (d.left === 0) i++;
    if (c.left === 0) j++;
  }
  return out;
}

/** A settlement "payer paid payee X" is recorded as payee now owing payer X, cancelling the original debt. */
export function settlementEntry(payerId: string, payeeId: string, amountMinor: number, currency: string, groupId?: string | null): LedgerEntry {
  return { debtorId: payeeId, creditorId: payerId, amountMinor, currency, groupId: groupId ?? null };
}

/** Reversal of an entry: the same obligation with a negated amount. */
export function reverseEntry(e: LedgerEntry): LedgerEntry {
  return { ...e, amountMinor: -e.amountMinor };
}

/** Net position per user per currency: positive = is owed money. */
export function netPositions(entries: LedgerEntry[]): Map<string, Map<string, number>> {
  const byCurrency = new Map<string, Map<string, number>>();
  for (const e of entries) {
    let m = byCurrency.get(e.currency);
    if (!m) byCurrency.set(e.currency, (m = new Map()));
    m.set(e.creditorId, (m.get(e.creditorId) ?? 0) + e.amountMinor);
    m.set(e.debtorId, (m.get(e.debtorId) ?? 0) - e.amountMinor);
  }
  for (const m of byCurrency.values()) for (const [k, v] of m) if (v === 0) m.delete(k);
  return byCurrency;
}

/**
 * Pairwise balance between `me` and each counterparty, per currency.
 * Positive = the counterparty owes me; negative = I owe them.
 */
export function pairwiseBalances(entries: LedgerEntry[], me: string): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  const add = (other: string, currency: string, delta: number) => {
    let m = result.get(other);
    if (!m) result.set(other, (m = new Map()));
    m.set(currency, (m.get(currency) ?? 0) + delta);
  };
  for (const e of entries) {
    if (e.creditorId === me && e.debtorId !== me) add(e.debtorId, e.currency, e.amountMinor);
    else if (e.debtorId === me && e.creditorId !== me) add(e.creditorId, e.currency, -e.amountMinor);
  }
  for (const [other, m] of result) {
    for (const [c, v] of m) if (v === 0) m.delete(c);
    if (m.size === 0) result.delete(other);
  }
  return result;
}

export interface CurrencyTotals {
  currency: string;
  owedToMe: number;
  iOwe: number;
  net: number;
}

/** Dashboard totals from pairwise balances, kept separate per currency (never summed across currencies). */
export function summarizePairwise(pairwise: Map<string, Map<string, number>>): CurrencyTotals[] {
  const totals = new Map<string, CurrencyTotals>();
  for (const m of pairwise.values()) {
    for (const [currency, v] of m) {
      let t = totals.get(currency);
      if (!t) totals.set(currency, (t = { currency, owedToMe: 0, iOwe: 0, net: 0 }));
      if (v > 0) t.owedToMe += v;
      else t.iOwe += -v;
      t.net += v;
    }
  }
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
