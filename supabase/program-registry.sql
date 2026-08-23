-- Collabify — the sections the program runs, and the syllabi it publishes.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/program-registry.sql

/**
 * Two things the program office owns rather than any one professor.
 *
 * **Sections.** A class carries its section as free text, so BSIT 3A, BSIT-3A
 * and bsit 3a have all been the same cohort with three names. The chair keeps
 * the list now and the class form offers it, which is what makes a cohort
 * figure mean one thing.
 *
 * The column stays text and there is no foreign key. A class already written
 * with a section that is not in the registry must keep working — a required
 * reference would have made every one of them invalid the moment the table
 * existed. The registry is what the form offers; matching is by name, folded so
 * spacing and punctuation cannot split a cohort in two.
 *
 * **Program-wide resources.** A syllabus published by the chair, which every
 * professor teaching that course can attach to their class. Two sections of one
 * course running different outlines is the problem it solves, and it is one
 * boolean on `teaching_resources` rather than a second table precisely so that
 * `classes.syllabus_id` and `syllabus_weeks` keep working untouched.
 */

begin;

-- ---------------------------------------------------------------- sections

create table if not exists public.program_sections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  year_level  public.year_level not null,
  school_year text not null,
  -- The faculty member who looks after this cohort, when the program names one.
  adviser_id  uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint program_sections_name_present check (length(btrim(name)) > 0)
);

-- One section of one name per school year. The same name may return next year.
create unique index if not exists program_sections_name_key
  on public.program_sections (lower(replace(replace(name, ' ', ''), '-', '')), school_year);

alter table public.program_sections enable row level security;

-- Everybody may read the list: a professor picks from it when making a class,
-- and a student seeing their own section's name spelled the same everywhere is
-- the point of the thing.
drop policy if exists program_sections_read on public.program_sections;
create policy program_sections_read on public.program_sections
  for select using (auth.uid() is not null);

drop policy if exists program_sections_write on public.program_sections;
create policy program_sections_write on public.program_sections
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.program_sections to authenticated;
grant insert, update, delete on public.program_sections to authenticated;

/** Folded for comparison, so "BSIT 3A" and "bsit-3a" are one cohort. */
create or replace function public.section_key(p_name text)
returns text language sql immutable as $$
  select lower(replace(replace(replace(coalesce(p_name, ''), ' ', ''), '-', ''), '_', ''));
$$;

/**
 * Each section with what is actually running in it. Counts only, like the rest
 * of the chair's console — and matched by folded name, which is why a class
 * written before the registry existed still lands in the right cohort.
 */
drop view if exists public.program_section_overview;

create view public.program_section_overview
with (security_barrier = true) as
select s.id            as section_id,
       s.name,
       s.year_level,
       s.school_year,
       s.adviser_id,
       case when s.adviser_id is null then null
            else btrim(a.first_name || ' ' || a.last_name) end as adviser_name,
       s.archived_at,
       coalesce(c.classes, 0)    as classes,
       coalesce(c.professors, 0) as professors,
       coalesce(c.students, 0)   as students
  from public.program_sections s
  left join public.profiles a on a.id = s.adviser_id
  left join lateral (
    select count(*)::int                        as classes,
           count(distinct cl.professor_id)::int as professors,
           coalesce(sum((
             select count(*) from public.class_members m
              where m.class_id = cl.id and m.status = 'active'
           )), 0)::int                          as students
      from public.classes cl
     where public.section_key(cl.section) = public.section_key(s.name)
       and cl.school_year = s.school_year
       and cl.archived_at is null
  ) c on true
 where public.is_admin();

revoke all on public.program_section_overview from anon;
grant select on public.program_section_overview to authenticated;

-- ------------------------------------------------------ program resources

alter table public.teaching_resources
  add column if not exists program_wide boolean not null default false;

create index if not exists teaching_resources_program_idx
  on public.teaching_resources (kind, uploaded_at desc) where program_wide;

-- The owner policy still covers personal rows. This one opens the published
-- ones to everybody, read-only.
drop policy if exists teaching_resources_program_read on public.teaching_resources;
create policy teaching_resources_program_read on public.teaching_resources
  for select using (program_wide and auth.uid() is not null);

/**
 * Publishing is the chair's alone.
 *
 * Without this a professor could set `program_wide` on their own row — the
 * owner policy would allow it, since the row is theirs — and their private
 * outline would appear in everybody's library. The guard watches the column
 * rather than the caller, so it holds however the row was written.
 */
create or replace function public.guard_program_resource()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new; -- service role
  end if;
  if new.program_wide and not public.is_admin() then
    raise exception 'Only the program office publishes a resource to the program'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists teaching_resources_guard_program on public.teaching_resources;
create trigger teaching_resources_guard_program
  before insert or update on public.teaching_resources
  for each row execute function public.guard_program_resource();

/**
 * The file behind a published resource has to be downloadable by the people it
 * was published for. Storage is scoped by uid folder, so this adds one opening:
 * an object under an admin's folder in the teaching-resources bucket is
 * readable by anybody signed in.
 */
drop policy if exists teaching_resources_program_objects on storage.objects;
create policy teaching_resources_program_objects on storage.objects
  for select using (
    bucket_id = 'teaching-resources'
    and auth.uid() is not null
    and exists (
      select 1 from public.profiles p
       where p.id::text = (storage.foldername(name))[1]
         and p.role = 'admin'
    )
  );

commit;
