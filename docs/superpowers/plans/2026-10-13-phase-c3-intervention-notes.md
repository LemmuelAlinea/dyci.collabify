# Phase C3: Intervention Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give teaching staff a log, readable only by staff, of what they noticed and did about a student or group. Reminders write to it automatically, and follow-ups that fall due show up in Needs attention.

**Architecture:**
- A new `supabase/class-notes.sql` adds `class_notes`. Staff can read it, there are no write policies, and it never deletes rows.
- Two security-definer functions write it: `add_class_note` and `resolve_class_note`.
- `nudge_board` (`automation.sql`) and `remind_peer_round` (`peer-evaluation.sql`) log into it. Their once-a-day limits now read the log instead of `notifications`, which students can delete.
- Analytics loads the notes on their own fast loader. It shows them in the student drawer and in each group card on the Groups view, and turns notes whose follow-up is due into `follow_up_due` actions.

**Tech Stack:** Supabase Postgres (plpgsql, RLS), React 19 + TypeScript + Vite, Tailwind tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-phase-c-grading-design.md`: section "C3: intervention notes", plus "Shared rules" and "Testing".

## Spec corrections (rulings made while planning)

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| 1 | Writes go through `add_class_note` and `resolve_class_note` (security definer). There are no insert or update policies. | The repo's rule is that new tables get no write policies. A function can also check that the student and board belong to the class, which a policy does awkwardly. | None. |
| 2 | `add_class_note` accepts only `note`, `meeting` and `follow_up`. `nudge` and `peer_reminder` are written only by the reminder functions. | The log must not be able to claim a reminder that never went out. | None. |
| 3 | The text caps are inline check constraints in `class-notes.sql`, not `hardening.sql` rows. | `hardening.sql` runs before this file in a rebuild, so it cannot reach the table. C1 did the same. | None. |
| 4 | A peer reminder writes one note per board reminded, worded "Reminded N students to rate their teammates". | A note needs a student or a board, and one reminder reaches several boards. | None. |
| 5 | Follow-up actions are built in TypeScript (`followUpActions` in `src/lib/notes.ts`) and merged into `rankActions`. They are not added to the SQL view `class_actions`. | `class_actions` is the slowest read on the page (5–9 s). Notes load separately and quickly, so a new note shows without that reload. | None. |
| 6 | "See why" on a follow-up action narrows the scope to its student, which opens their drawer through the existing "scope opens the drawer" path. A board-only note narrows to the board on the Groups view instead. | The spec says the action links to the drawer, and a board-only note has no student to open. | The professor clears the scope chip afterwards. |
| 7 | The nudge limit is per board (board + kind `nudge` + last 20 hours). Before, it was per project and recipient. | That is the spec's wording. A board is the thing reminded. | Two boards on one project can each be reminded once a day, which was already the case in practice. |

## Global Constraints

- **SQL files.** Every new SQL file is idempotent (`create … if not exists`, `create or replace`, `drop … if exists`). New enum types use `do $$ begin create type … exception when duplicate_object then null; end $$;`.
- **Writes.** Every write is a `security definer` function with `set search_path = public`. New tables get no insert, update or delete policies.
- **Refusals.** A refusal raises `check_violation` with a sentence a person can act on, or `insufficient_privilege` when the caller is the wrong person.
- **Staff, RLS and grants.** Teaching staff means `is_class_professor(class)`, which includes co-teachers. Admins who do not teach are not staff. New tables enable RLS. `revoke all … from anon` and `grant select … to authenticated` go inline. Re-run `node scripts/db.mjs supabase/anon-lockdown.sql` after any function change.
- **Rebuild order.** Add `class-notes` to the `scripts/schema-drift.mjs` ORDER string after `scoring`, and append `supabase/class-notes.sql` to **both** rebuild command lines in `docs/07-backup.md` (lines 26 and 53).
- **The database.** The live database is the only database. `node scripts/db.mjs <file>` runs SQL on it, and test files wrap everything in `begin; … rollback;`. **Never re-run** `results.sql`, `analytics.sql`, `admin-program.sql` or `task-archive.sql`: they cascade-drop or revert other views. Re-running `automation.sql` and `peer-evaluation.sql` is safe.
- **Colours** come only from tokens: `TONE_CELL` in `src/components/charts/format.ts`, `text-ink`, `text-muted`, `text-faint`, `border-line`, `surface`, `surface-sunken`. No raw hex.
- **Copy:** sentence case, active voice. No "please", no "successfully", no exclamation marks. An error says what happened and what to do next.
- **Days** are Manila days: `manilaDay()` in TypeScript, `timeZone: 'Asia/Manila'` in `Intl.DateTimeFormat`. A follow-up date is a `date`, compared as `YYYY-MM-DD` strings.
- **React rules.**
  - Render-time clocks use `useNow()` from `src/hooks/useNow.ts`.
  - A `.tsx` file exports components only, because of `react-refresh/only-export-components`. Hooks, helpers and types go in `.ts` files.
- **Staging.** Never stage `cinema/`, `cinema-portrait/`, `launch-video/`, `.claude/launch.json`, `.gitignore` or `supabase/.temp/`. Stage files by name.
- **Editing.** Use the Edit or Write tools, never PowerShell `Set-Content`.
- **Before calling a task done,** run `npm run build`, `npx eslint src` and `npx vitest run`.
- **Spec text, verbatim:**
  - Analytics privacy line: "Flags are prompts for a conversation. Notes record that conversation and only teaching staff can read them."
  - Follow-up action title: "Follow up with {name}", severity 2.
  - Note kinds: `'note' | 'nudge' | 'meeting' | 'follow_up' | 'peer_reminder'`.
  - Caps: body 2000, outcome 1000.

## Review Focus

1. **A professor saves a note with only spaces, or more than 2000 characters.** The form refuses with a reason, and the server refuses too. *Task 1 tests the server side (blank, 2001 characters). In Task 4 the Add button stays disabled on a blank body, and the textarea has `maxLength`.*
2. **A student opens the drawer data through the API.** They get no notes, including notes about themselves. *Task 1 test: a student reads zero rows, even with a note on them.*
3. **The student deletes the reminder notification, and the professor nudges again the same day.** Still refused. *Task 2 test.*
4. **A follow-up date of today, in Manila, while the UTC date is still yesterday.** It counts as due. *Task 3 unit test: `followUpActions` with `today = '2026-10-14'` and `follow_up_on = '2026-10-14'` returns an action. `useAnalytics` passes `manilaDay(new Date())`.*
5. **A resolved note with a past follow-up date.** It never produces an action. *Task 3 unit test.*

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/class-notes.sql` (new) | Enum, table, RLS, `add_class_note`, `resolve_class_note`, and the realtime publication. |
| `supabase/tests/class-notes.test.sql` (new) | Rolled-back SQL suite. |
| `supabase/automation.sql` (modify) | `nudge_board` logs a note, and its limit reads the log. |
| `supabase/peer-evaluation.sql` (modify) | `remind_peer_round` logs notes, and its limit reads the log. |
| `supabase/tests/automation.test.sql` (modify) | The handed-in check clears the logged nudge, so it tests what it says. |
| `src/lib/types.ts` (modify) | `ClassNote`, `ClassNoteKind`. |
| `src/lib/api/notes.ts` (new) | `listClassNotes`, `addClassNote`, `resolveClassNote`. |
| `src/lib/notes.ts` + `.test.ts` (new) | `NOTE_KIND_META`, `ADDABLE_KINDS`, `notesAbout`, `followUpActions`. |
| `src/lib/insight.ts` (modify) | `follow_up_due` kind, `Action.studentId`, and an `extra` parameter on `rankActions`. |
| `src/lib/analyticsView.ts` + test (modify) | Maps `follow_up_due` to Students. |
| `src/pages/app/analytics/useAnalytics.ts` (modify) | Loads notes on their own, and merges follow-ups into the actions. |
| `src/components/analytics/NotesPanel.tsx` (new) | The list, the Add note form, and Resolve. |
| `src/components/analytics/StudentDrawer.tsx` (modify) | The Notes section. |
| `src/pages/app/analytics/views/GroupsView.tsx` (modify) | A "Notes (N)" disclosure in each group's share-bar card. |
| `src/pages/app/analytics/views/StudentsView.tsx` (modify) | The privacy line. |
| `src/pages/app/analytics/Analytics.tsx` (modify) | "See why" on a follow-up opens the drawer. |
| `scripts/schema-drift.mjs`, `docs/07-backup.md` (modify) | Rebuild order. |

