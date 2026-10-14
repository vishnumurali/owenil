/**
 * Provisions Owenil's Supabase project through the Management API.
 *
 *   npm run supabase:provision                 find or create "owenil-dev" (free plan, Mumbai)
 *   npm run supabase:provision -- --ref <ref>  use an existing project instead
 *   npm run supabase:provision -- --auth-urls  only update the Auth Site URL and redirect URLs
 *   npm run supabase:provision -- --google     turn on Google sign-in with GOOGLE_OAUTH_CLIENT_ID/SECRET from .env.local
 *   npm run supabase:provision -- --google-off turn Google sign-in off again
 *   npm run supabase:provision -- --email-confirm off|on  skip email verification while testing / require it again
 *   npm run supabase:provision -- --smtp       send auth emails through Gmail (SMTP_USER / SMTP_PASS app password in .env.local),
 *                                              with Owenil's email texts, then send one test email to that inbox
 *
 * Needs SUPABASE_ACCESS_TOKEN in .env.local (Dashboard → Account → Access Tokens).
 * Writes VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY
 * (and SUPABASE_DB_URL when it creates the project) into .env.local without
 * printing any secret. Sets the Auth Site URL and redirect URLs.
 * Refuses to create a project in an organization that is not on the Free plan.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { adminClient, env, pgClient, projectRef, purgeProfiles } from './lib';

const API = 'https://api.supabase.com/v1';
const NAME = 'owenil-dev';
const REGION = 'ap-south-1'; // South Asia (Mumbai)
const SITE_URL = 'https://vishnumurali.github.io/owenil/';
// The last entry is the Android app's own link (Google sign-in and auth emails started in the app).
const REDIRECTS = ['https://vishnumurali.github.io/owenil/**', 'http://localhost:5173/owenil/**', 'io.github.vishnumurali.owenil://**'];

// Auth email texts (Supabase fills in the {{ .Placeholders }}). Plain inline HTML, no images, for deliverability.
const emailButton = (url: string, label: string) =>
  `<p style="margin:24px 0"><a href="${url}" style="background:#0f9b76;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">${label}</a></p>`;
const emailLayout = (title: string, body: string) =>
  `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">` +
  `<p style="font-size:20px;font-weight:700;margin:0 0 16px;color:#0f9b76">Owenil</p><h1 style="font-size:18px;margin:0 0 12px">${title}</h1>${body}` +
  `<p style="font-size:12px;color:#6b7280;margin-top:32px">Owenil records shared expenses. It never moves money.</p></div>`;
const ignoreNote = (text: string) => `<p style="font-size:13px;color:#6b7280">${text}</p>`;
const EMAIL_TEXTS = {
  mailer_subjects_confirmation: 'Confirm your Owenil account',
  mailer_templates_confirmation_content: emailLayout('Confirm your email',
    `<p>Tap the button to confirm {{ .Email }} and finish creating your Owenil account.</p>${emailButton('{{ .ConfirmationURL }}', 'Confirm my email')}${ignoreNote('If you didn’t sign up for Owenil, ignore this email.')}`),
  mailer_subjects_recovery: 'Reset your Owenil password',
  mailer_templates_recovery_content: emailLayout('Reset your password',
    `<p>Someone asked to reset the password for {{ .Email }}. If it was you, tap the button to choose a new one.</p>${emailButton('{{ .ConfirmationURL }}', 'Choose a new password')}${ignoreNote('If you didn’t ask for this, ignore this email. Your password stays the same.')}`),
  mailer_subjects_magic_link: 'Your Owenil sign-in link',
  mailer_templates_magic_link_content: emailLayout('Sign in to Owenil', `<p>Tap the button to sign in.</p>${emailButton('{{ .ConfirmationURL }}', 'Sign in')}`),
  mailer_subjects_email_change: 'Confirm your new email for Owenil',
  mailer_templates_email_change_content: emailLayout('Confirm your new email',
    `<p>Tap the button to use {{ .NewEmail }} for your Owenil account.</p>${emailButton('{{ .ConfirmationURL }}', 'Confirm new email')}`),
  mailer_subjects_invite: 'You’re invited to Owenil',
  mailer_templates_invite_content: emailLayout('You’re invited to Owenil', `<p>Tap the button to create your Owenil account.</p>${emailButton('{{ .ConfirmationURL }}', 'Accept the invitation')}`),
  mailer_subjects_reauthentication: 'Your Owenil verification code',
  mailer_templates_reauthentication_content: emailLayout('Your verification code',
    `<p>Enter this code in Owenil:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">{{ .Token }}</p>`),
};

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env('SUPABASE_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : null) as T;
}

function upsertEnv(values: Record<string, string>) {
  const file = '.env.local';
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  for (const [k, v] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  }
  writeFileSync(file, lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim() + '\n');
}

interface Project { id: string; ref?: string; name: string; organization_id: string; region: string; status: string }
interface Org { id: string; slug?: string; name: string; plan?: string }
interface ApiKey { name: string; api_key: string | null; type?: string | null }

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--email-confirm')) {
    const mode = args[args.indexOf('--email-confirm') + 1];
    if (mode !== 'on' && mode !== 'off') throw new Error('Use --email-confirm on or --email-confirm off');
    await api('PATCH', `/projects/${projectRef()}/config/auth`, { mailer_autoconfirm: mode === 'off', password_min_length: 8 });
    const check = await api<{ mailer_autoconfirm?: boolean; password_min_length?: number }>('GET', `/projects/${projectRef()}/config/auth`);
    console.log(check.mailer_autoconfirm
      ? '✓ Email confirmation is OFF: new accounts are signed in straight away (testing only — turn it on before launch).'
      : '✓ Email confirmation is ON: new accounts must open the verification email.');
    console.log(`  Minimum password length: ${check.password_min_length}`);
    return;
  }
  if (args.includes('--smtp')) {
    const user = env('SMTP_USER').trim();
    const pass = env('SMTP_PASS').replace(/\s+/g, ''); // Google shows app passwords in groups of four
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user)) throw new Error('SMTP_USER must be the full email address, e.g. owenil.app@gmail.com');
    if (pass.length < 16) throw new Error('SMTP_PASS should be the 16-letter app password from https://myaccount.google.com/apppasswords');
    await api('PATCH', `/projects/${projectRef()}/config/auth`, {
      smtp_admin_email: user,
      smtp_sender_name: process.env.SMTP_SENDER_NAME?.trim() || 'Owenil',
      smtp_host: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
      smtp_port: process.env.SMTP_PORT?.trim() || '465',
      smtp_user: user,
      smtp_pass: pass,
      ...EMAIL_TEXTS,
    });
    const check = await api<{ smtp_host?: string; smtp_admin_email?: string; rate_limit_email_sent?: number }>('GET', `/projects/${projectRef()}/config/auth`);
    console.log(`✓ Auth emails now go through ${check.smtp_host} from ${check.smtp_admin_email} (password not shown); limit ${check.rate_limit_email_sent} per hour`);
    // One real email proves the Gmail login works: an invitation to the sender's own inbox (plus-address),
    // then the temporary account is removed again.
    const testAddress = user.replace('@', '+owenil-test@');
    const admin = adminClient();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(testAddress);
    if (error) throw new Error(`Gmail did not accept the test email: ${error.message}. Check SMTP_USER / SMTP_PASS (an app password, with 2-Step Verification on).`);
    const db = await pgClient();
    try {
      await purgeProfiles(db, 'id = $1', [data.user.id]);
    } finally {
      await db.end();
    }
    await admin.auth.admin.deleteUser(data.user.id);
    console.log(`✓ Test email sent through Gmail to ${testAddress} ("You’re invited to Owenil"); the temporary account was removed`);
    return;
  }
  if (args.includes('--google') || args.includes('--google-off')) {
    const on = args.includes('--google');
    const config = on
      ? { external_google_enabled: true, external_google_client_id: env('GOOGLE_OAUTH_CLIENT_ID'), external_google_secret: env('GOOGLE_OAUTH_CLIENT_SECRET') }
      : { external_google_enabled: false };
    await api('PATCH', `/projects/${projectRef()}/config/auth`, config);
    const check = await api<{ external_google_enabled?: boolean }>('GET', `/projects/${projectRef()}/config/auth`);
    console.log(`✓ Google sign-in is ${check.external_google_enabled ? 'ON' : 'OFF'} (credentials not shown)`);
    if (on) console.log(`  Google redirect URI to allow: https://${projectRef()}.supabase.co/auth/v1/callback`);
    return;
  }
  if (args.includes('--auth-urls')) {
    await api('PATCH', `/projects/${projectRef()}/config/auth`, { site_url: SITE_URL, uri_allow_list: REDIRECTS.join(',') });
    console.log(`✓ Auth Site URL = ${SITE_URL}; redirect URLs = ${REDIRECTS.join(', ')}`);
    return;
  }
  const explicitRef = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : process.env.SUPABASE_PROJECT_REF;
  const projects = await api<Project[]>('GET', '/projects');
  const orgs = await api<Org[]>('GET', '/organizations');
  console.log(`Organizations: ${orgs.map((o) => o.name).join(', ') || '(none)'}`);
  console.log(`Existing projects: ${projects.map((p) => `${p.name} [${p.id}, ${p.region}, ${p.status}]`).join('; ') || '(none)'}`);

  let project = explicitRef ? projects.find((p) => p.id === explicitRef || p.ref === explicitRef) : projects.find((p) => p.name === NAME);
  if (explicitRef && !project) throw new Error(`Project ${explicitRef} not found in this account.`);
  let dbPassword: string | null = null;

  if (!project) {
    if (orgs.length === 0) throw new Error('No organization found. Create one at https://supabase.com/dashboard first.');
    const org = orgs[0]!;
    const detail = await api<Org>('GET', `/organizations/${org.slug ?? org.id}`).catch(() => org);
    if (detail.plan && detail.plan !== 'free') {
      throw new Error(`Organization "${org.name}" is on the "${detail.plan}" plan — a new project there could incur charges. Re-run with --ref <existing project ref>, or create a free organization.`);
    }
    dbPassword = randomBytes(24).toString('base64url');
    console.log(`Creating "${NAME}" in ${org.name} (${REGION}, Free plan)…`);
    const created = await api<Project>('POST', '/projects', { name: NAME, organization_id: org.id, db_pass: dbPassword, region: REGION });
    project = created;
  } else {
    console.log(`Using existing project "${project.name}" (${project.id}).`);
  }
  const ref = project.ref ?? project.id;

  for (let i = 0; i < 90; i++) {
    const p = await api<Project>('GET', `/projects/${ref}`);
    if (p.status === 'ACTIVE_HEALTHY') break;
    if (i === 0 || i % 6 === 0) console.log(`  waiting for project to become healthy (status: ${p.status})…`);
    if (p.status === 'INACTIVE' || p.status === 'PAUSED') throw new Error('The project is paused. Restore it in the Supabase dashboard, then re-run.');
    await new Promise((r) => setTimeout(r, 10_000));
  }

  let keys = await api<ApiKey[]>('GET', `/projects/${ref}/api-keys?reveal=true`);
  let publishable = keys.find((k) => k.type === 'publishable')?.api_key;
  let secret = keys.find((k) => k.type === 'secret')?.api_key;
  if (!publishable || !secret) {
    // Older projects may only have legacy keys; create the new-style keys if possible.
    try {
      if (!publishable) await api('POST', `/projects/${ref}/api-keys`, { type: 'publishable', name: 'default' });
      if (!secret) await api('POST', `/projects/${ref}/api-keys`, { type: 'secret', name: 'owenil_scripts' });
      keys = await api<ApiKey[]>('GET', `/projects/${ref}/api-keys?reveal=true`);
      publishable = keys.find((k) => k.type === 'publishable')?.api_key ?? publishable;
      secret = keys.find((k) => k.type === 'secret')?.api_key ?? secret;
    } catch {
      /* fall back to legacy keys below */
    }
    publishable ??= keys.find((k) => k.name === 'anon')?.api_key ?? undefined;
    secret ??= keys.find((k) => k.name === 'service_role')?.api_key ?? undefined;
  }
  if (!publishable || !secret) throw new Error('Could not read the project API keys.');

  const values: Record<string, string> = {
    VITE_SUPABASE_URL: `https://${ref}.supabase.co`,
    VITE_SUPABASE_PUBLISHABLE_KEY: publishable,
    SUPABASE_SECRET_KEY: secret,
    VITE_BASE_PATH: '/owenil/',
    VITE_ENABLE_DEV_TOOLS: 'true',
  };
  if (dbPassword) {
    try {
      const pools = await api<{ connection_string?: string; pool_mode?: string; db_port?: number }[]>('GET', `/projects/${ref}/config/database/pooler`);
      const pool = pools.find((p) => p.pool_mode === 'session') ?? pools[0];
      if (pool?.connection_string) {
        values.SUPABASE_DB_URL = pool.connection_string.replace('[YOUR-PASSWORD]', encodeURIComponent(dbPassword)).replace(':6543/', ':5432/');
      }
    } catch {
      console.log('  (pooler details unavailable — scripts will use the Management API for SQL)');
    }
    values.SUPABASE_DB_PASSWORD = dbPassword;
  }
  upsertEnv(values);
  console.log(`✓ Wrote ${Object.keys(values).join(', ')} to .env.local (values not shown)`);

  await api('PATCH', `/projects/${ref}/config/auth`, { site_url: SITE_URL, uri_allow_list: REDIRECTS.join(',') });
  console.log(`✓ Auth Site URL = ${SITE_URL}; redirect URLs = ${REDIRECTS.join(', ')}`);
  console.log(`\nProject ready: https://supabase.com/dashboard/project/${ref}`);
}

main().catch((e) => {
  console.error(`\n✖ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
