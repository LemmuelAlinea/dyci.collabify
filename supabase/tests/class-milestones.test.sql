-- supabase/tests/class-milestones.test.sql
-- Milestones on a class project. Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/class-milestones.test.sql
begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
    return;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

-- A released group project with a milestone and two tasks tagged to it, one of
-- them archived. Returns {project, milestone, live task, archived task}.
create or replace function pg_temp.mk_tagged(
  p_class uuid, p_prof uuid, p_set uuid, p_student uuid, p_label text, p_archived boolean
) returns uuid[] language plpgsql as $$
declare v_p uuid; v_b uuid; v_m uuid; v_t uuid; v_t2 uuid;
begin
  perform pg_temp.act_as_service();
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at, release_at)
  values (p_class, p_prof, p_label, 'activity', 1, 2, 'group', p_set,
          now() + interval '30 days', now() - interval '1 day')
  returning id into v_p;
  perform public.ensure_project_boards(v_p);
  select id into v_b from public.project_boards where project_id = v_p limit 1;
  insert into public.project_milestones (project_id, name, due_on, created_by)
  values (v_p, 'Tagged', current_date + 7, p_prof) returning id into v_m;
  perform pg_temp.act_as(p_student);
  insert into public.project_tasks (board_id, title, weight, created_by, milestone_id)
  values (v_b, 'Live tagged', 10, p_student, v_m) returning id into v_t;
  insert into public.project_tasks (board_id, title, weight, created_by, milestone_id)
  values (v_b, 'Archived tagged', 10, p_student, v_m) returning id into v_t2;
  perform public.archive_class_task(v_t2, true);
  perform pg_temp.act_as_service();
  if p_archived then
    update public.projects set archived_at = now() where id = v_p;
  end if;
  return array[v_p, v_m, v_t, v_t2];
