# Work tab, Part 2 — Backlog and Sprints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sprints and an ordered backlog to every project's Work tab in both spaces: plan sprints from the Backlog, run and finish them on Sprints, and filter Tasks to a sprint.

**Architecture:**
- **Database:** each space gets a sprint table. Work projects use `general_sprints`, owned by the project. Class projects use `board_sprints`, owned by one group's board. Both task tables gain `sprint_id`, which has a composite FK so a task can only join a sprint in its own project or board, and a `rank` for backlog order. Rules live in the database: state triggers, RLS, one running sprint per project or board, and one finish RPC per space.
- **Frontend:** a space-agnostic `WorkSource` object feeds the shared Backlog and Sprints views. It holds the tasks, the sprints, the viewer's rights and the actions. Each space builds its own `WorkSource` with a plain function, and one `lib/api/sprints.ts` talks to either table.

**Tech Stack:** React 19 + TypeScript + Vite, react-router `useSearchParams`, Tailwind tokens, Vitest, and Supabase Postgres. SQL runs with `node scripts/db.mjs <file>`. The owner has authorized applying it to the live database.

**Spec:** `docs/superpowers/specs/2026-10-06-work-tab-sprints-milestones-design.md`. This plan covers rollout Part 2. Part 1 is merged: see the end of `handoff.md`.

## Global Constraints

- Use tokens only for colour: `surface*`, `text-ink/muted/faint`, `border-line*`, `navy-*`, `amber-*`, and the status ramps `success-*` / `warning-*` / `danger-*` / `pending-*`. Never use `emerald-*`, `red-*`, or brand amber for a status.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully". Errors say what happened and what to do next.
- Design desktop first, then tablet, then phone. At 375 px there must be no sideways page scroll.
- `supabase/*.sql` files must be idempotent. They get re-run.
- Every new table has RLS. No new function is executable by `anon`. `supabase/tests/rls-coverage.test.sql` and `anon-lockdown.test.sql` must still pass.
- Run `npm run build` before claiming anything works.
- Commit messages are plain imperative sentences and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage files explicitly. Never stage `.claude/launch.json`, `.gitignore` or `supabase/.temp/`.
- Who plans:
  - Work space: anyone with `manage_tasks`, which means Owners and Managers. Members can still add tasks, and those land in the backlog.
  - Class: any member of the board while it is open, meaning the project is not locked and the board is not handed in.
  - Professors only read.
- Sprint lifecycle: Planned → Running → Finished, in that order only. There is one running sprint per project or board. A finished sprint can no longer change. Only a planned sprint can be deleted, and its tasks go back to the backlog.
- **Backlog** means unfinished tasks in no sprint, ordered by `rank` ascending (top = do next).
- Deliberate deviations from the spec:
  - One shared `src/lib/api/sprints.ts` serves both spaces, instead of separate functions in `general.ts` and `tasks.ts`. Same calls, half the code.
  - The task dialogs get no Sprint select. New tasks join the sprint that Tasks is scoped to, and tasks move between sprints on Backlog.
  - Sprint changes are not written to the task event logs.

## File map

| File | Status | Responsibility |
|---|---|---|
| `supabase/work-planning.sql` (+ `tests/work-planning.test.sql`) | new | `sprint_state` enum, shared sprint triggers, `general_sprints`, `general_tasks.sprint_id/rank`, plan guard, `complete_general_sprint`, overview view |
| `supabase/class-planning.sql` (+ `tests/class-planning.test.sql`) | new | `board_sprints`, `project_tasks.sprint_id/rank`, `complete_board_sprint`, detail view |
| `docs/07-backup.md` | modify | Add both files to the run list, plus re-run notes |
| `src/lib/work/types.ts` | new | `Sprint`, `SprintInput`, `WorkItem`, `WorkSource` |
| `src/lib/work/sprints.ts` (+ test) | new | Running/planned/finished, days left, next draft, counts, burndown |
| `src/lib/work/backlog.ts` (+ test) | new | Backlog and sprint lists, rank maths |
| `src/lib/work/scope.ts` (+ test) | new | Tasks scope (running / all / backlog / one sprint) |
| `src/lib/work/nav.ts` (+ test) | modify | Sections `backlog`, `sprints`, and the `scope` param |
| `src/lib/work/timeline.ts` (+ test), `calendar.ts` (+ test) | modify | Sprint bands, sprint calendar events |
| `src/lib/types.ts`, `src/components/calendar/eventLook.ts`, `EventChip.tsx` | modify | Calendar kinds `sprint_start` / `sprint_end` |
| `src/lib/api/sprints.ts` | new | Sprint CRUD, start, finish, move, rank for either space |
| `src/lib/general/types.ts`, `src/lib/api/general.ts`, `src/lib/api/tasks.ts` | modify | `sprint_id` / `rank` fields, new task into a sprint |
| `src/components/work/ScopePicker.tsx`, `SprintDialog.tsx`, `FinishSprintDialog.tsx`, `Burndown.tsx` | new | Small shared pieces |
| `src/components/work/BacklogView.tsx`, `SprintsView.tsx` | new | The two new sections |
| `src/components/work/WorkNav.tsx`, `TimelineView.tsx` | modify | Four sections, sprint band row |
| `src/components/general/useGeneralProject.ts`, `workSource.ts` (new), `WorkTab.tsx`, `TasksTab.tsx` | modify | Work-space wiring |
| `src/components/tasks/useProjectTasks.ts`, `classWorkSource.ts` (new), `StudentTasksView.tsx`, `ProfessorTasksView.tsx`, `TaskBoard.tsx` | modify | Class wiring |
| `handoff.md` | modify | New section |

---

### Task 1: Sprints for work projects (`supabase/work-planning.sql`)

**Files:**
- Create: `supabase/work-planning.sql`
- Create: `supabase/tests/work-planning.test.sql`
- Modify: `docs/07-backup.md` (run list line 26, plus a re-run note near lines 29–40)

**Interfaces:**
- Produces:
  - **Enum and shared triggers:** enum `public.sprint_state('planned','active','completed')`, and the shared trigger functions `public.prepare_sprint()` and `public.guard_sprint_state()`. Task 2 reuses all three.
  - **Sprint table:** `public.general_sprints(id, project_id, name, goal, starts_on date, ends_on date, state, started_at, completed_at, created_by, created_at)`.
  - **New task columns:** `general_tasks.sprint_id uuid null` and `general_tasks.rank double precision not null`.
  - **Overview view:** `general_task_overview` gains the columns `sprint_id, rank`.
  - **Finish RPC:** `public.complete_general_sprint(p_sprint uuid, p_carry_to uuid default null) returns void`.
  - **Constraint name, used by the client error mapping:** `general_sprints_one_running`.

- [ ] **Step 1: Write the test**

```sql
-- supabase/tests/work-planning.test.sql
-- Sprints and backlog order on a work project. Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/work-planning.test.sql
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

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

/** Runs a statement and asserts it is refused. */
create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
    return;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

do $$
declare
  v_ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_names text[] := array['Owner', 'Member', 'Outsider'];
  i int;
  a uuid; b uuid; d uuid;
  p uuid; p2 uuid; v_inv uuid;
  s1 uuid; s2 uuid; s_other uuid; s_gone uuid;
  t_open uuid; t_done uuid; t_member uuid; t_gone uuid; t_new uuid;
  r1 double precision; r2 double precision;
  n int;
begin
  for i in 1..3 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_user_meta_data, created_at, updated_at)
    values (v_ids[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-wplan-' || lower(v_names[i]) || '@example.test', '',
            jsonb_build_object('first_name', 'Zzwplan', 'last_name', v_names[i], 'role', 'professor'),
            now(), now());
  end loop;
  -- General accounts are approved faculty: supabase/access.sql.
  update public.profiles set status = 'active'
   where id = any (v_ids) and role = 'faculty' and status = 'pending';
  a := v_ids[1]; b := v_ids[2]; d := v_ids[3];

  perform pg_temp.act_as(a);
  p  := (public.create_general_project('Zz sprint project')).id;
  p2 := (public.create_general_project('Zz other project')).id;
  select id into v_inv from public.invite_to_general_project(p, b);
  perform pg_temp.act_as(b);
  perform public.respond_general_invitation(v_inv, true);

  ------------------------------------------------------------ creating
  perform pg_temp.act_as(a);
  insert into public.general_sprints (project_id, name, starts_on, ends_on, state)
  values (p, 'Sprint 1', current_date, current_date + 13, 'active') returning id into s1;
  perform pg_temp.must_be('a new sprint is always planned, whatever was sent',
    (select state from public.general_sprints where id = s1) = 'planned');
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Sprint 2', current_date + 14, current_date + 27) returning id into s2;
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p2, 'Elsewhere', current_date, current_date + 13) returning id into s_other;

  perform pg_temp.must_refuse('a sprint cannot end before it starts',
    format($q$insert into public.general_sprints (project_id, name, starts_on, ends_on)
              values (%L, 'Backwards', current_date, current_date - 1)$q$, p));

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('a member without manage_tasks cannot create a sprint',
    format($q$insert into public.general_sprints (project_id, name, starts_on, ends_on)
              values (%L, 'Mine', current_date, current_date + 1)$q$, p));
  perform pg_temp.must_be('a member can read the sprints',
    exists (select 1 from public.general_sprints where id = s1));

  perform pg_temp.act_as(d);
  perform pg_temp.must_be('an outsider cannot read the sprints',
    not exists (select 1 from public.general_sprints where id = s1));

  ------------------------------------------------------------ tasks and rank
  perform pg_temp.act_as(b);
  insert into public.general_tasks (project_id, title) values (p, 'Member task') returning id into t_member;
  perform pg_temp.must_be('a member can add a task, and it lands in the backlog',
    (select sprint_id from public.general_tasks where id = t_member) is null);
  perform pg_temp.must_refuse('a member cannot put a task in a sprint',
    format('update public.general_tasks set sprint_id = %L where id = %L', s1, t_member));
  perform pg_temp.must_refuse('a member cannot add a task straight into a sprint',
    format($q$insert into public.general_tasks (project_id, title, sprint_id) values (%L, 'Sneaky', %L)$q$, p, s1));
  perform pg_temp.must_refuse('a member cannot reorder the backlog',
    format('update public.general_tasks set rank = -1 where id = %L', t_member));

  perform pg_temp.act_as(a);
  insert into public.general_tasks (project_id, title) values (p, 'Open task') returning id into t_open;
  insert into public.general_tasks (project_id, title) values (p, 'Done task') returning id into t_done;
  select rank into r1 from public.general_tasks where id = t_open;
  select rank into r2 from public.general_tasks where id = t_done;
  perform pg_temp.must_be('a later task ranks below an earlier one', r2 > r1);

  update public.general_tasks set sprint_id = s1 where id in (t_open, t_done);
  perform pg_temp.must_be('a manager can move tasks into a sprint',
    (select count(*) from public.general_tasks where sprint_id = s1) = 2);
  perform pg_temp.must_refuse('a task cannot join another project''s sprint',
    format('update public.general_tasks set sprint_id = %L where id = %L', s_other, t_open));
  update public.general_tasks set status = 'done' where id = t_done;

  ------------------------------------------------------------ running
  update public.general_sprints set state = 'active' where id = s1;
  perform pg_temp.must_be('starting a sprint stamps when it started',
    (select started_at is not null and state = 'active' from public.general_sprints where id = s1));
  perform pg_temp.must_refuse('only one sprint runs at a time',
    format($q$update public.general_sprints set state = 'active' where id = %L$q$, s2));
  perform pg_temp.must_refuse('a running sprint cannot go back to planned',
    format($q$update public.general_sprints set state = 'planned' where id = %L$q$, s1));

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('a member cannot finish a sprint',
    format('select public.complete_general_sprint(%L, null)', s1));

  perform pg_temp.act_as(a);
  perform pg_temp.must_refuse('unfinished work can only move to a planned sprint',
    format('select public.complete_general_sprint(%L, %L)', s1, s_other));
  perform public.complete_general_sprint(s1, s2);
  perform pg_temp.must_be('finishing moves unfinished tasks to the chosen sprint',
    (select sprint_id from public.general_tasks where id = t_open) = s2);
  perform pg_temp.must_be('finished tasks stay in the sprint they were done in',
    (select sprint_id from public.general_tasks where id = t_done) = s1);
  perform pg_temp.must_be('the sprint is finished and stamped',
    (select state = 'completed' and completed_at is not null from public.general_sprints where id = s1));
  perform pg_temp.must_refuse('a finished sprint cannot change',
    format($q$update public.general_sprints set name = 'Renamed' where id = %L$q$, s1));

  ------------------------------------------------------------ deleting
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Short-lived', current_date + 30, current_date + 40) returning id into s_gone;
  insert into public.general_tasks (project_id, title, sprint_id) values (p, 'In it', s_gone) returning id into t_gone;
  delete from public.general_sprints where id = s_gone;
  perform pg_temp.must_be('deleting a planned sprint puts its tasks back in the backlog',
    (select sprint_id from public.general_tasks where id = t_gone) is null);
  delete from public.general_sprints where id = s1;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a finished sprint cannot be deleted', n = 0
    and exists (select 1 from public.general_sprints where id = s1));

  ------------------------------------------------------------ the overview
  insert into public.general_tasks (project_id, title, sprint_id) values (p, 'Visible', s2) returning id into t_new;
  perform pg_temp.must_be('the task overview carries sprint and rank',
    (select sprint_id = s2 and rank is not null from public.general_task_overview where id = t_new));

  perform pg_temp.act_as_service();
end $$;

rollback;
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node scripts/db.mjs supabase/tests/work-planning.test.sql`
Expected: ERROR `relation "public.general_sprints" does not exist`.

- [ ] **Step 3: Write `supabase/work-planning.sql`**

First check the live view so the copy below matches it:

```bash
node scripts/db.mjs -c "select pg_get_viewdef('public.general_task_overview'::regclass, true)"
```

Expected columns, in order: `id, project_id, team_id, title, description, status, due_at, weight, created_by, completed_at, created_at, updated_at, assignee_ids, comment_count, file_count, logged_minutes, starts_at, archived_at, archived_by`, with `WHERE archived_at IS NULL OR general_sees_archived(project_id, archived_by)`. If anything differs, copy the live version and append `t.sprint_id, t.rank` at the end.

