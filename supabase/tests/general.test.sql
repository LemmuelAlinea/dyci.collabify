-- supabase/tests/general.test.sql
-- General projects — rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/general.test.sql
--
-- Every refusal is paired with a control that succeeds on the same statement.
-- An RLS-filtered UPDATE changes zero rows without an error, so those checks
-- read the row back instead of expecting a refusal.

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
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 64);
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

-- ------------------------------------------------------------------ fixture

-- Five fresh General accounts, so nothing depends on who happens to be in the
-- database. Requires supabase/workplaces.sql.
do $$
declare
  v_ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                        gen_random_uuid(), gen_random_uuid()];
  v_names text[] := array['Owner', 'Bravo', 'Charlie', 'Delta', 'Echo'];
  i int;
  v_project uuid;
begin
  for i in 1..5 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_user_meta_data, created_at, updated_at)
    values (v_ids[i], '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'zz-gen-' || lower(v_names[i]) || '@example.test', '',
            jsonb_build_object('first_name', 'Zzgen', 'last_name', v_names[i],
                               'workplace', 'general'),
            now(), now());
  end loop;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert, update on fx to authenticated;
  insert into fx values ('a', v_ids[1]), ('b', v_ids[2]), ('c', v_ids[3]),
                        ('d', v_ids[4]), ('e', v_ids[5]);

  perform pg_temp.act_as(v_ids[1]);
  select (public.create_general_project('Zz Intramurals', 'Sports week', '2026-10-01', '2026-10-05')).id
    into v_project;
  perform pg_temp.act_as_service();
  insert into fx values ('project', v_project);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ creating and reading

do $$
declare
  a uuid := (select v from fx where k = 'a');
  c uuid := (select v from fx where k = 'c');
  p uuid := (select v from fx where k = 'project');
begin
  perform pg_temp.must_be('the creator is the Owner',
    exists (select 1 from public.general_members where project_id = p and user_id = a and level = 'owner'));

  perform pg_temp.act_as(c);
  perform pg_temp.must_be('a non-member cannot read the project',
    not exists (select 1 from public.general_projects where id = p));
  perform pg_temp.act_as(a);
  perform pg_temp.must_be('...while a member can',
    exists (select 1 from public.general_projects where id = p));

  perform pg_temp.must_refuse('a project cannot end before it starts',
    $q$select public.create_general_project('Zz Backwards', '', '2026-10-05', '2026-10-01')$q$);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ invitations

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  c uuid := (select v from fx where k = 'c');
  d uuid := (select v from fx where k = 'd');
  p uuid := (select v from fx where k = 'project');
  inv uuid;
