-- supabase/project-milestone-rules.sql
--
-- A work project's milestone rules: completion, due dates and dependencies.
--
-- Four general_projects columns, written through the existing update policy
-- (general_has edit_project, so the project manager). Their defaults keep
-- today's behaviour: milestone_completion 'automatic' (or 'manual'),
-- require_milestone_due on, allow_milestone_dependencies on and
-- milestone_overdue_alerts on (read by the overdue alert job).
--
-- general_milestones gains reached_auto (the database reached it, not a
-- person) and overdue_notified_at (for the overdue alert job). due_on becomes
-- nullable.
--
-- Triggers, added beside the existing ones (none of those is redefined):
--
--   general_milestones_rules (check_general_milestone_rules), before insert or
--     update, after general_milestones_guard (which still stamps reached_at
--     with the server's clock). Refuses a missing due_on while the project's
--     require_milestone_due is on (always on a class board's Files project):
--     on an insert, when a date is cleared, and when an undated milestone is
--     edited (any column but reached_at, reached_auto and overdue_notified_at
--     changes), so turning the switch back on keeps undated milestones until
--     someone edits them; marking one reached is not editing. Refuses setting
--     reached_at while a milestone it waits for isn't reached ("Waiting for
--     {name}. Reach it first."), and clearing it while a reached milestone
--     waits for this one ("{waiter} waits for this milestone. Mark {waiter}
--     not reached first."). A person who sets or clears reached_at sets
--     reached_auto to false, and nobody else changes reached_auto.
--   general_milestones_0_deleting, before delete, ahead of
--     general_milestones_release: names the milestone being deleted, so the
--     untagging release_milestone_tasks does doesn't settle (update) the row
--     its own delete is about to remove.
--   general_milestones_zz_waiters, after reached_at turns on or off: settles
--     the milestones that wait for this one.
--   general_tasks_zz_milestone_reach (+ _insert, _delete), after a task's
--     milestone, done-ness, archive or trash changes, after an insert of a
--     tagged task, and after a live tagged task is deleted: settles the
--     milestones it left and joined. Compared on the final row rather than
--     the columns named in the update, so stage moves (sync_general_task_stage
--     sets status) and sprint moves (task_follow_sprint_milestone sets
--     milestone_id) count.
--   general_milestone_dependencies_settle, after a link is added or removed
--     (or cascades away with its blocker): settles the waiting milestone.
--   general_projects_milestone_settle, after a project switches back to
--     automatic: settles its milestones.
--
-- settle_general_milestone(id): in automatic mode on a live work project, a
-- milestone with at least one live task (not archived, not trashed; private
-- planning work counts), all of them done, and every milestone it waits for
-- reached, is reached (reached_at now(), reached_auto true); an automatic
-- reach that no longer holds is undone. A reached milestone never waits:
-- while one it waits for isn't reached, its reach is undone, a reach someone
-- marked included (so an automatic un-reach runs down the chain). Otherwise a
-- marked reach stays, and manual mode changes nothing. It reads the project
-- first and locks the milestone only when it may write. It writes with
-- collabify.milestone_auto on (transaction-local), so the people-only rules
-- above don't block it; as security definer it isn't held to the milestone
-- update policy, so a member who finishes the last task reaches the
-- milestone. It locks the milestone row before it counts, so two tasks
-- finished at once both see each other's work. It only writes when the state
-- changes, and the links have no loops, so a cascade ends.
--
-- general_milestone_dependencies (milestone_id waits for depends_on_id), both
-- in one project (composite keys onto general_milestones (id, project_id)),
-- no self-links, no loops. Read by whoever reads the project; written only
-- through add_general_milestone_dependency and
-- remove_general_milestone_dependency, for whoever may manage the project's
-- milestones (general_can_manage_milestones). Adding is refused while the
-- project's allow_milestone_dependencies is off (existing links stay and
-- still hold, and can still be removed), and when a reached milestone would
-- wait for one that isn't reached. Adding locks both milestones (for share)
-- until commit, so their reach can't change under the check.
--
-- Class milestones (project_milestones) are untouched.
--
-- Run after project-member-rules.sql, then anon-lockdown.sql. Re-running
-- work-milestones.sql or project-member-rules.sql means re-running this file
-- afterwards, then anon-lockdown.sql.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- columns

alter table public.general_projects
  add column if not exists milestone_completion text not null default 'automatic'
    check (milestone_completion in ('automatic', 'manual')),
  add column if not exists require_milestone_due boolean not null default true,
  add column if not exists allow_milestone_dependencies boolean not null default true,
  add column if not exists milestone_overdue_alerts boolean not null default true;

alter table public.general_milestones
  add column if not exists reached_auto boolean not null default false,
  add column if not exists overdue_notified_at timestamptz;

alter table public.general_milestones alter column due_on drop not null;

-- ---------------------------------------------------------------- dependencies

-- milestone_id waits for depends_on_id. The composite keys keep both in the
-- row's project.
create table if not exists public.general_milestone_dependencies (
  milestone_id  uuid not null,
  depends_on_id uuid not null,
  project_id    uuid not null references public.general_projects (id) on delete cascade,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (milestone_id, depends_on_id),
  constraint general_milestone_dependencies_not_self check (milestone_id <> depends_on_id),
  constraint general_milestone_dependencies_milestone foreign key (milestone_id, project_id)
    references public.general_milestones (id, project_id) on delete cascade,
  constraint general_milestone_dependencies_depends_on foreign key (depends_on_id, project_id)
    references public.general_milestones (id, project_id) on delete cascade
);
create index if not exists general_milestone_dependencies_depends_on
  on public.general_milestone_dependencies (depends_on_id);
create index if not exists general_milestone_dependencies_project
  on public.general_milestone_dependencies (project_id);

alter table public.general_milestone_dependencies enable row level security;
drop policy if exists general_milestone_dependencies_select on public.general_milestone_dependencies;
create policy general_milestone_dependencies_select on public.general_milestone_dependencies
  for select to authenticated
  using (public.can_read_general_project(project_id));
revoke all on table public.general_milestone_dependencies from public, anon, authenticated;
grant select on table public.general_milestone_dependencies to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.general_milestone_dependencies;
  exception
    when duplicate_object then null;
    when undefined_object then null;   -- no realtime publication on this database
  end;
  alter table public.general_milestone_dependencies replica identity full;
end $$;

-- ---------------------------------------------------------------- settling

/**
 * Reaches or un-reaches one milestone to match its tasks and what it waits
 * for, in automatic mode only. See the header. Does nothing for a milestone
 * that is being deleted, gone, on a class board, in manual mode or on an
 * archived project.
 */
create or replace function public.settle_general_milestone(p_milestone uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m         public.general_milestones%rowtype;
  gp        public.general_projects%rowtype;
  v_project uuid;
  v_done    boolean;
  v_blocked boolean;
  v_reach   boolean;
  prior     text := current_setting('collabify.milestone_auto', true);
begin
  if p_milestone is null
     or p_milestone::text = coalesce(current_setting('collabify.milestone_deleting', true), '') then
    return;
  end if;
  select g.project_id into v_project from public.general_milestones g where g.id = p_milestone;
  if not found then
    return;
  end if;
  select * into gp from public.general_projects where id = v_project;
  if not found then
    return;
  end if;
  if gp.class_board_id is not null or gp.milestone_completion <> 'automatic'
     or gp.archived_at is not null then
    return;
  end if;
  -- Locked before counting; the counts are later statements, so they see work
  -- another transaction committed while this one waited for the lock.
  select * into m from public.general_milestones where id = p_milestone for update;
  if not found then
    return;
  end if;

  v_done :=
    exists (select 1 from public.general_tasks t
             where t.milestone_id = m.id and t.archived_at is null and t.trashed_at is null)
    and not exists (select 1 from public.general_tasks t
                     where t.milestone_id = m.id and t.archived_at is null
                       and t.trashed_at is null and t.status <> 'done');
  v_blocked :=
    exists (select 1 from public.general_milestone_dependencies d
              join public.general_milestones b on b.id = d.depends_on_id
             where d.milestone_id = m.id and b.reached_at is null);
  v_reach := v_done and not v_blocked;

  -- A reached milestone never waits: a blocker that isn't reached undoes any
  -- reach, a marked one included. Otherwise a marked reach stays.
  if m.reached_at is null then
    if not v_reach then
      return;
    end if;
  elsif not v_blocked and (v_done or not m.reached_auto) then
    return;
  end if;

  begin
    perform set_config('collabify.milestone_auto', 'on', true);
    update public.general_milestones
       set reached_at   = case when v_reach then now() end,
           reached_auto = v_reach
     where id = m.id;
    perform set_config('collabify.milestone_auto', coalesce(nullif(prior, ''), 'off'), true);
  exception when others then
    perform set_config('collabify.milestone_auto', coalesce(nullif(prior, ''), 'off'), true);
    raise;
  end;
end;
$$;

/**
 * A task's milestone, done-ness, archive or trash changed: settle the
 * milestones it left and joined, in id order so two moves can't deadlock.
 */
create or replace function public.reach_general_task_milestones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a uuid;
  b uuid;
  x uuid;
begin
  if tg_op <> 'INSERT' then
    a := old.milestone_id;
  end if;
  if tg_op <> 'DELETE' then
    b := new.milestone_id;
  end if;
  if a is not null and b is not null and b < a then
    x := a; a := b; b := x;
  end if;
  perform public.settle_general_milestone(a);
  if b is distinct from a then
    perform public.settle_general_milestone(b);
  end if;
  return null;
end;
$$;

drop trigger if exists general_tasks_zz_milestone_reach on public.general_tasks;
create trigger general_tasks_zz_milestone_reach
  after update on public.general_tasks
  for each row
  when (old.milestone_id is distinct from new.milestone_id
        or (old.status = 'done') is distinct from (new.status = 'done')
        or (old.archived_at is null) is distinct from (new.archived_at is null)
        or (old.trashed_at is null) is distinct from (new.trashed_at is null))
  execute function public.reach_general_task_milestones();

drop trigger if exists general_tasks_zz_milestone_reach_insert on public.general_tasks;
create trigger general_tasks_zz_milestone_reach_insert
  after insert on public.general_tasks
  for each row when (new.milestone_id is not null)
  execute function public.reach_general_task_milestones();

drop trigger if exists general_tasks_zz_milestone_reach_delete on public.general_tasks;
create trigger general_tasks_zz_milestone_reach_delete
  after delete on public.general_tasks
  for each row
  when (old.milestone_id is not null and old.archived_at is null and old.trashed_at is null)
  execute function public.reach_general_task_milestones();

/** A milestone was reached or un-reached: settle the milestones waiting for it. */
create or replace function public.settle_general_milestone_waiters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w uuid;
begin
  for w in
    select d.milestone_id from public.general_milestone_dependencies d
     where d.depends_on_id = new.id
     order by d.milestone_id
  loop
    perform public.settle_general_milestone(w);
  end loop;
  return null;
end;
$$;

drop trigger if exists general_milestones_zz_waiters on public.general_milestones;
create trigger general_milestones_zz_waiters
  after update on public.general_milestones
  for each row when ((old.reached_at is null) is distinct from (new.reached_at is null))
  execute function public.settle_general_milestone_waiters();

/** A link was added or removed: settle the milestone that waits (or waited). */
create or replace function public.settle_general_milestone_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.settle_general_milestone(
    case when tg_op = 'DELETE' then old.milestone_id else new.milestone_id end);
  return null;
end;
$$;

drop trigger if exists general_milestone_dependencies_settle on public.general_milestone_dependencies;
create trigger general_milestone_dependencies_settle
  after insert or delete on public.general_milestone_dependencies
  for each row execute function public.settle_general_milestone_link();

/** A project switched back to automatic: settle its milestones. */
create or replace function public.settle_general_project_milestones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m uuid;
begin
  for m in
    select g.id from public.general_milestones g
     where g.project_id = new.id
     order by g.due_on nulls last, g.id
  loop
    perform public.settle_general_milestone(m);
  end loop;
  return null;
end;
$$;

drop trigger if exists general_projects_milestone_settle on public.general_projects;
create trigger general_projects_milestone_settle
  after update of milestone_completion on public.general_projects
  for each row
  when (new.milestone_completion = 'automatic'
        and old.milestone_completion is distinct from new.milestone_completion)
  execute function public.settle_general_project_milestones();

/**
 * Names the milestone being deleted for settle_general_milestone, before
 * general_milestones_release untags its tasks. Updating the row inside its
 * own delete would be refused. A name left behind is harmless: that
 * milestone is gone.
 */
create or replace function public.mark_general_milestone_deleting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('collabify.milestone_deleting', old.id::text, true);
  return old;
end;
$$;

drop trigger if exists general_milestones_0_deleting on public.general_milestones;
create trigger general_milestones_0_deleting
  before delete on public.general_milestones
  for each row execute function public.mark_general_milestone_deleting();

-- ---------------------------------------------------------------- people's rules

/**
 * Due dates, waiting and reached_auto for writes people make. The settling
 * cascade (collabify.milestone_auto on) passes; it decides for itself.
 */
create or replace function public.check_general_milestone_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gp  public.general_projects%rowtype;
  blk text;
  -- Bookkeeping, not editing: these change without the date mattering.
  keep constant text[] := array['reached_at', 'reached_auto', 'overdue_notified_at'];
begin
  if coalesce(current_setting('collabify.milestone_auto', true), 'off') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.reached_auto := false;
  elsif (new.reached_at is null) is distinct from (old.reached_at is null) then
    new.reached_auto := false;
  else
    new.reached_auto := old.reached_auto;
  end if;

  select * into gp from public.general_projects where id = new.project_id;
  if new.due_on is null
     and (gp.class_board_id is not null or coalesce(gp.require_milestone_due, true))
     and (tg_op = 'INSERT'
          or old.due_on is not null
          or (to_jsonb(new) - keep) is distinct from (to_jsonb(old) - keep)) then
    raise exception 'Give the milestone a due date.' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' and new.reached_at is not null and old.reached_at is null then
    select b.name into blk
      from public.general_milestone_dependencies d
      join public.general_milestones b on b.id = d.depends_on_id
     where d.milestone_id = new.id and b.reached_at is null
     order by b.due_on nulls last, b.name, b.id
     limit 1;
    if found then
      raise exception 'Waiting for %. Reach it first.', blk using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.reached_at is null and old.reached_at is not null then
    select w.name into blk
      from public.general_milestone_dependencies d
      join public.general_milestones w on w.id = d.milestone_id
     where d.depends_on_id = new.id and w.reached_at is not null
     order by w.due_on nulls last, w.name, w.id
     limit 1;
    if found then
      raise exception '% waits for this milestone. Mark % not reached first.', blk, blk
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists general_milestones_rules on public.general_milestones;
create trigger general_milestones_rules
  before insert or update on public.general_milestones
  for each row execute function public.check_general_milestone_rules();

-- ---------------------------------------------------------------- links

/**
 * The checks both link changes share: the milestone exists on a live work
 * project and the caller may manage its milestones. Returns the project.
 */
create or replace function public.general_milestone_links_check(p_milestone uuid)
returns public.general_projects
language plpgsql stable security definer set search_path = public as $$
declare
  m  public.general_milestones%rowtype;
  gp public.general_projects%rowtype;
begin
  select * into m from public.general_milestones where id = p_milestone;
  if m.id is null then
    raise exception 'Choose two milestones in this project.' using errcode = 'check_violation';
  end if;
  select * into gp from public.general_projects where id = m.project_id;
  if gp.class_board_id is not null then
    raise exception 'Milestone dependencies are for work projects.' using errcode = 'check_violation';
  end if;
  if auth.uid() is null or public.general_role_of(gp.id, auth.uid()) is null then
    raise exception 'You are not on this project.' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(gp.id) then
    raise exception '%', public.general_archived_message(gp.id) using errcode = 'check_violation';
  end if;
  if not public.general_can_manage_milestones(gp.id) then
    raise exception 'Only someone who manages milestones can link them.'
      using errcode = 'insufficient_privilege';
  end if;
  return gp;
end;
$$;

/** p_milestone waits for p_depends_on. Adding a link that exists changes nothing. */
create or replace function public.add_general_milestone_dependency(p_milestone uuid, p_depends_on uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  gp public.general_projects%rowtype;
  m  public.general_milestones%rowtype;
  b  public.general_milestones%rowtype;
begin
  if p_milestone = p_depends_on then
    raise exception 'That would make the milestones wait for each other.'
      using errcode = 'check_violation';
  end if;
  gp := public.general_milestone_links_check(p_milestone);
  -- Held until commit, so neither one's reach changes under the checks below
  -- (a reach change takes a row lock this conflicts with).
  perform 1 from public.general_milestones
   where id in (p_milestone, p_depends_on) order by id for share;
  select * into m from public.general_milestones where id = p_milestone;
  select * into b from public.general_milestones where id = p_depends_on;
  if b.id is null then
    raise exception 'Choose two milestones in this project.' using errcode = 'check_violation';
  end if;
  if b.project_id is distinct from gp.id then
    raise exception 'Both milestones must be in the same project.' using errcode = 'check_violation';
  end if;
  if not gp.allow_milestone_dependencies then
    raise exception 'Milestone dependencies are turned off for this project.'
      using errcode = 'check_violation';
  end if;
  if m.reached_at is not null and b.reached_at is null then
    raise exception 'This milestone is reached. Mark it not reached, or reach % first.', b.name
      using errcode = 'check_violation';
  end if;

  -- One link change at a time per project, so two links can't close a loop together.
  perform pg_advisory_xact_lock(hashtextextended('general_milestone_dependencies:' || gp.id::text, 0));
  if exists (
    with recursive chain (id) as (
      select d.depends_on_id from public.general_milestone_dependencies d
       where d.milestone_id = p_depends_on
      union
      select d.depends_on_id from public.general_milestone_dependencies d
        join chain c on d.milestone_id = c.id
    )
    select 1 from chain where id = p_milestone
  ) then
    raise exception 'That would make the milestones wait for each other.'
      using errcode = 'check_violation';
  end if;

  insert into public.general_milestone_dependencies (milestone_id, depends_on_id, project_id, created_by)
  values (p_milestone, p_depends_on, gp.id, auth.uid())
  on conflict (milestone_id, depends_on_id) do nothing;
end;
$$;

/** p_milestone stops waiting for p_depends_on. Works while dependencies are off. */
create or replace function public.remove_general_milestone_dependency(p_milestone uuid, p_depends_on uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.general_milestone_links_check(p_milestone);
  delete from public.general_milestone_dependencies
   where milestone_id = p_milestone and depends_on_id = p_depends_on;
end;
$$;

-- ---------------------------------------------------------------- existing milestones

-- Milestones whose tasks were all done counted as reached in the app; the
-- database now records it. Settling only writes when the state differs.
do $$
declare
  m uuid;
begin
  for m in
    select g.id from public.general_milestones g
      join public.general_projects gp on gp.id = g.project_id
     where gp.class_board_id is null and gp.milestone_completion = 'automatic'
     order by g.project_id, g.due_on nulls last, g.id
  loop
    perform public.settle_general_milestone(m);
  end loop;
end $$;

-- ---------------------------------------------------------------- grants

revoke all on function public.settle_general_milestone(uuid) from public, anon, authenticated;
revoke all on function public.general_milestone_links_check(uuid) from public, anon, authenticated;
revoke all on function public.reach_general_task_milestones() from public, anon, authenticated;
revoke all on function public.settle_general_milestone_waiters() from public, anon, authenticated;
revoke all on function public.settle_general_milestone_link() from public, anon, authenticated;
revoke all on function public.settle_general_project_milestones() from public, anon, authenticated;
revoke all on function public.mark_general_milestone_deleting() from public, anon, authenticated;
revoke all on function public.check_general_milestone_rules() from public, anon, authenticated;
revoke all on function public.add_general_milestone_dependency(uuid, uuid) from public, anon;
grant execute on function public.add_general_milestone_dependency(uuid, uuid) to authenticated;
revoke all on function public.remove_general_milestone_dependency(uuid, uuid) from public, anon;
grant execute on function public.remove_general_milestone_dependency(uuid, uuid) to authenticated;

commit;
