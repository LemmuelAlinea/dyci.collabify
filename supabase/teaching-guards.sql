-- Collabify — three holes in who may teach, restore and attach.
--
--   node scripts/db.mjs supabase/teaching-guards.sql
--
-- 1. A deactivated professor kept teaching. `classes.professor_id` was trusted
--    on its own, so an account the admin had switched off still read, edited
--    and deleted its classes and resources. Co-teachers already had to be
--    active (teaches_in_space); the class's own professor now does too.
-- 2. Putting a removed student back ignored the class's size limit, which
--    join_class enforces. A full class now says so instead of overfilling.
-- 3. Any teaching professor could point `classes.syllabus_id` at another
--    professor's private outline by its id, and every student in the class
--    could then read it. A class may only take a syllabus the caller owns or
--    one the program office published.
--
-- Runs after class-files.sql: it redefines is_class_professor
-- (one-workplace.sql), owns_resource (syllabus.sql), is_privacy_handler
-- (privacy-requests.sql), restore_class_member (class-restore.sql) and four
-- policies from classes.sql / one-workplace.sql. Re-run it after any of those.

begin;

-- ---------------------------------------------------------------- 1. active professors only

create or replace function public.is_class_professor(p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.classes c
     where c.id = p_class
       and ((c.professor_id = auth.uid() and public.general_viewer_active())
            or public.teaches_in_space(c.space_id))
  );
$$;

create or replace function public.owns_resource(p_resource uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teaching_resources
     where id = p_resource and professor_id = auth.uid()
  ) and public.general_viewer_active();
$$;

create or replace function public.is_privacy_handler()
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.privacy_handler)
      then (exists (
        select 1 from public.privacy_handler
         where professor_id = auth.uid()
      ) and public.general_viewer_active()) or public.is_admin()
    else public.is_admin()
  end;
$$;

drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes for select using (
  (professor_id = auth.uid() and public.general_viewer_active())
  or public.teaches_in_space(space_id)
  or public.is_admin()
  or (archived_at is null and public.is_active_member(id))
);

drop policy if exists classes_update on public.classes;
create policy classes_update on public.classes for update
  using ((professor_id = auth.uid() and public.general_viewer_active()) or public.teaches_in_space(space_id))
  with check ((professor_id = auth.uid() and public.general_viewer_active()) or public.teaches_in_space(space_id));

drop policy if exists classes_delete on public.classes;
create policy classes_delete on public.classes for delete
  using (professor_id = auth.uid() and public.general_viewer_active());

drop policy if exists teaching_resources_own on public.teaching_resources;
create policy teaching_resources_own on public.teaching_resources for all
  using (professor_id = auth.uid() and public.general_viewer_active())
  with check (professor_id = auth.uid() and public.general_viewer_active());

-- ---------------------------------------------------------------- 2. restoring respects the size limit

/** class-restore.sql's restore, plus the class's size limit that join_class keeps. */
create or replace function public.restore_class_member(p_class uuid, p_student uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  groups_back int := 0;
  tasks_back  int := 0;
  cap         int;
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

  -- Locked like join_class, so a restore and a join cannot both take the last seat.
  select student_cap into cap from public.classes where id = p_class for no key update;
  if cap is not null and (
       select count(*) from public.class_members
        where class_id = p_class and status = 'active'
     ) >= cap then
    return jsonb_build_object('result', 'full');
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

-- ---------------------------------------------------------------- 3. only your own syllabus, or the program's

/**
 * Watches the column, not the form: a class keeps whatever it already has, so a
 * co-teacher re-saving the class does not trip over the professor's outline.
 * Only a change is checked. The service role (auth.uid() null) is trusted.
 */
create or replace function public.guard_class_syllabus()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or new.syllabus_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.syllabus_id is not distinct from old.syllabus_id then
    return new;
  end if;
  if not exists (
    select 1 from public.teaching_resources r
     where r.id = new.syllabus_id
       and r.kind = 'syllabus'
       and (r.program_wide or r.professor_id = auth.uid())
  ) then
    raise exception 'Choose one of your own syllabi, or one the program office published.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists classes_guard_syllabus on public.classes;
create trigger classes_guard_syllabus
  before insert or update of syllabus_id on public.classes
  for each row execute function public.guard_class_syllabus();

revoke all on function public.guard_class_syllabus() from public, anon;

commit;
