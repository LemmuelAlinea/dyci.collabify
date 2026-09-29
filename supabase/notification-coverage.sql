-- Collabify — notifications for everything that was silent.
--
--   node scripts/db.mjs supabase/notification-coverage.sql
--
-- Before this file, being invited to a space, handing work in, asking for a
-- review, and a project changing under you all happened without a word. This
-- adds them, plus two switches in Settings to govern the new informational
-- ones. The rule from supabase/notifications.sql still holds: anything a person
-- must act on, or asked for, arrives regardless of their settings.
--
--   type               to                          switch
--   space_invited      the invitee                 none — they must answer it
--   invite_accepted    whoever sent the invitation project_invites
--   board_submitted    everyone teaching the class submissions (new)
--   review_requested   the change's reviewers      submissions
--   review_answered    the change's author         none — they asked
--   project_updated    students of a class project project_updates (new)
--                      whose due date moved or that closed; members of a work
--                      project archived or restored
--   membership_changed someone whose level changed, or who was removed from a
--                      work space or project by somebody else
--                                                  project_updates
--
-- Runs after cleanup.sql and admin-invitable.sql, before anon-lockdown.sql.
-- Two transactions: a new enum value cannot be used in the one that added it.
-- Idempotent. Safe to re-run.

begin;

do $$
begin
  alter type public.notification_type add value if not exists 'space_invited';
  alter type public.notification_type add value if not exists 'invite_accepted';
  alter type public.notification_type add value if not exists 'board_submitted';
  alter type public.notification_type add value if not exists 'review_requested';
  alter type public.notification_type add value if not exists 'review_answered';
  alter type public.notification_type add value if not exists 'project_updated';
  alter type public.notification_type add value if not exists 'membership_changed';
end $$;

commit;

begin;

-- ---------------------------------------------------------------- columns

alter table public.notification_prefs
  add column if not exists submissions boolean not null default true;
alter table public.notification_prefs
  add column if not exists project_updates boolean not null default true;

alter table public.notifications
  add column if not exists general_space_id uuid
  references public.general_spaces (id) on delete cascade;

create index if not exists notifications_general_space_id_idx
  on public.notifications (general_space_id);

-- ---------------------------------------------------------------- helpers

create or replace function public.display_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(btrim(first_name || ' ' || last_name), '') from public.profiles where id = p_user),
    'Somebody');
$$;

