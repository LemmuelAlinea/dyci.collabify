-- Company roles, phase 4: QA — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/project-qa.test.sql
--
-- A work project marks one middle stage as its QA stage (by name, with a
-- "Testing" or next-to-last fallback). Tasks get a kind, task or bug. QA
-- creates bug tasks only, never changes a kind and holds no tasks. The pm sets
-- and invites the qa role, a coordinator switches people among member, qa and
-- stakeholder; becoming QA lets go of every task held in the project. Every
-- refusal is paired with a case that is allowed. A class-board Files project
-- is unaffected.
--
-- The first QA fixture is a service-role update of general_members.role.

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

-- ------------------------------------------------------------------ fixture

do $$
declare
  v_pm  uuid := gen_random_uuid();  -- member account, Project manager on
  v_c   uuid := gen_random_uuid();  -- coordinator
  v_c2  uuid := gen_random_uuid();  -- coordinator
  v_m   uuid := gen_random_uuid();  -- member
  v_m2  uuid := gen_random_uuid();  -- member, holds tasks, then qa
  v_q   uuid := gen_random_uuid();  -- qa
  v_x   uuid := gen_random_uuid();  -- invited as qa by the pm
  v_y   uuid := gen_random_uuid();  -- invited as qa by a coordinator
  v_out uuid := gen_random_uuid();  -- not on the project
  v_p   uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_pm,  'zz-qa-pm@example.test'),
      (v_c,   'zz-qa-c@example.test'),
      (v_c2,  'zz-qa-c2@example.test'),
      (v_m,   'zz-qa-m@example.test'),
      (v_m2,  'zz-qa-m2@example.test'),
      (v_q,   'zz-qa-q@example.test'),
      (v_x,   'zz-qa-x@example.test'),
      (v_y,   'zz-qa-y@example.test'),
      (v_out, 'zz-qa-out@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_pm,  'zz-qa-pm@example.test',  'Zz', 'Qapm',  'member', 'active', false, true),
    (v_c,   'zz-qa-c@example.test',   'Zz', 'Qac',   'member', 'active', false, false),
    (v_c2,  'zz-qa-c2@example.test',  'Zz', 'Qac2',  'member', 'active', false, false),
    (v_m,   'zz-qa-m@example.test',   'Zz', 'Qam',   'member', 'active', false, false),
    (v_m2,  'zz-qa-m2@example.test',  'Zz', 'Qam2',  'member', 'active', false, false),
    (v_q,   'zz-qa-q@example.test',   'Zz', 'Qaq',   'member', 'active', false, false),
    (v_x,   'zz-qa-x@example.test',   'Zz', 'Qax',   'member', 'active', false, false),
    (v_y,   'zz-qa-y@example.test',   'Zz', 'Qay',   'member', 'active', false, false),
    (v_out, 'zz-qa-out@example.test', 'Zz', 'Qaout', 'member', 'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status,
        can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_pm);
  v_p := (public.create_general_project('Zz QA project', '')).id;

  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, role)
  values (v_p, v_c, 'coordinator'), (v_p, v_c2, 'coordinator'),
         (v_p, v_m, 'member'), (v_p, v_m2, 'member'), (v_p, v_q, 'qa');

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert on fx to authenticated;
  insert into fx values ('pm', v_pm), ('c', v_c), ('c2', v_c2), ('m', v_m), ('m2', v_m2),
                        ('q', v_q), ('x', v_x), ('y', v_y), ('out', v_out), ('p', v_p);
end $$;

-- ------------------------------------------------------------------ the QA stage

do $$
declare
  v_p   uuid := (select v from fx where k = 'p');
  v_pm  uuid := (select v from fx where k = 'pm');
  v_m   uuid := (select v from fx where k = 'm');
  v_out uuid := (select v from fx where k = 'out');
  v_p2  uuid;
