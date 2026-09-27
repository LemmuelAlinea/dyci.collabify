-- Collabify — admins can be invited, classes included.
--
--   node scripts/db.mjs supabase/admin-invitable.sql
--
-- An admin has no classes, spaces or projects of their own, but anyone may
-- invite one in. Work spaces and projects already found admins through
-- search_general_people; the class faculty panel searches with search_faculty,
-- which returned faculty only. This redefines it (one-workplace.sql) to return
-- admins as well. Re-run this file after re-running one-workplace.sql.
--
-- An admin seated in a class gets a space member's access, not a teacher's:
-- teaches_in_space and the class chat seats still ask for role 'faculty'.
--
-- Runs after cleanup.sql, before anon-lockdown.sql. Idempotent. Safe to re-run.

begin;

create or replace function public.search_faculty(p_query text)
returns table (person_id uuid, first_name text, last_name text, avatar_url text, email text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  q text := btrim(coalesce(p_query, ''));
  pattern text;
begin
  if not public.is_faculty(auth.uid()) then
    raise exception 'Only faculty can look up faculty' using errcode = 'insufficient_privilege';
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
     where pr.status = 'active'
       and pr.role in ('faculty', 'admin')
       and pr.id <> auth.uid()
       and (lower(pr.email) = lower(q)
            or btrim(pr.first_name || ' ' || pr.last_name) ilike pattern)
     order by pr.last_name, pr.first_name
     limit 10;
end;
$$;

revoke execute on function public.search_faculty(text) from public, anon;
grant execute on function public.search_faculty(text) to authenticated, service_role;

commit;