begin
  perform pg_temp.act_as(c);
  perform pg_temp.must_refuse('a non-member cannot invite',
    format('select public.invite_to_general_project(%L, %L)', p, d));

  perform pg_temp.act_as(a);
  select id into inv from public.invite_to_general_project(p, b);
  perform pg_temp.must_be('an Owner can invite', inv is not null);

  perform pg_temp.act_as(b);
  perform pg_temp.must_be('the invited person can see the project they are invited to',
    exists (select 1 from public.general_projects where id = p));
  perform pg_temp.act_as(c);
  perform pg_temp.must_refuse('somebody else cannot answer the invitation',
    format('select public.respond_general_invitation(%L, true)', inv));
  perform pg_temp.act_as(b);
  perform pg_temp.must_allow('the invited person accepts',
    format('select public.respond_general_invitation(%L, true)', inv));
  perform pg_temp.must_be('...and becomes a Member',
    exists (select 1 from public.general_members where project_id = p and user_id = b and level = 'member'));

  perform pg_temp.must_refuse('a Member cannot invite',
    format('select public.invite_to_general_project(%L, %L)', p, c));
  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('an Owner makes them a Manager',
    format('select public.set_general_member_level(%L, %L, %L)', p, b, 'manager'));
  perform pg_temp.act_as(b);
  perform pg_temp.must_allow('a Manager can invite',
    format('select public.invite_to_general_project(%L, %L)', p, c));
  perform pg_temp.must_refuse('a Manager cannot change access levels',
    format('select public.set_general_member_level(%L, %L, %L)', p, a, 'member'));

  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('the Owner sets them back to Member',
    format('select public.set_general_member_level(%L, %L, %L)', p, b, 'member'));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ editing and extra permissions

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
begin
  perform pg_temp.act_as(b);
  update public.general_projects set name = 'Zz Renamed by a Member' where id = p;
  perform pg_temp.act_as(a);
  perform pg_temp.must_be('a Member cannot rename the project',
    (select name = 'Zz Intramurals' from public.general_projects where id = p));
  update public.general_projects set name = 'Zz Intramurals 2026' where id = p;
  perform pg_temp.must_be('...while an Owner can',
    (select name = 'Zz Intramurals 2026' from public.general_projects where id = p));

  perform pg_temp.must_refuse('a join code cannot be written directly',
    format($q$insert into public.general_join_codes (project_id, code, open) values (%L, 'ABCDEFGH', true)$q$, p));

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('a Member without the permission cannot add a team',
    format($q$insert into public.general_teams (project_id, name) values (%L, 'Logistics')$q$, p));
  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('an Owner grants manage_structure',
    format('select public.grant_general_permission(%L, %L, %L)', p, b, 'manage_structure'));
  perform pg_temp.act_as(b);
  perform pg_temp.must_allow('...and now the Member can add a team',
    format($q$insert into public.general_teams (project_id, name) values (%L, 'Logistics')$q$, p));
  perform pg_temp.act_as(a);
  perform pg_temp.must_allow('the Owner revokes it',
    format('select public.revoke_general_permission(%L, %L, %L)', p, b, 'manage_structure'));
  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('...and the Member cannot add a team again',
    format($q$insert into public.general_teams (project_id, name) values (%L, 'Sports')$q$, p));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ access requests

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  c uuid := (select v from fx where k = 'c');
  p uuid := (select v from fx where k = 'project');
  req uuid;
begin
  perform pg_temp.act_as(b);
  select id into req from public.request_general_access(p, 'edit_files', 'I keep the receipts');
  perform pg_temp.must_be('a Member can request a permission', req is not null);
  perform pg_temp.must_refuse('a second request for the same permission is refused while the first is open',
    format('select public.request_general_access(%L, %L, %L)', p, 'edit_files', 'again'));

  perform pg_temp.act_as(c);
  perform pg_temp.must_be('a non-member cannot read the request',
    not exists (select 1 from public.general_access_requests where id = req));
  perform pg_temp.must_refuse('a non-member cannot answer it',
    format('select public.answer_general_access_request(%L, true, %L)', req, ''));

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('the requester cannot approve their own request',
    format('select public.answer_general_access_request(%L, true, %L)', req, ''));

  perform pg_temp.act_as(a);
  perform pg_temp.must_be('the Owner reads the request',
    exists (select 1 from public.general_access_requests where id = req));
  perform pg_temp.must_allow('the Owner approves it',
    format('select public.answer_general_access_request(%L, true, %L)', req, 'Go ahead'));
  perform pg_temp.must_be('...which grants the permission',
    exists (select 1 from public.general_grants where project_id = p and user_id = b and permission = 'edit_files'));

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('asking for a permission you already hold is refused',
    format('select public.request_general_access(%L, %L, %L)', p, 'edit_files', ''));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ join codes

do $$
declare
  a uuid := (select v from fx where k = 'a');
  d uuid := (select v from fx where k = 'd');
  e uuid := (select v from fx where k = 'e');
  p uuid := (select v from fx where k = 'project');
  code text;
begin
  perform pg_temp.act_as(a);
  code := public.set_general_join_code(p, true, false);
  perform pg_temp.must_be('an Owner opens an eight-character join code', char_length(code) = 8);
  perform pg_temp.act_as((select v from fx where k = 'b'));
  perform pg_temp.must_be('a Member without manage_members cannot read the code',
    not exists (select 1 from public.general_join_codes where project_id = p));

  perform pg_temp.act_as(d);
  perform pg_temp.must_refuse('a Member-to-be cannot change the join code',
    format('select public.set_general_join_code(%L, false, false)', p));
  perform pg_temp.must_allow('a join code works while it is on',
    format('select public.join_general_project(%L)', lower(code)));
  perform pg_temp.must_be('...and joins them as a Member',
    exists (select 1 from public.general_members where project_id = p and user_id = d and level = 'member'));

  perform pg_temp.act_as(a);
  perform public.set_general_join_code(p, false, false);
  perform pg_temp.act_as(e);
  perform pg_temp.must_refuse('a join code fails once it is off',
    format('select public.join_general_project(%L)', code));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ fields

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
  f_budget uuid;
  f_venue uuid;
