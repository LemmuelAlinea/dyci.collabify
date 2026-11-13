-- supabase/tests/offices.test.sql
-- Offices: who writes them, home offices, space offices, archive, restore, delete
-- and the audit rows each write leaves. Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/offices.sql supabase/anon-lockdown.sql supabase/tests/offices.test.sql
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

/** Runs a statement and asserts it is refused, for the reason under test. */
create or replace function pg_temp.must_refuse_with(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_needle) in lower(sqlerrm)) > 0 then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
      return;
    end if;
    raise exception 'FAIL  % — refused for another reason: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

/**
 * Like must_refuse_with, but the message must hold the needle exactly as written, case
 * and all, so a message echoing the caller's input instead of the stored name fails.
 */
create or replace function pg_temp.must_refuse_exact(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_needle in sqlerrm) > 0 then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
      return;
    end if;
    raise exception 'FAIL  % — refused with another message: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

/** Audit rows of one action about one subject, read as the database. */
create or replace function pg_temp.audits(p_action text, p_subject uuid) returns int
language sql as $$
  select count(*)::int from public.audit_events
   where action::text = p_action and subject_id = p_subject;
$$;

do $$
declare
  v_admin   uuid := gen_random_uuid();  -- the active admin
  v_padmin  uuid := gen_random_uuid();  -- an admin still pending
  v_m1      uuid := gen_random_uuid();  -- member, project manager switch on
  v_m2      uuid := gen_random_uuid();  -- member
  v_m3      uuid := gen_random_uuid();  -- member
  v_m4      uuid := gen_random_uuid();  -- member
  v_pend    uuid := gen_random_uuid();  -- pending member
  v_rej     uuid := gen_random_uuid();  -- rejected member
  v_stu     uuid := gen_random_uuid();  -- student
  v_pm2     uuid := gen_random_uuid();  -- member, project manager switch on, later off
  v_teach   uuid := gen_random_uuid();  -- member who teaches, for a class board project
  v_m6      uuid := gen_random_uuid();  -- member made after the first Unassigned read
  v_bulk    uuid := gen_random_uuid();  -- bulk import, still pending setup
  v_bulk2   uuid := gen_random_uuid();  -- bulk import, active (not in setup)
  v_reg     uuid;  -- Zz Registrar, later archived and deleted
  v_reg2    uuid;  -- a second Zz Registrar, made once the first is archived
  v_old     uuid;  -- an archived office
  v_cash    uuid;  -- Zz Cashier
  v_space1  uuid;  -- work space made by m1 before m1 had an office
  v_space2  uuid;  -- work space made by m1 in Registrar
  v_space3  uuid;  -- archived work space in Registrar
  v_edu     uuid;  -- an education space
  o         public.offices%rowtype;
  n         int;
  s         text;
  -- admin reads
  v_ov      uuid;  -- Zz Overview, the office whose counts are exact
  v_s       uuid;  -- work space in Overview (m1)
  v_s2      uuid;  -- work space filed in Overview by the admin (pm2)
  v_s3      uuid;  -- work space in Overview, archived part way through
  v_syl     uuid;
  v_class   uuid;
  v_cproj   uuid;
  v_board   uuid;
  pq15      uuid;  -- last person event 15 days ago, open task: quiet
  pq13      uuid;  -- last person event 13 days ago, open task: not quiet
  pnull     uuid;  -- person event 16 days ago, automation 1 day ago: quiet
  pdone     uuid;  -- every live task done: never quiet
  pempty    uuid;  -- no tasks, made 15 days ago: quiet
  parch     uuid;  -- archived: never listed
  pnopm     uuid;  -- its pm lost the switch: no_pm
  pcb       uuid;  -- a class board project in a work space: never listed
  p3        uuid;  -- running project in the space that gets archived
  t         uuid;
  v_e15     timestamptz := now() - interval '15 days';
  r         record;
  u0        record;
  u1        record;
  sm0       record;
  sm1       record;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_admin,  'zz-of-admin@example.test'),
      (v_padmin, 'zz-of-padmin@example.test'),
      (v_m1,     'zz-of-m1@example.test'),
      (v_m2,     'zz-of-m2@example.test'),
      (v_m3,     'zz-of-m3@example.test'),
      (v_m4,     'zz-of-m4@example.test'),
      (v_pend,   'zz-of-pend@example.test'),
      (v_rej,    'zz-of-rej@example.test'),
      (v_stu,    'zz-of-stu@example.test'),
      (v_pm2,    'zz-of-pm2@example.test'),
      (v_teach,  'zz-of-teach@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_admin,  'zz-of-admin@example.test',  'Zz', 'Ofadmin',  'admin',   'active',   false, false),
    (v_padmin, 'zz-of-padmin@example.test', 'Zz', 'Ofpadmin', 'admin',   'pending',  false, false),
    (v_m1,     'zz-of-m1@example.test',     'Zz', 'Ofm1',     'member',  'active',   false, true),
    (v_m2,     'zz-of-m2@example.test',     'Zz', 'Ofm2',     'member',  'active',   false, false),
    (v_m3,     'zz-of-m3@example.test',     'Zz', 'Ofm3',     'member',  'active',   false, false),
    (v_m4,     'zz-of-m4@example.test',     'Zz', 'Ofm4',     'member',  'active',   false, false),
    (v_pend,   'zz-of-pend@example.test',   'Zz', 'Ofpend',   'member',  'pending',  false, false),
    (v_rej,    'zz-of-rej@example.test',    'Zz', 'Ofrej',    'member',  'rejected', false, false),
    (v_stu,    'zz-of-stu@example.test',    'Zz', 'Ofstu',    'student', 'active',   false, false),
    (v_pm2,    'zz-of-pm2@example.test',    'Zz', 'Ofpm2',    'member',  'active',   false, true),
    (v_teach,  'zz-of-teach@example.test',  'Zz', 'Ofteach',  'member',  'active',   true,  false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects, can_teach = excluded.can_teach;

  -- A work space made before its creator has an office, and an education space.
  perform pg_temp.act_as(v_m1);
  v_space1 := (public.create_general_space('Zz Of space one', '')).id;
  perform pg_temp.act_as_service();
  insert into public.general_spaces (name, created_by, kind)
  values ('Zz Of class space', v_m1, 'education') returning id into v_edu;

  -- ------------------------------------------------------------ who writes

  perform pg_temp.act_as(v_m1);
  perform pg_temp.must_refuse_with('a member cannot create an office',
    'select public.create_office(''Zz Registrar'')', 'Only an admin can change offices.');

  perform pg_temp.act_as(v_padmin);
  perform pg_temp.must_refuse_with('a pending admin cannot create an office',
    'select public.create_office(''Zz Registrar'')', 'Only an admin can change offices.');

  perform pg_temp.act_as(v_admin);
  o := public.create_office('  Zz   Registrar ', 'Records and enrollment');
  v_reg := o.id;
  perform pg_temp.must_be('the admin creates Registrar',
    o.name = 'Zz Registrar' and o.description = 'Records and enrollment'
    and o.archived_at is null and o.created_by = v_admin);
  perform pg_temp.must_be('create leaves one office_created row',
    pg_temp.audits('office_created', v_reg) = 1);

  perform pg_temp.must_refuse_exact('a second office named "  zz  registrar " is refused, naming the live one',
    'select public.create_office(''  zz  registrar '')',
    'An office named Zz Registrar already exists. Pick another name.');
  perform pg_temp.must_refuse_with('an empty office name is refused',
    'select public.create_office(''   '')', '1 to 80 characters');

  perform pg_temp.act_as(v_m1);
  perform pg_temp.must_refuse_with('a member cannot set their own office',
    format('select public.set_member_office(%L, %L)', v_m1, v_reg),
    'Only an admin can change offices.');
  perform pg_temp.must_refuse_with('a member cannot set a space''s office',
    format('select public.set_space_office(%L, %L)', v_space1, v_reg),
    'Only an admin can change offices.');
  perform pg_temp.must_refuse_with('a member cannot rename an office',
    format('select public.rename_office(%L, ''Zz Mine'', '''')', v_reg),
    'Only an admin can change offices.');
  perform pg_temp.must_refuse_with('a member cannot archive an office',
    format('select public.archive_office(%L)', v_reg), 'Only an admin can change offices.');
  perform pg_temp.must_refuse_with('a member cannot write office_members directly',
    format('insert into public.office_members (user_id, office_id) values (%L, %L)', v_m1, v_reg),
    'permission denied');

  -- ------------------------------------------------------------ home offices

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_refuse_with('the admin cannot give a student an office',
    format('select public.set_member_office(%L, %L)', v_stu, v_reg),
    'Only members have an office.');
  perform pg_temp.must_refuse_with('the admin cannot give an admin an office',
    format('select public.set_member_office(%L, %L)', v_admin, v_reg),
    'Only members have an office.');

  perform public.set_member_office(v_pend, v_reg);
  perform pg_temp.must_be('a pending member can be given an office',
    exists (select 1 from public.office_members where user_id = v_pend and office_id = v_reg));
  perform pg_temp.must_be('setting an office leaves one office_changed row',
    pg_temp.audits('office_changed', v_pend) = 1
    and exists (select 1 from public.audit_events where action = 'office_changed'
                 and subject_id = v_pend and before_value = '' and after_value = 'Zz Registrar'));

  perform public.set_member_office(v_pend, v_reg);
  perform pg_temp.must_be('setting the same office again writes nothing',
    pg_temp.audits('office_changed', v_pend) = 1);

  v_old := (public.create_office('Zz Old office')).id;
  perform public.archive_office(v_old);
  perform pg_temp.must_be('archive leaves one office_archived row',
    pg_temp.audits('office_archived', v_old) = 1
    and (select archived_at is not null from public.offices where id = v_old));
  perform pg_temp.must_refuse_with('assigning to an archived office is refused',
    format('select public.set_member_office(%L, %L)', v_m2, v_old),
    'This office is archived. Restore it first.');
  perform pg_temp.must_refuse_with('a space cannot go to an archived office',
    format('select public.set_space_office(%L, %L)', v_space1, v_old),
    'This office is archived. Restore it first.');

  -- ------------------------------------------------------------ space offices

  perform public.set_member_office(v_m1, v_reg);
  perform pg_temp.act_as(v_m1);
  v_space2 := (public.create_general_space('Zz Of space two', '')).id;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a new work space created by a member in Registrar starts in Registrar',
    exists (select 1 from public.office_spaces
             where space_id = v_space2 and office_id = v_reg and assigned_by = v_m1));
  perform pg_temp.must_be('an education space never gets an office row',
    not exists (select 1 from public.office_spaces where space_id = v_edu));
  perform pg_temp.must_be('a space created by someone with no office has no row',
    not exists (select 1 from public.office_spaces where space_id = v_space1));

  -- An archived work space in Registrar.
  insert into public.general_spaces (name, created_by, archived_at)
  values ('Zz Of space three', v_m1, now()) returning id into v_space3;

  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_refuse_with('an education space cannot be given an office',
    format('select public.set_space_office(%L, %L)', v_edu, v_reg),
    'Only a work space has an office.');
  perform public.set_space_office(v_space1, v_reg);
  perform pg_temp.must_be('the admin files a space under an office',
    exists (select 1 from public.office_spaces where space_id = v_space1 and office_id = v_reg));
  perform pg_temp.must_be('setting a space office leaves one space_office_changed row',
    pg_temp.audits('space_office_changed', v_space1) = 1
    and exists (select 1 from public.audit_events where action = 'space_office_changed'
                 and subject_id = v_space1 and subject_label = 'Zz Of space one'
                 and before_value = '' and after_value = 'Zz Registrar'));

  -- ------------------------------------------------------------ reads

  perform pg_temp.act_as(v_m1);
  perform pg_temp.must_be('a member reads their own office row only',
    (select count(*) from public.office_members) = 1
    and exists (select 1 from public.office_members where user_id = v_m1));
  perform pg_temp.must_be('a space member reads their space''s office row',
    exists (select 1 from public.office_spaces where space_id = v_space1));
  perform pg_temp.must_be('every account reads office names',
    exists (select 1 from public.offices where id = v_old));
  perform pg_temp.act_as(v_m2);
  perform pg_temp.must_be('a non-member of the space reads no space office row',
    not exists (select 1 from public.office_spaces where space_id = v_space1));
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_be('the admin reads every home office row',
    (select count(*) from public.office_members where user_id in (v_m1, v_pend)) = 2);

  -- ------------------------------------------------------------ archive

  v_cash := (public.create_office('Zz Cashier')).id;
  perform public.set_member_office(v_m2, v_cash);
  perform pg_temp.must_refuse_with('archive with one active member is refused',
    format('select public.archive_office(%L)', v_cash), 'Move its 1 person first.');

  perform public.set_member_office(v_m3, v_reg);
  perform public.set_member_office(v_m4, v_reg);
  perform public.set_member_office(v_rej, v_reg);
  perform pg_temp.must_refuse_with('archive with people and spaces is refused',
    format('select public.archive_office(%L)', v_reg), 'Move its 3 people and 2 spaces first.');

  perform public.set_member_office(v_m2, null);
  perform pg_temp.must_be('clearing an office leaves one more office_changed row',
    pg_temp.audits('office_changed', v_m2) = 2
    and not exists (select 1 from public.office_members where user_id = v_m2));
  perform public.archive_office(v_cash);

  perform public.set_member_office(v_m1, null);
  perform public.set_member_office(v_m3, null);
  perform public.set_member_office(v_m4, null);
  perform pg_temp.must_refuse_with('archive with only spaces left is refused',
    format('select public.archive_office(%L)', v_reg), 'Move its 2 spaces first.');
  perform public.set_space_office(v_space1, null);
  perform pg_temp.must_refuse_with('archive with one space left is refused',
    format('select public.archive_office(%L)', v_reg), 'Move its 1 space first.');
  perform public.set_space_office(v_space2, null);

  perform public.archive_office(v_reg);
  perform pg_temp.must_be('archive ignores a rejected member and clears their office',
    not exists (select 1 from public.office_members where user_id in (v_rej, v_pend))
    and exists (select 1 from public.audit_events where action = 'office_changed'
                 and subject_id = v_rej and before_value = 'Zz Registrar' and after_value = ''));
  perform pg_temp.must_be('archive ignores an archived space, which keeps its row',
    exists (select 1 from public.office_spaces where space_id = v_space3 and office_id = v_reg));
  perform pg_temp.must_be('a refused archive writes nothing',
    pg_temp.audits('office_archived', v_reg) = 1 and pg_temp.audits('office_archived', v_cash) = 1);

  -- ------------------------------------------------------------ restore and rename

  o := public.create_office('ZZ registrar');
  v_reg2 := o.id;
  perform pg_temp.must_refuse_exact('restore is refused while a live office has the same name, naming the live one',
    format('select public.restore_office(%L)', v_reg),
    'An office named ZZ registrar already exists. Rename one of them first.');

  perform public.restore_office(v_cash);
  perform pg_temp.must_be('restore leaves one office_restored row',
    pg_temp.audits('office_restored', v_cash) = 1
    and (select archived_at is null from public.offices where id = v_cash));

  perform pg_temp.must_refuse_exact('a rename onto a live name is refused, naming the live one',
    format('select public.rename_office(%L, '' zz cashier'', '''')', v_reg2),
    'An office named Zz Cashier already exists. Pick another name.');
  o := public.rename_office(v_reg2, 'Zz Records', 'Student records');
  perform pg_temp.must_be('rename leaves one office_renamed row with both names',
    o.name = 'Zz Records' and o.description = 'Student records'
    and pg_temp.audits('office_renamed', v_reg2) = 1
    and exists (select 1 from public.audit_events where action = 'office_renamed'
                 and subject_id = v_reg2 and before_value = 'ZZ registrar'
                 and after_value = 'Zz Records'));
  o := public.rename_office(v_reg2, 'Zz Registrar', null);
  perform pg_temp.must_be('a rename with no description keeps the description',
    o.name = 'Zz Registrar' and o.description = 'Student records');

  -- ------------------------------------------------------------ delete

  perform pg_temp.must_refuse_with('delete is refused for a live office',
    format('select public.delete_office(%L)', v_reg2),
    'Archive this office and move its people first.');
  perform public.delete_office(v_reg);
  perform pg_temp.must_be('delete of an archived office removes its remaining space rows',
    not exists (select 1 from public.offices where id = v_reg)
    and not exists (select 1 from public.office_spaces where space_id = v_space3)
    and pg_temp.audits('office_deleted', v_reg) = 1
    and pg_temp.audits('space_office_changed', v_space3) = 1);

  -- ------------------------------------------------------------ role changes

  perform public.set_member_office(v_m2, v_reg2);
  perform public.set_account_role(v_m2, 'student');
  perform pg_temp.must_be('a member made student loses their office',
    not exists (select 1 from public.office_members where user_id = v_m2));
  perform pg_temp.must_be('the role change leaves one office_changed row',
    (select count(*) from public.audit_events where action = 'office_changed'
      and subject_id = v_m2 and actor_id = v_admin
      and before_value = 'Zz Registrar' and after_value = '') = 1);

  -- An admin is made from the command line (scripts/set-role.mjs), as the database.
  perform public.set_member_office(v_m4, v_reg2);
  n := pg_temp.audits('office_changed', v_m4);
  perform pg_temp.act_as_service();
  update public.profiles set role = 'admin' where id = v_m4;
  perform pg_temp.must_be('a member made admin loses their office',
    not exists (select 1 from public.office_members where user_id = v_m4));
  perform pg_temp.must_be('...and the change leaves one office_changed row',
    pg_temp.audits('office_changed', v_m4) = n + 1
    and exists (select 1 from public.audit_events where action = 'office_changed'
                 and subject_id = v_m4 and actor_id is null
                 and before_value = 'Zz Registrar' and after_value = ''));
  update public.profiles set role = 'member' where id = v_m4;

  perform pg_temp.act_as(v_admin);
  perform public.set_member_office(v_m3, v_reg2);
  n := pg_temp.audits('office_changed', v_m3);
  update public.profiles set status = 'rejected' where id = v_m3;
  perform pg_temp.must_be('a member who is rejected keeps their office',
    exists (select 1 from public.office_members where user_id = v_m3 and office_id = v_reg2));
  update public.profiles set status = 'active' where id = v_m3;
  perform pg_temp.must_be('...and keeps it when made active again, with no audit row',
    exists (select 1 from public.office_members where user_id = v_m3 and office_id = v_reg2)
    and pg_temp.audits('office_changed', v_m3) = n);
  perform public.set_member_office(v_m3, null);

  -- ------------------------------------------------------------ by name

  s := public.set_member_office_by_name('zz-of-m3@example.test', 'Zz Nowhere');
  perform pg_temp.must_be('by name: an unknown office is unknown_office', s = 'unknown_office');
  s := public.set_member_office_by_name('zz-of-m3@example.test', 'Zz Old office');
  perform pg_temp.must_be('by name: an archived office is unknown_office', s = 'unknown_office');
  s := public.set_member_office_by_name('zz-of-stu@example.test', 'zz registrar');
  perform pg_temp.must_be('by name: a student is not_member', s = 'not_member');
  s := public.set_member_office_by_name('zz-of-nobody@example.test', 'Zz Registrar');
  perform pg_temp.must_be('by name: an unknown email is no_account', s = 'no_account');
  n := pg_temp.audits('office_changed', v_m3);
  s := public.set_member_office_by_name(' ZZ-OF-M3@example.test ', '  zz   REGISTRAR ');
  perform pg_temp.must_be('by name: a member is set',
    s = 'set'
    and exists (select 1 from public.office_members where user_id = v_m3 and office_id = v_reg2)
    and pg_temp.audits('office_changed', v_m3) = n + 1);

  perform pg_temp.act_as(v_m1);
  perform pg_temp.must_refuse_with('a member cannot set an office by name',
    'select public.set_member_office_by_name(''zz-of-m1@example.test'', ''Zz Registrar'')',
    'Only an admin can change offices.');

  -- ------------------------------------------------------------ admin reads
  --
  -- Zz Overview is an office of our own, so its row is exact. The Unassigned row and the
  -- summary also count the live organization, so they are read as differences.

  perform pg_temp.act_as(v_admin);
  v_ov := (public.create_office('Zz Overview')).id;
  perform public.set_member_office(v_m1, v_ov);
  perform public.set_member_office(v_pend, v_ov);

  perform pg_temp.act_as(v_m1);
  v_s := (public.create_general_space('Zz Ov space', '')).id;
  pq15   := (public.create_general_project('Zz Ov quiet 15', '', null, null, null, null, v_s)).id;
  pq13   := (public.create_general_project('Zz Ov quiet 13', '', null, null, null, null, v_s)).id;
  pnull  := (public.create_general_project('Zz Ov null actor', '', null, null, null, null, v_s)).id;
  pdone  := (public.create_general_project('Zz Ov all done', '', null, null, null, null, v_s)).id;
  pempty := (public.create_general_project('Zz Ov empty', '', null, null, null, null, v_s)).id;
  parch  := (public.create_general_project('Zz Ov archived', '', null, null, null, null, v_s)).id;
  v_s3 := (public.create_general_space('Zz Ov space three', '')).id;
  p3     := (public.create_general_project('Zz Ov in space three', '', null, null, null, null, v_s3)).id;
  perform pg_temp.act_as(v_pm2);
  v_s2 := (public.create_general_space('Zz Ov space two', '')).id;
  pnopm  := (public.create_general_project('Zz Ov no pm', '', null, null, null, null, v_s2)).id;
  perform pg_temp.act_as(v_admin);
  perform public.set_space_office(v_s2, v_ov);

  -- A class board's Files project, placed in a work space so only class_board_id keeps it out.
  perform pg_temp.act_as_service();
  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (v_teach, 'syllabus', 'Zz Of syllabus', 'x/of.pdf', 'of.pdf') returning id into v_syl;
  insert into public.syllabus_weeks (resource_id, week_no, title) values (v_syl, 1, 'Week 1');
  perform pg_temp.act_as(v_teach);
  insert into public.classes
    (professor_id, name, initial, code, section, year_level, semester, school_year, syllabus_id)
  values (v_teach, 'Zz Of class', 'ZZO', 'ZZOF-CLASS', 'BSIT 1A', '1st', '1st', '2026-2027', v_syl)
  returning id into v_class;
  perform pg_temp.act_as_service();
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience)
  values (v_class, v_teach, 'Zz Of class project', 'activity', 1, 1, 'individual')
  returning id into v_cproj;
  insert into public.project_boards (project_id, student_id) values (v_cproj, v_stu)
  returning id into v_board;
  insert into public.general_projects (name, space_id, class_board_id, created_by, preset)
  values ('Zz Ov class Files', v_s, v_board, v_teach, 'class-board')
  returning id into pcb;

  -- Backdate, as the database: tasks, person events and automation events.
  update public.general_projects set created_at = now() - interval '30 days'
   where id in (pq15, pq13, pnull, pdone, parch, pcb);
  update public.general_projects set created_at = v_e15 where id = pempty;
  update public.general_projects set archived_at = now() where id = parch;

  insert into public.general_tasks (project_id, title, created_by, routing_state)
  values (pq15, 'Zz Ov open', v_m1, 'released') returning id into t;
  insert into public.general_task_events (task_id, project_id, actor_id, kind, created_at)
  values (t, pq15, v_m1, 'updated', v_e15);

  insert into public.general_tasks (project_id, title, created_by, routing_state)
  values (pq13, 'Zz Ov open', v_m1, 'released') returning id into t;
  insert into public.general_task_events (task_id, project_id, actor_id, kind, created_at)
  values (t, pq13, v_m1, 'updated', now() - interval '13 days');

  insert into public.general_tasks (project_id, title, created_by, routing_state)
  values (pnull, 'Zz Ov open', v_m1, 'released') returning id into t;
  insert into public.general_task_events (task_id, project_id, actor_id, kind, created_at)
  values (t, pnull, v_m1, 'updated', now() - interval '16 days'),
         (t, pnull, null,  'updated', now() - interval '1 day');

  -- All done, beside an open task in the trash and an open task archived: neither is live.
  insert into public.general_tasks (project_id, title, created_by, routing_state)
  values (pdone, 'Zz Ov done', v_m1, 'released') returning id into t;
  update public.general_tasks set status = 'done' where id = t;
  insert into public.general_tasks (project_id, title, created_by, routing_state)
  values (pdone, 'Zz Ov trashed', v_m1, 'released') returning id into t;
  update public.general_tasks
     set archived_at = now(), archived_by = v_m1, trashed_at = now(), trashed_by = v_m1
   where id = t; -- the trash holds archived rows only
  insert into public.general_tasks (project_id, title, created_by, routing_state)
  values (pdone, 'Zz Ov archived', v_m1, 'released') returning id into t;
  update public.general_tasks set archived_at = now(), archived_by = v_m1 where id = t;

  update public.profiles set can_manage_projects = false where id = v_pm2;

  -- Who reads them.
  perform pg_temp.act_as(v_m1);
  perform pg_temp.must_be('a member reads no rows from each of the five functions',
    (select count(*) from public.admin_office_people()) = 0
    and (select count(*) from public.admin_office_spaces()) = 0
    and (select count(*) from public.admin_org_overview()) = 0
    and (select count(*) from public.admin_attention_projects()) = 0
    and (select count(*) from public.admin_org_summary()) = 0);
  perform pg_temp.act_as(v_padmin);
  perform pg_temp.must_be('a pending admin reads no rows either',
    (select count(*) from public.admin_office_people()) = 0
    and (select count(*) from public.admin_office_spaces()) = 0
    and (select count(*) from public.admin_org_overview()) = 0
    and (select count(*) from public.admin_attention_projects()) = 0
    and (select count(*) from public.admin_org_summary()) = 0);

  -- Attention.
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_be('quiet at 15 days',
    exists (select 1 from public.admin_attention_projects() a
             where a.project_id = pq15 and a.project_name = 'Zz Ov quiet 15'
               and a.space_name = 'Zz Ov space' and a.office_id = v_ov
               and a.office_name = 'Zz Overview' and not a.no_pm and a.quiet_since = v_e15));
  perform pg_temp.must_be('not quiet at 13 days',
    not exists (select 1 from public.admin_attention_projects() a where a.project_id = pq13));
  perform pg_temp.must_be('an event with a null actor 1 day ago does not reset quiet',
    exists (select 1 from public.admin_attention_projects() a
             where a.project_id = pnull and a.quiet_since = now() - interval '16 days'));
  perform pg_temp.must_be('a project whose live tasks are all done is never quiet',
    not exists (select 1 from public.admin_attention_projects() a where a.project_id = pdone));
  perform pg_temp.must_be('a project with no tasks created 15 days ago is quiet',
    exists (select 1 from public.admin_attention_projects() a
             where a.project_id = pempty and not a.no_pm and a.quiet_since = v_e15));
  perform pg_temp.must_be('a project whose PM lost Project manager shows no_pm',
    exists (select 1 from public.admin_attention_projects() a
             where a.project_id = pnopm and a.no_pm and a.quiet_since is null
               and a.office_id = v_ov and a.space_name = 'Zz Ov space two'));
  perform pg_temp.must_be('an archived project and a class board project are never listed',
    not exists (select 1 from public.admin_attention_projects() a
                 where a.project_id in (parch, pcb)));
  perform pg_temp.must_be('attention lists no-PM first, then the oldest quiet_since',
    (with a as (select x.project_id, row_number() over () as rn
                  from public.admin_attention_projects() x)
     select (select rn from a where project_id = pnopm) < (select rn from a where project_id = pnull)
        and (select rn from a where project_id = pnull) < (select rn from a where project_id = pq15)));

  -- People and spaces.
  perform pg_temp.must_be('admin_office_people lists members with their office, never a student or admin',
    exists (select 1 from public.admin_office_people() x
             where x.id = v_m1 and x.name = 'Zz Ofm1' and x.email = 'zz-of-m1@example.test'
               and x.status = 'active' and x.office_id = v_ov)
    and exists (select 1 from public.admin_office_people() x
                 where x.id = v_pend and x.status = 'pending' and x.office_id = v_ov)
    and exists (select 1 from public.admin_office_people() x where x.id = v_pm2 and x.office_id is null)
    and not exists (select 1 from public.admin_office_people() x where x.id in (v_stu, v_admin, v_m2)));
  perform pg_temp.must_be('an education space is not in admin_office_spaces',
    not exists (select 1 from public.admin_office_spaces() x where x.id = v_edu)
    and exists (select 1 from public.admin_office_spaces() x
                 where x.id = v_s and x.name = 'Zz Ov space' and x.office_id = v_ov
                   and not x.archived and x.running_projects = 5));

  -- The office row, before and after its third space is archived.
  select * into r from public.admin_org_overview() x where x.office_id = v_ov;
  perform pg_temp.must_be('the office row counts live spaces, running projects and attention',
    r.office_name = 'Zz Overview' and r.spaces = 3 and r.running_projects = 7
    and r.needs_attention = 4);
  perform pg_temp.must_be('a pending member is not in people', r.people = 1);

  perform pg_temp.act_as_service();
  update public.general_spaces set archived_at = now() where id = v_s3;
  perform pg_temp.act_as(v_admin);
  select * into r from public.admin_org_overview() x where x.office_id = v_ov;
  perform pg_temp.must_be('an archived space keeps its office row and leaves spaces and running_projects',
    r.spaces = 2 and r.running_projects = 6 and r.needs_attention = 4
    and exists (select 1 from public.office_spaces where space_id = v_s3 and office_id = v_ov)
    and exists (select 1 from public.admin_office_spaces() x
                 where x.id = v_s3 and x.archived and x.office_id = v_ov and x.running_projects = 0));

  -- Unassigned: one more space with no office and one more member with no office.
  select * into u0 from public.admin_org_overview() x where x.office_id is null;
  perform pg_temp.act_as_service();
  insert into public.general_spaces (name, created_by, kind) values ('Zz Ov loose space', v_pm2, 'work');
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (v_m6, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-of-m6@example.test', '', now(), now());
  insert into public.profiles (id, email, first_name, last_name, role, status)
  values (v_m6, 'zz-of-m6@example.test', 'Zz', 'Ofm6', 'member', 'active')
  on conflict (id) do update set role = excluded.role, status = excluded.status;
  perform pg_temp.act_as(v_admin);
  select * into u1 from public.admin_org_overview() x where x.office_id is null;
  perform pg_temp.must_be('the Unassigned row counts a space with no office and a member with no office',
    u0.office_name = '' and u1.office_name = ''
    and u1.spaces = u0.spaces + 1 and u1.people = u0.people + 1
    and u1.running_projects = u0.running_projects
    and (select count(*) from public.admin_org_overview() x where x.office_id is null) = 1);
  perform pg_temp.must_be('the overview has one row per live office, and none for an archived one',
    exists (select 1 from public.admin_org_overview() x where x.office_id = v_reg2)
    and not exists (select 1 from public.admin_org_overview() x where x.office_id = v_old));

  -- Summary.
  select * into sm0 from public.admin_org_summary();
  perform pg_temp.act_as_service();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values (v_bulk, 'zz-of-bulk@example.test'), (v_bulk2, 'zz-of-bulk2@example.test')) v(id, em);
  insert into public.profiles (id, email, first_name, last_name, role, status, bulk_setup_required)
  values (v_bulk,  'zz-of-bulk@example.test',  'Zz', 'Ofbulk',  'member', 'pending', true),
         (v_bulk2, 'zz-of-bulk2@example.test', 'Zz', 'Ofbulk2', 'member', 'active',  true)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        bulk_setup_required = excluded.bulk_setup_required;
  insert into public.privacy_requests
    (requester_name, requester_email, kind, status, acknowledge_by, complete_by)
  values
    ('Zz Of', 'zz-of-pr@example.test', 'access', 'open',         current_date - 1, current_date + 10),
    ('Zz Of', 'zz-of-pr@example.test', 'access', 'open',         current_date + 2, current_date + 10),
    ('Zz Of', 'zz-of-pr@example.test', 'access', 'open',         current_date + 3, current_date + 10),
    ('Zz Of', 'zz-of-pr@example.test', 'access', 'acknowledged', current_date - 5, current_date + 1),
    ('Zz Of', 'zz-of-pr@example.test', 'access', 'acknowledged', current_date - 5, current_date + 9),
    ('Zz Of', 'zz-of-pr@example.test', 'access', 'completed',    current_date - 9, current_date - 1);
  perform pg_temp.act_as(v_admin);
  select * into sm1 from public.admin_org_summary();
  perform pg_temp.must_be('accounts_in_setup counts a pending bulk import, not an active one',
    sm1.accounts_in_setup = sm0.accounts_in_setup + 1);
  perform pg_temp.must_be('privacy_due counts open past acknowledge_by and acknowledged near complete_by, not completed',
    sm1.privacy_due = sm0.privacy_due + 3);

  -- The privacy boundary: names and counts only.
  perform pg_temp.must_be('the five functions return exactly their columns',
    pg_get_function_result('public.admin_office_people()'::regprocedure)
      = 'TABLE(id uuid, name text, email text, status text, office_id uuid)'
    and pg_get_function_result('public.admin_office_spaces()'::regprocedure)
      = 'TABLE(id uuid, name text, office_id uuid, archived boolean, running_projects integer)'
    and pg_get_function_result('public.admin_org_overview()'::regprocedure)
      = 'TABLE(office_id uuid, office_name text, spaces integer, running_projects integer, people integer, needs_attention integer)'
    and pg_get_function_result('public.admin_attention_projects()'::regprocedure)
      = 'TABLE(project_id uuid, project_name text, space_name text, office_id uuid, office_name text, no_pm boolean, quiet_since timestamp with time zone)'
    and pg_get_function_result('public.admin_org_summary()'::regprocedure)
      = 'TABLE(accounts_in_setup integer, privacy_due integer)');
  perform pg_temp.must_be('person events are indexed by project and time',
    exists (select 1 from pg_indexes
             where schemaname = 'public' and indexname = 'general_task_events_person_recent'));

  perform pg_temp.act_as_service();
  raise notice 'offices suite: all passed';
end $$;

rollback;
