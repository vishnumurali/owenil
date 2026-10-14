// Verifies the Supabase database matches what Owenil expects: tables, RLS,
// policies, functions and their privileges, storage bucket, cron jobs.
//   npm run db:verify
import { pgClient } from './lib';

const TABLES = [
  'profiles', 'user_preferences', 'friendships', 'friendship_invitations', 'groups', 'group_members', 'group_invitations',
  'expenses', 'expense_payers', 'expense_participants', 'expense_splits', 'expense_items', 'expense_item_assignments',
  'expense_revisions', 'ledger_entries', 'settlements', 'recurring_expense_templates', 'recurring_expense_occurrences',
  'categories', 'comments', 'activity_events', 'notifications', 'budgets', 'exchange_rate_snapshots',
  'subscription_entitlements', 'subscription_events', 'receipt_metadata', 'idempotency_records', 'split_templates',
  'saved_filters', 'currencies', 'app_settings', 'rate_limit_events', 'payment_handles',
];
const CLIENT_RPCS = [
  'create_expense', 'update_expense', 'delete_expense', 'restore_expense', 'record_settlement', 'reverse_settlement',
  'get_balance_overview', 'get_group_balances', 'create_group', 'accept_group_invitation', 'create_friend_invitation',
  'accept_friend_invitation', 'create_recurring_template', 'run_due_recurring_now', 'get_my_spending', 'dev_set_plan',
  'export_my_data', 'delete_my_account', 'get_visible_profiles', 'set_upi_id', 'get_upi_id', 'record_settlements',
];
const INTERNAL = ['_create_expense_core', '_record_settlement_core', '_apply_expense_ledger', '_reverse_source_ledger', '_make_friends', 'generate_due_recurring_expenses', 'cleanup_ephemeral_records'];

async function main() {
  const db = await pgClient();
  let failures = 0;
  const check = (ok: boolean, label: string, detail = '') => {
    console.log(`${ok ? '✓' : '✖'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
  };

  const tables = (await db.query<{ tablename: string; rowsecurity: boolean }>(`select tablename, rowsecurity from pg_tables where schemaname = 'public'`)).rows;
  const names = new Set(tables.map((t) => t.tablename));
  const missing = TABLES.filter((t) => !names.has(t));
  check(missing.length === 0, `${TABLES.length} expected tables exist`, missing.join(', '));
  const noRls = tables.filter((t) => !t.rowsecurity).map((t) => t.tablename);
  check(noRls.length === 0, 'Row Level Security enabled on every public table', noRls.join(', '));

  const policies = (await db.query<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'public'`)).rows[0]!.n;
  check(policies >= 40, `RLS policies present (${policies})`);

  const anonTables = (await db.query<{ table_name: string }>(`select distinct table_name from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`)).rows;
  check(anonTables.length === 0, 'anon role has no table privileges', anonTables.map((r) => r.table_name).join(', '));

  const fnPriv = (await db.query<{ proname: string; auth: boolean; anon: boolean }>(
    `select p.proname, bool_or(has_function_privilege('authenticated', p.oid, 'execute')) as auth,
            bool_or(has_function_privilege('anon', p.oid, 'execute')) as anon
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' group by p.proname`,
  )).rows;
  const priv = new Map(fnPriv.map((r) => [r.proname, r]));
  const notCallable = CLIENT_RPCS.filter((f) => !priv.get(f)?.auth);
  check(notCallable.length === 0, `${CLIENT_RPCS.length} client RPCs callable by signed-in users`, notCallable.join(', '));
  const exposed = INTERNAL.filter((f) => !priv.has(f) || priv.get(f)!.auth || priv.get(f)!.anon);
  check(exposed.length === 0, `internal functions exist and are NOT callable by clients`, exposed.join(', '));
  const anonCallable = fnPriv.filter((r) => r.anon).map((r) => r.proname);
  check(anonCallable.length === 0, 'anonymous visitors cannot call any public function', anonCallable.join(', '));

  check((await db.query(`select 1 from pg_trigger where tgname = 'on_auth_user_created'`)).rowCount === 1, 'signup trigger on auth.users installed');
  const bucket = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'receipts'`);
  check(bucket.rowCount === 1 && bucket.rows[0]!.public === false, 'private "receipts" storage bucket exists');
  const cats = (await db.query<{ n: number }>(`select count(*)::int as n from public.categories where is_system`)).rows[0]!.n;
  check(cats === 16, `16 built-in categories (${cats})`);

  try {
    const jobs = (await db.query<{ jobname: string }>(`select jobname from cron.job where jobname like 'owenil-%'`)).rows.map((r) => r.jobname);
    check(jobs.includes('owenil-recurring'), 'pg_cron job for recurring expenses scheduled', jobs.join(', '));
  } catch {
    check(false, 'pg_cron available', 'enable it in Dashboard → Database → Extensions, then re-run the last block of migration 0004');
  }

  const mode = (await db.query<{ v: string }>(`select value #>> '{}' as v from public.app_settings where key = 'dev_entitlements_mode'`)).rows[0]?.v;
  console.log(`ℹ dev_entitlements_mode = ${mode ?? '(unset → off)'}${mode && mode !== 'off' ? '  (use "npm run db:tester -- --mode off" for production)' : ''}`);
  const migrations = (await db.query<{ version: string; name: string }>(`select version, name from supabase_migrations.schema_migrations order by version`)).rows;
  console.log(`ℹ applied migrations: ${migrations.map((m) => `${m.version}_${m.name}`).join(', ')}`);
  await db.end();
  console.log(failures ? `\n✖ ${failures} check(s) failed` : '\n✓ Database verified');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
