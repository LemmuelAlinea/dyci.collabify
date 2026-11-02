-- supabase/tests/project-milestone-rules.test.sql
-- A work project's milestone rules: completion, due dates and dependencies.
-- Rolls back; nothing survives.
--
--   node scripts/db.mjs supabase/tests/project-milestone-rules.test.sql
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

/** Runs a statement and asserts it is refused, for the reason under test. */
create or replace function pg_temp.must_refuse_with(p_label text, p_sql text, p_needle text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_needle) in lower(sqlerrm)) > 0 then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 70);
      return;
    end if;
    raise exception 'FAIL  % — refused for another reason: %', p_label, sqlerrm;
  end;
  raise exception 'FAIL  % — the write went through and should not have', p_label;
end;
$$;

/** Runs a statement and returns how many rows it touched. */
create or replace function pg_temp.rows_of(p_sql text) returns int
language plpgsql as $$
declare
  n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

/**
 * A released task tagged to a milestone, written by the service role as the
 * handoff would leave it, held by p_holder when given. Call as the service role.
 */
create or replace function pg_temp.tagged_task(p_project uuid, p_title text, p_milestone uuid,
                                               p_by uuid, p_holder uuid default null)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into public.general_tasks (project_id, title, created_by, routing_state, milestone_id)
  values (p_project, p_title, p_by, 'released', p_milestone)
  returning id into v;
  if p_holder is not null then
    insert into public.general_task_assignees (project_id, task_id, user_id)
    values (p_project, v, p_holder);
  end if;
  return v;
end;
$$;

/** The milestone's reach state: 'auto', 'manual' or 'open'. */
create or replace function pg_temp.reach_of(p_milestone uuid) returns text
language sql as $$
  select case when reached_at is null then 'open'
              when reached_auto then 'auto' else 'manual' end
    from public.general_milestones where id = p_milestone;
$$;

