-- Progress stages — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/task-stages.test.sql

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

do $$
declare
  v_task uuid; v_student uuid; v_board uuid; v_project uuid; v_other uuid;
  v_gproj uuid; v_owner uuid; v_member uuid; v_gtask uuid;
  s text; g int; changed int;
  refused boolean;
begin
  -- ------------------------------------------------------------ the list rule
  perform pg_temp.must_be('null is the default list', public.stages_ok(null));
  perform pg_temp.must_be('three names are enough',
    public.stages_ok(array['To do', 'Doing', 'Done']));
  perform pg_temp.must_be('two names are too few', not public.stages_ok(array['A', 'B']));
  perform pg_temp.must_be('nine names are too many',
    not public.stages_ok(array['1','2','3','4','5','6','7','8','9']));
  perform pg_temp.must_be('a blank name is refused', not public.stages_ok(array['A', ' ', 'C']));
  perform pg_temp.must_be('a repeated name is refused', not public.stages_ok(array['A', 'b', 'B']));

  -- ------------------------------------------------------------ class tasks
  select t.id, a.student_id, b.id, b.project_id
    into v_task, v_student, v_board, v_project
    from public.project_tasks t
    join public.task_assignees a on a.task_id = t.id
    join public.project_boards b on b.id = t.board_id
   where t.archived_at is null and t.trashed_at is null
     and not public.board_project_locked(b.id) and not public.board_submitted(b.id)
   -- Prefer a group board with somebody on it who is not on the task.
   order by not exists (
     select 1 from public.group_members gm
      where gm.group_id = b.group_id
        and not exists (select 1 from public.task_assignees x where x.task_id = t.id and x.student_id = gm.student_id))
   limit 1;
  if v_task is null then raise exception 'No claimed class task on an open board to test with'; end if;

  update public.projects
     set stages = array['Planning', 'Development', 'Testing', 'Revision', 'Completed']
   where id = v_project;

  perform pg_temp.act_as(v_student);
  update public.project_tasks set stage = 2 where id = v_task;
  select status::text, stage into s, g from public.project_tasks where id = v_task;
  perform pg_temp.must_be('a middle stage means in progress', s = 'in_progress' and g = 2);

  update public.project_tasks set stage = 3 where id = v_task;
  select status::text, stage into s, g from public.project_tasks where id = v_task;
  perform pg_temp.must_be('moving between middle stages stays in progress', s = 'in_progress' and g = 3);

  update public.project_tasks set stage = 4 where id = v_task;
  select status::text, stage into s, g from public.project_tasks where id = v_task;
  perform pg_temp.must_be('the last stage means done', s = 'done' and g = 4);

  update public.project_tasks set status = 'in_progress' where id = v_task;
  select status::text, stage into s, g from public.project_tasks where id = v_task;
  perform pg_temp.must_be('a status alone lands on the first middle stage', s = 'in_progress' and g = 1);

  update public.project_tasks set stage = 99 where id = v_task;
  select status::text, stage into s, g from public.project_tasks where id = v_task;
  perform pg_temp.must_be('a stage past the end is the last', s = 'done' and g = 4);

  update public.project_tasks set status = 'todo' where id = v_task;
  select status::text, stage into s, g from public.project_tasks where id = v_task;
  perform pg_temp.must_be('back to todo is the first stage', s = 'todo' and g = 0);

  -- Somebody else on the board, not on the task, cannot move it a stage.
  update public.project_tasks set stage = 1 where id = v_task;
  perform pg_temp.act_as_service();
  select m.student_id into v_other
    from public.group_members m
    join public.project_boards b on b.group_id = m.group_id
   where b.id = v_board and m.student_id <> v_student
     and not exists (select 1 from public.task_assignees a where a.task_id = v_task and a.student_id = m.student_id)
   limit 1;
  if v_other is not null then
    perform pg_temp.act_as(v_other);
    refused := false;
    begin
      update public.project_tasks set stage = 2 where id = v_task;
    exception when others then refused := true;
    end;
    perform pg_temp.must_be('a teammate off the task cannot move its stage', refused);
  else
    raise notice 'SKIP  no teammate off the task on this board';
  end if;

  perform pg_temp.act_as_service();
  refused := false;
  begin
    update public.projects set stages = array['Only', 'Two'] where id = v_project;
  exception when check_violation then refused := true;
  end;
  perform pg_temp.must_be('two stages are refused on a project', refused);

  -- A project back on the default reads a stored middle stage as In progress.
  update public.projects set stages = null where id = v_project;
  update public.project_tasks set stage = 1 where id = v_task;
  select status::text into s from public.project_tasks where id = v_task;
  perform pg_temp.must_be('the default list keeps the old three', s = 'in_progress');

  -- ------------------------------------------------------------ work tasks
  select m.project_id, m.user_id into v_gproj, v_owner
    from public.general_members m
    join public.general_projects p on p.id = m.project_id
   where m.level = 'owner' and p.archived_at is null
   limit 1;
  if v_gproj is null then raise exception 'No workspace project with an owner to test with'; end if;

  update public.general_projects set stages = array['Topic selection', 'Research', 'Drafting',
    'Review', 'Revision', 'Final'] where id = v_gproj;

  perform pg_temp.act_as(v_owner);
  insert into public.general_tasks (project_id, title, stage)
  values (v_gproj, 'zz stage test', 3)
  returning id into v_gtask;
  select status::text, stage into s, g from public.general_tasks where id = v_gtask;
  perform pg_temp.must_be('a work task made on a middle stage starts in progress', s = 'in_progress' and g = 3);

  update public.general_tasks set stage = 5 where id = v_gtask;
  select status::text into s from public.general_tasks where id = v_gtask;
  perform pg_temp.must_be('a work task on Final is done', s = 'done');
  perform pg_temp.must_be('done stamps completed_at',
    (select completed_at is not null from public.general_tasks where id = v_gtask));

  perform pg_temp.must_be('the overview carries the stage',
    (select stage = 5 from public.general_task_overview where id = v_gtask));

  perform pg_temp.act_as_service();
  select m.user_id into v_member
    from public.general_members m
   where m.project_id = v_gproj and m.role = 'member'
     and not exists (select 1 from public.general_team_members tm join public.general_teams t on t.id = tm.team_id where tm.project_id = v_gproj and t.leader_id = m.user_id)
   limit 1;
  if v_member is not null then
    perform pg_temp.act_as(v_member);
    refused := false;
    begin
      update public.general_tasks set stage = 2 where id = v_gtask;
      get diagnostics changed = row_count;
      refused := changed = 0;
    exception when others then refused := true;
    end;
    perform pg_temp.must_be('a member who holds nothing cannot move a stage', refused);
  else
    raise notice 'SKIP  no plain member on this workspace project';
  end if;

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('anon cannot read the task overview',
    not has_table_privilege('anon', 'public.task_detail_overview', 'select'));
end $$;

rollback;
