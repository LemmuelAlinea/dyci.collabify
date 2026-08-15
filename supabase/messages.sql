-- Collabify — messages: class chats, group chats, professor↔student direct threads.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/messages.sql

begin;

-- ---------------------------------------------------------------- enums

do $$ begin
  create type public.conversation_kind as enum ('class', 'group', 'direct');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables

create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  kind       public.conversation_kind not null,
  class_id   uuid references public.classes (id) on delete cascade,
  group_id   uuid references public.groups (id) on delete cascade,
  -- The two user ids sorted and joined, so a professor and student share one
  -- thread however many classes they have in common.
  direct_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_shape check (
    (kind = 'class'  and class_id is not null and group_id is null and direct_key is null) or
    (kind = 'group'  and group_id is not null and class_id is null and direct_key is null) or
    (kind = 'direct' and direct_key is not null and class_id is null and group_id is null)
  )
);

create unique index if not exists conversations_one_per_class
  on public.conversations (class_id) where kind = 'class';
create unique index if not exists conversations_one_per_group
  on public.conversations (group_id) where kind = 'group';
create unique index if not exists conversations_one_per_pair
  on public.conversations (direct_key) where kind = 'direct';

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  last_read_at    timestamptz not null default 'epoch',
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null default '',
  edited_at       timestamptz,
  -- Deleted messages keep their row so a tombstone can render in place.
  deleted_at      timestamptz,
  deleted_by      uuid references public.profiles (id) on delete set null,
  pinned          boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists messages_thread_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists messages_pinned_idx
  on public.messages (conversation_id, created_at desc) where pinned;

-- "Delete for me" is a row here rather than a mutation of the message, so it
-- can never affect what anyone else sees.
create table if not exists public.message_hidden (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  primary key (message_id, user_id)
);

