-- supabase/tests/office-heads.test.sql
-- Office heads: the shared attention helper, the admin's setter, the seat that clears itself
-- and who reads a seat. Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/offices.sql supabase/offboarding.sql supabase/office-heads.sql supabase/anon-lockdown.sql supabase/tests/office-heads.test.sql
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

/** Runs a statement and asserts it is refused with exactly this message. */
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

/** office_head_changed rows about one office, read as the database. */
create or replace function pg_temp.head_audits(p_office uuid) returns int
language sql as $$
  select count(*)::int from public.audit_events
   where action::text = 'office_head_changed' and subject_id = p_office;
$$;

/** How many rows the five head reads return to the caller, all together. */
create or replace function pg_temp.head_rows() returns int
language sql as $$
  select (select count(*) from public.my_headed_office())::int
       + (select count(*) from public.my_office_overview())::int
       + (select count(*) from public.my_office_attention())::int
       + (select count(*) from public.my_office_spaces())::int
       + (select count(*) from public.my_office_people())::int;
$$;

/** The clears among them: this head out, nobody in, by this actor. */
create or replace function pg_temp.head_clears(p_office uuid, p_label text, p_actor uuid) returns int
language sql as $$
  select count(*)::int from public.audit_events
   where action::text = 'office_head_changed' and subject_id = p_office
     and actor_id is not distinct from p_actor
     and before_value = p_label and after_value = '';
$$;

