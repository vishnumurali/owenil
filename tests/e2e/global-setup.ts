import { writeFileSync } from 'node:fs';
import { adminClient, createConfirmedUser, hasHostedConfig, pgClient, randomPassword, userClient } from '../../scripts/lib';

export const E2E_DOMAIN = 'e2e.owenil.test';

/** Creates confirmed throwaway accounts for the browser tests. */
export default async function globalSetup() {
  if (!hasHostedConfig()) {
    writeFileSync('e2e-credentials.local.json', JSON.stringify({ configured: false }));
    return;
  }
  const admin = adminClient();
  const tag = Math.random().toString(36).slice(2, 8);
  const accounts: Record<string, { email: string; password: string; name: string; id: string }> = {};
  for (const [key, name] of [['alice', 'E2E Alice'], ['bob', 'E2E Bob'], ['carol', 'E2E Carol'], ['xena', 'E2E Xena']] as const) {
    const email = `${key}.${tag}@${E2E_DOMAIN}`;
    const password = randomPassword();
    const id = await createConfirmedUser(admin, email, password, { display_name: name, default_currency: 'INR', timezone: 'Asia/Kolkata' });
    accounts[key] = { email, password, name, id };
  }
  // Alice is a tester (premium switch) and has completed onboarding; Bob & Carol are her friends.
  const db = await pgClient();
  await db.query(`update public.profiles set onboarded_at = now() where id = any($1::uuid[])`, [[accounts.alice!.id, accounts.bob!.id, accounts.carol!.id, accounts.xena!.id]]);
  await db.query(`update public.profiles set is_tester = true where id = $1`, [accounts.alice!.id]);
  await db.end();
  const alice = await userClient(accounts.alice!.email, accounts.alice!.password);
  for (const k of ['bob', 'carol'] as const) {
    const { data } = await alice.client.rpc('create_friend_invitation', { p_email: null });
    const other = await userClient(accounts[k]!.email, accounts[k]!.password);
    const { error } = await other.client.rpc('accept_friend_invitation', { p_token: (data as { token: string }).token });
    if (error) throw error;
  }
  writeFileSync('e2e-credentials.local.json', JSON.stringify({ configured: true, tag, accounts }, null, 2));
}
