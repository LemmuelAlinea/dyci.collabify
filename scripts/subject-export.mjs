#!/usr/bin/env node
// Everything Collabify holds about one person, as JSON.
//
//   node scripts/subject-export.mjs juan@school.edu.ph
//   node scripts/subject-export.mjs juan@school.edu.ph --out exports/
//
// Reads SUPABASE_DB_URL from .env.local (gitignored), the same way db.mjs does.

/**
 * This exists because RA 10173 §18 gives a data subject the right to receive
 * what they have given "in an electronic or structured format", and §16(c) the
 * right to a copy of what is held. Neither has a manual carve-out. The privacy
 * policy commits to fifteen days, and fifteen days is not achievable by
 * somebody writing SELECTs by hand under pressure — so the alternative to this
 * script is a promise the college cannot keep.
 *
 * **What it deliberately does not include.**
 *
 * A reassignment reason written *about* this person by somebody else. That
 * text is another student's personal information, disclosed to the professor
 * and its author only, and handing it over would satisfy one person's right of
 * access by breaching another's privacy. The rows still appear, with the reason
 * replaced by a line saying it was withheld and why — silence would look like
 * the request had missed something.
 *
 * **What it includes that may surprise the reader.** Notification previews,
 * which copy a line of whatever triggered them; task events, which record what
 * somebody did to a task minute by minute; and audit entries, which keep a
 * snapshot of the name at the time. All three are in the privacy policy, and a
 * copy that quietly omitted them would make that policy the honest document and
 * this the misleading one.
 *
 * Read the output before sending it. That is not a formality — it is the step
 * that catches a shared row naming somebody else, and it is in the checklist in
 * docs/10-privacy-requests.md for that reason.
 */

import { mkdir, writeFile } from 'node:fs/promises'
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
const email = args.find((a) => !a.startsWith('-'))
const outIndex = args.indexOf('--out')
const outDir = outIndex >= 0 ? args[outIndex + 1] : 'exports'

if (!email) {
  console.error('Usage: node scripts/subject-export.mjs <email> [--out <dir>]')
  process.exit(1)
}

const WITHHELD =
  'Withheld: this reason was written by another student and is their personal information. ' +
  'See "To access" in the privacy policy.'

/**
 * One section of the export.
 *
 * `$1` is always the subject's id. Each query is written to return only rows
 * that are about this person — never a whole table filtered in JavaScript,
 * which is how an export accidentally carries a classmate's row.
 */
