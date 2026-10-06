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

-- ---------------------------------------------------------------- deleting

/**
 * Deleting a planned sprint returns its tasks to the backlog. The foreign key's
 * `on delete set null` would do that on its own, but it updates the tasks
 * through guard_task_edit, which refuses any edit to an archived task unless
 * `collabify.task_archive_op` is on, and so would block the delete whenever an
 * archived task sat in the sprint. This trigger nulls sprint_id first with the
 * flag on (restoring whatever it was before). Security definer, because the
 * tasks' select policy hides archived ones: as the caller, the update would
 * miss them and the foreign key's own update would still trip the guard. The
 * trigger only fires for a row the caller's delete policy already let through
 * (planned sprint, member of the board, project open, board not handed in),
 * and the guard still runs on each task with auth.uid() unchanged: board
 * member, project not closed and board not handed in are checked ahead of the
 * archive check, so the flag lifts that one refusal and nothing else.
 */
create or replace function public.release_board_sprint_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  was text := current_setting('collabify.task_archive_op', true);
begin
  perform set_config('collabify.task_archive_op', 'on', true);
  update public.project_tasks set sprint_id = null where sprint_id = old.id;
  perform set_config('collabify.task_archive_op', coalesce(was, 'off'), true);
  return old;
end;
$$;

revoke all on function public.release_board_sprint_tasks() from public, anon;

drop trigger if exists board_sprints_release on public.board_sprints;
create trigger board_sprints_release before delete on public.board_sprints
  for each row execute function public.release_board_sprint_tasks();

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
