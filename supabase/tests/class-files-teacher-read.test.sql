-- supabase/tests/class-files-teacher-read.test.sql
-- Whoever teaches a class reads its groups' Files, and only reads them. Rolls
-- back; nothing survives.
--
-- The file under test must already be applied, or spliced in after the opening begin:
--   node scripts/db.mjs supabase/tests/class-files-teacher-read.test.sql
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

/** Runs the statement as the person, and it must be refused outright. */
create or replace function pg_temp.must_refuse(p_label text, p_user uuid, p_sql text) returns void
language plpgsql as $$
begin
  perform pg_temp.act_as(p_user);
  begin
    execute p_sql;
  exception when insufficient_privilege then
    raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 72);
    return;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

/** Runs an update or delete as the person: refused, or it touches no row. */
create or replace function pg_temp.must_touch_nothing(p_label text, p_user uuid, p_sql text) returns void
language plpgsql as $$
declare
  n bigint;
begin
  perform pg_temp.act_as(p_user);
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 72);
    return;
  end;
  if n = 0 then raise notice 'PASS  %  (no row touched)', p_label;
  else raise exception 'FAIL  % — it changed % row(s)', p_label, n; end if;
end;
$$;

/** How many rows of the board's Files the current caller can see, table by table. */
create or replace function pg_temp.visible(p_gp uuid, p_object text) returns int
language sql as $$
  select (select count(*) from public.general_projects where id = p_gp)::int
       + (select count(*) from public.general_project_overview where id = p_gp)::int
       + (select count(*) from public.general_members where project_id = p_gp)::int
       + (select count(*) from public.general_repos where project_id = p_gp)::int
       + (select count(*) from public.general_repo_overview where project_id = p_gp)::int
       + (select count(*) from public.general_commits where project_id = p_gp)::int
       + (select count(*) from public.general_blobs where project_id = p_gp)::int
       + (select count(*) from public.general_repo_tree where project_id = p_gp)::int
       + (select count(*) from public.general_repo_changes where project_id = p_gp)::int
       + (select count(*) from public.general_repo_comments where project_id = p_gp)::int
       + (select count(*) from public.general_shares where project_id = p_gp)::int
       + (select count(*) from public.general_share_recipients r
            where r.share_id in (select id from public.general_shares where project_id = p_gp))::int
       + (select count(*) from storage.objects where bucket_id = 'general-files' and name = p_object)::int;
$$;

do $$
declare
  v_t   uuid := gen_random_uuid();  -- teaches class A
  v_w   uuid := gen_random_uuid();  -- co-teaches class A through its space
  v_u   uuid := gen_random_uuid();  -- teaches class B
  v_s1  uuid := gen_random_uuid();  -- group 1, class A
  v_s2  uuid := gen_random_uuid();  -- group 1, class A
  v_s3  uuid := gen_random_uuid();  -- group 2, class A
  v_s4  uuid := gen_random_uuid();  -- class B
  res_a uuid; res_b uuid;
  cls_a uuid; cls_b uuid;
  set_a uuid; g1 uuid; g2 uuid;
  proj  uuid;
  b1    uuid; b2 uuid;
  gp    uuid;
  repo  uuid;
  blob  uuid;
  chg   uuid;
  shr   uuid;
  obj   text;
  refused boolean;
