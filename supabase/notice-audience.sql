-- Collabify — a program notice for everyone, for chosen offices, or for chosen groups.
--
--   node scripts/db.mjs supabase/notice-audience.sql supabase/anon-lockdown.sql
--
-- Spec: docs/superpowers/specs/2026-11-14-notice-audience-design.md
--
-- Each notice has one audience: everyone, a list of offices, or a list of groups. The
-- groups are students (role student), teaching faculty (a member who teaches) and office
-- staff (a member who doesn't); an admin is in no group and no office. An inactive account
-- is never in an audience.
--
-- The database enforces it, in one shared check (notice_audience_includes):
--
--   - Reading: the table's read policy, the Home view program_notices and so Realtime
--     (which checks the read policy as the subscriber) show a notice only to its audience.
--     The admin reads every notice through the table and program_notices_all.
--   - Notifying: the notifier writes a row only for the audience, still minus the author and
--     anybody with announcements off. admin_notice_reach counts exactly those rows ahead of
--     sending, through the same helper (notice_recipients).
--
-- The card is read at read time and the notification is sent at send time, so somebody
-- filed into an office later sees that office's live notices without a late notification.
-- A sent notice's audience never changes: take it down and send a new one.
--
-- Runs after office-heads.sql (it reads offices and office_members) and before
-- anon-lockdown.sql. It takes four objects from program-notices.sql: the read policy
-- program_announcements_read, the views program_notices and program_notices_all, and the
-- function notify_program_announcement. Re-running program-notices.sql means re-running
-- this file afterwards, or every notice opens to everyone again.
--
-- Idempotent. Safe to re-run.

begin;

-- ---------------------------------------------------------------- the columns

-- Existing notices take the defaults, so they stay notices to everyone.
alter table public.program_announcements
  add column if not exists audience text not null default 'everyone',
  add column if not exists audience_offices uuid[] not null default '{}',
  add column if not exists audience_groups text[] not null default '{}';

alter table public.program_announcements
  drop constraint if exists program_announcements_audience_kind;
alter table public.program_announcements
  add constraint program_announcements_audience_kind
  check (audience in ('everyone', 'offices', 'groups'));

alter table public.program_announcements
  drop constraint if exists program_announcements_audience_groups;
alter table public.program_announcements
  add constraint program_announcements_audience_groups
  check (audience_groups <@ array['students', 'teaching', 'staff']::text[]);

-- Offices needs offices and no groups, groups the reverse, everyone neither. A notice aimed
-- at nobody is refused.
alter table public.program_announcements
  drop constraint if exists program_announcements_audience_shape;
alter table public.program_announcements
  add constraint program_announcements_audience_shape
  check (array_position(audience_offices, null) is null
         and case audience
               when 'everyone' then cardinality(audience_offices) = 0
                                    and cardinality(audience_groups) = 0
               when 'offices'  then cardinality(audience_offices) > 0
                                    and cardinality(audience_groups) = 0
               when 'groups'   then cardinality(audience_groups) > 0
                                    and cardinality(audience_offices) = 0
               else false
             end);

-- ---------------------------------------------------------------- the shared check

/**
 * Whether p_user is in this audience right now. Internal and ungated: notice_reaches gates
 * it for callers, and the notifier and the reach count use it through notice_recipients.
 * An archived office's people still count while they are filed under it.
 */
create or replace function public.notice_audience_includes(
  p_audience text, p_offices uuid[], p_groups text[], p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p_audience
             when 'everyone' then true
             when 'offices' then exists (
               select 1 from public.office_members m
                where m.user_id = p.id and m.office_id = any (p_offices))
             when 'groups' then
               (case when p.role = 'student' then 'students'
                     when p.role = 'member' and coalesce(p.can_teach, false) then 'teaching'
                     when p.role = 'member' then 'staff'
                end) = any (p_groups)
             else false
           end
      from public.profiles p
     where p.id = p_user and p.status = 'active'), false);
$$;

/**
 * Who a notice notifies: active accounts in the audience with announcements on, minus
 * p_except (the author when sending, the caller when counting). The notifier and
 * admin_notice_reach both read this, so the count and the rows cannot drift apart.
 */
