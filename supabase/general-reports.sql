-- Collabify — General workplace reports.
--
--   node scripts/db.mjs supabase/general-reports.sql
--
-- Who did what, when, for one project or a whole space, over any date range.
-- Everything a report shows is computed here, in security definer functions,
-- so the access rule lives in one place:
--
--   A lead — the project's Owner or Manager, or an Owner or Manager of the
--   space that holds it — sees everyone. Anybody else who can read the project
--   gets a report locked to their own work: project-wide totals (which the
--   Progress tab already shows every reader) and their own rows, never another
--   person's name, note or comment text.
--
-- Archived work follows the archive rules already in place: an archived task or
-- project appears only when the report asks for archived work *and* the viewer
-- may see it. Drafts are private to their author and never reported. Comment
-- bodies are never returned — only that a comment was made, and its length.
--
-- Also adds general_project_events, a history of what general_task_events does
-- not record (archiving, project status, membership), written by triggers from
-- the day this file first runs; and general_report_templates, saved report
-- configurations.
--
-- Run after supabase/general-project-archive-rbac.sql — last in the chain.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.general_report_settings (
  id            int primary key default 1,
  history_since timestamptz not null default now(),
  constraint general_report_settings_one check (id = 1)
);

insert into public.general_report_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.general_project_events (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.general_projects (id) on delete cascade,
  task_id    uuid references public.general_tasks (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  subject_id uuid references public.profiles (id) on delete set null,
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint general_project_events_kind check (kind in (
    'task_archived', 'task_restored', 'project_status', 'project_archived',
    'project_restored', 'member_joined', 'member_left', 'member_removed', 'member_level'))
);

create index if not exists general_project_events_project_idx
  on public.general_project_events (project_id, created_at);
create index if not exists general_project_events_actor_idx
  on public.general_project_events (actor_id, created_at);

create table if not exists public.general_report_templates (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.general_spaces (id) on delete cascade,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null,
  description text not null default '',
  shared      boolean not null default false,
  config      jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint general_report_templates_name check (char_length(btrim(name)) between 1 and 80),
  constraint general_report_templates_description check (char_length(description) <= 280),
  constraint general_report_templates_config check (jsonb_typeof(config) = 'object')
);

create index if not exists general_report_templates_space_idx
  on public.general_report_templates (space_id, owner_id);

-- What the report queries filter on.
create index if not exists general_task_logs_project_day_idx
  on public.general_task_logs (project_id, logged_on);
create index if not exists general_task_comments_project_at_idx
  on public.general_task_comments (project_id, created_at);
create index if not exists general_commits_repo_at_idx
  on public.general_commits (repo_id, created_at);
create index if not exists general_repo_changes_project_at_idx
  on public.general_repo_changes (project_id, created_at);
create index if not exists general_task_events_project_at_idx
  on public.general_task_events (project_id, created_at);
create index if not exists general_task_events_task_at_idx
  on public.general_task_events (task_id, created_at);
create index if not exists general_task_files_project_at_idx
  on public.general_task_files (project_id, created_at);

commit;

begin;

-- ---------------------------------------------------------------- access

/** Owner or Manager of the project, or of the space that holds it. */
create or replace function public.general_report_is_lead(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.general_leads(p_project)
      or exists (
        select 1
          from public.general_projects p
          join public.general_space_members m on m.space_id = p.space_id
          join public.profiles pr on pr.id = m.user_id
         where p.id = p_project
           and m.user_id = auth.uid()
           and m.level in ('owner', 'manager')
           and pr.status <> 'rejected'
      );
$$;

create or replace function public.general_report_can_read(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.can_read_general_project(p_project), false);
$$;

/** The first moment general_project_events covers. */
create or replace function public.general_report_history_since()
returns timestamptz language sql stable security definer set search_path = public as $$
  select least(
    (select history_since from public.general_report_settings where id = 1),
    coalesce((select min(created_at) from public.general_project_events), 'infinity'::timestamptz)
  );
$$;

/** The projects a report covers, and whether the caller leads each one. */
create or replace function public.general_report_projects(
  p_space uuid, p_projects uuid[], p_include_archived boolean
) returns table (project_id uuid, is_lead boolean)
language sql stable security definer set search_path = public as $$
  select p.id, public.general_report_is_lead(p.id)
    from public.general_projects p
   where p.space_id = p_space
     and (p_projects is null or cardinality(p_projects) = 0 or p.id = any (p_projects))
     and (p.archived_at is null or coalesce(p_include_archived, false))
     and public.general_report_can_read(p.id);
$$;

/**
 * Whose work a report may show in one project. Null means everybody, which only
 * a lead with no person or team filter gets; anybody else gets themselves.
 */
create or replace function public.general_report_people_of(
  p_project uuid, p_lead boolean, p_people uuid[], p_teams uuid[]
) returns uuid[]
language sql stable security definer set search_path = public as $$
  select case
    when not p_lead then array[auth.uid()]
    when coalesce(cardinality(p_people), 0) = 0 and coalesce(cardinality(p_teams), 0) = 0 then null
    else array(
      select u from unnest(coalesce(p_people, '{}'::uuid[])) u
      union
      select tm.user_id from public.general_team_members tm
       where tm.project_id = p_project and tm.team_id = any (coalesce(p_teams, '{}'::uuid[]))
      union
      select stm.user_id from public.general_space_team_members stm
       where stm.team_id = any (coalesce(p_teams, '{}'::uuid[]))
    )
  end;
$$;

/** A person's name, or null when the caller may not see it. */
create or replace function public.general_report_name(p_user uuid, p_lead boolean)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_user is null then null
    when p_lead or p_user = auth.uid() then
      (select btrim(first_name || ' ' || last_name) from public.profiles where id = p_user)
  end;
$$;

/** Whether a task belongs in a report: live, or archived and asked for and visible. */
create or replace function public.general_report_task_ok(
  p_archived_at timestamptz, p_task uuid, p_include_archived boolean
) returns boolean language sql stable security definer set search_path = public as $$
  select p_archived_at is null
      or (coalesce(p_include_archived, false) and not public.general_task_hidden(p_task));
$$;

-- ---------------------------------------------------------------- history

alter table public.general_project_events enable row level security;

drop policy if exists general_project_events_select on public.general_project_events;
create policy general_project_events_select on public.general_project_events
  for select using (
    public.general_report_can_read(project_id)
    and (public.general_report_is_lead(project_id)
         or actor_id = auth.uid() or subject_id = auth.uid())
    and (task_id is null or not public.general_task_hidden(task_id))
  );

revoke all on public.general_project_events from public, anon;
grant select on public.general_project_events to authenticated;

create or replace function public.log_general_task_archive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.archived_at is null) <> (new.archived_at is null) then
    insert into public.general_project_events (project_id, task_id, actor_id, kind, detail)
    values (new.project_id, new.id, auth.uid(),
            case when new.archived_at is null then 'task_restored' else 'task_archived' end,
            jsonb_build_object('title', new.title));
  end if;
  return new;
end;
$$;

drop trigger if exists general_tasks_archive_event on public.general_tasks;
create trigger general_tasks_archive_event after update of archived_at on public.general_tasks
  for each row execute function public.log_general_task_archive();

create or replace function public.log_general_project_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- delete_general_project briefly restores a project before removing it.
  if current_setting('collabify.general_project_delete', true) = new.id::text then
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.general_project_events (project_id, actor_id, kind, detail)
    values (new.id, auth.uid(), 'project_status',
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if (old.archived_at is null) <> (new.archived_at is null) then
    insert into public.general_project_events (project_id, actor_id, kind)
    values (new.id, auth.uid(),
            case when new.archived_at is null then 'project_restored' else 'project_archived' end);
  end if;
  return new;
end;
$$;

drop trigger if exists general_projects_report_event on public.general_projects;
create trigger general_projects_report_event after update on public.general_projects
  for each row execute function public.log_general_project_change();

create or replace function public.log_general_member_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.general_project_events (project_id, actor_id, subject_id, kind, detail)
    values (new.project_id, auth.uid(), new.user_id, 'member_joined',
            jsonb_build_object('level', new.level));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.level is distinct from old.level then
      insert into public.general_project_events (project_id, actor_id, subject_id, kind, detail)
      values (new.project_id, auth.uid(), new.user_id, 'member_level',
              jsonb_build_object('from', old.level, 'to', new.level));
    end if;
    return new;
  end if;

  -- A cascade from a deleted project or profile records nothing: the project
  -- is going, or the person is.
  if pg_trigger_depth() > 1
     or not exists (select 1 from public.general_projects where id = old.project_id) then
    return old;
  end if;
  insert into public.general_project_events (project_id, actor_id, subject_id, kind)
  values (old.project_id, auth.uid(), old.user_id,
          case when auth.uid() = old.user_id then 'member_left' else 'member_removed' end);
  return old;
end;
$$;

drop trigger if exists general_members_report_event on public.general_members;
create trigger general_members_report_event after insert or update or delete on public.general_members
  for each row execute function public.log_general_member_change();

-- ---------------------------------------------------------------- templates

alter table public.general_report_templates enable row level security;

drop policy if exists general_report_templates_select on public.general_report_templates;
create policy general_report_templates_select on public.general_report_templates
  for select using (
    owner_id = auth.uid()
    or (shared and public.is_general_space_member(space_id))
  );

drop policy if exists general_report_templates_insert on public.general_report_templates;
create policy general_report_templates_insert on public.general_report_templates
  for insert with check (
    owner_id = auth.uid()
    and public.is_general_space_member(space_id)
    and not public.general_space_is_archived(space_id)
  );

drop policy if exists general_report_templates_update on public.general_report_templates;
create policy general_report_templates_update on public.general_report_templates
  for update using (owner_id = auth.uid() or public.general_space_has_manage(space_id))
  with check (owner_id = auth.uid() or public.general_space_has_manage(space_id));

drop policy if exists general_report_templates_delete on public.general_report_templates;
create policy general_report_templates_delete on public.general_report_templates
  for delete using (owner_id = auth.uid() or public.general_space_has_manage(space_id));

revoke all on public.general_report_templates from public, anon;
grant select, insert, update, delete on public.general_report_templates to authenticated;

create or replace function public.guard_general_report_template()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.space_id := old.space_id;
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
    return new;
  end if;
  if (select count(*) from public.general_report_templates
       where space_id = new.space_id and owner_id = new.owner_id) >= 50 then
    raise exception 'You have 50 saved reports in this space. Delete one to save another.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists general_report_templates_guard on public.general_report_templates;
create trigger general_report_templates_guard before insert or update on public.general_report_templates
  for each row execute function public.guard_general_report_template();

drop trigger if exists general_report_templates_touch on public.general_report_templates;
create trigger general_report_templates_touch before update on public.general_report_templates
  for each row execute function public.touch_updated_at();

commit;

begin;

-- ---------------------------------------------------------------- report RPCs

-- Common parameters, the same name everywhere:
--   p_space            the space the report is about
--   p_projects         the projects in it to include; null or empty = all readable
--   p_from, p_to       the range, from inclusive, to exclusive
--   p_people, p_teams  whose work; honoured for leads only
--   p_include_archived whether archived tasks and projects may appear
--   p_tz               the viewer's time zone, for days
--
-- `set jit = off` on each: compiling these plans took longer than running them
-- (about 0.8 s against 0.1 s on a 5,000-task project).

/** Which projects a report can cover, and whether each is full or the caller's own work. */
create or replace function public.general_report_scope(p_space uuid, p_projects uuid[] default null)
returns table (
  project_id uuid, name text, status text, archived boolean, is_lead boolean,
  points_enabled boolean, starts_on date, ends_on date, member_count int
)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.status::text, p.archived_at is not null,
         public.general_report_is_lead(p.id), p.points_enabled, p.starts_on, p.ends_on,
         (select count(*) from public.general_members m where m.project_id = p.id)::int
    from public.general_projects p
   where p.space_id = p_space
     and (p_projects is null or cardinality(p_projects) = 0 or p.id = any (p_projects))
     and public.general_report_can_read(p.id)
   order by p.archived_at is not null, lower(p.name);
$$;

create or replace function public.general_report_summary(
  p_space uuid, p_projects uuid[], p_from timestamptz, p_to timestamptz,
  p_people uuid[] default null, p_teams uuid[] default null,
  p_include_archived boolean default false, p_tz text default 'UTC'
) returns table (
  project_id uuid, tasks_total int, todo int, in_progress int, done int,
  done_in_range int, created_in_range int, overdue_now int, due_in_range int,
  points_total numeric, points_done numeric, minutes_in_range int, comments_in_range int,
  files_in_range int, commits_in_range int, reviews_opened int, reviews_applied int,
  reviews_declined int, members_active int
)
language sql stable security definer set search_path = public set jit = off as $$
  with pj as (
    select s.project_id, s.is_lead,
           public.general_report_people_of(s.project_id, s.is_lead, p_people, p_teams) as ppl
      from public.general_report_projects(p_space, p_projects, p_include_archived) s
  ),
  -- Totals are project-wide for a member; a lead's person filter narrows them
  -- to tasks held by those people.
  tk as (
    select t.*, pj.ppl, pj.is_lead
      from pj join public.general_tasks t on t.project_id = pj.project_id
     where public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
       and (not pj.is_lead or pj.ppl is null or exists (
             select 1 from public.general_task_assignees a
              where a.task_id = t.id and a.user_id = any (pj.ppl)))
  ),
  act as (
    select pj.project_id, l.user_id as who, l.created_at as at, 'log' as src, l.minutes as n
      from pj join public.general_task_logs l on l.project_id = pj.project_id
      join public.general_tasks t on t.id = l.task_id
     where l.logged_on >= (p_from at time zone p_tz)::date
       and l.logged_on < (p_to at time zone p_tz)::date
       and (pj.ppl is null or l.user_id = any (pj.ppl))
       and public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
    union all
    select pj.project_id, c.author_id, c.created_at, 'comment', 1
      from pj join public.general_task_comments c on c.project_id = pj.project_id
      join public.general_tasks t on t.id = c.task_id
     where c.created_at >= p_from and c.created_at < p_to
       and (pj.ppl is null or c.author_id = any (pj.ppl))
       and public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
    union all
    select pj.project_id, f.uploaded_by, f.created_at, 'file', 1
      from pj join public.general_task_files f on f.project_id = pj.project_id
      join public.general_tasks t on t.id = f.task_id
     where f.created_at >= p_from and f.created_at < p_to
       and (pj.ppl is null or f.uploaded_by = any (pj.ppl))
       and (f.archived_at is null or coalesce(p_include_archived, false))
       and public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
    union all
    select pj.project_id, cm.author_id, cm.created_at, 'commit', 1
      from pj join public.general_commits cm on cm.project_id = pj.project_id
     where cm.created_at >= p_from and cm.created_at < p_to
       and (pj.ppl is null or cm.author_id = any (pj.ppl))
    union all
    select pj.project_id, ch.author_id, ch.created_at, 'review_opened', 1
      from pj join public.general_repo_changes ch on ch.project_id = pj.project_id
     where ch.created_at >= p_from and ch.created_at < p_to
       and (pj.ppl is null or ch.author_id = any (pj.ppl) or ch.reviewer_id = any (pj.ppl))
    union all
    select pj.project_id, coalesce(ch.decided_by, ch.author_id), ch.decided_at,
           'review_' || ch.status::text, 1
      from pj join public.general_repo_changes ch on ch.project_id = pj.project_id
     where ch.decided_at >= p_from and ch.decided_at < p_to
       and ch.status in ('applied', 'declined')
       and (pj.ppl is null or ch.author_id = any (pj.ppl) or ch.decided_by = any (pj.ppl))
    union all
    select pj.project_id, e.actor_id, e.created_at, 'task_event', 1
      from pj join public.general_task_events e on e.project_id = pj.project_id
      join public.general_tasks t on t.id = e.task_id
     where e.created_at >= p_from and e.created_at < p_to
       and (pj.ppl is null or e.actor_id = any (pj.ppl))
       and public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
  )
  , tk_sum as (
    select tk.project_id,
           count(*)::int as tasks_total,
           count(*) filter (where tk.status = 'todo')::int as todo,
           count(*) filter (where tk.status = 'in_progress')::int as in_progress,
           count(*) filter (where tk.status = 'done')::int as done,
           count(*) filter (where tk.status = 'done' and tk.completed_at >= p_from and tk.completed_at < p_to)::int as done_in_range,
           count(*) filter (where tk.created_at >= p_from and tk.created_at < p_to)::int as created_in_range,
           count(*) filter (where tk.status <> 'done' and tk.archived_at is null and tk.due_at < now())::int as overdue_now,
           count(*) filter (where tk.due_at >= p_from and tk.due_at < p_to)::int as due_in_range,
           coalesce(sum(tk.weight), 0)::numeric as points_total,
           coalesce(sum(tk.weight) filter (where tk.status = 'done'), 0)::numeric as points_done
      from tk group by tk.project_id
  ),
  act_sum as (
    select act.project_id,
           coalesce(sum(n) filter (where src = 'log'), 0)::int as minutes,
           count(*) filter (where src = 'comment')::int as comments,
           count(*) filter (where src = 'file')::int as files,
           count(*) filter (where src = 'commit')::int as commits,
           count(*) filter (where src = 'review_opened')::int as opened,
           count(*) filter (where src = 'review_applied')::int as applied,
           count(*) filter (where src = 'review_declined')::int as declined,
           count(distinct who)::int as active
      from act group by act.project_id
  )
  select pj.project_id,
         coalesce(t.tasks_total, 0), coalesce(t.todo, 0), coalesce(t.in_progress, 0), coalesce(t.done, 0),
         coalesce(t.done_in_range, 0), coalesce(t.created_in_range, 0), coalesce(t.overdue_now, 0),
         coalesce(t.due_in_range, 0), coalesce(t.points_total, 0), coalesce(t.points_done, 0),
         coalesce(a.minutes, 0), coalesce(a.comments, 0), coalesce(a.files, 0), coalesce(a.commits, 0),
         coalesce(a.opened, 0), coalesce(a.applied, 0), coalesce(a.declined, 0), coalesce(a.active, 0)
    from pj
    left join tk_sum t on t.project_id = pj.project_id
    left join act_sum a on a.project_id = pj.project_id;
$$;

/**
 * Done and total, per project per day, rebuilt from the task history: a task's
 * status on a day is what its first status change after that day changed it
 * from, or its status now when nothing changed since. Tasks archived now are
 * left out of every day unless archived work is asked for.
 */
create or replace function public.general_report_progress_series(
  p_space uuid, p_projects uuid[], p_from timestamptz, p_to timestamptz,
  p_people uuid[] default null, p_teams uuid[] default null,
  p_include_archived boolean default false, p_tz text default 'UTC'
) returns table (
  project_id uuid, day date, done_count int, total_count int,
  done_points numeric, total_points numeric
)
language sql stable security definer set search_path = public set jit = off as $$
  with pj as (
    select s.project_id, s.is_lead,
           public.general_report_people_of(s.project_id, s.is_lead, p_people, p_teams) as ppl
      from public.general_report_projects(p_space, p_projects, p_include_archived) s
  ),
  days as (
    select d::date as day,
           ((d::date + 1)::timestamp at time zone p_tz) as day_end
      from generate_series((p_from at time zone p_tz)::date,
                           ((p_to at time zone p_tz) - interval '1 microsecond')::date,
                           interval '1 day') d
  ),
  tk as (
    select t.id, t.project_id, t.created_at, t.status::text as status_now, t.weight
      from pj join public.general_tasks t on t.project_id = pj.project_id
     where public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
       and (not pj.is_lead or pj.ppl is null or exists (
             select 1 from public.general_task_assignees a
              where a.task_id = t.id and a.user_id = any (pj.ppl)))
  ),
  -- Only tasks whose status changed after the first day need looking back at.
  moved as (
    select distinct e.task_id
      from public.general_task_events e
      join tk on tk.id = e.task_id
     where e.kind = 'updated' and e.detail ? 'status_from'
       and e.created_at >= (select min(day_end) from days)
  ),
  state as (
    select tk.project_id, days.day, tk.weight,
           case when m.task_id is null then tk.status_now
           else coalesce((
             select e.detail->>'status_from'
               from public.general_task_events e
              where e.task_id = tk.id and e.created_at >= days.day_end
                and e.kind = 'updated' and e.detail ? 'status_from'
              order by e.created_at
              limit 1), tk.status_now) end as status_then
      from tk
      join days on tk.created_at < days.day_end
      left join moved m on m.task_id = tk.id
  ),
  agg as (
    select s.project_id, s.day,
           count(*) filter (where s.status_then = 'done')::int as done_count,
           count(*)::int as total_count,
           coalesce(sum(s.weight) filter (where s.status_then = 'done'), 0)::numeric as done_points,
           coalesce(sum(s.weight), 0)::numeric as total_points
      from state s group by s.project_id, s.day
  )
  select pj.project_id, days.day,
         coalesce(a.done_count, 0), coalesce(a.total_count, 0),
         coalesce(a.done_points, 0), coalesce(a.total_points, 0)
    from pj cross join days
    left join agg a on a.project_id = pj.project_id and a.day = days.day
   order by pj.project_id, days.day;
$$;

create or replace function public.general_report_people(
  p_space uuid, p_projects uuid[], p_from timestamptz, p_to timestamptz,
  p_people uuid[] default null, p_teams uuid[] default null,
  p_include_archived boolean default false, p_tz text default 'UTC'
) returns table (
  project_id uuid, user_id uuid, name text, level text, teams text[],
  tasks_held_now int, tasks_finished_in_range int, tasks_finished_late int,
  points_finished numeric, minutes_logged int, comments int, files_uploaded int,
  commits int, files_changed int, reviews_requested int, reviews_done int,
  reviews_applied_as_author int, first_activity timestamptz, last_activity timestamptz
)
language sql stable security definer set search_path = public set jit = off as $$
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
     where l.logged_on >= (p_from at time zone p_tz)::date and l.logged_on < (p_to at time zone p_tz)::date
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
     where l.logged_on >= (p_from at time zone p_tz)::date and l.logged_on < (p_to at time zone p_tz)::date
    union all
    select c.project_id, c.author_id, c.created_at
      from public.general_task_comments c join people pe on pe.project_id = c.project_id and pe.user_id = c.author_id
     where c.created_at >= p_from and c.created_at < p_to
    union all
    select cm.project_id, cm.author_id, cm.created_at
      from public.general_commits cm join people pe on pe.project_id = cm.project_id and pe.user_id = cm.author_id
     where cm.created_at >= p_from and cm.created_at < p_to
    union all
    select e.project_id, e.actor_id, e.created_at
      from public.general_task_events e join people pe on pe.project_id = e.project_id and pe.user_id = e.actor_id
     where e.created_at >= p_from and e.created_at < p_to
    union all
    select f.project_id, f.uploaded_by, f.created_at
      from public.general_task_files f join people pe on pe.project_id = f.project_id and pe.user_id = f.uploaded_by
     where f.created_at >= p_from and f.created_at < p_to
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
             and (f.archived_at is null or coalesce(p_include_archived, false))
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

/**
 * Everything that happened, newest first, a page at a time. Pass the last row's
 * (at, id) as (p_before, p_before_id) for the next page. `total` counts the
 * whole feed, so a page can say how much it shows.
 */
create or replace function public.general_report_activity(
  p_space uuid, p_projects uuid[], p_from timestamptz, p_to timestamptz,
  p_people uuid[] default null, p_teams uuid[] default null,
  p_include_archived boolean default false, p_tz text default 'UTC',
  p_kinds text[] default null, p_before timestamptz default null,
  p_before_id uuid default null, p_limit int default 200
) returns table (
  at timestamptz, id uuid, project_id uuid, actor_id uuid, actor_name text,
  subject_id uuid, subject_name text, kind text, task_id uuid, task_title text,
  detail jsonb, total bigint
)
language sql stable security definer set search_path = public set jit = off as $$
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
       and (f.archived_at is null or coalesce(p_include_archived, false))
       and public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
    union all
    select f.archived_at, f.id, f.project_id, f.archived_by, null, 'file_archived', f.task_id,
           jsonb_build_object('file_name', f.file_name), pj.is_lead, pj.ppl
      from pj join public.general_task_files f on f.project_id = pj.project_id
      join public.general_tasks t on t.id = f.task_id
     where f.archived_at >= p_from and f.archived_at < p_to
       and coalesce(p_include_archived, false)
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
       and (pe.task_id is null or not public.general_task_hidden(pe.task_id))
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

/**
 * Tasks active at some point in the range: made before it ends, and not already
 * finished before it began. A member sees only tasks they hold. Capped at 2,000
 * rows; `truncated` says when there were more.
 */
create or replace function public.general_report_tasks(
  p_space uuid, p_projects uuid[], p_from timestamptz, p_to timestamptz,
  p_people uuid[] default null, p_teams uuid[] default null,
  p_include_archived boolean default false, p_tz text default 'UTC'
) returns table (
  task_id uuid, project_id uuid, title text, status text, team text,
  holders text[], holder_count int, created_by text, created_at timestamptz,
  starts_at timestamptz, due_at timestamptz, completed_at timestamptz, late boolean,
  weight numeric, minutes_in_range int, minutes_total int, comments int, files int,
  archived boolean, truncated boolean
)
language sql stable security definer set search_path = public set jit = off as $$
  with pj as (
    select s.project_id, s.is_lead,
           public.general_report_people_of(s.project_id, s.is_lead, p_people, p_teams) as ppl
      from public.general_report_projects(p_space, p_projects, p_include_archived) s
  ),
  tk as (
    select t.*, pj.is_lead, count(*) over () as n
      from pj join public.general_tasks t on t.project_id = pj.project_id
     where public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
       and t.created_at < p_to
       and (t.status <> 'done' or t.completed_at is null or t.completed_at >= p_from)
       and (pj.ppl is null or exists (
             select 1 from public.general_task_assignees a
              where a.task_id = t.id and a.user_id = any (pj.ppl)))
     order by (t.status <> 'done' and t.due_at < now()) desc, t.due_at nulls last, t.created_at
     limit 2000
  )
  select tk.id, tk.project_id, tk.title, tk.status::text,
         coalesce((select name from public.general_teams g where g.id = tk.team_id), ''),
         array(select public.general_report_name(a.user_id, tk.is_lead)
                 from public.general_task_assignees a
                where a.task_id = tk.id
                  and public.general_report_name(a.user_id, tk.is_lead) is not null
                order by a.assigned_at),
         (select count(*) from public.general_task_assignees a where a.task_id = tk.id)::int,
         public.general_report_name(tk.created_by, tk.is_lead),
         tk.created_at, tk.starts_at, tk.due_at, tk.completed_at,
         tk.due_at is not null and coalesce(tk.completed_at, now()) > tk.due_at,
         tk.weight::numeric,
         coalesce((select sum(l.minutes) from public.general_task_logs l where l.task_id = tk.id
             and l.logged_on >= (p_from at time zone p_tz)::date
             and l.logged_on < (p_to at time zone p_tz)::date), 0)::int,
         coalesce((select sum(l.minutes) from public.general_task_logs l where l.task_id = tk.id), 0)::int,
         (select count(*) from public.general_task_comments c where c.task_id = tk.id)::int,
         (select count(*) from public.general_task_files f where f.task_id = tk.id
             and (f.archived_at is null or coalesce(p_include_archived, false)))::int,
         tk.archived_at is not null,
         tk.n > 2000
    from tk;
$$;

create or replace function public.general_report_time_logs(
  p_space uuid, p_projects uuid[], p_from timestamptz, p_to timestamptz,
  p_people uuid[] default null, p_teams uuid[] default null,
  p_include_archived boolean default false, p_tz text default 'UTC'
) returns table (
  id uuid, project_id uuid, logged_on date, user_id uuid, user_name text,
  task_id uuid, task_title text, minutes int, note text
)
language sql stable security definer set search_path = public set jit = off as $$
  with pj as (
    select s.project_id, s.is_lead,
           public.general_report_people_of(s.project_id, s.is_lead, p_people, p_teams) as ppl
      from public.general_report_projects(p_space, p_projects, p_include_archived) s
  )
  select l.id, l.project_id, l.logged_on, l.user_id,
         public.general_report_name(l.user_id, pj.is_lead),
         l.task_id, t.title, l.minutes, l.note
    from pj join public.general_task_logs l on l.project_id = pj.project_id
    join public.general_tasks t on t.id = l.task_id
   where l.logged_on >= (p_from at time zone p_tz)::date
     and l.logged_on < (p_to at time zone p_tz)::date
     and (pj.ppl is null or l.user_id = any (pj.ppl))
     and public.general_report_task_ok(t.archived_at, t.id, p_include_archived)
   order by l.logged_on desc, l.created_at desc;
$$;

create or replace function public.general_report_commits(
  p_space uuid, p_projects uuid[], p_from timestamptz, p_to timestamptz,
  p_people uuid[] default null, p_teams uuid[] default null,
  p_include_archived boolean default false, p_tz text default 'UTC'
) returns table (
  id uuid, project_id uuid, seq int, at timestamptz, author text, message text,
  added int, changed int, removed int, change_title text, reviewer text
)
language sql stable security definer set search_path = public set jit = off as $$
  with pj as (
    select s.project_id, s.is_lead,
           public.general_report_people_of(s.project_id, s.is_lead, p_people, p_teams) as ppl
      from public.general_report_projects(p_space, p_projects, p_include_archived) s
  )
  select cm.id, cm.project_id, cm.seq, cm.created_at,
         public.general_report_name(cm.author_id, pj.is_lead), cm.message,
         (select count(*) from public.general_blobs b where b.commit_id = cm.id and b.action = 'added' and b.path !~ '(^|/)\.keep$')::int,
         (select count(*) from public.general_blobs b where b.commit_id = cm.id and b.action = 'changed' and b.path !~ '(^|/)\.keep$')::int,
         (select count(*) from public.general_blobs b where b.commit_id = cm.id and b.action = 'removed' and b.path !~ '(^|/)\.keep$')::int,
         ch.title,
         public.general_report_name(ch.decided_by, pj.is_lead)
    from pj join public.general_commits cm on cm.project_id = pj.project_id
    left join public.general_repo_changes ch on ch.id = cm.change_id
   where cm.created_at >= p_from and cm.created_at < p_to
     and (pj.ppl is null or cm.author_id = any (pj.ppl))
   order by cm.created_at desc;
$$;

create or replace function public.general_report_reviews(
  p_space uuid, p_projects uuid[], p_from timestamptz, p_to timestamptz,
  p_people uuid[] default null, p_teams uuid[] default null,
  p_include_archived boolean default false, p_tz text default 'UTC'
) returns table (
  id uuid, project_id uuid, title text, author text, reviewer text, status text,
  opened_at timestamptz, decided_at timestamptz, decided_by text, files int,
  comments int, hours_open numeric
)
language sql stable security definer set search_path = public set jit = off as $$
  with pj as (
    select s.project_id, s.is_lead,
           public.general_report_people_of(s.project_id, s.is_lead, p_people, p_teams) as ppl
      from public.general_report_projects(p_space, p_projects, p_include_archived) s
  )
  select ch.id, ch.project_id, ch.title,
         public.general_report_name(ch.author_id, pj.is_lead),
         public.general_report_name(ch.reviewer_id, pj.is_lead),
         ch.status::text, ch.created_at, ch.decided_at,
         public.general_report_name(ch.decided_by, pj.is_lead),
         jsonb_array_length(ch.files),
         (select count(*) from public.general_repo_comments rc where rc.change_id = ch.id)::int,
         round((extract(epoch from (coalesce(ch.decided_at, now()) - ch.created_at)) / 3600)::numeric, 1)
    from pj join public.general_repo_changes ch on ch.project_id = pj.project_id
   where ((ch.created_at >= p_from and ch.created_at < p_to)
          or (ch.decided_at >= p_from and ch.decided_at < p_to))
     and (pj.ppl is null or ch.author_id = any (pj.ppl) or ch.reviewer_id = any (pj.ppl)
          or ch.decided_by = any (pj.ppl))
   order by ch.created_at desc;
$$;

-- ---------------------------------------------------------------- grants

do $$
declare
  f text;
begin
  foreach f in array array[
    'general_report_is_lead(uuid)',
    'general_report_can_read(uuid)',
    'general_report_history_since()',
    'general_report_scope(uuid, uuid[])',
    'general_report_summary(uuid, uuid[], timestamptz, timestamptz, uuid[], uuid[], boolean, text)',
    'general_report_progress_series(uuid, uuid[], timestamptz, timestamptz, uuid[], uuid[], boolean, text)',
    'general_report_people(uuid, uuid[], timestamptz, timestamptz, uuid[], uuid[], boolean, text)',
    'general_report_activity(uuid, uuid[], timestamptz, timestamptz, uuid[], uuid[], boolean, text, text[], timestamptz, uuid, int)',
    'general_report_tasks(uuid, uuid[], timestamptz, timestamptz, uuid[], uuid[], boolean, text)',
    'general_report_time_logs(uuid, uuid[], timestamptz, timestamptz, uuid[], uuid[], boolean, text)',
    'general_report_commits(uuid, uuid[], timestamptz, timestamptz, uuid[], uuid[], boolean, text)',
    'general_report_reviews(uuid, uuid[], timestamptz, timestamptz, uuid[], uuid[], boolean, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;

  -- Internal: only the report functions above call these.
  foreach f in array array[
    'general_report_projects(uuid, uuid[], boolean)',
    'general_report_people_of(uuid, boolean, uuid[], uuid[])',
    'general_report_name(uuid, boolean)',
    'general_report_task_ok(timestamptz, uuid, boolean)',
    'log_general_task_archive()',
    'log_general_project_change()',
    'log_general_member_change()',
    'guard_general_report_template()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

commit;
