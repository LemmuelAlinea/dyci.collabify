-- Collabify — the program admin verifies a professor before they get advisers' tools.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/approvals.sql

/**
 * A professor signing up lands `pending` and waits at /pending. Until now the
 * only way past that was an admin editing the row by hand, which is why
 * the console has always said "coming soon".
 *
 * The rules were already here and are not being loosened: `profiles_update_admin`
 * lets an admin write, and `guard_privileged_columns` pins `role` and
 * `status` back for everybody else. This adds a way to use them, and records
 * who used it.
 */

begin;

-- Who let them in, and when. The seed of the audit log the console promises,
-- and enough on its own to answer "who approved this account".
alter table public.profiles
  add column if not exists decided_by uuid references public.profiles (id) on delete set null;

alter table public.profiles
  add column if not exists decided_at timestamptz;

/**
 * Approve or turn down a professor.
 *
 * Reversible in both directions on purpose: an account turned down by mistake
 * is otherwise dead, and the person it belongs to cannot do anything about it.
 */
create or replace function public.decide_professor(
  p_user    uuid,
  p_approve boolean
) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  target public.profiles%rowtype;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only the program admin approves professor accounts'
      using errcode = 'insufficient_privilege';
  end if;

  select * into target from public.profiles where id = p_user for update;
  if target.id is null then
    raise exception 'That account no longer exists';
  end if;

  if target.role <> 'professor' then
    raise exception 'Only professor accounts go through approval'
      using errcode = 'check_violation';
  end if;

  update public.profiles
     set status     = case when p_approve then 'active' else 'rejected' end::public.account_status,
         decided_by = auth.uid(),
         decided_at = now()
   where id = p_user
  returning * into target;

  return target;
end;
$$;

grant execute on function public.decide_professor(uuid, boolean) to authenticated;

/** Professor accounts with the admin who decided them, for the console. */
drop view if exists public.professor_accounts;

create view public.professor_accounts
with (security_invoker = true) as
select p.id,
       p.first_name,
       p.middle_name,
       p.last_name,
       p.email,
       p.avatar_url,
       p.status,
       p.created_at,
       p.decided_at,
       p.decided_by,
       btrim(d.first_name || ' ' || d.last_name) as decided_by_name,
       (select count(*) from public.classes c where c.professor_id = p.id)::int as class_count
  from public.profiles p
  left join public.profiles d on d.id = p.decided_by
 where p.role = 'professor';

grant select on public.professor_accounts to authenticated;

commit;