/** Everyone who teaches a class: its professor and active faculty seated at Owner or Manager. */
create or replace function public.class_teacher_ids(p_class uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select c.professor_id from public.classes c where c.id = p_class
  union
  select m.user_id
    from public.classes c
    join public.general_space_members m on m.space_id = c.space_id
    join public.profiles p on p.id = m.user_id
   where c.id = p_class
     and m.level in ('owner', 'manager')
     and p.role = 'faculty'
     and p.status = 'active';
$$;

create or replace function public.general_level_label(p_level public.general_level)
returns text language sql immutable as $$
  select case p_level when 'owner' then 'Owner' when 'manager' then 'Manager' else 'Member' end;
$$;

-- ---------------------------------------------------------------- space invitations

create or replace function public.notify_space_invitation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s public.general_spaces%rowtype;
  cls uuid;
begin
  select * into s from public.general_spaces where id = new.space_id;
  if s.id is null then return new; end if;
  if s.kind = 'education' then
    select id into cls from public.classes where space_id = s.id;
  end if;

  insert into public.notifications (user_id, type, general_space_id, class_id, title, preview)
  values (
    new.invitee, 'space_invited', s.id, cls, s.name,
    public.display_name(new.invited_by)
      || case when s.kind = 'education' then ' invited you to teach this class'
              else ' invited you to join this space' end);
  return new;
end;
$$;

drop trigger if exists general_space_invitations_notify on public.general_space_invitations;
create trigger general_space_invitations_notify after insert on public.general_space_invitations
  for each row when (new.status = 'pending')
  execute function public.notify_space_invitation();

-- ---------------------------------------------------------------- invitations accepted

create or replace function public.notify_invitation_accepted()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  label text;
  s public.general_spaces%rowtype;
  cls uuid;
begin
  if new.invited_by is null or new.invited_by = new.invitee then return new; end if;

  if tg_table_name = 'general_space_invitations' then
    select * into s from public.general_spaces where id = new.space_id;
    if s.id is null then return new; end if;
    if s.kind = 'education' then
      select id into cls from public.classes where space_id = s.id;
    end if;
    insert into public.notifications (user_id, type, general_space_id, class_id, title, preview)
    select new.invited_by, 'invite_accepted', s.id, cls, s.name,
           public.display_name(new.invitee) || ' accepted your invitation'
      from public.notification_prefs np
     where np.user_id = new.invited_by and np.project_invites;
  else
    select name into label from public.general_projects where id = new.project_id;
    if label is null then return new; end if;
    insert into public.notifications (user_id, type, general_project_id, title, preview)
    select new.invited_by, 'invite_accepted', new.project_id, label,
           public.display_name(new.invitee) || ' accepted your invitation'
      from public.notification_prefs np
     where np.user_id = new.invited_by and np.project_invites;
  end if;
  return new;
end;
$$;

drop trigger if exists general_space_invitations_accepted on public.general_space_invitations;
create trigger general_space_invitations_accepted after update of status on public.general_space_invitations
  for each row when (old.status = 'pending' and new.status = 'accepted')
  execute function public.notify_invitation_accepted();

drop trigger if exists general_invitations_accepted on public.general_invitations;
create trigger general_invitations_accepted after update of status on public.general_invitations
  for each row when (old.status = 'pending' and new.status = 'accepted')
  execute function public.notify_invitation_accepted();

-- ---------------------------------------------------------------- hand-ins

create or replace function public.notify_board_submitted()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  proj public.projects%rowtype;
  who text;
begin
  select * into proj from public.projects where id = new.project_id;
  if proj.id is null then return new; end if;

  if new.group_id is not null then
    select name into who from public.groups where id = new.group_id;
  end if;
  who := coalesce(who, public.display_name(coalesce(new.student_id, new.submitted_by)));

  insert into public.notifications (user_id, type, class_id, project_id, group_id, title, preview)
  select t.id, 'board_submitted', proj.class_id, proj.id, new.group_id, proj.title,
         who || ' handed in their work'
    from public.class_teacher_ids(proj.class_id) as t(id)
    join public.notification_prefs np on np.user_id = t.id
   where np.submissions
     and t.id is distinct from new.submitted_by;
  return new;
end;
$$;

drop trigger if exists project_boards_notify_submitted on public.project_boards;
create trigger project_boards_notify_submitted after update of submitted_at on public.project_boards
  for each row when (old.submitted_at is null and new.submitted_at is not null)
  execute function public.notify_board_submitted();

-- ---------------------------------------------------------------- reviews

create or replace function public.notify_review_requested()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  label text;
begin
  select name into label from public.general_projects where id = new.project_id;
  if label is null then return new; end if;

  insert into public.notifications (user_id, type, general_project_id, title, preview)
  select r.user_id, 'review_requested', new.project_id, new.title,
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
                            and g.permission = 'edit_files'))
    ) r
    join public.notification_prefs np on np.user_id = r.user_id
   where np.submissions
     and r.user_id is distinct from new.author_id;
  return new;
end;
$$;

drop trigger if exists general_repo_changes_notify_requested on public.general_repo_changes;
create trigger general_repo_changes_notify_requested after insert on public.general_repo_changes
  for each row when (new.status = 'open')
  execute function public.notify_review_requested();

create or replace function public.notify_review_answered()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.author_id is null or new.author_id = new.decided_by then return new; end if;
  insert into public.notifications (user_id, type, general_project_id, title, preview)
  values (
    new.author_id, 'review_answered', new.project_id, new.title,
    case when new.status = 'applied' then 'Merged by ' else 'Declined by ' end
      || public.display_name(new.decided_by)
      || coalesce(': ' || left(nullif(btrim(new.decided_note), ''), 120), ''));
  return new;
end;
$$;

drop trigger if exists general_repo_changes_notify_answered on public.general_repo_changes;
create trigger general_repo_changes_notify_answered after update of status on public.general_repo_changes
  for each row when (old.status = 'open' and new.status in ('applied', 'declined'))
  execute function public.notify_review_answered();

-- ---------------------------------------------------------------- class project changes

/**
 * A released project whose due date moved, or that closed. Reaches the same
 * students the release reached — a group project only those placed in it.
 */
