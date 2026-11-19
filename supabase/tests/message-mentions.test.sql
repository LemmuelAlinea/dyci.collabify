-- supabase/tests/message-mentions.test.sql
-- Mentions in the Inbox: what # can find for the writer, and the counts behind
-- the "they'll see a locked chip" note. Rolls back; nothing survives.
--
-- The file under test must already be applied:
--   node scripts/db.mjs supabase/tests/message-mentions.test.sql
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

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

/** The conversation for a project or class, made if the app did not make one. */
create or replace function pg_temp.chat(p_kind text, p_project uuid, p_class uuid, p_people uuid[]) returns uuid
language plpgsql as $$
declare c uuid;
begin
  if p_kind = 'project' then
    select id into c from public.conversations where kind = 'project' and general_project_id = p_project;
    if c is null then
      insert into public.conversations (kind, general_project_id) values ('project', p_project) returning id into c;
    end if;
  elsif p_kind = 'class' then
    select id into c from public.conversations where kind = 'class' and class_id = p_class;
    if c is null then
      insert into public.conversations (kind, class_id) values ('class', p_class) returning id into c;
    end if;
  else
    insert into public.conversations (kind, direct_key)
    values ('direct', least(p_people[1]::text, p_people[2]::text) || '|' || greatest(p_people[1]::text, p_people[2]::text))
    returning id into c;
  end if;
  insert into public.conversation_members (conversation_id, user_id)
  select c, u from unnest(p_people) u
  on conflict do nothing;
  return c;
end;
$$;

do $$
declare
  v_p  uuid := gen_random_uuid();  -- project manager of J and J2
  v_m  uuid := gen_random_uuid();  -- member of J and J2
  v_c  uuid := gen_random_uuid();  -- coordinator of J
  v_t  uuid := gen_random_uuid();  -- teaches K
  v_s1 uuid := gen_random_uuid();  -- student in K
  v_s2 uuid := gen_random_uuid();  -- student in K
  v_x  uuid := gen_random_uuid();  -- in nothing
  j uuid; j2 uuid; v uuid; k uuid; kp uuid; b1 uuid; b2 uuid;
  t_login uuid; t_secret uuid; t_old uuid; t_other uuid; origin uuid := gen_random_uuid(); ct_solo uuid;
  chat_j uuid; chat_dm uuid; chat_k uuid;
  n int; r record; refused boolean; res uuid;