```sql
-- Collabify — sprints and backlog order for work projects (Work tab, Part 2).
--
--   node scripts/db.mjs supabase/work-planning.sql
--
-- A sprint is a short time box on one project: planned, then running, then
-- finished, in that order. One runs at a time. A task in no sprint is in the
-- backlog, and `rank` orders a list top to bottom (lower = sooner).
--
-- Who plans: anyone with manage_tasks (Owners and Managers). Members still
-- add tasks; theirs land in the backlog. guard_general_task is left alone: a
-- second trigger, general_tasks_plan_guard, owns the planning columns.
--
-- Also defines what class-planning.sql reuses: the sprint_state enum and the
-- prepare_sprint / guard_sprint_state trigger functions. Run this file first.
--
-- Redefines general_task_overview (owner: general-archive-rbac.sql) to append
-- sprint_id and rank. Re-run this file after re-running that one.
--
-- Idempotent. Safe to re-run.

begin;

do $$ begin
  create type public.sprint_state as enum ('planned', 'active', 'completed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- shared triggers

/** A new sprint always starts out planned, whatever the client sent. */
create or replace function public.prepare_sprint()
returns trigger language plpgsql set search_path = public as $$
begin
  new.state        := 'planned';
  new.started_at   := null;
  new.completed_at := null;
  new.created_by   := coalesce(auth.uid(), new.created_by);
  new.created_at   := now();
  return new;
end;
$$;

/**
 * Planned → running → finished, never backwards, and a finished sprint is
 * fixed. The timestamps are stamped here so a client cannot backdate them.
 * Shared by general_sprints and board_sprints, so the owning column is pinned
 * by table name.
 */
create or replace function public.guard_sprint_state()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.state = 'completed' then
    raise exception 'This sprint is finished, so it can no longer change.'
      using errcode = 'check_violation';
  end if;

  if new.state is distinct from old.state then
    if old.state = 'planned' and new.state = 'active' then
      new.started_at := now();
    elsif old.state = 'active' and new.state = 'completed' then
      new.completed_at := now();
    else
      raise exception 'A sprint goes from planned to running to finished, in that order.'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.state = old.state then
    new.started_at   := old.started_at;
    new.completed_at := old.completed_at;
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if tg_table_name = 'general_sprints' then
    new.project_id := old.project_id;
  else
    new.board_id := old.board_id;
  end if;
  return new;
end;
$$;

revoke all on function public.prepare_sprint() from public, anon;
revoke all on function public.guard_sprint_state() from public, anon;

-- ---------------------------------------------------------------- sprints

create table if not exists public.general_sprints (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.general_projects (id) on delete cascade,
  name         text not null,
  goal         text not null default '',
  starts_on    date not null,
  ends_on      date not null,
  state        public.sprint_state not null default 'planned',
  started_at   timestamptz,
  completed_at timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint general_sprints_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint general_sprints_goal_len check (char_length(goal) <= 500),
  constraint general_sprints_dates check (ends_on >= starts_on),
  constraint general_sprints_id_project unique (id, project_id)
);

create unique index if not exists general_sprints_one_running
  on public.general_sprints (project_id) where state = 'active';
create index if not exists general_sprints_project_idx
  on public.general_sprints (project_id, starts_on);

drop trigger if exists general_sprints_prepare on public.general_sprints;
create trigger general_sprints_prepare before insert on public.general_sprints
  for each row execute function public.prepare_sprint();
drop trigger if exists general_sprints_guard on public.general_sprints;
create trigger general_sprints_guard before update on public.general_sprints
  for each row execute function public.guard_sprint_state();

alter table public.general_sprints enable row level security;

drop policy if exists general_sprints_read on public.general_sprints;
create policy general_sprints_read on public.general_sprints
  for select to authenticated
  using (public.can_read_general_project(project_id));

drop policy if exists general_sprints_insert on public.general_sprints;
create policy general_sprints_insert on public.general_sprints
  for insert to authenticated
  with check (public.general_can(project_id, 'manage_tasks')
              and not public.general_is_archived(project_id));

drop policy if exists general_sprints_update on public.general_sprints;
create policy general_sprints_update on public.general_sprints
  for update to authenticated
  using (public.general_can(project_id, 'manage_tasks')
         and not public.general_is_archived(project_id))
  with check (public.general_can(project_id, 'manage_tasks')
              and not public.general_is_archived(project_id));

-- Only a sprint that never started can go; its tasks fall back to the backlog.
drop policy if exists general_sprints_delete on public.general_sprints;
create policy general_sprints_delete on public.general_sprints
  for delete to authenticated
  using (state = 'planned'
         and public.general_can(project_id, 'manage_tasks')
         and not public.general_is_archived(project_id));

revoke all on public.general_sprints from anon;
grant select, insert, update, delete on public.general_sprints to authenticated;

-- ---------------------------------------------------------------- tasks

alter table public.general_tasks add column if not exists sprint_id uuid;
alter table public.general_tasks add column if not exists rank double precision;

-- Existing tasks keep the order they were made in.
update public.general_tasks set rank = extract(epoch from created_at) where rank is null;
alter table public.general_tasks
  alter column rank set default extract(epoch from clock_timestamp()),
  alter column rank set not null;

-- A task can only join a sprint on its own project. Deleting a sprint puts its
-- tasks back in the backlog (the column list needs Postgres 15 or later).
do $$ begin
  alter table public.general_tasks
    add constraint general_tasks_sprint_fk foreign key (sprint_id, project_id)
    references public.general_sprints (id, project_id) on delete set null (sprint_id);
exception when duplicate_object then null; end $$;

create index if not exists general_tasks_sprint_idx
  on public.general_tasks (sprint_id) where sprint_id is not null;

/** Planning (sprint and order) is manage_tasks only; everything else is guard_general_task's. */
create or replace function public.guard_general_task_plan()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.sprint_id is not null and not public.general_can(new.project_id, 'manage_tasks') then
      raise exception 'Only someone who manages tasks can put a task in a sprint.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if (new.sprint_id is distinct from old.sprint_id or new.rank is distinct from old.rank)
     and not public.general_can(old.project_id, 'manage_tasks') then
    raise exception 'Only someone who manages tasks can plan sprints and order the backlog.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_general_task_plan() from public, anon;

drop trigger if exists general_tasks_plan_guard on public.general_tasks;
create trigger general_tasks_plan_guard before insert or update on public.general_tasks
  for each row execute function public.guard_general_task_plan();

-- ---------------------------------------------------------------- finishing

/**
 * Finish the running sprint in one step: its unfinished tasks move to a
 * planned sprint (or the backlog, when p_carry_to is null), then it closes.
 * Security invoker, so RLS and the guards apply to the caller as usual.
 */
create or replace function public.complete_general_sprint(p_sprint uuid, p_carry_to uuid default null)
returns void language plpgsql security invoker set search_path = public as $$
declare
  s public.general_sprints;
begin
  select * into s from public.general_sprints where id = p_sprint;
  if not found then
    raise exception 'That sprint is not there any more. Reload the page.';
  end if;
  if not public.general_can(s.project_id, 'manage_tasks') then
    raise exception 'Only someone who manages tasks can finish a sprint.'
      using errcode = 'insufficient_privilege';
  end if;
  if s.state <> 'active' then
    raise exception 'Only a running sprint can be finished.' using errcode = 'check_violation';
  end if;
  if p_carry_to is not null and not exists (
    select 1 from public.general_sprints
     where id = p_carry_to and project_id = s.project_id and state = 'planned'
  ) then
    raise exception 'Unfinished tasks can only move to a planned sprint on this project.'
      using errcode = 'check_violation';
  end if;

  update public.general_tasks
     set sprint_id = p_carry_to
   where sprint_id = p_sprint and status <> 'done' and archived_at is null;

  update public.general_sprints set state = 'completed' where id = p_sprint;
end;
$$;

revoke all on function public.complete_general_sprint(uuid, uuid) from public, anon;
grant execute on function public.complete_general_sprint(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- the overview

create or replace view public.general_task_overview
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
       t.rank
  from public.general_tasks t
 where t.archived_at is null or public.general_sees_archived(t.project_id, t.archived_by);

grant select on public.general_task_overview to authenticated;

-- ---------------------------------------------------------------- realtime

do $$ begin
  alter publication supabase_realtime add table public.general_sprints;
exception when duplicate_object then null; end $$;

commit;
```

- [ ] **Step 4: Apply it twice, then run the tests**

Run: `node scripts/db.mjs supabase/work-planning.sql && node scripts/db.mjs supabase/work-planning.sql`
Expected: `Done.` twice.

Run: `node scripts/db.mjs supabase/tests/work-planning.test.sql`
Expected: every line `PASS`, no `FAIL`.

Run: `node scripts/db.mjs supabase/tests/general-tasks.test.sql supabase/tests/general-schedule.test.sql supabase/tests/general-archive-rbac.test.sql supabase/tests/rls-coverage.test.sql supabase/tests/anon-lockdown.test.sql`
Expected: all PASS.

- [ ] **Step 5: Backup doc**

In `docs/07-backup.md` line 26, append ` supabase/work-planning.sql` to the end of the run list. Next to the existing re-run notes (around lines 29–40), add:

> Re-run `work-planning.sql` after re-running `general-archive-rbac.sql`. It redefines `general_task_overview` to add `sprint_id` and `rank`.

- [ ] **Step 6: Commit**

```bash
git add supabase/work-planning.sql supabase/tests/work-planning.test.sql docs/07-backup.md
git commit -m "Add sprints and backlog order to work projects

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Sprints for class boards (`supabase/class-planning.sql`)

**Files:**
- Create: `supabase/class-planning.sql`
- Create: `supabase/tests/class-planning.test.sql`
- Modify: `docs/07-backup.md`

**Interfaces:**
- Consumes (Task 1): `public.sprint_state`, `public.prepare_sprint()`, `public.guard_sprint_state()`.
- Produces:
  - **Sprint table:** `public.board_sprints(id, board_id, name, goal, starts_on, ends_on, state, started_at, completed_at, created_by, created_at)`.
  - **New task columns:** `project_tasks.sprint_id uuid null` and `project_tasks.rank double precision not null`. `task_detail_overview` carries both through `t.*`.
  - **Finish RPC:** `public.complete_board_sprint(p_sprint uuid, p_carry_to uuid default null) returns void`.
  - **Constraint name:** `board_sprints_one_running`.

- [ ] **Step 1: Write the test**

```sql
-- supabase/tests/class-planning.test.sql
-- Sprints and backlog order on a class board. Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/class-planning.test.sql
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

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
    return;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_proj2 uuid; v_board uuid; v_board2 uuid;
  s1 uuid; s2 uuid; s_other uuid;
  t_todo uuid; t_started uuid; t_done uuid;
  n int;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at
   limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-cplan-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Plan group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_group, v_set, v_a), (v_group, v_set, v_b);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at, release_at)
  values (v_class, v_prof, 'zz-cplan-fixture', 'activity', 1, 2, 'group', v_set,
          now() + interval '30 days', now() - interval '1 day')
  returning id into v_proj;
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at, release_at)
  values (v_class, v_prof, 'zz-cplan-fixture-2', 'activity', 1, 2, 'group', v_set,
          now() + interval '30 days', now() - interval '1 day')
  returning id into v_proj2;
  perform public.ensure_project_boards(v_proj);
  perform public.ensure_project_boards(v_proj2);
  select id into v_board from public.project_boards where project_id = v_proj limit 1;
  select id into v_board2 from public.project_boards where project_id = v_proj2 limit 1;

  ------------------------------------------------------------ creating
  perform pg_temp.act_as(v_a);
  insert into public.board_sprints (board_id, name, starts_on, ends_on, state)
  values (v_board, 'Sprint 1', current_date, current_date + 6, 'completed') returning id into s1;
  perform pg_temp.must_be('a new board sprint is always planned',
    (select state from public.board_sprints where id = s1) = 'planned');
  insert into public.board_sprints (board_id, name, starts_on, ends_on)
  values (v_board, 'Sprint 2', current_date + 7, current_date + 13) returning id into s2;
  insert into public.board_sprints (board_id, name, starts_on, ends_on)
  values (v_board2, 'Other board', current_date, current_date + 6) returning id into s_other;

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('the professor can read a group''s sprints',
    exists (select 1 from public.board_sprints where id = s1));
  perform pg_temp.must_refuse('the professor cannot plan a group''s sprints',
    format($q$insert into public.board_sprints (board_id, name, starts_on, ends_on)
              values (%L, 'Prof sprint', current_date, current_date + 1)$q$, v_board));

  ------------------------------------------------------------ tasks
  perform pg_temp.act_as(v_a);
  insert into public.project_tasks (board_id, title, weight, created_by)
  values (v_board, 'To do', 10, v_a) returning id into t_todo;
  insert into public.project_tasks (board_id, title, weight, created_by)
  values (v_board, 'Started', 10, v_a) returning id into t_started;
  insert into public.project_tasks (board_id, title, weight, created_by)
  values (v_board, 'Done', 10, v_a) returning id into t_done;
  -- Filler, so the board totals 70 and A's fair share (35) covers the two tasks A claims.
  insert into public.project_tasks (board_id, title, weight, created_by)
  select v_board, 'Filler ' || g, 10, v_a from generate_series(1, 4) g;
  perform pg_temp.must_be('a new class task lands in the backlog with a rank',
    (select sprint_id is null and rank is not null from public.project_tasks where id = t_todo));
  insert into public.task_assignees (task_id, student_id) values (t_started, v_a), (t_done, v_a);
  update public.project_tasks set status = 'in_progress' where id in (t_started, t_done);
  update public.project_tasks set status = 'done' where id = t_done;

  update public.project_tasks set sprint_id = s1 where id in (t_todo, t_started, t_done);
  perform pg_temp.must_be('a member can move even a started task into a sprint',
    (select count(*) from public.project_tasks where sprint_id = s1) = 3);
  perform pg_temp.must_refuse('a task cannot join another board''s sprint',
    format('update public.project_tasks set sprint_id = %L where id = %L', s_other, t_todo));
  update public.project_tasks set rank = -5 where id = t_started;
  perform pg_temp.must_be('a member can reorder a started task',
    (select rank from public.project_tasks where id = t_started) = -5);
  perform pg_temp.must_be('the detail view carries sprint and rank',
    (select sprint_id = s1 from public.task_detail_overview where id = t_todo));

  ------------------------------------------------------------ running
  update public.board_sprints set state = 'active' where id = s1;
  perform pg_temp.must_be('starting a board sprint stamps it',
    (select started_at is not null from public.board_sprints where id = s1));
  perform pg_temp.must_refuse('only one sprint runs on a board',
    format($q$update public.board_sprints set state = 'active' where id = %L$q$, s2));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('the professor cannot finish a group''s sprint',
    format('select public.complete_board_sprint(%L, null)', s1));

  perform pg_temp.act_as(v_b);
  perform public.complete_board_sprint(s1, null);
  perform pg_temp.must_be('finishing with no target sends unfinished tasks to the backlog',
    (select count(*) from public.project_tasks where id in (t_todo, t_started) and sprint_id is null) = 2);
  perform pg_temp.must_be('a done task stays in its sprint',
    (select sprint_id from public.project_tasks where id = t_done) = s1);
  perform pg_temp.must_be('the board sprint is finished',
    (select state from public.board_sprints where id = s1) = 'completed');

  ------------------------------------------------------------ handed in
  perform pg_temp.act_as(v_a);
  perform public.set_board_submitted(v_board, true);
  perform pg_temp.must_refuse('a handed-in board cannot plan a sprint',
    format($q$insert into public.board_sprints (board_id, name, starts_on, ends_on)
              values (%L, 'Late plan', current_date, current_date + 1)$q$, v_board));
  perform public.set_board_submitted(v_board, false);

  ------------------------------------------------------------ deleting
  delete from public.board_sprints where id = s2;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a member can delete a planned sprint', n = 1);

  perform pg_temp.act_as_service();
end $$;

rollback;
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node scripts/db.mjs supabase/tests/class-planning.test.sql`
Expected: ERROR `relation "public.board_sprints" does not exist`.

- [ ] **Step 3: Write `supabase/class-planning.sql`**

The view body is the one in `supabase/class-schedule.sql`, copied verbatim. Because it is `select t.*`, recreating it picks up the new columns.

```sql
-- Collabify — sprints and backlog order for class boards (Work tab, Part 2).
--
--   node scripts/db.mjs supabase/class-planning.sql
--
-- Each group's board plans its own sprints; the professor reads them. A task
-- in no sprint is in the board's backlog, ordered by `rank`.
--
-- Requires work-planning.sql (sprint_state, prepare_sprint, guard_sprint_state).
-- Recreates task_detail_overview (`select t.*`, frozen at creation) so it picks
-- up sprint_id and rank; same body as class-schedule.sql. Moving a task
-- between sprints or reordering it is allowed even once started:
-- guard_task_edit freezes title, details, weight, dates and position, not these.
--
-- Idempotent. Safe to re-run.

begin;

create table if not exists public.board_sprints (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.project_boards (id) on delete cascade,
  name         text not null,
  goal         text not null default '',
  starts_on    date not null,
  ends_on      date not null,
  state        public.sprint_state not null default 'planned',
  started_at   timestamptz,
  completed_at timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint board_sprints_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint board_sprints_goal_len check (char_length(goal) <= 500),
  constraint board_sprints_dates check (ends_on >= starts_on),
  constraint board_sprints_id_board unique (id, board_id)
);

