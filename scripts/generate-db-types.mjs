/**
 * Generates src/lib/supabase/database.types.ts from the migrations themselves.
 *
 * The migrations are applied to an in-memory Postgres (PGlite) and the
 * resulting catalogue is introspected, so the types can never drift from the
 * schema: if a migration changes, regenerating produces the new shape or fails
 * loudly.
 *
 * Once a real Supabase project exists, `supabase gen types typescript` against
 * it is equivalent; this keeps the repo self-contained until then.
 */
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url).pathname
const OUT_FILE = new URL('../src/lib/supabase/database.types.ts', import.meta.url).pathname

const SHIM = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid());
  create or replace function auth.uid() returns uuid language sql stable
  as $shim$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $shim$;
`

/** Postgres base type -> TypeScript type. */
const SCALARS = {
  uuid: 'string', text: 'string', citext: 'string', varchar: 'string', bpchar: 'string',
  char: 'string', name: 'string',
  int2: 'number', int4: 'number', int8: 'number', float4: 'number', float8: 'number',
  numeric: 'number', bool: 'boolean',
  timestamptz: 'string', timestamp: 'string', date: 'string', time: 'string',
  json: 'Json', jsonb: 'Json',
}

function tsType(udtName, enums) {
  if (udtName.startsWith('_')) {
    const inner = tsType(udtName.slice(1), enums)
    return `${inner}[]`
  }
  if (enums.has(udtName)) return `Database['public']['Enums']['${udtName}']`
  return SCALARS[udtName] ?? 'unknown'
}

async function main() {
  const db = new PGlite({ extensions: { pgcrypto, citext } })
  await db.exec('create extension if not exists pgcrypto;')
  await db.exec(SHIM)

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    await db.exec(await readFile(join(MIGRATIONS_DIR, file), 'utf8'))
  }

  const enumRows = await db.query(`
    select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
    group by t.typname
    order by t.typname
  `)
  const enums = new Map(enumRows.rows.map((r) => [r.name, r.labels]))

  const columnRows = await db.query(`
    select c.table_name, c.column_name, c.is_nullable, c.column_default, c.udt_name,
           c.is_generated, c.identity_generation
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
    order by c.table_name, c.ordinal_position
  `)

  const tables = new Map()
  for (const row of columnRows.rows) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, [])
    tables.get(row.table_name).push(row)
  }

  // Foreign keys. Supabase's client uses these to type nested selects such as
  // `.select('*, organisations(name)')`; without them every join resolves to
  // `never` and the query result is unusable.
  const fkRows = await db.query(`
    select
      con.conname as constraint_name,
      src.relname as table_name,
      tgt.relname as referenced_table,
      (select array_agg(a.attname order by k.ord)
         from unnest(con.conkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as columns,
      (select array_agg(a.attname order by k.ord)
         from unnest(con.confkey) with ordinality k(attnum, ord)
         join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as referenced_columns,
      exists (
        select 1 from pg_constraint u
        where u.conrelid = con.conrelid
          and u.contype in ('p','u')
          and u.conkey @> con.conkey and con.conkey @> u.conkey
      ) as is_one_to_one
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_class tgt on tgt.oid = con.confrelid
    join pg_namespace n on n.oid = src.relnamespace
    where con.contype = 'f' and n.nspname = 'public'
    order by src.relname, con.conname
  `)

  const relationships = new Map()
  for (const row of fkRows.rows) {
    if (!relationships.has(row.table_name)) relationships.set(row.table_name, [])
    relationships.get(row.table_name).push(row)
  }

  const lines = []
  lines.push('// GENERATED FILE - do not edit by hand.')
  lines.push('// Regenerate with: npm run db:types')
  lines.push('// Source of truth: supabase/migrations/*.sql')
  lines.push('')
  lines.push('export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]')
  lines.push('')
  lines.push('export interface Database {')
  lines.push('  public: {')
  lines.push('    Tables: {')

  for (const [table, cols] of [...tables.entries()].sort()) {
    lines.push(`      ${table}: {`)
    lines.push('        Row: {')
    for (const c of cols) {
      const type = tsType(c.udt_name, enums)
      lines.push(`          ${c.column_name}: ${type}${c.is_nullable === 'YES' ? ' | null' : ''}`)
    }
    lines.push('        }')

    lines.push('        Insert: {')
    for (const c of cols) {
      const type = tsType(c.udt_name, enums)
      // Optional on insert when the database can supply a value itself.
      const optional = c.column_default !== null || c.is_nullable === 'YES' || c.identity_generation !== null
      lines.push(`          ${c.column_name}${optional ? '?' : ''}: ${type}${c.is_nullable === 'YES' ? ' | null' : ''}`)
    }
    lines.push('        }')

    lines.push('        Update: {')
    for (const c of cols) {
      const type = tsType(c.udt_name, enums)
      lines.push(`          ${c.column_name}?: ${type}${c.is_nullable === 'YES' ? ' | null' : ''}`)
    }
    lines.push('        }')
    const rels = relationships.get(table) ?? []
    if (rels.length === 0) {
      lines.push('        Relationships: []')
    } else {
      lines.push('        Relationships: [')
      for (const rel of rels) {
        lines.push('          {')
        lines.push(`            foreignKeyName: '${rel.constraint_name}'`)
        lines.push(`            columns: [${rel.columns.map((c) => `'${c}'`).join(', ')}]`)
        lines.push(`            isOneToOne: ${rel.is_one_to_one}`)
        lines.push(`            referencedRelation: '${rel.referenced_table}'`)
        lines.push(`            referencedColumns: [${rel.referenced_columns.map((c) => `'${c}'`).join(', ')}]`)
        lines.push('          },')
      }
      lines.push('        ]')
    }
    lines.push('      }')
  }

  lines.push('    }')
  lines.push('    Views: Record<string, never>')
  lines.push('    Functions: Record<string, never>')
  lines.push('    Enums: {')
  for (const [name, labels] of [...enums.entries()].sort()) {
    lines.push(`      ${name}: ${labels.map((l) => `'${l}'`).join(' | ')}`)
  }
  lines.push('    }')
  lines.push('    CompositeTypes: Record<string, never>')
  lines.push('  }')
  lines.push('}')
  lines.push('')
  lines.push("export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']")
  lines.push("export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']")
  lines.push("export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']")
  lines.push("export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]")
  lines.push('')

  await writeFile(OUT_FILE, lines.join('\n'), 'utf8')
  console.log(`Wrote ${OUT_FILE}`)
  console.log(`  ${tables.size} tables, ${enums.size} enums, ${fkRows.rows.length} relationships`)
  await db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