begin
  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_be('the default stages put QA on In progress (1)',
    public.general_qa_stage_index(v_p) = 1);

  update public.general_projects set stages = array['Planning', 'In progress', 'Testing', 'Done']
   where id = v_p;
  perform pg_temp.must_be('a stage named Testing is the QA stage (2)',
    public.general_qa_stage_index(v_p) = 2);

  perform pg_temp.must_refuse_with('the pm cannot make the last stage the QA stage',
    format($q$update public.general_projects set qa_stage = 'Done' where id = %L$q$, v_p),
    'The QA stage must be one of the middle stages.');
  perform pg_temp.must_refuse_with('...nor the first',
    format($q$update public.general_projects set qa_stage = 'Planning' where id = %L$q$, v_p),
    'The QA stage must be one of the middle stages.');
  perform pg_temp.must_refuse_with('...nor a name that is not a stage',
    format($q$update public.general_projects set qa_stage = 'Review' where id = %L$q$, v_p),
    'The QA stage must be one of the middle stages.');

  update public.general_projects set stages = array['A', 'B', 'C', 'D'] where id = v_p;
  perform pg_temp.must_be('without Testing, the stage before the last (2)',
    public.general_qa_stage_index(v_p) = 2);

  perform pg_temp.must_allow('the pm makes B the QA stage',
    format($q$update public.general_projects set qa_stage = 'B' where id = %L$q$, v_p));
  perform pg_temp.must_be('...and the QA stage is B (1)', public.general_qa_stage_index(v_p) = 1);
  perform pg_temp.must_allow('a case-insensitive match is a match',
    format($q$update public.general_projects set qa_stage = 'b' where id = %L$q$, v_p));
  perform pg_temp.must_be('...still B (1)', public.general_qa_stage_index(v_p) = 1);

  update public.general_projects set stages = array['A', 'C', 'B', 'D'] where id = v_p;
  perform pg_temp.must_be('reordering keeps the QA stage',
    (select qa_stage = 'b' from public.general_projects where id = v_p)
    and public.general_qa_stage_index(v_p) = 2);

  perform pg_temp.must_allow('removing the QA stage from the list goes through',
    format($q$update public.general_projects set stages = array['A', 'C', 'D'] where id = %L$q$, v_p));
  perform pg_temp.must_be('...and the QA stage falls back to null',
    (select qa_stage is null from public.general_projects where id = v_p)
    and public.general_qa_stage_index(v_p) = 1);

  update public.general_projects set stages = array['Planning', 'In progress', 'Testing', 'Done']
   where id = v_p;

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_be('a member reads the QA stage', public.general_qa_stage_index(v_p) = 2);
  perform pg_temp.act_as(v_out);
  perform pg_temp.must_be('somebody off the project does not',
    public.general_qa_stage_index(v_p) is null);

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_be('the project has QA', public.general_project_has_qa(v_p));
  v_p2 := (public.create_general_project('Zz QA other project', '')).id;
  perform pg_temp.must_be('a project without QA has none', not public.general_project_has_qa(v_p2));
  perform pg_temp.act_as_service();
  insert into fx values ('p2', v_p2);
end $$;

-- ------------------------------------------------------------------ kinds

do $$
declare
  v_p   uuid := (select v from fx where k = 'p');
  v_pm  uuid := (select v from fx where k = 'pm');
  v_c   uuid := (select v from fx where k = 'c');
  v_m   uuid := (select v from fx where k = 'm');
  v_q   uuid := (select v from fx where k = 'q');
  v_tm  uuid;
  v_tq  uuid;
begin
  perform pg_temp.act_as(v_q);
  perform pg_temp.must_refuse_with('QA cannot create a task',
    format($q$insert into public.general_tasks (project_id, title, kind)
              values (%L, 'Zz QA task', 'task')$q$, v_p),
    'QA creates bug tasks only.');
  perform pg_temp.must_refuse_with('...nor one with the default kind',
    format($q$insert into public.general_tasks (project_id, title) values (%L, 'Zz QA plain')$q$, v_p),
    'QA creates bug tasks only.');
  perform pg_temp.must_allow('QA creates a bug',
    format($q$insert into public.general_tasks (project_id, title, kind)
              values (%L, 'Zz QA bug', 'bug')$q$, v_p));
  v_tq := (select id from public.general_tasks where project_id = v_p and title = 'Zz QA bug');
  perform pg_temp.must_refuse_with('QA cannot change the kind of their own bug',
    format($q$update public.general_tasks set kind = 'task' where id = %L$q$, v_tq),
    'changes a task''s kind');
  perform pg_temp.must_allow('...but edits its title',
    format($q$update public.general_tasks set title = 'Zz QA bug, renamed' where id = %L$q$, v_tq));

  perform pg_temp.act_as(v_m);
  perform pg_temp.must_allow('a member creates a bug',
    format($q$insert into public.general_tasks (project_id, title, kind)
              values (%L, 'Zz M bug', 'bug')$q$, v_p));
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz M task') returning id into v_tm;
  perform pg_temp.must_be('a task is a task by default',
    (select kind = 'task' from public.general_tasks where id = v_tm));
  perform pg_temp.must_refuse_with('a member cannot change a task''s kind',
    format($q$update public.general_tasks set kind = 'bug' where id = %L$q$, v_tm),
    'changes a task''s kind');
  perform pg_temp.must_allow('...but edits its title',
    format($q$update public.general_tasks set title = 'Zz M task, renamed' where id = %L$q$, v_tm));

  perform pg_temp.act_as(v_c);
  perform pg_temp.must_allow('a coordinator changes the kind',
    format($q$update public.general_tasks set kind = 'bug' where id = %L$q$, v_tm));
  perform pg_temp.must_be('...which is now a bug',
    (select kind = 'bug' from public.general_tasks where id = v_tm));

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_be('the task overview shows kind and qa_entered_at',
    (select kind = 'bug' and qa_entered_at is null
       from public.general_task_overview where id = v_tm));
  perform pg_temp.act_as_service();
  insert into fx values ('tm', v_tm);