const SECTIONS = [
  {
    key: 'profile',
    about: 'What you gave when you registered, and what you have changed since.',
    sql: `select id, email, first_name, middle_name, last_name, role, status,
                 avatar_url, theme, created_at, updated_at
            from public.profiles where id = $1`,
  },
  {
    key: 'consent',
    about: 'Which version of each document you agreed to, and when.',
    sql: `select document, version, granted_at, withdrawn_at, surface
            from public.consent_records where user_id = $1 order by granted_at`,
  },
  {
    key: 'notification_settings',
    about: 'Which notifications you chose to receive.',
    sql: `select * from public.notification_prefs where user_id = $1`,
  },
  {
    key: 'class_membership',
    about: 'Classes you joined, when, and who removed you if anybody did.',
    sql: `select cm.class_id, c.name as class_name, cm.status, cm.joined_at,
                 cm.removed_at, cm.removed_by
            from public.class_members cm
            join public.classes c on c.id = cm.class_id
           where cm.student_id = $1 order by cm.joined_at`,
  },
  {
    key: 'group_membership',
    about: 'Groups you were put in, and who put you there.',
    sql: `select gm.group_id, g.name as group_name, gm.set_id, gm.added_by, gm.joined_at
            from public.group_members gm
            join public.groups g on g.id = gm.group_id
           where gm.student_id = $1 order by gm.joined_at`,
  },
  {
    key: 'tasks_held',
    about: 'Tasks you claimed or were given, and when.',
    sql: `select ta.task_id, t.title, t.status, t.due_at, t.late,
                 ta.claimed_by, ta.claimed_at
            from public.task_assignees ta
            join public.project_tasks t on t.id = ta.task_id
           where ta.student_id = $1 order by ta.claimed_at`,
  },
  {
    key: 'tasks_you_created',
    about: 'Tasks you wrote.',
    sql: `select id, board_id, title, details, weight, status, due_at,
                 author_role, ai_generated, created_at
            from public.project_tasks where created_by = $1 order by created_at`,
  },
  {
    key: 'work_log',
    about: 'The minutes, notes and dates you recorded against your tasks.',
    sql: `select w.id, w.task_id, t.title, w.minutes, w.note, w.worked_on, w.created_at
            from public.task_worklog w
            join public.project_tasks t on t.id = w.task_id
           where w.student_id = $1 order by w.worked_on`,
  },
  {
    key: 'comments',
    about: 'Comments you wrote on tasks.',
    sql: `select id, task_id, body, edited_at, created_at
            from public.task_comments where author_id = $1 order by created_at`,
  },
  {
    key: 'messages_you_sent',
    about: 'Messages you sent, including in one-to-one conversations.',
    sql: `select id, conversation_id, body, edited_at, deleted_at, pinned, created_at
            from public.messages where sender_id = $1 order by created_at`,
  },
  {
    key: 'conversations',
    about: 'Conversations you are part of.',
    sql: `select conversation_id, joined_at, last_read_at
            from public.conversation_members where user_id = $1 order by joined_at`,
  },
  {
    key: 'poll_votes',
    about: 'How you voted. Poll votes are recorded against your name and are not anonymous.',
    sql: `select v.poll_id, p.question, v.option_id, o.label as option_label, v.voted_at
            from public.poll_votes v
            join public.polls p on p.id = v.poll_id
            left join public.poll_options o on o.id = v.option_id
           where v.user_id = $1 order by v.voted_at`,
  },
  {
    key: 'announcements_you_wrote',
    about: 'Class announcements you posted.',
    sql: `select id, class_id, title, body, pinned, created_at
            from public.announcements where author_id = $1 order by created_at`,
  },
  {
    key: 'files_you_uploaded',
    about: 'Files you attached to a task.',
    sql: `select id, task_id, file_name, mime_type, size_bytes, created_at
            from public.task_files where uploaded_by = $1 order by created_at`,
  },
  {
    key: 'reassignments_you_asked_for',
    about: 'Requests you made for a task to change hands, including your own reason.',
    sql: `select id, task_id, wants, reason, status, decided_by, decided_at,
                 decision_note, created_at
            from public.task_reassignments
           where requested_by = $1 order by created_at`,
  },
  {
    key: 'reassignments_about_you',
    about:
      'Requests somebody else made about a task you held. The reason is withheld: it was ' +
      'written by another student and is their personal information.',
    sql: `select id, task_id, wants, $2::text as reason, status, decided_at, created_at
            from public.task_reassignments
           where from_student = $1 and requested_by <> $1 order by created_at`,
    params: [WITHHELD],
  },
  {
    key: 'notifications',
    about:
      'Notifications sent to you. Each keeps a short preview of whatever triggered it, which ' +
      'for a private message is a line of that message.',
    sql: `select id, type, title, preview, read_at, created_at
            from public.notifications where user_id = $1 order by created_at`,
  },
  {
    key: 'task_activity',
    about: 'The per-task trail of what you did, recorded by the system rather than typed by you.',
    sql: `select id, task_id, kind, detail, at
            from public.task_events where actor_id = $1 order by at`,
  },
  {
    key: 'administrative_log',
    about:
      'Entries in the administrative log naming you, as subject or as actor. This log cannot ' +
      'be edited or deleted by anyone, including administrators, and is kept when other things ' +
      'are erased.',
    sql: `select id, at, action, actor_id, subject_id, subject_label,
                 class_label, before_value, after_value
            from public.audit_events
           where subject_id = $1 or actor_id = $1 order by at`,
  },
  {
    key: 'privacy_requests',
    about: 'Requests you have made under the Data Privacy Act, and their answers.',
    sql: `select id, kind, detail, status, acknowledge_by, complete_by,
                 answer, answered_at, created_at
            from public.privacy_requests where requester_id = $1 order by created_at`,
  },
]

const { Client } = pg
const client = new Client({ connectionString })
await client.connect()

try {
  const found = await client.query(
    `select id, email, first_name, last_name from public.profiles where lower(email) = lower($1)`,
    [email],
  )

  if (found.rowCount === 0) {
    console.error(`No account with the address ${email}.`)
    process.exit(1)
  }
  if (found.rowCount > 1) {
    // Cannot happen with the current unique index, but exporting the wrong
    // person's coursework is not a failure worth risking on that assumption.
    console.error(`${found.rowCount} accounts share that address. Resolve that first.`)
    process.exit(1)
  }

  const subject = found.rows[0]
  const out = {
    _about: {
      subject: `${subject.first_name} ${subject.last_name} <${subject.email}>`,
      generated_at: new Date().toISOString(),
      produced_by: 'scripts/subject-export.mjs',
      note:
        'Produced in answer to a request under the Data Privacy Act of 2012. Read this file ' +
        'before sending it: check that no section names another student.',
      not_included: [
        'Your password. It is held by the sign-in service, hashed, and is never readable.',
        'The IP address and browser of each sign-in. Those are held by the sign-in service, ' +
          'not by Collabify. Ask if you want them.',
        'The reason another student gave when asking for one of your tasks to be reassigned. ' +
          'It is their personal information as much as it is about you.',
      ],
    },
  }

  for (const section of SECTIONS) {
    const params = [subject.id, ...(section.params ?? [])]
    const { rows } = await client.query(section.sql, params)
    out[section.key] = { _about: section.about, rows }
    console.log(`${String(rows.length).padStart(5)}  ${section.key}`)
  }

  await mkdir(path.resolve(root, outDir), { recursive: true })
  const safe = subject.email.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  const file = path.resolve(root, outDir, `${safe}-${new Date().toISOString().slice(0, 10)}.json`)
  await writeFile(file, JSON.stringify(out, null, 2), 'utf8')

  console.log(`\nWritten to ${path.relative(root, file)}`)
  console.log('Read it before sending it. See docs/10-privacy-requests.md.')
} finally {
  await client.end()
}
