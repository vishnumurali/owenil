import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import { expensePayload } from './payload';

let t: TestDb;
let A: string, B: string, X: string, T: string;
let G: string, E: string, PE: string, S: string;
const key = () => `auth-${Math.random().toString(36).slice(2)}-${Date.now()}`;

beforeAll(async () => {
  t = await createTestDb();
  A = await t.createUser('Owner Ana');
  B = await t.createUser('Member Ben');
  X = await t.createUser('Outsider Xia');
  T = await t.createUser('Tester Tom', { tester: true });
  const inv = await t.rpc<{ token: string }>(A, 'create_friend_invitation', { p_email: null });
  await t.rpc(B, 'accept_friend_invitation', { p_token: inv.token });
  G = await t.rpc<string>(A, 'create_group', { p_name: 'Private group', p_member_ids: [B] });
  E = (await t.rpc<{ expense_id: string }>(A, 'create_expense', {
    p_payload: expensePayload({ groupId: G, amount: 5000, payers: [[A, 5000]], participants: [A, B] }), p_idempotency_key: key(),
  })).expense_id;
  PE = (await t.rpc<{ expense_id: string }>(A, 'create_expense', {
    p_payload: expensePayload({ amount: 8000, payers: [[A, 8000]], participants: [A, B], description: 'Private dinner' }), p_idempotency_key: key(),
  })).expense_id;
  S = (await t.rpc<{ settlement_id: string }>(B, 'record_settlement', {
    p_payload: { group_id: null, payer_id: B, payee_id: A, amount_minor: 1000, currency: 'INR', settled_on: new Date().toISOString().slice(0, 10), method: 'cash', note: null },
    p_idempotency_key: key(),
  })).settlement_id;
});

describe('harness sanity', () => {
  it('really runs queries as the authenticated role', async () => {
    const [r] = await t.as<{ role: string; uid: string }>(B, 'select current_user as role, auth.uid()::text as uid');
    expect(r).toEqual({ role: 'authenticated', uid: B });
  });
});

describe('members can see their data', () => {
  it('group member sees the group, expense, splits and ledger', async () => {
    expect(await t.as(B, 'select id from public.groups where id = $1', [G])).toHaveLength(1);
    expect(await t.as(B, 'select id from public.expenses where id = $1', [E])).toHaveLength(1);
    expect(await t.as(B, 'select * from public.expense_splits where expense_id = $1', [E])).toHaveLength(2);
    expect((await t.as(B, 'select * from public.ledger_entries where group_id = $1', [G])).length).toBeGreaterThan(0);
  });
});

