-- Work-space helpers — rolled back.
--
--   node scripts/db.mjs supabase/tests/work-automation.test.sql

begin;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

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

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_proj uuid; v_a uuid; v_b uuid; v_out uuid := gen_random_uuid();
begin
  -- A live work project with two active members.
  select m.project_id into v_proj
    from public.general_members m
    join public.general_projects p on p.id = m.project_id
    join public.profiles pr on pr.id = m.user_id and pr.status = 'active'
   where p.archived_at is null
   group by m.project_id
  having count(*) >= 2
   limit 1;
  select m.user_id into v_a from public.general_members m
    join public.profiles pr on pr.id = m.user_id and pr.status = 'active'
   where m.project_id = v_proj order by m.user_id limit 1;
  select m.user_id into v_b from public.general_members m
    join public.profiles pr on pr.id = m.user_id and pr.status = 'active'
   where m.project_id = v_proj and m.user_id <> v_a order by m.user_id limit 1;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (v_out, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-work-out@example.test', '', now(), now());
  insert into public.profiles (id, first_name, last_name, email, role, status)
  values (v_out, 'Zz', 'Outsider', 'zz-work-out@example.test', 'student', 'active');

  delete from public.general_project_visits where project_id = v_proj and user_id = v_a;

  create temp table fx (k text primary key, v uuid) on commit drop;
  insert into fx values ('proj', v_proj), ('a', v_a), ('b', v_b), ('out', v_out);
  grant select on fx to authenticated;
end $$;

-- ------------------------------------------------------------ since last visit

do $$
declare
  v_proj uuid := (select v from fx where k='proj');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_out uuid := (select v from fx where k='out');
  r jsonb; v_done uuid; v_mine uuid; refused boolean;
begin
  perform pg_temp.act_as(v_a);
  r := public.general_since_last_visit(v_proj);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a first visit says nothing', (r ->> 'first_visit')::boolean);

  -- Away for an hour.
  update public.general_project_visits set seen_at = now() - interval '1 hour'
   where user_id = v_a and project_id = v_proj;

  -- Meanwhile B finishes a task, gives A one, and comments on it.
  insert into public.general_tasks (project_id, title, created_by, status, completed_at)
  values (v_proj, 'zz finished by b', v_b, 'done', now()) returning id into v_done;
  insert into public.general_tasks (project_id, title, created_by)
  values (v_proj, 'zz for a', v_b) returning id into v_mine;
  insert into public.general_task_assignees (task_id, project_id, user_id, assigned_by)
  values (v_mine, v_proj, v_a, v_b);
  insert into public.general_task_comments (task_id, project_id, author_id, body)
  values (v_mine, v_proj, v_b, 'zz over to you');

  perform pg_temp.act_as(v_a);
  r := public.general_since_last_visit(v_proj);
  perform pg_temp.act_as_service();

  perform pg_temp.must_be('coming back reports the finished task',
    r -> 'tasks_done' @> jsonb_build_array(jsonb_build_object('id', v_done, 'title', 'zz finished by b')));
  perform pg_temp.must_be('...the task given to me',
    r -> 'assigned_to_me' @> jsonb_build_array(jsonb_build_object('id', v_mine, 'title', 'zz for a')));
  perform pg_temp.must_be('...the comment on it', (r ->> 'comments_on_mine')::int >= 1);
  perform pg_temp.must_be('...and the new tasks', (r ->> 'tasks_added')::int >= 2);

  -- A reload a minute later keeps the same "since".
  perform pg_temp.act_as(v_a);
  r := public.general_since_last_visit(v_proj);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a reload keeps the summary',
    r -> 'tasks_done' @> jsonb_build_array(jsonb_build_object('id', v_done, 'title', 'zz finished by b')));

  -- Someone off the project learns nothing.
  perform pg_temp.act_as(v_out);
  refused := false;
  begin
    perform public.general_since_last_visit(v_proj);
  exception when others then refused := true;
  end;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a non-member is refused', refused);

  perform pg_temp.must_be('visits are private',
    exists (select 1 from pg_policies where tablename = 'general_project_visits'
             and policyname = 'general_project_visits_own'));
end $$;

rollback;
