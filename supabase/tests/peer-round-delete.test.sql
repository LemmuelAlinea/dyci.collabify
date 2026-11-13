-- Deleting a peer evaluation round — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/peer-round-delete.test.sql
--
-- A round nobody has answered can be deleted by the professor, and takes its
-- notices with it. A round with a saved rating cannot. Every refusal is paired
-- with a control that succeeds.

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

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 58);
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

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_c uuid;
  v_set uuid; v_g uuid; v_proj uuid;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where c.archived_at is null
     and (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 2
     and (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 3
   order by c.created_at
   limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 0 limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 1 limit 1;
  select student_id into v_c from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 2 limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-peer-delete-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'zz-peer-delete-group') returning id into v_g;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_g, v_set, v_a), (v_g, v_set, v_b), (v_g, v_set, v_c);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-peer-delete-proj', 'activity', 1, 2, 'group', v_set, now() + interval '5 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);

  -- Every fixture student hears about rounds, so the notice cleanup is tested.
  update public.notification_prefs set deadline_reminders = true
   where user_id in (v_a, v_b, v_c);

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert, update on fx to authenticated;
  insert into fx values
    ('prof', v_prof), ('a', v_a), ('b', v_b), ('c', v_c), ('proj', v_proj);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------ an unanswered round

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_proj uuid := (select v from fx where k='proj');
  v_round uuid;
  n int;
begin
  perform pg_temp.act_as(v_prof);
  select id into v_round
    from public.open_peer_round(v_proj, 'final', now() + interval '2 days');

  perform pg_temp.act_as_service();
  select count(*) into n from public.notifications
   where project_id = v_proj and type = 'peer_round_opened';
  perform pg_temp.must_be('opening the round told the group', n >= 1);

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot delete a round',
    format('select public.delete_peer_round(%L)', v_round));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor deletes a round nobody has answered',
    format('select public.delete_peer_round(%L)', v_round));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the round is gone',
    not exists (select 1 from public.peer_rounds where id = v_round));
  select count(*) into n from public.notifications
   where project_id = v_proj and type = 'peer_round_opened';
  perform pg_temp.must_be('and its notice went with it', n = 0);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('a deleted round cannot be deleted again',
    format('select public.delete_peer_round(%L)', v_round));
  perform pg_temp.must_allow('a final round deleted by mistake frees the final for a new one',
    format('select public.open_peer_round(%L, ''final'', now() + interval ''2 days'')', v_proj));
end $$;

-- --------------------------------------------------------- an answered round

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_proj uuid := (select v from fx where k='proj');
  v_round uuid;
  v_one jsonb;
begin
  perform pg_temp.act_as_service();
  select id into v_round from public.peer_rounds where project_id = v_proj;

  perform pg_temp.act_as(v_a);
  select jsonb_agg(jsonb_build_object('ratee_id', x, 'contributes', 4, 'interacts', 4,
                     'on_track', 4, 'quality', 4, 'skills', 4, 'comment', ''))
    into v_one from unnest(array[v_a, v_b, v_c]) x;
  perform public.save_peer_ratings(v_round, v_one);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('a round a student has answered cannot be deleted',
    format('select public.delete_peer_round(%L)', v_round));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the round and its rating stay',
    exists (select 1 from public.peer_ratings where round_id = v_round));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor can still close it',
    format('select public.close_peer_round(%L)', v_round));
end $$;

rollback;
