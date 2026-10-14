import { describe, expect, it } from 'vitest';
import type { Edge, GroupNets } from './balances';
import { itemPayload, myItemDebts, paymentPlans, planPayloads, type PaymentContext } from './payments';

const ME = 'me';
const expense = (id: string, groupId: string | null, payers: [string, number][], splits: [string, number][]) => ({
  id, group_id: groupId, currency: 'INR', deleted_at: null,
  expense_payers: payers.map(([user_id, amount_minor]) => ({ user_id, amount_minor })),
  expense_splits: splits.map(([user_id, amount_minor]) => ({ user_id, amount_minor })),
}) as never;

function ctx(edges: Edge[], over: Partial<PaymentContext> = {}): PaymentContext {
  return { me: ME, edges, groupNets: new Map(), simplify: new Map(), itemPaid: new Map(), ...over };
}

describe('myItemDebts', () => {
  const villa = expense('e1', 'g1', [['asha', 300000]], [['asha', 100000], [ME, 100000], ['bala', 100000]]);

  it('offers to pay my share when it is still owed', () => {
    const c = ctx([{ groupId: 'g1', fromId: ME, toId: 'asha', currency: 'INR', amountMinor: 100000 }]);
    expect(myItemDebts(villa, c)).toEqual([
      { expenseId: 'e1', groupId: 'g1', creditorId: 'asha', currency: 'INR', shareMinor: 100000, paidMinor: 0, payableMinor: 100000, status: 'owe' },
    ]);
  });

  it('never asks for more than I still owe that person there', () => {
    const c = ctx([{ groupId: 'g1', fromId: ME, toId: 'asha', currency: 'INR', amountMinor: 30000 }]);
    expect(myItemDebts(villa, c)[0]).toMatchObject({ status: 'owe', payableMinor: 30000 });
  });

  it('is "paid" once paid for this expense, even if other debts to them remain', () => {
    const c = ctx([{ groupId: 'g1', fromId: ME, toId: 'asha', currency: 'INR', amountMinor: 50000 }], { itemPaid: new Map([['e1|asha', 100000]]) });
    expect(myItemDebts(villa, c)[0]).toMatchObject({ status: 'paid', payableMinor: 0 });
  });

  it('is "settled" when nothing is owed to them any more (e.g. paid via Settle up)', () => {
    expect(myItemDebts(villa, ctx([]))[0]).toMatchObject({ status: 'settled', payableMinor: 0 });
  });

  it('in simplified groups, uses what I owe the group overall', () => {
    const groupNets: GroupNets = new Map([['g1', new Map([['INR', new Map([[ME, -40000], ['asha', 40000]])]])]]);
    const c = ctx([], { simplify: new Map([['g1', true]]), groupNets });
    expect(myItemDebts(villa, c)[0]).toMatchObject({ status: 'owe', payableMinor: 40000 });
  });

  it('ignores expenses where I owe nothing, and deleted ones', () => {
    const mine = expense('e2', null, [[ME, 1000]], [[ME, 500], ['asha', 500]]);
    expect(myItemDebts(mine, ctx([]))).toEqual([]);
    expect(myItemDebts({ ...(villa as object), deleted_at: '2026-10-14' } as never, ctx([]))).toEqual([]);
  });

  it('builds a repayment linked to the expense', () => {
    const c = ctx([{ groupId: 'g1', fromId: ME, toId: 'asha', currency: 'INR', amountMinor: 100000 }]);
    const p = itemPayload(myItemDebts(villa, c)[0]!, ME, { settledOn: '2026-10-14', method: 'upi', note: 'Villa' });
    expect(p).toEqual({ group_id: 'g1', payer_id: ME, payee_id: 'asha', amount_minor: 100000, currency: 'INR', settled_on: '2026-10-14', method: 'upi', note: 'Villa', expense_id: 'e1' });
  });
});

describe('paymentPlans (combine everything I owe one person)', () => {
  const edges: Edge[] = [
    { groupId: 'g1', fromId: ME, toId: 'asha', currency: 'INR', amountMinor: 120000 },
    { groupId: null, fromId: ME, toId: 'asha', currency: 'INR', amountMinor: 40000 },
    { groupId: 'g2', fromId: 'asha', toId: ME, currency: 'INR', amountMinor: 25000 },
    { groupId: 'g1', fromId: 'bala', toId: ME, currency: 'INR', amountMinor: 90000 },
    { groupId: null, fromId: ME, toId: 'bala', currency: 'INR', amountMinor: 10000 },
    { groupId: 'g3', fromId: ME, toId: 'asha', currency: 'USD', amountMinor: 500 },
  ];

  it('nets across groups per person and currency, keeping only people I owe', () => {
    const plans = paymentPlans(edges, ME);
    expect(plans.map((p) => [p.personId, p.currency, p.totalMinor])).toEqual([
      ['asha', 'INR', 135000],
      ['asha', 'USD', 500],
    ]);
    expect(plans[0]!.parts).toEqual([
      { groupId: 'g1', iOweMinor: 120000, theyOweMinor: 0 },
      { groupId: null, iOweMinor: 40000, theyOweMinor: 0 },
      { groupId: 'g2', iOweMinor: 0, theyOweMinor: 25000 },
    ]);
  });

  it('records one repayment per group plus an offset, moving exactly the total', () => {
    const plan = paymentPlans(edges, ME)[0]!;
    const payloads = planPayloads(plan, ME, { settledOn: '2026-10-14', method: 'upi', note: 'Combined UPI payment' });
    expect(payloads.map((p) => [p.group_id, p.payer_id, p.payee_id, p.amount_minor, p.method])).toEqual([
      ['g1', ME, 'asha', 120000, 'upi'],
      [null, ME, 'asha', 40000, 'upi'],
      ['g2', 'asha', ME, 25000, 'other'],
    ]);
    const moved = payloads.reduce((a, p) => a + (p.payer_id === ME ? p.amount_minor : -p.amount_minor), 0);
    expect(moved).toBe(plan.totalMinor);
    expect(payloads[2]!.note).toMatch(/^Offset in a combined payment/);
  });
});
