# Work tab, Part 3 — Milestones — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Milestones section to every project's Work tab in both spaces. A milestone is a dated goal; tasks are tagged to it; its progress and status (Upcoming · At risk · Late · Reached) come from those tasks. Milestones also appear on the Timeline as diamonds and on the Calendar.

**Architecture:** One milestones table per space:
- **Work projects:** `general_milestones` belong to the project and are run by `manage_tasks`.
- **Class projects:** `project_milestones` belong to the class project and are set by the professor for every group.

Both task tables gain `milestone_id`. Rules live in SQL: RLS, a same-project check, who may tag, and a release-on-delete. A `MilestoneSource` adapter, built by each space with a plain function, feeds one shared `MilestonesView`. One shared `lib/api/milestones.ts` talks to either table.

**Tech Stack:** React 19 + TypeScript + Vite, react-router, Tailwind tokens, Vitest, Supabase Postgres via `node scripts/db.mjs <file>`. The owner has authorized applying SQL to the live database.

**Spec:** `docs/superpowers/specs/2026-10-06-work-tab-sprints-milestones-design.md` (rollout Part 3). Parts 1–2 are merged; read the end of `handoff.md`.

## Global Constraints

- Colours come from tokens only: `surface*`, `text-ink/muted/faint`, `border-line*`, `navy-*`, `amber-*`, and the status ramps `success-*` / `warning-*` / `danger-*` / `pending-*`. Never `emerald-*`, `red-*`, or brand amber for a status.
  - Milestone status colours: Reached = `success-*`, Late = `danger-*`, At risk = `warning-*`, Upcoming = `pending-soft` / `pending-ink`.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully". Errors say what happened and what to do next.
- Layout goes desktop first, then tablet, then phone. At 375 px there is no sideways page scroll.
- `supabase/*.sql` files must be idempotent; they get re-run. Every new table has RLS, and no new function is executable by `anon`. `rls-coverage` and `anon-lockdown` must still pass.
- Run `npm run build` before claiming anything works.
- Commit messages are plain imperative sentences ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage files explicitly. Never stage `.claude/launch.json`, `.gitignore`, or `supabase/.temp/`.
- Who does what:
  - **Work space:** anyone with `manage_tasks` (Owners, Managers, granted Members) creates, edits, deletes and marks milestones reached, and tags tasks. Everyone on the project reads.
  - **Class:** the professor creates, edits and deletes milestones and tags the tasks they set (across every copy). Students tag their own board's tasks while the board is open. Everyone who can see the project reads.
- Milestone status, computed in `lib/work/milestones.ts`:
  - **Reached:** marked reached (work space only), or every tagged task is done and there is at least one.
  - **Late:** not reached and the due date has passed.
  - **At risk:** not reached, due within 7 days, and under half of its tasks done (or none tagged).
  - **Upcoming:** anything else.
- Deliberate deviations from the spec:
  1. Milestone tags stay changeable after a task starts. They are planning labels like `sprint_id`, not part of the task's content.
  2. Instead of a new parameter on `create_professor_task` / `update_professor_task` (which would add overloads to functions other files own), the professor's milestone goes through a new RPC, `set_professor_task_milestone(origin, milestone)`. It applies to every copy.
  3. The SQL lives in new files `work-milestones.sql` and `class-milestones.sql`, not in the planning files.
- `handoff.md` §"Milestones — decided against" gets one line saying the idea was revisited as generic dated goals (Task 9).

## File map

| File | Status | Responsibility |
|---|---|---|
| `supabase/work-milestones.sql` (+ `tests/work-milestones.test.sql`) | new | `general_milestones`, `general_tasks.milestone_id`, tag guard, release trigger, overview view |
| `supabase/work-planning.sql` | modify | View statement becomes drop + create, so re-runs stay safe |
| `supabase/class-milestones.sql` (+ `tests/class-milestones.test.sql`) | new | `project_milestones`, `project_tasks.milestone_id`, same-project guard, `set_professor_task_milestone`, detail view |
| `docs/07-backup.md` | modify | Run list and re-run notes |
| `src/lib/work/types.ts`, `milestones.ts` (+ test), `nav.ts` (+ test) | modify/new | `Milestone`, `WorkItem.milestone_id`, status maths, the `milestones` section |
| `src/lib/work/timeline.ts` (+ test), `calendar.ts` (+ test), `src/lib/types.ts`, `components/calendar/eventLook.ts` | modify | Milestone marks and calendar events |
| `src/lib/api/milestones.ts` | new | Milestone CRUD, reached, tagging, professor origin tagging |
| `src/lib/general/types.ts`, `src/lib/types.ts`, `src/lib/api/tasks.ts` | modify | `milestone_id` on tasks and on `ProfessorTaskGroup` |
| `src/components/work/MilestoneDialog.tsx`, `TagTasksDialog.tsx`, `MilestonesView.tsx`, `WorkNav.tsx`, `TimelineView.tsx` | new/modify | Shared UI |
| `src/components/general/useGeneralProject.ts`, `workSource.ts`, `WorkTab.tsx`, `TasksTab.tsx` | modify | Work-space wiring |
| `src/components/tasks/useProjectTasks.ts`, `classWorkSource.ts`, `StudentTasksView.tsx`, `ProfessorTasksView.tsx`, `FanOutForm.tsx` | modify | Class wiring |
| `handoff.md` | modify | New section, plus the "decided against" note |

---

### Task 1: Milestones for work projects (`supabase/work-milestones.sql`)

**Files:**
- Create: `supabase/work-milestones.sql`
- Create: `supabase/tests/work-milestones.test.sql`
- Modify: `supabase/work-planning.sql` (its `general_task_overview` statement)
- Modify: `docs/07-backup.md`

**Interfaces:**
- Consumes (Part 2, live):
  - `general_tasks.sprint_id/rank`
  - the release pattern in `work-planning.sql` (`release_sprint_tasks()`, which is security definer, flips `collabify.general_archive_op` and restores the previous value)
  - the `guard_general_task` exemption under that flag
- Produces:
  - `public.general_milestones(id, project_id, name, description, due_on date, reached_at timestamptz, created_by, created_at)`
  - `general_tasks.milestone_id uuid null`, FK `(milestone_id, project_id)` → `general_milestones(id, project_id)` on delete set null `(milestone_id)`
  - `general_task_overview` gains `milestone_id` as its last column

- [ ] **Step 1: Write the test**

Mirror the fixture of `supabase/tests/work-planning.test.sql`: its helper functions `act_as`, `act_as_service`, `must_be` and `must_refuse`; three faculty users (Owner `a`, Member `b`, Outsider `d`); `create_general_project`; and the invite/respond flow for `b`. Then:

```sql
-- supabase/tests/work-milestones.test.sql (body of the main do-block, after the fixture)
  perform pg_temp.act_as(a);
  p2 := (public.create_general_project('Zz other milestones')).id;
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Beta', current_date + 10) returning id into m1;
  insert into public.general_milestones (project_id, name, due_on)
  values (p2, 'Elsewhere', current_date + 10) returning id into m_other;
  perform pg_temp.must_be('a manager can create a milestone',
    exists (select 1 from public.general_milestones where id = m1));
  perform pg_temp.must_refuse('a milestone needs a name',
    format($q$insert into public.general_milestones (project_id, name, due_on) values (%L, '  ', current_date)$q$, p));

  perform pg_temp.act_as(b);
  perform pg_temp.must_be('a member can read milestones',
    exists (select 1 from public.general_milestones where id = m1));
  perform pg_temp.must_refuse('a member cannot create a milestone',
    format($q$insert into public.general_milestones (project_id, name, due_on) values (%L, 'Mine', current_date)$q$, p));
  update public.general_milestones set reached_at = now() where id = m1;
  perform pg_temp.must_be('a member cannot mark a milestone reached',
    (select reached_at from public.general_milestones where id = m1) is null);

  perform pg_temp.act_as(d);
  perform pg_temp.must_be('an outsider cannot read milestones',
    not exists (select 1 from public.general_milestones where id = m1));

  -- tagging
  perform pg_temp.act_as(b);
  insert into public.general_tasks (project_id, title) values (p, 'Member task') returning id into t_b;
  perform pg_temp.must_refuse('a member cannot tag a task',
    format('update public.general_tasks set milestone_id = %L where id = %L', m1, t_b));
  perform pg_temp.must_refuse('a member cannot add a task already tagged',
    format($q$insert into public.general_tasks (project_id, title, milestone_id) values (%L, 'x', %L)$q$, p, m1));

  perform pg_temp.act_as(a);
  insert into public.general_tasks (project_id, title, milestone_id) values (p, 'Tagged', m1) returning id into t_a;
  update public.general_tasks set milestone_id = m1 where id = t_b;
  perform pg_temp.must_be('a manager can tag tasks',
    (select count(*) from public.general_tasks where milestone_id = m1) = 2);
  perform pg_temp.must_refuse('a task cannot take another project''s milestone',
    format('update public.general_tasks set milestone_id = %L where id = %L', m_other, t_a));
  update public.general_milestones set reached_at = now() where id = m1;
  perform pg_temp.must_be('a manager can mark a milestone reached',
    (select reached_at is not null from public.general_milestones where id = m1));
  perform pg_temp.must_be('the overview carries the milestone',
    (select milestone_id = m1 from public.general_task_overview where id = t_a));

  -- deleting releases tags, archived team tasks included
  insert into public.general_teams (project_id, name) values (p, 'Zz Crew') returning id into v_team;
  insert into public.general_tasks (project_id, team_id, title, milestone_id)
  values (p, v_team, 'Archived team task', m1) returning id into t_arch;
  perform public.archive_general_task(t_arch, true);
  delete from public.general_milestones where id = m1;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a milestone can be deleted over archived team tasks', n = 1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('its tasks lose the tag, archived ones too',
    (select count(*) from public.general_tasks where id in (t_a, t_b, t_arch) and milestone_id is null) = 3);
  perform pg_temp.must_be('the archive flag is not left on',
    coalesce(current_setting('collabify.general_archive_op', true), '') <> 'on');
```

