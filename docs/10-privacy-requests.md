# Answering a privacy request

Collabify holds education records, which the Data Privacy Act of 2012 treats as
**sensitive** personal information. Every right in [the privacy
policy](../src/lib/legal/privacy.ts) is exercised by request, and the policy
commits to acknowledging within **five working days** and completing within
**fifteen**. That promise is only keepable if the steps are written down before
somebody is under the clock, which is what this file is.

Requests arrive in `public.privacy_requests` and appear at `/admin/privacy`, or
`/professor/privacy` for the named handler. Move each one along with the
**Record an answer** button — never by editing the table, which has no update
policy for anybody by design.

---

## Before anything else

1. **Check it is really them.** The request carries the account's own name and
   email, taken from the profile rather than typed, so a signed-in request is
   already authenticated. A request arriving by email is not: confirm through
   the college's own channel before acting on it.
2. **Acknowledge it now, not when it is done.** Five days is for the
   acknowledgement. Doing that first also starts the visible clock for the
   student, who can otherwise only see silence.
3. **Ask what they actually mean** when erasure and withdrawal are both
   possible readings. They are different requests with different outcomes, and
   guessing wrong is not recoverable in the erasure direction.

---

## Access, and portability

```bash
node scripts/subject-export.mjs <email>
```

Writes `exports/<email>-<date>.json`. `exports/` is gitignored, and it must
stay that way: one of those files is a named student's whole coursework record.

**Read the file before sending it.** That is the step that catches a row naming
somebody else, and it is not a formality. The script already withholds the one
known case — a reassignment reason written *about* this student by another —
replacing it with a line saying so, because handing it over would answer one
person's right of access by breaching another's privacy.

What the export deliberately does not carry, and what to say if asked:

| Not included | Where it is |
|---|---|
| The password | Held hashed by Supabase Auth. Nobody can read it, including us |
| Sign-in IP addresses and browsers | `auth.audit_log_entries`, not `public.*`. Obtainable from the Supabase dashboard if they ask |
| Page request logs | Vercel. Ask Vercel; they are not the college's to export |
| Another student's reassignment reason | Withheld, with the ground stated in the file |

Portability and access take the same file. Portability is about the format
being machine-readable, not about the contents being curated, so send it as it
is.

---

## Correction

Get what is wrong and what it should be **in writing** before changing
anything.

- **Name, photo, theme** — the person changes these themselves in Settings.
  Point them there rather than doing it for them.
- **Email address or role** — an admin action. The `profiles_guard_privileged`
  trigger refuses a self-change, which is the point of it.
- **Something another person wrote** — a comment, a message, a decision note.
  Correct it only with that author's agreement, or record the correction beside
  it instead. It is their statement as much as it is about the subject.
- **An `audit_events` entry is never edited.** Add a new entry recording the
  correction. A log its own subject can rewrite is worth nothing, which is the
  whole reason it is append-only.

---

## Erasure

**Read this whole section before running anything.** A profile delete is not
the answer on its own: it removes some things the group still needs and leaves
other things behind.

### What a profile delete takes with it

`on delete cascade` from `public.profiles`:

`announcements` · `class_member_archive` · `class_members` ·
`conversation_members` · `group_members` · `message_hidden` · `messages` ·
`notification_prefs` · `notifications` · `poll_votes` · `polls` ·
`program_announcements` · `project_boards` · `rate_limits` · `task_assignees` ·
`task_reassignments` (as requester) · `task_worklog` · `teaching_resources`

> **`project_boards` is on that list.** A board is per student within a group,
> and deleting it takes its tasks with it. This is exactly why the privacy
> policy says accounts are deactivated rather than deleted: an unqualified
> delete removes work the rest of the group is still standing on. Decide with
> the student whether their tasks should be released to the group first.

### What a profile delete leaves behind

`on delete set null` — the row survives with no author, so the **text stays**:

