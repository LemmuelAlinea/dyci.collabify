-- Collabify — polls inside chat.
-- A poll hangs off a message, so it renders in the thread and inherits the
-- conversation's membership rules rather than inventing its own.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/polls.sql

begin;

create table if not exists public.polls (
  id                uuid primary key default gen_random_uuid(),
  message_id        uuid not null unique references public.messages (id) on delete cascade,
  conversation_id   uuid not null references public.conversations (id) on delete cascade,
  created_by        uuid not null references public.profiles (id) on delete cascade,
  question          text not null,
  allow_multiple    boolean not null default false,
  allow_new_options boolean not null default false,
  closed_at         timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists polls_conversation_idx on public.polls (conversation_id);

create table if not exists public.poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.polls (id) on delete cascade,
  label    text not null,
  position int not null default 1,
  added_by uuid references public.profiles (id) on delete set null
);

create index if not exists poll_options_poll_idx on public.poll_options (poll_id, position);

create table if not exists public.poll_votes (
  option_id uuid not null references public.poll_options (id) on delete cascade,
  poll_id   uuid not null references public.polls (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  voted_at  timestamptz not null default now(),
  primary key (option_id, user_id)
);

create index if not exists poll_votes_poll_idx on public.poll_votes (poll_id);

-- ---------------------------------------------------------------- helpers

create or replace function public.can_manage_poll(p_poll uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.polls p
     where p.id = p_poll
       and (p.created_by = auth.uid() or public.can_moderate_conversation(p.conversation_id))
  );
$$;

-- ---------------------------------------------------------------- RPCs

/** Message, poll, and options in one transaction — a poll cannot half-exist. */
create or replace function public.create_poll(
  p_conversation uuid,
  p_question text,
  p_options jsonb,
  p_allow_multiple boolean default false,
  p_allow_new_options boolean default false
)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  msg    uuid;
  poll   uuid;
  label  text;
  idx    int := 0;
  kept   int := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('result', 'not_signed_in');
  end if;
  if not public.is_conversation_member(p_conversation) then
    return jsonb_build_object('result', 'not_a_member');
  end if;
  if not public.conversation_is_writable(p_conversation) then
    return jsonb_build_object('result', 'read_only');
  end if;
  if coalesce(trim(p_question), '') = '' then
    return jsonb_build_object('result', 'no_question');
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (p_conversation, auth.uid(), '')
  returning id into msg;

  insert into public.polls (message_id, conversation_id, created_by, question,
                            allow_multiple, allow_new_options)
  values (msg, p_conversation, auth.uid(), trim(p_question),
          coalesce(p_allow_multiple, false), coalesce(p_allow_new_options, false))
  returning id into poll;

  for label in select value #>> '{}' from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) loop
    if coalesce(trim(label), '') <> '' then
      idx := idx + 1;
      insert into public.poll_options (poll_id, label, position, added_by)
      values (poll, trim(label), idx, auth.uid());
      kept := kept + 1;
    end if;
  end loop;

  if kept < 2 then
    raise exception 'A poll needs at least two options';
  end if;

  return jsonb_build_object('result', 'ok', 'poll_id', poll, 'message_id', msg);
end;
$$;

/** Toggles one option. Single-choice polls clear the voter's other picks. */
create or replace function public.cast_poll_vote(p_option uuid, p_selected boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  o public.poll_options%rowtype;
  p public.polls%rowtype;
begin
  select * into o from public.poll_options where id = p_option;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  select * into p from public.polls where id = o.poll_id;
  if not public.is_conversation_member(p.conversation_id) then
    return jsonb_build_object('result', 'not_a_member');
  end if;
  if p.closed_at is not null then
    return jsonb_build_object('result', 'closed');
  end if;

  if p_selected then
    if not p.allow_multiple then
      delete from public.poll_votes where poll_id = p.id and user_id = auth.uid();
    end if;
    insert into public.poll_votes (option_id, poll_id, user_id)
    values (p_option, p.id, auth.uid())
    on conflict do nothing;
  else
    delete from public.poll_votes where option_id = p_option and user_id = auth.uid();
  end if;

  return jsonb_build_object('result', 'ok');
end;
$$;

create or replace function public.add_poll_option(p_poll uuid, p_label text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p    public.polls%rowtype;
  next int;
begin
  select * into p from public.polls where id = p_poll;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if not public.is_conversation_member(p.conversation_id) then
    return jsonb_build_object('result', 'not_a_member');
  end if;
  if p.closed_at is not null then
    return jsonb_build_object('result', 'closed');
  end if;
  -- The creator can always extend their own poll.
  if not p.allow_new_options and p.created_by <> auth.uid() then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if coalesce(trim(p_label), '') = '' then
    return jsonb_build_object('result', 'empty');
  end if;
  if exists (
    select 1 from public.poll_options
     where poll_id = p_poll and lower(label) = lower(trim(p_label))
  ) then
    return jsonb_build_object('result', 'duplicate');
  end if;

  select coalesce(max(position), 0) + 1 into next from public.poll_options where poll_id = p_poll;

  insert into public.poll_options (poll_id, label, position, added_by)
  values (p_poll, trim(p_label), next, auth.uid());

  return jsonb_build_object('result', 'ok');
end;
$$;

create or replace function public.set_poll_closed(p_poll uuid, p_closed boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.can_manage_poll(p_poll) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  update public.polls
     set closed_at = case when p_closed then now() else null end
   where id = p_poll;
  return jsonb_build_object('result', 'ok');
end;
$$;

revoke all on function public.create_poll(uuid, text, jsonb, boolean, boolean) from public;
revoke all on function public.cast_poll_vote(uuid, boolean) from public;
revoke all on function public.add_poll_option(uuid, text) from public;
revoke all on function public.set_poll_closed(uuid, boolean) from public;
grant execute on function public.create_poll(uuid, text, jsonb, boolean, boolean) to authenticated;
grant execute on function public.cast_poll_vote(uuid, boolean) to authenticated;
grant execute on function public.add_poll_option(uuid, text) to authenticated;
grant execute on function public.set_poll_closed(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.polls        enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes   enable row level security;

-- Reads are gated on the conversation; writes all go through the RPCs above.
drop policy if exists polls_select on public.polls;
create policy polls_select on public.polls
  for select using (public.is_conversation_member(conversation_id));

drop policy if exists poll_options_select on public.poll_options;
create policy poll_options_select on public.poll_options
  for select using (
    exists (
      select 1 from public.polls p
       where p.id = poll_id and public.is_conversation_member(p.conversation_id)
    )
  );

drop policy if exists poll_votes_select on public.poll_votes;
create policy poll_votes_select on public.poll_votes
  for select using (
    exists (
      select 1 from public.polls p
       where p.id = poll_id and public.is_conversation_member(p.conversation_id)
    )
  );

-- ---------------------------------------------------------------- realtime

do $$ begin
  alter publication supabase_realtime add table public.poll_votes;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.poll_options;
exception when duplicate_object then null; end $$;

commit;