---

### Task 1: The notes table, its functions and who can read it

**Files:**
- Create: `supabase/class-notes.sql`
- Create: `supabase/tests/class-notes.test.sql`
- Modify: `scripts/schema-drift.mjs`. The ORDER string ends `… peer-evaluation scoring`; append ` class-notes`.
- Modify: `docs/07-backup.md`. Append ` supabase/class-notes.sql` to the command lines at line 26 and line 53, after `supabase/scoring.sql`. Add one paragraph after the `scoring.sql` note.

**Interfaces:**
- Consumes: `public.is_class_professor(uuid)` (one-workplace.sql), `public.class_members`, `public.project_boards`, `public.projects`, `public.classes`.
- Produces:
  - Enum `public.class_note_kind`: `'note','nudge','meeting','follow_up','peer_reminder'`.
  - Table `public.class_notes`: `id, class_id, student_id, board_id, kind, body, follow_up_on, resolved_at, outcome, created_by, created_at`.
  - `add_class_note(p_class uuid, p_student uuid, p_board uuid, p_kind public.class_note_kind, p_body text, p_follow_up date) returns public.class_notes`
  - `resolve_class_note(p_note uuid, p_outcome text) returns public.class_notes`
  - Test fixture table `fx` with keys `prof a b d class set group proj board outsider other_board`. The last two can be null.

- [ ] **Step 1: Write the failing test file**

Create `supabase/tests/class-notes.test.sql`:

```sql
-- Intervention notes — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/class-notes.test.sql
--
-- Every refusal is paired with a control that succeeds.

begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 58);
      return;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

create or replace function pg_temp.must_allow(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS  %', p_label;
exception
  when others then
    raise exception 'FAIL  % — refused with: %', p_label, sqlerrm;
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

-- ---------------------------------------------------------------- fixture

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_d uuid;
  v_set uuid; v_g uuid; v_proj uuid; v_board uuid; v_outsider uuid; v_other_board uuid;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where c.archived_at is null
     and (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 2
     and (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 3
   order by c.created_at
   limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 0 limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 1 limit 1;
  select student_id into v_d from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 2 limit 1;
  select p.id into v_outsider from public.profiles p
   where p.role = 'student'
     and not exists (select 1 from public.class_members m where m.class_id = v_class and m.student_id = p.id)
   limit 1;
  select b.id into v_other_board from public.project_boards b
    join public.projects p on p.id = b.project_id
   where p.class_id <> v_class
   limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-notes-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'zz-notes-group') returning id into v_g;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_g, v_set, v_a), (v_g, v_set, v_b);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-notes-proj', 'activity', 1, 2, 'group', v_set, now() + interval '5 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_g;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert, update on fx to authenticated;
  insert into fx values
    ('prof', v_prof), ('a', v_a), ('b', v_b), ('d', v_d), ('class', v_class),
    ('set', v_set), ('group', v_g), ('proj', v_proj), ('board', v_board),
    ('outsider', v_outsider), ('other_board', v_other_board);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------ writing (Task 1)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_class uuid := (select v from fx where k='class');
  v_board uuid := (select v from fx where k='board');
  v_outsider uuid := (select v from fx where k='outsider');
  v_other_board uuid := (select v from fx where k='other_board');
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot add a note',
    format('select public.add_class_note(%L, %L, null, ''note'', ''zz-mine'', null)', v_class, v_a));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor records a meeting with a student, with a follow-up date',
    format('select public.add_class_note(%L, %L, null, ''meeting'', ''zz-talked about the late tasks'', current_date + 3)',
           v_class, v_a));
  perform pg_temp.must_allow('and a note on a group',
    format('select public.add_class_note(%L, null, %L, ''note'', ''zz-group split the work again'', null)',
           v_class, v_board));
  perform pg_temp.must_refuse('a note needs a student or a group',
    format('select public.add_class_note(%L, null, null, ''note'', ''zz-about nobody'', null)', v_class));
  perform pg_temp.must_refuse('a note needs words',
    format('select public.add_class_note(%L, %L, null, ''note'', ''   '', null)', v_class, v_a));
  perform pg_temp.must_refuse('a note stays under 2000 characters',
    format('select public.add_class_note(%L, %L, null, ''note'', %L, null)', v_class, v_a, repeat('x', 2001)));
  perform pg_temp.must_refuse('reminders are logged by sending them, not by hand',
    format('select public.add_class_note(%L, %L, null, ''nudge'', ''zz-fake'', null)', v_class, v_a));
  perform pg_temp.must_refuse('the professor cannot write the table directly',
    format('insert into public.class_notes (class_id, student_id, kind, body) values (%L, %L, ''note'', ''zz-direct'')',
           v_class, v_a));
  if v_outsider is not null then
    perform pg_temp.must_refuse('a student from another class is refused',
      format('select public.add_class_note(%L, %L, null, ''note'', ''zz-outsider'', null)', v_class, v_outsider));
  else
    raise notice 'skipped: no student outside the fixture class';
  end if;
  if v_other_board is not null then
    perform pg_temp.must_refuse('a board from another class is refused',
      format('select public.add_class_note(%L, null, %L, ''note'', ''zz-elsewhere'', null)', v_class, v_other_board));
  else
    raise notice 'skipped: no board in another class';
  end if;
end $$;

-- ------------------------------------------------------ reading (Task 1)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_class uuid := (select v from fx where k='class');
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a student reads no note, even one about them',
    (select count(*) from public.class_notes where class_id = v_class) = 0);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('the professor reads both notes',
    (select count(*) from public.class_notes where class_id = v_class and body like 'zz-%') = 2);
  perform pg_temp.must_be('each note records who wrote it',
    (select bool_and(created_by = v_prof) from public.class_notes where class_id = v_class and body like 'zz-%'));
end $$;

-- ---------------------------------------------------- resolving (Task 1)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_class uuid := (select v from fx where k='class');
  v_note uuid;
begin
  perform pg_temp.act_as_service();
  select id into v_note from public.class_notes where body = 'zz-talked about the late tasks';

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot resolve a note',
    format('select public.resolve_class_note(%L, ''zz-done'')', v_note));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('an outcome stays under 1000 characters',
    format('select public.resolve_class_note(%L, %L)', v_note, repeat('x', 1001)));
  perform pg_temp.must_allow('the professor resolves it with an outcome',
    format('select public.resolve_class_note(%L, ''  zz-they caught up  '')', v_note));
  perform pg_temp.must_be('it is resolved, with the outcome trimmed',
    exists (select 1 from public.class_notes
             where id = v_note and resolved_at is not null and outcome = 'zz-they caught up'));
  perform pg_temp.must_refuse('a resolved note stays resolved',
    format('select public.resolve_class_note(%L, '''')', v_note));

  -- No delete policy: a delete runs and removes nothing.
  execute format('delete from public.class_notes where id = %L', v_note);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('nobody deletes a note', exists (select 1 from public.class_notes where id = v_note));

  update public.classes set archived_at = now() where id = v_class;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('an archived class takes no new notes',
    format('select public.add_class_note(%L, %L, null, ''note'', ''zz-late'', null)', v_class, v_a));
  perform pg_temp.act_as_service();
  update public.classes set archived_at = null where id = v_class;
end $$;

-- ================================================= Task 2 appends below here

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/db.mjs supabase/tests/class-notes.test.sql`
Expected: FAIL at the first writing block with `function public.add_class_note(...) does not exist` (shown as a FAIL from `must_allow`).

