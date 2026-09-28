-- Collabify — small automations that save somebody a step.
--
--   node scripts/db.mjs supabase/automation.sql
--
--   type / function            what it does
--   project_released (cron)    a scheduled project tells its students when it
--                              opens, not only when it is saved
--   task_overdue (cron)        a task holder hears once when their task slips
--                              past its date
--   nudge (nudge_board)        a professor reminds a quiet board in one click;
--                              arrives regardless of settings, once a day
--
-- Runs after appearance.sql, before anon-lockdown.sql. Re-run anon-lockdown.sql
-- after it. Two transactions: a new enum value cannot be used in the one that
-- added it. Idempotent. Safe to re-run.

begin;

do $$
begin
  alter type public.notification_type add value if not exists 'task_overdue';
  alter type public.notification_type add value if not exists 'nudge';
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

-- ------------------------------------------------------------------ nudge

/**
 * A professor looking at a stalled board used to have one move: open it. This
 * sends the people on it a reminder, with an optional line of their own.
 *
 * Ungated by settings, like anything from a person rather than a clock. Once a
 * day per board, so a reminder cannot turn into pestering. Nothing to remind
 * about on work already handed in or a project that is closed.
 */
create or replace function public.nudge_board(p_board uuid, p_note text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  b    public.project_boards%rowtype;
  proj public.projects%rowtype;
  who  text;
  note text := nullif(btrim(coalesce(p_note, '')), '');
  recipients uuid[];
  sent integer;
begin
  select * into b from public.project_boards where id = p_board;
  if b.id is null then
    raise exception 'That board no longer exists';
  end if;
  if not public.is_board_professor(p_board) then
    raise exception 'Only someone teaching this class can send a reminder'
      using errcode = 'insufficient_privilege';
  end if;

  select * into proj from public.projects where id = b.project_id;
  if b.submitted_at is not null then
    raise exception 'That work is handed in, so there is nothing to remind them about'
      using errcode = 'check_violation';
  end if;
  if proj.locked_at is not null or proj.archived_at is not null then
    raise exception 'That project is closed, so reminders are off'
      using errcode = 'check_violation';
  end if;
  if length(note) > 280 then
    raise exception 'Keep the note under 280 characters'
      using errcode = 'check_violation';
  end if;

  select array_agg(x) into recipients from (
    select b.student_id as x where b.student_id is not null
    union
    select gm.student_id from public.group_members gm
     where b.group_id is not null and gm.group_id = b.group_id
  ) r;
  if recipients is null then
    raise exception 'Nobody is on that board yet'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.notifications n
     where n.user_id = any (recipients)
       and n.type = 'nudge'
       and n.project_id = proj.id
       and n.created_at > now() - interval '20 hours'
  ) then
    raise exception 'They were reminded today already. Try again tomorrow'
      using errcode = 'check_violation';
  end if;

  select btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))
    into who from public.profiles p where p.id = auth.uid();

  insert into public.notifications
    (user_id, type, class_id, project_id, group_id, title, preview)
  select t.user_id, 'nudge', proj.class_id, proj.id, b.group_id,
         'Reminder: ' || proj.title,
         coalesce(note,
           coalesce(nullif(who, ''), 'Your professor')
             || ' is checking in. Move a task forward, or say on the board what is in the way.')
    from unnest(recipients) as t(user_id);
  get diagnostics sent = row_count;
  return sent;
end;
$$;

grant execute on function public.nudge_board(uuid, text) to authenticated;

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
