-- Collabify — removing a student keeps their work, so putting them back restores it.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/class-restore.sql

begin;

-- Removing a student deletes their group placement, and that cascades into
-- their task claims. Both are recorded here first, so a restore is a replay
-- rather than a guess.
create table if not exists public.class_member_archive (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes (id) on delete cascade,
  student_id  uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('group', 'task')),
  ref_id      uuid not null,
  set_id      uuid,
  archived_at timestamptz not null default now()
);

create unique index if not exists class_member_archive_key
  on public.class_member_archive (class_id, student_id, kind, ref_id);

alter table public.class_member_archive enable row level security;

drop policy if exists class_member_archive_read on public.class_member_archive;
create policy class_member_archive_read on public.class_member_archive
  for select using (public.is_class_professor(class_id));

/**
 * Write down what they held, then let the existing removal take it away. The
 * order matters: task claims disappear with the group membership, so both are
 * captured before either is touched.
 */
create or replace function public.drop_group_memberships_on_class_removal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'removed' and old.status is distinct from 'removed' then
    insert into public.class_member_archive (class_id, student_id, kind, ref_id, set_id)
    select new.class_id, new.student_id, 'task', a.task_id, null
      from public.task_assignees a
      join public.project_tasks t on t.id = a.task_id
      join public.project_boards b on b.id = t.board_id
      join public.projects p on p.id = b.project_id
     where a.student_id = new.student_id and p.class_id = new.class_id
    on conflict do nothing;

    insert into public.class_member_archive (class_id, student_id, kind, ref_id, set_id)
    select new.class_id, new.student_id, 'group', gm.group_id, gm.set_id
      from public.group_members gm
      join public.group_sets s on s.id = gm.set_id
     where s.class_id = new.class_id and gm.student_id = new.student_id
    on conflict do nothing;

    delete from public.group_members gm
      using public.group_sets s
     where gm.set_id = s.id
       and s.class_id = new.class_id
       and gm.student_id = new.student_id;
  end if;
  return new;
end;
$$;

drop trigger if exists class_members_drop_groups on public.class_members;
create trigger class_members_drop_groups after update on public.class_members
  for each row execute function public.drop_group_memberships_on_class_removal();

-- A restore is the app acting for the student, not a professor assigning work,
-- so the claim guard is told to stand aside — the same escape hatch the group
-- release path uses.
create or replace function public.guard_task_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  board uuid := public.task_board(new.task_id);
  cap   numeric;
  held  numeric;