- [ ] **Step 3: Write `supabase/class-notes.sql`**

```sql
-- Collabify — intervention notes: what the teaching staff saw and did, kept as a record.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/class-notes.sql
-- Requires: classes.sql, groups.sql, projects.sql, tasks.sql (project_boards),
-- one-workplace.sql (is_class_professor with co-teachers).
-- Re-run supabase/anon-lockdown.sql afterwards.

/**
 * Analytics raises a flag; the professor talks to the student; then what? The
 * conversation lived nowhere, so next week's flag looked brand new and an
 * accreditation visit could not see that anybody acted.
 *
 * A note is the professor's own record: a meeting, a follow-up, or a plain
 * note, about one student or one group. Reminders the professor sends are
 * logged here automatically (nudge_board, remind_peer_round), and their
 * once-a-day limits read this log, because students can delete their
 * notifications and the old limit counted those.
 *
 * Staff only, in both directions. A student never reads a note, not even one
 * about themselves. A note is never deleted: it is resolved, with an outcome.
 */

begin;

do $$ begin
  create type public.class_note_kind as enum ('note', 'nudge', 'meeting', 'follow_up', 'peer_reminder');
exception when duplicate_object then null; end $$;

create table if not exists public.class_notes (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes (id) on delete cascade,
  student_id   uuid references public.profiles (id) on delete cascade,
  board_id     uuid references public.project_boards (id) on delete cascade,
  kind         public.class_note_kind not null,
  body         text not null,
  follow_up_on date,
  resolved_at  timestamptz,
  outcome      text not null default '',
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  constraint class_notes_subject check (student_id is not null or board_id is not null),
  constraint class_notes_body_len check (char_length(btrim(body)) between 1 and 2000),
  constraint class_notes_outcome_len check (char_length(outcome) <= 1000)
);

create index if not exists class_notes_by_class on public.class_notes (class_id, created_at desc);
create index if not exists class_notes_by_student on public.class_notes (student_id) where student_id is not null;
create index if not exists class_notes_by_board on public.class_notes (board_id, kind, created_at desc)
  where board_id is not null;

-- ---------------------------------------------------------------- writing

/**
 * Add a note by hand. Reminders are not added here: nudge_board and
 * remind_peer_round log those when they actually send, so the log cannot claim
 * a reminder that never went out.
 */
create or replace function public.add_class_note(
  p_class     uuid,
  p_student   uuid,
  p_board     uuid,
  p_kind      public.class_note_kind,
  p_body      text,
  p_follow_up date
) returns public.class_notes
language plpgsql security definer set search_path = public as $$
declare
  c    public.classes%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  n    public.class_notes%rowtype;
begin
  select * into c from public.classes where id = p_class;
  if c.id is null then
    raise exception 'That class no longer exists';
  end if;
  if not public.is_class_professor(p_class) then
    raise exception 'Only someone teaching this class can add a note'
      using errcode = 'insufficient_privilege';
  end if;
  if c.archived_at is not null then
    raise exception 'That class is archived. Restore it to add notes'
      using errcode = 'check_violation';
  end if;
  if p_kind not in ('note', 'meeting', 'follow_up') then
    raise exception 'Reminders are logged when you send them. Choose note, meeting or follow-up'
      using errcode = 'check_violation';
  end if;
  if p_student is null and p_board is null then
    raise exception 'Say who the note is about: a student or a group'
      using errcode = 'check_violation';
  end if;
  if v_body = '' then
    raise exception 'Write the note before saving it'
      using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'Keep the note under 2000 characters'
      using errcode = 'check_violation';
  end if;
  if p_student is not null and not exists (
    select 1 from public.class_members m where m.class_id = p_class and m.student_id = p_student
  ) then
    raise exception 'That student is not in this class'
      using errcode = 'check_violation';
  end if;
  if p_board is not null and not exists (
    select 1 from public.project_boards b
      join public.projects p on p.id = b.project_id
     where b.id = p_board and p.class_id = p_class
  ) then
    raise exception 'That group is not on a project in this class'
      using errcode = 'check_violation';
  end if;

  insert into public.class_notes (class_id, student_id, board_id, kind, body, follow_up_on)
  values (p_class, p_student, p_board, p_kind, v_body, p_follow_up)
  returning * into n;
  return n;
end;
$$;

/** Close a note with what came of it. Once resolved, it stays resolved. */
create or replace function public.resolve_class_note(p_note uuid, p_outcome text)
returns public.class_notes
language plpgsql security definer set search_path = public as $$
declare
  n       public.class_notes%rowtype;
  v_outcome text := btrim(coalesce(p_outcome, ''));
begin
  select * into n from public.class_notes where id = p_note for update;
  if n.id is null then
    raise exception 'That note no longer exists';
  end if;
  if not public.is_class_professor(n.class_id) then
    raise exception 'Only someone teaching this class can resolve a note'
      using errcode = 'insufficient_privilege';
  end if;
  if n.resolved_at is not null then
    raise exception 'That note is already resolved. Add a new note instead'
      using errcode = 'check_violation';
  end if;
  if char_length(v_outcome) > 1000 then
    raise exception 'Keep the outcome under 1000 characters'
      using errcode = 'check_violation';
  end if;

  update public.class_notes
     set resolved_at = clock_timestamp(), outcome = v_outcome
   where id = p_note
  returning * into n;
  return n;
end;
$$;

-- ---------------------------------------------------------------- policies

alter table public.class_notes enable row level security;

-- Teaching staff of the class, and nobody else: not the student, not an admin
-- who does not teach it.
drop policy if exists class_notes_select on public.class_notes;
create policy class_notes_select on public.class_notes
  for select using (public.is_class_professor(class_id));

-- Anon gets nothing here, inline, so a rebuild that runs this file after
-- anon-lockdown.sql stays locked down.
revoke all on public.class_notes from anon;
grant select on public.class_notes to authenticated;

revoke all on function public.add_class_note(uuid, uuid, uuid, public.class_note_kind, text, date) from public, anon;
revoke all on function public.resolve_class_note(uuid, text) from public, anon;
grant execute on function public.add_class_note(uuid, uuid, uuid, public.class_note_kind, text, date) to authenticated;
grant execute on function public.resolve_class_note(uuid, text) to authenticated;

-- ---------------------------------------------------------------- realtime

-- Listed here, not in live.sql: live.sql runs earlier in a rebuild.
do $$
begin
  begin
    alter publication supabase_realtime add table public.class_notes;
  exception
    when duplicate_object then null;
    when undefined_object then null;   -- no realtime publication on this database
  end;
  alter table public.class_notes replica identity full;
end $$;

commit;
```

- [ ] **Step 4: Apply and run the tests**

