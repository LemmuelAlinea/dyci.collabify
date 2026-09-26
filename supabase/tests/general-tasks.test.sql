-- General tasks — rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/general-tasks.test.sql

begin;

-- ------------------------------------------------------------------ helpers

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

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 64);
      return;
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
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_names text[] := array['Owner', 'Bravo', 'Charlie', 'Outsider'];
  i int;
  v_project uuid;
  v_inv uuid;
begin
  for i in 1..4 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_user_meta_data, created_at, updated_at)
    values (v_ids[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-gtask-' || lower(v_names[i]) || '@example.test', '',
            jsonb_build_object('first_name', 'Zzgtask', 'last_name', v_names[i],
                               'role', 'professor'),
            now(), now());
  -- General accounts are approved faculty now: supabase/access.sql.
  update public.profiles set status = 'active' where created_at = now() and role = 'professor' and status = 'pending';
  end loop;

  perform pg_temp.act_as(v_ids[1]);
  select (public.create_general_project('Zz Recognition day')).id into v_project;
  for i in 2..3 loop
    perform pg_temp.act_as(v_ids[1]);
    select id into v_inv from public.invite_to_general_project(v_project, v_ids[i]);
    perform pg_temp.act_as(v_ids[i]);
    perform public.respond_general_invitation(v_inv, true);
  end loop;
  perform pg_temp.act_as_service();

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values ('a', v_ids[1]), ('b', v_ids[2]), ('c', v_ids[3]), ('d', v_ids[4]),
                        ('project', v_project);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ creating and reading

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  d uuid := (select v from fx where k = 'd');
  p uuid := (select v from fx where k = 'project');
  t_a uuid; t_b uuid; t_w uuid;
begin
  perform pg_temp.act_as(a);
  insert into public.general_tasks (project_id, title) values (p, 'Book the gym') returning id into t_a;

  perform pg_temp.act_as(d);
  perform pg_temp.must_be('a non-member cannot read tasks',
    not exists (select 1 from public.general_tasks where id = t_a));
  perform pg_temp.act_as(b);
  perform pg_temp.must_be('...while a member can',
    exists (select 1 from public.general_tasks where id = t_a));

  insert into public.general_tasks (project_id, title, created_by)
  values (p, 'Print certificates', a) returning id into t_b;
  perform pg_temp.must_be('a task is always created by the caller, whatever was sent',
    (select created_by = b from public.general_tasks where id = t_b));

  perform pg_temp.must_refuse('a Member cannot set points when creating a task',
    format($q$insert into public.general_tasks (project_id, title, weight) values (%L, 'Stage', 5)$q$, p));
  perform pg_temp.act_as(a);
  insert into public.general_tasks (project_id, title, weight) values (p, 'Stage design', 5)
  returning id into t_w;
  perform pg_temp.must_be('...while an Owner can', t_w is not null);

  perform pg_temp.act_as_service();
  insert into fx values ('t_a', t_a), ('t_b', t_b), ('t_w', t_w);
end $$;

-- ------------------------------------------------------------------ claiming and editing

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  c uuid := (select v from fx where k = 'c');
  p uuid := (select v from fx where k = 'project');
  t_b uuid := (select v from fx where k = 't_b');
begin
  perform pg_temp.act_as(c);
  perform pg_temp.must_allow('a member claims a task nobody holds',
    format('insert into public.general_task_assignees (task_id, project_id, user_id) values (%L, %L, %L)', t_b, p, c));

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('a second member cannot claim a held task',
    format('insert into public.general_task_assignees (task_id, project_id, user_id) values (%L, %L, %L)', t_b, p, b));
  perform pg_temp.must_refuse('the creator cannot edit a task somebody else holds',
    format($q$update public.general_tasks set title = 'Print the certificates' where id = %L$q$, t_b));

  perform pg_temp.act_as(c);
  perform pg_temp.must_allow('the holder moves it along',
    format($q$update public.general_tasks set status = 'in_progress' where id = %L$q$, t_b));
  perform pg_temp.must_refuse('the holder cannot change its points',
    format('update public.general_tasks set weight = 3 where id = %L', t_b));

  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('an Owner unassigns the holder',
    format('delete from public.general_task_assignees where task_id = %L and user_id = %L', t_b, c));
  perform pg_temp.must_allow('...and reassigns it to somebody else',
    format('insert into public.general_task_assignees (task_id, project_id, user_id) values (%L, %L, %L)', t_b, p, b));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ files, logs, comments

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  c uuid := (select v from fx where k = 'c');
  d uuid := (select v from fx where k = 'd');
  p uuid := (select v from fx where k = 'project');
  t_b uuid := (select v from fx where k = 't_b');
begin
  perform pg_temp.act_as(c);
  perform pg_temp.must_refuse('a Member cannot add a file to a task they do not hold',
    format($q$insert into public.general_task_files (task_id, project_id, file_path, file_name, size_bytes)
              values (%L, %L, %L, 'plan.pdf', 10)$q$, t_b, p, p || '/' || t_b || '/1-plan.pdf'));

  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('an Owner grants edit_files',
    format('select public.grant_general_permission(%L, %L, %L)', p, c, 'edit_files'));
  perform pg_temp.act_as(c);
  perform pg_temp.must_allow('...and the Member adds a file to any task',
    format($q$insert into public.general_task_files (task_id, project_id, file_path, file_name, size_bytes)
              values (%L, %L, %L, 'plan.pdf', 10)$q$, t_b, p, p || '/' || t_b || '/2-plan.pdf'));
  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('the Owner revokes edit_files',
    format('select public.revoke_general_permission(%L, %L, %L)', p, c, 'edit_files'));
  perform pg_temp.act_as(c);
  perform pg_temp.must_refuse('...and the Member cannot add a file again',
    format($q$insert into public.general_task_files (task_id, project_id, file_path, file_name, size_bytes)
              values (%L, %L, %L, 'plan.pdf', 10)$q$, t_b, p, p || '/' || t_b || '/3-plan.pdf'));

  perform pg_temp.act_as(b);
  perform pg_temp.must_allow('the holder logs time',
    format($q$insert into public.general_task_logs (task_id, project_id, minutes, note) values (%L, %L, 30, 'Layout')$q$, t_b, p));
  perform pg_temp.act_as(c);
  perform pg_temp.must_refuse('somebody who does not hold it cannot log time on it',
    format($q$insert into public.general_task_logs (task_id, project_id, minutes) values (%L, %L, 30)$q$, t_b, p));

  perform pg_temp.act_as(d);
  perform pg_temp.must_refuse('an outsider cannot comment',
    format($q$insert into public.general_task_comments (task_id, project_id, body) values (%L, %L, 'Hi')$q$, t_b, p));
  perform pg_temp.act_as(c);
  perform pg_temp.must_allow('any member can comment',
    format($q$insert into public.general_task_comments (task_id, project_id, body) values (%L, %L, 'Paper is in the office')$q$, t_b, p));

  perform pg_temp.act_as(a);
  perform pg_temp.must_be('history records the task being created',
    exists (select 1 from public.general_task_events where task_id = t_b and kind = 'created'));
  perform pg_temp.must_be('history records who it was assigned to',
    exists (select 1 from public.general_task_events
             where task_id = t_b and kind = 'assigned' and detail ->> 'user_id' = b::text));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ done, progress, archive

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
  t_a uuid := (select v from fx where k = 't_a');
  t_b uuid := (select v from fx where k = 't_b');
begin
  perform pg_temp.act_as(b);
  update public.general_tasks set status = 'done' where id = t_b;
  perform pg_temp.must_be('finishing a task stamps when',
    (select completed_at is not null from public.general_tasks where id = t_b));
  update public.general_tasks set status = 'todo' where id = t_b;
  perform pg_temp.must_be('reopening it clears the stamp',
    (select completed_at is null from public.general_tasks where id = t_b));

  perform pg_temp.act_as(a);
  update public.general_tasks set status = 'done' where id = t_a;
  -- Three tasks weighing 1, 1 and 5, with the first one done.
  perform pg_temp.must_be('points off: progress counts finished tasks',
    (select progress_pct = 33.3 from public.general_project_overview where id = p));
  update public.general_projects set points_enabled = true where id = p;
  perform pg_temp.must_be('points on: progress weighs finished tasks',
    (select progress_pct = 14.3 from public.general_project_overview where id = p));

  perform pg_temp.act_as(b);
  delete from public.general_tasks where id = t_a;
  perform pg_temp.must_be('a Member cannot delete somebody else''s task',
    exists (select 1 from public.general_tasks where id = t_a));

  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('an Owner archives the project',
    format('select public.archive_general_project(%L, true)', p));
  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('nobody adds a task to an archived project',
    format($q$insert into public.general_tasks (project_id, title) values (%L, 'Late idea')$q$, p));
  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('the Owner restores it',
    format('select public.archive_general_project(%L, false)', p));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ file paths tied to their task

do $$
declare
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
  t_b uuid := (select v from fx where k = 't_b');
begin
  -- b still holds t_b from the claiming-and-editing block above.
  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('a file path outside its task folder is refused',
    format($q$insert into public.general_task_files (task_id, project_id, file_path, file_name, size_bytes)
              values (%L, %L, 'not-the-right-folder/plan.pdf', 'plan.pdf', 10)$q$, t_b, p));
  perform pg_temp.must_allow('...while a path inside its own task folder is allowed',
    format($q$insert into public.general_task_files (task_id, project_id, file_path, file_name, size_bytes)
              values (%L, %L, %L, 'plan.pdf', 10)$q$, t_b, p, p || '/' || t_b || '/4-plan.pdf'));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ a team delete lets a structure manager through

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  c uuid := (select v from fx where k = 'c');
  p uuid := (select v from fx where k = 'project');
  v_team uuid;
  t_team uuid;
begin
  perform pg_temp.act_as(a);
  insert into public.general_teams (project_id, name) values (p, 'Zz Ushers') returning id into v_team;
  insert into public.general_tasks (project_id, team_id, title) values (p, v_team, 'Greet guests')
    returning id into t_team;
  insert into public.general_task_assignees (task_id, project_id, user_id) values (t_team, p, b);
  perform pg_temp.must_allow('an Owner grants manage_structure only',
    format('select public.grant_general_permission(%L, %L, %L)', p, c, 'manage_structure'));

  -- c holds neither manage_tasks nor this task, but deleting the team cascades
  -- into an UPDATE on general_tasks that only clears team_id.
  perform pg_temp.act_as(c);
  perform pg_temp.must_allow(
    'a Member with manage_structure but not manage_tasks deletes a team holding an assigned task',
    format('delete from public.general_teams where id = %L', v_team));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the task survives the team delete with team_id cleared',
    (select team_id is null from public.general_tasks where id = t_team));
