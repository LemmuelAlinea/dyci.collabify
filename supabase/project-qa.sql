-- Collabify — company roles, phase 4: QA.
--
--   node scripts/db.mjs supabase/project-qa.sql supabase/anon-lockdown.sql
--
-- Tasks get a kind (task or bug), and a work project marks one middle stage
-- as its QA stage. This file holds the data and the write rules; the QA gate
-- on moving a task out of the QA stage comes later (sync_general_task_stage).
--
--   general_tasks.kind            task | bug (general_task_kind), default task
--   general_tasks.qa_entered_at   when the task last reached the QA stage
--   general_projects.qa_stage     the QA stage, by name; null = the default
--
-- The QA stage, general_qa_stage_index(project), 0-based, among the middle
-- stages of the project's list (null stages = To do, In progress, Done):
--
--   1. qa_stage, matched case-insensitively;
--   2. else a stage named "Testing";
--   3. else the stage before the last.
--
-- qa_stage must be null or a middle stage ("The QA stage must be one of the
-- middle stages."). Changing the stage list so qa_stage is no longer a middle
-- stage clears it instead of failing, so removing a stage never fails.
-- Setting qa_stage needs edit_project (the pm) through the existing
-- general_projects update policy.
--
-- general_project_has_qa(project): somebody active holds the qa role there.
--
-- QA's write rules, on top of general_can_write (QA is not a stakeholder):
--   - QA creates bug tasks only ("QA creates bug tasks only.");
--   - a task's kind changes only with manage_tasks, which QA never holds;
--   - QA holds no tasks: guard_general_task_child refuses a qa assignee
--     ("QA can't hold tasks. Pick someone else."), whoever adds the row.
--
-- The role, on: the pm sets and invites qa; a coordinator switches people
-- among member, qa and stakeholder and invites as any of the three. Becoming
-- QA lets go of every task held in the project, as becoming a stakeholder does.
--
-- Two transactions: the enum is created and committed on its own.
--
-- Runs after project-feedback.sql, last in docs/07-backup.md before
-- anon-lockdown.sql. It is the final owner of general_task_overview
-- (task-stages.sql), guard_general_task, guard_general_task_child,
-- set_general_member_role and invite_to_general_project (project-stakeholders.sql).
-- Re-run it (then anon-lockdown.sql) after re-running task-stages.sql or
-- project-stakeholders.sql (and so after anything that requires those).
--
-- Idempotent. Safe to re-run.

begin;

do $$
begin
  if not exists (select 1 from pg_type
                  where typname = 'general_task_kind' and typnamespace = 'public'::regnamespace) then
    create type public.general_task_kind as enum ('task', 'bug');
  end if;
end $$;

commit;

begin;

-- ---------------------------------------------------------------- columns

alter table public.general_tasks
  add column if not exists kind public.general_task_kind not null default 'task';
alter table public.general_tasks add column if not exists qa_entered_at timestamptz;
alter table public.general_projects add column if not exists qa_stage text;

-- ---------------------------------------------------------------- the QA stage

/**
 * The 0-based index of p_name among the middle stages of p_stages (null is
 * the default three), matched case-insensitively; null when it is not one.
 */
create or replace function public.general_qa_stage_match(p_stages text[], p_name text)
returns int language sql immutable set search_path = public as $$
  select (s.i - 1)::int
    from unnest(coalesce(p_stages, array['To do', 'In progress', 'Done'])) with ordinality s(name, i)
   where s.i between 2 and coalesce(array_length(p_stages, 1), 3) - 1
     and lower(btrim(s.name)) = lower(btrim(p_name))
   order by s.i
   limit 1
$$;

/** The project's QA stage, 0-based. Null for somebody off the project. */
create or replace function public.general_qa_stage_index(p_project uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(
           public.general_qa_stage_match(gp.stages, gp.qa_stage),
           public.general_qa_stage_match(gp.stages, 'Testing'),
           public.stage_count(gp.stages) - 2)
    from public.general_projects gp
   where gp.id = p_project
     and (auth.uid() is null or public.is_general_member(p_project))
$$;

/** Somebody with an active account holds the qa role on the project. */
create or replace function public.general_project_has_qa(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (auth.uid() is null or public.is_general_member(p_project))
     and exists (
       select 1 from public.general_members m
         join public.profiles p on p.id = m.user_id
        where m.project_id = p_project and m.role = 'qa' and p.status = 'active'
     )
$$;

/**
 * qa_stage is null or a middle stage. A new qa_stage that isn't is refused; a
 * stage list change that leaves the old one out clears it.
 */
create or replace function public.general_projects_qa_stage_check()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.qa_stage is null
     or public.general_qa_stage_match(new.stages, new.qa_stage) is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.qa_stage is not distinct from old.qa_stage then
    new.qa_stage := null;
    return new;
  end if;
  raise exception 'The QA stage must be one of the middle stages.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists general_projects_qa_stage on public.general_projects;
create trigger general_projects_qa_stage
  before insert or update of qa_stage, stages on public.general_projects
  for each row execute function public.general_projects_qa_stage_check();

-- ---------------------------------------------------------------- task overview

-- As task-stages.sql, with kind and qa_entered_at appended.
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
       t.rank,
       t.milestone_id,
       t.stage,
       t.kind,
       t.qa_entered_at
  from public.general_tasks t
 where t.archived_at is null or public.general_sees_archived(t.project_id, t.archived_by);

grant select on public.general_task_overview to authenticated;
revoke all on public.general_task_overview from anon;

-- ---------------------------------------------------------------- task guards

-- project-stakeholders.sql's guard_general_task, as live, with: QA inserts bug
-- tasks only; a kind changes only with manage_tasks (QA holds no permission);
-- an archived task's kind is frozen like its other fields.
create or replace function public.guard_general_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project uuid := case when tg_op = 'INSERT' then new.project_id else old.project_id end;
begin
  if auth.uid() is null then
    if tg_op = 'INSERT' then
      new.completed_at := case when new.status = 'done' then now() end;
    end if;
    return new;
  end if;

  if not public.is_general_member(v_project) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(v_project) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    if public.general_is_archived(new.project_id) then
      raise exception '%', public.general_archived_message(new.project_id)
        using errcode = 'check_violation';
    end if;
    -- QA reports bugs; everything else is somebody else's to create.
    if new.kind is distinct from 'bug'
       and public.general_role_of(new.project_id, auth.uid()) is not distinct from 'qa' then
      raise exception 'QA creates bug tasks only.'
        using errcode = 'insufficient_privilege';
    end if;
    new.created_by := auth.uid();
    if new.weight <> 1 and not public.general_can(new.project_id, 'manage_tasks') then
      raise exception 'Only someone who manages tasks sets points'
        using errcode = 'insufficient_privilege';
    end if;
    new.completed_at := case when new.status = 'done' then now() end;
    return new;
  end if;

  -- UPDATE
  new.project_id := old.project_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if (new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by)
     and coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on' then
    raise exception 'Archive and restore through the archive buttons.'
      using errcode = 'insufficient_privilege';
  end if;

  if public.general_is_archived(old.project_id) then
    raise exception '%', public.general_archived_message(old.project_id)
      using errcode = 'check_violation';
  end if;

  -- A team delete still cascades team_id to null on an archived task.
  if old.archived_at is not null
     and coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on'
     and not (
       new.team_id is null
       and new.title is not distinct from old.title
       and new.description is not distinct from old.description
       and new.status is not distinct from old.status
       and new.due_at is not distinct from old.due_at
       and new.starts_at is not distinct from old.starts_at
       and new.weight is not distinct from old.weight
       and new.kind is not distinct from old.kind
     ) then
    raise exception 'This task is archived. Restore it from the project archive to change it.'
      using errcode = 'check_violation';
  end if;

  -- Task or bug is the task manager's call, holder or not. QA never holds
  -- manage_tasks (general_has gives the qa role nothing), so QA never changes it.
  if new.kind is distinct from old.kind
     and not public.general_can(old.project_id, 'manage_tasks') then
    raise exception 'Only someone who manages tasks changes a task''s kind.'
      using errcode = 'insufficient_privilege';
  end if;

  -- archive_general_task decides who may archive; while it holds the flag, the
  -- holder rule below would wrongly stop a creator archiving a task somebody took.
  if not public.general_can(old.project_id, 'manage_tasks')
     and coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on' then
    if not (
      public.is_general_task_assignee(old.id)
      or (old.created_by = auth.uid() and not public.general_task_held(old.id))
      -- A team leader, for a task somebody on their team holds.
      or exists (
        select 1 from public.general_task_assignees a
         where a.task_id = old.id
           and public.general_leads_user(old.project_id, auth.uid(), a.user_id)
      )
      or (
        -- A team delete cascades into an UPDATE (team_id set null) that runs
        -- under the deleting caller's own auth.uid(), even though referential
        -- actions bypass RLS — BEFORE triggers still fire. Someone who
        -- manages structure but not tasks still needs that cascade to reach
        -- this row, as long as nothing besides team_id actually changed.
        new.team_id is null
        and new.title is not distinct from old.title
        and new.description is not distinct from old.description
        and new.status is not distinct from old.status
        and new.due_at is not distinct from old.due_at
        and new.starts_at is not distinct from old.starts_at
        and new.weight is not distinct from old.weight
        and new.kind is not distinct from old.kind
        and public.general_can(old.project_id, 'manage_structure')
      )
    ) then
      raise exception 'Only whoever holds this task, or someone who manages tasks, can change it'
        using errcode = 'insufficient_privilege';
    end if;
    if new.weight is distinct from old.weight then
      raise exception 'Only someone who manages tasks changes points'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;

-- project-stakeholders.sql's guard_general_task_child, as live, with a qa
-- assignee refused next to a stakeholder one.
create or replace function public.guard_general_task_child()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p uuid;
  -- Leaving an archived project cascades into general_task_assignees; that
  -- delete should go through even though the membership row that drove it is
  -- already gone by the time this trigger fires.
  v_member_gone boolean := false;
  v_role public.general_role;
begin
  if tg_op = 'DELETE' then
    p := old.project_id;
  else
    p := new.project_id;
  end if;
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' and tg_table_name = 'general_task_assignees' then
    v_member_gone := not exists (
      select 1 from public.general_members
       where project_id = old.project_id and user_id = old.user_id
    );
  end if;

  if not v_member_gone then
    if not public.is_general_member(p) then
      raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
    end if;
    if not public.general_can_write(p) then
      raise exception 'Stakeholders can view this project but not change it.'
        using errcode = 'insufficient_privilege';
    end if;
    if public.general_is_archived(p) then
      raise exception 'This project is archived. An Owner can restore it to make changes.'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' then
    case tg_table_name
      when 'general_task_assignees' then
        -- Nobody hands a stakeholder or QA a task, whichever policy branch
        -- let the row in: a self-claim, a task manager or a team leader.
        select role into v_role from public.general_members
         where project_id = new.project_id and user_id = new.user_id;
        if v_role = 'stakeholder' then
          raise exception 'Stakeholders can''t hold tasks. Pick someone else.'
            using errcode = 'insufficient_privilege';
        end if;
        if v_role = 'qa' then
          raise exception 'QA can''t hold tasks. Pick someone else.'
            using errcode = 'insufficient_privilege';
        end if;
        new.assigned_by := auth.uid();
        -- Locks the task row so two simultaneous claims cannot both see it unheld.
        perform 1 from public.general_tasks where id = new.task_id for update;
        if not public.general_can(new.project_id, 'manage_tasks')
           and public.general_task_held(new.task_id) then
          raise exception 'Somebody already holds this task' using errcode = 'check_violation';
        end if;
      when 'general_task_comments'  then new.author_id := auth.uid();
      when 'general_task_files'     then new.uploaded_by := auth.uid();
      when 'general_task_logs'      then new.user_id := auth.uid();
      else null;
    end case;
  elsif tg_op = 'UPDATE' and tg_table_name = 'general_task_comments' then
    new.author_id := old.author_id;
    new.task_id := old.task_id;
    new.project_id := old.project_id;
    new.created_at := old.created_at;
    new.edited_at := now();
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ---------------------------------------------------------------- the role, on

-- project-stakeholders.sql's set_general_member_role, as live, with qa
-- allowed: the pm sets it on anyone but themself, a coordinator switches
-- people among member, qa and stakeholder. Becoming QA, like becoming a
-- stakeholder, takes them off every task they held here.
create or replace function public.set_general_member_role(
  p_project uuid,
  p_user    uuid,
  p_role    public.general_role
) returns void language plpgsql security definer set search_path = public as $$
declare
  me     public.general_role;
  target public.general_members%rowtype;
begin
  -- Every role but pm is set here; the pm changes only by a hand over. QA is
  -- on since phase 4 (project-qa.sql): the pm sets it, and a coordinator may
  -- too, on a member or a stakeholder (the coordinator rules below).
  if p_role = 'pm' then
    raise exception 'Use hand over to change the project manager.'
      using errcode = 'check_violation';
  end if;

  -- Class-board Files projects hold no pm or coordinator, so they stop here too.
  me := public.general_role_of(p_project, auth.uid());
  if me is null or me not in ('pm', 'coordinator') then
    raise exception 'Only the project manager or a coordinator changes roles.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. The project manager can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  -- The pm's row, then the target's: the hand over locks in the same order.
  perform 1 from public.general_members
   where project_id = p_project and role = 'pm' for update;
  select * into target from public.general_members
   where project_id = p_project and user_id = p_user for update;
  if target.user_id is null then
    raise exception 'They are not on this project' using errcode = 'no_data_found';
  end if;
  -- Asked again under the lock: a hand over may have moved the caller since.
  me := public.general_role_of(p_project, auth.uid());
  if me is null or me not in ('pm', 'coordinator') then
    raise exception 'Only the project manager or a coordinator changes roles.'
      using errcode = 'insufficient_privilege';
  end if;

  -- A coordinator moves people among member, qa and stakeholder only.
  if me = 'coordinator' then
    if target.role not in ('member', 'qa', 'stakeholder') then
      raise exception 'Only the project manager can change a coordinator or the project manager.'
        using errcode = 'insufficient_privilege';
    end if;
    if p_role = 'coordinator' then
      raise exception 'Only the project manager can make someone a coordinator.'
        using errcode = 'insufficient_privilege';
    end if;
  elsif target.role = 'pm' then
    raise exception 'Use hand over to change the project manager.'
      using errcode = 'check_violation';
  end if;

  if target.role = p_role then
    return;
  end if;

  update public.general_members set role = p_role
   where project_id = p_project and user_id = p_user;

  -- Grants are extras for members only, so anyone moved off member loses
  -- theirs and any open requests for more.
  if p_role <> 'member' then
    delete from public.general_grants where project_id = p_project and user_id = p_user;
    update public.general_access_requests
       set status = 'withdrawn', answered_at = now()
     where project_id = p_project and user_id = p_user and status = 'open';
  end if;

  -- A stakeholder or QA holds no tasks: becoming one lets go of every task
  -- they held here, archived ones too (the archive op lets that delete past the
  -- archived-task guard). Each one leaves an "unassigned" event in the history.
  if p_role in ('stakeholder', 'qa') then
    perform set_config('collabify.general_archive_op', 'on', true);
    delete from public.general_task_assignees where project_id = p_project and user_id = p_user;
    perform set_config('collabify.general_archive_op', 'off', true);
  end if;
end;
$$;

-- project-stakeholders.sql's invite_to_general_project, as live, with qa
-- allowed: the pm invites as member, coordinator, qa or stakeholder, a
-- coordinator as member, qa or stakeholder. Accepting, or joining by code with
-- the invitation pending, gives the invitation's role (respond_general_invitation,
-- join_general_project).
create or replace function public.invite_to_general_project(
  p_project uuid,
  p_user    uuid,
  p_role    public.general_role default 'member'
) returns public.general_invitations language plpgsql security definer set search_path = public as $$
declare
  inv public.general_invitations%rowtype;
  i_am_pm boolean := public.general_role_of(p_project, auth.uid()) is not distinct from 'pm';
begin
  if not public.general_can(p_project, 'manage_members') then
    raise exception 'You need permission to invite people to this project'
      using errcode = 'insufficient_privilege';
  end if;
  -- Every role but pm can be invited; only the pm invites a coordinator. QA
  -- is on since phase 4: the pm and a coordinator both invite as qa, and the
  -- invitee holds no tasks once they join (guard_general_task_child).
  if p_role = 'pm' then
    raise exception 'Use hand over to change the project manager.'
      using errcode = 'check_violation';
  end if;
  if p_role = 'coordinator' and not i_am_pm then
    raise exception 'Only the project manager can invite a coordinator.'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and status <> 'rejected') then
    raise exception 'That account cannot be invited' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.general_members where project_id = p_project and user_id = p_user) then
    raise exception 'They are already on this project' using errcode = 'unique_violation';
  end if;

  select * into inv from public.general_invitations
   where project_id = p_project and invitee = p_user and status = 'pending';
  if inv.id is not null then
    -- Already invited, and inviting again is not an error. The pm may change
    -- the role it carries; anyone else gets it back as it stands.
    if i_am_pm and inv.role is distinct from p_role then
      update public.general_invitations set role = p_role where id = inv.id
      returning * into inv;
    end if;
    return inv;
  end if;

  perform public.rate_limit('general_invite', 100, interval '1 hour',
    'You have sent a lot of invitations in the last hour. Try again later.');

  -- The invitee joins with this role when they accept or join by code.
  insert into public.general_invitations (project_id, invitee, invited_by, role)
  values (p_project, p_user, auth.uid(), p_role)
  returning * into inv;
  return inv;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.general_qa_stage_index(uuid) from public, anon;
grant execute on function public.general_qa_stage_index(uuid) to authenticated;
revoke all on function public.general_project_has_qa(uuid) from public, anon;
grant execute on function public.general_project_has_qa(uuid) to authenticated;

commit;
