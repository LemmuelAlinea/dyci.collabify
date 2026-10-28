-- Space project requests: private discussion and status gates. Rolled back.
begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_true, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

create or replace function pg_temp.must_refuse_with(p_label text, p_sql text, p_expected text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_expected in sqlerrm) > 0 then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
      return;
    end if;
    raise exception 'FAIL  % — wrong refusal: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — it went through', p_label;
end;
$$;

do $$
#variable_conflict use_variable
declare
  owner_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  author_id uuid := gen_random_uuid();
  peer_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  inactive_id uuid := gen_random_uuid();
  no_switch_id uuid := gen_random_uuid();
  space_id uuid;
  other_space_id uuid;
  education_id uuid;
  request_id uuid;
  converted_id uuid;
  message_id uuid;
  n int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.email, 'x', now(),
         jsonb_build_object('first_name', 'Request', 'last_name', v.label, 'role', 'professor'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
  from (values
    (owner_id, 'request-owner@example.test', 'Owner'),
    (manager_id, 'request-manager@example.test', 'Manager'),
    (author_id, 'request-author@example.test', 'Author'),
    (peer_id, 'request-peer@example.test', 'Peer'),
    (outsider_id, 'request-outsider@example.test', 'Outsider'),
    (inactive_id, 'request-inactive@example.test', 'Inactive'),
    (no_switch_id, 'request-no-switch@example.test', 'No switch')
  ) as v(id, email, label);

  perform pg_temp.service();
  update public.profiles set can_manage_projects = true
   where id in (owner_id, manager_id, author_id, peer_id, outsider_id, inactive_id);
  update public.profiles set status = 'rejected' where id = inactive_id;

  perform pg_temp.act_as(owner_id);
  select id into space_id from public.create_general_space('Request space', '');
  perform pg_temp.act_as(outsider_id);
  select id into other_space_id from public.create_general_space('Other request space', '');

  perform pg_temp.service();
  insert into public.general_space_members (space_id, user_id, level)
  values (space_id, manager_id, 'manager'),
         (space_id, author_id, 'member'),
         (space_id, peer_id, 'member'),
         (space_id, inactive_id, 'member'),
         (space_id, no_switch_id, 'manager');

  -- Service setup uses the class-sync flag for an education-space fixture.
  perform public.class_sync_on();
  insert into public.general_spaces (name, kind, created_by)
  values ('Education request fixture', 'education', owner_id) returning id into education_id;
  insert into public.general_space_members (space_id, user_id, level)
  values (education_id, owner_id, 'owner');
  perform public.class_sync_restore('off');

  perform pg_temp.act_as(author_id);
  request_id := public.create_general_project_request(
    space_id, 'Customer portal', 'Serve customers online', 'Customers can track orders', current_date + 30);
  perform pg_temp.must_be('author reads their request',
    (select count(*) = 1 from public.general_project_requests where id = request_id));
  message_id := public.post_general_project_request_message(request_id, 'Can we include status updates?');
  perform pg_temp.must_be('author reads their message',
    (select count(*) = 1 from public.general_project_request_messages where id = message_id));
  perform public.edit_general_project_request(request_id,
    'Customer portal', 'Updated brief', 'Customers can track orders', current_date + 30);
  perform pg_temp.must_be('author edits open brief',
    (select brief = 'Updated brief' from public.general_project_requests where id = request_id));

  perform pg_temp.act_as(manager_id);
  perform pg_temp.must_be('manager reads request and thread',
    (select count(*) = 1 from public.general_project_requests where id = request_id)
    and (select count(*) = 1 from public.general_project_request_messages m where m.request_id = request_id));
  perform public.post_general_project_request_message(request_id, 'Yes, track orders.');
  perform public.set_general_project_request_status(request_id, 'ready');
  perform pg_temp.must_be('manager marks ready',
    (select status = 'ready' from public.general_project_requests where id = request_id));

  perform pg_temp.act_as(author_id);
  perform pg_temp.must_refuse_with('author cannot edit a ready brief',
    format('select public.edit_general_project_request(%L, %L, %L, %L, null)',
      request_id, 'Changed', 'No', 'No'), 'no longer open for edits');
  perform public.post_general_project_request_message(request_id, 'The brief is agreed.');

  perform pg_temp.act_as(peer_id);
  perform pg_temp.must_be('ordinary Space peer cannot read request or messages',
    (select count(*) = 0 from public.general_project_requests where id = request_id)
    and (select count(*) = 0 from public.general_project_request_messages m where m.request_id = request_id));
  perform pg_temp.must_refuse_with('ordinary Space peer cannot comment',
    format('select public.post_general_project_request_message(%L, %L)', request_id, 'No access'),
    'cannot join this request discussion');
  perform pg_temp.must_refuse_with('ordinary Space peer cannot mark ready',
    format('select public.set_general_project_request_status(%L, %L)', request_id, 'ready'),
    'Only a Project manager');

  perform pg_temp.act_as(outsider_id);
  perform pg_temp.must_be('another Space cannot read request',
    (select count(*) = 0 from public.general_project_requests where id = request_id));
  perform pg_temp.must_refuse_with('another Space cannot comment',
    format('select public.post_general_project_request_message(%L, %L)', request_id, 'No access'),
    'cannot join this request discussion');

  perform pg_temp.act_as(no_switch_id);
  perform pg_temp.must_be('manager without Project manager switch can read',
    (select count(*) = 1 from public.general_project_requests where id = request_id));
  perform pg_temp.must_refuse_with('manager without Project manager switch cannot change status',
    format('select public.set_general_project_request_status(%L, %L)', request_id, 'closed'),
    'Only a Project manager');

  perform pg_temp.act_as(inactive_id);
  perform pg_temp.must_refuse_with('inactive member cannot create',
    format('select public.create_general_project_request(%L, %L, %L, %L, null)',
      space_id, 'New request', 'Brief', 'Outcome'), 'active account');

  perform pg_temp.act_as(owner_id);
  perform pg_temp.must_refuse_with('education Space refuses project requests',
    format('select public.create_general_project_request(%L, %L, %L, %L, null)',
      education_id, 'New request', 'Brief', 'Outcome'), 'only for work Spaces');
  perform pg_temp.must_refuse_with('invalid title refuses',
    format('select public.create_general_project_request(%L, %L, %L, %L, null)',
      space_id, '', 'Brief', 'Outcome'), 'length limits');
  perform pg_temp.must_refuse_with('oversize message refuses',
    format('select public.post_general_project_request_message(%L, %L)', request_id, repeat('a', 5001)),
    '1 to 5,000 characters');
  perform pg_temp.must_refuse_with('request tables refuse direct writes',
    format('update public.general_project_requests set title = %L where id = %L', 'Override', request_id),
    'permission denied for table');

  converted_id := public.create_general_project_request(
    space_id, 'Converted fixture', 'Approved brief', 'Deliver a portal', null);
  perform pg_temp.service();
  update public.general_project_requests set status = 'converted' where id = converted_id;
  perform pg_temp.act_as(owner_id);
  perform pg_temp.must_refuse_with('converted request refuses edits',
    format('select public.edit_general_project_request(%L, %L, %L, %L, null)',
      converted_id, 'Changed', 'Changed', 'Changed'), 'no longer open for edits');
  perform pg_temp.must_refuse_with('converted request refuses comments',
    format('select public.post_general_project_request_message(%L, %L)', converted_id, 'Too late'),
    'discussion is closed');

  perform pg_temp.service();
  delete from public.general_space_members m where m.space_id = space_id and m.user_id = author_id;
  perform pg_temp.act_as(author_id);
  select count(*) into n from public.general_project_requests where id = request_id;
  perform pg_temp.must_be('removed author loses request', n = 0);
  select count(*) into n from public.general_project_request_messages m where m.request_id = request_id;
  perform pg_temp.must_be('removed author loses messages', n = 0);

  perform pg_temp.act_as(manager_id);
  perform public.set_general_project_request_status(request_id, 'closed');
  perform pg_temp.must_refuse_with('closed request refuses comments',
    format('select public.post_general_project_request_message(%L, %L)', request_id, 'Too late'),
    'discussion is closed');
end;
$$;

rollback;