```bash
node scripts/db.mjs supabase/class-notes.sql
node scripts/db.mjs supabase/anon-lockdown.sql
node scripts/db.mjs supabase/tests/class-notes.test.sql
node scripts/db.mjs supabase/tests/rls-coverage.test.sql
node scripts/db.mjs supabase/tests/anon-lockdown.test.sql
```
Expected: all `PASS`, no exception.

- [ ] **Step 5: Rebuild order**

In `scripts/schema-drift.mjs`, change the end of the ORDER string from `peer-evaluation scoring\`` to `peer-evaluation scoring class-notes\``.

In `docs/07-backup.md`, append ` supabase/class-notes.sql` to the end of the command lines at lines 26 and 53. After the paragraph that begins `` `scoring.sql` runs after ``, add:

```markdown
`class-notes.sql` runs after `scoring.sql`. `nudge_board` (`automation.sql`) and
`remind_peer_round` (`peer-evaluation.sql`) write to `class_notes` and read it for their daily
limits. Those plpgsql bodies resolve the table at run time, so their files still load first.
Re-run `anon-lockdown.sql` after it.
```

Run: `node scripts/schema-drift.mjs`. Expected: no drift that names `class-notes.sql`. CHECK hints on objects that already existed before this task are known.

- [ ] **Step 6: Commit**

```bash
git add supabase/class-notes.sql supabase/tests/class-notes.test.sql scripts/schema-drift.mjs docs/07-backup.md
git commit -m "Add a staff-only notes log for students and groups"
```

---

### Task 2: Reminders write to the log, and their limits read it

**Files:**
- Modify: `supabase/automation.sql:141-210` (`nudge_board`)
- Modify: `supabase/peer-evaluation.sql:254-333` (the comment and body of `remind_peer_round`)
- Modify: `supabase/tests/automation.test.sql:233-234` (the handed-in check)
- Modify: `supabase/tests/class-notes.test.sql` (insert at the Task 2 marker)

**Interfaces:**
- Consumes: `public.class_notes` and `public.class_note_kind` (Task 1).
- Produces:
  - `nudge_board(p_board uuid, p_note text default null) returns integer`. Same signature as today. It writes one `class_notes` row: kind `nudge`, `board_id`, body = the note or `Reminder sent`.
  - `remind_peer_round(p_round uuid) returns integer`. Same signature. It writes one `peer_reminder` note per board reached.

- [ ] **Step 1: Write the failing tests**

Insert at the Task 2 marker in `supabase/tests/class-notes.test.sql`:

```sql
-- ------------------------------------------------ a nudge is logged (Task 2)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_proj uuid := (select v from fx where k='proj');
  v_board uuid := (select v from fx where k='board');
  n int;
begin
  perform pg_temp.act_as(v_prof);
  n := public.nudge_board(v_board, '  zz-Show me a draft by Friday.  ');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the nudge reached the group', n = 2);
  perform pg_temp.must_be('and is logged as a note on the board, by the professor',
    exists (select 1 from public.class_notes
             where board_id = v_board and kind = 'nudge'
               and body = 'zz-Show me a draft by Friday.' and created_by = v_prof));

  -- The students clear their notifications.
  delete from public.notifications where project_id = v_proj and type = 'nudge';
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('the daily limit holds after the students delete the notification',
    format('select public.nudge_board(%L, null)', v_board));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('students still cannot read the log',
    (select count(*) from public.class_notes where board_id = v_board) = 0);
end $$;

-- ------------------------------------------ a peer reminder is logged (Task 2)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_proj uuid := (select v from fx where k='proj');
  v_board uuid := (select v from fx where k='board');
  v_round uuid;
  n int;
begin
  perform pg_temp.act_as(v_prof);
  perform public.open_peer_round(v_proj, 'check_in', now() + interval '2 days');
  select id into v_round from public.peer_rounds where project_id = v_proj;
  n := public.remind_peer_round(v_round);
  perform pg_temp.must_be('the reminder reached both students who have not rated', n = 2);

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('and is logged once for the board, saying how many',
    (select count(*) from public.class_notes
      where board_id = v_board and kind = 'peer_reminder'
        and body = 'Reminded 2 students to rate their teammates') = 1);

  delete from public.notifications where project_id = v_proj and type = 'peer_round_reminder';
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('the peer reminder limit holds after the notifications are deleted',
    format('select public.remind_peer_round(%L)', v_round));
end $$;
```

In `supabase/tests/automation.test.sql`, in the nudge block, right after the line `delete from public.notifications where user_id = v_a and type = 'nudge';`, add:

```sql
  -- The daily limit now reads the professor's log, so clear that too: this
  -- check is about handed-in work, not the limit.
  delete from public.class_notes where board_id = v_board and kind = 'nudge';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/db.mjs supabase/tests/class-notes.test.sql`
Expected: FAIL at `and is logged as a note on the board, by the professor`.

- [ ] **Step 3: Log the nudge and read the log for its limit**

In `supabase/automation.sql`, in `nudge_board`, replace the limit block:

```sql
  if exists (
    select 1 from public.notifications n
     where n.user_id = any (recipients)
       and n.type = 'nudge'
       and n.project_id = proj.id
       and n.created_at > now() - interval '20 hours'
  ) then
    raise exception 'They were reminded today already. Try again tomorrow'
      using errcode = 'check_violation';
  end if;
```

with:

```sql
  -- Once a day per board, counted from the professor's own log (class-notes.sql).
  -- Students can delete their notifications, so counting those let the limit slip.
  if exists (
    select 1 from public.class_notes cn
     where cn.board_id = p_board
       and cn.kind = 'nudge'
       and cn.created_at > now() - interval '20 hours'
  ) then
    raise exception 'They were reminded today already. Try again tomorrow'
      using errcode = 'check_violation';
  end if;
```

and, directly after `get diagnostics sent = row_count;`, add:

```sql
  insert into public.class_notes (class_id, board_id, kind, body)
  values (proj.class_id, p_board, 'nudge', coalesce(note, 'Reminder sent'));
```

- [ ] **Step 4: Log the peer reminder and read the log for its limit**

In `supabase/peer-evaluation.sql`, replace the doc comment above `remind_peer_round`:

```sql
/**
 * Remind the students who have not rated everyone yet. Once a day per project:
 * counted from the reminders already sent, as nudge_board does. Phase C3 moves
 * this count to the professor's notes log, which students cannot delete.
 */
```

with:

```sql
/**
 * Remind the students who have not rated everyone yet. Once a day per project,
 * counted from the professor's notes log (class-notes.sql), which students
 * cannot delete. Each board reached gets one 'peer_reminder' note.
 */
```

Replace its limit block (the `if exists (select 1 from public.notifications n where n.type = 'peer_round_reminder' …) then raise … end if;`) with:

```sql
  -- Once a day per round: only reminders logged since this round opened count.
  if exists (
    select 1 from public.class_notes cn
      join public.project_boards b on b.id = cn.board_id
     where cn.kind = 'peer_reminder'
       and b.project_id = proj.id
       and cn.created_at > r.opens_at
       and cn.created_at > now() - interval '20 hours'
  ) then
    raise exception 'You already sent a reminder today. Try again tomorrow.'
      using errcode = 'check_violation';
  end if;
```

Replace the whole notification `insert … ;` statement and the `get diagnostics sent = row_count;` line after it (from `-- Stamped with the clock, …` through `get diagnostics sent = row_count;`) with:

