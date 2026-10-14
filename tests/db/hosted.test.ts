/**
 * Hosted-database tests: run against the real Supabase project in .env.local
 * through the real Data API (PostgREST), Auth and Storage — exactly the path
 * the browser uses. Creates throwaway users (@test.owenil.test) and removes
 * everything afterwards. Skipped (and reported as skipped) without config.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseCSV, sumMinor } from '@owenil/core';
import {
  adminClient, anonClient, createConfirmedUser, deleteAuthUsersByEmail, hasHostedConfig, pgClient, purgeProfiles, randomPassword, userClient,
} from '../../scripts/lib';
import { expensePayload } from '../sql/payload';
import { EXPENSE_CSV_HEADERS, expensesToCSV, fetchExpensesForExport } from '../../src/features/settings/exporters';

const run = hasHostedConfig();
const DOMAIN = 'test.owenil.test';
const tag = Math.random().toString(36).slice(2, 8);
const key = () => `hosted-${tag}-${Math.random().toString(36).slice(2)}`;

let A: { client: SupabaseClient; id: string };
let B: { client: SupabaseClient; id: string };
let X: { client: SupabaseClient; id: string };
let G = '';
let E = '';
let PE = '';
let S = '';

async function rpc<T>(c: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

describe.skipIf(!run)('hosted Supabase: authentication, RLS and financial consistency', () => {
  beforeAll(async () => {
    const admin = adminClient();
    const make = async (name: string) => {
      const email = `${name}.${tag}@${DOMAIN}`;
      const password = randomPassword();
      await createConfirmedUser(admin, email, password, { display_name: `Test ${name}` });
      return userClient(email, password);
    };
    A = await make('alice');
    B = await make('bob');
    X = await make('mallory');
    const inv = await rpc<{ token: string }>(A.client, 'create_friend_invitation', { p_email: null });
    await rpc(B.client, 'accept_friend_invitation', { p_token: inv.token });
    G = await rpc<string>(A.client, 'create_group', { p_name: `Test group ${tag}`, p_member_ids: [B.id] });
    E = (await rpc<{ expense_id: string }>(A.client, 'create_expense', {
      p_payload: expensePayload({ groupId: G, amount: 300000, payers: [[A.id, 300000]], participants: [A.id, B.id] }), p_idempotency_key: key(),
    })).expense_id;
    PE = (await rpc<{ expense_id: string }>(A.client, 'create_expense', {
      p_payload: expensePayload({ amount: 5000, payers: [[B.id, 5000]], participants: [A.id, B.id], description: 'Private coffee' }), p_idempotency_key: key(),
    })).expense_id;
  });

  afterAll(async () => {
    if (!A) return;
    const db = await pgClient();
    try {
      await purgeProfiles(db, 'id = any($1::uuid[])', [[A.id, B.id, X?.id].filter(Boolean)]);
    } finally {
      await db.end();
    }
    await deleteAuthUsersByEmail(adminClient(), (e) => e.endsWith(`.${tag}@${DOMAIN}`));
  });

  it('signup created profile, preferences and a free entitlement', async () => {
    const { data } = await A.client.from('subscription_entitlements').select('plan').eq('user_id', A.id).single();
    expect(data?.plan).toBe('free');
    const { data: prefs } = await A.client.from('user_preferences').select('theme').eq('user_id', A.id).single();
    expect(prefs?.theme).toBe('system');
  });

  it('₹3,000 paid by one, split equally by two → correct balance', async () => {
    const nets = await rpc<{ user_id: string; net_minor: number }[]>(B.client, 'get_group_balances', { p_group_id: G });
    expect(Object.fromEntries(nets.map((n) => [n.user_id, Number(n.net_minor)]))).toEqual({ [A.id]: 150000, [B.id]: -150000 });
  });

  it('records a settlement exactly once when the request is retried', async () => {
    const k = key();
    const p = { group_id: G, payer_id: B.id, payee_id: A.id, amount_minor: 150000, currency: 'INR', settled_on: new Date().toISOString().slice(0, 10), method: 'upi', note: null };
    const r1 = await rpc<{ settlement_id: string }>(B.client, 'record_settlement', { p_payload: p, p_idempotency_key: k });
    const r2 = await rpc<{ settlement_id: string }>(B.client, 'record_settlement', { p_payload: p, p_idempotency_key: k });
    expect(r2.settlement_id).toBe(r1.settlement_id);
    S = r1.settlement_id;
    const { count } = await A.client.from('settlements').select('id', { count: 'exact', head: true }).eq('group_id', G);
    expect(count).toBe(1);
    const nets = await rpc<unknown[]>(A.client, 'get_group_balances', { p_group_id: G });
    expect(nets).toEqual([]);
  });

  it('an outsider sees none of the private rows', async () => {
    for (const table of ['groups', 'group_members', 'expenses', 'expense_splits', 'expense_payers', 'settlements', 'ledger_entries', 'activity_events']) {
      const { data, error } = await X.client.from(table).select('*');
      expect(error, table).toBeNull();
      expect(JSON.stringify(data), table).not.toContain(A.id);
    }
    const { data: profiles } = await X.client.from('profiles').select('id, display_name').in('id', [A.id, B.id]);
    expect(profiles).toEqual([]);
    const { data: exp } = await X.client.from('expenses').select('id').in('id', [E, PE]);
    expect(exp).toEqual([]);
  });

  it('an outsider cannot read balances, write financial tables or call internal functions', async () => {
    expect((await X.client.rpc('get_group_balances', { p_group_id: G })).error?.message).toMatch(/not a member/);
    expect((await X.client.from('expenses').insert({ description: 'x', amount_minor: 1, currency: 'INR', expense_date: '2026-01-01', split_method: 'equal', created_by: X.id })).error).not.toBeNull();
    expect((await X.client.from('ledger_entries').insert({ currency: 'INR', debtor_id: A.id, creditor_id: X.id, amount_minor: 100, source_type: 'expense', source_id: E })).error).not.toBeNull();
    expect((await X.client.rpc('_create_expense_core', { p: {}, p_actor: A.id })).error).not.toBeNull();
    expect((await X.client.rpc('delete_expense', { p_expense_id: E, p_expected_version: 1 })).error?.message).toMatch(/not found/i);
    expect((await X.client.rpc('reverse_settlement', { p_settlement_id: S, p_reason: 'x' })).error?.message).toMatch(/not found/i);
    const upd = await X.client.from('groups').update({ name: 'hacked' }).eq('id', G).select('id');
    expect(upd.data ?? []).toEqual([]);
  });

  it('users cannot grant themselves premium', async () => {
    expect((await X.client.from('subscription_entitlements').update({ plan: 'plus' }).eq('user_id', X.id)).error).not.toBeNull();
    expect((await X.client.rpc('dev_set_plan', { p_plan: 'plus' })).error?.message).toMatch(/disabled/);
    const { data } = await X.client.from('subscription_entitlements').select('plan').eq('user_id', X.id).single();
    expect(data?.plan).toBe('free');
    expect((await X.client.from('budgets').insert({ user_id: X.id, amount_minor: 100, currency: 'INR' })).error).not.toBeNull();
  });

  it('anonymous visitors cannot read data', async () => {
    const anon = anonClient();
    const { data, error } = await anon.from('expenses').select('id');
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    expect((await anon.rpc('get_balance_overview')).error).not.toBeNull();
  });

  it('receipts are private: owner and expense participants only', async () => {
    const db = await pgClient();
    await db.query('update public.profiles set is_tester = true where id = $1', [A.id]);
    await db.end();
    await rpc(A.client, 'dev_set_plan', { p_plan: 'plus' });
    const path = `${A.id}/${randomUUID()}.png`;
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));
    const up = await A.client.storage.from('receipts').upload(path, new Blob([png], { type: 'image/png' }), { contentType: 'image/png' });
    expect(up.error).toBeNull();
    const id = randomUUID();
    expect((await A.client.from('receipt_metadata').insert({ id, owner_id: A.id, storage_path: path, mime_type: 'image/png', size_bytes: png.length })).error).toBeNull();
    // Not linked to an expense yet → only the owner can read it.
    expect((await A.client.storage.from('receipts').download(path)).error).toBeNull();
    expect((await B.client.storage.from('receipts').download(path)).error).not.toBeNull();
    expect((await X.client.storage.from('receipts').download(path)).error).not.toBeNull();
    // Attach to a group expense → group members can read it, outsiders still can't.
    const p = expensePayload({ groupId: G, amount: 1000, payers: [[A.id, 1000]], participants: [A.id, B.id], description: 'With receipt' });
    await rpc(A.client, 'create_expense', { p_payload: { ...p, receipt_id: id }, p_idempotency_key: key() });
    expect((await B.client.storage.from('receipts').download(path)).error).toBeNull();
    expect((await X.client.storage.from('receipts').download(path)).error).not.toBeNull();
    // Uploading into someone else's folder is rejected.
    expect((await A.client.storage.from('receipts').upload(`${B.id}/evil.png`, new Blob([png], { type: 'image/png' }))).error).not.toBeNull();
    await A.client.storage.from('receipts').remove([path]).catch(() => undefined);
  });

  it('CSV export matches the database exactly', async () => {
    const rows = await fetchExpensesForExport(A.client, {});
    const db = await pgClient();
    const truth = await db.query(
      `select e.id, e.amount_minor from public.expenses e
        where e.deleted_at is null and (public.can_view_expense(e.id, $1))`,
      [A.id],
    );
    await db.end();
    expect(rows.map((r) => r.id).sort()).toEqual(truth.rows.map((r) => r.id).sort());
    const csv = expensesToCSV(rows, { me: A.id, name: (id) => id.slice(0, 4), category: () => '', group: (g) => g ?? 'Non-group' });
    const parsed = parseCSV(csv);
    expect(parsed[0]).toEqual(EXPENSE_CSV_HEADERS);
    const amountCol = EXPENSE_CSV_HEADERS.indexOf('Amount');
    const csvTotal = sumMinor(parsed.slice(1).map((r) => Math.round(Number(r[amountCol]) * 100)));
    expect(csvTotal).toBe(sumMinor(truth.rows.map((r) => Number(r.amount_minor))));
  });

  it('data export contains only the caller’s data', async () => {
    const data = await rpc<Record<string, unknown[]>>(B.client, 'export_my_data', {});
    expect(JSON.stringify(data)).not.toContain(X.id);
    expect((data.expenses as unknown[]).length).toBeGreaterThanOrEqual(2);
  });
});

describe.skipIf(run)('hosted Supabase tests', () => {
  it.skip('skipped: add VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY and SUPABASE_DB_URL to .env.local', () => undefined);
});
