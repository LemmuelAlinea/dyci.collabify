begin;

-- supabase/work-workload.sql
-- Space workload, phase 1: task estimates (written only through
-- set_work_task_estimate, with a history row), weekly hours per work-space
-- membership (set_space_weekly_minutes) and personal time off (user_time_off).
-- Work projects and work spaces only. Stored in minutes.
-- Runs after project-open-tasks.sql and before anon-lockdown.sql. Idempotent.
-- Redefines nothing another file owns. Suite: supabase/tests/work-workload.test.sql.

------------------------------------------------------------ estimates

alter table public.general_tasks
  add column if not exists estimated_minutes integer;

-- The first version checked estimated_minutes > 0 under the default name.
alter table public.general_tasks drop constraint if exists general_tasks_estimated_minutes_check;
alter table public.general_tasks drop constraint if exists general_tasks_estimated_minutes_range;
alter table public.general_tasks
  add constraint general_tasks_estimated_minutes_range
  check (estimated_minutes between 1 and 60000);

-- A person changes an estimate only through set_work_task_estimate, which sets
-- collabify.estimate_write around its one update. Service writes (no auth.uid())
-- pass, except that a class board task never carries an estimate.
create or replace function public.guard_work_task_estimate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.estimated_minutes is not distinct from old.estimated_minutes then return new; end if;
  elsif new.estimated_minutes is null then
    return new;
  end if;

  if new.estimated_minutes is not null and exists (
    select 1 from public.general_projects p
     where p.id = new.project_id and p.class_board_id is not null
  ) then
    raise exception 'Estimates are for work projects only.' using errcode = 'check_violation';
  end if;

  if auth.uid() is not null
     and coalesce(current_setting('collabify.estimate_write', true), 'off') <> 'on' then
    raise exception 'Use the estimate field to change the estimate.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists general_tasks_work_estimate on public.general_tasks;
create trigger general_tasks_work_estimate
before insert or update of estimated_minutes on public.general_tasks
for each row execute function public.guard_work_task_estimate();

revoke all on function public.guard_work_task_estimate() from public, anon, authenticated;