begin
  perform pg_temp.act_as(a);
  insert into public.general_fields (project_id, name, type) values (p, 'Budget', 'short_text')
  returning id into f_budget;
  perform pg_temp.must_allow('an empty field can change type',
    format($q$update public.general_fields set type = 'money' where id = %L$q$, f_budget));

  perform pg_temp.must_refuse('a negative amount is refused',
    format($q$insert into public.general_field_values (field_id, value) values (%L, '-5')$q$, f_budget));
  perform pg_temp.must_allow('a valid amount is saved',
    format($q$insert into public.general_field_values (field_id, value) values (%L, '15000.50')$q$, f_budget));
  perform pg_temp.must_refuse('a field type cannot change once it holds values',
    format($q$update public.general_fields set type = 'number' where id = %L$q$, f_budget));

  perform pg_temp.must_refuse('a choice field needs options',
    format($q$insert into public.general_fields (project_id, name, type) values (%L, 'Venue', 'single_choice')$q$, p));
  insert into public.general_fields (project_id, name, type, options)
  values (p, 'Venue', 'single_choice', '["Gym", "Covered court"]') returning id into f_venue;
  perform pg_temp.must_refuse('a choice outside the options is refused',
    format($q$insert into public.general_field_values (field_id, value) values (%L, '"Field"')$q$, f_venue));
  perform pg_temp.must_allow('a listed choice is saved',
    format($q$insert into public.general_field_values (field_id, value) values (%L, '"Gym"')$q$, f_venue));
  perform pg_temp.must_refuse('an option still chosen cannot be removed',
    format($q$update public.general_fields set options = '["Covered court"]' where id = %L$q$, f_venue));

  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('a Member without edit_project cannot add a field',
    format($q$insert into public.general_fields (project_id, name, type) values (%L, 'Theme', 'short_text')$q$, p));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ people search

do $$
declare
  a uuid := (select v from fx where k = 'a');
  n int;
  shown_email text;
begin
  perform pg_temp.act_as(a);
  select count(*) into n from public.search_general_people('zz');
  perform pg_temp.must_be('a search shorter than three characters returns nothing', n = 0);
  select count(*) into n from public.search_general_people('Zzgen');
  perform pg_temp.must_be('a name search finds the other accounts, not yourself', n = 4);
  perform pg_temp.must_be('...without showing their email addresses',
    not exists (select 1 from public.search_general_people('Zzgen') s where s.email is not null));
  select s.email into shown_email from public.search_general_people('zz-gen-echo@example.test') s;
  perform pg_temp.must_be('an exact email search shows the email that was typed',
    shown_email = 'zz-gen-echo@example.test');
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ owners and archiving

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
begin
  perform pg_temp.act_as(a);
  perform pg_temp.must_refuse('the last Owner cannot leave',
    format('select public.leave_general_project(%L)', p));
  perform pg_temp.must_refuse('the last Owner cannot step down',
    format('select public.set_general_member_level(%L, %L, %L)', p, a, 'manager'));

  perform pg_temp.must_allow('an Owner archives the project',
    format('select public.archive_general_project(%L, true)', p));
  perform pg_temp.must_refuse('an archived project cannot be renamed',
    format($q$update public.general_projects set name = 'Zz Too late' where id = %L$q$, p));
  perform pg_temp.must_allow('an Owner restores it',
    format('select public.archive_general_project(%L, false)', p));

  perform pg_temp.must_allow('the Owner makes somebody else an Owner',
    format('select public.set_general_member_level(%L, %L, %L)', p, b, 'owner'));
  perform pg_temp.must_allow('...and can then leave',
    format('select public.leave_general_project(%L)', p));
  perform pg_temp.act_as_service();
end $$;

rollback;
