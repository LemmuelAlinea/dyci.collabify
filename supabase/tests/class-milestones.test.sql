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

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_proj2 uuid; v_board uuid; v_board2 uuid;
  m1 uuid; m_other uuid; t1 uuid; v_origin uuid; n int;
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

  -- deleting a milestone untags its tasks
  perform pg_temp.act_as(v_prof);
  delete from public.project_milestones where id = m1;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('deleting a milestone untags its tasks',
    not exists (select 1 from public.project_tasks where milestone_id = m1));
end $$;

rollback;
