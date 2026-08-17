-- Collabify — projects. Every project binds to a span of syllabus weeks.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/projects.sql

begin;

-- ---------------------------------------------------------------- enums

do $$ begin
  create type public.project_type as enum (
    'web_dev', 'mobile_dev', 'research', 'capstone',
    'group_programming', 'individual_programming',
    'activity', 'laboratory', 'quiz', 'exam', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.project_audience as enum ('group', 'individual');
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.notification_type add value if not exists 'project_released';
exception when undefined_object then null; end $$;

commit;

-- New enum values cannot be used in the transaction that adds them.
begin;

-- ---------------------------------------------------------------- tables

create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes (id) on delete cascade,
  created_by   uuid not null references public.profiles (id) on delete cascade,
  title        text not null,
  type         public.project_type not null,
  -- Free label when type = 'other', so the list stays open-ended.
  type_label   text,
  guidelines   text not null default '',

  -- The syllabus basis. A project cannot exist without one.
  start_week   int not null,
  end_week     int not null,

  audience     public.project_audience not null,
  -- Set only when audience = 'group': which arrangement receives it.
  group_set_id uuid references public.group_sets (id),

  total_points int not null default 100,
  due_at       timestamptz,
  -- Null means visible now. A future time keeps it hidden from students.
  release_at   timestamptz,

  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint projects_week_span check (start_week >= 1 and end_week >= start_week),
  constraint projects_points_sane check (total_points between 1 and 1000),
  constraint projects_type_label check (type <> 'other' or coalesce(type_label, '') <> ''),
  -- A group project needs a group set; an individual one must not carry one.
  constraint projects_audience_shape check (
    (audience = 'group' and group_set_id is not null) or
    (audience = 'individual' and group_set_id is null)
  )
);

create index if not exists projects_class_idx
  on public.projects (class_id, start_week, created_at desc);

-- Deleting a group set out from under a project would leave a group project with
-- nobody to give it to, and the audience check would reject the resulting row
-- anyway. Refuse the delete instead, so the professor is told which projects
-- still point at that arrangement.
do $$ begin
  alter table public.projects drop constraint if exists projects_group_set_id_fkey;
  alter table public.projects
    add constraint projects_group_set_id_fkey
    foreign key (group_set_id) references public.group_sets (id) on delete restrict;
end $$;

create table if not exists public.project_criteria (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  position     int not null default 1,
  label        text not null,
  description  text not null default '',
  max_points   int not null default 10,
  constraint project_criteria_points_sane check (max_points between 1 and 1000)
);

create index if not exists project_criteria_project_idx
  on public.project_criteria (project_id, position);

