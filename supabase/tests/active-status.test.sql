-- supabase/tests/active-status.test.sql
-- Active now: who counts as a contact, the heartbeat, hiding your status, and
-- the direct chat a contact opens. Rolls back; nothing survives.
--
-- The file under test must already be applied:
--   node scripts/db.mjs supabase/tests/active-status.test.sql
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

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

/** Whether p_viewer's active list holds p_other right now. */
create or replace function pg_temp.sees(p_viewer uuid, p_other uuid) returns boolean
language plpgsql as $$
declare found boolean;
begin
  perform pg_temp.act_as(p_viewer);
  select exists (select 1 from public.my_active_contacts() c where c.id = p_other) into found;
  perform pg_temp.act_as_service();
  return found;
end;
$$;

/** Stamps a person as seen at a given time, as the heartbeat would. */
create or replace function pg_temp.seen(p_user uuid, p_at timestamptz) returns void
language plpgsql as $$
begin
  insert into public.user_presence (user_id, last_seen_at) values (p_user, p_at)
  on conflict (user_id) do update set last_seen_at = excluded.last_seen_at;
end;
$$;

do $$
declare
  v_t  uuid := gen_random_uuid();  -- teaches K and K2
  v_c  uuid := gen_random_uuid();  -- co-teacher on K's space
  v_s1 uuid := gen_random_uuid();  -- student in K and K2
  v_s2 uuid := gen_random_uuid();  -- student in K and K2
  v_s3 uuid := gen_random_uuid();  -- removed from K
  v_x  uuid := gen_random_uuid();  -- shares nothing
  v_m1 uuid := gen_random_uuid();  -- work space W
  v_m2 uuid := gen_random_uuid();  -- work space W
  v_p1 uuid := gen_random_uuid();  -- work project J
  v_p2 uuid := gen_random_uuid();  -- work project J
  k_id uuid; k2_id uuid; k_space uuid; w uuid; j uuid;
  a jsonb; b jsonb; n int; refused boolean;
