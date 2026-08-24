-- Does each switch in Settings actually control something — rolled back.
--
--   node scripts/db.mjs supabase/tests/notifications.test.sql
--
-- Every switch is asserted twice: off, and then on with everything else the
-- same. A gate that blocked unconditionally would pass the first half alone,
-- which is exactly how three of these switches came to control nothing without
-- anybody noticing.

begin;

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
  v_prof uuid; v_class uuid; v_proj uuid; v_board uuid; v_task uuid;
  v_a uuid; v_b uuid; v_syllabus uuid;
begin
  select professor_id, id into v_prof, v_class
    from public.classes where archived_at is null limit 1;

  -- Two students of our own, so nobody real is notified by the test.
  for i in 1..2 loop
    declare v_id uuid := gen_random_uuid();
    begin
      insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                              created_at, updated_at)
      values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
              'authenticated', 'zz-notif-' || i || '@example.test', '', now(), now());
      insert into public.profiles (id, first_name, last_name, email, role, status)
      values (v_id, 'Zz', 'Notif' || i, 'zz-notif-' || i || '@example.test', 'student', 'active');
      insert into public.class_members (class_id, student_id) values (v_class, v_id);
      if i = 1 then v_a := v_id; else v_b := v_id; end if;
    end;
  end loop;

  select syllabus_id into v_syllabus from public.classes
   where syllabus_id is not null
     and (select count(*) from public.syllabus_weeks w where w.resource_id = syllabus_id) >= 1
   limit 1;

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz notif project', 'activity', 1, 1, 'individual',
          now() + interval '10 days')
  returning id into v_proj;

  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj limit 1;

  insert into public.project_tasks (board_id, title, weight, due_at, created_by, author_role)
  values (v_board, 'zz notif task', 10, now() + interval '6 hours', v_prof, 'professor')
  returning id into v_task;

  -- Both hold it, so a comment from one reaches the other.
  insert into public.task_assignees (task_id, student_id) values (v_task, v_a), (v_task, v_b);

  create temp table fx (k text primary key, v uuid) on commit drop;
  insert into fx values
    ('prof', v_prof), ('class', v_class), ('proj', v_proj),
    ('board', v_board), ('task', v_task), ('a', v_a), ('b', v_b);
  raise notice 'fixture ready';
end $$;

-- ---------------------------------------------------- comments_mentions

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_task uuid := (select v from fx where k='task');
  n int;
begin
  -- OFF
  update public.notification_prefs set comments_mentions = false where user_id = v_b;
  insert into public.task_comments (task_id, author_id, body) values (v_task, v_a, 'zz muted');
  select count(*) into n from public.notifications
   where user_id = v_b and type = 'comment_posted';
  perform pg_temp.must_be('comments off: no notification', n = 0);

  -- ON — the control
  update public.notification_prefs set comments_mentions = true where user_id = v_b;
  insert into public.task_comments (task_id, author_id, body) values (v_task, v_a, 'zz heard');
  select count(*) into n from public.notifications
   where user_id = v_b and type = 'comment_posted';
  perform pg_temp.must_be('comments on: the other holder is told', n = 1);

  -- and never yourself
  select count(*) into n from public.notifications
   where user_id = v_a and type = 'comment_posted';
  perform pg_temp.must_be('...and never the person who wrote it', n = 0);
end $$;

-- --------------------------------------------------- deadline_reminders

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_task uuid := (select v from fx where k='task');
  n int;
begin
  update public.notification_prefs set deadline_reminders = false where user_id = v_a;
  perform public.send_deadline_reminders();
  select count(*) into n from public.notifications
   where user_id = v_a and type = 'deadline_soon';
  perform pg_temp.must_be('reminders off: nothing sent', n = 0);

  update public.notification_prefs set deadline_reminders = true where user_id = v_a;
  perform public.send_deadline_reminders();
  select count(*) into n from public.notifications
   where user_id = v_a and type = 'deadline_soon' and task_id = v_task;
  perform pg_temp.must_be('reminders on: one nudge for the task due in 6 hours', n = 1);

  -- Running again must not nudge twice. This is the whole design.
  perform public.send_deadline_reminders();
  perform public.send_deadline_reminders();
  select count(*) into n from public.notifications
   where user_id = v_a and type = 'deadline_soon' and task_id = v_task;
  perform pg_temp.must_be('...and running it three more times still leaves one', n = 1);
end $$;

/**
 * A finished task is not something to wake anybody about.
 *
 * Asserted against a task of its own rather than the shared one: the person
 * already has a reminder from the block above, so counting their notifications
 * would pass whatever this does. Scoping to a new task is what makes the
 * assertion about the rule instead of about the order the tests run in.
 */
do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_board uuid := (select v from fx where k='board');
  v_b uuid := (select v from fx where k='b');
  v_done uuid;
  n int;
