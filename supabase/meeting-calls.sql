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
alter table public.meetings add column if not exists empty_since timestamptz;

update public.meetings set call_state = 'scheduled'
 where platform = 'collabify' and call_state is null;

alter table public.meetings drop constraint if exists meetings_call_shape;
alter table public.meetings add constraint meetings_call_shape check (
  (platform = 'collabify' and call_state is not null)
  or (platform <> 'collabify' and call_state is null and room_name is null)
);
create unique index if not exists meetings_room_name_unique on public.meetings (room_name)
  where room_name is not null;

create table if not exists public.meeting_call_bans (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  room_name text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_name, user_id)
);
alter table public.meeting_call_bans enable row level security;
revoke all on table public.meeting_call_bans from public, anon, authenticated;
grant select, insert, update, delete on public.meeting_call_bans to service_role;

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

create or replace function public.meeting_call_member_for(m public.meetings, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with active as (
    select 1 from public.profiles pr where pr.id = p_user and pr.status = 'active'
  ), faculty as (
    select 1 from public.classes c
    join public.profiles pr on pr.id = p_user and pr.status = 'active'
    left join public.general_space_members sm
      on sm.space_id = c.space_id and sm.user_id = p_user
   where c.id = m.class_id
     and (c.professor_id = p_user
       or (pr.role = 'member' and pr.can_teach and sm.level in ('owner', 'manager')))
  )
  select exists (select 1 from active) and coalesce(case m.scope
    when 'class' then exists (select 1 from faculty)
      or exists (select 1 from public.class_members cm
                  where cm.class_id = m.class_id and cm.student_id = p_user
                    and cm.status = 'active')
    when 'group' then exists (
      select 1 from public.group_members gm
      join public.class_members cm on cm.class_id = m.class_id
        and cm.student_id = gm.student_id and cm.status = 'active'
     where gm.group_id = m.group_id and gm.student_id = p_user)
      or (m.created_by = p_user and exists (select 1 from faculty))
    when 'space' then exists (select 1 from public.general_space_members sm
                              where sm.space_id = m.space_id and sm.user_id = p_user)
    when 'project' then exists (select 1 from public.general_members gm
                                where gm.project_id = m.project_id and gm.user_id = p_user)
    when 'space_team' then exists (select 1 from public.general_space_team_members tm
                                   where tm.team_id = m.space_team_id and tm.user_id = p_user)
    when 'project_team' then exists (select 1 from public.general_team_members tm
                                     where tm.team_id = m.project_team_id and tm.user_id = p_user)
      and exists (select 1 from public.general_members gm
                   where gm.project_id = m.project_id and gm.user_id = p_user)
  end, false);
$$;

create or replace function public.meeting_call_host_for(m public.meetings, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists (
    select 1 from public.profiles pr
     where pr.id = p_user and pr.status = 'active'
       and public.meeting_call_member_for(m, p_user)
       and (m.started_by = p_user
         or case m.scope
           when 'class' then exists (
             select 1 from public.classes c
             left join public.general_space_members sm
               on sm.space_id = c.space_id and sm.user_id = p_user
              where c.id = m.class_id
                and (c.professor_id = p_user
                     or (pr.role = 'member' and pr.can_teach and sm.level in ('owner', 'manager'))))
           when 'group' then exists (select 1 from public.groups g
                                     where g.id = m.group_id and g.leader_id = p_user)
           when 'space' then exists (select 1 from public.general_space_members sm
                                     where sm.space_id = m.space_id and sm.user_id = p_user
                                       and sm.level in ('owner', 'manager'))
           when 'project' then exists (select 1 from public.general_members gm
                                       where gm.project_id = m.project_id and gm.user_id = p_user
                                         and gm.level in ('owner', 'manager'))
           when 'space_team' then exists (select 1 from public.general_space_team_members tm
                                          where tm.team_id = m.space_team_id and tm.user_id = p_user
                                            and tm.level in ('owner', 'manager'))
           when 'project_team' then exists (
             select 1 from public.general_members gm
              where gm.project_id = m.project_id and gm.user_id = p_user
                and gm.level in ('owner', 'manager'))
             or exists (select 1 from public.general_teams t
                         where t.id = m.project_team_id and t.leader_id = p_user)
         end)
  ), false);
$$;

create or replace function public.meeting_call_host(m public.meetings)
returns boolean language sql stable security definer set search_path = public as $$
  select public.meeting_call_host_for(m, auth.uid());
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
           and not exists (select 1 from public.meeting_call_bans b
                            where b.room_name = m.room_name and b.user_id = auth.uid())
           and ((m.call_state = 'starting' and public.meeting_call_host(m))
             or (m.call_state = 'live' and
                   (m.locked_at is null or public.meeting_call_host(m)))),
         100
    from public.meetings m
    join public.profiles pr on pr.id = auth.uid() and pr.status = 'active'
   where m.id = p_meeting and m.platform = 'collabify'
     and m.cancelled_at is null and not public.meeting_audience_archived(m)
     and public.meeting_call_member_for(m, auth.uid())
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
           ended_at = null, locked_at = null, empty_since = null
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
  update public.meetings set call_state = 'ended', ended_at = now(), locked_at = null,
                             empty_since = null
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

create or replace function public.ban_meeting_call_participant(
  p_meeting uuid, p_room text, p_user uuid
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.meetings
                  where id = p_meeting and room_name = p_room and call_state = 'live') then
    raise exception 'This call is unavailable.' using errcode = 'check_violation';
  end if;
  insert into public.meeting_call_bans(meeting_id, room_name, user_id)
  values (p_meeting, p_room, p_user) on conflict do nothing;
end;
$$;

create or replace function public.mark_meeting_call_empty(
  p_meeting uuid, p_room text, p_empty boolean
)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.meetings
     set empty_since = case when p_empty then coalesce(empty_since, now()) else null end
   where id = p_meeting and room_name = p_room and call_state = 'live';
end;
$$;

create or replace function public.meeting_call_participant_allowed(
  p_meeting uuid, p_user uuid, p_new_join boolean
)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.meetings m
    join public.profiles pr on pr.id = p_user and pr.status = 'active'
   where m.id = p_meeting and m.platform = 'collabify' and m.room_name is not null
     and m.call_state in ('starting', 'live') and m.cancelled_at is null
     and not public.meeting_audience_archived(m)
     and (m.started_at is null or m.started_at > now() - interval '8 hours')
     and coalesce((select meeting_calls_enabled from public.organization_settings where id), false)
     and public.meeting_call_member_for(m, p_user)
     and not exists (select 1 from public.meeting_call_bans b
                      where b.room_name = m.room_name and b.user_id = p_user)
     and (m.call_state = 'live' or public.meeting_call_host_for(m, p_user))
     and (not p_new_join or m.locked_at is null or public.meeting_call_host_for(m, p_user))
  );
