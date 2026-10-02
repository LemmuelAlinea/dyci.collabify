-- Group leaders: who may set one, and what clears it.
-- Rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/group-leader.test.sql
--
-- Every refusal is paired with a control that succeeds on the same call.

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
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 72);
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
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  prof  uuid := gen_random_uuid();
  ana   uuid := gen_random_uuid();
  ben   uuid := gen_random_uuid();
  cy    uuid := gen_random_uuid();   -- in the other group
  cls   uuid;
  st    uuid;
  g1    uuid;
  g2    uuid;
  spare uuid;
  res   uuid;

  leader uuid;
begin
  perform pg_temp.act_as_service();

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated',
         'authenticated', u.id::text || '@test.invalid', '', now(), now()
    from (values (prof), (ana), (ben), (cy)) as u(id);

  insert into public.profiles (id, email, first_name, last_name, role, status)
  values (prof, prof::text || '@test.invalid', 'Lead', 'Prof', 'faculty', 'active'),
         (ana,  ana::text  || '@test.invalid', 'Ana',  'One',  'student', 'active'),
         (ben,  ben::text  || '@test.invalid', 'Ben',  'Two',  'student', 'active'),
         (cy,   cy::text   || '@test.invalid', 'Cy',   'Three','student', 'active');

  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (prof, 'syllabus', 'zz Group Leader syllabus', 'x/l.pdf', 'l.pdf')
  returning id into res;

  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id, term_start, term_end)
  values (prof, 'zz Group Leader', 'ZZGL', 'ZZ-GL-1', 'BSIT 9Z', '3rd', '1st', '2026-2027',
          res, date '2026-07-20', date '2026-08-16')
  returning id into cls;

  insert into public.class_members (class_id, student_id, status)
  values (cls, ana, 'active'), (cls, ben, 'active'), (cls, cy, 'active');

  insert into public.group_sets (class_id, name, mode)
  values (cls, 'Set L', 'manual') returning id into st;

  insert into public.groups (set_id, name, position) values (st, 'Alpha', 1) returning id into g1;
  insert into public.groups (set_id, name, position) values (st, 'Beta',  2) returning id into g2;
  insert into public.groups (set_id, name, position) values (st, 'Spare', 3) returning id into spare;

  insert into public.group_members (group_id, set_id, student_id, added_by)
  values (g1, st, ana, prof), (g1, st, ben, prof), (g2, st, cy, prof);

  -- --------------------------------------------------------------- direct writes

  perform pg_temp.act_as(ana);
  update public.groups set leader_id = ana where id = g1;
  perform pg_temp.must_be('a member cannot set the leader with a plain update',
    (select leader_id from public.groups where id = g1) is null);

  perform pg_temp.act_as(prof);
  update public.groups set leader_id = ana where id = g1;
  perform pg_temp.must_be('nor can the professor',
    (select leader_id from public.groups where id = g1) is null);

  -- --------------------------------------------------------------- picking one

  perform pg_temp.act_as(cy);
  perform pg_temp.must_refuse('a student in another group cannot pick the leader',
    format('select public.set_group_leader(%L, %L)', g1, cy));

  perform pg_temp.act_as(ana);
  perform pg_temp.must_refuse('the leader has to be in the group',
    format('select public.set_group_leader(%L, %L)', g1, cy));

  perform pg_temp.must_allow('a member picks a leader while there is none',
    format('select public.set_group_leader(%L, %L)', g1, ben));
  perform pg_temp.must_be('and it lands',
    (select leader_id from public.groups where id = g1) = ben);
  perform pg_temp.must_be('group_overview carries it',
    (select leader_id from public.group_overview where id = g1) = ben);

  perform pg_temp.must_refuse('another member cannot take it once there is a leader',
    format('select public.set_group_leader(%L, %L)', g1, ana));

  perform pg_temp.act_as(ben);
  perform pg_temp.must_allow('the leader hands it on',
    format('select public.set_group_leader(%L, %L)', g1, ana));
  perform pg_temp.must_be('to the member they chose',
    (select leader_id from public.groups where id = g1) = ana);

  perform pg_temp.act_as(prof);
  perform pg_temp.must_allow('the professor can change it any time',
    format('select public.set_group_leader(%L, %L)', g1, ben));

  -- A final set still lets the group run itself.
  perform pg_temp.act_as_service();
  update public.group_sets set closed_at = now() where id = st;

  perform pg_temp.act_as(ben);
  perform pg_temp.must_allow('the leader can step down after the set is final',
    format('select public.set_group_leader(%L, null)', g1));
  perform pg_temp.must_be('which leaves no leader',
    (select leader_id from public.groups where id = g1) is null);

  perform pg_temp.act_as(ana);
  perform pg_temp.must_allow('and a member can pick again',
    format('select public.set_group_leader(%L, %L)', g1, ana));

  -- --------------------------------------------------------------- archived

  perform pg_temp.act_as(prof);
  update public.groups set archived_at = now() where id = g1;
  perform pg_temp.must_refuse('an archived group keeps its leader as it is',
    format('select public.set_group_leader(%L, %L)', g1, ben));
  update public.groups set archived_at = null where id = g1;
  perform pg_temp.must_allow('restored, it can change again',
    format('select public.set_group_leader(%L, %L)', g1, ben));

  -- --------------------------------------------------------------- leaving

  perform pg_temp.act_as(prof);
  delete from public.group_members where group_id = g1 and student_id = ana;
  perform pg_temp.must_be('removing someone else leaves the leader alone',
    (select leader_id from public.groups where id = g1) = ben);

  delete from public.group_members where group_id = g1 and student_id = ben;
  perform pg_temp.must_be('removing the leader clears it',
    (select leader_id from public.groups where id = g1) is null);

  -- Dropping the leader from the class takes them off the roster, and so off the lead.
  perform pg_temp.act_as_service();
  update public.group_sets set closed_at = null where id = st;
  perform pg_temp.act_as(prof);
  perform pg_temp.must_allow('the professor sets one in the other group',
    format('select public.set_group_leader(%L, %L)', g2, cy));
  update public.class_members set status = 'removed' where class_id = cls and student_id = cy;
  perform pg_temp.must_be('dropping the leader from the class clears it',
    (select leader_id from public.groups where id = g2) is null);

  -- A group that is deleted takes its roster with it; the clean-up must not trip on that.
  perform pg_temp.act_as_service();
  insert into public.group_members (group_id, set_id, student_id, added_by)
  values (spare, st, ana, prof);
  perform pg_temp.act_as(prof);
  perform pg_temp.must_allow('the professor names a leader in the spare group',
    format('select public.set_group_leader(%L, %L)', spare, ana));
  perform pg_temp.must_allow('and can still delete it while it has one',
    format('delete from public.groups where id = %L', spare));

  -- --------------------------------------------------------------- anon

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('anon cannot call set_group_leader',
    not has_function_privilege('anon', 'public.set_group_leader(uuid, uuid)', 'execute'));
  perform pg_temp.must_be('authenticated can',
    has_function_privilege('authenticated', 'public.set_group_leader(uuid, uuid)', 'execute'));
end;
$$;

rollback;
