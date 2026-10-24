-- Company roles, phase 3: stakeholders are read-only — rolled back, touches
-- nothing permanently.
--
--   node scripts/db.mjs supabase/tests/project-stakeholders.test.sql
--
-- A stakeholder on a work project reads what a member reads and changes
-- nothing: general_can_write is false for them, and every write chokepoint a
-- member passes refuses them. Every refusal is paired with a case that is
-- allowed, so a refusal never passes for the wrong reason. A class-board
-- Files project keeps every write its members had.
--
-- The first stakeholder fixture is a service-role update of
-- general_members.role. The last sections set the role through
-- set_general_member_role and the invitation RPCs, and check that a
-- stakeholder is out of the discussion, the project chat and the space.

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

-- A refusal that must be the one under test, not some other rule further along.
create or replace function pg_temp.must_refuse_with(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      if position(lower(p_needle) in lower(sqlerrm)) > 0 then
        raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 60);
        return;
      end if;
      raise exception 'FAIL  % — refused for another reason: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

-- The stakeholder refusal, with its errcode.
create or replace function pg_temp.must_refuse_stakeholder(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when insufficient_privilege then
      if sqlerrm = 'Stakeholders can view this project but not change it.' then
        raise notice 'PASS  %  (refused as a stakeholder)', p_label;
        return;
      end if;
      raise exception 'FAIL  % — refused for another reason: %', p_label, sqlerrm;
    when others then
      raise exception 'FAIL  % — refused for another reason: % (%)', p_label, sqlerrm, sqlstate;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

create or replace function pg_temp.must_allow(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS  %', p_label;
exception
  when others then
    raise exception 'FAIL  % — refused with: %', p_label, sqlerrm;
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_pm   uuid := gen_random_uuid();  -- member account, Project manager on
  v_m    uuid := gen_random_uuid();  -- member
  v_s    uuid := gen_random_uuid();  -- member, then stakeholder
  v_q    uuid := gen_random_uuid();  -- qa
  v_out  uuid := gen_random_uuid();  -- not on the project
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_pm,  'zz-sh-pm@example.test'),
      (v_m,   'zz-sh-m@example.test'),
      (v_s,   'zz-sh-s@example.test'),
      (v_q,   'zz-sh-q@example.test'),
      (v_out, 'zz-sh-out@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_pm,  'zz-sh-pm@example.test',  'Zz', 'Shpm',  'member', 'active', false, true),
    (v_m,   'zz-sh-m@example.test',   'Zz', 'Shm',   'member', 'active', false, false),
    (v_s,   'zz-sh-s@example.test',   'Zz', 'Shs',   'member', 'active', false, false),
    (v_q,   'zz-sh-q@example.test',   'Zz', 'Shq',   'member', 'active', false, false),
    (v_out, 'zz-sh-out@example.test', 'Zz', 'Shout', 'member', 'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values ('pm', v_pm), ('m', v_m), ('s', v_s), ('q', v_q), ('out', v_out);
end $$;

-- The project, its files, tasks and everything S did while still a member.
do $$
declare
  v_pm    uuid := (select v from fx where k = 'pm');
  v_m     uuid := (select v from fx where k = 'm');
  v_s     uuid := (select v from fx where k = 's');
  v_q     uuid := (select v from fx where k = 'q');
  v_p     uuid;
  v_repo  uuid;
  v_t1    uuid;  -- M's, held by M
  v_t2    uuid;  -- the PM's, unheld
  v_t3    uuid;  -- M's, unheld
  v_ts    uuid;  -- S's, made while S was a member
  v_team  uuid;
  v_c0    uuid;  -- the PM's change, S its reviewer
  v_share uuid;
  v_t5    uuid;  -- the PM's, held by S
  v_meet  uuid;  -- S's project meeting
begin
  perform pg_temp.act_as(v_pm);
  v_p := (public.create_general_project('Zz SH project', '')).id;
  v_repo := (public.create_general_repo(v_p, 'Files')).id;
  perform public.commit_general_files(v_repo, 'The first files', 0, jsonb_build_array(
    jsonb_build_object('path', 'readme.md', 'action', 'added', 'kind', 'text', 'content', 'Hello')));

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, role)
  values (v_p, v_m, 'member'), (v_p, v_s, 'member'), (v_p, v_q, 'qa');

  perform pg_temp.act_as(v_pm);
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz PM task') returning id into v_t2;
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (v_p, 'Zz sprint', current_date, current_date + 14);
  insert into public.general_milestones (project_id, name, due_on)
  values (v_p, 'Zz milestone', current_date + 30);
  insert into public.general_teams (project_id, name) values (v_p, 'Zz team') returning id into v_team;
  insert into public.general_team_members (team_id, project_id, user_id)
  values (v_team, v_p, v_m), (v_team, v_p, v_s);

  perform pg_temp.act_as(v_m);
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz M task') returning id into v_t1;
  insert into public.general_task_assignees (task_id, project_id, user_id) values (v_t1, v_p, v_m);
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz M spare') returning id into v_t3;
  insert into public.general_task_comments (task_id, project_id, body) values (v_t1, v_p, 'M was here');

  perform pg_temp.act_as(v_pm);
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz S holds') returning id into v_t5;

  perform pg_temp.act_as(v_s);
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz S task') returning id into v_ts;
  perform public.save_general_draft_file(v_repo, 's.md', 'added', 'text', 'S wrote this');
  -- S holds a task, with a file on it, and has a draft file in Trash.
  insert into public.general_task_assignees (task_id, project_id, user_id) values (v_t5, v_p, v_s);
  insert into storage.objects (bucket_id, name, owner_id)
  values ('general-files', v_p || '/' || v_t5 || '/s.txt', v_s::text);
  insert into public.general_task_files (task_id, project_id, file_path, file_name)
  values (v_t5, v_p, v_p || '/' || v_t5 || '/s.txt', 's.txt');
  perform public.save_general_draft_file(v_repo, 'trash.md', 'added', 'text', 'S threw this out');
  perform public.trash_general_draft_path(v_repo, 'trash.md');
  v_meet := (public.create_meeting('project', v_p, 'Zz S meeting', '', 'https://zoom.us/j/1234567890',
                                   now() + interval '1 day', 60)).id;

  -- The PM's change names S as reviewer, and the PM shares a file with S.
  perform pg_temp.act_as(v_pm);
  perform public.save_general_draft_file(v_repo, 'early.md', 'added', 'text', 'For S');
  v_share := public.share_general_draft_path(v_repo, 'early.md', false, array[v_s]);
  perform public.save_general_draft_file(v_repo, 'review.md', 'added', 'text', 'Review me');
  v_c0 := (public.submit_general_draft_file(v_repo, 'review.md', 'Zz review', '', v_s)).id;
  perform public.save_general_draft_file(v_repo, 'pm.md', 'added', 'text', 'PM file');

  -- S becomes a stakeholder.
  perform pg_temp.act_as_service();
  update public.general_members set role = 'stakeholder' where project_id = v_p and user_id = v_s;

  insert into fx values
    ('p', v_p), ('repo', v_repo), ('t1', v_t1), ('t2', v_t2),
    ('t3', v_t3), ('ts', v_ts), ('team', v_team), ('c0', v_c0), ('share', v_share),
    ('t5', v_t5), ('meet', v_meet);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ the helper

do $$
declare
  v_p uuid := (select v from fx where k = 'p');
begin
  perform pg_temp.must_be('S is a stakeholder at level member',
    (select role = 'stakeholder' and level = 'member' from public.general_members
      where project_id = v_p and user_id = (select v from fx where k = 's')));
  perform pg_temp.act_as((select v from fx where k = 'pm'));
  perform pg_temp.must_be('the pm can write', public.general_can_write(v_p));
  perform pg_temp.act_as((select v from fx where k = 'm'));
  perform pg_temp.must_be('a member can write', public.general_can_write(v_p));
  perform pg_temp.act_as((select v from fx where k = 'q'));
  perform pg_temp.must_be('a qa can write', public.general_can_write(v_p));
  perform pg_temp.act_as((select v from fx where k = 's'));
  perform pg_temp.must_be('a stakeholder cannot', public.general_can_write(v_p) is false);
  perform pg_temp.must_be('...but is still a member', public.is_general_member(v_p));
  perform pg_temp.act_as((select v from fx where k = 'out'));
  perform pg_temp.must_be('somebody not on the project cannot', public.general_can_write(v_p) is false);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ tasks

do $$
declare
  v_p  uuid := (select v from fx where k = 'p');
  v_s  uuid := (select v from fx where k = 's');
  v_m  uuid := (select v from fx where k = 'm');
  v_t1 uuid := (select v from fx where k = 't1');
  v_t2 uuid := (select v from fx where k = 't2');
  v_t3 uuid := (select v from fx where k = 't3');
  v_ts uuid := (select v from fx where k = 'ts');
  v_t4 uuid;
begin
  perform pg_temp.act_as(v_s);
  perform pg_temp.must_refuse_stakeholder('S adds a task',
    format($q$insert into public.general_tasks (project_id, title) values (%L, 'Zz no')$q$, v_p));
  perform pg_temp.must_refuse_stakeholder('S renames M''s task',
    format($q$update public.general_tasks set title = 'Zz renamed' where id = %L$q$, v_t1));
  perform pg_temp.must_refuse_stakeholder('S renames their own task from before',
    format($q$update public.general_tasks set title = 'Zz renamed' where id = %L$q$, v_ts));
  perform pg_temp.must_refuse_stakeholder('S moves their own task to another stage',
    format($q$update public.general_tasks set stage = 1 where id = %L$q$, v_ts));
  perform pg_temp.must_refuse_stakeholder('S takes an unheld task',
    format($q$insert into public.general_task_assignees (task_id, project_id, user_id)
              values (%L, %L, %L)$q$, v_t2, v_p, v_s));
  perform pg_temp.must_refuse_stakeholder('S comments on a task',
    format($q$insert into public.general_task_comments (task_id, project_id, body)
              values (%L, %L, 'Zz no')$q$, v_t1, v_p));
  perform pg_temp.must_refuse_stakeholder('S logs time on a task',
    format($q$insert into public.general_task_logs (task_id, project_id, user_id, minutes)
              values (%L, %L, %L, 30)$q$, v_t1, v_p, v_s));
  perform pg_temp.must_refuse_stakeholder('S archives a task they added before',
    format($q$select public.archive_general_task(%L, true)$q$, v_ts));
  delete from public.general_tasks where id = v_ts;
  perform pg_temp.must_be('S deleting their own task from before removes nothing',
    exists (select 1 from public.general_tasks where id = v_ts));

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_allow('M adds a task',
    format($q$insert into public.general_tasks (project_id, title) values (%L, 'Zz yes')$q$, v_p));
  perform pg_temp.must_allow('M renames their own task',
    format($q$update public.general_tasks set title = 'Zz M task 2' where id = %L$q$, v_t1));
  perform pg_temp.must_allow('M takes the unheld task',
    format($q$insert into public.general_task_assignees (task_id, project_id, user_id)
              values (%L, %L, %L)$q$, v_t2, v_p, v_m));
  perform pg_temp.must_allow('M comments on a task',
    format($q$insert into public.general_task_comments (task_id, project_id, body)
              values (%L, %L, 'Zz yes')$q$, v_t1, v_p));
  perform pg_temp.must_allow('M logs time on their task',
    format($q$insert into public.general_task_logs (task_id, project_id, user_id, minutes)
              values (%L, %L, %L, 30)$q$, v_t1, v_p, v_m));
  perform pg_temp.must_allow('M archives a task they added',
    format($q$select public.archive_general_task(%L, true)$q$, v_t3));
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz M gone') returning id into v_t4;
  delete from public.general_tasks where id = v_t4;
  perform pg_temp.must_be('M deleting their own unheld task removes it',
    not exists (select 1 from public.general_tasks where id = v_t4));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ files

do $$
declare
  v_p   uuid := (select v from fx where k = 'p');
  v_s   uuid := (select v from fx where k = 's');
  v_m   uuid := (select v from fx where k = 'm');
  v_pm  uuid := (select v from fx where k = 'pm');
  v_repo  uuid := (select v from fx where k = 'repo');
  v_t1    uuid := (select v from fx where k = 't1');
  v_t5    uuid := (select v from fx where k = 't5');
  v_draft uuid;
  v_share uuid;
  v_chg   uuid;
begin
  perform pg_temp.act_as(v_s);
  perform pg_temp.must_refuse_with('S uploads to the project''s files',
    format($q$insert into storage.objects (bucket_id, name, owner_id)
              values ('general-files', %L, %L)$q$, v_p || '/files/x.txt', v_s),
    'row-level security');
  perform pg_temp.must_refuse_stakeholder('S opens a draft',
    format($q$select public.my_general_draft(%L)$q$, v_repo));
  perform pg_temp.must_refuse_stakeholder('S saves a draft file',
    format($q$select public.save_general_draft_file(%L, 'more.md', 'added', 'text', 'x')$q$, v_repo));
  v_draft := (select id from public.general_drafts where repo_id = v_repo and user_id = v_s);
  perform pg_temp.must_be('S still sees the draft they had', v_draft is not null);
  perform pg_temp.must_refuse_stakeholder('S writes into that draft by hand',
    format($q$insert into public.general_draft_files (draft_id, project_id, path, action, kind, content)
              values (%L, %L, 'hand.md', 'added', 'text', 'x')$q$, v_draft, v_p));
  perform pg_temp.must_refuse_stakeholder('S submits their draft',
    format($q$select public.submit_general_draft(%L, 'Zz S change', '', %L)$q$, v_repo, v_pm));
  perform pg_temp.must_refuse_stakeholder('S submits one file',
    format($q$select public.submit_general_draft_file(%L, 's.md', 'Zz S change', '', %L)$q$, v_repo, v_pm));
  perform pg_temp.must_refuse_stakeholder('S commits a draft path',
    format($q$select public.commit_general_draft_path(%L, 's.md', false, 'Zz')$q$, v_repo));
  perform pg_temp.must_refuse_stakeholder('S copies a share they got before',
    format($q$select public.copy_general_share_to_draft(%L)$q$, (select v from fx where k = 'share')));
  perform pg_temp.must_refuse_stakeholder('S answers the change they were asked to review',
    format($q$select public.answer_general_repo_change(%L, false, 'no')$q$, (select v from fx where k = 'c0')));
  perform pg_temp.must_refuse_with('S comments on a change',
    format($q$insert into public.general_repo_comments (change_id, project_id, author_id, body)
              values (%L, %L, %L, 'Zz no')$q$, (select v from fx where k = 'c0'), v_p, v_s),
    'row-level security');
  perform pg_temp.must_refuse_with('S, still holding a task, uploads a file to it',
    format($q$insert into storage.objects (bucket_id, name, owner_id)
              values ('general-files', %L, %L)$q$, v_p || '/' || v_t5 || '/s2.txt', v_s),
    'row-level security');
  -- The Storage API's own delete goes through these policies; SQL needs the switch.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'general-files' and name = v_p || '/' || v_t5 || '/s.txt';
  perform pg_temp.must_be('...and removing the file they put there removes nothing',
    exists (select 1 from storage.objects
             where bucket_id = 'general-files' and name = v_p || '/' || v_t5 || '/s.txt'));
  perform pg_temp.must_be('S''s Trash leaves out their trashed draft file',
    not exists (select 1 from public.list_my_trash() where kind = 'draft'));
  perform pg_temp.must_allow('S empties Trash', 'select public.empty_my_trash()');
  perform pg_temp.must_be('...which leaves that draft file where it was',
    exists (select 1 from public.general_draft_files
             where draft_id = v_draft and path = 'trash.md' and trashed_at is not null));
  -- With the old draft gone, S cannot start one by hand either.
  perform pg_temp.act_as_service();
  perform set_config('collabify.trash_purge', 'on', true);
  delete from public.general_drafts where repo_id = v_repo and user_id = v_s;
  perform set_config('collabify.trash_purge', 'off', true);
  perform pg_temp.act_as(v_s);
  perform pg_temp.must_refuse_with('S inserts a draft by hand',
    format($q$insert into public.general_drafts (repo_id, project_id, user_id, base_seq)
              values (%L, %L, %L, 0)$q$, v_repo, v_p, v_s),
    'row-level security');

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_allow('M uploads to the project''s files',
    format($q$insert into storage.objects (bucket_id, name, owner_id)
              values ('general-files', %L, %L)$q$, v_p || '/files/x.txt', v_m));
  perform pg_temp.must_allow('M inserts a draft by hand',
    format($q$insert into public.general_drafts (repo_id, project_id, user_id, base_seq)
              values (%L, %L, %L, 1)$q$, v_repo, v_p, v_m));
  perform pg_temp.must_allow('M opens their draft',
    format($q$select public.my_general_draft(%L)$q$, v_repo));
  perform public.save_general_draft_file(v_repo, 'm.md', 'added', 'text', 'M wrote this');
  perform pg_temp.must_refuse_with('M cannot name a stakeholder as reviewer',
    format($q$select public.submit_general_draft(%L, 'Zz M change', '', %L)$q$, v_repo, v_s),
    'Stakeholders can''t review changes');
  perform pg_temp.must_allow('M names the pm as reviewer',
    format($q$select public.submit_general_draft(%L, 'Zz M change', '', %L)$q$, v_repo, v_pm));
  perform pg_temp.must_allow('M comments on a change',
    format($q$insert into public.general_repo_comments (change_id, project_id, author_id, body)
              values (%L, %L, %L, 'Zz yes')$q$, (select v from fx where k = 'c0'), v_p, v_m));
  perform pg_temp.must_refuse_with('M cannot open a change by hand naming S as reviewer',
    format($q$insert into public.general_repo_changes
                (repo_id, project_id, author_id, reviewer_ids, title, base_seq, files)
              values (%L, %L, %L, array[%L]::uuid[], 'Zz by hand', 1, '[]'::jsonb)$q$,
           v_repo, v_p, v_m, v_s),
    'Stakeholders can''t review changes');
  perform public.save_general_draft_file(v_repo, 'one.md', 'added', 'text', 'One file');
  perform pg_temp.must_allow('M submits one file',
    format($q$select public.submit_general_draft_file(%L, 'one.md', 'Zz one', '', %L)$q$, v_repo, v_pm));
  perform pg_temp.must_allow('M uploads a file to the task they hold',
    format($q$insert into storage.objects (bucket_id, name, owner_id)
              values ('general-files', %L, %L)$q$, v_p || '/' || v_t1 || '/m.txt', v_m));
  insert into public.general_task_files (task_id, project_id, file_path, file_name)
  values (v_t1, v_p, v_p || '/' || v_t1 || '/m.txt', 'm.txt');
  delete from storage.objects where bucket_id = 'general-files' and name = v_p || '/' || v_t1 || '/m.txt';
  perform pg_temp.must_be('...and removing it removes it',
    not exists (select 1 from storage.objects
                 where bucket_id = 'general-files' and name = v_p || '/' || v_t1 || '/m.txt'));
  perform public.save_general_draft_file(v_repo, 'mtrash.md', 'added', 'text', 'M threw this out');
  perform public.trash_general_draft_path(v_repo, 'mtrash.md');
  perform pg_temp.must_be('M''s Trash lists their trashed draft file',
    exists (select 1 from public.list_my_trash() where kind = 'draft' and root = 'mtrash.md'));
  perform pg_temp.must_allow('M empties Trash', 'select public.empty_my_trash()');
  perform pg_temp.must_be('...which removes it',
    not exists (select 1 from public.general_draft_files f
                  join public.general_drafts d on d.id = f.draft_id
                 where d.repo_id = v_repo and d.user_id = v_m and f.path = 'mtrash.md'));

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('the pm shares a draft file with S',
    format($q$select public.share_general_draft_path(%L, 'pm.md', false, array[%L]::uuid[])$q$, v_repo, v_s),
    'Stakeholders can''t receive shared files.');
  perform pg_temp.must_allow('the pm shares it with M',
    format($q$select public.share_general_draft_path(%L, 'pm.md', false, array[%L]::uuid[])$q$, v_repo, v_m));
  v_chg := (select id from public.general_repo_changes
             where repo_id = v_repo and author_id = v_m and status = 'open' order by created_at limit 1);
  perform pg_temp.must_allow('the pm answers M''s change',
    format($q$select public.answer_general_repo_change(%L, false, 'Not yet')$q$, v_chg));
  perform pg_temp.must_allow('the pm commits a draft path',
    format($q$select public.commit_general_draft_path(%L, 'pm.md', false, 'Zz')$q$, v_repo));

  perform pg_temp.act_as(v_m);
  v_share := (select s.id from public.general_shares s
               where s.repo_id = v_repo and s.path = 'pm.md' and s.sender_id = v_pm);
  perform pg_temp.must_allow('M copies the share they got',
    format($q$select public.copy_general_share_to_draft(%L)$q$, v_share));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ meetings and access

do $$
declare
  v_p    uuid := (select v from fx where k = 'p');
  v_team uuid := (select v from fx where k = 'team');
begin
  perform pg_temp.act_as((select v from fx where k = 's'));
  perform pg_temp.must_refuse_stakeholder('S schedules a project meeting',
    format($q$select public.create_meeting('project', %L, 'Zz sync', '', 'https://zoom.us/j/1234567890',
                                           now() + interval '1 day', 60)$q$, v_p));
  perform pg_temp.must_refuse_stakeholder('S schedules a meeting for their project team',
    format($q$select public.create_meeting('project_team', %L, 'Zz sync', '', 'https://zoom.us/j/1234567890',
                                           now() + interval '1 day', 60)$q$, v_team));
  perform pg_temp.must_be('meeting_audiences lists the project for S, but not to create in',
    exists (select 1 from public.meeting_audiences() a
             where a.scope = 'project' and a.audience_id = v_p and not a.can_create));
  perform pg_temp.must_be('...nor the project team',
    exists (select 1 from public.meeting_audiences() a
             where a.scope = 'project_team' and a.audience_id = v_team and not a.can_create));
  perform pg_temp.must_refuse_stakeholder('S changes the meeting they scheduled as a member',
    format($q$select public.update_meeting(%L, 'Zz renamed', '', 'https://zoom.us/j/1234567890',
                                           now() + interval '2 days', 60)$q$, (select v from fx where k = 'meet')));
  perform pg_temp.must_refuse_stakeholder('...or cancels it',
    format($q$select public.cancel_meeting(%L)$q$, (select v from fx where k = 'meet')));
  perform pg_temp.must_be('...and meeting_can_manage says so',
    not public.meeting_can_manage((select m from public.meetings m where m.id = (select v from fx where k = 'meet'))));
  perform pg_temp.must_refuse_stakeholder('S asks for edit_files',
    format($q$select public.request_general_access(%L, 'edit_files', 'Zz')$q$, v_p));

  perform pg_temp.act_as((select v from fx where k = 'q'));
  perform pg_temp.must_refuse_with('a qa asks for edit_files',
    format($q$select public.request_general_access(%L, 'edit_files', 'Zz')$q$, v_p),
    'QA can''t ask for more access.');

  perform pg_temp.act_as((select v from fx where k = 'm'));
  perform pg_temp.must_be('meeting_audiences lets M create in the project',
    exists (select 1 from public.meeting_audiences() a
             where a.scope = 'project' and a.audience_id = v_p and a.can_create));
  perform pg_temp.must_be('...and in the project team',
    exists (select 1 from public.meeting_audiences() a
             where a.scope = 'project_team' and a.audience_id = v_team and a.can_create));
  perform pg_temp.must_allow('M schedules a project meeting',
    format($q$select public.create_meeting('project', %L, 'Zz sync', '', 'https://zoom.us/j/1234567890',
                                           now() + interval '1 day', 60)$q$, v_p));
  perform pg_temp.must_allow('M schedules a project team meeting',
    format($q$select public.create_meeting('project_team', %L, 'Zz sync', '', 'https://zoom.us/j/1234567890',
                                           now() + interval '1 day', 60)$q$, v_team));
  perform pg_temp.act_as((select v from fx where k = 'pm'));
  perform pg_temp.must_allow('the pm can still change S''s meeting',
    format($q$select public.update_meeting(%L, 'Zz renamed', '', 'https://zoom.us/j/1234567890',
                                           now() + interval '2 days', 60)$q$, (select v from fx where k = 'meet')));
  perform pg_temp.act_as((select v from fx where k = 'm'));
  perform pg_temp.must_allow('M asks for edit_files',
    format($q$select public.request_general_access(%L, 'edit_files', 'Zz')$q$, v_p));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ reading and leaving

do $$
declare
  v_p uuid := (select v from fx where k = 'p');
  v_s uuid := (select v from fx where k = 's');
begin
  perform pg_temp.act_as(v_s);
  perform pg_temp.must_be('S reads the project',
    exists (select 1 from public.general_projects where id = v_p));
  perform pg_temp.must_be('...its tasks',
    (select count(*) from public.general_tasks where project_id = v_p) >= 4);
  perform pg_temp.must_be('...its comments',
    exists (select 1 from public.general_task_comments where project_id = v_p));
  perform pg_temp.must_be('...its files',
    exists (select 1 from public.general_repos where project_id = v_p)
    and exists (select 1 from public.general_commits where project_id = v_p)
    and exists (select 1 from storage.objects
                 where bucket_id = 'general-files' and name = v_p || '/files/x.txt'));
  perform pg_temp.must_be('...its sprints',
    exists (select 1 from public.general_sprints where project_id = v_p));
  perform pg_temp.must_be('...and its milestones',
    exists (select 1 from public.general_milestones where project_id = v_p));
  perform pg_temp.must_allow('S leaves the project',
    format($q$select public.leave_general_project(%L)$q$, v_p));
  perform pg_temp.must_be('...and is off it', not public.is_general_member(v_p));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ the role, discussions and chat

-- From here the role is set through set_general_member_role and the invitation
-- RPCs, not by hand. Coordinators C and C2, and X, Y and Z to invite.
do $$
declare
  v_p  uuid := (select v from fx where k = 'p');
  v_c  uuid := gen_random_uuid();
  v_c2 uuid := gen_random_uuid();
  v_x  uuid := gen_random_uuid();
  v_y  uuid := gen_random_uuid();
  v_z  uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_c,  'zz-sh-c@example.test'),
      (v_c2, 'zz-sh-c2@example.test'),
      (v_x,  'zz-sh-x@example.test'),
      (v_y,  'zz-sh-y@example.test'),
      (v_z,  'zz-sh-z@example.test')
    ) as v(id, em);
  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_c,  'zz-sh-c@example.test',  'Zz', 'Shc',  'member', 'active', false, false),
    (v_c2, 'zz-sh-c2@example.test', 'Zz', 'Shctwo', 'member', 'active', false, false),
    (v_x,  'zz-sh-x@example.test',  'Zz', 'Shx',  'member', 'active', false, false),
    (v_y,  'zz-sh-y@example.test',  'Zz', 'Shy',  'member', 'active', false, false),
    (v_z,  'zz-sh-z@example.test',  'Zz', 'Shz',  'member', 'active', false, false)
  on conflict (id) do update set role = excluded.role, status = excluded.status;
  insert into public.general_members (project_id, user_id, role)
  values (v_p, v_c, 'coordinator'), (v_p, v_c2, 'coordinator');
  insert into fx values ('c', v_c), ('c2', v_c2), ('x', v_x), ('y', v_y), ('z', v_z);
