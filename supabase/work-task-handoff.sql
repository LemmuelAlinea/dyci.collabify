-- Final task routing owner; run after project-requests.sql, then anon-lockdown.sql.
-- Default remains released until the planner and lead UI is activated.
begin;
alter type public.notification_type add value if not exists 'work_task_handoff';
commit;
begin;
alter table public.general_tasks
  add column if not exists routing_state text not null default 'released',
  add column if not exists reviewer_id uuid references public.profiles(id) on delete set null,
  add column if not exists sent_at timestamptz;
alter table public.general_tasks drop constraint if exists general_tasks_routing_state;
alter table public.general_tasks add constraint general_tasks_routing_state
  check (routing_state in ('planning', 'coordinator_review', 'released'));
create index if not exists general_tasks_routing_idx on public.general_tasks(project_id, routing_state);

create or replace function public.general_task_readable(p_project uuid, p_state text, p_creator uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.can_read_general_project(p_project) and (
    p_state = 'released'
    or exists (select 1 from public.general_projects p where p.id = p_project and p.class_board_id is not null)
    or public.general_role_of(p_project, auth.uid()) in ('pm', 'coordinator')
    or (p_creator = auth.uid() and public.general_role_of(p_project, auth.uid()) = 'qa')
  ), false);
$$;

create or replace function public.general_task_child_readable(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.general_tasks t where t.id = p_task
      and public.general_task_readable(t.project_id, t.routing_state,
        case when t.kind = 'bug' then t.created_by end)
  );
$$;

-- Summary counts exclude unsent work even for planners and its QA creator.
create or replace function public.general_task_released(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.general_tasks t join public.general_projects p on p.id = t.project_id
    where t.id = p_task and (p.class_board_id is not null or t.routing_state = 'released')
      and public.can_read_general_project(t.project_id)
  );
$$;

create or replace function public.general_task_hidden(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.general_tasks t where t.id = p_task
      and (not public.general_task_child_readable(t.id)
        or (t.archived_at is not null and not public.general_sees_archived(t.project_id, t.archived_by)))
  );
$$;

create or replace function public.general_report_task_ok(p_archived_at timestamptz, p_task uuid, p_include_archived boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select public.general_task_released(p_task)
    and (p_archived_at is null or (coalesce(p_include_archived, false) and not public.general_task_hidden(p_task)));
$$;

-- Generic task notifications stay released-only; handoff bells reach their next actor.
drop policy if exists notifications_task_routing_read on public.notifications;
create policy notifications_task_routing_read on public.notifications as restrictive for select
  using (general_task_id is null or public.general_task_released(general_task_id)
    or (type = 'work_task_handoff' and exists (
      select 1 from public.general_tasks t where t.id = general_task_id
        and ((t.routing_state = 'coordinator_review' and t.reviewer_id = auth.uid())
          or (t.routing_state = 'planning' and public.general_role_of(t.project_id,auth.uid()) = 'pm')))));

-- Restrictive policies compose with existing archive/trash and membership rules.
drop policy if exists general_tasks_routing_read on public.general_tasks;
create policy general_tasks_routing_read on public.general_tasks as restrictive for select
  using (public.general_task_readable(project_id, routing_state, case when kind = 'bug' then created_by end));
do $$
declare v_table text;
begin
  foreach v_table in array array['general_task_assignees','general_task_comments','general_task_files','general_task_logs','general_task_events'] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_routing_read', v_table);
    execute format('create policy %I on public.%I as restrictive for select using (public.general_task_child_readable(task_id))',
      v_table || '_routing_read', v_table);
  end loop;
end $$;

revoke all on function public.general_task_readable(uuid,text,uuid), public.general_task_child_readable(uuid),
  public.general_task_released(uuid) from public, anon;
grant execute on function public.general_task_readable(uuid,text,uuid), public.general_task_child_readable(uuid),
  public.general_task_released(uuid) to authenticated;

create or replace view public.general_task_overview with (security_invoker = true) as
 SELECT id,
    project_id,
    team_id,
    title,
    description,
    status,
    due_at,
    weight,
    created_by,
    completed_at,
    created_at,
    updated_at,
    COALESCE(( SELECT array_agg(a.user_id ORDER BY a.assigned_at) AS array_agg
           FROM general_task_assignees a
          WHERE a.task_id = t.id), '{}'::uuid[]) AS assignee_ids,
    (( SELECT count(*) AS count
           FROM general_task_comments c
          WHERE c.task_id = t.id))::integer AS comment_count,
    (( SELECT count(*) AS count
           FROM general_task_files f
          WHERE f.task_id = t.id AND f.archived_at IS NULL))::integer AS file_count,
    (( SELECT COALESCE(sum(l.minutes), 0::bigint) AS "coalesce"
           FROM general_task_logs l
          WHERE l.task_id = t.id))::integer AS logged_minutes,
    starts_at,
    archived_at,
    archived_by,
    sprint_id,
    rank,
    milestone_id,
    stage,
    kind,
    qa_entered_at,
    routing_state,
    reviewer_id,
    sent_at
   FROM general_tasks t
  WHERE archived_at IS NULL OR general_sees_archived(project_id, archived_by);

create or replace view public.general_project_overview with (security_invoker = true) as
 SELECT p.id,
    p.name,
    p.description,
    p.starts_on,
    p.ends_on,
    p.status,
    p.points_enabled,
    ( SELECT jc.code
           FROM general_join_codes jc
          WHERE jc.project_id = p.id) AS join_code,
    COALESCE(( SELECT jc.open
           FROM general_join_codes jc
          WHERE jc.project_id = p.id), false) AS join_open,
    p.created_by,
    p.archived_at,
    p.created_at,
    p.updated_at,
    m.level AS my_level,
    (( SELECT count(*) AS count
           FROM general_members x
          WHERE x.project_id = p.id))::integer AS member_count,
    COALESCE(t.task_count, 0) AS task_count,
    COALESCE(t.done_count, 0) AS done_count,
        CASE
            WHEN COALESCE(t.task_count, 0) = 0 THEN 0::numeric
            WHEN p.points_enabled THEN round(t.done_weight / NULLIF(t.total_weight, 0::numeric) * 100::numeric, 1)
            ELSE round(t.done_count::numeric / t.task_count::numeric * 100::numeric, 1)
        END AS progress_pct,
    (( SELECT count(*) AS count
           FROM general_access_requests r
          WHERE r.project_id = p.id AND r.status = 'open'::general_request_status))::integer AS open_request_count,
    p.preset,
    p.has_code,
    p.space_id,
    s.name AS space_name,
    m.role AS my_role,
    general_project_has_pm(p.id) AS has_pm,
    general_project_has_qa(p.id) AS has_qa
   FROM general_projects p
     LEFT JOIN general_members m ON m.project_id = p.id AND m.user_id = auth.uid()
     LEFT JOIN general_spaces s ON s.id = p.space_id
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS task_count,
            count(*) FILTER (WHERE x.status = 'done'::general_task_status)::integer AS done_count,
            sum(x.weight) AS total_weight,
            COALESCE(sum(x.weight) FILTER (WHERE x.status = 'done'::general_task_status), 0::numeric) AS done_weight
           FROM general_tasks x
          WHERE x.project_id = p.id AND x.archived_at IS NULL
            AND (p.class_board_id IS NOT NULL OR x.routing_state = 'released')) t ON true;