do $$
declare
  v_pm    uuid := gen_random_uuid();  -- project manager on P, P2 and PZ
  v_dev   uuid := gen_random_uuid();  -- member on P, holds tasks
  v_stake uuid := gen_random_uuid();  -- stakeholder on P
  v_coord uuid := gen_random_uuid();  -- coordinator on P
  v_space uuid;
  pa      uuid;  -- a project that gets archived
  mt      uuid;
  mpa     uuid;
  ea      uuid;  -- reached automatically
  eb      uuid;  -- marked reached, waits for ea
  tt1     uuid;
  tt2     uuid;
  tpa     uuid;
  e1      uuid;
  p       uuid;  -- the project under test
  p2      uuid;  -- a project that switches to manual
  pz      uuid;  -- another project, for cross-project links
  m0      uuid;
  mu      uuid;  -- undated
  ma      uuid;
  mb      uuid;
  mc      uuid;
  mx      uuid;
  mz      uuid;
  km      uuid;
  kn      uuid;
  d1      uuid;  -- design: the blocker
  d2      uuid;  -- build: waits for design
  d3      uuid;  -- ship: waits for build
  t1      uuid;
  t2      uuid;
  t3      uuid;
  t4      uuid;
  tx      uuid;
  k1      uuid;
  k2      uuid;
  u1      uuid;
  u2      uuid;
  u3      uuid;
  b1      boolean;
  b2      boolean;
  v_who   uuid;
  n       int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         v.em, '', now(), now()
    from (values
      (v_pm,    'zz-pms-pm@example.test'),
      (v_dev,   'zz-pms-dev@example.test'),
      (v_stake, 'zz-pms-stake@example.test'),
      (v_coord, 'zz-pms-coord@example.test')
    ) as v(id, em);

  insert into public.profiles
    (id, email, first_name, last_name, role, status, can_teach, can_manage_projects)
  values
    (v_pm,    'zz-pms-pm@example.test',    'Zz', 'Pmspm',    'member', 'active', false, true),
    (v_dev,   'zz-pms-dev@example.test',   'Zz', 'Pmsdev',   'member', 'active', false, false),
    (v_stake, 'zz-pms-stake@example.test', 'Zz', 'Pmsstake', 'member', 'active', false, false),
    (v_coord, 'zz-pms-coord@example.test', 'Zz', 'Pmscoord', 'member', 'active', false, false)
  on conflict (id) do update
    set role = excluded.role, status = excluded.status, can_teach = excluded.can_teach,
        can_manage_projects = excluded.can_manage_projects;

  perform pg_temp.act_as(v_pm);
  v_space := (public.create_general_space('Zz PMS space', '')).id;
  p  := (public.create_general_project('Zz PMS project', '', null, null, null, null, v_space)).id;
  p2 := (public.create_general_project('Zz PMS manual', '', null, null, null, null, v_space)).id;
  pz := (public.create_general_project('Zz PMS other', '', null, null, null, null, v_space)).id;
  pa := (public.create_general_project('Zz PMS archived', '', null, null, null, null, v_space)).id;

  perform pg_temp.act_as_service();
  insert into public.general_space_members (space_id, user_id, level) values
    (v_space, v_dev, 'member'), (v_space, v_stake, 'member'), (v_space, v_coord, 'member');
  insert into public.general_members (project_id, user_id, role) values
    (p, v_dev, 'member'), (p, v_stake, 'stakeholder'), (p, v_coord, 'coordinator');

  ------------------------------------------------------------ defaults
  perform pg_temp.act_as(v_pm);
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMS dated', current_date + 10) returning id into m0;
  perform pg_temp.must_be('new projects keep today''s milestone rules',
    (select milestone_completion = 'automatic' and require_milestone_due
            and allow_milestone_dependencies and milestone_overdue_alerts
       from public.general_projects where id = p)
    and (select not reached_auto and overdue_notified_at is null and reached_at is null
           from public.general_milestones where id = m0));

  ------------------------------------------------------------ who changes the settings
  n := 0;
  foreach v_who in array array[v_coord, v_dev] loop
    perform pg_temp.act_as(v_who);
    n := n + pg_temp.rows_of(format($q$update public.general_projects set milestone_completion = 'manual' where id = %L$q$, p))
           + pg_temp.rows_of(format($q$update public.general_projects set require_milestone_due = false where id = %L$q$, p))
           + pg_temp.rows_of(format($q$update public.general_projects set allow_milestone_dependencies = false where id = %L$q$, p))
           + pg_temp.rows_of(format($q$update public.general_projects set milestone_overdue_alerts = false where id = %L$q$, p));
  end loop;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('a coordinator and a member can''t change the milestone settings',
    n = 0
    and (select milestone_completion = 'automatic' and require_milestone_due
                and allow_milestone_dependencies and milestone_overdue_alerts
           from public.general_projects where id = p));
  perform pg_temp.act_as(v_pm);

  ------------------------------------------------------------ due dates
  perform pg_temp.must_refuse_with('a missing due date is refused while required',
    format($q$insert into public.general_milestones (project_id, name) values (%L, 'Zz PMS undated')$q$, p),
    'Give the milestone a due date.');
  perform pg_temp.must_refuse_with('...and so is clearing one',
    format($q$update public.general_milestones set due_on = null where id = %L$q$, m0),
    'Give the milestone a due date.');

  update public.general_projects set require_milestone_due = false where id = p;
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMS undated', null) returning id into mu;
  n := pg_temp.rows_of(format($q$update public.general_milestones set due_on = null where id = %L$q$, m0));
  perform pg_temp.must_be('an undated milestone is allowed when the switch is off',
    n = 1
    and (select due_on is null from public.general_milestones where id = mu)
    and (select due_on is null from public.general_milestones where id = m0));
  update public.general_milestones set due_on = current_date + 10 where id = m0;

  update public.general_projects set require_milestone_due = true where id = p;
  perform pg_temp.must_be('turning the switch back on keeps undated milestones until edited',
    (select due_on is null and name = 'Zz PMS undated' from public.general_milestones where id = mu));
  perform pg_temp.must_refuse_with('...editing one then needs a date',
    format($q$update public.general_milestones set name = 'Zz PMS renamed' where id = %L$q$, mu),
    'Give the milestone a due date.');
  n := pg_temp.rows_of(format($q$update public.general_milestones set reached_at = now() where id = %L$q$, mu));
  n := n + pg_temp.rows_of(format($q$update public.general_milestones set reached_at = null where id = %L$q$, mu));
  perform pg_temp.must_be('...though marking it reached and back is not editing',
    n = 2 and (select reached_at is null from public.general_milestones where id = mu));
  n := pg_temp.rows_of(format($q$update public.general_milestones
                                   set name = 'Zz PMS dated now', due_on = current_date + 3
                                 where id = %L$q$, mu));
  perform pg_temp.must_be('...and it saves once it has one',
    n = 1 and (select name = 'Zz PMS dated now' and due_on = current_date + 3
                 from public.general_milestones where id = mu));

  ------------------------------------------------------------ automatic reach
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMS alpha', current_date + 7) returning id into ma;
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMS bare', current_date + 7) returning id into mb;
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMS solo', current_date + 7) returning id into mc;
  -- Private planning work, which the planners still have to finish.
  insert into public.general_tasks (project_id, title, milestone_id)
  values (p, 'Zz PMS planning', ma) returning id into t3;
  perform pg_temp.act_as_service();
  t1 := pg_temp.tagged_task(p, 'Zz PMS one', ma, v_pm, v_dev);
  t2 := pg_temp.tagged_task(p, 'Zz PMS two', ma, v_pm, v_dev);
  t4 := pg_temp.tagged_task(p, 'Zz PMS four', mc, v_pm, v_dev);

  perform pg_temp.act_as(v_dev);
  update public.general_tasks set status = 'done' where id = t1;
  update public.general_tasks set status = 'done' where id = t2;
  perform pg_temp.must_be('...an open private planning task keeps a milestone open',
    pg_temp.reach_of(ma) = 'open');
  perform pg_temp.act_as(v_pm);
  perform public.archive_general_task(t3, true);
  perform pg_temp.must_be('all tasks done reaches a milestone automatically',
    pg_temp.reach_of(ma) = 'auto'
    and (select abs(extract(epoch from now() - reached_at)) < 60
           from public.general_milestones where id = ma));
  perform pg_temp.must_be('...and the cascade flag is cleared after it',
    coalesce(nullif(current_setting('collabify.milestone_auto', true), ''), 'off') = 'off');

  perform pg_temp.act_as(v_dev);
  update public.general_tasks set status = 'done' where id = t4;
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('...even when the last task is finished by a member who can''t edit milestones',
    pg_temp.reach_of(mc) = 'auto');

  -- Switching back to automatic settles every milestone, the empty one included.
  perform pg_temp.act_as(v_pm);
  update public.general_projects set milestone_completion = 'manual' where id = p;
  update public.general_projects set milestone_completion = 'automatic' where id = p;
  perform pg_temp.must_be('a milestone with no tasks is never reached automatically',
    pg_temp.reach_of(mb) = 'open' and pg_temp.reach_of(mc) = 'auto' and pg_temp.reach_of(ma) = 'auto');
  update public.general_tasks set milestone_id = mb where id = t4;
  perform pg_temp.must_be('...and one that loses its last task is no longer reached',
    pg_temp.reach_of(mc) = 'open' and pg_temp.reach_of(mb) = 'auto');
  insert into public.general_tasks (project_id, title, milestone_id)
  values (p, 'Zz PMS late addition', mb);
  perform pg_temp.must_be('...and tagging a new open task undoes an automatic reach',
    pg_temp.reach_of(mb) = 'open');

  ------------------------------------------------------------ reopening
  perform pg_temp.act_as(v_dev);
  update public.general_tasks set status = 'in_progress' where id = t1;
  b1 := pg_temp.reach_of(ma) = 'open';
  perform pg_temp.act_as(v_pm);
  update public.general_milestones set reached_at = now() where id = ma;
  b2 := pg_temp.reach_of(ma) = 'manual';
  perform pg_temp.act_as(v_dev);
  update public.general_tasks set status = 'done' where id = t1;
  update public.general_tasks set status = 'todo' where id = t2;
  perform pg_temp.must_be('reopening a task undoes an automatic reach but not a manual one',
    b1 and b2 and pg_temp.reach_of(ma) = 'manual');
  perform pg_temp.act_as(v_pm);
  update public.general_milestones set reached_auto = true where id = ma;
  update public.general_milestones set reached_auto = true where id = m0;
  perform pg_temp.must_be('...and nobody sets reached_auto by hand',
    pg_temp.reach_of(ma) = 'manual'
    and (select not reached_auto from public.general_milestones where id = m0));

  ------------------------------------------------------------ manual mode
  insert into public.general_milestones (project_id, name, due_on)
  values (p2, 'Zz PMS kept', current_date + 7) returning id into km;
  insert into public.general_milestones (project_id, name, due_on)
  values (p2, 'Zz PMS sign-off', current_date + 7) returning id into kn;
  perform pg_temp.act_as_service();
  k1 := pg_temp.tagged_task(p2, 'Zz PMS kept task', km, v_pm);
  k2 := pg_temp.tagged_task(p2, 'Zz PMS sign-off task', kn, v_pm);
  perform pg_temp.act_as(v_pm);
  update public.general_tasks set status = 'done' where id = k1;
  b1 := pg_temp.reach_of(km) = 'auto';
  update public.general_projects set milestone_completion = 'manual' where id = p2;
  update public.general_tasks set status = 'todo' where id = k1;
  update public.general_tasks set status = 'done' where id = k2;
  perform pg_temp.must_be('manual mode never reaches automatically',
    b1 and pg_temp.reach_of(km) = 'auto' and pg_temp.reach_of(kn) = 'open');
  update public.general_milestones set reached_at = now() where id = kn;
  perform pg_temp.must_be('...someone marks it instead',
    pg_temp.reach_of(kn) = 'manual');
  perform pg_temp.must_refuse_with('...and the mode is one of the two',
    format($q$update public.general_projects set milestone_completion = 'sometimes' where id = %L$q$, p2),
    'check constraint');
  update public.general_projects set milestone_completion = 'automatic' where id = p2;
  perform pg_temp.must_be('...switching back to automatic settles its milestones',
    pg_temp.reach_of(km) = 'open' and pg_temp.reach_of(kn) = 'manual');

  ------------------------------------------------------------ dependencies
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMS design', current_date + 5) returning id into d1;
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMS build', current_date + 10) returning id into d2;
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMS ship', current_date + 15) returning id into d3;
  perform pg_temp.act_as_service();
  u1 := pg_temp.tagged_task(p, 'Zz PMS design task', d1, v_pm);
  u2 := pg_temp.tagged_task(p, 'Zz PMS build task', d2, v_pm);
  u3 := pg_temp.tagged_task(p, 'Zz PMS ship task', d3, v_pm);
  perform pg_temp.act_as(v_pm);
  perform public.add_general_milestone_dependency(d2, d1);
  perform public.add_general_milestone_dependency(d3, d2);
  perform public.add_general_milestone_dependency(d3, d2);  -- again: nothing changes
  perform pg_temp.must_be('fixture: build waits for design, ship for build',
    (select count(*) = 2 from public.general_milestone_dependencies
      where (milestone_id, depends_on_id) in ((d2, d1), (d3, d2))
        and project_id = p and created_by = v_pm));

  perform pg_temp.must_refuse_with('a milestone can''t be marked reached while it waits',
    format($q$update public.general_milestones set reached_at = now() where id = %L$q$, d2),
    'Waiting for Zz PMS design. Reach it first.');

  update public.general_tasks set status = 'done' where id = u2;
  update public.general_tasks set status = 'done' where id = u3;
  perform pg_temp.must_be('automatic reach waits for the blocker',
    pg_temp.reach_of(d2) = 'open' and pg_temp.reach_of(d3) = 'open');

  update public.general_tasks set status = 'done' where id = u1;
  perform pg_temp.must_be('reaching the blocker reaches the waiting milestone',
    pg_temp.reach_of(d1) = 'auto' and pg_temp.reach_of(d2) = 'auto' and pg_temp.reach_of(d3) = 'auto');

  update public.general_tasks set status = 'todo' where id = u1;
  perform pg_temp.must_be('...reopening the blocker''s task undoes the automatic chain',
    pg_temp.reach_of(d1) = 'open' and pg_temp.reach_of(d2) = 'open' and pg_temp.reach_of(d3) = 'open');
  update public.general_milestones set reached_at = now() where id = d1;
  perform pg_temp.must_be('...a blocker marked reached by hand counts too',
    pg_temp.reach_of(d1) = 'manual' and pg_temp.reach_of(d2) = 'auto' and pg_temp.reach_of(d3) = 'auto');
  perform pg_temp.must_refuse_with('a milestone can''t be marked not reached while a reached one waits for it',
    format($q$update public.general_milestones set reached_at = null where id = %L$q$, d1),
    'Zz PMS build waits for this milestone. Mark Zz PMS build not reached first.');
  update public.general_milestones set reached_at = null where id = d3;
  update public.general_milestones set reached_at = null where id = d2;
  update public.general_milestones set reached_at = null where id = d1;
  perform pg_temp.must_be('...so the chain is un-marked from its end',
    pg_temp.reach_of(d1) = 'open' and pg_temp.reach_of(d2) = 'open' and pg_temp.reach_of(d3) = 'open');

  -- B marked reached waits for A, reached automatically; A's task reopens.
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMS early', current_date + 5) returning id into ea;
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMS sign-off on early', current_date + 6) returning id into eb;
  perform pg_temp.act_as_service();
  e1 := pg_temp.tagged_task(p, 'Zz PMS early task', ea, v_pm);
  perform pg_temp.act_as(v_pm);
  perform public.add_general_milestone_dependency(eb, ea);
  update public.general_tasks set status = 'done' where id = e1;
  update public.general_milestones set reached_at = now() where id = eb;
  b1 := pg_temp.reach_of(ea) = 'auto' and pg_temp.reach_of(eb) = 'manual';
  update public.general_tasks set status = 'in_progress' where id = e1;
  perform pg_temp.must_be('an automatic un-reach un-reaches what waits for it, a marked reach included',
    b1 and pg_temp.reach_of(ea) = 'open' and pg_temp.reach_of(eb) = 'open');

  ------------------------------------------------------------ loops and other refusals
  perform pg_temp.must_refuse_with('a dependency loop is refused',
    format('select public.add_general_milestone_dependency(%L, %L)', d1, d3),
    'That would make the milestones wait for each other.');
  perform pg_temp.must_refuse_with('...a milestone waiting for itself too',
    format('select public.add_general_milestone_dependency(%L, %L)', d1, d1),
    'That would make the milestones wait for each other.');
  insert into public.general_milestones (project_id, name, due_on)
  values (pz, 'Zz PMS elsewhere', current_date + 5) returning id into mz;
  perform pg_temp.must_refuse_with('...and a milestone in another project',
    format('select public.add_general_milestone_dependency(%L, %L)', d1, mz),
    'Both milestones must be in the same project.');
  perform pg_temp.must_refuse_with('...and nobody writes links directly',
    format($q$insert into public.general_milestone_dependencies (milestone_id, depends_on_id, project_id)
              values (%L, %L, %L)$q$, d1, m0, p),
    'permission denied');

  ------------------------------------------------------------ the switch
  update public.general_projects set allow_milestone_dependencies = false where id = p;
  perform pg_temp.must_refuse_with('dependencies off refuses new links but keeps existing ones',
    format('select public.add_general_milestone_dependency(%L, %L)', d3, d1),
    'Milestone dependencies are turned off for this project.');
  perform pg_temp.must_be('...the existing links stay',
    (select count(*) = 3 from public.general_milestone_dependencies where project_id = p));
  perform pg_temp.must_refuse_with('...and still hold',
    format($q$update public.general_milestones set reached_at = now() where id = %L$q$, d2),
    'Waiting for Zz PMS design. Reach it first.');
  perform public.remove_general_milestone_dependency(d3, d2);
  perform pg_temp.must_be('...and can still be removed, which lets the waiting milestone reach',
    not exists (select 1 from public.general_milestone_dependencies where milestone_id = d3)
    and pg_temp.reach_of(d3) = 'auto');
  update public.general_projects set allow_milestone_dependencies = true where id = p;
  perform pg_temp.must_refuse_with('a reached milestone can''t be made to wait for one that isn''t',
    format('select public.add_general_milestone_dependency(%L, %L)', d3, d2),
    'This milestone is reached. Mark it not reached, or reach Zz PMS build first.');
  update public.general_milestones set reached_at = null where id = d3;
  perform public.add_general_milestone_dependency(d3, d2);
  perform pg_temp.must_be('...once it is marked not reached, it can',
    pg_temp.reach_of(d3) = 'open'
    and exists (select 1 from public.general_milestone_dependencies
                 where milestone_id = d3 and depends_on_id = d2));

  ------------------------------------------------------------ who manages links
  perform pg_temp.act_as(v_dev);
  perform pg_temp.must_refuse_with('a member manages dependencies only when the member switch allows milestones',
    format('select public.add_general_milestone_dependency(%L, %L)', d3, d1),
    'Only someone who manages milestones can link them.');
  perform pg_temp.must_refuse_with('...nor removes one',
    format('select public.remove_general_milestone_dependency(%L, %L)', d3, d2),
    'Only someone who manages milestones can link them.');
  perform pg_temp.act_as(v_pm);
  update public.general_projects set members_manage_milestones = true where id = p;
  perform pg_temp.act_as(v_dev);
  perform public.add_general_milestone_dependency(d3, d1);
  b1 := exists (select 1 from public.general_milestone_dependencies where milestone_id = d3 and depends_on_id = d1);
  perform public.remove_general_milestone_dependency(d3, d1);
  perform pg_temp.must_be('...and does once it does',
    b1 and not exists (select 1 from public.general_milestone_dependencies
                        where milestone_id = d3 and depends_on_id = d1));
  perform pg_temp.act_as(v_stake);
  perform pg_temp.must_refuse_with('...a stakeholder never does',
    format('select public.add_general_milestone_dependency(%L, %L)', d3, d1),
    'Only someone who manages milestones can link them.');
  perform pg_temp.must_be('...though everyone on the project reads the links',
    (select count(*) = 3 from public.general_milestone_dependencies where project_id = p));

  ------------------------------------------------------------ deleting
  perform pg_temp.act_as(v_pm);
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMS doomed', current_date + 5) returning id into mx;
  perform pg_temp.act_as_service();
  tx := pg_temp.tagged_task(p, 'Zz PMS doomed task', mx, v_pm);
  perform pg_temp.act_as(v_pm);
  update public.general_tasks set status = 'done' where id = tx;
  b1 := pg_temp.reach_of(mx) = 'auto';
  n := pg_temp.rows_of(format('delete from public.general_milestones where id = %L', mx));
  perform pg_temp.must_be('deleting a reached milestone with tasks still works',
    b1 and n = 1 and (select milestone_id is null from public.general_tasks where id = tx));
  -- Design is open, so build and ship wait; deleting design frees build.
  b1 := pg_temp.reach_of(d2) = 'open' and pg_temp.reach_of(d3) = 'open';
  n := pg_temp.rows_of(format('delete from public.general_milestones where id = %L', d1));
  perform pg_temp.must_be('...and deleting a blocker lets the milestones that waited reach',
    b1 and n = 1 and pg_temp.reach_of(d2) = 'auto' and pg_temp.reach_of(d3) = 'auto');

  ------------------------------------------------------------ trash
  -- Marked not reached by hand while its tasks are done, so the next settle
  -- shows: trashing the archived task settles it again.
  insert into public.general_milestones (project_id, name, due_on)
  values (p, 'Zz PMS trash', current_date + 5) returning id into mt;
  perform pg_temp.act_as_service();
  tt1 := pg_temp.tagged_task(p, 'Zz PMS trash done', mt, v_pm);
  tt2 := pg_temp.tagged_task(p, 'Zz PMS trash archived', mt, v_pm);
  perform pg_temp.act_as(v_pm);
  update public.general_tasks set status = 'done' where id = tt1;
  perform public.archive_general_task(tt2, true);
  b1 := pg_temp.reach_of(mt) = 'auto';
  update public.general_milestones set reached_at = null where id = mt;
  b2 := pg_temp.reach_of(mt) = 'open';
  perform public.trash_archived_item('work_task', tt2);
  perform pg_temp.act_as_service();  -- Trash is out of the planners' sight
  perform pg_temp.must_be('trashing a task settles its milestone again',
    b1 and b2 and (select trashed_at is not null from public.general_tasks where id = tt2)
    and pg_temp.reach_of(mt) = 'auto');

  ------------------------------------------------------------ archived projects
  perform pg_temp.act_as(v_pm);
  insert into public.general_milestones (project_id, name, due_on)
  values (pa, 'Zz PMS frozen', current_date + 5) returning id into mpa;
  perform pg_temp.act_as_service();
  tpa := pg_temp.tagged_task(pa, 'Zz PMS frozen task', mpa, v_pm);
  perform pg_temp.act_as(v_pm);
  update public.general_projects set milestone_completion = 'manual' where id = pa;
  update public.general_tasks set status = 'done' where id = tpa;
  perform public.archive_general_project(pa, true);
  perform pg_temp.act_as_service();
  update public.general_projects set milestone_completion = 'automatic' where id = pa;
  perform public.settle_general_milestone(mpa);
  perform pg_temp.must_be('an archived project never settles',
    (select archived_at is not null and milestone_completion = 'automatic'
       from public.general_projects where id = pa)
    and pg_temp.reach_of(mpa) = 'open');

  ------------------------------------------------------------ class milestones
  perform pg_temp.act_as_service();
  perform pg_temp.must_be('class milestones are untouched',
    (select is_nullable = 'NO' from information_schema.columns
      where table_schema = 'public' and table_name = 'project_milestones' and column_name = 'due_on')
    and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'project_milestones'
                       and column_name in ('reached_at', 'reached_auto', 'overdue_notified_at'))
    and not exists (select 1 from information_schema.tables
                     where table_schema = 'public' and table_name = 'project_milestone_dependencies'));
end;
$$;

rollback;
