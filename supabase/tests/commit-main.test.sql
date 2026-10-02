-- Commit to Main: its own permission, granted by an Owner in a work project and
-- by the group's leader on a class board. Rolls back; nothing here survives.
--
--   node scripts/db.mjs supabase/tests/commit-main.test.sql

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

create or replace function pg_temp.files(variadic p text[]) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'path', p[i], 'action', p[i + 1], 'content', p[i + 2])), '[]'::jsonb)
    from generate_series(1, array_length(p, 1), 3) i;
$$;

/** Whether the caller may commit to this repository now. */
create or replace function pg_temp.commits(p_repo uuid, p_label text) returns boolean
language plpgsql as $$
declare
  seq int;
begin
  select commit_count into seq from public.general_repos where id = p_repo;
  perform public.commit_general_files(p_repo, p_label, seq, pg_temp.files('notes/' || md5(p_label) || '.md', 'added', p_label));
  return true;
exception when insufficient_privilege then
  return false;
end;
$$;

do $$
declare
  owner_id uuid := gen_random_uuid();
  dev_id   uuid := gen_random_uuid();
  ask_id   uuid := gen_random_uuid();
  proj     public.general_projects%rowtype;
  repo     public.general_repos%rowtype;
  req      public.general_access_requests%rowtype;
  chg      uuid;
  refused  boolean;

  v_class uuid; v_prof uuid; v_a uuid; v_b uuid;
  v_set uuid; v_group uuid; v_cproj uuid; v_board uuid; gp uuid; brepo uuid;