do $$
declare
  v_a    uuid := gen_random_uuid();  -- the active admin
  v_pa   uuid := gen_random_uuid();  -- an admin still pending
  v_x    uuid := gen_random_uuid();  -- another active admin, a head candidate
  v_h1   uuid := gen_random_uuid();  -- member in office one, its head
  v_h2   uuid := gen_random_uuid();  -- member in office two, its head
  v_m    uuid := gen_random_uuid();  -- member in office one, not a head
  v_rej  uuid := gen_random_uuid();  -- deactivated member in office one
  v_stu  uuid := gen_random_uuid();  -- student
  v_p1   uuid := gen_random_uuid();  -- PM, working
  v_p2   uuid := gen_random_uuid();  -- PM, switch later off
  v_p3   uuid := gen_random_uuid();  -- PM, later deactivated
  pa     uuid;  -- v_p1's project: has a working PM
  pb     uuid;  -- v_p2's project: its PM loses the switch
  pc     uuid;  -- v_p3's project: its PM is deactivated
  o1     uuid;
  o2     uuid;
  o3     uuid;  -- archived
  pq     uuid;  -- v_p1's quiet project, in office one
  px     uuid;  -- v_p1's project in an archived space, in office one
  s1     uuid;  -- pa's and pq's space, office one
  s2     uuid;  -- pb's space, office one
  s3     uuid;  -- pc's space, office two
  sx     uuid;  -- an archived space, office one
  n      int;
  c      int;
  v_nopm uuid[];
  v_run  uuid[];
  v_help uuid[];
  j_adm  jsonb;
  j_help jsonb;
  j_me   jsonb;
  j_org  jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_a,   'zz-oh-a@example.test'),
      (v_pa,  'zz-oh-pa@example.test'),
      (v_x,   'zz-oh-x@example.test'),
      (v_h1,  'zz-oh-h1@example.test'),
      (v_h2,  'zz-oh-h2@example.test'),
      (v_m,   'zz-oh-m@example.test'),
      (v_rej, 'zz-oh-rej@example.test'),
      (v_stu, 'zz-oh-stu@example.test'),
      (v_p1,  'zz-oh-p1@example.test'),
      (v_p2,  'zz-oh-p2@example.test'),
      (v_p3,  'zz-oh-p3@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_a,   'zz-oh-a@example.test',   'Zz', 'Oha',   'admin',   'active',   false, false),
    (v_pa,  'zz-oh-pa@example.test',  'Zz', 'Ohpa',  'admin',   'pending',  false, false),
    (v_x,   'zz-oh-x@example.test',   'Zz', 'Ohx',   'admin',   'active',   false, false),
    (v_h1,  'zz-oh-h1@example.test',  'Zz', 'Ohh1',  'member',  'active',   false, false),
    (v_h2,  'zz-oh-h2@example.test',  'Zz', 'Ohh2',  'member',  'active',   false, false),
    (v_m,   'zz-oh-m@example.test',   'Zz', 'Ohm',   'member',  'active',   false, false),
    (v_rej, 'zz-oh-rej@example.test', 'Zz', 'Ohrej', 'member',  'rejected', false, false),
    (v_stu, 'zz-oh-stu@example.test', 'Zz', 'Ohstu', 'student', 'active',   false, false),
    (v_p1,  'zz-oh-p1@example.test',  'Zz', 'Ohp1',  'member',  'active',   false, true),
    (v_p2,  'zz-oh-p2@example.test',  'Zz', 'Ohp2',  'member',  'active',   false, true),
    (v_p3,  'zz-oh-p3@example.test',  'Zz', 'Ohp3',  'member',  'active',   false, true)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects, can_teach = excluded.can_teach;

  -- ------------------------------------------------------------ the attention helper

  perform pg_temp.act_as(v_p1);
  pa := (public.create_general_project('Zz Oh healthy', '', null, null, null, null,
          (public.create_general_space('Zz Oh space p1', '')).id)).id;
  perform pg_temp.act_as(v_p2);
  pb := (public.create_general_project('Zz Oh switched off', '', null, null, null, null,
          (public.create_general_space('Zz Oh space p2', '')).id)).id;
  perform pg_temp.act_as(v_p3);
  pc := (public.create_general_project('Zz Oh deactivated', '', null, null, null, null,
          (public.create_general_space('Zz Oh space p3', '')).id)).id;
  perform pg_temp.act_as_service();
  update public.profiles set can_manage_projects = false where id = v_p2;
  update public.profiles set status = 'rejected' where id = v_p3;

  -- What the Work projects page calls "no PM", read as the admin.
  perform pg_temp.act_as(v_a);
  select coalesce(array_agg(w.id), '{}') into v_nopm
    from (select x.id from public.admin_work_project_rows() x
           group by x.id having not bool_or(x.has_pm)) w;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.project_id), '[]') into j_adm
    from public.admin_attention_projects() a;

  perform pg_temp.act_as_service();
  select coalesce(array_agg(r.id order by r.id), '{}') into v_run
    from public.office_running_projects() r where r.id = any (v_nopm);
  select coalesce(array_agg(h.project_id order by h.project_id), '{}') into v_help
    from public.office_attention_rows() h where h.no_pm;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.project_id), '[]') into j_help
    from public.office_attention_rows() h;

  perform pg_temp.must_be('fixtures: switched-off and deactivated PMs, one working PM',
    pb = any (v_nopm) and pc = any (v_nopm) and not pa = any (v_nopm));
  perform pg_temp.must_be('the helper''s no_pm agrees with admin_work_project_rows for every running project',
    v_help = v_run and pb = any (v_help) and pc = any (v_help) and not pa = any (v_help));
  perform pg_temp.must_be('admin_attention_projects returns exactly the helper''s rows to the admin',
    j_adm = j_help and jsonb_array_length(j_adm) > 0);
  perform pg_temp.must_be('the helper returns exactly its columns',
    pg_get_function_result('public.office_attention_rows()'::regprocedure)
      = 'TABLE(project_id uuid, project_name text, space_name text, office_id uuid, office_name text, no_pm boolean, quiet_since timestamp with time zone)');

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_refuse_exact('a member cannot call the helper',
    'select * from public.office_attention_rows()', 'permission denied');

  -- ------------------------------------------------------------ offices

  perform pg_temp.act_as(v_a);
  o1 := (public.create_office('Zz Oh office one', '')).id;
  o2 := (public.create_office('Zz Oh office two', '')).id;
  o3 := (public.create_office('Zz Oh office three', '')).id;
  perform public.archive_office(o3);
  perform public.set_member_office(v_h1, o1);
  perform public.set_member_office(v_m, o1);
  perform public.set_member_office(v_rej, o1);
  perform public.set_member_office(v_h2, o2);

  -- ------------------------------------------------------------ refusals

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_refuse_exact('set_office_head refuses a non-admin',
    format('select public.set_office_head(%L, %L)', o1, v_h1),
    'Only an admin can change offices.');
  perform pg_temp.act_as(v_pa);
  perform pg_temp.must_refuse_exact('set_office_head refuses an inactive admin',
    format('select public.set_office_head(%L, %L)', o1, v_h1),
    'Only an admin can change offices.');

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse_exact('set_office_head refuses a student',
    format('select public.set_office_head(%L, %L)', o1, v_stu),
    'Only an active member of this office can head it. Choose someone else.');
  perform pg_temp.must_refuse_exact('set_office_head refuses an admin',
    format('select public.set_office_head(%L, %L)', o1, v_x),
    'Only an active member of this office can head it. Choose someone else.');
  perform pg_temp.must_refuse_exact('set_office_head refuses a member of another office',
    format('select public.set_office_head(%L, %L)', o1, v_h2),
    'Only an active member of this office can head it. Choose someone else.');
  perform pg_temp.must_refuse_exact('set_office_head refuses an inactive member',
    format('select public.set_office_head(%L, %L)', o1, v_rej),
    'Only an active member of this office can head it. Choose someone else.');
  perform pg_temp.must_refuse_exact('set_office_head refuses an archived office',
    format('select public.set_office_head(%L, %L)', o3, v_h1),
    'This office is archived. Restore it first.');
  perform pg_temp.must_refuse_exact('set_office_head refuses an office that is not there',
    format('select public.set_office_head(%L, %L)', gen_random_uuid(), v_h1),
    'That office no longer exists. Refresh the page.');
  perform pg_temp.must_refuse_exact('the admin cannot write office_heads directly',
    format('insert into public.office_heads (office_id, user_id) values (%L, %L)', o1, v_h1),
    'permission denied');

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and a refusal writes nothing',
    not exists (select 1 from public.office_heads where office_id in (o1, o3))
    and pg_temp.head_audits(o1) = 0 and pg_temp.head_audits(o3) = 0);

  -- ------------------------------------------------------------ set and clear

  perform pg_temp.act_as(v_a);
  perform public.set_office_head(o1, v_h1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('set_office_head sets and clears, one audit row each: set',
    exists (select 1 from public.office_heads
             where office_id = o1 and user_id = v_h1 and assigned_by = v_a)
    and pg_temp.head_audits(o1) = 1
    and exists (select 1 from public.audit_events
                 where action::text = 'office_head_changed' and subject_id = o1
                   and actor_id = v_a and subject_label = 'Zz Oh office one'
                   and before_value = '' and after_value = 'Zz Ohh1'));

  perform pg_temp.act_as(v_a);
  perform public.set_office_head(o1, v_h1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('setting the same head again writes nothing',
    pg_temp.head_audits(o1) = 1);

  perform pg_temp.act_as(v_a);
  perform public.set_office_head(o1, v_m);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a new head replaces the old with one audit row naming both',
    exists (select 1 from public.office_heads where office_id = o1 and user_id = v_m)
    and (select count(*) from public.office_heads where office_id = o1) = 1
    and pg_temp.head_audits(o1) = 2
    and exists (select 1 from public.audit_events
                 where action::text = 'office_head_changed' and subject_id = o1
                   and before_value = 'Zz Ohh1' and after_value = 'Zz Ohm'));

  perform pg_temp.act_as(v_a);
  perform public.set_office_head(o1, null);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('set_office_head sets and clears, one audit row each: clear',
    not exists (select 1 from public.office_heads where office_id = o1)
    and pg_temp.head_audits(o1) = 3
    and pg_temp.head_clears(o1, 'Zz Ohm', v_a) = 1);

  perform pg_temp.act_as(v_a);
  perform public.set_office_head(o1, null);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('clearing an empty seat writes nothing',
    pg_temp.head_audits(o1) = 3);

  perform pg_temp.act_as(v_a);
  perform public.set_office_head(o1, v_h1);
  perform public.set_office_head(o2, v_h2);

  -- ------------------------------------------------------------ who reads a seat

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_be('a member reads no office_heads row',
    (select count(*) from public.office_heads) = 0);
  perform pg_temp.act_as(v_h2);
  perform pg_temp.must_be('another head reads only their own row',
    (select count(*) from public.office_heads) = 1
    and exists (select 1 from public.office_heads where office_id = o2 and user_id = v_h2));
  perform pg_temp.act_as(v_h1);
  perform pg_temp.must_be('the head reads their own row',
    (select count(*) from public.office_heads) = 1
    and exists (select 1 from public.office_heads where office_id = o1 and user_id = v_h1));
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('the admin reads every row',
    (select count(*) from public.office_heads where office_id in (o1, o2)) = 2);

  perform pg_temp.must_be('admin_office_heads lists heads for the admin',
    exists (select 1 from public.admin_office_heads() x
             where x.office_id = o1 and x.head_id = v_h1 and x.head_name = 'Zz Ohh1')
    and exists (select 1 from public.admin_office_heads() x
                 where x.office_id = o2 and x.head_id = v_h2 and x.head_name = 'Zz Ohh2')
    and (select count(*) from public.admin_office_heads() x where x.office_id = o1) = 1);
  perform pg_temp.must_be('admin_office_heads returns exactly its columns',
    pg_get_function_result('public.admin_office_heads()'::regprocedure)
      = 'TABLE(office_id uuid, head_id uuid, head_name text)');
  perform pg_temp.act_as(v_m);
  perform pg_temp.must_be('admin_office_heads is nothing for a member',
    (select count(*) from public.admin_office_heads()) = 0);
  perform pg_temp.act_as(v_h1);
  perform pg_temp.must_be('admin_office_heads is nothing for a head',
    (select count(*) from public.admin_office_heads()) = 0);
  perform pg_temp.act_as(v_pa);
  perform pg_temp.must_be('admin_office_heads is nothing for an inactive admin',
    (select count(*) from public.admin_office_heads()) = 0);

  -- ------------------------------------------------------------ the seat clears itself
  --
  -- Each case runs as the admin and is undone afterwards by a savepoint. Office two's seat
  -- stays as it is throughout.

  perform pg_temp.act_as_service();
  n := pg_temp.head_audits(o1);
  c := pg_temp.head_clears(o1, 'Zz Ohh1', v_a);

  begin
    perform pg_temp.act_as(v_a);
    perform public.set_member_office(v_h1, o2);
    perform pg_temp.act_as_service();
    perform pg_temp.must_be('moving the head to another office clears the seat, actor = the admin',
      not exists (select 1 from public.office_heads where office_id = o1)
      and not exists (select 1 from public.office_heads where user_id = v_h1)
      and pg_temp.head_audits(o1) = n + 1
      and pg_temp.head_clears(o1, 'Zz Ohh1', v_a) = c + 1
      and exists (select 1 from public.office_heads where office_id = o2 and user_id = v_h2)
      and pg_temp.head_audits(o2) = 1);
    raise exception 'zz undo';
  exception when others then
    if sqlerrm <> 'zz undo' then raise; end if;
  end;

  begin
    perform pg_temp.act_as(v_a);
    perform public.set_member_office(v_h1, null);
    perform pg_temp.act_as_service();
    perform pg_temp.must_be('removing their office clears it',
      not exists (select 1 from public.office_heads where office_id = o1)
      and pg_temp.head_audits(o1) = n + 1
      and pg_temp.head_clears(o1, 'Zz Ohh1', v_a) = c + 1);
    raise exception 'zz undo';
  exception when others then
    if sqlerrm <> 'zz undo' then raise; end if;
  end;

  begin
    perform pg_temp.act_as(v_a);
    perform public.set_account_role(v_h1, 'student');
    perform pg_temp.act_as_service();
    perform pg_temp.must_be('making the head a student clears it',
      not exists (select 1 from public.office_heads where office_id = o1)
      and not exists (select 1 from public.office_members where user_id = v_h1)
      and pg_temp.head_audits(o1) = n + 1
      and pg_temp.head_clears(o1, 'Zz Ohh1', v_a) = c + 1);
    raise exception 'zz undo';
  exception when others then
    if sqlerrm <> 'zz undo' then raise; end if;
  end;

  -- An admin is made from the command line (scripts/set-role.mjs), so there is no actor.
  begin
    perform pg_temp.act_as_service();
    update public.profiles set role = 'admin' where id = v_h1;
    perform pg_temp.must_be('making the head an admin clears it, one audit row',
      not exists (select 1 from public.office_heads where office_id = o1)
      and not exists (select 1 from public.office_members where user_id = v_h1)
      and pg_temp.head_audits(o1) = n + 1
      and pg_temp.head_clears(o1, 'Zz Ohh1', null) = 1);
    raise exception 'zz undo';
  exception when others then
    if sqlerrm <> 'zz undo' then raise; end if;
  end;

  begin
    perform pg_temp.act_as(v_a);
    perform public.set_account_active(v_m, false);
    perform pg_temp.act_as_service();
    perform pg_temp.must_be('deactivating someone who is not a head leaves the seat',
      exists (select 1 from public.office_heads where office_id = o1 and user_id = v_h1)
      and pg_temp.head_audits(o1) = n);

    perform pg_temp.act_as(v_a);
    perform public.set_account_active(v_h1, false);
    perform pg_temp.act_as_service();
    perform pg_temp.must_be('deactivating the head clears it',
      not exists (select 1 from public.office_heads where office_id = o1)
      and exists (select 1 from public.office_members where user_id = v_h1 and office_id = o1)
      and pg_temp.head_audits(o1) = n + 1
      and pg_temp.head_clears(o1, 'Zz Ohh1', v_a) = c + 1);

    perform pg_temp.act_as(v_a);
    perform public.set_account_active(v_h1, true);
    perform pg_temp.act_as_service();
    perform pg_temp.must_be('reactivating does not restore it',
      (select status = 'active' from public.profiles where id = v_h1)
      and not exists (select 1 from public.office_heads where office_id = o1)
      and exists (select 1 from public.office_members where user_id = v_h1 and office_id = o1)
      and pg_temp.head_audits(o1) = n + 1);
    raise exception 'zz undo';
  exception when others then
    if sqlerrm <> 'zz undo' then raise; end if;
  end;

  begin
    perform pg_temp.act_as(v_a);
    perform public.admin_offboard_member(v_h1, null);
    perform pg_temp.act_as_service();
    perform pg_temp.must_be('admin_offboard_member on the head clears it',
      (select status = 'rejected' from public.profiles where id = v_h1)
      and not exists (select 1 from public.office_heads where office_id = o1)
      and pg_temp.head_audits(o1) = n + 1
      and pg_temp.head_clears(o1, 'Zz Ohh1', v_a) = c + 1);
    raise exception 'zz undo';
  exception when others then
    if sqlerrm <> 'zz undo' then raise; end if;
  end;

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...and the savepoints put the seats back',
    exists (select 1 from public.office_heads where office_id = o1 and user_id = v_h1)
    and exists (select 1 from public.office_heads where office_id = o2 and user_id = v_h2)
    and pg_temp.head_audits(o1) = n);

  -- ------------------------------------------------------------ head reads
  --
  -- Office one: space p1 (pa, working PM; pq, quiet), space p2 (pb, no PM) and an archived
  -- space (px). Office two: space p3 (pc, no PM). v_h1 is a stakeholder on pb and nothing else.

  perform pg_temp.act_as_service();
  select space_id into s1 from public.general_projects where id = pa;
  select space_id into s2 from public.general_projects where id = pb;
  select space_id into s3 from public.general_projects where id = pc;

  perform pg_temp.act_as(v_p1);
  pq := (public.create_general_project('Zz Oh quiet', '', null, null, null, null, s1)).id;
  sx := (public.create_general_space('Zz Oh space archived', '')).id;
  px := (public.create_general_project('Zz Oh in an archived space', '', null, null, null, null, sx)).id;

  perform pg_temp.act_as(v_a);
  perform public.set_space_office(s1, o1);
  perform public.set_space_office(s2, o1);
  perform public.set_space_office(sx, o1);
  perform public.set_space_office(s3, o2);

  perform pg_temp.act_as_service();
  update public.general_projects set created_at = now() - interval '30 days' where id = pq;
  update public.general_spaces set archived_at = now() where id = sx;
  insert into public.general_members (project_id, user_id, role) values (pb, v_h1, 'stakeholder');

  perform pg_temp.must_be('the head reads columns are pinned',
    pg_get_function_result('public.my_headed_office()'::regprocedure)
      = 'TABLE(office_id uuid, office_name text)'
    and pg_get_function_result('public.my_office_overview()'::regprocedure)
      = 'TABLE(spaces integer, running_projects integer, people integer, needs_attention integer)'
    and pg_get_function_result('public.my_office_attention()'::regprocedure)
      = 'TABLE(project_id uuid, project_name text, space_name text, no_pm boolean, quiet_since timestamp with time zone, i_am_on boolean)'
    and pg_get_function_result('public.my_office_spaces()'::regprocedure)
      = 'TABLE(space_id uuid, space_name text, running_projects integer)'
    and pg_get_function_result('public.my_office_people()'::regprocedure)
      = 'TABLE(id uuid, name text)');

  -- Nobody but a head gets a row.
  perform pg_temp.act_as(v_m);
  perform pg_temp.must_be('the head reads refuse a member: zero rows', pg_temp.head_rows() = 0);
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('the head reads refuse the admin: zero rows', pg_temp.head_rows() = 0);
  perform pg_temp.act_as(v_stu);
  perform pg_temp.must_be('the head reads refuse a student: zero rows', pg_temp.head_rows() = 0);
  perform pg_temp.act_as(v_m);
  perform pg_temp.must_refuse_exact('a member cannot call the gate helper',
    'select public.office_head_of_caller()', 'permission denied');

  -- The admin's numbers for each office.
  perform pg_temp.act_as(v_a);
  select coalesce(jsonb_agg(jsonb_build_object('spaces', x.spaces,
           'running_projects', x.running_projects, 'people', x.people,
           'needs_attention', x.needs_attention)), '[]')
    into j_org from public.admin_org_overview() x where x.office_id = o1;

  perform pg_temp.act_as(v_h1);
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into j_me from public.my_office_overview() x;
  perform pg_temp.must_be('my_headed_office names the head''s office',
    (select count(*) from public.my_headed_office()) = 1
    and exists (select 1 from public.my_headed_office() x
                 where x.office_id = o1 and x.office_name = 'Zz Oh office one'));
  perform pg_temp.must_be('my_office_overview equals that office''s admin_org_overview row',
    j_me = j_org
    and j_me = '[{"spaces": 2, "running_projects": 3, "people": 2, "needs_attention": 2}]'::jsonb);
  perform pg_temp.must_be('my_office_attention lists the office''s quiet and no-PM projects only',
    (select array_agg(x.project_id) from public.my_office_attention() x) = array[pb, pq]
    and exists (select 1 from public.my_office_attention() x
                 where x.project_id = pb and x.no_pm and x.quiet_since is null
                   and x.project_name = 'Zz Oh switched off' and x.space_name = 'Zz Oh space p2')
    and exists (select 1 from public.my_office_attention() x
                 where x.project_id = pq and not x.no_pm and x.quiet_since is not null
                   and x.space_name = 'Zz Oh space p1'));
  perform pg_temp.must_be('i_am_on is true only where the head is a general_members row',
    (select bool_and(x.i_am_on = (x.project_id = pb)) from public.my_office_attention() x));
  perform pg_temp.must_be('spaces and people match the office: spaces',
    (select jsonb_agg(to_jsonb(x)) from public.my_office_spaces() x)
      = jsonb_build_array(
          jsonb_build_object('space_id', s1, 'space_name', 'Zz Oh space p1', 'running_projects', 2),
          jsonb_build_object('space_id', s2, 'space_name', 'Zz Oh space p2', 'running_projects', 1)));
  perform pg_temp.must_be('spaces and people match the office: people',
    (select jsonb_agg(to_jsonb(x)) from public.my_office_people() x)
      = jsonb_build_array(
          jsonb_build_object('id', v_h1, 'name', 'Zz Ohh1'),
          jsonb_build_object('id', v_m, 'name', 'Zz Ohm')));

  -- The head of another office reads only their own.
  perform pg_temp.act_as(v_a);
  select coalesce(jsonb_agg(jsonb_build_object('spaces', x.spaces,
           'running_projects', x.running_projects, 'people', x.people,
           'needs_attention', x.needs_attention)), '[]')
    into j_org from public.admin_org_overview() x where x.office_id = o2;

  perform pg_temp.act_as(v_h2);
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into j_me from public.my_office_overview() x;
  perform pg_temp.must_be('the head of another office reads only their own office',
    (select array_agg(x.office_id) from public.my_headed_office() x) = array[o2]
    and j_me = j_org
    and j_me = '[{"spaces": 1, "running_projects": 1, "people": 1, "needs_attention": 1}]'::jsonb
    and (select array_agg(x.project_id) from public.my_office_attention() x) = array[pc]
    and not (select bool_or(x.i_am_on) from public.my_office_attention() x)
    and (select array_agg(x.space_id) from public.my_office_spaces() x) = array[s3]
    and (select array_agg(x.id) from public.my_office_people() x) = array[v_h2]);

  -- A seat on an archived office reads nothing. archive_office refuses while the head is
  -- active, so the archive is forced here to reach the gate.
  begin
    perform pg_temp.act_as_service();
    update public.offices set archived_at = now() where id = o1;
    perform pg_temp.act_as(v_h1);
    perform pg_temp.must_be('the head of an archived office reads nothing',
      pg_temp.head_rows() = 0);
    raise exception 'zz undo';
  exception when others then
    if sqlerrm <> 'zz undo' then raise; end if;
  end;

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the gate and the reads are definer functions',
    (select bool_and(p.prosecdef) from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('office_head_of_caller', 'my_headed_office', 'my_office_overview',
                          'my_office_attention', 'my_office_spaces', 'my_office_people')
     having count(*) = 6));
  perform pg_temp.must_be('anon runs none of the head reads',
    not has_function_privilege('anon', 'public.my_headed_office()', 'execute')
    and not has_function_privilege('anon', 'public.my_office_overview()', 'execute')
    and not has_function_privilege('anon', 'public.my_office_attention()', 'execute')
    and not has_function_privilege('anon', 'public.my_office_spaces()', 'execute')
    and not has_function_privilege('anon', 'public.my_office_people()', 'execute'));

  perform pg_temp.must_be('the seat triggers fire only when relevant',
    not exists (select 1 from pg_trigger
                 where tgname = 'office_members_head_seat'
                   and tgrelid = 'public.office_members'::regclass)
    and exists (select 1 from pg_trigger
                 where tgname = 'office_members_head_seat_delete'
                   and tgrelid = 'public.office_members'::regclass and tgqual is null)
    and exists (select 1 from pg_trigger
                 where tgname = 'office_members_head_seat_move'
                   and tgrelid = 'public.office_members'::regclass and tgqual is not null)
    and exists (select 1 from pg_trigger
                 where tgname = 'profiles_office_head_status'
                   and tgrelid = 'public.profiles'::regclass and tgqual is not null));

  perform pg_temp.must_be('the audit enum has office_head_changed',
    'office_head_changed' = any (enum_range(null::public.audit_action)::text[]));

  -- A head with no name shows as their email, not blank.
  perform pg_temp.act_as_service();
  declare
    v_nn uuid := gen_random_uuid();
    o4   uuid := gen_random_uuid();
  begin
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    values (v_nn, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-oh-nn@example.test', '', now(), now());
    insert into public.profiles (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
    values (v_nn, 'zz-oh-nn@example.test', '', '', 'member', 'active', false, false);
    insert into public.offices (id, name) values (o4, 'Zz Oh nameless');
    insert into public.office_members (office_id, user_id) values (o4, v_nn);
    insert into public.office_heads (office_id, user_id) values (o4, v_nn);
    perform pg_temp.act_as(v_a);
    perform pg_temp.must_be('admin_office_heads falls back to the email for a nameless head',
      exists (select 1 from public.admin_office_heads() x
               where x.office_id = o4 and x.head_name = 'zz-oh-nn@example.test'));
    perform pg_temp.act_as(v_nn);
    perform pg_temp.must_be('my_office_people falls back to the email for a nameless person',
      (select array_agg(x.name) from public.my_office_people() x) = array['zz-oh-nn@example.test']);
  end;

  perform pg_temp.act_as_service();
  raise notice 'office heads suite: all passed';
end $$;

rollback;