create table if not exists public.project_attachments (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  file_path  text not null,
  file_name  text not null,
  mime_type  text,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists project_attachments_project_idx
  on public.project_attachments (project_id);

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

alter table public.notifications
  add column if not exists project_id uuid references public.projects (id) on delete cascade;

-- ---------------------------------------------------------------- helpers

create or replace function public.is_project_professor(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
      join public.classes c on c.id = p.class_id
     where p.id = p_project and c.professor_id = auth.uid()
  );
$$;

/** Projects still pointing at an arrangement. Drives the delete warning. */
create or replace function public.projects_using_set(p_set uuid)
returns int language sql stable security definer set search_path = public as $$
  select case
    when public.is_set_professor(p_set)
      then (select count(*)::int from public.projects p where p.group_set_id = p_set)
    else 0
  end;
$$;

/** Released to students, or still scheduled. The single visibility rule. */
create or replace function public.project_is_live(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
     where p.id = p_project
       and p.archived_at is null
       and (p.release_at is null or p.release_at <= now())
  );
$$;

-- The week span must exist in the class's syllabus. Without this a project
-- could name week 40 of an 18-week course and nothing would notice.
create or replace function public.guard_project_weeks()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  available int;
begin
  select count(*) into available
    from public.classes c
    join public.syllabus_weeks w on w.resource_id = c.syllabus_id
   where c.id = new.class_id
     and w.week_no between new.start_week and new.end_week;

  if available < (new.end_week - new.start_week + 1) then
    raise exception
      'Weeks % to % are not all in this class''s syllabus', new.start_week, new.end_week;
  end if;

  -- A group set must belong to the same class as the project.
  if new.group_set_id is not null and not exists (
    select 1 from public.group_sets s
     where s.id = new.group_set_id and s.class_id = new.class_id
  ) then
    raise exception 'That group set belongs to a different class';
  end if;

  return new;
end;
$$;

drop trigger if exists projects_guard_weeks on public.projects;
create trigger projects_guard_weeks before insert or update on public.projects
  for each row execute function public.guard_project_weeks();

-- ---------------------------------------------------------------- release

/** Notifies the right people the moment a project becomes visible. */
create or replace function public.notify_project_released()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  was_live boolean := tg_op = 'UPDATE'
    and old.archived_at is null
    and (old.release_at is null or old.release_at <= now());
  now_live boolean := new.archived_at is null
    and (new.release_at is null or new.release_at <= now());
  class_name text;
begin
  if was_live or not now_live then
    return new;
  end if;

  select c.name into class_name from public.classes c where c.id = new.class_id;

  insert into public.notifications (user_id, type, class_id, project_id, title, preview)
  select m.student_id, 'project_released', new.class_id, new.id,
         new.title,
         'New in ' || class_name || ' · weeks ' || new.start_week || '–' || new.end_week
    from public.class_members m
    join public.notification_prefs np on np.user_id = m.student_id
   where m.class_id = new.class_id
     and m.status = 'active'
     and np.task_assignments
     -- A group project reaches only the students actually placed in it.
     and (
       new.group_set_id is null
       or exists (
         select 1 from public.group_members gm
          where gm.set_id = new.group_set_id and gm.student_id = m.student_id
       )
     );
  return new;
end;
$$;

drop trigger if exists projects_notify_released on public.projects;
create trigger projects_notify_released after insert or update on public.projects
  for each row execute function public.notify_project_released();

-- ---------------------------------------------------------------- RLS

alter table public.projects            enable row level security;
alter table public.project_criteria    enable row level security;
alter table public.project_attachments enable row level security;

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select using (
    public.is_class_professor(class_id)
    or (
      public.is_active_member(class_id)
      and archived_at is null
      -- Scheduled projects stay invisible until their release time.
      and (release_at is null or release_at <= now())
      -- A group project is only for the students in that arrangement.
      and (
        group_set_id is null
        or exists (
          select 1 from public.group_members gm
           where gm.set_id = group_set_id and gm.student_id = auth.uid()
        )
      )
    )
  );

drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects
  for all using (public.is_class_professor(class_id))
  with check (public.is_class_professor(class_id) and created_by = auth.uid());

drop policy if exists project_criteria_select on public.project_criteria;
create policy project_criteria_select on public.project_criteria
  for select using (
    exists (select 1 from public.projects p where p.id = project_id)
    and (public.is_project_professor(project_id) or public.project_is_live(project_id))
  );

drop policy if exists project_criteria_write on public.project_criteria;
create policy project_criteria_write on public.project_criteria
  for all using (public.is_project_professor(project_id))
  with check (public.is_project_professor(project_id));

drop policy if exists project_attachments_select on public.project_attachments;
create policy project_attachments_select on public.project_attachments
  for select using (
    public.is_project_professor(project_id) or public.project_is_live(project_id)
  );

drop policy if exists project_attachments_write on public.project_attachments;
create policy project_attachments_write on public.project_attachments
  for all using (public.is_project_professor(project_id))
  with check (public.is_project_professor(project_id));

-- ---------------------------------------------------------------- view

drop view if exists public.project_overview;

create view public.project_overview
with (security_invoker = true) as
select p.*,
       c.name    as class_name,
       c.initial as class_initial,
       s.name    as group_set_name,
       (select count(*) from public.project_criteria x where x.project_id = p.id)::int
         as criteria_count,
       (select coalesce(sum(x.max_points), 0) from public.project_criteria x
         where x.project_id = p.id)::int as criteria_points,
       (select count(*) from public.project_attachments a where a.project_id = p.id)::int
         as attachment_count,
       (p.release_at is not null and p.release_at > now()) as scheduled,
       (select w.title from public.syllabus_weeks w
         where w.resource_id = c.syllabus_id and w.week_no = p.start_week) as start_week_title,
       (select string_agg(w.assessments, ' · ' order by w.week_no)
          from public.syllabus_weeks w
         where w.resource_id = c.syllabus_id
           and w.week_no between p.start_week and p.end_week
           and w.assessments <> '') as week_assessments
  from public.projects p
  join public.classes c on c.id = p.class_id
  left join public.group_sets s on s.id = p.group_set_id;

grant select on public.project_overview to authenticated;

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do update set public = false;

-- Paths start with the project id.
drop policy if exists project_files_read on storage.objects;
create policy project_files_read on storage.objects
  for select using (
    bucket_id = 'project-files'
    and (
      public.is_project_professor(((storage.foldername(name))[1])::uuid)
      or public.project_is_live(((storage.foldername(name))[1])::uuid)
    )
  );

drop policy if exists project_files_write on storage.objects;
create policy project_files_write on storage.objects
  for insert with check (
    bucket_id = 'project-files'
    and public.is_project_professor(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists project_files_delete on storage.objects;
create policy project_files_delete on storage.objects
  for delete using (
    bucket_id = 'project-files'
    and public.is_project_professor(((storage.foldername(name))[1])::uuid)
  );

commit;