```sql
  -- Stamped with the clock, not the transaction start, so the daily count lines up
  -- with opens_at (also a clock time).
  with recipients as (
    select t.board_id, t.group_id, t.student_id
      from (
        select b.id as board_id, b.group_id, gm.student_id
          from public.project_boards b
          join public.groups g on g.id = b.group_id and g.archived_at is null
          join public.group_members gm on gm.group_id = b.group_id
         where b.project_id = proj.id
      ) t
      join (
        select b.id as board_id, count(*) as n
          from public.project_boards b
          join public.groups g on g.id = b.group_id and g.archived_at is null
          join public.group_members gm on gm.group_id = b.group_id
         where b.project_id = proj.id
         group by b.id
      ) s on s.board_id = t.board_id
      left join (
        select pr.rater_id, pr.board_id, count(*) as n
          from public.peer_ratings pr
          join public.project_boards b on b.id = pr.board_id
          join public.groups g on g.id = b.group_id and g.archived_at is null
          join public.group_members gm on gm.group_id = b.group_id and gm.student_id = pr.ratee_id
         where pr.round_id = p_round
         group by pr.rater_id, pr.board_id
      ) d on d.rater_id = t.student_id and d.board_id = t.board_id
     where s.n > 1 and coalesce(d.n, 0) < s.n
  ),
  notified as (
    insert into public.notifications (user_id, type, class_id, project_id, group_id, title, preview, created_at)
    select x.student_id, 'peer_round_reminder', proj.class_id, proj.id, x.group_id,
           'Reminder: ' || proj.title,
           'Rate your teammates before '
             || to_char(r.closes_at at time zone 'Asia/Manila', 'Mon FMDD, FMHH12:MI AM'),
           clock_timestamp()
      from recipients x
    returning user_id
  ),
  logged as (
    insert into public.class_notes (class_id, board_id, kind, body, created_at)
    select proj.class_id, x.board_id, 'peer_reminder',
           'Reminded ' || case when count(*) = 1 then '1 student' else count(*) || ' students' end
             || ' to rate their teammates',
           clock_timestamp()
      from recipients x
     group by x.board_id
    returning 1
  )
  select count(*) into sent from notified;
```

`logged` is never read. Postgres still runs every data-modifying CTE, which is how the notes get written.

- [ ] **Step 5: Apply and run every affected test**

```bash
node scripts/db.mjs supabase/automation.sql
node scripts/db.mjs supabase/peer-evaluation.sql
node scripts/db.mjs supabase/anon-lockdown.sql
node scripts/db.mjs supabase/tests/class-notes.test.sql
node scripts/db.mjs supabase/tests/automation.test.sql
node scripts/db.mjs supabase/tests/peer-evaluation.test.sql
node scripts/db.mjs supabase/tests/scoring.test.sql
node scripts/db.mjs supabase/tests/anon-lockdown.test.sql
```
Expected: no `FAIL`. Re-running `peer-evaluation.sql` drops and recreates its three views. Nothing depends on them (scoring.sql uses string-bodied functions), so it succeeds.

Before applying `automation.sql`, check it is safe to re-run. Read its header, and grep `docs/07-backup.md` for notes on it. If either says a later file redefines one of its functions, apply only the `create or replace function public.nudge_board …` statement. Put it in a scratch `.sql` file wrapped in `begin; … commit;`, with any grant/revoke lines for it, and run that instead of the whole file. Say which you did in the report.

- [ ] **Step 6: Commit**

```bash
git add supabase/automation.sql supabase/peer-evaluation.sql supabase/tests/automation.test.sql supabase/tests/class-notes.test.sql
git commit -m "Log reminders in the notes and count the daily limit from the log"
```

---

### Task 3: Notes in TypeScript and follow-ups that fall due

**Files:**
- Modify: `src/lib/types.ts` (add after the scoring types, e.g. after `MyGrade`)
- Create: `src/lib/api/notes.ts`
- Create: `src/lib/notes.ts`
- Create: `src/lib/notes.test.ts`
- Modify: `src/lib/insight.ts` (the `ActionKind` union at ~line 92, the `Action` type at ~line 124, `sentence()` at ~line 322, `rankActions` at ~line 441)
- Modify: `src/lib/analyticsView.ts` and `src/lib/analyticsView.test.ts`
- Modify: `src/pages/app/analytics/useAnalytics.ts`

**Interfaces:**
- Consumes: Task 1's table and RPCs; `pageAll` (`src/lib/api/paging.ts`); `Tone` (`src/lib/analyticsMath.ts`); `manilaDay` (`src/lib/analyticsMath.ts`).
- Produces:
  - `type ClassNoteKind = 'note' | 'nudge' | 'meeting' | 'follow_up' | 'peer_reminder'`
  - `type ClassNote = { id, class_id, student_id: string | null, board_id: string | null, kind: ClassNoteKind, body, follow_up_on: string | null, resolved_at: string | null, outcome: string, created_by: string | null, created_at: string }`
  - `listClassNotes(): Promise<ClassNote[]>`
  - `addClassNote(input: NewClassNote): Promise<void>`, with `type NewClassNote = { classId: string; studentId: string | null; boardId: string | null; kind: AddableNoteKind; body: string; followUpOn: string | null }`
  - `resolveClassNote(noteId: string, outcome: string): Promise<void>`
  - `NOTE_KIND_META: Record<ClassNoteKind, { label: string; tone: Tone }>`
  - `ADDABLE_KINDS: readonly ['note', 'meeting', 'follow_up']` and `type AddableNoteKind`
  - `notesAbout(notes: ClassNote[], about: { classId: string; studentId?: string | null; boardIds?: string[] }): ClassNote[]`, newest first
  - `followUpActions(notes: ClassNote[], today: string, nameOf: (n: ClassNote) => string): Action[]`
  - `ActionKind` gains `'follow_up_due'`. `Action` gains `studentId?: string | null`. `rankActions(rows, burns, extra?: Action[])`.
  - `useAnalytics` returns `notes: ClassNote[]` and `reloadNotes: () => Promise<void>`. Its `actions` include follow-ups.

- [ ] **Step 1: Write the failing unit tests**

Create `src/lib/notes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { followUpActions, notesAbout } from './notes'
import type { ClassNote } from './types'

const note = (over: Partial<ClassNote> & { id: string }): ClassNote => ({
  class_id: 'c1', student_id: null, board_id: null, kind: 'note', body: 'zz',
  follow_up_on: null, resolved_at: null, outcome: '', created_by: 'p',
  created_at: '2026-10-10T02:00:00Z', ...over,
})

describe('followUpActions', () => {
  const name = (n: ClassNote) => (n.student_id === 's1' ? 'Ana Cruz' : 'Group 1')

  it('raises a follow-up that is due today, as a Manila day', () => {
    const out = followUpActions(
      [note({ id: 'n1', student_id: 's1', kind: 'follow_up', follow_up_on: '2026-10-14', body: 'Check the draft' })],
      '2026-10-14',
      name,
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      key: 'follow_up_due-n1', kind: 'follow_up_due', severity: 2,
      title: 'Follow up with Ana Cruz', classId: 'c1', studentId: 's1', boardId: null, to: null,
    })
    expect(out[0].evidence).toContain('Check the draft')
  })

  it('raises one that is overdue', () => {
    expect(followUpActions([note({ id: 'n2', student_id: 's1', follow_up_on: '2026-10-01' })], '2026-10-14', name)).toHaveLength(1)
  })

  it('skips one due later, one resolved, and one with no date', () => {
    expect(
      followUpActions(
        [
          note({ id: 'n3', student_id: 's1', follow_up_on: '2026-10-15' }),
          note({ id: 'n4', student_id: 's1', follow_up_on: '2026-10-01', resolved_at: '2026-10-02T00:00:00Z' }),
          note({ id: 'n5', student_id: 's1' }),
        ],
        '2026-10-14',
        name,
      ),
    ).toEqual([])
  })

  it('names a group for a note on a board', () => {
    const out = followUpActions([note({ id: 'n6', board_id: 'b1', follow_up_on: '2026-10-14' })], '2026-10-14', name)
    expect(out[0]).toMatchObject({ title: 'Follow up with Group 1', boardId: 'b1', studentId: null })
  })
})

describe('notesAbout', () => {
  const notes = [
    note({ id: 'old', student_id: 's1', created_at: '2026-10-01T00:00:00Z' }),
    note({ id: 'board', board_id: 'b1', created_at: '2026-10-05T00:00:00Z' }),
    note({ id: 'new', student_id: 's1', created_at: '2026-10-09T00:00:00Z' }),
    note({ id: 'other', student_id: 's2', created_at: '2026-10-09T00:00:00Z' }),
    note({ id: 'elsewhere', student_id: 's1', class_id: 'c2', created_at: '2026-10-09T00:00:00Z' }),
  ]

  it('gives a student their notes and their boards’ notes, newest first', () => {
    expect(notesAbout(notes, { classId: 'c1', studentId: 's1', boardIds: ['b1'] }).map((n) => n.id)).toEqual([
      'new', 'board', 'old',
    ])
  })

  it('gives a board only its own notes', () => {
    expect(notesAbout(notes, { classId: 'c1', boardIds: ['b1'] }).map((n) => n.id)).toEqual(['board'])
  })
})
```