end $$;

create or replace function pg_temp.in_chat(p_project uuid, p_user uuid) returns boolean
language sql as $$
  select exists (select 1 from public.conversation_members cm
                   join public.conversations c on c.id = cm.conversation_id
                  where c.kind = 'project' and c.general_project_id = p_project
                    and cm.user_id = p_user);
$$;

create or replace function pg_temp.in_space(p_project uuid, p_user uuid) returns boolean
language sql as $$
  select exists (select 1 from public.general_space_members sm
                   join public.general_projects gp on gp.space_id = sm.space_id
                  where gp.id = p_project and sm.user_id = p_user);
$$;

-- The PM moves M to stakeholder and back.
do $$
declare
  v_p    uuid := (select v from fx where k = 'p');
  v_pm   uuid := (select v from fx where k = 'pm');
  v_m    uuid := (select v from fx where k = 'm');
  v_q    uuid := (select v from fx where k = 'q');
  v_team uuid := (select v from fx where k = 'team');
  v_d    uuid;
  v_d2   uuid;
  v_poll uuid;
  v_opt  uuid;
begin
  perform pg_temp.act_as(v_pm);
  v_d := public.start_general_discussion(v_p, null, 'Zz SH discussion');
  perform public.send_general_discussion_message(v_d, 'Zz first word');
  perform public.set_general_team_leader(v_team, v_m);
  perform public.grant_general_permission(v_p, v_m, 'manage_tasks');

  perform pg_temp.must_be('before: M is in the project chat', pg_temp.in_chat(v_p, v_m));
  perform pg_temp.must_be('...leads the team',
    (select leader_id = v_m from public.general_teams where id = v_team));
  perform pg_temp.must_be('...holds a grant',
    exists (select 1 from public.general_grants where project_id = v_p and user_id = v_m));
  perform pg_temp.must_be('...and has an open access request',
    exists (select 1 from public.general_access_requests
             where project_id = v_p and user_id = v_m and status = 'open'));
  perform pg_temp.act_as(v_m);
  perform pg_temp.must_be('...and reads the discussion',
    (select count(*) from public.general_discussions where project_id = v_p) = 1);

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_allow('the pm makes M a stakeholder',
    format($q$select public.set_general_member_role(%L, %L, 'stakeholder')$q$, v_p, v_m));
  perform pg_temp.must_be('M is a stakeholder',
    (select role = 'stakeholder' from public.general_members where project_id = v_p and user_id = v_m));
  perform pg_temp.must_be('M is out of the project chat', not pg_temp.in_chat(v_p, v_m));
  perform pg_temp.must_be('M no longer leads the team',
    (select leader_id is null from public.general_teams where id = v_team));
  perform pg_temp.must_be('M''s grants are gone',
    not exists (select 1 from public.general_grants where project_id = v_p and user_id = v_m));
  perform pg_temp.must_be('M''s access request is withdrawn',
    not exists (select 1 from public.general_access_requests
                 where project_id = v_p and user_id = v_m and status = 'open'));
  perform pg_temp.must_be('M stays in the space', pg_temp.in_space(v_p, v_m));

  -- One discussion runs at a time: the PM stops the first and starts another,
  -- with a poll, while M is a stakeholder.
  perform public.stop_general_discussion(v_d);
  v_d2 := public.start_general_discussion(v_p, null, 'Zz SH second');
  perform public.send_general_discussion_message(v_d2, 'Zz second word');
  perform public.create_general_discussion_poll(v_d2, 'Zz which?', array['One', 'Two']);
  select id into v_poll from public.general_discussion_polls where discussion_id = v_d2;
  select id into v_opt from public.general_discussion_poll_options where poll_id = v_poll order by position limit 1;
  perform pg_temp.act_as_service();  -- notifications are read as their owner otherwise
  perform pg_temp.must_be('a new discussion notifies the qa',
    exists (select 1 from public.notifications
             where user_id = v_q and type = 'discussion_started' and title = 'Zz SH second'));
  perform pg_temp.must_be('...but not the stakeholder',
    not exists (select 1 from public.notifications
                 where user_id = v_m and type = 'discussion_started' and title = 'Zz SH second'));

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_be('stakeholder M reads no discussions',
    (select count(*) from public.general_discussions where project_id = v_p) = 0);
  perform pg_temp.must_be('...no discussion messages',
    (select count(*) from public.general_discussion_messages where project_id = v_p) = 0);
  perform pg_temp.must_be('...no polls, options or votes',
    (select count(*) from public.general_discussion_polls where project_id = v_p) = 0
    and (select count(*) from public.general_discussion_poll_options where project_id = v_p) = 0);
  perform pg_temp.must_be('...and no discussion recordings or files',
    not public.discussion_voice_readable(v_p || '/' || v_d2 || '/x.webm'));
  perform pg_temp.must_be('...and no project chat',
    not exists (select 1 from public.conversations where kind = 'project' and general_project_id = v_p));
  perform pg_temp.must_refuse_with('stakeholder M posts in the discussion',
    format($q$select public.send_general_discussion_message(%L, 'Zz no')$q$, v_d2),
    'not on this project');
  perform pg_temp.must_refuse_with('...starts a discussion',
    format($q$select public.start_general_discussion(%L, null, 'Zz no')$q$, v_p),
    'not on this project');
  perform pg_temp.must_refuse_with('...votes in a poll',
    format($q$select public.cast_general_discussion_poll_vote(%L, true)$q$, v_opt),
    'not on this project');
  perform pg_temp.must_refuse_with('...uploads a recording',
    format($q$insert into storage.objects (bucket_id, name, owner_id)
              values ('discussion-voice', %L, %L)$q$, v_p || '/' || v_d2 || '/m.webm', v_m),
    'row-level security');

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_allow('the pm makes M a member again',
    format($q$select public.set_general_member_role(%L, %L, 'member')$q$, v_p, v_m));
  perform pg_temp.must_be('M is back in the project chat', pg_temp.in_chat(v_p, v_m));
  perform pg_temp.act_as(v_m);
  perform pg_temp.must_be('member M reads the discussions again',
    (select count(*) from public.general_discussions where project_id = v_p) = 2);
  perform pg_temp.must_be('...their messages and polls',
    (select count(*) from public.general_discussion_messages where project_id = v_p) >= 1
    and (select count(*) from public.general_discussion_polls where project_id = v_p) = 1);
  perform pg_temp.must_be('...the recordings',
    public.discussion_voice_readable(v_p || '/' || v_d2 || '/x.webm'));
  perform pg_temp.must_allow('member M posts in the discussion',
    format($q$select public.send_general_discussion_message(%L, 'Zz yes')$q$, v_d2));
  perform pg_temp.must_allow('...votes in the poll',
    format($q$select public.cast_general_discussion_poll_vote(%L, true)$q$, v_opt));
  perform pg_temp.must_allow('...uploads a recording',
    format($q$insert into storage.objects (bucket_id, name, owner_id)
              values ('discussion-voice', %L, %L)$q$, v_p || '/' || v_d2 || '/m.webm', v_m));
  perform pg_temp.act_as_service();