end $$;

-- ------------------------------------------------------------------ assigning a deactivated member

do $$
declare
  a uuid := (select v from fx where k = 'a');
  c uuid := (select v from fx where k = 'c');
  p uuid := (select v from fx where k = 'project');
  t_w uuid := (select v from fx where k = 't_w');
begin
  perform pg_temp.act_as_service();
  update public.profiles set status = 'rejected' where id = c;

  perform pg_temp.act_as(a);
  perform pg_temp.must_refuse('an Owner cannot assign a deactivated member',
    format('insert into public.general_task_assignees (task_id, project_id, user_id) values (%L, %L, %L)',
      t_w, p, c));

  perform pg_temp.act_as_service();
  update public.profiles set status = 'active' where id = c;
end $$;

-- ------------------------------------------------------------------ deactivated holder cannot write

do $$
declare
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
  t_b uuid := (select v from fx where k = 't_b');
begin
  perform pg_temp.act_as(b);
  perform pg_temp.must_allow('the holder logs time while active (control)',
    format($q$insert into public.general_task_logs (task_id, project_id, minutes, note)
              values (%L, %L, 15, 'Still active')$q$, t_b, p));

  perform pg_temp.act_as_service();
  update public.profiles set status = 'rejected' where id = b;

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('a deactivated holder cannot log time',
    format($q$insert into public.general_task_logs (task_id, project_id, minutes)
              values (%L, %L, 15)$q$, t_b, p));

  perform pg_temp.act_as_service();
  update public.profiles set status = 'active' where id = b;
