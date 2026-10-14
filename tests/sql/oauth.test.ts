import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './harness';

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

async function signUp(email: string, meta: Record<string, unknown>) {
  const id = randomUUID();
  await t.admin('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, meta]);
  const [p] = await t.admin<{ display_name: string }>('select display_name from public.profiles where id = $1', [id]);
  return p?.display_name;
}

describe('profile names on sign-up', () => {
  it('uses the name typed on the email sign-up form', async () => {
    expect(await signUp('form@example.org', { display_name: 'Asha Form', full_name: 'Ignored' })).toBe('Asha Form');
  });

  it('uses the full name Google sends', async () => {
    expect(await signUp('gita@gmail.example', { full_name: 'Gita Google', name: 'Gita G', email_verified: true })).toBe('Gita Google');
  });

  it('falls back to "name", then to the email address', async () => {
    expect(await signUp('nina@example.org', { name: 'Nina Name' })).toBe('Nina Name');
    expect(await signUp('plain.user@example.org', { full_name: '   ' })).toBe('plain.user');
  });

  it('caps very long names at 60 characters', async () => {
    expect(await signUp('long@example.org', { full_name: 'L'.repeat(80) })).toHaveLength(60);
  });
});
