-- Company roles, phase 3: the Feedback tab — rolled back, touches nothing
-- permanently.
--
--   node scripts/db.mjs supabase/tests/project-feedback.test.sql
--
-- Stakeholders, the PM and coordinators post and reply; only the PM and
-- coordinators change a status; everyone on the project reads. Posting tells
-- the PM and coordinators, a reply or a status change tells the post's author.
-- Every refusal is paired with a case that is allowed, so a refusal never
-- passes for the wrong reason.
--
-- Fixture: the PM, coordinator C, member M, stakeholder S, and O, who is not
-- on the project.

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

-- A refusal that must be the one under test, not some other rule further along.
create or replace function pg_temp.must_refuse_with(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      if position(lower(p_needle) in lower(sqlerrm)) > 0 then
        raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 60);
        return;
      end if;
      raise exception 'FAIL  % — refused for another reason: %', p_label, sqlerrm;
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
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

-- Read as the service role: a notification is only readable by its owner.
create or replace function pg_temp.got(p_user uuid, p_type text, p_project uuid) returns int
language plpgsql as $$
declare
  n int;
  r text := current_setting('role', true);
  c text := current_setting('request.jwt.claims', true);
begin
  perform set_config('role', 'none', true);
  select count(*)::int into n from public.notifications
   where user_id = p_user and type::text = p_type and general_project_id = p_project;
  perform set_config('role', coalesce(r, 'none'), true);
  perform set_config('request.jwt.claims', coalesce(c, ''), true);
  return n;