Declare `p2, m1, m_other, t_a, t_b, t_arch, v_team uuid; n int;`. If `archive_general_task` refuses for the Owner, follow the archived-team-task setup already working in `work-planning.test.sql` (around lines 195–215).

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node scripts/db.mjs supabase/tests/work-milestones.test.sql`
Expected: ERROR `relation "public.general_milestones" does not exist`.

- [ ] **Step 3: Write `supabase/work-milestones.sql`**

```sql
-- Collabify — milestones for work projects (Work tab, Part 3).
--
--   node scripts/db.mjs supabase/work-milestones.sql
--
-- A milestone is a dated goal on one project. Tasks are tagged to it; its
-- progress is how many of those are done (worked out in the app). Anyone with
-- manage_tasks runs milestones and tags tasks; everybody on the project reads.
--
-- Requires work-planning.sql (and everything before it). Recreates
-- general_task_overview with milestone_id appended, so re-run this file after
-- re-running work-planning.sql, general-schedule.sql, general-project-archive.sql
-- or general-archive-rbac.sql.
--
-- Idempotent. Safe to re-run.

begin;

create table if not exists public.general_milestones (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.general_projects (id) on delete cascade,
  name        text not null,
  description text not null default '',
  due_on      date not null,
  reached_at  timestamptz,
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint general_milestones_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint general_milestones_description_len check (char_length(description) <= 1000),
  constraint general_milestones_id_project unique (id, project_id)
);

create index if not exists general_milestones_project_idx
  on public.general_milestones (project_id, due_on);

alter table public.general_milestones enable row level security;

drop policy if exists general_milestones_read on public.general_milestones;
create policy general_milestones_read on public.general_milestones
  for select to authenticated
  using (public.can_read_general_project(project_id));

drop policy if exists general_milestones_insert on public.general_milestones;
create policy general_milestones_insert on public.general_milestones
  for insert to authenticated
  with check (public.general_can(project_id, 'manage_tasks')
              and not public.general_is_archived(project_id));

drop policy if exists general_milestones_update on public.general_milestones;
create policy general_milestones_update on public.general_milestones
  for update to authenticated
  using (public.general_can(project_id, 'manage_tasks')
         and not public.general_is_archived(project_id))
  with check (public.general_can(project_id, 'manage_tasks')
              and not public.general_is_archived(project_id));

drop policy if exists general_milestones_delete on public.general_milestones;
create policy general_milestones_delete on public.general_milestones
  for delete to authenticated
  using (public.general_can(project_id, 'manage_tasks')
         and not public.general_is_archived(project_id));

revoke all on public.general_milestones from anon;
grant select, insert, update, delete on public.general_milestones to authenticated;

-- ---------------------------------------------------------------- tasks

alter table public.general_tasks add column if not exists milestone_id uuid;

do $$ begin
  alter table public.general_tasks
    add constraint general_tasks_milestone_fk foreign key (milestone_id, project_id)
    references public.general_milestones (id, project_id) on delete set null (milestone_id);
exception when duplicate_object then null; end $$;

create index if not exists general_tasks_milestone_idx
  on public.general_tasks (milestone_id) where milestone_id is not null;

/** Tagging a task is planning: manage_tasks only. */
create or replace function public.guard_general_task_milestone()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.milestone_id is not null)
     or (tg_op = 'UPDATE' and new.milestone_id is distinct from old.milestone_id) then
    if not public.general_can(new.project_id, 'manage_tasks') then
      raise exception 'Only someone who manages tasks can tag a task with a milestone.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_general_task_milestone() from public, anon;

drop trigger if exists general_tasks_milestone_guard on public.general_tasks;
create trigger general_tasks_milestone_guard before insert or update on public.general_tasks
  for each row execute function public.guard_general_task_milestone();

/**
 * Untag a milestone's tasks before it goes, archived ones included. The FK's
 * own set-null would otherwise trip guard_general_task's archived-task freeze
 * (the same trap release_sprint_tasks handles in work-planning.sql). Security
 * definer so tasks the deleter cannot see are untagged too; it only ever runs
 * for a row the delete policy allowed. The previous flag value is restored.
 */
create or replace function public.release_milestone_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  was text := current_setting('collabify.general_archive_op', true);
begin
  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_tasks set milestone_id = null where milestone_id = old.id;
  perform set_config('collabify.general_archive_op', coalesce(was, 'off'), true);
  return old;
end;
$$;

revoke all on function public.release_milestone_tasks() from public, anon;

drop trigger if exists general_milestones_release on public.general_milestones;
create trigger general_milestones_release before delete on public.general_milestones
  for each row execute function public.release_milestone_tasks();

-- ---------------------------------------------------------------- the overview

-- Dropped and recreated: `create or replace` cannot drop or reorder columns,
-- and the owners before this file define it with fewer.
drop view if exists public.general_task_overview;

create view public.general_task_overview
with (security_invoker = true) as
select t.id,
       t.project_id,
       t.team_id,
       t.title,
       t.description,
       t.status,
       t.due_at,
       t.weight,
       t.created_by,
       t.completed_at,
       t.created_at,
       t.updated_at,
       coalesce((select array_agg(a.user_id order by a.assigned_at)
                   from public.general_task_assignees a where a.task_id = t.id), '{}'::uuid[])
         as assignee_ids,
       (select count(*) from public.general_task_comments c where c.task_id = t.id)::int
         as comment_count,
       (select count(*) from public.general_task_files f
         where f.task_id = t.id and f.archived_at is null)::int as file_count,
       (select coalesce(sum(l.minutes), 0) from public.general_task_logs l where l.task_id = t.id)::int
         as logged_minutes,
       t.starts_at,
       t.archived_at,
       t.archived_by,
       t.sprint_id,
       t.rank,
       t.milestone_id
  from public.general_tasks t
 where t.archived_at is null or public.general_sees_archived(t.project_id, t.archived_by);

grant select on public.general_task_overview to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.general_milestones;
exception when duplicate_object then null; end $$;

commit;
```

Before applying it, run `node scripts/db.mjs -c "select pg_get_viewdef('public.general_task_overview'::regclass, true)"`. The live view must match the select list above minus `milestone_id`. If anything differs, copy the live version and append `t.milestone_id`. Also confirm with a read-only check on `pg_depend` / `pg_views` that no view depends on `general_task_overview`.

In `supabase/work-planning.sql`, change its `create or replace view public.general_task_overview` to `drop view if exists public.general_task_overview;` followed by `create view …`, with the same body. That way re-running `work-planning.sql` after this file no longer errors. It drops `milestone_id` until this file runs again, which the run order handles.

- [ ] **Step 4: Apply and test**

Run: `node scripts/db.mjs supabase/work-milestones.sql && node scripts/db.mjs supabase/work-milestones.sql`
Expected: `Done.` twice.

Run: `node scripts/db.mjs supabase/work-planning.sql supabase/work-milestones.sql`
Expected: `Done.` This proves the re-run order works.

Run: `node scripts/db.mjs supabase/tests/work-milestones.test.sql`
Expected: every line PASS.

Run: `node scripts/db.mjs supabase/tests/work-planning.test.sql supabase/tests/general-tasks.test.sql supabase/tests/general-archive-rbac.test.sql supabase/tests/task-archive.test.sql supabase/tests/archive-page.test.sql supabase/tests/rls-coverage.test.sql supabase/tests/anon-lockdown.test.sql`
Expected: all PASS.

- [ ] **Step 5: Backup doc**

In `docs/07-backup.md`:
- Append ` supabase/work-milestones.sql` to the run list, after `supabase/class-planning.sql`.
- Extend the `general_task_overview` re-run note so it says: re-run `work-planning.sql`, then `work-milestones.sql`, after any of the view's earlier owners.

- [ ] **Step 6: Commit**

```bash
git add supabase/work-milestones.sql supabase/tests/work-milestones.test.sql supabase/work-planning.sql docs/07-backup.md
git commit -m "Add milestones to work projects

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Milestones for class projects (`supabase/class-milestones.sql`)