create unique index if not exists board_sprints_one_running
  on public.board_sprints (board_id) where state = 'active';
create index if not exists board_sprints_board_idx
  on public.board_sprints (board_id, starts_on);

drop trigger if exists board_sprints_prepare on public.board_sprints;
create trigger board_sprints_prepare before insert on public.board_sprints
  for each row execute function public.prepare_sprint();
drop trigger if exists board_sprints_guard on public.board_sprints;
create trigger board_sprints_guard before update on public.board_sprints
  for each row execute function public.guard_sprint_state();

alter table public.board_sprints enable row level security;

drop policy if exists board_sprints_read on public.board_sprints;
create policy board_sprints_read on public.board_sprints
  for select to authenticated
  using (public.can_see_board(board_id));

-- Planning belongs to the group, while the board is open.
drop policy if exists board_sprints_insert on public.board_sprints;
create policy board_sprints_insert on public.board_sprints
  for insert to authenticated
  with check (public.is_board_member(board_id)
              and not public.board_project_locked(board_id)
              and not public.board_submitted(board_id));

drop policy if exists board_sprints_update on public.board_sprints;
create policy board_sprints_update on public.board_sprints
  for update to authenticated
  using (public.is_board_member(board_id)
         and not public.board_project_locked(board_id)
         and not public.board_submitted(board_id))
  with check (public.is_board_member(board_id)
              and not public.board_project_locked(board_id)
              and not public.board_submitted(board_id));

drop policy if exists board_sprints_delete on public.board_sprints;
create policy board_sprints_delete on public.board_sprints
  for delete to authenticated
  using (state = 'planned'
         and public.is_board_member(board_id)
         and not public.board_project_locked(board_id)
         and not public.board_submitted(board_id));

revoke all on public.board_sprints from anon;
grant select, insert, update, delete on public.board_sprints to authenticated;

-- ---------------------------------------------------------------- tasks

alter table public.project_tasks add column if not exists sprint_id uuid;
alter table public.project_tasks add column if not exists rank double precision;

update public.project_tasks set rank = extract(epoch from created_at) where rank is null;
alter table public.project_tasks
  alter column rank set default extract(epoch from clock_timestamp()),
  alter column rank set not null;

do $$ begin
  alter table public.project_tasks
    add constraint project_tasks_sprint_fk foreign key (sprint_id, board_id)
    references public.board_sprints (id, board_id) on delete set null (sprint_id);
exception when duplicate_object then null; end $$;

create index if not exists project_tasks_sprint_idx
  on public.project_tasks (sprint_id) where sprint_id is not null;

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

-- ---------------------------------------------------------------- finishing

create or replace function public.complete_board_sprint(p_sprint uuid, p_carry_to uuid default null)
returns void language plpgsql security invoker set search_path = public as $$
declare
  s public.board_sprints;
begin
  select * into s from public.board_sprints where id = p_sprint;
  if not found then
    raise exception 'That sprint is not there any more. Reload the page.';
  end if;
  if not public.is_board_member(s.board_id)
     or public.board_project_locked(s.board_id)
     or public.board_submitted(s.board_id) then
    raise exception 'Only the group can finish its sprint, and only while the board is open.'
      using errcode = 'insufficient_privilege';
  end if;
  if s.state <> 'active' then
    raise exception 'Only a running sprint can be finished.' using errcode = 'check_violation';
  end if;
  if p_carry_to is not null and not exists (
    select 1 from public.board_sprints
     where id = p_carry_to and board_id = s.board_id and state = 'planned'
  ) then
    raise exception 'Unfinished tasks can only move to a planned sprint on this board.'
      using errcode = 'check_violation';
  end if;

  update public.project_tasks
     set sprint_id = p_carry_to
   where sprint_id = p_sprint and status <> 'done' and archived_at is null;

  update public.board_sprints set state = 'completed' where id = p_sprint;
end;
$$;