begin
  ------------------------------------------------------------------ work project
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Commit', 'last_name', v.ln, 'role', 'professor'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'cm-owner@test.local', 'Owner'),
                 (dev_id, 'cm-dev@test.local', 'Dev'),
                 (ask_id, 'cm-ask@test.local', 'Ask')) as v(id, em, ln);
  update public.profiles set status = 'active' where id in (owner_id, dev_id, ask_id);

  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Commit project', '');
  repo := public.create_general_repo(proj.id, 'Files', '');
  perform pg_temp.ok('an Owner commits to Main', pg_temp.commits(repo.id, 'owner first'));

  perform pg_temp.svc();
  insert into public.general_members (project_id, user_id, level)
  values (proj.id, dev_id, 'member'), (proj.id, ask_id, 'member');
  insert into public.general_grants (project_id, user_id, permission, granted_by)
  values (proj.id, dev_id, 'edit_files', owner_id);

  perform pg_temp.act_as(dev_id);
  perform pg_temp.ok('editing files no longer lets a Member commit to Main', not pg_temp.commits(repo.id, 'dev without'));
  begin
    insert into public.general_commits (repo_id, project_id, seq, message, author_id)
    values (repo.id, proj.id, 99, 'sneaky', dev_id);
    refused := false;
  exception when others then refused := true;
  end;
  perform pg_temp.ok('a direct commit insert is refused without Commit to Main', refused);

  begin
    perform public.grant_general_permission(proj.id, ask_id, 'commit_main');
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('a Member cannot grant Commit to Main', refused);

  perform pg_temp.act_as(owner_id);
  perform public.grant_general_permission(proj.id, dev_id, 'commit_main');
  perform pg_temp.act_as(dev_id);
  perform pg_temp.ok('an Owner grants Commit to Main and the Member commits', pg_temp.commits(repo.id, 'dev granted'));
  perform pg_temp.ok('the screen is told so', (public.general_commit_rights(proj.id) ->> 'commit')::boolean
    and not (public.general_commit_rights(proj.id) ->> 'grant')::boolean);

  -- A change from someone who cannot commit, merged by someone who can.
  perform pg_temp.act_as(ask_id);
  perform pg_temp.ok('a Member without it cannot commit', not pg_temp.commits(repo.id, 'ask without'));
  perform set_config('collabify.general_repo_op', 'off', true);
  insert into public.general_repo_changes (repo_id, project_id, author_id, title, base_seq, files, reviewer_ids)
  values (repo.id, proj.id, ask_id, 'Ask''s change', (select commit_count from public.general_repos where id = repo.id),
          pg_temp.files('notes/ask.md', 'added', 'from ask'), array[dev_id])
  returning id into chg;
  perform pg_temp.act_as(dev_id);
  perform public.answer_general_repo_change(chg, true, '');
  perform pg_temp.ok('a reviewer who can commit merges it onto Main',
    exists (select 1 from public.general_commits where change_id = chg));

  -- Asking for it.
  perform pg_temp.act_as(ask_id);
  req := public.request_general_access(proj.id, 'commit_main', 'I finish the docs');
  perform pg_temp.svc();
  perform pg_temp.ok('the Owner is told of the request',
    exists (select 1 from public.notifications where user_id = owner_id and type = 'general_access_requested'
             and general_project_id = proj.id and preview like '%asked for: Commit to Main'));
  perform pg_temp.act_as(owner_id);
  perform public.answer_general_access_request(req.id, true, '');
  perform pg_temp.act_as(ask_id);
  perform pg_temp.ok('an approved request lets them commit', pg_temp.commits(repo.id, 'ask approved'));

  perform pg_temp.act_as(owner_id);
  perform public.revoke_general_permission(proj.id, ask_id, 'commit_main');
  perform pg_temp.act_as(ask_id);
  perform pg_temp.ok('taking it back stops them', not pg_temp.commits(repo.id, 'ask revoked'));

  -- A named reviewer without it may decline, not merge.
  perform pg_temp.act_as(dev_id);
  perform set_config('collabify.general_repo_op', 'off', true);
  insert into public.general_repo_changes (repo_id, project_id, author_id, title, base_seq, files, reviewer_ids)
  values (repo.id, proj.id, dev_id, 'Dev''s change', (select commit_count from public.general_repos where id = repo.id),
          pg_temp.files('notes/dev2.md', 'added', 'from dev'), array[ask_id])
  returning id into chg;
  perform pg_temp.act_as(ask_id);
  begin
    perform public.answer_general_repo_change(chg, true, '');
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('a named reviewer without Commit to Main cannot merge', refused);
  perform public.answer_general_repo_change(chg, false, 'Not yet');
  perform pg_temp.ok('...but can decline',
    (select status::text from public.general_repo_changes where id = chg) = 'declined');

  ------------------------------------------------------------------ class board
  perform pg_temp.svc();
  select c.id, c.professor_id into v_class, v_prof from public.classes c
   where (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-commit', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Commit group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id) values (v_group, v_set, v_a), (v_group, v_set, v_b);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'Commit lab', 'activity', 1, 1, 'group', v_set, now() + interval '7 days')
  returning id into v_cproj;
  perform public.ensure_project_boards(v_cproj);
  select id into v_board from public.project_boards where project_id = v_cproj and group_id = v_group;

  perform pg_temp.act_as(v_a);
  gp := public.ensure_class_board_repo(v_board);
  select id into brepo from public.general_repos where project_id = gp;

  perform pg_temp.ok('with no leader, a student commits to the board', pg_temp.commits(brepo, 'a no leader'));
  perform pg_temp.act_as(v_b);
  perform pg_temp.ok('...and so does the other', pg_temp.commits(brepo, 'b no leader'));

  perform pg_temp.act_as(v_a);
  perform public.set_group_leader(v_group, v_a);
  perform pg_temp.ok('the leader commits', pg_temp.commits(brepo, 'a leads'));
  perform pg_temp.ok('...and decides it for others', (public.general_commit_rights(gp) ->> 'grant')::boolean);
  perform pg_temp.act_as(v_b);
  perform pg_temp.ok('once there is a leader, the others need their grant', not pg_temp.commits(brepo, 'b led'));
  begin
    perform public.grant_general_permission(gp, v_b, 'commit_main');
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('a non-leader cannot grant it', refused);

  req := public.request_general_access(gp, 'commit_main', 'Let me push the ERD');
  perform pg_temp.svc();
  perform pg_temp.ok('the leader is told, pointing at the class project',
    exists (select 1 from public.notifications where user_id = v_a and type = 'general_access_requested'
             and project_id = v_cproj and general_project_id is null));
  perform pg_temp.act_as(v_a);
  perform pg_temp.ok('the leader sees the request',
    exists (select 1 from public.general_access_requests where id = req.id));
  perform public.answer_general_access_request(req.id, true, '');
  perform pg_temp.act_as(v_b);
  perform pg_temp.ok('the leader approves and the groupmate commits', pg_temp.commits(brepo, 'b approved'));

  perform pg_temp.act_as(v_a);
  perform public.revoke_general_permission(gp, v_b, 'commit_main');
  perform pg_temp.act_as(v_b);
  perform pg_temp.ok('the leader takes it back', not pg_temp.commits(brepo, 'b revoked'));
  begin
    perform public.grant_general_permission(gp, v_b, 'manage_tasks');
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('a leader grants only Commit to Main', refused);

  perform pg_temp.svc();
  perform pg_temp.ok('anon reaches none of the new calls',
    not has_function_privilege('anon', 'public.general_commit_rights(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.general_can_grant(uuid, public.general_permission)', 'execute'));
end;
$$;

rollback;
