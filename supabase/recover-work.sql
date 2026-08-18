-- Collabify — rebuild a student's lost claims from the audit trail.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/recover-work.sql

begin;

/**
 * What a student held before their claims were dropped, read back out of
 * task_events. The archive covers anyone removed from now on; this covers the
 * ones removed before it existed, and any other way a claim went missing.
 *
 * A task counts if the trail shows them claiming or being assigned it, it is
 * still on a board of a group they are in now, and nobody has it recorded
 * against them today.
 */
create or replace function public.recoverable_work(p_class uuid, p_student uuid)
returns table (task_id uuid, group_id uuid) language sql stable
security definer set search_path = public as $$
  select distinct t.id, b.group_id
    from public.task_events e
    join public.project_tasks t on t.id = e.task_id
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
   where e.actor_id = p_student
     and e.kind in ('claimed', 'assigned')
     and p.class_id = p_class
     and not exists (
       select 1 from public.task_assignees a
        where a.task_id = t.id and a.student_id = p_student
     );
$$;

create or replace function public.recoverable_work_count(p_class uuid, p_student uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when public.is_class_professor(p_class)
    then (select count(*)::int from public.recoverable_work(p_class, p_student))
    else 0 end;
$$;

/**
 * Puts the work back. The group comes first — a claim on a board they are not
 * on would be a lie — and is taken from the same trail when they are no longer
 * placed anywhere. Anything since deleted or filled is skipped.
 */
create or replace function public.recover_member_work(p_class uuid, p_student uuid)
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
     where class_id = p_class and student_id = p_student and status = 'active'
  ) then
    return jsonb_build_object('result', 'not_a_member');
  end if;

  perform set_config('collabify.restoring', 'on', true);

  insert into public.group_members (group_id, set_id, student_id)
  select distinct g.id, g.set_id, p_student
    from public.recoverable_work(p_class, p_student) w
    join public.groups g on g.id = w.group_id
   where not exists (
     select 1 from public.group_members m
      where m.set_id = g.set_id and m.student_id = p_student
   )
     and (select count(*) from public.group_members m where m.group_id = g.id) < g.member_limit
  on conflict do nothing;
  get diagnostics groups_back = row_count;

  insert into public.task_assignees (task_id, student_id, claimed_by)
  select w.task_id, p_student, p_student
    from public.recoverable_work(p_class, p_student) w
    join public.project_tasks t on t.id = w.task_id
    join public.project_boards b on b.id = t.board_id
   where exists (
     select 1 from public.group_members m
      where m.group_id = b.group_id and m.student_id = p_student
   )
  on conflict do nothing;
  get diagnostics tasks_back = row_count;

  perform set_config('collabify.restoring', '', true);

  return jsonb_build_object(
    'result', 'recovered', 'groups', groups_back, 'tasks', tasks_back
  );
end;
$$;

revoke all on function public.recover_member_work(uuid, uuid) from public;
grant execute on function public.recover_member_work(uuid, uuid) to authenticated;
grant execute on function public.recoverable_work_count(uuid, uuid) to authenticated;

-- Restoring falls back to the trail when there is no archive to replay, so a
-- student removed before the archive existed still comes back whole.
create or replace function public.restore_class_member(p_class uuid, p_student uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  groups_back int := 0;
  tasks_back  int := 0;
  archived    int;
  fallback    jsonb;
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

  select count(*) into archived from public.class_member_archive
   where class_id = p_class and student_id = p_student;

  update public.class_members
     set status = 'active', removed_at = null, removed_by = null
   where class_id = p_class and student_id = p_student;

  perform set_config('collabify.restoring', 'on', true);

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
     and exists (
       select 1 from public.group_members m
        where m.group_id = b.group_id and m.student_id = p_student
     )
  on conflict do nothing;
  get diagnostics tasks_back = row_count;

  perform set_config('collabify.restoring', '', true);

  delete from public.class_member_archive
   where class_id = p_class and student_id = p_student;

  if archived = 0 then
    fallback := public.recover_member_work(p_class, p_student);
    groups_back := groups_back + coalesce((fallback->>'groups')::int, 0);
    tasks_back := tasks_back + coalesce((fallback->>'tasks')::int, 0);
  end if;

  return jsonb_build_object(
    'result', 'restored', 'groups', groups_back, 'tasks', tasks_back
  );
end;
$$;

revoke all on function public.restore_class_member(uuid, uuid) from public;
grant execute on function public.restore_class_member(uuid, uuid) to authenticated;

commit;
