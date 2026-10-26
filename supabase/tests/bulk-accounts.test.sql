-- Imported users wait for consent and a new password; ordinary sign-up does not.
-- This suite leaves no accounts behind.
begin;

do $$
declare
  imported uuid := gen_random_uuid();
  ordinary uuid := gen_random_uuid();
  program_admin uuid := gen_random_uuid();
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password,
     raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values
    (imported, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'bulk-test@dyci.edu.ph', '',
     '{"first_name":"Bulk","middle_name":"M","last_name":"Test","role":"member"}',
     '{"bulk_registration":true}', now(), now()),
    (ordinary, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'ordinary-test@example.test', '',
     '{"first_name":"Ordinary","last_name":"Test","role":"student"}',
    '{}', now(), now()),
    (program_admin, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'bulk-admin-test@example.test', '',
     '{}', '{}', now(), now());

  insert into public.profiles (id, email, first_name, last_name, role, status)
  values (program_admin, 'bulk-admin-test@example.test', 'Bulk', 'Admin', 'admin', 'active');

  if not exists (
    select 1 from public.profiles
     where id = imported and role = 'member' and status = 'pending'
       and bulk_setup_required and not can_teach and not can_manage_projects
       and middle_name = 'M'
  ) then raise exception 'FAIL imported profile setup state'; end if;
  raise notice 'PASS imported profile waits with both switches off';

  if not exists (
    select 1 from public.profiles
     where id = ordinary and role = 'student' and status = 'active'
       and not bulk_setup_required
  ) then raise exception 'FAIL ordinary signup state'; end if;
  raise notice 'PASS ordinary signup remains active';

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', imported, 'role', 'authenticated')::text, true);
  update public.profiles set bulk_setup_required = false, status = 'active'
   where id = imported;
  if not exists (
    select 1 from public.profiles
     where id = imported and bulk_setup_required and status = 'pending'
  ) then raise exception 'FAIL imported user changed setup state'; end if;
  raise notice 'PASS imported user cannot activate their own profile';

  perform set_config('request.jwt.claims',
    json_build_object('sub', program_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.set_account_active(imported, true);
    raise exception 'FAIL admin activated unfinished import';
  exception when check_violation then
    raise notice 'PASS admin cannot activate unfinished import';
  end;
end $$;

rollback;
