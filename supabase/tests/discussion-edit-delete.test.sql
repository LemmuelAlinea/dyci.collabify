-- Editing and deleting live discussion messages. Rolls back.
--
--   node scripts/db.mjs supabase/tests/discussion-edit-delete.test.sql

begin;

create or replace function pg_temp.act_as(p uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.svc() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.ok(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_true, false) then raise notice 'PASS  %', p_label;
  else raise notice 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_c uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_board uuid;
  gp uuid; d1 uuid; d2 uuid; r jsonb;
  m_a uuid; m_b uuid; m_c uuid; m_c2 uuid; m_file uuid; m_late uuid; poll1 uuid;
  v_path text;
  refused boolean;
begin
  select c.id, c.professor_id into v_class, v_prof from public.classes c
   where (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 3
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;
  select student_id into v_c from public.class_members where class_id = v_class and status = 'active' and student_id not in (v_a, v_b) order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-editdelete', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Edit group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_group, v_set, v_a), (v_group, v_set, v_b), (v_group, v_set, v_c);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'Edit lab', 'activity', 1, 1, 'group', v_set, now() + interval '7 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_group;

  perform pg_temp.act_as(v_a);
  gp := public.ensure_class_board_repo(v_board);
  d1 := public.start_general_discussion(gp, null, 'Edit prep');
  m_a := public.send_general_discussion_message(d1, 'Hello from A');
  perform pg_temp.act_as(v_b);
  m_b := public.send_general_discussion_message(d1, 'Hello from B');
  perform pg_temp.act_as(v_c);
  m_c := public.send_general_discussion_message(d1, 'Hello from C');
  m_c2 := public.send_general_discussion_message(d1, 'Second from C');

  ------------------------------------------------------------------ editing
  perform pg_temp.act_as(v_a);
  perform public.edit_general_discussion_message(m_a, '  Hello again from A  ');
  perform pg_temp.ok('the sender edits their message',
    (select body = 'Hello again from A' and edited_at is not null from public.general_discussion_messages where id = m_a));

  begin
    perform public.edit_general_discussion_message(m_b, 'Not mine');
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('nobody edits someone else''s message', refused);

  begin
    perform public.edit_general_discussion_message(m_a, '   ');
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a text message cannot be edited to nothing', refused);

  r := public.create_general_discussion_poll(d1, 'Meet when?', array['Friday', 'Saturday'], false, false);
  poll1 := (r->>'poll_id')::uuid;
  begin
    perform public.edit_general_discussion_message((select message_id from public.general_discussion_polls where id = poll1), 'Changed');
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a poll cannot be edited', refused);

  v_path := gp || '/' || d1 || '/zz-edit-brief.pdf';
  insert into storage.objects (bucket_id, name, owner_id) values ('discussion-files', v_path, v_a::text);
  m_file := public.send_general_discussion_files(d1, 'Caption', jsonb_build_array(jsonb_build_object('path', v_path, 'name', 'brief.pdf')));
  perform public.edit_general_discussion_message(m_file, '');
  perform pg_temp.ok('a file caption can be edited, even to blank',
    (select body = '' and edited_at is not null from public.general_discussion_messages where id = m_file));

  ------------------------------------------------------------------ deleting
  perform pg_temp.act_as(v_b);
  begin
    perform public.delete_general_discussion_message(m_c);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('a plain member cannot delete someone else''s message', refused);

  perform public.delete_general_discussion_message(m_b);
  perform pg_temp.ok('the sender deletes their own message',
    not exists (select 1 from public.general_discussion_messages where id = m_b));

  perform pg_temp.act_as(v_a);
  perform pg_temp.ok('...a student is not a moderator before being leader',
    not public.general_discussion_moderator(gp));
  perform public.set_group_leader(v_group, v_a);
  perform pg_temp.ok('the group leader is a moderator', public.general_discussion_moderator(gp));
  perform public.delete_general_discussion_message(m_c);
  perform pg_temp.ok('...and deletes a groupmate''s message',
    not exists (select 1 from public.general_discussion_messages where id = m_c));

  perform public.delete_general_discussion_message((select message_id from public.general_discussion_polls where id = poll1));
  perform pg_temp.ok('deleting a poll takes the poll and its options',
    not exists (select 1 from public.general_discussion_polls where id = poll1)
    and not exists (select 1 from public.general_discussion_poll_options where poll_id = poll1));

  perform public.delete_general_discussion_message(m_file);
  perform pg_temp.ok('deleting a file message takes its file rows',
    not exists (select 1 from public.general_discussion_files where message_id = m_file));

  ------------------------------------------------------------------ after it stops
  perform public.stop_general_discussion(d1);
  perform pg_temp.ok('a deleted message is not in the discussion file',
    (select content_html not like '%Hello from B%' and content_html like '%Hello again from A%'
       from public.general_discussions where id = d1));

  perform pg_temp.act_as(v_c);
  begin
    perform public.edit_general_discussion_message(m_c2, 'Too late');
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('nothing is edited once the discussion stops', refused);
  begin
    perform public.delete_general_discussion_message(m_c2);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('...nor deleted', refused);

  ------------------------------------------------------------------ frozen board
  perform pg_temp.act_as(v_a);
  d2 := public.start_general_discussion(gp, null, 'Late talk');
  m_late := public.send_general_discussion_message(d2, 'Before hand-in');
  perform pg_temp.svc();
  update public.project_boards set submitted_at = now() where id = v_board;
  perform pg_temp.act_as(v_a);
  begin
    perform public.delete_general_discussion_message(m_late);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a handed-in board''s messages stay put', refused);
end;
$$;

rollback;
