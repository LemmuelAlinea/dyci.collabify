-- Editing and deleting messages in a live discussion.
--
-- The sender edits a text message or a file caption, and only while the
-- discussion is live: once it stops, its words are in the discussion file and
-- that file is what gets edited. Deleting removes the message for everyone,
-- with no trace — there is no "delete for me". The sender deletes their own;
-- an Owner or Manager, or the group leader on a class board, deletes anyone's.
-- A deleted poll, voice message or file message takes its poll, votes and file
-- rows with it (cascade); the stored audio and files become orphans and the
-- storage sweep removes them after its grace period.
--
-- Depends on general-discussions.sql, discussion-polls-voice.sql and
-- group-leader.sql. Idempotent.
--
--   node scripts/db.mjs supabase/discussion-edit-delete.sql

begin;

alter table public.general_discussion_messages
  add column if not exists edited_at timestamptz;

-- Without the old row, realtime drops UPDATE and DELETE events on a table
-- behind RLS (see realtime.sql), and an edit would wait for the 10 s poll.
alter table public.general_discussion_messages replica identity full;

/** Owner or Manager, or the leader of the class group a board belongs to. */
create or replace function public.general_discussion_moderator(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.general_discussion_lead(p_project)
      or exists (
        select 1
          from public.general_projects gp
          join public.project_boards b on b.id = gp.class_board_id
          join public.groups g on g.id = b.group_id
         where gp.id = p_project and g.leader_id = auth.uid()
      );
$$;

/** The sender rewrites a text message or a file caption, while the discussion is live. */
create or replace function public.edit_general_discussion_message(p_message uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.general_discussion_messages%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
begin
  select * into m from public.general_discussion_messages where id = p_message;
  if not found then
    raise exception 'That message is gone' using errcode = 'no_data_found';
  end if;
  perform public.general_discussion_check(m.project_id);
  if m.sender_id is distinct from auth.uid() then
    raise exception 'Only whoever sent it can edit it.' using errcode = 'insufficient_privilege';
  end if;
  if m.kind not in ('text', 'file') then
    raise exception 'Only text messages and file captions can be edited.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.general_discussions d where d.id = m.discussion_id and d.ended_at is not null) then
    raise exception 'This discussion has stopped. Edit its file instead.' using errcode = 'check_violation';
  end if;
  if m.kind = 'text' and v_body = '' then
    raise exception 'A message needs some words. Delete it instead.' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'Keep a message under 4,000 characters.' using errcode = 'check_violation';
  end if;
  if v_body = m.body then return; end if;
  update public.general_discussion_messages
     set body = v_body, edited_at = now()
   where id = p_message;
end;
$$;

/** Removes a message for everyone: its sender, or a moderator, while the discussion is live. */
create or replace function public.delete_general_discussion_message(p_message uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.general_discussion_messages%rowtype;
begin
  select * into m from public.general_discussion_messages where id = p_message;
  if not found then
    raise exception 'That message is gone' using errcode = 'no_data_found';
  end if;
  perform public.general_discussion_check(m.project_id);
  if m.sender_id is distinct from auth.uid() and not public.general_discussion_moderator(m.project_id) then
    raise exception 'Only whoever sent it, an Owner or Manager, or the group leader can delete it.'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.general_discussions d where d.id = m.discussion_id and d.ended_at is not null) then
    raise exception 'This discussion has stopped. Edit its file instead.' using errcode = 'check_violation';
  end if;
  delete from public.general_discussion_messages where id = p_message;
end;
$$;

revoke all on function public.general_discussion_moderator(uuid) from public, anon;
revoke all on function public.edit_general_discussion_message(uuid, text) from public, anon;
revoke all on function public.delete_general_discussion_message(uuid) from public, anon;
grant execute on function public.general_discussion_moderator(uuid) to authenticated;
grant execute on function public.edit_general_discussion_message(uuid, text) to authenticated;
grant execute on function public.delete_general_discussion_message(uuid) to authenticated;

commit;
