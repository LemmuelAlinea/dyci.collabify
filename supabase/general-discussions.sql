-- Collabify — Discussion: live planning rooms that save as editable files.
--
--   node scripts/db.mjs supabase/general-discussions.sql
--
-- A member starts a discussion, the others are told, and the group talks in
-- one live room. When the person who started it stops it, the conversation is
-- written into the discussion as a document (`content_html`, the rich format
-- the app's editor and .docx export already use). Everyone on the project can
-- then edit that file, download it, and draft tasks from it.
--
-- Keyed on general_projects, so a work project and a class project's group
-- board (its hidden project, class-files.sql) share one design. Teachers are
-- not members of a board's hidden project, so they see nothing here either.
--
--   general_discussion_folders   one level of folders per project
--   general_discussions          a discussion, live until ended_at is set
--   general_discussion_messages  text only, while the discussion is live
--
-- Deleting a discussion moves it to the Trash of whoever deleted it
-- (trashed_at / trashed_by). It leaves everyone else's Discussion tab at once,
-- comes back with Restore, and trash.sql's purge takes it after 30 days.
--
-- One live discussion per project at a time (a partial unique index). Every
-- write goes through the functions below; the tables grant select only. A
-- handed-in or closed board refuses writes through guard_class_board_files,
-- the trigger class-files.sql puts on the Files tables.
--
-- Polls and voice messages (their tables, bucket and calls) are in
-- discussion-polls-voice.sql, which runs after this file; stop_general_discussion
-- here writes both into the file.
--
-- Runs after class-files.sql, before anon-lockdown.sql. Idempotent. Safe to re-run.

begin;

do $$
begin
  alter type public.notification_type add value if not exists 'discussion_started';
end $$;

commit;

begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.general_discussion_folders (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.general_projects (id) on delete cascade,
  name       text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint general_discussion_folders_name check (char_length(btrim(name)) between 1 and 80)
);

create unique index if not exists general_discussion_folders_unique
  on public.general_discussion_folders (project_id, lower(btrim(name)));

create table if not exists public.general_discussions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.general_projects (id) on delete cascade,
  folder_id    uuid references public.general_discussion_folders (id) on delete restrict,
  topic        text not null,
  started_by   uuid references public.profiles (id) on delete set null,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  ended_by     uuid references public.profiles (id) on delete set null,
  content_html text not null default '',
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id) on delete set null,
  constraint general_discussions_topic check (char_length(btrim(topic)) between 1 and 120),
  constraint general_discussions_content check (char_length(content_html) <= 400000)
);

-- One live discussion per project.
alter table public.general_discussions
  add column if not exists trashed_at timestamptz,
  add column if not exists trashed_by uuid references public.profiles (id) on delete set null;

create unique index if not exists general_discussions_one_live
  on public.general_discussions (project_id) where ended_at is null;

create index if not exists general_discussions_project_idx
  on public.general_discussions (project_id, started_at desc);

create table if not exists public.general_discussion_messages (
  id            uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.general_discussions (id) on delete cascade,
  project_id    uuid not null references public.general_projects (id) on delete cascade,
  sender_id     uuid references public.profiles (id) on delete set null,
  body          text not null,
  created_at    timestamptz not null default now(),
  constraint general_discussion_messages_body check (char_length(btrim(body)) between 1 and 4000)
);

create index if not exists general_discussion_messages_idx
  on public.general_discussion_messages (discussion_id, created_at);

-- ---------------------------------------------------------------- who reads

alter table public.general_discussion_folders enable row level security;
alter table public.general_discussions enable row level security;
alter table public.general_discussion_messages enable row level security;

drop policy if exists general_discussion_folders_read on public.general_discussion_folders;
create policy general_discussion_folders_read on public.general_discussion_folders
  for select using (public.is_general_member(project_id));

