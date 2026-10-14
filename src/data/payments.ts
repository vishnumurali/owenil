import { attributeExpense, type SettlementPayload } from '@owenil/core';
import type { Expense } from '@/types/db';
import type { Edge, GroupNets } from './balances';

/** What the app knows about the caller's balances, for working out payments. */
export interface PaymentContext {
  me: string;
  /** The caller's current balances (deriveMyEdges). */
  edges: Edge[];
  /** Everyone's net position per group (groupNetsFromRows). */
  groupNets: GroupNets;
  /** Group id → "simplify debts" on/off. */
  simplify: Map<string, boolean>;
  /** `${expenseId}|${payeeId}` → amount the caller already paid for that expense (non-reversed). */
  itemPaid: Map<string, number>;
}

export type ItemStatus = 'owe' | 'paid' | 'settled';

/** The caller's debt to one person for one expense. */
export interface ItemDebt {
  expenseId: string;
  groupId: string | null;
  creditorId: string;
  currency: string;
  /** The caller's share owed to this person for this expense. */
  shareMinor: number;
  /** Already paid specifically for this expense. */
  paidMinor: number;
  /** What a "Pay" button should pay now (0 unless status is "owe"). */
  payableMinor: number;
  /**
   * owe: something is still due · paid: paid for this expense ·
   * settled: the whole balance with them (in this group / outside groups) is clear.
   */
  status: ItemStatus;
}

/** How much the caller still owes `creditorId` in the expense's context. */
function outstandingInContext(groupId: string | null, creditorId: string, currency: string, ctx: PaymentContext): number {
  if (groupId && ctx.simplify.get(groupId)) {
    // Simplified groups settle against the group as a whole: what I owe overall there.
    const net = ctx.groupNets.get(groupId)?.get(currency)?.get(ctx.me) ?? 0;
    return net < 0 ? -net : 0;
  }
  return ctx.edges
    .filter((e) => e.groupId === groupId && e.fromId === ctx.me && e.toId === creditorId && e.currency === currency)
    .reduce((a, e) => a + e.amountMinor, 0);
}

/** The caller's debts on one expense, with whether each is still due, paid or settled. */
export function myItemDebts(expense: Pick<Expense, 'id' | 'group_id' | 'currency' | 'deleted_at' | 'expense_payers' | 'expense_splits'>, ctx: PaymentContext): ItemDebt[] {
  if (expense.deleted_at) return [];
  const payers = (expense.expense_payers ?? []).map((p) => ({ userId: p.user_id, amountMinor: Number(p.amount_minor) }));
  const splits = (expense.expense_splits ?? []).map((s) => ({ userId: s.user_id, amountMinor: Number(s.amount_minor) }));
  let lines;
  try {
    lines = attributeExpense(payers, splits);
  } catch {
    return [];
  }
  return lines
    .filter((l) => l.debtorId === ctx.me && l.amountMinor > 0)
    .map((l): ItemDebt => {
      const paidMinor = ctx.itemPaid.get(`${expense.id}|${l.creditorId}`) ?? 0;
      const remaining = Math.max(0, l.amountMinor - paidMinor);
      const outstanding = outstandingInContext(expense.group_id, l.creditorId, expense.currency, ctx);
      const base = { expenseId: expense.id, groupId: expense.group_id, creditorId: l.creditorId, currency: expense.currency, shareMinor: l.amountMinor, paidMinor };
      if (remaining === 0) return { ...base, payableMinor: 0, status: 'paid' };
      if (outstanding <= 0) return { ...base, payableMinor: 0, status: 'settled' };
      return { ...base, payableMinor: Math.min(remaining, outstanding), status: 'owe' };
    });
}

/** Everything the caller owes one person in one currency, combined across groups. */
export interface PersonPlan {
  personId: string;
  currency: string;
  /** Net amount to pay this person (always > 0). */
  totalMinor: number;
  /** Per group (null = outside groups): what I owe them, or what they owe me there. */
  parts: { groupId: string | null; iOweMinor: number; theyOweMinor: number }[];
}

/**
 * People the caller owes, netted across groups per currency. Someone who owes
 * the caller more than the caller owes them doesn't appear.
 */
export function paymentPlans(edges: Edge[], me: string): PersonPlan[] {
  const plans = new Map<string, PersonPlan>();
  for (const e of edges) {
    if (e.fromId !== me && e.toId !== me) continue;
    const personId = e.fromId === me ? e.toId : e.fromId;
    const k = `${personId}|${e.currency}`;
    let p = plans.get(k);
    if (!p) plans.set(k, (p = { personId, currency: e.currency, totalMinor: 0, parts: [] }));
    let part = p.parts.find((x) => x.groupId === e.groupId);
    if (!part) p.parts.push((part = { groupId: e.groupId, iOweMinor: 0, theyOweMinor: 0 }));
    if (e.fromId === me) {
      part.iOweMinor += e.amountMinor;
      p.totalMinor += e.amountMinor;
    } else {
      part.theyOweMinor += e.amountMinor;
      p.totalMinor -= e.amountMinor;
    }
  }
  return [...plans.values()]
    .filter((p) => p.totalMinor > 0)
    .map((p) => ({ ...p, parts: p.parts.sort((a, b) => b.iOweMinor - a.iOweMinor || b.theyOweMinor - a.theyOweMinor) }))
    .sort((a, b) => b.totalMinor - a.totalMinor);
}

/**
 * The repayments that settle a combined plan, recorded together. Where the
 * person owes the caller in some group, that is recorded as an offset (method
 * "other"), so every group's balance with them ends at zero and the money that
 * actually moved equals the plan total.
 */
export function planPayloads(plan: PersonPlan, me: string, opts: { settledOn: string; method: SettlementPayload['method']; note: string }): SettlementPayload[] {
  const out: SettlementPayload[] = [];
  for (const part of plan.parts) {
    if (part.iOweMinor > 0) {
      out.push({ group_id: part.groupId, payer_id: me, payee_id: plan.personId, amount_minor: part.iOweMinor, currency: plan.currency, settled_on: opts.settledOn, method: opts.method, note: opts.note });
    }
    if (part.theyOweMinor > 0) {
      out.push({
        group_id: part.groupId, payer_id: plan.personId, payee_id: me, amount_minor: part.theyOweMinor, currency: plan.currency, settled_on: opts.settledOn,
        method: 'other', note: `Offset in a combined payment (${opts.note})`.slice(0, 500),
      });
    }
  }
  return out;
}

/** The repayment for one expense debt. */
export function itemPayload(d: ItemDebt, me: string, opts: { settledOn: string; method: SettlementPayload['method']; note: string }): SettlementPayload {
  return {
    group_id: d.groupId, payer_id: me, payee_id: d.creditorId, amount_minor: d.payableMinor, currency: d.currency,
    settled_on: opts.settledOn, method: opts.method, note: opts.note, expense_id: d.expenseId,
  };
}
