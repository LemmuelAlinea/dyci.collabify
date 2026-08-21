#!/usr/bin/env node
// Run SQL against the Supabase database as the postgres superuser.
//
//   node scripts/db.mjs supabase/schema.sql
//   node scripts/db.mjs supabase/results.sql supabase/analytics.sql
//   node scripts/db.mjs -c "select count(*) from public.profiles"
//
// Reads SUPABASE_DB_URL from .env.local (gitignored).

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'
import dotenv from 'dotenv'

const root = path.resolve(import.meta.dirname, '..')
for (const file of ['.env.local', '.env']) {
  const full = path.join(root, file)
  if (existsSync(full)) dotenv.config({ path: full })
}

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error(
    'SUPABASE_DB_URL is not set. Copy .env.example to .env.local and paste your\n' +
      'Supabase session-pooler connection string (Project settings → Database).',
  )
  process.exit(1)
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error(
    'Usage: node scripts/db.mjs <file.sql> [more.sql …]   |   node scripts/db.mjs -c "SQL"',
  )
  process.exit(1)
}

// Several files run in the order given, stopping at the first failure. A view
// dropped with `cascade` takes its dependants with it, so whatever rebuilds them
// has to follow in the same breath.
const jobs =
  args[0] === '-c'
    ? [{ label: '-c', sql: args.slice(1).join(' ') }]
    : await Promise.all(
        args.map(async (file) => ({
          label: file,
          sql: await readFile(path.resolve(root, file), 'utf8'),
        })),
      )

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
})

// `raise notice` is how migrations report assertions; without this they vanish.
client.on('notice', (n) => console.log(`NOTICE: ${n.message}`))

try {
  await client.connect()
  for (const job of jobs) {
    if (jobs.length > 1) console.log(`\n── ${job.label}`)
    const result = await client.query(job.sql)
    const sets = Array.isArray(result) ? result : [result]
    for (const set of sets) {
      if (set.rows?.length) console.table(set.rows)
      else
        console.log(
          `${set.command ?? 'OK'}${set.rowCount != null ? ` · ${set.rowCount} row(s)` : ''}`,
        )
    }
  }
  console.log('\nDone.')
} catch (err) {
  console.error('\nSQL failed:', err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