create or replace function public.notify_class_project_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  msg text;
begin
  -- Not yet released to students: nothing they have seen has changed.
  if old.release_at is not null and old.release_at > now() then return new; end if;
  if old.archived_at is not null then return new; end if;

  if new.archived_at is not null then
    msg := 'This project was closed';
  elsif new.due_at is distinct from old.due_at then
    msg := case when new.due_at is null then 'The due date was removed'
                else 'Now due ' || to_char(new.due_at at time zone 'Asia/Manila',
                                           'FMDay, FMMon FMDD at FMHH12:MI AM') end;
  else
    return new;
  end if;

  insert into public.notifications (user_id, type, class_id, project_id, title, preview)
  select m.student_id, 'project_updated', new.class_id, new.id, new.title, msg
    from public.class_members m
    join public.notification_prefs np on np.user_id = m.student_id
   where m.class_id = new.class_id
     and m.status = 'active'
     and np.project_updates
     and (
       new.group_set_id is null
       or exists (select 1 from public.group_members gm
                   where gm.set_id = new.group_set_id and gm.student_id = m.student_id)
     );
  return new;
end;
$$;

drop trigger if exists projects_notify_changed on public.projects;
create trigger projects_notify_changed after update of due_at, archived_at on public.projects
  for each row execute function public.notify_class_project_changed();

-- ---------------------------------------------------------------- work project changes

create or replace function public.notify_general_project_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  msg text;
  actor uuid := coalesce(auth.uid(), new.archived_by);
begin
  if old.archived_at is null and new.archived_at is not null then
    msg := public.display_name(actor) || ' archived this project';
  elsif old.archived_at is not null and new.archived_at is null then
    msg := public.display_name(actor) || ' restored this project';
  else
    return new;
  end if;

  insert into public.notifications (user_id, type, general_project_id, title, preview)
  select m.user_id, 'project_updated', new.id, new.name, msg
    from public.general_members m
    join public.notification_prefs np on np.user_id = m.user_id
   where m.project_id = new.id
     and np.project_updates
     and m.user_id is distinct from actor;
  return new;
end;
$$;

drop trigger if exists general_projects_notify_changed on public.general_projects;
create trigger general_projects_notify_changed after update of archived_at on public.general_projects
  for each row execute function public.notify_general_project_changed();

-- ---------------------------------------------------------------- membership changes

/**
 * Somebody else changed your level, or removed you. Leaving on your own, or a
 * project or space being deleted outright, says nothing. A removal carries no
 * link, since there is nothing left for the person to open.
 */
create or replace function public.notify_general_membership()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who uuid := coalesce(new.user_id, old.user_id);
  label text;
  msg text;
begin
  if auth.uid() is null or auth.uid() = who then return coalesce(new, old); end if;

  if tg_table_name = 'general_members' then
    select name into label from public.general_projects where id = coalesce(new.project_id, old.project_id);
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

drop trigger if exists general_members_notify_level on public.general_members;
create trigger general_members_notify_level after update of level on public.general_members
  for each row when (old.level is distinct from new.level)
  execute function public.notify_general_membership();

drop trigger if exists general_members_notify_removed on public.general_members;
create trigger general_members_notify_removed after delete on public.general_members
  for each row execute function public.notify_general_membership();

drop trigger if exists general_space_members_notify_level on public.general_space_members;
create trigger general_space_members_notify_level after update of level on public.general_space_members
  for each row when (old.level is distinct from new.level)
  execute function public.notify_general_membership();

drop trigger if exists general_space_members_notify_removed on public.general_space_members;
create trigger general_space_members_notify_removed after delete on public.general_space_members
  for each row execute function public.notify_general_membership();

-- ---------------------------------------------------------------- grants

revoke execute on function public.display_name(uuid) from public, anon;
revoke execute on function public.class_teacher_ids(uuid) from public, anon;
revoke execute on function public.notify_space_invitation() from public, anon;
revoke execute on function public.notify_invitation_accepted() from public, anon;
revoke execute on function public.notify_board_submitted() from public, anon;
revoke execute on function public.notify_review_requested() from public, anon;
revoke execute on function public.notify_review_answered() from public, anon;
revoke execute on function public.notify_class_project_changed() from public, anon;
revoke execute on function public.notify_general_project_changed() from public, anon;
revoke execute on function public.notify_general_membership() from public, anon;

commit;