describe('an outsider cannot read or modify private data', () => {
  const tables = ['groups', 'group_members', 'expenses', 'expense_payers', 'expense_participants', 'expense_splits',
    'expense_revisions', 'settlements', 'ledger_entries', 'activity_events', 'notifications', 'friendships',
    'subscription_entitlements', 'user_preferences', 'budgets', 'receipt_metadata'];
  for (const table of tables) {
    it(`sees none of A/B's rows in ${table}`, async () => {
      const rows = await t.as<Record<string, unknown>>(X, `select * from public.${table}`);
      const leaked = rows.filter((r) => JSON.stringify(r).includes(A) || JSON.stringify(r).includes(B));
      expect(leaked).toEqual([]);
    });
  }

  it('cannot see their profiles', async () => {
    expect(await t.as(X, 'select id from public.profiles where id in ($1, $2)', [A, B])).toEqual([]);
  });

  it('cannot call balance functions for a foreign group', async () => {
    await expect(t.as(X, 'select * from public.get_group_balances($1)', [G])).rejects.toThrow(/not a member/);
  });

  it('cannot add, edit, delete or restore expenses in the group', async () => {
    await expect(
      t.rpc(X, 'create_expense', { p_payload: expensePayload({ groupId: G, amount: 100, payers: [[X, 100]], participants: [X] }), p_idempotency_key: key() }),
    ).rejects.toThrow(/not a member/);
    await expect(
      t.rpc(X, 'update_expense', { p_expense_id: E, p_expected_version: 1, p_payload: expensePayload({ groupId: G, amount: 1, payers: [[X, 1]], participants: [X] }), p_idempotency_key: key() }),
    ).rejects.toThrow(/not found/i);
    await expect(t.rpc(X, 'delete_expense', { p_expense_id: E, p_expected_version: 1 })).rejects.toThrow(/not found/i);
    await expect(t.rpc(X, 'delete_expense', { p_expense_id: PE, p_expected_version: 1 })).rejects.toThrow(/not found/i);
  });

  it('cannot reverse or fake settlements between others', async () => {
    await expect(t.rpc(X, 'reverse_settlement', { p_settlement_id: S, p_reason: 'x' })).rejects.toThrow(/not found/i);
    await expect(
      t.rpc(X, 'record_settlement', {
        p_payload: { group_id: G, payer_id: A, payee_id: B, amount_minor: 100, currency: 'INR', settled_on: '2026-01-01', method: 'cash', note: null },
        p_idempotency_key: key(),
      }),
    ).rejects.toThrow(/Only the people involved/);
  });

  it('cannot manage group membership', async () => {
    await expect(t.rpc(X, 'set_group_member_role', { p_group_id: G, p_user_id: B, p_role: 'owner' })).rejects.toThrow(/not a member/);
    await expect(t.rpc(X, 'remove_group_member', { p_group_id: G, p_user_id: B })).rejects.toThrow(/not a member/);
    await expect(t.rpc(X, 'create_group_invitation', { p_group_id: G })).rejects.toThrow(/not a member/);
    await expect(t.rpc(X, 'add_group_members', { p_group_id: G, p_user_ids: [X] })).rejects.toThrow(/not a member/);
  });

  it('cannot write financial tables directly (no grants)', async () => {
    await expect(t.as(X, `insert into public.expenses (description, amount_minor, currency, expense_date, split_method, created_by) values ('x', 1, 'INR', '2026-01-01', 'equal', $1)`, [X])).rejects.toThrow(/permission denied/);
    await expect(t.as(X, `insert into public.ledger_entries (currency, debtor_id, creditor_id, amount_minor, source_type, source_id) values ('INR', $1, $2, 100, 'expense', gen_random_uuid())`, [A, X])).rejects.toThrow(/permission denied/);
    await expect(t.as(B, `update public.expense_splits set amount_minor = 0 where expense_id = $1`, [E])).rejects.toThrow(/permission denied/);
    await expect(t.as(B, `delete from public.settlements where id = $1`, [S])).rejects.toThrow(/permission denied/);
  });

  it('cannot grant itself premium or tester status', async () => {
    await expect(t.as(X, `update public.subscription_entitlements set plan = 'plus' where user_id = $1`, [X])).rejects.toThrow(/permission denied/);
    await expect(t.as(X, `insert into public.subscription_entitlements (user_id, plan) values ($1, 'plus')`, [X])).rejects.toThrow(/permission denied/);
    await expect(t.as(X, `update public.profiles set is_tester = true where id = $1`, [X])).rejects.toThrow(/permission denied/);
    await expect(t.rpc(X, 'dev_set_plan', { p_plan: 'plus' })).rejects.toThrow(/disabled/);
    const [e] = await t.admin<{ plan: string }>(`select plan::text from public.subscription_entitlements where user_id = $1`, [X]);
    expect(e!.plan).toBe('free');
  });

  it('cannot read server configuration or idempotency records', async () => {
    await expect(t.as(X, 'select * from public.app_settings')).rejects.toThrow(/permission denied/);
    await expect(t.as(X, 'select * from public.idempotency_records')).rejects.toThrow(/permission denied/);
  });
});

describe('anonymous visitors', () => {
  it('cannot read any table or call RPCs', async () => {
    await expect(t.as(null, 'select * from public.expenses')).rejects.toThrow(/permission denied/);
    await expect(t.as(null, 'select * from public.profiles')).rejects.toThrow(/permission denied/);
    await expect(t.rpc(null, 'get_balance_overview', {})).rejects.toThrow(/permission denied/);
    await expect(t.rpc(null, 'create_expense', { p_payload: {}, p_idempotency_key: null })).rejects.toThrow(/permission denied/);
  });
});

