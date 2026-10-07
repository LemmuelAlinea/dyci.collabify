-- supabase/tests/sprint-milestones.test.sql
-- A sprint counting toward a milestone, in both spaces. Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/sprint-milestones.test.sql
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

-------------------------------------------------------------------- work
do $$
declare
  v_ids uuid[] := array[gen_random_uuid(), gen_random_uuid()];
  v_names text[] := array['Owner', 'Member'];
  i int; a uuid; b uuid; p uuid; p2 uuid; v_inv uuid;
  m uuid; m2 uuid; m_other uuid; s uuid; s2 uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; n int;
begin
  for i in 1..2 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_user_meta_data, created_at, updated_at)
    values (v_ids[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-smile-' || lower(v_names[i]) || '@example.test', '',
            jsonb_build_object('first_name', 'Zzsmile', 'last_name', v_names[i], 'role', 'professor'),
            now(), now());
  end loop;
  update public.profiles set status = 'active'
   where id = any (v_ids) and role = 'faculty' and status = 'pending';
  a := v_ids[1]; b := v_ids[2];

  perform pg_temp.act_as(a);
  p := (public.create_general_project('Zz sprint milestone')).id;
  select id into v_inv from public.invite_to_general_project(p, b);
  perform pg_temp.act_as(b);
  perform public.respond_general_invitation(v_inv, true);
  perform pg_temp.act_as(a);
  p2 := (public.create_general_project('Zz sprint milestone other')).id;

  insert into public.general_milestones (project_id, name, due_on) values (p, 'Prototype', current_date + 20) returning id into m;
  insert into public.general_milestones (project_id, name, due_on) values (p, 'Other', current_date + 30) returning id into m2;
  insert into public.general_milestones (project_id, name, due_on) values (p2, 'Elsewhere', current_date + 30) returning id into m_other;
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Sprint 1', current_date, current_date + 13) returning id into s;
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Sprint 2', current_date + 14, current_date + 27) returning id into s2;

  insert into public.general_tasks (project_id, title, sprint_id) values (p, 'Open', s) returning id into t1;
  insert into public.general_tasks (project_id, title, sprint_id) values (p, 'Finished', s) returning id into t2;
  update public.general_tasks set status = 'done' where id = t2;
  insert into public.general_tasks (project_id, title, sprint_id, milestone_id) values (p, 'Tagged elsewhere', s, m2) returning id into t3;
  insert into public.general_tasks (project_id, title) values (p, 'Backlog') returning id into t4;

  perform pg_temp.act_as(b);
  update public.general_sprints set milestone_id = m where id = s;
  perform pg_temp.must_be('a Member cannot add a sprint to a milestone',
    (select milestone_id is null from public.general_sprints where id = s));

  perform pg_temp.act_as(a);
  perform pg_temp.must_refuse('a sprint cannot count toward another project''s milestone',
    format('update public.general_sprints set milestone_id = %L where id = %L', m_other, s));

  update public.general_sprints set milestone_id = m where id = s;
  perform pg_temp.must_be('the Owner adds a sprint to a milestone',
    (select milestone_id = m from public.general_sprints where id = s));
  perform pg_temp.must_be('its untagged tasks, done ones too, are tagged',
    (select count(*) = 2 from public.general_tasks where id in (t1, t2) and milestone_id = m));
  perform pg_temp.must_be('a task tagged to another milestone keeps it',
    (select milestone_id = m2 from public.general_tasks where id = t3));
  perform pg_temp.must_be('a backlog task is not tagged',
    (select milestone_id is null from public.general_tasks where id = t4));

  insert into public.general_tasks (project_id, title, sprint_id) values (p, 'Joins later', s) returning id into t5;
  perform pg_temp.must_be('a task created in the sprint takes its milestone',
    (select milestone_id = m from public.general_tasks where id = t5));
  update public.general_tasks set sprint_id = s where id = t4;
  perform pg_temp.must_be('a task moved into the sprint takes its milestone',
    (select milestone_id = m from public.general_tasks where id = t4));
  update public.general_tasks set milestone_id = null where id = t4;
  perform pg_temp.must_be('a task in the sprint can still be untagged by hand',
    (select milestone_id is null from public.general_tasks where id = t4));
  update public.general_tasks set sprint_id = s2 where id = t5;
  perform pg_temp.must_be('a task leaving the sprint keeps the tag',
    (select milestone_id = m from public.general_tasks where id = t5));

  update public.general_sprints set milestone_id = null where id = s;
  perform pg_temp.must_be('taking the sprint off untags the tasks it tagged',
    (select count(*) = 0 from public.general_tasks where id in (t1, t2) and milestone_id is not null));
  perform pg_temp.must_be('and leaves the other milestone''s tag alone',
    (select milestone_id = m2 from public.general_tasks where id = t3));

  update public.general_sprints set milestone_id = m2 where id = s;
  perform pg_temp.must_be('moving the sprint to another milestone retags its tasks',
    (select count(*) = 3 from public.general_tasks where id in (t1, t2, t3) and milestone_id = m2));

  -- A finished sprint keeps its link, can lose it with the milestone, but is otherwise fixed.
  update public.general_sprints set state = 'active' where id = s;
  perform public.complete_general_sprint(s, null);
  perform pg_temp.must_be('the sprint finished',
    (select state = 'completed' from public.general_sprints where id = s));
  perform pg_temp.must_refuse('a finished sprint still cannot be renamed',
    format($q$update public.general_sprints set name = 'Renamed' where id = %L$q$, s));
  delete from public.general_milestones where id = m2;
  get diagnostics n = row_count;
  perform pg_temp.must_be('a milestone with a finished sprint on it can be deleted', n = 1);
  perform pg_temp.must_be('the finished sprint lost the link',
    (select milestone_id is null from public.general_sprints where id = s));

  insert into public.general_sprints (project_id, name, starts_on, ends_on, milestone_id)
  values (p, 'Sprint 3', current_date + 28, current_date + 41, m) returning id into s;
  insert into public.general_tasks (project_id, title, sprint_id) values (p, 'In a linked new sprint', s) returning id into t1;
  perform pg_temp.must_be('a sprint can be created already counting toward a milestone',
    (select milestone_id = m from public.general_tasks where id = t1));
end;
$$;

-------------------------------------------------------------------- class
do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_proj2 uuid; v_board uuid;
  m1 uuid; m_other uuid; s uuid; t1 uuid; t2 uuid;
begin
  perform pg_temp.act_as_service();
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
  values (v_class, 'zz-smile-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Sprint group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_group, v_set, v_a), (v_group, v_set, v_b);
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at, release_at)
  values (v_class, v_prof, 'zz-smile-fixture', 'activity', 1, 2, 'group', v_set,
          now() + interval '30 days', now() - interval '1 day')
  returning id into v_proj;
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at, release_at)
  values (v_class, v_prof, 'zz-smile-fixture-2', 'activity', 1, 2, 'group', v_set,
          now() + interval '30 days', now() - interval '1 day')
  returning id into v_proj2;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj limit 1;

  perform pg_temp.act_as(v_prof);
  insert into public.project_milestones (project_id, name, due_on)
  values (v_proj, 'Chapter 1–3', current_date + 14) returning id into m1;
  insert into public.project_milestones (project_id, name, due_on)
  values (v_proj2, 'Other project', current_date + 14) returning id into m_other;

  perform pg_temp.act_as(v_a);
  insert into public.board_sprints (board_id, name, starts_on, ends_on)
  values (v_board, 'Sprint 1', current_date, current_date + 13) returning id into s;
  insert into public.project_tasks (board_id, title, weight, created_by, sprint_id)
  values (v_board, 'Draft chapter 1', 10, v_a, s) returning id into t1;

  perform pg_temp.must_refuse('a board sprint cannot count toward another project''s milestone',
    format('update public.board_sprints set milestone_id = %L where id = %L', m_other, s));
  update public.board_sprints set milestone_id = m1 where id = s;
  perform pg_temp.must_be('a student adds their board''s sprint to the professor''s milestone',
    (select milestone_id = m1 from public.board_sprints where id = s));
  perform pg_temp.must_be('the sprint''s task is tagged',
    (select milestone_id = m1 from public.project_tasks where id = t1));
  insert into public.project_tasks (board_id, title, weight, created_by, sprint_id)
  values (v_board, 'Draft chapter 2', 10, v_a, s) returning id into t2;
  perform pg_temp.must_be('a task added to the sprint later is tagged',
    (select milestone_id = m1 from public.project_tasks where id = t2));

  perform pg_temp.act_as(v_prof);
  delete from public.project_milestones where id = m1;
  perform pg_temp.must_be('the professor can still delete the milestone',
    not exists (select 1 from public.project_milestones where id = m1));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the board sprint lost the link and its tasks the tag',
    (select milestone_id is null from public.board_sprints where id = s)
    and (select count(*) = 0 from public.project_tasks where id in (t1, t2) and milestone_id is not null));
end;
$$;

rollback;