| Table | Column | What is left sitting there |
|---|---|---|
| `task_comments` | `author_id` | The comment body, attributed to nobody |
| `task_files` | `uploaded_by` | The file row, and the object in storage |
| `project_tasks` | `created_by` | The task title and details |
| `task_events` | `actor_id` | The activity trail, anonymised |
| `task_reassignments` | `from_student`, `to_student`, `decided_by` | The reason another student wrote |
| `audit_events` | `actor_id` | The entry, and `subject_label` — a snapshot of the name |

So erasure means, in order:

```sql
-- 1. Their own writing, which a cascade would not remove.
delete from public.task_comments where author_id = :id;

-- 2. Their files. Delete the storage objects first — a deleted row leaves an
--    orphaned object nobody can find, which is worse than a visible one.
select file_path from public.task_files where uploaded_by = :id;
-- …remove each path from the `task-files` bucket, then:
delete from public.task_files where uploaded_by = :id;

-- 3. Their avatar, from the `avatars` bucket: avatars/<id>/…
--    The bucket is public, so an object left behind stays world-readable.

-- 4. Everything the cascade covers.
delete from public.profiles where id = :id;

-- 5. The auth account, so the address cannot be signed in with again.
--    Supabase dashboard → Authentication → Users, or the admin API.
```

`consent_records` cascades from `auth.users`, so step 5 removes it. That is
correct: consent to processing that no longer happens is itself personal data
with nothing left to justify it.

### What is kept, and what to tell them

**`audit_events`.** It records that an account existed, what was changed and by
whom, and it carries `subject_label` — the name as it was. Nothing can edit or
delete it, including an administrator, because a log its subject can rewrite
would be no protection to anybody.

Tell the person exactly what was kept. Do not say "everything is gone" if a
name snapshot remains in the administrative log, because it does.

### A professor cannot be deleted while they teach

`classes.professor_id` and `projects.created_by` are `on delete restrict`. The
delete will simply fail. Hand the classes over first — that is a real decision
about a course, not a database step, and it belongs with the program office.

---

## Objection

Ask which use they object to. The usual one is the profiling described under
[Measurements about you](../src/lib/legal/privacy.ts): last activity, share of
a board held and finished, whether one person is carrying the group.

There is no switch for it. Objecting means the professor is told not to rely on
those measures for that student, and the objection is recorded here. Say that
plainly rather than implying something in the software changed.

Processing that is what makes somebody a member of a class cannot be objected
to while they keep the account. If that is what they mean, the request is
really deactivation.

---

## Withdrawing consent

```sql
select public.withdraw_consent('privacy');  -- run as that user, or:
update public.consent_records set withdrawn_at = now() where id = :row;  -- refused: no update policy
```

Withdrawal stamps `withdrawn_at` on the newest live row. It never deletes one:
the record's whole value is still saying what was agreed on the day it was
agreed.

Withdrawal is not erasure and removes nothing. In practice, withdrawing consent
to the privacy policy means the account is deactivated, because the processing
being withdrawn from *is* the course. Say so before doing it, so nobody
withdraws expecting to keep using Collabify.

---

## Refusing a request

A refusal needs a ground, and the form will not accept one without it. §16(e)
gives the person the right to know why and to challenge it.

Legitimate grounds are narrow. "It is inconvenient" is not one. Disclosing
another person's personal information is — that is why a reassignment reason is
withheld, and the refusal should say exactly that rather than declining the
whole request.

Always end by telling them they may take it to the college's Data Protection
Officer, and beyond that to the National Privacy Commission
(privacy.gov.ph, info@privacy.gov.ph), without the college's permission.

---

## When a version of a document changes

1. Edit `src/lib/legal/privacy.ts` or `terms.ts` and bump `version`.
2. Add the new version to `legal_versions` in `supabase/consent.sql`, in the
   same commit. Set `material` to `false` for a correction or a clearer
   sentence, `true` for a change to what is being agreed to.
3. Re-run `node scripts/db.mjs supabase/consent.sql`.

Consent to a version missing from `legal_versions` is refused by the database,
so forgetting step 2 breaks registration on the first attempt rather than
silently recording nothing. That is the trade the foreign key is making.

A `material` change asks everyone to agree again the next time they sign in. A
non-material one does not — and marking a typo fix as material would lock a
whole cohort behind a prompt mid-term and teach them to click through it.