revoke all on function public.complete_board_sprint(uuid, uuid) from public, anon;
grant execute on function public.complete_board_sprint(uuid, uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.board_sprints;
exception when duplicate_object then null; end $$;

commit;
```

- [ ] **Step 4: Apply it twice, then run the tests**

Run: `node scripts/db.mjs supabase/class-planning.sql && node scripts/db.mjs supabase/class-planning.sql`
Expected: `Done.` twice.

Run: `node scripts/db.mjs supabase/tests/class-planning.test.sql`
Expected: every line PASS, no FAIL.

Run: `node scripts/db.mjs supabase/tests/class-schedule.test.sql supabase/tests/deadline-lock.test.sql supabase/tests/task-archive.test.sql supabase/tests/rls-coverage.test.sql supabase/tests/anon-lockdown.test.sql`
Expected: all PASS.

If the class test's fixture is refused (for example `set_board_submitted` has a different contract), read its definition in `supabase/submissions.sql` and adjust the fixture. Never weaken an assertion.

- [ ] **Step 5: Backup doc**

Append ` supabase/class-planning.sql` to the run list after `supabase/work-planning.sql`. Add this re-run note:

> Re-run `class-planning.sql` after `class-schedule.sql`. Both recreate `task_detail_overview`; `t.*` keeps every column either way.

- [ ] **Step 6: Commit**

```bash
git add supabase/class-planning.sql supabase/tests/class-planning.test.sql docs/07-backup.md
git commit -m "Add sprints and backlog order to class boards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sprint types and sprint maths (`src/lib/work/types.ts`, `sprints.ts`)

**Files:**
- Create: `src/lib/work/types.ts`
- Create: `src/lib/work/sprints.ts`
- Test: `src/lib/work/sprints.test.ts`

**Interfaces:**
- Consumes: `WorkStatus` from `src/lib/work/timeline.ts`.
- Produces (all exported):
  - **types.ts:** `SprintState`, `Sprint`, `SprintInput`, `WorkItem`, `WorkSource`. The exact shapes are below.
  - **sprints.ts date helpers:** `addDays(day: string, n: number): string`, `toDay(ms: number): string`, `dayDiff(from: string, to: string): number`.
  - **sprints.ts list helpers:** `runningSprint(sprints): Sprint | null`, `plannedSprints(sprints): Sprint[]`, `finishedSprints(sprints): Sprint[]`.
  - **sprints.ts length and countdown:** `SPRINT_DAYS = 14`, `sprintLength(sprint): number`, `daysLeft(sprint, now?): number`, `daysLeftLabel(n: number): string`.
  - **sprints.ts planning helpers:** `nextSprintDraft(sprints, now?): SprintInput`, `sprintCounts(items, sprintId): { done: number; total: number }`, `type BurnPoint = { day: string; left: number }`, `burndown(sprint, items, now?): BurnPoint[]`.

- [ ] **Step 1: Create `types.ts`**

```ts
// src/lib/work/types.ts
import type { WorkStatus } from './timeline'

export type SprintState = 'planned' | 'active' | 'completed'

export type Sprint = {
  id: string
  name: string
  goal: string
  /** Calendar days, YYYY-MM-DD; the sprint covers both. */
  starts_on: string
  ends_on: string
  state: SprintState
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export type SprintInput = { name: string; goal: string; startsOn: string; endsOn: string }

/** One task as Backlog and Sprints see it, from either space. */
export type WorkItem = {
  id: string
  title: string
  status: WorkStatus
  due_at: string | null
  /** When it was finished; null while it is not done. */
  done_at: string | null
  sprint_id: string | null
  rank: number
  /** Names of whoever holds it; empty when nobody does. */
  holders: string[]
  created_at: string
}

/**
 * What a space hands Backlog and Sprints: its tasks, its sprints, what the
 * viewer may do, and how to do it. Every action reloads the space when done.
 */
export type WorkSource = {
  items: WorkItem[]
  sprints: Sprint[]
  /** May create, edit, start, finish, move and reorder. */
  canPlan: boolean
  /** May add a task to the backlog. */
  canAdd: boolean
  /** Why planning is off for this viewer; '' when it is on. */
  readOnlyReason: string
  openTask: (id: string) => void
  createSprint: (input: SprintInput) => Promise<string>
  updateSprint: (id: string, input: SprintInput) => Promise<void>
  deleteSprint: (id: string) => Promise<void>
  startSprint: (id: string) => Promise<void>
  finishSprint: (id: string, carryTo: string | null) => Promise<void>
  moveToSprint: (taskIds: string[], sprintId: string | null) => Promise<void>
  setRank: (taskId: string, rank: number) => Promise<void>
  addToBacklog: (title: string) => Promise<void>
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/work/sprints.test.ts
import { describe, expect, it } from 'vitest'
import {
  addDays,
  burndown,
  dayDiff,
  daysLeft,
  daysLeftLabel,
  finishedSprints,
  nextSprintDraft,
  plannedSprints,
  runningSprint,
  sprintCounts,
  sprintLength,
} from './sprints'
import type { Sprint, WorkItem } from './types'

const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: 's1',
  name: 'Sprint 1',
  goal: '',
  starts_on: '2026-10-05',
  ends_on: '2026-10-18',
  state: 'planned',
  started_at: null,
  completed_at: null,
  created_at: '2026-10-01T00:00:00Z',
  ...over,
})

const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: 't1',
  title: 'Task',
  status: 'todo',
  due_at: null,
  done_at: null,
  sprint_id: 's1',
  rank: 1,
  holders: [],
  created_at: '2026-10-01T00:00:00Z',
  ...over,
})

/** Local noon on a day, so time zones cannot tip it into the next one. */
const noon = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}

describe('dates', () => {
  it('adds days across a month end', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDays('2026-10-05', -5)).toBe('2026-09-30')
  })
  it('counts the days between two dates', () => {
    expect(dayDiff('2026-10-05', '2026-10-18')).toBe(13)
    expect(dayDiff('2026-10-18', '2026-10-05')).toBe(-13)
  })
  it('measures a sprint in days, both ends counted', () => {
    expect(sprintLength(sprint())).toBe(14)
  })
})

describe('picking sprints', () => {
  const list = [
    sprint({ id: 'b', state: 'planned', starts_on: '2026-11-02' }),
    sprint({ id: 'a', state: 'planned', starts_on: '2026-10-19' }),
    sprint({ id: 'r', state: 'active' }),
    sprint({ id: 'f1', state: 'completed', completed_at: '2026-09-01T00:00:00Z' }),
    sprint({ id: 'f2', state: 'completed', completed_at: '2026-09-20T00:00:00Z' }),
  ]
  it('finds the running sprint', () => {
    expect(runningSprint(list)?.id).toBe('r')
    expect(runningSprint([sprint()])).toBeNull()
  })
  it('lists planned sprints soonest first', () => {
    expect(plannedSprints(list).map((s) => s.id)).toEqual(['a', 'b'])
  })
  it('lists finished sprints newest first', () => {
    expect(finishedSprints(list).map((s) => s.id)).toEqual(['f2', 'f1'])
  })
})

describe('days left', () => {
  it('counts today and the last day', () => {
    expect(daysLeft(sprint(), noon('2026-10-16'))).toBe(3)
    expect(daysLeft(sprint(), noon('2026-10-18'))).toBe(1)
    expect(daysLeft(sprint(), noon('2026-10-19'))).toBe(0)
    expect(daysLeft(sprint(), noon('2026-10-21'))).toBe(-2)
  })
  it('says it in words', () => {
    expect(daysLeftLabel(3)).toBe('3 days left')
    expect(daysLeftLabel(1)).toBe('Last day')
    expect(daysLeftLabel(0)).toBe('Ended yesterday')
    expect(daysLeftLabel(-2)).toBe('Ended 3 days ago')
  })
})

describe('nextSprintDraft', () => {
  it('starts today when there are no sprints', () => {
    expect(nextSprintDraft([], noon('2026-10-06'))).toEqual({
      name: 'Sprint 1',
      goal: '',
      startsOn: '2026-10-06',
      endsOn: '2026-10-19',
    })
  })
  it('starts the day after the latest sprint ends', () => {
    const draft = nextSprintDraft([sprint(), sprint({ id: 's2', ends_on: '2026-11-01' })], noon('2026-10-06'))
    expect(draft.name).toBe('Sprint 3')
    expect(draft.startsOn).toBe('2026-11-02')
    expect(draft.endsOn).toBe('2026-11-15')
  })
  it('never starts in the past', () => {
    expect(nextSprintDraft([sprint({ ends_on: '2026-01-10' })], noon('2026-10-06')).startsOn).toBe('2026-10-06')
  })
})

describe('sprintCounts', () => {
  it('counts a sprint\'s tasks and the done ones', () => {
    const items = [item(), item({ id: 't2', status: 'done' }), item({ id: 't3', sprint_id: null })]
    expect(sprintCounts(items, 's1')).toEqual({ done: 1, total: 2 })
  })
})

describe('burndown', () => {
  const items = [
    item({ id: 'a', status: 'done', done_at: new Date(noon('2026-10-06')).toISOString() }),
    item({ id: 'b', status: 'done', done_at: new Date(noon('2026-10-07')).toISOString() }),
    item({ id: 'c' }),
    item({ id: 'x', sprint_id: 'other' }),
  ]
  it('counts what is still open at the end of each day so far', () => {
    expect(burndown(sprint({ state: 'active' }), items, noon('2026-10-07'))).toEqual([
      { day: '2026-10-05', left: 3 },
      { day: '2026-10-06', left: 2 },
      { day: '2026-10-07', left: 1 },
    ])
  })
  it('is empty before the sprint starts', () => {
    expect(burndown(sprint(), items, noon('2026-10-01'))).toEqual([])
  })
  it('stops at the sprint\'s last day', () => {
    expect(burndown(sprint({ ends_on: '2026-10-06' }), items, noon('2026-10-20'))).toHaveLength(2)
  })
})
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run src/lib/work/sprints.test.ts`
Expected: FAIL, "Failed to resolve import './sprints'".

- [ ] **Step 4: Implement `sprints.ts`**

```ts
// src/lib/work/sprints.ts
/**
 * Sprint arithmetic for Backlog, Sprints and Summary. Calendar days are
 * YYYY-MM-DD strings read as local midnight, the way a project's dates are,
 * so a sprint ending "the 18th" ends on the 18th wherever the reader is.
 */
import type { Sprint, SprintInput, WorkItem } from './types'

export const SPRINT_DAYS = 14

function parse(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toDay(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(day: string, n: number) {
  const d = parse(day)
  return toDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime())
}

/** Whole days from one date to another; negative when `to` is earlier. */
export function dayDiff(from: string, to: string) {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000)
}

export function runningSprint(sprints: readonly Sprint[]) {
  return sprints.find((s) => s.state === 'active') ?? null
}

export function plannedSprints(sprints: readonly Sprint[]) {
  return sprints
    .filter((s) => s.state === 'planned')
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.created_at.localeCompare(b.created_at))
}

export function finishedSprints(sprints: readonly Sprint[]) {
  return sprints
    .filter((s) => s.state === 'completed')
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
}

export function sprintLength(sprint: Pick<Sprint, 'starts_on' | 'ends_on'>) {
  return dayDiff(sprint.starts_on, sprint.ends_on) + 1
}

/** Days from today through the last day, today included: 1 on the last day, 0 the day after. */
export function daysLeft(sprint: Pick<Sprint, 'ends_on'>, now = Date.now()) {
  return dayDiff(toDay(now), sprint.ends_on) + 1
}

export function daysLeftLabel(n: number) {
  if (n > 1) return `${n} days left`
  if (n === 1) return 'Last day'
  if (n === 0) return 'Ended yesterday'
  return `Ended ${1 - n} days ago`
}

/** The next sprint: named in sequence, starting the day after the latest one ends, or today. */
export function nextSprintDraft(sprints: readonly Sprint[], now = Date.now()): SprintInput {
  const today = toDay(now)
  const latest = sprints.reduce<string | null>((max, s) => (max && max > s.ends_on ? max : s.ends_on), null)
  const startsOn = latest && addDays(latest, 1) > today ? addDays(latest, 1) : today
  return {
    name: `Sprint ${sprints.length + 1}`,
    goal: '',
    startsOn,
    endsOn: addDays(startsOn, SPRINT_DAYS - 1),
  }
}

export function sprintCounts(items: readonly WorkItem[], sprintId: string) {
  const mine = items.filter((i) => i.sprint_id === sprintId)
  return { done: mine.filter((i) => i.status === 'done').length, total: mine.length }
}

export type BurnPoint = { day: string; left: number }

/**
 * Tasks still open at the end of each sprint day, from the first day up to
 * today (or the last day). Counted over the sprint's tasks as they stand now,
 * so a task added mid-sprint counts from day one; done is read from done_at.
 */
export function burndown(sprint: Sprint, items: readonly WorkItem[], now = Date.now()): BurnPoint[] {
  const mine = items.filter((i) => i.sprint_id === sprint.id)
  const today = toDay(now)
  const last = sprint.ends_on < today ? sprint.ends_on : today
  const out: BurnPoint[] = []
  // Guarded rather than open-ended: a bad date must not hang the page.
  for (let day = sprint.starts_on, i = 0; day <= last && i < 400; day = addDays(day, 1), i++) {
    const endOfDay = parse(addDays(day, 1)).getTime()
    const left = mine.filter(
      (t) => !(t.status === 'done' && t.done_at && new Date(t.done_at).getTime() < endOfDay),
    ).length
    out.push({ day, left })
  }
  return out
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/work/sprints.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add src/lib/work/types.ts src/lib/work/sprints.ts src/lib/work/sprints.test.ts
git commit -m "Add sprint types and sprint arithmetic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Backlog order, Tasks scope, and the new sections in the URL

**Files:**
- Create: `src/lib/work/backlog.ts` (+ `backlog.test.ts`)
- Create: `src/lib/work/scope.ts` (+ `scope.test.ts`)
- Modify: `src/lib/work/nav.ts` (+ `nav.test.ts`)
- Modify: `src/components/work/WorkNav.tsx` (two `LOOK` entries)

**Interfaces:**
- Consumes (Task 3): `Sprint`, `WorkItem`, `runningSprint`.
- Produces:
  - **backlog.ts:**
    - `backlogItems(items): WorkItem[]` (unfinished, no sprint, by rank)
    - `sprintItems(items, sprintId): WorkItem[]`
    - `rankBetween(before?: number, after?: number): number`
    - `rankForMove(list, index, dir: -1 | 1): number | null`
  - **scope.ts:**
    - `type TaskScope = string`, with the values `'running'` | `'all'` | `'backlog'` | `` `sprint:${id}` ``
    - `defaultScope(sprints)`
    - `readScope(raw: string | null, sprints): TaskScope`
    - `scopeSprintId(scope, sprints): string | null`
    - `applyScope<T extends { sprint_id: string | null }>(items, scope, sprints): T[]`
    - `scopeOptions(sprints): { value: string; label: string }[]`
  - **nav.ts:**
    - `WorkSection = 'summary' | 'backlog' | 'sprints' | 'tasks'`
    - `WORK_SECTIONS = ['summary', 'backlog', 'sprints', 'tasks']`
    - `withWork` patch gains `scope?: string` (written to `?scope=`)

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/work/backlog.test.ts
import { describe, expect, it } from 'vitest'
import { backlogItems, rankBetween, rankForMove, sprintItems } from './backlog'
import type { WorkItem } from './types'

const item = (over: Partial<WorkItem>): WorkItem => ({
  id: 'x', title: 'x', status: 'todo', due_at: null, done_at: null, sprint_id: null,
  rank: 0, holders: [], created_at: '2026-10-01T00:00:00Z', ...over,
})

describe('backlogItems', () => {
  it('keeps unfinished tasks in no sprint, top rank first', () => {
    const list = backlogItems([
      item({ id: 'b', rank: 2 }),
      item({ id: 'a', rank: 1 }),
      item({ id: 'done', rank: 0, status: 'done' }),
      item({ id: 'planned', rank: 0, sprint_id: 's1' }),
    ])
    expect(list.map((i) => i.id)).toEqual(['a', 'b'])
  })
  it('breaks a rank tie by age', () => {
    const list = backlogItems([
      item({ id: 'new', rank: 1, created_at: '2026-10-02T00:00:00Z' }),
      item({ id: 'old', rank: 1, created_at: '2026-10-01T00:00:00Z' }),
    ])
    expect(list.map((i) => i.id)).toEqual(['old', 'new'])
  })
})

describe('sprintItems', () => {
  it('lists a sprint\'s tasks, done ones included, by rank', () => {
    const list = sprintItems(
      [item({ id: 'b', sprint_id: 's', rank: 2, status: 'done' }), item({ id: 'a', sprint_id: 's', rank: 1 }), item({ id: 'c' })],
      's',
    )
    expect(list.map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('rankBetween', () => {
  it('splits the gap between neighbours', () => expect(rankBetween(1, 2)).toBe(1.5))
  it('goes above the first', () => expect(rankBetween(undefined, 5)).toBe(4))
  it('goes below the last', () => expect(rankBetween(5, undefined)).toBe(6))
  it('starts at zero in an empty list', () => expect(rankBetween(undefined, undefined)).toBe(0))
})

describe('rankForMove', () => {
  const list = [{ rank: 1 }, { rank: 2 }, { rank: 3 }]
  it('moves up between the two above', () => expect(rankForMove(list, 2, -1)).toBe(1.5))
  it('moves to the top', () => expect(rankForMove(list, 1, -1)).toBe(0))
  it('moves down between the two below', () => expect(rankForMove(list, 0, 1)).toBe(2.5))
  it('moves to the bottom', () => expect(rankForMove(list, 1, 1)).toBe(4))
  it('does nothing past either end', () => {
    expect(rankForMove(list, 0, -1)).toBeNull()
    expect(rankForMove(list, 2, 1)).toBeNull()
  })
})
```

```ts
// src/lib/work/scope.test.ts
import { describe, expect, it } from 'vitest'
import { applyScope, defaultScope, readScope, scopeOptions, scopeSprintId } from './scope'
import type { Sprint } from './types'

const sprint = (over: Partial<Sprint>): Sprint => ({
  id: 's', name: 'Sprint', goal: '', starts_on: '2026-10-05', ends_on: '2026-10-18',
  state: 'planned', started_at: null, completed_at: null, created_at: '2026-10-01T00:00:00Z', ...over,
})

const running = sprint({ id: 'r', name: 'Sprint 2', state: 'active' })
const planned = sprint({ id: 'p', name: 'Sprint 3', starts_on: '2026-10-19' })
const finished = sprint({ id: 'f', name: 'Sprint 1', state: 'completed', starts_on: '2026-09-21' })
const all = [running, planned, finished]
const items = [
  { id: 'a', sprint_id: 'r' },
  { id: 'b', sprint_id: 'p' },
  { id: 'c', sprint_id: null },
]

describe('scope', () => {
  it('defaults to the running sprint, or everything', () => {
    expect(defaultScope(all)).toBe('running')
    expect(defaultScope([planned])).toBe('all')
  })

  it('reads a scope from the address, falling back when it no longer fits', () => {
    expect(readScope('backlog', all)).toBe('backlog')
    expect(readScope('sprint:p', all)).toBe('sprint:p')
    expect(readScope('sprint:gone', all)).toBe('running')
    expect(readScope('running', [planned])).toBe('all')
    expect(readScope(null, all)).toBe('running')
  })

  it('names the sprint a scope points at', () => {
    expect(scopeSprintId('running', all)).toBe('r')
    expect(scopeSprintId('sprint:p', all)).toBe('p')
    expect(scopeSprintId('all', all)).toBeNull()
  })

  it('filters tasks by scope', () => {
    expect(applyScope(items, 'running', all).map((i) => i.id)).toEqual(['a'])
    expect(applyScope(items, 'sprint:p', all).map((i) => i.id)).toEqual(['b'])
    expect(applyScope(items, 'backlog', all).map((i) => i.id)).toEqual(['c'])
    expect(applyScope(items, 'all', all).map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('offers the running sprint first, then everything, the backlog and each other sprint by date', () => {
    expect(scopeOptions(all)).toEqual([
      { value: 'running', label: 'Running sprint · Sprint 2' },
      { value: 'all', label: 'All tasks' },
      { value: 'backlog', label: 'Backlog' },
      { value: 'sprint:f', label: 'Sprint 1 (finished)' },
      { value: 'sprint:p', label: 'Sprint 3' },
    ])
  })
})
```

In `src/lib/work/nav.test.ts`:
- In "falls back when nothing or something unknown is named", change `workSection(p('work=sprints'), 'summary')` to `workSection(p('work=milestones'), 'summary')`. Sprints is a real section now.
- Add:

```ts
  it('reads the backlog and sprints sections', () => {
    expect(workSection(p('work=backlog'), 'tasks')).toBe('backlog')
    expect(workSection(p('work=sprints'), 'tasks')).toBe('sprints')
  })
```

- In `describe('withWork')`, add:

```ts
  it('writes the tasks scope', () => {
    expect(withWork(p('tab=work'), { scope: 'sprint:s1' }).get('scope')).toBe('sprint:s1')
  })
```

Run: `npx vitest run src/lib/work`
Expected: FAIL for the unresolved `./backlog` and `./scope` imports, and for the two new nav tests.

- [ ] **Step 2: Implement `backlog.ts`**

```ts
// src/lib/work/backlog.ts
/**
 * The backlog's order. Lower rank is nearer the top; a move writes one new
 * rank between the item's new neighbours, so nothing else is renumbered.
 */
import type { WorkItem } from './types'

const byRank = (a: WorkItem, b: WorkItem) => a.rank - b.rank || a.created_at.localeCompare(b.created_at)

/** Unfinished tasks in no sprint, top first. */
export function backlogItems(items: readonly WorkItem[]) {
  return items.filter((i) => i.sprint_id === null && i.status !== 'done').sort(byRank)
}

/** A sprint's tasks, done ones too, top first. */
export function sprintItems(items: readonly WorkItem[], sprintId: string) {
  return items.filter((i) => i.sprint_id === sprintId).sort(byRank)
}

export function rankBetween(before: number | undefined, after: number | undefined) {
  if (before === undefined && after === undefined) return 0
  if (before === undefined) return (after as number) - 1
  if (after === undefined) return before + 1
  return (before + after) / 2
}

/** The rank that moves list[index] one place up (-1) or down (1); null past an end. */
export function rankForMove(list: readonly Pick<WorkItem, 'rank'>[], index: number, dir: -1 | 1) {
  const target = index + dir
  if (target < 0 || target >= list.length) return null
  return dir === -1
    ? rankBetween(list[target - 1]?.rank, list[target].rank)
    : rankBetween(list[target].rank, list[target + 1]?.rank)
}
```

- [ ] **Step 3: Implement `scope.ts`**

```ts
// src/lib/work/scope.ts
/**
 * Which tasks Tasks shows: the running sprint (the default while one runs),
 * everything, the backlog, or one sprint. Kept in the address as `?scope=`.
 */
import { runningSprint } from './sprints'
import type { Sprint } from './types'

/** 'running' | 'all' | 'backlog' | `sprint:${id}` */
export type TaskScope = string

export function defaultScope(sprints: readonly Sprint[]): TaskScope {
  return runningSprint(sprints) ? 'running' : 'all'
}

export function readScope(raw: string | null, sprints: readonly Sprint[]): TaskScope {
  if (raw === 'all' || raw === 'backlog') return raw
  if (raw === 'running' && runningSprint(sprints)) return raw
  if (raw?.startsWith('sprint:') && sprints.some((s) => `sprint:${s.id}` === raw)) return raw
  return defaultScope(sprints)
}

export function scopeSprintId(scope: TaskScope, sprints: readonly Sprint[]) {
  if (scope === 'running') return runningSprint(sprints)?.id ?? null
  return scope.startsWith('sprint:') ? scope.slice('sprint:'.length) : null
}

export function applyScope<T extends { sprint_id: string | null }>(
  items: readonly T[],
  scope: TaskScope,
  sprints: readonly Sprint[],
): T[] {
  if (scope === 'backlog') return items.filter((i) => i.sprint_id === null)
  const id = scopeSprintId(scope, sprints)
  return id ? items.filter((i) => i.sprint_id === id) : [...items]
}

export function scopeOptions(sprints: readonly Sprint[]) {
  const running = runningSprint(sprints)
  return [
    ...(running ? [{ value: 'running', label: `Running sprint · ${running.name}` }] : []),
    { value: 'all', label: 'All tasks' },
    { value: 'backlog', label: 'Backlog' },
    ...sprints
      .filter((s) => s.state !== 'active')
      .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
      .map((s) => ({ value: `sprint:${s.id}`, label: s.state === 'completed' ? `${s.name} (finished)` : s.name })),
  ]
}
```

- [ ] **Step 4: Extend `nav.ts`**

```ts
export type WorkSection = 'summary' | 'backlog' | 'sprints' | 'tasks'

export const WORK_SECTIONS: readonly WorkSection[] = ['summary', 'backlog', 'sprints', 'tasks']
```

In `withWork`, widen the patch type to `{ section?: WorkSection; layout?: TaskLayout; scope?: string }`, and add `if (patch.scope) next.set('scope', patch.scope)` after the layout line.

- [ ] **Step 5: Run the tests and type-check**

Run: `npx vitest run src/lib/work`
Expected: PASS.

Run: `npx tsc -b`
Expected: errors only in `src/components/work/WorkNav.tsx`, because its `LOOK` record now misses `backlog` and `sprints`. Fix that here by adding these entries to `LOOK`:

```ts
  backlog: { label: 'Backlog', icon: 'board' },
  sprints: { label: 'Sprints', icon: 'target' },
```

Then `npx tsc -b` is clean. The new sections render nothing until Tasks 9–10, and that is expected.

- [ ] **Step 6: Commit**

```bash
git add src/lib/work/backlog.ts src/lib/work/backlog.test.ts src/lib/work/scope.ts src/lib/work/scope.test.ts src/lib/work/nav.ts src/lib/work/nav.test.ts src/components/work/WorkNav.tsx
git commit -m "Order the backlog, scope Tasks to a sprint, and add Backlog and Sprints to Work

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sprint API for both spaces (`src/lib/api/sprints.ts`) and the new task fields

**Files:**
- Create: `src/lib/api/sprints.ts`
- Modify: `src/lib/general/types.ts` (`GeneralTask`), `src/lib/types.ts` (`ProjectTask`)
- Modify: `src/lib/api/general.ts` (`createTask`), `src/lib/api/tasks.ts` (`TaskInput`, `addTask`)
- Modify: `src/lib/authError.ts` (the `KNOWN` list)

**Interfaces:**
- Consumes: `Sprint`, `SprintInput` (Task 3). `supabase` from `src/lib/supabase.ts`. The client is untyped, so table names are plain strings.
- Produces:
  - **The home type:** `type SprintHome = { kind: 'work'; projectId: string } | { kind: 'class'; boardId: string }`.
  - **Sprint calls:** `listSprints(home): Promise<Sprint[]>`, `createSprint(home, input): Promise<string>`, `updateSprint(home, id, input)`, `deleteSprint(home, id)`, `startSprint(home, id)`, `finishSprint(home, id, carryTo: string | null)`.
  - **Task calls:** `moveTasksToSprint(home, taskIds: string[], sprintId: string | null)`, `setTaskRank(home, taskId, rank)`.
  - **New fields:** `GeneralTask.sprint_id: string | null`, `GeneralTask.rank: number`, `ProjectTask.sprint_id: string | null`, `ProjectTask.rank: number`.
  - **Optional inputs:** `createTask({ …, sprintId?: string | null })`, and `TaskInput.sprintId?: string | null`, which is used by `addTask` only.

- [ ] **Step 1: Write the API**

```ts
// src/lib/api/sprints.ts
/**
 * Sprints for either space. A work project owns its sprints; a class board
 * owns its group's. The database holds the rules (who may plan, the order a
 * sprint moves through, one running at a time): see supabase/work-planning.sql
 * and supabase/class-planning.sql. These calls only say what to do.
 */
import { supabase } from '../supabase'
import type { Sprint, SprintInput } from '../work/types'

export type SprintHome = { kind: 'work'; projectId: string } | { kind: 'class'; boardId: string }

const SPRINTS = { work: 'general_sprints', class: 'board_sprints' } as const
const TASKS = { work: 'general_tasks', class: 'project_tasks' } as const
const FINISH = { work: 'complete_general_sprint', class: 'complete_board_sprint' } as const
const COLUMNS = 'id, name, goal, starts_on, ends_on, state, started_at, completed_at, created_at'

function owner(home: SprintHome) {
  return home.kind === 'work'
    ? { column: 'project_id', id: home.projectId }
    : { column: 'board_id', id: home.boardId }
}

function fields(input: SprintInput) {
  return { name: input.name.trim(), goal: input.goal.trim(), starts_on: input.startsOn, ends_on: input.endsOn }
}

/** An update or delete that matched no row was refused by RLS or the row is gone. */
function touched(data: unknown[] | null, message: string) {
  if (!data || data.length === 0) throw new Error(message)
}

export async function listSprints(home: SprintHome) {
  const { column, id } = owner(home)
  const { data, error } = await supabase.from(SPRINTS[home.kind]).select(COLUMNS).eq(column, id).order('starts_on')
  if (error) throw error
  return (data ?? []) as Sprint[]
}

export async function createSprint(home: SprintHome, input: SprintInput) {
  const { column, id } = owner(home)
  const { data, error } = await supabase
    .from(SPRINTS[home.kind])
    .insert({ [column]: id, ...fields(input) })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function updateSprint(home: SprintHome, sprintId: string, input: SprintInput) {
  const { data, error } = await supabase.from(SPRINTS[home.kind]).update(fields(input)).eq('id', sprintId).select('id')
  if (error) throw error
  touched(data, 'That sprint could not change. It may be finished, or you may not plan here.')
}

export async function deleteSprint(home: SprintHome, sprintId: string) {
  const { data, error } = await supabase.from(SPRINTS[home.kind]).delete().eq('id', sprintId).select('id')
  if (error) throw error
  touched(data, 'Only a sprint that has not started can be deleted.')
}

export async function startSprint(home: SprintHome, sprintId: string) {
  const { data, error } = await supabase.from(SPRINTS[home.kind]).update({ state: 'active' }).eq('id', sprintId).select('id')
  if (error) throw error
  touched(data, 'That sprint could not start. Reload the page and try again.')
}

export async function finishSprint(home: SprintHome, sprintId: string, carryTo: string | null) {
  const { error } = await supabase.rpc(FINISH[home.kind], { p_sprint: sprintId, p_carry_to: carryTo })
  if (error) throw error
}

export async function moveTasksToSprint(home: SprintHome, taskIds: string[], sprintId: string | null) {
  if (taskIds.length === 0) return
  const { data, error } = await supabase.from(TASKS[home.kind]).update({ sprint_id: sprintId }).in('id', taskIds).select('id')
  if (error) throw error
  touched(data, 'Those tasks could not move. Reload the page and try again.')
}

export async function setTaskRank(home: SprintHome, taskId: string, rank: number) {
  const { data, error } = await supabase.from(TASKS[home.kind]).update({ rank }).eq('id', taskId).select('id')
  if (error) throw error
  touched(data, 'That task could not move. Reload the page and try again.')
}
```

- [ ] **Step 2: Task fields and new-task-into-a-sprint**

- **`src/lib/general/types.ts` (`GeneralTask`):** after `archived_by`, add:

```ts
  /** The sprint it is in; null while it sits in the backlog. */
  sprint_id: string | null
  /** Backlog order: lower is nearer the top. */
  rank: number
```

- **`src/lib/types.ts` (`ProjectTask`):** add the same two fields after `starts_at`.
- **`src/lib/api/general.ts` (`createTask`):** add `sprintId?: string | null` to the input type, and `sprint_id: input.sprintId ?? null,` to the insert.
- **`src/lib/api/tasks.ts`:** add to `TaskInput`:

```ts
  /** New tasks only: the sprint it joins. Omitted or null puts it in the backlog. */
  sprintId?: string | null
```

  Then in `addTask`'s insert object, add `sprint_id: input.sprintId ?? null,`.

- [ ] **Step 3: Readable errors for the one-running rule**

In `src/lib/authError.ts`, add these to `KNOWN`, next to the `project_tasks_start_before_due` rule:

```ts
  [
    /general_sprints_one_running|board_sprints_one_running/i,
    'Another sprint is already running. Finish it before starting this one.',
  ],
```

- [ ] **Step 4: Type-check and test**

Run: `npx tsc -b`
Expected: errors only in object literals typed `GeneralTask` or `ProjectTask` that now miss `sprint_id` / `rank`, for example in tests or fixtures. Add `sprint_id: null, rank: 0` to each one reported. Then the check is clean.

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/sprints.ts src/lib/general/types.ts src/lib/types.ts src/lib/api/general.ts src/lib/api/tasks.ts src/lib/authError.ts
git add -u src
git commit -m "Add a sprint API for both spaces and carry sprint and rank on tasks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sprints on the Timeline and the Calendar

**Files:**
- Modify: `src/lib/work/timeline.ts` (+ test), `src/lib/work/calendar.ts` (+ test)
- Modify: `src/lib/types.ts` (`CalendarKind`), `src/components/calendar/eventLook.ts`, `src/components/calendar/EventChip.tsx`
- Modify: `src/components/work/TimelineView.tsx`

**Interfaces:**
- Consumes: `Sprint` (Task 3), plus `TimelineWindow` and the private `dayStart` / `offset` in `timeline.ts`.
- Produces:
  - **Timeline helpers:** `type Band = { id: string; label: string; start: number; end: number }`, `sprintBands(sprints: readonly Pick<Sprint, 'id' | 'name' | 'starts_on' | 'ends_on'>[]): Band[]`, and `placeBand(band, window): { left: number; width: number } | null`.
  - **Calendar helper:** `sprintCalendarEvents(sprints): CalendarEvent[]`.
  - **New calendar kinds:** `CalendarKind` gains `'sprint_start' | 'sprint_end'`.
  - **Timeline prop:** `TimelineView` gains the optional prop `bands?: Band[]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/work/timeline.test.ts`, adding `placeBand, sprintBands` to its import from `./timeline`:

```ts
describe('sprint bands', () => {
  const day = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d).getTime()
  }
  const window = { start: day('2026-10-01'), end: day('2026-10-31'), source: 'project' as const }

  it('spans a sprint from its first day to the end of its last', () => {
    const [band] = sprintBands([{ id: 's', name: 'Sprint 1', starts_on: '2026-10-05', ends_on: '2026-10-18' }])
    expect(band).toEqual({ id: 's', label: 'Sprint 1', start: day('2026-10-05'), end: day('2026-10-19') })
  })

  it('places a band inside the window', () => {
    const place = placeBand({ id: 's', label: 'S', start: day('2026-10-01'), end: day('2026-10-16') }, window)
    expect(place?.left).toBe(0)
    expect(place?.width).toBeCloseTo(50, 0)
  })

  it('leaves out a band outside the window', () => {
    expect(placeBand({ id: 's', label: 'S', start: day('2026-11-02'), end: day('2026-11-09') }, window)).toBeNull()
    expect(placeBand({ id: 's', label: 'S', start: 0, end: 1 }, { start: 0, end: 0, source: 'none' })).toBeNull()
  })
})
```

Append to `src/lib/work/calendar.test.ts`, adding `sprintCalendarEvents` to the import:

```ts
describe('sprintCalendarEvents', () => {
  it('marks where each sprint starts and ends, opening no task', () => {
    const events = sprintCalendarEvents([
      { id: 's1', name: 'Sprint 1', starts_on: '2026-10-05', ends_on: '2026-10-18', state: 'active' },
    ])
    expect(events.map((e) => [e.kind, e.title, e.task_id])).toEqual([
      ['sprint_start', 'Sprint 1 starts', null],
      ['sprint_end', 'Sprint 1 ends', null],
    ])
    const start = new Date(events[0].at)
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 9, 5])
  })

  it('shows a passed start as done, and an end once the sprint is finished', () => {
    const [start, end] = sprintCalendarEvents([
      { id: 's1', name: 'S', starts_on: '2026-10-05', ends_on: '2026-10-18', state: 'active' },
    ])
    expect(start.done).toBe(true)
    expect(end.done).toBe(false)
  })
})
```

Run: `npx vitest run src/lib/work`
Expected: FAIL. `placeBand`, `sprintBands` and `sprintCalendarEvents` are not exported yet.

- [ ] **Step 2: Implement the bands in `timeline.ts`**

Add these after `nowMarker`:

```ts
/** A stretch of time drawn behind the tasks: a sprint, from its first day to the end of its last. */
export type Band = { id: string; label: string; start: number; end: number }

