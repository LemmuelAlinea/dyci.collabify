-- A sprint can count toward a milestone.
--
-- Whoever plans adds a sprint to a milestone; every task in that sprint then
-- counts toward it, including tasks that join the sprint later, so the
-- milestone is reached when the sprint's tasks are all done. It works through
-- the tags milestones already read (milestone_id on tasks), so progress,
-- status, Summary and the professor's grid need nothing new:
--
--   * Adding a sprint tags its tasks that have no milestone (or had the
--     sprint's previous one); removing it untags the ones it tagged.
--   * A task that joins a sprint with a milestone, untagged, takes it.
--   * A task keeps its tag when it leaves the sprint (carried to the next one,
--     say): unfinished work still counts. Untag it by hand to stop that.
--
-- One milestone per sprint. Work: general_sprints.milestone_id, a composite
-- FK so it stays in the project; set by whoever may update the sprint
-- (manage_tasks). Class: board_sprints.milestone_id, one of the class
-- project's milestones (the professor's), set by the group while the board is
-- open; guard_board_sprint_milestone keeps it in the board's project.
--
-- Redefines guard_sprint_state (first defined in supabase/work-planning.sql,
-- which carries the same body; keep the two in step) so a finished sprint can
-- still lose or change its milestone: deleting a milestone sets the link to
-- null on finished sprints too.
--
-- Run after work-milestones.sql and class-milestones.sql. Idempotent.

begin;

/**
 * Planned → running → finished, never backwards, and a finished sprint is
 * fixed except for its milestone. The timestamps are stamped here so a client
 * cannot backdate them. Shared by general_sprints and board_sprints, so the
 * owning column is pinned by table name.
 */
create or replace function public.guard_sprint_state()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.state = 'completed'
     and (new.name, new.goal, new.starts_on, new.ends_on, new.state)
         is distinct from (old.name, old.goal, old.starts_on, old.ends_on, old.state) then
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

revoke all on function public.guard_sprint_state() from public, anon;

-- ---------------------------------------------------------------- columns

alter table public.general_sprints add column if not exists milestone_id uuid;
do $$ begin
  alter table public.general_sprints
    add constraint general_sprints_milestone_fk foreign key (milestone_id, project_id)
    references public.general_milestones (id, project_id) on delete set null (milestone_id);
exception when duplicate_object then null; end $$;
create index if not exists general_sprints_milestone_idx
  on public.general_sprints (milestone_id) where milestone_id is not null;

alter table public.board_sprints add column if not exists milestone_id uuid;
do $$ begin
  alter table public.board_sprints
    add constraint board_sprints_milestone_fk foreign key (milestone_id)
    references public.project_milestones (id) on delete set null;
exception when duplicate_object then null; end $$;
create index if not exists board_sprints_milestone_idx
  on public.board_sprints (milestone_id) where milestone_id is not null;

comment on column public.general_sprints.milestone_id is
  'The milestone this sprint counts toward; its tasks are tagged with it.';
comment on column public.board_sprints.milestone_id is
  'The class milestone this sprint counts toward; its tasks are tagged with it.';

/** A board's sprint can only count toward a milestone of the board's project. */
create or replace function public.guard_board_sprint_milestone()
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

revoke all on function public.guard_board_sprint_milestone() from public, anon;

drop trigger if exists board_sprints_milestone_guard on public.board_sprints;
create trigger board_sprints_milestone_guard before insert or update on public.board_sprints
  for each row execute function public.guard_board_sprint_milestone();

-- ---------------------------------------------------------------- tagging

/**
 * A sprint's milestone changed: tag its live tasks that had none or had the
 * old one, and so untag them when it is taken away. Archived tasks are left
 * alone (their guards freeze them). Security definer so tasks the planner
 * cannot see are tagged too; the sprint update itself already passed RLS, and
 * the task guards still check the caller.
 */
create or replace function public.sprint_milestone_retag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.milestone_id is not distinct from old.milestone_id then
    return null;
  end if;
  if tg_table_name = 'general_sprints' then
    update public.general_tasks set milestone_id = new.milestone_id
     where sprint_id = new.id and archived_at is null
       and (milestone_id is null or milestone_id = old.milestone_id);
  else
    update public.project_tasks set milestone_id = new.milestone_id
     where sprint_id = new.id and archived_at is null
       and (milestone_id is null or milestone_id = old.milestone_id);
  end if;
  return null;
end;
$$;

revoke all on function public.sprint_milestone_retag() from public, anon;

drop trigger if exists general_sprints_milestone_retag on public.general_sprints;
create trigger general_sprints_milestone_retag after update of milestone_id on public.general_sprints
  for each row execute function public.sprint_milestone_retag();
drop trigger if exists board_sprints_milestone_retag on public.board_sprints;
create trigger board_sprints_milestone_retag after update of milestone_id on public.board_sprints
  for each row execute function public.sprint_milestone_retag();

/**
 * An untagged task joining a sprint takes the sprint's milestone. Named to
 * fire before the *_milestone_guard triggers, which then check the tag as for
 * any other.
 */
create or replace function public.task_follow_sprint_milestone()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sprint_id is null or new.milestone_id is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.sprint_id is not distinct from old.sprint_id then
    return new;
  end if;
  if tg_table_name = 'general_tasks' then
    select s.milestone_id into new.milestone_id from public.general_sprints s where s.id = new.sprint_id;
  else
    select s.milestone_id into new.milestone_id from public.board_sprints s where s.id = new.sprint_id;
  end if;
  return new;
end;
$$;

revoke all on function public.task_follow_sprint_milestone() from public, anon;

drop trigger if exists general_tasks_milestone_follow on public.general_tasks;
create trigger general_tasks_milestone_follow before insert or update of sprint_id on public.general_tasks
  for each row execute function public.task_follow_sprint_milestone();
drop trigger if exists project_tasks_milestone_follow on public.project_tasks;
create trigger project_tasks_milestone_follow before insert or update of sprint_id on public.project_tasks
  for each row execute function public.task_follow_sprint_milestone();

commit;
