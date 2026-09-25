-- Collabify — bringing a declined or withdrawn request back into My draft.
--
--   node scripts/db.mjs supabase/general-draft-restore.sql
--
-- Submitting empties the draft into a general_repo_changes row. When that row
-- is declined, or its author withdraws it, the work used to be stranded there:
-- readable, but only rebuildable by hand. This hands it back.
--
-- The author can take the whole request or one file or folder of it. Nothing
-- already in the draft is ever replaced — a clash stops the restore and names
-- the paths, so newer work cannot be lost to an older copy. The change row is
-- left as it was: it is the record of what was asked and what was said.
--
-- Depends on supabase/general-drafts.sql. Run after supabase/general-folders.sql.
--
-- Idempotent. Safe to re-run.

begin;

/**
 * Copies a declined or withdrawn change's files back into the caller's draft
 * and answers how many came back. `p_path` narrows it to one file, or to a
 * folder and everything under it; null takes the whole change.
 */
create or replace function public.restore_general_repo_change(
  p_change uuid,
  p_path   text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  ch      public.general_repo_changes%rowtype;
  d       public.general_drafts%rowtype;
  v_path  text := nullif(btrim(coalesce(p_path, ''), ' /'), '');
  items   jsonb;
  clashes text;
  live    int;
  n       int;
begin
  select * into ch from public.general_repo_changes where id = p_change;
  if not found then
    raise exception 'That request is gone' using errcode = 'no_data_found';
  end if;

  if ch.author_id is distinct from auth.uid() then
    raise exception 'Only whoever submitted a request can bring it back to their draft'
      using errcode = 'insufficient_privilege';
  end if;
  if ch.status not in ('declined', 'withdrawn') then
    raise exception 'Only a declined or withdrawn request can come back to your draft'
      using errcode = 'invalid_parameter_value';
  end if;
  if public.general_is_archived(ch.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Checks membership and an active account, and starts a draft if there is none.
  d := public.my_general_draft(ch.repo_id);

  select coalesce(jsonb_agg(e), '[]'::jsonb) into items
    from jsonb_array_elements(ch.files) e
   where v_path is null
      or e->>'path' = v_path
      or left(e->>'path', char_length(v_path) + 1) = v_path || '/';

  n := jsonb_array_length(items);
  if n = 0 then
    if v_path is null then
      raise exception 'That request has no files to bring back' using errcode = 'no_data_found';
    end if;
    raise exception 'That request has nothing at %', v_path using errcode = 'no_data_found';
  end if;

  -- Anything at these paths in the draft, archived or not, is newer work.
  select string_agg(f.path, ', ' order by f.path) into clashes
    from public.general_draft_files f
   where f.draft_id = d.id
     and f.path in (select e->>'path' from jsonb_array_elements(items) e)
     and f.path !~ '(^|/)\.keep$';
  if clashes is not null then
    raise exception 'Your draft already has %. Submit, archive or discard them, then bring this back.', clashes
      using errcode = 'unique_violation';
  end if;

  select count(*) into live
    from public.general_draft_files
   where draft_id = d.id and archived_at is null;

  if live = 0 then
    -- An empty draft takes the request's starting point, so "bring it up to
    -- date" shows exactly what Main changed underneath it since.
    update public.general_drafts set base_seq = ch.base_seq where id = d.id
    returning * into d;
  elsif d.base_seq > ch.base_seq then
    -- The draft already sits past the request's starting point. Restoring a
    -- path Main changed in between would quietly undo that change at merge.
    select string_agg(distinct b.path, ', ') into clashes
      from public.general_blobs b
     where b.repo_id = ch.repo_id
       and b.seq > ch.base_seq and b.seq <= d.base_seq
       and b.path in (select e->>'path' from jsonb_array_elements(items) e)
       and b.path !~ '(^|/)\.keep$';
    if clashes is not null then
      raise exception 'Main changed % after this request was written. Submit or discard your current draft first, then bring this back.', clashes
        using errcode = 'serialization_failure';
    end if;
  end if;

  -- A folder placeholder already in the draft stands for the same folder.
  insert into public.general_draft_files
    (draft_id, project_id, path, action, kind, content, storage_path)
  select d.id, d.project_id,
         e->>'path',
         (e->>'action')::public.general_file_action,
         coalesce(e->>'kind', 'text')::public.general_file_kind,
         case when coalesce(e->>'kind', 'text') = 'binary' then '' else coalesce(e->>'content', '') end,
         case when coalesce(e->>'kind', 'text') = 'binary' then e->>'storage_path' end
    from jsonb_array_elements(items) e
  on conflict (draft_id, path) do nothing;

  get diagnostics n = row_count;

  update public.general_drafts set updated_at = now() where id = d.id;

  return n;
end;
$$;

revoke all on function public.restore_general_repo_change(uuid, text) from public, anon;
grant execute on function public.restore_general_repo_change(uuid, text) to authenticated;

commit;