end;
$$;

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_pm  uuid := gen_random_uuid();
  v_c   uuid := gen_random_uuid();
  v_m   uuid := gen_random_uuid();
  v_s   uuid := gen_random_uuid();
  v_o   uuid := gen_random_uuid();
  v_p   uuid;
  v_p2  uuid;  -- another project, where S is also a stakeholder
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_pm, 'zz-fb-pm@example.test'),
      (v_c,  'zz-fb-c@example.test'),
      (v_m,  'zz-fb-m@example.test'),
      (v_s,  'zz-fb-s@example.test'),
      (v_o,  'zz-fb-o@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_pm, 'zz-fb-pm@example.test', 'Zz', 'Fbpm', 'member', 'active', false, true),
    (v_c,  'zz-fb-c@example.test',  'Zz', 'Fbc',  'member', 'active', false, false),
    (v_m,  'zz-fb-m@example.test',  'Zz', 'Fbm',  'member', 'active', false, false),
    (v_s,  'zz-fb-s@example.test',  'Zz', 'Fbs',  'member', 'active', false, false),
    (v_o,  'zz-fb-o@example.test',  'Zz', 'Fbo',  'member', 'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_pm);
  v_p  := (public.create_general_project('Zz FB project', '')).id;
  v_p2 := (public.create_general_project('Zz FB other', '')).id;

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, role)
  values (v_p, v_c, 'coordinator'), (v_p, v_m, 'member'), (v_p, v_s, 'stakeholder'),
         (v_p2, v_s, 'stakeholder');

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values ('pm', v_pm), ('c', v_c), ('m', v_m), ('s', v_s), ('o', v_o),
                        ('p', v_p), ('p2', v_p2);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------------ posting

do $$
declare
  v_pm uuid := (select v from fx where k = 'pm');
  v_c  uuid := (select v from fx where k = 'c');
  v_m  uuid := (select v from fx where k = 'm');
  v_s  uuid := (select v from fx where k = 's');
  v_p  uuid := (select v from fx where k = 'p');
  v_f  uuid;
  v_f2 uuid;
begin
  perform pg_temp.act_as(v_s);
  v_f := public.create_general_feedback(v_p, 'concern', '  Zz concern  ', '  The budget looks short.  ');
  perform pg_temp.must_be('S posts a concern', v_f is not null);
  perform pg_temp.must_be('...stored trimmed, open, with S as author',
    exists (select 1 from public.general_feedback
             where id = v_f and title = 'Zz concern' and body = 'The budget looks short.'
               and kind = 'concern' and status = 'open' and author_id = v_s and project_id = v_p));
  perform pg_temp.must_be('...which tells the pm once',
    pg_temp.got(v_pm, 'feedback_posted', v_p) = 1);
  perform pg_temp.must_be('...and C once',
    pg_temp.got(v_c, 'feedback_posted', v_p) = 1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...each as "New feedback: Zz concern"',
    (select count(*) from public.notifications
      where type = 'feedback_posted' and general_project_id = v_p
        and user_id in (v_pm, v_c) and title = 'New feedback: Zz concern') = 2);
  perform pg_temp.act_as(v_s);
  perform pg_temp.must_be('...but not S, nor M',
    pg_temp.got(v_s, 'feedback_posted', v_p) = 0 and pg_temp.got(v_m, 'feedback_posted', v_p) = 0);

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_refuse_with('M posts feedback',
    format($q$select public.create_general_feedback(%L, 'input', 'Zz no', 'No')$q$, v_p),
    'Only stakeholders, the project manager and coordinators post feedback.');

  perform pg_temp.act_as(v_pm);
  v_f2 := public.create_general_feedback(v_p, 'approval_request', 'Zz sign off', 'Approve the plan.');
  perform pg_temp.must_be('the pm posts', v_f2 is not null);
  perform pg_temp.must_be('...which tells C',
    pg_temp.got(v_c, 'feedback_posted', v_p) = 2);
  perform pg_temp.must_be('...but not the pm',
    pg_temp.got(v_pm, 'feedback_posted', v_p) = 1);

  perform pg_temp.act_as(v_c);
  perform pg_temp.must_allow('C posts input',
    format($q$select public.create_general_feedback(%L, 'input', 'Zz from C', 'An idea.')$q$, v_p));

  perform pg_temp.act_as(v_s);
  perform pg_temp.must_refuse_with('a title of 121 characters',
    format($q$select public.create_general_feedback(%L, 'input', %L, 'Body')$q$, v_p, repeat('x', 121)),
    'title');
  perform pg_temp.must_allow('...where 120 goes through',
    format($q$select public.create_general_feedback(%L, 'input', %L, 'Body')$q$, v_p, repeat('x', 120)));
  perform pg_temp.must_refuse_with('an empty title',
    format($q$select public.create_general_feedback(%L, 'input', '   ', 'Body')$q$, v_p),
    'title');
  perform pg_temp.must_refuse_with('an empty body',
    format($q$select public.create_general_feedback(%L, 'input', 'Zz empty', '')$q$, v_p),
    'Write');
  perform pg_temp.must_refuse_with('a body of only spaces',
    format($q$select public.create_general_feedback(%L, 'input', 'Zz empty', '   ')$q$, v_p),
    'Write');
  perform pg_temp.must_refuse_with('a body over 4000 characters',
    format($q$select public.create_general_feedback(%L, 'input', 'Zz long', %L)$q$, v_p, repeat('x', 4001)),
    '4000');
  perform pg_temp.must_refuse_with('S inserts a post by hand',
    format($q$insert into public.general_feedback (project_id, author_id, kind, title, body)
              values (%L, %L, 'input', 'Zz hand', 'x')$q$, v_p, v_s),
    'permission denied');

  perform pg_temp.act_as((select v from fx where k = 'o'));
  perform pg_temp.must_refuse_with('O, off the project, posts',
    format($q$select public.create_general_feedback(%L, 'input', 'Zz no', 'No')$q$, v_p),
    'You are not on this project');

  perform pg_temp.act_as_service();
  insert into fx values ('f', v_f), ('f2', v_f2);
end $$;

-- ------------------------------------------------------------------ reading

do $$
declare
  v_p  uuid := (select v from fx where k = 'p');
  v_f2 uuid := (select v from fx where k = 'f2');
begin
  perform pg_temp.act_as((select v from fx where k = 'm'));
  perform pg_temp.must_be('M reads the feedback',
    (select count(*) from public.general_feedback where project_id = v_p) = 4);
  perform pg_temp.act_as((select v from fx where k = 's'));
  perform pg_temp.must_be('S reads the pm''s post',
    exists (select 1 from public.general_feedback where id = v_f2));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ replies

do $$
declare
  v_pm uuid := (select v from fx where k = 'pm');
  v_c  uuid := (select v from fx where k = 'c');
  v_m  uuid := (select v from fx where k = 'm');
  v_s  uuid := (select v from fx where k = 's');
  v_p  uuid := (select v from fx where k = 'p');
  v_f  uuid := (select v from fx where k = 'f');
  v_r  uuid;
begin
  perform pg_temp.act_as(v_c);
  v_r := public.reply_general_feedback(v_f, '  We will look at it.  ');
  perform pg_temp.must_be('C replies to S''s post',
    exists (select 1 from public.general_feedback_replies
             where id = v_r and feedback_id = v_f and project_id = v_p and author_id = v_c
               and body = 'We will look at it.'));
  perform pg_temp.must_be('...which tells S',
    pg_temp.got(v_s, 'feedback_reply', v_p) = 1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...as "Zz Fbc replied to Zz concern"',
    exists (select 1 from public.notifications
             where user_id = v_s and type = 'feedback_reply' and title = 'Zz Fbc replied to Zz concern'));

  perform pg_temp.act_as(v_s);
  perform pg_temp.must_allow('S replies to their own post',
    format($q$select public.reply_general_feedback(%L, 'Thanks.')$q$, v_f));
  perform pg_temp.must_be('...which tells nobody new',
    pg_temp.got(v_s, 'feedback_reply', v_p) = 1);

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_refuse_with('M replies',
    format($q$select public.reply_general_feedback(%L, 'Me too')$q$, v_f),
    'Only stakeholders, the project manager and coordinators post feedback.');
  perform pg_temp.must_be('M reads both replies',
    (select count(*) from public.general_feedback_replies where feedback_id = v_f) = 2);

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('an empty reply',
    format($q$select public.reply_general_feedback(%L, '  ')$q$, v_f),
    'Write');
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ status

do $$
declare
  v_pm uuid := (select v from fx where k = 'pm');
  v_c  uuid := (select v from fx where k = 'c');
  v_s  uuid := (select v from fx where k = 's');
  v_p  uuid := (select v from fx where k = 'p');
  v_f  uuid := (select v from fx where k = 'f');
  v_f2 uuid := (select v from fx where k = 'f2');
begin
  perform pg_temp.act_as(v_c);
  perform pg_temp.must_allow('C acknowledges S''s post',
    format($q$select public.set_general_feedback_status(%L, 'acknowledged')$q$, v_f));
  perform pg_temp.must_be('...which records who and when',
    exists (select 1 from public.general_feedback
             where id = v_f and status = 'acknowledged' and status_changed_by = v_c
               and status_changed_at is not null));
  perform pg_temp.must_be('...and tells S',
    pg_temp.got(v_s, 'feedback_status', v_p) = 1);
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...as "Zz concern is now acknowledged"',
    exists (select 1 from public.notifications
             where user_id = v_s and type = 'feedback_status' and title = 'Zz concern is now acknowledged'));

  perform pg_temp.act_as(v_c);
  perform pg_temp.must_allow('C sets the same status again',
    format($q$select public.set_general_feedback_status(%L, 'acknowledged')$q$, v_f));
  perform pg_temp.must_be('...which changes nothing and tells nobody',
    pg_temp.got(v_s, 'feedback_status', v_p) = 1);

  perform pg_temp.act_as(v_s);
  perform pg_temp.must_refuse_with('S sets a status',
    format($q$select public.set_general_feedback_status(%L, 'resolved')$q$, v_f),
    'Only the project manager and coordinators change a feedback status.');
  perform pg_temp.act_as((select v from fx where k = 'm'));
  perform pg_temp.must_refuse_with('M sets a status',
    format($q$select public.set_general_feedback_status(%L, 'resolved')$q$, v_f),
    'Only the project manager and coordinators change a feedback status.');

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_allow('the pm resolves it',
    format($q$select public.set_general_feedback_status(%L, 'resolved')$q$, v_f));
  perform pg_temp.must_allow('...and opens it again (any status to any status)',
    format($q$select public.set_general_feedback_status(%L, 'open')$q$, v_f));
  perform pg_temp.must_be('S hears of both', pg_temp.got(v_s, 'feedback_status', v_p) = 3);
  perform pg_temp.must_allow('the pm resolves their own post',
    format($q$select public.set_general_feedback_status(%L, 'resolved')$q$, v_f2));
  perform pg_temp.must_be('...and is not told of it', pg_temp.got(v_pm, 'feedback_status', v_p) = 0);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ notification settings

