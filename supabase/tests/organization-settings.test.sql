-- supabase/tests/organization-settings.test.sql
-- Organization settings: the one row, its read helpers, the audited admin setter and the
-- trash purge preview. Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/organization-settings.sql supabase/anon-lockdown.sql supabase/tests/organization-settings.test.sql
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

/**
 * The org_setting_changed rows our fixtures wrote, as label:before>after, sorted. One
 * transaction gives every row the same `at`, so the rows compare as a set.
 */
create or replace function pg_temp.audits(p_actors uuid[]) returns text[]
language sql as $$
  select coalesce(array_agg(x order by x), '{}') from (
    select subject_label || ':' || before_value || '>' || after_value as x
    from public.audit_events
   where action::text = 'org_setting_changed' and actor_id = any (p_actors)) e;
$$;

/**
 * Every trashed row whose date is past a p_days limit, counted straight from the tables purge_trash
 * reads, read as the database. The preview should equal it.
 */
create or replace function pg_temp.eligible(p_days int) returns int
language sql as $$
  with c as (select now() - make_interval(days => p_days) as before)
  select ((select count(*) from public.general_draft_files, c where trashed_at < c.before)
        + (select count(*) from public.general_task_files, c where trashed_at < c.before)
        + (select count(*) from public.teaching_resources, c where trashed_at < c.before)
        + (select count(*) from public.general_discussions, c where trashed_at < c.before)
        + (select count(*) from public.project_tasks, c where trashed_at < c.before)
        + (select count(*) from public.general_tasks, c where trashed_at < c.before)
        + (select count(*) from public.groups, c where trashed_at < c.before)
        + (select count(*) from public.projects, c where trashed_at < c.before)
        + (select count(*) from public.general_space_teams, c where trashed_at < c.before)
        + (select count(*) from public.general_projects, c where trashed_at < c.before)
        + (select count(*) from public.classes, c where trashed_at < c.before)
        + (select count(*) from public.general_spaces g, c
            where g.kind = 'work' and g.trashed_at < c.before))::int;
$$;

do $$
declare
  v_a    uuid := gen_random_uuid();  -- active admin
  v_a2   uuid := gen_random_uuid();  -- a second active admin
  v_pa   uuid := gen_random_uuid();  -- admin still pending
  v_m    uuid := gen_random_uuid();  -- active member, owns the trashed spaces
  v_gone uuid := gen_random_uuid();  -- rejected member, whose trash purge cannot delete
  v_admins uuid[];
  s      public.organization_settings;
  b7 int; b30 int; b60 int; b365 int;
  p7 int; p30 int; p60 int; p365 int;
  purged int;
  s_del uuid; s_recent uuid; s_gone uuid; s_null uuid;
  r_old uuid; r_new uuid; r_ancient uuid;
  setter text := 'select public.set_organization_settings(%s, %s, %s, %s)';
