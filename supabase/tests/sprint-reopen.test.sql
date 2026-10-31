-- supabase/tests/sprint-reopen.test.sql
-- Running a finished sprint again on a work project. Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/sprint-reopen.test.sql
begin;

-- Released rows below are trusted historical fixtures for the original work-flow checks.

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

/** Runs a statement and asserts it is refused. */
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
  v_ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_names text[] := array['Owner', 'Coord', 'Member'];
  i int;
  a uuid; c uuid; m uuid;
  p uuid; v_inv uuid;
  s1 uuid; s2 uuid; s3 uuid;
begin
  for i in 1..3 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_user_meta_data, created_at, updated_at)
    values (v_ids[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-reopen-' || lower(v_names[i]) || '@example.test', '',
            jsonb_build_object('first_name', 'Zzreopen', 'last_name', v_names[i], 'role', 'professor'),
            now(), now());
  end loop;
  update public.profiles set can_teach = true, can_manage_projects = true
   where id = any (v_ids) and role = 'member';
  a := v_ids[1]; c := v_ids[2]; m := v_ids[3];

  perform pg_temp.act_as(a);
  p := (public.create_general_project('Zz reopen project')).id;
  select id into v_inv from public.invite_to_general_project(p, c);
  perform pg_temp.act_as(c);
  perform public.respond_general_invitation(v_inv, true);
  perform pg_temp.act_as(a);
  select id into v_inv from public.invite_to_general_project(p, m);
  perform pg_temp.act_as(m);
  perform public.respond_general_invitation(v_inv, true);
  perform pg_temp.act_as_service();
  update public.general_members set role = 'coordinator' where project_id = p and user_id = c;

  perform pg_temp.act_as(a);
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Sprint 1', current_date - 14, current_date - 1) returning id into s1;
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Sprint 2', current_date, current_date + 13) returning id into s2;
  insert into public.general_sprints (project_id, name, starts_on, ends_on)
  values (p, 'Sprint 3', current_date + 14, current_date + 27) returning id into s3;
  update public.general_sprints set state = 'active' where id = s1;
  perform public.complete_general_sprint(s1, null);
  update public.general_sprints set state = 'active' where id = s2;
  update public.general_sprints set archived = true where id = s1;

  ------------------------------------------------------------ the guard still holds
  perform pg_temp.must_refuse('a finished sprint cannot be set running directly',
    format($q$update public.general_sprints set state = 'active' where id = %L$q$, s1));
  perform pg_temp.must_refuse('a running sprint cannot be set planned directly',
    format($q$update public.general_sprints set state = 'planned' where id = %L$q$, s2));

  ------------------------------------------------------------ who may
  perform pg_temp.act_as(m);
  perform pg_temp.must_refuse('a member cannot run a finished sprint again',
    format('select public.reopen_general_sprint(%L)', s1));
  perform pg_temp.act_as(a);
  perform pg_temp.must_refuse('a sprint that is not finished cannot be reopened',
    format('select public.reopen_general_sprint(%L)', s3));

  ------------------------------------------------------------ the project manager
  perform public.reopen_general_sprint(s1);
  perform pg_temp.must_be('the finished sprint runs again, unarchived, with no finish time',
    (select state = 'active' and not archived and completed_at is null and started_at is not null
       from public.general_sprints where id = s1));
  perform pg_temp.must_be('the sprint that was running goes back to planned, never started',
    (select state = 'planned' and started_at is null from public.general_sprints where id = s2));
  perform pg_temp.must_be('one sprint runs at a time',
    (select count(*) = 1 from public.general_sprints where project_id = p and state = 'active'));
  perform pg_temp.must_be('the reopen switch is off again afterwards',
    coalesce(current_setting('collabify.sprint_reopen', true), 'off') <> 'on');
  perform pg_temp.must_refuse('after a reopen, a direct backward move is still refused',
    format($q$update public.general_sprints set state = 'planned' where id = %L$q$, s1));

  ------------------------------------------------------------ a coordinator
  perform public.complete_general_sprint(s1, null);
  update public.general_sprints set state = 'active' where id = s2;
  perform pg_temp.act_as(c);
  perform public.reopen_general_sprint(s1);
  perform pg_temp.must_be('a coordinator can run a finished sprint again',
    (select state from public.general_sprints where id = s1) = 'active');

  ------------------------------------------------------------ nothing running
  perform public.complete_general_sprint(s1, null);
  perform public.reopen_general_sprint(s1);
  perform pg_temp.must_be('it reopens when no other sprint is running',
    (select state from public.general_sprints where id = s1) = 'active');
end;
$$;

rollback;
