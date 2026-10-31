-- supabase/sprint-reopen.sql
--
-- Bring a finished sprint on a work project back to running. Only the
-- project manager and coordinators may, through reopen_general_sprint(). The
-- sprint that was running goes back to planned (Backlog), as if it had never
-- started. Tasks stay where they are: unfinished tasks carried out of the
-- finished sprint when it ended do not come back with it.
--
-- Redefines guard_sprint_state (last written by sprint-milestones.sql, first
-- by work-planning.sql; keep them in step) so those two backward moves are
-- allowed, but only while reopen_general_sprint has set
-- collabify.sprint_reopen. A direct update still goes planned → running →
-- finished only. Re-running sprint-milestones.sql or work-planning.sql means
-- re-running this file after it.
--
-- Run after sprint-archive.sql. Idempotent.

begin;

/**
 * Planned → running → finished, never backwards, and a finished sprint is
 * fixed except for its milestone, unless reopen_general_sprint is moving it.
 * The timestamps are stamped here so a client cannot backdate them. Shared by
 * general_sprints and board_sprints, so the owning column is pinned by table
 * name.
 */
create or replace function public.guard_sprint_state()
returns trigger language plpgsql set search_path = public as $$
declare
  reopening boolean := coalesce(current_setting('collabify.sprint_reopen', true), 'off') = 'on';
begin
  if old.state = 'completed'
     and not (reopening and new.state = 'active')
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
    elsif reopening and old.state = 'completed' and new.state = 'active' then
      new.completed_at := null;
    elsif reopening and old.state = 'active' and new.state = 'planned' then
      new.started_at := null;
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

/**
 * Run a finished sprint again. The running sprint, if any, goes back to
 * planned first (one runs at a time). Runs as the caller, so the sprint
 * update policy (manage_tasks, project not archived) still applies.
 */
create or replace function public.reopen_general_sprint(p_sprint uuid)
returns void language plpgsql set search_path = public as $$
declare
  s public.general_sprints;
  was text := current_setting('collabify.sprint_reopen', true);
begin
  select * into s from public.general_sprints where id = p_sprint;
  if not found then
    raise exception 'That sprint is not there any more. Reload the page.';
  end if;
  if coalesce(public.general_role_of(s.project_id)::text, '') not in ('pm', 'coordinator') then
    raise exception 'Only the project manager or a coordinator can run a finished sprint again.'
      using errcode = 'insufficient_privilege';
  end if;
  if s.state <> 'completed' then
    raise exception 'Only a finished sprint can run again.' using errcode = 'check_violation';
  end if;

  perform set_config('collabify.sprint_reopen', 'on', true);

  update public.general_sprints set state = 'planned'
   where project_id = s.project_id and state = 'active';

  update public.general_sprints set state = 'active', archived = false
   where id = p_sprint;
  if not found then
    raise exception 'That sprint could not run again. Reload the page and try again.'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('collabify.sprint_reopen', coalesce(was, 'off'), true);
end;
$$;

revoke all on function public.reopen_general_sprint(uuid) from public, anon;
grant execute on function public.reopen_general_sprint(uuid) to authenticated;

commit;
