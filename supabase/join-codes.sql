-- Collabify — one join code each, for good.
--
--   node scripts/db.mjs supabase/join-codes.sql
--
-- A class, a space and a project each get ONE join code and keep it. Codes
-- that could be replaced caused trouble: a code shared in a group chat or on
-- a slide stopped working the moment somebody pressed "New code".
--
--   classes.code                         made on insert (classes_set_code)
--   general_space_join_codes.code        made the first time it is opened
--   general_join_codes.code              made the first time it is opened
--
-- Opening and closing a code still works; only the code itself is fixed.
-- set_general_join_code (general.sql) and set_general_space_join_code
-- (general-spaces.sql) no longer make a new code, and these triggers refuse
-- any other way of changing one, whoever tries: a client, an admin, or a
-- function written later. A code row goes only when its space or project is
-- deleted, so a new one can never replace it.
--
-- Runs after classes.sql, general.sql, general-spaces.sql and one-workplace.sql,
-- before anon-lockdown.sql. Idempotent. Safe to re-run.

begin;

/** A join code, once made, never changes. */
create or replace function public.guard_join_code_fixed()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.code is not null and old.code <> '' and new.code is distinct from old.code then
    raise exception 'A join code cannot be changed. Share the one it already has.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

/**
 * A code row goes only with its space or project. A delete made directly is
 * refused; one cascading from the parent's delete runs inside the foreign
 * key's own trigger, so it arrives one level deeper and is let through.
 */
create or replace function public.guard_join_code_kept()
returns trigger language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() < 2 then
    raise exception 'A join code cannot be removed. Turn it off instead.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_join_code_fixed() from public, anon;
revoke all on function public.guard_join_code_kept() from public, anon;

drop trigger if exists classes_code_fixed on public.classes;
create trigger classes_code_fixed before update of code on public.classes
  for each row execute function public.guard_join_code_fixed();

drop trigger if exists general_space_join_codes_fixed on public.general_space_join_codes;
create trigger general_space_join_codes_fixed before update of code on public.general_space_join_codes
  for each row execute function public.guard_join_code_fixed();

drop trigger if exists general_space_join_codes_kept on public.general_space_join_codes;
create trigger general_space_join_codes_kept before delete on public.general_space_join_codes
  for each row execute function public.guard_join_code_kept();

drop trigger if exists general_join_codes_fixed on public.general_join_codes;
create trigger general_join_codes_fixed before update of code on public.general_join_codes
  for each row execute function public.guard_join_code_fixed();

drop trigger if exists general_join_codes_kept on public.general_join_codes;
create trigger general_join_codes_kept before delete on public.general_join_codes
  for each row execute function public.guard_join_code_kept();

commit;
