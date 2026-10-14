import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

let t: TestDb;
let A: string, B: string, C: string, H: string, M: string, Q: string;

interface Found { hash: string; user_id: string; display_name: string; relation: string }
const find = (as: string, values: string[]) =>
  t.as<Found>(as, 'select hash, user_id, display_name, relation from public.find_people($1)', [values.map(sha)]);

beforeAll(async () => {
  t = await createTestDb();
  A = await t.createUser('Asha', { email: 'asha@example.test' });
  B = await t.createUser('Bala', { email: 'bala@example.test' });
  C = await t.createUser('Chitra (hidden)', { email: 'chitra@example.test' });
  H = await t.createUser('Hari (shares a group with Asha)');
  M = await t.createUser('Meera (asked Asha first)');
  Q = await t.createUser('Quinn (stranger)');
  await t.rpc(B, 'set_my_phone', { p_phone: '+91 98765-43210' });
  await t.rpc(C, 'set_my_phone', { p_phone: '+919000000001' });
  await t.as(C, 'update public.user_preferences set discoverable_by_phone = false, discoverable_by_email = false where user_id = $1', [C]);
  const g = await t.rpc<string>(A, 'create_group', { p_name: 'Trip', p_member_ids: [] });
  const gi = await t.rpc<{ token: string }>(A, 'create_group_invitation', { p_group_id: g, p_role: 'member', p_max_uses: 5, p_valid_days: 7 });
  await t.rpc(H, 'accept_group_invitation', { p_token: gi.token });
  await t.rpc(H, 'set_my_phone', { p_phone: '+919111111111' });
  await t.rpc(M, 'set_my_phone', { p_phone: '+919222222222' });
  await t.rpc(M, 'request_friend', { p_user_id: A });
});

