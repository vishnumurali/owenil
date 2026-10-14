// Manually runs the server-side recurring-expense generator (what pg_cron does hourly).
import { pgClient } from './lib';

async function main() {
  const db = await pgClient();
  const { rows } = await db.query<{ created: number }>('select public.generate_due_recurring_expenses() as created');
  console.log(`Created ${rows[0]?.created ?? 0} recurring expense(s).`);
  await db.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
