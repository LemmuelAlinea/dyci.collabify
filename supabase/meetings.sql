-- Collabify — meetings: a Zoom or Google Meet link, a time and an audience.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/meetings.sql
--
-- Requires classes.sql, groups.sql, general.sql, general-spaces.sql,
-- general-space-teams.sql, one-workplace.sql and teaching-guards.sql.

/**
 * Collabify does not make the meeting. Somebody makes it in Zoom or Meet,
 * pastes the link here, and picks who it is for. What this adds is the part
 * those apps cannot do: knowing who "the class", "group 3" or "the design team"
 * is, telling all of them, and putting it on their calendar.
 *
 * Six audiences, each an existing membership:
 *
 *   class         every active student, the professor, and faculty who
 *                 co-teach or advise the class. Only its faculty schedule one.
 *   group         a class group's students. Its members schedule for it, and
 *                 so does the class's faculty.
 *   space         everyone in a work space.
 *   project       everyone on a work project.
 *   space_team    a work space's reusable team.
 *   project_team  a team inside one work project.
 *
 * In work, any member of the audience may schedule for it. A meeting is read
 * by its audience; a group meeting also by whoever scheduled it, so faculty
 * who set one for a group can still see what they set.
 *
 * Writes go through the RPCs below rather than RLS on the table, because a
 * meeting's audience has to be checked against a different membership per
 * scope and the refusal should say which.
 *
 * Notifications are never gated on a Settings switch, under the rule in
 * notifications.sql: something a person is expected to turn up to is not
 * something a preference should quietly swallow.
 */

begin;

do $$
begin
  alter type public.notification_type add value if not exists 'meeting_scheduled';
  alter type public.notification_type add value if not exists 'meeting_changed';
  alter type public.notification_type add value if not exists 'meeting_cancelled';
end $$;

commit;

-- A new enum value cannot be used in the same transaction that added it.
begin;

-- ------------------------------------------------------------------ types

do $$ begin
  create type public.meeting_scope as enum
    ('class', 'group', 'space', 'project', 'space_team', 'project_team');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.meeting_platform as enum ('google_meet', 'zoom');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------ table

create table if not exists public.meetings (
  id              uuid primary key default gen_random_uuid(),
  scope           public.meeting_scope not null,
  class_id        uuid references public.classes (id) on delete cascade,
  group_id        uuid references public.groups (id) on delete cascade,
  space_id        uuid references public.general_spaces (id) on delete cascade,
  project_id      uuid references public.general_projects (id) on delete cascade,
  space_team_id   uuid references public.general_space_teams (id) on delete cascade,
  project_team_id uuid references public.general_teams (id) on delete cascade,
  title           text not null,
  agenda          text not null default '',
  platform        public.meeting_platform not null,
  join_url        text not null,
  starts_at       timestamptz not null,
  duration_min    int not null default 60,
  created_by      uuid references public.profiles (id) on delete set null,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint meetings_title_len check (char_length(btrim(title)) between 1 and 120),
  constraint meetings_agenda_len check (char_length(agenda) <= 2000),
  constraint meetings_duration check (duration_min between 5 and 480),
  constraint meetings_url check (
    join_url ~* '^https://meet\.google\.com/[^[:space:]]+$'
    or join_url ~* '^https://([a-z0-9-]+\.)*zoom\.(us|com)/[^[:space:]]+$'
  ),
  -- The audience id, plus its parents so a list can filter by class or space
  -- without joining through teams and projects. The fill trigger sets them.
  constraint meetings_shape check (
    (scope = 'class' and class_id is not null and group_id is null and space_id is null
       and project_id is null and space_team_id is null and project_team_id is null) or
    (scope = 'group' and group_id is not null and class_id is not null and space_id is null
       and project_id is null and space_team_id is null and project_team_id is null) or
    (scope = 'space' and space_id is not null and class_id is null and group_id is null
       and project_id is null and space_team_id is null and project_team_id is null) or
    (scope = 'project' and project_id is not null and space_id is not null and class_id is null
       and group_id is null and space_team_id is null and project_team_id is null) or
    (scope = 'space_team' and space_team_id is not null and space_id is not null
       and class_id is null and group_id is null and project_id is null and project_team_id is null) or
    (scope = 'project_team' and project_team_id is not null and project_id is not null
       and space_id is not null and class_id is null and group_id is null and space_team_id is null)
  )
);

