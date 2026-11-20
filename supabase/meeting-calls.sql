-- Collabify video meetings. Apply after project-open-tasks.sql and before
-- anon-lockdown.sql. This is the final owner of meetings_notify.
-- Idempotent: safe to run repeatedly.

begin;
alter type public.notification_type add value if not exists 'meeting_started';
commit;

begin;

alter table public.organization_settings
  add column if not exists meeting_calls_enabled boolean not null default false;

do $$ begin
  create type public.meeting_call_state as enum ('scheduled', 'starting', 'live', 'ended');
exception when duplicate_object then null; end $$;

alter table public.meetings add column if not exists call_state public.meeting_call_state;
alter table public.meetings add column if not exists room_name text;
alter table public.meetings add column if not exists starting_at timestamptz;
alter table public.meetings add column if not exists started_at timestamptz;
alter table public.meetings add column if not exists started_by uuid references public.profiles (id) on delete set null;
alter table public.meetings add column if not exists ended_at timestamptz;
alter table public.meetings add column if not exists locked_at timestamptz;

update public.meetings set call_state = 'scheduled'
 where platform = 'collabify' and call_state is null;

alter table public.meetings drop constraint if exists meetings_call_shape;
alter table public.meetings add constraint meetings_call_shape check (
  (platform = 'collabify' and call_state is not null)
  or (platform <> 'collabify' and call_state is null and room_name is null)
);
create unique index if not exists meetings_room_name_unique on public.meetings (room_name)
  where room_name is not null;

create or replace function public.meeting_call_init()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.join_url is null then new.call_state := 'scheduled'; end if;
  return new;
end;
$$;

drop trigger if exists meeting_call_init on public.meetings;
create trigger meeting_call_init before insert on public.meetings
  for each row execute function public.meeting_call_init();

-- Scheduling an immediate internal call does not claim that anyone connected.
create or replace function public.meetings_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  kind public.notification_type;
  head text;
  actor uuid := coalesce(auth.uid(), new.created_by);
begin
  if tg_op = 'INSERT' then
    kind := 'meeting_scheduled';
    head := case when new.platform <> 'collabify' and new.starts_at <= now() + interval '1 minute'
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

create or replace function public.meeting_call_host(m public.meetings)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.meeting_can_see(m) and (
    m.started_by = auth.uid()
    or case m.scope
      when 'class' then public.is_class_professor(m.class_id)
      when 'group' then exists (select 1 from public.groups g
                                 where g.id = m.group_id and g.leader_id = auth.uid())
      when 'space' then public.general_space_has_manage(m.space_id)
      when 'project' then public.general_leads(m.project_id)
      when 'space_team' then public.general_space_team_can_manage(m.space_team_id)
      when 'project_team' then public.general_leads(m.project_id)
        or exists (select 1 from public.general_teams t
                     where t.id = m.project_team_id and t.leader_id = auth.uid())
    end
  ), false);
$$;

create or replace function public.meeting_call_access(p_meeting uuid)
returns table (room_name text, call_state public.meeting_call_state, can_start boolean,
               can_host boolean, can_join boolean, max_participants integer)
language sql stable security definer set search_path = public as $$
  select m.room_name, m.call_state,
         (m.scope <> 'class' or public.is_class_professor(m.class_id))
           and (m.call_state = 'scheduled'
             or (m.call_state = 'starting' and m.starting_at < now() - interval '2 minutes')),
         public.meeting_call_host(m),
         m.room_name is not null
           and (m.started_at is null or m.started_at > now() - interval '8 hours')
           and ((m.call_state = 'starting' and public.meeting_call_host(m))
             or (m.call_state = 'live' and
                   (m.locked_at is null or public.meeting_call_host(m)))),
         100
    from public.meetings m
    join public.profiles pr on pr.id = auth.uid() and pr.status = 'active'
   where m.id = p_meeting and m.platform = 'collabify'
     and m.cancelled_at is null and not public.meeting_audience_archived(m)
     and public.meeting_can_see(m)
     and coalesce((select meeting_calls_enabled from public.organization_settings where id), false);
