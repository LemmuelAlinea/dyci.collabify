-- Collabify — company roles, phase 3: stakeholders are read-only.
--
--   node scripts/db.mjs supabase/project-stakeholders.sql supabase/anon-lockdown.sql
--
-- A stakeholder on a work project reads everything a member reads and changes
-- nothing. Until now every member write in a work project was gated by
-- is_general_member, which also drives reads. This file adds
--
--   general_can_write(project)  the caller is a member (not rejected) who, on a
--                               work project, isn't a stakeholder.
--
-- and puts it at every write chokepoint a plain member passes. Reads keep
-- is_general_member. Anything already gated by general_has / general_can is
-- unchanged: a stakeholder holds no permission (project-roles.sql).
--
-- A refusal that a trigger or a function raises says "Stakeholders can view
-- this project but not change it." (insufficient_privilege). A write that only
-- a policy stops (a storage upload, a draft or review comment inserted by hand)
-- fails with the usual row-level security error, and an UPDATE or DELETE that
-- a policy filters touches no rows. Non-member refusals keep their messages.
--
-- Class-board Files projects keep the old model: every row there is a member
-- by role, so general_can_write equals is_general_member on them.
--
-- Stakeholders are not in the discussion or the project chat: they neither
-- read nor write either (the one read path that changes). Joining as a
-- stakeholder seats nobody in the project's space. The pm and coordinators can
-- now set and invite the stakeholder role; QA stays refused until phase 4.
--
-- Unchanged on purpose: leave_general_project (a stakeholder can leave),
-- respond_general_invitation and join_general_project (they give a pending
-- invitation's role, so stakeholder too), every other read path, space
-- membership someone already has, and space report templates. A meeting a
-- stakeholder scheduled while still a member is theirs to see but no longer
-- to change or cancel.
--
-- Runs after project-team-leads.sql and everything else in docs/07-backup.md,
-- and redefines from their latest (live) copies:
--   guard_general_task, sync_general_task_stage, guard_general_task_plan
--     (project-team-leads.sql), guard_general_task_child (general-tasks.sql),
--   archive_general_task (task-archive.sql), general_archive_guard
--     (general-archive-rbac.sql), archive_general_task_file (trash.sql),
--   archive_trash_block, list_my_trash, empty_my_trash (archive-page.sql),
--   my_general_draft, submit_general_draft, submit_general_draft_file,
--     submit_general_draft_folder, general_review_reviewers (general-drafts.sql),
--   guard_general_draft_file (trash.sql), commit_general_draft_path
--     (general-draft-commit.sql), share_general_draft_path,
--     copy_general_share_to_draft (general-shares.sql),
--   answer_general_repo_change (general-repo.sql),
--   request_general_access (general.sql), create_meeting, meeting_audiences
--     (meetings.sql),
-- and these policies: general_tasks_insert / _update / _delete,
-- general_task_comments_insert / _update / _delete, general_task_files_insert /
-- _delete, general_task_logs_insert / _delete (general-tasks.sql and
-- general-archive-rbac.sql), general_task_assignees_insert / _delete
-- (project-team-leads.sql), general_drafts_own, now split into
-- general_drafts_select / _insert / _update / _delete (general-drafts.sql),
-- general_repo_changes_insert / _update and general_repo_comments_insert /
-- _delete (general-repo.sql), and on storage.objects general_project_files_write
-- (general-files.sql), general_files_write and general_files_remove
-- (general-archive-rbac.sql). Also meeting_can_manage, update_meeting and
-- cancel_meeting (meetings.sql) and guard_general_repo_change
-- (general-repo.sql). Then, for discussions, chat, spaces and the role:
-- the policies general_discussion_folders_read, general_discussions_read,
-- general_discussion_messages_read (general-discussions.sql),
-- general_discussion_polls_read, general_discussion_poll_options_read,
-- general_discussion_poll_votes_read, general_discussion_files_read and the
-- functions discussion_voice_readable, discussion_voice_path_ok
-- (discussion-polls-voice.sql), general_discussion_check,
-- notify_discussion_started (general-discussions.sql),
-- sync_general_conversation_member and the general_members_conversation
-- trigger (general-notify.sql), add_general_member_to_space
-- (project-visibility.sql), set_general_member_role and
-- invite_to_general_project (project-roles.sql). Re-run it after re-running
-- any of those files, or general-schedule-guard.sql (an older
-- guard_general_task), then anon-lockdown.sql. general-notify.sql alone also
-- puts every stakeholder back in the project chat; the cleanup below takes
-- them out again.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- the helper

create or replace function public.general_can_write(p_project uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select public.is_general_member(p_project)
     and not exists (
       select 1 from public.general_members m
         join public.general_projects gp on gp.id = m.project_id
        where m.project_id = p_project
          and m.user_id = auth.uid()
          and m.role = 'stakeholder'
          and gp.class_board_id is null
     );
$$;

comment on function public.general_can_write(uuid) is
  'True when the caller is a member of the project (not rejected) who, on a work project, '
  'isn''t a stakeholder. Gates every member write; reads keep is_general_member.';

-- ---------------------------------------------------------------- tasks

create or replace function public.guard_general_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
     ) then
    raise exception 'This task is archived. Restore it from the project archive to change it.'
      using errcode = 'check_violation';
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

-- Fires before guard_general_task (triggers run in name order), so it says the
-- stakeholder refusal itself rather than a holder rule.
create or replace function public.sync_general_task_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  r record;
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

  select public.stage_count(p.stages) into n
    from public.general_projects p where p.id = new.project_id;

  -- The same people who may change its status: whoever holds it, its creator
  -- while nobody does, a leader of whoever holds it, or someone who manages
  -- tasks.
  if tg_op = 'UPDATE'
     and new.stage is distinct from old.stage
     and auth.uid() is not null
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

  select * into r from public.align_task_stage(
    coalesce(n, 3), tg_op = 'INSERT',
    case when tg_op = 'UPDATE' then old.status::text end,
    case when tg_op = 'UPDATE' then old.stage end,
    new.status::text, new.stage);
  new.status := r.status::public.general_task_status;
  new.stage := r.stage;
  return new;
end;
$$;

create or replace function public.guard_general_task_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_general_member(new.project_id) and not public.general_can_write(new.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.sprint_id is not null
     and (tg_op = 'INSERT' or new.sprint_id is distinct from old.sprint_id)
     and exists (select 1 from public.general_sprints s
                  where s.id = new.sprint_id and s.state = 'completed') then
    raise exception 'This sprint is finished, so tasks can no longer join it. Pick a planned sprint or the backlog.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.general_can(new.project_id, 'manage_tasks') then
      if new.sprint_id is not null then
        raise exception 'Only someone who manages tasks can put a task in a sprint.'
          using errcode = 'check_violation';
      end if;
      -- A member's task joins the end of the backlog, whatever rank was sent.
      new.rank := extract(epoch from clock_timestamp());
    end if;
    return new;
  end if;

  if auth.uid() is not null
     and (new.sprint_id is distinct from old.sprint_id
          or (new.rank is distinct from old.rank
              -- A team leader reorders tasks somebody on their team holds.
              and not exists (
                select 1 from public.general_task_assignees a
                 where a.task_id = old.id
                   and public.general_leads_user(old.project_id, auth.uid(), a.user_id)
              )))
     and not public.general_can(old.project_id, 'manage_tasks') then
    raise exception 'Only someone who manages tasks can plan sprints and order the backlog.'
      using errcode = 'check_violation';
  end if;

  if old.sprint_id is not null
     and new.sprint_id is not distinct from old.sprint_id
     and new.status <> 'done'
     and (old.status = 'done' or (old.archived_at is not null and new.archived_at is null))
     and exists (select 1 from public.general_sprints s
                  where s.id = old.sprint_id and s.state = 'completed') then
    new.sprint_id := null;
  end if;
  return new;
end;
$$;

create or replace function public.guard_general_task_child()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p uuid;
  -- Leaving an archived project cascades into general_task_assignees; that
  -- delete should go through even though the membership row that drove it is
  -- already gone by the time this trigger fires.
  v_member_gone boolean := false;
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

-- An UPDATE keeps is_general_member on the rows it may target, so the guard
-- triggers above run and say why; the new row must pass general_can_write.
drop policy if exists general_tasks_insert on public.general_tasks;
create policy general_tasks_insert on public.general_tasks
  for insert with check (public.general_can_write(project_id));

drop policy if exists general_tasks_update on public.general_tasks;
create policy general_tasks_update on public.general_tasks
  for update using (public.is_general_member(project_id))
  with check (public.general_can_write(project_id));

drop policy if exists general_tasks_delete on public.general_tasks;
create policy general_tasks_delete on public.general_tasks
  for delete using (
    (public.general_can(project_id, 'manage_tasks')
     or (created_by = auth.uid() and public.general_can_write(project_id)
         and not public.general_task_held(id) and not public.general_is_archived(project_id)))
    and (archived_at is null or public.general_sees_archived(project_id, archived_by))
  );

drop policy if exists general_task_assignees_insert on public.general_task_assignees;
create policy general_task_assignees_insert on public.general_task_assignees
  for insert with check (
    (public.general_can(project_id, 'manage_tasks')
     and exists (select 1 from public.profiles p
                  where p.id = general_task_assignees.user_id and p.status <> 'rejected'))
    or (user_id = auth.uid() and public.general_can_write(project_id)
        and not public.general_task_held(task_id))
    or (public.general_can_write(project_id)
        and public.general_leads_user(project_id, auth.uid(), user_id)
        and exists (select 1 from public.profiles p
                     where p.id = general_task_assignees.user_id and p.status <> 'rejected'))
  );

drop policy if exists general_task_assignees_delete on public.general_task_assignees;
create policy general_task_assignees_delete on public.general_task_assignees
  for delete using (
    public.general_can(project_id, 'manage_tasks')
    or (user_id = auth.uid() and public.general_can_write(project_id))
    or public.general_leads_user(project_id, auth.uid(), user_id)
  );

drop policy if exists general_task_comments_insert on public.general_task_comments;
create policy general_task_comments_insert on public.general_task_comments
  for insert with check (author_id = auth.uid() and public.general_can_write(project_id));

drop policy if exists general_task_comments_update on public.general_task_comments;
create policy general_task_comments_update on public.general_task_comments
  for update using (author_id = auth.uid() and public.is_general_member(project_id))
  with check (author_id = auth.uid() and public.general_can_write(project_id));

drop policy if exists general_task_comments_delete on public.general_task_comments;
create policy general_task_comments_delete on public.general_task_comments
  for delete using (
    (author_id = auth.uid() and public.general_can_write(project_id))
    or public.general_can(project_id, 'manage_tasks')
  );

drop policy if exists general_task_files_insert on public.general_task_files;
create policy general_task_files_insert on public.general_task_files
  for insert with check (
    uploaded_by = auth.uid() and public.general_can_write(project_id)
    and (public.is_general_task_assignee(task_id) or public.general_can(project_id, 'edit_files'))
  );

drop policy if exists general_task_files_delete on public.general_task_files;
create policy general_task_files_delete on public.general_task_files
  for delete using (
    ((uploaded_by = auth.uid() and public.general_can_write(project_id))
     or public.general_can(project_id, 'edit_files'))
    and (archived_at is null or public.general_sees_archived(project_id, archived_by))
    and not public.general_task_hidden(task_id)
  );

drop policy if exists general_task_logs_insert on public.general_task_logs;
create policy general_task_logs_insert on public.general_task_logs
  for insert with check (
    user_id = auth.uid() and public.general_can_write(project_id)
    and public.is_general_task_assignee(task_id)
  );

drop policy if exists general_task_logs_delete on public.general_task_logs;
create policy general_task_logs_delete on public.general_task_logs
  for delete using (user_id = auth.uid() and public.general_can_write(project_id));

-- ---------------------------------------------------------------- archive and trash

create or replace function public.archive_general_task(p_task uuid, p_archived boolean)
returns public.general_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.general_tasks%rowtype;
begin
  select * into t from public.general_tasks where id = p_task for update;
  if not found then
    raise exception 'Task not found' using errcode = 'no_data_found';
  end if;
  if not public.is_general_member(t.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(t.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(t.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if not p_archived and t.archived_at is not null
     and not public.general_sees_archived(t.project_id, t.archived_by) then
    raise exception 'Only whoever archived this, or an Owner or Manager, can restore it.'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.general_can(t.project_id, 'manage_tasks')
    or t.created_by = auth.uid()
    or (not p_archived and t.archived_by = auth.uid())
  ) then
    raise exception '%', case when p_archived
        then 'Only whoever added this task, or someone who manages tasks, can archive it.'
        else 'Only whoever added this task, or someone who manages tasks, can restore it.' end
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_tasks
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then coalesce(archived_by, auth.uid()) else null end
   where id = p_task
   returning * into t;
  perform set_config('collabify.general_archive_op', 'off', true);
  return t;
end;
$$;

-- Behind trash_general_task_file, restore_trashed_task_file,
-- delete_trashed_task_file and the restore / delete archived task and task
-- file functions.
create or replace function public.general_archive_guard(p_project uuid)
returns void
language plpgsql
stable security definer
set search_path = public
as $$
begin
  if not public.is_general_member(p_project) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(p_project) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function public.archive_general_task_file(p_file uuid, p_archived boolean)
returns public.general_task_files
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.general_task_files%rowtype;
begin
  select * into f from public.general_task_files where id = p_file for update;
  if not found then
    raise exception 'File not found' using errcode = 'no_data_found';
  end if;
  if not public.is_general_member(f.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(f.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(f.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if f.trashed_at is not null then
    raise exception 'This file is in Trash. Restore it from Trash first.'
      using errcode = 'check_violation';
  end if;
  if not p_archived and f.archived_at is not null
     and not public.general_sees_archived(f.project_id, f.archived_by) then
    raise exception 'Only whoever archived this, or an Owner or Manager, can restore it.'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.general_can(f.project_id, 'edit_files') or f.uploaded_by = auth.uid()
          or (not p_archived and f.archived_by = auth.uid())) then
    raise exception 'Only whoever added this file, or somebody who can edit files, can archive it.'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_task_files
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then coalesce(archived_by, auth.uid()) else null end
   where id = p_file
   returning * into f;
  perform set_config('collabify.general_archive_op', 'off', true);
  return f;
end;
$$;

create or replace function public.archive_trash_block(p_kind text, p_id uuid, p_in_trash boolean default false)
returns text
language plpgsql
stable security definer
set search_path = public
as $$
declare
  gone constant text := 'That is no longer in the archive. Reload to see where things stand.';
  c  public.classes%rowtype;
  g  public.groups%rowtype;
  p  public.projects%rowtype;
  t  public.project_tasks%rowtype;
  s  public.general_spaces%rowtype;
  st public.general_space_teams%rowtype;
  gp public.general_projects%rowtype;
  gt public.general_tasks%rowtype;
  held text;
begin
  if not public.general_viewer_active() then
    return 'Sign in with an active account to do this.';
  end if;

  if p_kind = 'class' then
    select * into c from public.classes where id = p_id;
    if not found or c.archived_at is null or (c.trashed_at is not null) <> p_in_trash then return gone; end if;
    if c.professor_id <> auth.uid() then return 'Only the class Owner can delete it.'; end if;

  elsif p_kind = 'group' then
    select * into g from public.groups where id = p_id;
    if not found or g.archived_at is null or (g.trashed_at is not null) <> p_in_trash then return gone; end if;
    if not public.is_set_professor(g.set_id) then return 'Only the class''s faculty can delete a group.'; end if;
    held := public.group_work_summary(g.id);
    if held is not null then
      return g.name || ' has ' || held || ' on it, so it stays in Archive.';
    end if;

  elsif p_kind = 'class_project' then
    select * into p from public.projects where id = p_id;
    if not found or p.archived_at is null or (p.trashed_at is not null) <> p_in_trash then return gone; end if;
    if not public.is_class_professor(p.class_id) then
      return 'Only the class''s faculty can delete a project.';
    end if;

  elsif p_kind = 'class_task' then
    select * into t from public.project_tasks where id = p_id;
    if not found or t.archived_at is null or (t.trashed_at is not null) <> p_in_trash then return gone; end if;
    if public.is_board_professor(t.board_id) then return null; end if;
    if t.archived_by is distinct from auth.uid() or not public.is_board_member(t.board_id) then
      return 'Only whoever archived this task, or the professor, can delete it.';
    end if;
    if public.board_project_locked(t.board_id) or public.board_submitted(t.board_id) then
      return 'This project is closed or handed in, so its tasks can no longer change.';
    end if;

  elsif p_kind = 'space' then
    select * into s from public.general_spaces where id = p_id;
    if not found or s.kind <> 'work' or s.archived_at is null or (s.trashed_at is not null) <> p_in_trash then
      return gone;
    end if;
    if not public.is_general_space_owner(s.id) then return 'Only an Owner can delete a space.'; end if;

  elsif p_kind = 'team' then
    select * into st from public.general_space_teams where id = p_id;
    if not found or st.archived_at is null or (st.trashed_at is not null) <> p_in_trash then return gone; end if;
    if not public.general_space_team_can_manage(st.id) then
      return 'Only the team''s Owner or Manager can delete it.';
    end if;

  elsif p_kind = 'project' then
    select * into gp from public.general_projects where id = p_id;
    if not found or gp.class_board_id is not null or gp.archived_at is null
       or (gp.trashed_at is not null) <> p_in_trash then
      return gone;
    end if;
    if not public.is_general_owner(gp.id) then return 'Only an Owner can delete a project.'; end if;

  elsif p_kind = 'work_task' then
    select * into gt from public.general_tasks where id = p_id;
    if not found or gt.archived_at is null or (gt.trashed_at is not null) <> p_in_trash then return gone; end if;
    if not public.is_general_member(gt.project_id) then return 'You are no longer on this project.'; end if;
    if not public.general_can_write(gt.project_id) then
      return 'Stakeholders can view this project but not change it.';
    end if;
    if public.general_is_archived(gt.project_id) then
      return 'This project is archived. An Owner can restore it to make changes.';
    end if;
    if not public.general_sees_archived(gt.project_id, gt.archived_by) then
      return 'You can delete only what you archived. An Owner or Manager can delete anything in the archive.';
    end if;

  else
    return 'That cannot go to Trash.';
  end if;

  return null;
end;
$$;

-- A stakeholder's Trash leaves out the draft files, task files and
-- discussions they can no longer restore or delete; empty_my_trash leaves them
-- where they are.
create or replace function public.list_my_trash()
returns table(kind text, id uuid, repo_id uuid, root text, name text, is_folder boolean,
              file_count integer, size_bytes bigint, trashed_at timestamptz, purge_at timestamptz,
              project_id uuid, project_name text, class_project_id uuid, task_title text,
              frozen boolean, resource_kind text, place_id uuid)
language sql
stable security definer
set search_path = public
as $$
  with drafts as (
    select d.repo_id, d.project_id, f.trash_root,
           max(f.trashed_at) as trashed_at,
           bool_or(f.path <> f.trash_root) as is_folder,
           count(*) filter (where f.path !~ '(^|/)\.keep$')::int as file_count,
           sum(case when f.kind = 'binary'
                    then coalesce((select (o.metadata ->> 'size')::bigint from storage.objects o
                                    where o.bucket_id = 'general-files' and o.name = f.storage_path), 0)
                    else octet_length(f.content) end)::bigint as size_bytes
      from public.general_drafts d
      join public.general_draft_files f on f.draft_id = d.id
     where d.user_id = auth.uid()
       and f.trashed_at is not null
       and public.general_can_write(d.project_id)
     group by d.repo_id, d.project_id, f.trash_root
  ),
  rows as (
    select 'draft'::text as kind, null::uuid as id, x.repo_id, x.trash_root as root,
           regexp_replace(x.trash_root, '^.*/', '') as name,
           x.is_folder, x.file_count, x.size_bytes, x.trashed_at, x.project_id,
           null::text as task_title, null::text as resource_kind,
           null::text as label, null::uuid as place_id
      from drafts x
    union all
    select 'task_file', f.id, null, null, f.file_name, false, 1, f.size_bytes, f.trashed_at,
           f.project_id, t.title, null, null, null
      from public.general_task_files f
      join public.general_tasks t on t.id = f.task_id
     where f.trashed_by = auth.uid()
       and f.trashed_at is not null
       and public.general_can_write(f.project_id)
    union all
    select 'resource', tr.id, null, null, tr.title, false, 1, tr.size_bytes, tr.trashed_at,
           null, null, tr.kind::text, null, null
      from public.teaching_resources tr
     where tr.professor_id = auth.uid()
       and tr.trashed_at is not null
    union all
    select 'discussion', gd.id, null, null, gd.topic, false, 1, octet_length(gd.content_html)::bigint,
           gd.trashed_at, gd.project_id, null, null, null, null
      from public.general_discussions gd
     where gd.trashed_by = auth.uid()
       and gd.trashed_at is not null
       and public.general_can_write(gd.project_id)
    union all
    select 'class', c.id, null, null, c.name, false, 1, null, c.trashed_at,
           null, null, null, c.initial || ' · ' || c.section, null
      from public.classes c
     where c.trashed_by = auth.uid() and c.trashed_at is not null
    union all
    select 'group', g.id, null, null, g.name, false, 1, null, g.trashed_at,
           null, null, null, c.name, c.id
      from public.groups g
      join public.group_sets s on s.id = g.set_id
      join public.classes c on c.id = s.class_id
     where g.trashed_by = auth.uid() and g.trashed_at is not null
    union all
    select 'class_project', p.id, null, null, p.title, false, 1, null, p.trashed_at,
           null, null, null, c.name, c.id
      from public.projects p
      join public.classes c on c.id = p.class_id
     where p.trashed_by = auth.uid() and p.trashed_at is not null
    union all
    select 'class_task', t.id, null, null, t.title, false, 1, null, t.trashed_at,
           null, null, null, p.title, p.id
      from public.project_tasks t
      join public.project_boards b on b.id = t.board_id
      join public.projects p on p.id = b.project_id
     where t.trashed_by = auth.uid() and t.trashed_at is not null
    union all
    select 'space', s.id, null, null, s.name, false, 1, null, s.trashed_at,
           null, null, null, 'Spaces', null
      from public.general_spaces s
     where s.kind = 'work' and s.trashed_by = auth.uid() and s.trashed_at is not null
    union all
    select 'team', t.id, null, null, t.name, false, 1, null, t.trashed_at,
           null, null, null, s.name, s.id
      from public.general_space_teams t
      join public.general_spaces s on s.id = t.space_id
     where t.trashed_by = auth.uid() and t.trashed_at is not null
    union all
    select 'project', p.id, null, null, p.name, false, 1, null, p.trashed_at,
           null, null, null, coalesce(s.name, 'Projects'), s.id
      from public.general_projects p
      left join public.general_spaces s on s.id = p.space_id
     where p.trashed_by = auth.uid() and p.trashed_at is not null
    union all
    select 'work_task', t.id, null, null, t.title, false, 1, null, t.trashed_at,
           t.project_id, null, null, null, null
      from public.general_tasks t
     where t.trashed_by = auth.uid() and t.trashed_at is not null
  )
  select r.kind, r.id, r.repo_id, r.root, r.name, r.is_folder, r.file_count, r.size_bytes,
         r.trashed_at, r.trashed_at + interval '30 days',
         r.project_id,
         coalesce(r.label,
                  case r.resource_kind when 'syllabus' then 'Syllabi' when 'curriculum' then 'Curriculum' end,
                  cp.title, gp.name),
         b.project_id,
         r.task_title,
         coalesce(gp.archived_at is not null or public.class_board_frozen(gp.class_board_id), false),
         r.resource_kind,
         r.place_id
    from rows r
    left join public.general_projects gp on gp.id = r.project_id
    left join public.project_boards b on b.id = gp.class_board_id
    left join public.projects cp on cp.id = b.project_id
   order by r.trashed_at desc, r.name;
$$;

create or replace function public.empty_my_trash()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  m int;
  k int;
  j int;
  x int := 0;
  r record;
begin
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to empty Trash'
      using errcode = 'insufficient_privilege';
  end if;
  delete from public.general_draft_files f
   using public.general_drafts d
   where d.id = f.draft_id and d.user_id = auth.uid()
     and f.trashed_at is not null
     and public.general_can_write(d.project_id)
     and not public.general_is_archived(d.project_id);
  get diagnostics n = row_count;

  perform set_config('collabify.general_archive_op', 'on', true);
  delete from public.general_task_files f
   where f.trashed_by = auth.uid() and f.trashed_at is not null
     and public.general_can_write(f.project_id)
     and not public.general_is_archived(f.project_id);
  get diagnostics m = row_count;
  perform set_config('collabify.general_archive_op', 'off', true);

  delete from public.teaching_resources where professor_id = auth.uid() and trashed_at is not null;
  get diagnostics k = row_count;

  delete from public.general_discussions gd
   where gd.trashed_by = auth.uid() and gd.trashed_at is not null
     and public.general_can_write(gd.project_id)
     and not public.general_is_archived(gd.project_id);
  get diagnostics j = row_count;

  -- Whatever may not go yet (a project now locked, a right since lost) stays.
  for r in select * from public.archive_trash_rows(auth.uid(), null) loop
    begin
      perform public.delete_trashed_item(r.kind, r.id);
      x := x + 1;
    exception when others then
      null;
    end;
  end loop;
  return n + m + k + j + x;
end;
$$;

-- ---------------------------------------------------------------- drafts and review

-- A stakeholder still reads the draft they had; they cannot start, change or
-- remove one.
drop policy if exists general_drafts_own on public.general_drafts;

drop policy if exists general_drafts_select on public.general_drafts;
create policy general_drafts_select on public.general_drafts
  for select using (user_id = auth.uid() and public.is_general_member(project_id));

drop policy if exists general_drafts_insert on public.general_drafts;
create policy general_drafts_insert on public.general_drafts
  for insert with check (user_id = auth.uid() and public.general_can_write(project_id));

drop policy if exists general_drafts_update on public.general_drafts;
create policy general_drafts_update on public.general_drafts
  for update using (user_id = auth.uid() and public.general_can_write(project_id))
  with check (user_id = auth.uid() and public.general_can_write(project_id));

drop policy if exists general_drafts_delete on public.general_drafts;
create policy general_drafts_delete on public.general_drafts
  for delete using (user_id = auth.uid() and public.general_can_write(project_id));

-- Every draft-file write passes here: the policy on general_draft_files only
-- asks that the draft be yours, and the draft functions (save, discard,
-- archive, trash, restore, rename) run as security definer. A cascade after
-- the stakeholder has left finds them no longer a member, so it goes through.
create or replace function public.guard_general_draft_file()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('collabify.trash_purge', true), 'off') = 'on' then
    return old;
  end if;
  if public.general_is_archived(coalesce(new.project_id, old.project_id)) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.general_viewer_active() then
    raise exception 'Sign in with an active account to work on files'
      using errcode = 'insufficient_privilege';
  end if;
  if public.is_general_member(coalesce(new.project_id, old.project_id))
     and not public.general_can_write(coalesce(new.project_id, old.project_id)) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  -- An uploaded object must sit under this project's own folder, the same rule
  -- a commit follows.
  if tg_op <> 'DELETE' and new.kind = 'binary'
     and new.storage_path !~ ('^' || new.project_id::text || '/files/') then
    raise exception 'That file was not uploaded to this project'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.my_general_draft(p_repo uuid)
returns public.general_drafts
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.general_repos%rowtype;
  d public.general_drafts%rowtype;
begin
  select * into r from public.general_repos where id = p_repo;
  if not found then
    raise exception 'That repository is gone' using errcode = 'no_data_found';
  end if;

  if not public.general_viewer_active() or not public.is_general_member(r.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(r.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if found then
    return d;
  end if;

  insert into public.general_drafts (repo_id, project_id, user_id, base_seq)
  values (r.id, r.project_id, auth.uid(), r.commit_count)
  returning * into d;

  return d;
end;
$$;

-- Reviewers must be on the project and must not be stakeholders.
create or replace function public.general_review_reviewers(p_project uuid, p_reviewer uuid, p_reviewers uuid[])
returns uuid[]
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v uuid[];
begin
  select coalesce(array_agg(x order by ord), '{}') into v
    from (
      select x, min(ord) as ord
        from unnest(array_prepend(p_reviewer, coalesce(p_reviewers, '{}'))) with ordinality as t(x, ord)
       where x is not null
       group by x
    ) u;
  if cardinality(v) = 0 then
    raise exception 'Choose at least one project member to review your change'
      using errcode = 'invalid_parameter_value';
  end if;
  if auth.uid() = any (v) then
    raise exception 'Choose somebody else to review your change'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (
    select 1 from unnest(v) as x
     where not exists (
       select 1 from public.general_members m
       join public.profiles pr on pr.id = m.user_id
        where m.project_id = p_project and m.user_id = x and pr.status <> 'rejected')
  ) then
    raise exception 'Every reviewer must be on this project'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (
    select 1 from public.general_members m
     where m.project_id = p_project and m.user_id = any (v) and m.role = 'stakeholder'
  ) then
    raise exception 'Stakeholders can''t review changes. Choose somebody else to review it.'
      using errcode = 'insufficient_privilege';
  end if;
  return v;
end;
$$;

create or replace function public.submit_general_draft(p_repo uuid, p_title text, p_body text default '',
                                                       p_reviewer uuid default null, p_reviewers uuid[] default null)
returns public.general_repo_changes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reviewers uuid[];
  d     public.general_drafts%rowtype;
  r     public.general_repos%rowtype;
  ch    public.general_repo_changes%rowtype;
  items jsonb;
  n     int;
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if not found then
    raise exception 'You have nothing in your draft' using errcode = 'no_data_found';
  end if;

  select * into r from public.general_repos where id = p_repo;

  if not public.general_viewer_active() or not public.is_general_member(r.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(r.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(r.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;
  v_reviewers := public.general_review_reviewers(r.project_id, p_reviewer, p_reviewers);

  select count(*) into n from public.general_draft_files where draft_id = d.id and archived_at is null;
  if n = 0 then
    raise exception 'You have nothing in your draft' using errcode = 'no_data_found';
  end if;
  if n > 100 then
    raise exception 'A change can carry up to 100 files. Submit some of them first.'
      using errcode = 'check_violation';
  end if;

  if d.base_seq <> r.commit_count then
    raise exception 'Your draft was started from commit % and the repository is now on commit %. Bring it up to date first.', d.base_seq, r.commit_count
      using errcode = 'serialization_failure';
  end if;

  select jsonb_agg(jsonb_build_object(
           'path', f.path,
           'action', f.action,
           'kind', f.kind,
           'content', f.content,
           'storage_path', f.storage_path) order by f.path)
    into items
    from public.general_draft_files f
   where f.draft_id = d.id
     and f.archived_at is null;

  insert into public.general_repo_changes
    (repo_id, project_id, author_id, reviewer_id, reviewer_ids, title, body, base_seq, files)
  values (r.id, r.project_id, auth.uid(), v_reviewers[1], v_reviewers, btrim(p_title), coalesce(p_body, ''),
          d.base_seq, items)
  returning * into ch;

  delete from public.general_draft_files where draft_id = d.id and archived_at is null;
  update public.general_drafts set updated_at = now() where id = d.id;

  return ch;
end;
$$;

create or replace function public.submit_general_draft_file(p_repo uuid, p_path text, p_title text, p_body text default '',
                                                            p_reviewer uuid default null, p_reviewers uuid[] default null)
returns public.general_repo_changes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reviewers uuid[];
  d     public.general_drafts%rowtype;
  r     public.general_repos%rowtype;
  f     public.general_draft_files%rowtype;
  ch    public.general_repo_changes%rowtype;
  items jsonb;
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if not found then
    raise exception 'You have nothing in your draft' using errcode = 'no_data_found';
  end if;

  select * into r from public.general_repos where id = p_repo;

  if not public.general_viewer_active() or not public.is_general_member(r.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(r.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(r.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;
  v_reviewers := public.general_review_reviewers(r.project_id, p_reviewer, p_reviewers);
  if d.base_seq <> r.commit_count then
    raise exception 'Your draft was started from commit % and the repository is now on commit %. Bring it up to date first.', d.base_seq, r.commit_count
      using errcode = 'serialization_failure';
  end if;

  select * into f from public.general_draft_files
   where draft_id = d.id and path = btrim(p_path) and archived_at is null;
  if not found then
    raise exception 'That file is not in your draft' using errcode = 'no_data_found';
  end if;

  items := jsonb_build_array(jsonb_build_object(
    'path', f.path,
    'action', f.action,
    'kind', f.kind,
    'content', f.content,
    'storage_path', f.storage_path));

  insert into public.general_repo_changes
    (repo_id, project_id, author_id, reviewer_id, reviewer_ids, title, body, base_seq, files)
  values (r.id, r.project_id, auth.uid(), v_reviewers[1], v_reviewers, btrim(p_title), coalesce(p_body, ''),
          d.base_seq, items)
  returning * into ch;

  delete from public.general_draft_files where id = f.id;
  update public.general_drafts set updated_at = now() where id = d.id;

  return ch;
end;
$$;

create or replace function public.submit_general_draft_folder(p_repo uuid, p_path text, p_title text, p_body text default '',
                                                              p_reviewer uuid default null, p_reviewers uuid[] default null)
returns public.general_repo_changes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reviewers uuid[];
  d     public.general_drafts%rowtype;
  r     public.general_repos%rowtype;
  ch    public.general_repo_changes%rowtype;
  items jsonb;
  v_path text := btrim(p_path);
  n int;
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if not found then
    raise exception 'You have nothing in your draft' using errcode = 'no_data_found';
  end if;

  select * into r from public.general_repos where id = p_repo;

  if not public.general_viewer_active() or not public.is_general_member(r.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(r.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(r.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;
  v_reviewers := public.general_review_reviewers(r.project_id, p_reviewer, p_reviewers);
  if d.base_seq <> r.commit_count then
    raise exception 'Your draft was started from commit % and the repository is now on commit %. Bring it up to date first.', d.base_seq, r.commit_count
      using errcode = 'serialization_failure';
  end if;

  select count(*) into n
    from public.general_draft_files f
   where f.draft_id = d.id
     and f.archived_at is null
     and left(f.path, char_length(v_path) + 1) = v_path || '/';

  if n = 0 then
    raise exception 'That folder has no draft files' using errcode = 'no_data_found';
  end if;
  if n > 100 then
    raise exception 'A change can carry up to 100 files. Submit a smaller folder first.'
      using errcode = 'check_violation';
  end if;

  select jsonb_agg(jsonb_build_object(
           'path', f.path,
           'action', f.action,
           'kind', f.kind,
           'content', f.content,
           'storage_path', f.storage_path) order by f.path)
    into items
    from public.general_draft_files f
   where f.draft_id = d.id
     and f.archived_at is null
     and left(f.path, char_length(v_path) + 1) = v_path || '/';

  insert into public.general_repo_changes
    (repo_id, project_id, author_id, reviewer_id, reviewer_ids, title, body, base_seq, files)
  values (r.id, r.project_id, auth.uid(), v_reviewers[1], v_reviewers, btrim(p_title), coalesce(p_body, ''),
          d.base_seq, items)
  returning * into ch;

  delete from public.general_draft_files
   where draft_id = d.id
     and archived_at is null
     and left(path, char_length(v_path) + 1) = v_path || '/';
  update public.general_drafts set updated_at = now() where id = d.id;

  return ch;
end;
$$;

create or replace function public.commit_general_draft_path(p_repo uuid, p_path text, p_folder boolean,
                                                            p_message text default '')
returns public.general_commits
language plpgsql
security definer
set search_path = public
as $$
declare
  d      public.general_drafts%rowtype;
  r      public.general_repos%rowtype;
  c      public.general_commits%rowtype;
  items  jsonb;
  v_path text := btrim(p_path, ' /');
  n      int;
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if not found then
    raise exception 'You have nothing in your draft' using errcode = 'no_data_found';
  end if;

  select * into r from public.general_repos where id = p_repo;

  if not public.general_viewer_active() or not public.is_general_member(r.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(r.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(r.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;
  if d.base_seq <> r.commit_count then
    raise exception 'Your draft was started from commit % and the repository is now on commit %. Bring it up to date first.', d.base_seq, r.commit_count
      using errcode = 'serialization_failure';
  end if;

  select count(*),
         jsonb_agg(jsonb_build_object(
           'path', f.path,
           'action', f.action,
           'kind', f.kind,
           'content', f.content,
           'storage_path', f.storage_path) order by f.path)
    into n, items
    from public.general_draft_files f
   where f.draft_id = d.id
     and f.archived_at is null
     and (case when p_folder then left(f.path, char_length(v_path) + 1) = v_path || '/'
               else f.path = v_path end);

  if n = 0 then
    raise exception 'That is not in your draft' using errcode = 'no_data_found';
  end if;
  if n > 100 then
    raise exception 'A commit can carry up to 100 files. Commit a smaller folder first.'
      using errcode = 'check_violation';
  end if;

  -- Checks edit_files and every file rule.
  c := public.commit_general_files(
    r.id,
    left(coalesce(nullif(btrim(p_message), ''), 'Committed ' || v_path), 2000),
    d.base_seq,
    items);

  delete from public.general_draft_files
   where draft_id = d.id
     and archived_at is null
     and (case when p_folder then left(path, char_length(v_path) + 1) = v_path || '/'
               else path = v_path end);

  -- The only commit since the draft's base is this one, and it touched only
  -- paths that just left the draft, so what remains is still up to date.
  update public.general_drafts set base_seq = c.seq, updated_at = now() where id = d.id;

  return c;
end;
$$;

-- A reviewer who has since become a stakeholder answers nothing.
create or replace function public.answer_general_repo_change(p_change uuid, p_merge boolean, p_note text default '')
returns public.general_repo_changes
language plpgsql
security definer
set search_path = public
as $$
declare
  ch public.general_repo_changes%rowtype;
  r  public.general_repos%rowtype;
begin
  select * into ch from public.general_repo_changes where id = p_change for update;
  if not found then
    raise exception 'That change is gone' using errcode = 'no_data_found';
  end if;

  if ch.author_id = auth.uid() then
    raise exception 'You cannot answer your own change'
      using errcode = 'insufficient_privilege';
  end if;
  if public.is_general_member(ch.project_id) and not public.general_can_write(ch.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Any one of the reviewers asked may answer; with none named, anyone who
  -- holds commit_main. Merging lands it on Main, so that takes commit_main
  -- whoever was asked.
  if not public.general_viewer_active()
     or (
       (cardinality(ch.reviewer_ids) > 0 and not auth.uid() = any (ch.reviewer_ids))
       or (cardinality(ch.reviewer_ids) = 0 and not public.general_can(ch.project_id, 'commit_main'))
     ) then
    raise exception 'You are not the reviewer for this change'
      using errcode = 'insufficient_privilege';
  end if;
  if p_merge and not public.general_can(ch.project_id, 'commit_main') then
    raise exception 'Merging puts this on Main, which needs Commit to Main. Decline it, or ask for that permission.'
      using errcode = 'insufficient_privilege';
  end if;

  if ch.status <> 'open' then
    raise exception 'That change was already answered' using errcode = 'invalid_parameter_value';
  end if;

  if p_merge then
    select * into r from public.general_repos where id = ch.repo_id;
    if r.commit_count <> ch.base_seq then
      raise exception 'This change was written against commit % and the repository is now on commit %. Ask its author to bring it up to date.', ch.base_seq, r.commit_count
        using errcode = 'serialization_failure';
    end if;

    perform set_config('collabify.general_repo_op', 'on', true);
    perform public.commit_general_files(
      ch.repo_id,
      left(coalesce(nullif(btrim(ch.title), ''), 'Merged a change'), 2000),
      ch.base_seq,
      ch.files,
      ch.author_id,
      ch.id);
    perform set_config('collabify.general_repo_op', 'off', true);
  end if;

  perform set_config('collabify.general_repo_op', 'on', true);
  update public.general_repo_changes
     set status = case when p_merge then 'applied' else 'declined' end::public.general_change_status,
         decided_by = auth.uid(),
         decided_at = now(),
         decided_note = left(coalesce(p_note, ''), 2000)
   where id = ch.id
  returning * into ch;
  perform set_config('collabify.general_repo_op', 'off', true);

  return ch;
end;
$$;

-- A change opened by hand names no stakeholder as reviewer either.
create or replace function public.guard_general_repo_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.general_is_archived(coalesce(new.project_id, old.project_id)) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    if new.author_id is distinct from auth.uid() then
      raise exception 'A change is opened by whoever wrote it' using errcode = 'insufficient_privilege';
    end if;
    if new.status <> 'open' or new.decided_by is not null or new.decided_at is not null then
      raise exception 'A change starts open and undecided' using errcode = 'insufficient_privilege';
    end if;
    if new.reviewer_id is not null and not new.reviewer_id = any (new.reviewer_ids) then
      new.reviewer_ids := array_prepend(new.reviewer_id, new.reviewer_ids);
    end if;
    if new.author_id = any (new.reviewer_ids) then
      raise exception 'Choose somebody else to review your change'
        using errcode = 'insufficient_privilege';
    end if;
    if exists (
      select 1 from unnest(new.reviewer_ids) as x
       where not exists (
         select 1 from public.general_members m
         join public.profiles pr on pr.id = m.user_id
          where m.project_id = new.project_id and m.user_id = x
            and pr.status <> 'rejected')
    ) then
      raise exception 'Every reviewer must be on this project'
        using errcode = 'insufficient_privilege';
    end if;
    if exists (
      select 1 from public.general_members m
       where m.project_id = new.project_id and m.user_id = any (new.reviewer_ids)
         and m.role = 'stakeholder'
    ) then
      raise exception 'Stakeholders can''t review changes. Choose somebody else to review it.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.project_id <> old.project_id or new.repo_id <> old.repo_id then
      raise exception 'A change cannot move' using errcode = 'insufficient_privilege';
    end if;
    if new.author_id is distinct from old.author_id or new.created_at <> old.created_at then
      raise exception 'A change keeps who opened it' using errcode = 'insufficient_privilege';
    end if;
    if (new.reviewer_id is distinct from old.reviewer_id or new.reviewer_ids is distinct from old.reviewer_ids)
       and coalesce(current_setting('collabify.general_repo_op', true), 'off') <> 'on' then
      raise exception 'A change keeps its reviewer' using errcode = 'insufficient_privilege';
    end if;
    if old.status <> 'open' then
      raise exception 'That change was already answered' using errcode = 'insufficient_privilege';
    end if;
    -- The author may keep editing their own open change; deciding one is the
    -- RPC's, which sets collabify.general_repo_op.
    if new.status <> old.status then
      if new.status = 'withdrawn' then
        if old.author_id is distinct from auth.uid() then
          raise exception 'Only whoever opened a change withdraws it'
            using errcode = 'insufficient_privilege';
        end if;
      elsif coalesce(current_setting('collabify.general_repo_op', true), 'off') <> 'on' then
        raise exception 'Use the review buttons to answer a change'
          using errcode = 'insufficient_privilege';
      end if;
    elsif new.author_id is distinct from auth.uid()
          and coalesce(current_setting('collabify.general_repo_op', true), 'off') <> 'on' then
      raise exception 'Only whoever opened a change edits it' using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop policy if exists general_repo_changes_insert on public.general_repo_changes;
create policy general_repo_changes_insert on public.general_repo_changes
  for insert with check (
    public.general_can_write(project_id) and public.general_viewer_active()
    and not public.general_is_archived(project_id)
  );

drop policy if exists general_repo_changes_update on public.general_repo_changes;
create policy general_repo_changes_update on public.general_repo_changes
  for update using (
    ((author_id = auth.uid() and public.general_can_write(project_id))
     or public.general_can(project_id, 'edit_files'))
    and public.general_viewer_active()
  )
  with check (
    ((author_id = auth.uid() and public.general_can_write(project_id))
     or public.general_can(project_id, 'edit_files'))
    and public.general_viewer_active()
  );

drop policy if exists general_repo_comments_insert on public.general_repo_comments;
create policy general_repo_comments_insert on public.general_repo_comments
  for insert with check (public.general_can_write(project_id) and public.general_viewer_active());

drop policy if exists general_repo_comments_delete on public.general_repo_comments;
create policy general_repo_comments_delete on public.general_repo_comments
  for delete using (
    ((author_id = auth.uid() and public.general_can_write(project_id))
     or public.general_can(project_id, 'edit_files'))
    and public.general_viewer_active()
  );

-- ---------------------------------------------------------------- shares

create or replace function public.share_general_draft_path(p_repo uuid, p_path text, p_folder boolean, p_recipients uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.general_repos%rowtype;
  d       public.general_drafts%rowtype;
  v_path  text := btrim(coalesce(p_path, ''));
  v_to    uuid[];
  v_files jsonb;
  v_share uuid;
begin
  select * into r from public.general_repos where id = p_repo;
  if not found then
    raise exception 'Those files are gone' using errcode = 'no_data_found';
  end if;
  if not public.general_viewer_active() or not public.is_general_member(r.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(r.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(r.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;

  select array_agg(distinct x) into v_to from unnest(coalesce(p_recipients, '{}')) x where x is not null;
  if v_to is null or cardinality(v_to) = 0 then
    raise exception 'Choose at least one member to share with' using errcode = 'invalid_parameter_value';
  end if;
  if auth.uid() = any (v_to) then
    raise exception 'You cannot share with yourself. Choose another member.'
      using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(v_to) x
              where not exists (select 1 from public.general_members m
                                 where m.project_id = r.project_id and m.user_id = x)) then
    raise exception 'You can only share with members of this project'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.general_members m
              where m.project_id = r.project_id and m.user_id = any (v_to)
                and m.role = 'stakeholder') then
    raise exception 'Stakeholders can''t receive shared files.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into d from public.general_drafts where repo_id = p_repo and user_id = auth.uid();
  if not found then
    raise exception 'Your draft is empty, so there is nothing to share' using errcode = 'no_data_found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'path', f.path, 'kind', f.kind, 'content', f.content, 'storage_path', f.storage_path)
           order by f.path), '[]'::jsonb)
    into v_files
    from public.general_draft_files f
   where f.draft_id = d.id
     and f.archived_at is null
     and f.action <> 'removed'
     and (case when p_folder then left(f.path, char_length(v_path) + 1) = v_path || '/'
               else f.path = v_path end);

  if jsonb_array_length(v_files) = 0 then
    raise exception 'That is not in your draft any more. Refresh and try again.'
      using errcode = 'no_data_found';
  end if;

  -- Sharing a path again replaces what these people had of it before.
  delete from public.general_share_recipients sr
   using public.general_shares s
   where s.id = sr.share_id
     and s.repo_id = p_repo and s.sender_id = auth.uid() and s.path = v_path
     and sr.user_id = any (v_to);
  delete from public.general_shares s
   where s.repo_id = p_repo and s.sender_id = auth.uid() and s.path = v_path
     and not exists (select 1 from public.general_share_recipients sr where sr.share_id = s.id);

  insert into public.general_shares (project_id, repo_id, sender_id, type, path, files)
  values (r.project_id, p_repo, auth.uid(), case when p_folder then 'folder' else 'file' end, v_path, v_files)
  returning id into v_share;

  insert into public.general_share_recipients (share_id, user_id)
  select v_share, x from unnest(v_to) x;

  return v_share;
end;
$$;

create or replace function public.copy_general_share_to_draft(p_share uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s       public.general_shares%rowtype;
  d       public.general_drafts%rowtype;
  v_taken text;
  v_count int;
begin
  select * into s from public.general_shares where id = p_share;
  if not found
     or not exists (select 1 from public.general_share_recipients r
                     where r.share_id = p_share and r.user_id = auth.uid())
     or not public.is_general_member(s.project_id) then
    raise exception 'That is not shared with you' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(s.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;

  d := public.my_general_draft(s.repo_id);

  select string_agg(f.path, ', ' order by f.path) into v_taken
    from public.general_draft_files f
   where f.draft_id = d.id
     and f.path in (select x ->> 'path' from jsonb_array_elements(s.files) x);
  if v_taken is not null then
    raise exception 'Your draft already has %. Move or rename it, then copy again.', v_taken
      using errcode = 'unique_violation';
  end if;

  insert into public.general_draft_files (draft_id, project_id, path, action, kind, content, storage_path)
  select d.id, d.project_id, x ->> 'path',
         (case when exists (select 1 from public.general_repo_tree t
                             where t.repo_id = s.repo_id and t.path = x ->> 'path')
               then 'changed' else 'added' end)::public.general_file_action,
         (x ->> 'kind')::public.general_file_kind,
         coalesce(x ->> 'content', ''),
         x ->> 'storage_path'
    from jsonb_array_elements(s.files) x;
  get diagnostics v_count = row_count;

  update public.general_drafts set updated_at = now() where id = d.id;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------- storage

drop policy if exists general_project_files_write on storage.objects;
create policy general_project_files_write on storage.objects
  for insert with check (
    bucket_id = 'general-files'
    and (storage.foldername(name))[2] = 'files'
    and public.general_viewer_active()
    and public.general_can_write(public.general_safe_uuid((storage.foldername(name))[1]))
    and not public.general_is_archived(public.general_safe_uuid((storage.foldername(name))[1]))
  );

drop policy if exists general_files_write on storage.objects;
create policy general_files_write on storage.objects
  for insert with check (
    bucket_id = 'general-files'
    and public.general_task_project(public.general_safe_uuid((storage.foldername(name))[2]))
        = public.general_safe_uuid((storage.foldername(name))[1])
    and not public.general_task_archived(public.general_safe_uuid((storage.foldername(name))[2]))
    and (
      (public.is_general_task_assignee(public.general_safe_uuid((storage.foldername(name))[2]))
       and public.general_can_write(public.general_safe_uuid((storage.foldername(name))[1]))
       and not public.general_is_archived(public.general_safe_uuid((storage.foldername(name))[1])))
      or public.general_can(public.general_safe_uuid((storage.foldername(name))[1]), 'edit_files')
    )
  );

drop policy if exists general_files_remove on storage.objects;
create policy general_files_remove on storage.objects
  for delete using (
    bucket_id = 'general-files'
    and (
      (exists (select 1 from public.general_task_files f
                where f.file_path = objects.name and f.uploaded_by = auth.uid())
       and public.general_can_write(public.general_safe_uuid((storage.foldername(name))[1]))
       and not public.general_is_archived(public.general_safe_uuid((storage.foldername(name))[1])))
      or public.general_can(public.general_safe_uuid((storage.foldername(name))[1]), 'edit_files')
    )
    and not public.general_task_file_hidden(name)
  );

-- ---------------------------------------------------------------- access requests

-- Grants are for members and team leads only: a stakeholder or a qa asks for
-- nothing.
create or replace function public.request_general_access(p_project uuid, p_permission public.general_permission,
                                                         p_reason text default '')
returns public.general_access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  lvl public.general_level;
  rl  public.general_role;
  req public.general_access_requests%rowtype;
begin
  if not public.is_general_member(p_project) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(p_project) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  select level, role into lvl, rl from public.general_members
   where project_id = p_project and user_id = auth.uid();
  if rl = 'qa' then
    raise exception 'QA can''t ask for more access.' using errcode = 'insufficient_privilege';
  end if;
  if lvl <> 'member' or exists (
    select 1 from public.general_grants
     where project_id = p_project and user_id = auth.uid() and permission = p_permission
  ) or (p_permission = 'commit_main' and public.general_class_commit_ok(p_project)) then
    raise exception 'You already have that permission' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.general_access_requests
     where project_id = p_project and user_id = auth.uid()
       and permission = p_permission and status = 'open'
  ) then
    raise exception 'You already asked for this. An Owner has not answered yet.'
      using errcode = 'unique_violation';
  end if;

  perform public.rate_limit('general_access_request', 20, interval '1 hour',
    'You have sent a lot of access requests in the last hour. Try again later.');

  insert into public.general_access_requests (project_id, user_id, permission, reason)
  values (p_project, auth.uid(), p_permission, btrim(coalesce(p_reason, '')))
  returning * into req;
  return req;
end;
$$;

-- ---------------------------------------------------------------- meetings

create or replace function public.create_meeting(p_scope public.meeting_scope, p_audience uuid, p_title text,
                                                 p_agenda text, p_join_url text, p_starts_at timestamptz,
                                                 p_duration_min integer)
returns public.meetings
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.meetings;
  allowed boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to schedule a meeting.' using errcode = 'insufficient_privilege';
  end if;

  m.scope := p_scope;
  case p_scope
    when 'class' then m.class_id := p_audience;
    when 'group' then m.group_id := p_audience;
    when 'space' then m.space_id := p_audience;
    when 'project' then m.project_id := p_audience;
    when 'space_team' then m.space_team_id := p_audience;
    when 'project_team' then m.project_team_id := p_audience;
  end case;

  -- Fill the parents here too, so the checks below can read them.
  if p_scope = 'group' then
    select gs.class_id into m.class_id
      from public.groups g join public.group_sets gs on gs.id = g.set_id where g.id = p_audience;
  elsif p_scope = 'project' then
    select space_id into m.space_id from public.general_projects where id = p_audience;
  elsif p_scope = 'space_team' then
    select space_id into m.space_id from public.general_space_teams where id = p_audience;
  elsif p_scope = 'project_team' then
    select t.project_id, p.space_id into m.project_id, m.space_id
      from public.general_teams t join public.general_projects p on p.id = t.project_id
     where t.id = p_audience;
  end if;

  if p_scope in ('project', 'project_team')
     and public.is_general_member(m.project_id) and not public.general_can_write(m.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;

  allowed := case p_scope
    when 'class' then public.is_class_professor(m.class_id)
    when 'group' then public.is_group_member(m.group_id) or public.is_class_professor(m.class_id)
    when 'space' then public.is_general_space_member(m.space_id)
      and exists (select 1 from public.general_spaces s where s.id = m.space_id and s.kind = 'work')
    when 'project' then public.general_can_write(m.project_id)
    when 'space_team' then public.is_general_space_team_member(m.space_team_id)
    when 'project_team' then public.is_general_team_member(m.project_team_id)
      and public.general_can_write(m.project_id)
  end;
  if not coalesce(allowed, false) then
    raise exception '%', case p_scope
      when 'class' then 'Only the faculty who teach this class can schedule a meeting for all of it.'
      when 'group' then 'Only this group''s members and its class''s faculty can schedule a meeting for it.'
      else 'You can schedule a meeting only for a space, project or team you are in.' end
      using errcode = 'insufficient_privilege';
  end if;
  -- A class board's Files are a hidden project behind the board (class-files.sql);
  -- its students meet as their group, never as that project.
  if exists (select 1 from public.general_projects
              where id = m.project_id and class_board_id is not null) then
    raise exception 'A class project''s files are not a meeting audience. Schedule it for your group instead.'
      using errcode = 'check_violation';
  end if;
  if public.meeting_audience_archived(m) then
    raise exception 'This is archived, so it takes no new meetings. Restore it first.'
      using errcode = 'check_violation';
  end if;
  if not public.meeting_url_ok(p_join_url) then
    raise exception 'Paste a Zoom, Google Meet or Google Calendar invite link. It starts with https://zoom.us/, https://meet.google.com/ or https://calendar.app.google/.'
      using errcode = 'check_violation';
  end if;
  if p_starts_at < now() - interval '5 minutes' then
    raise exception 'That start time has passed. Pick a time from now on, or start the meeting now.'
      using errcode = 'check_violation';
  end if;

  insert into public.meetings
    (scope, class_id, group_id, space_id, project_id, space_team_id, project_team_id,
     title, agenda, platform, join_url, starts_at, duration_min, created_by)
  values
    (m.scope, m.class_id, m.group_id, m.space_id, m.project_id, m.space_team_id, m.project_team_id,
     btrim(p_title), coalesce(p_agenda, ''), 'zoom', btrim(p_join_url), p_starts_at,
     coalesce(p_duration_min, 60), auth.uid())
  returning * into m;
  return m;
end;
$$;

create or replace function public.meeting_audiences()
returns table(scope public.meeting_scope, audience_id uuid, label text, context text,
              class_id uuid, space_id uuid, can_create boolean)
language sql
stable security definer
set search_path = public
as $$
  -- Classes: their students, and their faculty.
  select 'class'::public.meeting_scope, c.id, c.name, c.section, c.id, null::uuid,
         public.is_class_professor(c.id)
    from public.classes c
   where c.archived_at is null
     and (public.is_active_member(c.id) or public.is_class_professor(c.id))
  union all
  -- Groups: a student's own, and every group in a class the reader teaches.
  select 'group', g.id, g.name, c.name || ' · ' || gs.name, c.id, null, true
    from public.groups g
    join public.group_sets gs on gs.id = g.set_id
    join public.classes c on c.id = gs.class_id
   where g.archived_at is null and c.archived_at is null
     and (public.is_group_member(g.id) or public.is_class_professor(c.id))
  union all
  select 'space', s.id, s.name, '', null, s.id, true
    from public.general_spaces s
   where s.kind = 'work' and s.archived_at is null and public.is_general_space_member(s.id)
  union all
  -- A stakeholder sees their projects and teams here, but schedules nothing.
  select 'project', p.id, p.name, s.name, null, p.space_id, public.general_can_write(p.id)
    from public.general_projects p
    join public.general_spaces s on s.id = p.space_id
   where p.archived_at is null and s.archived_at is null and public.is_general_member(p.id)
     -- Not the hidden project behind a class board's Files: that is the group.
     and p.class_board_id is null
  union all
  select 'space_team', t.id, t.name, s.name, null, t.space_id, true
    from public.general_space_teams t
    join public.general_spaces s on s.id = t.space_id
   where t.archived_at is null and s.archived_at is null and public.is_general_space_team_member(t.id)
  union all
  select 'project_team', t.id, t.name, p.name, null, p.space_id, public.general_can_write(t.project_id)
    from public.general_teams t
    join public.general_projects p on p.id = t.project_id
    join public.general_spaces s on s.id = p.space_id
   where p.archived_at is null and s.archived_at is null and public.is_general_team_member(t.id)
     and p.class_board_id is null;
$$;

-- Whoever scheduled a project or project-team meeting keeps managing it only
-- while they can write to the project; the project's leads always can.
create or replace function public.meeting_can_manage(m public.meetings)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select public.meeting_can_see(m) and (
    (m.created_by = auth.uid()
     and (m.scope not in ('project', 'project_team') or public.general_can_write(m.project_id)))
    or case m.scope
      when 'class' then public.is_class_professor(m.class_id)
      when 'group' then public.is_class_professor(m.class_id)
      when 'space' then public.general_space_has_manage(m.space_id)
      when 'project' then public.general_leads(m.project_id)
      when 'space_team' then public.general_space_team_can_manage(m.space_team_id)
      when 'project_team' then public.general_leads(m.project_id)
    end
  );
$$;

create or replace function public.update_meeting(p_meeting uuid, p_title text, p_agenda text, p_join_url text,
                                                 p_starts_at timestamptz, p_duration_min integer)
returns public.meetings
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if not found or not public.meeting_can_see(m) then
    raise exception 'That meeting is gone, or you are no longer in it.' using errcode = 'no_data_found';
  end if;
  if m.scope in ('project', 'project_team')
     and public.is_general_member(m.project_id) and not public.general_can_write(m.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.meeting_can_manage(m) then
    raise exception 'Only whoever scheduled this meeting, or whoever leads its audience, can change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if m.cancelled_at is not null then
    raise exception 'This meeting was cancelled. Schedule a new one instead.' using errcode = 'check_violation';
  end if;
  if public.meeting_audience_archived(m) then
    raise exception 'This is archived, so its meetings cannot change. Restore it first.'
      using errcode = 'check_violation';
  end if;
  if not public.meeting_url_ok(p_join_url) then
    raise exception 'Paste a Zoom, Google Meet or Google Calendar invite link. It starts with https://zoom.us/, https://meet.google.com/ or https://calendar.app.google/.'
      using errcode = 'check_violation';
  end if;
  if p_starts_at is distinct from m.starts_at and p_starts_at < now() - interval '5 minutes' then
    raise exception 'That start time has passed. Pick a time from now on.' using errcode = 'check_violation';
  end if;

  update public.meetings
     set title = btrim(p_title),
         agenda = coalesce(p_agenda, ''),
         join_url = btrim(p_join_url),
         starts_at = p_starts_at,
         duration_min = coalesce(p_duration_min, duration_min)
   where id = p_meeting
   returning * into m;
  return m;
end;
$$;

create or replace function public.cancel_meeting(p_meeting uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if not found or not public.meeting_can_see(m) then
    raise exception 'That meeting is gone, or you are no longer in it.' using errcode = 'no_data_found';
  end if;
  if m.scope in ('project', 'project_team')
     and public.is_general_member(m.project_id) and not public.general_can_write(m.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.meeting_can_manage(m) then
    raise exception 'Only whoever scheduled this meeting, or whoever leads its audience, can cancel it.'
      using errcode = 'insufficient_privilege';
  end if;
  update public.meetings set cancelled_at = coalesce(cancelled_at, now()) where id = p_meeting;
end;
$$;

-- ---------------------------------------------------------------- discussions

-- Stakeholders are not in the discussion: they neither read nor write it.
-- Every read policy and both write funnels take general_can_write where they
-- took is_general_member (general-discussions.sql, discussion-polls-voice.sql).

drop policy if exists general_discussion_folders_read on public.general_discussion_folders;
create policy general_discussion_folders_read on public.general_discussion_folders
  for select using (public.general_can_write(project_id));

-- A trashed discussion is seen only by whoever trashed it, in their Trash.
drop policy if exists general_discussions_read on public.general_discussions;
create policy general_discussions_read on public.general_discussions
  for select using (
    public.general_can_write(project_id)
    and (trashed_at is null or trashed_by = auth.uid())
  );

drop policy if exists general_discussion_messages_read on public.general_discussion_messages;
create policy general_discussion_messages_read on public.general_discussion_messages
  for select using (public.general_can_write(project_id));

drop policy if exists general_discussion_polls_read on public.general_discussion_polls;
create policy general_discussion_polls_read on public.general_discussion_polls
  for select using (public.general_can_write(project_id));

drop policy if exists general_discussion_poll_options_read on public.general_discussion_poll_options;
create policy general_discussion_poll_options_read on public.general_discussion_poll_options
  for select using (public.general_can_write(project_id));

drop policy if exists general_discussion_poll_votes_read on public.general_discussion_poll_votes;
create policy general_discussion_poll_votes_read on public.general_discussion_poll_votes
  for select using (public.general_can_write(project_id));

drop policy if exists general_discussion_files_read on public.general_discussion_files;
create policy general_discussion_files_read on public.general_discussion_files
  for select using (public.general_can_write(project_id));

-- Recordings and files sent in a discussion (storage policies discussion_voice_read
-- and discussion_files_read read through this).
create or replace function public.discussion_voice_readable(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := storage.foldername(p_name);
begin
  if coalesce(array_length(parts, 1), 0) < 1 or parts[1] !~ '^[0-9a-f-]{36}$' then
    return false;
  end if;
  return public.general_can_write(parts[1]::uuid);
end;
$$;

/** The project and discussion a voice path names, when it names live ones the caller is on. */
create or replace function public.discussion_voice_path_ok(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := storage.foldername(p_name);
begin
  if coalesce(array_length(parts, 1), 0) <> 2
     or parts[1] !~ '^[0-9a-f-]{36}$' or parts[2] !~ '^[0-9a-f-]{36}$' then
    return false;
  end if;
  return public.general_viewer_active()
     and public.general_can_write(parts[1]::uuid)
     and exists (select 1 from public.general_discussions d
                  where d.id = parts[2]::uuid and d.project_id = parts[1]::uuid
                    and d.ended_at is null and d.trashed_at is null);
end;
$$;

-- Every discussion RPC (start, send, edit, polls, folders, trash) passes here.
-- A stakeholder is told they are not on it, as for the discussion they are.
create or replace function public.general_discussion_check(p_project uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  board uuid;
begin
  if not public.general_viewer_active() or not public.general_can_write(p_project) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  select class_board_id into board from public.general_projects where id = p_project;
  if board is not null and public.class_board_frozen(board) then
    raise exception 'This project is handed in or closed, so its discussions cannot change.'
      using errcode = 'check_violation';
  end if;
end;
$$;

-- A new discussion notifies everyone in it, so not the stakeholders.
create or replace function public.notify_discussion_started()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  label    text;
  board    public.project_boards%rowtype;
  cls_proj public.projects%rowtype;
begin
  select name into label from public.general_projects where id = new.project_id;
  if label is null then return new; end if;
  select b.* into board from public.project_boards b
    join public.general_projects gp on gp.class_board_id = b.id
   where gp.id = new.project_id;
  if board.id is not null then
    select * into cls_proj from public.projects where id = board.project_id;
    label := cls_proj.title;
  end if;

  insert into public.notifications (user_id, type, general_project_id, class_id, project_id, title, preview)
  select m.user_id, 'discussion_started',
         case when board.id is null then new.project_id end,
         cls_proj.class_id, cls_proj.id, new.topic,
         public.display_name(new.started_by) || ' started a discussion in ' || label
    from public.general_members m
    join public.notification_prefs np on np.user_id = m.user_id
   where m.project_id = new.project_id
     and m.user_id is distinct from new.started_by
     and m.role <> 'stakeholder'
     and np.project_updates;
  return new;
end;
$$;

-- ---------------------------------------------------------------- project chat

-- Stakeholders are not in the project chat. Joining as one adds no chat row;
-- becoming one removes it; leaving the role puts it back; leaving the project
-- removes it, as before (general-notify.sql).
create or replace function public.sync_general_conversation_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.role = 'stakeholder' then
      return new;
    end if;
    insert into public.conversation_members (conversation_id, user_id)
    select c.id, new.user_id
      from public.conversations c
     where c.kind = 'project' and c.general_project_id = new.project_id
    on conflict do nothing;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.role is not distinct from old.role then
      return new;
    end if;
    if new.role = 'stakeholder' then
      delete from public.conversation_members cm
       using public.conversations c
       where c.id = cm.conversation_id
         and c.kind = 'project'
         and c.general_project_id = new.project_id
         and cm.user_id = new.user_id;
    elsif old.role = 'stakeholder' then
      insert into public.conversation_members (conversation_id, user_id)
      select c.id, new.user_id
        from public.conversations c
       where c.kind = 'project' and c.general_project_id = new.project_id
      on conflict do nothing;
    end if;
    return new;
  end if;

  delete from public.conversation_members cm
   using public.conversations c
   where c.id = cm.conversation_id
     and c.kind = 'project'
     and c.general_project_id = old.project_id
     and cm.user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists general_members_conversation on public.general_members;
create trigger general_members_conversation after insert or update of role or delete on public.general_members
  for each row execute function public.sync_general_conversation_member();

-- Stakeholders already in a project chat (general-notify.sql's backfill puts
-- every member back in when it is re-run).
delete from public.conversation_members cm
 using public.conversations c, public.general_members m
 where c.id = cm.conversation_id
   and c.kind = 'project'
   and m.project_id = c.general_project_id
   and m.user_id = cm.user_id
   and m.role = 'stakeholder';

-- ---------------------------------------------------------------- spaces

-- Joining a work project adds you to its space as a plain member, unless you
-- join as a stakeholder: space membership would let them schedule space
-- meetings and add shared templates, and they need only the project. Someone
-- already in the space keeps their level, and becoming a stakeholder later
-- leaves space membership as it is.
create or replace function public.add_general_member_to_space()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'stakeholder' then
    return null;
  end if;
  insert into public.general_space_members (space_id, user_id, level)
  select p.space_id, new.user_id, 'member'
    from public.general_projects p
    join public.general_spaces s on s.id = p.space_id
   where p.id = new.project_id
     and p.class_board_id is null
     and s.kind = 'work'
  on conflict do nothing;
  return null;
end;
$$;

-- ---------------------------------------------------------------- the role, on

-- project-roles.sql's set_general_member_role, as live, with stakeholder
-- allowed: the pm sets it on anyone but themself, a coordinator switches
-- people between member and stakeholder. QA stays refused until phase 4.
-- Leaving member deletes grants and withdraws requests (below), and
-- general_members_leader_clear clears a team they led (project-team-leads.sql).
create or replace function public.set_general_member_role(
  p_project uuid,
  p_user    uuid,
  p_role    public.general_role
) returns void language plpgsql security definer set search_path = public as $$
declare
  me     public.general_role;
  target public.general_members%rowtype;
begin
  if p_role = 'qa' then
    raise exception 'QA and stakeholder roles are not available yet.'
      using errcode = 'check_violation';
  end if;
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
end;
$$;

-- project-roles.sql's invite_to_general_project, as live, with stakeholder
-- allowed: the pm invites as member, coordinator or stakeholder, a coordinator
-- as member or stakeholder. Accepting, or joining by code with the invitation
-- pending, gives the invitation's role (respond_general_invitation,
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
  if p_role = 'qa' then
    raise exception 'QA and stakeholder roles are not available yet.'
      using errcode = 'check_violation';
  end if;
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

  insert into public.general_invitations (project_id, invitee, invited_by, role)
  values (p_project, p_user, auth.uid(), p_role)
  returning * into inv;
  return inv;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.general_can_write(uuid) from public, anon;
grant execute on function public.general_can_write(uuid) to authenticated;

commit;
