-- supabase/tests/notice-audience.test.sql
-- Notice audiences: who a program notice reaches, who reads it (the table, the views and so
-- Realtime, which checks the table's read policy), the admin's reach count, and the refusals.
-- Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/notice-audience.sql supabase/anon-lockdown.sql supabase/tests/notice-audience.test.sql
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

/** Runs a statement and asserts it is refused with a message containing p_needle. */
create or replace function pg_temp.must_refuse_exact(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_needle in sqlerrm) > 0 then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 80);
      return;
    end if;
    raise exception 'FAIL  % — refused with another message: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — the call went through and should not have', p_label;
end;
$$;

create or replace function pg_temp.sorted(p uuid[]) returns uuid[]
language sql as $$
  select coalesce(array_agg(x order by x), '{}') from unnest(p) x;
$$;

/** Which of p_ids read the notice through program_notices, each as themselves. */
create or replace function pg_temp.view_readers(p_notice uuid, p_ids uuid[]) returns uuid[]
language plpgsql as $$
declare
  r uuid[] := '{}';
  u uuid;
begin
  foreach u in array p_ids loop
    perform pg_temp.act_as(u);
    if exists (select 1 from public.program_notices where id = p_notice) then r := r || u; end if;
  end loop;
  perform pg_temp.act_as_service();
  return pg_temp.sorted(r);
end;
$$;

/** Which of p_ids read the row straight from the table: a direct select, and Realtime's check. */
create or replace function pg_temp.table_readers(p_notice uuid, p_ids uuid[]) returns uuid[]
language plpgsql as $$
declare
  r uuid[] := '{}';
  u uuid;
begin
  foreach u in array p_ids loop
    perform pg_temp.act_as(u);
    if exists (select 1 from public.program_announcements where id = p_notice) then r := r || u; end if;
  end loop;
  perform pg_temp.act_as_service();
  return pg_temp.sorted(r);
end;
$$;

/** Which of p_ids got a notification for this title, read as the database. */
create or replace function pg_temp.notified(p_title text, p_ids uuid[]) returns uuid[]
language sql as $$
  select pg_temp.sorted(coalesce(array_agg(n.user_id), '{}'))
    from public.notifications n
   where n.title = p_title and n.type::text = 'announcement' and n.user_id = any (p_ids);
$$;

/** Every notification row the notifier wrote for this title. */
create or replace function pg_temp.notified_count(p_title text) returns int
language sql as $$
  select count(*)::int from public.notifications
   where title = p_title and type::text = 'announcement';
$$;

/**
 * One notice's whole outcome: the reach count the admin saw before sending equals the rows
 * written; exactly the expected fixtures were notified; exactly the expected fixtures read it,
 * through the view and through the table alike.
 */
create or replace function pg_temp.check_notice(p_label text, p_notice uuid, p_title text,
  p_reach int, p_all uuid[], p_people uuid[], p_notified uuid[], p_readers uuid[])
returns void language plpgsql as $$
begin
  perform pg_temp.act_as_service();
  perform pg_temp.must_be(p_label || ': admin_notice_reach equals the rows the notifier wrote',
    p_reach = pg_temp.notified_count(p_title));
  perform pg_temp.must_be(p_label || ': exactly the right accounts are notified',
    pg_temp.notified(p_title, p_all) = pg_temp.sorted(p_notified));
  perform pg_temp.must_be(p_label || ': exactly the right accounts read it through program_notices',
    pg_temp.view_readers(p_notice, p_people) = pg_temp.sorted(p_readers));
  perform pg_temp.must_be(p_label || ': ...and through the table (a direct select, Realtime)',
    pg_temp.table_readers(p_notice, p_people) = pg_temp.sorted(p_readers));
end;
$$;

do $$
declare
  v_a    uuid := gen_random_uuid();  -- the active admin, the author
  v_a2   uuid := gen_random_uuid();  -- another active admin
  v_pa   uuid := gen_random_uuid();  -- an admin still pending
  v_stu  uuid := gen_random_uuid();  -- student
  v_off  uuid := gen_random_uuid();  -- student with announcements off
  v_sin  uuid := gen_random_uuid();  -- student, deactivated
  v_t    uuid := gen_random_uuid();  -- teaching member, no office
  v_tf   uuid := gen_random_uuid();  -- teaching member filed in office one
  v_s1   uuid := gen_random_uuid();  -- staff in office one
  v_s2   uuid := gen_random_uuid();  -- staff in office two
  v_s0   uuid := gen_random_uuid();  -- staff in no office
  v_sx   uuid := gen_random_uuid();  -- staff in office one, deactivated
  v_late uuid := gen_random_uuid();  -- staff filed into office one after the notice
  v_all    uuid[];
  v_people uuid[];
  o1     uuid;
  o2     uuid;
  n_old  uuid;
  n_ev   uuid;
  n_o1   uuid;
  n_o12  uuid;
  n_stu  uuid;
  n_tch  uuid;
  n_stf  uuid;
  n_mix  uuid;
  reach  int;
  r      public.program_announcements;
  r_ev   public.program_announcements;