do $$
declare
  v_c uuid := (select v from fx where k = 'c');
  v_p uuid := (select v from fx where k = 'p');
begin
  update public.notification_prefs set project_updates = false where user_id = v_c;
  perform pg_temp.act_as((select v from fx where k = 's'));
  perform public.create_general_feedback(v_p, 'input', 'Zz quiet', 'C turned project updates off.');
  perform pg_temp.must_be('C, with project updates off, is not told',
    pg_temp.got(v_c, 'feedback_posted', v_p) = 3);
  perform pg_temp.act_as_service();
  update public.notification_prefs set project_updates = true where user_id = v_c;
end $$;

-- ------------------------------------------------------------------ files

do $$
declare
  v_pm uuid := (select v from fx where k = 'pm');
  v_m  uuid := (select v from fx where k = 'm');
  v_s  uuid := (select v from fx where k = 's');
  v_p  uuid := (select v from fx where k = 'p');
  v_p2 uuid := (select v from fx where k = 'p2');
  v_f  uuid := (select v from fx where k = 'f');
  v_k  uuid := gen_random_uuid();  -- the client's folder for a new post
  v_ok    text := v_p || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '-plan.pdf';
  v_rep   text := v_p || '/' || v_f || '/' || gen_random_uuid() || '-reply.pdf';
  v_pms   text := v_p || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '-pm.pdf';
  v_other text := v_p2 || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '-other.pdf';
  v_new   uuid;
  v_r     uuid;
