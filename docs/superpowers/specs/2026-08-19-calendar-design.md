# Calendar — design

**Date** 2026-08-19 · follows `e94aeca`

## Context

`Calendar` has been a `soon:` placeholder in the student nav since phase 1. Deadlines
currently surface in three disconnected places: the dashboard's next-seven-days list, the
`dueSoonLabel` on task cards, and the overdue styling on project cards. None of them show
the *shape* of a term — what is bunched, what is empty, what is coming after next week.

Both roles need it, and they need different things from it.

## What goes on it

Everything below already exists in the schema. **No new tables, no new columns.**

| On the calendar | Source | Who sees it |
|---|---|---|
| Project deadlines | `projects.due_at` | both |
| Task deadlines | `project_tasks.due_at` | student only |
| Scheduled releases | `projects.release_at` | professor only |
| Handed in | `project_boards.submitted_at` | both |
| Syllabus weeks | `class_week_map` | both |
| Term bounds | `classes.term_start` / `term_end` | both |

### Deliberately left off

- **`polls.closed_at`, `group_sets.closed_at`** — these record when something *was* closed,
  the way `locked_at` does. They are state, not scheduled deadlines; none are set in the
  live database. Showing them would imply a future date that does not exist.
- **`task_events`, `worklog.worked_on`, `claimed_at`, `archived_at`** — activity and admin.
  A calendar is for what you plan around; the activity feed already covers what happened.

### Syllabus weeks are the spine, not events

`class_week_map` ([syllabus.sql:92](supabase/syllabus.sql:92)) already computes `week_start`,
`week_end`, `phase`, plus each week's `title` and `assessments`. Each week renders as a
labelled band behind the dates — "Week 11 · Building a DES in SimPy", carrying
*"Lab 6; Project Milestone 4"*.

This is the point of the feature. It puts what the syllabus promised next to what was
actually set, so a professor can see a week that names an assessment with no project
against it. A generic calendar cannot do that.

## Decisions taken

1. **The professor's calendar stops at project level.** Their class holds 16 students
   carrying 9 tasks each; 144 chips in a month is unreadable and none of them are the
   professor's to act on. Clicking a project opens its board, where per-group detail lives.
2. **Syllabus weeks as full labelled bands**, with titles and assessments.
3. **Month and agenda.** Month for the shape of the term, agenda for "what is next" — and
   agenda is the only one that works on a phone. Desktop-first, per the house conventions.
4. **Read-only.** Editing stays in the project and task forms. Dragging a chip to a new date
   is an easy way to move a deadline by accident, and `due_at` now decides what gets stamped
   late.

## Data

One migration, `supabase/calendar.sql`, holding a single view.

```sql
create view public.calendar_events with (security_invoker = true) as
  <project deadlines>  union all
  <project releases>   union all
  <task deadlines>     union all
  <board submissions>
```

`security_invoker = true` does the role scoping for free: a student's policies already hide
unreleased projects and other groups' boards, so the release rows and other groups' tasks
simply do not come back for them. Nothing role-specific is written into the view.

The professor's query excludes `task_due` server-side (`.neq('kind', 'task_due')`) rather
than fetching 144 rows and discarding them. That is a readability decision, not a security
one — RLS would allow it.

Columns: `kind`, `ref_id`, `title`, `at`, `class_id`, `class_initial`, `project_id`,
`project_title`, `task_id`, `group_name`, `done`, `late`.

## Reuse

- `Deadline` in [dashboard.ts:66](src/lib/api/dashboard.ts:66) is already the right shape.
  The calendar extends that idea rather than inventing a parallel one.
- `hasPassed` and `calendarDaysUntil` in [types.ts](src/lib/types.ts) — the corrected
  day-bucketing. The calendar must not re-derive its own, or it will drift out of agreement
  with the cards.
- `late` on `project_tasks` for the late marker; the same red chip idiom as `TaskCard`.

## UI

- `src/pages/app/calendar/Calendar.tsx` — one page, both roles, role from `useAuth()`.
- `src/components/calendar/MonthGrid.tsx` — the month, with week bands behind the cells.
- `src/components/calendar/AgendaList.tsx` — what is coming, in order.
- `src/components/calendar/EventChip.tsx` — one chip, coloured by kind.
- Filters: class (both), and a "only mine" toggle for students.
- Routes `/student/calendar` and `/professor/calendar` inside `<ProtectedRoute>` +
  `<AppShell>`; nav gains a real Calendar entry for both roles, and the student's
  `soon:` Calendar row goes.
- Clicking a task opens the existing task detail modal; a project goes to the project page.

## Verification

- A SQL suite, `supabase/tests/calendar.test.sql`, rolled back and impersonating real users:
  a student sees their own tasks and not another group's; a student does not see a scheduled
  project's release; a professor sees releases and every project in their classes; an
  outsider sees nothing.
- `npm run build`.
- A throwaway probe for the month grid and agenda, deleted afterwards.
- Grep the live bundle for a string unique to this change. **Do not trust a bundle-hash
  match** — `core.autocrlf = true` means local and Vercel builds compile different bytes.

## Later, not now

**iCal subscribe.** Students genuinely want deadlines in Google Calendar, but it needs a
tokenised per-user URL that is readable without a session. That is its own security
decision and deserves its own thinking, not a corner of this change.
