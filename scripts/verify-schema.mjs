/**
 * Executes every migration in supabase/migrations against a real Postgres
 * engine (PGlite, Postgres compiled to WASM) so schema errors surface here
 * rather than on a live database.
 *
 * Supabase-specific objects that PGlite has no knowledge of (the `auth` schema,
 * `auth.uid()`, the `service_role`) are shimmed below to match Supabase's own
 * definitions closely enough for the DDL and RLS policies to compile.
 */
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url).pathname

const SUPABASE_SHIM = `
  create schema if not exists auth;

  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    created_at timestamptz not null default now()
  );

  create or replace function auth.uid()
  returns uuid language sql stable
  as $shim$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $shim$;
`

async function main() {
  const db = new PGlite({ extensions: { pgcrypto, citext } })
  await db.exec('create extension if not exists pgcrypto;')
  await db.exec(SUPABASE_SHIM)

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  if (files.length === 0) throw new Error('No migrations found')

  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    try {
      await db.exec(sql)
      console.log(`  ok   ${file}`)
    } catch (error) {
      console.error(`  FAIL ${file}`)
      console.error(`       ${error.message}`)
      process.exitCode = 1
      await db.close()
      return
    }
  }

  // Structural assertions: the guarantees the rest of the app relies on.
  const checks = [
    {
      label: 'every org-scoped table has RLS enabled',
      sql: `select string_agg(c.relname, ', ') as bad
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
              and exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name=c.relname and column_name='org_id')
              and c.relrowsecurity = false`,
    },
    {
      label: 'no money column is stored as a floating point type',
      sql: `select string_agg(table_name || '.' || column_name, ', ') as bad
            from information_schema.columns
            where table_schema='public'
              and (column_name like '%_minor' or column_name like '%price%' or column_name like '%cost%')
              and data_type in ('real','double precision')`,
    },
    {
      label: 'audit_logs rejects UPDATE',
      sql: null,
    },
  ]

  for (const check of checks.filter((c) => c.sql)) {
    const res = await db.query(check.sql)
    const bad = res.rows[0]?.bad
    if (bad) {
      console.error(`  FAIL ${check.label}: ${bad}`)
      process.exitCode = 1
    } else {
      console.log(`  ok   ${check.label}`)
    }
  }

  // Prove the append-only trigger actually fires.
  await db.exec(`insert into organisations (name, slug) values ('Verify', 'verify');`)
  const orgId = (await db.query(`select id from organisations where slug='verify'`)).rows[0].id
  await db.query(
    `insert into audit_logs (org_id, actor_type, action, entity_type) values ($1, 'system', 'TEST', 'test')`,
    [orgId],
  )
  let blocked = false
  try {
    await db.exec(`update audit_logs set action = 'TAMPERED'`)
  } catch {
    blocked = true
  }
  console.log(`  ${blocked ? 'ok  ' : 'FAIL'} audit_logs rejects UPDATE`)
  if (!blocked) process.exitCode = 1

  let deleteBlocked = false
  try {
    await db.exec(`delete from audit_logs`)
  } catch {
    deleteBlocked = true
  }
  console.log(`  ${deleteBlocked ? 'ok  ' : 'FAIL'} audit_logs rejects DELETE`)
  if (!deleteBlocked) process.exitCode = 1

  const tables = await db.query(
    `select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r'`,
  )
  console.log(`\n  ${tables.rows[0].n} tables created.`)
  await db.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
