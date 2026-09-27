-- Collabify — committing a draft file or folder straight to Main.
--
--   node scripts/db.mjs supabase/general-draft-commit.sql
--
-- Whoever holds `edit_files` can already commit from the editor; this lets
-- them do the same from My draft without a review. Everyone else still goes
-- through Submit for review: commit_general_files refuses them. A class
-- board's own guard (class-files.sql) still freezes handed-in Files.

begin;

create or replace function public.commit_general_draft_path(
  p_repo    uuid,
  p_path    text,
  p_folder  boolean,
  p_message text default ''
) returns public.general_commits
language plpgsql security definer set search_path = public as $$
declare
  d      public.general_drafts%rowtype;
  r      public.general_repos%rowtype;
  c      public.general_commits%rowtype;
  items  jsonb;
  v_path text := btrim(p_path, ' /');
  n      int;
begin
  select * into d from public.general_drafts
   where repo_id = p_repo and user_id = auth.uid();
  if not found then
    raise exception 'You have nothing in your draft' using errcode = 'no_data_found';
  end if;

  select * into r from public.general_repos where id = p_repo;

  if not public.general_viewer_active() or not public.is_general_member(r.project_id) then
    raise exception 'You are not on this project' using errcode = 'insufficient_privilege';
  end if;
  if public.general_is_archived(r.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'insufficient_privilege';
  end if;
  if d.base_seq <> r.commit_count then
    raise exception 'Your draft was started from commit % and the repository is now on commit %. Bring it up to date first.', d.base_seq, r.commit_count
      using errcode = 'serialization_failure';
  end if;

  select count(*),
         jsonb_agg(jsonb_build_object(
           'path', f.path,
           'action', f.action,
           'kind', f.kind,
           'content', f.content,
           'storage_path', f.storage_path) order by f.path)
    into n, items
    from public.general_draft_files f
   where f.draft_id = d.id
     and f.archived_at is null
     and (case when p_folder then left(f.path, char_length(v_path) + 1) = v_path || '/'
               else f.path = v_path end);

  if n = 0 then
    raise exception 'That is not in your draft' using errcode = 'no_data_found';
  end if;
  if n > 100 then
    raise exception 'A commit can carry up to 100 files. Commit a smaller folder first.'
      using errcode = 'check_violation';
  end if;

  -- Checks edit_files and every file rule.
  c := public.commit_general_files(
    r.id,
    left(coalesce(nullif(btrim(p_message), ''), 'Committed ' || v_path), 2000),
    d.base_seq,
    items);

  delete from public.general_draft_files
   where draft_id = d.id
     and archived_at is null
     and (case when p_folder then left(path, char_length(v_path) + 1) = v_path || '/'
               else path = v_path end);

  -- The only commit since the draft's base is this one, and it touched only
  -- paths that just left the draft, so what remains is still up to date.
  update public.general_drafts set base_seq = c.seq, updated_at = now() where id = d.id;

  return c;
end;
$$;

revoke all on function public.commit_general_draft_path(uuid, text, boolean, text) from public, anon;
grant execute on function public.commit_general_draft_path(uuid, text, boolean, text) to authenticated;

commit;