$$;

create or replace function public.meeting_call_disallowed_participants(
  p_meeting uuid, p_identities text[], p_new_joins boolean[]
)
returns table (identity text)
language sql stable security definer set search_path = public as $$
  select u.identity
    from unnest(p_identities, p_new_joins) as u(identity, new_join)
   where case
     when u.identity ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       then not public.meeting_call_participant_allowed(
         p_meeting, u.identity::uuid, coalesce(u.new_join, true))
     else true
   end;
$$;

drop function if exists public.meeting_calls_to_reconcile(integer);
create or replace function public.meeting_calls_to_reconcile(p_limit integer)
returns table (meeting_id uuid, room_name text, call_state public.meeting_call_state,
               starting_at timestamptz, started_at timestamptz, empty_since timestamptz,
               locked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.room_name, m.call_state, m.starting_at, m.started_at, m.empty_since,
         m.locked_at
    from public.meetings m
   where m.platform = 'collabify' and m.call_state in ('starting', 'live')
     and m.room_name is not null
   order by coalesce(m.started_at, m.starting_at), m.id
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

create table if not exists public.meeting_call_events (
  event_id text primary key,
  room_name text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.meeting_call_events add column if not exists processed_at timestamptz;
create index if not exists meeting_call_events_received_idx
  on public.meeting_call_events (received_at);
alter table public.meeting_call_events enable row level security;
revoke all on table public.meeting_call_events from public, anon, authenticated;
grant select, insert, update, delete on table public.meeting_call_events to service_role;

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
     and (m.platform <> 'collabify' or public.meeting_call_member_for(m, auth.uid()))
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
     and (m.platform <> 'collabify' or public.meeting_call_member_for(m, auth.uid()))
     and not public.meeting_audience_archived(m);
$$;

revoke all on function public.meeting_call_init() from public, anon, authenticated;
revoke all on function public.meeting_call_host(public.meetings) from public, anon, authenticated;
revoke all on function public.meeting_call_host_for(public.meetings,uuid) from public, anon, authenticated;
revoke all on function public.meeting_call_member_for(public.meetings,uuid) from public, anon, authenticated;
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
revoke all on function public.ban_meeting_call_participant(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.mark_meeting_call_empty(uuid,text,boolean) from public, anon, authenticated;
revoke all on function public.meeting_call_participant_allowed(uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.meeting_call_disallowed_participants(uuid,text[],boolean[]) from public, anon, authenticated;
revoke all on function public.meeting_calls_to_reconcile(integer) from public, anon, authenticated;
grant execute on function public.confirm_meeting_live(uuid,text) to service_role;
grant execute on function public.finish_meeting_call(uuid,text) to service_role;
grant execute on function public.set_meeting_call_lock(uuid,boolean) to service_role;
grant execute on function public.ban_meeting_call_participant(uuid,text,uuid) to service_role;
grant execute on function public.mark_meeting_call_empty(uuid,text,boolean) to service_role;
grant execute on function public.meeting_call_participant_allowed(uuid,uuid,boolean) to service_role;
grant execute on function public.meeting_call_disallowed_participants(uuid,text[],boolean[]) to service_role;
grant execute on function public.meeting_calls_to_reconcile(integer) to service_role;
grant execute on function public.confirm_meeting_live(uuid,text) to service_role;
grant execute on function public.finish_meeting_call(uuid,text) to service_role;
grant execute on function public.set_meeting_call_lock(uuid,boolean) to service_role;
grant execute on function public.mark_meeting_call_empty(uuid,text,boolean) to service_role;
grant execute on function public.meeting_call_participant_allowed(uuid,uuid,boolean) to service_role;
grant execute on function public.meeting_call_disallowed_participants(uuid,text[],boolean[]) to service_role;
grant execute on function public.meeting_calls_to_reconcile(integer) to service_role;

create or replace function public.reconcile_meeting_calls_tick()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets
   where name = 'collabify_supabase_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets
   where name = 'collabify_meeting_call_cron_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/meeting-call-events',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret,
                                  'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
end;
$$;
revoke all on function public.reconcile_meeting_calls_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'collabify-meeting-call-reconcile') then
    perform cron.unschedule('collabify-meeting-call-reconcile');
  end if;
  perform cron.schedule('collabify-meeting-call-reconcile', '* * * * *',
                        'select public.reconcile_meeting_calls_tick()');
end;
$$;

commit;
