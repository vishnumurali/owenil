/**
 * Provisions Owenil's Supabase project through the Management API.
 *
 *   npm run supabase:provision                 find or create "owenil-dev" (free plan, Mumbai)
 *   npm run supabase:provision -- --ref <ref>  use an existing project instead
 *   npm run supabase:provision -- --auth-urls  only update the Auth Site URL and redirect URLs
 *
 * Needs SUPABASE_ACCESS_TOKEN in .env.local (Dashboard → Account → Access Tokens).
 * Writes VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY
 * (and SUPABASE_DB_URL when it creates the project) into .env.local without
 * printing any secret. Sets the Auth Site URL and redirect URLs.
 * Refuses to create a project in an organization that is not on the Free plan.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { env, projectRef } from './lib';

const API = 'https://api.supabase.com/v1';
const NAME = 'owenil-dev';
const REGION = 'ap-south-1'; // South Asia (Mumbai)
const SITE_URL = 'https://vishnumurali.github.io/owenil/';
const REDIRECTS = ['https://vishnumurali.github.io/owenil/**', 'http://localhost:5173/owenil/**'];

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
