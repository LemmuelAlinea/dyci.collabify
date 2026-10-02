-- Collabify — a class project's Files: the same repository a work project has,
-- one per group board.
--
--   node scripts/db.mjs supabase/class-files.sql
--
-- A board's Files live in a hidden work project (`general_projects` with
-- `class_board_id` set, preset 'class-board') so the whole repository — Main,
-- drafts, reviews, history — works unchanged. Nobody manages that project by
-- hand: `ensure_class_board_repo` creates it the first time the Files tab
-- opens and keeps its members in step every time after.
--
--   board students   Member + edit_files: commit, draft, review
--   class teachers   no access (2026-09-28): a group's files are the group's
--                    own. Teachers see what is handed in, not the working files.
--
-- Handing the board in, or the professor closing or archiving the project,
-- freezes its Files the way it freezes its tasks. Returning it unfreezes them.
--
-- Redefines, as supersets, guard_general_creator from access.sql (so the
-- hidden project can be made on a student's behalf), and
-- notify_general_membership, notify_review_requested and
-- notify_review_answered from notification-coverage.sql, so a board's Files
-- never announce the group sync and their reviews open the class project.
-- Re-run this file after access.sql and notification-coverage.sql.
--
-- Runs after inbox.sql, before anon-lockdown.sql. Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- the link

alter table public.general_projects
  add column if not exists class_board_id uuid unique
  references public.project_boards (id) on delete cascade;

-- ---------------------------------------------------------------- where they live

/**
 * Every project needs a space, and a class's own space would let the whole
 * class read every group's files. So the hidden projects share one space that
 * nobody is a member of: reading one takes membership of the project itself.
 */
create table if not exists public.class_board_files_space (
  only_one boolean primary key default true check (only_one),
  space_id uuid not null unique references public.general_spaces (id) on delete restrict
);

alter table public.class_board_files_space enable row level security;
-- No policies: nothing reads it but the functions below.

-- ---------------------------------------------------------------- who is on a board

/** The students a board belongs to: its group's members, or its one student. */
create or replace function public.board_student_ids(p_board uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select gm.student_id
    from public.project_boards b
    join public.group_members gm on gm.group_id = b.group_id
   where b.id = p_board and b.group_id is not null
  union
  select b.student_id from public.project_boards b
   where b.id = p_board and b.student_id is not null;
$$;

/** Whether a board's Files are frozen: handed in, or the project closed or archived. */
create or replace function public.class_board_frozen(p_board uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_boards b
      join public.projects p on p.id = b.project_id
     where b.id = p_board
       and (b.submitted_at is not null or p.locked_at is not null or p.archived_at is not null)
  );
$$;

-- ---------------------------------------------------------------- who may create

/**
 * As access.sql, plus one exception: a board's hidden Files project and the
 * one space that holds them all, created by ensure_class_board_repo while it
 * holds `collabify.class_board_repo`. A student cannot set that flag from
 * outside, so they still cannot open a space or project of their own.
 */
create or replace function public.guard_general_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Checked table by table: NEW has no class_board_id on general_spaces.
  if current_setting('collabify.class_board_repo', true) = 'on' then
    if tg_table_name = 'general_spaces' then
      return new;
    elsif to_jsonb(new) ->> 'class_board_id' is not null then
      return new;
    end if;
  end if;
  if auth.uid() is not null and not public.is_faculty(auth.uid()) then
    raise exception 'Only faculty can create spaces and projects. Ask a faculty member to invite you to one.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- open the Files

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

-- Teachers used to be read-only members of every board's Files. Take them off
-- the ones that already exist; ensure_class_board_repo no longer adds them.
-- (Membership notices skip board Files, so nobody is told.)
delete from public.general_members m
 using public.general_projects gp
 where gp.id = m.project_id
   and gp.class_board_id is not null
   and m.user_id not in (select s from public.board_student_ids(gp.class_board_id) s);

-- ---------------------------------------------------------------- the guard

/**
 * Only a board's students write to its Files, and only while the board is
 * open. Teachers read. Covers every way a change lands: a commit, a draft, a
 * draft file, and a review request.
 */
create or replace function public.guard_class_board_files()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  board uuid;
begin
  select class_board_id into board from public.general_projects where id = new.project_id;
  if board is null then return new; end if;

  if public.class_board_frozen(board) then
    raise exception 'This project is handed in or closed, so its files cannot change. Take the submission back or ask your professor to reopen it.'
      using errcode = 'check_violation';
  end if;
  if auth.uid() is not null
     and not exists (select 1 from public.board_student_ids(board) s where s = auth.uid()) then
    raise exception 'Only this board''s students change its files' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['general_commits', 'general_drafts', 'general_draft_files', 'general_repo_changes']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_class_board', t);
    execute format(
      'create trigger %I before insert or update on public.%I
         for each row execute function public.guard_class_board_files()',
      t || '_class_board', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- leaving

/** A student who leaves the group loses the board's Files at once. */
create or replace function public.class_board_files_drop_student()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.general_members m
   using public.general_projects gp, public.project_boards b
   where gp.id = m.project_id
     and b.id = gp.class_board_id
     and b.group_id = old.group_id
     and m.user_id = old.student_id;
  return old;
end;
$$;

drop trigger if exists group_members_class_board_files on public.group_members;
create trigger group_members_class_board_files after delete on public.group_members
  for each row execute function public.class_board_files_drop_student();

/** A co-teacher whose seat is taken away loses read access to the class's Files. */
create or replace function public.class_board_files_drop_teacher()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.general_members m
   using public.general_projects gp, public.project_boards b, public.projects p, public.classes c
   where gp.id = m.project_id
     and b.id = gp.class_board_id
     and p.id = b.project_id
     and c.id = p.class_id
     and c.space_id = old.space_id
     and m.user_id = old.user_id
     and m.user_id not in (select s from public.board_student_ids(b.id) s)
     and m.user_id not in (select t from public.class_teacher_ids(c.id) t);
  return old;
end;
$$;

drop trigger if exists general_space_members_class_board_files on public.general_space_members;
create trigger general_space_members_class_board_files after delete on public.general_space_members
  for each row execute function public.class_board_files_drop_teacher();

-- ---------------------------------------------------------------- notifications

create or replace function public.notify_general_membership()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who uuid := coalesce(new.user_id, old.user_id);
  label text;
  msg text;
begin
  if auth.uid() is null or auth.uid() = who then return coalesce(new, old); end if;

  if tg_table_name = 'general_members' then
    -- A class board's Files project is kept in step with the group by the
    -- database; nobody is removed by a person, so nobody is told.
    select name into label from public.general_projects
     where id = coalesce(new.project_id, old.project_id) and class_board_id is null;
  else
    select name into label from public.general_spaces
     where id = coalesce(new.space_id, old.space_id) and kind = 'work';
  end if;
  if label is null then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    msg := public.display_name(auth.uid()) || ' removed you';
  else
    msg := 'You are now ' || public.general_level_label(new.level);
  end if;

  if tg_table_name = 'general_members' then
    insert into public.notifications (user_id, type, general_project_id, title, preview)
    select who, 'membership_changed', case when tg_op = 'DELETE' then null else new.project_id end, label, msg
      from public.notification_prefs np
     where np.user_id = who and np.project_updates;
  else
    insert into public.notifications (user_id, type, general_space_id, title, preview)
    select who, 'membership_changed', case when tg_op = 'DELETE' then null else new.space_id end, label, msg
      from public.notification_prefs np
     where np.user_id = who and np.project_updates;
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.notify_review_requested()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  label text;
  board public.project_boards%rowtype;
  cls_proj public.projects%rowtype;
begin
  select name into label from public.general_projects where id = new.project_id;
  if label is null then return new; end if;
  -- A class board's Files: the notification opens the class project instead.
  select b.* into board from public.project_boards b
    join public.general_projects gp on gp.class_board_id = b.id
   where gp.id = new.project_id;
  if board.id is not null then
    select * into cls_proj from public.projects where id = board.project_id;
    label := cls_proj.title;
  end if;

  insert into public.notifications (user_id, type, general_project_id, class_id, project_id, title, preview)
  select r.user_id, 'review_requested',
         case when board.id is null then new.project_id end,
         cls_proj.class_id, cls_proj.id, new.title,
         public.display_name(new.author_id) || ' asked for a review in ' || label
    from (
      select unnest(new.reviewer_ids) as user_id
      union
      select m.user_id
        from public.general_members m
       where cardinality(new.reviewer_ids) = 0
         and m.project_id = new.project_id
         and (m.level in ('owner', 'manager')
              or exists (select 1 from public.general_grants g
                          where g.project_id = m.project_id and g.user_id = m.user_id
                            and g.permission = 'commit_main')
              or exists (select 1 from public.general_projects gp
                           join public.project_boards b on b.id = gp.class_board_id
                           left join public.groups grp on grp.id = b.group_id
                          where gp.id = m.project_id
                            and (b.student_id = m.user_id or grp.leader_id is null or grp.leader_id = m.user_id)))
    ) r
    join public.notification_prefs np on np.user_id = r.user_id
   where np.submissions
     and r.user_id is distinct from new.author_id;
  return new;
end;
$$;

create or replace function public.notify_review_answered()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cls_proj public.projects%rowtype;
begin
  if new.author_id is null or new.author_id = new.decided_by then return new; end if;
  select p.* into cls_proj from public.projects p
    join public.project_boards b on b.project_id = p.id
    join public.general_projects gp on gp.class_board_id = b.id
   where gp.id = new.project_id;
  insert into public.notifications (user_id, type, general_project_id, class_id, project_id, title, preview)
  values (
    new.author_id, 'review_answered',
    case when cls_proj.id is null then new.project_id end,
    cls_proj.class_id, cls_proj.id, new.title,
    case when new.status = 'applied' then 'Merged by ' else 'Declined by ' end
      || public.display_name(new.decided_by)
      || coalesce(': ' || left(nullif(btrim(new.decided_note), ''), 120), ''));
  return new;
end;
$$;

-- ---------------------------------------------------------------- deleting

/**
 * Deleting a class project (or one of its boards) cascades to the board's
 * hidden Files project, and from there to its commits, which refuse to be
 * removed. Each board being deleted notes its Files project first, and the
 * commit guard lets those go. Whoever may delete the board already decided;
 * the history goes with the work it belonged to.
 */
create or replace function public.class_board_files_release()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  gp uuid;
begin
  select id into gp from public.general_projects where class_board_id = old.id;
  if gp is not null then
    perform set_config('collabify.class_board_delete',
      concat_ws(',', nullif(current_setting('collabify.class_board_delete', true), ''), gp::text), true);
  end if;
  return old;
end;
$$;

drop trigger if exists project_boards_release_files on public.project_boards;
create trigger project_boards_release_files before delete on public.project_boards
  for each row execute function public.class_board_files_release();

/** general-project-archive-rbac.sql's guard, plus a class board being deleted. */
create or replace function public.guard_general_commit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE'
     and (current_setting('collabify.general_project_delete', true) = old.project_id::text
          or old.project_id::text = any (
               string_to_array(coalesce(current_setting('collabify.class_board_delete', true), ''), ','))) then
    return old;
  end if;
  raise exception 'A commit cannot be changed or removed once it is made'
    using errcode = 'insufficient_privilege';
end;
$$;

-- ---------------------------------------------------------------- grants

revoke execute on function public.class_board_files_release() from public, anon;
revoke execute on function public.guard_general_commit() from public, anon;
revoke execute on function public.ensure_class_board_repo(uuid) from public, anon;
grant execute on function public.ensure_class_board_repo(uuid) to authenticated;
revoke execute on function public.board_student_ids(uuid) from public, anon;
revoke execute on function public.class_board_frozen(uuid) from public, anon;
revoke execute on function public.guard_class_board_files() from public, anon;
revoke execute on function public.class_board_files_drop_student() from public, anon;
revoke execute on function public.class_board_files_drop_teacher() from public, anon;

commit;
