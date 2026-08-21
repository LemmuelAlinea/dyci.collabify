-- Collabify — the admin's account list: two reversible changes, and no delete.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/accounts.sql

/**
 * An admin already reads every profile, so this adds no access — only a way to
 * use it, and two changes that had no home in the product at all:
 *
 *   - Somebody signed up as the wrong role. The only fix was set-role.mjs from
 *     a terminal, which is why the docs had to explain it.
 *   - Somebody left the program. There was no offboarding at all: a student is
 *     `active` forever, even though ProtectedRoute already turns away anyone
 *     who is not.
 *
 * **There is deliberately no delete here.** `classes.professor_id` is
 * `on delete cascade`, and so are seventeen other columns — removing one
 * professor's row takes their classes, projects, boards, tasks, files and work
 * log with it. Deactivation covers every honest reason to remove somebody and
 * is a door that reopens; a real erasure should stay a deliberate database
 * operation, not a button beside a search box.
 *
 * And no route to `admin`: an admin minting other admins has nothing above it
 * to notice. That stays on the command line.
 *
 * Both changes here are already audited — `log_profile_change` watches the
 * columns, not the caller, so every one of them lands in the log by itself.
 */

begin;

/**
 * Move somebody between student and professor.
 *
 * Promotion lands them `pending`, so a new professor still goes through
 * approval rather than around it — the point of approval is that somebody
 * verified them, and a promotion is not that.
 */
create or replace function public.set_account_role(
  p_user uuid,
  p_role public.user_role
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  target  public.profiles%rowtype;
  holding int;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only the program admin changes an account''s role'
      using errcode = 'insufficient_privilege';
  end if;

  if p_role = 'admin' then
    raise exception 'An admin is made from the command line, not from here'
      using errcode = 'check_violation';
  end if;

  select * into target from public.profiles where id = p_user for update;
  if target.id is null then
    raise exception 'That account no longer exists';
  end if;

  if target.role = 'admin' then
    raise exception 'An admin''s own role is not changed from here'
      using errcode = 'check_violation';
  end if;

  if target.id = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;

  if target.role = p_role then
    return target; -- already there, and saying so twice is not an error
  end if;

  -- A class with no professor is unreachable to everybody. Hand it over first,
  -- which is the same reasoning that keeps delete off this page.
  if target.role = 'professor' and p_role = 'student' then
    select count(*) into holding from public.classes
     where professor_id = p_user and archived_at is null;
    if holding > 0 then
      raise exception
        'They still run % active %. Hand those over first, or archive them.',
        holding, case when holding = 1 then 'class' else 'classes' end
        using errcode = 'check_violation';
    end if;
  end if;

  update public.profiles
     set role = p_role,
         -- A new professor is unverified; a student needs no verifying.
         status = case when p_role = 'professor' then 'pending' else 'active' end
                  ::public.account_status,
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_user
  returning * into target;

  return target;
end;
$$;

/**
 * Offboarding, and undoing it. `rejected` is the status ProtectedRoute already
 * turns away, so this reuses the gate rather than inventing a second one.
 */
create or replace function public.set_account_active(
  p_user   uuid,
  p_active boolean
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only the program admin deactivates an account'
      using errcode = 'insufficient_privilege';
  end if;

  select * into target from public.profiles where id = p_user for update;
  if target.id is null then
    raise exception 'That account no longer exists';
  end if;

  if target.role = 'admin' then
    raise exception 'An admin account is not deactivated from here'
      using errcode = 'check_violation';
  end if;

  if target.id = auth.uid() then
    raise exception 'You cannot deactivate yourself';
  end if;

  update public.profiles
     set status = case when p_active then 'active' else 'rejected' end
                  ::public.account_status,
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_user
  returning * into target;

  return target;
end;
$$;

grant execute on function public.set_account_role(uuid, public.user_role) to authenticated;
grant execute on function public.set_account_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- view

/**
 * Every account, with how much a change to it would disturb. `classes` is a
 * count and nothing more — what is inside one belongs to its professor, and
 * this page is about people.
 */
drop view if exists public.account_overview;

create view public.account_overview
with (security_invoker = true) as
select p.id,
       p.first_name,
       p.middle_name,
       p.last_name,
       p.email,
       p.avatar_url,
       p.role,
       p.status,
       p.created_at,
       p.decided_at,
       p.decided_by,
       btrim(d.first_name || ' ' || d.last_name) as decided_by_name,
       (select count(*) from public.classes c
         where c.professor_id = p.id and c.archived_at is null)::int as class_count,
       (select count(*) from public.class_members m
         where m.student_id = p.id and m.status = 'active')::int as enrolment_count
  from public.profiles p
  left join public.profiles d on d.id = p.decided_by;

grant select on public.account_overview to authenticated;

commit;
