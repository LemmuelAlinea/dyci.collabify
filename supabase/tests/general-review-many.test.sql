-- A change sent to several reviewers: any one of them answers it. Rolls back.
--
--   node scripts/db.mjs supabase/tests/general-review-many.test.sql

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
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_c uuid; v_out uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_board uuid;
  gp uuid; v_repo uuid; ch public.general_repo_changes%rowtype; ch2 public.general_repo_changes%rowtype;
  refused boolean;
begin
  select c.id, c.professor_id into v_class, v_prof from public.classes c
   where (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 4
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;
  select student_id into v_c from public.class_members where class_id = v_class and status = 'active' and student_id not in (v_a, v_b) order by student_id limit 1;
  select student_id into v_out from public.class_members where class_id = v_class and status = 'active' and student_id not in (v_a, v_b, v_c) order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-review', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Review group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id) values (v_group, v_set, v_a), (v_group, v_set, v_b), (v_group, v_set, v_c);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'Review lab', 'activity', 1, 1, 'group', v_set, now() + interval '7 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_group;

  perform pg_temp.act_as(v_a);
  gp := public.ensure_class_board_repo(v_board);
  perform pg_temp.svc();
  select id into v_repo from public.general_repos where project_id = gp;
  update public.notification_prefs set submissions = true where user_id in (v_b, v_c);

  ------------------------------------------------------------------ several reviewers
  perform pg_temp.act_as(v_a);
  perform public.save_general_draft_file(v_repo, 'one.md', 'added', 'text', 'First file');
  ch := public.submit_general_draft_file(v_repo, 'one.md', 'First', '', null, array[v_b, v_c]);
  perform pg_temp.ok('a change goes to two reviewers',
    ch.reviewer_ids @> array[v_b, v_c] and cardinality(ch.reviewer_ids) = 2 and ch.reviewer_id = v_b);
  perform pg_temp.svc();
  perform pg_temp.ok('both are told',
    (select count(distinct user_id) from public.notifications
      where type = 'review_requested' and user_id in (v_b, v_c) and title = 'First') = 2);

  perform pg_temp.act_as(v_c);
  perform public.answer_general_repo_change(ch.id, true, 'Looks right');
  perform pg_temp.svc();
  perform pg_temp.ok('the second reviewer answers it, and it goes into Main',
    (select status::text from public.general_repo_changes where id = ch.id) = 'applied'
    and exists (select 1 from public.general_repo_tree where repo_id = v_repo and path = 'one.md'));

  perform pg_temp.act_as(v_b);
  begin
    perform public.answer_general_repo_change(ch.id, false, 'Too late');
    refused := false;
  exception when invalid_parameter_value then refused := true;
  end;
  perform pg_temp.ok('the first answer decides; the other reviewer cannot answer again', refused);

  ------------------------------------------------------------------ one reviewer still works
  perform pg_temp.act_as(v_a);
  perform public.sync_general_draft(v_repo);
  perform public.save_general_draft_file(v_repo, 'two.md', 'added', 'text', 'Second file');
  ch2 := public.submit_general_draft_file(v_repo, 'two.md', 'Second', '', v_b);
  perform pg_temp.ok('one reviewer, the old way, still works', ch2.reviewer_ids = array[v_b]);
  perform pg_temp.act_as(v_c);
  begin
    perform public.answer_general_repo_change(ch2.id, true, '');
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('someone not asked cannot answer it', refused);

  ------------------------------------------------------------------ refusals
  perform pg_temp.act_as(v_a);
  perform public.save_general_draft_file(v_repo, 'three.md', 'added', 'text', 'Third file');
  begin
    perform public.submit_general_draft_file(v_repo, 'three.md', 'Third', '', null, array[v_b, v_out]);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('nobody outside the project can be a reviewer', refused);
  begin
    perform public.submit_general_draft_file(v_repo, 'three.md', 'Third', '', null, array[v_a, v_b]);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('the author cannot review their own change', refused);
  begin
    perform public.submit_general_draft_file(v_repo, 'three.md', 'Third', '', null, '{}'::uuid[]);
    refused := false;
  exception when invalid_parameter_value then refused := true;
  end;
  perform pg_temp.ok('at least one reviewer is needed', refused);

  ch := public.submit_general_draft_file(v_repo, 'three.md', 'Third', '', v_b, array[v_b, v_c, v_b]);
  perform pg_temp.ok('repeats collapse to one each', cardinality(ch.reviewer_ids) = 2);

  begin
    update public.general_repo_changes set reviewer_ids = array[v_a] where id = ch.id;
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('the reviewers of an open change cannot be swapped', refused);
  perform pg_temp.svc();
end;
$$;

rollback;
