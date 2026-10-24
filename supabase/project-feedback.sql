-- Collabify — company roles, phase 3: the Feedback tab.
--
--   node scripts/db.mjs supabase/project-feedback.sql supabase/anon-lockdown.sql
--
-- Every work project gets Feedback. A post has a kind (input, concern,
-- approval request), a title, a body, optional files, replies, and a status
-- (open, acknowledged, resolved).
--
--   who                       post and reply   change a status   read
--   pm, coordinator           yes              yes               yes
--   stakeholder               yes                                yes
--   member, qa                                                   yes
--
-- Reads are row-level security (is_general_member). Every write goes through
-- create_general_feedback, reply_general_feedback and
-- set_general_feedback_status; the tables take no direct writes. An archived
-- project's feedback is read-only, and a class board's hidden Files project has
-- none.
--
-- Files go to the private feedback-files bucket (25 MB each) at
-- <project>/<folder>/<uuid>-<safe-name>. The folder is the post's id for a
-- reply and a fresh client uuid for a new post, which has no id yet, so the
-- RPCs check only the project prefix, the bucket and that the caller uploaded
-- the object. Only someone who may post uploads there; members read. The RPCs
-- take the paths (p_paths text[]); a file's name and size come from the path
-- and from Storage, not from the client.
--
-- A post or reply outlives its author's account: author_id goes null.
--
-- Notifications, all behind notification_prefs.project_updates:
--   feedback_posted   a new post, to the pm and coordinators but its author
--   feedback_reply    a reply, to the post's author unless they wrote it
--   feedback_status   a status change, to the post's author unless they made it
-- A reply or status change skips an author who has left the project.
--
-- Two transactions: a new enum value cannot be used in the transaction that
-- added it.
--
-- Runs after project-stakeholders.sql, last in docs/07-backup.md before
-- anon-lockdown.sql. It redefines storage_orphans (storage-sweep.sql) so the
-- sweep keeps attached feedback files and clears unattached ones: storage-sweep.sql
-- runs earlier, before general_feedback_files exists. Re-run this file (then
-- anon-lockdown.sql) after re-running storage-sweep.sql; storage-sweep.sql alone
-- only stops sweeping feedback-files, it never removes an attached one.
--
-- Idempotent. Safe to re-run.

begin;

do $$
begin
  alter type public.notification_type add value if not exists 'feedback_posted';
  alter type public.notification_type add value if not exists 'feedback_reply';
  alter type public.notification_type add value if not exists 'feedback_status';
end $$;

commit;

begin;

-- ---------------------------------------------------------------- types

do $$
begin
  if not exists (select 1 from pg_type
                  where typname = 'general_feedback_kind' and typnamespace = 'public'::regnamespace) then
    create type public.general_feedback_kind as enum ('input', 'concern', 'approval_request');
  end if;
  if not exists (select 1 from pg_type
                  where typname = 'general_feedback_status' and typnamespace = 'public'::regnamespace) then
    create type public.general_feedback_status as enum ('open', 'acknowledged', 'resolved');
  end if;
end $$;

-- ---------------------------------------------------------------- tables

-- A post or reply outlives its author's account (author_id goes null), like
-- every other general_* author column, so nobody else's replies vanish with it.
-- Deleting a post takes its replies and files.
create table if not exists public.general_feedback (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.general_projects (id) on delete cascade,
  author_id         uuid references public.profiles (id) on delete set null,
  kind              public.general_feedback_kind not null,
  title             text not null,
  body              text not null,
  status            public.general_feedback_status not null default 'open',
  status_changed_by uuid references public.profiles (id) on delete set null,
  status_changed_at timestamptz,
  created_at        timestamptz not null default now(),
  constraint general_feedback_title check (char_length(btrim(title)) between 1 and 120),
  constraint general_feedback_body check (char_length(body) between 1 and 4000)
);

create index if not exists general_feedback_project_idx
  on public.general_feedback (project_id, status, created_at desc);