describe('internal functions are not callable by clients', () => {
  it('blocks impersonation through internal helpers', async () => {
    const forged = expensePayload({ groupId: G, amount: 999, payers: [[B, 999]], participants: [A, B] });
    await expect(t.as(X, 'select public._create_expense_core($1, $2)', [forged, A])).rejects.toThrow(/permission denied/);
    await expect(t.as(B, 'select public._create_expense_core($1, $2)', [forged, A])).rejects.toThrow(/permission denied/);
    await expect(t.as(B, "select public._record_settlement_core($1, $2)", [{}, A])).rejects.toThrow(/permission denied/);
    await expect(t.as(B, 'select public._apply_expense_ledger($1, $2)', [E, A])).rejects.toThrow(/permission denied/);
    await expect(t.as(B, 'select public._make_friends($1, $2)', [B, X])).rejects.toThrow(/permission denied/);
    await expect(t.as(B, 'select public.generate_due_recurring_expenses()')).rejects.toThrow(/permission denied/);
    await expect(t.as(B, 'select public.cleanup_ephemeral_records()')).rejects.toThrow(/permission denied/);
    await expect(t.as(B, 'select * from public._group_nets($1)', [G])).rejects.toThrow(/permission denied/);
  });
});

describe('roles inside a group', () => {
  it('members cannot remove others or promote themselves; owner can', async () => {
    await expect(t.rpc(B, 'remove_group_member', { p_group_id: G, p_user_id: A })).rejects.toThrow(/permission/);
    await expect(t.rpc(B, 'set_group_member_role', { p_group_id: G, p_user_id: B, p_role: 'admin' })).rejects.toThrow(/permission/);
    await expect(t.rpc(B, 'set_group_archived', { p_group_id: G, p_archived: true })).rejects.toThrow(/admins/);
    await t.rpc(A, 'set_group_member_role', { p_group_id: G, p_user_id: B, p_role: 'admin' });
    await t.rpc(B, 'set_group_archived', { p_group_id: G, p_archived: true });
    await expect(
      t.rpc(A, 'create_expense', { p_payload: expensePayload({ groupId: G, amount: 100, payers: [[A, 100]], participants: [A, B] }), p_idempotency_key: key() }),
    ).rejects.toThrow(/archived/);
    await t.rpc(A, 'set_group_archived', { p_group_id: G, p_archived: false });
  });

  it('group settings can only be updated by admins via RLS', async () => {
    const r = await t.as(X, `update public.groups set name = 'hacked' where id = $1 returning id`, [G]);
    expect(r).toEqual([]);
    const [g] = await t.admin<{ name: string }>('select name from public.groups where id = $1', [G]);
    expect(g!.name).toBe('Private group');
  });
});

describe('invitations', () => {
  it('only works with the secret token, and expires', async () => {
    const inv = await t.rpc<{ token: string; invitation_id: string }>(A, 'create_group_invitation', { p_group_id: G, p_max_uses: 1 });
    await expect(t.rpc(X, 'accept_group_invitation', { p_token: 'not-the-token' })).rejects.toThrow(/not valid/);
    const preview = await t.rpc<{ valid: boolean; group_name: string }>(X, 'preview_invitation', { p_kind: 'group', p_token: inv.token });
    expect(preview.valid).toBe(true);
    expect(preview.group_name).toBe('Private group');
    expect(await t.rpc(X, 'accept_group_invitation', { p_token: inv.token })).toBe(G);
    const Y = await t.createUser('Late Yan');
    await expect(t.rpc(Y, 'accept_group_invitation', { p_token: inv.token })).rejects.toThrow(/expired|revoked/);
    // Only the hash of the token is stored.
    const stored = await t.admin<{ token_hash: string }>('select token_hash from public.group_invitations where id = $1', [inv.invitation_id]);
    expect(stored[0]!.token_hash).not.toContain(inv.token);
    // X is now a member and can see the group; then leaves cleanly (no balance).
    expect(await t.as(X, 'select id from public.groups where id = $1', [G])).toHaveLength(1);
    await t.rpc(X, 'leave_group', { p_group_id: G });
    expect(await t.as(X, 'select id from public.groups where id = $1', [G])).toHaveLength(0);
  });

  it('prevents duplicate friendships', async () => {
    const inv = await t.rpc<{ token: string }>(B, 'create_friend_invitation', { p_email: null });
    await t.rpc(A, 'accept_friend_invitation', { p_token: inv.token });
    const rows = await t.admin('select * from public.friendships where user_a = least($1::uuid, $2::uuid) and user_b = greatest($1::uuid, $2::uuid)', [A, B]);
    expect(rows).toHaveLength(1);
    await expect(t.admin('insert into public.friendships (user_a, user_b) values (greatest($1::uuid, $2::uuid), least($1::uuid, $2::uuid))', [A, B])).rejects.toThrow();
  });
});

