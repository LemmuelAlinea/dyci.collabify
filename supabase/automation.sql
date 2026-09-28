-- Collabify — small automations that save somebody a step.
--
--   node scripts/db.mjs supabase/automation.sql
--
--   type / function            what it does
--   project_released (cron)    a scheduled project tells its students when it
--                              opens, not only when it is saved
--   task_overdue (cron)        a task holder hears once when their task slips
--                              past its date
--
-- Runs after appearance.sql, before anon-lockdown.sql. Re-run anon-lockdown.sql
-- after it. Two transactions: a new enum value cannot be used in the one that
-- added it. Idempotent. Safe to re-run.

begin;

do $$
begin
  alter type public.notification_type add value if not exists 'task_overdue';
end $$;

commit;

begin;

-- --------------------------------------------------- scheduled releases

/**
 * The release trigger in notifications.sql fires when a project is saved. A
 * project saved with a future `release_at` is not live then, so it says
 * nothing — and nothing ever wakes up when the time arrives. This is that
 * wake-up.
 *
 * Same audience and switch as the trigger: active students of the class,
 * only those placed in the set for a group project, `project_invites` on.
 * `not exists` against notifications already sent keeps it to one each, so it
 * cannot double up with the trigger or with itself. Only releases in the last
 * day, so a missed run is caught up but old projects are never announced.
 */
create or replace function public.send_scheduled_releases()
returns integer language plpgsql security definer set search_path = public as $$
declare
  sent integer;
begin
  insert into public.notifications (user_id, type, class_id, project_id, title, preview)
  select m.student_id, 'project_released', p.class_id, p.id,
         p.title,
         'New in ' || c.name || ' · weeks ' || p.start_week || '–' || p.end_week
    from public.projects p
    join public.classes c on c.id = p.class_id
    join public.class_members m on m.class_id = p.class_id and m.status = 'active'
    join public.notification_prefs np on np.user_id = m.student_id
   where p.release_at is not null
     and p.release_at <= now()
     and p.release_at > now() - interval '1 day'
     and p.archived_at is null
     and p.locked_at is null
     and np.project_invites
     and (
       p.group_set_id is null
       or exists (
         select 1 from public.group_members gm
          where gm.set_id = p.group_set_id and gm.student_id = m.student_id
       )
     )
     and not exists (
       select 1 from public.notifications n
        where n.user_id = m.student_id
          and n.project_id = p.id
          and n.type = 'project_released'
     );
  get diagnostics sent = row_count;
  return sent;
end;
$$;

-- -------------------------------------------------------- overdue notices

/**
 * "Due soon" is sent the day before. Nothing followed once the date passed,
 * so a missed task went quiet exactly when it mattered. One notice per task
 * per holder, the first hour after it slips.
 *
 * Same rules as the reminder: open work on a live board, `deadline_reminders`
 * on. Only tasks that slipped in the last three days, so turning this on does
 * not send a pile about work long gone.
 */
create or replace function public.send_overdue_notices()
returns integer language plpgsql security definer set search_path = public as $$
declare
  sent integer;
begin
  insert into public.notifications
    (user_id, type, class_id, project_id, task_id, title, preview)
  select a.student_id,
         'task_overdue'::public.notification_type,
         p.class_id, p.id, t.id,
         t.title,
         'Was due ' || to_char(t.due_at at time zone 'Asia/Manila', 'FMDay, FMMon FMDD at FMHH12:MI AM')
           || '. Finish it or ask to hand it over.'
    from public.project_tasks t
    join public.task_assignees a on a.task_id = t.id
    join public.project_boards b on b.id = t.board_id
    join public.projects p on p.id = b.project_id
    join public.notification_prefs np on np.user_id = a.student_id
   where t.due_at is not null
     and t.status <> 'done'
     and t.due_at <= now()
     and t.due_at > now() - interval '3 days'
     and b.submitted_at is null
     and p.locked_at is null
     and p.archived_at is null
     and np.deadline_reminders
     and not exists (
       select 1 from public.notifications n
        where n.user_id = a.student_id
          and n.task_id = t.id
          and n.type = 'task_overdue'
     );
  get diagnostics sent = row_count;
  return sent;
end;
$$;

revoke all on function public.send_scheduled_releases() from public, anon, authenticated;
revoke all on function public.send_overdue_notices() from public, anon, authenticated;

-- ------------------------------------------------------------ the clock

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('collabify-scheduled-releases');
exception when others then null; end $$;

do $$
begin
  perform cron.unschedule('collabify-overdue-notices');
exception when others then null; end $$;

-- Every 15 minutes, so a project set to open at 8:00 is announced by 8:15.
select cron.schedule(
  'collabify-scheduled-releases',
  '*/15 * * * *',
  $cron$ select public.send_scheduled_releases() $cron$
);

-- Hourly, a quarter past, clear of the reminder job on the hour.
select cron.schedule(
  'collabify-overdue-notices',
  '15 * * * *',
  $cron$ select public.send_overdue_notices() $cron$
);

commit;
