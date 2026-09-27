-- Collabify — admins are never members of anything.
--
--   node scripts/db.mjs supabase/admin-no-membership.sql
--
-- An admin runs the program; they do not sit in it. No class roster, group,
-- space, project or conversation takes an admin as a member, and nobody can
-- invite one — so the admin rail has no tasks, calendar, messages, spaces or
-- projects to show. One trigger function guards every membership and
-- invitation table; team rosters hang off space and project membership by
-- foreign key, so guarding those covers them too.
--
-- Also redefines search_general_people (general.sql) so an invite picker never
-- offers an admin in the first place. search_faculty already returns faculty
-- only. Re-run this file after re-running general.sql.
--
-- Rows an account already had when it became admin are left alone; the check
-- at the bottom of docs/07-backup.md lists them.
--
-- Runs after cleanup.sql, before anon-lockdown.sql. Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- the guard

-- The column holding the member is the trigger's one argument, read through
-- to_jsonb so one function serves student_id, user_id and invitee alike.
create or replace function public.guard_not_admin_member()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.profiles
     where id = (to_jsonb(new) ->> tg_argv[0])::uuid
       and role = 'admin'
  ) then
    raise exception 'Admins cannot join or be invited to a class, space, project or conversation'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_not_admin_member() from public, anon;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('class_members',             'student_id'),
      ('group_members',             'student_id'),
      ('general_space_members',     'user_id'),
      ('general_space_invitations', 'invitee'),
      ('general_members',           'user_id'),
      ('general_invitations',       'invitee'),
      ('conversation_members',      'user_id')
    ) as v(tbl, col)
  loop
    execute format('drop trigger if exists %I on public.%I', t.tbl || '_not_admin', t.tbl);
    execute format(
      'create trigger %I before insert or update of %I on public.%I
         for each row execute function public.guard_not_admin_member(%L)',
      t.tbl || '_not_admin', t.col, t.tbl, t.col);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- invite search

-- As general.sql, plus: never an admin.
create or replace function public.search_general_people(p_query text)
returns table (person_id uuid, first_name text, last_name text, avatar_url text, email text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  q text := btrim(coalesce(p_query, ''));
  pattern text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if char_length(q) < 3 then
    return;
  end if;

  perform public.rate_limit('general_people_search', 60, interval '1 minute',
    'Too many searches at once. Wait a minute and try again.');

  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    select pr.id, pr.first_name, pr.last_name, pr.avatar_url,
           case when lower(pr.email) = lower(q) then pr.email end
      from public.profiles pr
     where pr.status <> 'rejected'
       and pr.role is distinct from 'admin'
       and pr.id <> auth.uid()
       and (lower(pr.email) = lower(q)
            or btrim(pr.first_name || ' ' || pr.last_name) ilike pattern)
     order by pr.last_name, pr.first_name
     limit 10;
end;
$$;

revoke execute on function public.search_general_people(text) from public, anon;
grant execute on function public.search_general_people(text) to authenticated;

commit;
