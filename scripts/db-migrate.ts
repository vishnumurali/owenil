// Applies supabase/migrations/*.sql in order. Each file runs as ONE script
// (begin … commit), through a direct connection (SUPABASE_DB_URL) or the
// Supabase Management API (SUPABASE_ACCESS_TOKEN). Applied versions are recorded
// in supabase_migrations.schema_migrations, the table the Supabase CLI uses.
//   npm run db:migrate             apply pending migrations
//   npm run db:migrate -- --print  write supabase/combined.sql for the SQL editor instead
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pgClient, sqlLiteral } from './lib';

const dir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

async function main() {
  if (process.argv.includes('--print')) {
    writeFileSync(join(process.cwd(), 'supabase', 'combined.sql'), files.map((f) => `-- >>> ${f}\n${readFileSync(join(dir, f), 'utf8')}\n`).join('\n'));
    console.log(`Wrote supabase/combined.sql (${files.length} migrations). Paste it into Dashboard → SQL Editor and run once.`);
    return;
  }
  const db = await pgClient();
  await db.query(`create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
  const applied = new Set((await db.query<{ version: string }>('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version));
  let count = 0;
  for (const f of files) {
    const [version, ...rest] = f.replace(/\.sql$/, '').split('_');
    if (applied.has(version!)) continue;
    process.stdout.write(`→ ${f} ... `);
    const sql = readFileSync(join(dir, f), 'utf8');
    try {
      await db.query(
        `begin;\n${sql}\n;insert into supabase_migrations.schema_migrations (version, name, statements) values (${sqlLiteral(version)}, ${sqlLiteral(rest.join('_'))}, array[]::text[]);\ncommit;`,
      );
      console.log('ok');
      count++;
    } catch (e) {
      console.log('FAILED');
      console.error(`\n${e instanceof Error ? e.message : e}`);
      await db.end();
      process.exit(1);
    }
  }
  await db.query(`notify pgrst, 'reload schema'`);
  await db.end();
  console.log(count ? `Applied ${count} migration(s).` : 'Database is up to date.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
