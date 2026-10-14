import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;
let A: string, F: string, M: string, P: string, X: string, L: string;
let G: string;

beforeAll(async () => {
  t = await createTestDb();
  A = await t.createUser('Asha (has UPI)');
  F = await t.createUser('Farid (friend)');
  M = await t.createUser('Mira (group member)');
  P = await t.createUser('Pia (pending invite only)');
  X = await t.createUser('Xavi (stranger)');
  L = await t.createUser('Leo (left the group)');
  const inv = await t.rpc<{ token: string }>(A, 'create_friend_invitation', { p_email: null });
  await t.rpc(F, 'accept_friend_invitation', { p_token: inv.token });
  G = await t.rpc<string>(M, 'create_group', { p_name: 'Flat', p_member_ids: [] });
  for (const u of [A, L]) {
    const gi = await t.rpc<{ token: string }>(M, 'create_group_invitation', { p_group_id: G, p_role: 'member', p_max_uses: 5, p_valid_days: 7 });
    await t.rpc(u, 'accept_group_invitation', { p_token: gi.token });
  }
  await t.rpc(L, 'leave_group', { p_group_id: G });
  // Pia only has a pending friend invitation from Asha: she can see Asha's profile, but not her UPI ID.
  await t.admin(`insert into public.friendship_invitations (inviter_id, invitee_id, token_hash, status, expires_at)
                 values ($1, $2, 'test-hash-' || gen_random_uuid(), 'pending', now() + interval '7 days')`, [A, P]);
  await t.rpc(A, 'set_upi_id', { p_upi_id: '  Asha.K@OkHdfcBank ' });
});

describe('saving a UPI ID', () => {
  it('normalizes and stores it; the owner can read it back', async () => {
    expect(await t.rpc(A, 'get_upi_id', { p_user_id: A })).toBe('asha.k@okhdfcbank');
    expect(await t.as(A, 'select upi_id from public.payment_handles')).toEqual([{ upi_id: 'asha.k@okhdfcbank' }]);
  });

  it.each(['asha', 'asha@', '@ybl', 'asha k@ybl', 'asha@ybl.com', "x@y'); drop table public.payment_handles; --"])('rejects %j', async (bad) => {
    await expect(t.rpc(F, 'set_upi_id', { p_upi_id: bad })).rejects.toThrow(/UPI ID like name@bank/);
  });

  it('an empty value removes it', async () => {
    await t.rpc(F, 'set_upi_id', { p_upi_id: 'farid@ybl' });
    expect(await t.rpc(F, 'get_upi_id', { p_user_id: F })).toBe('farid@ybl');
    expect(await t.rpc(F, 'set_upi_id', { p_upi_id: '' })).toBeNull();
    expect(await t.rpc(F, 'get_upi_id', { p_user_id: F })).toBeNull();
  });

  it('cannot be written directly, only through set_upi_id', async () => {
    await expect(t.as(X, 'insert into public.payment_handles (user_id, upi_id) values ($1, $2)', [A, 'evil@ybl'])).rejects.toThrow();
    await expect(t.as(A, 'update public.payment_handles set upi_id = $1', ['evil@ybl'])).rejects.toThrow();
    expect(await t.rpc(A, 'get_upi_id', { p_user_id: A })).toBe('asha.k@okhdfcbank');
  });
});

describe('who can see a UPI ID', () => {
  it('a current friend and an active group co-member can', async () => {
    expect(await t.rpc(F, 'get_upi_id', { p_user_id: A })).toBe('asha.k@okhdfcbank');
    expect(await t.rpc(M, 'get_upi_id', { p_user_id: A })).toBe('asha.k@okhdfcbank');
  });

  it('a stranger, a pending invitee and a former group member cannot', async () => {
    expect(await t.rpc(X, 'get_upi_id', { p_user_id: A })).toBeNull();
    expect(await t.rpc(P, 'get_upi_id', { p_user_id: A })).toBeNull();
    expect(await t.rpc(L, 'get_upi_id', { p_user_id: A })).toBeNull();
    // Pia can see Asha's profile (pending invitation) — the UPI ID is stricter than that.
    expect(await t.as(P, 'select id from public.profiles where id = $1', [A])).toHaveLength(1);
  });

  it('nobody else can read the table directly', async () => {
    for (const u of [F, M, X]) expect(await t.as(u, 'select * from public.payment_handles where user_id = $1', [A])).toEqual([]);
  });

  it('anonymous callers get nothing', async () => {
    await expect(t.rpc(null, 'get_upi_id', { p_user_id: A })).rejects.toThrow();
    await expect(t.rpc(null, 'set_upi_id', { p_upi_id: 'anon@ybl' })).rejects.toThrow();
  });

  it('after unfriending, the former friend loses access', async () => {
    const Z = await t.createUser('Zoe (ex-friend)');
    const inv = await t.rpc<{ token: string }>(A, 'create_friend_invitation', { p_email: null });
    await t.rpc(Z, 'accept_friend_invitation', { p_token: inv.token });
    expect(await t.rpc(Z, 'get_upi_id', { p_user_id: A })).toBe('asha.k@okhdfcbank');
    await t.rpc(Z, 'remove_friend', { p_friend_id: A });
    expect(await t.rpc(Z, 'get_upi_id', { p_user_id: A })).toBeNull();
  });
});

describe('privacy controls', () => {
  it('the data export includes the UPI ID', async () => {
    const data = await t.rpc<{ upi_id: string | null }>(A, 'export_my_data', {});
    expect(data.upi_id).toBe('asha.k@okhdfcbank');
  });

  it('deleting the account removes the UPI ID', async () => {
    const D = await t.createUser('Dev (deletes account)');
    await t.rpc(D, 'set_upi_id', { p_upi_id: 'dev@paytm' });
    await t.rpc(D, 'delete_my_account', { p_confirmation: 'DELETE' });
    expect(await t.admin('select * from public.payment_handles where user_id = $1', [D])).toEqual([]);
  });
});
