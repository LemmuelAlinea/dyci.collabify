begin;

alter table public.general_tasks
  add column if not exists estimated_minutes integer
  check (estimated_minutes > 0);

create or replace function public.guard_work_task_estimate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.estimated_minutes is not distinct from old.estimated_minutes then return new; end if;
  elsif new.estimated_minutes is null then return new;
  end if;

  if not exists (
    select 1 from public.general_projects p
    where p.id = new.project_id and p.class_board_id is null and p.archived_at is null
  ) then
    raise exception 'Estimates are available on active work projects only.' using errcode = 'check_violation';
  end if;
  if auth.uid() is not null and (
    public.general_role_of(new.project_id, auth.uid()) is null
    or public.general_role_of(new.project_id, auth.uid()) not in ('pm', 'coordinator')
    or not public.general_can_write(new.project_id)
  ) then
    raise exception 'Only project planners can change the estimate.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists general_tasks_work_estimate on public.general_tasks;
create trigger general_tasks_work_estimate
before insert or update of estimated_minutes on public.general_tasks
for each row execute function public.guard_work_task_estimate();

revoke all on function public.guard_work_task_estimate() from public, anon, authenticated;

commit;