create table if not exists public.general_feedback_replies (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.general_feedback (id) on delete cascade,
  project_id  uuid not null references public.general_projects (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now(),
  constraint general_feedback_replies_body check (char_length(body) between 1 and 4000)
);

-- The first live copy had author_id not null, on delete cascade.
alter table public.general_feedback alter column author_id drop not null;
alter table public.general_feedback drop constraint if exists general_feedback_author_id_fkey;
alter table public.general_feedback add constraint general_feedback_author_id_fkey
  foreign key (author_id) references public.profiles (id) on delete set null;
alter table public.general_feedback_replies alter column author_id drop not null;
alter table public.general_feedback_replies drop constraint if exists general_feedback_replies_author_id_fkey;
alter table public.general_feedback_replies add constraint general_feedback_replies_author_id_fkey
  foreign key (author_id) references public.profiles (id) on delete set null;

create index if not exists general_feedback_replies_feedback_idx
  on public.general_feedback_replies (feedback_id, created_at);

create table if not exists public.general_feedback_files (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.general_feedback (id) on delete cascade,
  reply_id    uuid references public.general_feedback_replies (id) on delete cascade,
  project_id  uuid not null references public.general_projects (id) on delete cascade,
  path        text not null unique,
  name        text not null,
  size_bytes  bigint not null default 0,
  created_at  timestamptz not null default now(),
  constraint general_feedback_files_name check (char_length(name) between 1 and 255),
  constraint general_feedback_files_size check (size_bytes between 0 and 26214400)
);

create index if not exists general_feedback_files_feedback_idx on public.general_feedback_files (feedback_id);
create index if not exists general_feedback_files_reply_idx on public.general_feedback_files (reply_id);

alter table public.general_feedback enable row level security;
alter table public.general_feedback_replies enable row level security;
alter table public.general_feedback_files enable row level security;

-- Everyone on the project reads, stakeholders included. No write policies.
drop policy if exists general_feedback_read on public.general_feedback;
create policy general_feedback_read on public.general_feedback
  for select using (public.is_general_member(project_id));

drop policy if exists general_feedback_replies_read on public.general_feedback_replies;
create policy general_feedback_replies_read on public.general_feedback_replies
  for select using (public.is_general_member(project_id));

drop policy if exists general_feedback_files_read on public.general_feedback_files;
create policy general_feedback_files_read on public.general_feedback_files
  for select using (public.is_general_member(project_id));

revoke all on public.general_feedback from public, anon, authenticated;
revoke all on public.general_feedback_replies from public, anon, authenticated;
revoke all on public.general_feedback_files from public, anon, authenticated;
grant select on public.general_feedback to authenticated;
grant select on public.general_feedback_replies to authenticated;
grant select on public.general_feedback_files to authenticated;

-- Live updates for the tab; row-level security still decides who hears what.
do $$
declare
  t text;
begin
  foreach t in array array['general_feedback', 'general_feedback_replies', 'general_feedback_files'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------- storage

-- Any kind of file, up to 25 MB each.
insert into storage.buckets (id, name, public, file_size_limit)
values ('feedback-files', 'feedback-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

/** An upload to <project>/<folder>/<file> by someone who may post there. */
create or replace function public.feedback_file_path_ok(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := storage.foldername(p_name);
  v_project uuid;
begin
  if coalesce(array_length(parts, 1), 0) <> 2
     or public.general_safe_uuid(parts[2]) is null then
    return false;
  end if;
  v_project := public.general_safe_uuid(parts[1]);
  if v_project is null then
    return false;
  end if;
  return coalesce(public.general_role_of(v_project, auth.uid()) in ('pm', 'coordinator', 'stakeholder'), false)
     and exists (select 1 from public.general_projects gp
                  where gp.id = v_project and gp.class_board_id is null and gp.archived_at is null);
end;
$$;

/** Everyone on the project reads its feedback files. */
create or replace function public.feedback_file_readable(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_project uuid := public.general_safe_uuid((storage.foldername(p_name))[1]);
begin
  return v_project is not null and public.is_general_member(v_project);
end;
$$;

-- Nobody replaces or removes one; the sweep clears what nothing records.
drop policy if exists feedback_files_read on storage.objects;
create policy feedback_files_read on storage.objects
  for select using (bucket_id = 'feedback-files' and public.feedback_file_readable(name));

drop policy if exists feedback_files_write on storage.objects;
create policy feedback_files_write on storage.objects
  for insert with check (bucket_id = 'feedback-files' and public.feedback_file_path_ok(name));

-- ---------------------------------------------------------------- the RPCs

/**
 * Behind every feedback RPC: a work project the caller is on, not archived,
 * in a role that may post (or, with p_status, change a status).
 */
create or replace function public.general_feedback_check(p_project uuid, p_status boolean default false)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  gp public.general_projects%rowtype;
  r  public.general_role;
begin
  select * into gp from public.general_projects where id = p_project;
  if not found then
    raise exception 'That project is gone' using errcode = 'no_data_found';
  end if;
  if gp.class_board_id is not null then
    raise exception 'Feedback is only on work projects.' using errcode = 'check_violation';
  end if;
  r := public.general_role_of(p_project, auth.uid());
  if auth.uid() is null or r is null then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if gp.archived_at is not null then
    raise exception 'This project is archived. Its feedback is read-only.'
      using errcode = 'check_violation';
  end if;
  if p_status then
    if r not in ('pm', 'coordinator') then
      raise exception 'Only the project manager and coordinators change a feedback status.'
        using errcode = 'insufficient_privilege';
    end if;
  elsif r not in ('pm', 'coordinator', 'stakeholder') then
    raise exception 'Only stakeholders, the project manager and coordinators post feedback.'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- The first live copy took the files as jsonb; only the text[] versions stay.
drop function if exists public.create_general_feedback(uuid, public.general_feedback_kind, text, text, jsonb);
drop function if exists public.reply_general_feedback(uuid, text, jsonb);
drop function if exists public.general_feedback_attach(uuid, uuid, uuid, jsonb);

/**
 * Records files the caller has just uploaded to feedback-files under the
 * project's folder, as send_general_discussion_files does. Each path is
 * <project>/<folder>/<uuid>-<safe-name>: the name shown is what follows the
 * uuid, and the size is what Storage recorded, not what the client says.
 */
create or replace function public.general_feedback_attach(p_project uuid, p_feedback uuid, p_reply uuid, p_paths text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_path text;
begin
  if p_paths is null or cardinality(p_paths) = 0 then
    return;
  end if;
  if cardinality(p_paths) > 10 then
    raise exception 'Attach up to 10 files at a time.' using errcode = 'check_violation';
  end if;
  if (select count(x) <> count(distinct x) from unnest(p_paths) x) then
    raise exception 'That file is attached twice. Remove the copy and try again.'
      using errcode = 'unique_violation';
  end if;

  foreach v_path in array p_paths loop
    if v_path is null
       or coalesce(array_length(storage.foldername(v_path), 1), 0) <> 2
       or v_path not like p_project || '/%'
       or not exists (select 1 from storage.objects o
                       where o.bucket_id = 'feedback-files' and o.name = v_path
                         and o.owner_id = auth.uid()::text) then
      raise exception 'A file did not upload. Attach it again.' using errcode = 'invalid_parameter_value';
    end if;
    if exists (select 1 from public.general_feedback_files where path = v_path) then
      raise exception 'That file was already attached. Upload it again to attach it here.'
        using errcode = 'unique_violation';
    end if;
  end loop;

  insert into public.general_feedback_files (feedback_id, reply_id, project_id, path, name, size_bytes)
  select p_feedback, p_reply, p_project, o.name,
         left(coalesce(nullif(btrim(regexp_replace(regexp_replace(o.name, '^.*/', ''),
                                                   '^[0-9a-fA-F-]{36}-', '')), ''), 'file'), 255),
         least(case when o.metadata ->> 'size' ~ '^[0-9]{1,18}$'
                    then (o.metadata ->> 'size')::bigint else 0 end, 26214400)
    from unnest(p_paths) x
    join storage.objects o on o.bucket_id = 'feedback-files' and o.name = x;
end;
$$;

/** Posts feedback, with optional files, and returns its id. */
create or replace function public.create_general_feedback(
  p_project uuid,
  p_kind public.general_feedback_kind,
  p_title text,
  p_body text,
  p_paths text[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
  v_id    uuid;
begin
  perform public.general_feedback_check(p_project, false);
  if p_kind is null then
    raise exception 'Choose a type: input, concern or approval request.' using errcode = 'check_violation';
  end if;
  if char_length(v_title) not between 1 and 120 then
    raise exception 'Give your feedback a title of up to 120 characters.' using errcode = 'check_violation';
  end if;
  if v_body = '' then
    raise exception 'Write your feedback before posting it.' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'Feedback can be up to 4000 characters. Shorten it and post again.'
      using errcode = 'check_violation';
  end if;

  insert into public.general_feedback (project_id, author_id, kind, title, body)
  values (p_project, auth.uid(), p_kind, v_title, v_body)
  returning id into v_id;

  perform public.general_feedback_attach(p_project, v_id, null, p_paths);
  return v_id;
end;
$$;

/** Replies to a post, with optional files, and returns the reply's id. */
create or replace function public.reply_general_feedback(
  p_feedback uuid,
  p_body text,
  p_paths text[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
  v_body    text := btrim(coalesce(p_body, ''));
  v_id      uuid;
begin
  select project_id into v_project from public.general_feedback where id = p_feedback;
  if not found then
    raise exception 'That feedback is gone. Reload to see where things stand.' using errcode = 'no_data_found';
  end if;
  perform public.general_feedback_check(v_project, false);
  if v_body = '' then
    raise exception 'Write your reply before sending it.' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'A reply can be up to 4000 characters. Shorten it and send again.'
      using errcode = 'check_violation';
  end if;

  insert into public.general_feedback_replies (feedback_id, project_id, author_id, body)
  values (p_feedback, v_project, auth.uid(), v_body)
  returning id into v_id;

  perform public.general_feedback_attach(v_project, p_feedback, v_id, p_paths);
  return v_id;
end;
$$;

/** Moves a post to any status. Setting the status it already has does nothing. */
create or replace function public.set_general_feedback_status(
  p_feedback uuid,
  p_status public.general_feedback_status
) returns void language plpgsql security definer set search_path = public as $$
declare
  fb public.general_feedback%rowtype;
begin
  select * into fb from public.general_feedback where id = p_feedback for update;
  if not found then
    raise exception 'That feedback is gone. Reload to see where things stand.' using errcode = 'no_data_found';
  end if;
  perform public.general_feedback_check(fb.project_id, true);
  if p_status is null then
    raise exception 'Choose a status: open, acknowledged or resolved.' using errcode = 'check_violation';
  end if;
  if fb.status = p_status then
    return;
  end if;
  update public.general_feedback
     set status = p_status, status_changed_by = auth.uid(), status_changed_at = now()
   where id = p_feedback;
end;
$$;

-- ---------------------------------------------------------------- notifications

create or replace function public.notify_general_feedback_posted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, general_project_id, title, preview)
  select m.user_id, 'feedback_posted', new.project_id, 'New feedback: ' || new.title, gp.name
    from public.general_members m
    join public.general_projects gp on gp.id = m.project_id
    join public.notification_prefs np on np.user_id = m.user_id
   where m.project_id = new.project_id
     and m.role in ('pm', 'coordinator')
     and m.user_id <> new.author_id
     and np.project_updates;
  return new;
end;
$$;

drop trigger if exists general_feedback_notify_posted on public.general_feedback;
create trigger general_feedback_notify_posted after insert on public.general_feedback
  for each row execute function public.notify_general_feedback_posted();

create or replace function public.notify_general_feedback_reply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, general_project_id, title, preview)
  select f.author_id, 'feedback_reply', new.project_id,
         public.display_name(new.author_id) || ' replied to ' || f.title, gp.name
    from public.general_feedback f
    join public.general_projects gp on gp.id = f.project_id
    join public.notification_prefs np on np.user_id = f.author_id
   where f.id = new.feedback_id
     and f.author_id <> new.author_id
     and np.project_updates
     and exists (select 1 from public.general_members m
                  where m.project_id = f.project_id and m.user_id = f.author_id);
  return new;
end;
$$;

drop trigger if exists general_feedback_replies_notify on public.general_feedback_replies;
create trigger general_feedback_replies_notify after insert on public.general_feedback_replies
  for each row execute function public.notify_general_feedback_reply();

create or replace function public.notify_general_feedback_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, general_project_id, title, preview)
  select new.author_id, 'feedback_status', new.project_id,
         -- The enum's labels read as the status in a sentence.
         new.title || ' is now ' || new.status::text,
         gp.name
    from public.general_projects gp
    join public.notification_prefs np on np.user_id = new.author_id
   where gp.id = new.project_id
     and new.author_id is distinct from new.status_changed_by
     and np.project_updates
     and exists (select 1 from public.general_members m
                  where m.project_id = new.project_id and m.user_id = new.author_id);
  return new;
end;
$$;

drop trigger if exists general_feedback_notify_status on public.general_feedback;
create trigger general_feedback_notify_status after update of status on public.general_feedback
  for each row when (new.status is distinct from old.status)
  execute function public.notify_general_feedback_status();

-- ---------------------------------------------------------------- the sweep

/**
 * storage-sweep.sql's storage_orphans, from its live copy, with feedback-files
 * added: a file attached to a post or reply is kept, an unattached one is
 * cleared a day after upload.
 */
create or replace function public.storage_orphans(
  p_limit int default 500,
  p_grace interval default interval '1 day'
) returns table (bucket_id text, name text)
language sql stable security definer set search_path = public as $$
  with used (bucket_id, path) as (
              select 'general-files', f.file_path from public.general_task_files f
    union all select 'general-files', b.storage_path from public.general_blobs b where b.storage_path is not null
    union all select 'general-files', d.storage_path from public.general_draft_files d where d.storage_path is not null
    union all select 'general-files', x ->> 'storage_path'
                from public.general_repo_changes ch, jsonb_array_elements(ch.files) x
               where x ->> 'storage_path' is not null
    union all select 'general-files', x ->> 'storage_path'
                from public.general_shares sh, jsonb_array_elements(sh.files) x
               where x ->> 'storage_path' is not null
    union all select 'task-files', t.file_path from public.task_files t
    union all select 'project-files', a.file_path from public.project_attachments a
    union all select 'class-files', a.file_path from public.announcement_attachments a
    union all select 'chat-files', m.file_path from public.message_attachments m
    union all select 'teaching-resources', r.file_path from public.teaching_resources r
    union all select 'discussion-voice', m.audio_path
                from public.general_discussion_messages m where m.audio_path is not null
    union all select 'discussion-files', df.file_path from public.general_discussion_files df
    union all select 'feedback-files', ff.path from public.general_feedback_files ff
  )
  select o.bucket_id, o.name
    from storage.objects o
   where o.bucket_id in ('general-files', 'task-files', 'project-files', 'class-files',
                         'chat-files', 'teaching-resources', 'discussion-voice', 'discussion-files',
                         'feedback-files')
     and o.created_at < now() - p_grace
     -- Pictures inside Word files: only some version's HTML refers to them,
     -- and versions are history, so they are kept like any committed file.
     and not (o.bucket_id = 'general-files' and o.name like '%/files/doc-images/%')
     and not exists (select 1 from used u where u.bucket_id = o.bucket_id and u.path = o.name)
   order by o.created_at
   limit p_limit;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.storage_orphans(int, interval) from public, anon, authenticated;
revoke all on function public.general_feedback_check(uuid, boolean) from public, anon, authenticated;
revoke all on function public.general_feedback_attach(uuid, uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function public.notify_general_feedback_posted() from public, anon, authenticated;
revoke all on function public.notify_general_feedback_reply() from public, anon, authenticated;
revoke all on function public.notify_general_feedback_status() from public, anon, authenticated;

revoke all on function public.feedback_file_path_ok(text) from public, anon;
revoke all on function public.feedback_file_readable(text) from public, anon;
grant execute on function public.feedback_file_path_ok(text) to authenticated;
grant execute on function public.feedback_file_readable(text) to authenticated;

revoke all on function public.create_general_feedback(uuid, public.general_feedback_kind, text, text, text[]) from public, anon;
revoke all on function public.reply_general_feedback(uuid, text, text[]) from public, anon;
revoke all on function public.set_general_feedback_status(uuid, public.general_feedback_status) from public, anon;
grant execute on function public.create_general_feedback(uuid, public.general_feedback_kind, text, text, text[]) to authenticated;
grant execute on function public.reply_general_feedback(uuid, text, text[]) to authenticated;
grant execute on function public.set_general_feedback_status(uuid, public.general_feedback_status) to authenticated;

commit;
