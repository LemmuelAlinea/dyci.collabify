-- Every notification notification-coverage.sql adds: it arrives, reaches the
-- right people, and the switches that should silence it do. Rolls back.
--
--   node scripts/db.mjs supabase/tests/notification-coverage.test.sql
--
-- Actions run as the person who would take them; every check reads as the
-- service role (`pg_temp.svc()`), past row security.

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

create or replace function pg_temp.got(p_user uuid, p_type text) returns int
language sql as $$
  select count(*)::int from public.notifications where user_id = p_user and type::text = p_type;
$$;

do $$
declare
  owner_id uuid := gen_random_uuid();
  mate_id  uuid := gen_random_uuid();
  space    public.general_spaces%rowtype;
  proj     public.general_projects%rowtype;
  inv      uuid;
  chg      uuid;
  v_class uuid; v_prof uuid; v_stu uuid; v_proj uuid; v_board uuid; v_repo uuid;
  n int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Cover', 'last_name', v.ln, 'role', 'professor'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'cover-owner@test.local', 'Owner'),
                 (mate_id,  'cover-mate@test.local',  'Mate')) as v(id, em, ln);
  update public.profiles set status = 'active' where id in (owner_id, mate_id);

  ------------------------------------------------------------------ space invitations
  perform pg_temp.act_as(owner_id);
  space := public.create_general_space('Cover space', '');
  select (public.invite_to_general_space(space.id, mate_id)).id into inv;
  perform pg_temp.svc();
  perform pg_temp.ok('a space invitation reaches the invitee',
    exists (select 1 from public.notifications where user_id = mate_id and type = 'space_invited'
             and general_space_id = space.id and preview = 'Cover Owner invited you to join this space'));

  perform pg_temp.act_as(mate_id);
  perform public.respond_general_space_invitation(inv, true);
  perform pg_temp.svc();
  perform pg_temp.ok('accepting tells whoever invited',
    exists (select 1 from public.notifications where user_id = owner_id and type = 'invite_accepted'
             and general_space_id = space.id));

  ------------------------------------------------------------------ space membership
  perform pg_temp.act_as(owner_id);
  perform public.set_general_space_level(space.id, mate_id, 'manager');
  perform pg_temp.svc();
  perform pg_temp.ok('a level change reaches the member',
    exists (select 1 from public.notifications where user_id = mate_id and type = 'membership_changed'
             and preview = 'You are now Manager' and general_space_id = space.id));

  update public.notification_prefs set project_updates = false where user_id = mate_id;
  perform pg_temp.act_as(owner_id);
  perform public.set_general_space_level(space.id, mate_id, 'member');
  perform pg_temp.svc();
  perform pg_temp.ok('project_updates off silences a level change',
    pg_temp.got(mate_id, 'membership_changed') = 1);
  update public.notification_prefs set project_updates = true where user_id = mate_id;

  ------------------------------------------------------------------ project invitations
  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Cover project', '', null, null, null, null, space.id);
  select (public.invite_to_general_project(proj.id, mate_id)).id into inv;
  perform pg_temp.svc();
  update public.notification_prefs set project_invites = false where user_id = owner_id;
  perform pg_temp.act_as(mate_id);
  perform public.respond_general_invitation(inv, true);
  perform pg_temp.svc();
  perform pg_temp.ok('project_invites off silences an accepted invitation',
    pg_temp.got(owner_id, 'invite_accepted') = 1);
  update public.notification_prefs set project_invites = true where user_id = owner_id;

  ------------------------------------------------------------------ reviews
  perform pg_temp.act_as(owner_id);
  select (public.create_general_repo(proj.id, 'main', '')).id into v_repo;
  perform pg_temp.act_as(mate_id);
  insert into public.general_repo_changes (repo_id, project_id, author_id, title, base_seq)
  values (v_repo, proj.id, mate_id, 'Fix the intro', 0);
  perform pg_temp.svc();
  perform pg_temp.ok('a change asking for review reaches the Owner',
    pg_temp.got(owner_id, 'review_requested') = 1);
  perform pg_temp.ok('...and never its own author', pg_temp.got(mate_id, 'review_requested') = 0);

  update public.notification_prefs set submissions = false where user_id = owner_id;
  perform pg_temp.act_as(mate_id);
  insert into public.general_repo_changes (repo_id, project_id, author_id, title, base_seq)
  values (v_repo, proj.id, mate_id, 'Second change', 0)
  returning id into chg;
  perform pg_temp.svc();
  perform pg_temp.ok('submissions off silences a review request',
    pg_temp.got(owner_id, 'review_requested') = 1);
  update public.notification_prefs set submissions = true where user_id = owner_id;

  perform pg_temp.act_as(owner_id);
  perform public.answer_general_repo_change(chg, false, 'Not yet');
  perform pg_temp.svc();
  perform pg_temp.ok('the author hears the answer, with the note',
    exists (select 1 from public.notifications where user_id = mate_id and type = 'review_answered'
             and preview = 'Declined by Cover Owner: Not yet'));

  ------------------------------------------------------------------ project archive and removal
  perform pg_temp.act_as(owner_id);
  perform public.archive_general_project(proj.id, true);
  perform pg_temp.svc();
  perform pg_temp.ok('archiving tells the other members',
    exists (select 1 from public.notifications where user_id = mate_id and type = 'project_updated'
             and general_project_id = proj.id and preview = 'Cover Owner archived this project'));
  perform pg_temp.ok('...not the one who archived it', pg_temp.got(owner_id, 'project_updated') = 0);

  perform pg_temp.act_as(owner_id);
  perform public.archive_general_project(proj.id, false);
  perform pg_temp.svc();
  perform pg_temp.ok('restoring tells them too', pg_temp.got(mate_id, 'project_updated') = 2);

  perform pg_temp.act_as(owner_id);
  perform public.remove_general_member(proj.id, mate_id);
  perform pg_temp.svc();
  perform pg_temp.ok('removal tells the person removed, with no link',
    exists (select 1 from public.notifications where user_id = mate_id and type = 'membership_changed'
             and title = 'Cover project' and general_project_id is null
             and preview = 'Cover Owner removed you'));

  perform pg_temp.act_as(owner_id);
  perform public.remove_general_space_member(space.id, mate_id);
  perform pg_temp.svc();
  perform pg_temp.ok('removal from a space tells them too',
    exists (select 1 from public.notifications where user_id = mate_id and type = 'membership_changed'
             and title = 'Cover space' and general_space_id is null));
  perform pg_temp.ok('nobody is told about their own changes',
    pg_temp.got(owner_id, 'membership_changed') = 0);

  ------------------------------------------------------------------ deleting says nothing
  -- Mate back in the space and on the project, then the whole space goes.
  insert into public.general_space_members (space_id, user_id, level) values (space.id, mate_id, 'member');
  insert into public.general_members (project_id, user_id, level) values (proj.id, mate_id, 'member');
  select count(*) into n from public.notifications
   where user_id = mate_id and type = 'membership_changed' and preview like '%removed you';
  perform pg_temp.act_as(owner_id);
  perform public.delete_general_space(space.id);
  perform pg_temp.svc();
  perform pg_temp.ok('deleting a space outright sends no removal notices',
    (select count(*) from public.notifications
      where user_id = mate_id and type = 'membership_changed' and preview like '%removed you') = n);

  ------------------------------------------------------------------ class hand-ins and changes
  select c.id, c.professor_id into v_class, v_prof from public.classes c
   where exists (select 1 from public.class_members m where m.class_id = c.id and m.status = 'active')
   order by c.created_at limit 1;
  select student_id into v_stu from public.class_members
   where class_id = v_class and status = 'active' order by student_id limit 1;

  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'Cover class project', 'activity', 1, 1, 'individual', now() + interval '10 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and student_id = v_stu;

  perform pg_temp.act_as(v_stu);
  perform public.set_board_submitted(v_board, true);
  perform pg_temp.svc();
  perform pg_temp.ok('handing in reaches the professor',
    exists (select 1 from public.notifications where user_id = v_prof and type = 'board_submitted'
             and project_id = v_proj));
  perform pg_temp.ok('...not the student who handed in', pg_temp.got(v_stu, 'board_submitted') = 0);

  update public.notification_prefs set submissions = false where user_id = v_prof;
  perform pg_temp.act_as(v_stu);
  perform public.set_board_submitted(v_board, false);
  perform public.set_board_submitted(v_board, true);
  perform pg_temp.svc();
  perform pg_temp.ok('submissions off silences a hand-in',
    (select count(*) from public.notifications where user_id = v_prof and type = 'board_submitted'
      and project_id = v_proj) = 1);
  update public.notification_prefs set submissions = true where user_id = v_prof;

  update public.projects set due_at = due_at + interval '2 days' where id = v_proj;
  perform pg_temp.ok('a moved due date reaches the class',
    exists (select 1 from public.notifications where user_id = v_stu and type = 'project_updated'
             and project_id = v_proj and preview like 'Now due %'));

  update public.notification_prefs set project_updates = false where user_id = v_stu;
  update public.projects set due_at = due_at + interval '1 day' where id = v_proj;
  perform pg_temp.ok('project_updates off silences it',
    (select count(*) from public.notifications where user_id = v_stu and type = 'project_updated'
      and project_id = v_proj) = 1);
  update public.notification_prefs set project_updates = true where user_id = v_stu;

  update public.projects set title = 'Cover class project, renamed' where id = v_proj;
  perform pg_temp.ok('an edit that is neither a date nor a closing says nothing',
    (select count(*) from public.notifications where user_id = v_stu and type = 'project_updated'
      and project_id = v_proj) = 1);

  update public.projects set archived_at = now() where id = v_proj;
  perform pg_temp.ok('closing a project tells the class',
    exists (select 1 from public.notifications where user_id = v_stu and type = 'project_updated'
             and project_id = v_proj and preview = 'This project was closed'));
end;
$$;

rollback;