**Files:**
- Create: `supabase/class-milestones.sql`
- Create: `supabase/tests/class-milestones.test.sql`
- Modify: `docs/07-backup.md`

**Interfaces:**
- Produces:
  - `public.project_milestones(id, project_id → projects, name, description, due_on date, created_by, created_at)`
  - `project_tasks.milestone_id uuid null`, FK → `project_milestones(id)` on delete set null
  - same-project trigger `project_tasks_milestone_guard`
  - `public.set_professor_task_milestone(p_origin uuid, p_milestone uuid) returns int` (the number of copies changed)
  - `task_detail_overview` carries `milestone_id` via `t.*`

- [ ] **Step 1: Write the test**

Mirror the fixture of `supabase/tests/class-planning.test.sql`: a class with 2 or more active students, a group set and group holding A and B, two released group projects `v_proj` and `v_proj2` on that set, and their boards `v_board` / `v_board2`. Then:

```sql
  perform pg_temp.act_as(v_prof);
  insert into public.project_milestones (project_id, name, due_on)
  values (v_proj, 'Chapter 1–3', current_date + 14) returning id into m1;
  insert into public.project_milestones (project_id, name, due_on)
  values (v_proj2, 'Other project', current_date + 14) returning id into m_other;
  perform pg_temp.must_be('the professor can set a milestone',
    exists (select 1 from public.project_milestones where id = m1));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a student in the project can read its milestones',
    exists (select 1 from public.project_milestones where id = m1));
  perform pg_temp.must_refuse('a student cannot set a milestone',
    format($q$insert into public.project_milestones (project_id, name, due_on) values (%L, 'Mine', current_date)$q$, v_proj));

  insert into public.project_tasks (board_id, title, weight, created_by)
  values (v_board, 'Draft chapter 1', 10, v_a) returning id into t1;
  update public.project_tasks set milestone_id = m1 where id = t1;
  perform pg_temp.must_be('a student can tag their board''s task',
    (select milestone_id from public.project_tasks where id = t1) = m1);
  perform pg_temp.must_refuse('a task cannot take another project''s milestone',
    format('update public.project_tasks set milestone_id = %L where id = %L', m_other, t1));
  perform pg_temp.must_be('the detail view carries the milestone',
    (select milestone_id = m1 from public.task_detail_overview where id = t1));

  -- the professor tags every copy of a task they set
  perform pg_temp.act_as(v_prof);
  select (public.create_professor_task(v_proj, 'Outline', '', 10, null, null, false) ->> 'origin_id')::uuid
    into v_origin;
  perform pg_temp.must_be('setting a milestone on a set task reaches its copies',
    public.set_professor_task_milestone(v_origin, m1) >= 1
    and not exists (select 1 from public.project_tasks where origin_id = v_origin and milestone_id is distinct from m1));
  perform pg_temp.must_refuse('a set task cannot take another project''s milestone',
    format('select public.set_professor_task_milestone(%L, %L)', v_origin, m_other));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot tag every copy',
    format('select public.set_professor_task_milestone(%L, null)', v_origin));

  -- deleting a milestone untags its tasks
  perform pg_temp.act_as(v_prof);
  delete from public.project_milestones where id = m1;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('deleting a milestone untags its tasks',
    not exists (select 1 from public.project_tasks where milestone_id = m1));
```

Declare `m1, m_other, t1, v_origin uuid`. Check the real argument list of `create_professor_task` in `supabase/tasks.sql` (around line 478) and adjust the call; never weaken an assertion.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node scripts/db.mjs supabase/tests/class-milestones.test.sql`
Expected: ERROR `relation "public.project_milestones" does not exist`.

- [ ] **Step 3: Write `supabase/class-milestones.sql`**

```sql
-- Collabify — milestones for class projects (Work tab, Part 3).
--
--   node scripts/db.mjs supabase/class-milestones.sql
--
-- The professor sets a project's milestones once; every group sees the same
-- ones and tags its own tasks to them. Progress per group is worked out in the
-- app from each board's tagged tasks.
--
-- Tags are planning labels: guard_task_edit does not freeze milestone_id, so a
-- started task can still be tagged. A professor's set task is tagged on every
-- copy through set_professor_task_milestone.
--
-- Recreates task_detail_overview (`select t.*`) to pick up milestone_id; same
-- body as class-schedule.sql. Requires class-planning.sql.
--
-- Idempotent. Safe to re-run.

begin;

create table if not exists public.project_milestones (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null,
  description text not null default '',
  due_on      date not null,
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint project_milestones_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint project_milestones_description_len check (char_length(description) <= 1000)
);

create index if not exists project_milestones_project_idx
  on public.project_milestones (project_id, due_on);

alter table public.project_milestones enable row level security;

-- Readable by whoever can read the project (its own RLS decides).
drop policy if exists project_milestones_read on public.project_milestones;
create policy project_milestones_read on public.project_milestones
  for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id));

drop policy if exists project_milestones_write on public.project_milestones;
create policy project_milestones_write on public.project_milestones
  for all to authenticated
  using (public.is_class_professor((select p.class_id from public.projects p where p.id = project_id)))
  with check (public.is_class_professor((select p.class_id from public.projects p where p.id = project_id)));

revoke all on public.project_milestones from anon;
grant select, insert, update, delete on public.project_milestones to authenticated;

-- ---------------------------------------------------------------- tasks

alter table public.project_tasks add column if not exists milestone_id uuid;