In `src/lib/analyticsView.test.ts`, add inside `describe('viewForAction', …)`:

```ts
  it('sends a follow-up to Students', () => {
    expect(viewForAction('follow_up_due')).toBe('students')
  })
```

Run: `npx vitest run src/lib/notes.test.ts src/lib/analyticsView.test.ts`
Expected: FAIL (`Failed to resolve import "./notes"`).

- [ ] **Step 2: Types and API**

In `src/lib/types.ts`, add:

```ts
export type ClassNoteKind = 'note' | 'nudge' | 'meeting' | 'follow_up' | 'peer_reminder'

/** class_notes: what the teaching staff noted or did. Staff only. */
export type ClassNote = {
  id: string
  class_id: string
  student_id: string | null
  board_id: string | null
  kind: ClassNoteKind
  body: string
  /** A Manila day, YYYY-MM-DD. */
  follow_up_on: string | null
  resolved_at: string | null
  outcome: string
  created_by: string | null
  created_at: string
}
```

Create `src/lib/api/notes.ts`:

```ts
import { supabase } from '../supabase'
import { pageAll } from './paging'
import type { AddableNoteKind } from '../notes'
import type { ClassNote } from '../types'

export type NewClassNote = {
  classId: string
  studentId: string | null
  boardId: string | null
  kind: AddableNoteKind
  body: string
  /** YYYY-MM-DD, or null for no follow-up. */
  followUpOn: string | null
}

/** Every note the professor can read, newest first. Paged: a long term passes a thousand. */
export async function listClassNotes() {
  return pageAll<ClassNote>(async (from, to) => {
    const { data, error } = await supabase
      .from('class_notes')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as ClassNote[]
  })
}

export async function addClassNote(input: NewClassNote) {
  const { error } = await supabase.rpc('add_class_note', {
    p_class: input.classId,
    p_student: input.studentId,
    p_board: input.boardId,
    p_kind: input.kind,
    p_body: input.body,
    p_follow_up: input.followUpOn,
  })
  if (error) throw error
}

export async function resolveClassNote(noteId: string, outcome: string) {
  const { error } = await supabase.rpc('resolve_class_note', { p_note: noteId, p_outcome: outcome })
  if (error) throw error
}
```

- [ ] **Step 3: Write `src/lib/notes.ts`**

```ts
import type { Tone } from './analyticsMath'
import type { Action } from './insight'
import type { ClassNote, ClassNoteKind } from './types'

export const NOTE_KIND_META: Record<ClassNoteKind, { label: string; tone: Tone }> = {
  note: { label: 'Note', tone: 'pending' },
  meeting: { label: 'Meeting', tone: 'success' },
  follow_up: { label: 'Follow-up', tone: 'warning' },
  nudge: { label: 'Reminder', tone: 'pending' },
  peer_reminder: { label: 'Peer reminder', tone: 'pending' },
}

/** What a professor can add by hand. Reminders are logged when they are sent. */
export const ADDABLE_KINDS = ['note', 'meeting', 'follow_up'] as const
export type AddableNoteKind = (typeof ADDABLE_KINDS)[number]

/** A student's notes and their boards' notes, or one board's, newest first. */
export function notesAbout(
  notes: ClassNote[],
  about: { classId: string; studentId?: string | null; boardIds?: string[] },
): ClassNote[] {
  const boards = new Set(about.boardIds ?? [])
  return notes
    .filter((n) => n.class_id === about.classId)
    .filter(
      (n) =>
        (about.studentId ? n.student_id === about.studentId : false) ||
        (n.board_id !== null && boards.has(n.board_id) && (!about.studentId || n.student_id === null || n.student_id === about.studentId)),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

const dayFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })

/**
 * Open notes whose follow-up date has come, as Needs attention cards. `today`
 * is a Manila day (YYYY-MM-DD), compared as a string with follow_up_on.
 */
export function followUpActions(notes: ClassNote[], today: string, nameOf: (n: ClassNote) => string): Action[] {
  return notes
    .filter((n) => !n.resolved_at && n.follow_up_on !== null && n.follow_up_on <= today)
    .map((n) => ({
      key: `follow_up_due-${n.id}`,
      kind: 'follow_up_due' as const,
      severity: 2,
      title: `Follow up with ${nameOf(n)}`,
      evidence: `Due ${dayFmt.format(new Date(`${n.follow_up_on}T00:00:00+08:00`))}. You noted: ${n.body}`,
      to: null,
      classId: n.class_id,
      boardId: n.board_id,
      projectId: null,
      studentId: n.student_id,
    }))
}
```

- [ ] **Step 4: Teach `insight.ts` and `analyticsView.ts` the new kind**

In `src/lib/insight.ts`:
- Add to the `ActionKind` union, after `'will_miss_deadline'`:
  ```ts
    /** Composed from class_notes in lib/notes.ts: a follow-up date has come. */
    | 'follow_up_due'
  ```
- Add to the `Action` type, after `projectId: string | null`:
  ```ts
    /** Set when the card is about one student, so "See why" can open their record. */
    studentId?: string | null
  ```
- In `sentence()`, after the `will_miss_deadline` case, add:
  ```ts
      case 'follow_up_due':
        return { title: `Follow up with ${who}`, evidence: '' }
  ```
- Change the signature `export function rankActions(rows: ActionRow[], burns: BoardBurn[]): Action[] {` to `export function rankActions(rows: ActionRow[], burns: BoardBurn[], extra: Action[] = []): Action[] {`, and the final return to `return [...projected, ...single, ...groups, ...extra].sort(`. The comparator stays the same.

In `src/lib/analyticsView.ts`, add `follow_up_due: 'students',` to `VIEW_FOR`.

- [ ] **Step 5: Load notes in `useAnalytics`**

In `src/pages/app/analytics/useAnalytics.ts`:
- Import `listClassNotes` from `'../../../lib/api/notes'`, `followUpActions` from `'../../../lib/notes'`, `ClassNote` from `'../../../lib/types'`, and `manilaDay` from `'../../../lib/analyticsMath'` if not already imported.
- Add state and a separate loader after the other `useState` lines. Notes load on their own, so adding one does not rerun the slow analytics load:

```ts
  const [notes, setNotes] = useState<ClassNote[]>([])
  const reloadNotes = useCallback(async () => {
    try {
      setNotes(await listClassNotes())
    } catch {
      // The notes are an extra; the page still answers without them.
    }
  }, [])
  useEffect(() => {
    void reloadNotes()
  }, [reloadNotes])
  useLive(reloadNotes, ['class_notes'])
```

- Change the `actions` memo to merge in follow-ups, narrowed like everything else:

```ts
  const actions = useMemo(() => {
    const rows = actionRows
      .filter((a) => (scope.classId ? a.class_id === scope.classId : true))
      // Below a class, a recommendation about the class itself — a syllabus
      // week, a missing term — is no longer an answer to the question asked.
      .filter((a) => (scope.projectId ? a.project_id === scope.projectId : true))
      .filter((a) => (scope.boardId ? a.board_id === scope.boardId : true))
      .filter((a) =>
        scope.studentId ? a.student_id === scope.studentId || boardsInView.has(a.board_id ?? '') : true,
      )
    const names = new Map(roster.map((r) => [`${r.class_id}:${r.student_id}`, r.student_name]))
    const boardNames = new Map(burns.map((b) => [b.board_id, b.group_name ?? b.student_name ?? 'A group']))
    const due = notes
      .filter((n) => (scope.classId ? n.class_id === scope.classId : true))
      .filter((n) => (scope.boardId ? n.board_id === scope.boardId : true))
      .filter((n) => (scope.studentId ? n.student_id === scope.studentId || boardsInView.has(n.board_id ?? '') : true))
    const followUps = followUpActions(due, manilaDay(new Date()), (n) =>
      n.student_id
        ? names.get(`${n.class_id}:${n.student_id}`) ?? 'a student'
        : boardNames.get(n.board_id ?? '') ?? 'a group',
    )
    return rankActions(rows, shownBurns, followUps)
  }, [actionRows, scope, shownBurns, boardsInView, notes, roster, burns])
```

  Check the state names first. The roster state is called `roster` and the burn state `burns`; if they differ, use the real names.
- Add `notes,` and `reloadNotes,` to the returned object, next to `shownPeer`.

- [ ] **Step 6: Run the tests, the build and lint**

Run: `npx vitest run`, then `npm run build`, then `npx eslint src`.
Expected: all clean, including the new `notes.test.ts` and `analyticsView.test.ts` cases. If the purity lint rejects `new Date()` inside the memo, compute `const today = manilaDay(new Date(useNow()))` at the top of the hook (`useNow` is in `src/hooks/useNow.ts`) and use `today` instead.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/api/notes.ts src/lib/notes.ts src/lib/notes.test.ts src/lib/insight.ts src/lib/analyticsView.ts src/lib/analyticsView.test.ts src/pages/app/analytics/useAnalytics.ts
git commit -m "Load notes in Analytics and raise follow-ups that fall due"
```

---

### Task 4: Notes in the drawer and the Groups view, and "See why" opens them

**Files:**
- Create: `src/components/analytics/NotesPanel.tsx`
- Modify: `src/components/analytics/StudentDrawer.tsx` (a Notes section before the reminder footer)
- Modify: `src/pages/app/analytics/views/GroupsView.tsx` (inside each `groupBoards.map` card of "Who holds the work")
- Modify: `src/pages/app/analytics/views/StudentsView.tsx:78` (privacy line)
- Modify: `src/pages/app/analytics/Analytics.tsx` (the `onSeeWhy` handler)

**Interfaces:**
- Consumes: `addClassNote`, `resolveClassNote` and `NewClassNote` (Task 3); `NOTE_KIND_META`, `ADDABLE_KINDS`, `AddableNoteKind` and `notesAbout` (Task 3); `data.notes` and `data.reloadNotes` from `useAnalytics` (Task 3); `TONE_CELL`; `useNow`; `manilaDay`.
- Produces: `NotesPanel({ classId, studentId, boardId, notes, onChanged })`.

- [ ] **Step 1: Write the panel**

Create `src/components/analytics/NotesPanel.tsx`:

```tsx
import { useId, useState } from 'react'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { TONE_CELL } from '../charts/format'
import { useNow } from '../../hooks/useNow'
import { manilaDay } from '../../lib/analyticsMath'
import { addClassNote, resolveClassNote } from '../../lib/api/notes'
import { authErrorMessage } from '../../lib/authError'
import { ADDABLE_KINDS, NOTE_KIND_META } from '../../lib/notes'
import type { AddableNoteKind } from '../../lib/notes'
import type { ClassNote } from '../../lib/types'

const stampFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })
const dayFmt = (day: string) => stampFmt.format(new Date(`${day}T00:00:00+08:00`))
const field = 'rounded-lg border border-line surface px-2.5 text-[13px] text-ink'

/**
 * What the teaching staff noted and did about one student or one group, and a
 * place to add the next note. Only teaching staff ever see this.
 */
