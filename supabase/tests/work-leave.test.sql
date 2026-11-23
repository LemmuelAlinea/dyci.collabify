-- supabase/tests/work-leave.test.sql
-- Leave and cover: away days recorded as a range by the person or a space
-- planner, leaves as runs of weekdays, away ranges for the space, the impact
-- check and its notices, and temporary cover. Rolls back.
--
-- The file under test must already be applied:
--   node scripts/db.mjs supabase/tests/work-leave.test.sql
begin;

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.service() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.check(p_label text, p_ok boolean) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL %', p_label; end if;
  raise notice 'PASS %', p_label;
end $$;

create or replace function pg_temp.refuse(p_label text, p_sql text, p_needle text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_needle in sqlerrm) > 0 then
      raise notice 'PASS %', p_label;
      return;
    end if;
    raise exception 'FAIL % (refused for another reason: %)', p_label, sqlerrm;
  end;
  raise exception 'FAIL % (not refused)', p_label;
end $$;

-- A fixed Monday well in the future, so weekday maths is predictable.
create or replace function pg_temp.mon() returns date language sql as $$
  select ((now() at time zone 'Asia/Manila')::date + 28)
         - (extract(isodow from (now() at time zone 'Asia/Manila')::date + 28)::int - 1);
$$;

------------------------------------------------------------ recording leave
do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                    gen_random_uuid(), gen_random_uuid()];
  -- 1 space A pm, 2 space A coordinator, 3 Ann (A and B), 4 Bo (A), 5 space B pm, 6 outsider
  a uuid; b uuid; m date := pg_temp.mon(); n int;
begin
  for k in 1..6 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-leave-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-leave-'||k||'@example.test', 'Leave', k::text, 'member', 'active', false, k in (1, 5, 6))
      on conflict(id) do update set role = 'member', status = 'active', can_teach = false,
        can_manage_projects = excluded.can_manage_projects;
  end loop;
  perform pg_temp.act_as(u[1]);
  a := (public.create_general_space('Zz leave A', '')).id;
  perform pg_temp.act_as(u[5]);
  b := (public.create_general_space('Zz leave B', '')).id;
  perform pg_temp.act_as(u[6]);
  perform public.create_general_space('Zz leave outside', '');
  perform pg_temp.service();
  insert into public.general_space_members(space_id, user_id, role) values
    (a, u[2], 'coordinator'), (a, u[3], 'member'), (a, u[4], 'member'), (b, u[3], 'member');

  perform pg_temp.act_as(u[3]);
  n := public.save_time_off_range(u[3], m, m + 4, null);
  perform pg_temp.check('person saves own range',
    n = 5 and (select count(*) = 5 from public.user_time_off where user_id = u[3] and added_by is null));
  n := public.save_time_off_range(u[3], m + 11, m + 14, 120);
  perform pg_temp.check('weekend skipped',
    n = 2 and (select count(*) = 2 from public.user_time_off where user_id = u[3] and off_on between m + 11 and m + 14)
    and (select bool_and(minutes = 120) from public.user_time_off where user_id = u[3] and off_on between m + 11 and m + 14));

  perform pg_temp.act_as(u[2]);
  n := public.save_time_off_range(u[4], m, m + 2, null);
  perform pg_temp.service();
  perform pg_temp.check('planner saves range',
    n = 3 and (select bool_and(added_by = u[2]) from public.user_time_off where user_id = u[4]));

  perform pg_temp.act_as(u[5]);
  perform public.save_time_off_range(u[3], m + 21, m + 21, null);
  perform pg_temp.service();
  perform pg_temp.check('planner from other space',
    exists (select 1 from public.user_time_off where user_id = u[3] and off_on = m + 21 and added_by = u[5]));

  perform pg_temp.act_as(u[4]);
  perform pg_temp.refuse('member refused',
    format('select public.save_time_off_range(%L, %L, %L, null)', u[3], m, m), 'You can''t mark this person away.');
  perform pg_temp.act_as(u[6]);
  perform pg_temp.refuse('outsider planner refused',
    format('select public.save_time_off_range(%L, %L, %L, null)', u[3], m, m), 'You can''t mark this person away.');
  perform pg_temp.act_as(u[3]);
  perform pg_temp.refuse('bad range refused',
    format('select public.save_time_off_range(%L, %L, %L, null)', u[3], m + 3, m), 'Choose a start date on or before the end date.');
  perform pg_temp.refuse('long range refused',
    format('select public.save_time_off_range(%L, %L, %L, null)', u[3], m, m + 120), 'Choose 60 days or fewer.');

  -- Planners remove only what planners added.
  perform pg_temp.act_as(u[4]);
  perform public.save_time_off_range(u[4], m + 7 + 2, m + 7 + 2, null);
  perform pg_temp.act_as(u[2]);
  perform public.save_time_off_range(u[4], m + 7, m + 7 + 1, null);
  perform public.save_time_off_range(u[4], m + 7 + 3, m + 7 + 4, null);
  n := public.remove_time_off_range(u[4], m + 7, m + 7 + 4);
  perform pg_temp.service();
  perform pg_temp.check('planner removes only planner rows',
    n = 4 and (select array_agg(off_on) = array[m + 9] from public.user_time_off
                where user_id = u[4] and off_on between m + 7 and m + 11));
  perform pg_temp.act_as(u[2]);
  perform public.save_time_off_range(u[4], m + 9, m + 9, 60);
  n := public.remove_time_off_range(u[4], m + 9, m + 9);
  perform pg_temp.service();
  perform pg_temp.check('planner overwrite keeps person row',
    n = 0 and (select added_by is null and minutes = 60 from public.user_time_off where user_id = u[4] and off_on = m + 9));
  perform pg_temp.act_as(u[4]);
  n := public.remove_time_off_range(u[4], m, m + 13);
  perform pg_temp.check('person removes any',
    n = 4 and not exists (select 1 from public.user_time_off where user_id = u[4]));

  -- Runs.
  perform pg_temp.service();
  delete from public.user_time_off where user_id = u[3];
  insert into public.user_time_off(user_id, off_on) values (u[3], m + 3), (u[3], m + 4), (u[3], m + 7);
  perform pg_temp.check('runs join over weekend',
    (select count(*) = 1 from public.work_leave_runs(u[3], m))
    and (select first_day = m + 3 and last_day = m + 7 and not part_day from public.work_leave_runs(u[3], m)));
  insert into public.user_time_off(user_id, off_on, minutes) values (u[3], m + 9, 60);
  perform pg_temp.check('runs split by a weekday',
    (select count(*) = 2 from public.work_leave_runs(u[3], m))
    and (select part_day from public.work_leave_runs(u[3], m) where first_day = m + 9));
  perform pg_temp.check('runs before a date dropped',
    (select count(*) = 1 from public.work_leave_runs(u[3], m + 8)));

  perform pg_temp.act_as(u[4]);
  perform pg_temp.check('away ranges readable in space',
    (select count(*) = 2 from public.space_away_ranges(a) where user_id = u[3]));
  perform pg_temp.check('own rows policy unchanged',
    not exists (select 1 from public.user_time_off where user_id = u[3]));
  perform pg_temp.act_as(u[6]);
  perform pg_temp.check('outside space sees none',
    not exists (select 1 from public.space_away_ranges(a)));
  perform pg_temp.service();
end $$;

rollback;
