-- Collabify — a place to keep work before it is work you hand in.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/group-drive.sql

/**
 * A task attachment means "this is the deliverable". There was nowhere to put
 * the things that come before one: a draft, the raw dataset, the file two
 * members are still arguing about.
 *
 * So the drive means exactly one thing — **not handed in yet** — and it stays
 * true because attaching moves a file out of it. One file is never in both
 * places, so nothing has to be reconciled at grading time, and a group sitting
 * on six staged files with nothing attached is visible as exactly that.
 *
 * The professor reads it and cannot touch it. Seeing that a quiet group has
 * been working is worth a lot; deleting somebody's draft is worth nothing.
 */

begin;

create table if not exists public.group_files (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  uploaded_by uuid references public.profiles (id) on delete set null,
  file_path   text not null,
  file_name   text not null,
  mime_type   text,
  size_bytes  bigint not null default 0,
  note        text not null default '',
  created_at  timestamptz not null default now(),

  constraint group_files_name_present check (length(btrim(file_name)) > 0)
);

create index if not exists group_files_by_group
  on public.group_files (group_id, created_at desc);

-- The class a group belongs to, so the professor's read can be checked without
-- walking the same three joins in four policies.
create or replace function public.group_class(p_group uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.class_id
    from public.groups g
    join public.group_sets s on s.id = g.set_id
   where g.id = p_group;
$$;

/**
 * A ceiling, because storage has one and an opaque failure at the far end of a
 * long upload is a miserable way to find that out. Per group, so one group
 * cannot spend the whole project's room.
 */
create or replace function public.group_drive_limit()
returns bigint language sql immutable as $$ select (100 * 1024 * 1024)::bigint $$;

create or replace function public.group_drive_used(p_group uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(size_bytes), 0)::bigint
    from public.group_files where group_id = p_group;
$$;

grant execute on function public.group_drive_used(uuid) to authenticated;
grant execute on function public.group_drive_limit() to authenticated;

create or replace function public.guard_group_file()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  used bigint;
  cap  bigint := public.group_drive_limit();
begin
  if auth.uid() is null then
    return new; -- service role
  end if;

  new.uploaded_by := auth.uid();

  if not public.is_group_member(new.group_id) then
    raise exception 'Only this group can put files in its own space'
      using errcode = 'check_violation';
  end if;

  used := public.group_drive_used(new.group_id);
  if used + new.size_bytes > cap then
    raise exception
      'That would take the group past its % MB of space — % MB is already used. Remove something first.',
      round(cap / 1024.0 / 1024.0), round(used / 1024.0 / 1024.0, 1)
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists group_files_guard on public.group_files;
create trigger group_files_guard before insert on public.group_files
  for each row execute function public.guard_group_file();

-- ---------------------------------------------------------------- policies

alter table public.group_files enable row level security;

/** The group works in it; their professor can see what they are working on. */
drop policy if exists group_files_select on public.group_files;
create policy group_files_select on public.group_files
  for select using (
    public.is_group_member(group_id)
    or public.is_class_professor(public.group_class(group_id))
  );

drop policy if exists group_files_insert on public.group_files;
create policy group_files_insert on public.group_files
  for insert with check (public.is_group_member(group_id));

-- Read-only for the professor on purpose: a draft is the group's to withdraw.
drop policy if exists group_files_delete on public.group_files;
create policy group_files_delete on public.group_files
  for delete using (public.is_group_member(group_id));

grant select, insert, delete on public.group_files to authenticated;

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values ('group-files', 'group-files', false)
on conflict (id) do update set public = false;

-- Paths start with the group id.
drop policy if exists group_files_read on storage.objects;
create policy group_files_read on storage.objects
  for select using (
    bucket_id = 'group-files'
    and (
      public.is_group_member(((storage.foldername(name))[1])::uuid)
      or public.is_class_professor(
           public.group_class(((storage.foldername(name))[1])::uuid))
    )
  );

drop policy if exists group_files_write on storage.objects;
create policy group_files_write on storage.objects
  for insert with check (
    bucket_id = 'group-files'
    and public.is_group_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists group_files_remove on storage.objects;
create policy group_files_remove on storage.objects
  for delete using (
    bucket_id = 'group-files'
    and public.is_group_member(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------- view

/** The drive with the names around it, and the class it answers to. */
drop view if exists public.group_file_overview;

create view public.group_file_overview
with (security_invoker = true) as
select f.*,
       g.name    as group_name,
       g.set_id,
       s.class_id,
       c.initial as class_initial,
       c.name    as class_name,
       btrim(p.first_name || ' ' || p.last_name) as uploaded_by_name
  from public.group_files f
  join public.groups g      on g.id = f.group_id
  join public.group_sets s  on s.id = g.set_id
  join public.classes c     on c.id = s.class_id
  left join public.profiles p on p.id = f.uploaded_by;

grant select on public.group_file_overview to authenticated;

commit;
