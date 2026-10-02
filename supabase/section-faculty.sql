-- Collabify — which teaching faculty each section is assigned to.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/section-faculty.sql

/**
 * The program office assigns each section to the faculty who teach it, several
 * to a section if it likes. The class form offers a teacher only the sections
 * assigned to them, so a class lands in a cohort the office meant it for.
 *
 * Assigning is the chair's alone, through `set_section_faculty`, which replaces
 * a section's whole list in one call and refuses anybody who cannot teach.
 * Faculty read their own rows; the chair reads them all. Nothing is written to
 * the table directly.
 *
 * Classes still carry their section as text (program-registry.sql), so taking a
 * section away from somebody never touches a class they already made.
 */

begin;

create table if not exists public.program_section_faculty (
  section_id  uuid not null references public.program_sections (id) on delete cascade,
  faculty_id  uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (section_id, faculty_id)
);

create index if not exists program_section_faculty_faculty_idx
  on public.program_section_faculty (faculty_id);
create index if not exists program_section_faculty_assigned_by_idx
  on public.program_section_faculty (assigned_by);

alter table public.program_section_faculty enable row level security;

drop policy if exists program_section_faculty_read on public.program_section_faculty;
create policy program_section_faculty_read on public.program_section_faculty
  for select using (public.is_admin() or faculty_id = auth.uid());

revoke all on public.program_section_faculty from anon, authenticated;
grant select on public.program_section_faculty to authenticated;

/**
 * A section's assigned faculty, all of it: whoever is in `p_faculty` stays or
 * is added, whoever is not is taken off. An empty list clears the section.
 */
create or replace function public.set_section_faculty(p_section uuid, p_faculty uuid[])
returns int
language plpgsql security definer set search_path = public as $$
declare
  wanted uuid[] := coalesce(p_faculty, '{}');
  bad    int;
  n      int;
begin
  if not public.is_admin() then
    raise exception 'Only the program office assigns sections' using errcode = 'insufficient_privilege';
  end if;

  perform 1 from public.program_sections where id = p_section and archived_at is null for update;
  if not found then
    raise exception 'That section is archived or no longer exists. Restore it from Archive first.'
      using errcode = 'check_violation';
  end if;

  select count(*) into bad
    from unnest(wanted) as w(id)
   where not exists (
     select 1 from public.profiles p
      where p.id = w.id and p.role = 'faculty' and p.status = 'active' and p.can_teach
   );
  if bad > 0 then
    raise exception 'Only active faculty who teach can be assigned a section'
      using errcode = 'check_violation';
  end if;

  delete from public.program_section_faculty
   where section_id = p_section and not (faculty_id = any (wanted));

  insert into public.program_section_faculty (section_id, faculty_id, assigned_by)
  select distinct p_section, w.id, auth.uid() from unnest(wanted) as w(id)
  on conflict (section_id, faculty_id) do nothing;

  select count(*) into n from public.program_section_faculty where section_id = p_section;
  return n;
end;
$$;

revoke all on function public.set_section_faculty(uuid, uuid[]) from public, anon;
grant execute on function public.set_section_faculty(uuid, uuid[]) to authenticated;

commit;

begin;

do $$
begin
  alter publication supabase_realtime add table public.program_section_faculty;
exception when duplicate_object then null;
end $$;

commit;
