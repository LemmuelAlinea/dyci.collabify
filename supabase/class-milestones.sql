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
  using (exists (select 1 from public.projects p where p.id = project_milestones.project_id));

drop policy if exists project_milestones_write on public.project_milestones;
create policy project_milestones_write on public.project_milestones
  for all to authenticated
  using (public.is_class_professor((select p.class_id from public.projects p where p.id = project_milestones.project_id)))
  with check (public.is_class_professor((select p.class_id from public.projects p where p.id = project_milestones.project_id)));

revoke all on public.project_milestones from anon;
grant select, insert, update, delete on public.project_milestones to authenticated;

-- ---------------------------------------------------------------- tasks

alter table public.project_tasks add column if not exists milestone_id uuid;

-- Deferred NO ACTION, not on delete set null and not immediate. Deleting a
-- project cascades to its boards, tasks and milestones in no promised order.
-- A set-null update on tasks that outlive the project row is refused by
-- guard_task_edit (is_board_professor is false once the project is gone), and
-- an immediate NO ACTION check fires when the milestone's own cascade ends,
-- possibly before the board cascade has removed the tasks. Checked at commit,
-- the tasks are gone either way. A milestone deleted on its own untags its
-- tasks first, in guard_project_milestone.
alter table public.project_tasks drop constraint if exists project_tasks_milestone_fk;
alter table public.project_tasks
  add constraint project_tasks_milestone_fk foreign key (milestone_id)
  references public.project_milestones (id) deferrable initially deferred;

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

/**
 * A milestone never moves to another project (the same-project rule on tasks
 * would break), who made it and when are fixed at insert, and deleting one
 * untags its tasks first, as the caller, so the professor's path through
 * guard_task_edit applies, archived tasks included. When the project itself is
 * going, its tasks are going too: return at once.
 */
create or replace function public.guard_project_milestone()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.project_id := old.project_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    return new;
  end if;
  if not exists (select 1 from public.projects where id = old.project_id) then
    return old;
  end if;
  update public.project_tasks set milestone_id = null where milestone_id = old.id;
  return old;
end;
$$;

revoke all on function public.guard_project_milestone() from public, anon;

drop trigger if exists project_milestones_guard_insert on public.project_milestones;
create trigger project_milestones_guard_insert before insert on public.project_milestones
  for each row execute function public.guard_project_milestone();

drop trigger if exists project_milestones_guard_edit on public.project_milestones;
create trigger project_milestones_guard_edit before update on public.project_milestones
  for each row execute function public.guard_project_milestone();

drop trigger if exists project_milestones_untag_tasks on public.project_milestones;
create trigger project_milestones_untag_tasks before delete on public.project_milestones
  for each row execute function public.guard_project_milestone();

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
  -- Only projects whose class the caller teaches, so a forged origin on
  -- someone else's board finds nothing.
  select b.project_id into v_project
    from public.project_tasks t
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
   where t.origin_id = p_origin
     and public.is_class_professor(p.class_id)
   order by b.project_id
   limit 1;
  if v_project is null then
    if exists (select 1 from public.project_tasks where origin_id = p_origin) then
      raise exception 'Only the professor can tag the tasks they set.' using errcode = 'insufficient_privilege';
    end if;
    raise exception 'That task is not there any more. Reload the page.';
  end if;
  if p_milestone is not null and not exists (
    select 1 from public.project_milestones where id = p_milestone and project_id = v_project
  ) then
    raise exception 'That milestone belongs to another project.' using errcode = 'check_violation';
  end if;

  update public.project_tasks
     set milestone_id = p_milestone
   where origin_id = p_origin and archived_at is null
     and board_id in (select id from public.project_boards where project_id = v_project);
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
