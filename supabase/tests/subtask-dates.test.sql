-- supabase/tests/subtask-dates.test.sql
-- A work task with subtasks follows their dates: it starts at the earliest
-- subtask start and is due at the latest subtask due, its first due date is kept
-- as planned_due_at, each move is a history row by whoever moved the subtask, and
-- nobody sets its dates by hand. Rolls back.
--
-- The file under test must already be applied:
--   node scripts/db.mjs supabase/tests/subtask-dates.test.sql
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

-- A Manila day and time as a timestamp.
create or replace function pg_temp.at(p_day date, p_time time) returns timestamptz language sql as $$
  select (p_day + p_time) at time zone 'Asia/Manila'
$$;

do $$
declare
  u uuid[] := array[gen_random_uuid(), gen_random_uuid()];
  s uuid; p uuid; par uuid; a uuid; b uuid; c uuid; q uuid; qa uuid;
  d date := date '2026-12-01';
  ev record;
begin
  for k in 1..2 loop
    insert into auth.users(id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      values(u[k], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'zz-subdates-'||k||'@example.test', '', now(), now());
    insert into public.profiles(id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
      values(u[k], 'zz-subdates-'||k||'@example.test', 'Sub', k::text, 'member', 'active', false, k = 1)
      on conflict(id) do update set role = 'member', status = 'active', can_manage_projects = excluded.can_manage_projects;
  end loop;
  perform pg_temp.act_as(u[1]);
  s := (public.create_general_space('Zz subdates space', '')).id;
  p := (public.create_general_project('Zz subdates project', '', null, null, null, null, s)).id;
  perform pg_temp.service();
  insert into public.general_space_members(space_id, user_id, role) values (s, u[2], 'member');
  insert into public.general_members(project_id, user_id, role) values (p, u[2], 'member');

  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, starts_at, due_at)
    values (p, 'Zz parent', 'released', now(), u[1], pg_temp.at(d, '09:00'), pg_temp.at(d + 3, '17:00'))
    returning id into par;

  -- One subtask due earlier: the parent follows it, and keeps its first due date as planned.
  insert into public.general_tasks(project_id, parent_id, title, routing_state, sent_at, created_by, starts_at, due_at)
    values (p, par, 'Zz part A', 'released', now(), u[1], pg_temp.at(d + 1, '10:00'), pg_temp.at(d + 2, '12:00'))
    returning id into a;
  perform pg_temp.check('parent follows its first subtask',
    (select starts_at = pg_temp.at(d + 1, '10:00') and due_at = pg_temp.at(d + 2, '12:00')
            and planned_due_at = pg_temp.at(d + 3, '17:00')
       from public.general_tasks where id = par));

  -- A later subtask pushes it out; the planned date stays the first one.
  insert into public.general_tasks(project_id, parent_id, title, routing_state, sent_at, created_by, due_at)
    values (p, par, 'Zz part B', 'released', now(), u[1], pg_temp.at(d + 7, '17:00'))
    returning id into b;
  perform pg_temp.check('latest subtask due wins',
    (select due_at = pg_temp.at(d + 7, '17:00') and starts_at = pg_temp.at(d + 1, '10:00')
            and planned_due_at = pg_temp.at(d + 3, '17:00')
       from public.general_tasks where id = par));

  -- A subtask with no dates changes nothing.
  insert into public.general_tasks(project_id, parent_id, title, routing_state, sent_at, created_by)
    values (p, par, 'Zz part C', 'released', now(), u[1]) returning id into c;
  perform pg_temp.check('an undated subtask leaves the dates',
    (select due_at = pg_temp.at(d + 7, '17:00') from public.general_tasks where id = par));

  -- A person re-dates a subtask: the parent moves, and its history names them.
  perform pg_temp.act_as(u[1]);
  update public.general_tasks set due_at = pg_temp.at(d + 4, '17:00') where id = b;
  perform pg_temp.service();
  perform pg_temp.check('re-dating a subtask moves the parent',
    (select due_at = pg_temp.at(d + 4, '17:00') from public.general_tasks where id = par));
  select * into ev from public.general_task_events
   where task_id = par and kind = 'updated' and detail ->> 'by' = 'subtasks'
     and (detail ->> 'due_to')::timestamptz = pg_temp.at(d + 4, '17:00');
  perform pg_temp.check('the move is in history by whoever moved the subtask',
    ev.id is not null and ev.actor_id = u[1] and ev.detail -> 'fields' ? 'due_at');

  -- Nobody sets the parent's dates or planned date by hand.
  perform pg_temp.act_as(u[1]);
  perform pg_temp.refuse('parent dates are not set by hand',
    format('update public.general_tasks set due_at = %L where id = %L', pg_temp.at(d + 9, '17:00'), par),
    'This task''s dates follow its subtasks. Change a subtask''s dates instead.');
  perform pg_temp.refuse('planned due date is not set by hand',
    format('update public.general_tasks set planned_due_at = null where id = %L', par),
    'The planned due date is kept by Collabify.');
  update public.general_tasks set due_at = pg_temp.at(d + 9, '17:00') where id = a;
  perform pg_temp.check('a task without subtasks keeps hand dates',
    (select due_at = pg_temp.at(d + 9, '17:00') from public.general_tasks where id = a));
  perform pg_temp.service();
  perform pg_temp.check('that re-date moved the parent too',
    (select due_at = pg_temp.at(d + 9, '17:00') from public.general_tasks where id = par));

  -- Trashing or moving a subtask out recomputes from the rest.
  update public.general_tasks
     set archived_at = now(), archived_by = u[1], trashed_at = now(), trashed_by = u[1] where id = a;
  perform pg_temp.check('a trashed subtask stops counting',
    (select due_at = pg_temp.at(d + 4, '17:00') from public.general_tasks where id = par));
  update public.general_tasks
     set archived_at = null, archived_by = null, trashed_at = null, trashed_by = null where id = a;
  perform pg_temp.check('a restored subtask counts again',
    (select due_at = pg_temp.at(d + 9, '17:00') from public.general_tasks where id = par));

  -- A subtask added while the rollup itself is writing is not rolled up again.
  insert into public.general_tasks(project_id, title, routing_state, sent_at, created_by, due_at)
    values (p, 'Zz quiet parent', 'released', now(), u[1], pg_temp.at(d, '17:00')) returning id into q;
  perform set_config('collabify.subtask_dates', 'on', true);
  insert into public.general_tasks(project_id, parent_id, title, routing_state, sent_at, created_by, starts_at, due_at)
    values (p, q, 'Zz quiet part', 'released', now(), u[1], pg_temp.at(d + 2, '09:00'), pg_temp.at(d + 2, '17:00'))
    returning id into qa;
  perform set_config('collabify.subtask_dates', 'off', true);
  perform pg_temp.check('a write inside the rollup is not rolled up again',
    (select due_at = pg_temp.at(d, '17:00') and planned_due_at is null from public.general_tasks where id = q));

  -- The one-time pass brings an old parent in line with no history.
  perform public.follow_all_subtask_dates();
  perform pg_temp.check('the pass brings an old parent in line',
    (select due_at = pg_temp.at(d + 2, '17:00') and starts_at = pg_temp.at(d + 2, '09:00')
            and planned_due_at = pg_temp.at(d, '17:00')
       from public.general_tasks where id = q));
  perform pg_temp.check('the pass writes no history',
    not exists (select 1 from public.general_task_events
                 where task_id = q and kind = 'updated' and detail -> 'fields' ? 'due_at'));
end $$;

rollback;
