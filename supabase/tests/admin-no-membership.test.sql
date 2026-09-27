-- Admins are never members of anything, and never offered in invite search.
--
-- Rolls back; nothing here survives.
begin;

create or replace function pg_temp.act_as(p uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.ok(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if p_true then raise notice 'PASS  %', p_label;
  else raise notice 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  owner_id uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  space    public.general_spaces%rowtype;
  proj     public.general_projects%rowtype;
  refused  boolean;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Nomember', 'last_name', v.ln, 'role', 'professor'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'nomember-owner@test.local', 'Owner'),
                 (admin_id, 'nomember-admin@test.local', 'Admin')) as v(id, em, ln);
  -- As the service role: the privileged-column guard lets only an admin or
  -- the service role set role and status.
  update public.profiles set status = 'active' where id in (owner_id, admin_id);
  update public.profiles set role = 'admin' where id = admin_id;

  perform pg_temp.act_as(owner_id);
  space := public.create_general_space('No admins here', '');
  proj := public.create_general_project('No admins either', '', null, null, null, null, space.id);

  -- Straight at the tables, past row security, so only the trigger decides.
  reset role;
  perform set_config('request.jwt.claims', '', true);

  begin
    insert into public.general_space_invitations (space_id, invitee, invited_by)
    values (space.id, admin_id, owner_id);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('an admin cannot be invited to a space', refused);

  begin
    insert into public.general_invitations (project_id, invitee, invited_by)
    values (proj.id, admin_id, owner_id);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('an admin cannot be invited to a project', refused);

  begin
    insert into public.general_space_members (space_id, user_id, level)
    values (space.id, admin_id, 'member');
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('an admin cannot be added to a space', refused);

  begin
    insert into public.general_members (project_id, user_id, level)
    values (proj.id, admin_id, 'member');
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('an admin cannot be added to a project', refused);

  perform pg_temp.act_as(owner_id);
  perform pg_temp.ok('invite search never offers an admin',
    not exists (select 1 from public.search_general_people('Nomember Admin') where person_id = admin_id));
end;
$$;

rollback;
