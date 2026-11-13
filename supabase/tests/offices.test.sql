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
      (v_stu,    'zz-of-stu@example.test')
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
    (v_stu,    'zz-of-stu@example.test',    'Zz', 'Ofstu',    'student', 'active',   false, false)
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

  perform pg_temp.must_refuse_with('a second office named "  registrar " is refused',
    'select public.create_office(''  zz  registrar '')', 'Zz Registrar');
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
  perform pg_temp.must_refuse_with('restore is refused while a live office has the same name',
    format('select public.restore_office(%L)', v_reg),
    'An office named Zz Registrar already exists. Rename one of them first.');

  perform public.restore_office(v_cash);
  perform pg_temp.must_be('restore leaves one office_restored row',
    pg_temp.audits('office_restored', v_cash) = 1
    and (select archived_at is null from public.offices where id = v_cash));

  perform pg_temp.must_refuse_with('a rename onto a live name is refused',
    format('select public.rename_office(%L, '' zz cashier'', '''')', v_reg2), 'Zz Cashier');
  o := public.rename_office(v_reg2, 'Zz Records', 'Student records');
  perform pg_temp.must_be('rename leaves one office_renamed row with both names',
    o.name = 'Zz Records' and o.description = 'Student records'
    and pg_temp.audits('office_renamed', v_reg2) = 1
    and exists (select 1 from public.audit_events where action = 'office_renamed'
                 and subject_id = v_reg2 and before_value = 'ZZ registrar'
                 and after_value = 'Zz Records'));
  o := public.rename_office(v_reg2, 'Zz Registrar', 'Student records');

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

  perform pg_temp.act_as_service();
  raise notice 'offices suite: all passed';
end $$;

rollback;
