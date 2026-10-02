-- Collabify — polls, voice messages and shared files in a live discussion.
--
--   node scripts/db.mjs supabase/discussion-polls-voice.sql
--
-- A discussion message now has a kind:
--   text   what there was before
--   poll   body is the question; the poll hangs off the message
--   voice  body is the transcript (empty until it is written); the audio sits
--          in the private `discussion-voice` bucket at
--          <project id>/<discussion id>/<file>
--   file   body is an optional caption; the files are rows of
--          general_discussion_files, in the private `discussion-files` bucket
--          at the same kind of path. They are references: the work-ai task
--          drafter reads them, never makes a task of a file by itself, and
--          offers one with a task only when the discussion ties them together.
--
-- Voice messages are transcribed by the `transcribe-voice` edge function
-- (Groq Whisper). It writes `body` and `transcript_status` with the service
-- role; nothing else may. The sender may correct the transcript while the
-- discussion is live (`edit_general_discussion_transcript`).
--
-- Polls work like the class chat's: one or many answers, optionally open to
-- new options, closed by whoever made them or an Owner or Manager. Stopping
-- the discussion closes every open poll, and `stop_general_discussion`
-- (general-discussions.sql) writes each poll's results and each voice
-- message's transcript into the discussion file.
--
-- Runs after general-discussions.sql. Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- messages

alter table public.general_discussion_messages
  add column if not exists kind text not null default 'text',
  add column if not exists audio_path text,
  add column if not exists audio_ms int,
  add column if not exists transcript_status text,
  add column if not exists transcript_edited_at timestamptz;

alter table public.general_discussion_messages
  drop constraint if exists general_discussion_messages_kind,
  drop constraint if exists general_discussion_messages_body,
  drop constraint if exists general_discussion_messages_voice;

alter table public.general_discussion_messages
  add constraint general_discussion_messages_kind check (kind in ('text', 'poll', 'voice', 'file')),
  -- A voice message may be empty while it waits for its transcript, and five
  -- minutes of speech runs longer than a typed message is allowed to.
  add constraint general_discussion_messages_body check (
    case when kind = 'voice' then char_length(body) <= 8000
         when kind = 'file' then char_length(body) <= 4000
         else char_length(btrim(body)) between 1 and 4000 end),
  add constraint general_discussion_messages_voice check (
    (kind = 'voice') = (audio_path is not null)
    and (kind <> 'voice' or (audio_ms between 1 and 305000
         and transcript_status in ('pending', 'working', 'done', 'failed'))));

-- ---------------------------------------------------------------- polls

create table if not exists public.general_discussion_polls (
  id                uuid primary key default gen_random_uuid(),
  message_id        uuid not null unique references public.general_discussion_messages (id) on delete cascade,
  discussion_id     uuid not null references public.general_discussions (id) on delete cascade,
  project_id        uuid not null references public.general_projects (id) on delete cascade,
  created_by        uuid references public.profiles (id) on delete set null,
  question          text not null,
  allow_multiple    boolean not null default false,
  allow_new_options boolean not null default false,
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  constraint general_discussion_polls_question check (char_length(btrim(question)) between 1 and 160)
);

create index if not exists general_discussion_polls_discussion_idx
  on public.general_discussion_polls (discussion_id);

create table if not exists public.general_discussion_poll_options (
  id         uuid primary key default gen_random_uuid(),
  poll_id    uuid not null references public.general_discussion_polls (id) on delete cascade,
  project_id uuid not null references public.general_projects (id) on delete cascade,
  label      text not null,
  position   int not null default 1,
  added_by   uuid references public.profiles (id) on delete set null,
  constraint general_discussion_poll_options_label check (char_length(btrim(label)) between 1 and 80)
);

create index if not exists general_discussion_poll_options_poll_idx
  on public.general_discussion_poll_options (poll_id, position);

create table if not exists public.general_discussion_poll_votes (
  option_id  uuid not null references public.general_discussion_poll_options (id) on delete cascade,
  poll_id    uuid not null references public.general_discussion_polls (id) on delete cascade,
  project_id uuid not null references public.general_projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  voted_at   timestamptz not null default now(),
  primary key (option_id, user_id)
);

create index if not exists general_discussion_poll_votes_poll_idx
  on public.general_discussion_poll_votes (poll_id);

alter table public.general_discussion_polls enable row level security;
alter table public.general_discussion_poll_options enable row level security;
alter table public.general_discussion_poll_votes enable row level security;