begin
  update public.notification_prefs set deadline_reminders = true where user_id = v_b;

  insert into public.project_tasks
    (board_id, title, weight, due_at, status, done_at, created_by, author_role)
  values (v_board, 'zz already finished', 10, now() + interval '3 hours',
          'done', now(), v_prof, 'professor')
  returning id into v_done;
  insert into public.task_assignees (task_id, student_id) values (v_done, v_b);

  perform public.send_deadline_reminders();
  select count(*) into n from public.notifications
   where type = 'deadline_soon' and task_id = v_done;
  perform pg_temp.must_be('a finished task sends no reminder', n = 0);
end $$;

-- ------------------------------------------------------ progress_digest

do $$
declare
  v_a uuid := (select v from fx where k='a');
  n int;
begin
  update public.notification_prefs set progress_digest = false where user_id = v_a;
  perform public.send_weekly_digest();
  select count(*) into n from public.notifications
   where user_id = v_a and type = 'weekly_digest';
  perform pg_temp.must_be('digest off: nothing sent', n = 0);

  update public.notification_prefs set progress_digest = true where user_id = v_a;
  perform public.send_weekly_digest();
  select count(*) into n from public.notifications
   where user_id = v_a and type = 'weekly_digest';
  perform pg_temp.must_be('digest on: it arrives', n = 1);
end $$;

-- Somebody holding nothing is skipped rather than told they finished zero.
do $$
declare
  v_empty uuid := gen_random_uuid();
  n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  values (v_empty, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'zz-empty@example.test', '', now(), now());
  insert into public.profiles (id, first_name, last_name, email, role, status)
  values (v_empty, 'Zz', 'Empty', 'zz-empty@example.test', 'student', 'active');
  update public.notification_prefs set progress_digest = true where user_id = v_empty;

  perform public.send_weekly_digest();
  select count(*) into n from public.notifications
   where user_id = v_empty and type = 'weekly_digest';
  perform pg_temp.must_be('a person holding nothing gets no digest', n = 0);
end $$;

-- ------------------------------------------------------- project_invites

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_class uuid := (select v from fx where k='class');
  v_a uuid := (select v from fx where k='a');
  v_p uuid;
  n int;
begin
  update public.notification_prefs
     set project_invites = false, task_assignments = true where user_id = v_a;

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience)
  values (v_class, v_prof, 'zz release muted', 'activity', 1, 1, 'individual')
  returning id into v_p;

  select count(*) into n from public.notifications
   where user_id = v_a and type = 'project_released' and project_id = v_p;
  perform pg_temp.must_be('invites off: a released project is not announced', n = 0);

  -- The control, and the fix: this used to be gated on task_assignments, so
  -- turning invites off changed nothing at all.
  update public.notification_prefs set project_invites = true where user_id = v_a;
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience)
  values (v_class, v_prof, 'zz release heard', 'activity', 1, 1, 'individual')
  returning id into v_p;

  select count(*) into n from public.notifications
   where user_id = v_a and type = 'project_released' and project_id = v_p;
  perform pg_temp.must_be('invites on: it is', n = 1);
end $$;

-- ----------------------------------------- what no switch may swallow

/**
 * The rule these three are held to: anything somebody asked for, or has to act
 * on, arrives whatever their settings say. Asserted with *every* switch off, so
 * this cannot pass by accident.
 */
do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  n int;
begin
  update public.notification_prefs
     set task_assignments = false, deadline_reminders = false,
         comments_mentions = false, project_invites = false,
         progress_digest = false, announcements = false
   where user_id = v_a;

  -- A board of its own: reassigning the fixture board's owner collides with
  -- the one-board-per-student constraint, and the point here is the switches,
  -- not who owns what.
  declare
    v_p uuid;
    v_own uuid;
  begin
    insert into public.projects
      (class_id, created_by, title, type, start_week, end_week, audience)
    values ((select v from fx where k='class'), v_prof, 'zz verdict', 'activity',
            1, 1, 'individual')
    returning id into v_p;
    perform public.ensure_project_boards(v_p);
    select id into v_own from public.project_boards
     where project_id = v_p and student_id = v_a;

    -- A verdict answers a submission, so there has to be one to answer.
    update public.project_boards
       set submitted_at = now(), submitted_by = v_a
     where id = v_own;
    perform public.record_board_result(v_own, 'accepted'::public.result_verdict, 'zz fine');

    select count(*) into n from public.notifications
     where user_id = v_a and type = 'result_recorded';
    perform pg_temp.must_be('with every switch off, the verdict still arrives', n >= 1);
  end;
end $$;

-- --------------------------------------------------------- the schedule

do $$
declare n int;
begin
  select count(*) into n from cron.job where jobname = 'collabify-deadline-reminders';
  perform pg_temp.must_be('the reminder job is scheduled', n = 1);
  select count(*) into n from cron.job where jobname = 'collabify-weekly-digest';
  perform pg_temp.must_be('the digest job is scheduled', n = 1);
  select count(*) into n from cron.job
   where jobname in ('collabify-deadline-reminders', 'collabify-weekly-digest')
     and not active;
  perform pg_temp.must_be('...and both are active', n = 0);
end $$;

rollback;