create or replace function public.notice_recipients(
  p_audience text, p_offices uuid[], p_groups text[], p_except uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id
    from public.profiles p
    join public.notification_prefs np on np.user_id = p.id
   where p.status = 'active'
     and np.announcements
     and p.id is distinct from p_except
     and public.notice_audience_includes(p_audience, coalesce(p_offices, '{}'),
                                         coalesce(p_groups, '{}'), p.id);
$$;

/**
 * Whether this notice reaches p_user. The read policy, program_notices and Realtime call it
 * as the caller, so it stays executable by authenticated; and so that nobody can probe
 * another person's office or group with a hand-built row, it answers false unless p_user is
 * the caller or the caller is an admin.
 */
create or replace function public.notice_reaches(p_notice public.program_announcements, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (p_user = auth.uid() or public.is_admin())
    and public.notice_audience_includes(p_notice.audience, p_notice.audience_offices,
                                        p_notice.audience_groups, p_user),
    false);
$$;

-- ---------------------------------------------------------------- reading

-- Taken from program-notices.sql. Writes stay program_announcements_write (the admin's).
drop policy if exists program_announcements_read on public.program_announcements;
create policy program_announcements_read on public.program_announcements
  for select using (public.is_admin() or public.notice_reaches(program_announcements, auth.uid()));

drop view if exists public.program_notices;

/**
 * What is on a Home right now: every notice sent in the last 7 days, not taken down, that
 * reaches the caller, newest first, pinned before the rest. After 7 days a notice leaves every
 * Home and stays only in the admin's history (program_notices_all). Not security_invoker, for
 * the reason program-notices.sql gives (the author's name comes from profiles, which the
 * reader often cannot read), so the audience filter has to be here: the table's policy does
 * not apply to the view's owner. The 7 days also appear in program_notices_all and in
 * program_announcements_free_pin; change all three together.
 */
create view public.program_notices
with (security_barrier = true) as
select a.id,
       a.title,
       a.body,
       a.pinned,
       a.created_at,
       a.edited_at,
       a.author_id,
       btrim(p.first_name || ' ' || p.last_name) as author_name,
       p.avatar_url as author_avatar,
       a.audience
  from public.program_announcements a
  join public.profiles p on p.id = a.author_id
 where a.created_at > now() - interval '7 days'
   and public.notice_reaches(a, auth.uid());

revoke all on public.program_notices from anon;
grant select on public.program_notices to authenticated;

drop view if exists public.program_notices_all;

/**
 * Every notice the office has sent, with its audience, for the admin alone. The office names
 * are labels, so an archived office keeps its name here; a deleted one drops out.
 */
create view public.program_notices_all
with (security_barrier = true) as
select a.id,
       a.title,
       a.body,
       a.pinned,
       a.created_at,
       a.edited_at,
       a.author_id,
       btrim(p.first_name || ' ' || p.last_name) as author_name,
       p.avatar_url as author_avatar,
       a.audience,
       a.audience_offices,
       a.audience_groups,
       array(select o.name from public.offices o
              where o.id = any (a.audience_offices)
              order by lower(o.name), o.id) as audience_office_names,
       a.created_at > now() - interval '7 days' as live,
       a.created_at + interval '7 days' as leaves_at
  from public.program_announcements a
  join public.profiles p on p.id = a.author_id
 where public.is_admin();

revoke all on public.program_notices_all from anon;
grant select on public.program_notices_all to authenticated;

-- ---------------------------------------------------------------- notifying

/**
 * The audience at send time, minus whoever wrote it, minus anybody who turned announcements
 * off. Keeps the trigger program-notices.sql made (program_announcements_notify).
 */
create or replace function public.notify_program_announcement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title, preview)
  select r.id,
         'announcement',
         new.title,
         left(regexp_replace(new.body, '\s+', ' ', 'g'), 140)
    from public.notice_recipients(new.audience, new.audience_offices, new.audience_groups,
                                  new.author_id) as r(id);
  return new;
end;
$$;

/** The title and body stay editable; who a sent notice went to does not change. */
create or replace function public.program_announcements_keep_audience()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.audience is distinct from old.audience
     or new.audience_offices is distinct from old.audience_offices
     or new.audience_groups is distinct from old.audience_groups then
    raise exception 'A sent notice keeps its audience. Take it down and send a new one.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists program_announcements_keep_audience on public.program_announcements;
create trigger program_announcements_keep_audience
  before update of audience, audience_offices, audience_groups on public.program_announcements
  for each row execute function public.program_announcements_keep_audience();

/**
 * One pinned notice at a time (program-notices.sql's index), but a notice that left the
 * dashboards after 7 days no longer holds the slot: pinning a live notice first unpins any
 * pinned notice older than that. A notice older than 7 days can't be pinned, since nobody
 * would see it.
 */
create or replace function public.program_announcements_free_pin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pinned and (tg_op = 'INSERT' or not old.pinned) then
    if new.created_at <= now() - interval '7 days' then
      raise exception 'This notice has left the dashboards. Send a new one to pin it.'
        using errcode = 'check_violation';
    end if;
    update public.program_announcements
       set pinned = false
     where pinned
       and id <> new.id
       and created_at <= now() - interval '7 days';
  end if;
  return new;
end;
$$;

drop trigger if exists program_announcements_free_pin on public.program_announcements;
create trigger program_announcements_free_pin
  before insert or update of pinned on public.program_announcements
  for each row execute function public.program_announcements_free_pin();

/**
 * How many people a notice would notify if the caller sent it now: exactly the rows the
 * notifier writes (other admins count when the audience is everyone). For the "This will
 * notify N people" line. An active admin only.
 */
create or replace function public.admin_notice_reach(p_audience text, p_offices uuid[], p_groups text[])
returns int language plpgsql stable security definer set search_path = public as $$
begin
  if not public.office_admin_reads() then
    raise exception 'Only an admin can send notices.' using errcode = 'insufficient_privilege';
  end if;
  return (select count(*)::int
            from public.notice_recipients(p_audience, p_offices, p_groups, auth.uid()));
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.notice_audience_includes(text, uuid[], text[], uuid)
  from public, anon, authenticated;
revoke all on function public.notice_recipients(text, uuid[], text[], uuid)
  from public, anon, authenticated;
revoke all on function public.program_announcements_keep_audience()
  from public, anon, authenticated;
revoke all on function public.program_announcements_free_pin()
  from public, anon, authenticated;

revoke all on function public.notice_reaches(public.program_announcements, uuid) from public, anon;
revoke all on function public.admin_notice_reach(text, uuid[], text[]) from public, anon;
grant execute on function public.notice_reaches(public.program_announcements, uuid) to authenticated;
grant execute on function public.admin_notice_reach(text, uuid[], text[]) to authenticated;

commit;