create index if not exists meetings_starts_idx on public.meetings (starts_at);
create index if not exists meetings_class_idx on public.meetings (class_id);
create index if not exists meetings_group_idx on public.meetings (group_id);
create index if not exists meetings_space_idx on public.meetings (space_id);
create index if not exists meetings_project_idx on public.meetings (project_id);

alter table public.notifications add column if not exists meeting_id uuid
  references public.meetings (id) on delete cascade;
create index if not exists notifications_meeting_id_idx on public.notifications (meeting_id);

/**
 * Parents and platform come from the database, not the client: a group meeting
 * cannot claim to belong to another class, and the platform badge cannot say
 * Meet over a Zoom link.
 */
create or replace function public.meetings_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.scope = 'group' then
    select gs.class_id into new.class_id
      from public.groups g join public.group_sets gs on gs.id = g.set_id
     where g.id = new.group_id;
  elsif new.scope = 'project' then
    select space_id into new.space_id from public.general_projects where id = new.project_id;
  elsif new.scope = 'space_team' then
    select space_id into new.space_id from public.general_space_teams where id = new.space_team_id;
  elsif new.scope = 'project_team' then
    select t.project_id, p.space_id into new.project_id, new.space_id
      from public.general_teams t join public.general_projects p on p.id = t.project_id
     where t.id = new.project_team_id;
  end if;

  new.platform := case when new.join_url ~* '^https://meet\.google\.com/' then 'google_meet'
                       else 'zoom' end::public.meeting_platform;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end;
$$;

drop trigger if exists meetings_fill on public.meetings;
create trigger meetings_fill before insert or update on public.meetings
  for each row execute function public.meetings_fill();

-- ---------------------------------------------------------------- helpers

/** Members of a project team. general_team_members has no helper of its own. */
create or replace function public.is_general_team_member(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.general_team_members tm
      join public.profiles pr on pr.id = tm.user_id
     where tm.team_id = p_team and tm.user_id = auth.uid() and pr.status <> 'rejected'
  );
$$;

create or replace function public.meeting_can_see(m public.meetings)
returns boolean language sql stable security definer set search_path = public as $$
  select case m.scope
    when 'class' then public.is_active_member(m.class_id) or public.is_class_professor(m.class_id)
    when 'group' then public.is_group_member(m.group_id) or m.created_by = auth.uid()
    when 'space' then public.is_general_space_member(m.space_id)
    when 'project' then public.is_general_member(m.project_id)
    when 'space_team' then public.is_general_space_team_member(m.space_team_id)
    when 'project_team' then public.is_general_team_member(m.project_team_id)
  end;
$$;

/** Edit and cancel: whoever set it, or whoever leads its audience. */
create or replace function public.meeting_can_manage(m public.meetings)
returns boolean language sql stable security definer set search_path = public as $$
  select public.meeting_can_see(m) and (
    m.created_by = auth.uid()
    or case m.scope
      when 'class' then public.is_class_professor(m.class_id)
      when 'group' then public.is_class_professor(m.class_id)
      when 'space' then public.general_space_has_manage(m.space_id)
      when 'project' then public.general_leads(m.project_id)
      when 'space_team' then public.general_space_team_can_manage(m.space_team_id)
      when 'project_team' then public.general_leads(m.project_id)
    end
  );
$$;