$$;

create or replace function public.begin_meeting_call(p_meeting uuid)
returns table (room_name text, call_state public.meeting_call_state, can_start boolean,
               can_host boolean, can_join boolean, max_participants integer)
language plpgsql security definer set search_path = public as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if not found or not exists (select 1 from public.meeting_call_access(p_meeting)) then
    raise exception 'That call is unavailable to you.' using errcode = 'insufficient_privilege';
  end if;
  if m.scope = 'class' and not public.is_class_professor(m.class_id) then
    raise exception 'Only this class''s faculty can start its call.' using errcode = 'insufficient_privilege';
  end if;
  if m.call_state = 'ended' then
    raise exception 'This call has ended.' using errcode = 'check_violation';
  end if;
  if m.call_state = 'scheduled'
     or (m.call_state = 'starting' and m.starting_at < now() - interval '2 minutes') then
    update public.meetings
       set call_state = 'starting', room_name = 'collabify-' || replace(gen_random_uuid()::text, '-', ''),
           starting_at = now(), started_by = auth.uid(), started_at = null,
           ended_at = null, locked_at = null
     where id = p_meeting;
  end if;
  return query select * from public.meeting_call_access(p_meeting);
end;
$$;

create or replace function public.confirm_meeting_live(p_meeting uuid, p_room text)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if not found or m.room_name is distinct from p_room or m.call_state <> 'starting' then return; end if;
  update public.meetings set call_state = 'live', started_at = now() where id = p_meeting;
  insert into public.notifications (user_id, type, meeting_id, title, preview)
  select u, 'meeting_started', m.id, 'Meeting started: ' || m.title,
         public.meeting_audience_label(m) || ' · Join in Collabify'
    from public.meeting_audience(m) as u
    join public.profiles pr on pr.id = u and pr.status = 'active'
   where u is distinct from m.started_by;
end;
$$;

create or replace function public.finish_meeting_call(p_meeting uuid, p_room text)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if not found or m.room_name is distinct from p_room
     or m.call_state not in ('starting', 'live') then return; end if;
  update public.meetings set call_state = 'ended', ended_at = now(), locked_at = null
   where id = p_meeting;
end;
$$;

