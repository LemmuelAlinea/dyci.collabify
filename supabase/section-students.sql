-- Admin-managed section rosters. Run after section-faculty.sql and one-workplace.sql.
-- Re-run anon-lockdown.sql after this file.
begin;

create table if not exists public.program_section_students (
  section_id uuid not null references public.program_sections (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (section_id, student_id)
);

create index if not exists program_section_students_student_idx
  on public.program_section_students (student_id);

alter table public.program_section_students enable row level security;
drop policy if exists program_section_students_read on public.program_section_students;
create policy program_section_students_read on public.program_section_students
  for select using (public.is_admin());
revoke all on public.program_section_students from anon, authenticated;
grant select on public.program_section_students to authenticated;

-- A new class starts with the active students in its registered section.
create or replace function public.enroll_section_on_class_create()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  roster_size int;
begin
  -- Serialize a class being created with an admin editing this section's roster.
  perform 1 from public.program_sections s
   where public.section_key(s.name) = public.section_key(new.section)
     and s.school_year = new.school_year and s.archived_at is null
   for share;

  select count(*) into roster_size
    from public.program_sections s
    join public.program_section_students ss on ss.section_id = s.id
    join public.profiles p on p.id = ss.student_id
   where public.section_key(s.name) = public.section_key(new.section)
     and s.school_year = new.school_year and s.archived_at is null
     and p.role = 'student' and p.status = 'active';

  if new.student_cap is not null and roster_size > new.student_cap then
    raise exception 'The section has more students than this class allows. Increase the class limit.'
      using errcode = 'check_violation';
  end if;

  insert into public.class_members (class_id, student_id)
  select new.id, ss.student_id
    from public.program_sections s
    join public.program_section_students ss on ss.section_id = s.id
    join public.profiles p on p.id = ss.student_id
   where public.section_key(s.name) = public.section_key(new.section)
     and s.school_year = new.school_year and s.archived_at is null
     and p.role = 'student' and p.status = 'active'
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists classes_enroll_section_students on public.classes;
create trigger classes_enroll_section_students after insert on public.classes
  for each row execute function public.enroll_section_on_class_create();

-- Replaces the registry roster. Existing class removals remain the teacher's decision.
-- Newly assigned students also enter classes already running in this section.
create or replace function public.set_section_students(p_section uuid, p_students uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare
  wanted uuid[] := coalesce(p_students, '{}');
  sec public.program_sections%rowtype;
  cls public.classes%rowtype;
  needed int;
  total int;
begin
  if not public.is_admin() then
    raise exception 'Only the program office assigns students to sections'
      using errcode = 'insufficient_privilege';
  end if;

  select * into sec from public.program_sections
   where id = p_section and archived_at is null for update;
  if not found then
    raise exception 'That section is archived or no longer exists. Restore it first.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from unnest(wanted) as w(id)
     where not exists (select 1 from public.profiles p
                        where p.id = w.id and p.role = 'student' and p.status = 'active')
  ) then
    raise exception 'Only active student accounts can be assigned a section'
      using errcode = 'check_violation';
  end if;

  delete from public.program_section_students
   where section_id = p_section and not (student_id = any(wanted));
  insert into public.program_section_students (section_id, student_id, assigned_by)
  select distinct p_section, w.id, auth.uid() from unnest(wanted) as w(id)
  on conflict do nothing;

  for cls in select * from public.classes c
              where public.section_key(c.section) = public.section_key(sec.name)
                and c.school_year = sec.school_year and c.archived_at is null
              order by c.id for no key update
  loop
    select count(*) into needed
      from public.program_section_students ss
      left join public.class_members m on m.class_id = cls.id and m.student_id = ss.student_id
     where ss.section_id = p_section and m.student_id is null;
    select count(*) into total from public.class_members
     where class_id = cls.id and status = 'active';
    if cls.student_cap is not null and total + needed > cls.student_cap then
      raise exception 'A class in this section does not have enough seats. Increase its limit first.'
        using errcode = 'check_violation';
    end if;

    insert into public.class_members (class_id, student_id)
    select cls.id, ss.student_id from public.program_section_students ss
    join public.profiles p on p.id = ss.student_id
    where ss.section_id = p_section and p.role = 'student' and p.status = 'active'
    on conflict do nothing;
  end loop;

  select count(*) into total from public.program_section_students where section_id = p_section;
  return total;
end;
$$;

revoke all on function public.set_section_students(uuid, uuid[]) from public, anon;
grant execute on function public.set_section_students(uuid, uuid[]) to authenticated;

commit;

begin;
do $$
begin
  alter publication supabase_realtime add table public.program_section_students;
exception when duplicate_object then null;
end $$;
commit;