begin
  v_people := array[v_stu, v_off, v_sin, v_t, v_tf, v_s1, v_s2, v_s0, v_sx, v_late];
  v_all := v_people || array[v_a, v_a2, v_pa];

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_a,    'zz-na-a@example.test'),
      (v_a2,   'zz-na-a2@example.test'),
      (v_pa,   'zz-na-pa@example.test'),
      (v_stu,  'zz-na-stu@example.test'),
      (v_off,  'zz-na-off@example.test'),
      (v_sin,  'zz-na-sin@example.test'),
      (v_t,    'zz-na-t@example.test'),
      (v_tf,   'zz-na-tf@example.test'),
      (v_s1,   'zz-na-s1@example.test'),
      (v_s2,   'zz-na-s2@example.test'),
      (v_s0,   'zz-na-s0@example.test'),
      (v_sx,   'zz-na-sx@example.test'),
      (v_late, 'zz-na-late@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_a,    'zz-na-a@example.test',    'Zz', 'Naa',    'admin',   'active',   false, false),
    (v_a2,   'zz-na-a2@example.test',   'Zz', 'Naa2',   'admin',   'active',   false, false),
    (v_pa,   'zz-na-pa@example.test',   'Zz', 'Napa',   'admin',   'pending',  false, false),
    (v_stu,  'zz-na-stu@example.test',  'Zz', 'Nastu',  'student', 'active',   false, false),
    (v_off,  'zz-na-off@example.test',  'Zz', 'Naoff',  'student', 'active',   false, false),
    (v_sin,  'zz-na-sin@example.test',  'Zz', 'Nasin',  'student', 'rejected', false, false),
    (v_t,    'zz-na-t@example.test',    'Zz', 'Nat',    'member',  'active',   true,  false),
    (v_tf,   'zz-na-tf@example.test',   'Zz', 'Natf',   'member',  'active',   true,  false),
    (v_s1,   'zz-na-s1@example.test',   'Zz', 'Nas1',   'member',  'active',   false, false),
    (v_s2,   'zz-na-s2@example.test',   'Zz', 'Nas2',   'member',  'active',   false, false),
    (v_s0,   'zz-na-s0@example.test',   'Zz', 'Nas0',   'member',  'active',   false, false),
    (v_sx,   'zz-na-sx@example.test',   'Zz', 'Nasx',   'member',  'rejected', false, false),
    (v_late, 'zz-na-late@example.test', 'Zz', 'Nalate', 'member',  'active',   false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects, can_teach = excluded.can_teach;

  insert into public.notification_prefs (user_id)
  select unnest(v_all) on conflict (user_id) do nothing;
  update public.notification_prefs set announcements = (user_id <> v_off)
   where user_id = any (v_all);

  perform pg_temp.act_as(v_a);
  o1 := (public.create_office('Zz Na office one', '')).id;
  o2 := (public.create_office('Zz Na office two', '')).id;
  perform public.set_member_office(v_tf, o1);
  perform public.set_member_office(v_s1, o1);
  perform public.set_member_office(v_sx, o1);
  perform public.set_member_office(v_s2, o2);
  perform pg_temp.act_as_service();

  -- ------------------------------------------------------------ the shape

  perform pg_temp.must_be('program_notices keeps its columns and adds audience at the end',
    (select array_agg(column_name::text order by ordinal_position)
       from information_schema.columns
      where table_schema = 'public' and table_name = 'program_notices')
      = array['id', 'title', 'body', 'pinned', 'created_at', 'edited_at', 'author_id',
              'author_name', 'author_avatar', 'audience']);
  perform pg_temp.must_be('program_notices_all keeps its columns and adds the audience four at the end',
    (select array_agg(column_name::text order by ordinal_position)
       from information_schema.columns
      where table_schema = 'public' and table_name = 'program_notices_all')
      = array['id', 'title', 'body', 'pinned', 'created_at', 'edited_at', 'author_id',
              'author_name', 'author_avatar', 'audience', 'audience_offices', 'audience_groups',
              'audience_office_names']);
  perform pg_temp.must_be('both views stay security_barrier and are not security_invoker',
    (select bool_and(c.reloptions @> array['security_barrier=true']
                     and not exists (select 1 from unnest(c.reloptions) o
                                      where o like 'security_invoker%'))
       from pg_class c
      where c.oid in ('public.program_notices'::regclass, 'public.program_notices_all'::regclass)));

  -- ------------------------------------------------------------ refusals

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse_exact('an offices notice with no office list is refused',
    format('insert into public.program_announcements (author_id, title, body, audience)
            values (%L, %L, %L, %L)', v_a, 'Zz Na refused', 'b', 'offices'),
    'program_announcements_audience_shape');
  perform pg_temp.must_refuse_exact('an offices notice with an empty office list is refused',
    format('insert into public.program_announcements (author_id, title, body, audience, audience_offices)
            values (%L, %L, %L, %L, %L)', v_a, 'Zz Na refused', 'b', 'offices', '{}'),
    'program_announcements_audience_shape');
  perform pg_temp.must_refuse_exact('a groups notice with an empty group list is refused',
    format('insert into public.program_announcements (author_id, title, body, audience, audience_groups)
            values (%L, %L, %L, %L, %L)', v_a, 'Zz Na refused', 'b', 'groups', '{}'),
    'program_announcements_audience_shape');
  perform pg_temp.must_refuse_exact('a group outside the three is refused',
    format('insert into public.program_announcements (author_id, title, body, audience, audience_groups)
            values (%L, %L, %L, %L, %L)', v_a, 'Zz Na refused', 'b', 'groups', '{students,admins}'),
    'program_announcements_audience_groups');
  perform pg_temp.must_refuse_exact('mixed lists are refused: offices with groups',
    format('insert into public.program_announcements
              (author_id, title, body, audience, audience_offices, audience_groups)
            values (%L, %L, %L, %L, %L, %L)',
           v_a, 'Zz Na refused', 'b', 'offices', array[o1]::text, '{students}'),
    'program_announcements_audience_shape');
  perform pg_temp.must_refuse_exact('mixed lists are refused: groups with offices',
    format('insert into public.program_announcements
              (author_id, title, body, audience, audience_offices, audience_groups)
            values (%L, %L, %L, %L, %L, %L)',
           v_a, 'Zz Na refused', 'b', 'groups', array[o1]::text, '{students}'),
    'program_announcements_audience_shape');
  perform pg_temp.must_refuse_exact('everyone with a list is refused',
    format('insert into public.program_announcements (author_id, title, body, audience, audience_groups)
            values (%L, %L, %L, %L, %L)', v_a, 'Zz Na refused', 'b', 'everyone', '{staff}'),
    'program_announcements_audience_shape');
  perform pg_temp.must_refuse_exact('an office list holding a null is refused',
    format('insert into public.program_announcements (author_id, title, body, audience, audience_offices)
            values (%L, %L, %L, %L, %L)', v_a, 'Zz Na refused', 'b', 'offices', '{NULL}'),
    'program_announcements_audience_shape');
  perform pg_temp.must_refuse_exact('an audience outside the three is refused',
    format('insert into public.program_announcements (author_id, title, body, audience)
            values (%L, %L, %L, %L)', v_a, 'Zz Na refused', 'b', 'school'),
    'program_announcements_audience_kind');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and a refusal writes nothing',
    not exists (select 1 from public.program_announcements where title = 'Zz Na refused'));

  perform pg_temp.act_as(v_s1);
  perform pg_temp.must_refuse_exact('admin_notice_reach refuses a member',
    'select public.admin_notice_reach(''everyone'', ''{}'', ''{}'')', 'Only an admin can send notices.');
  perform pg_temp.act_as(v_stu);
  perform pg_temp.must_refuse_exact('admin_notice_reach refuses a student',
    'select public.admin_notice_reach(''everyone'', ''{}'', ''{}'')', 'Only an admin can send notices.');
  perform pg_temp.act_as(v_pa);
  perform pg_temp.must_refuse_exact('admin_notice_reach refuses an inactive admin',
    'select public.admin_notice_reach(''everyone'', ''{}'', ''{}'')', 'Only an admin can send notices.');
  perform pg_temp.act_as_service();

  -- ------------------------------------------------------------ an old-style notice
  --
  -- Written the way every notice before this file was: no audience columns at all.

  insert into public.program_announcements (author_id, title, body)
  values (v_a, 'Zz Na old style', 'Written before audiences.') returning id into n_old;
  perform pg_temp.must_be('a notice written without an audience reads as everyone',
    exists (select 1 from public.program_announcements
             where id = n_old and audience = 'everyone'
               and audience_offices = '{}' and audience_groups = '{}'));
  perform pg_temp.must_be('...and every active account reads it, nobody inactive',
    pg_temp.view_readers(n_old, v_people)
      = pg_temp.sorted(array[v_stu, v_off, v_t, v_tf, v_s1, v_s2, v_s0, v_late]));

  -- ------------------------------------------------------------ each audience
  --
  -- The author is v_a every time. Four are sent as the admin (under the rate limit of six an
  -- hour), the rest by the service role with v_a as author; the reach is always asked as v_a.

  perform pg_temp.act_as(v_a);
  reach := public.admin_notice_reach('everyone', '{}', '{}');
  insert into public.program_announcements (author_id, title, body)
  values (v_a, 'Zz Na everyone', 'To all.') returning id into n_ev;
  perform pg_temp.check_notice('everyone', n_ev, 'Zz Na everyone', reach, v_all, v_people,
    array[v_a2, v_stu, v_t, v_tf, v_s1, v_s2, v_s0, v_late],
    array[v_stu, v_off, v_t, v_tf, v_s1, v_s2, v_s0, v_late]);

  perform pg_temp.act_as(v_a);
  reach := public.admin_notice_reach('offices', array[o1], '{}');
  insert into public.program_announcements (author_id, title, body, audience, audience_offices)
  values (v_a, 'Zz Na office one', 'To office one.', 'offices', array[o1]) returning id into n_o1;
  perform pg_temp.check_notice('office one (a teacher filed in it included)', n_o1,
    'Zz Na office one', reach, v_all, v_people,
    array[v_tf, v_s1], array[v_tf, v_s1]);
  perform pg_temp.must_be('the reach of a new office is its two active people', reach = 2);

  perform pg_temp.act_as(v_a);
  reach := public.admin_notice_reach('offices', array[o1, o2], '{}');
  perform pg_temp.act_as_service();
  insert into public.program_announcements (author_id, title, body, audience, audience_offices)
  values (v_a, 'Zz Na offices one and two', 'To both.', 'offices', array[o1, o2])
  returning id into n_o12;
  perform pg_temp.check_notice('offices one and two', n_o12, 'Zz Na offices one and two', reach,
    v_all, v_people, array[v_tf, v_s1, v_s2], array[v_tf, v_s1, v_s2]);

  perform pg_temp.act_as(v_a);
  reach := public.admin_notice_reach('groups', '{}', array['students']);
  insert into public.program_announcements (author_id, title, body, audience, audience_groups)
  values (v_a, 'Zz Na students', 'To students.', 'groups', array['students'])
  returning id into n_stu;
  perform pg_temp.check_notice('students (announcements off: reads, not notified)', n_stu,
    'Zz Na students', reach, v_all, v_people, array[v_stu], array[v_stu, v_off]);

  perform pg_temp.act_as(v_a);
  reach := public.admin_notice_reach('groups', '{}', array['teaching']);
  perform pg_temp.act_as_service();
  insert into public.program_announcements (author_id, title, body, audience, audience_groups)
  values (v_a, 'Zz Na teaching', 'To teaching faculty.', 'groups', array['teaching'])
  returning id into n_tch;
  perform pg_temp.check_notice('teaching faculty', n_tch, 'Zz Na teaching', reach,
    v_all, v_people, array[v_t, v_tf], array[v_t, v_tf]);

  perform pg_temp.act_as(v_a);
  reach := public.admin_notice_reach('groups', '{}', array['staff']);
  insert into public.program_announcements (author_id, title, body, audience, audience_groups)
  values (v_a, 'Zz Na staff', 'To office staff.', 'groups', array['staff'])
  returning id into n_stf;
  perform pg_temp.check_notice('office staff', n_stf, 'Zz Na staff', reach, v_all, v_people,
    array[v_s1, v_s2, v_s0, v_late], array[v_s1, v_s2, v_s0, v_late]);

  perform pg_temp.act_as(v_a);
  reach := public.admin_notice_reach('groups', '{}', array['students', 'staff']);
  perform pg_temp.act_as_service();
  insert into public.program_announcements (author_id, title, body, audience, audience_groups)
  values (v_a, 'Zz Na students and staff', 'To both.', 'groups', array['students', 'staff'])
  returning id into n_mix;
  perform pg_temp.check_notice('students and staff', n_mix, 'Zz Na students and staff', reach,
    v_all, v_people, array[v_stu, v_s1, v_s2, v_s0, v_late],
    array[v_stu, v_off, v_s1, v_s2, v_s0, v_late]);

  perform pg_temp.must_be('the author and inactive accounts are never notified',
    pg_temp.notified('Zz Na everyone', array[v_a, v_pa, v_sin, v_sx]) = '{}'
    and pg_temp.notified('Zz Na office one', array[v_a, v_sx]) = '{}'
    and pg_temp.notified('Zz Na students', array[v_a, v_sin]) = '{}');

  -- ------------------------------------------------------------ the admin reads all

  perform pg_temp.act_as(v_a2);
  perform pg_temp.must_be('another admin reads every notice through the table',
    (select count(*) from public.program_announcements
      where id in (n_old, n_ev, n_o1, n_o12, n_stu, n_tch, n_stf, n_mix)) = 8);
  perform pg_temp.must_be('...and through program_notices_all, with each audience',
    (select count(*) from public.program_notices_all
      where id in (n_old, n_ev, n_o1, n_o12, n_stu, n_tch, n_stf, n_mix)) = 8
    and exists (select 1 from public.program_notices_all
                 where id = n_o12 and audience = 'offices' and audience_offices = array[o1, o2]
                   and audience_groups = '{}'
                   and audience_office_names = array['Zz Na office one', 'Zz Na office two'])
    and exists (select 1 from public.program_notices_all
                 where id = n_mix and audience = 'groups'
                   and audience_groups = array['students', 'staff']
                   and audience_office_names = '{}')
    and exists (select 1 from public.program_notices_all
                 where id = n_ev and audience = 'everyone' and audience_office_names = '{}'));
  perform pg_temp.must_be('program_notices carries the audience',
    (select audience from public.program_notices where id = n_ev) = 'everyone');
  perform pg_temp.act_as(v_s1);
  perform pg_temp.must_be('a member reads nothing from program_notices_all',
    (select count(*) from public.program_notices_all) = 0);
  perform pg_temp.must_be('program_notices carries the audience to a reader',
    (select audience from public.program_notices where id = n_o1) = 'offices');

  -- ------------------------------------------------------------ a hand-built row

  perform pg_temp.act_as_service();
  select * into r from public.program_announcements where id = n_o1;
  select * into r_ev from public.program_announcements where id = n_ev;

  perform pg_temp.act_as(v_stu);
  perform pg_temp.must_be('notice_reaches answers false about someone else to a non-admin',
    not public.notice_reaches(r, v_s1)
    and not public.notice_reaches(r_ev, v_s1)
    and not public.notice_reaches(r_ev, v_off));
  perform pg_temp.must_be('...and true about the caller in the audience',
    public.notice_reaches(r_ev, v_stu) and not public.notice_reaches(r, v_stu));
  r.audience_offices := array[o2];
  perform pg_temp.act_as(v_s1);
  perform pg_temp.must_be('a hand-built row cannot probe another office''s member',
    not public.notice_reaches(r, v_s2) and not public.notice_reaches(r, v_tf));
  perform pg_temp.act_as(v_s2);
  perform pg_temp.must_be('...while the member asks about themselves',
    public.notice_reaches(r, v_s2));
  perform pg_temp.act_as(v_a2);
  perform pg_temp.must_be('an admin may ask about anyone',
    public.notice_reaches(r, v_s2) and not public.notice_reaches(r, v_s1)
    and public.notice_reaches(r_ev, v_s1) and not public.notice_reaches(r_ev, v_sin));

  -- ------------------------------------------------------------ a sent notice keeps its audience

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse_exact('changing a sent notice''s audience is refused',
    format('update public.program_announcements set audience = ''everyone'', audience_offices = ''{}''
             where id = %L', n_o1),
    'A sent notice keeps its audience. Take it down and send a new one.');
  perform pg_temp.must_refuse_exact('...its group list too',
    format('update public.program_announcements set audience_groups = ''{students,teaching}''
             where id = %L', n_stu),
    'A sent notice keeps its audience. Take it down and send a new one.');
  perform pg_temp.must_refuse_exact('...its office list too',
    format('update public.program_announcements set audience_offices = %L where id = %L',
           array[o2]::text, n_o1),
    'A sent notice keeps its audience. Take it down and send a new one.');
  perform pg_temp.act_as_service();
  perform pg_temp.must_refuse_exact('...even for the service role',
    format('update public.program_announcements set audience = ''groups'', audience_offices = ''{}'',
              audience_groups = ''{staff}'' where id = %L', n_o1),
    'A sent notice keeps its audience. Take it down and send a new one.');

  perform pg_temp.act_as(v_a);
  update public.program_announcements
     set title = 'Zz Na office one, edited', body = 'A new body.', edited_at = now()
   where id = n_o1;
  update public.program_announcements set audience = 'offices' where id = n_o1;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('title and body edits still work, the audience stays',
    exists (select 1 from public.program_announcements
             where id = n_o1 and title = 'Zz Na office one, edited' and body = 'A new body.'
               and audience = 'offices' and audience_offices = array[o1]));

  -- ------------------------------------------------------------ read at read time

  perform pg_temp.act_as(v_a);
  perform public.set_member_office(v_late, o1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('someone filed into the office after sending reads the notice',
    pg_temp.view_readers(n_o1, v_people) = pg_temp.sorted(array[v_tf, v_s1, v_late])
    and pg_temp.table_readers(n_o1, v_people) = pg_temp.sorted(array[v_tf, v_s1, v_late]));
  perform pg_temp.must_be('...without being notified after the fact',
    pg_temp.notified('Zz Na office one', array[v_late]) = '{}');

  -- archive_office refuses while active people are filed, so the archive is forced here: the
  -- people stay filed until they are moved, and so they keep reading.
  begin
    update public.offices set archived_at = now() where id = o1;
    perform pg_temp.must_be('an office archived after sending: its members still read the notice',
      pg_temp.view_readers(n_o1, v_people) = pg_temp.sorted(array[v_tf, v_s1, v_late])
      and pg_temp.table_readers(n_o12, v_people) = pg_temp.sorted(array[v_tf, v_s1, v_s2, v_late]));
    raise exception 'zz undo';
  exception when others then
    if sqlerrm <> 'zz undo' then raise; end if;
  end;

  -- ------------------------------------------------------------ the wiring

  perform pg_temp.must_be('the table''s policies are the read policy and the admin''s write only',
    (select array_agg(policyname::text order by policyname) from pg_policies
      where schemaname = 'public' and tablename = 'program_announcements')
      = array['program_announcements_read', 'program_announcements_write']
    and (select qual from pg_policies
          where schemaname = 'public' and tablename = 'program_announcements'
            and policyname = 'program_announcements_read') like '%notice_reaches%');
  perform pg_temp.must_be('Realtime publishes the table, so its read policy is what subscribers get',
    exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public'
               and tablename = 'program_announcements'));
  perform pg_temp.must_be('the notifier and the audience guard are triggers on the table',
    exists (select 1 from pg_trigger where tgname = 'program_announcements_notify'
             and tgrelid = 'public.program_announcements'::regclass)
    and exists (select 1 from pg_trigger where tgname = 'program_announcements_keep_audience'
                 and tgrelid = 'public.program_announcements'::regclass));
  perform pg_temp.must_be('authenticated runs notice_reaches and admin_notice_reach, anon neither',
    has_function_privilege('authenticated',
      'public.notice_reaches(public.program_announcements, uuid)', 'execute')
    and has_function_privilege('authenticated',
      'public.admin_notice_reach(text, uuid[], text[])', 'execute')
    and not has_function_privilege('anon',
      'public.notice_reaches(public.program_announcements, uuid)', 'execute')
    and not has_function_privilege('anon',
      'public.admin_notice_reach(text, uuid[], text[])', 'execute'));
  perform pg_temp.must_be('nobody signed in calls the internal audience helpers',
    not has_function_privilege('authenticated',
      'public.notice_audience_includes(text, uuid[], text[], uuid)', 'execute')
    and not has_function_privilege('authenticated',
      'public.notice_recipients(text, uuid[], text[], uuid)', 'execute')
    and not has_function_privilege('authenticated',
      'public.program_announcements_keep_audience()', 'execute')
    and not has_function_privilege('anon',
      'public.notice_audience_includes(text, uuid[], text[], uuid)', 'execute'));

  perform pg_temp.act_as_service();
  raise notice 'notice audience suite: all passed';
end $$;

rollback;
