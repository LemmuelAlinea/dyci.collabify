-- Collabify — the Inbox answers every invitation, so it needs to know a class
-- invitation from a space one.
--
--   node scripts/db.mjs supabase/inbox.sql
--
-- Adds `space_kind` to list_my_general_space_invitations (general-spaces.sql,
-- which now carries the same shape). Runs after notification-coverage.sql,
-- before anon-lockdown.sql. Idempotent. Safe to re-run.

begin;

/**
 * Pending space invitations sent to the caller. Never the inviter's profile
 * row — just enough of it to draw a card. `space_kind` lets the Inbox say
 * whether it is a space or a class; dropped first because adding a column
 * changes the return type.
 */
drop function if exists public.list_my_general_space_invitations();
create or replace function public.list_my_general_space_invitations()
returns table (
  invitation_id      uuid,
  space_id           uuid,
  space_name         text,
  space_description  text,
  space_kind         text,
  inviter_id         uuid,
  inviter_first_name text,
  inviter_last_name  text,
  inviter_avatar_url text,
  created_at         timestamptz
)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.general_viewer_active() then
    return;
  end if;

  return query
    select i.id, i.space_id, s.name, s.description, s.kind::text,
           i.invited_by, pr.first_name, pr.last_name, pr.avatar_url, i.created_at
      from public.general_space_invitations i
      join public.general_spaces s on s.id = i.space_id
      left join public.profiles pr on pr.id = i.invited_by
     where i.invitee = auth.uid() and i.status = 'pending'
     order by i.created_at desc;
end;
$$;

revoke all on function public.list_my_general_space_invitations() from public, anon;
grant execute on function public.list_my_general_space_invitations() to authenticated;

commit;
