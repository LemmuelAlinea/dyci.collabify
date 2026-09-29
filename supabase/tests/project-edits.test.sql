-- Editing a class project: every field the edit form saves, and who does it.
-- Rolls back.
--
--   node scripts/db.mjs supabase/tests/project-edits.test.sql

begin;

create or replace function pg_temp.act_as(p uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.svc() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.ok(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_true, false) then raise notice 'PASS  %', p_label;
  else raise notice 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  v_class uuid; v_other uuid; v_prof uuid; v_a uuid; v_b uuid; v_c uuid;
  v_set_a uuid; v_set_b uuid; v_set_x uuid; v_ga uuid; v_gb uuid; v_proj uuid;
  p public.projects%rowtype; refused boolean; v_due timestamptz := now() + interval '10 days';
begin
  select c.id, c.professor_id into v_class, v_prof from public.classes c
   where (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 3
     and c.syllabus_id is not null
   order by c.created_at limit 1;
  select id into v_other from public.classes where id <> v_class order by created_at limit 1;
  select student_id into v_a from public.class_members where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;
  select student_id into v_c from public.class_members where class_id = v_class and status = 'active' and student_id not in (v_a, v_b) order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-edit A', 'manual') returning id into v_set_a;
  insert into public.groups (set_id, name) values (v_set_a, 'A1') returning id into v_ga;
  insert into public.group_members (group_id, set_id, student_id) values (v_ga, v_set_a, v_a), (v_ga, v_set_a, v_b);
  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-edit B', 'manual') returning id into v_set_b;
  insert into public.groups (set_id, name) values (v_set_b, 'B1') returning id into v_gb;
  insert into public.group_members (group_id, set_id, student_id) values (v_gb, v_set_b, v_c);
  insert into public.group_sets (class_id, name, mode) values (v_other, 'zz-edit X', 'manual') returning id into v_set_x;

  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, due_at, guidelines)
  values (v_class, v_prof, 'Edit me', 'activity', 1, 1, 'individual', v_due, 'Old brief')
  returning id into v_proj;
  perform pg_temp.ok('an individual project starts with a board per student',
    (select count(*) from public.project_boards where project_id = v_proj and student_id is not null)
      = (select count(*) from public.class_members where class_id = v_class and status = 'active')
    and not exists (select 1 from public.project_boards where project_id = v_proj and group_id is not null));

  ------------------------------------------------------------------ the shared fields
  perform pg_temp.act_as(v_prof);
  perform public.update_project_series(array[v_proj], 'Edited title', 'other', 'Case study', 'New brief',
    1, 1, 80, v_due + interval '1 day', null,
    '[{"label": "Accuracy", "description": "Right answers", "max_points": 60}, {"label": "Clarity", "max_points": 20}]'::jsonb);
  perform pg_temp.svc();
  select * into p from public.projects where id = v_proj;
  perform pg_temp.ok('title, type and its label save', p.title = 'Edited title' and p.type = 'other' and p.type_label = 'Case study');
  perform pg_temp.ok('the brief saves', p.guidelines = 'New brief');
  perform pg_temp.ok('points and deadline save', p.total_points = 80 and p.due_at = v_due + interval '1 day');
  perform pg_temp.ok('the rubric is replaced',
    (select string_agg(label || ':' || max_points, ',' order by position) from public.project_criteria where project_id = v_proj)
      = 'Accuracy:60,Clarity:20');

  ------------------------------------------------------------------ who does it
  perform pg_temp.act_as(v_prof);
  perform public.set_project_audience(v_proj, 'group', v_set_a);
  perform pg_temp.svc();
  select * into p from public.projects where id = v_proj;
  perform pg_temp.ok('individual becomes group, with the set picked', p.audience = 'group' and p.group_set_id = v_set_a);
  perform pg_temp.ok('...and its boards become one per group of that set, the student boards gone',
    (select count(*) from public.project_boards where project_id = v_proj) = 1
    and exists (select 1 from public.project_boards where project_id = v_proj and group_id = v_ga));

  perform pg_temp.act_as(v_prof);
  perform public.set_project_audience(v_proj, 'group', v_set_b);
  perform pg_temp.svc();
  perform pg_temp.ok('switching to another set moves the boards to its groups',
    (select group_set_id from public.projects where id = v_proj) = v_set_b
    and (select array_agg(group_id) from public.project_boards where project_id = v_proj) = array[v_gb]);

  perform pg_temp.act_as(v_prof);
  perform public.set_project_audience(v_proj, 'group', v_set_b);
  perform pg_temp.svc();
  perform pg_temp.ok('saving the same arrangement changes nothing',
    (select array_agg(group_id) from public.project_boards where project_id = v_proj) = array[v_gb]);

  perform pg_temp.act_as(v_prof);
  perform public.set_project_audience(v_proj, 'individual', null);
  perform pg_temp.svc();
  perform pg_temp.ok('group goes back to individual, a board per student again',
    (select audience::text from public.projects where id = v_proj) = 'individual'
    and (select group_set_id from public.projects where id = v_proj) is null
    and not exists (select 1 from public.project_boards where project_id = v_proj and group_id is not null)
    and exists (select 1 from public.project_boards where project_id = v_proj and student_id = v_a));

  ------------------------------------------------------------------ refusals
  perform pg_temp.act_as(v_prof);
  begin
    perform public.set_project_audience(v_proj, 'group', null);
    refused := false;
  exception when invalid_parameter_value then refused := true;
  end;
  perform pg_temp.ok('group with no set is refused', refused);

  begin
    perform public.set_project_audience(v_proj, 'group', v_set_x);
    refused := false;
  exception when others then refused := sqlerrm like '%different class%';
  end;
  perform pg_temp.ok('a set from another class is refused', refused);
  perform pg_temp.svc();
  perform pg_temp.ok('...and the project is left as it was',
    (select audience::text from public.projects where id = v_proj) = 'individual'
    and exists (select 1 from public.project_boards where project_id = v_proj and student_id = v_a));

  perform pg_temp.act_as(v_a);
  begin
    perform public.set_project_audience(v_proj, 'group', v_set_a);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('a student cannot change it', refused);

  perform pg_temp.svc();
  insert into public.project_tasks (board_id, title, created_by, author_role)
  select b.id, 'Started', v_a, 'student' from public.project_boards b
   where b.project_id = v_proj and b.student_id = v_a;
  perform pg_temp.act_as(v_prof);
  begin
    perform public.set_project_audience(v_proj, 'group', v_set_a);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('once a student has started, who does it can no longer change', refused);
  perform pg_temp.svc();
  perform pg_temp.ok('...and the started work is still there',
    exists (select 1 from public.project_tasks t join public.project_boards b on b.id = t.board_id
             where b.project_id = v_proj and t.title = 'Started'));
end;
$$;

rollback;