end;
$$;

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_proj2 uuid; v_board uuid; v_board2 uuid;
  m1 uuid; m_other uuid; t1 uuid; v_origin uuid; n int;
  m2 uuid; t_live uuid; t_arch uuid; v_unrel uuid; m_hidden uuid;
  v_set2 uuid; v_group2 uuid; v_solo uuid; m_solo uuid; r uuid[];
  t_closed uuid; t_shelf uuid; m_stamp uuid;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at
   limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-cplan-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Plan group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_group, v_set, v_a), (v_group, v_set, v_b);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at, release_at)
  values (v_class, v_prof, 'zz-cplan-fixture', 'activity', 1, 2, 'group', v_set,
          now() + interval '30 days', now() - interval '1 day')
  returning id into v_proj;
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at, release_at)
  values (v_class, v_prof, 'zz-cplan-fixture-2', 'activity', 1, 2, 'group', v_set,
          now() + interval '30 days', now() - interval '1 day')
  returning id into v_proj2;
  perform public.ensure_project_boards(v_proj);
  perform public.ensure_project_boards(v_proj2);
  select id into v_board from public.project_boards where project_id = v_proj limit 1;
  select id into v_board2 from public.project_boards where project_id = v_proj2 limit 1;
  ------------------------------------------------------------ milestones
  perform pg_temp.act_as(v_prof);
  insert into public.project_milestones (project_id, name, due_on)
  values (v_proj, 'Chapter 1–3', current_date + 14) returning id into m1;
  insert into public.project_milestones (project_id, name, due_on)
  values (v_proj2, 'Other project', current_date + 14) returning id into m_other;
  perform pg_temp.must_be('the professor can set a milestone',
    exists (select 1 from public.project_milestones where id = m1));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a student in the project can read its milestones',
    exists (select 1 from public.project_milestones where id = m1));
  perform pg_temp.must_refuse('a student cannot set a milestone',
    format($q$insert into public.project_milestones (project_id, name, due_on) values (%L, 'Mine', current_date)$q$, v_proj));

  insert into public.project_tasks (board_id, title, weight, created_by)
  values (v_board, 'Draft chapter 1', 10, v_a) returning id into t1;
  update public.project_tasks set milestone_id = m1 where id = t1;
  perform pg_temp.must_be('a student can tag their board''s task',
    (select milestone_id from public.project_tasks where id = t1) = m1);
  perform pg_temp.must_refuse('a task cannot take another project''s milestone',
    format('update public.project_tasks set milestone_id = %L where id = %L', m_other, t1));
  perform pg_temp.must_be('the detail view carries the milestone',
    (select milestone_id = m1 from public.task_detail_overview where id = t1));

  perform pg_temp.must_refuse('a new task cannot already carry another project''s milestone',
    format($q$insert into public.project_tasks (board_id, title, weight, created_by, milestone_id)
              values (%L, 'Foreign tag', 10, %L, %L)$q$, v_board, v_a, m_other));

  -- the professor tags every copy of a task they set
  perform pg_temp.act_as(v_prof);
  select (public.create_professor_task(v_proj, 'Outline', '', 10, null, null, false) ->> 'origin_id')::uuid
    into v_origin;
  -- The RPC runs in its own statement: called inside the assertion's query, the
  -- check would read the rows as they were before the update.
  n := public.set_professor_task_milestone(v_origin, m1);
  perform pg_temp.must_be('setting a milestone on a set task reaches its copies',
    n >= 1
    and not exists (select 1 from public.project_tasks where origin_id = v_origin and milestone_id is distinct from m1));
  perform pg_temp.must_refuse('a set task cannot take another project''s milestone',
    format('select public.set_professor_task_milestone(%L, %L)', v_origin, m_other));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot tag every copy',
    format('select public.set_professor_task_milestone(%L, null)', v_origin));

  ------------------------------------------------------------ when a board is closed to its students
  -- Each refusal has a control: the same tag goes through while the board is open.
  perform pg_temp.act_as(v_a);
  insert into public.project_tasks (board_id, title, weight, created_by)
  values (v_board, 'Closed-board task', 10, v_a) returning id into t_closed;
  insert into public.project_tasks (board_id, title, weight, created_by)
  values (v_board, 'Archived-board task', 10, v_a) returning id into t_shelf;
  update public.project_tasks set milestone_id = m1 where id = t_closed;
  perform pg_temp.must_be('control: a student can tag a task while the board is open',
    (select milestone_id = m1 from public.project_tasks where id = t_closed));
  update public.project_tasks set milestone_id = null where id = t_closed;

  perform public.set_board_submitted(v_board, true);
  perform pg_temp.must_refuse('a student cannot tag a task on a handed-in board',
    format('update public.project_tasks set milestone_id = %L where id = %L', m1, t_closed));
  perform public.set_board_submitted(v_board, false);

  perform pg_temp.act_as_service();
  update public.projects set locked_at = now() where id = v_proj;
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot tag a task on a locked project',
    format('update public.project_tasks set milestone_id = %L where id = %L', m1, t_closed));
  perform pg_temp.act_as_service();
  update public.projects set locked_at = null where id = v_proj;

  perform pg_temp.act_as(v_a);
  perform public.archive_class_task(t_shelf, true);
  -- Archived tasks are hidden from a student's reads, so the update finds no
  -- row and changes nothing rather than raising.
  update public.project_tasks set milestone_id = m1 where id = t_shelf;
  get diagnostics n = row_count;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a student cannot tag an archived task',
    n = 0 and (select milestone_id is null and archived_at is not null from public.project_tasks where id = t_shelf));
  perform pg_temp.act_as(v_a);
  perform public.archive_class_task(t_shelf, false);
  update public.project_tasks set milestone_id = m1 where id = t_shelf;
  perform pg_temp.must_be('control: the same task takes the tag once restored',
    (select milestone_id = m1 from public.project_tasks where id = t_shelf));

  ------------------------------------------------------------ the bookkeeping columns
  perform pg_temp.act_as(v_prof);
  insert into public.project_milestones (project_id, name, due_on, created_by, created_at)
  values (v_proj, 'Stamped', current_date + 9, v_a, '2000-01-01') returning id into m_stamp;
  perform pg_temp.must_be('a new milestone takes its creator and time from the server',
    (select created_by = v_prof and abs(extract(epoch from now() - created_at)) < 60
       from public.project_milestones where id = m_stamp));
  update public.project_milestones set created_by = v_a, created_at = '2000-01-01' where id = m_stamp;
  perform pg_temp.must_be('an edit cannot change who made a milestone or when',
    (select created_by = v_prof and created_at > '2001-01-01'
       from public.project_milestones where id = m_stamp));

  -- deleting a milestone untags its tasks
  perform pg_temp.act_as(v_prof);
  delete from public.project_milestones where id = m1;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('deleting a milestone untags its tasks',
    not exists (select 1 from public.project_tasks where milestone_id = m1));

  ------------------------------------------------------------ deleting with archived tasks
  perform pg_temp.act_as_service();
  insert into public.project_milestones (project_id, name, due_on, created_by)
  values (v_proj, 'To delete', current_date + 3, v_prof) returning id into m2;
  perform pg_temp.act_as(v_a);
  insert into public.project_tasks (board_id, title, weight, created_by, milestone_id)
  values (v_board, 'Live tagged', 10, v_a, m2) returning id into t_live;
  insert into public.project_tasks (board_id, title, weight, created_by, milestone_id)
  values (v_board, 'Archived tagged', 10, v_a, m2) returning id into t_arch;
  perform public.archive_class_task(t_arch, true);

  perform pg_temp.act_as(v_prof);
  delete from public.project_milestones where id = m2;
  get diagnostics n = row_count;
  set constraints project_tasks_milestone_fk immediate;
  perform pg_temp.must_be('the professor can delete a milestone that holds live and archived tasks', n = 1);
  set constraints project_tasks_milestone_fk deferred;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('both the live and the archived task are untagged',
    (select count(*) from public.project_tasks where id in (t_live, t_arch) and milestone_id is null) = 2);
  perform pg_temp.must_be('the archived task stays archived',
    (select archived_at is not null from public.project_tasks where id = t_arch));

  ------------------------------------------------------------ who can read them
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at, release_at)
  values (v_class, v_prof, 'zz-cplan-fixture-unreleased', 'activity', 1, 2, 'group', v_set,
          now() + interval '30 days', now() + interval '10 days')
  returning id into v_unrel;
  insert into public.project_milestones (project_id, name, due_on, created_by)
  values (v_unrel, 'Hidden', current_date + 20, v_prof) returning id into m_hidden;
  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-cms-solo', 'manual') returning id into v_set2;
  insert into public.groups (set_id, name) values (v_set2, 'Solo group') returning id into v_group2;
  insert into public.group_members (group_id, set_id, student_id) values (v_group2, v_set2, v_a);
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at, release_at)
  values (v_class, v_prof, 'zz-cplan-fixture-solo', 'activity', 1, 2, 'group', v_set2,
          now() + interval '30 days', now() - interval '1 day')
  returning id into v_solo;
  insert into public.project_milestones (project_id, name, due_on, created_by)
  values (v_solo, 'Solo', current_date + 20, v_prof) returning id into m_solo;

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a student cannot read the milestones of a project not yet released',
    not exists (select 1 from public.project_milestones where id = m_hidden));
  perform pg_temp.must_be('a student in the group set reads its milestones',
    exists (select 1 from public.project_milestones where id = m_solo));
  perform pg_temp.act_as(v_b);
  perform pg_temp.must_be('a student outside the group set cannot read its milestones',
    not exists (select 1 from public.project_milestones where id = m_solo));
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('the professor reads the milestones of an unreleased project',
    exists (select 1 from public.project_milestones where id = m_hidden));

  ------------------------------------------------------------ fixed project
  -- A professor's write that names another project is quietly pinned back.
  update public.project_milestones set name = 'Renamed', project_id = v_proj2 where id = m_hidden;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('an edit that names another project leaves the milestone where it was',
    (select project_id = v_unrel and name = 'Renamed' from public.project_milestones where id = m_hidden));

  ------------------------------------------------------------ deleting a whole project
  -- The service role, with the cascade in its usual order.
  r := pg_temp.mk_tagged(v_class, v_prof, v_set, v_a, 'zz-cms-del-service', false);
  set constraints project_tasks_milestone_fk deferred;
  delete from public.projects where id = r[1];
  set constraints project_tasks_milestone_fk immediate;
  perform pg_temp.must_be('the service role can delete a project holding tagged tasks',
    not exists (select 1 from public.projects where id = r[1])
    and not exists (select 1 from public.project_milestones where id = r[2])
    and not exists (select 1 from public.project_tasks where id in (r[3], r[4])));
  set constraints project_tasks_milestone_fk deferred;

  -- Now make the milestone cascade run before the board cascade, the order that
  -- an update of still-existing tasks would trip over.
  alter table public.project_boards drop constraint project_boards_project_id_fkey;
  alter table public.project_boards add constraint project_boards_project_id_fkey
    foreign key (project_id) references public.projects (id) on delete cascade;

  r := pg_temp.mk_tagged(v_class, v_prof, v_set, v_a, 'zz-cms-del-service-2', false);
  delete from public.projects where id = r[1];
  set constraints project_tasks_milestone_fk immediate;
  perform pg_temp.must_be('the service role can delete it when the milestones cascade first',
    not exists (select 1 from public.projects where id = r[1])
    and not exists (select 1 from public.project_tasks where id in (r[3], r[4])));
  set constraints project_tasks_milestone_fk deferred;

  r := pg_temp.mk_tagged(v_class, v_prof, v_set, v_a, 'zz-cms-del-prof', false);
  perform pg_temp.act_as(v_prof);
  delete from public.projects where id = r[1];
  get diagnostics n = row_count;
  set constraints project_tasks_milestone_fk immediate;
  perform pg_temp.must_be('the professor can delete a project holding tagged tasks', n = 1);
  set constraints project_tasks_milestone_fk deferred;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('and its milestones and tasks went with it',
    not exists (select 1 from public.project_milestones where id = r[2])
    and not exists (select 1 from public.project_tasks where id in (r[3], r[4])));

  r := pg_temp.mk_tagged(v_class, v_prof, v_set, v_a, 'zz-cms-del-trash', true);
  perform pg_temp.act_as(v_prof);
  perform public.trash_archived_item('class_project', r[1]);
  perform public.delete_trashed_item('class_project', r[1]);
  set constraints project_tasks_milestone_fk immediate;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('an archived project deleted from Trash takes its tagged tasks with it',
    not exists (select 1 from public.projects where id = r[1])
    and not exists (select 1 from public.project_milestones where id = r[2])
    and not exists (select 1 from public.project_tasks where id in (r[3], r[4])));
end $$;

rollback;
