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
-- It also takes over ensure_class_board_repo from class-files.sql, the same body
-- with a per-board lock so two first opens at once make one project, not a
-- duplicate-name error.
--
-- Adds two functions and new policies named <table>_class_teacher_read (and
-- general_project_files_class_teacher_read on storage.objects); apart from
-- ensure_class_board_repo it redefines no existing function or policy. Each new policy sits beside the table's existing
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

-- ---------------------------------------------------------------- open the Files, one at a time

-- class-files.sql's body, with one change: a per-board lock before the lookup.
-- Two first opens at once (a double-mounted tab, two students together) both
-- found no project and both inserted, and the second failed on the name. Now
-- the second waits, then finds the first one's project.
create or replace function public.ensure_class_board_repo(p_board uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  b      public.project_boards%rowtype;
  proj   public.projects%rowtype;
  gp_id  uuid;
  holder uuid;
  who    text;
  student boolean;
begin
  select * into b from public.project_boards where id = p_board;
  if b.id is null then
    raise exception 'That board is gone' using errcode = 'no_data_found';
  end if;
  select * into proj from public.projects where id = b.project_id;

  student := exists (select 1 from public.board_student_ids(b.id) s where s = me);
  if me is null or not student then
    raise exception 'A group''s files are theirs alone. Only the students on this board open them.'
      using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ensure_class_board_repo:' || b.id::text, 0));

  select id into gp_id from public.general_projects where class_board_id = b.id;
  if gp_id is null then
    if b.group_id is not null then
      select name into who from public.groups where id = b.group_id;
    else
      who := public.display_name(b.student_id);
    end if;
    perform set_config('collabify.class_board_repo', 'on', true);
    select space_id into holder from public.class_board_files_space;
    if holder is null then
      insert into public.general_spaces (name, description, created_by)
      values ('Class project files', '', null)
      returning id into holder;
      insert into public.class_board_files_space (space_id) values (holder)
      on conflict (only_one) do nothing;
      select space_id into holder from public.class_board_files_space;
    end if;
    insert into public.general_projects (name, description, created_by, preset, class_board_id, space_id)
    values (left(proj.title || coalesce(' · ' || who, ''), 200), '', me, 'class-board', b.id, holder)
    returning id into gp_id;
    perform set_config('collabify.class_board_repo', 'off', true);
    -- A board already has its group chat; its Files need no second one.
    delete from public.conversations where kind = 'project' and general_project_id = gp_id;
    insert into public.general_repos (project_id, name, description, created_by)
    values (gp_id, 'Files', '', me);
  end if;

  -- Members follow the board: its students, and nobody else.
  delete from public.general_members m
   where m.project_id = gp_id
     and m.user_id not in (select s from public.board_student_ids(b.id) s);

  insert into public.general_members (project_id, user_id, level)
  select gp_id, s, 'member'::public.general_level from public.board_student_ids(b.id) s
  on conflict (project_id, user_id) do nothing;

  insert into public.general_grants (project_id, user_id, permission, granted_by)
  select gp_id, s, 'edit_files'::public.general_permission, me from public.board_student_ids(b.id) s
  on conflict do nothing;

  -- A teacher who is also on the board would be rare; one who is not never writes.
  delete from public.general_grants g
   where g.project_id = gp_id
     and g.user_id not in (select s from public.board_student_ids(b.id) s);

  return gp_id;
end;
$$;

revoke execute on function public.ensure_class_board_repo(uuid) from public, anon;
grant execute on function public.ensure_class_board_repo(uuid) to authenticated;

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
