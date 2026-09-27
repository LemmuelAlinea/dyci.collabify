-- A class board's Files: who gets in, who writes, and when they freeze. Rolls back.
--
--   node scripts/db.mjs supabase/tests/class-files.test.sql

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
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_out uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_board uuid;
  gp uuid; again uuid; v_repo uuid;
  refused boolean;
begin
  select c.id, c.professor_id into v_class, v_prof from public.classes c
   where (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 3
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;
  select student_id into v_out from public.class_members where class_id = v_class and status = 'active' and student_id not in (v_a, v_b) order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-files', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Files group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id) values (v_group, v_set, v_a), (v_group, v_set, v_b);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'Files lab', 'activity', 1, 1, 'group', v_set, now() + interval '7 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_group;

  ------------------------------------------------------------------ opening
  perform pg_temp.act_as(v_a);
  gp := public.ensure_class_board_repo(v_board);
  again := public.ensure_class_board_repo(v_board);
  perform pg_temp.svc();
  perform pg_temp.ok('opening the Files makes one hidden project, once', gp is not null and gp = again);
  perform pg_temp.ok('...marked as a class board',
    (select preset = 'class-board' and class_board_id = v_board from public.general_projects where id = gp));
  perform pg_temp.ok('...with its repository ready',
    exists (select 1 from public.general_repos where project_id = gp));
  perform pg_temp.ok('...and no second chat',
    not exists (select 1 from public.conversations where kind = 'project' and general_project_id = gp));
  perform pg_temp.ok('both students are members who can write',
    (select count(*) from public.general_grants where project_id = gp and permission = 'edit_files'
      and user_id in (v_a, v_b)) = 2);
  perform pg_temp.ok('the professor is a member who cannot write',
    exists (select 1 from public.general_members where project_id = gp and user_id = v_prof)
    and not exists (select 1 from public.general_grants where project_id = gp and user_id = v_prof));

  perform pg_temp.act_as(v_out);
  begin
    perform public.ensure_class_board_repo(v_board);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('a classmate outside the group cannot open it', refused);

  ------------------------------------------------------------------ writing
  perform pg_temp.svc();
  select id into v_repo from public.general_repos where project_id = gp;
  perform pg_temp.act_as(v_a);
  perform public.commit_general_files(v_repo, 'First draft', 0,
    '[{"path": "report.md", "action": "added", "content": "Hello"}]'::jsonb);
  perform pg_temp.svc();
  perform pg_temp.ok('a student commits to Main', (select commit_count from public.general_repos where id = v_repo) = 1);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.ok('the professor reads Main',
    exists (select 1 from public.general_repo_tree where repo_id = v_repo and path = 'report.md'));
  perform pg_temp.act_as(v_out);
  perform pg_temp.ok('a classmate outside the group reads nothing',
    not exists (select 1 from public.general_repo_tree where repo_id = v_repo)
    and not exists (select 1 from public.general_project_overview where id = gp));
  perform pg_temp.svc();

  perform pg_temp.act_as(v_prof);
  begin
    insert into public.general_drafts (repo_id, project_id, user_id, base_seq) values (v_repo, gp, v_prof, 1);
    refused := false;
  exception when insufficient_privilege or check_violation then refused := true;
  end;
  perform pg_temp.ok('the professor cannot start a draft', refused);

  ------------------------------------------------------------------ freezing
  perform pg_temp.act_as(v_a);
  perform public.set_board_submitted(v_board, true);
  begin
    perform public.commit_general_files(v_repo, 'After hand-in', 1,
      '[{"path": "late.md", "action": "added", "content": "Too late"}]'::jsonb);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('handing in freezes the files', refused);

  perform public.set_board_submitted(v_board, false);
  perform public.commit_general_files(v_repo, 'Taken back', 1,
    '[{"path": "late.md", "action": "added", "content": "Fine now"}]'::jsonb);
  perform pg_temp.svc();
  perform pg_temp.ok('taking it back unfreezes them', (select commit_count from public.general_repos where id = v_repo) = 2);

  ------------------------------------------------------------------ reviews open the class project
  perform pg_temp.act_as(v_b);
  insert into public.general_repo_changes (repo_id, project_id, author_id, title, base_seq)
  values (v_repo, gp, v_b, 'Tidy the intro', 2);
  perform pg_temp.svc();
  perform pg_temp.ok('a review request reaches the rest of the group, pointing at the class project',
    exists (select 1 from public.notifications where user_id = v_a and type = 'review_requested'
             and project_id = v_proj and general_project_id is null));
  perform pg_temp.ok('...and not the professor, who only reads',
    not exists (select 1 from public.notifications where user_id = v_prof and type = 'review_requested'));

  ------------------------------------------------------------------ leaving
  delete from public.group_members where group_id = v_group and student_id = v_b;
  perform pg_temp.ok('leaving the group takes the files away',
    not exists (select 1 from public.general_members where project_id = gp and user_id = v_b));
  perform pg_temp.ok('...without a removal notice',
    not exists (select 1 from public.notifications where user_id = v_b and type = 'membership_changed'));

  ------------------------------------------------------------------ deleting
  perform pg_temp.act_as(v_prof);
  delete from public.projects where id = v_proj;
  perform pg_temp.svc();
  perform pg_temp.ok('deleting a class project whose Files have commits goes through',
    not exists (select 1 from public.projects where id = v_proj));
  perform pg_temp.ok('...and takes the hidden Files project and its history with it',
    not exists (select 1 from public.general_projects where id = gp)
    and not exists (select 1 from public.general_commits where project_id = gp));
  begin
    delete from public.general_commits where repo_id in (select id from public.general_repos limit 1);
    perform pg_temp.ok('a commit on its own still cannot be deleted', not exists (select 1 from public.general_commits));
  exception when insufficient_privilege then
    perform pg_temp.ok('a commit on its own still cannot be deleted', true);
  end;
end;
$$;

rollback;
