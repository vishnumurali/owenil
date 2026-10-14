import { describe, expect, it } from 'vitest';
import { byCounterparty, deriveMyEdges, pairwiseFromLedger, totalsByCurrency } from './balances';
import type { BalanceRow } from '@/types/db';

const ME = 'a';
const rows: BalanceRow[] = [
  // Group g1 (simplified): a +200, b −100, c −100
  { kind: 'group_net', group_id: 'g1', user_id: 'a', currency: 'INR', net_minor: 200 },
  { kind: 'group_net', group_id: 'g1', user_id: 'b', currency: 'INR', net_minor: -100 },
  { kind: 'group_net', group_id: 'g1', user_id: 'c', currency: 'INR', net_minor: -100 },
  { kind: 'pair', group_id: 'g1', user_id: 'b', currency: 'INR', net_minor: 100 },
  { kind: 'pair', group_id: 'g1', user_id: 'c', currency: 'INR', net_minor: 100 },
  // Group g2 (not simplified): raw pairs only
  { kind: 'group_net', group_id: 'g2', user_id: 'a', currency: 'USD', net_minor: -50 },
  { kind: 'group_net', group_id: 'g2', user_id: 'd', currency: 'USD', net_minor: 50 },
  { kind: 'pair', group_id: 'g2', user_id: 'd', currency: 'USD', net_minor: -50 },
  // Non-group friend balance
  { kind: 'pair', group_id: null, user_id: 'b', currency: 'INR', net_minor: 30 },
];
const groups = [{ id: 'g1', simplify_debts: true }, { id: 'g2', simplify_debts: false }];

describe('balance derivation for the UI', () => {
  it('uses simplified transfers or exact pairs per group setting', () => {
    const edges = deriveMyEdges(rows, groups, ME);
    expect(edges).toContainEqual({ groupId: 'g1', fromId: 'b', toId: 'a', currency: 'INR', amountMinor: 100 });
    expect(edges).toContainEqual({ groupId: 'g1', fromId: 'c', toId: 'a', currency: 'INR', amountMinor: 100 });
    expect(edges).toContainEqual({ groupId: 'g2', fromId: 'a', toId: 'd', currency: 'USD', amountMinor: 50 });
    expect(edges).toContainEqual({ groupId: null, fromId: 'b', toId: 'a', currency: 'INR', amountMinor: 30 });
    expect(edges).toHaveLength(4);
  });

  it('totals stay separate per currency', () => {
    const totals = totalsByCurrency(deriveMyEdges(rows, groups, ME), ME);
    expect(totals).toContainEqual({ currency: 'INR', owedToMe: 230, iOwe: 0, net: 230 });
    expect(totals).toContainEqual({ currency: 'USD', owedToMe: 0, iOwe: 50, net: -50 });
  });

  it('aggregates per counterparty', () => {
    const m = byCounterparty(deriveMyEdges(rows, groups, ME), ME);
    expect(m.get('b')?.get('INR')).toBe(130);
    expect(m.get('d')?.get('USD')).toBe(-50);
  });

  it('nets a group ledger into pairwise balances', () => {
    const edges = pairwiseFromLedger([
      { debtor_id: 'b', creditor_id: 'a', currency: 'INR', amount_minor: 100 },
      { debtor_id: 'a', creditor_id: 'b', currency: 'INR', amount_minor: 30 },
      { debtor_id: 'b', creditor_id: 'a', currency: 'INR', amount_minor: -20 },
    ]);
    expect(edges).toEqual([{ groupId: null, fromId: 'b', toId: 'a', currency: 'INR', amountMinor: 50 }]);
  });
});
