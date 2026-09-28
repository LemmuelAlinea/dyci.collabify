-- Collabify — helpers for work spaces and their projects.
--
--   node scripts/db.mjs supabase/work-automation.sql
--
--   general_project_visits   when each person last opened each work project,
--                            so the overview can say what changed since
--
-- Runs after automation.sql, before anon-lockdown.sql. Re-run anon-lockdown.sql
-- after it. Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- visits

/**
 * Two times, not one. `seen_at` moves on every visit; `since` is the visit
 * before the current sitting, and only moves once a person has been away for
 * half an hour. Without it, a reload or a second tab would reset "since you
 * were last here" to a few seconds ago and the summary would vanish while the
 * person was still reading it.
 */
create table if not exists public.general_project_visits (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.general_projects (id) on delete cascade,
  since      timestamptz,
  seen_at    timestamptz not null default now(),
  primary key (user_id, project_id)
);

alter table public.general_project_visits enable row level security;

drop policy if exists general_project_visits_own on public.general_project_visits;
create policy general_project_visits_own on public.general_project_visits
  for select using (user_id = auth.uid());

/**
 * What changed in a work project since the caller's last sitting, and records
 * this one. Nothing on a first visit: there is no "since" to speak of.
 *
 * Counts only what somebody else did. Being told you finished your own task is
 * noise. Reviews waiting are the open changes where the caller is the named
 * reviewer, or where nobody is named and the caller may edit files.
 */
create or replace function public.general_since_last_visit(p_project uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
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
           where t.project_id = p_project
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
       where t.project_id = p_project and t.archived_at is null
         and t.created_at > since and t.created_by is distinct from me
    ),
    'assigned_to_me', (
      select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title)), '[]'::jsonb)
        from public.general_task_assignees a
        join public.general_tasks t on t.id = a.task_id
       where a.project_id = p_project and a.user_id = me
         and a.assigned_at > since and a.assigned_by is distinct from me
         and t.archived_at is null
    ),
    'comments_on_mine', (
      select count(*) from public.general_task_comments c
       where c.project_id = p_project
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
         and (ch.reviewer_id = me
              or (ch.reviewer_id is null and public.general_has(p_project, 'edit_files')))
    )
  ) into out;

  return out;
end;
$$;

grant execute on function public.general_since_last_visit(uuid) to authenticated;

commit;
