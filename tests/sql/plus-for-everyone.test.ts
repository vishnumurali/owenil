import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;
let A: string, B: string;

const planOf = async (id: string) =>
  (await t.admin<{ plan: string; source: string }>('select plan, source from public.subscription_entitlements where user_id = $1', [id]))[0];
const setMode = async (mode: string) =>
  (await t.admin<{ r: { granted: number; revoked: number } }>('select public.set_dev_entitlements_mode($1) as r', [mode]))[0]!.r;

beforeAll(async () => {
  t = await createTestDb();
  A = await t.createUser('Asha');
  B = await t.createUser('Bala');
});

describe('"Plus for everyone" testing mode', () => {
  it('grants Plus to every existing account and logs it', async () => {
    expect(await planOf(A)).toEqual({ plan: 'free', source: 'default' });
    const r = await setMode('everyone');
    expect(r.granted).toBeGreaterThanOrEqual(2);
    expect(await planOf(A)).toEqual({ plan: 'plus', source: 'development' });
    expect(await t.rpc<boolean>(A, 'is_premium', { p_user_id: A })).toBe(true);
    const ev = await t.admin(`select 1 from public.subscription_events where user_id = $1 and to_plan = 'plus' and details ->> 'mode' = 'everyone'`, [A]);
    expect(ev).toHaveLength(1);
  });

  it('gives new sign-ups Plus automatically', async () => {
    const N = await t.createUser('New tester');
    expect(await planOf(N)).toEqual({ plan: 'plus', source: 'development' });
    // Plus-only features really work for them (budgets require Plus in RLS).
    await t.as(N, `insert into public.budgets (user_id, amount_minor, currency) values ($1, 500000, 'INR')`, [N]);
  });

  it('still lets anyone switch back to Free and on again', async () => {
    const s = await t.rpc<{ premium_switch_allowed: boolean; mode: string }>(B, 'get_dev_tools_status', {});
    expect(s).toEqual({ mode: 'everyone', premium_switch_allowed: true });
    await t.rpc(B, 'dev_set_plan', { p_plan: 'free' });
    expect((await planOf(B))?.plan).toBe('free');
    await t.rpc(B, 'dev_set_plan', { p_plan: 'plus' });
    expect((await planOf(B))?.plan).toBe('plus');
  });

  it('cannot be switched from the browser', async () => {
    await expect(t.rpc(A, 'set_dev_entitlements_mode', { p_mode: 'everyone' })).rejects.toThrow(/permission denied/);
    await expect(t.rpc(null, 'set_dev_entitlements_mode', { p_mode: 'everyone' })).rejects.toThrow(/permission denied/);
  });

  it('going "off" for launch removes only development Plus', async () => {
    const R = await t.createUser('Real customer');
    await t.admin(`update public.subscription_entitlements set plan = 'plus', source = 'web' where user_id = $1`, [R]);
    const r = await setMode('off');
    expect(r.revoked).toBeGreaterThanOrEqual(3);
    expect(await planOf(A)).toEqual({ plan: 'free', source: 'default' });
    expect(await planOf(R)).toEqual({ plan: 'plus', source: 'web' });
    const N2 = await t.createUser('After launch');
    expect((await planOf(N2))?.plan).toBe('free');
  });
});
