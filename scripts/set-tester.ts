// Marks an account as a tester so it can use the development premium switch
// (when app_settings.dev_entitlements_mode = 'testers').
//   npm run db:tester -- you@example.com          enable
//   npm run db:tester -- you@example.com --off    disable
//   npm run db:tester -- --mode off|testers|all   change the global mode
import { pgClient } from './lib';

async function main() {
  const args = process.argv.slice(2);
  const db = await pgClient();
  if (args[0] === '--mode') {
    const mode = args[1] ?? '';
    if (!['off', 'testers', 'all'].includes(mode)) throw new Error('mode must be off | testers | all');
    await db.query(
      `insert into public.app_settings (key, value) values ('dev_entitlements_mode', to_jsonb($1::text))
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [mode],
    );
    console.log(`dev_entitlements_mode = ${mode}`);
  } else {
    const email = (args[0] ?? '').toLowerCase();
    if (!email.includes('@')) throw new Error('Usage: npm run db:tester -- you@example.com [--off]');
    const on = !args.includes('--off');
    const r = await db.query(`update public.profiles p set is_tester = $2 from auth.users u where u.id = p.id and lower(u.email) = $1 returning p.id`, [email, on]);
    console.log(r.rowCount ? `${email}: tester = ${on}` : `No account found for ${email}. Sign up first.`);
  }
  await db.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