begin
  perform pg_temp.act_as_service();

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@test.invalid', '', now(), now()
    from (values (v_t), (v_c), (v_s1), (v_s2), (v_s3), (v_x), (v_m1), (v_m2), (v_p1), (v_p2)) as u(id);
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values (v_t,  v_t::text  || '@test.invalid', 'Zz', 'Active teacher', 'member',  'active', true,  false),
         (v_c,  v_c::text  || '@test.invalid', 'Zz', 'Active coteach', 'member',  'active', true,  false),
         (v_s1, v_s1::text || '@test.invalid', 'Zz', 'Active s1',      'student', 'active', false, false),
         (v_s2, v_s2::text || '@test.invalid', 'Zz', 'Active s2',      'student', 'active', false, false),
         (v_s3, v_s3::text || '@test.invalid', 'Zz', 'Active s3',      'student', 'active', false, false),
         (v_x,  v_x::text  || '@test.invalid', 'Zz', 'Active x',       'member',  'active', false, false),
         (v_m1, v_m1::text || '@test.invalid', 'Zz', 'Active m1',      'member',  'active', false, true),
         (v_m2, v_m2::text || '@test.invalid', 'Zz', 'Active m2',      'member',  'active', false, false),
         (v_p1, v_p1::text || '@test.invalid', 'Zz', 'Active p1',      'member',  'active', false, true),
         (v_p2, v_p2::text || '@test.invalid', 'Zz', 'Active p2',      'member',  'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_teach = excluded.can_teach, can_manage_projects = excluded.can_manage_projects;

  -- Two classes taught by T; S1 and S2 are in both, S3 was removed from K.
  insert into public.classes (professor_id, name, initial, code, section, year_level, semester, school_year)
  values (v_t, 'Zz Active K', 'ZZAK', 'ZZ-ACT-K-' || left(v_t::text, 8), 'BSIT 9A', '3rd', '1st', '2026-2027')
  returning id, space_id into k_id, k_space;
  insert into public.classes (professor_id, name, initial, code, section, year_level, semester, school_year)
  values (v_t, 'Zz Active K2', 'ZZAKB', 'ZZ-ACT-K2-' || left(v_t::text, 8), 'BSIT 9B', '3rd', '1st', '2026-2027')
  returning id into k2_id;
  insert into public.class_members (class_id, student_id, status) values
    (k_id, v_s1, 'active'), (k_id, v_s2, 'active'), (k_id, v_s3, 'removed'),
    (k2_id, v_s1, 'active'), (k2_id, v_s2, 'active');
  insert into public.general_space_members (space_id, user_id, level) values (k_space, v_c, 'manager')
  on conflict (space_id, user_id) do update set level = 'manager';

  -- A work space with M1 and M2, and a work project with P1 and P2.
  perform pg_temp.act_as(v_m1);
  w := (public.create_general_space('Zz Active space', '')).id;
  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, role) values (w, v_m2, 'member');

  perform pg_temp.act_as(v_p1);
  j := (public.create_general_project('Zz Active project', '')).id;
  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, role) values (j, v_p2, 'member');

  -- Everybody was seen just now.
  perform pg_temp.seen(u, now())
    from unnest(array[v_t, v_c, v_s1, v_s2, v_s3, v_x, v_m1, v_m2, v_p1, v_p2]) as u;

  ------------------------------------------------------------ who counts
  perform pg_temp.must_be('class: student sees classmate', pg_temp.sees(v_s1, v_s2));
  perform pg_temp.must_be('class: student sees teacher', pg_temp.sees(v_s1, v_t));
  perform pg_temp.must_be('class: student sees co-teacher', pg_temp.sees(v_s1, v_c));
  perform pg_temp.must_be('class: teacher sees student', pg_temp.sees(v_t, v_s1));

  perform pg_temp.act_as(v_s1);
  select count(*) into n from public.my_active_contacts() c where c.id = v_s2;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('one row per person', n = 1);

  perform pg_temp.must_be('space: members see each other',
    pg_temp.sees(v_m1, v_m2) and pg_temp.sees(v_m2, v_m1));
  perform pg_temp.must_be('project: members see each other',
    pg_temp.sees(v_p1, v_p2) and pg_temp.sees(v_p2, v_p1));

  perform pg_temp.act_as(v_x);
  select count(*) into n from public.my_active_contacts();
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('stranger sees nobody', n = 0 and not pg_temp.sees(v_s1, v_x));

  perform pg_temp.must_be('removed: a removed student is not a contact',
    not pg_temp.sees(v_s1, v_s3) and not pg_temp.sees(v_s3, v_s1));

  insert into public.general_space_members (space_id, user_id, level) values (k_space, v_m1, 'member')
  on conflict (space_id, user_id) do nothing;
  perform pg_temp.must_be('class space: a class''s own space links nobody',
    not pg_temp.sees(v_s1, v_m1) and not pg_temp.sees(v_m1, v_s1));
  delete from public.general_space_members where space_id = k_space and user_id = v_m1;

  perform pg_temp.seen(v_s2, now() - interval '61 minutes');
  perform pg_temp.must_be('stale: seen over an hour ago is not listed', not pg_temp.sees(v_s1, v_s2));
  perform pg_temp.seen(v_s2, now());

  ------------------------------------------------------------ the heartbeat
  perform pg_temp.seen(v_s1, now() - interval '30 seconds');
  perform pg_temp.act_as(v_s1);
  perform public.touch_presence();
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('skip: a stamp under 45 s old is kept',
    (select last_seen_at < now() - interval '29 seconds' from public.user_presence where user_id = v_s1));
  perform pg_temp.seen(v_s1, now() - interval '61 seconds');
  perform pg_temp.act_as(v_s1);
  perform public.touch_presence();
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('skip: an older stamp moves to now',
    (select last_seen_at = now() from public.user_presence where user_id = v_s1));

  ------------------------------------------------------------ the direct chat
  perform pg_temp.act_as(v_t);
  a := public.start_direct_conversation(v_s1);
  perform pg_temp.act_as(v_s1);
  b := public.start_contact_conversation(v_t);
  perform pg_temp.must_be('dm: same thread as start_direct_conversation',
    a->>'result' = 'ok' and b->>'result' = 'ok' and a->>'conversation_id' = b->>'conversation_id');
  a := public.start_contact_conversation(v_t);
  perform pg_temp.must_be('dm: calling twice returns the same thread',
    a->>'conversation_id' = b->>'conversation_id');

  perform pg_temp.act_as(v_x);
  a := public.start_contact_conversation(v_s1);
  perform pg_temp.act_as_service();
  select count(*) into n from public.conversations
   where kind = 'direct'
     and direct_key = least(v_x::text, v_s1::text) || '|' || greatest(v_x::text, v_s1::text);
  perform pg_temp.must_be('dm: a stranger is refused', a->>'result' = 'not_contact' and n = 0);

  ------------------------------------------------------------ hiding
  perform pg_temp.act_as(v_s2);
  perform public.set_active_status(false);
  perform public.touch_presence();
  perform pg_temp.must_be('hidden: my_active_status reads false', not public.my_active_status());
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('hidden: a hidden person appears to nobody',
    (select last_seen_at is null from public.user_presence where user_id = v_s2)
    and not pg_temp.sees(v_s1, v_s2) and not pg_temp.sees(v_t, v_s2));

  perform pg_temp.act_as(v_s2);
  select count(*) into n from public.my_active_contacts();
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('hidden: a hidden person sees nobody', n = 0);

  perform pg_temp.act_as(v_s1);
  a := public.start_contact_conversation(v_s2);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('hidden: still messageable', a->>'result' = 'ok');

  perform pg_temp.act_as(v_s2);
  perform public.set_active_status(true);
  perform public.touch_presence();
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('hidden: turning it back on shows them again', pg_temp.sees(v_s1, v_s2));

  ------------------------------------------------------------ archived places
  update public.classes set archived_at = now() where id in (k_id, k2_id);
  perform pg_temp.must_be('archived: an archived class drops out', not pg_temp.sees(v_s1, v_s2));
  perform pg_temp.act_as(v_s1);
  a := public.start_contact_conversation(v_s2);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('archived: no new chat through an archived class', a->>'result' = 'not_contact');

  -- Joining a project also puts you in its space, so the space still links
  -- them; only archiving the space too ends it.
  update public.general_projects set archived_at = now() where id = j;
  perform pg_temp.must_be('archived: an archived project still leaves its live space',
    pg_temp.sees(v_p1, v_p2));
  update public.general_spaces set archived_at = now()
   where id = (select space_id from public.general_projects where id = j);
  perform pg_temp.must_be('archived: an archived project in an archived space drops out',
    not pg_temp.sees(v_p1, v_p2));

  ------------------------------------------------------------ internal
  perform pg_temp.act_as(v_s1);
  refused := false;
  begin
    perform public.contacts_of(v_s1);
  exception when insufficient_privilege then
    refused := true;
  end;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('internal: contacts_of is not callable', refused);

  perform pg_temp.act_as(v_s1);
  refused := false;
  begin
    perform 1 from public.user_presence;
  exception when insufficient_privilege then
    refused := true;
  end;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('internal: user_presence is not readable directly', refused);
end;
$$;

rollback;
