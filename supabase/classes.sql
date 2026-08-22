-- Collabify phase 2 — classes, rosters, announcements, teaching resources, notifications.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/classes.sql

begin;

-- ---------------------------------------------------------------- enums

do $$ begin
  create type public.year_level as enum ('1st', '2nd', '3rd', '4th');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.semester as enum ('1st', '2nd', '3rd', 'summer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.member_status as enum ('active', 'removed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.resource_kind as enum ('syllabus', 'curriculum');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_type as enum ('announcement');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables

-- Syllabi and curricula are the same shape and differ only by `kind`, so the
-- Syllabi and Curriculum pages are one component with a filter.
create table if not exists public.teaching_resources (
  id           uuid primary key default gen_random_uuid(),
  professor_id uuid not null references public.profiles (id) on delete cascade,
  kind         public.resource_kind not null,
  title        text not null,
  file_path    text not null,
  file_name    text not null,
  size_bytes   bigint not null default 0,
  uploaded_at  timestamptz not null default now()
);

create index if not exists teaching_resources_owner_idx
  on public.teaching_resources (professor_id, kind, uploaded_at desc);

create table if not exists public.classes (
  id            uuid primary key default gen_random_uuid(),
  professor_id  uuid not null references public.profiles (id) on delete cascade,
  name          text not null,
  initial       text not null,
  code          text not null unique,
  section       text not null,
  year_level    public.year_level not null,
  semester      public.semester not null,
  -- Text rather than an enum: a new school year must not need a migration.
  school_year   text not null,
  description   text,
  syllabus_id   uuid references public.teaching_resources (id) on delete set null,
  curriculum_id uuid references public.teaching_resources (id) on delete set null,
  join_open     boolean not null default true,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint classes_initial_shape check (initial ~ '^[A-Z0-9]{2,6}$'),
  constraint classes_school_year_shape check (school_year ~ '^\d{4}-\d{4}$')
);

create index if not exists classes_professor_idx on public.classes (professor_id, archived_at);

create table if not exists public.class_members (
  class_id   uuid not null references public.classes (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  status     public.member_status not null default 'active',
  joined_at  timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete set null,
  primary key (class_id, student_id)
);

create index if not exists class_members_student_idx
  on public.class_members (student_id, status);

create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.classes (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  body       text not null,
  pinned     boolean not null default false,
  edited_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists announcements_class_idx
  on public.announcements (class_id, pinned desc, created_at desc);

-- At most one pinned announcement per class.
create unique index if not exists announcements_one_pin_per_class
  on public.announcements (class_id) where pinned;

create table if not exists public.announcement_attachments (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  file_path       text not null,
  file_name       text not null,
  mime_type       text,
  size_bytes      bigint not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists announcement_attachments_parent_idx
  on public.announcement_attachments (announcement_id);

-- Deliberately generic: task assignments and deadline reminders will reuse this.
create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  type            public.notification_type not null,
  class_id        uuid references public.classes (id) on delete cascade,
  announcement_id uuid references public.announcements (id) on delete cascade,
  title           text not null,
  preview         text,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists notifications_inbox_idx
  on public.notifications (user_id, read_at, created_at desc);

-- ---------------------------------------------------------------- helpers

-- All three are security definer so RLS policies can ask membership questions
-- without re-entering the policy they are defined on. Same pattern as
-- public.is_admin() in schema.sql.

create or replace function public.is_class_professor(p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.classes
    where id = p_class and professor_id = auth.uid()
  );
$$;

create or replace function public.is_active_member(p_class uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.class_members
    where class_id = p_class and student_id = auth.uid() and status = 'active'
  );
$$;

-- Backs the classmate roster: true when caller and p_user share a live class.
create or replace function public.shares_class_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.class_members me
      join public.class_members them on them.class_id = me.class_id
      join public.classes c on c.id = me.class_id
     where me.student_id = auth.uid() and me.status = 'active'
       and them.student_id = p_user and them.status = 'active'
       and c.archived_at is null
    union all
    -- A professor and the students in their class see each other's names.
    select 1
      from public.classes c
      join public.class_members m on m.class_id = c.id and m.status = 'active'
     where (c.professor_id = auth.uid() and m.student_id = p_user)
        or (c.professor_id = p_user and m.student_id = auth.uid())
  );
$$;

create or replace function public.generate_class_code(p_initial text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  candidate text;
  attempts  int := 0;
begin
  loop
    candidate := upper(p_initial) || '-' || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from public.classes where code = candidate);
    attempts := attempts + 1;
    if attempts > 50 then
      raise exception 'Could not generate a unique class code for %', p_initial;
    end if;
  end loop;
  return candidate;
end;
$$;

-- Fill the code server-side so the client can never choose or collide on one.
create or replace function public.set_class_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code is null or new.code = '' then
    new.code := public.generate_class_code(new.initial);
  end if;
  return new;
end;
$$;

drop trigger if exists classes_set_code on public.classes;
create trigger classes_set_code before insert on public.classes
  for each row execute function public.set_class_code();

drop trigger if exists classes_touch on public.classes;
create trigger classes_touch before update on public.classes
  for each row execute function public.touch_updated_at();

drop trigger if exists announcements_touch on public.announcements;
create trigger announcements_touch before update on public.announcements
  for each row execute function public.touch_updated_at();

-- One notification per active member, skipping anyone who switched
-- announcements off in settings.
create or replace function public.notify_class_announcement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, class_id, announcement_id, title, preview)
  select m.student_id,
         'announcement',
         new.class_id,
         new.id,
         new.title,
         left(regexp_replace(new.body, '\s+', ' ', 'g'), 140)
    from public.class_members m
    join public.notification_prefs np on np.user_id = m.student_id
   where m.class_id = new.class_id
     and m.status = 'active'
     and np.announcements
     and m.student_id <> new.author_id;
  return new;
end;
$$;

drop trigger if exists announcements_notify on public.announcements;
create trigger announcements_notify after insert on public.announcements
  for each row execute function public.notify_class_announcement();

-- ---------------------------------------------------------------- join RPC

-- Joining needs several checks and a distinct message for each, which a single
-- INSERT policy cannot express. The client calls this and switches on the result.
create or replace function public.join_class(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  target public.classes%rowtype;
  caller public.profiles%rowtype;
  existing public.class_members%rowtype;
begin
  select * into caller from public.profiles where id = auth.uid();
  if not found then
    return jsonb_build_object('result', 'not_signed_in');
  end if;
  if caller.role <> 'student' then
    return jsonb_build_object('result', 'not_student');
  end if;

  select * into target from public.classes where upper(code) = upper(trim(p_code));
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if target.archived_at is not null then
    return jsonb_build_object('result', 'archived');
  end if;

  select * into existing from public.class_members
   where class_id = target.id and student_id = caller.id;

  if found and existing.status = 'removed' then
    return jsonb_build_object('result', 'blocked');
  end if;
  if found then
    return jsonb_build_object('result', 'already_member', 'class_id', target.id);
  end if;
  if not target.join_open then
    return jsonb_build_object('result', 'closed');
  end if;

  insert into public.class_members (class_id, student_id) values (target.id, caller.id);
  return jsonb_build_object('result', 'joined', 'class_id', target.id);
end;
$$;

revoke all on function public.join_class(text) from public;
grant execute on function public.join_class(text) to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.classes                 enable row level security;
alter table public.class_members           enable row level security;
alter table public.announcements           enable row level security;
alter table public.announcement_attachments enable row level security;
alter table public.teaching_resources      enable row level security;
alter table public.notifications           enable row level security;

-- classes: owner writes; active members read live classes; admin reads all.
drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes
  for select using (
    professor_id = auth.uid()
    or public.is_admin()
    or (archived_at is null and public.is_active_member(id))
  );

drop policy if exists classes_insert on public.classes;
create policy classes_insert on public.classes
  for insert with check (professor_id = auth.uid());

drop policy if exists classes_update on public.classes;
create policy classes_update on public.classes
  for update using (professor_id = auth.uid()) with check (professor_id = auth.uid());

drop policy if exists classes_delete on public.classes;
create policy classes_delete on public.classes
  for delete using (professor_id = auth.uid());

-- class_members: professor manages the roster; students see their classmates.
drop policy if exists class_members_select on public.class_members;
create policy class_members_select on public.class_members
  for select using (
    student_id = auth.uid()
    or public.is_class_professor(class_id)
    or public.is_active_member(class_id)
  );

-- Inserts go through join_class(); no direct client insert path.
drop policy if exists class_members_update on public.class_members;
create policy class_members_update on public.class_members
  for update using (public.is_class_professor(class_id))
  with check (public.is_class_professor(class_id));

drop policy if exists class_members_delete on public.class_members;
create policy class_members_delete on public.class_members
  for delete using (public.is_class_professor(class_id));

-- announcements: professor writes, active members read.
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select using (
    public.is_class_professor(class_id)
    or (
      public.is_active_member(class_id)
      and exists (select 1 from public.classes c where c.id = class_id and c.archived_at is null)
    )
  );

drop policy if exists announcements_write on public.announcements;
create policy announcements_write on public.announcements
  for all using (public.is_class_professor(class_id))
  with check (public.is_class_professor(class_id) and author_id = auth.uid());

drop policy if exists announcement_attachments_select on public.announcement_attachments;
create policy announcement_attachments_select on public.announcement_attachments
  for select using (
    exists (
      select 1 from public.announcements a
       where a.id = announcement_id
         and (public.is_class_professor(a.class_id) or public.is_active_member(a.class_id))
    )
  );

drop policy if exists announcement_attachments_write on public.announcement_attachments;
create policy announcement_attachments_write on public.announcement_attachments
  for all using (
    exists (
      select 1 from public.announcements a
       where a.id = announcement_id and public.is_class_professor(a.class_id)
    )
  )
  with check (
    exists (
      select 1 from public.announcements a
       where a.id = announcement_id and public.is_class_professor(a.class_id)
    )
  );

drop policy if exists teaching_resources_own on public.teaching_resources;
create policy teaching_resources_own on public.teaching_resources
  for all using (professor_id = auth.uid()) with check (professor_id = auth.uid());

-- notifications: read and mark read your own. Rows are created by the trigger.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete using (user_id = auth.uid());

-- Phase 1 let you read only your own profile. The classmate roster needs names
-- and avatars of people you actually share a live class with — nothing wider.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (
    id = auth.uid() or public.is_admin() or public.shares_class_with(id)
  );

-- ---------------------------------------------------------------- views

-- Cards and headers always want the live student count. security_invoker keeps
-- the caller's RLS in force, so a student counts only the classes they are in.
--
-- The columns are spelled out rather than `c.*`. Postgres freezes a star at
-- creation, so `term_start` and `term_end` — added later by syllabus.sql — never
-- reached this view: the class page read them as undefined and went on offering
-- to set dates that were already set. A named list makes adding a column a
-- deliberate edit here, and the drop is needed because `create or replace`
-- refuses a column inserted before an existing one.
drop view if exists public.class_overview;

create view public.class_overview
with (security_invoker = true) as
select c.id,
       c.professor_id,
       c.name,
       c.initial,
       c.code,
       c.section,
       c.year_level,
       c.semester,
       c.school_year,
       c.description,
       c.syllabus_id,
       c.curriculum_id,
       c.join_open,
       c.term_start,
       c.term_end,
       c.archived_at,
       c.created_at,
       c.updated_at,
       (
         select count(*)
           from public.class_members m
          where m.class_id = c.id and m.status = 'active'
       )::int as student_count
  from public.classes c;

grant select on public.class_overview to authenticated;

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values ('class-files', 'class-files', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('teaching-resources', 'teaching-resources', false)
on conflict (id) do update set public = false;

-- class-files paths start with the class id: <class_id>/announcements/<id>/<file>
drop policy if exists class_files_read on storage.objects;
create policy class_files_read on storage.objects
  for select using (
    bucket_id = 'class-files'
    and (
      public.is_class_professor(((storage.foldername(name))[1])::uuid)
      or public.is_active_member(((storage.foldername(name))[1])::uuid)
    )
  );

drop policy if exists class_files_write on storage.objects;
create policy class_files_write on storage.objects
  for insert with check (
    bucket_id = 'class-files'
    and public.is_class_professor(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists class_files_delete on storage.objects;
create policy class_files_delete on storage.objects
  for delete using (
    bucket_id = 'class-files'
    and public.is_class_professor(((storage.foldername(name))[1])::uuid)
  );

-- teaching-resources paths start with the owner id: <professor_id>/<kind>/<file>
drop policy if exists teaching_resources_own_objects on storage.objects;
create policy teaching_resources_own_objects on storage.objects
  for all using (
    bucket_id = 'teaching-resources' and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'teaching-resources' and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