CREATE OR REPLACE FUNCTION public.general_user_sees_task(p_task uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
as $$
  select exists (
    select 1 from public.general_tasks t
     where t.id = p_task
       and (t.routing_state = 'released'
            or exists (select 1 from public.general_projects p where p.id = t.project_id and p.class_board_id is not null))
       and exists (select 1 from public.general_members m join public.profiles pr on pr.id = m.user_id
                   where m.project_id = t.project_id and m.user_id = p_user and pr.status <> 'rejected')
       and (t.archived_at is null
            or exists (select 1 from public.general_members m
                        where m.project_id = t.project_id and m.user_id = p_user
                          and (m.user_id = t.archived_by or m.level in ('owner', 'manager'))))
  );
$$;

CREATE OR REPLACE FUNCTION public.general_task_project(p_task uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
as $$
  select case when auth.uid() is null then null
    else (select project_id from public.general_tasks where id = p_task and public.general_task_child_readable(id)) end;
$$;

CREATE OR REPLACE FUNCTION public.general_task_held(p_task uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
as $$
  select case when auth.uid() is null then false
    else exists (select 1 from public.general_task_assignees where task_id = p_task and public.general_task_child_readable(p_task)) end;
$$;

CREATE OR REPLACE FUNCTION public.is_general_task_assignee(p_task uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
as $$
  select case when auth.uid() is null then false else exists (
    select 1 from public.general_task_assignees
     where task_id = p_task and user_id = auth.uid() and public.general_task_child_readable(p_task)
  ) end;
$$;

CREATE OR REPLACE FUNCTION public.general_task_archived(p_task uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
as $$
  select exists (select 1 from public.general_tasks where id = p_task and archived_at is not null and public.general_task_child_readable(id));
$$;

CREATE OR REPLACE FUNCTION public.general_task_file_hidden(p_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
as $$
  select exists (
    select 1 from public.general_tasks t
     where t.id = public.general_safe_uuid((storage.foldername(p_path))[2])
       and not public.general_task_child_readable(t.id)
  ) or exists (
    select 1 from public.general_task_files f
     where f.file_path = p_path
       and ((f.archived_at is not null
             and not public.general_sees_archived(f.project_id, f.archived_by))
            or public.general_task_hidden(f.task_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.general_assign_context(p_project uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
as $$
declare
  v_n      int;
  v_has_qa boolean;
  v_qa     int;
  v_total  int;
  v_cands  jsonb;
  v_pos    jsonb;
  v_tasks  jsonb;
begin
  select public.stage_count(gp.stages) into v_n
    from public.general_projects gp
   where gp.id = p_project and gp.class_board_id is null;
  if v_n is null or not coalesce(public.general_has(p_project, 'manage_tasks'), false) then
    raise exception 'Only the project manager and coordinators can assign by position.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;

  v_has_qa := coalesce(public.general_project_has_qa(p_project), false);
  v_qa := public.general_qa_stage_index(p_project);

  with cands as (
    select m.user_id,
           btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')) as name
      from public.general_members m
      join public.profiles pr on pr.id = m.user_id
     where m.project_id = p_project
       and m.role in ('pm', 'coordinator', 'member')
       and pr.status = 'active'
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', c.user_id,
               'name', c.name,
               'load', (select count(*)
                          from public.general_task_assignees a
                          join public.general_tasks t on t.id = a.task_id
                         where a.project_id = p_project and a.user_id = c.user_id
                           and t.status <> 'done' and t.archived_at is null and public.general_task_released(t.id)),
               'teams', coalesce((select jsonb_agg(tm.team_id order by tm.team_id)
                                    from public.general_team_members tm
                                   where tm.project_id = p_project and tm.user_id = c.user_id),
                                 '[]'::jsonb),
               'positions', coalesce((select jsonb_agg(h.position_id order by h.position_id)
                                        from public.general_position_holders h
                                       where h.project_id = p_project and h.user_id = c.user_id),
                                     '[]'::jsonb),
               'tags', coalesce((select jsonb_agg(s.tag order by lower(s.tag))
                                   from public.general_member_skills s
                                  where s.project_id = p_project and s.user_id = c.user_id),
                                '[]'::jsonb)
             ) order by c.name, c.user_id)
        from cands c
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'team_id', p.team_id, 'team', tm.name
             ) order by p.sort, p.name, p.id)
        from public.general_positions p
        left join public.general_teams tm on tm.id = p.team_id
       where p.project_id = p_project
         and exists (select 1 from public.general_position_holders h
                       join cands c on c.user_id = h.user_id
                      where h.position_id = p.id and h.project_id = p_project)
    ), '[]'::jsonb)
    into v_cands, v_pos;

  with eligible as (
    select t.id, t.title, t.description, t.team_id, t.created_at
      from public.general_tasks t
     where t.project_id = p_project and public.general_task_child_readable(t.id)
       and t.status <> 'done'
       and t.archived_at is null
       and not exists (select 1 from public.general_task_assignees a where a.task_id = t.id)
       and (not v_has_qa
            or public.general_task_stage_at(t.status, t.stage, v_n) < v_qa)
  ),
  firsts as (
    select * from eligible order by created_at, id limit 60
  )
  select
    (select count(*) from eligible),
    coalesce((select jsonb_agg(jsonb_build_object(
                       'id', f.id, 'title', f.title,
                       'description', coalesce(f.description, ''), 'team_id', f.team_id
                     ) order by f.created_at, f.id)
                from firsts f), '[]'::jsonb)
    into v_total, v_tasks;

  return jsonb_build_object(
    'positions', v_pos,
    'candidates', v_cands,
    'tasks', v_tasks,
    'left', greatest(v_total - 60, 0)
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.my_qa_queue()
 RETURNS TABLE(project_id uuid, name text, qa_stage_name text, waiting integer, oldest_entered_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
as $$
  select p.id,
         p.name,
         (coalesce(p.stages, array['To do', 'In progress', 'Done']))[q.qa_i + 1],
         w.waiting,
         w.oldest
    from public.general_members m
    join public.general_projects p on p.id = m.project_id
    join public.profiles pr on pr.id = m.user_id and pr.status = 'active'
    cross join lateral (
      select public.stage_count(p.stages) as n,
             public.general_qa_stage_pick(p.stages, p.qa_stage) as qa_i
    ) q
    cross join lateral (
      select count(*)::int as waiting, min(x.qa_entered_at) as oldest
        from public.general_tasks x
       where x.project_id = p.id and public.general_task_released(x.id)
         and x.archived_at is null
         and public.general_task_stage_at(x.status, x.stage, q.n) = q.qa_i
    ) w
   where auth.uid() is not null
     and m.user_id = auth.uid()
     and m.role = 'qa'
     and p.archived_at is null
     and p.class_board_id is null
   order by p.name, p.id;
$$;

CREATE OR REPLACE FUNCTION public.general_since_last_visit(p_project uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
as $$
declare
  me     uuid := auth.uid();
  v      public.general_project_visits%rowtype;
  since  timestamptz;
  out    jsonb;
begin
  if not public.is_general_member(p_project) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;

  select * into v from public.general_project_visits
   where user_id = me and project_id = p_project;

  if v.user_id is null then
    insert into public.general_project_visits (user_id, project_id, since, seen_at)
    values (me, p_project, null, now());
    return jsonb_build_object('first_visit', true);
  end if;

  -- A new sitting after half an hour away: the last one becomes "since".
  if v.seen_at < now() - interval '30 minutes' then
    since := v.seen_at;
    update public.general_project_visits
       set since = v.seen_at, seen_at = now()
     where user_id = me and project_id = p_project;
  else
    since := v.since;
    update public.general_project_visits
       set seen_at = now()
     where user_id = me and project_id = p_project;
  end if;

  if since is null then
    return jsonb_build_object('first_visit', true);
  end if;

  select jsonb_build_object(
    'first_visit', false,
    'since', since,
    'tasks_done', (
      select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title)
                                order by t.completed_at desc), '[]'::jsonb)
        from (
          select t.id, t.title, t.completed_at
            from public.general_tasks t
           where t.project_id = p_project and public.general_task_released(t.id)
             and t.archived_at is null
             and t.status = 'done'
             and t.completed_at > since
             and not exists (
               select 1 from public.general_task_assignees a
                where a.task_id = t.id and a.user_id = me
             )
           order by t.completed_at desc
           limit 20
        ) t
    ),
    'tasks_added', (
      select count(*) from public.general_tasks t
       where t.project_id = p_project and public.general_task_released(t.id) and t.archived_at is null
         and t.created_at > since and t.created_by is distinct from me
    ),
    'assigned_to_me', (
      select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title)), '[]'::jsonb)
        from public.general_task_assignees a
        join public.general_tasks t on t.id = a.task_id
       where a.project_id = p_project and a.user_id = me and public.general_task_released(t.id)
         and a.assigned_at > since and a.assigned_by is distinct from me
         and t.archived_at is null
    ),
    'comments_on_mine', (
      select count(*) from public.general_task_comments c
       where c.project_id = p_project and public.general_task_released(c.task_id)
         and c.created_at > since
         and c.author_id is distinct from me
         and exists (
           select 1 from public.general_task_assignees a
            where a.task_id = c.task_id and a.user_id = me
         )
    ),
    'commits', (
      select count(*) from public.general_commits c
       where c.project_id = p_project
         and c.created_at > since
         and c.author_id is distinct from me
    ),
    'reviews_waiting', (
      select count(*) from public.general_repo_changes ch
       where ch.project_id = p_project
         and ch.status = 'open'
         and ch.author_id is distinct from me
         and (me = any (ch.reviewer_ids)
              or (cardinality(ch.reviewer_ids) = 0 and public.general_has(p_project, 'edit_files')))
    )
  ) into out;

  return out;
end;
$$;

CREATE OR REPLACE FUNCTION public.general_report_people(p_space uuid, p_projects uuid[], p_from timestamp with time zone, p_to timestamp with time zone, p_people uuid[] DEFAULT NULL::uuid[], p_teams uuid[] DEFAULT NULL::uuid[], p_include_archived boolean DEFAULT false, p_tz text DEFAULT 'UTC'::text)
 RETURNS TABLE(project_id uuid, user_id uuid, name text, level text, teams text[], tasks_held_now integer, tasks_finished_in_range integer, tasks_finished_late integer, points_finished numeric, minutes_logged integer, comments integer, files_uploaded integer, commits integer, files_changed integer, reviews_requested integer, reviews_done integer, reviews_applied_as_author integer, first_activity timestamp with time zone, last_activity timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET jit TO 'off'
as $$
  with pj as (
    select s.project_id, s.is_lead, p.space_id,
           public.general_report_people_of(s.project_id, s.is_lead, p_people, p_teams) as ppl
      from public.general_report_projects(p_space, p_projects, p_include_archived) s
      join public.general_projects p on p.id = s.project_id
  ),
  who as (
    select pj.project_id, m.user_id from pj join public.general_members m on m.project_id = pj.project_id
    union
    select pj.project_id, l.user_id from pj join public.general_task_logs l on l.project_id = pj.project_id
     where public.general_task_released(l.task_id) and l.logged_on >= (p_from at time zone p_tz)::date and l.logged_on < (p_to at time zone p_tz)::date
    union
    select pj.project_id, c.author_id from pj join public.general_commits c on c.project_id = pj.project_id
     where c.created_at >= p_from and c.created_at < p_to and c.author_id is not null
  ),
  people as (
    select w.project_id, w.user_id, pj.is_lead, pj.space_id
      from who w join pj on pj.project_id = w.project_id
     where w.user_id is not null and (pj.ppl is null or w.user_id = any (pj.ppl))
  ),
  finished as (
    select a.user_id, t.project_id, t.completed_at, t.due_at, t.weight
      from people pe
      join public.general_task_assignees a on a.project_id = pe.project_id and a.user_id = pe.user_id
      join public.general_tasks t on t.id = a.task_id
     where t.status = 'done' and t.completed_at >= p_from and t.completed_at < p_to
       and public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
  ),
  stamps as (
    select l.project_id, l.user_id as who, l.created_at as at
      from public.general_task_logs l join people pe on pe.project_id = l.project_id and pe.user_id = l.user_id
     where public.general_task_released(l.task_id) and l.logged_on >= (p_from at time zone p_tz)::date and l.logged_on < (p_to at time zone p_tz)::date
    union all
    select c.project_id, c.author_id, c.created_at
      from public.general_task_comments c join people pe on pe.project_id = c.project_id and pe.user_id = c.author_id
     where public.general_task_released(c.task_id) and c.created_at >= p_from and c.created_at < p_to
    union all
    select cm.project_id, cm.author_id, cm.created_at
      from public.general_commits cm join people pe on pe.project_id = cm.project_id and pe.user_id = cm.author_id
     where cm.created_at >= p_from and cm.created_at < p_to
    union all
    select e.project_id, e.actor_id, e.created_at
      from public.general_task_events e join people pe on pe.project_id = e.project_id and pe.user_id = e.actor_id
     where public.general_task_released(e.task_id) and public.general_task_released(e.task_id) and e.created_at >= p_from and e.created_at < p_to
    union all
    select f.project_id, f.uploaded_by, f.created_at
      from public.general_task_files f join people pe on pe.project_id = f.project_id and pe.user_id = f.uploaded_by
     where public.general_task_released(f.task_id) and public.general_task_released(f.task_id) and f.created_at >= p_from and f.created_at < p_to
  )
  select pe.project_id, pe.user_id,
         public.general_report_name(pe.user_id, pe.is_lead),
         (select m.level::text from public.general_members m
           where m.project_id = pe.project_id and m.user_id = pe.user_id),
         array(
           select t.name from public.general_team_members tm
             join public.general_teams t on t.id = tm.team_id
            where tm.project_id = pe.project_id and tm.user_id = pe.user_id
           union
           select st.name from public.general_space_team_members stm
             join public.general_space_teams st on st.id = stm.team_id
            where stm.space_id = pe.space_id and stm.user_id = pe.user_id and st.archived_at is null
         ),
         (select count(*) from public.general_task_assignees a
            join public.general_tasks t on t.id = a.task_id
           where a.project_id = pe.project_id and a.user_id = pe.user_id and t.status <> 'done'
             and public.general_report_task_ok(t.archived_at, t.id, p_include_archived))::int,
         (select count(*) from finished f where f.project_id = pe.project_id and f.user_id = pe.user_id)::int,
         (select count(*) from finished f where f.project_id = pe.project_id and f.user_id = pe.user_id
             and f.due_at is not null and f.completed_at > f.due_at)::int,
         coalesce((select sum(f.weight) from finished f
                    where f.project_id = pe.project_id and f.user_id = pe.user_id), 0)::numeric,
         coalesce((select sum(l.minutes) from public.general_task_logs l
            join public.general_tasks t on t.id = l.task_id
           where l.project_id = pe.project_id and l.user_id = pe.user_id
             and l.logged_on >= (p_from at time zone p_tz)::date and l.logged_on < (p_to at time zone p_tz)::date
             and public.general_report_task_ok(t.archived_at, t.id, p_include_archived)), 0)::int,
         (select count(*) from public.general_task_comments c
            join public.general_tasks t on t.id = c.task_id
           where c.project_id = pe.project_id and c.author_id = pe.user_id
             and c.created_at >= p_from and c.created_at < p_to
             and public.general_report_task_ok(t.archived_at, t.id, p_include_archived))::int,
         (select count(*) from public.general_task_files f
            join public.general_tasks t on t.id = f.task_id
           where f.project_id = pe.project_id and f.uploaded_by = pe.user_id
             and f.created_at >= p_from and f.created_at < p_to
             and public.general_report_file_ok(f, p_include_archived)
             and public.general_report_task_ok(t.archived_at, t.id, p_include_archived))::int,
         (select count(*) from public.general_commits cm
           where cm.project_id = pe.project_id and cm.author_id = pe.user_id
             and cm.created_at >= p_from and cm.created_at < p_to)::int,
         (select count(*) from public.general_commits cm
            join public.general_blobs b on b.commit_id = cm.id
           where cm.project_id = pe.project_id and cm.author_id = pe.user_id
             and cm.created_at >= p_from and cm.created_at < p_to
             and b.path !~ '(^|/)\.keep$')::int,
         (select count(*) from public.general_repo_changes ch
           where ch.project_id = pe.project_id and ch.author_id = pe.user_id
             and ch.created_at >= p_from and ch.created_at < p_to)::int,
         (select count(*) from public.general_repo_changes ch
           where ch.project_id = pe.project_id and ch.decided_by = pe.user_id
             and ch.decided_at >= p_from and ch.decided_at < p_to)::int,
         (select count(*) from public.general_repo_changes ch
           where ch.project_id = pe.project_id and ch.author_id = pe.user_id and ch.status = 'applied'
             and ch.decided_at >= p_from and ch.decided_at < p_to)::int,
         (select min(s.at) from stamps s where s.project_id = pe.project_id and s.who = pe.user_id),
         (select max(s.at) from stamps s where s.project_id = pe.project_id and s.who = pe.user_id)
    from people pe;
$$;

CREATE OR REPLACE FUNCTION public.general_report_activity(p_space uuid, p_projects uuid[], p_from timestamp with time zone, p_to timestamp with time zone, p_people uuid[] DEFAULT NULL::uuid[], p_teams uuid[] DEFAULT NULL::uuid[], p_include_archived boolean DEFAULT false, p_tz text DEFAULT 'UTC'::text, p_kinds text[] DEFAULT NULL::text[], p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 200)
 RETURNS TABLE(at timestamp with time zone, id uuid, project_id uuid, actor_id uuid, actor_name text, subject_id uuid, subject_name text, kind text, task_id uuid, task_title text, detail jsonb, total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET jit TO 'off'
as $$
  with pj as (
    select s.project_id, s.is_lead,
           public.general_report_people_of(s.project_id, s.is_lead, p_people, p_teams) as ppl
      from public.general_report_projects(p_space, p_projects, p_include_archived) s
  ),
  feed as (
    select e.created_at as at, e.id, e.project_id, e.actor_id,
           case when e.kind in ('assigned', 'unassigned') then (e.detail->>'user_id')::uuid end as subject_id,
           e.kind, e.task_id, e.detail - 'user_id' as detail, pj.is_lead, pj.ppl
      from pj join public.general_task_events e on e.project_id = pj.project_id
      join public.general_tasks t on t.id = e.task_id
     where e.created_at >= p_from and e.created_at < p_to
       and public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
    union all
    select c.created_at, c.id, c.project_id, c.author_id, null, 'comment', c.task_id,
           jsonb_build_object('length', char_length(c.body)), pj.is_lead, pj.ppl
      from pj join public.general_task_comments c on c.project_id = pj.project_id
      join public.general_tasks t on t.id = c.task_id
     where c.created_at >= p_from and c.created_at < p_to
       and public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
    union all
    select l.created_at, l.id, l.project_id, l.user_id, null, 'time_logged', l.task_id,
           jsonb_build_object('minutes', l.minutes, 'logged_on', l.logged_on,
             'note', case when pj.is_lead or l.user_id = auth.uid() then l.note end),
           pj.is_lead, pj.ppl
      from pj join public.general_task_logs l on l.project_id = pj.project_id
      join public.general_tasks t on t.id = l.task_id
     where l.created_at >= p_from and l.created_at < p_to
       and public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
    union all
    select f.created_at, f.id, f.project_id, f.uploaded_by, null, 'file_added', f.task_id,
           jsonb_build_object('file_name', f.file_name, 'size', f.size_bytes), pj.is_lead, pj.ppl
      from pj join public.general_task_files f on f.project_id = pj.project_id
      join public.general_tasks t on t.id = f.task_id
     where f.created_at >= p_from and f.created_at < p_to
       and public.general_report_file_ok(f, p_include_archived)
       and public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
    union all
    select f.archived_at, f.id, f.project_id, f.archived_by, null, 'file_archived', f.task_id,
           jsonb_build_object('file_name', f.file_name), pj.is_lead, pj.ppl
      from pj join public.general_task_files f on f.project_id = pj.project_id
      join public.general_tasks t on t.id = f.task_id
     where f.archived_at >= p_from and f.archived_at < p_to
       and coalesce(p_include_archived, false)
       and public.general_report_file_ok(f, true)
       and public.general_sees_archived(f.project_id, f.archived_by)
       and public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
    union all
    select cm.created_at, cm.id, cm.project_id, cm.author_id, null, 'commit', null,
           jsonb_build_object('seq', cm.seq, 'message', cm.message,
             'added', (select count(*) from public.general_blobs b where b.commit_id = cm.id and b.action = 'added' and b.path !~ '(^|/)\.keep$'),
             'changed', (select count(*) from public.general_blobs b where b.commit_id = cm.id and b.action = 'changed' and b.path !~ '(^|/)\.keep$'),
             'removed', (select count(*) from public.general_blobs b where b.commit_id = cm.id and b.action = 'removed' and b.path !~ '(^|/)\.keep$')),
           pj.is_lead, pj.ppl
      from pj join public.general_commits cm on cm.project_id = pj.project_id
     where cm.created_at >= p_from and cm.created_at < p_to
    union all
    select ch.created_at, ch.id, ch.project_id, ch.author_id, ch.reviewer_id, 'review_requested', null,
           jsonb_build_object('title', ch.title, 'files', jsonb_array_length(ch.files)), pj.is_lead, pj.ppl
      from pj join public.general_repo_changes ch on ch.project_id = pj.project_id
     where ch.created_at >= p_from and ch.created_at < p_to
    union all
    select coalesce(ch.decided_at, ch.updated_at), ch.id, ch.project_id,
           case when ch.status = 'withdrawn' then ch.author_id else ch.decided_by end,
           case when ch.status = 'withdrawn' then null else ch.author_id end,
           'review_' || ch.status::text, null,
           jsonb_build_object('title', ch.title), pj.is_lead, pj.ppl
      from pj join public.general_repo_changes ch on ch.project_id = pj.project_id
     where ch.status in ('applied', 'declined', 'withdrawn')
       and coalesce(ch.decided_at, ch.updated_at) >= p_from
       and coalesce(ch.decided_at, ch.updated_at) < p_to
    union all
    select rc.created_at, rc.id, rc.project_id, rc.author_id, null, 'review_comment', null,
           jsonb_build_object('title', ch.title, 'length', char_length(rc.body)), pj.is_lead, pj.ppl
      from pj join public.general_repo_comments rc on rc.project_id = pj.project_id
      join public.general_repo_changes ch on ch.id = rc.change_id
     where rc.created_at >= p_from and rc.created_at < p_to
    union all
    select pe.created_at, pe.id, pe.project_id, pe.actor_id, pe.subject_id, pe.kind, pe.task_id,
           pe.detail, pj.is_lead, pj.ppl
      from pj join public.general_project_events pe on pe.project_id = pj.project_id
     where pe.created_at >= p_from and pe.created_at < p_to
       and (pe.task_id is null or (public.general_task_released(pe.task_id) and not public.general_task_hidden(pe.task_id)))
  ),
  kept as (
    select f.*, count(*) over () as total
      from feed f
     where f.at is not null
       and (f.ppl is null or f.actor_id = any (f.ppl) or f.subject_id = any (f.ppl))
       and (p_kinds is null or cardinality(p_kinds) = 0 or f.kind = any (p_kinds))
  )
  select k.at, k.id, k.project_id,
         case when k.is_lead or k.actor_id = auth.uid() then k.actor_id end,
         public.general_report_name(k.actor_id, k.is_lead),
         case when k.is_lead or k.subject_id = auth.uid() then k.subject_id end,
         public.general_report_name(k.subject_id, k.is_lead),
         k.kind, k.task_id,
         (select t.title from public.general_tasks t where t.id = k.task_id),
         k.detail, k.total
    from kept k
   where p_before is null or (k.at, k.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
   order by k.at desc, k.id desc
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

CREATE OR REPLACE FUNCTION public.list_my_archive()
 RETURNS TABLE(kind text, area text, id uuid, name text, detail text, file_source text, class_id uuid, class_name text, space_id uuid, space_name text, project_id uuid, project_name text, class_project_id uuid, repo_id uuid, path text, archived_at timestamp with time zone, archived_by uuid, archived_by_name text, restore_block text, trash_block text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
as $$
  with rows as (
    -- Classes the caller teaches.
    select 'class'::text as kind, 'classes'::text as area, c.id, c.name,
           c.initial || ' · ' || c.section as detail, null::text as file_source,
           c.id as class_id, c.name as class_name, null::uuid as space_id, null::text as space_name,
           null::uuid as project_id, null::text as project_name, null::uuid as class_project_id,
           null::uuid as repo_id, null::text as path,
           c.archived_at, null::uuid as archived_by
      from public.classes c
     where c.archived_at is not null and c.trashed_at is null
       and ((c.professor_id = auth.uid() and public.general_viewer_active())
            or public.teaches_in_space(c.space_id))

    union all
    -- Groups in a live class the caller teaches.
    select 'group', 'classes', g.id, g.name, s.name, null,
           c.id, c.name, null, null, null, null, null, null, null,
           g.archived_at, null
      from public.groups g
      join public.group_sets s on s.id = g.set_id
      join public.classes c on c.id = s.class_id
     where g.archived_at is not null and g.trashed_at is null
       and c.archived_at is null and c.trashed_at is null
       and public.is_set_professor(g.set_id)

    union all
    -- Class projects in a live class the caller teaches.
    select 'class_project', 'classes', p.id, p.title,
           'Weeks ' || p.start_week || '–' || p.end_week, null,
           c.id, c.name, null, null, null, null, p.id, null, null,
           p.archived_at, null
      from public.projects p
      join public.classes c on c.id = p.class_id
     where p.archived_at is not null and p.trashed_at is null
       and c.archived_at is null and c.trashed_at is null
       and public.is_class_professor(p.class_id)

    union all
    -- Class tasks: the ones the caller archived from their own board, and for
    -- faculty, every task archived in a class they teach.
    select 'class_task', 'classes', t.id, t.title,
           coalesce(g.name, public.display_name(b.student_id)), null,
           c.id, c.name, null, null, null, p.title, p.id, null, null,
           t.archived_at, t.archived_by
      from public.project_tasks t
      join public.project_boards b on b.id = t.board_id
      join public.projects p on p.id = b.project_id
      join public.classes c on c.id = p.class_id
      left join public.groups g on g.id = b.group_id
     where t.archived_at is not null and t.trashed_at is null
       and p.archived_at is null and p.trashed_at is null
       and c.archived_at is null and c.trashed_at is null
       and ((t.archived_by = auth.uid() and public.is_board_member(b.id))
            or public.is_board_professor(b.id))

    union all
    -- Files the caller archived in their own draft, on a class board or in a work project.
    select case when gp.class_board_id is null then 'work_file' else 'class_file' end,
           case when gp.class_board_id is null then 'work' else 'classes' end,
           f.id, regexp_replace(f.path, '^.*/', ''), 'My draft', 'draft',
           cc.id, cc.name,
           case when gp.class_board_id is null then gs.id end,
           case when gp.class_board_id is null then gs.name end,
           gp.id, coalesce(cp.title, gp.name), cp.id, d.repo_id, f.path,
           f.archived_at, f.archived_by
      from public.general_draft_files f
      join public.general_drafts d on d.id = f.draft_id
      join public.general_projects gp on gp.id = d.project_id
      left join public.general_spaces gs on gs.id = gp.space_id
      left join public.project_boards b on b.id = gp.class_board_id
      left join public.projects cp on cp.id = b.project_id
      left join public.classes cc on cc.id = cp.class_id
     where d.user_id = auth.uid()
       and f.archived_at is not null and f.trashed_at is null
       and f.action <> 'removed'
       and f.path !~ '(^|/)\.keep$'
       and gp.archived_at is null and gp.trashed_at is null

    union all
    -- Task files in a live work project, for whoever may read that archive.
    select 'work_file', 'work', f.id, f.file_name, t.title, 'task',
           null, null, gs.id, gs.name, gp.id, gp.name, null, null, null,
           f.archived_at, f.archived_by
      from public.general_task_files f
      join public.general_tasks t on t.id = f.task_id
      join public.general_projects gp on gp.id = f.project_id
      left join public.general_spaces gs on gs.id = gp.space_id
     where public.general_task_child_readable(t.id) and f.archived_at is not null and f.trashed_at is null
       and t.archived_at is null
       and gp.archived_at is null and gp.trashed_at is null and gp.class_board_id is null
       and public.general_sees_archived(f.project_id, f.archived_by)

    union all
    -- The caller's own syllabi and curricula.
    select r.kind::text, 'classes', r.id, r.title, r.file_name, null,
           null, null, null, null, null, null, null, null, null,
           r.archived_at, r.professor_id
      from public.teaching_resources r
     where r.professor_id = auth.uid()
       and r.archived_at is not null and r.trashed_at is null
       and public.general_viewer_active()

    union all
    -- Work spaces the caller leads.
    select 'space', 'work', s.id, s.name, nullif(s.description, ''), null,
           null, null, s.id, s.name, null, null, null, null, null,
           s.archived_at, null
      from public.general_spaces s
     where s.kind = 'work' and s.archived_at is not null and s.trashed_at is null
       and public.is_general_space_member(s.id)
       and exists (select 1 from public.general_space_members m
                    where m.space_id = s.id and m.user_id = auth.uid()
                      and m.level in ('owner', 'manager'))

    union all
    -- Space teams the caller runs, in a live space.
    select 'team', 'work', t.id, t.name, nullif(t.description, ''), null,
           null, null, s.id, s.name, null, null, null, null, null,
           t.archived_at, null
      from public.general_space_teams t
      join public.general_spaces s on s.id = t.space_id
     where t.archived_at is not null and t.trashed_at is null
       and s.archived_at is null and s.trashed_at is null
       and public.general_space_team_can_manage(t.id)

    union all
    -- Work projects the caller archived or leads, outside an archived space.
    select 'project', 'work', p.id, p.name, nullif(p.description, ''), null,
           null, null, s.id, s.name, p.id, p.name, null, null, null,
           p.archived_at, p.archived_by
      from public.general_projects p
      left join public.general_spaces s on s.id = p.space_id
     where p.class_board_id is null
       and p.archived_at is not null and p.trashed_at is null
       and (s.id is null or (s.archived_at is null and s.trashed_at is null))
       and ((p.archived_by = auth.uid() and public.is_general_member(p.id))
            or public.general_leads(p.id))

    union all
    -- Work tasks in a live project, for whoever may read that archive.
    select 'work_task', 'work', t.id, t.title,
           case t.status when 'todo' then 'To do' when 'in_progress' then 'In progress' else 'Done' end, null,
           null, null, s.id, s.name, p.id, p.name, null, null, null,
           t.archived_at, t.archived_by
      from public.general_tasks t
      join public.general_projects p on p.id = t.project_id
      left join public.general_spaces s on s.id = p.space_id
     where public.general_task_child_readable(t.id) and t.archived_at is not null and t.trashed_at is null
       and p.archived_at is null and p.trashed_at is null and p.class_board_id is null
       and public.general_sees_archived(t.project_id, t.archived_by)
  )
  select r.kind, r.area, r.id, r.name, r.detail, r.file_source,
         r.class_id, r.class_name, r.space_id, r.space_name,
         r.project_id, r.project_name, r.class_project_id, r.repo_id, r.path,
         r.archived_at, r.archived_by,
         case when r.archived_by is not null then public.display_name(r.archived_by) end,
         case
           when r.kind in ('class_file', 'work_file') and r.file_source = 'draft' then
             case when public.class_board_frozen(gp.class_board_id)
                  then 'The project is closed or handed in, so its files cannot change.' end
           when r.kind = 'work_file' then
             case when not (public.general_can(r.project_id, 'edit_files')
                            or tf.uploaded_by = auth.uid() or tf.archived_by = auth.uid())
                  then 'Only whoever added this file, or somebody who can edit files, can restore it.' end
           when r.kind in ('syllabus', 'curriculum') then null
           else public.archive_restore_block(r.kind, r.id)
         end,
         case
           when r.kind in ('class_file', 'work_file') and r.file_source = 'draft' then
             case when public.class_board_frozen(gp.class_board_id)
                  then 'The project is closed or handed in, so its files cannot change.' end
           when r.kind = 'work_file' then
             case when not (public.general_can(r.project_id, 'edit_files') or tf.uploaded_by = auth.uid())
                  then 'Only whoever added this file, or somebody who can edit files, can move it to Trash.' end
           when r.kind in ('syllabus', 'curriculum') then null
           else public.archive_trash_block(r.kind, r.id)
         end
    from rows r
    left join public.general_projects gp on gp.id = r.project_id and r.file_source = 'draft'
    left join public.general_task_files tf on tf.id = r.id and r.file_source = 'task'
   order by r.archived_at desc, r.name;
$$;

CREATE OR REPLACE FUNCTION public.list_my_trash()
 RETURNS TABLE(kind text, id uuid, repo_id uuid, root text, name text, is_folder boolean, file_count integer, size_bytes bigint, trashed_at timestamp with time zone, purge_at timestamp with time zone, project_id uuid, project_name text, class_project_id uuid, task_title text, frozen boolean, resource_kind text, place_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
as $$
  with drafts as (
    select d.repo_id, d.project_id, f.trash_root,
           max(f.trashed_at) as trashed_at,
           bool_or(f.path <> f.trash_root) as is_folder,
           count(*) filter (where f.path !~ '(^|/)\.keep$')::int as file_count,
           sum(case when f.kind = 'binary'
                    then coalesce((select (o.metadata ->> 'size')::bigint from storage.objects o
                                    where o.bucket_id = 'general-files' and o.name = f.storage_path), 0)
                    else octet_length(f.content) end)::bigint as size_bytes
      from public.general_drafts d
      join public.general_draft_files f on f.draft_id = d.id
     where d.user_id = auth.uid()
       and f.trashed_at is not null
       and public.general_can_write(d.project_id)
     group by d.repo_id, d.project_id, f.trash_root
  ),
  rows as (
    select 'draft'::text as kind, null::uuid as id, x.repo_id, x.trash_root as root,
           regexp_replace(x.trash_root, '^.*/', '') as name,
           x.is_folder, x.file_count, x.size_bytes, x.trashed_at, x.project_id,
           null::text as task_title, null::text as resource_kind,
           null::text as label, null::uuid as place_id
      from drafts x
    union all
    select 'task_file', f.id, null, null, f.file_name, false, 1, f.size_bytes, f.trashed_at,
           f.project_id, t.title, null, null, null
      from public.general_task_files f
      join public.general_tasks t on t.id = f.task_id
     where public.general_task_child_readable(t.id) and f.trashed_by = auth.uid()
       and f.trashed_at is not null
       and public.general_can_write(f.project_id)
    union all
    select 'resource', tr.id, null, null, tr.title, false, 1, tr.size_bytes, tr.trashed_at,
           null, null, tr.kind::text, null, null
      from public.teaching_resources tr
     where tr.professor_id = auth.uid()
       and tr.trashed_at is not null
    union all
    select 'discussion', gd.id, null, null, gd.topic, false, 1, octet_length(gd.content_html)::bigint,
           gd.trashed_at, gd.project_id, null, null, null, null
      from public.general_discussions gd
     where gd.trashed_by = auth.uid()
       and gd.trashed_at is not null
       and public.general_can_write(gd.project_id)
    union all
    select 'class', c.id, null, null, c.name, false, 1, null, c.trashed_at,
           null, null, null, c.initial || ' · ' || c.section, null
      from public.classes c
     where c.trashed_by = auth.uid() and c.trashed_at is not null
    union all
    select 'group', g.id, null, null, g.name, false, 1, null, g.trashed_at,
           null, null, null, c.name, c.id
      from public.groups g
      join public.group_sets s on s.id = g.set_id
      join public.classes c on c.id = s.class_id
     where g.trashed_by = auth.uid() and g.trashed_at is not null
    union all
    select 'class_project', p.id, null, null, p.title, false, 1, null, p.trashed_at,
           null, null, null, c.name, c.id
      from public.projects p
      join public.classes c on c.id = p.class_id
     where p.trashed_by = auth.uid() and p.trashed_at is not null
    union all
    select 'class_task', t.id, null, null, t.title, false, 1, null, t.trashed_at,
           null, null, null, p.title, p.id
      from public.project_tasks t
      join public.project_boards b on b.id = t.board_id
      join public.projects p on p.id = b.project_id
     where t.trashed_by = auth.uid() and t.trashed_at is not null
    union all
    select 'space', s.id, null, null, s.name, false, 1, null, s.trashed_at,
           null, null, null, 'Spaces', null
      from public.general_spaces s
     where s.kind = 'work' and s.trashed_by = auth.uid() and s.trashed_at is not null
    union all
    select 'team', t.id, null, null, t.name, false, 1, null, t.trashed_at,
           null, null, null, s.name, s.id
      from public.general_space_teams t
      join public.general_spaces s on s.id = t.space_id
     where t.trashed_by = auth.uid() and t.trashed_at is not null
    union all
    select 'project', p.id, null, null, p.name, false, 1, null, p.trashed_at,
           null, null, null, coalesce(s.name, 'Projects'), s.id
      from public.general_projects p
      left join public.general_spaces s on s.id = p.space_id
     where p.trashed_by = auth.uid() and p.trashed_at is not null
    union all
    select 'work_task', t.id, null, null, t.title, false, 1, null, t.trashed_at,
           t.project_id, null, null, null, null
      from public.general_tasks t
     where public.general_task_child_readable(t.id) and t.trashed_by = auth.uid() and t.trashed_at is not null
  )
  select r.kind, r.id, r.repo_id, r.root, r.name, r.is_folder, r.file_count, r.size_bytes,
         r.trashed_at, r.trashed_at + interval '30 days',
         r.project_id,
         coalesce(r.label,
                  case r.resource_kind when 'syllabus' then 'Syllabi' when 'curriculum' then 'Curriculum' end,
                  cp.title, gp.name),
         b.project_id,
         r.task_title,
         coalesce(gp.archived_at is not null or public.class_board_frozen(gp.class_board_id), false),
         r.resource_kind,
         r.place_id
    from rows r
    left join public.general_projects gp on gp.id = r.project_id
    left join public.project_boards b on b.id = gp.class_board_id
    left join public.projects cp on cp.id = b.project_id
   order by r.trashed_at desc, r.name;
$$;

CREATE OR REPLACE FUNCTION public.archive_general_task(p_task uuid, p_archived boolean)
 RETURNS general_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
as $$
declare
  t public.general_tasks%rowtype;
begin
  select * into t from public.general_tasks where id = p_task and public.general_task_child_readable(id) for update;
  if not found then
    raise exception 'Task not found' using errcode = 'no_data_found';
  end if;
  if not public.is_general_member(t.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(t.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(t.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if not p_archived and t.archived_at is not null
     and not public.general_sees_archived(t.project_id, t.archived_by) then
    raise exception 'Only whoever archived this, or an Owner or Manager, can restore it.'
      using errcode = 'insufficient_privilege';
  end if;
  if not (
    public.general_can(t.project_id, 'manage_tasks')
    or t.created_by = auth.uid()
    or (not p_archived and t.archived_by = auth.uid())
  ) then
    raise exception '%', case when p_archived
        then 'Only whoever added this task, or someone who manages tasks, can archive it.'
        else 'Only whoever added this task, or someone who manages tasks, can restore it.' end
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_tasks
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then coalesce(archived_by, auth.uid()) else null end
   where id = p_task
   returning * into t;
  perform set_config('collabify.general_archive_op', 'off', true);
  return t;
end;
$$;

CREATE OR REPLACE FUNCTION public.archive_general_task_file(p_file uuid, p_archived boolean)
 RETURNS general_task_files
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
as $$
declare
  f public.general_task_files%rowtype;
begin
  select * into f from public.general_task_files where id = p_file and public.general_task_child_readable(task_id) for update;
  if not found then
    raise exception 'File not found' using errcode = 'no_data_found';
  end if;
  if not public.is_general_member(f.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(f.project_id) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(f.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  if f.trashed_at is not null then
    raise exception 'This file is in Trash. Restore it from Trash first.'
      using errcode = 'check_violation';
  end if;
  if not p_archived and f.archived_at is not null
     and not public.general_sees_archived(f.project_id, f.archived_by) then
    raise exception 'Only whoever archived this, or an Owner or Manager, can restore it.'
      using errcode = 'insufficient_privilege';
  end if;
  if not (public.general_can(f.project_id, 'edit_files') or f.uploaded_by = auth.uid()
          or (not p_archived and f.archived_by = auth.uid())) then
    raise exception 'Only whoever added this file, or somebody who can edit files, can archive it.'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('collabify.general_archive_op', 'on', true);
  update public.general_task_files
     set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
         archived_by = case when p_archived then coalesce(archived_by, auth.uid()) else null end
   where id = p_file
   returning * into f;
  perform set_config('collabify.general_archive_op', 'off', true);
  return f;
end;
$$;

CREATE OR REPLACE FUNCTION public.general_qa_task_waiting(p_task uuid, OUT v_project uuid, OUT v_qa integer)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
as $$
declare
  t  public.general_tasks%rowtype;
  gp public.general_projects%rowtype;
begin
  select * into t from public.general_tasks where id = p_task and public.general_task_released(id) for update;
  if t.id is not null then
    select * into gp from public.general_projects where id = t.project_id;
  end if;
  if t.id is null or gp.id is null
     or gp.class_board_id is not null
     or gp.archived_at is not null
     or t.archived_at is not null
     or auth.uid() is null
     or coalesce(public.general_role_of(gp.id, auth.uid()) not in ('qa', 'pm'), true)
     or public.general_task_stage_at(t.status, t.stage, public.stage_count(gp.stages))
        is distinct from public.general_qa_stage_pick(gp.stages, gp.qa_stage) then
    raise exception 'This task isn''t waiting for QA.' using errcode = 'check_violation';
  end if;
  v_project := gp.id;
  v_qa := public.general_qa_stage_pick(gp.stages, gp.qa_stage);
end;
$$;

create or replace function public.guard_general_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project uuid := case when tg_op = 'INSERT' then new.project_id else old.project_id end;
  -- QA passing a task or moving it back a stage, and changing nothing else.
  v_qa_move boolean := false;
begin
  if auth.uid() is null then
    if tg_op = 'INSERT' then
      new.completed_at := case when new.status = 'done' then now() end;
    end if;
    return new;
  end if;

  if not public.is_general_member(v_project) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if not public.general_can_write(v_project) then
    raise exception 'Stakeholders can view this project but not change it.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists(select 1 from public.general_projects where id=v_project and class_board_id is null)
     and coalesce(current_setting('collabify.work_task_handoff',true),'off')<>'on' then
    if (tg_op='UPDATE' and ((new.routing_state,new.reviewer_id,new.sent_at) is distinct from (old.routing_state,old.reviewer_id,old.sent_at)
        or (old.routing_state='released' and new.team_id is distinct from old.team_id
          and not (pg_trigger_depth()>1 and new.team_id is null
            and not exists(select 1 from public.general_teams where id=old.team_id)))))
       or (tg_op='INSERT' and (new.reviewer_id is not null or new.sent_at is not null or new.routing_state='coordinator_review')) then
      raise exception 'Use the handoff actions to route work.' using errcode='insufficient_privilege';
    end if;
  end if;
  if tg_op = 'INSERT' then
    if public.general_is_archived(new.project_id) then
      raise exception '%', public.general_archived_message(new.project_id)
        using errcode = 'check_violation';
    end if;
    -- QA reports bugs; everything else is somebody else's to create. The role
    -- is read off the membership row, not general_role_of, which sees active
    -- accounts only and would let a pending QA account past.
    if new.kind is distinct from 'bug'
       and exists (select 1 from public.general_members m
                    where m.project_id = new.project_id and m.user_id = auth.uid()
                      and m.role = 'qa') then
      raise exception 'QA creates bug tasks only.'
        using errcode = 'insufficient_privilege';
    end if;
    new.created_by := auth.uid();
    if new.weight <> 1 and not public.general_can(new.project_id, 'manage_tasks') then
      raise exception 'Only someone who manages tasks sets points'
        using errcode = 'insufficient_privilege';
    end if;
    new.completed_at := case when new.status = 'done' then now() end;
    return new;
  end if;

  -- UPDATE
  new.project_id := old.project_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if (new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by)
     and coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on' then
    raise exception 'Archive and restore through the archive buttons.'
      using errcode = 'insufficient_privilege';
  end if;

  if public.general_is_archived(old.project_id) then
    raise exception '%', public.general_archived_message(old.project_id)
      using errcode = 'check_violation';
  end if;

  -- A team delete still cascades team_id to null on an archived task.
  if old.archived_at is not null
     and coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on'
     and not (
       new.team_id is null
       and new.title is not distinct from old.title
       and new.description is not distinct from old.description
       and new.status is not distinct from old.status
       and new.stage is not distinct from old.stage
       and new.due_at is not distinct from old.due_at
       and new.starts_at is not distinct from old.starts_at
       and new.weight is not distinct from old.weight
       and new.kind is not distinct from old.kind
     ) then
    raise exception 'This task is archived. Restore it from the project archive to change it.'
      using errcode = 'check_violation';
  end if;

  -- Task or bug is the task manager's call, holder or not. QA never holds
  -- manage_tasks (general_has gives the qa role nothing), so QA never changes it.
  if new.kind is distinct from old.kind
     and not public.general_can(old.project_id, 'manage_tasks') then
    raise exception 'Only someone who manages tasks changes a task''s kind.'
      using errcode = 'insufficient_privilege';
  end if;

  -- QA holds no tasks, yet moves one out of the QA stage to any stage after it
  -- or back to the stage before it (sync_general_task_stage has already aligned
  -- status and stage and applied the QA gate). Nothing else may change with it.
  if (new.status, new.stage) is distinct from (old.status, old.stage) then
    v_qa_move := public.general_qa_may_move(old.project_id, old.status, old.stage,
                                            new.status, new.stage)
      and (to_jsonb(new) - array['status', 'stage', 'completed_at', 'updated_at', 'qa_entered_at'])
        = (to_jsonb(old) - array['status', 'stage', 'completed_at', 'updated_at', 'qa_entered_at']);
  end if;

  -- archive_general_task decides who may archive; while it holds the flag, the
  -- holder rule below would wrongly stop a creator archiving a task somebody took.
  if not public.general_can(old.project_id, 'manage_tasks')
     and coalesce(current_setting('collabify.work_task_handoff',true),'off')<>'on'
     and coalesce(current_setting('collabify.general_archive_op', true), 'off') <> 'on' then
    if not (
      v_qa_move
      or public.is_general_task_assignee(old.id)
      or (old.created_by = auth.uid() and not public.general_task_held(old.id))
      -- A team leader, for a task somebody on their team holds.
      or exists (
        select 1 from public.general_task_assignees a
         where a.task_id = old.id
           and public.general_leads_user(old.project_id, auth.uid(), a.user_id)
      )
      or (
        -- A team delete cascades into an UPDATE (team_id set null) that runs
        -- under the deleting caller's own auth.uid(), even though referential
        -- actions bypass RLS — BEFORE triggers still fire. Someone who
        -- manages structure but not tasks still needs that cascade to reach
        -- this row, as long as nothing besides team_id actually changed.
        new.team_id is null
        and new.title is not distinct from old.title
        and new.description is not distinct from old.description
        and new.status is not distinct from old.status
        and new.due_at is not distinct from old.due_at
        and new.starts_at is not distinct from old.starts_at
        and new.weight is not distinct from old.weight
        and new.kind is not distinct from old.kind
        and public.general_can(old.project_id, 'manage_structure')
      )
    ) then
      raise exception 'Only whoever holds this task, or someone who manages tasks, can change it'
        using errcode = 'insufficient_privilege';
    end if;
    if new.weight is distinct from old.weight then
      raise exception 'Only someone who manages tasks changes points'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;
-- Work-task tokens must advance even for two writes in the same transaction.
create or replace function public.touch_general_task_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin
  new.updated_at := greatest(clock_timestamp(),old.updated_at + interval '1 microsecond');
  return new;
end $$;
revoke all on function public.touch_general_task_updated_at() from public,anon,authenticated;
drop trigger if exists general_tasks_touch on public.general_tasks;
create trigger general_tasks_touch before update on public.general_tasks
  for each row execute function public.touch_general_task_updated_at();
-- Route changes are explicit, atomic handoffs; regular task edits keep their existing guards.
alter table public.general_task_events drop constraint if exists general_task_events_kind;
alter table public.general_task_events add constraint general_task_events_kind check
  (kind in ('created','updated','assigned','unassigned','qa_passed','qa_sent_back',
            'sent_to_coordinator','returned','sent_to_team','rerouted'));


create or replace function public.send_work_tasks_to_coordinator(p_project uuid, p_rows jsonb, p_coordinator uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  t public.general_tasks%rowtype;
  n int := 0;
  prior_flag text := coalesce(current_setting('collabify.work_task_handoff',true),'off');
begin
  if public.general_role_of(p_project,auth.uid()) is distinct from 'pm' then
    raise exception 'Only the project manager sends work for review.' using errcode='insufficient_privilege';
  end if;
  perform 1 from public.general_projects where id=p_project and class_board_id is null
    and archived_at is null and trashed_at is null for share;
  if not found or public.general_is_archived(p_project) then
    raise exception 'This project cannot receive handoffs. Restore it first.' using errcode='check_violation';
  end if;
  if public.general_role_of(p_project,p_coordinator) is distinct from 'coordinator' then
    raise exception 'Choose an active coordinator on this project.' using errcode='check_violation';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception 'Select tasks to send.' using errcode='invalid_parameter_value';
  end if;
  if jsonb_array_length(p_rows)=0 or exists (
    select 1 from jsonb_to_recordset(p_rows) r(id uuid,updated_at timestamptz)
    group by r.id having r.id is null or count(*)>1) then
    raise exception 'Select each task once.' using errcode='invalid_parameter_value';
  end if;
  for t in select gt.* from public.general_tasks gt
    join jsonb_to_recordset(p_rows) r(id uuid,updated_at timestamptz) on r.id=gt.id
    order by gt.id for update of gt
  loop
    n := n+1;
    if t.project_id<>p_project or t.archived_at is not null or t.trashed_at is not null
       or t.routing_state<>'planning' or public.general_task_held(t.id) then
      raise exception 'Select unassigned planning tasks in this project.' using errcode='check_violation';
    end if;
    if t.updated_at is distinct from (select r.updated_at from jsonb_to_recordset(p_rows) r(id uuid,updated_at timestamptz) where r.id=t.id) then
      raise exception 'A task changed. Reload the tasks and try again.' using errcode='serialization_failure';
    end if;
  end loop;
  if n<>jsonb_array_length(p_rows) then
    raise exception 'A task changed. Reload the tasks and try again.' using errcode='serialization_failure';
  end if;
  perform set_config('collabify.work_task_handoff','on',true);
  for t in select gt.* from public.general_tasks gt
    join jsonb_to_recordset(p_rows) r(id uuid) on r.id=gt.id order by gt.id
  loop
    update public.general_tasks set routing_state='coordinator_review',reviewer_id=p_coordinator,sent_at=clock_timestamp() where id=t.id;
    insert into public.general_task_events(task_id,project_id,actor_id,kind,detail)
      values(t.id,p_project,auth.uid(),'sent_to_coordinator',jsonb_build_object('actor_id',auth.uid(),
        'old_team_id',t.team_id,'new_team_id',t.team_id,'reviewer_id',p_coordinator,'reason',null,'former_holder_ids','[]'::jsonb));
    insert into public.notifications(user_id,type,general_project_id,general_task_id,title,preview)
      select p_coordinator,'work_task_handoff'::public.notification_type,p_project,t.id,'Review '||t.title,'Tasks are ready for your review.'
      from public.notification_prefs np where np.user_id=p_coordinator and np.task_assignments and p_coordinator<>auth.uid();
  end loop;
  perform set_config('collabify.work_task_handoff',prior_flag,true);
  return n;
end $$;

create or replace function public.send_work_tasks_to_teams(p_project uuid, p_rows jsonb, p_reason text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  t public.general_tasks%rowtype;
  gp public.general_projects%rowtype;
  destination uuid;
  lead_id uuid;
  holders uuid[];
  n int := 0;
  reason text := nullif(btrim(p_reason),'');
  prior_flag text := coalesce(current_setting('collabify.work_task_handoff',true),'off');
begin
  if coalesce(public.general_role_of(p_project,auth.uid()) not in ('pm','coordinator'),true) then
    raise exception 'Only the project manager or a coordinator sends work to teams.' using errcode='insufficient_privilege';
  end if;
  select * into gp from public.general_projects where id=p_project and class_board_id is null
    and archived_at is null and trashed_at is null for share;
  if not found or public.general_is_archived(p_project) then
    raise exception 'This project cannot receive handoffs. Restore it first.' using errcode='check_violation';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then
    raise exception 'Select tasks to send.' using errcode='invalid_parameter_value';
  end if;
  if jsonb_array_length(p_rows)=0 or exists (
    select 1 from jsonb_to_recordset(p_rows) r(id uuid,team_id uuid,updated_at timestamptz)
    group by r.id having r.id is null or count(*)>1) then
    raise exception 'Select each task once.' using errcode='invalid_parameter_value';
  end if;
  for t in select gt.* from public.general_tasks gt
    join jsonb_to_recordset(p_rows) r(id uuid,team_id uuid,updated_at timestamptz) on r.id=gt.id
    order by gt.id for update of gt
  loop
    n := n+1;
    if t.project_id<>p_project or t.archived_at is not null or t.trashed_at is not null then
      raise exception 'Select live tasks in this project.' using errcode='check_violation';
    end if;
    if t.updated_at is distinct from (select r.updated_at from jsonb_to_recordset(p_rows) r(id uuid,updated_at timestamptz) where r.id=t.id) then
      raise exception 'A task changed. Reload the tasks and try again.' using errcode='serialization_failure';
    end if;
    select r.team_id into destination from jsonb_to_recordset(p_rows) r(id uuid,team_id uuid) where r.id=t.id;
    select g.leader_id into lead_id from public.general_teams g
      join public.general_team_members tm on tm.team_id=g.id and tm.user_id=g.leader_id and tm.project_id=p_project
      join public.general_members m on m.project_id=p_project and m.user_id=g.leader_id
      join public.profiles pr on pr.id=m.user_id
      where g.id=destination and g.project_id=p_project and pr.status='active' and m.role<>'stakeholder'
      for share of g;
    if not found then
      raise exception 'Choose a team with an active lead on this project.' using errcode='check_violation';
    end if;
    if t.routing_state='released' then
      if reason is null then
        raise exception 'Give a reason for rerouting released work.' using errcode='check_violation';
      end if;
      if public.general_task_stage_at(t.status,t.stage,public.stage_count(gp.stages)) >= public.general_qa_stage_pick(gp.stages,gp.qa_stage) then
        raise exception 'Reopen work in QA or Done before rerouting it.' using errcode='check_violation';
      end if;
    elsif public.general_task_held(t.id) then
      raise exception 'Remove planning task holders before sending it.' using errcode='check_violation';
    end if;
  end loop;
  if n<>jsonb_array_length(p_rows) then
    raise exception 'A task changed. Reload the tasks and try again.' using errcode='serialization_failure';
  end if;
  perform set_config('collabify.work_task_handoff','on',true);
  for t in select gt.* from public.general_tasks gt
    join jsonb_to_recordset(p_rows) r(id uuid) on r.id=gt.id order by gt.id
  loop
    select r.team_id into destination from jsonb_to_recordset(p_rows) r(id uuid,team_id uuid) where r.id=t.id;
    select coalesce(array_agg(a.user_id order by a.user_id),'{}'::uuid[]) into holders from public.general_task_assignees a where a.task_id=t.id;
    delete from public.general_task_assignees where task_id=t.id;
    update public.general_tasks set routing_state='released',team_id=destination,reviewer_id=null,sent_at=clock_timestamp() where id=t.id;
    insert into public.general_task_events(task_id,project_id,actor_id,kind,detail)
      values(t.id,p_project,auth.uid(),case when t.routing_state='released' then 'rerouted' else 'sent_to_team' end,
        jsonb_build_object('actor_id',auth.uid(),'old_team_id',t.team_id,'new_team_id',destination,
          'reviewer_id',t.reviewer_id,'reason',reason,'former_holder_ids',to_jsonb(holders)));
    insert into public.notifications(user_id,type,general_project_id,general_task_id,title,preview)
      select distinct m.user_id,'work_task_handoff'::public.notification_type,p_project,t.id,
        case when t.routing_state='released' then 'Rerouted: ' else 'Incoming: ' end||t.title,
        coalesce(left(reason,140),'Your team has incoming work.')
      from public.general_teams g
      join public.general_team_members tm on tm.team_id=g.id and tm.project_id=p_project
      join public.general_members m on m.project_id=p_project and m.user_id=tm.user_id
      join public.profiles pr on pr.id=m.user_id
      join public.notification_prefs np on np.user_id=m.user_id and np.task_assignments
      where g.project_id=p_project and pr.status='active' and m.user_id<>auth.uid()
        and ((t.routing_state='released' and g.id in(t.team_id,destination))
          or (g.id=destination and g.leader_id=m.user_id));
  end loop;
  perform set_config('collabify.work_task_handoff',prior_flag,true);
  return n;
end $$;

create or replace function public.return_work_task(p_task uuid,p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.general_tasks%rowtype;
  recipient uuid;
  reason text := nullif(btrim(p_reason),'');
  prior_flag text := coalesce(current_setting('collabify.work_task_handoff',true),'off');
begin
  if auth.uid() is null or reason is null then
    raise exception 'Give a reason for returning this task.' using errcode='check_violation';
  end if;
  select * into t from public.general_tasks where id=p_task;
  if not found or t.archived_at is not null or t.trashed_at is not null then
    raise exception 'Choose a live task to return.' using errcode='check_violation';
  end if;
  perform 1 from public.general_projects where id=t.project_id and class_board_id is null
    and archived_at is null and trashed_at is null for share;
  if not found or public.general_is_archived(t.project_id) then
    raise exception 'This project cannot receive handoffs. Restore it first.' using errcode='check_violation';
  end if;
  select * into t from public.general_tasks where id=p_task for update;
  if not found or t.archived_at is not null or t.trashed_at is not null then
    raise exception 'Choose a live task to return.' using errcode='check_violation';
  end if;
  if t.routing_state='released' and exists (
    select 1 from public.general_projects gp where gp.id=t.project_id
      and public.general_task_stage_at(t.status,t.stage,public.stage_count(gp.stages)) >= public.general_qa_stage_pick(gp.stages,gp.qa_stage)) then
    raise exception 'Reopen work in QA or Done before returning it.' using errcode='check_violation';
  end if;
  if not coalesce((
    (t.routing_state='coordinator_review' and t.reviewer_id=auth.uid()
      and public.general_role_of(t.project_id,auth.uid())='coordinator')
    or (t.routing_state='released' and not public.general_task_held(t.id)
      and exists(select 1 from public.general_teams g
        join public.general_team_members tm on tm.team_id=g.id and tm.user_id=g.leader_id
        where g.id=t.team_id and g.project_id=t.project_id and g.leader_id=auth.uid())
      and public.general_role_of(t.project_id,auth.uid()) in ('pm','coordinator','member','qa'))
  ),false) then
    raise exception 'Only its reviewer or receiving lead can return unassigned work.' using errcode='insufficient_privilege';
  end if;
  select user_id into recipient from public.general_members m
    join public.profiles pr on pr.id=m.user_id where m.project_id=t.project_id and m.role='pm' and pr.status='active';
  perform set_config('collabify.work_task_handoff','on',true);
  update public.general_tasks set routing_state='planning',reviewer_id=null,sent_at=null where id=t.id;
  insert into public.general_task_events(task_id,project_id,actor_id,kind,detail)
    values(t.id,t.project_id,auth.uid(),'returned',jsonb_build_object('actor_id',auth.uid(),
      'old_team_id',t.team_id,'new_team_id',t.team_id,'reviewer_id',t.reviewer_id,'reason',reason,'former_holder_ids','[]'::jsonb,
      'return_source',case when t.routing_state='released' then 'team' else 'coordinator' end));
  insert into public.notifications(user_id,type,general_project_id,general_task_id,title,preview)
    select recipient,'work_task_handoff'::public.notification_type,t.project_id,t.id,'Returned: '||t.title,left(reason,140)
    from public.notification_prefs np where np.user_id=recipient and np.task_assignments and recipient<>auth.uid();
  perform set_config('collabify.work_task_handoff',prior_flag,true);
end $$;
revoke all on function public.send_work_tasks_to_coordinator(uuid,jsonb,uuid),public.send_work_tasks_to_teams(uuid,jsonb,text),public.return_work_task(uuid,text) from public,anon;
grant execute on function public.send_work_tasks_to_coordinator(uuid,jsonb,uuid),public.send_work_tasks_to_teams(uuid,jsonb,text),public.return_work_task(uuid,text) to authenticated;

-- A return receipt remains available without reopening the private task or its history.
create or replace function public.work_task_return_receipts(p_project uuid)
returns table(task_id uuid,returned_at timestamptz,reason text)
language plpgsql stable security definer set search_path=public as $$
begin
  if auth.uid() is null or public.general_role_of(p_project,auth.uid()) is null
     or not public.can_read_general_project(p_project) then
    raise exception 'You are not on this project.' using errcode='insufficient_privilege';
  end if;
  return query select e.task_id,e.created_at,e.detail->>'reason'
    from public.general_task_events e
    where e.project_id=p_project and e.actor_id=auth.uid() and e.kind='returned'
      and e.detail->>'return_source'='team'
    order by e.created_at desc,e.id;
end $$;
revoke all on function public.work_task_return_receipts(uuid) from public,anon;
grant execute on function public.work_task_return_receipts(uuid) to authenticated;
commit;