end $$;

-- Who sets the role.
do $$
declare
  v_p  uuid := (select v from fx where k = 'p');
  v_pm uuid := (select v from fx where k = 'pm');
  v_m  uuid := (select v from fx where k = 'm');
  v_c  uuid := (select v from fx where k = 'c');
  v_c2 uuid := (select v from fx where k = 'c2');
begin
  perform pg_temp.act_as(v_c);
  perform pg_temp.must_allow('a coordinator makes a member a stakeholder',
    format($q$select public.set_general_member_role(%L, %L, 'stakeholder')$q$, v_p, v_m));
  perform pg_temp.must_be('...who is out of the chat', not pg_temp.in_chat(v_p, v_m));
  perform pg_temp.must_allow('...and back to member',
    format($q$select public.set_general_member_role(%L, %L, 'member')$q$, v_p, v_m));
  perform pg_temp.must_be('...who is back in the chat', pg_temp.in_chat(v_p, v_m));
  perform pg_temp.must_refuse_with('a coordinator cannot make a coordinator a stakeholder',
    format($q$select public.set_general_member_role(%L, %L, 'stakeholder')$q$, v_p, v_c2),
    'Only the project manager can change a coordinator or the project manager.');
  perform pg_temp.must_refuse_with('...nor the pm',
    format($q$select public.set_general_member_role(%L, %L, 'stakeholder')$q$, v_p, v_pm),
    'Only the project manager can change a coordinator or the project manager.');
  perform pg_temp.must_refuse_with('...nor set qa',
    format($q$select public.set_general_member_role(%L, %L, 'qa')$q$, v_p, v_m),
    'QA and stakeholder roles are not available yet.');

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('the pm cannot make themself a stakeholder',
    format($q$select public.set_general_member_role(%L, %L, 'stakeholder')$q$, v_p, v_pm),
    'Use hand over to change the project manager.');
  perform pg_temp.must_refuse_with('the pm still cannot set qa',
    format($q$select public.set_general_member_role(%L, %L, 'qa')$q$, v_p, v_m),
    'QA and stakeholder roles are not available yet.');
  perform pg_temp.must_allow('the pm makes a coordinator a stakeholder',
    format($q$select public.set_general_member_role(%L, %L, 'stakeholder')$q$, v_p, v_c2));
  perform pg_temp.must_be('...who is out of the chat', not pg_temp.in_chat(v_p, v_c2));
  perform pg_temp.act_as_service();