/** Everybody a meeting is for. */
create or replace function public.meeting_audience(m public.meetings)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct u from (
    select cm.student_id as u from public.class_members cm
     where m.scope = 'class' and cm.class_id = m.class_id and cm.status = 'active'
    union all
    select c.professor_id from public.classes c where m.scope = 'class' and c.id = m.class_id
    union all
    select sm.user_id
      from public.classes c
      join public.general_space_members sm on sm.space_id = c.space_id
      join public.profiles pr on pr.id = sm.user_id
     where m.scope = 'class' and c.id = m.class_id
       and sm.level in ('owner', 'manager') and pr.role = 'faculty' and pr.status = 'active'
    union all
    select gm.student_id from public.group_members gm where m.scope = 'group' and gm.group_id = m.group_id
    union all
    select m.created_by where m.scope = 'group'
    union all
    select sm.user_id from public.general_space_members sm where m.scope = 'space' and sm.space_id = m.space_id
    union all
    select gm.user_id from public.general_members gm where m.scope = 'project' and gm.project_id = m.project_id
    union all
    select tm.user_id from public.general_space_team_members tm
     where m.scope = 'space_team' and tm.team_id = m.space_team_id
    union all
    select tm.user_id from public.general_team_members tm
     where m.scope = 'project_team' and tm.team_id = m.project_team_id
  ) x
  join public.profiles pr on pr.id = x.u
  where x.u is not null and pr.status <> 'rejected';
$$;

/** "Group 3 · Database Management", the way a person would name who it is for. */
create or replace function public.meeting_audience_label(m public.meetings)
returns text language sql stable security definer set search_path = public as $$
  select case m.scope
    when 'class' then (select c.name || ' · ' || c.section from public.classes c where c.id = m.class_id)
    when 'group' then (select g.name || ' · ' || c.name from public.groups g, public.classes c
                        where g.id = m.group_id and c.id = m.class_id)
    when 'space' then (select s.name from public.general_spaces s where s.id = m.space_id)
    when 'project' then (select p.name from public.general_projects p where p.id = m.project_id)
    when 'space_team' then (select t.name || ' · ' || s.name from public.general_space_teams t, public.general_spaces s
                             where t.id = m.space_team_id and s.id = m.space_id)
    when 'project_team' then (select t.name || ' · ' || p.name from public.general_teams t, public.general_projects p
                               where t.id = m.project_team_id and p.id = m.project_id)
  end;
$$;

/** Whether the audience is still live. An archived class, space or project takes no new meetings. */
create or replace function public.meeting_audience_archived(m public.meetings)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select c.archived_at is not null from public.classes c where c.id = m.class_id), false)
    or coalesce((select g.archived_at is not null from public.groups g where g.id = m.group_id), false)
    or coalesce(public.general_space_is_archived(m.space_id), false)
    or coalesce(public.general_is_archived(m.project_id), false)
    or coalesce((select t.archived_at is not null from public.general_space_teams t where t.id = m.space_team_id), false);
$$;

-- -------------------------------------------------------------------- RLS

alter table public.meetings enable row level security;

drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings
  for select using (public.meeting_can_see(meetings));

-- No insert, update or delete policy: the RPCs below are the only way in.
revoke insert, update, delete on public.meetings from anon, authenticated;
grant select on public.meetings to authenticated;

-- -------------------------------------------------------------- notifying

/** "Mon Oct 6, 3:00 PM" in Manila time, where every reader is. */
create or replace function public.meeting_when(p_at timestamptz)
returns text language sql stable set search_path = public as $$
  select to_char(p_at at time zone 'Asia/Manila', 'Dy Mon FMDD, FMHH12:MI AM');
$$;

create or replace function public.meetings_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  kind  public.notification_type;
  head  text;
  actor uuid := coalesce(auth.uid(), new.created_by);
begin
  if tg_op = 'INSERT' then
    kind := 'meeting_scheduled';
    head := case when new.starts_at <= now() + interval '1 minute'
                 then 'Meeting started: ' else 'Meeting: ' end || new.title;
  elsif new.cancelled_at is not null and old.cancelled_at is null then
    kind := 'meeting_cancelled';
    head := 'Meeting cancelled: ' || new.title;
  elsif new.cancelled_at is null and (
          new.starts_at is distinct from old.starts_at
       or new.duration_min is distinct from old.duration_min
       or new.join_url is distinct from old.join_url) then
    kind := 'meeting_changed';
    head := 'Meeting changed: ' || new.title;
  else
    return new;
  end if;

  insert into public.notifications (user_id, type, meeting_id, title, preview)
  select u, kind, new.id, head,
         public.meeting_audience_label(new) || ' · ' || public.meeting_when(new.starts_at)
    from public.meeting_audience(new) as u
   where u is distinct from actor;
  return new;