create or replace function public.set_meeting_call_lock(p_meeting uuid, p_locked boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.meetings set locked_at = case when p_locked then coalesce(locked_at, now()) else null end
   where id = p_meeting and platform = 'collabify' and call_state = 'live';
end;
$$;

create or replace function public.list_my_meetings_v2(
  p_since timestamptz, p_before timestamptz, p_limit integer
)
returns table (
  id uuid, scope public.meeting_scope, class_id uuid, group_id uuid, space_id uuid,
  project_id uuid, space_team_id uuid, project_team_id uuid, title text, agenda text,
  platform public.meeting_platform, join_url text, starts_at timestamptz, duration_min integer,
  created_by uuid, cancelled_at timestamptz, created_at timestamptz,
  audience_label text, class_initial text, class_name text, space_name text,
  creator_name text, can_manage boolean,
  call_state public.meeting_call_state, room_name text, starting_at timestamptz,
  started_at timestamptz, started_by uuid, ended_at timestamptz, locked_at timestamptz,
  can_start boolean, can_join boolean, can_host boolean
)
language sql stable security definer set search_path = public as $$
  select m.id, m.scope, m.class_id, m.group_id, m.space_id, m.project_id,
         m.space_team_id, m.project_team_id, m.title, m.agenda, m.platform,
         m.join_url, m.starts_at, m.duration_min, m.created_by, m.cancelled_at,
         m.created_at, public.meeting_audience_label(m), c.initial, c.name, s.name,
         nullif(btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''),
         public.meeting_can_manage(m), m.call_state, m.room_name, m.starting_at,
         m.started_at, m.started_by, m.ended_at, m.locked_at,
         ca.can_start, ca.can_join, ca.can_host
    from public.meetings m
    join public.profiles viewer on viewer.id = auth.uid() and viewer.status = 'active'
    left join public.classes c on c.id = m.class_id
    left join public.general_spaces s on s.id = m.space_id
    left join public.profiles pr on pr.id = m.created_by
    left join lateral public.meeting_call_access(m.id) ca on m.platform = 'collabify'
   where m.starts_at < p_before
     and (m.starts_at + make_interval(mins => m.duration_min) >= p_since
          or m.call_state in ('starting', 'live'))
     and public.meeting_can_see(m)
     and not public.meeting_audience_archived(m)
   order by m.starts_at desc, m.id
   limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

create or replace function public.get_my_meeting_v2(p_meeting uuid)
returns table (
  id uuid, scope public.meeting_scope, class_id uuid, group_id uuid, space_id uuid,
  project_id uuid, space_team_id uuid, project_team_id uuid, title text, agenda text,
  platform public.meeting_platform, join_url text, starts_at timestamptz, duration_min integer,
  created_by uuid, cancelled_at timestamptz, created_at timestamptz,
  audience_label text, class_initial text, class_name text, space_name text,
  creator_name text, can_manage boolean,
  call_state public.meeting_call_state, room_name text, starting_at timestamptz,
  started_at timestamptz, started_by uuid, ended_at timestamptz, locked_at timestamptz,
  can_start boolean, can_join boolean, can_host boolean
)
language sql stable security definer set search_path = public as $$
  select m.id, m.scope, m.class_id, m.group_id, m.space_id, m.project_id,
         m.space_team_id, m.project_team_id, m.title, m.agenda, m.platform,
         m.join_url, m.starts_at, m.duration_min, m.created_by, m.cancelled_at,
         m.created_at, public.meeting_audience_label(m), c.initial, c.name, s.name,
         nullif(btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''),
         public.meeting_can_manage(m), m.call_state, m.room_name, m.starting_at,
         m.started_at, m.started_by, m.ended_at, m.locked_at,
         ca.can_start, ca.can_join, ca.can_host
    from public.meetings m
    join public.profiles viewer on viewer.id = auth.uid() and viewer.status = 'active'
    left join public.classes c on c.id = m.class_id
    left join public.general_spaces s on s.id = m.space_id
    left join public.profiles pr on pr.id = m.created_by
    left join lateral public.meeting_call_access(m.id) ca on m.platform = 'collabify'
   where m.id = p_meeting and public.meeting_can_see(m)
     and not public.meeting_audience_archived(m);
$$;

revoke all on function public.meeting_call_init() from public, anon, authenticated;
revoke all on function public.meeting_call_host(public.meetings) from public, anon, authenticated;
revoke all on function public.meeting_call_access(uuid) from public, anon;
revoke all on function public.begin_meeting_call(uuid) from public, anon;
revoke all on function public.list_my_meetings_v2(timestamptz,timestamptz,integer) from public, anon;
revoke all on function public.get_my_meeting_v2(uuid) from public, anon;
grant execute on function public.meeting_call_access(uuid) to authenticated;
grant execute on function public.begin_meeting_call(uuid) to authenticated;
grant execute on function public.list_my_meetings_v2(timestamptz,timestamptz,integer) to authenticated;
grant execute on function public.get_my_meeting_v2(uuid) to authenticated;

revoke all on function public.confirm_meeting_live(uuid,text) from public, anon, authenticated;
revoke all on function public.finish_meeting_call(uuid,text) from public, anon, authenticated;
revoke all on function public.set_meeting_call_lock(uuid,boolean) from public, anon, authenticated;
grant execute on function public.confirm_meeting_live(uuid,text) to service_role;
grant execute on function public.finish_meeting_call(uuid,text) to service_role;
grant execute on function public.set_meeting_call_lock(uuid,boolean) to service_role;

commit;
