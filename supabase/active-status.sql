-- supabase/active-status.sql
-- Active now: the Inbox shows which of your contacts are online, and a contact
-- can open a direct chat with you.
--
-- A contact is an active account that shares a live place with you: a class
-- (its active students, its teacher and its co-teachers), a work space, or a
-- work project. Archived places, removed class members and a class's own
-- space never count.
--
-- Each open tab calls touch_presence() about once a minute. Nobody reads
-- user_presence directly: my_active_contacts() returns only the caller's
-- contacts who have not hidden their status, and a person who hides their own
-- status sees nobody's.
--
-- Runs after send-to-planner.sql and before anon-lockdown.sql. Redefines
-- nothing another file owns. Idempotent.
-- Suite: supabase/tests/active-status.test.sql

begin;

-- ---------------------------------------------------------------- the table

create table if not exists public.user_presence (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  last_seen_at timestamptz,
  show_active  boolean not null default true
);

create index if not exists user_presence_seen_idx on public.user_presence (last_seen_at);

alter table public.user_presence enable row level security;
revoke all on public.user_presence from anon, authenticated;

-- ---------------------------------------------------------------- the contact rule

/** Everyone who shares a live class, work space or work project with p_user. Internal. */
create or replace function public.contacts_of(p_user uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  -- Only the caller's own live classes are expanded, never the whole school.
  with my_classes (id, space_id, professor_id) as (
    select c.id, c.space_id, c.professor_id
      from public.classes c
     where c.archived_at is null
       and (c.professor_id = p_user
            or exists (select 1 from public.class_members m
                        where m.class_id = c.id and m.student_id = p_user and m.status = 'active')
            or exists (select 1 from public.general_space_members sm
                         join public.profiles t
                           on t.id = sm.user_id and t.role = 'member' and t.can_teach
                        where sm.space_id = c.space_id and sm.user_id = p_user
                          and sm.level in ('owner', 'manager')))
  ),
  shared (person) as (
    select m.student_id
      from my_classes c
      join public.class_members m on m.class_id = c.id and m.status = 'active'
    union
    select c.professor_id from my_classes c
    union
    -- co-teachers: the same test teaches_in_space uses
    select sm.user_id
      from my_classes c
      join public.general_space_members sm
        on sm.space_id = c.space_id and sm.level in ('owner', 'manager')
      join public.profiles t
        on t.id = sm.user_id and t.role = 'member' and t.can_teach
    union
    select o.user_id
      from public.general_space_members mine
      join public.general_spaces s
        on s.id = mine.space_id and s.kind = 'work' and s.archived_at is null
      join public.general_space_members o on o.space_id = mine.space_id
     where mine.user_id = p_user
    union
    select o.user_id
      from public.general_members mine
      join public.general_projects p
        on p.id = mine.project_id and p.class_board_id is null and p.archived_at is null
      join public.general_members o on o.project_id = mine.project_id
     where mine.user_id = p_user
  )
  select s.person
    from shared s
    join public.profiles pr on pr.id = s.person and pr.status = 'active'
   where s.person <> p_user;
$$;

revoke all on function public.contacts_of(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- the heartbeat

/** Stamps the caller as seen now. Skips when stamped under 45 s ago or hidden. */
create or replace function public.touch_presence()
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null or not public.am_i_admitted() then
    return;
  end if;
  insert into public.user_presence as up (user_id, last_seen_at)
  values (me, now())
  on conflict (user_id) do update
    set last_seen_at = now()
  where up.show_active
    and (up.last_seen_at is null or up.last_seen_at < now() - interval '45 seconds');
end;
$$;

-- ---------------------------------------------------------------- the switch

/** Shows or hides the caller's active status. Hiding forgets the last stamp. */
create or replace function public.set_active_status(p_show boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null or p_show is null then
    return;
  end if;
  insert into public.user_presence as up (user_id, show_active, last_seen_at)
  values (me, p_show, null)
  on conflict (user_id) do update
    set show_active  = excluded.show_active,
        last_seen_at = case when excluded.show_active then up.last_seen_at end;
end;
$$;

/** The caller's own switch; on until they turn it off. */
create or replace function public.my_active_status()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select show_active from public.user_presence where user_id = auth.uid()),
    true);
$$;

-- ---------------------------------------------------------------- the list

/** The caller's contacts seen in the last hour, newest first. Nothing when the caller is hidden. */
create or replace function public.my_active_contacts()
returns table (id uuid, first_name text, last_name text, avatar_url text, last_seen_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.first_name, p.last_name, p.avatar_url, up.last_seen_at
    from public.contacts_of(auth.uid()) as c (person)
    join public.profiles p on p.id = c.person
    join public.user_presence up on up.user_id = c.person
   where public.am_i_admitted()
     and public.my_active_status()
     and up.show_active
     and up.last_seen_at > now() - interval '1 hour'
   order by up.last_seen_at desc;
$$;

-- ---------------------------------------------------------------- the direct chat

/**
 * Opens or creates the caller's direct chat with a contact. Uses the same key
 * as start_direct_conversation, so a teacher and a student keep one thread.
 */
create or replace function public.start_contact_conversation(p_person uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  key   text;
  convo uuid;
begin
  if me is null then
    return jsonb_build_object('result', 'not_signed_in');
  end if;
  if p_person is null
     or not public.am_i_admitted()
     or not exists (select 1 from public.contacts_of(me) as c (person) where c.person = p_person) then
    return jsonb_build_object('result', 'not_contact');
  end if;

  key := least(me::text, p_person::text) || '|' || greatest(me::text, p_person::text);

  insert into public.conversations (kind, direct_key) values ('direct', key)
  on conflict (direct_key) where kind = 'direct' do nothing
  returning id into convo;
  if convo is null then
    select id into convo from public.conversations where kind = 'direct' and direct_key = key;
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (convo, me), (convo, p_person)
  on conflict (conversation_id, user_id) do nothing;

  return jsonb_build_object('result', 'ok', 'conversation_id', convo);
end;
$$;

-- ---------------------------------------------------------------- names in a chat

/**
 * Whether the caller shares a direct chat with p_user. Space-only contacts have
 * no other profile policy (class and project peers do), so without this their
 * chat would show no name, face or sender.
 */
create or replace function public.shares_direct_chat_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user <> auth.uid() and exists (
    select 1
      from public.conversation_members mine
      join public.conversations c on c.id = mine.conversation_id and c.kind = 'direct'
      join public.conversation_members other on other.conversation_id = mine.conversation_id
     where mine.user_id = auth.uid()
       and other.user_id = p_user
  );
$$;

drop policy if exists profiles_select_direct_peer on public.profiles;
create policy profiles_select_direct_peer on public.profiles
  for select to authenticated using (public.shares_direct_chat_with(id));

-- ---------------------------------------------------------------- grants

revoke all on function public.shares_direct_chat_with(uuid) from public, anon;
grant execute on function public.shares_direct_chat_with(uuid) to authenticated;

revoke all on function public.touch_presence() from public, anon;
revoke all on function public.set_active_status(boolean) from public, anon;
revoke all on function public.my_active_status() from public, anon;
revoke all on function public.my_active_contacts() from public, anon;
revoke all on function public.start_contact_conversation(uuid) from public, anon;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.set_active_status(boolean) to authenticated;
grant execute on function public.my_active_status() to authenticated;
grant execute on function public.my_active_contacts() to authenticated;
grant execute on function public.start_contact_conversation(uuid) to authenticated;

commit;