begin
  v_admins := array[v_a, v_a2, v_pa, v_m];

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_a,    'zz-os-a@example.test'),
      (v_a2,   'zz-os-a2@example.test'),
      (v_pa,   'zz-os-pa@example.test'),
      (v_m,    'zz-os-m@example.test'),
      (v_gone, 'zz-os-gone@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_a,    'zz-os-a@example.test',    'Zz', 'Osa',    'admin',  'active',   false, false),
    (v_a2,   'zz-os-a2@example.test',   'Zz', 'Osa2',   'admin',  'active',   false, false),
    (v_pa,   'zz-os-pa@example.test',   'Zz', 'Ospa',   'admin',  'pending',  false, false),
    (v_m,    'zz-os-m@example.test',    'Zz', 'Osm',    'member', 'active',   false, true),
    (v_gone, 'zz-os-gone@example.test', 'Zz', 'Osgone', 'member', 'rejected', false, true)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects, can_teach = excluded.can_teach;

  -- The suite starts from the defaults whatever the live row holds. It rolls back.
  update public.organization_settings
     set quiet_days = 14, trash_retention_days = 30, new_project_visibility = 'private',
         school_email_domain = 'dyci.edu.ph'
   where id;

  -- ------------------------------------------------------------ shape and defaults

  perform pg_temp.must_be('organization_settings holds exactly one row',
    (select count(*) from public.organization_settings) = 1);
  perform pg_temp.must_refuse_exact('a second row is refused',
    'insert into public.organization_settings (id) values (false)', 'organization_settings_one_row');
  perform pg_temp.must_refuse_exact('a second true row is refused',
    'insert into public.organization_settings (id) values (true)', 'duplicate key');
  perform pg_temp.must_be('the column defaults equal the values fixed in code today',
    (select array_agg(pg_get_expr(d.adbin, d.adrelid) order by a.attnum)
       from pg_attribute a
       join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.organization_settings'::regclass
        and a.attname in ('quiet_days', 'trash_retention_days', 'new_project_visibility',
                          'school_email_domain'))
      = array['14', '30', '''private''::text', '''dyci.edu.ph''::text']);

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_be('a signed-in member reads the row',
    (select count(*) from public.organization_settings) = 1);
  perform pg_temp.must_be('the four helpers answer the defaults to anyone signed in',
    public.org_quiet_days() = 14
    and public.org_trash_retention_days() = 30
    and public.org_new_project_visibility() = 'private'
    and public.org_school_email_domain() = 'dyci.edu.ph');

  -- ------------------------------------------------------------ nobody writes directly

  perform pg_temp.must_refuse_exact('a member cannot update the row directly',
    'update public.organization_settings set quiet_days = 3 where id', 'permission denied');
  perform pg_temp.must_refuse_exact('a member cannot delete the row directly',
    'delete from public.organization_settings', 'permission denied');
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse_exact('an admin cannot update the row directly either',
    'update public.organization_settings set quiet_days = 3 where id', 'permission denied');
  perform pg_temp.must_refuse_exact('an admin cannot insert a row directly',
    'insert into public.organization_settings (id) values (true)', 'permission denied');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('signed-out visitors cannot read the table or call the helpers',
    not has_table_privilege('anon', 'public.organization_settings', 'select')
    and not has_function_privilege('anon', 'public.org_quiet_days()', 'execute')
    and not has_function_privilege('anon', 'public.org_trash_retention_days()', 'execute')
    and not has_function_privilege('anon', 'public.org_new_project_visibility()', 'execute')
    and not has_function_privilege('anon', 'public.org_school_email_domain()', 'execute')
    and not has_function_privilege('anon',
      'public.set_organization_settings(integer, integer, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.admin_trash_purge_preview(integer)', 'execute'));
  perform pg_temp.must_be('signed-in callers run the helpers, the setter and the preview',
    has_function_privilege('authenticated', 'public.org_quiet_days()', 'execute')
    and has_function_privilege('authenticated', 'public.org_school_email_domain()', 'execute')
    and has_function_privilege('authenticated',
      'public.set_organization_settings(integer, integer, text, text)', 'execute')
    and has_function_privilege('authenticated', 'public.admin_trash_purge_preview(integer)', 'execute'));
  perform pg_temp.must_be('nobody signed in calls the domain check directly',
    not has_function_privilege('authenticated', 'public.org_domain_valid(text)', 'execute'));

  -- ------------------------------------------------------------ setter refusals

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_refuse_exact('a member cannot change organization settings',
    format(setter, 7, 30, '''private''', '''dyci.edu.ph'''), 'Only an admin');
  perform pg_temp.act_as(v_pa);
  perform pg_temp.must_refuse_exact('a pending admin cannot change organization settings',
    format(setter, 7, 30, '''private''', '''dyci.edu.ph'''), 'Only an admin');

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse_exact('quiet below 3 days is refused',
    format(setter, 2, 30, '''private''', '''dyci.edu.ph'''), 'Quiet after takes 3 to 90 days');
  perform pg_temp.must_refuse_exact('quiet above 90 days is refused',
    format(setter, 91, 30, '''private''', '''dyci.edu.ph'''), 'Quiet after takes 3 to 90 days');
  perform pg_temp.must_refuse_exact('trash below 7 days is refused',
    format(setter, 14, 6, '''private''', '''dyci.edu.ph'''), 'Trash keeps items for 7 to 365 days');
  perform pg_temp.must_refuse_exact('trash above 365 days is refused',
    format(setter, 14, 366, '''private''', '''dyci.edu.ph'''), 'Trash keeps items for 7 to 365 days');
  perform pg_temp.must_refuse_exact('a visibility other than private or workspace is refused',
    format(setter, 14, 30, '''public''', '''dyci.edu.ph'''), 'New projects start Private or Workspace');
  perform pg_temp.must_refuse_exact('a domain with no dot is refused',
    format(setter, 14, 30, '''private''', '''dyci'''), 'Enter a domain like dyci.edu.ph');
  perform pg_temp.must_refuse_exact('a label starting with a hyphen is refused',
    format(setter, 14, 30, '''private''', '''-x.ph'''), 'Enter a domain like dyci.edu.ph');
  perform pg_temp.must_refuse_exact('a label ending with a hyphen is refused',
    format(setter, 14, 30, '''private''', '''x-.ph'''), 'Enter a domain like dyci.edu.ph');
  perform pg_temp.must_refuse_exact('a leading @ is refused',
    format(setter, 14, 30, '''private''', '''@dyci.edu.ph'''), 'Enter a domain like dyci.edu.ph');
  perform pg_temp.must_refuse_exact('a space inside the domain is refused',
    format(setter, 14, 30, '''private''', '''dyci .edu.ph'''), 'Enter a domain like dyci.edu.ph');
  perform pg_temp.must_refuse_exact('an empty dot label is refused',
    format(setter, 14, 30, '''private''', '''dyci..ph'''), 'Enter a domain like dyci.edu.ph');
  perform pg_temp.must_refuse_exact('a domain under 4 characters is refused',
    format(setter, 14, 30, '''private''', '''a.b'''), 'Enter a domain like dyci.edu.ph');
  perform pg_temp.must_refuse_exact('a domain over 253 characters is refused',
    format(setter, 14, 30, '''private''',
           quote_literal(repeat('a.', 126) || 'ph')), 'Enter a domain like dyci.edu.ph');
  perform pg_temp.must_refuse_exact('an empty domain is refused',
    format(setter, 14, 30, '''private''', ''' '''), 'Enter a domain like dyci.edu.ph');
  perform pg_temp.must_be('the refusals changed nothing and wrote no audit row',
    (select quiet_days = 14 and trash_retention_days = 30
            and new_project_visibility = 'private' and school_email_domain = 'dyci.edu.ph'
       from public.organization_settings)
    and pg_temp.audits(v_admins) = '{}');

  -- ------------------------------------------------------------ changes and their audit

  s := public.set_organization_settings(7, 30, 'private', 'dyci.edu.ph');
  perform pg_temp.must_be('changing one value saves it and returns the row',
    s.quiet_days = 7 and s.trash_retention_days = 30 and s.updated_by = v_a);
  perform pg_temp.must_be('one changed value writes one audit row with old and new',
    pg_temp.audits(v_admins) = array['Quiet after:14 days>7 days']);
  perform pg_temp.must_be('the audit row names the admin and no subject id',
    (select bool_and(actor_id = v_a and subject_id is null)
       from public.audit_events
      where action::text = 'org_setting_changed' and actor_id = any (v_admins)));

  perform public.set_organization_settings(7, 30, 'private', 'dyci.edu.ph');
  perform public.set_organization_settings(null, null, null, null);
  perform pg_temp.must_be('a call that changes nothing writes no audit row',
    cardinality(pg_temp.audits(v_admins)) = 1);

  s := public.set_organization_settings(3, 7, 'workspace', '  UPPER.PH ');
  perform pg_temp.must_be('the bounds 3 and 7 are accepted, the domain is trimmed and lower-cased',
    s.quiet_days = 3 and s.trash_retention_days = 7 and s.new_project_visibility = 'workspace'
    and s.school_email_domain = 'upper.ph');
  perform pg_temp.must_be('each of three changed values writes its own audit row',
    pg_temp.audits(v_admins) = array['New projects start:Private>Workspace',
      'Quiet after:14 days>7 days', 'Quiet after:7 days>3 days',
      'School email domain:dyci.edu.ph>upper.ph', 'Trash keeps items:30 days>7 days']);
  perform pg_temp.must_be('the helpers follow the saved values',
    public.org_quiet_days() = 3 and public.org_trash_retention_days() = 7
    and public.org_new_project_visibility() = 'workspace'
    and public.org_school_email_domain() = 'upper.ph');

  s := public.set_organization_settings(90, 365, 'private', 'mail.dyci-2.edu.ph');
  perform pg_temp.must_be('the bounds 90 and 365, and a hyphen and digits inside a label, are accepted',
    s.quiet_days = 90 and s.trash_retention_days = 365
    and s.school_email_domain = 'mail.dyci-2.edu.ph');

  -- ------------------------------------------------------------ two admins, one after the other

  -- Review Focus 4. The setter takes the row lock before it reads, so a second save that
  -- waited on the first compares against the first's values. Sequential here, under the
  -- same lock: only what the second admin actually changed is audited, from the first's values.
  s := public.set_organization_settings(20, 60, null, null);
  perform pg_temp.act_as(v_a2);
  s := public.set_organization_settings(20, 90, 'workspace', null);
  perform pg_temp.must_be('the second save keeps the first admin''s quiet value and domain',
    s.quiet_days = 20 and s.trash_retention_days = 90 and s.new_project_visibility = 'workspace'
    and s.school_email_domain = 'mail.dyci-2.edu.ph' and s.updated_by = v_a2);
  perform pg_temp.must_be('the second admin''s audit rows name only their changes, from the first''s values',
    (select coalesce(array_agg(subject_label || ':' || before_value || '>' || after_value
                               order by subject_label), '{}')
       from public.audit_events
      where action::text = 'org_setting_changed' and actor_id = v_a2)
      = array['New projects start:Private>Workspace', 'Trash keeps items:60 days>90 days']);
  perform pg_temp.must_be('the setter locks the row before it compares',
    (select prosrc ilike '%for update%' from pg_proc
      where oid = 'public.set_organization_settings(integer, integer, text, text)'::regprocedure));

  -- ------------------------------------------------------------ the purge preview

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_refuse_exact('a member cannot preview the trash clean-up',
    'select public.admin_trash_purge_preview(30)', 'Only an admin');
  perform pg_temp.act_as(v_pa);
  perform pg_temp.must_refuse_exact('a pending admin cannot preview the trash clean-up',
    'select public.admin_trash_purge_preview(30)', 'Only an admin');
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse_exact('a preview below 7 days is refused',
    'select public.admin_trash_purge_preview(6)', 'Trash keeps items for 7 to 365 days');
  perform pg_temp.must_refuse_exact('a preview above 365 days is refused',
    'select public.admin_trash_purge_preview(366)', 'Trash keeps items for 7 to 365 days');
  perform pg_temp.must_refuse_exact('a preview with no number is refused',
    'select public.admin_trash_purge_preview(null)', 'Trash keeps items for 7 to 365 days');

  b7   := public.admin_trash_purge_preview(7);
  b30  := public.admin_trash_purge_preview(30);
  b60  := public.admin_trash_purge_preview(60);
  b365 := public.admin_trash_purge_preview(365);
  perform pg_temp.must_be('the preview leaves the admin signed in as themselves',
    auth.uid() = v_a);
  perform pg_temp.must_be('the preview never acts as anyone else',
    (select prosrc not ilike '%request.jwt%' and prosrc not ilike '%set_config%'
            and prosrc not ilike '%archive_trash_block%'
       from pg_proc where oid = 'public.admin_trash_purge_preview(integer)'::regprocedure));

  -- Fixtures, written as the database: three trashed resources (10, 40 and 100 days ago),
  -- and four trashed work spaces. The preview counts all of them by date. The purge deletes a
  -- space only as whoever trashed it, and only when they could delete it by hand: v_m owns
  -- s_del and s_recent, so those go; v_gone is rejected, so s_gone comes back instead; s_null
  -- has nobody, so it comes back too. So the preview is an upper bound.
  perform pg_temp.act_as_service();
  r_new := gen_random_uuid(); r_old := gen_random_uuid(); r_ancient := gen_random_uuid();
  insert into public.teaching_resources
    (id, professor_id, kind, title, file_path, file_name, archived_at, trashed_at, trashed_by)
  values
    (r_new,     v_m, 'syllabus', 'Zz os new',     'zz/os/new.pdf',     'new.pdf',
     now() - interval '11 days',  now() - interval '10 days',  v_m),
    (r_old,     v_m, 'syllabus', 'Zz os old',     'zz/os/old.pdf',     'old.pdf',
     now() - interval '41 days',  now() - interval '40 days',  v_m),
    (r_ancient, v_m, 'syllabus', 'Zz os ancient', 'zz/os/ancient.pdf', 'ancient.pdf',
     now() - interval '101 days', now() - interval '100 days', v_m);

  s_del := gen_random_uuid(); s_recent := gen_random_uuid();
  s_gone := gen_random_uuid(); s_null := gen_random_uuid();
  insert into public.general_spaces (id, name, kind, archived_at, trashed_at, trashed_by)
  values
    (s_del,    'Zz os deleted', 'work', now() - interval '41 days', now() - interval '40 days', v_m),
    (s_recent, 'Zz os recent',  'work', now() - interval '11 days', now() - interval '10 days', v_m),
    (s_gone,   'Zz os gone',    'work', now() - interval '41 days', now() - interval '40 days', v_gone),
    (s_null,   'Zz os nobody',  'work', now() - interval '41 days', now() - interval '40 days', null);
  insert into public.general_space_members (space_id, user_id, role)
  values (s_del, v_m, 'pm'), (s_recent, v_m, 'pm'), (s_gone, v_gone, 'pm'), (s_null, v_m, 'pm');

  perform pg_temp.act_as(v_a);
  p7   := public.admin_trash_purge_preview(7);
  p30  := public.admin_trash_purge_preview(30);
  p60  := public.admin_trash_purge_preview(60);
  p365 := public.admin_trash_purge_preview(365);
  perform pg_temp.must_be('7 days counts the three resources and all four spaces',
    p7 = b7 + 7);
  perform pg_temp.must_be('30 days counts the 40 and 100 day resources and the three 40 day spaces',
    p30 = b30 + 5);
  perform pg_temp.must_be('60 days counts only the 100 day resource',
    p60 = b60 + 1);
  perform pg_temp.must_be('365 days counts none of them',
    p365 = b365);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the preview equals the date-eligible count at 7, 30, 60 and 365 days',
    p7 = pg_temp.eligible(7) and p30 = pg_temp.eligible(30)
    and p60 = pg_temp.eligible(60) and p365 = pg_temp.eligible(365));
  perform pg_temp.must_be('the preview changed nothing',
    (select count(*) from public.general_spaces
      where id in (s_del, s_recent, s_gone, s_null) and trashed_at is not null) = 4
    and (select count(*) from public.teaching_resources
          where id in (r_new, r_old, r_ancient)) = 3);

  -- Review Focus 2: at 30 days, the setting purge_trash reads today, the preview is never
  -- below what the nightly clean-up deletes. Here it is 2 above: s_gone and s_null come back.
  perform pg_temp.act_as_service();
  purged := public.purge_trash();
  perform pg_temp.must_be('the 30 day preview is at least what purge_trash deletes',
    p30 >= purged);
  perform pg_temp.must_be('...and the gap is the two spaces the purge put back',
    p30 - purged = 2);
  perform pg_temp.must_be('...and the purge treated each fixture as expected',
    not exists (select 1 from public.general_spaces where id = s_del)
    and exists (select 1 from public.general_spaces where id = s_recent and trashed_at is not null)
    and exists (select 1 from public.general_spaces where id in (s_gone) and trashed_at is null)
    and exists (select 1 from public.general_spaces where id in (s_null) and trashed_at is null)
    and not exists (select 1 from public.teaching_resources where id in (r_old, r_ancient))
    and exists (select 1 from public.teaching_resources where id = r_new));

  perform pg_temp.act_as_service();
  raise notice 'organization settings suite: all passed';
end $$;

rollback;