export function sprintBands(
  sprints: readonly { id: string; name: string; starts_on: string; ends_on: string }[],
): Band[] {
  return sprints.map((s) => ({ id: s.id, label: s.name, start: dayStart(s.starts_on), end: dayStart(s.ends_on) + DAY }))
}

export function placeBand(band: Band, window: TimelineWindow) {
  if (window.source === 'none' || band.end <= window.start || band.start >= window.end) return null
  const left = offset(band.start, window)
  return { left, width: Math.max(0.5, offset(band.end, window) - left) }
}
```

- [ ] **Step 3: Implement the calendar events**

In `src/lib/types.ts`:

```ts
export type CalendarKind =
  | 'project_due'
  | 'project_release'
  | 'task_due'
  | 'submitted'
  | 'meeting'
  | 'sprint_start'
  | 'sprint_end'
```

Do not add the new kinds to `CALENDAR_KINDS`. That list is the main calendar page's legend, and sprints only appear on a project's own calendar.

In `src/components/calendar/eventLook.ts`, add to `LOOK`:

```ts
  // A sprint edge is the plan's frame rather than something due, so it is a
  // quiet outline instead of a filled chip.
  sprint_start: {
    cls: 'surface-sunken text-ink ring-1 ring-[var(--line-strong)] ring-inset',
    icon: 'target',
    dot: 'bg-navy-400 dark:bg-navy-300',
  },
  sprint_end: {
    cls: 'surface-sunken text-ink ring-1 ring-[var(--line-strong)] ring-inset',
    icon: 'flag' in LOOK_ICONS ? 'flag' : 'target',
    dot: 'bg-navy-400 dark:bg-navy-300',
  },
```

There is no `flag` icon in `src/components/ui/Icon.tsx`. Use `icon: 'checkCircle'` for `sprint_end`, and delete the `'flag' in LOOK_ICONS` expression above. It is shown only to flag the choice.

In `src/components/calendar/EventChip.tsx`, replace the `overdue` condition with the equivalent positive form, so the new kinds are never marked overdue:

```ts
  const overdue =
    (event.kind === 'project_due' || event.kind === 'task_due') &&
    !event.done &&
    new Date(event.at).getTime() < now
```

In `src/lib/work/calendar.ts`, add `import type { Sprint } from './types'` and this function:

```ts
/** Local noon on a calendar day, so no time zone tips it onto the day before. */
function noonOf(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12).toISOString()
}

/** Where each sprint starts and ends. They open nothing: `task_id` is null. */
export function sprintCalendarEvents(
  sprints: readonly Pick<Sprint, 'id' | 'name' | 'starts_on' | 'ends_on' | 'state'>[],
): CalendarEvent[] {
  const edge = (kind: 'sprint_start' | 'sprint_end', s: (typeof sprints)[number], title: string, at: string, done: boolean): CalendarEvent => ({
    kind, ref_id: s.id, title, at, class_id: '', class_initial: '', class_name: '',
    project_id: '', project_title: '', task_id: null, group_name: null, done, late: false,
  })
  return sprints.flatMap((s) => [
    edge('sprint_start', s, `${s.name} starts`, noonOf(s.starts_on), s.state !== 'planned'),
    edge('sprint_end', s, `${s.name} ends`, noonOf(s.ends_on), s.state === 'completed'),
  ])
}
```

- [ ] **Step 4: Draw the band row in `TimelineView.tsx`**

1. Import `placeBand` and `type Band` from `'../../lib/work/timeline'`. Add the prop `bands = []` with type `bands?: Band[]`, and the doc line `/** Sprints, drawn as a row of their own under the dates. */`.
2. After `const ticks = …`, add `const placed = bands.flatMap((band) => { const place = placeBand(band, window); return place ? [{ band, place }] : [] })`.
3. Directly after the axis row (the `<div className="relative flex border-b border-line px-3 py-1.5">…</div>`), add:

```tsx
          {placed.length > 0 && (
            <div className="flex items-center border-b border-line">
              <p className="w-[14rem] shrink-0 px-3 py-1.5 text-[11px] font-medium text-faint uppercase">Sprints</p>
              <div className="relative h-7 flex-1">
                {placed.map(({ band, place }) => (
                  <span
                    key={band.id}
                    title={band.label}
                    className="absolute top-1 bottom-1 truncate rounded-md border border-navy-300/60 bg-navy-500/10 px-1.5 text-[11px] leading-5 text-navy-700 dark:border-navy-400/40 dark:text-navy-100"
                    style={{ left: `${place.left}%`, width: `${place.width}%` }}
                  >
                    {band.label}
                  </span>
                ))}
              </div>
            </div>
          )}
```

- [ ] **Step 5: Test, type-check, lint**

Run: `npx vitest run src/lib/work` and expect PASS.
Run: `npx tsc -b` and expect it clean. If any other `Record<CalendarKind, …>` or `switch` over kinds is reported, add the two kinds there with the same quiet treatment.
Run: `npx eslint src/lib/work src/components/work src/components/calendar` and expect it clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/work/timeline.ts src/lib/work/timeline.test.ts src/lib/work/calendar.ts src/lib/work/calendar.test.ts src/lib/types.ts src/components/calendar/eventLook.ts src/components/calendar/EventChip.tsx src/components/work/TimelineView.tsx
git commit -m "Show sprints on the timeline and the task calendar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Small sprint pieces (scope picker, sprint dialog, finish dialog, burndown)

**Files:**
- Create: `src/components/work/ScopePicker.tsx`
- Create: `src/components/work/SprintDialog.tsx`
- Create: `src/components/work/FinishSprintDialog.tsx`
- Create: `src/components/work/Burndown.tsx`

**Interfaces:**
- Consumes:
  - From Tasks 3–4: `Sprint`, `SprintInput`, `WorkSource`, `WorkItem`, `nextSprintDraft`, `plannedSprints`, `sprintCounts`, `burndown`, `sprintLength`, `sprintItems`.
  - UI from the repo: `Modal` (`open, onClose, title, focusField?, footer`), `Field` (`label, optional?, hint?`, child `(id) => …`), `Input` (`../ui/Field`), `Select` / `Textarea` (`../ui/Select`; `Select` takes `options` plus native props), `Button`, `Alert`, `useToast().show(message, tone?)`, `authErrorMessage(err, fallback)`, `dateRange(start, end)` (`lib/general/dates`), and `useNow()`.
- Produces:
  - `ScopePicker({ value, options, onChange })`
  - `SprintDialog({ open, onClose, title, submitLabel, initial, onSubmit })`
  - `FinishSprintDialog({ open, onClose, sprint, source })`
  - `Burndown({ sprint, items })`

- [ ] **Step 1: `ScopePicker.tsx`**

```tsx
// src/components/work/ScopePicker.tsx
import { Select } from '../ui/Select'

