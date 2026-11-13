-- Collabify — delete a peer evaluation round nobody has answered.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/peer-round-delete.sql supabase/anon-lockdown.sql
-- Requires: peer-evaluation.sql (peer_rounds, peer_ratings, peer_project_archived),
-- one-workplace.sql (is_project_professor). Runs after class-look.sql, before
-- anon-lockdown.sql. Suite: supabase/tests/peer-round-delete.test.sql

/**
 * A round opened by mistake (the wrong kind, the wrong project, too early) used
 * to stay for good: it could only be closed, and a final round opened by mistake
 * used up the project's one final. The professor can now delete a round, but
 * only while nobody has saved a rating in it, so students' answers are never
 * thrown away. A round with answers is closed instead.
 *
 * The notices the round sent go with it: the "rate your teammates" notice is
 * stamped with the round's own created_at (same transaction), and reminders
 * fall inside the round's window, since a project has one open round at a time.
 * The professor's reminder log in class_notes stays, as a record of what was sent.
 *
 * The round row is locked FOR UPDATE, which conflicts with the FOR KEY SHARE a
 * rating's foreign key takes, so a rating saved at the same moment either lands
 * first (and the delete is refused) or fails because the round is gone.
 */

create or replace function public.delete_peer_round(p_round uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.peer_rounds%rowtype;
begin
  select * into r from public.peer_rounds where id = p_round for update;
  if r.id is null then
    raise exception 'That peer evaluation no longer exists';
  end if;
  if not public.is_project_professor(r.project_id) then
    raise exception 'Only someone teaching this class can delete a peer evaluation'
      using errcode = 'insufficient_privilege';
  end if;
  if public.peer_project_archived(r.project_id) then
    raise exception 'That project is archived. Restore it to change its peer evaluation'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.peer_ratings pr where pr.round_id = p_round) then
    raise exception 'Students have already answered this round, so it can''t be deleted. Close it instead.'
      using errcode = 'check_violation';
  end if;

  delete from public.notifications n
   where n.project_id = r.project_id
     and (
       (n.type = 'peer_round_opened' and n.created_at = r.created_at)
       or (n.type = 'peer_round_reminder'
           and n.created_at >= r.opens_at
           and n.created_at <= coalesce(r.closed_at, r.closes_at))
     );

  delete from public.peer_rounds where id = p_round;
end;
$$;

revoke all on function public.delete_peer_round(uuid) from public, anon;
grant execute on function public.delete_peer_round(uuid) to authenticated;