describe('Owenil Plus entitlements', () => {
  it('blocks premium features without an entitlement', async () => {
    await expect(
      t.as(A, `insert into public.budgets (user_id, amount_minor, currency) values ($1, 100000, 'INR')`, [A]),
    ).rejects.toThrow(/row-level security/);
    await expect(
      t.as(A, `insert into public.exchange_rate_snapshots (user_id, base_currency, quote_currency, rate, as_of) values ($1, 'USD', 'INR', 83.2, '2026-10-01')`, [A]),
    ).rejects.toThrow(/row-level security/);
  });

  it('a tester can use the development switch; budgets then work', async () => {
    const status = await t.rpc<{ premium_switch_allowed: boolean }>(T, 'get_dev_tools_status', {});
    expect(status.premium_switch_allowed).toBe(true);
    await t.rpc(T, 'dev_set_plan', { p_plan: 'plus' });
    await t.as(T, `insert into public.budgets (user_id, amount_minor, currency) values ($1, 100000, 'INR')`, [T]);
    expect(await t.as(T, 'select * from public.budgets')).toHaveLength(1);
    const events = await t.as(T, 'select event_type, to_plan::text from public.subscription_events');
    expect(events).toEqual([{ event_type: 'dev_plan_changed', to_plan: 'plus' }]);
  });

  it('the switch is off for everyone when the server mode is "off"', async () => {
    await t.admin(`update public.app_settings set value = '"off"' where key = 'dev_entitlements_mode'`);
    await expect(t.rpc(T, 'dev_set_plan', { p_plan: 'free' })).rejects.toThrow(/disabled/);
    await t.admin(`update public.app_settings set value = '"testers"' where key = 'dev_entitlements_mode'`);
  });
});

describe('private receipts', () => {
  it('only the owner and expense viewers can read a receipt object', async () => {
    await t.rpc(T, 'dev_set_plan', { p_plan: 'plus' });
    await t.as(T, `insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)`, [`${T}/r1.jpg`, T]);
    expect(await t.as(T, `select name from storage.objects where bucket_id = 'receipts'`)).toHaveLength(1);
    expect(await t.as(X, `select name from storage.objects where bucket_id = 'receipts'`)).toHaveLength(0);
    // Non-premium users and foreign folders are rejected.
    await expect(t.as(X, `insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)`, [`${X}/r.jpg`, X])).rejects.toThrow(/row-level security/);
    await expect(t.as(T, `insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)`, [`${X}/r.jpg`, T])).rejects.toThrow(/row-level security/);
    const [b] = await t.admin<{ public: boolean }>(`select public from storage.buckets where id = 'receipts'`);
    expect(b!.public).toBe(false);
  });
});

describe('privacy', () => {
  it('exports only the caller’s data', async () => {
    const data = await t.rpc<Record<string, unknown[]>>(B, 'export_my_data', {});
    expect((data.expenses as unknown[]).length).toBe(2);
    expect(JSON.stringify(data)).not.toContain(T);
  });

  it('refuses account deletion while balances are open, then anonymises', async () => {
    await expect(t.rpc(B, 'delete_my_account', { p_confirmation: 'DELETE' })).rejects.toThrow(/Settle/);
    const Z = await t.createUser('Zed Leaving');
    const r = await t.rpc<{ deleted: boolean }>(Z, 'delete_my_account', { p_confirmation: 'DELETE' });
    expect(r.deleted).toBe(true);
    const [p] = await t.admin<{ display_name: string; deleted_at: string | null }>('select display_name, deleted_at from public.profiles where id = $1', [Z]);
    expect(p!.display_name).toBe('Deleted user');
    expect(p!.deleted_at).not.toBeNull();
  });
});