end $$;

-- ------------------------------------------------------------------ holders

do $$
declare
  v_p   uuid := (select v from fx where k = 'p');
  v_pm  uuid := (select v from fx where k = 'pm');
  v_c   uuid := (select v from fx where k = 'c');
  v_m   uuid := (select v from fx where k = 'm');
  v_q   uuid := (select v from fx where k = 'q');
  v_t   uuid;
  v_t2  uuid;
begin
  perform pg_temp.act_as(v_pm);
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz to hold') returning id into v_t;
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz to hold 2') returning id into v_t2;

  perform pg_temp.act_as(v_q);
  perform pg_temp.must_refuse_with('QA cannot claim a task',
    format($q$insert into public.general_task_assignees (task_id, project_id, user_id)
              values (%L, %L, %L)$q$, v_t, v_p, v_q),
    'QA can''t hold tasks. Pick someone else.');

  perform pg_temp.act_as(v_pm);
  perform pg_temp.must_refuse_with('the pm cannot hand QA a task',
    format($q$insert into public.general_task_assignees (task_id, project_id, user_id)
              values (%L, %L, %L)$q$, v_t, v_p, v_q),
    'QA can''t hold tasks. Pick someone else.');
  perform pg_temp.must_allow('...but hands member M the task',
    format($q$insert into public.general_task_assignees (task_id, project_id, user_id)
              values (%L, %L, %L)$q$, v_t, v_p, v_m));

  perform pg_temp.act_as(v_c);
  perform pg_temp.must_refuse_with('a coordinator cannot hand QA a task either',
    format($q$insert into public.general_task_assignees (task_id, project_id, user_id)
              values (%L, %L, %L)$q$, v_t2, v_p, v_q),
    'QA can''t hold tasks. Pick someone else.');
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ the role, on

do $$
declare
  v_p   uuid := (select v from fx where k = 'p');
  v_p2  uuid := (select v from fx where k = 'p2');
  v_pm  uuid := (select v from fx where k = 'pm');
  v_c   uuid := (select v from fx where k = 'c');
  v_c2  uuid := (select v from fx where k = 'c2');
  v_m   uuid := (select v from fx where k = 'm');
  v_m2  uuid := (select v from fx where k = 'm2');
  v_ta  uuid;
  v_tb  uuid;
  v_tc  uuid;
