-- Work project teams retain their people, positions, and completed work in the
-- owning project's archive. Unfinished work must be moved or completed first.
alter table public.general_teams add column if not exists archived_at timestamptz;
create index if not exists general_teams_project_archive_idx
  on public.general_teams (project_id, archived_at);

create or replace function public.guard_general_team_archive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.archived_at is not distinct from old.archived_at then return new; end if;
  if new.project_id is distinct from old.project_id
     or not exists (select 1 from public.general_projects p
                     where p.id = old.project_id and p.class_board_id is null) then
    raise exception 'Only work project teams can be archived.' using errcode = 'check_violation';
  end if;
  if not public.general_can(old.project_id, 'manage_structure') then
    raise exception 'Only someone who manages teams can archive or restore a team.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.archived_at is not null and exists (
    select 1 from public.general_tasks t
     where t.team_id = old.id and t.archived_at is null and t.trashed_at is null
       and t.status <> 'done'
  ) then
    raise exception 'Move or complete this team''s open tasks before archiving it.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists general_team_archive_guard on public.general_teams;
create trigger general_team_archive_guard before update of archived_at on public.general_teams
  for each row execute function public.guard_general_team_archive();

-- A task cannot be routed onto an archived team, including by a direct write.
create or replace function public.guard_general_task_archived_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is not null and new.archived_at is null and new.trashed_at is null
     and new.status <> 'done' and exists (
       select 1 from public.general_teams g where g.id = new.team_id
         and g.project_id = new.project_id and g.archived_at is not null for share
     ) then
    raise exception 'Restore the team before assigning open work to it.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists general_task_archived_team_guard on public.general_tasks;
create trigger general_task_archived_team_guard before insert or update of team_id, status, archived_at, trashed_at
  on public.general_tasks for each row execute function public.guard_general_task_archived_team();

-- Archived teams no longer confer lead powers.
create or replace function public.general_leads_user(p_project uuid, p_lead uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (auth.uid() is null or coalesce(public.can_read_general_project(p_project), false))
     and exists (
    select 1 from public.general_teams t
      join public.general_projects gp on gp.id = t.project_id and gp.class_board_id is null
      join public.general_team_members tm on tm.team_id = t.id and tm.user_id = p_user
      join public.general_team_members tl on tl.team_id = t.id and tl.user_id = p_lead
      join public.general_members m on m.project_id = t.project_id and m.user_id = p_lead
      join public.profiles pr on pr.id = p_lead
     where t.project_id = p_project and t.archived_at is null
       and t.leader_id = p_lead and m.role <> 'stakeholder' and pr.status = 'active'
  );
$$;
