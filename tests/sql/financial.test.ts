import { beforeAll, describe, expect, it } from 'vitest';
import { attributeExpense, computeSplit, occurrenceDate, simplifyDebts } from '../../packages/core/src';
import { createTestDb, type TestDb } from './harness';
import { expensePayload } from './payload';

let t: TestDb;
let A: string, B: string, C: string, D: string;
let G: string;

const nets = async (groupId: string, as = A) => {
  const rows = await t.as<{ user_id: string; currency: string; net_minor: string }>(as, 'select * from public.get_group_balances($1)', [groupId]);
  return Object.fromEntries(rows.map((r) => [r.user_id, Number(r.net_minor)]));
};
const key = () => `test-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const befriend = async (x: string, y: string) => {
  const inv = await t.rpc<{ token: string }>(x, 'create_friend_invitation', { p_email: null });
  await t.rpc(y, 'accept_friend_invitation', { p_token: inv.token });
};

beforeAll(async () => {
  t = await createTestDb();
  A = await t.createUser('Aarav');
  B = await t.createUser('Bianca');
  C = await t.createUser('Chen');
  D = await t.createUser('Dara');
  await befriend(A, B);
  await befriend(A, C);
  await befriend(A, D);
  G = await t.rpc<string>(A, 'create_group', { p_name: 'Goa trip', p_group_type: 'travel', p_currency: 'INR', p_member_ids: [B, C] });
});

describe('signup bootstrap', () => {
  it('creates profile, preferences and a free entitlement', async () => {
    const [p] = await t.admin<{ display_name: string; plan: string; theme: string }>(
      `select p.display_name, s.plan::text, up.theme from public.profiles p
         join public.subscription_entitlements s on s.user_id = p.id join public.user_preferences up on up.user_id = p.id where p.id = $1`,
      [A],
    );
    expect(p).toEqual({ display_name: 'Aarav', plan: 'free', theme: 'system' });
  });
});

describe('required example: ₹3,000 split equally by three, paid by one', () => {
  it('records ₹1,000 shares and correct balances', async () => {
    const res = await t.rpc<{ expense_id: string }>(A, 'create_expense', {
      p_payload: expensePayload({ groupId: G, amount: 300000, payers: [[A, 300000]], participants: [A, B, C], description: 'Villa' }),
      p_idempotency_key: key(),
    });
    const splits = await t.as<{ user_id: string; amount_minor: string }>(B, 'select user_id, amount_minor from public.expense_splits where expense_id = $1', [res.expense_id]);
    expect(splits.map((s) => Number(s.amount_minor))).toEqual([100000, 100000, 100000]);
    expect(await nets(G)).toEqual({ [A]: 200000, [B]: -100000, [C]: -100000 });
  });
});

describe('ledger', () => {
  it('matches the core attribution algorithm for multiple payers', async () => {
    const payload = expensePayload({ groupId: G, amount: 120001, payers: [[B, 80000], [C, 40001]], participants: [A, B, C], description: 'Dinner' });
    const { expense_id } = await t.rpc<{ expense_id: string }>(B, 'create_expense', { p_payload: payload, p_idempotency_key: key() });
    const lines = await t.admin<{ debtor_id: string; creditor_id: string; amount_minor: string }>(
      `select debtor_id, creditor_id, amount_minor from public.ledger_entries where source_id = $1 order by created_at, debtor_id, creditor_id`,
      [expense_id],
    );
    const expected = attributeExpense(
      [{ userId: B, amountMinor: 80000 }, { userId: C, amountMinor: 40001 }],
      computeSplit({ method: 'equal', totalMinor: 120001, participants: [A, B, C].map((userId) => ({ userId })) }),
    );
    const norm = (xs: { d: string; c: string; a: number }[]) => xs.map((x) => `${x.d}>${x.c}:${x.a}`).sort();
    expect(norm(lines.map((l) => ({ d: l.debtor_id, c: l.creditor_id, a: Number(l.amount_minor) })))).toEqual(
      norm(expected.map((o) => ({ d: o.debtorId, c: o.creditorId, a: o.amountMinor }))),
    );
  });

  it('group nets always sum to zero', async () => {
    const n = await nets(G);
    expect(Object.values(n).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('is append-only even for the database owner', async () => {
    await expect(t.admin('delete from public.ledger_entries')).rejects.toThrow(/append-only/);
    await expect(t.admin('update public.ledger_entries set amount_minor = 1')).rejects.toThrow(/append-only/);
  });
});

describe('idempotency', () => {
  it('replays the same request without creating a duplicate', async () => {
    const k = key();
    const payload = expensePayload({ groupId: G, amount: 5000, payers: [[A, 5000]], participants: [A, B] });
    const first = await t.rpc<{ expense_id: string }>(A, 'create_expense', { p_payload: payload, p_idempotency_key: k });
    const second = await t.rpc<{ expense_id: string; replayed: boolean }>(A, 'create_expense', { p_payload: payload, p_idempotency_key: k });
    expect(second.expense_id).toBe(first.expense_id);
    expect(second.replayed).toBe(true);
    const [{ n }] = await t.admin<{ n: number }>(`select count(*)::int n from public.expenses where id = $1`, [first.expense_id]) as [{ n: number }];
    expect(n).toBe(1);
  });

  it('rejects reusing a key for a different request', async () => {
    const k = key();
    await t.rpc(A, 'create_expense', { p_payload: expensePayload({ groupId: G, amount: 100, payers: [[A, 100]], participants: [A, B] }), p_idempotency_key: k });
    await expect(
      t.rpc(A, 'create_expense', { p_payload: expensePayload({ groupId: G, amount: 200, payers: [[A, 200]], participants: [A, B] }), p_idempotency_key: k }),
    ).rejects.toThrow(/already used/);
  });

  it('never records a settlement twice for a retried request', async () => {
    const k = key();
    const p = { group_id: G, payer_id: B, payee_id: A, amount_minor: 100, currency: 'INR', settled_on: new Date().toISOString().slice(0, 10), method: 'upi', note: null };
    const r1 = await t.rpc<{ settlement_id: string }>(B, 'record_settlement', { p_payload: p, p_idempotency_key: k });
    const r2 = await t.rpc<{ settlement_id: string }>(B, 'record_settlement', { p_payload: p, p_idempotency_key: k });
    expect(r2.settlement_id).toBe(r1.settlement_id);
    const rows = await t.admin(`select 1 from public.settlements where id = $1`, [r1.settlement_id]);
    expect(rows).toHaveLength(1);
    await t.rpc(B, 'reverse_settlement', { p_settlement_id: r1.settlement_id, p_reason: 'test cleanup' });
  });
});

describe('editing, deleting and restoring expenses', () => {
  let G2: string;
  let E: string;
  beforeAll(async () => {
    G2 = await t.rpc<string>(A, 'create_group', { p_name: 'Flat 4B', p_group_type: 'home', p_currency: 'INR', p_member_ids: [B, C] });
    const r = await t.rpc<{ expense_id: string }>(A, 'create_expense', {
      p_payload: expensePayload({ groupId: G2, amount: 300000, payers: [[A, 300000]], participants: [A, B, C] }),
      p_idempotency_key: key(),
    });
    E = r.expense_id;
  });

  it('reverses the old allocation and applies the new one exactly once', async () => {
    const r = await t.rpc<{ version: number }>(A, 'update_expense', {
      p_expense_id: E,
      p_expected_version: 1,
      p_payload: expensePayload({ groupId: G2, amount: 240000, payers: [[A, 240000]], participants: [A, B] }),
      p_idempotency_key: key(),
    });
    expect(r.version).toBe(2);
    expect(await nets(G2)).toEqual({ [A]: 120000, [B]: -120000 });
    const revisions = await t.as(B, `select version, change_type from public.expense_revisions where expense_id = $1 order by version`, [E]);
    expect(revisions).toEqual([{ version: 1, change_type: 'created' }, { version: 2, change_type: 'updated' }]);
  });

  it('rejects stale edits (optimistic concurrency)', async () => {
    await expect(
      t.rpc(B, 'update_expense', {
        p_expense_id: E,
        p_expected_version: 1,
        p_payload: expensePayload({ groupId: G2, amount: 1000, payers: [[B, 1000]], participants: [A, B] }),
        p_idempotency_key: key(),
      }),
    ).rejects.toThrow(/changed this expense/);
  });

  it('delete removes the effect; restore re-applies it', async () => {
    await t.rpc(B, 'delete_expense', { p_expense_id: E, p_expected_version: 2 });
    expect(await nets(G2)).toEqual({});
    await t.rpc(B, 'restore_expense', { p_expense_id: E });
    expect(await nets(G2)).toEqual({ [A]: 120000, [B]: -120000 });
  });

  it('partial then full repayment returns balances to zero; reversal restores the debt', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const s1 = await t.rpc<{ settlement_id: string }>(B, 'record_settlement', {
      p_payload: { group_id: G2, payer_id: B, payee_id: A, amount_minor: 20000, currency: 'INR', settled_on: today, method: 'cash', note: 'part' },
      p_idempotency_key: key(),
    });
    expect(await nets(G2)).toEqual({ [A]: 100000, [B]: -100000 });
    await t.rpc(A, 'record_settlement', {
      p_payload: { group_id: G2, payer_id: B, payee_id: A, amount_minor: 100000, currency: 'INR', settled_on: today, method: 'upi', note: null },
      p_idempotency_key: key(),
    });
    expect(await nets(G2)).toEqual({});
    await t.rpc(A, 'reverse_settlement', { p_settlement_id: s1.settlement_id, p_reason: 'bounced' });
    expect(await nets(G2)).toEqual({ [A]: 20000, [B]: -20000 });
  });

  it('blocks leaving or removal while a balance is open', async () => {
    await expect(t.rpc(B, 'leave_group', { p_group_id: G2 })).rejects.toThrow(/unsettled balance/);
    await expect(t.rpc(A, 'remove_group_member', { p_group_id: G2, p_user_id: B })).rejects.toThrow(/unsettled balance/);
    await t.rpc(C, 'leave_group', { p_group_id: G2 }); // C has no balance → can leave
    const [m] = await t.admin<{ status: string }>(`select status::text from public.group_members where group_id = $1 and user_id = $2`, [G2, C]);
    expect(m!.status).toBe('left');
  });
});

describe('server-side validation rejects tampered payloads', () => {
  it('rejects splits that do not add up', async () => {
    const p = expensePayload({ groupId: G, amount: 1000, payers: [[A, 1000]], participants: [A, B] });
    p.splits[0]!.amount_minor += 1;
    await expect(t.rpc(A, 'create_expense', { p_payload: p, p_idempotency_key: key() })).rejects.toThrow(/Shares must add up/);
  });
  it('rejects allocations inconsistent with the method', async () => {
    const p = expensePayload({ groupId: G, amount: 1000, payers: [[A, 1000]], participants: [A, B] });
    p.splits = [{ user_id: A, amount_minor: 100 }, { user_id: B, amount_minor: 900 }]; // claims "equal"
    await expect(t.rpc(A, 'create_expense', { p_payload: p, p_idempotency_key: key() })).rejects.toThrow(/does not match the chosen split/);
  });
  it('rejects payer totals that differ from the amount', async () => {
    const p = expensePayload({ groupId: G, amount: 1000, payers: [[A, 1000]], participants: [A, B] });
    p.payers[0]!.amount_minor = 999;
    await expect(t.rpc(A, 'create_expense', { p_payload: p, p_idempotency_key: key() })).rejects.toThrow(/Payer amounts/);
  });
  it('rejects people outside the group', async () => {
    const p = expensePayload({ groupId: G, amount: 1000, payers: [[A, 1000]], participants: [A, D] });
    await expect(t.rpc(A, 'create_expense', { p_payload: p, p_idempotency_key: key() })).rejects.toThrow(/current member/);
  });
  it('rejects non-group expenses with non-friends', async () => {
    const p = expensePayload({ amount: 1000, payers: [[B, 1000]], participants: [B, C] });
    await expect(t.rpc(B, 'create_expense', { p_payload: p, p_idempotency_key: key() })).rejects.toThrow(/friends/);
  });
  it('accepts every split method', async () => {
    const methods = [
      expensePayload({ groupId: G, amount: 10000, payers: [[A, 10000]], participants: [{ userId: A, value: 2500 }, { userId: B, value: 7500 }], method: 'exact' }),
      expensePayload({ groupId: G, amount: 10001, payers: [[A, 10001]], participants: [{ userId: A, value: 3333 }, { userId: B, value: 3333 }, { userId: C, value: 3334 }], method: 'percentage' }),
      expensePayload({ groupId: G, amount: 10001, payers: [[A, 6000], [B, 4001]], participants: [{ userId: A, value: 200 }, { userId: B, value: 100 }, { userId: C, value: 150 }], method: 'shares' }),
      expensePayload({ groupId: G, amount: 10000, payers: [[C, 10000]], participants: [{ userId: A, value: 1000 }, { userId: B, value: 0 }, { userId: C, value: -500 }], method: 'adjustment' }),
      expensePayload({ groupId: G, amount: 900, payers: [[A, 900]], participants: [{ userId: A }, { userId: B, included: false }, { userId: C }] }),
    ];
    for (const p of methods) await t.rpc(A, 'create_expense', { p_payload: p, p_idempotency_key: key() });
    const n = await nets(G);
    expect(Object.values(n).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('debt simplification over real balances', () => {
  it('suggested transfers preserve every net position', async () => {
    const n = await nets(G);
    const transfers = simplifyDebts(n);
    const after = { ...n };
    for (const tr of transfers) {
      after[tr.fromUserId] = (after[tr.fromUserId] ?? 0) + tr.amountMinor;
      after[tr.toUserId] = (after[tr.toUserId] ?? 0) - tr.amountMinor;
    }
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
    // Recording the suggestions as settlements actually zeroes the group.
    const today = new Date().toISOString().slice(0, 10);
    for (const tr of transfers) {
      await t.rpc(tr.fromUserId, 'record_settlement', {
        p_payload: { group_id: G, payer_id: tr.fromUserId, payee_id: tr.toUserId, amount_minor: tr.amountMinor, currency: 'INR', settled_on: today, method: 'upi', note: null },
        p_idempotency_key: key(),
      });
    }
    expect(await nets(G)).toEqual({});
  });
});

describe('recurring expenses', () => {
  it('backfills due occurrences exactly once and is idempotent', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const start = occurrenceDate(today, 'monthly', 0).replace(/-\d{2}$/, '-01');
    const startTwoMonthsAgo = (() => {
      const d = new Date(start + 'T00:00:00Z');
      d.setUTCMonth(d.getUTCMonth() - 2);
      return d.toISOString().slice(0, 10);
    })();
    const p = expensePayload({ groupId: G, amount: 60000, payers: [[A, 60000]], participants: [A, B, C], description: 'Netflix + wifi' });
    const id = await t.rpc<string>(A, 'create_recurring_template', { p_payload: p, p_frequency: 'monthly', p_start_date: startTwoMonthsAgo, p_end_date: null });
    const count = async () =>
      (await t.admin<{ n: number }>(`select count(*)::int n from public.expenses where recurring_template_id = $1`, [id]))[0]!.n;
    expect(await count()).toBe(3);
    expect(await t.rpc<number>(A, 'run_due_recurring_now', {})).toBe(0);
    await t.admin('select public.generate_due_recurring_expenses()');
    expect(await count()).toBe(3);
    await t.rpc(A, 'set_recurring_status', { p_template_id: id, p_status: 'paused' });
    await t.rpc(A, 'set_recurring_status', { p_template_id: id, p_status: 'active' });
    expect(await count()).toBe(3);
    await t.rpc(A, 'set_recurring_status', { p_template_id: id, p_status: 'cancelled' });
    const [tpl] = await t.admin<{ status: string; next_occurrence_on: string | null }>(`select status::text, next_occurrence_on from public.recurring_expense_templates where id = $1`, [id]);
    expect(tpl).toEqual({ status: 'cancelled', next_occurrence_on: null });
  });

  it('limits free accounts to weekly/monthly schedules', async () => {
    const p = expensePayload({ groupId: G, amount: 1000, payers: [[A, 1000]], participants: [A, B] });
    await expect(t.rpc(A, 'create_recurring_template', { p_payload: p, p_frequency: 'yearly', p_start_date: '2030-01-01', p_end_date: null })).rejects.toThrow(/Plus/);
  });
});

describe('multi-currency', () => {
  it('keeps balances per currency and never mixes them', async () => {
    const G3 = await t.rpc<string>(A, 'create_group', { p_name: 'Europe', p_group_type: 'travel', p_currency: 'EUR', p_member_ids: [B] });
    await t.rpc(A, 'create_expense', { p_payload: expensePayload({ groupId: G3, amount: 10000, currency: 'EUR', payers: [[A, 10000]], participants: [A, B] }), p_idempotency_key: key() });
    await t.rpc(B, 'create_expense', { p_payload: expensePayload({ groupId: G3, amount: 3000, currency: 'JPY', payers: [[B, 3000]], participants: [A, B] }), p_idempotency_key: key() });
    const rows = await t.as<{ user_id: string; currency: string; net_minor: string }>(A, 'select * from public.get_group_balances($1) order by currency, user_id', [G3]);
    const byCur = (c: string) => Object.fromEntries(rows.filter((r) => r.currency === c).map((r) => [r.user_id, Number(r.net_minor)]));
    expect(byCur('EUR')).toEqual({ [A]: 5000, [B]: -5000 });
    expect(byCur('JPY')).toEqual({ [A]: -1500, [B]: 1500 });
  });
});
