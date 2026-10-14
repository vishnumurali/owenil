import { describe, expect, it } from 'vitest';
import {
  applyTransfers,
  attributeExpense,
  computeSplit,
  netPositions,
  pairwiseBalances,
  reverseEntry,
  settlementEntry,
  simplifyDebts,
  summarizePairwise,
  type LedgerEntry,
} from '../src';

const [A, B, C, D, E] = ['a', 'b', 'c', 'd', 'e'] as const;

function expenseEntries(total: number, payers: [string, number][], participants: string[], currency = 'INR'): LedgerEntry[] {
  const allocations = computeSplit({ method: 'equal', totalMinor: total, participants: participants.map((userId) => ({ userId })) });
  return attributeExpense(payers.map(([userId, amountMinor]) => ({ userId, amountMinor })), allocations).map((o) => ({ ...o, currency }));
}

describe('ledger balances', () => {
  it('nets sum to zero for a single-currency group', () => {
    const entries = [
      ...expenseEntries(300000, [[A, 300000]], [A, B, C]),
      ...expenseEntries(90000, [[B, 90000]], [A, B, C]),
      ...expenseEntries(45001, [[C, 30000], [A, 15001]], [B, C]),
    ];
    const nets = netPositions(entries).get('INR')!;
    expect([...nets.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('partial then full repayment returns balances to zero', () => {
    const entries = expenseEntries(300000, [[A, 300000]], [A, B, C]);
    // B pays A ₹400 now, then ₹600 later; C pays ₹1,000 at once.
    entries.push(settlementEntry(B, A, 40000, 'INR'));
    let pw = pairwiseBalances(entries, A);
    expect(pw.get(B)!.get('INR')).toBe(60000);
    entries.push(settlementEntry(B, A, 60000, 'INR'));
    entries.push(settlementEntry(C, A, 100000, 'INR'));
    pw = pairwiseBalances(entries, A);
    expect(pw.size).toBe(0);
    expect(netPositions(entries).get('INR')!.size).toBe(0);
  });

  it('editing an expense = reversal + re-application, applied exactly once', () => {
    const original = expenseEntries(300000, [[A, 300000]], [A, B, C]);
    const edited = expenseEntries(240000, [[A, 240000]], [A, B]);
    const ledger = [...original, ...original.map(reverseEntry), ...edited];
    const nets = netPositions(ledger).get('INR')!;
    expect(Object.fromEntries(nets)).toEqual({ [A]: 120000, [B]: -120000 });
  });

  it('deleting an expense (full reversal) clears it', () => {
    const original = expenseEntries(300000, [[A, 300000]], [A, B, C]);
    expect(netPositions([...original, ...original.map(reverseEntry)]).get('INR')!.size).toBe(0);
  });

  it('never mixes currencies', () => {
    const entries = [...expenseEntries(1000, [[A, 1000]], [A, B]), ...expenseEntries(2000, [[B, 2000]], [A, B], 'USD')];
    const pw = pairwiseBalances(entries, A);
    expect(Object.fromEntries(pw.get(B)!)).toEqual({ INR: 500, USD: -1000 });
    const totals = summarizePairwise(pw);
    expect(totals).toEqual([
      { currency: 'INR', owedToMe: 500, iOwe: 0, net: 500 },
      { currency: 'USD', owedToMe: 0, iOwe: 1000, net: -1000 },
    ]);
  });
});

describe('debt simplification', () => {
  it('produces at most n-1 transfers and preserves every net position', () => {
    const nets = { [A]: 5000, [B]: -2000, [C]: -2000, [D]: 1500, [E]: -2500 };
    const transfers = simplifyDebts(nets);
    expect(transfers.length).toBeLessThanOrEqual(4);
    expect(Object.values(applyTransfers(nets, transfers)).every((v) => v === 0)).toBe(true);
    expect(transfers.every((t) => t.amountMinor > 0 && t.fromUserId !== t.toUserId)).toBe(true);
  });

  it('collapses a cycle (A→B→C→A) into nothing', () => {
    const entries: LedgerEntry[] = [
      { debtorId: A, creditorId: B, amountMinor: 100, currency: 'INR' },
      { debtorId: B, creditorId: C, amountMinor: 100, currency: 'INR' },
      { debtorId: C, creditorId: A, amountMinor: 100, currency: 'INR' },
    ];
    const nets = netPositions(entries).get('INR') ?? new Map();
    expect(simplifyDebts(nets)).toEqual([]);
  });

  it('chains A→B→C into a single A→C transfer', () => {
    const t = simplifyDebts({ [A]: -100, [B]: 0, [C]: 100 });
    expect(t).toEqual([{ fromUserId: A, toUserId: C, amountMinor: 100 }]);
  });

  it('rejects nets that do not balance', () => {
    expect(() => simplifyDebts({ [A]: 100, [B]: -99 })).toThrow(/sum to zero/);
  });

  it('is deterministic for ties', () => {
    const nets = { [B]: 100, [A]: 100, [C]: -100, [D]: -100 };
    expect(simplifyDebts(nets)).toEqual(simplifyDebts({ [D]: -100, [C]: -100, [A]: 100, [B]: 100 }));
  });
});