begin
  perform pg_temp.act_as(v_s);
  perform pg_temp.must_allow('S uploads to feedback-files',
    format($q$insert into storage.objects (bucket_id, name, owner_id, metadata)
              values ('feedback-files', %L, %L, '{"size": 1234}')$q$, v_ok, v_s));
  perform pg_temp.must_allow('...and under another project they are a stakeholder on',
    format($q$insert into storage.objects (bucket_id, name, owner_id) values ('feedback-files', %L, %L)$q$,
           v_other, v_s));
  perform pg_temp.must_allow('...and for a reply',
    format($q$insert into storage.objects (bucket_id, name, owner_id) values ('feedback-files', %L, %L)$q$,
           v_rep, v_s));
  perform pg_temp.must_refuse_with('S uploads outside a project folder',
    format($q$insert into storage.objects (bucket_id, name, owner_id) values ('feedback-files', %L, %L)$q$,
           v_p || '/loose.pdf', v_s),
    'row-level security');

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_refuse_with('M uploads to feedback-files',
    format($q$insert into storage.objects (bucket_id, name, owner_id) values ('feedback-files', %L, %L)$q$,
           v_p || '/' || v_k || '/' || gen_random_uuid() || '-m.pdf', v_m),
    'row-level security');

  perform pg_temp.act_as(v_pm);
  insert into storage.objects (bucket_id, name, owner_id) values ('feedback-files', v_pms, v_pm);

  perform pg_temp.act_as(v_s);
  perform pg_temp.must_refuse_with('S attaches a file the pm uploaded',
    format($q$select public.create_general_feedback(%L, 'input', 'Zz pm file', 'x',
                array[%L])$q$, v_p, v_pms),
    'A file did not upload');
  perform pg_temp.must_refuse_with('S attaches their file from another project',
    format($q$select public.create_general_feedback(%L, 'input', 'Zz other file', 'x',
                array[%L])$q$, v_p, v_other),
    'A file did not upload');
  perform pg_temp.must_refuse_with('S attaches a file that was never uploaded',
    format($q$select public.create_general_feedback(%L, 'input', 'Zz no file', 'x',
                array[%L])$q$,
           v_p, v_p || '/' || v_k || '/ghost.pdf'),
    'A file did not upload');
  perform pg_temp.must_refuse_with('S attaches one file twice in one post',
    format($q$select public.create_general_feedback(%L, 'input', 'Zz twice', 'x', array[%L, %L])$q$,
           v_p, v_ok, v_ok),
    'That file is attached twice. Remove the copy and try again.');
  perform pg_temp.must_refuse_with('S sends a missing path among the files',
    format($q$select public.create_general_feedback(%L, 'input', 'Zz null', 'x', array[%L, null])$q$,
           v_p, v_ok),
    'A file did not upload');
  perform pg_temp.must_be('...none of which left a post',
    not exists (select 1 from public.general_feedback where title in ('Zz pm file', 'Zz other file', 'Zz no file', 'Zz twice', 'Zz null')));

  v_new := public.create_general_feedback(v_p, 'input', 'Zz with file', 'See the plan.',
             array[v_ok]);
  perform pg_temp.must_be('S posts with their own file, named from its path, sized by Storage',
    exists (select 1 from public.general_feedback_files
             where feedback_id = v_new and reply_id is null and project_id = v_p
               and path = v_ok and name = 'plan.pdf' and size_bytes = 1234));
  perform pg_temp.must_refuse_with('...and cannot attach it twice',
    format($q$select public.create_general_feedback(%L, 'input', 'Zz again', 'x',
                array[%L])$q$, v_p, v_ok),
    'already');

  v_r := public.reply_general_feedback(v_f, 'With a file.',
           array[v_rep]);
  perform pg_temp.must_be('S replies with a file, its row carrying the reply',
    exists (select 1 from public.general_feedback_files
             where feedback_id = v_f and reply_id = v_r and path = v_rep
               and name = 'reply.pdf' and size_bytes = 0));

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_be('M reads the post''s files',
    (select count(*) from public.general_feedback_files where project_id = v_p) = 2);
  perform pg_temp.must_be('...and the stored file',
    exists (select 1 from storage.objects where bucket_id = 'feedback-files' and name = v_ok));
  perform pg_temp.must_be('...but not another project''s',
    not exists (select 1 from storage.objects where bucket_id = 'feedback-files' and name = v_other));

  perform pg_temp.act_as((select v from fx where k = 'o'));
  perform pg_temp.must_be('O reads no stored feedback file',
    not exists (select 1 from storage.objects where bucket_id = 'feedback-files' and name = v_ok));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the bucket is private, 25 MB',
    exists (select 1 from storage.buckets
             where id = 'feedback-files' and not public and file_size_limit = 26214400));
  -- The sweep keeps a recorded feedback file and takes an unrecorded one.
  update storage.objects set created_at = now() - interval '3 days'
   where bucket_id = 'feedback-files' and name in (v_ok, v_pms);
  perform pg_temp.must_be('the sweep keeps an attached feedback file',
    not exists (select 1 from public.storage_orphans(100000) where bucket_id = 'feedback-files' and name = v_ok));
  perform pg_temp.must_be('...and takes one nothing records',
    exists (select 1 from public.storage_orphans(100000) where bucket_id = 'feedback-files' and name = v_pms));