begin
  if auth.uid() is null
     or coalesce(current_setting('collabify.restoring', true), '') = 'on' then
    return new; -- service role, or a removed student being put back
  end if;

  if public.is_board_professor(board) and not public.is_board_member(board) then
    raise exception 'A professor does not assign tasks — the group claims them';
  end if;

  if not public.is_board_member(board) then
    raise exception 'Only this board can claim its tasks';
  end if;

  if not exists (
    select 1 from public.project_boards b
     where b.id = board
       and (
         b.student_id = new.student_id
         or exists (
           select 1 from public.group_members m
            where m.group_id = b.group_id and m.student_id = new.student_id
         )
       )
  ) then
    raise exception 'That student is not on this board';
  end if;

  cap := public.board_member_cap(board);
  if cap > 0 then
    held := public.board_member_held(board, new.student_id);
    if held >= cap then
      raise exception
        'That is already a full share of this project — % of the % each member carries. Hand something back first, or leave this one for a groupmate.',
        round(held, 1), round(cap, 1)
        using errcode = 'check_violation';
    end if;
  end if;

  new.claimed_by := coalesce(new.claimed_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists task_assignees_guard on public.task_assignees;
create trigger task_assignees_guard before insert on public.task_assignees
  for each row execute function public.guard_task_assignee();

/**
 * Puts a removed student back with what they had: their group in every set that
 * still exists, and the tasks they still hold. A group that has since been
 * deleted, closed, or filled is skipped rather than forced, and the count says
 * how much came back.
 */
create or replace function public.restore_class_member(p_class uuid, p_student uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  groups_back int := 0;
  tasks_back  int := 0;
begin
  if not public.is_class_professor(p_class) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if not exists (
    select 1 from public.class_members
     where class_id = p_class and student_id = p_student and status = 'removed'
  ) then
    return jsonb_build_object('result', 'not_removed');
  end if;

  update public.class_members
     set status = 'active', removed_at = null, removed_by = null
   where class_id = p_class and student_id = p_student;

  perform set_config('collabify.restoring', 'on', true);

  -- Only where the group is still there and still has room.
  insert into public.group_members (group_id, set_id, student_id)
  select a.ref_id, a.set_id, p_student
    from public.class_member_archive a
    join public.groups g on g.id = a.ref_id
   where a.class_id = p_class and a.student_id = p_student and a.kind = 'group'
     and (select count(*) from public.group_members m where m.group_id = g.id) < g.member_limit
  on conflict do nothing;
  get diagnostics groups_back = row_count;

  insert into public.task_assignees (task_id, student_id, claimed_by)
  select a.ref_id, p_student, p_student
    from public.class_member_archive a
    join public.project_tasks t on t.id = a.ref_id
    join public.project_boards b on b.id = t.board_id
   where a.class_id = p_class and a.student_id = p_student and a.kind = 'task'
     -- The board has to be theirs again, or the claim would be a lie.
     and exists (
       select 1 from public.group_members m
        where m.group_id = b.group_id and m.student_id = p_student
     )
  on conflict do nothing;
  get diagnostics tasks_back = row_count;

  perform set_config('collabify.restoring', '', true);

  delete from public.class_member_archive
   where class_id = p_class and student_id = p_student;

  return jsonb_build_object(
    'result', 'restored', 'groups', groups_back, 'tasks', tasks_back
  );
end;
$$;

revoke all on function public.restore_class_member(uuid, uuid) from public;
grant execute on function public.restore_class_member(uuid, uuid) to authenticated;

/** What a restore would bring back — shown before the professor commits to it. */
create or replace function public.archived_member_summary(p_class uuid, p_student uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_class_professor(p_class) then
    jsonb_build_object(
      'groups', (select count(*) from public.class_member_archive
                  where class_id = p_class and student_id = p_student and kind = 'group'),
      'tasks',  (select count(*) from public.class_member_archive
                  where class_id = p_class and student_id = p_student and kind = 'task')
    )
  else jsonb_build_object('groups', 0, 'tasks', 0) end;
$$;

commit;

-- ---------------------------------------------------------------- trail fix

-- Deleting a group cascades to its board, its tasks, and their claims. The
-- audit triggers then tried to log against a task that no longer exists, so
-- the whole delete failed on a foreign key. Nothing to log when the task is
-- going with it.

begin;

create or replace function public.log_task_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, actor_id, kind)
    values (new.task_id, coalesce(auth.uid(), new.claimed_by),
            (case when new.claimed_by = new.student_id then 'claimed' else 'assigned' end)
              ::public.task_event_kind);
    return new;
  end if;

  if exists (select 1 from public.project_tasks where id = old.task_id) then
    insert into public.task_events (task_id, actor_id, kind)
    values (old.task_id, auth.uid(), 'unclaimed');
  end if;
  return old;
end;
$$;

create or replace function public.log_task_side_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  task uuid;
  kind public.task_event_kind;
  who  uuid;
  what text := '';
begin
  if tg_op = 'DELETE' then
    task := old.task_id;
    kind := 'file_removed';
    who  := auth.uid();
    what := old.file_name;
    -- The task is being deleted too, so there is nothing left to hang this on.
    if not exists (select 1 from public.project_tasks where id = task) then
      return old;
    end if;
  elsif tg_table_name = 'task_files' then
    task := new.task_id;
    kind := 'file_added';
    who  := coalesce(auth.uid(), new.uploaded_by);
    what := new.file_name;
  elsif tg_table_name = 'task_comments' then
    task := new.task_id;
    kind := 'commented';
    who  := coalesce(auth.uid(), new.author_id);
  else
    task := new.task_id;
    kind := 'logged';
    who  := coalesce(auth.uid(), new.student_id);
    what := new.minutes || 'm';
  end if;

  insert into public.task_events (task_id, actor_id, kind, detail)
  values (task, who, kind, what);
  return coalesce(new, old);
end;
$$;

commit;
