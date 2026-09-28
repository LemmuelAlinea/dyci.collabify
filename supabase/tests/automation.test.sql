-- Scheduled releases, overdue notices — rolled back.
--
--   node scripts/db.mjs supabase/tests/automation.test.sql

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
  v_prof uuid; v_class uuid; v_a uuid := gen_random_uuid();
begin
  select professor_id, id into v_prof, v_class
    from public.classes where archived_at is null limit 1;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  values (v_a, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'zz-auto-1@example.test', '', now(), now());
  insert into public.profiles (id, first_name, last_name, email, role, status)
  values (v_a, 'Zz', 'Auto', 'zz-auto-1@example.test', 'student', 'active');
  insert into public.class_members (class_id, student_id) values (v_class, v_a);
  update public.notification_prefs
     set project_invites = true, deadline_reminders = true where user_id = v_a;

  create temp table fx (k text primary key, v uuid) on commit drop;
  insert into fx values ('prof', v_prof), ('class', v_class), ('a', v_a);
end $$;

-- ------------------------------------------------------ scheduled releases

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_class uuid := (select v from fx where k='class');
  v_a uuid := (select v from fx where k='a');
  v_p uuid; v_old uuid; n int;
begin
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, release_at)
  values (v_class, v_prof, 'zz scheduled', 'activity', 1, 1, 'individual',
          now() + interval '1 hour')
  returning id into v_p;

  select count(*) into n from public.notifications
   where user_id = v_a and project_id = v_p and type = 'project_released';
  perform pg_temp.must_be('saving a scheduled project says nothing yet', n = 0);

  perform public.send_scheduled_releases();
  select count(*) into n from public.notifications
   where user_id = v_a and project_id = v_p and type = 'project_released';
  perform pg_temp.must_be('the job says nothing before the release time', n = 0);

  -- Time arrives: pretend it opened ten minutes ago. Written as the table
  -- owner so the update trigger sees an old row that was not yet live.
  alter table public.projects disable trigger user;
  update public.projects set release_at = now() - interval '10 minutes' where id = v_p;
  alter table public.projects enable trigger user;

  perform public.send_scheduled_releases();
  select count(*) into n from public.notifications
   where user_id = v_a and project_id = v_p and type = 'project_released';
  perform pg_temp.must_be('once released, the student is told', n = 1);

  perform public.send_scheduled_releases();
  select count(*) into n from public.notifications
   where user_id = v_a and project_id = v_p and type = 'project_released';
  perform pg_temp.must_be('...and only once', n = 1);

  -- A release long past is never dug up.
  alter table public.projects disable trigger user;
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, release_at)
  values (v_class, v_prof, 'zz old', 'activity', 1, 1, 'individual',
          now() - interval '3 days')
  returning id into v_old;
  alter table public.projects enable trigger user;
  perform public.send_scheduled_releases();
  select count(*) into n from public.notifications
   where user_id = v_a and project_id = v_old;
  perform pg_temp.must_be('a release days old is not announced', n = 0);

  -- The switch still governs it.
  update public.notification_prefs set project_invites = false where user_id = v_a;
  alter table public.projects disable trigger user;
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, release_at)
  values (v_class, v_prof, 'zz muted', 'activity', 1, 1, 'individual',
          now() - interval '5 minutes')
  returning id into v_old;
  alter table public.projects enable trigger user;
  perform public.send_scheduled_releases();
  select count(*) into n from public.notifications
   where user_id = v_a and project_id = v_old;
  perform pg_temp.must_be('invites off: not announced', n = 0);
  update public.notification_prefs set project_invites = true where user_id = v_a;
end $$;

-- --------------------------------------------------------- overdue notices

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_class uuid := (select v from fx where k='class');
  v_a uuid := (select v from fx where k='a');
  v_p uuid; v_board uuid; v_late uuid; v_ancient uuid; v_done uuid; n int;