-- A trashed discussion is seen only by whoever trashed it, in their Trash.
drop policy if exists general_discussions_read on public.general_discussions;
create policy general_discussions_read on public.general_discussions
  for select using (
    public.is_general_member(project_id)
    and (trashed_at is null or trashed_by = auth.uid())
  );

drop policy if exists general_discussion_messages_read on public.general_discussion_messages;
create policy general_discussion_messages_read on public.general_discussion_messages
  for select using (public.is_general_member(project_id));

revoke all on public.general_discussion_folders, public.general_discussions,
  public.general_discussion_messages from public, anon, authenticated;
grant select on public.general_discussion_folders, public.general_discussions,
  public.general_discussion_messages to authenticated;

-- A handed-in, closed or archived board takes no new discussion, message or edit.
do $$
declare
  t text;
begin
  foreach t in array array['general_discussion_folders', 'general_discussions', 'general_discussion_messages']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_class_board', t);
    execute format(
      'create trigger %I before insert or update on public.%I
         for each row execute function public.guard_class_board_files()',
      t || '_class_board', t);
  end loop;
end;
$$;

commit;

begin;

-- ---------------------------------------------------------------- helpers

/** Refuses unless the caller may write to this project's discussions now. */
create or replace function public.general_discussion_check(p_project uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  board uuid;
begin
  if not public.general_viewer_active() or not public.is_general_member(p_project) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(p_project) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;
  select class_board_id into board from public.general_projects where id = p_project;
  if board is not null and public.class_board_frozen(board) then
    raise exception 'This project is handed in or closed, so its discussions cannot change.'
      using errcode = 'check_violation';
  end if;
end;
$$;

/** Whether the caller is an Owner or Manager of the project. */
create or replace function public.general_discussion_lead(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.general_members m
     where m.project_id = p_project and m.user_id = auth.uid() and m.level in ('owner', 'manager')
  );
$$;

create or replace function public.general_html_escape(p text)
returns text language sql immutable set search_path = public as $$
  select replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$;

-- ---------------------------------------------------------------- folders

create or replace function public.create_general_discussion_folder(p_project uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform public.general_discussion_check(p_project);
  if exists (select 1 from public.general_discussion_folders f
              where f.project_id = p_project and lower(btrim(f.name)) = lower(btrim(p_name))) then
    raise exception 'A folder called % is already here. Pick another name.', btrim(p_name)
      using errcode = 'unique_violation';
  end if;
  insert into public.general_discussion_folders (project_id, name, created_by)
  values (p_project, btrim(p_name), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.rename_general_discussion_folder(p_folder uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.general_discussion_folders%rowtype;
begin
  select * into f from public.general_discussion_folders where id = p_folder;
  if not found then
    raise exception 'That folder is gone' using errcode = 'no_data_found';
  end if;
  perform public.general_discussion_check(f.project_id);
  if exists (select 1 from public.general_discussion_folders x
              where x.project_id = f.project_id and x.id <> f.id
                and lower(btrim(x.name)) = lower(btrim(p_name))) then
    raise exception 'A folder called % is already here. Pick another name.', btrim(p_name)
      using errcode = 'unique_violation';
  end if;
  update public.general_discussion_folders set name = btrim(p_name) where id = p_folder;
end;
$$;

/**
 * Only an empty folder goes, so no discussion is lost with it. Discussions of
 * it sitting in somebody's Trash stay there, and come back at the top level.
 */
create or replace function public.delete_general_discussion_folder(p_folder uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.general_discussion_folders%rowtype;
begin
  select * into f from public.general_discussion_folders where id = p_folder;
  if not found then
    raise exception 'That folder is gone' using errcode = 'no_data_found';
  end if;
  perform public.general_discussion_check(f.project_id);
  if exists (select 1 from public.general_discussions d where d.folder_id = p_folder and d.trashed_at is null) then
    raise exception 'This folder still holds discussions. Move or delete them first.'
      using errcode = 'check_violation';
  end if;
  update public.general_discussions set folder_id = null
   where folder_id = p_folder and trashed_at is not null;
  delete from public.general_discussion_folders where id = p_folder;
end;
$$;

-- ---------------------------------------------------------------- the live room

create or replace function public.start_general_discussion(p_project uuid, p_folder uuid, p_topic text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_topic text := nullif(btrim(coalesce(p_topic, '')), '');
begin
  perform public.general_discussion_check(p_project);
  if p_folder is not null and not exists (
    select 1 from public.general_discussion_folders f where f.id = p_folder and f.project_id = p_project) then
    raise exception 'That folder is not in this project' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.general_discussions d where d.project_id = p_project and d.ended_at is null) then
    raise exception 'A discussion is already running here. Join it, or wait until it stops.'
      using errcode = 'unique_violation';
  end if;
  insert into public.general_discussions (project_id, folder_id, topic, started_by, updated_by)
  values (p_project, p_folder,
          coalesce(left(v_topic, 120),
                   'Discussion, ' || to_char(now() at time zone 'Asia/Manila', 'Mon FMDD, YYYY FMHH12:MI AM')),
          auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.send_general_discussion_message(p_discussion uuid, p_body text)
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
  insert into public.general_discussion_messages (discussion_id, project_id, sender_id, body)
  values (p_discussion, d.project_id, auth.uid(), btrim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Stops a discussion and writes its file. Only whoever started it may, or an
 * Owner or Manager once the starter has left the project.
 */
create or replace function public.stop_general_discussion(p_discussion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.general_discussions%rowtype;
  v_people text;
  v_body text;
  v_html text;
begin
  select * into d from public.general_discussions where id = p_discussion for update;
  if not found then
    raise exception 'That discussion is gone' using errcode = 'no_data_found';
  end if;
  perform public.general_discussion_check(d.project_id);
  if d.ended_at is not null then
    raise exception 'This discussion has already stopped' using errcode = 'check_violation';
  end if;
  if d.started_by is distinct from auth.uid() and not (
       public.general_discussion_lead(d.project_id)
       and (d.started_by is null or not exists (
             select 1 from public.general_members m
              where m.project_id = d.project_id and m.user_id = d.started_by))) then
    raise exception 'Only whoever started this discussion can stop it'
      using errcode = 'insufficient_privilege';
  end if;

  select string_agg(public.general_html_escape(public.display_name(s.sender_id)), ', ' order by s.first_at)
    into v_people
    from (select sender_id, min(created_at) as first_at
            from public.general_discussion_messages
           where discussion_id = p_discussion and sender_id is not null
           group by sender_id) s;

  -- Polls are final once the discussion stops (discussion-polls-voice.sql).
  update public.general_discussion_polls set closed_at = now()
   where discussion_id = p_discussion and closed_at is null;

  -- Each message by kind: what was typed, a poll with how it came out, or a
  -- voice message as its transcript.
  select string_agg(
           '<p><strong>' || public.general_html_escape(
              case when m.sender_id is null then 'A former member' else public.display_name(m.sender_id) end)
           || '</strong> ' || to_char(m.created_at at time zone 'Asia/Manila', 'FMHH12:MI AM')
           || case m.kind
                when 'poll' then ' asked in a poll: <strong>'
                  || public.general_html_escape(m.body) || '</strong></p>'
                  || coalesce(public.general_discussion_poll_html(m.id), '')
                when 'voice' then ' (voice message, '
                  || (m.audio_ms / 60000) || ':' || lpad(((m.audio_ms / 1000) % 60)::text, 2, '0')
                  || case when m.transcript_edited_at is not null then ', transcript corrected by the sender' else '' end
                  || '): '
                  || case when m.transcript_status = 'done' and btrim(m.body) <> ''
                          then replace(public.general_html_escape(m.body), E'\n', '<br>')
                          when m.transcript_status = 'done' then '<em>No speech was heard.</em>'
                          else '<em>Not transcribed.</em>' end
                  || '</p>'
                when 'file' then ' shared '
                  || coalesce((select string_agg('<em>' || public.general_html_escape(df.file_name) || '</em>', ', ' order by df.created_at)
                                 from public.general_discussion_files df where df.message_id = m.id), 'a file')
                  || case when btrim(m.body) <> ''
                          then ': ' || replace(public.general_html_escape(m.body), E'\n', '<br>') else '' end
                  || '</p>'
                else ': ' || replace(public.general_html_escape(m.body), E'\n', '<br>') || '</p>'
              end,
           '' order by m.created_at)
    into v_body
    from public.general_discussion_messages m
   where m.discussion_id = p_discussion;

  v_html := '<h1>' || public.general_html_escape(d.topic) || '</h1>'
    || '<p>' || to_char(d.started_at at time zone 'Asia/Manila', 'Mon FMDD, YYYY')
    || ' · Started by ' || public.general_html_escape(
         case when d.started_by is null then 'a former member' else public.display_name(d.started_by) end)
    || '</p>'
    || '<p>Taking part: ' || coalesce(v_people, 'nobody wrote anything') || '</p>'
    || '<h2>Discussion</h2>'
    || coalesce(v_body, '<p>No messages were sent.</p>');

  update public.general_discussions
     set ended_at = now(), ended_by = auth.uid(), content_html = v_html,
         updated_at = now(), updated_by = auth.uid()
   where id = p_discussion;
end;
$$;

-- ---------------------------------------------------------------- the file

/**
 * Saves an edited discussion file. `p_expected` is the updated_at the editor
 * opened; a newer save since then is refused rather than overwritten.
 */
create or replace function public.save_general_discussion_file(
  p_discussion uuid, p_html text, p_expected timestamptz
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  d public.general_discussions%rowtype;
  v_at timestamptz;
begin
  select * into d from public.general_discussions where id = p_discussion for update;
  if not found then
    raise exception 'That discussion is gone' using errcode = 'no_data_found';
  end if;
  perform public.general_discussion_check(d.project_id);
  if d.ended_at is null then
    raise exception 'This discussion is still running. Its file is written when it stops.'
      using errcode = 'check_violation';
  end if;
  if p_expected is not null and d.updated_at > p_expected then
    raise exception 'Someone saved a newer version while you were editing. Copy your changes, reopen the file and add them again.'
      using errcode = 'serialization_failure';
  end if;
  update public.general_discussions
     set content_html = coalesce(p_html, ''), updated_at = now(), updated_by = auth.uid()
   where id = p_discussion
  returning updated_at into v_at;
  return v_at;
end;
$$;

create or replace function public.rename_general_discussion(p_discussion uuid, p_topic text)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.general_discussions%rowtype;
begin
  select * into d from public.general_discussions where id = p_discussion;
  if not found then
    raise exception 'That discussion is gone' using errcode = 'no_data_found';
  end if;
  perform public.general_discussion_check(d.project_id);
  update public.general_discussions set topic = left(btrim(p_topic), 120) where id = p_discussion;
end;
$$;

create or replace function public.move_general_discussion(p_discussion uuid, p_folder uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.general_discussions%rowtype;
begin
  select * into d from public.general_discussions where id = p_discussion;
  if not found then
    raise exception 'That discussion is gone' using errcode = 'no_data_found';
  end if;
  perform public.general_discussion_check(d.project_id);
  if p_folder is not null and not exists (
    select 1 from public.general_discussion_folders f where f.id = p_folder and f.project_id = d.project_id) then
    raise exception 'That folder is not in this project' using errcode = 'invalid_parameter_value';
  end if;
  update public.general_discussions set folder_id = p_folder where id = p_discussion;
end;
$$;

-- Deleting goes through Trash now; the old outright delete is gone.
drop function if exists public.delete_general_discussion(uuid);

/**
 * Its starter, or an Owner or Manager, moves a stopped discussion to their
 * own Trash. It leaves the Discussion tab for everyone.
 */
create or replace function public.trash_general_discussion(p_discussion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.general_discussions%rowtype;
begin
  select * into d from public.general_discussions where id = p_discussion for update;
  if not found or d.trashed_at is not null then
    raise exception 'That discussion is gone' using errcode = 'no_data_found';
  end if;
  perform public.general_discussion_check(d.project_id);
  if d.ended_at is null then
    raise exception 'This discussion is still running. Stop it first.' using errcode = 'check_violation';
  end if;
  if d.started_by is distinct from auth.uid() and not public.general_discussion_lead(d.project_id) then
    raise exception 'Only whoever started this discussion, or an Owner or Manager, can move it to Trash'
      using errcode = 'insufficient_privilege';
  end if;
  update public.general_discussions set trashed_at = now(), trashed_by = auth.uid() where id = p_discussion;
end;
$$;

/** Back into the Discussion tab, where it was. Only whoever trashed it. */
create or replace function public.restore_trashed_discussion(p_discussion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.general_discussions%rowtype;
begin
  select * into d from public.general_discussions
   where id = p_discussion and trashed_at is not null and trashed_by = auth.uid()
   for update;
  if not found then return; end if;
  perform public.general_discussion_check(d.project_id);
  update public.general_discussions set trashed_at = null, trashed_by = null where id = p_discussion;
end;
$$;

/** For good, with its messages. Only whoever trashed it. */
create or replace function public.delete_trashed_discussion(p_discussion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d public.general_discussions%rowtype;
begin
  select * into d from public.general_discussions
   where id = p_discussion and trashed_at is not null and trashed_by = auth.uid();
  if not found then return; end if;
  perform public.general_discussion_check(d.project_id);
  delete from public.general_discussions where id = p_discussion;
end;
$$;

-- ---------------------------------------------------------------- notice

/** Tells the rest of the project a discussion has started. A class board's opens the class project. */
create or replace function public.notify_discussion_started()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  label    text;
  board    public.project_boards%rowtype;
  cls_proj public.projects%rowtype;
begin
  select name into label from public.general_projects where id = new.project_id;
  if label is null then return new; end if;
  select b.* into board from public.project_boards b
    join public.general_projects gp on gp.class_board_id = b.id
   where gp.id = new.project_id;
  if board.id is not null then
    select * into cls_proj from public.projects where id = board.project_id;
    label := cls_proj.title;
  end if;

  insert into public.notifications (user_id, type, general_project_id, class_id, project_id, title, preview)
  select m.user_id, 'discussion_started',
         case when board.id is null then new.project_id end,
         cls_proj.class_id, cls_proj.id, new.topic,
         public.display_name(new.started_by) || ' started a discussion in ' || label
    from public.general_members m
    join public.notification_prefs np on np.user_id = m.user_id
   where m.project_id = new.project_id
     and m.user_id is distinct from new.started_by
     and np.project_updates;
  return new;
end;
$$;

drop trigger if exists general_discussions_notify on public.general_discussions;
create trigger general_discussions_notify after insert on public.general_discussions
  for each row execute function public.notify_discussion_started();

revoke all on function public.general_discussion_check(uuid) from public, anon;
revoke all on function public.general_discussion_lead(uuid) from public, anon;
revoke all on function public.notify_discussion_started() from public, anon;
grant execute on function public.general_html_escape(text) to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'create_general_discussion_folder(uuid, text)',
    'rename_general_discussion_folder(uuid, text)',
    'delete_general_discussion_folder(uuid)',
    'start_general_discussion(uuid, uuid, text)',
    'send_general_discussion_message(uuid, text)',
    'stop_general_discussion(uuid)',
    'save_general_discussion_file(uuid, text, timestamptz)',
    'rename_general_discussion(uuid, text)',
    'move_general_discussion(uuid, uuid)',
    'trash_general_discussion(uuid)',
    'restore_trashed_discussion(uuid)',
    'delete_trashed_discussion(uuid)'
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
  foreach t in array array['general_discussion_folders', 'general_discussions', 'general_discussion_messages'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

commit;