/** Which tasks Tasks is showing: the running sprint, all, the backlog, or one sprint. */
export function ScopePicker({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
      <span className="shrink-0">Showing</span>
      <span className="min-w-0 flex-1 sm:flex-none">
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={options}
          aria-label="Which tasks to show"
          className="!h-9 min-w-[12rem] !text-[13px]"
        />
      </span>
    </label>
  )
}
```

- [ ] **Step 2: `SprintDialog.tsx`**

```tsx
// src/components/work/SprintDialog.tsx
import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Textarea } from '../ui/Select'
import { authErrorMessage } from '../../lib/authError'
import type { SprintInput } from '../../lib/work/types'

/**
 * Create or edit a sprint. The parent passes a `key` that changes per sprint,
 * so the fields start from `initial` each time it opens.
 */
export function SprintDialog({
  open,
  onClose,
  title,
  submitLabel,
  initial,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  title: string
  submitLabel: string
  initial: SprintInput
  onSubmit: (input: SprintInput) => Promise<unknown>
}) {
  const [name, setName] = useState(initial.name)
  const [goal, setGoal] = useState(initial.goal)
  const [startsOn, setStartsOn] = useState(initial.startsOn)
  const [endsOn, setEndsOn] = useState(initial.endsOn)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    if (!name.trim()) return setError('A sprint needs a name.')
    if (!startsOn || !endsOn) return setError('A sprint needs a start and an end date.')
    if (endsOn < startsOn) return setError('A sprint cannot end before it starts. Move one of the two dates.')
    setBusy(true)
    try {
      await onSubmit({ name, goal, startsOn, endsOn })
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the sprint.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          {(id) => <Input id={id} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts">
            {(id) => <Input id={id} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}
          </Field>
          <Field label="Ends">
            {(id) => <Input id={id} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />}
          </Field>
        </div>
        <Field label="Goal" optional hint={<span className="text-[12px] text-faint">What this sprint should get done, in a sentence.</span>}>
          {(id) => <Textarea id={id} rows={3} maxLength={500} value={goal} onChange={(e) => setGoal(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  )
}
```

Check that `Field` accepts `hint`. `src/components/tasks/TaskForm.tsx` already passes `hint={<span …>}`, so it does.

- [ ] **Step 3: `FinishSprintDialog.tsx`**

```tsx
// src/components/work/FinishSprintDialog.tsx
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { authErrorMessage } from '../../lib/authError'
import { dateRange } from '../../lib/general/dates'
import { sprintItems } from '../../lib/work/backlog'
import { nextSprintDraft, plannedSprints, sprintCounts } from '../../lib/work/sprints'
import type { Sprint, WorkSource } from '../../lib/work/types'

type Target = 'backlog' | 'next' | 'new'

/** Close the running sprint, and say where its unfinished tasks go. */
export function FinishSprintDialog({
  open,
  onClose,
  sprint,
  source,
}: {
  open: boolean
  onClose: () => void
  sprint: Sprint
  source: WorkSource
}) {
  const { show } = useToast()
  const planned = plannedSprints(source.sprints)
  const unfinished = sprintItems(source.items, sprint.id).filter((i) => i.status !== 'done').length
  const counts = sprintCounts(source.items, sprint.id)
  const draft = nextSprintDraft(source.sprints)
  const [target, setTarget] = useState<Target>(planned.length > 0 ? 'next' : 'backlog')
  const [nextId, setNextId] = useState(planned[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function finish() {
    setError(null)
    setBusy(true)
    try {
      let carryTo: string | null = null
      if (unfinished > 0 && target === 'next') carryTo = nextId || null
      if (unfinished > 0 && target === 'new') carryTo = await source.createSprint(draft)
      await source.finishSprint(sprint.id, carryTo)
      show(`${sprint.name} finished`)
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not finish the sprint.'))
    } finally {
      setBusy(false)
    }
  }

  const option = (value: Target, label: string, extra?: ReactNode) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-3 py-2.5 has-[:checked]:border-navy-400 has-[:checked]:bg-navy-500/8">
      <input
        type="radio"
        name="carry"
        value={value}
        checked={target === value}
        onChange={() => setTarget(value)}
        className="mt-1 accent-[var(--color-navy-600)]"
      />
      <span className="min-w-0 flex-1 text-[14px] text-ink">
        {label}
        {extra}
      </span>
    </label>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Finish ${sprint.name}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void finish()} loading={busy}>
            Finish sprint
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-[14px] text-muted">
          {counts.done} of {counts.total} {counts.total === 1 ? 'task' : 'tasks'} done.{' '}
          {unfinished === 0 ? 'Every task in it is finished.' : `Where should the ${unfinished} unfinished ${unfinished === 1 ? 'task' : 'tasks'} go?`}
        </p>
        {unfinished > 0 && (
          <div className="space-y-2" role="radiogroup" aria-label="Where unfinished tasks go">
            {planned.length > 0 &&
              option(
                'next',
                'Into a planned sprint',
                target === 'next' && (
                  <span className="mt-2 block">
                    <Select
                      value={nextId}
                      onChange={(e) => setNextId(e.target.value)}
                      options={planned.map((s) => ({ value: s.id, label: `${s.name} · ${dateRange(s.starts_on, s.ends_on)}` }))}
                      aria-label="Planned sprint"
                      className="!h-9 !text-[13px]"
                    />
                  </span>
                ),
              )}
            {option('new', `Into a new sprint (${draft.name}, ${dateRange(draft.startsOn, draft.endsOn)})`)}
            {option('backlog', 'Back to the backlog')}
          </div>
        )}
      </div>
    </Modal>
  )
}
```

If `accent-[var(--color-navy-600)]` does not resolve (check that `src/styles/index.css` defines `--color-navy-600`), use `accent-navy-600`.

- [ ] **Step 4: `Burndown.tsx`**

```tsx
// src/components/work/Burndown.tsx
import { useNow } from '../../hooks/useNow'
import { burndown, sprintCounts, sprintLength } from '../../lib/work/sprints'
import type { Sprint, WorkItem } from '../../lib/work/types'

const W = 320
const H = 120
const PAD = 10

/**
 * Tasks left at the end of each day, against a straight line from all of
 * them to none. Hand-drawn SVG, like the rest of the app's charts.
 */
export function Burndown({ sprint, items }: { sprint: Sprint; items: WorkItem[] }) {
  const now = useNow()
  const total = sprintCounts(items, sprint.id).total
  const points = burndown(sprint, items, now)
  const days = sprintLength(sprint)

  if (total === 0) {
    return <p className="text-[12px] text-faint">Move tasks into this sprint to see it burn down.</p>
  }
  if (points.length === 0) {
    return <p className="text-[12px] text-faint">The chart starts on the sprint's first day.</p>
  }

  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(1, days - 1)
  const y = (left: number) => PAD + (1 - left / total) * (H - 2 * PAD)
  const line = points.map((p, i) => `${x(i)},${y(p.left)}`).join(' ')

  return (
    <figure className="space-y-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-[420px]"
        role="img"
        aria-label={`Tasks left at the end of each day: ${points.map((p) => p.left).join(', ')}, out of ${total}.`}
      >
        <line x1={x(0)} y1={y(total)} x2={x(days - 1)} y2={y(0)} stroke="var(--line-strong)" strokeDasharray="4 4" />
        <polyline points={line} fill="none" strokeWidth={2.5} className="stroke-navy-500 dark:stroke-navy-300" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.day} cx={x(i)} cy={y(p.left)} r={2.5} className="fill-navy-500 dark:fill-navy-300" />
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 text-[11px] text-faint">
        <span>Solid: tasks left</span>
        <span>Dashed: an even pace to zero</span>
      </figcaption>
    </figure>
  )
}
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc -b` and expect it clean.
Run: `npx eslint src/components/work` and expect it clean. If `React.ReactNode` needs an import, use `import type { ReactNode } from 'react'` instead.

- [ ] **Step 6: Commit**

```bash
git add src/components/work/ScopePicker.tsx src/components/work/SprintDialog.tsx src/components/work/FinishSprintDialog.tsx src/components/work/Burndown.tsx
git commit -m "Add the sprint dialog, the finish dialog, a burndown chart and a scope picker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Backlog and Sprints views

**Files:**
- Create: `src/components/work/BacklogView.tsx`
- Create: `src/components/work/SprintsView.tsx`

**Interfaces:**
- Consumes:
  - Task 3: `WorkSource`, `WorkItem`, `Sprint`, `runningSprint`, `plannedSprints`, `finishedSprints`, `sprintCounts`, `daysLeft`, `daysLeftLabel`, `nextSprintDraft`.
  - Task 4: `backlogItems`, `sprintItems`, `rankForMove`.
  - Task 7: `SprintDialog`, `FinishSprintDialog`, `Burndown`.
  - The repo: `ConfirmDialog` (`open, onClose, onConfirm, title, body, confirmLabel, tone`), `EmptyState` (`icon, title, body, action`), `formatDue`, `isOverdue`, `dateRange`, `TASK_STATUSES` (`lib/general/progress`; values `todo` / `in_progress` / `done` with labels), and `useNow`.
- Produces: `BacklogView({ source }: { source: WorkSource })` and `SprintsView({ source, onPlan }: { source: WorkSource; onPlan: () => void })`.

- [ ] **Step 1: `BacklogView.tsx`**

```tsx
// src/components/work/BacklogView.tsx
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { Input } from '../ui/Field'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { SprintDialog } from './SprintDialog'
import { authErrorMessage } from '../../lib/authError'
import { dateRange, formatDue, isOverdue } from '../../lib/general/dates'
import { backlogItems, rankForMove, sprintItems } from '../../lib/work/backlog'
import { nextSprintDraft, plannedSprints, runningSprint } from '../../lib/work/sprints'
import type { Sprint, WorkItem, WorkSource } from '../../lib/work/types'

const BACKLOG = ''

/**
 * Planning: the sprints that have not started, each with its tasks, then
 * the backlog. Tasks move between them with a "Move to" picker (one at a
 * time, or several checked), and up and down within a list.
 */
export function BacklogView({ source }: { source: WorkSource }) {
  const { show } = useToast()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [bulkTarget, setBulkTarget] = useState(BACKLOG)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Sprint | null>(null)
  const [deleting, setDeleting] = useState<Sprint | null>(null)
  const [title, setTitle] = useState('')
  const [adding, setAdding] = useState(false)

  const running = runningSprint(source.sprints)
  const planned = plannedSprints(source.sprints)
  const backlog = backlogItems(source.items)
  const targets = [
    { value: BACKLOG, label: 'Backlog' },
    ...(running ? [{ value: running.id, label: `${running.name} (running)` }] : []),
    ...planned.map((s) => ({ value: s.id, label: s.name })),
  ]

  async function run(action: () => Promise<unknown>, failure: string) {
    try {
      await action()
    } catch (err) {
      show(authErrorMessage(err, failure), 'error')
    }
  }

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function moveChecked() {
    await run(async () => {
      await source.moveToSprint([...checked], bulkTarget || null)
      setChecked(new Set())
    }, 'Could not move those tasks.')
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setAdding(true)
    await run(async () => {
      await source.addToBacklog(title.trim())
      setTitle('')
    }, 'Could not add that task.')
    setAdding(false)
  }

  const list = (items: WorkItem[]) =>
    items.length === 0 ? null : (
      <ul className="divide-y divide-[var(--line)]">
        {items.map((item, index) => (
          <ItemRow
            key={item.id}
            item={item}
            canPlan={source.canPlan}
            checked={checked.has(item.id)}
            onCheck={() => toggle(item.id)}
            onOpen={() => source.openTask(item.id)}
            targets={targets}
            onMove={(to) => void run(() => source.moveToSprint([item.id], to || null), 'Could not move that task.')}
            onStep={(dir) => {
              const rank = rankForMove(items, index, dir)
              if (rank !== null) void run(() => source.setRank(item.id, rank), 'Could not move that task.')
            }}
            first={index === 0}
            last={index === items.length - 1}
          />
        ))}
      </ul>
    )

  return (
    <div className="space-y-6">
      {source.readOnlyReason && <Alert tone="info">{source.readOnlyReason}</Alert>}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3>Coming up</h3>
          <p className="mt-0.5 text-[13px] text-muted">
            Sprints that have not started. Move tasks in from the backlog, then start one when the team is ready.
          </p>
        </div>
        {source.canPlan && (
          <Button size="sm" className="!rounded-lg" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} />
            Create sprint
          </Button>
        )}
      </div>

      {planned.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
          No sprint is planned. {source.canPlan ? 'Create one, then move tasks into it.' : 'Nothing to show yet.'}
        </p>
      ) : (
        planned.map((s) => {
          const items = sprintItems(source.items, s.id)
          return (
            <section key={s.id} className="card overflow-hidden shadow-card">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <h4 className="font-semibold text-ink">{s.name}</h4>
                  <p className="mt-0.5 font-mono text-[12px] text-faint">
                    {dateRange(s.starts_on, s.ends_on)} · {items.length} {items.length === 1 ? 'task' : 'tasks'}
                  </p>
                  {s.goal && <p className="mt-1 text-[13px] text-muted">{s.goal}</p>}
                </div>
                {source.canPlan && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="!rounded-lg"
                      disabled={Boolean(running)}
                      title={running ? `Finish ${running.name} first.` : undefined}
                      onClick={() => void run(() => source.startSprint(s.id), 'Could not start the sprint.')}
                    >
                      <Icon name="target" size={15} />
                      Start sprint
                    </Button>
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      aria-label={`Edit ${s.name}`}
                      className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                    >
                      <Icon name="edit" size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(s)}
                      aria-label={`Delete ${s.name}`}
                      className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-500/12 dark:hover:text-danger-400"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                )}
              </header>
              {list(items) ?? <p className="px-4 py-5 text-[13px] text-faint">No tasks in this sprint yet.</p>}
            </section>
          )
        })
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3>
              Backlog <span className="font-mono text-[13px] font-normal text-faint">{backlog.length}</span>
            </h3>
            <p className="mt-0.5 text-[13px] text-muted">Every unfinished task that is not in a sprint. The top is what comes next.</p>
          </div>
          {source.canPlan && checked.size > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-muted">{checked.size} checked</span>
              <Select
                value={bulkTarget}
                onChange={(e) => setBulkTarget(e.target.value)}
                options={targets}
                aria-label="Move checked tasks to"
                className="!h-9 !text-[13px]"
              />
              <Button size="sm" className="!rounded-lg" onClick={() => void moveChecked()}>
                Move
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
                Clear
              </Button>
            </div>
          )}
        </div>

        <div className="card overflow-hidden shadow-card">
          {list(backlog) ?? (
            <p className="px-4 py-6 text-center text-[13px] text-muted">
              The backlog is empty. Every unfinished task is in a sprint.
            </p>
          )}
          {source.canAdd && (
            <form onSubmit={(e) => void add(e)} className="flex gap-2 border-t border-line p-3">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Add a task to the backlog"
                aria-label="New backlog task"
                maxLength={200}
                className="!h-10 !text-[14px]"
              />
              <Button type="submit" size="sm" className="!h-10 !rounded-lg" loading={adding} disabled={!title.trim()}>
                Add
              </Button>
            </form>
          )}
        </div>
      </section>

      <SprintDialog
        key={creating ? 'new-open' : 'new'}
        open={creating}
        onClose={() => setCreating(false)}
        title="New sprint"
        submitLabel="Create sprint"
        initial={nextSprintDraft(source.sprints)}
        onSubmit={(input) => source.createSprint(input)}
      />
      {editing && (
        <SprintDialog
          key={editing.id}
          open
          onClose={() => setEditing(null)}
          title={`Edit ${editing.name}`}
          submitLabel="Save sprint"
          initial={{ name: editing.name, goal: editing.goal, startsOn: editing.starts_on, endsOn: editing.ends_on }}
          onSubmit={(input) => source.updateSprint(editing.id, input)}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await source.deleteSprint(deleting.id)
        }}
        title={`Delete ${deleting?.name ?? 'this sprint'}?`}
        body="Its tasks go back to the backlog. Nothing else changes."
        confirmLabel="Delete sprint"
        tone="danger"
      />
    </div>
  )
}

function ItemRow({
  item,
  canPlan,
  checked,
  onCheck,
  onOpen,
  targets,
  onMove,
  onStep,
  first,
  last,
}: {
  item: WorkItem
  canPlan: boolean
  checked: boolean
  onCheck: () => void
  onOpen: () => void
  targets: { value: string; label: string }[]
  onMove: (to: string) => void
  onStep: (dir: -1 | 1) => void
  first: boolean
  last: boolean
}) {
  const overdue = isOverdue(item.due_at, item.status)
  const step =
    'grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink disabled:pointer-events-none disabled:opacity-30'
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      {canPlan && (
        <input
          type="checkbox"
          checked={checked}
          onChange={onCheck}
          aria-label={`Check ${item.title}`}
          className="h-4 w-4 shrink-0 accent-[var(--color-navy-600)]"
        />
      )}
      <div className="min-w-0 flex-1 basis-48">
        <button
          type="button"
          onClick={onOpen}
          className={`block max-w-full truncate text-left text-[14px] font-medium hover:underline ${
            item.status === 'done' ? 'text-muted line-through' : 'text-ink'
          }`}
        >
          {item.title}
        </button>
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-faint">
          <span className={item.holders.length ? '' : 'text-warning-700 dark:text-warning-300'}>
            {item.holders.length ? item.holders.join(', ') : 'Nobody yet'}
          </span>
          {item.due_at && (
            <span className={`font-mono ${overdue ? 'text-danger-600 dark:text-danger-400' : ''}`}>{formatDue(item.due_at)}</span>
          )}
        </p>
      </div>
      {canPlan && (
        <div className="flex items-center gap-1">
          <button type="button" className={step} onClick={() => onStep(-1)} disabled={first} aria-label={`Move ${item.title} up`}>
            <Icon name="chevronDown" size={15} className="rotate-180" />
          </button>
          <button type="button" className={step} onClick={() => onStep(1)} disabled={last} aria-label={`Move ${item.title} down`}>
            <Icon name="chevronDown" size={15} />
          </button>
          <Select
            value={item.sprint_id ?? BACKLOG}
            onChange={(e) => onMove(e.target.value)}
            options={targets}
            aria-label={`Move ${item.title} to`}
            className="!h-8 !w-auto !pr-8 !pl-2.5 !text-[12px]"
          />
        </div>
      )}
    </li>
  )
}
```

If `Icon` takes no `className` prop, wrap it in `<span className="rotate-180">`. Check this in `src/components/ui/Icon.tsx`.

- [ ] **Step 2: `SprintsView.tsx`**

```tsx
// src/components/work/SprintsView.tsx
import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Icon } from '../ui/Icon'
import { Burndown } from './Burndown'
import { FinishSprintDialog } from './FinishSprintDialog'
import { useNow } from '../../hooks/useNow'
import { dateRange } from '../../lib/general/dates'
import { TASK_STATUSES } from '../../lib/general/progress'
import { sprintItems } from '../../lib/work/backlog'
import { daysLeft, daysLeftLabel, finishedSprints, runningSprint, sprintCounts } from '../../lib/work/sprints'
import type { WorkSource } from '../../lib/work/types'

const COLUMN_TONE = {
  todo: 'text-pending-ink',
  in_progress: 'text-warning-700 dark:text-warning-300',
  done: 'text-success-700 dark:text-success-300',
} as const

/** Running the sprint, then looking back at the finished ones. */
export function SprintsView({ source, onPlan }: { source: WorkSource; onPlan: () => void }) {
  const now = useNow()
  const [finishing, setFinishing] = useState(false)
  const running = runningSprint(source.sprints)
  const finished = finishedSprints(source.sprints)

  return (
    <div className="space-y-6">
      {source.readOnlyReason && <Alert tone="info">{source.readOnlyReason}</Alert>}

      {running ? (
        (() => {
          const items = sprintItems(source.items, running.id)
          const { done, total } = sprintCounts(source.items, running.id)
          const pct = total ? Math.round((done / total) * 100) : 0
          const left = daysLeft(running, now)
          return (
            <section className="card space-y-5 p-4 shadow-card sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="eyebrow">Running sprint</p>
                  <h2 className="mt-1">{running.name}</h2>
                  <p className="mt-1 font-mono text-[12px] text-faint">
                    {dateRange(running.starts_on, running.ends_on)} ·{' '}
                    <span className={left <= 0 ? 'text-danger-600 dark:text-danger-400' : ''}>{daysLeftLabel(left)}</span>
                  </p>
                  {running.goal && <p className="mt-2 max-w-prose text-[14px] text-muted">{running.goal}</p>}
                </div>
                {source.canPlan && (
                  <Button size="sm" className="!rounded-lg" onClick={() => setFinishing(true)}>
                    <Icon name="checkCircle" size={15} />
                    Finish sprint
                  </Button>
                )}
              </div>

              <div>
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="text-muted">
                    <strong className="text-ink">
                      {done} of {total}
                    </strong>{' '}
                    done
                  </span>
                  <span className="font-mono text-faint">{pct}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full surface-sunken">
                  <span className="block h-full rounded-full bg-progress" style={{ width: `${pct}%` }} />
                </div>
                {left <= 0 && source.canPlan && (
                  <p className="mt-2 text-[12px] text-warning-700 dark:text-warning-300">
                    Its last day has passed. Finish it to move what is left on.
                  </p>
                )}
              </div>

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <div>
                  <h3 className="mb-2 text-[14px]">Burndown</h3>
                  <Burndown sprint={running} items={source.items} />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  {TASK_STATUSES.map((s) => {
                    const column = items.filter((i) => i.status === s.value)
                    return (
                      <div key={s.value} className="min-w-0">
                        <h4 className={`flex items-baseline justify-between border-b border-line pb-1.5 text-[13px] font-semibold ${COLUMN_TONE[s.value]}`}>
                          {s.label}
                          <span className="font-mono text-[12px] font-normal text-faint">{column.length}</span>
                        </h4>
                        <ul className="mt-2 space-y-1">
                          {column.map((i) => (
                            <li key={i.id}>
                              <button
                                type="button"
                                onClick={() => source.openTask(i.id)}
                                className={`block w-full truncate text-left text-[13px] hover:underline ${i.status === 'done' ? 'text-muted line-through' : 'text-ink'}`}
                              >
                                {i.title}
                              </button>
                            </li>
                          ))}
                          {column.length === 0 && <li className="text-[12px] text-faint">Nothing here</li>}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>
          )
        })()
      ) : (
        <EmptyState
          icon="target"
          title="No sprint is running"
          body={source.canPlan ? 'Plan one in Backlog, then start it.' : 'When a sprint starts, it shows here.'}
          action={
            <Button variant="outline" className="!rounded-xl" onClick={onPlan}>
              Go to Backlog
            </Button>
          }
        />
      )}

      <section className="space-y-3">
        <h3>Finished sprints</h3>
        {finished.length === 0 ? (
          <p className="text-[13px] text-muted">None yet. A sprint lands here once it is finished.</p>
        ) : (
          <ul className="space-y-2">
            {finished.map((s) => {
              const { done, total } = sprintCounts(source.items, s.id)
              const doneItems = sprintItems(source.items, s.id).filter((i) => i.status === 'done')
              return (
                <li key={s.id} className="surface rounded-xl border border-line px-4 py-3">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-ink">{s.name}</span>
                      <span className="font-mono text-[12px] text-faint">
                        {dateRange(s.starts_on, s.ends_on)} · {done} of {total} done
                      </span>
                    </summary>
                    {s.goal && <p className="mt-2 text-[13px] text-muted">{s.goal}</p>}
                    <ul className="mt-2 space-y-1">
                      {doneItems.map((i) => (
                        <li key={i.id}>
                          <button type="button" onClick={() => source.openTask(i.id)} className="text-left text-[13px] text-ink hover:underline">
                            {i.title}
                          </button>
                        </li>
                      ))}
                      {doneItems.length === 0 && <li className="text-[12px] text-faint">Nothing was finished in it.</li>}
                    </ul>
                  </details>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {running && finishing && (
        <FinishSprintDialog open onClose={() => setFinishing(false)} sprint={running} source={source} />
      )}
    </div>
  )
}
```

Note: done tasks carried in a finished sprint's count are the ones still recorded there. Unfinished ones moved on, so `total` reads as what stayed in it.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc -b` and `npx eslint src/components/work`. Expect both clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/work/BacklogView.tsx src/components/work/SprintsView.tsx
git commit -m "Add the Backlog and Sprints views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Sprints in work projects

**Files:**
- Modify: `src/components/general/useGeneralProject.ts`
- Create: `src/components/general/workSource.ts`
- Modify: `src/components/general/WorkTab.tsx`
- Modify: `src/components/general/TasksTab.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3–8. `GeneralProjectState`: `project`, `tasks`, `archived`, `can`, `nameOf`, `reload`. `createTask` from `lib/api/general`.
- Produces:
  - `GeneralProjectState.sprints: Sprint[]`
  - `generalWorkSource(state, openTask): WorkSource`
  - `TasksTab` gains the props `scope: TaskScope` and `onScope: (s: TaskScope) => void`

- [ ] **Step 1: Load sprints with the project**

In `useGeneralProject.ts`:
- Import `listSprints` (`../../lib/api/sprints`) and `type Sprint` (`../../lib/work/types`).
- Add `sprints: Sprint[]` to `GeneralProjectState` after `tasks`, with the comment `/** Oldest start first. */`.
- Add `const [sprints, setSprints] = useState<Sprint[]>([])`.
- In the not-found reset, add `setSprints([])`.
- Add `listSprints({ kind: 'work', projectId })` to the `Promise.all`, with its result destructured as `sp` after `tk`, and call `setSprints(sp)`.
- Add `'general_sprints'` to the `useLive` table list after `'general_task_assignees'`.
- Add `sprints` to the returned object and to the `useMemo` dependency list.

- [ ] **Step 2: `workSource.ts`**

```ts
// src/components/general/workSource.ts
import {
  createSprint,
  deleteSprint,
  finishSprint,
  moveTasksToSprint,
  setTaskRank,
  startSprint,
  updateSprint,
} from '../../lib/api/sprints'
import type { SprintHome } from '../../lib/api/sprints'
import { createTask } from '../../lib/api/general'
import type { WorkSource } from '../../lib/work/types'
import type { GeneralProjectState } from './useGeneralProject'

/** A work project as Backlog and Sprints see it. Owners and Managers plan; members add. */
export function generalWorkSource(state: GeneralProjectState, openTask: (id: string) => void): WorkSource {
  const project = state.project
  const home: SprintHome = { kind: 'work', projectId: project?.id ?? '' }
  const live = Boolean(project) && !state.archived
  const canPlan = live && state.can('manage_tasks')
  const then = async <T,>(action: Promise<T>) => {
    const result = await action
    await state.reload()
    return result
  }

  return {
    items: state.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      due_at: t.due_at,
      done_at: t.completed_at,
      sprint_id: t.sprint_id,
      rank: t.rank,
      holders: t.assignee_ids.map((id) => state.nameOf(id)),
      created_at: t.created_at,
    })),
    sprints: state.sprints,
    canPlan,
    canAdd: live,
    readOnlyReason: state.archived
      ? 'This project is archived, so nothing in it can change.'
      : canPlan
        ? ''
        : 'Owners and Managers plan the sprints. You can follow the plan and add tasks to the backlog.',
    openTask,
    createSprint: (input) => then(createSprint(home, input)),
    updateSprint: (id, input) => then(updateSprint(home, id, input)),
    deleteSprint: (id) => then(deleteSprint(home, id)),
    startSprint: (id) => then(startSprint(home, id)),
    finishSprint: (id, carryTo) => then(finishSprint(home, id, carryTo)),
    moveToSprint: (ids, sprintId) => then(moveTasksToSprint(home, ids, sprintId)),
    setRank: (id, rank) => then(setTaskRank(home, id, rank)),
    addToBacklog: (title) =>
      then(
        createTask({ projectId: home.projectId, title, description: '', dueAt: null, startsAt: null, teamId: null }).then(
          () => undefined,
        ),
      ),
  }
}
```

- [ ] **Step 3: Sections and scope in `WorkTab.tsx`**

1. Import `BacklogView`, `SprintsView` (`../work/…`), `generalWorkSource` (`./workSource`), and `readScope` (`../../lib/work/scope`).
2. After `const layout = …`, add:

```tsx
  const scope = readScope(params.get('scope'), state.sprints)
  const source = generalWorkSource(state, (id) => showTask(id))
