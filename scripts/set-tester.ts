// Marks an account as a tester so it can use the development premium switch
// (when app_settings.dev_entitlements_mode = 'testers').
//   npm run db:tester -- you@example.com          enable
//   npm run db:tester -- you@example.com --off    disable
//   npm run db:tester -- --mode off|testers|all|everyone   change the global mode
//     everyone: every account has Plus (existing + new sign-ups) while testing
//     off:      production — removes all development Plus (never purchases)
import { pgClient } from './lib';

async function main() {
  const args = process.argv.slice(2);
  const db = await pgClient();
  if (args[0] === '--mode') {
    const mode = args[1] ?? '';
    if (!['off', 'testers', 'all', 'everyone'].includes(mode)) throw new Error('mode must be off | testers | all | everyone');
    const { rows } = await db.query<{ r: { mode: string; previous_mode: string | null; granted: number; revoked: number } }>(
      'select public.set_dev_entitlements_mode($1) as r',
      [mode],
    );
    const r = rows[0]!.r;
    console.log(`dev_entitlements_mode = ${r.mode} (was ${r.previous_mode ?? 'unset'}); Plus granted to ${r.granted}, removed from ${r.revoked} account(s)`);
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
