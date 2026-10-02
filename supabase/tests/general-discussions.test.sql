-- Discussion: the live room, its file, and who may do what. Rolls back.
--
--   node scripts/db.mjs supabase/tests/general-discussions.test.sql

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
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_out uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_board uuid;
  gp uuid; v_folder uuid; d1 uuid; d2 uuid; v_at timestamptz; v_html text;
  refused boolean;
begin
  select c.id, c.professor_id into v_class, v_prof from public.classes c
   where (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 3
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;
  select student_id into v_out from public.class_members where class_id = v_class and status = 'active' and student_id not in (v_a, v_b) order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-discuss', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Talk group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id) values (v_group, v_set, v_a), (v_group, v_set, v_b);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'Talk lab', 'activity', 1, 1, 'group', v_set, now() + interval '7 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_group;

  perform pg_temp.act_as(v_a);
  gp := public.ensure_class_board_repo(v_board);
  perform pg_temp.svc();
  update public.notification_prefs set project_updates = true where user_id = v_b;

  ------------------------------------------------------------------ the room
  perform pg_temp.act_as(v_a);
  v_folder := public.create_general_discussion_folder(gp, 'Planning');
  d1 := public.start_general_discussion(gp, v_folder, 'Sprint 1 plan');
  perform pg_temp.svc();
  perform pg_temp.ok('a student starts a discussion in a folder',
    exists (select 1 from public.general_discussions where id = d1 and folder_id = v_folder and ended_at is null));
  perform pg_temp.ok('the rest of the group is told, pointing at the class project',
    exists (select 1 from public.notifications where user_id = v_b and type = 'discussion_started'
             and project_id = v_proj and general_project_id is null));
  perform pg_temp.ok('...and the starter is not',
    not exists (select 1 from public.notifications where user_id = v_a and type = 'discussion_started'
                   and project_id = v_proj));

  perform pg_temp.act_as(v_b);
  begin
    perform public.start_general_discussion(gp, null, 'Another');
    refused := false;
  exception when unique_violation then refused := true;
  end;
  perform pg_temp.ok('only one live discussion at a time', refused);

  perform public.send_general_discussion_message(d1, 'I will draft <the> survey & send it Friday');
  perform pg_temp.act_as(v_a);
  perform public.send_general_discussion_message(d1, 'Good. I take the interviews.');

  perform pg_temp.act_as(v_out);
  perform pg_temp.ok('a classmate outside the group reads nothing',
    not exists (select 1 from public.general_discussions where project_id = gp)
    and not exists (select 1 from public.general_discussion_messages where project_id = gp));
  begin
    perform public.send_general_discussion_message(d1, 'hello');
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('...and cannot write', refused);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.ok('the professor reads nothing', not exists (select 1 from public.general_discussions where project_id = gp));

  perform pg_temp.act_as(v_b);
  begin
    insert into public.general_discussion_messages (discussion_id, project_id, sender_id, body) values (d1, gp, v_b, 'direct');
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('no direct writes to the tables', refused);

  begin
    perform public.stop_general_discussion(d1);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('only the starter stops it', refused);

  ------------------------------------------------------------------ the file
  perform pg_temp.act_as(v_a);
  perform public.stop_general_discussion(d1);
  perform pg_temp.svc();
  select content_html, updated_at into v_html, v_at from public.general_discussions where id = d1;
  perform pg_temp.ok('stopping writes the conversation into the file',
    v_html like '%<h1>Sprint 1 plan</h1>%' and v_html like '%take the interviews%');
  perform pg_temp.ok('...with what people typed escaped', v_html like '%&lt;the&gt; survey &amp; send%');

  perform pg_temp.act_as(v_b);
  begin
    perform public.send_general_discussion_message(d1, 'late');
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('nothing is sent after it stops', refused);

  v_at := public.save_general_discussion_file(d1, '<p>Edited by B</p>', v_at);
  perform pg_temp.ok('anyone in the group edits and saves the file',
    (select content_html from public.general_discussions where id = d1) = '<p>Edited by B</p>');

  perform pg_temp.act_as(v_a);
  begin
    perform public.save_general_discussion_file(d1, '<p>Old copy</p>', v_at - interval '1 minute');
    refused := false;
  exception when serialization_failure then refused := true;
  end;
  perform pg_temp.ok('a save over a newer version is refused', refused);

  begin
    perform public.delete_general_discussion_folder(v_folder);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a folder with discussions in it cannot be deleted', refused);

  perform pg_temp.act_as(v_b);
  begin
    perform public.trash_general_discussion(d1);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('someone who did not start it cannot move it to Trash', refused);

  ------------------------------------------------------------------ freezing
  perform pg_temp.act_as(v_a);
  perform public.set_board_submitted(v_board, true);
  perform pg_temp.act_as(v_b);
  begin
    d2 := public.start_general_discussion(gp, null, 'After hand-in');
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a handed-in board starts no discussion', refused);
  begin
    perform public.save_general_discussion_file(d1, '<p>x</p>', null);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('...and its files cannot change', refused);
  perform pg_temp.ok('...but they can still be read', exists (select 1 from public.general_discussions where id = d1));

  ------------------------------------------------------------------ trash
  perform pg_temp.act_as(v_a);
  perform public.set_board_submitted(v_board, false);
  perform public.trash_general_discussion(d1);
  perform pg_temp.ok('the starter moves it to Trash, where they see it',
    exists (select 1 from public.list_my_trash() t where t.kind = 'discussion' and t.id = d1));
  perform pg_temp.act_as(v_b);
  perform pg_temp.ok('...and it leaves the Discussion tab for everyone else',
    not exists (select 1 from public.general_discussions where id = d1));
  perform pg_temp.ok('...and is not in their Trash',
    not exists (select 1 from public.list_my_trash() t where t.id = d1));

  perform pg_temp.act_as(v_a);
  perform public.restore_trashed_discussion(d1);
  perform pg_temp.act_as(v_b);
  perform pg_temp.ok('restoring brings it back for the group, in its folder',
    exists (select 1 from public.general_discussions where id = d1 and folder_id = v_folder and trashed_at is null));

  perform pg_temp.act_as(v_a);
  perform public.trash_general_discussion(d1);
  perform public.delete_general_discussion_folder(v_folder);
  perform pg_temp.svc();
  perform pg_temp.ok('a folder whose only discussion is in Trash can go, and the discussion comes back at the top',
    not exists (select 1 from public.general_discussion_folders where id = v_folder)
    and (select folder_id from public.general_discussions where id = d1) is null);

  update public.general_discussions set trashed_at = now() - interval '31 days' where id = d1;
  perform public.purge_trash();
  perform pg_temp.ok('after 30 days the purge deletes it for good',
    not exists (select 1 from public.general_discussions where id = d1));
end;
$$;

rollback;