end $$;

-- Invitations and join codes.
do $$
declare
  v_p    uuid := (select v from fx where k = 'p');
  v_pm   uuid := (select v from fx where k = 'pm');
  v_c    uuid := (select v from fx where k = 'c');
  v_x    uuid := (select v from fx where k = 'x');
  v_y    uuid := (select v from fx where k = 'y');
  v_z    uuid := (select v from fx where k = 'z');
  v_inv  public.general_invitations;
  v_code text;
begin
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('the pm cannot invite as qa',
    format($q$select public.invite_to_general_project(%L, %L, 'qa')$q$, v_p, v_x),
    'QA and stakeholder roles are not available yet.');
  v_inv := public.invite_to_general_project(v_p, v_x, 'stakeholder');
  perform pg_temp.must_be('the pm invites X as a stakeholder', v_inv.role = 'stakeholder');
  v_inv := public.invite_to_general_project(v_p, v_y, 'member');

  perform pg_temp.act_as(v_x);
  perform pg_temp.must_allow('X accepts',
    format($q$select public.respond_general_invitation(%L, true)$q$,
           (select id from public.general_invitations where project_id = v_p and invitee = v_x)));
  perform pg_temp.must_be('X is a stakeholder',
    (select role = 'stakeholder' from public.general_members where project_id = v_p and user_id = v_x));
  perform pg_temp.must_be('...not in the project chat', not pg_temp.in_chat(v_p, v_x));
  perform pg_temp.must_be('...and not in the space', not pg_temp.in_space(v_p, v_x));
  perform pg_temp.must_be('...but reads the project',
    exists (select 1 from public.general_projects where id = v_p));

  perform pg_temp.act_as(v_y);
  perform public.respond_general_invitation(
    (select id from public.general_invitations where project_id = v_p and invitee = v_y), true);
  perform pg_temp.must_be('Y, invited as a member, is in the chat', pg_temp.in_chat(v_p, v_y));
  perform pg_temp.must_be('...and in the space', pg_temp.in_space(v_p, v_y));

  perform pg_temp.act_as(v_c);
  perform pg_temp.must_refuse_with('a coordinator cannot invite as coordinator',
    format($q$select public.invite_to_general_project(%L, %L, 'coordinator')$q$, v_p, v_z),
    'Only the project manager can invite a coordinator.');
  perform pg_temp.must_refuse_with('...nor as qa',
    format($q$select public.invite_to_general_project(%L, %L, 'qa')$q$, v_p, v_z),
    'QA and stakeholder roles are not available yet.');
  v_inv := public.invite_to_general_project(v_p, v_z, 'stakeholder');
  perform pg_temp.must_be('a coordinator invites Z as a stakeholder', v_inv.role = 'stakeholder');

  perform pg_temp.act_as(v_pm);
  v_code := public.set_general_join_code(v_p, true);
  perform pg_temp.act_as(v_z);
  perform pg_temp.must_be('Z joins by the code', public.join_general_project(v_code) = v_p);
  perform pg_temp.must_be('...as the stakeholder the invitation made them',
    (select role = 'stakeholder' from public.general_members where project_id = v_p and user_id = v_z));
  perform pg_temp.must_be('...out of the chat and the space',
    not pg_temp.in_chat(v_p, v_z) and not pg_temp.in_space(v_p, v_z));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ class board

-- A class board's hidden Files project: every row is a member by role, so its
-- members keep every write they had.
do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_board uuid;
  gp uuid; v_task uuid;
begin
  select c.id, c.professor_id into v_class, v_prof from public.classes c
   where (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-stakeholders', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Zz SH group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id) values (v_group, v_set, v_a), (v_group, v_set, v_b);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'Zz SH lab', 'activity', 1, 1, 'group', v_set, now() + interval '7 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_group;

  perform pg_temp.act_as(v_a);
  gp := public.ensure_class_board_repo(v_board);
  perform pg_temp.must_be('a class-board member can write', public.general_can_write(gp));
  perform pg_temp.must_allow('...adds a task there',
    format($q$insert into public.general_tasks (project_id, title) values (%L, 'Zz board task')$q$, gp));
  v_task := (select id from public.general_tasks where project_id = gp and title = 'Zz board task');
  perform pg_temp.must_allow('...and comments on it',
    format($q$insert into public.general_task_comments (task_id, project_id, body)
              values (%L, %L, 'Zz board comment')$q$, v_task, gp));
  perform pg_temp.act_as_service();
end $$;

rollback;