end;
$$;

drop trigger if exists meetings_notify on public.meetings;
create trigger meetings_notify after insert or update on public.meetings
  for each row execute function public.meetings_notify();

/** Mirrors the meetings_url check, so a refusal can say what a good link looks like. */
create or replace function public.meeting_url_ok(p_url text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(btrim(p_url) ~* '^https://meet\.google\.com/[^[:space:]]+$'
               or btrim(p_url) ~* '^https://([a-z0-9-]+\.)*zoom\.(us|com)/[^[:space:]]+$', false);
$$;

-- ------------------------------------------------------------------- RPCs

create or replace function public.create_meeting(
  p_scope public.meeting_scope,
  p_audience uuid,
  p_title text,
  p_agenda text,
  p_join_url text,
  p_starts_at timestamptz,
  p_duration_min int
)
returns public.meetings language plpgsql security definer set search_path = public as $$
declare
  m public.meetings;
  allowed boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in to schedule a meeting.' using errcode = 'insufficient_privilege';
  end if;

  m.scope := p_scope;
  case p_scope
    when 'class' then m.class_id := p_audience;
    when 'group' then m.group_id := p_audience;
    when 'space' then m.space_id := p_audience;
    when 'project' then m.project_id := p_audience;
    when 'space_team' then m.space_team_id := p_audience;
    when 'project_team' then m.project_team_id := p_audience;
  end case;

  -- Fill the parents here too, so the checks below can read them.
  if p_scope = 'group' then
    select gs.class_id into m.class_id
      from public.groups g join public.group_sets gs on gs.id = g.set_id where g.id = p_audience;
  elsif p_scope = 'project' then
    select space_id into m.space_id from public.general_projects where id = p_audience;
  elsif p_scope = 'space_team' then
    select space_id into m.space_id from public.general_space_teams where id = p_audience;
  elsif p_scope = 'project_team' then
    select t.project_id, p.space_id into m.project_id, m.space_id
      from public.general_teams t join public.general_projects p on p.id = t.project_id
     where t.id = p_audience;
  end if;

  allowed := case p_scope
    when 'class' then public.is_class_professor(m.class_id)
    when 'group' then public.is_group_member(m.group_id) or public.is_class_professor(m.class_id)
    when 'space' then public.is_general_space_member(m.space_id)
      and exists (select 1 from public.general_spaces s where s.id = m.space_id and s.kind = 'work')
    when 'project' then public.is_general_member(m.project_id)
    when 'space_team' then public.is_general_space_team_member(m.space_team_id)
    when 'project_team' then public.is_general_team_member(m.project_team_id)
  end;
  if not coalesce(allowed, false) then
    raise exception '%', case p_scope
      when 'class' then 'Only the faculty who teach this class can schedule a meeting for all of it.'
      when 'group' then 'Only this group''s members and its class''s faculty can schedule a meeting for it.'
      else 'You can schedule a meeting only for a space, project or team you are in.' end
      using errcode = 'insufficient_privilege';
  end if;
  if public.meeting_audience_archived(m) then
    raise exception 'This is archived, so it takes no new meetings. Restore it first.'
      using errcode = 'check_violation';
  end if;
  if not public.meeting_url_ok(p_join_url) then
    raise exception 'Paste a Zoom or Google Meet link. It starts with https://zoom.us/ or https://meet.google.com/.'
      using errcode = 'check_violation';
  end if;
  if p_starts_at < now() - interval '5 minutes' then
    raise exception 'That start time has passed. Pick a time from now on, or start the meeting now.'
      using errcode = 'check_violation';
  end if;

  insert into public.meetings
    (scope, class_id, group_id, space_id, project_id, space_team_id, project_team_id,
     title, agenda, platform, join_url, starts_at, duration_min, created_by)
  values
    (m.scope, m.class_id, m.group_id, m.space_id, m.project_id, m.space_team_id, m.project_team_id,
     btrim(p_title), coalesce(p_agenda, ''), 'zoom', btrim(p_join_url), p_starts_at,
     coalesce(p_duration_min, 60), auth.uid())
  returning * into m;
  return m;
end;
$$;

create or replace function public.update_meeting(
  p_meeting uuid,
  p_title text,
  p_agenda text,
  p_join_url text,
  p_starts_at timestamptz,
  p_duration_min int
)
returns public.meetings language plpgsql security definer set search_path = public as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if not found or not public.meeting_can_see(m) then
    raise exception 'That meeting is gone, or you are no longer in it.' using errcode = 'no_data_found';
  end if;
  if not public.meeting_can_manage(m) then
    raise exception 'Only whoever scheduled this meeting, or whoever leads its audience, can change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if m.cancelled_at is not null then
    raise exception 'This meeting was cancelled. Schedule a new one instead.' using errcode = 'check_violation';
  end if;
  if public.meeting_audience_archived(m) then
    raise exception 'This is archived, so its meetings cannot change. Restore it first.'
      using errcode = 'check_violation';
  end if;
  if not public.meeting_url_ok(p_join_url) then
    raise exception 'Paste a Zoom or Google Meet link. It starts with https://zoom.us/ or https://meet.google.com/.'
      using errcode = 'check_violation';
  end if;
  if p_starts_at is distinct from m.starts_at and p_starts_at < now() - interval '5 minutes' then
    raise exception 'That start time has passed. Pick a time from now on.' using errcode = 'check_violation';
  end if;

  update public.meetings
     set title = btrim(p_title),
         agenda = coalesce(p_agenda, ''),
         join_url = btrim(p_join_url),
         starts_at = p_starts_at,
         duration_min = coalesce(p_duration_min, duration_min)
   where id = p_meeting
   returning * into m;
  return m;
end;
$$;

create or replace function public.cancel_meeting(p_meeting uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if not found or not public.meeting_can_see(m) then
    raise exception 'That meeting is gone, or you are no longer in it.' using errcode = 'no_data_found';
  end if;
  if not public.meeting_can_manage(m) then
    raise exception 'Only whoever scheduled this meeting, or whoever leads its audience, can cancel it.'
      using errcode = 'insufficient_privilege';
  end if;
  update public.meetings set cancelled_at = coalesce(cancelled_at, now()) where id = p_meeting;
end;
$$;

/**
 * The meetings this person can see from p_since on, with everything a list
 * shows. A function rather than a view so the labels do not depend on the
 * reader also being able to read every parent row.
 */
create or replace function public.list_my_meetings(p_since timestamptz)
returns table (
  id uuid, scope public.meeting_scope, class_id uuid, group_id uuid, space_id uuid,
  project_id uuid, space_team_id uuid, project_team_id uuid, title text, agenda text,
  platform public.meeting_platform, join_url text, starts_at timestamptz, duration_min int,
  created_by uuid, cancelled_at timestamptz, created_at timestamptz,
  audience_label text, class_initial text, class_name text, space_name text,
  creator_name text, can_manage boolean
)
language sql stable security definer set search_path = public as $$
  select m.id, m.scope, m.class_id, m.group_id, m.space_id, m.project_id, m.space_team_id,
         m.project_team_id, m.title, m.agenda, m.platform, m.join_url, m.starts_at,
         m.duration_min, m.created_by, m.cancelled_at, m.created_at,
         public.meeting_audience_label(m),
         c.initial, c.name, s.name,
         nullif(btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''),
         public.meeting_can_manage(m)
    from public.meetings m
    left join public.classes c on c.id = m.class_id
    left join public.general_spaces s on s.id = m.space_id
    left join public.profiles pr on pr.id = m.created_by
   where m.starts_at + make_interval(mins => m.duration_min) >= p_since
     and public.meeting_can_see(m)
     and not public.meeting_audience_archived(m)
   order by m.starts_at;
$$;

/**
 * Every audience this person belongs to, and whether they may schedule for it.
 * Drives the scheduler's pickers and the page's filters in one call.
 */
create or replace function public.meeting_audiences()
returns table (
  scope public.meeting_scope, audience_id uuid, label text, context text,
  class_id uuid, space_id uuid, can_create boolean
)
language sql stable security definer set search_path = public as $$
  -- Classes: their students, and their faculty.
  select 'class'::public.meeting_scope, c.id, c.name, c.section, c.id, null::uuid,
         public.is_class_professor(c.id)
    from public.classes c
   where c.archived_at is null
     and (public.is_active_member(c.id) or public.is_class_professor(c.id))
  union all
  -- Groups: a student's own, and every group in a class the reader teaches.
  select 'group', g.id, g.name, c.name || ' · ' || gs.name, c.id, null, true
    from public.groups g
    join public.group_sets gs on gs.id = g.set_id
    join public.classes c on c.id = gs.class_id
   where g.archived_at is null and c.archived_at is null
     and (public.is_group_member(g.id) or public.is_class_professor(c.id))
  union all
  select 'space', s.id, s.name, '', null, s.id, true
    from public.general_spaces s
   where s.kind = 'work' and s.archived_at is null and public.is_general_space_member(s.id)
  union all
  select 'project', p.id, p.name, s.name, null, p.space_id, true
    from public.general_projects p
    join public.general_spaces s on s.id = p.space_id
   where p.archived_at is null and s.archived_at is null and public.is_general_member(p.id)
  union all
  select 'space_team', t.id, t.name, s.name, null, t.space_id, true
    from public.general_space_teams t
    join public.general_spaces s on s.id = t.space_id
   where t.archived_at is null and s.archived_at is null and public.is_general_space_team_member(t.id)
  union all
  select 'project_team', t.id, t.name, p.name, null, p.space_id, true
    from public.general_teams t
    join public.general_projects p on p.id = t.project_id
    join public.general_spaces s on s.id = p.space_id
   where p.archived_at is null and s.archived_at is null and public.is_general_team_member(t.id);
$$;

revoke all on function public.meetings_fill() from public, anon, authenticated;
revoke all on function public.meetings_notify() from public, anon, authenticated;
revoke all on function public.meeting_audience(public.meetings) from public, anon, authenticated;
revoke all on function public.is_general_team_member(uuid) from public, anon;
revoke all on function public.meeting_can_see(public.meetings) from public, anon;
revoke all on function public.meeting_can_manage(public.meetings) from public, anon;
revoke all on function public.meeting_audience_label(public.meetings) from public, anon;
revoke all on function public.meeting_audience_archived(public.meetings) from public, anon;
revoke all on function public.create_meeting(public.meeting_scope, uuid, text, text, text, timestamptz, int) from public, anon;
revoke all on function public.update_meeting(uuid, text, text, text, timestamptz, int) from public, anon;
revoke all on function public.cancel_meeting(uuid) from public, anon;
revoke all on function public.list_my_meetings(timestamptz) from public, anon;
revoke all on function public.meeting_audiences() from public, anon;

grant execute on function public.is_general_team_member(uuid) to authenticated;
grant execute on function public.meeting_can_see(public.meetings) to authenticated;
grant execute on function public.meeting_can_manage(public.meetings) to authenticated;
grant execute on function public.meeting_audience_label(public.meetings) to authenticated;
grant execute on function public.meeting_audience_archived(public.meetings) to authenticated;
grant execute on function public.meeting_when(timestamptz) to authenticated;
grant execute on function public.meeting_url_ok(text) to authenticated;
grant execute on function public.create_meeting(public.meeting_scope, uuid, text, text, text, timestamptz, int) to authenticated;
grant execute on function public.update_meeting(uuid, text, text, text, timestamptz, int) to authenticated;
grant execute on function public.cancel_meeting(uuid) to authenticated;
grant execute on function public.list_my_meetings(timestamptz) to authenticated;
grant execute on function public.meeting_audiences() to authenticated;

-- ---------------------------------------------------------------- realtime

do $$ begin
  alter publication supabase_realtime add table public.meetings;
exception when duplicate_object then null; end $$;

alter table public.meetings replica identity full;

commit;
