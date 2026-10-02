-- Polls and voice messages in a discussion, and how both reach its file. Rolls back.
--
--   node scripts/db.mjs supabase/tests/discussion-polls-voice.test.sql

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
  gp uuid; d1 uuid; v_html text; r jsonb;
  poll1 uuid; poll2 uuid; o_yes uuid; o_no uuid; o_x uuid; o_y uuid;
  v_path text; v_voice uuid; v_voice2 uuid;
  refused boolean;
begin
  select c.id, c.professor_id into v_class, v_prof from public.classes c
   where (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 3
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;
  select student_id into v_out from public.class_members where class_id = v_class and status = 'active' and student_id not in (v_a, v_b) order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-pollvoice', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Poll group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id) values (v_group, v_set, v_a), (v_group, v_set, v_b);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'Poll lab', 'activity', 1, 1, 'group', v_set, now() + interval '7 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_group;

  perform pg_temp.act_as(v_a);
  gp := public.ensure_class_board_repo(v_board);
  d1 := public.start_general_discussion(gp, null, 'Defense prep');

  ------------------------------------------------------------------ polls
  r := public.create_general_discussion_poll(d1, 'Meet when?', array['Friday', ' friday ', 'Saturday', ''], false, false);
  perform pg_temp.ok('a member posts a poll', r->>'result' = 'ok');
  poll1 := (r->>'poll_id')::uuid;
  perform pg_temp.ok('...as a poll message carrying the question',
    exists (select 1 from public.general_discussion_messages m join public.general_discussion_polls p on p.message_id = m.id
             where p.id = poll1 and m.kind = 'poll' and m.body = 'Meet when?'));
  perform pg_temp.ok('...with blank and repeated options dropped',
    (select array_agg(label order by position) from public.general_discussion_poll_options where poll_id = poll1)
      = array['Friday', 'Saturday']);
  perform pg_temp.ok('one option is not a poll',
    (public.create_general_discussion_poll(d1, 'Q', array['Only'], false, false))->>'result' = 'too_few_options');
  perform pg_temp.ok('a poll needs a question',
    (public.create_general_discussion_poll(d1, '  ', array['A', 'B'], false, false))->>'result' = 'no_question');

  select id into o_yes from public.general_discussion_poll_options where poll_id = poll1 and label = 'Friday';
  select id into o_no from public.general_discussion_poll_options where poll_id = poll1 and label = 'Saturday';

  perform public.cast_general_discussion_poll_vote(o_yes, true);
  perform public.cast_general_discussion_poll_vote(o_no, true);
  perform pg_temp.ok('a single-answer poll keeps only the last pick',
    (select array_agg(option_id) from public.general_discussion_poll_votes where poll_id = poll1 and user_id = v_a) = array[o_no]);

  perform pg_temp.act_as(v_b);
  perform public.cast_general_discussion_poll_vote(o_no, true);
  perform pg_temp.ok('others vote too',
    (select count(*) from public.general_discussion_poll_votes where option_id = o_no) = 2);
  perform pg_temp.ok('a closed-to-others poll takes no new option from them',
    (public.add_general_discussion_poll_option(poll1, 'Sunday'))->>'result' = 'not_allowed');
  perform pg_temp.ok('...and only its maker or a lead closes it',
    (public.set_general_discussion_poll_closed(poll1, true))->>'result' = 'not_allowed');

  r := public.create_general_discussion_poll(d1, 'Bring what?', array['Laptop', 'Printouts'], true, true);
  poll2 := (r->>'poll_id')::uuid;
  select id into o_x from public.general_discussion_poll_options where poll_id = poll2 and label = 'Laptop';
  select id into o_y from public.general_discussion_poll_options where poll_id = poll2 and label = 'Printouts';
  perform public.cast_general_discussion_poll_vote(o_x, true);
  perform public.cast_general_discussion_poll_vote(o_y, true);
  perform pg_temp.ok('a pick-any poll keeps every pick',
    (select count(*) from public.general_discussion_poll_votes where poll_id = poll2 and user_id = v_b) = 2);
  perform pg_temp.act_as(v_a);
  perform pg_temp.ok('an open poll takes a new option from anyone',
    (public.add_general_discussion_poll_option(poll2, 'Adapter'))->>'result' = 'ok');
  perform pg_temp.ok('...but not the same one twice',
    (public.add_general_discussion_poll_option(poll2, 'adapter'))->>'result' = 'duplicate');

  perform pg_temp.act_as(v_out);
  perform pg_temp.ok('a classmate outside the group sees no poll',
    not exists (select 1 from public.general_discussion_polls where project_id = gp)
    and not exists (select 1 from public.general_discussion_poll_votes where project_id = gp));
  begin
    perform public.cast_general_discussion_poll_vote(o_yes, true);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('...and cannot vote', refused);

  perform pg_temp.act_as(v_b);
  begin
    insert into public.general_discussion_poll_votes (option_id, poll_id, project_id, user_id)
    values (o_yes, poll1, gp, v_b);
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('no direct vote writes', refused);

  ------------------------------------------------------------------ voice
  v_path := gp || '/' || d1 || '/' || gen_random_uuid() || '.webm';

  perform pg_temp.act_as(v_out);
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('discussion-voice', v_path, v_out::text);
    refused := false;
  exception when others then refused := true;
  end;
  perform pg_temp.ok('someone outside the group cannot upload a recording there', refused);

  perform pg_temp.act_as(v_a);
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('discussion-voice', gp || '/' || gen_random_uuid() || '/x.webm', v_a::text);
    refused := false;
  exception when others then refused := true;
  end;
  perform pg_temp.ok('...nor anyone into a discussion that is not live there', refused);

  insert into storage.objects (bucket_id, name, owner_id) values ('discussion-voice', v_path, v_a::text);
  perform pg_temp.ok('a member uploads a recording into the live discussion',
    exists (select 1 from storage.objects where bucket_id = 'discussion-voice' and name = v_path));

  perform pg_temp.act_as(v_b);
  begin
    perform public.send_general_discussion_voice(d1, v_path, 84000);
    refused := false;
  exception when invalid_parameter_value then refused := true;
  end;
  perform pg_temp.ok('nobody sends a recording someone else uploaded', refused);

  perform pg_temp.act_as(v_a);
  begin
    perform public.send_general_discussion_voice(d1, v_path, 400000);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a voice message runs up to 5 minutes', refused);

  v_voice := public.send_general_discussion_voice(d1, v_path, 84000);
  perform pg_temp.ok('the uploader sends it, waiting for its transcript',
    exists (select 1 from public.general_discussion_messages
             where id = v_voice and kind = 'voice' and body = '' and transcript_status = 'pending'));
  begin
    perform public.send_general_discussion_voice(d1, v_path, 84000);
    refused := false;
  exception when unique_violation then refused := true;
  end;
  perform pg_temp.ok('...once', refused);

  perform pg_temp.act_as(v_b);
  perform pg_temp.ok('the rest of the group can play it',
    exists (select 1 from storage.objects where bucket_id = 'discussion-voice' and name = v_path));
  perform pg_temp.act_as(v_out);
  perform pg_temp.ok('...and nobody outside it can',
    not exists (select 1 from storage.objects where bucket_id = 'discussion-voice' and name = v_path));

  -- The edge function writes the transcript with the service role.
  perform pg_temp.svc();
  update public.general_discussion_messages
     set body = 'Ako na sa slides, kayo sa demo.', transcript_status = 'done' where id = v_voice;

  perform pg_temp.act_as(v_b);
  begin
    perform public.edit_general_discussion_transcript(v_voice, 'hijacked');
    refused := false;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('only the sender corrects a transcript', refused);
  begin
    update public.general_discussion_messages set body = 'direct' where id = v_voice;
    refused := not found;
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.ok('...and nobody writes it directly', refused);

  perform pg_temp.act_as(v_a);
  perform public.edit_general_discussion_transcript(v_voice, 'Ako na sa slides, kayo na sa demo & Q<A>.');
  perform pg_temp.ok('the sender corrects it',
    exists (select 1 from public.general_discussion_messages
             where id = v_voice and body like 'Ako na sa slides, kayo na%' and transcript_edited_at is not null));

  -- A second recording that never got its transcript.
  v_path := gp || '/' || d1 || '/' || gen_random_uuid() || '.webm';
  insert into storage.objects (bucket_id, name, owner_id) values ('discussion-voice', v_path, v_a::text);
  v_voice2 := public.send_general_discussion_voice(d1, v_path, 5000);

  ------------------------------------------------------------------ shared files
  v_path := gp || '/' || d1 || '/' || gen_random_uuid() || '-brief.pdf';
  perform pg_temp.act_as(v_out);
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('discussion-files', v_path, v_out::text);
    refused := false;
  exception when others then refused := true;
  end;
  perform pg_temp.ok('someone outside the group cannot upload a file there', refused);

  perform pg_temp.act_as(v_a);
  insert into storage.objects (bucket_id, name, owner_id) values ('discussion-files', v_path, v_a::text);
  perform pg_temp.act_as(v_b);
  begin
    perform public.send_general_discussion_files(d1, '', jsonb_build_array(jsonb_build_object('path', v_path, 'name', 'brief.pdf')));
    refused := false;
  exception when invalid_parameter_value then refused := true;
  end;
  perform pg_temp.ok('nobody sends a file someone else uploaded', refused);

  perform pg_temp.act_as(v_a);
  perform public.send_general_discussion_files(d1, 'Use this <brief> for the survey',
    jsonb_build_array(jsonb_build_object('path', v_path, 'name', 'brief.pdf', 'mime', 'application/pdf', 'size', 1234)));
  perform pg_temp.ok('a member shares a file with a caption',
    exists (select 1 from public.general_discussion_messages m join public.general_discussion_files f on f.message_id = m.id
             where m.discussion_id = d1 and m.kind = 'file' and f.file_name = 'brief.pdf' and f.size_bytes = 1234));
  begin
    perform public.send_general_discussion_files(d1, '', jsonb_build_array(jsonb_build_object('path', v_path, 'name', 'again.pdf')));
    refused := false;
  exception when unique_violation then refused := true;
  end;
  perform pg_temp.ok('...once', refused);
  begin
    perform public.send_general_discussion_files(d1, 'nothing', '[]'::jsonb);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a file message needs a file', refused);

  perform pg_temp.act_as(v_b);
  perform pg_temp.ok('the group sees the file',
    exists (select 1 from public.general_discussion_files where file_path = v_path)
    and exists (select 1 from storage.objects where bucket_id = 'discussion-files' and name = v_path));
  perform pg_temp.act_as(v_out);
  perform pg_temp.ok('...and nobody outside it does',
    not exists (select 1 from public.general_discussion_files where file_path = v_path)
    and not exists (select 1 from storage.objects where bucket_id = 'discussion-files' and name = v_path));
  perform pg_temp.act_as(v_a);

  ------------------------------------------------------------------ the file
  perform public.stop_general_discussion(d1);
  perform pg_temp.svc();
  select content_html into v_html from public.general_discussions where id = d1;

  perform pg_temp.ok('stopping closes every poll',
    not exists (select 1 from public.general_discussion_polls where discussion_id = d1 and closed_at is null));
  perform pg_temp.ok('the file has each poll and how it came out',
    v_html like '%asked in a poll: <strong>Meet when?</strong>%'
    and v_html like '%<li>Saturday: 2 votes (%' and v_html like '%<li>Friday: 0 votes</li>%'
    and v_html like '%2 people voted.%');
  perform pg_temp.ok('...including a pick-any poll and its added option',
    v_html like '%picking any number of options%' and v_html like '%<li>Adapter: 0 votes</li>%');
  perform pg_temp.ok('...each voice message as its corrected transcript, escaped',
    v_html like '%(voice message, 1:24, transcript corrected by the sender): Ako na sa slides, kayo na sa demo &amp; Q&lt;A&gt;.%');
  perform pg_temp.ok('...each shared file by name with its caption, escaped',
    v_html like '%shared <em>brief.pdf</em>: Use this &lt;brief&gt; for the survey</p>%');
  perform pg_temp.ok('...and a recording with no transcript says so',
    v_html like '%(voice message, 0:05): <em>Not transcribed.</em>%');

  perform pg_temp.act_as(v_b);
  begin
    perform public.cast_general_discussion_poll_vote(o_yes, true);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('a stopped discussion takes no more votes', refused);
  perform pg_temp.act_as(v_a);
  begin
    perform public.edit_general_discussion_transcript(v_voice, 'later');
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.ok('...and no more transcript edits', refused);

  perform pg_temp.svc();
  perform pg_temp.ok('anon reaches none of the new calls',
    not has_function_privilege('anon', 'public.create_general_discussion_poll(uuid, text, text[], boolean, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.send_general_discussion_voice(uuid, text, integer)', 'execute')
    and not has_function_privilege('anon', 'public.edit_general_discussion_transcript(uuid, text)', 'execute'));
end;
$$;

rollback;
