#!/usr/bin/env node
// Promote or approve an existing Collabify account.
//
//   node scripts/set-role.mjs you@example.com superadmin
//   node scripts/set-role.mjs prof@example.com professor active
//
// The user must already have signed up (the row is created by the auth trigger).

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

const [email, role = 'superadmin', status = 'active'] = process.argv.slice(2)

if (!email) {
  console.error('Usage: node scripts/set-role.mjs <email> [student|professor|superadmin] [active|pending|rejected]')
  process.exit(1)
}
if (!['student', 'professor', 'superadmin'].includes(role)) {
  console.error(`Unknown role "${role}".`)
  process.exit(1)
}
if (!['active', 'pending', 'rejected'].includes(status)) {
  console.error(`Unknown status "${status}".`)
  process.exit(1)
}
if (!process.env.SUPABASE_DB_URL) {
  console.error('SUPABASE_DB_URL is not set. See .env.example.')
  process.exit(1)
}

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
})

try {
  await client.connect()

  // Backfill the profile row in case the account signed up through Google and
  // never finished onboarding.
  await client.query(
    `insert into public.profiles (id, email, first_name, last_name, role, status)
     select u.id, u.email, '', '', $2::public.user_role, $3::public.account_status
       from auth.users u
      where lower(u.email) = lower($1)
     on conflict (id) do nothing`,
    [email, role, status],
  )

  const { rows } = await client.query(
    `update public.profiles p
        set role = $2::public.user_role,
            status = $3::public.account_status
       from auth.users u
      where u.id = p.id and lower(u.email) = lower($1)
      returning p.id, p.email, p.role, p.status`,
    [email, role, status],
  )

  if (rows.length === 0) {
    console.error(`No account found for ${email}. Have them sign up first.`)
    process.exitCode = 1
  } else {
    await client.query(
      `insert into public.notification_prefs (user_id) values ($1)
       on conflict (user_id) do nothing`,
      [rows[0].id],
    )
    console.table(rows)
    console.log('\nDone.')
  }
} catch (err) {
  console.error('\nFailed:', err.message)
  process.exitCode = 1
} finally {
  await client.end()
}