describe('phone numbers', () => {
  it('are saved in E.164 form and only the owner can read them', async () => {
    expect(await t.as(B, 'select phone_e164 from public.user_contact_info')).toEqual([{ phone_e164: '+919876543210' }]);
    expect(await t.as(A, 'select phone_e164 from public.user_contact_info where user_id = $1', [B])).toEqual([]);
    await expect(t.as(B, 'select phone_hash from public.user_contact_info')).rejects.toThrow(/permission denied/);
  });

  it.each(['98765 43210', '+0123456789', '+91 98', 'abc', "+91'; drop table x; --"])('rejects %j', async (bad) => {
    await expect(t.rpc(Q, 'set_my_phone', { p_phone: bad })).rejects.toThrow(/country code/);
  });

  it('one account per number', async () => {
    await expect(t.rpc(Q, 'set_my_phone', { p_phone: '+919876543210' })).rejects.toThrow(/already used by another Owenil account/);
  });

  it('cannot be written directly, only through set_my_phone; an empty value removes it', async () => {
    await expect(t.as(Q, 'insert into public.user_contact_info (user_id, phone_e164, phone_hash) values ($1, $2, $3)', [Q, '+919333333333', 'x'])).rejects.toThrow();
    await expect(t.as(B, 'update public.user_contact_info set phone_e164 = $1', ['+919333333333'])).rejects.toThrow();
    await t.rpc(Q, 'set_my_phone', { p_phone: '+919444444444' });
    expect(await t.rpc(Q, 'set_my_phone', { p_phone: '' })).toBeNull();
    expect(await t.as(Q, 'select phone_e164 from public.user_contact_info')).toEqual([{ phone_e164: null }]);
  });

  it('a valid, unused number given at sign-up is saved; a taken one is skipped without failing the sign-up', async () => {
    const fresh = randomUUID();
    await t.admin('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [fresh, `new.${fresh.slice(0, 6)}@example.test`, { display_name: 'New', phone: '+91 95555 55555' }]);
    expect(await t.admin('select phone_e164 from public.user_contact_info where user_id = $1', [fresh])).toEqual([{ phone_e164: '+919555555555' }]);
    const dup = randomUUID();
    await t.admin('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [dup, `dup.${dup.slice(0, 6)}@example.test`, { display_name: 'Dup', phone: '+919555555555' }]);
    expect(await t.admin('select phone_e164 from public.user_contact_info where user_id = $1', [dup])).toEqual([{ phone_e164: null }]);
    expect(await t.admin('select count(*)::int as n from public.profiles where id = $1', [dup])).toEqual([{ n: 1 }]);
  });
});

describe('finding people by email or phone', () => {
  it('finds a registered person by phone number or email (hashed), never returning either', async () => {
    const rows = await find(A, ['+919876543210', 'bala@example.test']);
    expect(rows.map((r) => [r.display_name, r.relation]).sort()).toEqual([['Bala', 'none'], ['Bala', 'none']]);
    expect(rows.map((r) => r.hash).sort()).toEqual([sha('+919876543210'), sha('bala@example.test')].sort());
    expect(Object.keys(rows[0]!)).not.toContain('phone_e164');
  });

  it('says nothing about people who are not registered, or who turned discovery off', async () => {
    expect(await find(A, ['+919999999999', 'nobody@example.test', '+919000000001', 'chitra@example.test'])).toEqual([]);
  });

  it('reports how each person relates to you', async () => {
    const rel = async (values: string[]) => (await find(A, values)).map((r) => r.relation);
    expect(await rel(['asha@example.test'])).toEqual(['self']);
    expect(await rel(['+919222222222'])).toEqual(['incoming']); // Meera asked Asha
  });

  it('ignores anything that is not a SHA-256 hash and limits batch size', async () => {
    expect(await t.as(A, 'select * from public.find_people($1)', [['+919876543210', "' or 1=1 --"]])).toEqual([]);
    await expect(t.as(A, 'select * from public.find_people($1)', [Array.from({ length: 2001 }, (_, i) => sha(String(i)))])).rejects.toThrow(/2,000/);
  });

  it('needs a signed-in user', async () => {
    await expect(t.as(null, 'select * from public.find_people($1)', [[sha('bala@example.test')]])).rejects.toThrow();
  });

  it('follows an email change', async () => {
    await t.admin('update auth.users set email = $1 where id = $2', ['bala.new@example.test', B]);
    expect((await find(A, ['bala.new@example.test'])).map((r) => r.display_name)).toEqual(['Bala']);
    expect(await find(A, ['bala@example.test'])).toEqual([]);
  });
});

describe('adding someone found that way', () => {
  it('a stranger gets a friend request to accept, and is told about it', async () => {
    expect(await t.rpc(A, 'request_friend', { p_user_id: B })).toBe('requested');
    expect((await find(A, ['+919876543210']))[0]!.relation).toBe('requested');
    expect(await t.rpc(A, 'request_friend', { p_user_id: B })).toBe('requested'); // no duplicate request
    expect(await t.admin('select count(*)::int as n from public.friendship_invitations where inviter_id = $1 and invitee_id = $2', [A, B])).toEqual([{ n: 1 }]);
    expect(await t.admin("select title from public.notifications where user_id = $1 and kind = 'friend_invite'", [B])).toEqual([{ title: 'Asha wants to be friends on Owenil' }]);
    // Bala adds Asha back: that accepts the request.
    expect(await t.rpc(B, 'request_friend', { p_user_id: A })).toBe('friends');
    expect(await t.rpc(A, 'are_friends', { p_a: A, p_b: B })).toBe(true);
  });

  it('someone who already asked you becomes a friend at once', async () => {
    expect(await t.rpc(A, 'request_friend', { p_user_id: M })).toBe('friends');
    expect((await find(A, ['+919222222222']))[0]!.relation).toBe('friend');
  });

  it('someone you already share a group with becomes a friend at once', async () => {
    expect(await t.rpc(A, 'request_friend', { p_user_id: H })).toBe('friends');
    expect(await t.admin("select title from public.notifications where user_id = $1 and kind = 'friend_accepted'", [H])).toEqual([{ title: 'Asha added you as a friend' }]);
  });

  it('you cannot add yourself or someone who does not exist', async () => {
    await expect(t.rpc(A, 'request_friend', { p_user_id: A })).rejects.toThrow(/yourself/);
    await expect(t.rpc(A, 'request_friend', { p_user_id: randomUUID() })).rejects.toThrow(/isn’t on Owenil/);
  });
});

describe('account deletion and export', () => {
  it('export includes your phone number', async () => {
    const data = await t.rpc<{ phone: string | null }>(H, 'export_my_data', {});
    expect(data.phone).toBe('+919111111111');
  });

  it('deleting an account removes its phone number and hashes', async () => {
    await t.admin('update public.profiles set deleted_at = now() where id = $1', [Q]);
    expect(await t.admin('select count(*)::int as n from public.user_contact_info where user_id = $1', [Q])).toEqual([{ n: 0 }]);
  });
});
