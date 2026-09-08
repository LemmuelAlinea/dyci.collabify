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

-- ------------------------------------------------------------ term shifts

/**
 * When a term slips.
 *
 * A typhoon closed the school for a week and everything from the midterm
 * onward moved. Before this table there was nothing to move: a week has no
 * date of its own, and every calendar date in the product is computed as
 * `term_start + (week_no - 1) * 7`. The only lever was `term_start`, which
 * drags the weeks already taught along with the ones still to come.
 *
 * One row per disruption. A week's offset is the sum of every shift at or
 * before it, so the effect cascades forward on its own and a second typhoon is
 * a second row.
 *
 * **This is a log of events, not a table of dates.** The obvious alternative
 * was `class_week_dates (class_id, week_no, week_start)` overriding the
 * arithmetic per week, and it is worse in three ways. It stores the result and
 * loses the reason, which is the one sentence a student actually needs. It has
 * to rewrite the whole tail on every edit. And once it has materialised weeks
 * 4 to 16, changing `term_start` silently stops moving them — a surprise
 * nobody would predict from the term-dates card.
 *
 * Per class, not per syllabus. Weeks hang off the shared resource, and one
 * syllabus here already serves two classes; putting dates on `syllabus_weeks`
 * would re-date somebody else's section from inside your own.
 */
create table if not exists public.class_week_shifts (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.classes (id) on delete cascade,
  /** The first week that moves. Everything after it moves by the same amount. */
  from_week  int  not null check (from_week between 1 and 60),
  /** Positive is later. Bounded so a typo cannot push a term into next year. */
  days       int  not null check (days <> 0 and days between -180 and 180),
  /** Shown to students on the week map. "Typhoon Kristine — classes suspended". */
  reason     text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists class_week_shifts_class_idx
  on public.class_week_shifts (class_id, from_week);

comment on table public.class_week_shifts is
  'One row per disruption. Week offset = sum(days) where from_week <= week_no. Written only by public.shift_class_weeks().';

-- ---------------------------------------------------------------- RLS

alter table public.syllabus_weeks enable row level security;
alter table public.class_week_shifts enable row level security;

/**
 * Anyone who can see the class can see why its dates moved. That is the whole
 * point of recording a reason — a student who planned around the old midterm
 * date is owed the explanation, not just the new date.
 */
drop policy if exists class_week_shifts_select on public.class_week_shifts;
create policy class_week_shifts_select on public.class_week_shifts
  for select to authenticated
  using (public.is_class_professor(class_id) or public.is_active_member(class_id));

/**
 * No insert, update or delete policy for anybody, including the professor who
 * owns the class. Writes go through `shift_class_weeks` in term-shifts.sql,
 * which is where the ownership check, the `term_end` adjustment and the
 * author stamp live. A policy wide enough to let a professor insert a shift
 * would also let them insert one on a class they do not teach.
 */
revoke insert, update, delete on public.class_week_shifts from anon, authenticated;

drop policy if exists syllabus_weeks_select on public.syllabus_weeks;
create policy syllabus_weeks_select on public.syllabus_weeks
  for select using (public.owns_resource(resource_id) or public.can_read_syllabus(resource_id));

drop policy if exists syllabus_weeks_write on public.syllabus_weeks;
create policy syllabus_weeks_write on public.syllabus_weeks
  for all using (public.owns_resource(resource_id))
  with check (public.owns_resource(resource_id));

-- ---------------------------------------------------------------- view

-- Every consumer reads this rather than recomputing dates. Week 1 starts on
-- term_start; week N runs the seven days from term_start + (N-1) weeks, plus
-- whatever `class_week_shifts` has moved it by.
--
-- `class_gaps` in analytics.sql used to re-derive this arithmetic instead of
-- reading the view, and once weeks could move the two would have disagreed by
-- exactly the shift. It now joins this view. If a third place ever needs a week
-- date, it joins here too — the formula lives once.
--
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
       sh.offset_days,
       (c.term_start + ((w.week_no - 1) * 7) + sh.offset_days)::date     as week_start,
       (c.term_start + ((w.week_no - 1) * 7) + sh.offset_days + 6)::date as week_end,
       case
         when c.term_start is null then 'undated'
         when current_date <  (c.term_start + ((w.week_no - 1) * 7) + sh.offset_days)     then 'upcoming'
         when current_date <= (c.term_start + ((w.week_no - 1) * 7) + sh.offset_days + 6) then 'current'
         else 'past'
       end                                                      as phase
  from public.classes c
  join public.syllabus_weeks w on w.resource_id = c.syllabus_id
  -- Lateral rather than a correlated expression repeated four times: the sum is
  -- computed once per week and the three date expressions read it.
  left join lateral (
    select coalesce(sum(s.days), 0)::int as offset_days
      from public.class_week_shifts s
     where s.class_id = c.id
       and s.from_week <= w.week_no
  ) sh on true;

grant select on public.class_week_map to authenticated;

commit;
