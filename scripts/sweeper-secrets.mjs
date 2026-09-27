#!/usr/bin/env node
// Puts the project URL and service role key into Supabase Vault for the
// storage sweep (supabase/storage-sweep.sql). Run once, and again after
// rotating the service key.
//
//   node scripts/sweeper-secrets.mjs
//
// Reads VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL from
// .env.local (gitignored). Never prints either secret.

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import pg from 'pg'
import dotenv from 'dotenv'

const root = path.resolve(import.meta.dirname, '..')
for (const file of ['.env.local', '.env']) {
  const full = path.join(root, file)
  if (existsSync(full)) dotenv.config({ path: full, quiet: true })
}

const { SUPABASE_DB_URL, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!SUPABASE_DB_URL || !VITE_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_DB_URL, VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: SUPABASE_DB_URL })
await client.connect()

async function put(name, secret, description) {
  const { rows } = await client.query('select id from vault.secrets where name = $1', [name])
  if (rows[0]) {
    await client.query('select vault.update_secret($1, $2)', [rows[0].id, secret])
    console.log(`Updated ${name}`)
  } else {
    await client.query('select vault.create_secret($1, $2, $3)', [secret, name, description])
    console.log(`Stored ${name}`)
  }
}

try {
  await put('collabify_supabase_url', VITE_SUPABASE_URL, 'Project URL for the storage sweep')
  await put('collabify_service_role_key', SUPABASE_SERVICE_ROLE_KEY, 'Service key for the storage sweep')
} finally {
  await client.end()
}
