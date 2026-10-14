import { existsSync, readFileSync } from 'node:fs';
import { adminClient, deleteAuthUsersByEmail, hasHostedConfig, pgClient, purgeProfiles } from '../../scripts/lib';

/** Removes every account (and its data) created by the browser tests. */
export default async function globalTeardown() {
  if (!hasHostedConfig() || !existsSync('e2e-credentials.local.json')) return;
  const creds = JSON.parse(readFileSync('e2e-credentials.local.json', 'utf8')) as { configured: boolean; tag?: string };
  if (!creds.configured || !creds.tag) return;
  const db = await pgClient();
  try {
    const { rows } = await db.query(`select id from auth.users where email like $1`, [`%.${creds.tag}@e2e.owenil.test`]);
    const regs = await db.query(`select id from auth.users where email like 'register.%@e2e.owenil.test'`);
    const ids = [...rows, ...regs.rows].map((r) => r.id);
    if (ids.length) await purgeProfiles(db, 'id = any($1::uuid[])', [ids]);
  } finally {
    await db.end();
  }
  await deleteAuthUsersByEmail(adminClient(), (e) => e.endsWith('@e2e.owenil.test'));
}
