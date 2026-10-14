import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

const { findPeople, formatPhone, normalizePhone, parseContactInput, requestFriend, sha256Hex } = await import('./people');

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

beforeEach(() => rpc.mockReset());

describe('normalizePhone', () => {
  it.each([
    ['98765 43210', '+919876543210'],
    ['098765-43210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['0091 9876543210', '+919876543210'],
    ['(+91) 98765.43210', '+919876543210'],
    ['+44 7911 123456', '+447911123456'],
    ['+1 (415) 555-2671', '+14155552671'],
  ])('%j → %s', (input, e164) => {
    expect(normalizePhone(input)).toBe(e164);
  });

  it.each(['', '12345', 'call me', '+91 98', '0000000000'])('rejects %j', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('formats for display', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210');
  });
});

describe('parseContactInput', () => {
  it('recognises an email (lower-cased) or a phone number', () => {
    expect(parseContactInput('  Asha.K@Gmail.com ')).toEqual({ kind: 'email', value: 'asha.k@gmail.com' });
    expect(parseContactInput('98765 43210')).toEqual({ kind: 'phone', value: '+919876543210' });
    expect(parseContactInput('asha@')).toBeNull();
    expect(parseContactInput('hello')).toBeNull();
  });
});

describe('findPeople', () => {
  it('hashes on the device, sends only hashes, and maps matches back to what was asked', async () => {
    expect(await sha256Hex('+919876543210')).toBe(sha('+919876543210'));
    rpc.mockResolvedValue({
      data: [{ hash: sha('bala@example.com'), user_id: 'u-b', display_name: 'Bala', avatar_url: null, avatar_color: '#000000', relation: 'none' }],
      error: null,
    });
    const found = await findPeople(['bala@example.com', '+919876543210', 'bala@example.com']);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [, args] = rpc.mock.calls[0]!;
    expect(args.p_hashes).toEqual([sha('bala@example.com'), sha('+919876543210')]);
    expect(JSON.stringify(args)).not.toContain('bala@');
    expect(found.get('bala@example.com')).toEqual({ user_id: 'u-b', display_name: 'Bala', avatar_url: null, avatar_color: '#000000', relation: 'none' });
    expect(found.has('+919876543210')).toBe(false);
  });

  it('sends large address books in batches of 2,000', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await findPeople(Array.from({ length: 4500 }, (_, i) => `+9198${String(i).padStart(8, '0')}`));
    expect(rpc.mock.calls.map(([, a]) => a.p_hashes.length)).toEqual([2000, 2000, 500]);
  });

  it('adds a friend through request_friend', async () => {
    rpc.mockResolvedValue({ data: 'requested', error: null });
    expect(await requestFriend('u-b')).toBe('requested');
    expect(rpc).toHaveBeenCalledWith('request_friend', { p_user_id: 'u-b' });
  });
});

describe('matchAddressBook', () => {
  it('finds who is on Owenil (once each, never yourself) and who to invite (once each)', async () => {
    const { matchAddressBook } = await import('./people');
    rpc.mockResolvedValue({
      data: [
        { hash: sha('+919876543210'), user_id: 'u-bala', display_name: 'Bala R', avatar_url: null, avatar_color: '#111111', relation: 'none' },
        { hash: sha('me@example.com'), user_id: 'u-me', display_name: 'Me', avatar_url: null, avatar_color: '#222222', relation: 'self' },
      ],
      error: null,
    });
    const rows = await matchAddressBook([
      { name: 'Bala', phones: ['098765 43210'], emails: [] },
      { name: 'Bala (work)', phones: ['+91 98765-43210'], emails: ['bala@work.example'] },
      { name: 'Me', phones: [], emails: ['ME@example.com'] },
      { name: 'Chitra', phones: ['+91 90000 00001', '90000 00001'], emails: [] },
      { name: 'Chitra again', phones: ['9000000001'], emails: [] },
      { name: 'No number', phones: ['call later'], emails: [] },
    ]);
    expect(rows).toEqual([
      { name: 'Bala', phone: '+919876543210', email: null, person: { user_id: 'u-bala', display_name: 'Bala R', avatar_url: null, avatar_color: '#111111', relation: 'none' } },
      { name: 'Chitra', phone: '+919000000001', email: null, person: null },
    ]);
  });
});