export function NotesPanel({
  classId,
  studentId = null,
  boardId = null,
  notes,
  onChanged,
}: {
  classId: string
  studentId?: string | null
  boardId?: string | null
  notes: ClassNote[]
  onChanged: () => Promise<void>
}) {
  const { show } = useToast()
  const ids = useId()
  const today = manilaDay(new Date(useNow()))
  const [kind, setKind] = useState<AddableNoteKind>('note')
  const [body, setBody] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [busy, setBusy] = useState(false)
  const [resolving, setResolving] = useState<string | null>(null)
  const [outcome, setOutcome] = useState('')

  const add = async () => {
    setBusy(true)
    try {
      await addClassNote({ classId, studentId, boardId, kind, body: body.trim(), followUpOn: followUp || null })
      await onChanged()
      setBody('')
      setFollowUp('')
      show('Note added')
    } catch (err) {
      show(authErrorMessage(err, 'Could not add the note. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const resolve = async (id: string) => {
    setBusy(true)
    try {
      await resolveClassNote(id, outcome.trim())
      await onChanged()
      setResolving(null)
      setOutcome('')
      show('Note resolved')
    } catch (err) {
      show(authErrorMessage(err, 'Could not resolve the note. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {notes.length === 0 ? (
        <p className="text-[13px] text-muted">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => {
            const meta = NOTE_KIND_META[n.kind]
            const due = !n.resolved_at && n.follow_up_on !== null && n.follow_up_on <= today
            return (
              <li key={n.id} className="space-y-1.5 rounded-xl border border-line p-3">
                <p className="flex flex-wrap items-center gap-2 text-[12px] text-faint">
                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[meta.tone]}`}>{meta.label}</span>
                  {stampFmt.format(new Date(n.created_at))}
                  {n.follow_up_on && !n.resolved_at && (
                    <span className={due ? 'text-warning-700 dark:text-warning-300' : ''}>
                      · Follow up by {dayFmt(n.follow_up_on)}
                    </span>
                  )}
                  {n.resolved_at && <span>· Resolved {stampFmt.format(new Date(n.resolved_at))}</span>}
                </p>
                <p className="whitespace-pre-wrap text-[13px] text-ink">{n.body}</p>
                {n.resolved_at && n.outcome && <p className="text-[13px] text-muted">Outcome: {n.outcome}</p>}
                {!n.resolved_at &&
                  (resolving === n.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={`${ids}-outcome-${n.id}`} className="sr-only">
                        Outcome
                      </label>
                      <input
                        id={`${ids}-outcome-${n.id}`}
                        value={outcome}
                        maxLength={1000}
                        placeholder="What came of it (optional)"
                        onChange={(e) => setOutcome(e.target.value)}
                        className={`${field} h-9 min-w-0 flex-1`}
                      />
                      <Button size="sm" disabled={busy} onClick={() => resolve(n.id)}>
                        Resolve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setResolving(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setResolving(n.id)
                        setOutcome('')
                      }}
                    >
                      Resolve…
                    </Button>
                  ))}
              </li>
            )
          })}
        </ul>
      )}

      <form
        className="space-y-2 rounded-xl surface-sunken p-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (body.trim()) void add()
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-[12px] text-muted">
            <span className="block">Kind</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AddableNoteKind)}
              className={`${field} h-9`}
            >
              {ADDABLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {NOTE_KIND_META[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[12px] text-muted">
            <span className="block">Follow up by (optional)</span>
            <input
              type="date"
              value={followUp}
              min={today}
              onChange={(e) => setFollowUp(e.target.value)}
              className={`${field} h-9`}
            />
          </label>
        </div>
        <label className="block space-y-1 text-[12px] text-muted">
          <span className="block">Note</span>
          <textarea
            value={body}
            maxLength={2000}
            rows={2}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What you saw, said or agreed"
            className={`${field} w-full py-2`}
          />
        </label>
        <div className="flex justify-end">
          <Button size="sm" type="submit" disabled={busy || !body.trim()}>
            Add note
          </Button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: The drawer's Notes section**

In `src/components/analytics/StudentDrawer.tsx`:
- Import `NotesPanel` from `'./NotesPanel'` and `notesAbout` from `'../../lib/notes'`.
- After the `mainBoard` computation, add:

```ts
  const myBoards = data.members
    .filter((m) => m.student_id === entry.student_id && m.class_id === entry.class_id)
    .map((m) => m.board_id)
  const myNotes = notesAbout(data.notes, { classId: entry.class_id, studentId: entry.student_id, boardIds: myBoards })
```

  Check that `data.members` rows carry `class_id`, `student_id` and `board_id`. The drawer already filters `data.shownMembers` on these fields, so the raw `members` has them too.
- Before the `{mainBoard && (` reminder footer, add:

```tsx
        <section className="space-y-2">
          <h4 className="text-ink">Notes</h4>
          <p className="text-[12px] text-faint">Only teaching staff read these, never the student.</p>
          <NotesPanel
            classId={entry.class_id}
            studentId={entry.student_id}
            notes={myNotes}
            onChanged={data.reloadNotes}
          />
        </section>
```

- [ ] **Step 3: Notes per group on the Groups view**

In `src/pages/app/analytics/views/GroupsView.tsx`:
- Import `NotesPanel` from `'../../../../components/analytics/NotesPanel'` and `notesAbout` from `'../../../../lib/notes'`.
- Inside the `groupBoards.map((b) => { … })` card of "Who holds the work", after the `<ShareBar … />`, add:

```tsx
                  {(() => {
                    const boardNotes = notesAbout(data.notes, { classId: b.class_id, boardIds: [b.board_id] })
                    return (
                      <details className="group rounded-lg">
                        <summary className="cursor-pointer list-none text-[12px] font-medium text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
                          Notes ({boardNotes.length})
                        </summary>
                        <div className="mt-2">
                          <NotesPanel
                            classId={b.class_id}
                            boardId={b.board_id}
                            notes={boardNotes}
                            onChanged={data.reloadNotes}
                          />
                        </div>
                      </details>
                    )
                  })()}
```

  `BoardBurn` carries `class_id` (`types.ts` `BoardBurn`).

- [ ] **Step 4: The privacy line and "See why"**

In `src/pages/app/analytics/views/StudentsView.tsx`, change the `subtitle` to:

```tsx
        subtitle={`${flagged} of ${entries.length} flagged. Flags are prompts for a conversation. Notes record that conversation and only teaching staff can read them. Select a name for their full record.`}
```

In `src/pages/app/analytics/Analytics.tsx`:
- Import `type { Action } from '../../../lib/insight'`.
- Add, after `onScope`:

```ts
  // A follow-up is about a person or a group: open their record, not just a tab.
  const seeWhy = (a: Action) => {
    if (a.kind === 'follow_up_due' && a.studentId) {
      setScope({ ...scope, studentId: a.studentId, boardId: '', taskId: '' })
      setView('students')
      return
    }
    if (a.kind === 'follow_up_due' && a.boardId) {
      setScope({ ...scope, boardId: a.boardId, studentId: '', taskId: '' })
      setView('groups')
      return
    }
    setView(viewForAction(a.kind))
  }
```

- Change `<NeedsAttention actions={data.actions} onSeeWhy={(a) => setView(viewForAction(a.kind))} />` to `<NeedsAttention actions={data.actions} onSeeWhy={seeWhy} />`.

- [ ] **Step 5: Build, lint, test**

Run: `npm run build`, then `npx eslint src`, then `npx vitest run`.
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/analytics/NotesPanel.tsx src/components/analytics/StudentDrawer.tsx src/pages/app/analytics/views/GroupsView.tsx src/pages/app/analytics/views/StudentsView.tsx src/pages/app/analytics/Analytics.tsx
git commit -m "Add notes to the student drawer and group cards, and open them from a follow-up"
```

---

## After the tasks (controller)

1. **Browser check, as faculty** (it needs the user signed in). It writes real notes, but they are staff-only and touch no students. Ask the user before the walk-through all the same.
   - Analytics → Students: open Lemmuel Rodge's drawer, add a Follow-up note dated today, and check that Needs attention gains "Follow up with …". Use "See why", which should open the drawer. Resolve the note with an outcome.
   - Groups → open "Notes (N)" on Group 1 and add a note.
   - Check the console for errors, and check widths 375, 768 and 1440.
   - Notes cannot be deleted, so word the test notes as tests ("zz test …"). Tell the user they stay.
2. **Ship.**
   - Fast-forward to `main` and push.
   - Append a "Phase C3" section to `handoff.md`.
   - Update the `collabify-current-state` memory: C3 is live, Phase B is next.

---

## Self-review

- **Spec coverage** (C3 section):

  | Spec item | Where |
  |---|---|
  | Data (enum, table, checks) | Task 1 |
  | RLS: staff select, no delete, students read nothing | Task 1 (rulings 1, 3) |
  | `nudge_board` logs, limit reads `class_notes` | Task 2 (ruling 7) |
  | `remind_peer_round` logs, limit reads them | Task 2 (ruling 4) |
  | No other system events write notes | Nothing else writes |
  | Drawer Notes section: kind chip, body, follow-up date, resolved state with outcome, Add note (Note / Meeting / Follow-up), Resolve with optional outcome | Task 4 |
  | Groups "Notes (N)" disclosure | Task 4 |
  | Needs attention `follow_up_due` (severity 2, "Follow up with {name}", Students view, links to drawer) | Tasks 3–4 (rulings 5–6) |
  | Privacy line verbatim | Task 4 |
  | Testing (spec C3: students can't read incl. own, staff can, nudge writes a note, limit holds after deletion) | Tasks 1–2 |
  | `analyticsView` mapping unit test | Task 3 |
- **Placeholders:** none.
- **Type consistency:**
  - `AddableNoteKind` and `ADDABLE_KINDS` live in `lib/notes.ts`; `api/notes.ts` imports the type from there.
  - `followUpActions` returns `Action` with `studentId`. `Action.studentId` is added in Task 3 Step 4.
  - `rankActions(rows, burns, extra)` matches its caller in `useAnalytics`.
  - `NotesPanel` props match both call sites.
  - `data.notes` and `data.reloadNotes` come from Task 3 Step 5.
- **Review Focus:** items 1–3 have SQL tests in Tasks 1–2, items 4–5 have unit tests in Task 3, and item 1's client side is the disabled button and `maxLength` in Task 4.
