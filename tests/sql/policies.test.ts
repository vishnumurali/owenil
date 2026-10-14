import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './harness';
import { expensePayload } from './payload';

/**
 * The policies in force after all migrations ran. A policy that reads the table
 * it guards makes Postgres fail with "infinite recursion detected in policy".
 */
function finalPolicies(): Map<string, string> {
  const dir = join(process.cwd(), 'supabase', 'migrations');
  const policies = new Map<string, string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const m of sql.matchAll(/drop policy (?:if exists )?(\w+) on (\w+\.\w+)/gi)) policies.delete(`${m[2]}:${m[1]}`);
    for (const p of sql.split(/(?=create policy )/i).slice(1)) {
      const head = /^create policy "?([\w ]+?)"? on (\w+\.\w+)/i.exec(p);
      if (head) policies.set(`${head[2]}:${head[1]}`, p.slice(head[0].length, p.indexOf(';')));
    }
  }
  return policies;
}

describe('policy lint', () => {
  it('no policy reads the table it protects', () => {
    const offenders = [...finalPolicies()].filter(([key, body]) => {
      const [schema, table] = key.split(':')[0]!.split('.');
      return new RegExp(`from\\s+(${schema}\\.)?${table}\\b`, 'i').test(body);
    });
    expect(offenders.map(([k]) => k)).toEqual([]);
  });
});

let t: TestDb;
let A: string, B: string, X: string, E: string;
const key = () => `pol-${Math.random().toString(36).slice(2)}`;

beforeAll(async () => {
  t = await createTestDb();
  A = await t.createUser('Ana');
  B = await t.createUser('Ben');
  X = await t.createUser('Xia');
  const inv = await t.rpc<{ token: string }>(A, 'create_friend_invitation', { p_email: null });
  await t.rpc(B, 'accept_friend_invitation', { p_token: inv.token });
  E = (await t.rpc<{ expense_id: string }>(A, 'create_expense', {
    p_payload: expensePayload({ amount: 4000, payers: [[A, 4000]], participants: [A, B], description: 'Dinner' }), p_idempotency_key: key(),
  })).expense_id;
});

describe('comments written by signed-in users (as the app does)', () => {
  it('a participant can comment and both people see it', async () => {
    await t.as(B, 'insert into public.comments (expense_id, author_id, body) values ($1, $2, $3)', [E, B, 'Is this correct?']);
    expect(await t.as(A, 'select body from public.comments where expense_id = $1', [E])).toEqual([{ body: 'Is this correct?' }]);
    // The payer is notified.
    const [n] = await t.as<{ title: string }>(A, `select title from public.notifications where kind = 'comment_added'`);
    expect(n?.title).toMatch(/commented on “Dinner”/);
  });

  it('an outsider cannot comment, and nobody can comment as someone else', async () => {
    await expect(t.as(X, 'insert into public.comments (expense_id, author_id, body) values ($1, $2, $3)', [E, X, 'hi'])).rejects.toThrow(/row-level security/);
    await expect(t.as(B, 'insert into public.comments (expense_id, author_id, body) values ($1, $2, $3)', [E, A, 'fake'])).rejects.toThrow(/row-level security/);
  });
});

describe('custom categories (as the app creates them)', () => {
  it('a user can add their own category; others cannot see or use it', async () => {
    const [c] = await t.as<{ id: string }>(A, `insert into public.categories (owner_id, name, slug, icon, color) values ($1, 'Pets', 'custom', 'tag', '#64748b') returning id`, [A]);
    expect(c?.id).toBeTruthy();
    expect(await t.as(X, 'select id from public.categories where id = $1', [c!.id])).toEqual([]);
    await expect(t.as(X, `insert into public.categories (owner_id, name, slug, icon, color) values ($1, 'Nope', 'custom', 'tag', '#64748b')`, [A])).rejects.toThrow(/row-level security/);
  });

  it('caps each user at 50 custom categories', async () => {
    for (let i = 0; i < 49; i++) {
      await t.as(B, `insert into public.categories (owner_id, name, slug, icon, color) values ($1, $2, 'custom', 'tag', '#64748b')`, [B, `Cat ${i}`]);
    }
    await t.as(B, `insert into public.categories (owner_id, name, slug, icon, color) values ($1, 'Cat 49', 'custom', 'tag', '#64748b')`, [B]);
    await expect(t.as(B, `insert into public.categories (owner_id, name, slug, icon, color) values ($1, 'Cat 50', 'custom', 'tag', '#64748b')`, [B])).rejects.toThrow(/row-level security/);
  });
});
