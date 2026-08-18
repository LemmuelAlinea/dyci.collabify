# Deadline enforcement — design

**Date** 2026-08-19 · follows `46a10a3`

## The problem

`projects.due_at` is decoration. It drives `dueSoonLabel`, the overdue styling on
`ProjectCard`, the `closed` bucket in `ProjectsBoard`, and the dashboard deadline
lists. Nothing in RLS or any trigger reads it. A student can finish a task a month
after it was due and the record shows nothing.

Two separate needs are tangled in that one date:

- **When was this due?** — a fact about the work, used to judge it.
- **May this student still write?** — a decision about access, which a professor
  makes.

Conflating them means an extension rewrites history, and a passed deadline either
locks people out or does nothing. This design separates them.

## Decisions taken

1. **A passed deadline records lateness; it does not block.** For a class, handing in
   late and having it marked late is more useful than being locked out. A network
   failure at 23:59 should not cost a student the submission.
2. **The professor gets a manual lock**, independent of `due_at`. Closing early or
   granting an extension never edits the deadline, so `due_at` stays an honest record.
3. **Lateness is stamped, not derived.** Written once, when the task is completed.
   Editing `due_at` afterwards does not retroactively excuse or condemn finished work.

## Data model

One migration, `supabase/deadline-lock.sql`, idempotent like the rest.

```
projects.locked_at    timestamptz          -- null = open
project_tasks.late    boolean not null default false
```

`locked_at` mirrors the shape of the neighbouring `archived_at` and `release_at`:
a nullable timestamp where null is the permissive state. It records *when* the
project was closed, which the professor may want to see.

`late` is a boolean, not a timestamp — `done_at` already records when, and the only
question `late` answers is yes or no.

## What the lock blocks

`due_at` passing blocks nothing at all. `locked_at` being set blocks students. The
professor is exempt throughout, matching every other guard in the schema
(`is_board_professor`).

| Action | Past `due_at` | Locked |
|---|---|---|
| Start or finish a task | allowed, stamped late | blocked |
| Edit a task | existing freeze rules | blocked |
| Claim or hand back | allowed | blocked |
| Attach or remove files | allowed | blocked |
| Log work | allowed | blocked |
| Comment | allowed | **allowed** |

Comments stay open deliberately. A closed project is exactly when a professor leaves
feedback and a student answers; freezing that conversation serves nobody.

### Mechanism

A helper resolves a board to its project's lock state:

```sql
public.board_project_locked(p_board uuid) returns boolean
```

`security definer`, matching the existing `is_board_professor` / `is_board_member`
helpers, so it can read `projects` regardless of the caller's own policies.

- **`project_tasks`** — a check inside the existing `guard_task_edit` trigger, placed
  after the professor exemption and before the ownership check, so a locked board
  refuses every student write with one message.
- **`task_assignees`** — the insert and delete policies gain `and not
  board_project_locked(task_board(task_id))`.
- **`task_files`, `task_worklog`** — same clause on insert and delete.
- **`task_comments`** — untouched.

Insert of new tasks on a locked board is refused by the same rule on the
`project_tasks` insert policy; the professor's own insert path is unaffected.

## Lateness

`stamp_task_status` already runs `before insert or update` on `project_tasks` and
writes `started_at` and `done_at`. It gains the late stamp in the same pass:

- On a move **into** `done`: `late := (project due_at is not null and now() > due_at)`.
- On a move **out of** `done`: `late := false`.

So `late` is only ever meaningful on a task that is currently done, and it always
reflects the deadline as it stood at the moment the work was handed in. A professor
who later pushes `due_at` forward does not silently clear the marks.

A task completed by the professor on a student's behalf is stamped by the same rule —
lateness is a fact about the time, not about who clicked.

## Views

`task_board_overview` and `task_member_progress` (from `task-points.sql`) each gain:

```sql
late_count int   -- count(*) filter (where status = 'done' and late)
```

so the professor's Summary tab and the member-progress panel can show a late count
without a second round trip.

## UI

Small, and follows what is already there.

- **`TaskCard` / `TaskList`** — a `Late` badge on done tasks that carry the flag,
  using the existing amber accent, beside the current due label.
- **`TaskSummary`** — a late count alongside the other counts.
- **Member progress** — a late count per member, so the professor sees who is behind.
- **`canChangeFiles`** in `src/lib/types.ts` takes the lock into account, so the file
  grid closes for the same reason the writes are refused.
- **Professor** — a Close / Reopen action on the project page, wording plain: closing
  says the project stops accepting work, reopening says it accepts it again.
- **Student** — a banner on a locked board: the project is closed, ask the professor
  to reopen it.
- **`ProjectsBoard.statusOf`** — a locked project sorts into `closed` alongside a
  past-deadline one.

Copy follows the house rules: sentence case, active voice, no exclamation marks, no
"please", errors say what happened and what to do next.

## Verification

A rolled-back SQL suite in the pattern of the existing ones, asserting:

1. A student is refused a status change on a locked board.
2. A professor is not refused on the same board.
3. A student is refused a file attach and a work-log entry on a locked board.
4. A student may still comment on a locked board.
5. A task finished after `due_at` is stamped `late`.
6. A task finished before `due_at` is not.
7. Reopening and re-finishing restamps; moving out of done clears.
8. Editing `due_at` afterwards leaves an existing stamp untouched.
9. A student may still finish a task on a past-deadline but unlocked project.

The fixture traps recorded in the handoff apply: grant on temp tables when
impersonating, `touch_updated_at` fights backdating, `reset role` does not clear
`request.jwt.claims`, and a professor cannot insert `task_assignees`.

Then `npm run build`, which runs `tsc -b` first.

The UI half cannot be exercised end to end without a signed-in session. It is verified
by a throwaway probe route, deleted afterwards, as established last session — and
called out plainly as unverified where a probe cannot reach it.