end $$;

-- ------------------------------------------------------------------ outsiders

do $$
declare
  v_p uuid := (select v from fx where k = 'p');
begin
  perform pg_temp.act_as((select v from fx where k = 'o'));
  perform pg_temp.must_be('O selects no feedback',
    (select count(*) from public.general_feedback) = 0
    and (select count(*) from public.general_feedback where project_id = v_p) = 0);
  perform pg_temp.must_be('...no replies, no files',
    (select count(*) from public.general_feedback_replies where project_id = v_p) = 0
    and (select count(*) from public.general_feedback_files where project_id = v_p) = 0);
  perform pg_temp.must_refuse_with('O replies',
    format($q$select public.reply_general_feedback(%L, 'No')$q$, (select v from fx where k = 'f')),
    'You are not on this project');
  perform pg_temp.must_refuse_with('O sets a status',
    format($q$select public.set_general_feedback_status(%L, 'resolved')$q$, (select v from fx where k = 'f')),
    'You are not on this project');
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ a deleted author

-- A post and its replies outlive the author's account; only author_id goes.
do $$
declare
  v_a  uuid := gen_random_uuid();
  v_c  uuid := (select v from fx where k = 'c');
  v_p  uuid := (select v from fx where k = 'p');
  v_f  uuid;
  v_ra uuid;
  v_rc uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  values (v_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'zz-fb-a@example.test', '', now(), now());
  insert into public.profiles (id, email, first_name, last_name, role, status)
  values (v_a, 'zz-fb-a@example.test', 'Zz', 'Fba', 'member', 'active')
  on conflict (id) do update set status = excluded.status;
  insert into public.general_members (project_id, user_id, role) values (v_p, v_a, 'stakeholder');

  perform pg_temp.act_as(v_a);
  v_f := public.create_general_feedback(v_p, 'input', 'Zz orphan', 'Written by A.');
  v_ra := public.reply_general_feedback(v_f, 'A adds a note.');
  perform pg_temp.act_as(v_c);
  v_rc := public.reply_general_feedback(v_f, 'C answers A.');

  -- A leaves first: deleting an account still on a project trips the project
  -- log's leave event (an older, separate issue), and this test is about feedback.
  perform pg_temp.act_as_service();
  delete from public.general_members where project_id = v_p and user_id = v_a;
  delete from auth.users where id = v_a;
  perform pg_temp.must_be('A''s account is gone',
    not exists (select 1 from public.profiles where id = v_a));
  perform pg_temp.must_be('...their post stays, with no author',
    exists (select 1 from public.general_feedback where id = v_f and author_id is null));
  perform pg_temp.must_be('...C''s reply stays as it was',
    exists (select 1 from public.general_feedback_replies where id = v_rc and author_id = v_c));
  perform pg_temp.must_be('...and A''s reply stays, with no author',
    exists (select 1 from public.general_feedback_replies where id = v_ra and author_id is null));

  perform pg_temp.act_as(v_c);
  perform pg_temp.must_allow('C still replies to it',
    format($q$select public.reply_general_feedback(%L, 'Still here.')$q$, v_f));
  perform pg_temp.must_allow('...and changes its status',
    format($q$select public.set_general_feedback_status(%L, 'resolved')$q$, v_f));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ archived

