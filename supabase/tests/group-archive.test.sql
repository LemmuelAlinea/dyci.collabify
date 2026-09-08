-- Archiving a group, and what deleting one is allowed to take.
-- Rolled back at the end, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/group-archive.test.sql
--
-- Every refusal is paired with a control that succeeds on the same statement.
-- Without that the suite lies: a refusal can come from a guard that was already
-- there, and would still "pass" with this whole feature deleted.
--
-- The claim worth proving is the one the old confirmation dialog got wrong.
-- Deleting a group does not just remove the group; it cascades into the
-- group's board and its conversation. So: a group holding either cannot be
-- deleted at all, an empty one still can, and archiving leaves every one of
-- those rows exactly where it was.

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
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 72);
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
  prof     uuid := gen_random_uuid();
  student  uuid := gen_random_uuid();
  cls      uuid;
  st       uuid;
  busy     uuid;   -- a group with work on its board
  chatty   uuid;   -- a group with a conversation
  empty    uuid;   -- a group that never held anything
  placed   uuid;   -- members on it and nothing else
  proj     uuid;
  board    uuid;
  convo    uuid;
  res      uuid;
begin
  perform pg_temp.act_as_service();

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated',
         'authenticated', u.id::text || '@test.invalid', '', now(), now()
    from (values (prof), (student)) as u(id);

  insert into public.profiles (id, email, first_name, last_name, role, status)
  values (prof,    prof::text    || '@test.invalid', 'Group', 'Prof',    'professor', 'active'),
         (student, student::text || '@test.invalid', 'Group', 'Student', 'student',   'active');

  -- `guard_project_weeks` refuses a project whose weeks the class's syllabus
  -- does not have, so the class needs one before a project can exist on it.
  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (prof, 'syllabus', 'zz Group Archive syllabus', 'x/g.pdf', 'g.pdf')
  returning id into res;

  insert into public.syllabus_weeks (resource_id, week_no, title)
  select res, n, 'Week ' || n from generate_series(1, 4) as n;

  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id, term_start, term_end)
  values (prof, 'zz Group Archive', 'ZZGA', 'ZZ-GA-1', 'BSIT 9Z', '3rd', '1st', '2026-2027',
          res, date '2026-07-20', date '2026-08-16')
  returning id into cls;

  insert into public.class_members (class_id, student_id, status)
  values (cls, student, 'active');

  insert into public.group_sets (class_id, name, mode)
  values (cls, 'Set A', 'manual') returning id into st;

  insert into public.groups (set_id, name, position) values (st, 'Busy',   1) returning id into busy;
  insert into public.groups (set_id, name, position) values (st, 'Chatty', 2) returning id into chatty;
  insert into public.groups (set_id, name, position) values (st, 'Empty',  3) returning id into empty;
  insert into public.groups (set_id, name, position) values (st, 'Placed', 4) returning id into placed;

  insert into public.group_members (group_id, set_id, student_id, added_by)
  values (busy, st, student, prof);

  -- A group project must carry its set: `projects_audience_shape`.
  insert into public.projects (class_id, created_by, title, type, audience,
                               group_set_id, start_week, end_week)
  values (cls, prof, 'Group project', 'activity', 'group', st, 1, 2)
  returning id into proj;

  -- A board with one task on it. This is what the delete would have taken.
  select id into board from public.project_boards
   where project_id = proj and group_id = busy;
  if board is null then
    insert into public.project_boards (project_id, group_id)
    values (proj, busy) returning id into board;
  end if;

  insert into public.project_tasks (board_id, title, created_by, author_role)
  values (board, 'Draft the ERD', prof, 'professor');

  -- Every group gets its conversation when it is created, so this looks the
  -- existing one up rather than making a second and hitting
  -- `conversations_one_per_group`. Which is itself the point: a group always
  -- has a chat behind it, and deleting the group takes it.
  select id into convo from public.conversations where group_id = chatty;
  if convo is null then
    insert into public.conversations (kind, group_id)
    values ('group', chatty) returning id into convo;
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (convo, student), (convo, prof)
  on conflict do nothing;

  insert into public.messages (conversation_id, sender_id, body)
  values (convo, student, 'when are we meeting');

  -- --------------------------------------------------------------- deleting

  perform pg_temp.act_as(prof);

  -- The pair that matters: an empty group is still disposable, so the guard is
  -- not simply refusing everything.
  perform pg_temp.must_allow(
    'a group that never held anything can still be deleted',
    format('delete from public.groups where id = %L', empty));

  perform pg_temp.must_refuse(
    'a group with a task on its board cannot be deleted',
    format('delete from public.groups where id = %L', busy));

  perform pg_temp.must_refuse(
    'a group with messages in its conversation cannot be deleted',
    format('delete from public.groups where id = %L', chatty));

  -- Members alone are not work: a placement can be made again in a moment, and
  -- blocking on it would refuse the one case deleting is for.
  perform pg_temp.act_as_service();
  insert into public.group_members (group_id, set_id, student_id, added_by)
  values (placed, st, student, prof)
  on conflict do nothing;
  perform pg_temp.act_as(prof);

  perform pg_temp.must_be(
    'a group holding only members counts as holding nothing',
    public.group_work_summary(placed) is null);

  perform pg_temp.must_allow(
    'so it can still be deleted',
    format('delete from public.groups where id = %L', placed));

  perform pg_temp.must_be(
    'the refusal says what is on it',
    public.group_work_summary(busy) = '1 task');

  perform pg_temp.must_be(
    'and counts messages separately',
    public.group_work_summary(chatty) = '1 message');

  -- The bulk path. `save_group_arrangement` wipes every group in the set and
  -- rebuilds it, which silently destroyed started work before this guard.
  perform pg_temp.must_refuse(
    're-saving an arrangement over started work is refused too',
    format('delete from public.groups where set_id = %L', st));

  -- The service role is not exempt. A guard that only holds for the app is not
  -- a guard — the Supabase dashboard has a delete button too.
  perform pg_temp.act_as_service();
  perform pg_temp.must_refuse(
    'not even the service role may delete it',
    format('delete from public.groups where id = %L', busy));
  perform pg_temp.act_as(prof);

  -- -------------------------------------------------------------- archiving

  perform pg_temp.must_allow(
    'the professor can archive it instead',
    format('update public.groups set archived_at = now() where id = %L', busy));

  perform pg_temp.must_be(
    'the board is still there',
    exists (select 1 from public.project_boards where id = board));

  perform pg_temp.must_be(
    'and so is the task on it',
    (select count(*) from public.project_tasks where board_id = board) = 1);

  perform pg_temp.must_be(
    'the members stay placed',
    (select count(*) from public.group_members where group_id = busy) = 1);

  perform pg_temp.must_be(
    'the conversation on the other group is untouched',
    (select count(*) from public.messages where conversation_id = convo) = 1);

  perform pg_temp.must_allow(
    'restoring is the same column set back to null',
    format('update public.groups set archived_at = null where id = %L', busy));

  perform pg_temp.must_be(
    'and it comes back live',
    (select archived_at from public.groups where id = busy) is null);

  -- ------------------------------------------------------------ who may do it

  -- A member may rename their own group — `groups_rename_by_member` exists for
  -- that. Without the column guard the same policy would let any one of them
  -- archive the group out from under the rest.
  perform pg_temp.act_as(student);
  update public.groups set archived_at = now() where id = busy;
  perform pg_temp.must_be(
    'a student cannot archive their own group',
    (select archived_at from public.groups where id = busy) is null);

  perform pg_temp.must_be(
    'though they can still rename it',
    (select name from public.groups where id = busy) = 'Busy');

  raise notice 'ALL PASS';
end $$;

rollback;