-- Only the professor deletes milestones, and guard_task_edit lets the
-- professor through without the archived-task freeze, so the plain set-null is
-- enough here (unlike work projects).
do $$ begin
  alter table public.project_tasks
    add constraint project_tasks_milestone_fk foreign key (milestone_id)
    references public.project_milestones (id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists project_tasks_milestone_idx
  on public.project_tasks (milestone_id) where milestone_id is not null;

/** A task can only carry a milestone of its own project. */
create or replace function public.guard_task_milestone()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.milestone_id is null
     or (tg_op = 'UPDATE' and new.milestone_id is not distinct from old.milestone_id) then
    return new;
  end if;
  if not exists (
    select 1 from public.project_milestones m
      join public.project_boards b on b.project_id = m.project_id
     where m.id = new.milestone_id and b.id = new.board_id
  ) then
    raise exception 'That milestone belongs to another project.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_task_milestone() from public, anon;

drop trigger if exists project_tasks_milestone_guard on public.project_tasks;
create trigger project_tasks_milestone_guard before insert or update on public.project_tasks
  for each row execute function public.guard_task_milestone();

drop view if exists public.task_detail_overview;

create view public.task_detail_overview
with (security_invoker = true) as
select t.*,
       b.project_id,
       b.group_id,
       (select count(*) from public.task_comments c where c.task_id = t.id)::int
         as comment_count,
       (select count(*) from public.task_files f where f.task_id = t.id)::int
         as file_count,
       (select coalesce(sum(w.minutes), 0) from public.task_worklog w where w.task_id = t.id)::int
         as logged_minutes,
       p.first_name || ' ' || p.last_name as creator_name
  from public.project_tasks t
  join public.project_boards b on b.id = t.board_id
  left join public.profiles p on p.id = t.created_by;

grant select on public.task_detail_overview to authenticated;

-- ---------------------------------------------------------------- the professor's tasks

/** Tag every live copy of a task the professor set. Returns how many changed. */
create or replace function public.set_professor_task_milestone(p_origin uuid, p_milestone uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
  n int;
begin
  select b.project_id into v_project
    from public.project_tasks t join public.project_boards b on b.id = t.board_id
   where t.origin_id = p_origin
   limit 1;
  if v_project is null then
    raise exception 'That task is not there any more. Reload the page.';
  end if;
  if not public.is_class_professor((select p.class_id from public.projects p where p.id = v_project)) then
    raise exception 'Only the professor can tag the tasks they set.' using errcode = 'insufficient_privilege';
  end if;
  if p_milestone is not null and not exists (
    select 1 from public.project_milestones where id = p_milestone and project_id = v_project
  ) then
    raise exception 'That milestone belongs to another project.' using errcode = 'check_violation';
  end if;

  update public.project_tasks
     set milestone_id = p_milestone
   where origin_id = p_origin and archived_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.set_professor_task_milestone(uuid, uuid) from public, anon;
grant execute on function public.set_professor_task_milestone(uuid, uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.project_milestones;
exception when duplicate_object then null; end $$;

commit;
```

- [ ] **Step 4: Apply and test**

Run: `node scripts/db.mjs supabase/class-milestones.sql && node scripts/db.mjs supabase/class-milestones.sql`
Expected: `Done.` twice.

Run: `node scripts/db.mjs supabase/tests/class-milestones.test.sql`
Expected: every line PASS.

Run: `node scripts/db.mjs supabase/tests/class-planning.test.sql supabase/tests/class-schedule.test.sql supabase/tests/deadline-lock.test.sql supabase/tests/task-archive.test.sql supabase/tests/rls-coverage.test.sql supabase/tests/anon-lockdown.test.sql`
Expected: all PASS.

- [ ] **Step 5: Backup doc**

In `docs/07-backup.md`, append ` supabase/class-milestones.sql` to the run list after `supabase/work-milestones.sql`.

- [ ] **Step 6: Commit**

```bash
git add supabase/class-milestones.sql supabase/tests/class-milestones.test.sql docs/07-backup.md
git commit -m "Add milestones to class projects

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Milestone types, status maths and the Milestones section

**Files:**
- Modify: `src/lib/work/types.ts` (add `Milestone`, `MilestoneInput`, `MilestoneGroup`, `MilestoneSource`, and `WorkItem.milestone_id`)
- Create: `src/lib/work/milestones.ts` (+ `milestones.test.ts`)
- Modify: `src/lib/work/nav.ts` (+ `nav.test.ts`), `src/components/work/WorkNav.tsx`

**Interfaces:**
- Consumes: `dayDiff`, `toDay` (`lib/work/sprints.ts`), `WorkItem`.
- Produces:
  - types: `Milestone`, `MilestoneInput`, `MilestoneGroup`, `MilestoneSource` (shapes below), and `WorkItem.milestone_id: string | null`.
  - `milestones.ts`: `type MilestoneStatus`, `MILESTONE_STATUS_LABEL`, `milestoneProgress(items, id)`, `milestoneStatus(m, progress, now?)`, `dueInLabel(due_on, now?)`, `sortMilestones(ms)`.
  - `nav.ts`: `WorkSection` gains `'milestones'`, and `WORK_SECTIONS` becomes `['summary', 'backlog', 'sprints', 'tasks', 'milestones']`.

- [ ] **Step 1: Types**

Append to `src/lib/work/types.ts`:

```ts
export type Milestone = {
  id: string
  name: string
  description: string
  /** Calendar day, YYYY-MM-DD. */
  due_on: string
  /** Work projects only: when someone marked it reached. Always null in class projects. */
  reached_at: string | null
  created_at: string
}

export type MilestoneInput = { name: string; description: string; dueOn: string }

/** One group's tasks, for a professor following every group's progress. */
export type MilestoneGroup = { id: string; name: string; items: WorkItem[] }

/** What a space hands the Milestones view. Every action reloads the space when done. */
export type MilestoneSource = {
  milestones: Milestone[]
  /** The tasks this viewer can tag (empty for a professor, who reads `groups`). */
  items: WorkItem[]
  /** Per-group tasks for a professor's view; empty elsewhere. */
  groups: MilestoneGroup[]
  /** May create, edit and delete milestones. */
  canManage: boolean
  /** May tag and untag `items`. */
  canTag: boolean
  /** Work projects: may mark a milestone reached by hand. */
  canMarkReached: boolean
  /** Shown as a note when this viewer can only read; '' otherwise. */
  readOnlyReason: string
  openTask: (id: string) => void
  createMilestone: (input: MilestoneInput) => Promise<string>
  updateMilestone: (id: string, input: MilestoneInput) => Promise<void>
  deleteMilestone: (id: string) => Promise<void>
  setReached: (id: string, reached: boolean) => Promise<void>
  tag: (taskIds: string[], milestoneId: string | null) => Promise<void>
}
```

`WorkItem.milestone_id` arrives in Task 4, together with the task fields that feed it.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/work/milestones.test.ts
import { describe, expect, it } from 'vitest'
import { dueInLabel, milestoneProgress, milestoneStatus, sortMilestones } from './milestones'
import type { Milestone } from './types'

const noon = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}
const ms = (over: Partial<Milestone> = {}): Milestone => ({
  id: 'm', name: 'Beta', description: '', due_on: '2026-10-20', reached_at: null,
  created_at: '2026-10-01T00:00:00Z', ...over,
})

describe('milestoneProgress', () => {
  it('counts tagged tasks and the done ones', () => {
    const items = [
      { milestone_id: 'm', status: 'done' as const },
      { milestone_id: 'm', status: 'todo' as const },
      { milestone_id: 'm', status: 'in_progress' as const },
      { milestone_id: null, status: 'done' as const },
    ]
    expect(milestoneProgress(items, 'm')).toEqual({ done: 1, total: 3, pct: 33 })
  })
  it('is zero with nothing tagged', () => {
    expect(milestoneProgress([], 'm')).toEqual({ done: 0, total: 0, pct: 0 })
  })
})

describe('milestoneStatus', () => {
  it('is reached when marked, or when every tagged task is done', () => {
    expect(milestoneStatus(ms({ reached_at: '2026-10-05T00:00:00Z' }), { done: 0, total: 2 }, noon('2026-10-25'))).toBe('reached')
    expect(milestoneStatus(ms(), { done: 2, total: 2 }, noon('2026-10-25'))).toBe('reached')
  })
  it('is late once the day has passed', () => {
    expect(milestoneStatus(ms(), { done: 1, total: 2 }, noon('2026-10-21'))).toBe('late')
  })
  it('is at risk inside a week with under half done or nothing tagged', () => {
    expect(milestoneStatus(ms(), { done: 0, total: 4 }, noon('2026-10-15'))).toBe('at_risk')
    expect(milestoneStatus(ms(), { done: 0, total: 0 }, noon('2026-10-20'))).toBe('at_risk')
  })
  it('is upcoming otherwise', () => {
    expect(milestoneStatus(ms(), { done: 2, total: 4 }, noon('2026-10-15'))).toBe('upcoming')
    expect(milestoneStatus(ms(), { done: 0, total: 4 }, noon('2026-10-01'))).toBe('upcoming')
  })
})

describe('dueInLabel', () => {
  it('says when it is due in words', () => {
    expect(dueInLabel('2026-10-20', noon('2026-10-15'))).toBe('in 5 days')
    expect(dueInLabel('2026-10-20', noon('2026-10-19'))).toBe('tomorrow')
    expect(dueInLabel('2026-10-20', noon('2026-10-20'))).toBe('today')
    expect(dueInLabel('2026-10-20', noon('2026-10-21'))).toBe('yesterday')
    expect(dueInLabel('2026-10-20', noon('2026-10-24'))).toBe('4 days ago')
  })
})

describe('sortMilestones', () => {
  it('orders by date, then by when it was made', () => {
    const list = sortMilestones([
      ms({ id: 'c', due_on: '2026-11-01' }),
      ms({ id: 'b', due_on: '2026-10-20', created_at: '2026-10-02T00:00:00Z' }),
      ms({ id: 'a', due_on: '2026-10-20', created_at: '2026-10-01T00:00:00Z' }),
    ])
    expect(list.map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })
})
```

Run: `npx vitest run src/lib/work/milestones.test.ts`
Expected: FAIL (unresolved import).

- [ ] **Step 3: Implement `milestones.ts`**

```ts
// src/lib/work/milestones.ts
/**
 * Milestone progress and status, from the tasks tagged to it. Status is
 * worked out here rather than stored, so it is always as fresh as the tasks.
 */
import { dayDiff, toDay } from './sprints'
import type { WorkStatus } from './timeline'
import type { Milestone } from './types'

export type MilestoneStatus = 'reached' | 'late' | 'at_risk' | 'upcoming'

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  reached: 'Reached',
  late: 'Late',
  at_risk: 'At risk',
  upcoming: 'Upcoming',
}

export function milestoneProgress(items: readonly { milestone_id: string | null; status: WorkStatus }[], id: string) {
  const mine = items.filter((i) => i.milestone_id === id)
  const done = mine.filter((i) => i.status === 'done').length
  return { done, total: mine.length, pct: mine.length ? Math.round((done / mine.length) * 100) : 0 }
}

/** Reached, then late, then at risk (a week out with under half done), else upcoming. */
export function milestoneStatus(
  m: Pick<Milestone, 'due_on' | 'reached_at'>,
  progress: { done: number; total: number },
  now = Date.now(),
): MilestoneStatus {
  if (m.reached_at || (progress.total > 0 && progress.done === progress.total)) return 'reached'
  const days = dayDiff(toDay(now), m.due_on)
  if (days < 0) return 'late'
  if (days <= 7 && (progress.total === 0 || progress.done / progress.total < 0.5)) return 'at_risk'
  return 'upcoming'
}

export function dueInLabel(dueOn: string, now = Date.now()) {
  const days = dayDiff(toDay(now), dueOn)
  if (days > 1) return `in ${days} days`
  if (days === 1) return 'tomorrow'
  if (days === 0) return 'today'
  if (days === -1) return 'yesterday'
  return `${-days} days ago`
}

export function sortMilestones<T extends Pick<Milestone, 'due_on' | 'created_at'>>(list: readonly T[]) {
  return [...list].sort((a, b) => a.due_on.localeCompare(b.due_on) || a.created_at.localeCompare(b.created_at))
}
```

- [ ] **Step 4: The section in the URL and the nav**

In `nav.ts`: `export type WorkSection = 'summary' | 'backlog' | 'sprints' | 'tasks' | 'milestones'` and `WORK_SECTIONS = ['summary', 'backlog', 'sprints', 'tasks', 'milestones']`.

In `nav.test.ts`:
- The fallback test uses `work=milestones` as its unknown value. Change it to `work=archive`.
- Add `expect(workSection(p('work=milestones'), 'tasks')).toBe('milestones')` to the "reads the backlog and sprints sections" test, and rename that test to "reads the planning sections".

In `WorkNav.tsx`'s `LOOK`, add `milestones: { label: 'Milestones', icon: 'pin' },`.

- [ ] **Step 5: Test and type-check**

Run: `npx vitest run src/lib/work`. Expect PASS.
Run: `npx tsc -b`. Expect it clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/work/types.ts src/lib/work/milestones.ts src/lib/work/milestones.test.ts src/lib/work/nav.ts src/lib/work/nav.test.ts src/components/work/WorkNav.tsx
git commit -m "Add milestone types, status and the Milestones section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Milestone API and the task fields

**Files:**
- Create: `src/lib/api/milestones.ts`
- Modify: `src/lib/general/types.ts` (`GeneralTask.milestone_id`), `src/lib/types.ts` (`ProjectTask.milestone_id`)
- Modify: `src/lib/api/tasks.ts` (`ProfessorTaskGroup.milestone_id`, set in `groupByOrigin`)

**Interfaces:**
- Consumes: `Milestone`, `MilestoneInput` (Task 3); `supabase`.
- Produces:
  - `type MilestoneHome = { kind: 'work' | 'class'; projectId: string }`
  - `listMilestones(home)`, `createMilestone(home, input): Promise<string>`, `updateMilestone(home, id, input)`, `deleteMilestone(home, id)`
  - `setMilestoneReached(id, reached: boolean)` (work only)
  - `tagTasks(home, taskIds, milestoneId | null)`
  - `setOriginMilestone(originId, milestoneId | null): Promise<number>`

- [ ] **Step 1: Write the API**

```ts
// src/lib/api/milestones.ts
/**
 * Milestones for either space. A work project's are run by whoever manages
 * tasks; a class project's are set by the professor. The database holds the
 * rules: supabase/work-milestones.sql and supabase/class-milestones.sql.
 */
import { supabase } from '../supabase'
import type { Milestone, MilestoneInput } from '../work/types'

export type MilestoneHome = { kind: 'work' | 'class'; projectId: string }

const TABLE = { work: 'general_milestones', class: 'project_milestones' } as const
const TASKS = { work: 'general_tasks', class: 'project_tasks' } as const
const COLUMNS = {
  work: 'id, name, description, due_on, reached_at, created_at',
  class: 'id, name, description, due_on, created_at',
} as const

function fields(input: MilestoneInput) {
  return { name: input.name.trim(), description: input.description.trim(), due_on: input.dueOn }
}

function touched(data: unknown[] | null, message: string) {
  if (!data || data.length === 0) throw new Error(message)
}

export async function listMilestones(home: MilestoneHome): Promise<Milestone[]> {
  const { data, error } = await supabase
    .from(TABLE[home.kind])
    .select(COLUMNS[home.kind])
    .eq('project_id', home.projectId)
    .order('due_on')
  if (error) throw error
  // Class milestones have no reached_at column; they read as never marked.
  return ((data ?? []) as (Omit<Milestone, 'reached_at'> & { reached_at?: string | null })[]).map((m) => ({
    ...m,
    reached_at: m.reached_at ?? null,
  }))
}

export async function createMilestone(home: MilestoneHome, input: MilestoneInput) {
  const { data, error } = await supabase
    .from(TABLE[home.kind])
    .insert({ project_id: home.projectId, ...fields(input) })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function updateMilestone(home: MilestoneHome, id: string, input: MilestoneInput) {
  const { data, error } = await supabase.from(TABLE[home.kind]).update(fields(input)).eq('id', id).select('id')
  if (error) throw error
  touched(data, 'That milestone could not change. It may be gone, or you may not manage milestones here.')
}

export async function deleteMilestone(home: MilestoneHome, id: string) {
  const { data, error } = await supabase.from(TABLE[home.kind]).delete().eq('id', id).select('id')
  if (error) throw error
  touched(data, 'That milestone could not be deleted. Reload the page and try again.')
}

/** Work projects only: mark a milestone reached by hand, or take it back. */
export async function setMilestoneReached(id: string, reached: boolean) {
  const { data, error } = await supabase
    .from('general_milestones')
    .update({ reached_at: reached ? new Date().toISOString() : null })
    .eq('id', id)
    .select('id')
  if (error) throw error
  touched(data, 'That milestone could not change. Reload the page and try again.')
}

export async function tagTasks(home: MilestoneHome, taskIds: string[], milestoneId: string | null) {
  if (taskIds.length === 0) return
  const { data, error } = await supabase
    .from(TASKS[home.kind])
    .update({ milestone_id: milestoneId })
    .in('id', taskIds)
    .select('id')
  if (error) throw error
  touched(data, 'Those tasks could not be tagged. Reload the page and try again.')
}

/** Class professors: tag every copy of a task they set. */
export async function setOriginMilestone(originId: string, milestoneId: string | null) {
  const { data, error } = await supabase.rpc('set_professor_task_milestone', {
    p_origin: originId,
    p_milestone: milestoneId,
  })
  if (error) throw error
  return data as number
}
```

- [ ] **Step 2: Task fields**

- Add `milestone_id: string | null` (comment `/** The milestone it counts toward; null when untagged. */`) to `GeneralTask` after `rank`, and to `ProjectTask` after `rank`.
- Add `milestone_id: string | null` to `ProfessorTaskGroup`, and set `milestone_id: t.milestone_id` in `groupByOrigin`'s initial row.
- In `src/lib/work/types.ts` `WorkItem`, after `sprint_id`, add `milestone_id: string | null` (comment `/** The milestone it counts toward; null when untagged. */`). Map it in `src/components/general/workSource.ts` (`milestone_id: t.milestone_id,`) and `src/components/tasks/classWorkSource.ts` (`milestone_id: task.milestone_id,`), and add `milestone_id: null` to every `WorkItem` literal in tests that `tsc` reports.
- Fix every literal `tsc` reports by adding `milestone_id: null`.

- [ ] **Step 3: Check**

Run: `npx tsc -b` and expect it clean.
Run: `npx vitest run` and expect PASS.
Run: `npx eslint src/lib` and expect it clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/milestones.ts src/lib/general/types.ts src/lib/types.ts src/lib/api/tasks.ts src/lib/work/types.ts src/components/general/workSource.ts src/components/tasks/classWorkSource.ts
git add -u src
git commit -m "Add a milestone API for both spaces and carry the milestone on tasks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Milestones on the Timeline and the Calendar

**Files:**
- Modify: `src/lib/work/timeline.ts` (+ test), `src/lib/work/calendar.ts` (+ test)
- Modify: `src/lib/types.ts` (`CalendarKind` adds `'milestone'`), `src/components/calendar/eventLook.ts`
- Modify: `src/components/work/TimelineView.tsx`

**Interfaces:**
- Produces:
  - `type Mark = { id: string; label: string; at: number }`
  - `milestoneMarks(ms: readonly { id; name; due_on }[]): Mark[]`, placed at local noon of `due_on`
  - `placeMark(mark, window): number | null`
  - `milestoneCalendarEvents(ms: readonly Pick<Milestone, 'id' | 'name' | 'due_on' | 'reached_at'>[]): CalendarEvent[]`
  - `TimelineView` gets an optional prop `marks?: Mark[]`

- [ ] **Step 1: Failing tests**

Append to `timeline.test.ts`, importing `milestoneMarks` and `placeMark`:

```ts
describe('milestone marks', () => {
  const localDay = (s: string, h = 0) => {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d, h).getTime()
  }
  const window = { start: localDay('2026-10-01'), end: localDay('2026-11-01'), source: 'project' as const }
  it('sits at noon on its day', () => {
    expect(milestoneMarks([{ id: 'm', name: 'Beta', due_on: '2026-10-16' }])).toEqual([
      { id: 'm', label: 'Beta', at: localDay('2026-10-16', 12) },
    ])
  })
  it('places inside the window and drops what falls outside', () => {
    expect(placeMark({ id: 'm', label: 'B', at: localDay('2026-10-01') }, window)).toBe(0)
    expect(placeMark({ id: 'm', label: 'B', at: localDay('2026-11-05') }, window)).toBeNull()
    expect(placeMark({ id: 'm', label: 'B', at: 1 }, { start: 0, end: 0, source: 'none' })).toBeNull()
  })
})
```

Append to `calendar.test.ts`, importing `milestoneCalendarEvents`:

```ts
describe('milestoneCalendarEvents', () => {
  it('puts each milestone on its day, opening no task', () => {
    const [e] = milestoneCalendarEvents([
      { id: 'm1', name: 'Beta', due_on: '2026-10-16', reached_at: null },
    ])
    expect([e.kind, e.title, e.task_id, e.done]).toEqual(['milestone', 'Beta', null, false])
    const at = new Date(e.at)
    expect([at.getFullYear(), at.getMonth(), at.getDate()]).toEqual([2026, 9, 16])
  })
  it('shows a reached milestone as done', () => {
    expect(milestoneCalendarEvents([{ id: 'm', name: 'B', due_on: '2026-10-16', reached_at: '2026-10-10T00:00:00Z' }])[0].done).toBe(true)
  })
})
```

Run: `npx vitest run src/lib/work`. Expect FAIL.

- [ ] **Step 2: Implement**

In `timeline.ts`, after `placeBand`:

```ts
/** A single dated point drawn above the tasks: a milestone, at noon on its day. */
export type Mark = { id: string; label: string; at: number }

export function milestoneMarks(milestones: readonly { id: string; name: string; due_on: string }[]): Mark[] {
  return milestones.map((m) => ({ id: m.id, label: m.name, at: dayStart(m.due_on) + DAY / 2 }))
}

export function placeMark(mark: Mark, window: TimelineWindow) {
  if (window.source === 'none' || mark.at < window.start || mark.at > window.end) return null
  return offset(mark.at, window)
}
```

In `src/lib/types.ts`, add `| 'milestone'` to `CalendarKind`. Do not add it to `CALENDAR_KINDS`. In `eventLook.ts`, add:

```ts
  // A milestone is a goal on the plan, not a deadline: outlined in the accent,
  // so it reads apart from task and project dues.
  milestone: {
    cls: 'surface text-ink ring-1 ring-amber-400/70 ring-inset',
    icon: 'pin',
    dot: 'bg-amber-400',
  },
```

In `calendar.ts`, add `Milestone` to the `./types` import and add this function, reusing the existing `noonOf`:

```ts
/** Each milestone on its day. Opens no task: `task_id` is null. */
export function milestoneCalendarEvents(
  milestones: readonly Pick<Milestone, 'id' | 'name' | 'due_on' | 'reached_at'>[],
): CalendarEvent[] {
  return milestones.map((m) => ({
    kind: 'milestone', ref_id: m.id, title: m.name, at: noonOf(m.due_on),
    class_id: '', class_initial: '', class_name: '', project_id: '', project_title: 'Milestone',
    task_id: null, group_name: null, done: Boolean(m.reached_at), late: false,
  }))
}
```

In `TimelineView.tsx`:
- Import `placeMark` and `type Mark`.
- Add the prop `marks = []` (`marks?: Mark[]`, doc `/** Milestones, as diamonds in a row of their own. */`).
- Compute `const pinned = marks.flatMap((mark) => { const left = placeMark(mark, window); return left === null ? [] : [{ mark, left }] })`.
- Render this row directly after the Sprints row:

```tsx
          {pinned.length > 0 && (
            <div className="flex items-center border-b border-line">
              <p className="w-[14rem] shrink-0 px-3 py-1.5 text-[11px] font-medium text-faint uppercase">Milestones</p>
              <div className="relative h-8 flex-1">
                {pinned.map(({ mark, left }) => (
                  <span
                    key={mark.id}
                    role="img"
                    tabIndex={0}
                    aria-label={`Milestone: ${mark.label}`}
                    title={mark.label}
                    className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-amber-400 ring-2 ring-[var(--surface)]"
                    style={{ left: `${left}%` }}
                  />
                ))}
              </div>
            </div>
          )}
```

Also add a legend item, shown only when there are pinned marks: `<span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rotate-45 bg-amber-400" />milestone</span>`.

- [ ] **Step 3: Check**

Run: `npx vitest run src/lib/work` and expect PASS. Run: `npx tsc -b` and expect it clean; add `milestone` to any other exhaustive kind map reported. Run: `npx eslint src/lib/work src/components/work src/components/calendar` and expect it clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/work/timeline.ts src/lib/work/timeline.test.ts src/lib/work/calendar.ts src/lib/work/calendar.test.ts src/lib/types.ts src/components/calendar/eventLook.ts src/components/work/TimelineView.tsx
git commit -m "Show milestones on the timeline and the task calendar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Milestones view

**Files:**
- Create: `src/components/work/MilestoneDialog.tsx`
- Create: `src/components/work/TagTasksDialog.tsx`
- Create: `src/components/work/MilestonesView.tsx`

**Interfaces:**
- Consumes:
  - Task 3: `MilestoneSource`, `Milestone`, `MilestoneInput`, `WorkItem`, and `milestoneProgress`, `milestoneStatus`, `MILESTONE_STATUS_LABEL`, `dueInLabel`, `sortMilestones`.
  - UI primitives (`Modal`, `Field` / `Input`, `Textarea`, `Button`, `Alert`, `ConfirmDialog`, `Icon`, `useToast`), `authErrorMessage`, `formatDay`, `useNow`.
- Produces:
  - `MilestoneDialog({ open, onClose, title, submitLabel, initial, onSubmit })`
  - `TagTasksDialog({ open, onClose, milestone, source })`
  - `MilestonesView({ source })`

- [ ] **Step 1: `MilestoneDialog.tsx`**

Follow `src/components/work/SprintDialog.tsx` exactly, including how it validates, sets busy, catches errors with `authErrorMessage`, uses the Modal footer and guards `onClose` while busy. Change only these:
- The fields are **Name** (`maxLength={80}`), **Due** (`type="date"`), and **Description** (optional, `rows={3}`, `maxLength={1000}`, hint "What reaching it means, in a sentence.").
- Validation errors: "A milestone needs a name." and "A milestone needs a due date."
- Types: `initial: MilestoneInput` and `onSubmit: (input: MilestoneInput) => Promise<unknown>`.

```tsx
// src/components/work/MilestoneDialog.tsx — the body, after SprintDialog's pattern
export function MilestoneDialog({
  open, onClose, title, submitLabel, initial, onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  submitLabel: string
  initial: MilestoneInput
  onSubmit: (input: MilestoneInput) => Promise<unknown>
}) {
  const [name, setName] = useState(initial.name)
  const [dueOn, setDueOn] = useState(initial.dueOn)
  const [description, setDescription] = useState(initial.description)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    if (!name.trim()) return setError('A milestone needs a name.')
    if (!dueOn) return setError('A milestone needs a due date.')
    setBusy(true)
    try {
      await onSubmit({ name, description, dueOn })
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the milestone.'))
    } finally {
      setBusy(false)
    }
  }
  // …Modal with onClose={busy ? () => {} : onClose}, footer Cancel / {submitLabel},
  // fields Name, Due, Description as above — same markup as SprintDialog.
}
```

- [ ] **Step 2: `TagTasksDialog.tsx`**

```tsx
// src/components/work/TagTasksDialog.tsx
import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { authErrorMessage } from '../../lib/authError'
import type { Milestone, MilestoneSource } from '../../lib/work/types'

/** Pick unfinished tasks to count toward a milestone. A task can count toward one milestone at a time. */
export function TagTasksDialog({
  open,
  onClose,
  milestone,
  source,
}: {
  open: boolean
  onClose: () => void
  milestone: Milestone
  source: MilestoneSource
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const candidates = source.items.filter((i) => i.status !== 'done' && i.milestone_id !== milestone.id)
  const nameOf = (id: string | null) => source.milestones.find((m) => m.id === id)?.name

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function save() {
    setError(null)
    setBusy(true)
    try {
      await source.tag([...picked].filter((id) => candidates.some((c) => c.id === id)), milestone.id)
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not tag those tasks.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Tasks for ${milestone.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={picked.size === 0}>
            Tag {picked.size || ''} {picked.size === 1 ? 'task' : 'tasks'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        {candidates.length === 0 ? (
          <p className="text-[14px] text-muted">Every unfinished task already counts toward this milestone.</p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-[var(--line)] overflow-y-auto rounded-xl border border-line">
            {candidates.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={picked.has(item.id)}
                    onChange={() => toggle(item.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-navy-600)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-ink">{item.title}</span>
                    {item.milestone_id && (
                      <span className="block text-[12px] text-faint">Moves from {nameOf(item.milestone_id) ?? 'another milestone'}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3: `MilestonesView.tsx`**

```tsx
// src/components/work/MilestonesView.tsx
import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { MilestoneDialog } from './MilestoneDialog'
import { TagTasksDialog } from './TagTasksDialog'
import { useNow } from '../../hooks/useNow'
import { authErrorMessage } from '../../lib/authError'
import { formatDay } from '../../lib/general/dates'
import { addDays, toDay } from '../../lib/work/sprints'
import {
  MILESTONE_STATUS_LABEL,
  dueInLabel,
  milestoneProgress,
  milestoneStatus,
  sortMilestones,
} from '../../lib/work/milestones'
import type { MilestoneStatus } from '../../lib/work/milestones'
import type { Milestone, MilestoneSource } from '../../lib/work/types'

const TONE: Record<MilestoneStatus, string> = {
  reached: 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-300',
  late: 'bg-danger-50 text-danger-700 dark:bg-danger-500/15 dark:text-danger-300',
  at_risk: 'bg-warning-50 text-warning-800 dark:bg-warning-400/15 dark:text-warning-300',
  upcoming: 'bg-pending-soft text-pending-ink',
}

function StatusPill({ status }: { status: MilestoneStatus }) {
  return (
    <span className={`rounded-md px-2 py-0.5 text-[12px] font-medium ${TONE[status]}`}>
      {MILESTONE_STATUS_LABEL[status]}
    </span>
  )
}

function Bar({ pct }: { pct: number }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full surface-sunken">
      <span className="block h-full rounded-full bg-progress" style={{ width: `${pct}%` }} />
    </span>
  )
}

/**
 * Dated goals and how close each one is. A milestone's progress is the share
 * of its tagged tasks that are done; a professor sees that per group.
 */
export function MilestonesView({ source }: { source: MilestoneSource }) {
  const now = useNow()
  const { show } = useToast()
  const [createKey, setCreateKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Milestone | null>(null)
  const [deleting, setDeleting] = useState<Milestone | null>(null)
  const [tagging, setTagging] = useState<Milestone | null>(null)
  const list = sortMilestones(source.milestones)
  // A professor's source carries one group per board; everyone else reads their own items.
  const professor = source.groups.length > 0

  async function run(action: () => Promise<unknown>, failure: string) {
    try {
      await action()
    } catch (err) {
      show(authErrorMessage(err, failure), 'error')
    }
  }

  return (
    <div className="space-y-5">
      {source.readOnlyReason && <Alert tone="info">{source.readOnlyReason}</Alert>}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3>Milestones</h3>
          <p className="mt-0.5 max-w-prose text-[13px] text-muted">
            Dated goals. Tag the tasks that count toward each one; its progress is how many of those are done.
          </p>
        </div>
        {source.canManage && (
          <Button
            size="sm"
            className="!rounded-lg"
            onClick={() => {
              setCreateKey((k) => k + 1)
              setCreating(true)
            }}
          >
            <Icon name="plus" size={15} />
            Add milestone
          </Button>
        )}
      </div>

      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">
          No milestones yet. {source.canManage ? 'Add the first one, such as a draft or a defense date.' : 'When one is set, it shows here.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((m) => {
            const progress = milestoneProgress(source.items, m.id)
            const status = milestoneStatus(m, progress, now)
            const tagged = source.items.filter((i) => i.milestone_id === m.id)
            return (
              <li key={m.id} className="card space-y-3 p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold text-ink">{m.name}</h4>
                      {!professor && <StatusPill status={status} />}
                    </div>
                    <p className="mt-0.5 font-mono text-[12px] text-faint">
                      {formatDay(m.due_on)} · {dueInLabel(m.due_on, now)}
                    </p>
                    {m.description && <p className="mt-1.5 max-w-prose text-[13px] text-muted">{m.description}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {source.canTag && (
                      <Button size="sm" variant="outline" className="!rounded-lg" onClick={() => setTagging(m)}>
                        <Icon name="plus" size={15} />
                        Tag tasks
                      </Button>
                    )}
                    {source.canMarkReached && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void run(() => source.setReached(m.id, !m.reached_at), 'Could not change that milestone.')}
                      >
                        {m.reached_at ? 'Not reached yet' : 'Mark reached'}
                      </Button>
                    )}
                    {source.canManage && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditing(m)}
                          aria-label={`Edit ${m.name}`}
                          className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                        >
                          <Icon name="edit" size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(m)}
                          aria-label={`Delete ${m.name}`}
                          className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-500/12 dark:hover:text-danger-400"
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {professor ? (
                  source.groups.length === 0 ? (
                    <p className="text-[13px] text-faint">No group has a board yet.</p>
                  ) : (
                    <ul className="divide-y divide-[var(--line)]">
                      {source.groups.map((g) => {
                        const p = milestoneProgress(g.items, m.id)
                        return (
                          <li key={g.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0">
                            <span className="min-w-[8rem] flex-1 truncate text-[14px] text-ink">{g.name}</span>
                            <span className="w-28 shrink-0"><Bar pct={p.pct} /></span>
                            <span className="w-16 shrink-0 text-right font-mono text-[12px] text-faint">
                              {p.done}/{p.total}
                            </span>
                            <StatusPill status={milestoneStatus(m, p, now)} />
                          </li>
                        )
                      })}
                    </ul>
                  )
                ) : (
                  <>
                    <div>
                      <div className="mb-1 flex items-baseline justify-between text-[12px]">
                        <span className="text-muted">
                          <strong className="text-ink">{progress.done} of {progress.total}</strong> tagged tasks done
                        </span>
                        <span className="font-mono text-faint">{progress.pct}%</span>
                      </div>
                      <Bar pct={progress.pct} />
                    </div>
                    {tagged.length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-[13px] text-muted">
                          {tagged.length} {tagged.length === 1 ? 'task' : 'tasks'}
                        </summary>
                        <ul className="mt-2 space-y-1">
                          {tagged.map((i) => (
                            <li key={i.id} className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => source.openTask(i.id)}
                                className={`min-w-0 flex-1 truncate text-left text-[13px] hover:underline ${i.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}
                              >
                                {i.title}
                              </button>
                              {source.canTag && (
                                <button
                                  type="button"
                                  onClick={() => void run(() => source.tag([i.id], null), 'Could not untag that task.')}
                                  aria-label={`Stop counting ${i.title} toward ${m.name}`}
                                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                                >
                                  <Icon name="x" size={14} />
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <MilestoneDialog
        key={createKey}
        open={creating}
        onClose={() => setCreating(false)}
        title="New milestone"
        submitLabel="Add milestone"
        initial={{ name: '', description: '', dueOn: addDays(toDay(now), 14) }}
        onSubmit={(input) => source.createMilestone(input)}
      />
      {editing && (
        <MilestoneDialog
          key={editing.id}
          open
          onClose={() => setEditing(null)}
          title={`Edit ${editing.name}`}
          submitLabel="Save milestone"
          initial={{ name: editing.name, description: editing.description, dueOn: editing.due_on }}
          onSubmit={(input) => source.updateMilestone(editing.id, input)}
        />
      )}
      {tagging && <TagTasksDialog open onClose={() => setTagging(null)} milestone={tagging} source={source} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await source.deleteMilestone(deleting.id)
        }}
        title={`Delete ${deleting?.name ?? 'this milestone'}?`}
        body="Its tasks stay where they are; they just stop counting toward it."
        confirmLabel="Delete milestone"
        tone="danger"
      />
    </div>
  )
}
```

Confirm that `bg-success-50`, `bg-warning-50` and `bg-pending-soft` exist as utilities in `src/styles/index.css`. If one does not, use the closest existing status tint, for example the one `StageBadge` in `src/components/tasks/StageSelect.tsx` uses.

- [ ] **Step 4: Check**

Run: `npx tsc -b` and `npx eslint src/components/work`. Expect both clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/work/MilestoneDialog.tsx src/components/work/TagTasksDialog.tsx src/components/work/MilestonesView.tsx
git commit -m "Add the Milestones view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Milestones in work projects

**Files:**
- Modify: `src/components/general/useGeneralProject.ts`, `workSource.ts`, `WorkTab.tsx`, `TasksTab.tsx`

**Interfaces:**
- Produces: `GeneralProjectState.milestones: Milestone[]` and `generalMilestoneSource(state, openTask): MilestoneSource`.

- [ ] **Step 1: Load milestones with the project**

In `useGeneralProject.ts`, do what Part 2 did for sprints:
- Add `milestones: Milestone[]` to the state type (comment `/** Soonest due first. */`).
- Add `useState`.
- Reset it in the not-found branch.
- Add `listMilestones({ kind: 'work', projectId })` to the `Promise.all`, setting it from its destructured `ms` result.
- Add `'general_milestones'` to the `useLive` tables.
- Add it to the returned memo object and to that memo's deps.

- [ ] **Step 2: `generalMilestoneSource` in `workSource.ts`**

```ts
export function generalMilestoneSource(state: GeneralProjectState, openTask: (id: string) => void): MilestoneSource {
  const project = state.project
  const home: MilestoneHome = { kind: 'work', projectId: project?.id ?? '' }
  const can = Boolean(project) && !state.archived && state.can('manage_tasks')
  const then = async <T,>(action: Promise<T>) => {
    const result = await action
    await state.reload()
    return result
  }
  return {
    milestones: state.milestones,
    items: generalWorkSource(state, openTask).items,
    groups: [],
    canManage: can,
    canTag: can,
    canMarkReached: can,
    readOnlyReason: state.archived
      ? 'This project is archived, so nothing in it can change.'
      : can
        ? ''
        : 'Owners and Managers run the milestones. You can follow how close each one is.',
    openTask,
    createMilestone: (input) => then(createMilestone(home, input)),
    updateMilestone: (id, input) => then(updateMilestone(home, id, input)),
    deleteMilestone: (id) => then(deleteMilestone(home, id)),
    setReached: (id, reached) => then(setMilestoneReached(id, reached)),
    tag: (ids, milestoneId) => then(tagTasks(home, ids, milestoneId)),
  }
}
```

Import the API functions, `type MilestoneHome` and `type MilestoneSource`.

- [ ] **Step 3: The section, and marks on Tasks**

In `WorkTab.tsx`, add a `section === 'milestones'` branch rendering `<MilestonesView source={generalMilestoneSource(state, showTask)} />`.

In `TasksTab.tsx`:
- Pass `marks={milestoneMarks(state.milestones)}` to `TimelineView`.
- Append `...milestoneCalendarEvents(state.milestones)` to the calendar events.

- [ ] **Step 4: Check and commit**

Run: `npm run build`, `npx eslint src/components/general src/components/work`, `npx vitest run`. Expect all clean.

```bash
git add src/components/general/useGeneralProject.ts src/components/general/workSource.ts src/components/general/WorkTab.tsx src/components/general/TasksTab.tsx
git commit -m "Run milestones in work projects

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Milestones in class projects

**Files:**
- Modify: `src/components/tasks/useProjectTasks.ts`, `classWorkSource.ts`, `StudentTasksView.tsx`, `ProfessorTasksView.tsx`, `FanOutForm.tsx`

**Interfaces:**
- Produces:
  - `useProjectTasks` returns `milestones: Milestone[]`, loaded per project with live updates.
  - `classWorkItem(task: ProjectTask): WorkItem`, exported from `classWorkSource.ts`.
  - `classMilestoneSource(t, project): MilestoneSource`.
  - `FanOutForm` gets the prop `milestones: Milestone[]`.

- [ ] **Step 1: Load the project's milestones**

In `useProjectTasks.ts`, add the following, keyed on `project.id`:

```ts
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const loadMilestones = useCallback(async () => {
    try {
      setMilestones(await listMilestones({ kind: 'class', projectId: project.id }))
    } catch {
      setMilestones([])
    }
  }, [project.id])
  useEffect(() => {
    void loadMilestones()
  }, [loadMilestones])
  useLive(loadMilestones, ['project_milestones'])
```

Then add `loadMilestones()` to `refresh`, and return `milestones`.

- [ ] **Step 2: `classWorkItem` and `classMilestoneSource`**

In `classWorkSource.ts`, lift the existing `t.tasks.map((task) => ({ … }))` body into an exported function, `classWorkItem(task: ProjectTask): WorkItem`, which includes `milestone_id`. Use it in `classWorkSource`. Then add:

```ts
/**
 * A class project's milestones. The professor sets them and follows every
 * group; a student tags their own board's tasks while it is open.
 */
export function classMilestoneSource(t: ProjectTasks, projectId: string): MilestoneSource {
  const home = { kind: 'class', projectId } as const
  const board = t.active
  const canTag = !t.isProfessor && Boolean(board) && canPlanBoard(board, t.locked)
  const then = async <T,>(action: Promise<T>) => {
    const result = await action
    await t.refresh()
    return result
  }
  return {
    milestones: t.milestones,
    items: t.isProfessor ? [] : t.tasks.map(classWorkItem),
    groups: t.isProfessor
      ? (t.boards ?? []).map((b) => ({
          id: b.id,
          name: boardOwnerName(b),
          items: t.rows.filter((r) => r.board_id === b.id).map(classWorkItem),
        }))
      : [],
    canManage: t.isProfessor,
    canTag,
    canMarkReached: false,
    readOnlyReason: t.isProfessor
      ? ''
      : !board
        ? ''
        : canTag
          ? ''
          : 'Your board is handed in or the project is closed, so tags are paused.',
    openTask: (id) => t.showTask(id),
    createMilestone: (input) => then(createMilestone(home, input)),
    updateMilestone: (id, input) => then(updateMilestone(home, id, input)),
    deleteMilestone: (id) => then(deleteMilestone(home, id)),
    setReached: async () => undefined,
    tag: (ids, milestoneId) => then(tagTasks(home, ids, milestoneId)),
  }
}
```

`t.rows` are `ProjectTaskRow`s, which extend `ProjectTask`, so `classWorkItem` accepts them. Import `boardOwnerName` from `../../lib/types`.

- [ ] **Step 3: The views**

In both `StudentTasksView.tsx` and `ProfessorTasksView.tsx`, add a `t.section === 'milestones'` branch rendering `<MilestonesView source={classMilestoneSource(t, project.id)} />`:
- In the student view, put it next to the backlog and sprints branch.
- In the professor view, put it as its own `section` block, with no group picker: the professor sees every group's row.
- The student `TaskDetailModal` guard already covers non-`tasks` sections.

In both views' Tasks layouts:
- Pass `marks={milestoneMarks(t.milestones)}` to `TimelineView`.
- Append `...milestoneCalendarEvents(t.milestones)` to the calendar events. In the professor view, show these whether or not a board is chosen.

- [ ] **Step 4: `FanOutForm` milestone**

- Add the prop `milestones: Milestone[]`, the state `const [milestoneId, setMilestoneId] = useState(editing?.milestone_id ?? '')`, and the imports for `setOriginMilestone`, `Select` (already imported) and `type Milestone`.
- When `milestones.length > 0`, render a labelled select above `TaskForm`, styled like the "Who gets it" label block: label "Counts toward" (optional), placeholder "No milestone", options from `milestones` by `name`.
- In `save`, after a successful create, if `milestoneId` is set and `res.origin_id` exists, call `await setOriginMilestone(res.origin_id, milestoneId)`.
- After a successful update, if `milestoneId !== (editing.milestone_id ?? '')`, call `await setOriginMilestone(editing.origin_id, milestoneId || null)`.
- In `ProfessorTasksView.tsx`, pass `milestones={t.milestones}` to `FanOutForm`.

- [ ] **Step 5: Check and commit**

Run: `npm run build`, `npx eslint src`, `npx vitest run`. Expect all clean.

```bash
git add src/components/tasks/useProjectTasks.ts src/components/tasks/classWorkSource.ts src/components/tasks/StudentTasksView.tsx src/components/tasks/ProfessorTasksView.tsx src/components/tasks/FanOutForm.tsx
git commit -m "Let professors set milestones and groups tag their tasks to them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Verify, hand off, push

**Files:**
- Modify: `handoff.md`

- [ ] **Step 1: Browser checks** (dev server, using `preview_start` with `collabify`). Do not create data in a real project; if a write check needs one, ask the owner first.
  - **Work project as a Member:** Milestones shows the read-only note and lists milestones with status and progress.
  - **Class project as a student:** Milestones lists the professor's milestones, and Tag tasks opens the picker while the board is open.
  - **As a professor:** each milestone shows a progress row per group.
  - **Timeline and Calendar:** Timeline shows the Milestones row when any milestone falls in its window, and Calendar shows milestone chips.
  - **Layout and theme:** no sideways scroll at 375 px; dark mode is readable; the console is clean.

- [ ] **Step 2: Append to `handoff.md`.** This covers what changed, who does what, the SQL files (applied live) and their re-run notes, the code, the checks with real numbers, what was not tried, and "Next: Part 4, Summary". Also add one line under the existing "Milestones — decided against" section: "Revisited 2026-10-07: milestones returned as generic dated goals tagged on tasks (Work tab, Part 3), not the defense track."

- [ ] **Step 3: Commit and push**

```bash
git add handoff.md
git commit -m "Hand off Work tab part 3

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin claude/work-tab-3
```

---

## Self-review notes

- Spec coverage for Part 3:
  - Work milestones: SQL in Task 1, the view in Task 6, wiring in Task 7.
  - Class milestones set by the professor with per-group progress: Tasks 2, 6 and 8.
  - Students tag their own tasks: Tasks 2, 6 and 8.
  - Professor fan-out milestone: Tasks 2 and 8.
  - Chips: the Milestones view shows tagged tasks per milestone. Backlog and Board chips were left out (YAGNI); the Milestones view covers them.
  - Diamonds on the Timeline and milestones on the Calendar: Task 5.
  - Mark reached by hand in work projects: Tasks 1 and 7.
  - The handoff note on the earlier decision: Task 9.
- Not in this part: Summary's next-milestone card (Part 4).