do $$
declare
  v_pm uuid := (select v from fx where k = 'pm');
  v_p  uuid := (select v from fx where k = 'p');
  v_f  uuid := (select v from fx where k = 'f');
begin
  perform pg_temp.act_as(v_pm);
  perform public.archive_general_project(v_p, true);

  perform pg_temp.act_as((select v from fx where k = 's'));
  perform pg_temp.must_refuse_with('S posts on the archived project',
    format($q$select public.create_general_feedback(%L, 'input', 'Zz late', 'Too late.')$q$, v_p),
    'This project is archived. Its feedback is read-only.');
  perform pg_temp.must_refuse_with('...or replies',
    format($q$select public.reply_general_feedback(%L, 'Too late.')$q$, v_f),
    'This project is archived. Its feedback is read-only.');
  perform pg_temp.must_be('...but still reads it',
    exists (select 1 from public.general_feedback where id = v_f));
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('the pm sets a status on the archived project',
    format($q$select public.set_general_feedback_status(%L, 'resolved')$q$, v_f),
    'This project is archived. Its feedback is read-only.');
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ class board

-- A class board's hidden Files project has no Feedback. Its own class, so the
-- test does not depend on live data.
do $$
declare
  v_prof uuid := gen_random_uuid();
  v_a    uuid := gen_random_uuid();
  v_b    uuid := gen_random_uuid();
  v_res uuid; v_class uuid; v_set uuid; v_group uuid; v_proj uuid; v_board uuid;
  gp uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@test.invalid', '', now(), now()
    from (values (v_prof), (v_a), (v_b)) as u(id);
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach)
  values (v_prof, v_prof::text || '@test.invalid', 'Zz', 'Fbprof', 'member',  'active', true),
         (v_a,    v_a::text    || '@test.invalid', 'Zz', 'Fbana',  'student', 'active', false),
         (v_b,    v_b::text    || '@test.invalid', 'Zz', 'Fbben',  'student', 'active', false)
  on conflict (id) do update set role = excluded.role, status = excluded.status, can_teach = excluded.can_teach;

  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (v_prof, 'syllabus', 'Zz FB syllabus', 'x/fb.pdf', 'fb.pdf')
  returning id into v_res;
  insert into public.syllabus_weeks (resource_id, week_no, title)
  select v_res, n, 'Week ' || n from generate_series(1, 4) as n;
  insert into public.classes (professor_id, name, initial, code, section, year_level,
                              semester, school_year, syllabus_id, term_start, term_end)
  values (v_prof, 'Zz FB class', 'ZZFB', 'ZZ-FB-' || left(v_prof::text, 8), 'BSIT 9Z', '3rd', '1st',
          '2026-2027', v_res, current_date - 7, current_date + 60)
  returning id into v_class;
  insert into public.class_members (class_id, student_id, status)
  values (v_class, v_a, 'active'), (v_class, v_b, 'active');

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-feedback', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Zz FB group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id) values (v_group, v_set, v_a), (v_group, v_set, v_b);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'Zz FB lab', 'activity', 1, 1, 'group', v_set, now() + interval '7 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_group;

  perform pg_temp.act_as(v_a);
  gp := public.ensure_class_board_repo(v_board);
  perform pg_temp.must_refuse_with('a class-board member posts feedback',
    format($q$select public.create_general_feedback(%L, 'input', 'Zz board', 'x')$q$, gp),
    'Feedback is only on work projects.');
  perform pg_temp.act_as_service();
end $$;

rollback;
