-- Collabify — every notification switch in Settings, made to mean something.
-- Idempotent: safe to run repeatedly.
--
--   node scripts/db.mjs supabase/notifications.sql

/**
 * Settings offered six switches. Three of them controlled nothing at all —
 * `deadline_reminders`, `comments_mentions` and `progress_digest` appeared in
 * no trigger, no function and no query — and a fourth, `project_released`, was
 * gated on the wrong one. Turning "Deadline reminders" off changed nothing
 * because there were no deadline reminders; turning it on promised a nudge
 * that never came.
 *
 * This file gives each switch something real behind it, and re-points the ones
 * that were wired to the wrong place. Two of the six need a clock rather than a
 * trigger, so `pg_cron` is installed and two jobs are scheduled.
 *
 * The map, after this file:
 *
 *   task_assignments    task_assigned
 *                       — work arriving at your hands
 *   deadline_reminders  deadline_soon (new)
 *                       — one nudge per task, the day before it is due
 *   comments_mentions   comment_posted (new)
 *                       — a reply on a task you hold or wrote on
 *   project_invites     group_placement, group_closed, project_released
 *                       — you have been put into something
 *   progress_digest     weekly_digest (new)
 *                       — Monday morning, what moved and what is due
 *   announcements       announcement
 *                       — a class notice or a program notice
 *
 * Three stay ungated on purpose, under one rule: **anything a person asked for,
 * or is required to act on, arrives regardless of their settings.**
 *
 *   reassign_requested  a professor who muted task assignments still has to
 *                       answer the request
 *   reassign_decided    the answer to a question this student asked; a
 *                       preference swallowing your own answer is a trap
 *   result_recorded     a group that handed work in is owed the verdict
 *
 * The rule matters more than the three cases. A switch that can silently eat
 * something somebody is waiting on is worse than no switch, and the next
 * notification added should be measured against it.
 */

begin;

-- ------------------------------------------------------------- new types

do $$
begin
  alter type public.notification_type add value if not exists 'deadline_soon';
  alter type public.notification_type add value if not exists 'comment_posted';
  alter type public.notification_type add value if not exists 'weekly_digest';
end $$;

drop function if exists public.notify_project_release();

commit;

-- A new enum value cannot be used in the same transaction that added it.
begin;

-- --------------------------------------------------------- task_id column

/**
 * `notifications` already carried project_id and task_id in some inserts, but
 * the table in classes.sql declares neither — the columns were added later by
 * files that insert into it. Assert they exist rather than assume, because a
 * missing one here fails at the first comment rather than at deploy.
 */
alter table public.notifications add column if not exists project_id uuid
  references public.projects (id) on delete cascade;
alter table public.notifications add column if not exists task_id uuid
  references public.project_tasks (id) on delete cascade;
alter table public.notifications add column if not exists group_id uuid
  references public.groups (id) on delete cascade;

-- ------------------------------------------- everybody has a row to gate on

/**
 * Every gate in this file is an inner join onto `notification_prefs`. That is
 * the right shape — a preference has to exist to be read — but it means a
 * profile without a row receives *nothing at all*, silently and forever.
 *
 * Today the row is created by `handle_new_user`, a trigger on `auth.users`, and
 * all 21 profiles have one. That is one path. A profile inserted any other way
 * — a fixture, a repair script, an import — would have no row and no symptom,
 * and the person would simply stop being notified.
 *
 * So: a trigger on `profiles` itself, which is the table the gates actually
 * join to, plus a backfill for anything already missing one. Defaults come from
 * the column defaults, so this cannot quietly opt somebody into or out of
 * anything.
 */
insert into public.notification_prefs (user_id)
select p.id from public.profiles p
 where not exists (select 1 from public.notification_prefs n where n.user_id = p.id)
on conflict (user_id) do nothing;