```

   `showTask` is declared below with `const`. Move its declaration above these two lines.
3. Replace the section render:

```tsx
      {section === 'summary' ? (
        <WorkSummary state={state} onOpenTask={showTask} />
      ) : section === 'backlog' ? (
        <BacklogView source={source} />
      ) : section === 'sprints' ? (
        <SprintsView source={source} onPlan={() => setParams(withWork(params, { section: 'backlog' }))} />
      ) : (
        <TasksTab
          state={state}
          layout={layout}
          onLayout={(l) => setParams(withWork(params, { layout: l }), { replace: true })}
          scope={scope}
          onScope={(s) => setParams(withWork(params, { scope: s }), { replace: true })}
          onOpenTask={showTask}
        />
      )}
```

- [ ] **Step 4: Scope, bands and sprint dates in `TasksTab.tsx`**

1. Add these imports:

```tsx
import { ScopePicker } from '../work/ScopePicker'
import { sprintCalendarEvents } from '../../lib/work/calendar'
import { applyScope, scopeOptions, scopeSprintId } from '../../lib/work/scope'
import type { TaskScope } from '../../lib/work/scope'
import { sprintBands } from '../../lib/work/timeline'
```

   If `taskCalendarEvents` is already imported from `../../lib/work/calendar`, add `sprintCalendarEvents` to that import.
2. Add the props `scope: TaskScope` and `onScope: (s: TaskScope) => void` to the signature.
3. Before `shown`, add `const scoped = useMemo(() => applyScope(state.tasks, scope, state.sprints), [state.tasks, scope, state.sprints])`. In the `shown` memo, replace `state.tasks` with `scoped` (both in the chain and in the dependency list).
4. Base progress and the unassigned count on `scoped` instead of `state.tasks`: `const progress = projectProgress(scoped)` and `const unassigned = scoped.filter(…)`. Pass `total={scoped.length}` to `TaskViewSwitch`.
5. Above the `TaskViewSwitch` (inside the `state.tasks.length > 0` fragment), add:

```tsx
          {state.sprints.length > 0 && (
            <ScopePicker value={scope} options={scopeOptions(state.sprints)} onChange={onScope} />
          )}