-- Sets or clears (null) a task's estimate. The project manager and coordinators
-- estimate any task; a holder estimates a task they hold. Writes one 'updated'
-- history row: fields ["estimated_minutes"], estimate_from, estimate_to.
create or replace function public.set_work_task_estimate(p_task uuid, p_minutes int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t      public.general_tasks%rowtype;
  proj   public.general_projects%rowtype;
  prior  text := coalesce(current_setting('collabify.estimate_write', true), 'off');
begin
  if auth.uid() is null then
    raise exception 'Sign in to change the estimate.' using errcode = 'insufficient_privilege';
  end if;

  select * into t from public.general_tasks where id = p_task for update;
  if not found then
    raise exception 'Task not found. Refresh the page and try again.' using errcode = 'no_data_found';
  end if;
  select * into proj from public.general_projects where id = t.project_id;

  if proj.class_board_id is not null then
    raise exception 'Estimates are for work projects only.' using errcode = 'check_violation';
  end if;

  if not (
    public.general_can_write(t.project_id)
    and (
      coalesce(public.general_role_of(t.project_id, auth.uid())::text, '') in ('pm', 'coordinator')
      or exists (select 1 from public.general_task_assignees a
                  where a.task_id = t.id and a.user_id = auth.uid())
    )
  ) then
    raise exception 'Only the project manager, coordinators or the task''s holder can change the estimate.'
      using errcode = 'insufficient_privilege';
  end if;

  if proj.archived_at is not null or proj.trashed_at is not null then
    raise exception 'This project is archived. The project manager can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if t.archived_at is not null or t.trashed_at is not null then
    raise exception 'This task is archived. Restore it to change the estimate.'
      using errcode = 'check_violation';
  end if;

  if p_minutes is not null and (p_minutes < 1 or p_minutes > 60000) then
    raise exception 'Estimates run between 1 minute and 1000 hours. Enter a value in that range.'
      using errcode = 'check_violation';
  end if;

  if t.estimated_minutes is not distinct from p_minutes then
    return;
  end if;

  perform set_config('collabify.estimate_write', 'on', true);
  update public.general_tasks set estimated_minutes = p_minutes where id = t.id;
  perform set_config('collabify.estimate_write', prior, true);

  insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
  values (t.id, t.project_id, auth.uid(), 'updated',
          jsonb_build_object(
            'status', t.status,
            'fields', jsonb_build_array('estimated_minutes'),
            'estimate_from', t.estimated_minutes,
            'estimate_to', p_minutes));
end;
$$;

revoke all on function public.set_work_task_estimate(uuid, int) from public, anon;
grant execute on function public.set_work_task_estimate(uuid, int) to authenticated;

------------------------------------------------------------ weekly hours

-- One row per work-space membership. Null weekly_minutes means not set; it is
-- never read as zero or as a default. Read only through definer functions:
-- RLS is on and there are no policies.
create table if not exists public.general_space_capacity (
  space_id       uuid not null,
  user_id        uuid not null,
  weekly_minutes int check (weekly_minutes between 0 and 10080),
  updated_by     uuid references public.profiles (id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (space_id, user_id),
  foreign key (space_id, user_id)
    references public.general_space_members (space_id, user_id) on delete cascade
);

alter table public.general_space_capacity enable row level security;

-- Sets or clears (null) someone's weekly hours in a work space. A person sets
-- their own; the space's project manager and coordinators set anyone's.
create or replace function public.set_space_weekly_minutes(p_space uuid, p_user uuid, p_minutes int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.general_role;
begin
  if auth.uid() is null then
    raise exception 'Sign in to change weekly hours.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.general_spaces s where s.id = p_space and s.kind = 'work')
     or exists (select 1 from public.classes c where c.space_id = p_space) then
    raise exception 'Weekly hours apply to work spaces only.' using errcode = 'check_violation';
  end if;

  select m.role into me from public.general_space_members m
   where m.space_id = p_space and m.user_id = auth.uid();
  if p_user is distinct from auth.uid()
     and coalesce(me::text, '') not in ('pm', 'coordinator') then
    raise exception 'Only the space''s project manager or coordinators can set someone else''s weekly hours.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.general_space_members m
                  where m.space_id = p_space and m.user_id = p_user) then
    raise exception 'They are not in this space. Add them to the space first.' using errcode = 'no_data_found';
  end if;

  if public.general_space_is_archived(p_space) then
    raise exception 'This space is archived. The project manager can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  if p_minutes is not null and (p_minutes < 0 or p_minutes > 10080) then
    raise exception 'Weekly hours run between 0 and 168 hours. Enter a value in that range.'
      using errcode = 'check_violation';
  end if;

  insert into public.general_space_capacity (space_id, user_id, weekly_minutes, updated_by, updated_at)
  values (p_space, p_user, p_minutes, auth.uid(), now())
  on conflict (space_id, user_id) do update
     set weekly_minutes = excluded.weekly_minutes,
         updated_by     = excluded.updated_by,
         updated_at     = excluded.updated_at;
end;
$$;

revoke all on function public.set_space_weekly_minutes(uuid, uuid, int) from public, anon;
grant execute on function public.set_space_weekly_minutes(uuid, uuid, int) to authenticated;

------------------------------------------------------------ time off

-- Per person, not per space. Null minutes means a full day. Only the person
-- reads and writes their own rows; planners see time off only as hours through
-- the workload functions.
create table if not exists public.user_time_off (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  off_on     date not null,
  minutes    int check (minutes between 1 and 1440),
  created_at timestamptz not null default now(),
  unique (user_id, off_on)
);

alter table public.user_time_off enable row level security;

drop policy if exists user_time_off_select on public.user_time_off;
create policy user_time_off_select on public.user_time_off
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_time_off_insert on public.user_time_off;
create policy user_time_off_insert on public.user_time_off
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists user_time_off_update on public.user_time_off;
create policy user_time_off_update on public.user_time_off
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_time_off_delete on public.user_time_off;
create policy user_time_off_delete on public.user_time_off
  for delete to authenticated using (user_id = auth.uid());

commit;