drop policy if exists general_discussion_polls_read on public.general_discussion_polls;
create policy general_discussion_polls_read on public.general_discussion_polls
  for select using (public.is_general_member(project_id));

drop policy if exists general_discussion_poll_options_read on public.general_discussion_poll_options;
create policy general_discussion_poll_options_read on public.general_discussion_poll_options
  for select using (public.is_general_member(project_id));

drop policy if exists general_discussion_poll_votes_read on public.general_discussion_poll_votes;
create policy general_discussion_poll_votes_read on public.general_discussion_poll_votes
  for select using (public.is_general_member(project_id));

revoke all on public.general_discussion_polls, public.general_discussion_poll_options,
  public.general_discussion_poll_votes from public, anon, authenticated;
grant select on public.general_discussion_polls, public.general_discussion_poll_options,
  public.general_discussion_poll_votes to authenticated;

-- A handed-in, closed or archived board takes no new poll or vote either.
do $$
declare
  t text;
begin
  foreach t in array array['general_discussion_polls', 'general_discussion_poll_options',
                           'general_discussion_poll_votes']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_class_board', t);
    execute format(
      'create trigger %I before insert or update on public.%I
         for each row execute function public.guard_class_board_files()',
      t || '_class_board', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- voice bucket

-- 5 minutes at the 32 kbps the recorder asks for is about 1.2 MB; the cap
-- leaves room for a browser that records at a higher rate.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('discussion-voice', 'discussion-voice', false, 8388608,
        array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/** The project and discussion a voice path names, when it names live ones the caller is on. */
create or replace function public.discussion_voice_path_ok(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := storage.foldername(p_name);
begin
  if coalesce(array_length(parts, 1), 0) <> 2
     or parts[1] !~ '^[0-9a-f-]{36}$' or parts[2] !~ '^[0-9a-f-]{36}$' then
    return false;
  end if;
  return public.general_viewer_active()
     and public.is_general_member(parts[1]::uuid)
     and exists (select 1 from public.general_discussions d
                  where d.id = parts[2]::uuid and d.project_id = parts[1]::uuid
                    and d.ended_at is null and d.trashed_at is null);
end;
$$;

create or replace function public.discussion_voice_readable(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := storage.foldername(p_name);
begin
  if coalesce(array_length(parts, 1), 0) < 1 or parts[1] !~ '^[0-9a-f-]{36}$' then
    return false;
  end if;
  return public.is_general_member(parts[1]::uuid);
end;
$$;

drop policy if exists discussion_voice_read on storage.objects;
create policy discussion_voice_read on storage.objects
  for select using (bucket_id = 'discussion-voice' and public.discussion_voice_readable(name));

-- Upload only into a live discussion of a project the caller is on. No update
-- or delete: a sent voice message stays as it was recorded.
drop policy if exists discussion_voice_write on storage.objects;
create policy discussion_voice_write on storage.objects
  for insert with check (bucket_id = 'discussion-voice' and public.discussion_voice_path_ok(name));

-- ---------------------------------------------------------------- helpers

/** The live discussion a poll belongs to, refusing unless the caller may act in it. */
create or replace function public.general_discussion_poll_live(p_poll uuid)
returns public.general_discussion_polls language plpgsql security definer set search_path = public as $$
declare
  p public.general_discussion_polls%rowtype;
begin
  select * into p from public.general_discussion_polls where id = p_poll;
  if not found then
    raise exception 'That poll no longer exists.' using errcode = 'no_data_found';
  end if;
  perform public.general_discussion_check(p.project_id);
  if exists (select 1 from public.general_discussions d where d.id = p.discussion_id and d.ended_at is not null) then
    raise exception 'This discussion has stopped, so its polls are final.' using errcode = 'check_violation';
  end if;
  return p;
end;
$$;

-- ---------------------------------------------------------------- polls: writes

create or replace function public.create_general_discussion_poll(
  p_discussion uuid, p_question text, p_options text[],
  p_allow_multiple boolean default false, p_allow_new_options boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.general_discussions%rowtype;
  v_question text := btrim(coalesce(p_question, ''));
  v_options text[];
  v_message uuid;
  v_poll uuid;
begin
  select * into d from public.general_discussions where id = p_discussion;
  if not found then
    raise exception 'That discussion is gone' using errcode = 'no_data_found';
  end if;
  perform public.general_discussion_check(d.project_id);
  if d.ended_at is not null then
    raise exception 'This discussion has stopped. Start a new one to keep talking.'
      using errcode = 'check_violation';
  end if;
  if v_question = '' then
    return jsonb_build_object('result', 'no_question');
  end if;

  select array_agg(o order by n) into v_options
    from (select distinct on (lower(btrim(o))) left(btrim(o), 80) as o, n
            from unnest(coalesce(p_options, '{}')) with ordinality as x(o, n)
           where btrim(o) <> ''
           order by lower(btrim(o)), n) s;
  if coalesce(array_length(v_options, 1), 0) < 2 then
    return jsonb_build_object('result', 'too_few_options');
  end if;
  if array_length(v_options, 1) > 12 then
    return jsonb_build_object('result', 'too_many_options');
  end if;

  insert into public.general_discussion_messages (discussion_id, project_id, sender_id, body, kind)
  values (p_discussion, d.project_id, auth.uid(), left(v_question, 160), 'poll')
  returning id into v_message;

  insert into public.general_discussion_polls
    (message_id, discussion_id, project_id, created_by, question, allow_multiple, allow_new_options)
  values (v_message, p_discussion, d.project_id, auth.uid(), left(v_question, 160),
          coalesce(p_allow_multiple, false), coalesce(p_allow_new_options, false))
  returning id into v_poll;

  insert into public.general_discussion_poll_options (poll_id, project_id, label, position, added_by)
  select v_poll, d.project_id, o, n, auth.uid()
    from unnest(v_options) with ordinality as x(o, n);

  return jsonb_build_object('result', 'ok', 'poll_id', v_poll);
end;
$$;

create or replace function public.cast_general_discussion_poll_vote(p_option uuid, p_selected boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.general_discussion_poll_options%rowtype;
  p public.general_discussion_polls%rowtype;
begin
  select * into o from public.general_discussion_poll_options where id = p_option;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  p := public.general_discussion_poll_live(o.poll_id);
  if p.closed_at is not null then
    return jsonb_build_object('result', 'closed');
  end if;

  if not coalesce(p_selected, false) then
    delete from public.general_discussion_poll_votes where option_id = p_option and user_id = auth.uid();
    return jsonb_build_object('result', 'ok');
  end if;

  if not p.allow_multiple then
    delete from public.general_discussion_poll_votes
     where poll_id = p.id and user_id = auth.uid() and option_id <> p_option;
  end if;
  insert into public.general_discussion_poll_votes (option_id, poll_id, project_id, user_id)
  values (p_option, p.id, p.project_id, auth.uid())
  on conflict do nothing;
  return jsonb_build_object('result', 'ok');
end;
$$;

create or replace function public.add_general_discussion_poll_option(p_poll uuid, p_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.general_discussion_polls%rowtype;
  v_label text := left(btrim(coalesce(p_label, '')), 80);
begin
  p := public.general_discussion_poll_live(p_poll);
  if p.closed_at is not null then
    return jsonb_build_object('result', 'closed');
  end if;
  if not p.allow_new_options and p.created_by is distinct from auth.uid() then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if v_label = '' then
    return jsonb_build_object('result', 'empty');
  end if;
  if exists (select 1 from public.general_discussion_poll_options
              where poll_id = p_poll and lower(btrim(label)) = lower(v_label)) then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if (select count(*) from public.general_discussion_poll_options where poll_id = p_poll) >= 12 then
    return jsonb_build_object('result', 'too_many_options');
  end if;
  insert into public.general_discussion_poll_options (poll_id, project_id, label, position, added_by)
  values (p_poll, p.project_id, v_label,
          coalesce((select max(position) from public.general_discussion_poll_options where poll_id = p_poll), 0) + 1,
          auth.uid());
  return jsonb_build_object('result', 'ok');
end;
$$;

create or replace function public.set_general_discussion_poll_closed(p_poll uuid, p_closed boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.general_discussion_polls%rowtype;
begin
  p := public.general_discussion_poll_live(p_poll);
  if p.created_by is distinct from auth.uid() and not public.general_discussion_lead(p.project_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  update public.general_discussion_polls
     set closed_at = case when coalesce(p_closed, true) then coalesce(closed_at, now()) end
   where id = p_poll;
  return jsonb_build_object('result', 'ok');
end;
$$;

-- ---------------------------------------------------------------- voice: writes

/** Records a voice message whose audio the caller has just uploaded. */
create or replace function public.send_general_discussion_voice(p_discussion uuid, p_path text, p_ms int)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  d public.general_discussions%rowtype;
  v_id uuid;
begin
  select * into d from public.general_discussions where id = p_discussion;
  if not found then
    raise exception 'That discussion is gone' using errcode = 'no_data_found';
  end if;
  perform public.general_discussion_check(d.project_id);
  if d.ended_at is not null then
    raise exception 'This discussion has stopped. Start a new one to keep talking.'
      using errcode = 'check_violation';
  end if;
  if p_path is null or p_path not like d.project_id || '/' || d.id || '/%'
     or not exists (select 1 from storage.objects o
                     where o.bucket_id = 'discussion-voice' and o.name = p_path
                       and o.owner_id = auth.uid()::text) then
    raise exception 'That recording did not upload. Record it again.' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.general_discussion_messages where audio_path = p_path) then
    raise exception 'That recording was already sent.' using errcode = 'unique_violation';
  end if;
  if p_ms is null or p_ms < 1 or p_ms > 305000 then
    raise exception 'A voice message runs up to 5 minutes.' using errcode = 'check_violation';
  end if;

  insert into public.general_discussion_messages
    (discussion_id, project_id, sender_id, body, kind, audio_path, audio_ms, transcript_status)
  values (p_discussion, d.project_id, auth.uid(), '', 'voice', p_path, p_ms, 'pending')
  returning id into v_id;
  return v_id;
end;
$$;

/** The sender corrects their transcript, while the discussion is live. */
create or replace function public.edit_general_discussion_transcript(p_message uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.general_discussion_messages%rowtype;
begin
  select * into m from public.general_discussion_messages where id = p_message;
  if not found or m.kind <> 'voice' then
    raise exception 'That voice message is gone' using errcode = 'no_data_found';
  end if;
  perform public.general_discussion_check(m.project_id);
  if m.sender_id is distinct from auth.uid() then
    raise exception 'Only whoever sent it can change its transcript.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.general_discussions d where d.id = m.discussion_id and d.ended_at is not null) then
    raise exception 'This discussion has stopped. Edit its file instead.' using errcode = 'check_violation';
  end if;
  update public.general_discussion_messages
     set body = left(btrim(coalesce(p_body, '')), 8000), transcript_status = 'done',
         transcript_edited_at = now()
   where id = p_message;
end;
$$;

-- ---------------------------------------------------------------- the file

/** A poll as it stood, for the discussion file. */
create or replace function public.general_discussion_poll_html(p_message uuid)
returns text language sql stable security definer set search_path = public as $$
  select '<ul>' || coalesce(string_agg(
           '<li>' || public.general_html_escape(o.label) || ': '
           || coalesce(v.n, 0) || case when coalesce(v.n, 0) = 1 then ' vote' else ' votes' end
           || coalesce(' (' || v.names || ')', '') || '</li>', '' order by o.position), '')
         || '</ul><p>' || p.voters || case when p.voters = 1 then ' person' else ' people' end
         || ' voted' || case when p.allow_multiple then ', picking any number of options' else '' end
         || '.</p>'
    from (select gp.*, (select count(distinct user_id) from public.general_discussion_poll_votes x
                         where x.poll_id = gp.id)::int as voters
            from public.general_discussion_polls gp where gp.message_id = p_message) p
    join public.general_discussion_poll_options o on o.poll_id = p.id
    left join lateral (
      select count(*)::int as n,
             string_agg(public.general_html_escape(public.display_name(pv.user_id)), ', ' order by pv.voted_at) as names
        from public.general_discussion_poll_votes pv where pv.option_id = o.id) v on true
   group by p.voters, p.allow_multiple;
$$;

-- ---------------------------------------------------------------- shared files

create table if not exists public.general_discussion_files (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.general_discussion_messages (id) on delete cascade,
  discussion_id uuid not null references public.general_discussions (id) on delete cascade,
  project_id    uuid not null references public.general_projects (id) on delete cascade,
  uploaded_by   uuid references public.profiles (id) on delete set null,
  file_path     text not null unique,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint not null default 0,
  created_at    timestamptz not null default now(),
  constraint general_discussion_files_name check (char_length(file_name) between 1 and 255),
  constraint general_discussion_files_size check (size_bytes between 0 and 26214400)
);

create index if not exists general_discussion_files_message_idx on public.general_discussion_files (message_id);
create index if not exists general_discussion_files_discussion_idx on public.general_discussion_files (discussion_id);

alter table public.general_discussion_files enable row level security;

drop policy if exists general_discussion_files_read on public.general_discussion_files;
create policy general_discussion_files_read on public.general_discussion_files
  for select using (public.is_general_member(project_id));

revoke all on public.general_discussion_files from public, anon, authenticated;
grant select on public.general_discussion_files to authenticated;

drop trigger if exists general_discussion_files_class_board on public.general_discussion_files;
create trigger general_discussion_files_class_board before insert or update on public.general_discussion_files
  for each row execute function public.guard_class_board_files();

-- Any kind of file, up to 25 MB each.
insert into storage.buckets (id, name, public, file_size_limit)
values ('discussion-files', 'discussion-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Same paths and rules as recordings: upload only into a live discussion of a
-- project you are on; members read; nobody replaces or removes.
drop policy if exists discussion_files_read on storage.objects;
create policy discussion_files_read on storage.objects
  for select using (bucket_id = 'discussion-files' and public.discussion_voice_readable(name));

drop policy if exists discussion_files_write on storage.objects;
create policy discussion_files_write on storage.objects
  for insert with check (bucket_id = 'discussion-files' and public.discussion_voice_path_ok(name));

/**
 * Sends files the caller has just uploaded, with an optional caption.
 *   p_files: [{ "path": "...", "name": "brief.pdf", "mime": "application/pdf", "size": 1234 }, ...]
 */
create or replace function public.send_general_discussion_files(p_discussion uuid, p_body text, p_files jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  d public.general_discussions%rowtype;
  f jsonb;
  v_id uuid;
  v_path text;
begin
  select * into d from public.general_discussions where id = p_discussion;
  if not found then
    raise exception 'That discussion is gone' using errcode = 'no_data_found';
  end if;
  perform public.general_discussion_check(d.project_id);
  if d.ended_at is not null then
    raise exception 'This discussion has stopped. Start a new one to keep talking.'
      using errcode = 'check_violation';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) not between 1 and 10 then
    raise exception 'Send between 1 and 10 files at a time.' using errcode = 'check_violation';
  end if;

  for f in select * from jsonb_array_elements(p_files) loop
    v_path := f ->> 'path';
    if v_path is null or v_path not like d.project_id || '/' || d.id || '/%'
       or not exists (select 1 from storage.objects o
                       where o.bucket_id = 'discussion-files' and o.name = v_path
                         and o.owner_id = auth.uid()::text) then
      raise exception 'A file did not upload. Attach it again.' using errcode = 'invalid_parameter_value';
    end if;
    if exists (select 1 from public.general_discussion_files where file_path = v_path) then
      raise exception 'That file was already sent.' using errcode = 'unique_violation';
    end if;
  end loop;

  insert into public.general_discussion_messages (discussion_id, project_id, sender_id, body, kind)
  values (p_discussion, d.project_id, auth.uid(), left(btrim(coalesce(p_body, '')), 4000), 'file')
  returning id into v_id;

  insert into public.general_discussion_files
    (message_id, discussion_id, project_id, uploaded_by, file_path, file_name, mime_type, size_bytes)
  select v_id, p_discussion, d.project_id, auth.uid(), x ->> 'path',
         left(coalesce(nullif(btrim(x ->> 'name'), ''), 'file'), 255),
         nullif(x ->> 'mime', ''),
         least(greatest(coalesce((x ->> 'size')::bigint, 0), 0), 26214400)
    from jsonb_array_elements(p_files) x;
  return v_id;
end;
$$;

revoke all on function public.discussion_voice_path_ok(text) from public, anon;
revoke all on function public.discussion_voice_readable(text) from public, anon;
grant execute on function public.discussion_voice_path_ok(text) to authenticated;
grant execute on function public.discussion_voice_readable(text) to authenticated;
revoke all on function public.general_discussion_poll_live(uuid) from public, anon, authenticated;
revoke all on function public.general_discussion_poll_html(uuid) from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'create_general_discussion_poll(uuid, text, text[], boolean, boolean)',
    'cast_general_discussion_poll_vote(uuid, boolean)',
    'add_general_discussion_poll_option(uuid, text)',
    'set_general_discussion_poll_closed(uuid, boolean)',
    'send_general_discussion_voice(uuid, text, integer)',
    'edit_general_discussion_transcript(uuid, text)',
    'send_general_discussion_files(uuid, text, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

commit;

begin;

do $$
declare
  t text;
begin
  foreach t in array array['general_discussion_polls', 'general_discussion_poll_options',
                           'general_discussion_poll_votes', 'general_discussion_files'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

commit;