```

6. Insert a scope-aware empty state before the "Nothing matches" branch:

```tsx
      ) : scoped.length === 0 ? (
        <EmptyState
          icon="target"
          title="No tasks here"
          body={scope === 'backlog' ? 'Every task is in a sprint.' : 'This sprint has no tasks yet. Move some in from Backlog.'}
        />
```

7. Pass `bands={sprintBands(state.sprints)}` to `TimelineView`. For the calendar, use `events={[...taskCalendarEvents(shown, …existing label…), ...sprintCalendarEvents(state.sprints)]}`.
8. New tasks join the scoped sprint, for planners only. Render `NewTaskDialog` with `sprintId={state.can('manage_tasks') ? scopeSprintId(scope, state.sprints) : null}`. In `NewTaskDialog`, add the prop `sprintId: string | null` and pass `sprintId` into `createTask({...})`.

- [ ] **Step 5: Build, lint, test**

Run: `npm run build` and expect it clean.
Run: `npx eslint src/components/general src/components/work` and expect it clean.
Run: `npx vitest run` and expect PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/general/useGeneralProject.ts src/components/general/workSource.ts src/components/general/WorkTab.tsx src/components/general/TasksTab.tsx
git commit -m "Plan and run sprints in work projects

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Sprints in class projects

**Files:**
- Modify: `src/components/tasks/useProjectTasks.ts`
- Create: `src/components/tasks/classWorkSource.ts`
- Modify: `src/components/tasks/StudentTasksView.tsx`
- Modify: `src/components/tasks/ProfessorTasksView.tsx`
- Modify: `src/components/tasks/TaskBoard.tsx`

**Interfaces:**
- Consumes:
  - Tasks 3–8: everything.
  - `ProjectTasks` fields: `active`, `tasks` (the active board's `ProjectTask[]` with `assignees[].profile`), `isProfessor`, `locked`, `refresh`, `showTask`, `showBoard`, `boards`, `section`, `setSection`, `view`, `shown`.
  - Helpers and API: `canPlanBoard`, `isBoardSubmitted`, `fullName`, `boardOwnerName` (`lib/types`); `addTask` (`lib/api/tasks`); `useLive` (`hooks/useLive`, options `{ enabled }`).
- Produces:
  - `useProjectTasks` returns `sprints: Sprint[]`, `sprintScope: TaskScope` and `setSprintScope(s)`. `shown` is now also narrowed by `sprintScope` when a board is active.
  - `classWorkSource(t, viewerId): WorkSource | null` (null when no board is active).
  - `TaskBoard` gains the optional prop `newTaskSprint?: string | null`.

- [ ] **Step 1: Sprints and scope in `useProjectTasks.ts`**

1. Add these imports:

```ts
import { useLive } from '../../hooks/useLive'
import { listSprints } from '../../lib/api/sprints'
import { applyScope, readScope } from '../../lib/work/scope'
import type { TaskScope } from '../../lib/work/scope'
import type { Sprint } from '../../lib/work/types'
```

2. After `const activeGroupId = …`, add:

```ts
  // Sprints belong to one board, so they follow the board in view.
  const [sprints, setSprints] = useState<Sprint[]>([])
  const loadSprints = useCallback(async () => {
    if (!activeId) return setSprints([])
    try {
      setSprints(await listSprints({ kind: 'class', boardId: activeId }))
    } catch {
      setSprints([])
    }
  }, [activeId])
  useEffect(() => {
    void loadSprints()
  }, [loadSprints])
  useLive(loadSprints, ['board_sprints'], { enabled: Boolean(activeId) })
```

3. Add `loadSprints()` to `refresh`'s `Promise.all`, and `loadSprints` to its dependency list.
4. Replace the `shown` memo:

```ts
  // With a board in view, Tasks follows the chosen sprint too.
  const sprintScope: TaskScope = activeId ? readScope(params.get('scope'), sprints) : 'all'
  const shown = useMemo(
    () => applyScope(applyTaskFilters(scope, filters), sprintScope, sprints),
    [scope, filters, sprintScope, sprints],
  )
```

   `params` is declared above. If `shown` is declared before `openTask`, keep the order: `sprintScope` needs only `params`, `activeId` and `sprints`.
5. After `setView`, add:

```ts
  const setSprintScope = useCallback(
    (s: TaskScope) => setParams(withWork(params, { scope: s }), { replace: true }),
    [params, setParams],
  )
```

6. Return `sprints, sprintScope, setSprintScope`.

- [ ] **Step 2: `classWorkSource.ts`**

```ts
// src/components/tasks/classWorkSource.ts
import {
  createSprint,
  deleteSprint,
  finishSprint,
  moveTasksToSprint,
  setTaskRank,
  startSprint,
  updateSprint,
} from '../../lib/api/sprints'
import { addTask } from '../../lib/api/tasks'
import { canPlanBoard, fullName, isBoardSubmitted } from '../../lib/types'
import type { WorkSource } from '../../lib/work/types'
import type { ProjectTasks } from './useProjectTasks'

/**
 * One group's board as Backlog and Sprints see it. The group plans while the
 * board is open; the professor follows along. Null with no board in view.
 */
export function classWorkSource(t: ProjectTasks, viewerId: string | undefined): WorkSource | null {
  const board = t.active
  if (!board) return null
  const home = { kind: 'class', boardId: board.id } as const
  const canPlan = !t.isProfessor && canPlanBoard(board, t.locked)
  const then = async <T,>(action: Promise<T>) => {
    const result = await action
    await t.refresh()
    return result
  }

  return {
    items: t.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      due_at: task.due_at,
      done_at: task.done_at,
      sprint_id: task.sprint_id,
      rank: task.rank,
      holders: task.assignees.flatMap((a) => (a.profile ? [fullName(a.profile)] : [])),
      created_at: task.created_at,
    })),
    sprints: t.sprints,
    canPlan,
    canAdd: canPlan && Boolean(viewerId),
    readOnlyReason: t.isProfessor
      ? 'Each group plans its own sprints. You can follow along here.'
      : t.locked
        ? 'This project is closed, so planning is paused.'
        : isBoardSubmitted(board)
          ? 'This board is handed in, so planning is paused. Take it back to change the plan.'
          : '',
    openTask: (id) => t.showTask(id),
    createSprint: (input) => then(createSprint(home, input)),
    updateSprint: (id, input) => then(updateSprint(home, id, input)),
    deleteSprint: (id) => then(deleteSprint(home, id)),
    startSprint: (id) => then(startSprint(home, id)),
    finishSprint: (id, carryTo) => then(finishSprint(home, id, carryTo)),
    moveToSprint: (ids, sprintId) => then(moveTasksToSprint(home, ids, sprintId)),
    setRank: (id, rank) => then(setTaskRank(home, id, rank)),
    addToBacklog: async (title) => {
      if (!viewerId) return
      await then(addTask(board.id, { title, details: '', weight: 1, dueAt: null }, viewerId))
    },
  }
}
```

Check that `TaskAssignee.profile` is the field name (`src/lib/types.ts`). If the profile is not optional, drop the `flatMap` guard and use `.map((a) => fullName(a.profile))`.

- [ ] **Step 3: `TaskBoard.tsx` adds new tasks to the scoped sprint**

Add the prop `newTaskSprint = null` (type `newTaskSprint?: string | null`, comment `/** New tasks join this sprint; null puts them in the backlog. */`). In `save`, change the add branch to `else await addTask(board.id, { ...input, sprintId: newTaskSprint }, viewerId)`.

- [ ] **Step 4: `StudentTasksView.tsx`**

1. Add these imports:

```tsx
import { BacklogView } from '../work/BacklogView'
import { ScopePicker } from '../work/ScopePicker'
import { SprintsView } from '../work/SprintsView'
import { classWorkSource } from './classWorkSource'
import { sprintCalendarEvents } from '../../lib/work/calendar'
import { scopeOptions, scopeSprintId } from '../../lib/work/scope'
import { sprintBands } from '../../lib/work/timeline'
```

   Merge these with the existing `lib/work/calendar` import.
2. Replace the `t.section === 'summary' ? (…) : (<>…</>)` ternary with a three-way:

```tsx
          {t.section === 'summary' ? (
            /* …existing summary block, unchanged… */
          ) : t.section === 'backlog' || t.section === 'sprints' ? (
            (() => {
              const source = classWorkSource(t, viewerId)
              if (!source) return null
              return t.section === 'backlog' ? (
                <BacklogView source={source} />
              ) : (
                <SprintsView source={source} onPlan={() => t.setSection('backlog')} />
              )
            })()
          ) : (
            <>{/* …existing Tasks content… */}</>
          )}
```

3. In the Tasks content:
   - Above `TaskViewSwitch`, add `{t.sprints.length > 0 && <ScopePicker value={t.sprintScope} options={scopeOptions(t.sprints)} onChange={t.setSprintScope} />}`.
   - The board's tasks must now always follow `shown`, because the sprint scope narrows it even with no filters. Replace the `tasks={t.filters === EMPTY_TASK_FILTERS ? t.tasks : t.tasks.filter((task) => t.shown.some((r) => r.id === task.id))}` expression with `tasks={t.tasks.filter((task) => t.shown.some((r) => r.id === task.id))}`. Remove the `EMPTY_TASK_FILTERS` import if it becomes unused.
   - Pass `newTaskSprint={scopeSprintId(t.sprintScope, t.sprints)}` to `TaskBoard`.
   - Pass `bands={sprintBands(t.sprints)}` to `TimelineView`.
   - Use calendar `events={[...taskCalendarEvents(t.shown), ...sprintCalendarEvents(t.sprints)]}`.
4. Change the `TaskDetailModal` guard from `(t.section === 'summary' || t.view !== 'board')` to `(t.section !== 'tasks' || t.view !== 'board')`, so tasks opened from Backlog and Sprints open too.

- [ ] **Step 5: `ProfessorTasksView.tsx`**

1. Use the same imports as Step 4, plus `Select` from `../ui/Select`.
2. Add a `t.section === 'backlog' || t.section === 'sprints'` branch between the summary and tasks fragments:

```tsx
      {(t.section === 'backlog' || t.section === 'sprints') && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3>{active ? boardOwnerName(active) : `Choose a ${who}`}</h3>
              <p className="mt-0.5 text-[13px] text-muted">
                {active ? `This ${who}'s plan, as they keep it.` : `Each ${who} plans its own sprints. Pick one to follow its plan.`}
              </p>
            </div>
            <div className="w-full max-w-xs">
              <Select
                value={active?.id ?? ''}
                onChange={(e) => t.showBoard(e.target.value || null)}
                placeholder={`Choose a ${who}`}
                options={(boards ?? []).map((b) => ({ value: b.id, label: boardOwnerName(b) }))}
                aria-label={`Which ${who}`}
                className="!h-10 !text-[13px]"
              />
            </div>
          </div>
          {(() => {
            const source = classWorkSource(t, viewerId)
            if (!source) return null
            return t.section === 'backlog' ? (
              <BacklogView source={source} />
            ) : (
              <SprintsView source={source} onPlan={() => t.setSection('backlog')} />
            )
          })()}
        </section>
      )}
```

3. In the Tasks fragment, with a board chosen:
   - Add `{active && t.sprints.length > 0 && <ScopePicker value={t.sprintScope} options={scopeOptions(t.sprints)} onChange={t.setSprintScope} />}` above `TaskViewSwitch`.
   - Pass `bands={active ? sprintBands(t.sprints) : []}` to `TimelineView`.
   - Append `...(active ? sprintCalendarEvents(t.sprints) : [])` to the calendar events.

- [ ] **Step 6: Build, lint, test**

Run: `npm run build`, `npx eslint src`, `npx vitest run`. Expect all clean and passing.

- [ ] **Step 7: Commit**

```bash
git add src/components/tasks/useProjectTasks.ts src/components/tasks/classWorkSource.ts src/components/tasks/StudentTasksView.tsx src/components/tasks/ProfessorTasksView.tsx src/components/tasks/TaskBoard.tsx
git commit -m "Let groups plan and run sprints on their class boards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Verify in the browser, hand off, push

**Files:**
- Modify: `handoff.md`

- [ ] **Step 1: Work project, signed in as an Owner** (`/projects/<id>?tab=work`)
- **Backlog:** create "Sprint 1" (the dates are pre-filled), move two tasks into it from the row picker, and check two backlog tasks and move them together. Move a task up and down. Add a task from the quick-add row.
- **Starting:** start Sprint 1. Its Start button disables the others ("Finish Sprint 1 first").
- **Sprints:** the running card shows the dates, days left, progress, burndown and stage columns, and clicking a title opens the task.
- **Finishing:** finish it into a new sprint. The unfinished tasks appear in Sprint 2, and Sprint 1 is listed under Finished.
- **Tasks:** the scope picker defaults to the running sprint and lists the others. Timeline shows the Sprints row, and Calendar shows the start and end chips. A task added from Tasks while scoped to a sprint lands in it.
- `read_console_messages` shows no errors.

- [ ] **Step 2: Class project**
- As a professor: Backlog and Sprints ask for a group, then show that group's plan read-only with the info alert. Tasks shows the scope picker once a group is chosen.
- As a student (ask the owner to sign in if needed): plan, start and finish a sprint on the group's board. Hand the board in, and the Backlog shows "planning is paused".

- [ ] **Step 3: Layout**: at 375×812 the Backlog rows wrap with no sideways page scroll, the dialogs fit, and the burndown scales down. Check dark mode and light mode. Take screenshots of Backlog and Sprints.

- [ ] **Step 4: Append to `handoff.md`**

```markdown
**Change (2026-10-0X): Backlog and Sprints in Work.** Part 2 of 4 of the Work tab plan
(plan: docs/superpowers/plans/2026-10-06-work-tab-part-2.md).
- Work › Backlog plans: planned sprints with their tasks, then the backlog (unfinished, no sprint,
  ordered by `rank`); move tasks by row picker or in bulk, up/down to reorder, quick add.
  Work › Sprints runs: the running sprint (dates, days left, progress, burndown, stage columns,
  Finish) and finished sprints. Finishing moves unfinished tasks to a planned sprint, a new one,
  or the backlog (`complete_general_sprint` / `complete_board_sprint`).
- Tasks has a scope picker (`?scope=running|all|backlog|sprint:<id>`, default the running sprint);
  new tasks added there join the scoped sprint. Timeline draws a Sprints row; Calendar shows starts
  and ends.
- Who plans: work = manage_tasks (Owners, Managers); class = the group while the board is open;
  professors read. One running sprint per project/board; planned → running → finished only;
  only a planned sprint can be deleted (its tasks return to the backlog).
- SQL (applied live): `work-planning.sql` (sprint_state, prepare_sprint, guard_sprint_state,
  general_sprints, general_tasks.sprint_id/rank, general_tasks_plan_guard, overview view) and
  `class-planning.sql` (board_sprints, project_tasks.sprint_id/rank, detail view). Re-run notes in
  docs/07-backup.md.
- Code: `lib/work/{types,sprints,backlog,scope}.ts`, `lib/api/sprints.ts` (both spaces),
  `components/work/{BacklogView,SprintsView,SprintDialog,FinishSprintDialog,Burndown,ScopePicker}.tsx`,
  `general/workSource.ts`, `tasks/classWorkSource.ts`.
- Checked: work-planning N PASS, class-planning N PASS, regression suites; build, eslint, Vitest N;
  browser as listed in the plan.
- Next: Part 3, Milestones.
```

Fill in the date and every N from the actual runs.

- [ ] **Step 5: Commit and push**

```bash
git add handoff.md
git commit -m "Hand off Work tab part 2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

## Self-review notes

- **Spec coverage for Part 2:**
  - Sprint SQL and tests, in both spaces: Tasks 1–2.
  - Adapters (`WorkSource`, one per space): Tasks 3, 9 and 10.
  - The Backlog page: Task 8.
  - The Sprints page, with burndown and finish carry-over: Tasks 7–8.
  - The scope picker: Tasks 4, 9 and 10.
  - Sprint bands on the Timeline and the Calendar: Task 6.
  - Sprint selection in task dialogs: replaced by "new tasks join the scoped sprint" (Tasks 9–10) and by moving tasks on Backlog. This is noted in Global Constraints.
- **Not in this part:** milestones, which come in Part 3, and the Summary sprint card, which comes in Part 4.
