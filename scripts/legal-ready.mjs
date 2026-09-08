#!/usr/bin/env node
// Refuse to call the legal documents finished while a placeholder is in them.
//
//   node scripts/legal-ready.mjs           # says what is missing, exits 0
//   LEGAL_READY=1 node scripts/legal-ready.mjs   # exits 1 if anything is missing
//
// Part of `npm run check`, which is why the default is quiet-and-passing:
// ordinary development must not be blocked by a name nobody has been given
// yet. Set LEGAL_READY=1 in the deploy that publishes them, and this becomes
// the thing that stops "TO BE FILLED IN" reaching a student.

/**
 * There are two guards on this, deliberately, because they fail differently.
 *
 * The banner on the page catches it if somebody looks. This catches it if
 * nobody does — and shipping a privacy policy is exactly the kind of task that
 * gets finished late on the day it is needed, by whoever is available, without
 * a careful read.
 *
 * It also checks the database, because the documents naming a professor and
 * `privacy_handler` naming nobody would mean requests reaching the admin queue
 * while the policy says otherwise. Only when a connection string is available:
 * this must stay runnable on a machine that has never seen the database.
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import dotenv from 'dotenv'

const root = path.resolve(import.meta.dirname, '..')
for (const file of ['.env.local', '.env']) {
  const full = path.join(root, file)
  if (existsSync(full)) dotenv.config({ path: full })
}

const strict = process.env.LEGAL_READY === '1'
const problems = []

// The same marker `contact.ts` uses. Read out of the file rather than imported,
// so this script needs no build step and no TypeScript loader.
const contact = await readFile(path.join(root, 'src/lib/legal/contact.ts'), 'utf8')
const UNSET = contact.match(/export const UNSET = '([^']+)'/)?.[1]

if (!UNSET) {
  problems.push('src/lib/legal/contact.ts no longer declares UNSET — this check cannot see anything.')
} else {
  for (const [label, field] of [
    ['the supervising professor', 'PRIVACY_CONTACT'],
    ["the college's Data Protection Officer", 'SCHOOL_DPO'],
  ]) {
    const block = contact.split(`export const ${field}`)[1]?.split('} as const')[0] ?? ''
    // Looks for the identifier, not the string. `contact.ts` writes
    // `${UNSET} — supervising professor`, so the literal never appears in the
    // source — the first version of this check searched for it and quietly
    // found nothing, which is the exact failure the script exists to prevent.
    if (/\$\{UNSET\}/.test(block)) {
      problems.push(`${field} still has a placeholder: ${label} has not been named.`)
    }
  }
}

// The database half. Skipped silently without a connection string, because the
// alternative is a check that fails on a fresh clone for a reason that has
// nothing to do with the legal documents.
if (process.env.SUPABASE_DB_URL) {
  const pg = (await import('pg')).default
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL })
  try {
    await client.connect()
    const { rows } = await client.query('select count(*)::int as n from public.privacy_handler')
    if (rows[0].n === 0) {
      problems.push(
        'privacy_handler names nobody, so requests fall back to the admin queue ' +
          'while the documents say a professor receives them.',
      )
    }
    const versions = await client.query('select document, version from public.legal_versions')
    for (const file of ['privacy', 'terms']) {
      const src = await readFile(path.join(root, `src/lib/legal/${file}.ts`), 'utf8')
      const version = src.match(/version: `([^`]+)`/)?.[1]
      const known = versions.rows.some((r) => r.document === file && r.version === version)
      if (!known) {
        problems.push(
          `${file}.ts is at version ${version}, which legal_versions has never heard of. ` +
            'Add it in supabase/consent.sql or registration will fail.',
        )
      }
    }
  } catch (err) {
    problems.push(`Could not check the database: ${err.message}`)
  } finally {
    await client.end().catch(() => {})
  }
}

if (problems.length === 0) {
  console.log('legal-ready: ok')
  process.exit(0)
}

console.log(strict ? 'legal-ready: NOT READY' : 'legal-ready: not ready yet (not enforced)')
for (const problem of problems) console.log(`  - ${problem}`)

if (strict) {
  console.log(
    '\nSee "Before publishing" in docs/10-privacy-requests.md. Unset LEGAL_READY to carry on\n' +
      'developing; it exists so publishing is a decision rather than an oversight.',
  )
  process.exit(1)
}
