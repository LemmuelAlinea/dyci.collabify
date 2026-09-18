-- supabase/tests/general-notify.test.sql
-- General notifications and conversations — rolled back at the end.
--
--   node scripts/db.mjs supabase/tests/general-notify.test.sql

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

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  p uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_user_meta_data, created_at, updated_at)
  values
    (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'zz-gnote-owner@example.test', '',
     jsonb_build_object('first_name', 'Zzgnote', 'last_name', 'Owner', 'workplace', 'general'), now(), now()),
    (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'zz-gnote-bravo@example.test', '',
     jsonb_build_object('first_name', 'Zzgnote', 'last_name', 'Bravo', 'workplace', 'general'), now(), now());

  perform pg_temp.act_as(a);
  select (public.create_general_project('Zz Science fair')).id into p;
  perform pg_temp.act_as_service();

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values ('a', a), ('b', b), ('project', p);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ conversation and invitations

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
  convo uuid;
  inv uuid;
begin
  select id into convo from public.conversations where kind = 'project' and general_project_id = p;
  perform pg_temp.must_be('creating a project creates its conversation', convo is not null);
  perform pg_temp.must_be('...with the Owner in it',
    exists (select 1 from public.conversation_members where conversation_id = convo and user_id = a));

  perform pg_temp.act_as(a);
  select id into inv from public.invite_to_general_project(p, b);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('an invitation notifies the invited person',
    exists (select 1 from public.notifications
             where user_id = b and type = 'general_invited' and general_project_id = p));

  perform pg_temp.act_as(b);
  perform public.respond_general_invitation(inv, true);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('accepting adds them to the conversation',
    exists (select 1 from public.conversation_members where conversation_id = convo and user_id = b));

  perform pg_temp.act_as(b);
  perform pg_temp.must_be('the conversation list carries the project id',
    exists (select 1 from public.conversation_overview where id = convo and general_project_id = p));
  perform pg_temp.act_as_service();

  insert into fx values ('convo', convo);
end $$;

-- ------------------------------------------------------------------ deactivation shuts a member out of the conversation

do $$
declare
  b uuid := (select v from fx where k = 'b');
  convo uuid := (select v from fx where k = 'convo');
begin
  perform pg_temp.act_as(b);
  perform pg_temp.must_be('an active member reads the conversation',
    exists (select 1 from public.conversation_overview where id = convo));
  perform pg_temp.must_allow('...and writes in it',
    format($q$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'Still counting cups')$q$, convo, b));

  perform pg_temp.act_as_service();
  update public.profiles set status = 'rejected' where id = b;

  perform pg_temp.act_as(b);
  perform pg_temp.must_be('a deactivated member cannot read the conversation through the overview',
    not exists (select 1 from public.conversation_overview where id = convo));
  perform pg_temp.must_refuse('...nor post in it, though their membership row is untouched',
    format($q$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'Let me back in')$q$, convo, b));

  perform pg_temp.act_as_service();
  update public.profiles set status = 'active' where id = b;

  perform pg_temp.act_as(b);
  perform pg_temp.must_be('reactivated, they read the conversation again',
    exists (select 1 from public.conversation_overview where id = convo));
  perform pg_temp.must_allow('...and post in it again',
    format($q$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'Back online')$q$, convo, b));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ requests, tasks, comments

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
  req uuid;
  t1 uuid;
  t2 uuid;
  t3 uuid;