begin
  -- M2 holds two tasks here (one archived) and one in another project.
  perform pg_temp.act_as_service();
  insert into public.general_members (project_id, user_id, role) values (v_p2, v_m2, 'member');
  perform pg_temp.act_as(v_pm);
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz M2 holds') returning id into v_ta;
  insert into public.general_tasks (project_id, title) values (v_p, 'Zz M2 archived') returning id into v_tb;
  insert into public.general_tasks (project_id, title) values (v_p2, 'Zz M2 elsewhere') returning id into v_tc;
  insert into public.general_task_assignees (task_id, project_id, user_id)
  values (v_ta, v_p, v_m2), (v_tb, v_p, v_m2), (v_tc, v_p2, v_m2);
  perform public.archive_general_task(v_tb, true);

  perform pg_temp.must_allow('the pm makes task holder M2 QA',
    format($q$select public.set_general_member_role(%L, %L, 'qa')$q$, v_p, v_m2));
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('M2 is QA', (select role = 'qa' from public.general_members
                                        where project_id = v_p and user_id = v_m2));
  perform pg_temp.must_be('...holds no task here now, the archived one included',
    not exists (select 1 from public.general_task_assignees where project_id = v_p and user_id = v_m2));
  perform pg_temp.must_be('...still holds the task in the other project',
    exists (select 1 from public.general_task_assignees where task_id = v_tc and user_id = v_m2));

  perform pg_temp.act_as(v_c);
  perform pg_temp.must_allow('a coordinator makes member M QA',
    format($q$select public.set_general_member_role(%L, %L, 'qa')$q$, v_p, v_m));
  perform pg_temp.must_allow('...switches QA to stakeholder',
    format($q$select public.set_general_member_role(%L, %L, 'stakeholder')$q$, v_p, v_m));
  perform pg_temp.must_allow('...and back to member',
    format($q$select public.set_general_member_role(%L, %L, 'member')$q$, v_p, v_m));
  perform pg_temp.must_refuse_with('a coordinator cannot make a coordinator QA',
    format($q$select public.set_general_member_role(%L, %L, 'qa')$q$, v_p, v_c2),
    'Only the project manager can change a coordinator or the project manager.');
  perform pg_temp.must_refuse_with('...nor the pm',
    format($q$select public.set_general_member_role(%L, %L, 'qa')$q$, v_p, v_pm),
    'Only the project manager can change a coordinator or the project manager.');
  perform pg_temp.must_refuse_with('...nor make QA a coordinator',
    format($q$select public.set_general_member_role(%L, %L, 'coordinator')$q$, v_p, v_m2),
    'Only the project manager can make someone a coordinator.');
  perform pg_temp.act_as_service();
end $$;

-- Invitations and join codes.
do $$
declare
  v_p    uuid := (select v from fx where k = 'p');
  v_pm   uuid := (select v from fx where k = 'pm');
  v_c    uuid := (select v from fx where k = 'c');
  v_x    uuid := (select v from fx where k = 'x');
  v_y    uuid := (select v from fx where k = 'y');
  v_inv  public.general_invitations;
  v_code text;
begin
  perform pg_temp.act_as(v_pm);
  v_inv := public.invite_to_general_project(v_p, v_x, 'qa');
  perform pg_temp.must_be('the pm invites X as QA', v_inv.role = 'qa');
  perform pg_temp.act_as(v_x);
  perform pg_temp.must_allow('X accepts',
    format($q$select public.respond_general_invitation(%L, true)$q$, v_inv.id));
  perform pg_temp.must_be('...and is QA',
    (select role = 'qa' from public.general_members where project_id = v_p and user_id = v_x));

  perform pg_temp.act_as(v_c);
  v_inv := public.invite_to_general_project(v_p, v_y, 'qa');
  perform pg_temp.must_be('a coordinator invites Y as QA', v_inv.role = 'qa');
  perform pg_temp.act_as(v_pm);
  v_code := public.set_general_join_code(v_p, true);
  perform pg_temp.act_as(v_y);
  perform pg_temp.must_be('Y joins by the code', public.join_general_project(v_code) = v_p);
  perform pg_temp.must_be('...as the QA the invitation made them',
    (select role = 'qa' from public.general_members where project_id = v_p and user_id = v_y));
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------------ class board

-- A class board's hidden Files project: its members' task inserts are unaffected.
do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid;
  v_set uuid; v_group uuid; v_proj uuid; v_board uuid;
  gp uuid;
begin
  select c.id, c.professor_id into v_class, v_prof from public.classes c
   where (select count(*) from public.class_members m where m.class_id = c.id and m.status = 'active') >= 2
   order by c.created_at limit 1;
  select student_id into v_a from public.class_members where class_id = v_class and status = 'active' order by student_id limit 1;
  select student_id into v_b from public.class_members where class_id = v_class and status = 'active' and student_id <> v_a order by student_id limit 1;

  insert into public.group_sets (class_id, name, mode) values (v_class, 'zz-qa', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'Zz QA group') returning id into v_group;
  insert into public.group_members (group_id, set_id, student_id) values (v_group, v_set, v_a), (v_group, v_set, v_b);
  insert into public.projects (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'Zz QA lab', 'activity', 1, 1, 'group', v_set, now() + interval '7 days')
  returning id into v_proj;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_group;

  perform pg_temp.act_as(v_a);
  gp := public.ensure_class_board_repo(v_board);
  perform pg_temp.must_allow('a class-board member adds a task',
    format($q$insert into public.general_tasks (project_id, title) values (%L, 'Zz QA board task')$q$, gp));
  perform pg_temp.must_be('...a task by kind',
    (select kind = 'task' from public.general_tasks where project_id = gp and title = 'Zz QA board task'));
  perform pg_temp.act_as_service();
end $$;

rollback;