end $$;

-- ------------------------------------------------------------------ a removed member's unfiltered writes

do $$
declare
  a uuid := (select v from fx where k = 'a');
  c uuid := (select v from fx where k = 'c');
  p uuid := (select v from fx where k = 'project');
  t_b uuid := (select v from fx where k = 't_b');
  t_c uuid;
begin
  perform pg_temp.act_as(c);
  insert into public.general_tasks (project_id, title) values (p, 'Fold programs') returning id into t_c;

  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('an Owner removes the member',
    format('select public.remove_general_member(%L, %L)', p, c));

  -- An unfiltered delete or update matches no rows under RLS rather than
  -- raising, so these are not must_refuse — the test is that nothing changes.
  perform pg_temp.act_as(c);
  delete from public.general_tasks where true;
  update public.general_task_comments set body = 'Nope';

  perform pg_temp.act_as_service();
  perform pg_temp.must_be(
    'a removed member''s unfiltered delete does not reach their own unheld task',
    exists (select 1 from public.general_tasks where id = t_c));
  perform pg_temp.must_be(
    'a removed member''s unfiltered update does not reach their old comment either',
    (select body = 'Paper is in the office' from public.general_task_comments
      where task_id = t_b and author_id = c));
end $$;

-- ------------------------------------------------------------------ catalog assertions

do $$
begin
  perform pg_temp.must_be('the helpers are closed to anon',
    not has_function_privilege('anon', 'public.general_task_held(uuid)', 'execute'));
  perform pg_temp.must_be('a malformed path segment parses to null',
    public.general_safe_uuid('not-a-uuid') is null);
  perform pg_temp.must_be('assignees are not in the realtime publication',
    not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'general_task_assignees'));
end $$;

-- ------------------------------------------------------------------ leaving an archived project

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
begin
  -- b still holds t_b, so leaving cascades into general_task_assignees while
  -- the project is archived.
  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('an Owner archives the project again',
    format('select public.archive_general_project(%L, true)', p));

  perform pg_temp.act_as(b);
  perform pg_temp.must_allow('a task holder can leave an archived project',
    format('select public.leave_general_project(%L)', p));

  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('the Owner restores the project once more',
    format('select public.archive_general_project(%L, false)', p));
  perform pg_temp.act_as_service();
end $$;

rollback;