begin
  perform pg_temp.act_as(b);
  select id into req from public.request_general_access(p, 'edit_files', 'Uploading the posters');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('an access request notifies every Owner',
    exists (select 1 from public.notifications
             where user_id = a and type = 'general_access_requested' and general_project_id = p));

  perform pg_temp.act_as(a);
  perform public.answer_general_access_request(req, false, 'Ask again next week');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the answer notifies whoever asked',
    exists (select 1 from public.notifications
             where user_id = b and type = 'general_access_answered' and general_project_id = p));

  perform pg_temp.act_as(a);
  insert into public.general_tasks (project_id, title) values (p, 'Judge sheets') returning id into t1;
  insert into public.general_task_assignees (task_id, project_id, user_id) values (t1, p, b);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('being assigned by somebody else notifies you',
    exists (select 1 from public.notifications
             where user_id = b and type = 'general_task_assigned' and general_task_id = t1));

  perform pg_temp.act_as(b);
  insert into public.general_tasks (project_id, title) values (p, 'Extension cords') returning id into t2;
  insert into public.general_task_assignees (task_id, project_id, user_id) values (t2, p, b);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('claiming a task yourself does not notify you',
    not exists (select 1 from public.notifications where user_id = b and general_task_id = t2));

  perform pg_temp.act_as(a);
  insert into public.general_task_comments (task_id, project_id, body) values (t1, p, 'Use the 2025 template');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a comment notifies whoever holds the task',
    exists (select 1 from public.notifications
             where user_id = b and type = 'general_comment_posted' and general_task_id = t1));
  perform pg_temp.must_be('...but not the person who wrote it',
    not exists (select 1 from public.notifications
                 where user_id = a and type = 'general_comment_posted' and general_task_id = t1));

  -- A reply should reach whoever commented before, not only whoever holds
  -- the task right now — and a task nobody holds should still tell its
  -- earlier commenters when somebody answers them.
  perform pg_temp.act_as(a);
  insert into public.general_tasks (project_id, title) values (p, 'Sound check') returning id into t3;
  perform pg_temp.act_as_service();

  perform pg_temp.act_as(b);
  insert into public.general_task_comments (task_id, project_id, body) values (t3, p, 'Borrowed a mic from AV');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('commenting on a task nobody holds notifies nobody yet',
    not exists (select 1 from public.notifications where general_task_id = t3));

  perform pg_temp.act_as(a);
  insert into public.general_task_comments (task_id, project_id, body) values (t3, p, 'Great, return it Friday');
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a reply reaches whoever commented before, though they never held the task',
    exists (select 1 from public.notifications
             where user_id = b and type = 'general_comment_posted' and general_task_id = t3));

  update public.general_tasks set due_at = now() + interval '2 hours' where id = t1;
  perform public.send_general_deadline_reminders();
  perform pg_temp.must_be('a task due within a day sends a reminder',
    exists (select 1 from public.notifications
             where user_id = b and type = 'general_deadline_soon' and general_task_id = t1));
  perform public.send_general_deadline_reminders();
  perform pg_temp.must_be('...once, however often the job runs',
    (select count(*) = 1 from public.notifications
      where user_id = b and type = 'general_deadline_soon' and general_task_id = t1));
end $$;

-- ------------------------------------------------------------------ writing, leaving, counts

do $$
declare
  a uuid := (select v from fx where k = 'a');
  b uuid := (select v from fx where k = 'b');
  p uuid := (select v from fx where k = 'project');
  convo uuid := (select v from fx where k = 'convo');
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
begin
  perform pg_temp.act_as(b);
  perform pg_temp.must_allow('a member writes in the project conversation',
    format($q$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'Booth 4 is ours')$q$, convo, b));

  perform pg_temp.act_as(a);
  perform public.archive_general_project(p, true);
  perform pg_temp.act_as(b);
  perform pg_temp.must_refuse('nobody writes in an archived project''s conversation',
    format($q$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'Still here')$q$, convo, b));

  perform pg_temp.act_as(a);
  perform public.archive_general_project(p, false);
  perform public.remove_general_member(p, b);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('removing a member takes them out of the conversation',
    not exists (select 1 from public.conversation_members where conversation_id = convo and user_id = b));

  perform pg_temp.act_as(a);
  perform pg_temp.must_refuse('only an admin reads the General counts',
    'select * from public.general_counts()');
  perform pg_temp.act_as(v_admin);
  perform pg_temp.must_allow('an admin reads the General counts',
    'select * from public.general_counts()');
  perform pg_temp.act_as_service();
end $$;

rollback;
