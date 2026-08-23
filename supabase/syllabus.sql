-- Collabify — syllabus week map. Structured weeks a project can bind to.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/syllabus.sql

begin;

do $$ begin
  create type public.parse_status as enum ('unparsed', 'parsing', 'draft', 'verified', 'failed');
exception when duplicate_object then null; end $$;

alter table public.teaching_resources
  add column if not exists parse_status public.parse_status not null default 'unparsed',
  add column if not exists parsed_at timestamptz,
  add column if not exists parse_error text;

-- Nullable: an existing class keeps working and simply prompts for its dates.
alter table public.classes
  add column if not exists term_start date,
  add column if not exists term_end date;

-- Weeks hang off the syllabus, not the class, so one verified syllabus serves
-- every class that uses it. Calendar dates come from the class's term_start.
create table if not exists public.syllabus_weeks (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.teaching_resources (id) on delete cascade,
  week_no     int not null,
  title       text not null default '',
  topics      text not null default '',
  outcomes    text not null default '',
  -- What the week expects handed in ("Project Milestone 2", "Lab 6"). This is
  -- what a project binds to, so it is its own column.
  assessments text not null default '',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint syllabus_weeks_no_sane check (week_no between 1 and 60),
  constraint syllabus_weeks_unique_no unique (resource_id, week_no)
);

create index if not exists syllabus_weeks_resource_idx
  on public.syllabus_weeks (resource_id, week_no);

drop trigger if exists syllabus_weeks_touch on public.syllabus_weeks;
create trigger syllabus_weeks_touch before update on public.syllabus_weeks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- helpers

create or replace function public.owns_resource(p_resource uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teaching_resources
     where id = p_resource and professor_id = auth.uid()
  );
$$;

/** True when the caller is in, or teaches, a live class using this syllabus. */
create or replace function public.can_read_syllabus(p_resource uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.classes c
      left join public.class_members m
        on m.class_id = c.id and m.student_id = auth.uid() and m.status = 'active'
     where c.syllabus_id = p_resource
       and c.archived_at is null
       and (c.professor_id = auth.uid() or m.student_id is not null)
  );
$$;

-- ---------------------------------------------------------------- RLS

alter table public.syllabus_weeks enable row level security;

drop policy if exists syllabus_weeks_select on public.syllabus_weeks;
create policy syllabus_weeks_select on public.syllabus_weeks
  for select using (public.owns_resource(resource_id) or public.can_read_syllabus(resource_id));

drop policy if exists syllabus_weeks_write on public.syllabus_weeks;
create policy syllabus_weeks_write on public.syllabus_weeks
  for all using (public.owns_resource(resource_id))
  with check (public.owns_resource(resource_id));

-- ---------------------------------------------------------------- view

-- Every consumer reads this rather than recomputing dates. Week 1 starts on
-- term_start; week N runs the seven days from term_start + (N-1) weeks.
-- Dropped first: `create or replace` cannot insert a column mid-list, so a new
-- field would fail on an existing view.
-- `cascade`: reports.sql builds on this view, and it is recreated below, so a
-- bare drop makes this file unrunnable once the report views exist. Re-run
-- reports.sql after this file.
drop view if exists public.class_week_map cascade;

create view public.class_week_map
with (security_invoker = true) as
select c.id                                                     as class_id,
       c.syllabus_id,
       w.id                                                     as week_id,
       w.week_no,
       w.title,
       w.topics,
       w.outcomes,
       w.assessments,
       w.notes,
       c.term_start,
       c.term_end,
       (c.term_start + ((w.week_no - 1) * 7))::date             as week_start,
       (c.term_start + ((w.week_no - 1) * 7) + 6)::date         as week_end,
       case
         when c.term_start is null then 'undated'
         when current_date <  (c.term_start + ((w.week_no - 1) * 7))     then 'upcoming'
         when current_date <= (c.term_start + ((w.week_no - 1) * 7) + 6) then 'current'
         else 'past'
       end                                                      as phase
  from public.classes c
  join public.syllabus_weeks w on w.resource_id = c.syllabus_id;

grant select on public.class_week_map to authenticated;

commit;
