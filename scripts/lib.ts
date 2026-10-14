// Shared helpers for local scripts and hosted-database tests.
// Reads .env.local; never prints secret values.
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';
import pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
for (const f of ['.env.local', '.env']) if (existsSync(join(ROOT, f))) config({ path: join(ROOT, f), override: false });

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env.local (see .env.example)`);
  return v;
}

/** True when scripts can reach the database: a direct connection string, or a Management API token. */
export const hasSqlAccess = () => Boolean(process.env.SUPABASE_DB_URL || (process.env.SUPABASE_ACCESS_TOKEN && process.env.VITE_SUPABASE_URL));

export const hasHostedConfig = () =>
  Boolean(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_SECRET_KEY && hasSqlAccess());

export function projectRef(): string {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env('VITE_SUPABASE_URL'));
  if (!m) throw new Error('VITE_SUPABASE_URL must look like https://<ref>.supabase.co');
  return m[1]!;
}

/** Admin client — server-side only (service role / secret key). Never ship to a browser. */
export function adminClient(): SupabaseClient {
  return createClient(env('VITE_SUPABASE_URL'), env('SUPABASE_SECRET_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A client acting as a normal signed-in user with the publishable key (RLS applies). */
export async function userClient(email: string, password: string): Promise<{ client: SupabaseClient; id: string }> {
  const client = createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { client, id: data.user.id };
}

export function anonClient(): SupabaseClient {
  return createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Minimal SQL interface shared by the direct-connection and Management-API backends. */
export interface Sql {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  end(): Promise<void>;
}

/** Renders a value as a SQL literal (used only for the Management API backend). */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('Non-finite number');
    return String(v);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (Array.isArray(v)) return `ARRAY[${v.map(sqlLiteral).join(', ')}]`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function inlineParams(text: string, params: unknown[]): string {
  let out = text;
  for (let i = params.length; i >= 1; i--) out = out.split("$" + i).join(sqlLiteral(params[i - 1]));
  return out;
}

/** Runs SQL through the Supabase Management API (needs SUPABASE_ACCESS_TOKEN). Each call is one transaction. */
export async function managementQuery(sql: string): Promise<unknown[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef()}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('SUPABASE_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) {
    let msg = body;
    try {
      msg = (JSON.parse(body) as { message?: string }).message ?? body;
    } catch {
      /* plain text */
    }
    throw new Error(`SQL failed (${res.status}): ${msg.slice(0, 1500)}`);
  }
  const parsed = body ? (JSON.parse(body) as unknown) : [];
  return Array.isArray(parsed) ? parsed : [];
}

/** SQL access for scripts/tests: direct Postgres if SUPABASE_DB_URL is set, else the Management API. */
export async function pgClient(): Promise<Sql> {
  if (process.env.SUPABASE_DB_URL) {
    const c = new pg.Client({ connectionString: env('SUPABASE_DB_URL'), ssl: { rejectUnauthorized: false } });
    await c.connect();
    return {
      async query(text, params = []) {
        const r = await c.query(text, params as unknown[]);
        return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
      },
      end: () => c.end(),
    };
  }
  return {
    async query(text, params = []) {
      const rows = (await managementQuery(inlineParams(text, params))) as never[];
      return { rows, rowCount: rows.length };
    },
    async end() {},
  };
}

export function randomPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(22));
  return 'Sp1-' + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Creates (or recreates) a confirmed auth user through the admin API. */
export async function createConfirmedUser(admin: SupabaseClient, email: string, password: string, meta: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

export async function deleteAuthUsersByEmail(admin: SupabaseClient, predicate: (email: string) => boolean): Promise<number> {
  let removed = 0;
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) {
      if (u.email && predicate(u.email)) {
        const { error: e } = await admin.auth.admin.deleteUser(u.id);
        if (e) throw e;
        removed++;
      }
    }
    if (data.users.length < 200) break;
  }
  return removed;
}

export function rpcOrThrow<T>(res: { data: T; error: { message: string; hint?: string } | null }, label: string): T {
  if (res.error) throw new Error(`${label}: ${res.error.message}${res.error.hint ? ` [${res.error.hint}]` : ''}`);
  return res.data;
}

/**
 * Permanently removes all data belonging to the given profiles (used for demo
 * reset and test cleanup only). Temporarily lifts the ledger's append-only
 * trigger inside one transaction.
 */
export async function purgeProfiles(db: Sql, whereProfilesRaw: string, params: unknown[] = []): Promise<void> {
  const whereProfiles = inlineParams(whereProfilesRaw, params);
  const ids = `(select id from public.profiles where ${whereProfiles})`;
  const groups = `(select id from public.groups where created_by in ${ids})`;
  const expenses = `(select id from public.expenses where created_by in ${ids} or group_id in ${groups}
                      or id in (select expense_id from public.expense_payers where user_id in ${ids})
                      or id in (select expense_id from public.expense_participants where user_id in ${ids}))`;
  const statements = [
    `delete from public.ledger_entries where debtor_id in ${ids} or creditor_id in ${ids} or group_id in ${groups}`,
    `delete from public.comments where author_id in ${ids} or expense_id in ${expenses}`,
    `update public.receipt_metadata set expense_id = null where expense_id in ${expenses}`,
    `delete from public.recurring_expense_occurrences where template_id in (select id from public.recurring_expense_templates where created_by in ${ids} or group_id in ${groups})`,
    `delete from public.expenses where id in ${expenses}`,
    `delete from public.recurring_expense_templates where created_by in ${ids} or group_id in ${groups}`,
    `delete from public.settlements where payer_id in ${ids} or payee_id in ${ids} or group_id in ${groups}`,
    `delete from public.activity_events where actor_id in ${ids} or group_id in ${groups}`,
    `delete from public.budgets where user_id in ${ids} or group_id in ${groups}`,
    `delete from public.split_templates where owner_id in ${ids} or group_id in ${groups}`,
    `delete from public.group_invitations where group_id in ${groups} or created_by in ${ids}`,
    `delete from public.group_members where group_id in ${groups} or user_id in ${ids}`,
    `delete from public.groups where id in ${groups}`,
    `delete from public.friendship_invitations where inviter_id in ${ids} or invitee_id in ${ids}`,
    `delete from public.friendships where user_a in ${ids} or user_b in ${ids}`,
    `delete from public.receipt_metadata where owner_id in ${ids}`,
    `delete from public.categories where owner_id in ${ids}`,
    `delete from public.profiles where ${whereProfiles}`,
  ];
  // One multi-statement script = one transaction on both backends.
  await db.query(
    ['begin', 'alter table public.ledger_entries disable trigger ledger_entries_no_update', ...statements,
     'alter table public.ledger_entries enable trigger ledger_entries_no_update', 'commit'].join(';\n') + ';',
  );
}
