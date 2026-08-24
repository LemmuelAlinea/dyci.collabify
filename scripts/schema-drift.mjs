#!/usr/bin/env node
// Report objects that more than one SQL file defines.
//
//   node scripts/schema-drift.mjs
//
// Why this exists: files here are re-runnable, and several of them redefine the
// same view or trigger function to add a column or a rule. Whichever file runs
// LAST wins, and if that one is the older copy, the additions are silently
// undone. Three real cases were found this way:
//
//   task_board_overview     dashboard.sql won and was missing ten columns, so
//                           rebuilding from docs/07-backup.md produced a
//                           database the app could not query.
//   guard_task_assignee     class-restore.sql won and had neither the locked-
//                           project nor the handed-in check.
//   guard_reassignment_req  reassignments.sql won and had no handed-in check.
//
// None of them showed up in the live database, because the files had never been
// run in the documented order against it. Nothing here is a failure on its own —
// a later file legitimately extends an earlier one. The rule it checks is:
// **the last definition must be the complete one.**

import { readFileSync } from 'node:fs'

// The order docs/07-backup.md rebuilds in. Keep the two in step.
const ORDER = `schema classes groups tasks task-points task-detail task-claim-limit
task-unclaim task-status-owner solo-auto-claim deadline-lock submissions
reassignments results syllabus syllabus-assessments polls messages dashboard
realtime recover-work removed-visible class-restore approvals accounts audit
admin-rename calendar analytics analytics-insight reports student-reports
admin-program program-notices program-registry safety live notifications rate-limit`.split(/\s+/)

const seen = new Map()
for (const name of ORDER) {
  const sql = readFileSync(`supabase/${name}.sql`, 'utf8')
  const re = /create\s+(?:or\s+replace\s+)?(function|view)\s+public\.(\w+)/gi
  for (const m of sql.matchAll(re)) {
    const key = `${m[1].toLowerCase()} ${m[2]}`
    // Rough size of the definition, to spot a later copy that is smaller.
    const body = sql.slice(m.index, sql.indexOf(m[1].toLowerCase() === 'view' ? ';' : '$$;', m.index))
    const entry = seen.get(key) ?? []
    if (!entry.some((e) => e.file === name)) entry.push({ file: name, lines: body.split('\n').length })
    seen.set(key, entry)
  }
}

const dupes = [...seen.entries()].filter(([, v]) => v.length > 1)
let suspect = 0

console.log(`${dupes.length} objects are defined in more than one file.\n`)
for (const [key, where] of dupes) {
  const last = where[where.length - 1]
  const biggest = where.reduce((a, b) => (b.lines > a.lines ? b : a))
  const shrank = last.lines < biggest.lines
  if (shrank) suspect++
  console.log(
    `${shrank ? 'CHECK' : '  ok '}  ${key.padEnd(42)} ` +
      where.map((w) => `${w.file}(${w.lines})`).join(' -> '),
  )
  if (shrank) {
    console.log(
      `        last definition is ${biggest.lines - last.lines} lines shorter than ${biggest.file}.sql's — ` +
        `confirm it did not drop a column or a rule`,
    )
  }
}

console.log(
  `\n${suspect} to check by hand. This is a hint, not a verdict: a shorter definition ` +
    `can be a correct simplification.\nThe real proof is running the chain in order and ` +
    `then supabase/tests/*.test.sql.`,
)