begin
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz overdue', 'activity', 1, 1, 'individual',
          now() + interval '10 days')
  returning id into v_p;
  perform public.ensure_project_boards(v_p);
  select id into v_board from public.project_boards
   where project_id = v_p and student_id = v_a;

  insert into public.project_tasks (board_id, title, weight, due_at, created_by, author_role)
  values (v_board, 'zz late', 10, now() - interval '2 hours', v_prof, 'professor')
  returning id into v_late;
  insert into public.project_tasks (board_id, title, weight, due_at, created_by, author_role)
  values (v_board, 'zz ancient', 10, now() - interval '10 days', v_prof, 'professor')
  returning id into v_ancient;
  insert into public.project_tasks (board_id, title, weight, due_at, created_by, author_role, status)
  values (v_board, 'zz done', 10, now() - interval '2 hours', v_prof, 'professor', 'done')
  returning id into v_done;
  -- Solo boards claim new tasks for their owner already; make sure.
  insert into public.task_assignees (task_id, student_id)
  values (v_late, v_a), (v_ancient, v_a), (v_done, v_a)
  on conflict do nothing;

  update public.notification_prefs set deadline_reminders = false where user_id = v_a;
  perform public.send_overdue_notices();
  select count(*) into n from public.notifications where user_id = v_a and type = 'task_overdue';
  perform pg_temp.must_be('reminders off: no overdue notice', n = 0);

  update public.notification_prefs set deadline_reminders = true where user_id = v_a;
  perform public.send_overdue_notices();
  select count(*) into n from public.notifications
   where user_id = v_a and type = 'task_overdue' and task_id = v_late;
  perform pg_temp.must_be('reminders on: the slipped task is flagged', n = 1);
  select count(*) into n from public.notifications
   where user_id = v_a and type = 'task_overdue' and task_id in (v_ancient, v_done);
  perform pg_temp.must_be('...not a done task, and not one long gone', n = 0);

  perform public.send_overdue_notices();
  select count(*) into n from public.notifications
   where user_id = v_a and type = 'task_overdue';
  perform pg_temp.must_be('...and only once', n = 1);

  -- A handed-in board is finished business.
  delete from public.notifications where user_id = v_a and type = 'task_overdue';
  update public.project_boards set submitted_at = now(), submitted_by = v_a where id = v_board;
  perform public.send_overdue_notices();
  select count(*) into n from public.notifications where user_id = v_a and type = 'task_overdue';
  perform pg_temp.must_be('a handed-in board is left alone', n = 0);
end $$;

-- ------------------------------------------------------------------ nudge

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_class uuid := (select v from fx where k='class');
  v_a uuid := (select v from fx where k='a');
  v_p uuid; v_board uuid; n int; refused boolean;
begin
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz nudge', 'activity', 1, 1, 'individual',
          now() + interval '10 days')
  returning id into v_p;
  perform public.ensure_project_boards(v_p);
  select id into v_board from public.project_boards
   where project_id = v_p and student_id = v_a;

  -- A student cannot nudge.
  perform pg_temp.act_as(v_a);
  refused := false;
  begin
    perform public.nudge_board(v_board, null);
  exception when others then refused := true;
  end;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a student cannot send a reminder', refused);

  -- The professor can, and the student hears it even with every switch off.
  update public.notification_prefs
     set deadline_reminders = false, project_invites = false where user_id = v_a;
  perform pg_temp.act_as(v_prof);
  n := public.nudge_board(v_board, '  Show me a draft by Friday.  ');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the professor reminds the board', n = 1);
  select count(*) into n from public.notifications
   where user_id = v_a and type = 'nudge' and project_id = v_p
     and preview = 'Show me a draft by Friday.';
  perform pg_temp.must_be('...with their note, whatever the settings', n = 1);

  -- Once a day.
  perform pg_temp.act_as(v_prof);
  refused := false;
  begin
    perform public.nudge_board(v_board, null);
  exception when others then refused := true;
  end;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a second reminder the same day is refused', refused);

  -- Not on handed-in work.
  delete from public.notifications where user_id = v_a and type = 'nudge';
  update public.project_boards set submitted_at = now(), submitted_by = v_a where id = v_board;
  perform pg_temp.act_as(v_prof);
  refused := false;
  begin
    perform public.nudge_board(v_board, null);
  exception when others then refused := true;
  end;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('handed-in work is not nudged', refused);
end $$;

-- --------------------------------------------------------------- grants

do $$
begin
  perform pg_temp.must_be('signed-in users cannot run the release job',
    not has_function_privilege('authenticated', 'public.send_scheduled_releases()', 'execute'));
  perform pg_temp.must_be('signed-in users cannot run the overdue job',
    not has_function_privilege('authenticated', 'public.send_overdue_notices()', 'execute'));
  perform pg_temp.must_be('both jobs are scheduled',
    (select count(*) from cron.job
      where jobname in ('collabify-scheduled-releases', 'collabify-overdue-notices')) = 2);
end $$;

rollback;