create or replace function public.ensure_notification_prefs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notification_prefs (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_ensure_prefs on public.profiles;
create trigger profiles_ensure_prefs after insert on public.profiles
  for each row execute function public.ensure_notification_prefs();

-- --------------------------------------------------- comments and mentions

/**
 * A reply reaches the people already on the task: whoever holds it, and
 * whoever has written on it before. Not the whole board — a board of six with
 * a busy task would otherwise notify five people about a conversation between
 * two.
 *
 * The author never notifies themselves, and `comments_mentions` gates it.
 */
create or replace function public.notify_task_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t record;
  proj record;
  who text;
begin
  select * into t from public.project_tasks where id = new.task_id;
  if t is null then return new; end if;

  select p.* into proj
    from public.projects p
    join public.project_boards b on b.project_id = p.id
   where b.id = t.board_id;

  select btrim(pr.first_name || ' ' || pr.last_name) into who
    from public.profiles pr where pr.id = new.author_id;

  insert into public.notifications
    (user_id, type, class_id, project_id, task_id, title, preview)
  select distinct s.user_id,
         'comment_posted'::public.notification_type,
         proj.class_id, proj.id, t.id,
         t.title,
         coalesce(who, 'Somebody') || ': ' ||
           left(regexp_replace(new.body, '\s+', ' ', 'g'), 120)
    from (
      select a.student_id as user_id
        from public.task_assignees a
       where a.task_id = new.task_id
      union
      select c.author_id
        from public.task_comments c
       where c.task_id = new.task_id
    ) s
    join public.notification_prefs np on np.user_id = s.user_id
   where s.user_id <> new.author_id
     and np.comments_mentions;

  return new;
end;
$$;

drop trigger if exists task_comments_notify on public.task_comments;
create trigger task_comments_notify after insert on public.task_comments
  for each row execute function public.notify_task_comment();

-- ----------------------------------------------------- deadline reminders

/**
 * One nudge per task per person, the day before it is due.
 *
 * `not exists` against the notifications already sent is what makes it one
 * nudge rather than one an hour: the job can run as often as it likes and a
 * person is told once. Nothing is stored to remember what was sent, because
 * the notification itself is that record.
 *
 * Only open work on a live board. A task that is done, on a board already
 * handed in, or in a project the professor has closed is not something anybody
 * needs waking up about.
 */
create or replace function public.send_deadline_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  sent integer;
begin
  insert into public.notifications
    (user_id, type, class_id, project_id, task_id, title, preview)
  select a.student_id,
         'deadline_soon'::public.notification_type,
         p.class_id, p.id, t.id,
         t.title,
         'Due ' || to_char(t.due_at at time zone 'Asia/Manila', 'FMDay, FMMon FMDD at FMHH12:MI AM')
    from public.project_tasks t
    join public.task_assignees a on a.task_id = t.id
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
    join public.notification_prefs np on np.user_id = a.student_id
   where t.due_at is not null
     and t.status <> 'done'
     and t.due_at > now()
     and t.due_at <= now() + interval '24 hours'
     and b.submitted_at is null
     and p.locked_at is null
     and p.archived_at is null
     and np.deadline_reminders
     and not exists (
       select 1 from public.notifications n
        where n.user_id = a.student_id
          and n.task_id = t.id
          and n.type = 'deadline_soon'
     );
  get diagnostics sent = row_count;
  return sent;
end;
$$;

-- ------------------------------------------------------- weekly digest

/**
 * Monday morning: what moved last week, and what is due this one.
 *
 * Sent to anybody who asked for it and holds work — a digest of nothing is
 * worse than no digest, so a person with no tasks at all is skipped rather
 * than told they finished zero of zero.
 *
 * Counted from the same rows the boards are drawn from, so the figures cannot
 * disagree with what the person sees when they follow it.
 */
create or replace function public.send_weekly_digest()
returns integer language plpgsql security definer set search_path = public as $$
declare
  sent integer;
begin
  with mine as (
    select a.student_id,
           count(*) filter (
             where t.done_at >= now() - interval '7 days'
           )::int as finished,
           count(*) filter (
             where t.status <> 'done'
               and t.due_at is not null
               and t.due_at <= now() + interval '7 days'
           )::int as due_next,
           count(*) filter (
             where t.status <> 'done' and t.due_at is not null and t.due_at < now()
           )::int as overdue
      from public.task_assignees a
      join public.project_tasks t on t.id = a.task_id
      join public.project_boards b on b.id = t.board_id
      join public.projects p on p.id = b.project_id
     where p.archived_at is null
     group by a.student_id
  )
  insert into public.notifications (user_id, type, title, preview)
  select m.student_id,
         'weekly_digest'::public.notification_type,
         'Your week: ' || m.finished || ' finished, ' || m.due_next || ' coming up',
         case
           when m.overdue > 0
             then m.overdue || ' past its date. ' || m.due_next || ' due in the next seven days.'
           when m.due_next = 0
             then 'Nothing due in the next seven days.'
           else m.due_next || ' due in the next seven days.'
         end
    from mine m
    join public.notification_prefs np on np.user_id = m.student_id
   where np.progress_digest
     and (m.finished > 0 or m.due_next > 0 or m.overdue > 0);
  get diagnostics sent = row_count;
  return sent;
end;
$$;

-- ------------------------------------------------- the switches, re-pointed

/**
 * A project opening to students is not a task being assigned — nobody has been
 * given anything yet. It belongs with the other "you are now part of this"
 * notices, which is `project_invites`.
 */
-- `notify_project_released`, past tense — the name the trigger in projects.sql
-- actually calls. Defining `notify_project_release` instead created a second,
-- unused function and left the original running on the wrong switch, with no
-- error anywhere. Dropped below so the near-miss cannot linger.
create or replace function public.notify_project_released()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  was_live boolean;
  now_live boolean;
  class_name text;
begin
  was_live := tg_op = 'UPDATE'
    and old.archived_at is null
    and (old.release_at is null or old.release_at <= now());
  now_live := new.archived_at is null
    and (new.release_at is null or new.release_at <= now());

  if was_live or not now_live then
    return new;
  end if;

  select c.name into class_name from public.classes c where c.id = new.class_id;

  insert into public.notifications (user_id, type, class_id, project_id, title, preview)
  select m.student_id, 'project_released', new.class_id, new.id,
         new.title,
         'New in ' || class_name || ' · weeks ' || new.start_week || '–' || new.end_week
    from public.class_members m
    join public.notification_prefs np on np.user_id = m.student_id
   where m.class_id = new.class_id
     and m.status = 'active'
     and np.project_invites
     -- A group project reaches only the students actually placed in it.
     and (
       new.group_set_id is null
       or exists (
         select 1 from public.group_members gm
          where gm.set_id = new.group_set_id and gm.student_id = m.student_id
       )
     );
  return new;
end;
$$;

-- ------------------------------------------------------------ the clock

/**
 * Two of the six need a clock rather than a trigger. `pg_cron` was available on
 * this project and not installed; it is installed here so the schedule lives
 * with the rest of the schema rather than in somebody's dashboard.
 *
 * Times are UTC, which is what pg_cron reads. Manila is UTC+8, so the digest's
 * Sunday 23:00 is Monday 07:00 to the people receiving it — a Monday morning
 * summary, which is when it is worth reading.
 *
 * Unscheduled first: `cron.schedule` on an existing name replaces it, but
 * unscheduling makes the intent legible and keeps a rename from leaving an
 * orphan job running forever.
 */
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('collabify-deadline-reminders');
exception when others then null; end $$;

do $$
begin
  perform cron.unschedule('collabify-weekly-digest');
exception when others then null; end $$;

-- Hourly. The function sends one nudge per task per person however often it
-- runs, so the cadence only decides how soon inside the last day it lands.
select cron.schedule(
  'collabify-deadline-reminders',
  '0 * * * *',
  $cron$ select public.send_deadline_reminders() $cron$
);

-- Sunday 23:00 UTC = Monday 07:00 in Manila.
select cron.schedule(
  'collabify-weekly-digest',
  '0 23 * * 0',
  $cron$ select public.send_weekly_digest() $cron$
);

commit;
