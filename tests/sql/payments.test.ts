import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import { expensePayload } from './payload';

let t: TestDb;
let A: string, B: string, C: string, X: string;
let G: string, GE: string, FE: string, CE: string;
const key = () => `pay-${Math.random().toString(36).slice(2)}`;
const today = () => new Date().toISOString().slice(0, 10);
const pay = (p: Record<string, unknown>) => ({ settled_on: today(), currency: 'INR', method: 'upi', note: null, group_id: null, ...p });

/** Pairwise balance between two people in one context (positive = a owes b). */
async function owes(a: string, b: string, groupId: string | null): Promise<number> {
  const [r] = await t.admin<{ n: string }>(
    `select coalesce(sum(case when debtor_id = $1 then amount_minor else -amount_minor end), 0)::text as n
       from public.ledger_entries
      where group_id is not distinct from $3::uuid and ((debtor_id = $1 and creditor_id = $2) or (debtor_id = $2 and creditor_id = $1))`,
    [a, b, groupId],
  );
  return Number(r!.n);
}

beforeAll(async () => {
  t = await createTestDb();
  A = await t.createUser('Asha');
  B = await t.createUser('Bala');
  C = await t.createUser('Chitra');
  X = await t.createUser('Xavi');
  for (const u of [B, C]) {
    const inv = await t.rpc<{ token: string }>(A, 'create_friend_invitation', { p_email: null });
    await t.rpc(u, 'accept_friend_invitation', { p_token: inv.token });
  }
  G = await t.rpc<string>(A, 'create_group', { p_name: 'Trip', p_member_ids: [B, C] });
  // Group: Asha paid 3,000 for three → Bala owes Asha 1,000 in the group.
  GE = (await t.rpc<{ expense_id: string }>(A, 'create_expense', {
    p_payload: expensePayload({ groupId: G, amount: 300000, payers: [[A, 300000]], participants: [A, B, C], description: 'Villa' }), p_idempotency_key: key(),
  })).expense_id;
  // Between friends: Asha paid 800 for two → Bala owes Asha 400 outside groups.
  FE = (await t.rpc<{ expense_id: string }>(A, 'create_expense', {
    p_payload: expensePayload({ amount: 80000, payers: [[A, 80000]], participants: [A, B], description: 'Dinner' }), p_idempotency_key: key(),
  })).expense_id;
  // Between friends: Bala paid 300 for two → Asha owes Bala 150 (offsets part of the above).
  CE = (await t.rpc<{ expense_id: string }>(B, 'create_expense', {
    p_payload: expensePayload({ amount: 30000, payers: [[B, 30000]], participants: [A, B], description: 'Coffee' }), p_idempotency_key: key(),
  })).expense_id;
});

describe('paying for one expense', () => {
  it('records the repayment against the expense and reduces the balance', async () => {
    expect(await owes(B, A, G)).toBe(100000);
    const r = await t.rpc<{ settlement_id: string }>(B, 'record_settlement', {
      p_payload: pay({ group_id: G, payer_id: B, payee_id: A, amount_minor: 100000, expense_id: GE }), p_idempotency_key: key(),
    });
    const [s] = await t.as<{ expense_id: string }>(A, 'select expense_id from public.settlements where id = $1', [r.settlement_id]);
    expect(s?.expense_id).toBe(GE);
    expect(await owes(B, A, G)).toBe(0);
    // Asha is told which expense it was for.
    const [n] = await t.as<{ body: string; link: string }>(A, `select body, link from public.notifications where kind = 'settlement_recorded' order by created_at desc limit 1`);
    expect(n).toMatchObject({ link: `/expenses/${GE}` });
    expect(n?.body).toContain('for “Villa”');
  });

  it('rejects an expense from another balance, the wrong direction or someone not on it', async () => {
    // Group expense but recorded outside the group.
    await expect(t.rpc(B, 'record_settlement', { p_payload: pay({ payer_id: B, payee_id: A, amount_minor: 100, expense_id: GE }) })).rejects.toThrow(/isn’t part of this balance/);
    // Asha paid for it, so she can't "pay back" Bala for it.
    await expect(t.rpc(A, 'record_settlement', { p_payload: pay({ payer_id: A, payee_id: B, amount_minor: 100, expense_id: FE }) })).rejects.toThrow(/Only someone sharing this expense/);
    // Wrong currency.
    await expect(t.rpc(B, 'record_settlement', { p_payload: pay({ payer_id: B, payee_id: A, amount_minor: 100, currency: 'USD', expense_id: FE }) })).rejects.toThrow(/isn’t part of this balance/);
  });
});

describe('paying everything to one person at once', () => {
  it('records every part in one go, including an offset, and zeroes the balance', async () => {
    // Outside groups: Bala owes 400 for dinner, Asha owes 150 for coffee → net 250.
    expect(await owes(B, A, null)).toBe(25000);
    const k = key();
    const parts = [
      pay({ payer_id: B, payee_id: A, amount_minor: 25000, note: 'Combined UPI payment' }),
    ];
    const r1 = await t.rpc<{ settlement_ids: string[] }>(B, 'record_settlements', { p_payloads: parts, p_idempotency_key: k });
    expect(r1.settlement_ids).toHaveLength(1);
    expect(await owes(B, A, null)).toBe(0);
    // Retrying the same request records nothing new.
    const r2 = await t.rpc<{ settlement_ids: string[] }>(B, 'record_settlements', { p_payloads: parts, p_idempotency_key: k });
    expect(r2.settlement_ids).toEqual(r1.settlement_ids);
  });

  it('is all-or-nothing: one invalid part records none of them', async () => {
    const before = await t.admin<{ n: string }>('select count(*)::text as n from public.settlements');
    await expect(t.rpc(C, 'record_settlements', {
      p_payloads: [
        pay({ group_id: G, payer_id: C, payee_id: A, amount_minor: 100000 }),
        pay({ payer_id: C, payee_id: X, amount_minor: 500 }), // not friends
      ],
      p_idempotency_key: key(),
    })).rejects.toThrow(/only record repayments with friends/);
    const after = await t.admin<{ n: string }>('select count(*)::text as n from public.settlements');
    expect(after[0]!.n).toBe(before[0]!.n);
    expect(await owes(C, A, G)).toBe(100000);
  });

  it('only lets people record repayments they are part of', async () => {
    await expect(t.rpc(X, 'record_settlements', { p_payloads: [pay({ group_id: G, payer_id: C, payee_id: A, amount_minor: 100 })] })).rejects.toThrow(/Only the people involved/);
    await expect(t.rpc(C, 'record_settlements', { p_payloads: [] })).rejects.toThrow(/between 1 and 50/);
    await expect(t.rpc(null, 'record_settlements', { p_payloads: [pay({ group_id: G, payer_id: C, payee_id: A, amount_minor: 100 })] })).rejects.toThrow();
  });

  it('reversing an item payment makes the expense unpaid again', async () => {
    const [s] = await t.admin<{ id: string }>('select id from public.settlements where expense_id = $1', [GE]);
    await t.rpc(A, 'reverse_settlement', { p_settlement_id: s!.id, p_reason: 'test' });
    expect(await owes(B, A, G)).toBe(100000);
    const live = await t.as(B, 'select id from public.settlements where expense_id = $1 and reversed_at is null', [GE]);
    expect(live).toEqual([]);
    void CE;
  });
});