begin
  perform pg_temp.act_as_service();

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@test.invalid', '', now(), now()
    from (values (v_p), (v_m), (v_c), (v_t), (v_s1), (v_s2), (v_x)) as u(id);
  insert into public.profiles (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values (v_p,  v_p::text  || '@test.invalid', 'Zz', 'Mention pm',      'member',  'active', false, true),
         (v_m,  v_m::text  || '@test.invalid', 'Zz', 'Mention member',  'member',  'active', false, false),
         (v_c,  v_c::text  || '@test.invalid', 'Zz', 'Mention coord',   'member',  'active', false, false),
         (v_t,  v_t::text  || '@test.invalid', 'Zz', 'Mention teacher', 'member',  'active', true,  false),
         (v_s1, v_s1::text || '@test.invalid', 'Zz', 'Mention s1',      'student', 'active', false, false),
         (v_s2, v_s2::text || '@test.invalid', 'Zz', 'Mention s2',      'student', 'active', false, false),
         (v_x,  v_x::text  || '@test.invalid', 'Zz', 'Mention x',       'member',  'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_teach = excluded.can_teach, can_manage_projects = excluded.can_manage_projects;

  ------------------------------------------------------------ work: J, J2, and V (viewable only)
  perform pg_temp.act_as(v_p);
  j  := (public.create_general_project('Zz Mention J', '')).id;
  j2 := (public.create_general_project('Zz Mention J2', '', null, null, null, null,
          (select space_id from public.general_projects where id = j))).id;
  v  := (public.create_general_project('Zz Mention V', '', null, null, null, null,
          (select space_id from public.general_projects where id = j))).id;
  perform pg_temp.act_as_service();
  update public.general_projects set visibility = 'workspace' where id = v;
  insert into public.general_members (project_id, user_id, role) values
    (j, v_m, 'member'), (j, v_c, 'coordinator'), (j2, v_m, 'member');

  insert into public.general_tasks (project_id, title, routing_state, created_by)
    values (j, 'Zz Login page', 'released', v_p) returning id into t_login;
  insert into public.general_tasks (project_id, title, routing_state, created_by)
    values (j, 'Zz Secret plan', 'planning', v_p) returning id into t_secret;
  insert into public.general_tasks (project_id, title, routing_state, created_by)
    values (j, 'Zz Old login', 'released', v_p) returning id into t_old;
  update public.general_tasks set archived_at = now() where id = t_old;
  insert into public.general_tasks (project_id, title, routing_state, created_by)
    values (v, 'Zz Viewable task', 'released', v_p);
  insert into public.general_tasks (project_id, title, routing_state, created_by)
    values (j2, 'Zz Other task', 'released', v_p) returning id into t_other;
  insert into public.general_tasks (project_id, title, routing_state, created_by)
  select j2, 'Zz bulk ' || g, 'released', v_p from generate_series(1, 10) g;
  -- J2's tasks are the newest, so only the place ranking can put J first.
  update public.general_tasks set updated_at = now() - interval '1 day' where project_id = j;

  ------------------------------------------------------------ class: K, project KP, two boards
  insert into public.teaching_resources (professor_id, kind, title, file_path, file_name)
  values (v_t, 'syllabus', 'Zz Mention syllabus', 'x/m.pdf', 'm.pdf') returning id into res;
  insert into public.syllabus_weeks (resource_id, week_no, title)
  select res, g, 'Week ' || g from generate_series(1, 4) as g;
  insert into public.classes (professor_id, name, initial, code, section, year_level, semester,
                              school_year, syllabus_id, term_start, term_end)
  values (v_t, 'Zz Mention K', 'ZZMK', 'ZZ-MEN-' || left(v_t::text, 8), 'BSIT 9M', '3rd', '1st', '2099-2100',
          res, date '2026-07-20', date '2026-08-16')
  returning id into k;
  insert into public.class_members (class_id, student_id, status) values (k, v_s1, 'active'), (k, v_s2, 'active');
  insert into public.projects (class_id, created_by, title, type, audience, start_week, end_week)
  values (k, v_t, 'Zz Mention KP', 'activity', 'individual', 1, 2) returning id into kp;
  select id into b1 from public.project_boards where project_id = kp and student_id = v_s1;
  if b1 is null then
    insert into public.project_boards (project_id, student_id) values (kp, v_s1) returning id into b1;
  end if;
  select id into b2 from public.project_boards where project_id = kp and student_id = v_s2;
  if b2 is null then
    insert into public.project_boards (project_id, student_id) values (kp, v_s2) returning id into b2;
  end if;
  insert into public.project_tasks (board_id, origin_id, title, created_by, author_role, weight) values
    (b1, origin, 'Zz Set essay', v_t, 'professor', 1),
    (b2, origin, 'Zz Set essay', v_t, 'professor', 1);
  insert into public.project_tasks (board_id, title, created_by, author_role, weight)
    values (b1, 'Zz Solo outline', v_s1, 'student', 1) returning id into ct_solo;

  ------------------------------------------------------------ chats
  chat_j  := pg_temp.chat('project', j, null, array[v_p, v_m, v_c]);
  chat_dm := pg_temp.chat('direct', null, null, array[v_m, v_s1]);
  chat_k  := pg_temp.chat('class', null, k, array[v_t, v_s1, v_s2]);

  ------------------------------------------------------------ search
  perform pg_temp.act_as(v_m);
  perform pg_temp.must_be('search: finds a released work task by part of its title',
    exists (select 1 from public.search_mentionables('login', chat_j) s where s.kind = 't' and s.id = t_login));
  perform pg_temp.must_be('search: a private planning task is offered only to planners (not a member)',
    not exists (select 1 from public.search_mentionables('secret', chat_j) s where s.id = t_secret));
  perform pg_temp.must_be('search: a project you only view is not offered',
    not exists (select 1 from public.search_mentionables('', chat_j) s where s.project_id = v)
    and not exists (select 1 from public.search_mentionables('viewable', chat_j)));
  perform pg_temp.must_be('search: archived tasks are left out',
    not exists (select 1 from public.search_mentionables('old login', chat_j)));
  select * into r from public.search_mentionables('', chat_j) limit 1;
  perform pg_temp.must_be('search: the chat''s own project ranks first', r.project_id = j);
  select count(*) into n from public.search_mentionables('bulk', chat_j);
  perform pg_temp.must_be('search: at most 8 rows', n = 8);
  perform pg_temp.must_be('search: finds a work project',
    exists (select 1 from public.search_mentionables('mention j2', chat_j) s where s.kind = 'p' and s.id = j2));

  perform pg_temp.act_as(v_c);
  perform pg_temp.must_be('search: a private planning task is offered only to planners (coordinator)',
    exists (select 1 from public.search_mentionables('secret', chat_j) s where s.id = t_secret));

  perform pg_temp.act_as(v_t);
  select count(*) into n from public.search_mentionables('set essay', chat_k) s where s.kind = 'co' and s.id = origin;
  perform pg_temp.must_be('search: a set task comes back once, as co (teacher)', n = 1);
  perform pg_temp.must_be('search: finds a class project',
    exists (select 1 from public.search_mentionables('mention kp', chat_k) s where s.kind = 'cp' and s.id = kp));
  perform pg_temp.act_as(v_s1);
  select count(*) into n from public.search_mentionables('set essay', chat_k) s where s.kind = 'co' and s.id = origin;
  perform pg_temp.must_be('search: a set task comes back once, as co (student)', n = 1);
  perform pg_temp.must_be('search: a group-only task comes back as ct',
    exists (select 1 from public.search_mentionables('solo', chat_k) s where s.kind = 'ct' and s.id = ct_solo));

  perform pg_temp.act_as(v_x);
  select count(*) into n from public.search_mentionables('', chat_j);
  perform pg_temp.must_be('search: nothing for a non-member of the conversation', n = 0);

  ------------------------------------------------------------ blind spots
  perform pg_temp.act_as(v_m);
  select * into r from public.mention_blind_spots(chat_dm, jsonb_build_array(jsonb_build_object('kind', 't', 'id', t_login)));
  perform pg_temp.must_be('blind spots: counts work members outside the project',
    r.members_without = 1 and not r.private_task and r.project_title = 'Zz Mention J');

  perform pg_temp.act_as(v_c);
  select * into r from public.mention_blind_spots(chat_j, jsonb_build_array(jsonb_build_object('kind', 't', 'id', t_secret)));
  perform pg_temp.must_be('blind spots: flags a planning task', r.private_task and r.members_without = 0);

  perform pg_temp.act_as(v_t);
  select * into r from public.mention_blind_spots(chat_k, jsonb_build_array(jsonb_build_object('kind', 'ct', 'id', ct_solo)));
  perform pg_temp.must_be('blind spots: ct counts other groups', r.members_without = 1);
  select * into r from public.mention_blind_spots(chat_k, jsonb_build_array(
    jsonb_build_object('kind', 'co', 'id', origin), jsonb_build_object('kind', 'cp', 'id', kp)))
   where kind = 'co';
  perform pg_temp.must_be('blind spots: co counts nobody in the class', r.members_without = 0);

  perform pg_temp.act_as(v_s2);
  refused := false;
  begin
    perform * from public.mention_blind_spots(chat_k, jsonb_build_array(jsonb_build_object('kind', 'ct', 'id', ct_solo)));
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.must_be('blind spots: counts only, refuses a ref the caller can''t reach', refused);

  perform pg_temp.act_as(v_m);
  refused := false;
  begin
    perform * from public.mention_blind_spots(chat_j, jsonb_build_array(jsonb_build_object('kind', 't', 'id', t_secret)));
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.must_be('blind spots: refuses a planning task the caller can''t read', refused);

  perform pg_temp.act_as(v_x);
  refused := false;
  begin
    perform * from public.mention_blind_spots(chat_j, jsonb_build_array(jsonb_build_object('kind', 'p', 'id', j)));
  exception when insufficient_privilege then refused := true;
  end;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('blind spots: refuses a non-member of the conversation', refused);
end;
$$;

rollback;
