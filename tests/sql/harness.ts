import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Local database harness: real PostgreSQL (PGlite/WASM) with a minimal stub
 * of the Supabase platform (auth schema, auth.uid(), storage schema, roles).
 * Lets us run the real migrations and exercise RLS + business logic offline.
 * The same behaviours are verified against the hosted project by tests/db.
 */
const SUPABASE_STUB = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create table auth.users (
  id uuid primary key,
  email text unique,
  raw_user_meta_data jsonb default '{}'
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
grant execute on function storage.foldername(text) to authenticated;
`;

export interface TestDb {
  db: PGlite;
  /** Create an auth user (fires the real signup trigger) and return its id. */
  createUser(name: string, opts?: { email?: string; tester?: boolean }): Promise<string>;
  /** Run a query as an authenticated user (RLS enforced). */
  as<T = Record<string, unknown>>(userId: string | null, sql: string, params?: unknown[]): Promise<T[]>;
  /** Call an RPC as a user; returns the single result value. */
  rpc<T = unknown>(userId: string | null, fn: string, args: Record<string, unknown>): Promise<T>;
  /** Run as superuser (bypasses RLS) — for assertions only. */
  admin<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = join(process.cwd(), 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(dir, f), 'utf8'));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }

  // Serialize all access: PGlite is single-connection and role/claims are session state.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const as = <T>(userId: string | null, sql: string, params: unknown[] = []) =>
    serial(async () => {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false);`);
      await db.exec(userId ? 'set role authenticated' : 'set role anon');
      try {
        const r = await db.query<T>(sql, params);
        return r.rows;
      } finally {
        await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
      }
    });

  const admin = <T>(sql: string, params: unknown[] = []) =>
    serial(async () => {
      await db.exec('reset role');
      return (await db.query<T>(sql, params)).rows;
    });

  return {
    db,
    as,
    admin,
    async createUser(name, opts = {}) {
      const id = randomUUID();
      const email = opts.email ?? `${name.toLowerCase().replace(/\W+/g, '.')}.${id.slice(0, 6)}@example.test`;
      await admin(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, email, { display_name: name }]);
      if (opts.tester) await admin(`update public.profiles set is_tester = true where id = $1`, [id]);
      return id;
    },
    async rpc<T>(userId: string | null, fn: string, args: Record<string, unknown>) {
      const keys = Object.keys(args);
      const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as result`;
      const rows = await as<{ result: T }>(userId, sql, keys.map((k) => args[k]));
      return rows[0]!.result;
    },
  };
}