begin
  perform pg_temp.act_as_service();

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@test.invalid', '', now(), now()
    from (values (v_t), (v_w), (v_u), (v_s1), (v_s2), (v_s3), (v_s4)) as u(id);
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach)
  values (v_t,  v_t::text  || '@test.invalid', 'Zz', 'Cftr teacher',  'member',  'active', true),
         (v_w,  v_w::text  || '@test.invalid', 'Zz', 'Cftr coteach',  'member',  'active', true),
         (v_u,  v_u::text  || '@test.invalid', 'Zz', 'Cftr other',    'member',  'active', true),
         (v_s1, v_s1::text || '@test.invalid', 'Zz', 'Cftr one',      'student', 'active', false),
         (v_s2, v_s2::text || '@test.invalid', 'Zz', 'Cftr two',      'student', 'active', false),
         (v_s3, v_s3::text || '@test.invalid', 'Zz', 'Cftr three',    'student', 'active', false),
         (v_s4, v_s4::text || '@test.invalid', 'Zz', 'Cftr four',     'student', 'active', false)
  on conflict (id) do update set role = excluded.role, status = excluded.status, can_teach = excluded.can_teach;

  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (v_t, 'syllabus', 'Zz CFTR syllabus A', 'x/cftr-a.pdf', 'cftr-a.pdf') returning id into res_a;
  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (v_u, 'syllabus', 'Zz CFTR syllabus B', 'x/cftr-b.pdf', 'cftr-b.pdf') returning id into res_b;
  insert into public.syllabus_weeks (resource_id, week_no, title)
  select r, n, 'Week ' || n from generate_series(1, 4) as n, unnest(array[res_a, res_b]) as r;

  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id, term_start, term_end)
  values (v_t, 'Zz CFTR class A', 'ZZCA', 'ZZ-CFTR-A-' || left(v_t::text, 8), 'BSIT 9Z', '3rd', '1st',
          '2026-2027', res_a, current_date - 7, current_date + 60)
  returning id into cls_a;
  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id, term_start, term_end)
  values (v_u, 'Zz CFTR class B', 'ZZCB', 'ZZ-CFTR-B-' || left(v_u::text, 8), 'BSIT 9Y', '3rd', '1st',
          '2026-2027', res_b, current_date - 7, current_date + 60)
  returning id into cls_b;
  insert into public.class_members (class_id, student_id, status)
  values (cls_a, v_s1, 'active'), (cls_a, v_s2, 'active'), (cls_a, v_s3, 'active'), (cls_b, v_s4, 'active');

  -- A co-teacher: a teaching member managing class A's space.
  insert into public.general_space_members (space_id, user_id, level)
  select space_id, v_w, 'manager' from public.classes where id = cls_a;

  insert into public.group_sets (class_id, name, mode) values (cls_a, 'zz-cftr', 'manual') returning id into set_a;
  insert into public.groups (set_id, name) values (set_a, 'Zz CFTR group 1') returning id into g1;
  insert into public.groups (set_id, name) values (set_a, 'Zz CFTR group 2') returning id into g2;
  insert into public.group_members (group_id, set_id, student_id)
  values (g1, set_a, v_s1), (g1, set_a, v_s2), (g2, set_a, v_s3);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (cls_a, v_t, 'Zz CFTR lab', 'activity', 1, 1, 'group', set_a, now() + interval '7 days')
  returning id into proj;
  perform public.ensure_project_boards(proj);
  select id into b1 from public.project_boards where project_id = proj and group_id = g1;
  select id into b2 from public.project_boards where project_id = proj and group_id = g2;

  ------------------------------------------------------------ the group opens its Files
  perform pg_temp.act_as(v_s1);
  gp := public.ensure_class_board_repo(b1);
  perform pg_temp.act_as_service();
  select id into repo from public.general_repos where project_id = gp;

  perform pg_temp.act_as(v_s1);
  perform public.commit_general_files(repo, 'First draft', 0,
    '[{"path": "report.md", "action": "added", "content": "Hello"}]'::jsonb);
  insert into public.general_repo_changes (repo_id, project_id, author_id, title, base_seq)
  values (repo, gp, v_s1, 'Zz tidy the intro', 1) returning id into chg;
  insert into public.general_repo_comments (change_id, project_id, author_id, body)
  values (chg, gp, v_s1, 'Zz have a look');

  perform pg_temp.act_as_service();
  select id into blob from public.general_blobs where project_id = gp and path = 'report.md';
  insert into public.general_shares (project_id, repo_id, sender_id, type, path, files)
  values (gp, repo, v_s1, 'file', 'report.md', '[]'::jsonb) returning id into shr;
  insert into public.general_share_recipients (share_id, user_id) values (shr, v_s2);
  obj := gp::text || '/files/zz-cftr-upload.bin';
  insert into storage.objects (bucket_id, name) values ('general-files', obj);

  ------------------------------------------------------------ 1. the teacher reads
  perform pg_temp.act_as(v_t);
  perform pg_temp.must_be('the teacher reads the hidden project',
    exists (select 1 from public.general_projects where id = gp)
    and exists (select 1 from public.general_project_overview where id = gp));
  perform pg_temp.must_be('...and who is on it',
    (select count(*) from public.general_members where project_id = gp) = 2);
  perform pg_temp.must_be('...its repository',
    exists (select 1 from public.general_repos where id = repo)
    and exists (select 1 from public.general_repo_overview where id = repo and file_count = 1));
  perform pg_temp.must_be('...the commit',
    exists (select 1 from public.general_commits where repo_id = repo and seq = 1));
  perform pg_temp.must_be('...the file',
    exists (select 1 from public.general_blobs where id = blob and content = 'Hello')
    and exists (select 1 from public.general_repo_tree where repo_id = repo and path = 'report.md'));
  perform pg_temp.must_be('...the review and its comment',
    exists (select 1 from public.general_repo_changes where id = chg)
    and exists (select 1 from public.general_repo_comments where change_id = chg));
  perform pg_temp.must_be('...the share and who it went to',
    exists (select 1 from public.general_shares where id = shr)
    and exists (select 1 from public.general_share_recipients where share_id = shr and user_id = v_s2));
  perform pg_temp.must_be('...the uploaded file in storage',
    exists (select 1 from storage.objects where bucket_id = 'general-files' and name = obj));
  perform pg_temp.must_be('class_board_repo_id finds the group''s Files',
    public.class_board_repo_id(b1) = gp);
  perform pg_temp.must_be('...and answers null for a group that never opened them',
    public.class_board_repo_id(b2) is null);
  perform pg_temp.must_be('...and creates nothing',
    not exists (select 1 from public.general_projects where class_board_id = b2));

  perform pg_temp.act_as(v_w);
  perform pg_temp.must_be('a co-teacher on the class space reads them too',
    pg_temp.visible(gp, obj) > 0 and public.class_board_repo_id(b1) = gp);

  ------------------------------------------------------------ 2. and only reads
  perform pg_temp.must_refuse('the teacher cannot insert a commit', v_t,
    format($q$insert into public.general_commits (repo_id, project_id, seq, message, author_id)
              values (%L, %L, 2, 'Zz teacher', %L)$q$, repo, gp, v_t));
  perform pg_temp.must_refuse('the teacher cannot commit through the function', v_t,
    format($q$select public.commit_general_files(%L, 'Zz teacher', 1,
              '[{"path": "teacher.md", "action": "added", "content": "No"}]'::jsonb)$q$, repo));
  perform pg_temp.must_refuse('the teacher cannot comment on a review', v_t,
    format($q$insert into public.general_repo_comments (change_id, project_id, author_id, body)
              values (%L, %L, %L, 'Zz teacher')$q$, chg, gp, v_t));
  perform pg_temp.must_refuse('the teacher cannot start a draft', v_t,
    format($q$insert into public.general_drafts (repo_id, project_id, user_id, base_seq)
              values (%L, %L, %L, 1)$q$, repo, gp, v_t));
  perform pg_temp.must_refuse('the teacher cannot open a review', v_t,
    format($q$insert into public.general_repo_changes (repo_id, project_id, author_id, title, base_seq)
              values (%L, %L, %L, 'Zz teacher', 1)$q$, repo, gp, v_t));
  perform pg_temp.must_refuse('the teacher cannot share', v_t,
    format($q$insert into public.general_shares (project_id, repo_id, sender_id, type, path)
              values (%L, %L, %L, 'file', 'report.md')$q$, gp, repo, v_t));
  perform pg_temp.must_refuse('the teacher cannot upload', v_t,
    format($q$insert into storage.objects (bucket_id, name) values ('general-files', %L)$q$,
           gp::text || '/files/zz-teacher.bin'));
  perform pg_temp.must_touch_nothing('the teacher cannot change the file', v_t,
    format($q$update public.general_blobs set content = 'Changed' where id = %L$q$, blob));
  perform pg_temp.must_touch_nothing('the teacher cannot remove the file', v_t,
    format($q$delete from public.general_blobs where id = %L$q$, blob));
  perform pg_temp.must_touch_nothing('the teacher cannot remove the commit', v_t,
    format($q$delete from public.general_commits where repo_id = %L$q$, repo));
  perform pg_temp.must_touch_nothing('the teacher cannot rename the repository', v_t,
    format($q$update public.general_repos set name = 'Zz teacher' where id = %L$q$, repo));
  perform pg_temp.must_touch_nothing('the teacher cannot change the project', v_t,
    format($q$update public.general_projects set name = 'Zz teacher' where id = %L$q$, gp));
  perform pg_temp.must_touch_nothing('the teacher cannot remove the comment', v_t,
    format($q$delete from public.general_repo_comments where change_id = %L$q$, chg));
  perform pg_temp.must_touch_nothing('the teacher cannot remove the share', v_t,
    format($q$delete from public.general_shares where id = %L$q$, shr));
  perform pg_temp.must_touch_nothing('the teacher cannot delete the upload', v_t,
    format($q$delete from storage.objects where bucket_id = 'general-files' and name = %L$q$, obj));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and everything is as the students left it',
    (select content from public.general_blobs where id = blob) = 'Hello'
    and (select count(*) from public.general_commits where repo_id = repo) = 1
    and (select name from public.general_repos where id = repo) = 'Files'
    and exists (select 1 from public.general_repo_comments where change_id = chg)
    and exists (select 1 from public.general_shares where id = shr)
    and exists (select 1 from storage.objects where bucket_id = 'general-files' and name = obj)
    and not exists (select 1 from public.general_drafts where project_id = gp and user_id = v_t)
    and not exists (select 1 from public.general_members where project_id = gp and user_id = v_t));

  ------------------------------------------------------------ 3. another class's professor
  perform pg_temp.act_as(v_u);
  perform pg_temp.must_be('another class''s professor sees nothing', pg_temp.visible(gp, obj) = 0);
  begin
    perform public.class_board_repo_id(b1);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.must_be('...and class_board_repo_id refuses them', refused);

  ------------------------------------------------------------ 4. other students
  perform pg_temp.act_as(v_s3);
  perform pg_temp.must_be('a student in another group sees nothing', pg_temp.visible(gp, obj) = 0);
  begin
    perform public.class_board_repo_id(b1);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.must_be('...and class_board_repo_id refuses them', refused);
  perform pg_temp.act_as(v_s4);
  perform pg_temp.must_be('a student in another class sees nothing', pg_temp.visible(gp, obj) = 0);

  ------------------------------------------------------------ 5. the group keeps working
  perform pg_temp.act_as(v_s1);
  perform public.commit_general_files(repo, 'Second draft', 1,
    '[{"path": "report.md", "action": "changed", "content": "Hello again"}]'::jsonb);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a student still commits',
    (select commit_count from public.general_repos where id = repo) = 2);
  perform pg_temp.act_as(v_s2);
  perform pg_temp.must_be('...and the group still reads its files',
    exists (select 1 from public.general_repo_tree where repo_id = repo and content = 'Hello again'));

  ------------------------------------------------------------ 6. the teacher still cannot open them
  perform pg_temp.act_as(v_t);
  begin
    perform public.ensure_class_board_repo(b1);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.must_be('ensure_class_board_repo still refuses the teacher', refused);
  begin
    perform public.ensure_class_board_repo(b2);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.must_be('...on a group that never opened them too', refused);

  perform pg_temp.act_as_service();
end;
$$;

rollback;
