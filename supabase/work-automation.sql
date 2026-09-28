-- Collabify — helpers for work spaces and their projects.
--
--   node scripts/db.mjs supabase/work-automation.sql
--
--   general_project_visits   when each person last opened each work project,
--                            so the overview can say what changed since
--   draft_waiting (cron)     draft changes nobody has touched or submitted
--                            for three days get their owner one reminder
--   general_project_templates a person's own starting points for new work
--                            projects, saved from a project they are on
--
-- Runs after automation.sql, before anon-lockdown.sql. Re-run anon-lockdown.sql
-- after it. Two transactions: a new enum value cannot be used in the one that
-- added it. Idempotent. Safe to re-run.

begin;

do $$
begin
  alter type public.notification_type add value if not exists 'draft_waiting';
end $$;

commit;

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

-- ------------------------------------------------------ waiting drafts

/**
 * Work in somebody's draft is invisible to the rest of the group until it is
 * submitted, and a draft that sits for days is usually forgotten rather than
 * unfinished. One reminder per stretch of quiet: not again until the draft is
 * touched and then goes quiet again.
 *
 * Only live files (not archived, not trashed) in a live project the person is
 * still on. Governed by `deadline_reminders`, the switch for nudges from the
 * clock.
 */
create or replace function public.send_draft_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  sent integer;
begin
  with waiting as (
    select d.user_id, d.project_id, count(*)::int as files, max(f.updated_at) as last_touched
      from public.general_drafts d
      join public.general_draft_files f on f.draft_id = d.id
     where f.archived_at is null
       and f.trashed_at is null
     group by d.user_id, d.project_id
    having max(f.updated_at) < now() - interval '3 days'
  )
  insert into public.notifications (user_id, type, general_project_id, title, preview)
  select w.user_id, 'draft_waiting', w.project_id, p.name,
         w.files || case when w.files = 1 then ' file has' else ' files have' end
           || ' waited in your draft since '
           || to_char(w.last_touched at time zone 'Asia/Manila', 'FMMon FMDD')
           || '. The group sees them once you submit them for review.'
    from waiting w
    join public.general_projects p on p.id = w.project_id
    join public.general_members m on m.project_id = w.project_id and m.user_id = w.user_id
    join public.notification_prefs np on np.user_id = w.user_id
   where p.archived_at is null
     and np.deadline_reminders
     and not exists (
       select 1 from public.notifications n
        where n.user_id = w.user_id
          and n.general_project_id = w.project_id
          and n.type = 'draft_waiting'
          and n.created_at > w.last_touched
     );
  get diagnostics sent = row_count;
  return sent;
end;
$$;

revoke all on function public.send_draft_reminders() from public, anon, authenticated;

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('collabify-draft-reminders');
exception when others then null; end $$;

-- Daily, 01:00 UTC = 9:00 in Manila.
select cron.schedule(
  'collabify-draft-reminders',
  '0 1 * * *',
  $cron$ select public.send_draft_reminders() $cron$
);

commit;

begin;

-- ------------------------------------------------------------- templates

/**
 * A work project saved as somebody's own starting point: its fields, teams,
 * positions and task list, in the same shape a built-in preset hands
 * create_general_project. No dates, no people, no files — those belong to the
 * project it came from, not to the next one.
 *
 * Owner-only. A template is a personal shortcut; sharing one is a different
 * decision, with its own questions about who may see a project's structure.
 */
create table if not exists public.general_project_templates (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name          text not null,
  blurb         text not null default '',
  source_preset text,
  payload       jsonb not null,
  created_at    timestamptz not null default now(),
  constraint general_project_templates_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint general_project_templates_blurb_len check (char_length(blurb) <= 300)
);

-- coalesce, because a CHECK that comes out null passes: a payload missing a
-- key would otherwise slip through.
alter table public.general_project_templates
  drop constraint if exists general_project_templates_payload_shape;
alter table public.general_project_templates
  add constraint general_project_templates_payload_shape check (coalesce(
    jsonb_typeof(payload) = 'object'
    and jsonb_typeof(payload -> 'fields') = 'array'
    and jsonb_typeof(payload -> 'teams') = 'array'
    and jsonb_typeof(payload -> 'positions') = 'array'
    and jsonb_typeof(payload -> 'tasks') = 'array'
    and jsonb_array_length(payload -> 'tasks') <= 300
    and pg_column_size(payload) <= 262144,
  false));

create index if not exists general_project_templates_owner_idx
  on public.general_project_templates (owner_id, created_at desc);

alter table public.general_project_templates enable row level security;

drop policy if exists general_project_templates_own on public.general_project_templates;
create policy general_project_templates_own on public.general_project_templates
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on public.general_project_templates to authenticated;

/** Thirty each is plenty for a person, and keeps a runaway loop bounded. */
create or replace function public.guard_general_template_cap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.general_project_templates where owner_id = new.owner_id) >= 30 then
    raise exception 'You have 30 templates already. Remove one you no longer use first.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists general_project_templates_cap on public.general_project_templates;
create trigger general_project_templates_cap before insert on public.general_project_templates
  for each row execute function public.guard_general_template_cap();

commit;
