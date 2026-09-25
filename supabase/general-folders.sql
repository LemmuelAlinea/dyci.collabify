-- Collabify — renaming folders in a General draft.
--
--   node scripts/db.mjs supabase/general-folders.sql
--
-- A folder is a path prefix, and an empty one made in the site holds a hidden
-- `.keep`. Renaming rewrites paths in the caller's draft only; a folder that
-- already exists in Main becomes remove-old + add-new pairs, so Main still
-- changes only through review.

begin;

create or replace function public.rename_general_draft_folder(
  p_repo uuid,
  p_from text,
  p_to   text
) returns int
language plpgsql security definer set search_path = public as $$
declare
  d      public.general_drafts%rowtype;
  v_from text := btrim(p_from, ' /');
  v_to   text := btrim(p_to, ' /');
  v_name text;
  v_new  text;
  rec    record;
  n      int := 0;
begin
  if v_from = '' or v_to = '' then
    raise exception 'Give the folder a name.' using errcode = 'check_violation';
  end if;
  if v_to = v_from then
    return 0;
  end if;
  if left(v_to, char_length(v_from) + 1) = v_from || '/' then
    raise exception 'A folder cannot move inside itself.' using errcode = 'check_violation';
  end if;
  v_name := regexp_replace(v_to, '^.*/', '');
  if char_length(v_name) > 120 then
    raise exception 'A folder name can be up to 120 characters.' using errcode = 'check_violation';
  end if;
  if v_to ~ '(^|/)\.\.?(/|$)' or v_to ~ '\\' or v_to ~ '//' then
    raise exception 'A folder name cannot be "." or "..", or contain a backslash. Pick another name.'
      using errcode = 'check_violation';
  end if;

  d := public.my_general_draft(p_repo);
  if public.general_is_archived(d.project_id) then
    raise exception 'This project is archived. An Owner can restore it to make changes.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.general_repo_tree t
              where t.repo_id = p_repo
                and (t.path = v_to or left(t.path, char_length(v_to) + 1) = v_to || '/'))
     or exists (select 1 from public.general_draft_files f
                 where f.draft_id = d.id
                   and (f.path = v_to or left(f.path, char_length(v_to) + 1) = v_to || '/')) then
    raise exception 'A folder called % is already here. Pick another name.', v_name
      using errcode = 'unique_violation';
  end if;

  for rec in
    select p.path,
           t.kind as main_kind, t.content as main_content, t.storage_path as main_storage,
           f.action as draft_action, f.kind as draft_kind, f.content as draft_content,
           f.storage_path as draft_storage
      from (
        select t.path from public.general_repo_tree t
         where t.repo_id = p_repo and left(t.path, char_length(v_from) + 1) = v_from || '/'
        union
        select f.path from public.general_draft_files f
         where f.draft_id = d.id and f.archived_at is null
           and left(f.path, char_length(v_from) + 1) = v_from || '/'
      ) p
      left join public.general_repo_tree t on t.repo_id = p_repo and t.path = p.path
      left join public.general_draft_files f
             on f.draft_id = d.id and f.path = p.path and f.archived_at is null
  loop
    if rec.draft_action = 'removed' then
      continue;
    end if;
    v_new := v_to || substr(rec.path, char_length(v_from) + 1);

    insert into public.general_draft_files (draft_id, project_id, path, action, kind, content, storage_path)
    values (
      d.id, d.project_id, v_new, 'added',
      coalesce(rec.draft_kind, rec.main_kind),
      case when rec.draft_action is not null then rec.draft_content else rec.main_content end,
      case when rec.draft_action is not null then rec.draft_storage else rec.main_storage end
    );

    if rec.main_kind is not null then
      insert into public.general_draft_files (draft_id, project_id, path, action, kind, content, storage_path)
      values (d.id, d.project_id, rec.path, 'removed', rec.main_kind, '', rec.main_storage)
      on conflict (draft_id, path) do update
        set action = 'removed', kind = excluded.kind, content = '',
            storage_path = excluded.storage_path, archived_at = null, archived_by = null,
            updated_at = now();
    else
      delete from public.general_draft_files where draft_id = d.id and path = rec.path;
    end if;
    n := n + 1;
  end loop;

  if n = 0 then
    raise exception 'That folder is not here anymore. Reload the page and try again.'
      using errcode = 'no_data_found';
  end if;

  update public.general_drafts set updated_at = now() where id = d.id;
  return n;
end;
$$;

revoke all on function public.rename_general_draft_folder(uuid, text, text) from public, anon;
grant execute on function public.rename_general_draft_folder(uuid, text, text) to authenticated;

commit;
