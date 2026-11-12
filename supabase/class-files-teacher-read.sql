-- supabase/class-files-teacher-read.sql
-- Whoever teaches a class reads its groups' Files, and only reads them.
--
--   node scripts/db.mjs supabase/class-files-teacher-read.sql supabase/anon-lockdown.sql
--
-- A board's Files live in a hidden work project (class-files.sql) whose only
-- members are the board's students. The class professor, and a co-teacher
-- managing the class space (is_class_professor), now read that project, its
-- members, its repository (commits, files, reviews, review comments), its shares
-- and its uploaded files in Storage. Nothing here lets them write: every policy
-- added is SELECT-only, and they never become members, so commits, drafts,
-- reviews, comments, shares and uploads still refuse them, and
-- ensure_class_board_repo still opens the Files only for the board's students.
--
-- class_board_repo_id(board) answers the hidden project's id to a teacher
-- without creating anything: null while the group has never opened its Files.
--
-- Adds two functions and new policies named <table>_class_teacher_read (and
-- general_project_files_class_teacher_read on storage.objects); it redefines no
-- existing function or policy. Each new policy sits beside the table's existing
-- SELECT policy, which keeps its owner (general-repo.sql, general-files.sql,
-- general-shares.sql, project-settings-general.sql and the files that took
-- them over).
--
-- Runs after task-comment-scope.sql and before anon-lockdown.sql. Re-running
-- general-repo.sql, general-files.sql, general-shares.sql, class-files.sql or
-- project-settings-general.sql means re-running this afterwards.
-- Idempotent. Suite: supabase/tests/class-files-teacher-read.test.sql

begin;

-- ---------------------------------------------------------------- who reads

/** Whether the caller teaches the class whose group board this hidden Files project belongs to. */
create or replace function public.class_board_teacher_reads(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.general_projects gp
      join public.project_boards b on b.id = gp.class_board_id
      join public.projects pr on pr.id = b.project_id
     where gp.id = p_project
       and gp.class_board_id is not null
       and public.is_class_professor(pr.class_id)
  );
$$;

/**
 * A group board's hidden Files project, for whoever teaches its class. Null
 * while the group has never opened its Files; it never creates them.
 */
create or replace function public.class_board_repo_id(p_board uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_class uuid;
  v_project uuid;
begin
  select pr.class_id into v_class
    from public.project_boards b
    join public.projects pr on pr.id = b.project_id
   where b.id = p_board;

  if v_class is null or not public.is_class_professor(v_class) then
    raise exception 'Only the people who teach this class can read its groups'' files.'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_project from public.general_projects where class_board_id = p_board;
  return v_project;
end;
$$;

revoke execute on function public.class_board_teacher_reads(uuid) from public, anon;
grant execute on function public.class_board_teacher_reads(uuid) to authenticated;
revoke execute on function public.class_board_repo_id(uuid) from public, anon;
grant execute on function public.class_board_repo_id(uuid) to authenticated;

-- ---------------------------------------------------------------- what they read

drop policy if exists general_projects_class_teacher_read on public.general_projects;
create policy general_projects_class_teacher_read on public.general_projects
  for select to authenticated using (public.class_board_teacher_reads(id));

do $$
declare
  t text;
begin
  foreach t in array array[
    'general_members',
    'general_repos',
    'general_commits',
    'general_blobs',
    'general_repo_changes',
    'general_repo_comments',
    'general_shares'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_class_teacher_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.class_board_teacher_reads(project_id))',
      t || '_class_teacher_read', t);
  end loop;
end;
$$;

-- A recipient row has no project of its own; it follows its share's.
drop policy if exists general_share_recipients_class_teacher_read on public.general_share_recipients;
create policy general_share_recipients_class_teacher_read on public.general_share_recipients
  for select to authenticated using (
    public.class_board_teacher_reads(
      (select s.project_id from public.general_shares s where s.id = share_id))
  );

-- The uploaded files a commit, draft or share points at: `<project>/files/...`.
drop policy if exists general_project_files_class_teacher_read on storage.objects;
create policy general_project_files_class_teacher_read on storage.objects
  for select to authenticated using (
    bucket_id = 'general-files'
    and (storage.foldername(name))[2] = 'files'
    and public.class_board_teacher_reads(public.general_safe_uuid((storage.foldername(name))[1]))
  );

commit;
