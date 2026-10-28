-- Collabify — company roles, phase 4: QA.
--
--   node scripts/db.mjs supabase/project-qa.sql supabase/anon-lockdown.sql
--
-- Tasks get a kind (task or bug), and a work project marks one middle stage
-- as its QA stage. This file holds the data, the write rules, the QA gate,
-- Pass and Send back, and QA's queue summary.
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
-- The gate (sync_general_task_stage), on a work project where somebody active
-- is QA, on the stage a task ends up on after alignment (a status-only "done"
-- lands on the last stage), blocks crossing the QA stage:
--   - an update from the QA stage to a stage after it goes only by QA or the
--     pm ("Only QA or the project manager can pass a task out of {stage}.");
--   - an update from a stage before QA to one after it, or an insert after it,
--     goes only by the pm ("Only QA or the project manager can move a task
--     past {stage}."), QA included, even QA who leads a team;
--   - moves among the stages after QA (Revision to Completed) and moves back
--     are not crossings: anyone who may move the task makes them;
--   - QA, who holds nothing, moves a task from the QA stage to any stage after
--     it or to the stage before QA, and changes nothing else with it.
-- Without QA the QA stage is an ordinary stage. (This replaced an earlier rule
-- that refused any move into the last stage, Revision to Completed included.)
--
-- qa_entered_at is kept by the general_tasks_zz_qa_entered trigger alone (set
-- on arrival at the QA stage, kept while there, null elsewhere); a written
-- value is replaced.
--
-- qa_pass_general_task(task) moves a task from the QA stage to the last one;
-- qa_send_back_general_task(task, note) moves it to the stage before QA, posts
-- the note (1 to 2000 characters, "Add a note saying what to fix.") as the
-- caller's comment and sends each holder task_sent_back (behind
-- notification_prefs.task_assignments). Both need QA or the pm, an unarchived
-- task and project, and the task on the QA stage ("This task isn't waiting for
-- QA."), and each records its task event, qa_passed or qa_sent_back.
--
-- my_qa_queue(): per live work project where the caller is QA, the QA stage's
-- name, the unarchived tasks waiting on it and the oldest arrival.
--
-- Two transactions: the enum and the notification type are added and
-- committed on their own.
--
-- Runs after project-feedback.sql, last in docs/07-backup.md before
-- anon-lockdown.sql. It is the final owner of general_task_overview
-- (task-stages.sql), guard_general_task, guard_general_task_child,
-- set_general_member_role, invite_to_general_project and
-- sync_general_task_stage (project-stakeholders.sql), of general_project_overview
-- (project-roles.sql) and of the general_task_events_kind CHECK
-- (general-tasks.sql). Re-run it (then anon-lockdown.sql) after re-running
-- task-stages.sql, project-roles.sql (which rebuilds the overview without
-- has_qa), project-team-leads.sql or project-stakeholders.sql (and so after
-- anything that requires those).
--
-- Idempotent. Safe to re-run.

begin;

do $$
begin
  if not exists (select 1 from pg_type
                  where typname = 'general_task_kind' and typnamespace = 'public'::regnamespace) then
    create type public.general_task_kind as enum ('task', 'bug');
  end if;
  alter type public.notification_type add value if not exists 'task_sent_back';
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

/** The QA stage of a stage list (null = the default three), 0-based: the rule above. */
create or replace function public.general_qa_stage_pick(p_stages text[], p_qa_stage text)
returns int language sql immutable set search_path = public as $$
  select coalesce(
           public.general_qa_stage_match(p_stages, p_qa_stage),
           public.general_qa_stage_match(p_stages, 'Testing'),
           public.stage_count(p_stages) - 2)
$$;

/** The project's QA stage, 0-based. Null for somebody off the project. */
create or replace function public.general_qa_stage_index(p_project uuid)
returns int language sql stable security definer set search_path = public as $$
  select public.general_qa_stage_pick(gp.stages, gp.qa_stage)
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
drop view if exists public.general_task_overview;
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
-- an archived task's kind and stage are frozen like its other fields.
create or replace function public.guard_general_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project uuid := case when tg_op = 'INSERT' then new.project_id else old.project_id end;
  -- QA passing a task or moving it back a stage, and changing nothing else.
  v_qa_move boolean := false;
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
    -- QA reports bugs; everything else is somebody else's to create. The role
    -- is read off the membership row, not general_role_of, which sees active
    -- accounts only and would let a pending QA account past.
    if new.kind is distinct from 'bug'
       and exists (select 1 from public.general_members m
                    where m.project_id = new.project_id and m.user_id = auth.uid()
                      and m.role = 'qa') then
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
       and new.stage is not distinct from old.stage
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

  -- QA holds no tasks, yet moves one out of the QA stage to any stage after it
  -- or back to the stage before it (sync_general_task_stage has already aligned
  -- status and stage and applied the QA gate). Nothing else may change with it.
  if (new.status, new.stage) is distinct from (old.status, old.stage) then
    v_qa_move := public.general_qa_may_move(old.project_id, old.status, old.stage,
                                            new.status, new.stage)
      and (to_jsonb(new) - array['status', 'stage', 'completed_at', 'updated_at', 'qa_entered_at'])
        = (to_jsonb(old) - array['status', 'stage', 'completed_at', 'updated_at', 'qa_entered_at']);
  end if;

  -- archive_general_task decides who may archive; while it holds the flag, the
  -- holder rule below would wrongly stop a creator archiving a task somebody took.
  if not public.general_can(old.project_id, 'manage_tasks')
     and coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on' then
    if not (
      v_qa_move
      or public.is_general_task_assignee(old.id)
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
  -- on since phase 4 (project-qa.sql): the pm sets it, and a coordinator acts
  -- on a member, QA or stakeholder (the coordinator rules below).
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

-- ---------------------------------------------------------------- project overview

/**
 * general_project_overview gains has_qa at the end, so the task pages can hide
 * every way to move a task to the last stage from people the gate refuses.
 * Redefined from project-roles.sql, the last file to own it; re-run this file
 * after re-running that one.
 */
create or replace view public.general_project_overview
with (security_invoker = true) as
select p.id,
       p.name,
       p.description,
       p.starts_on,
       p.ends_on,
       p.status,
       p.points_enabled,
       (select jc.code from public.general_join_codes jc where jc.project_id = p.id) as join_code,
       coalesce((select jc.open from public.general_join_codes jc where jc.project_id = p.id), false)
         as join_open,
       p.created_by,
       p.archived_at,
       p.created_at,
       p.updated_at,
       m.level as my_level,
       (select count(*) from public.general_members x where x.project_id = p.id)::int as member_count,
       coalesce(t.task_count, 0) as task_count,
       coalesce(t.done_count, 0) as done_count,
       case
         when coalesce(t.task_count, 0) = 0 then 0::numeric
         when p.points_enabled then round(t.done_weight / nullif(t.total_weight, 0) * 100, 1)
         else round(t.done_count::numeric / t.task_count * 100, 1)
       end as progress_pct,
       (select count(*) from public.general_access_requests r
         where r.project_id = p.id and r.status = 'open')::int as open_request_count,
       p.preset,
       p.has_code,
       p.space_id,
       s.name as space_name,
       m.role as my_role,
       public.general_project_has_pm(p.id) as has_pm,
       public.general_project_has_qa(p.id) as has_qa
  from public.general_projects p
  left join public.general_members m on m.project_id = p.id and m.user_id = auth.uid()
  left join public.general_spaces s on s.id = p.space_id
  left join lateral (
    select count(*)::int as task_count,
           count(*) filter (where x.status = 'done')::int as done_count,
           sum(x.weight) as total_weight,
           coalesce(sum(x.weight) filter (where x.status = 'done'), 0) as done_weight
      from public.general_tasks x
     where x.project_id = p.id and x.archived_at is null
  ) t on true;

grant select on public.general_project_overview to authenticated;

-- ---------------------------------------------------------------- grants

revoke all on function public.general_qa_stage_index(uuid) from public, anon;
grant execute on function public.general_qa_stage_index(uuid) to authenticated;
revoke all on function public.general_project_has_qa(uuid) from public, anon;
grant execute on function public.general_project_has_qa(uuid) to authenticated;

-- ================================================================ the gate, Pass and Send back

-- One transaction with the guards above: guard_general_task calls
-- general_qa_may_move, defined here.

-- ---------------------------------------------------------------- history

-- general-tasks.sql's CHECK, widened with the two QA kinds. Pass and Send back
-- write these rows themselves, beside the "updated" row the stage change leaves.
alter table public.general_task_events drop constraint if exists general_task_events_kind;
alter table public.general_task_events add constraint general_task_events_kind
  check (kind in ('created', 'updated', 'assigned', 'unassigned', 'qa_passed', 'qa_sent_back'));

-- ---------------------------------------------------------------- stage helpers

/**
 * The stage a task sits on, 0-based, as src/lib/stages.ts stageIndex reads it:
 * todo is the first stage, done the last, and in progress the stored stage
 * kept inside the middle ones (1 when none is stored).
 */
create or replace function public.general_task_stage_at(
  p_status public.general_task_status,
  p_stage  int,
  p_n      int
) returns int language sql immutable set search_path = public as $$
  select case p_status
           when 'todo' then 0
           when 'done' then p_n - 1
           else least(p_n - 2, greatest(1, coalesce(p_stage, 1)))
         end
$$;

/**
 * The caller, active QA on the task's work project, moves it from the QA stage
 * to any stage after it (a pass) or to the stage before QA (back): the moves QA
 * makes on tasks they never hold. Old and new are effective stages.
 */
create or replace function public.general_qa_may_move(
  p_project    uuid,
  p_old_status public.general_task_status,
  p_old_stage  int,
  p_new_status public.general_task_status,
  p_new_stage  int
) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and public.general_role_of(p_project, auth.uid()) is not distinct from 'qa'
     and coalesce((
       select public.general_task_stage_at(p_old_status, p_old_stage, s.n) = s.qa_i
          and (public.general_task_stage_at(p_new_status, p_new_stage, s.n) > s.qa_i
               or public.general_task_stage_at(p_new_status, p_new_stage, s.n) = s.qa_i - 1)
         from (select public.stage_count(gp.stages) as n,
                      public.general_qa_stage_pick(gp.stages, gp.qa_stage) as qa_i
                 from public.general_projects gp
                where gp.id = p_project and gp.class_board_id is null) s
     ), false)
$$;

-- ---------------------------------------------------------------- the gate

-- project-stakeholders.sql's sync_general_task_stage, as live (the stakeholder
-- refusal, the holder rule with its team-lead branch, the alignment), with:
--   - the alignment worked out first, so the rules below read where the task
--     ends up, not what was sent: a status-only "done" lands on the last stage;
--   - QA's moves out of the QA stage (general_qa_may_move) let past the holder
--     rule, since QA holds no tasks;
--   - the QA gate: on a work project with active QA, crossing the QA stage
--     (an update from it or before it to a stage after it, or an insert after
--     it) goes only by the pm, or by QA from the QA stage itself.
create or replace function public.sync_general_task_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n          int;
  r          record;
  v_stages   text[];
  v_board    uuid;
  v_qa_stage text;
  qa_i       int;
  old_i      int;
  new_i      int;
begin
  if tg_op = 'UPDATE'
     and new.stage is not distinct from old.stage
     and new.status is not distinct from old.status then
    return new;
  end if;

  if public.is_general_member(new.project_id) and not public.general_can_write(new.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;

  select public.stage_count(p.stages), p.stages, p.class_board_id, p.qa_stage
    into n, v_stages, v_board, v_qa_stage
    from public.general_projects p where p.id = new.project_id;

  select * into r from public.align_task_stage(
    coalesce(n, 3), tg_op = 'INSERT',
    case when tg_op = 'UPDATE' then old.status::text end,
    case when tg_op = 'UPDATE' then old.stage end,
    new.status::text, new.stage);

  -- The same people who may change its status: whoever holds it, its creator
  -- while nobody does, a leader of whoever holds it, or someone who manages
  -- tasks. QA passing it, or moving it back a stage, comes first.
  if tg_op = 'UPDATE'
     and new.stage is distinct from old.stage
     and auth.uid() is not null
     and not public.general_qa_may_move(old.project_id, old.status, old.stage,
                                        r.status::public.general_task_status, r.stage)
     and not public.general_can(old.project_id, 'manage_tasks')
     and not public.is_general_task_assignee(old.id)
     and not (old.created_by = auth.uid() and not public.general_task_held(old.id))
     and not exists (
       select 1 from public.general_task_assignees a
        where a.task_id = old.id
          and public.general_leads_user(old.project_id, auth.uid(), a.user_id)
     ) then
    raise exception 'Only whoever holds this task, or someone who manages tasks, can change it'
      using errcode = 'insufficient_privilege';
  end if;

  -- The QA gate, on effective stages. Without active QA the stage is ordinary.
  -- A crossing takes a task past the QA stage: an update from the QA stage or
  -- before it to a stage after it, or an insert after it (a status-only "done"
  -- included). The pm crosses freely; QA only from the QA stage itself, a team
  -- QA leads included. Moves among the stages after QA, and moves back, are
  -- not crossings and keep the holder rule above.
  if auth.uid() is not null and n is not null and v_board is null then
    qa_i := public.general_qa_stage_pick(v_stages, v_qa_stage);
    new_i := public.general_task_stage_at(r.status::public.general_task_status, r.stage, n);
    if tg_op = 'UPDATE' then
      old_i := public.general_task_stage_at(old.status, old.stage, n);
    end if;
    if new_i > qa_i
       and (tg_op = 'INSERT' or old_i <= qa_i)
       and public.general_project_has_qa(new.project_id)
       and public.general_role_of(new.project_id, auth.uid()) is distinct from 'pm'
       and not (public.general_role_of(new.project_id, auth.uid()) is not distinct from 'qa'
                and old_i is not distinct from qa_i) then
      raise exception 'Only QA or the project manager can % %.',
        case when old_i is not distinct from qa_i then 'pass a task out of' else 'move a task past' end,
        (coalesce(v_stages, array['To do', 'In progress', 'Done']))[qa_i + 1]
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  new.status := r.status::public.general_task_status;
  new.stage := r.stage;
  return new;
end;
$$;

-- ---------------------------------------------------------------- qa_entered_at

-- When the task last reached the QA stage, kept by this trigger alone. It fires
-- after every other BEFORE trigger on general_tasks (triggers fire in name
-- order; the stage sync is general_tasks_a_stage, the guard general_tasks_guard),
-- so it reads the final status and stage, and whatever a writer sent for
-- qa_entered_at is replaced:
--   - not on the QA stage (or on a class board's Files project): null;
--   - arriving there (an insert, or an update from another stage): now;
--   - staying there: unchanged.
-- clock_timestamp, not now: two arrivals in one transaction still order.
create or replace function public.keep_general_task_qa_entered()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n     int;
  qa_i  int;
  new_i int;
begin
  select public.stage_count(p.stages), public.general_qa_stage_pick(p.stages, p.qa_stage)
    into n, qa_i
    from public.general_projects p
   where p.id = new.project_id and p.class_board_id is null;

  new_i := public.general_task_stage_at(new.status, new.stage, n);
  if qa_i is null or new_i <> qa_i then
    new.qa_entered_at := null;
  elsif tg_op = 'INSERT' or public.general_task_stage_at(old.status, old.stage, n) <> qa_i then
    new.qa_entered_at := clock_timestamp();
  else
    new.qa_entered_at := old.qa_entered_at;
  end if;
  return new;
end;
$$;

drop trigger if exists general_tasks_zz_qa_entered on public.general_tasks;
create trigger general_tasks_zz_qa_entered
  before insert or update of status, stage, qa_entered_at on public.general_tasks
  for each row execute function public.keep_general_task_qa_entered();

-- ---------------------------------------------------------------- Pass and Send back

/**
 * Locks p_task for Pass or Send back and returns its project and QA stage. The
 * caller is active QA or the pm on the task's work project, neither the task
 * nor the project is archived, and the task sits on the QA stage; otherwise
 * "This task isn't waiting for QA."
 */
create or replace function public.general_qa_task_waiting(
  p_task        uuid,
  out v_project uuid,
  out v_qa      int
) returns record language plpgsql security definer set search_path = public as $$
declare
  t  public.general_tasks%rowtype;
  gp public.general_projects%rowtype;
begin
  select * into t from public.general_tasks where id = p_task for update;
  if t.id is not null then
    select * into gp from public.general_projects where id = t.project_id;
  end if;
  if t.id is null or gp.id is null
     or gp.class_board_id is not null
     or gp.archived_at is not null
     or t.archived_at is not null
     or auth.uid() is null
     or coalesce(public.general_role_of(gp.id, auth.uid()) not in ('qa', 'pm'), true)
     or public.general_task_stage_at(t.status, t.stage, public.stage_count(gp.stages))
        is distinct from public.general_qa_stage_pick(gp.stages, gp.qa_stage) then
    raise exception 'This task isn''t waiting for QA.' using errcode = 'check_violation';
  end if;
  v_project := gp.id;
  v_qa := public.general_qa_stage_pick(gp.stages, gp.qa_stage);
end;
$$;

/** Pass: QA or the pm moves a task from the QA stage to the last stage. */
create or replace function public.qa_pass_general_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  w record;
begin
  select * into w from public.general_qa_task_waiting(p_task);

  update public.general_tasks set status = 'done' where id = p_task;

  insert into public.general_task_events (task_id, project_id, actor_id, kind)
  values (p_task, w.v_project, auth.uid(), 'qa_passed');
end;
$$;

/**
 * Send back: QA or the pm moves a task from the QA stage to the stage before
 * it, posts the note as their task comment, and tells each holder
 * (task_sent_back, behind notification_prefs.task_assignments, so it arrives
 * with comment notifications off; the comment notifies as comments do).
 */
create or replace function public.qa_send_back_general_task(p_task uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  w       record;
  v_note  text := btrim(coalesce(p_note, ''), E' \t\r\n');
  v_title text;
begin
  select * into w from public.general_qa_task_waiting(p_task);

  if char_length(v_note) not between 1 and 2000 then
    raise exception 'Add a note saying what to fix.' using errcode = 'check_violation';
  end if;

  update public.general_tasks
     set status = case when w.v_qa - 1 = 0 then 'todo' else 'in_progress' end::public.general_task_status,
         stage = w.v_qa - 1
   where id = p_task
  returning title into v_title;

  insert into public.general_task_comments (task_id, project_id, author_id, body)
  values (p_task, w.v_project, auth.uid(), v_note);

  insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
  values (p_task, w.v_project, auth.uid(), 'qa_sent_back', jsonb_build_object('note', v_note));

  insert into public.notifications
    (user_id, type, general_project_id, general_task_id, title, preview)
  select a.user_id, 'task_sent_back'::public.notification_type, w.v_project, p_task,
         v_title || ' was sent back', left(v_note, 140)
    from public.general_task_assignees a
    join public.general_members gm on gm.project_id = a.project_id and gm.user_id = a.user_id
    join public.notification_prefs np on np.user_id = a.user_id
   where a.task_id = p_task
     and a.user_id <> auth.uid()
     and np.task_assignments;
end;
$$;

-- ---------------------------------------------------------------- the queue summary

/**
 * QA's Home count: for each of the caller's live work projects where they are
 * QA (active account), the QA stage's name, how many unarchived tasks sit on it
 * and when the longest-waiting one arrived.
 */
create or replace function public.my_qa_queue()
returns table (
  project_id        uuid,
  name              text,
  qa_stage_name     text,
  waiting           int,
  oldest_entered_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id,
         p.name,
         (coalesce(p.stages, array['To do', 'In progress', 'Done']))[q.qa_i + 1],
         w.waiting,
         w.oldest
    from public.general_members m
    join public.general_projects p on p.id = m.project_id
    join public.profiles pr on pr.id = m.user_id and pr.status = 'active'
    cross join lateral (
      select public.stage_count(p.stages) as n,
             public.general_qa_stage_pick(p.stages, p.qa_stage) as qa_i
    ) q
    cross join lateral (
      select count(*)::int as waiting, min(x.qa_entered_at) as oldest
        from public.general_tasks x
       where x.project_id = p.id
         and x.archived_at is null
         and public.general_task_stage_at(x.status, x.stage, q.n) = q.qa_i
    ) w
   where auth.uid() is not null
     and m.user_id = auth.uid()
     and m.role = 'qa'
     and p.archived_at is null
     and p.class_board_id is null
   order by p.name, p.id;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.general_qa_stage_pick(text[], text) from public, anon;
grant execute on function public.general_qa_stage_pick(text[], text) to authenticated;
revoke all on function public.general_task_stage_at(public.general_task_status, int, int) from public, anon;
grant execute on function public.general_task_stage_at(public.general_task_status, int, int) to authenticated;

revoke all on function public.general_qa_may_move(uuid, public.general_task_status, int, public.general_task_status, int)
  from public, anon, authenticated;
revoke all on function public.keep_general_task_qa_entered() from public, anon, authenticated;
revoke all on function public.general_qa_task_waiting(uuid) from public, anon, authenticated;

revoke all on function public.qa_pass_general_task(uuid) from public, anon;
grant execute on function public.qa_pass_general_task(uuid) to authenticated;
revoke all on function public.qa_send_back_general_task(uuid, text) from public, anon;
grant execute on function public.qa_send_back_general_task(uuid, text) to authenticated;
revoke all on function public.my_qa_queue() from public, anon;
grant execute on function public.my_qa_queue() to authenticated;

commit;
