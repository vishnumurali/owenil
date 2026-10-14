import { simplifyDebts } from '@owenil/core';
import type { BalanceRow, Group } from '@/types/db';

/** A directed obligation for display: `fromId` owes `toId`. */
export interface Edge {
  groupId: string | null;
  fromId: string;
  toId: string;
  currency: string;
  amountMinor: number;
}

export type GroupNets = Map<string, Map<string, Map<string, number>>>; // group → currency → user → net

export function groupNetsFromRows(rows: BalanceRow[]): GroupNets {
  const out: GroupNets = new Map();
  for (const r of rows) {
    if (r.kind !== 'group_net' || !r.group_id) continue;
    let g = out.get(r.group_id);
    if (!g) out.set(r.group_id, (g = new Map()));
    let c = g.get(r.currency);
    if (!c) g.set(r.currency, (c = new Map()));
    c.set(r.user_id, Number(r.net_minor));
  }
  return out;
}

/**
 * The caller's balances as edges. In groups with "simplify debts" on, the
 * edges are the simplified suggested transfers computed from everyone's net
 * position; otherwise (and for non-group expenses) they are the exact
 * pairwise ledger balances.
 */
export function deriveMyEdges(rows: BalanceRow[], groups: Pick<Group, 'id' | 'simplify_debts'>[], me: string): Edge[] {
  const simplify = new Map(groups.map((g) => [g.id, g.simplify_debts]));
  const nets = groupNetsFromRows(rows);
  const edges: Edge[] = [];
  for (const [groupId, byCurrency] of nets) {
    if (!simplify.get(groupId)) continue;
    for (const [currency, m] of byCurrency) {
      for (const t of simplifyDebts(m)) {
        if (t.fromUserId === me || t.toUserId === me) edges.push({ groupId, fromId: t.fromUserId, toId: t.toUserId, currency, amountMinor: t.amountMinor });
      }
    }
  }
  for (const r of rows) {
    if (r.kind !== 'pair') continue;
    if (r.group_id && simplify.get(r.group_id)) continue;
    const net = Number(r.net_minor);
    if (net > 0) edges.push({ groupId: r.group_id, fromId: r.user_id, toId: me, currency: r.currency, amountMinor: net });
    else if (net < 0) edges.push({ groupId: r.group_id, fromId: me, toId: r.user_id, currency: r.currency, amountMinor: -net });
  }
  return edges;
}

export interface CurrencyTotal {
  currency: string;
  owedToMe: number;
  iOwe: number;
  net: number;
}

export function totalsByCurrency(edges: Edge[], me: string): CurrencyTotal[] {
  const m = new Map<string, CurrencyTotal>();
  for (const e of edges) {
    let t = m.get(e.currency);
    if (!t) m.set(e.currency, (t = { currency: e.currency, owedToMe: 0, iOwe: 0, net: 0 }));
    if (e.toId === me) {
      t.owedToMe += e.amountMinor;
      t.net += e.amountMinor;
    } else if (e.fromId === me) {
      t.iOwe += e.amountMinor;
      t.net -= e.amountMinor;
    }
  }
  return [...m.values()].sort((a, b) => b.owedToMe + b.iOwe - (a.owedToMe + a.iOwe));
}

/** Net per counterparty per currency (positive = they owe me). */
export function byCounterparty(edges: Edge[], me: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const e of edges) {
    const other = e.fromId === me ? e.toId : e.fromId;
    const sign = e.toId === me ? 1 : -1;
    let m = out.get(other);
    if (!m) out.set(other, (m = new Map()));
    m.set(e.currency, (m.get(e.currency) ?? 0) + sign * e.amountMinor);
  }
  for (const [k, m] of out) {
    for (const [c, v] of m) if (v === 0) m.delete(c);
    if (m.size === 0) out.delete(k);
  }
  return out;
}

/** Pairwise netted balances for a whole group from its ledger lines (used when simplification is off). */
export function pairwiseFromLedger(lines: { debtor_id: string; creditor_id: string; currency: string; amount_minor: number }[]): Edge[] {
  const m = new Map<string, number>();
  for (const l of lines) {
    const [a, b] = [l.debtor_id, l.creditor_id].sort() as [string, string];
    const sign = l.debtor_id === a ? 1 : -1; // positive = a owes b
    const k = `${a}|${b}|${l.currency}`;
    m.set(k, (m.get(k) ?? 0) + sign * Number(l.amount_minor));
  }
  const edges: Edge[] = [];
  for (const [k, v] of m) {
    if (v === 0) continue;
    const [a, b, currency] = k.split('|') as [string, string, string];
    edges.push(v > 0 ? { groupId: null, fromId: a, toId: b, currency, amountMinor: v } : { groupId: null, fromId: b, toId: a, currency, amountMinor: -v });
  }
  return edges.sort((x, y) => y.amountMinor - x.amountMinor);
}