create table if not exists public.message_attachments (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  file_path  text not null,
  file_name  text not null,
  mime_type  text,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists message_attachments_parent_idx
  on public.message_attachments (message_id);

drop trigger if exists conversations_touch on public.conversations;
create trigger conversations_touch before update on public.conversations
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- helpers

create or replace function public.is_conversation_member(p_conversation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members
     where conversation_id = p_conversation and user_id = auth.uid()
  );
$$;

/** The professor who owns the class or group behind this conversation. */
create or replace function public.can_moderate_conversation(p_conversation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.conversations c
      left join public.classes cl on cl.id = c.class_id
      left join public.groups g on g.id = c.group_id
      left join public.group_sets gs on gs.id = g.set_id
      left join public.classes gcl on gcl.id = gs.class_id
     where c.id = p_conversation
       and coalesce(cl.professor_id, gcl.professor_id) = auth.uid()
  );
$$;

/** False when the conversation's class is archived — that is what makes an
    archived class read-only rather than merely hidden. */
create or replace function public.conversation_is_writable(p_conversation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1
      from public.conversations c
      left join public.classes cl on cl.id = c.class_id
      left join public.groups g on g.id = c.group_id
      left join public.group_sets gs on gs.id = g.set_id
      left join public.classes gcl on gcl.id = gs.class_id
     where c.id = p_conversation
       and coalesce(cl.archived_at, gcl.archived_at) is not null
  );
$$;

-- ---------------------------------------------------------------- auto-wiring

create or replace function public.create_class_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  convo uuid;
begin
  insert into public.conversations (kind, class_id) values ('class', new.id)
  on conflict do nothing
  returning id into convo;

  if convo is null then
    select id into convo from public.conversations where class_id = new.id and kind = 'class';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (convo, new.professor_id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists classes_create_conversation on public.classes;
create trigger classes_create_conversation after insert on public.classes
  for each row execute function public.create_class_conversation();

create or replace function public.create_group_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.conversations (kind, group_id) values ('group', new.id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists groups_create_conversation on public.groups;
create trigger groups_create_conversation after insert on public.groups
  for each row execute function public.create_group_conversation();

/** Roster changes drive class-chat membership, and removal also clears every
    group chat in that class. */
create or replace function public.sync_class_conversation_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  convo uuid;
begin
  select id into convo from public.conversations
   where class_id = new.class_id and kind = 'class';
  if convo is null then
    return new;
  end if;

  if new.status = 'active' then
    insert into public.conversation_members (conversation_id, user_id)
    values (convo, new.student_id)
    on conflict do nothing;
  else
    delete from public.conversation_members
     where conversation_id = convo and user_id = new.student_id;

    delete from public.conversation_members cm
     using public.conversations c
      join public.groups g on g.id = c.group_id
      join public.group_sets gs on gs.id = g.set_id
     where cm.conversation_id = c.id
       and gs.class_id = new.class_id
       and cm.user_id = new.student_id;
  end if;
  return new;
end;
$$;

drop trigger if exists class_members_sync_conversation on public.class_members;
create trigger class_members_sync_conversation after insert or update on public.class_members
  for each row execute function public.sync_class_conversation_member();

create or replace function public.add_group_conversation_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  convo uuid;
begin
  select id into convo from public.conversations where group_id = new.group_id and kind = 'group';
  if convo is not null then
    insert into public.conversation_members (conversation_id, user_id)
    values (convo, new.student_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists group_members_add_conversation on public.group_members;
create trigger group_members_add_conversation after insert on public.group_members
  for each row execute function public.add_group_conversation_member();

create or replace function public.remove_group_conversation_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  convo uuid;
begin
  select id into convo from public.conversations where group_id = old.group_id and kind = 'group';
  if convo is not null then
    delete from public.conversation_members
     where conversation_id = convo and user_id = old.student_id;
  end if;
  return old;
end;
$$;

drop trigger if exists group_members_remove_conversation on public.group_members;
create trigger group_members_remove_conversation after delete on public.group_members
  for each row execute function public.remove_group_conversation_member();

-- ---------------------------------------------------------------- guards

/** The 15-minute edit window lives here, not in the client, and only the body
    may change. */
create or replace function public.guard_message_edit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new; -- service role / SQL console
  end if;

  -- Moderation paths (delete for all, pin) go through their own functions.
  if new.deleted_at is distinct from old.deleted_at
     or new.pinned is distinct from old.pinned then
    return new;
  end if;

  if new.body is distinct from old.body then
    if old.sender_id <> auth.uid() then
      raise exception 'Only the sender can edit a message';
    end if;
    if old.deleted_at is not null then
      raise exception 'A deleted message cannot be edited';
    end if;
    if now() - old.created_at > interval '15 minutes' then
      raise exception 'The 15 minute edit window for this message has passed';
    end if;
    new.edited_at := now();
  end if;

  new.conversation_id := old.conversation_id;
  new.sender_id       := old.sender_id;
  new.created_at      := old.created_at;
  return new;
end;
$$;

drop trigger if exists messages_guard_edit on public.messages;
create trigger messages_guard_edit before update on public.messages
  for each row execute function public.guard_message_edit();

/** Keeps the conversation list ordered by real activity. */
create or replace function public.touch_conversation_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation after insert on public.messages
  for each row execute function public.touch_conversation_on_message();

-- ---------------------------------------------------------------- RPCs

/** Professor only. Returns the existing thread or creates one. */
create or replace function public.start_direct_conversation(p_student uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  key   text;
  convo uuid;
begin
  if me is null then
    return jsonb_build_object('result', 'not_signed_in');
  end if;
  if not exists (select 1 from public.profiles where id = me and role = 'professor') then
    return jsonb_build_object('result', 'not_professor');
  end if;

  -- The student must actually be in one of this professor's classes.
  if not exists (
    select 1 from public.class_members m
      join public.classes c on c.id = m.class_id
     where c.professor_id = me and m.student_id = p_student and m.status = 'active'
  ) then
    return jsonb_build_object('result', 'not_your_student');
  end if;

  key := least(me::text, p_student::text) || '|' || greatest(me::text, p_student::text);

  select id into convo from public.conversations where direct_key = key and kind = 'direct';
  if convo is null then
    insert into public.conversations (kind, direct_key) values ('direct', key)
    returning id into convo;
    insert into public.conversation_members (conversation_id, user_id)
    values (convo, me), (convo, p_student);
  end if;

  return jsonb_build_object('result', 'ok', 'conversation_id', convo);
end;
$$;

create or replace function public.mark_conversation_read(p_conversation uuid)
returns void language sql volatile security definer set search_path = public as $$
  update public.conversation_members
     set last_read_at = now()
   where conversation_id = p_conversation and user_id = auth.uid();
$$;

create or replace function public.hide_message(p_message uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.messages m
     where m.id = p_message and public.is_conversation_member(m.conversation_id)
  ) then
    raise exception 'You are not in that conversation';
  end if;

  insert into public.message_hidden (message_id, user_id)
  values (p_message, auth.uid())
  on conflict do nothing;
end;
$$;

create or replace function public.delete_message_for_all(p_message uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  m public.messages%rowtype;
begin
  select * into m from public.messages where id = p_message;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if not public.is_conversation_member(m.conversation_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if m.sender_id <> auth.uid() and not public.can_moderate_conversation(m.conversation_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;

  update public.messages
     set deleted_at = now(), deleted_by = auth.uid(), body = '', pinned = false
   where id = p_message;

  delete from public.message_attachments where message_id = p_message;
  return jsonb_build_object('result', 'deleted');
end;
$$;

create or replace function public.set_message_pinned(p_message uuid, p_pinned boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  m public.messages%rowtype;
begin
  select * into m from public.messages where id = p_message;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if not public.is_conversation_member(m.conversation_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if m.deleted_at is not null then
    return jsonb_build_object('result', 'deleted');
  end if;

  update public.messages set pinned = p_pinned where id = p_message;
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.start_direct_conversation(uuid) from public;
revoke all on function public.mark_conversation_read(uuid) from public;
revoke all on function public.hide_message(uuid) from public;
revoke all on function public.delete_message_for_all(uuid) from public;
revoke all on function public.set_message_pinned(uuid, boolean) from public;
grant execute on function public.start_direct_conversation(uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.hide_message(uuid) to authenticated;
grant execute on function public.delete_message_for_all(uuid) to authenticated;
grant execute on function public.set_message_pinned(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.message_hidden       enable row level security;
alter table public.message_attachments  enable row level security;

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select using (public.is_conversation_member(id));

drop policy if exists conversation_members_select on public.conversation_members;
create policy conversation_members_select on public.conversation_members
  for select using (public.is_conversation_member(conversation_id));

-- last_read_at is updated through mark_conversation_read().
drop policy if exists conversation_members_update_own on public.conversation_members;
create policy conversation_members_update_own on public.conversation_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (public.is_conversation_member(conversation_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
    and public.conversation_is_writable(conversation_id)
  );

-- Editing is narrowed further by guard_message_edit().
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update using (sender_id = auth.uid() and public.is_conversation_member(conversation_id))
  with check (sender_id = auth.uid());

drop policy if exists message_hidden_own on public.message_hidden;
create policy message_hidden_own on public.message_hidden
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists message_attachments_select on public.message_attachments;
create policy message_attachments_select on public.message_attachments
  for select using (
    exists (
      select 1 from public.messages m
       where m.id = message_id and public.is_conversation_member(m.conversation_id)
    )
  );

drop policy if exists message_attachments_write on public.message_attachments;
create policy message_attachments_write on public.message_attachments
  for all using (
    exists (select 1 from public.messages m where m.id = message_id and m.sender_id = auth.uid())
  )
  with check (
    exists (select 1 from public.messages m where m.id = message_id and m.sender_id = auth.uid())
  );

-- ---------------------------------------------------------------- views

create or replace view public.conversation_overview
with (security_invoker = true) as
select c.id,
       c.kind,
       c.class_id,
       c.group_id,
       c.direct_key,
       c.updated_at,
       cm.last_read_at,
       (
         select count(*)
           from public.messages m
          where m.conversation_id = c.id
            and m.created_at > cm.last_read_at
            and m.sender_id <> auth.uid()
            and m.deleted_at is null
       )::int as unread_count,
       (
         select m.body from public.messages m
          where m.conversation_id = c.id and m.deleted_at is null
          order by m.created_at desc limit 1
       ) as last_body,
       (
         select m.created_at from public.messages m
          where m.conversation_id = c.id
          order by m.created_at desc limit 1
       ) as last_at
  from public.conversations c
  join public.conversation_members cm
    on cm.conversation_id = c.id and cm.user_id = auth.uid();

grant select on public.conversation_overview to authenticated;

-- ---------------------------------------------------------------- realtime

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.message_attachments;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', false)
on conflict (id) do update set public = false;

drop policy if exists chat_files_read on storage.objects;
create policy chat_files_read on storage.objects
  for select using (
    bucket_id = 'chat-files'
    and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists chat_files_write on storage.objects;
create policy chat_files_write on storage.objects
  for insert with check (
    bucket_id = 'chat-files'
    and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
    and public.conversation_is_writable(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists chat_files_delete on storage.objects;
create policy chat_files_delete on storage.objects
  for delete using (
    bucket_id = 'chat-files'
    and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------- backfill

-- Classes, groups, and rosters that already exist predate these triggers.
insert into public.conversations (kind, class_id)
select 'class', c.id from public.classes c
 where not exists (
   select 1 from public.conversations x where x.class_id = c.id and x.kind = 'class'
 );

insert into public.conversations (kind, group_id)
select 'group', g.id from public.groups g
 where not exists (
   select 1 from public.conversations x where x.group_id = g.id and x.kind = 'group'
 );

insert into public.conversation_members (conversation_id, user_id)
select x.id, c.professor_id
  from public.conversations x join public.classes c on c.id = x.class_id
 where x.kind = 'class'
on conflict do nothing;

insert into public.conversation_members (conversation_id, user_id)
select x.id, m.student_id
  from public.conversations x
  join public.class_members m on m.class_id = x.class_id and m.status = 'active'
 where x.kind = 'class'
on conflict do nothing;

insert into public.conversation_members (conversation_id, user_id)
select x.id, gm.student_id
  from public.conversations x
  join public.group_members gm on gm.group_id = x.group_id
 where x.kind = 'group'
on conflict do nothing;

commit;
