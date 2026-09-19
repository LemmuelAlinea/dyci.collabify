-- Collabify — notifications and conversations for the General workplace.
--
--   node scripts/db.mjs supabase/general-notify.sql
--
-- Two transactions: a new enum value cannot be used in the transaction that
-- added it.
--
-- The notification rule, from supabase/notifications.sql: anything a person
-- must act on, or asked for, arrives regardless of their settings. So an
-- invitation, an access request to its Owners and the answer to whoever asked
-- are ungated; assignments, comments and deadline reminders follow the same
-- three switches Education uses.
--
-- Requires supabase/general.sql, supabase/general-tasks.sql and supabase/messages.sql.
--
-- conversation_is_writable, conversation_overview and is_conversation_member
-- are redefined here as supersets of supabase/messages.sql — is_conversation_member
-- has the widest reach of the three, with 21 call sites across messages.sql
-- and polls.sql. Re-running supabase/messages.sql by itself after this file
-- will fail on conversation_overview ("cannot drop columns from view")
-- because its copy is missing general_project_id — a rebuild in the
-- documented order (messages, then general, general-tasks, general-notify)
-- is unaffected.

begin;

do $$
begin
  alter type public.notification_type add value if not exists 'general_invited';
  alter type public.notification_type add value if not exists 'general_access_requested';
  alter type public.notification_type add value if not exists 'general_access_answered';
  alter type public.notification_type add value if not exists 'general_task_assigned';
  alter type public.notification_type add value if not exists 'general_comment_posted';
  alter type public.notification_type add value if not exists 'general_deadline_soon';
  alter type public.conversation_kind add value if not exists 'project';
end $$;

commit;

begin;

-- ---------------------------------------------------------------- columns

alter table public.notifications
  add column if not exists general_project_id uuid
  references public.general_projects (id) on delete cascade;
alter table public.notifications
  add column if not exists general_task_id uuid
  references public.general_tasks (id) on delete cascade;

create index if not exists notifications_general_project_id_idx
  on public.notifications (general_project_id);
create index if not exists notifications_general_task_id_idx
  on public.notifications (general_task_id);

-- ---------------------------------------------------------------- invitations

create or replace function public.notify_general_invitation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, general_project_id, title, preview)
  select new.invitee,
         'general_invited'::public.notification_type,
         p.id,
         p.name,
         coalesce(nullif(btrim(i.first_name || ' ' || i.last_name), ''), 'Somebody')
           || ' invited you to join this project'
    from public.general_projects p
    left join public.profiles i on i.id = new.invited_by
   where p.id = new.project_id;
  return new;
end;
$$;

drop trigger if exists general_invitations_notify on public.general_invitations;
create trigger general_invitations_notify after insert on public.general_invitations
  for each row when (new.status = 'pending')
  execute function public.notify_general_invitation();

-- ---------------------------------------------------------------- access requests

create or replace function public.notify_general_access_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, type, general_project_id, title, preview)
    select o.user_id,
           'general_access_requested'::public.notification_type,
           p.id,
           p.name,
           coalesce(nullif(btrim(r.first_name || ' ' || r.last_name), ''), 'Somebody')
             || ' asked for: ' || public.general_permission_label(new.permission)
      from public.general_members o
      join public.general_projects p on p.id = o.project_id
      join public.profiles r on r.id = new.user_id
     where o.project_id = new.project_id and o.level = 'owner';
  elsif old.status = 'open' and new.status in ('approved', 'declined') then
    insert into public.notifications (user_id, type, general_project_id, title, preview)
    select new.user_id,
           'general_access_answered'::public.notification_type,
           p.id,
           p.name,
           case when new.status = 'approved' then 'Approved: ' else 'Declined: ' end
             || public.general_permission_label(new.permission)
      from public.general_projects p
     where p.id = new.project_id;
  end if;
  return new;
end;
$$;

drop trigger if exists general_access_requests_notify on public.general_access_requests;
create trigger general_access_requests_notify after insert or update on public.general_access_requests
  for each row execute function public.notify_general_access_request();

-- ---------------------------------------------------------------- tasks

create or replace function public.notify_general_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Claiming a task yourself is not news to you.
  if new.assigned_by is null or new.assigned_by = new.user_id then
    return new;
  end if;
  insert into public.notifications
    (user_id, type, general_project_id, general_task_id, title, preview)
  select new.user_id,
         'general_task_assigned'::public.notification_type,
         t.project_id,
         t.id,
         t.title,
         p.name
    from public.general_tasks t
    join public.general_projects p on p.id = t.project_id
    join public.notification_prefs np on np.user_id = new.user_id
   where t.id = new.task_id and np.task_assignments;
  return new;
end;
$$;

drop trigger if exists general_task_assignees_notify on public.general_task_assignees;
create trigger general_task_assignees_notify after insert on public.general_task_assignees
  for each row execute function public.notify_general_assignment();

/** Reaches whoever holds the task now, plus whoever has commented on it
    before — not only the current holder, and not the whole board — but only
    while they are still on the project. Comment rows outlive membership
    (author_id is only SET NULL, and general_task_comments has no FK to
    general_members), so a departed commenter is filtered back out here
    rather than left to ride along on a stale comment row. */
create or replace function public.notify_general_comment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications
    (user_id, type, general_project_id, general_task_id, title, preview)
  select r.user_id,
         'general_comment_posted'::public.notification_type,
         t.project_id,
         t.id,
         t.title,
         left(new.body, 140)
    from (
      select a.user_id from public.general_task_assignees a where a.task_id = new.task_id
      union
      select c.author_id from public.general_task_comments c
       where c.task_id = new.task_id and c.author_id is not null and c.id <> new.id
    ) r
    join public.general_tasks t on t.id = new.task_id
    join public.general_members gm on gm.project_id = t.project_id and gm.user_id = r.user_id
    join public.notification_prefs np on np.user_id = r.user_id
   where r.user_id is distinct from new.author_id
     and np.comments_mentions;
  return new;
end;
$$;

drop trigger if exists general_task_comments_notify on public.general_task_comments;
create trigger general_task_comments_notify after insert on public.general_task_comments
  for each row execute function public.notify_general_comment();

/** One nudge per task per person, the day before, on a live project. */
create or replace function public.send_general_deadline_reminders()
returns integer language plpgsql security definer set search_path = public as $$
declare
  sent integer;
begin
  insert into public.notifications
    (user_id, type, general_project_id, general_task_id, title, preview)
  select a.user_id,
         'general_deadline_soon'::public.notification_type,
         t.project_id,
         t.id,
         t.title,
         'Due ' || to_char(t.due_at at time zone 'Asia/Manila', 'FMDay, FMMon FMDD at FMHH12:MI AM')
    from public.general_tasks t
    join public.general_task_assignees a on a.task_id = t.id
    join public.general_projects p on p.id = t.project_id
    join public.notification_prefs np on np.user_id = a.user_id
   where t.due_at is not null
     and t.status <> 'done'
     and t.due_at > now()
     and t.due_at <= now() + interval '24 hours'
     and p.archived_at is null
     and np.deadline_reminders
     and not exists (
       select 1 from public.notifications n
        where n.user_id = a.user_id
          and n.general_task_id = t.id
          and n.type = 'general_deadline_soon'
     );
  get diagnostics sent = row_count;
  return sent;
end;
$$;

revoke execute on function public.send_general_deadline_reminders() from public, anon, authenticated;

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('collabify-general-deadline-reminders');
exception when others then null; end $$;

-- Hourly, at half past, so it does not land on the same minute as Education's.
select cron.schedule(
  'collabify-general-deadline-reminders',
  '30 * * * *',
  $cron$ select public.send_general_deadline_reminders() $cron$
);

-- ---------------------------------------------------------------- conversations

alter table public.conversations
  add column if not exists general_project_id uuid
  references public.general_projects (id) on delete cascade;

alter table public.conversations drop constraint if exists conversations_shape;
alter table public.conversations add constraint conversations_shape check (
  (kind = 'class'   and class_id is not null and group_id is null and direct_key is null
                    and general_project_id is null) or
  (kind = 'group'   and group_id is not null and class_id is null and direct_key is null
                    and general_project_id is null) or
  (kind = 'direct'  and direct_key is not null and class_id is null and group_id is null
                    and general_project_id is null) or
  (kind = 'project' and general_project_id is not null and class_id is null and group_id is null
                    and direct_key is null)
);

create unique index if not exists conversations_one_per_general_project
  on public.conversations (general_project_id) where kind = 'project';

create or replace function public.create_general_project_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.conversations (kind, general_project_id)
  values ('project', new.id)
  on conflict (general_project_id) where kind = 'project' do nothing;
  return new;
end;
$$;

drop trigger if exists general_projects_conversation on public.general_projects;
create trigger general_projects_conversation after insert on public.general_projects
  for each row execute function public.create_general_project_conversation();

create or replace function public.sync_general_conversation_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.conversation_members (conversation_id, user_id)
    select c.id, new.user_id
      from public.conversations c
     where c.kind = 'project' and c.general_project_id = new.project_id
    on conflict do nothing;
    return new;
  end if;

  delete from public.conversation_members cm
   using public.conversations c
   where c.id = cm.conversation_id
     and c.kind = 'project'
     and c.general_project_id = old.project_id
     and cm.user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists general_members_conversation on public.general_members;
create trigger general_members_conversation after insert or delete on public.general_members
  for each row execute function public.sync_general_conversation_member();

-- Projects that existed before this file ran.
insert into public.conversations (kind, general_project_id)
select 'project', p.id from public.general_projects p
on conflict (general_project_id) where kind = 'project' do nothing;

insert into public.conversation_members (conversation_id, user_id)
select c.id, m.user_id
  from public.general_members m
  join public.conversations c on c.kind = 'project' and c.general_project_id = m.project_id
on conflict do nothing;

/** As supabase/messages.sql, plus: a deactivated account is a member of
    nothing, whatever conversation_members rows still exist. This closes
    Education chat the same way — deactivation blocks both workplaces. */
create or replace function public.is_conversation_member(p_conversation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.conversation_members cm
      join public.profiles pr on pr.id = cm.user_id
     where cm.conversation_id = p_conversation
       and cm.user_id = auth.uid()
       and pr.status <> 'rejected'
  );
$$;

/** As supabase/messages.sql — an archived General project is read-only too —
    plus: a deactivated caller cannot post even where their membership row
    remains, so removal from general_members is not the only thing standing
    between them and the conversation. */
create or replace function public.conversation_is_writable(p_conversation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1
      from public.conversations c
      left join public.classes cl on cl.id = c.class_id
      left join public.groups g on g.id = c.group_id
      left join public.group_sets gs on gs.id = g.set_id
      left join public.classes gcl on gcl.id = gs.class_id
      left join public.general_projects gp on gp.id = c.general_project_id
     where c.id = p_conversation
       and coalesce(cl.archived_at, gcl.archived_at, gp.archived_at) is not null
  )
  and exists (
    select 1 from public.profiles where id = auth.uid() and status <> 'rejected'
  );
$$;

-- As supabase/messages.sql, with general_project_id appended. A column can only
-- be added at the end by `create or replace view`.
create or replace view public.conversation_overview
with (security_invoker = true) as
select c.id,
       c.kind,
       c.class_id,
       c.group_id,
       c.direct_key,
       c.updated_at,
       cm.last_read_at,
       (
         select count(*)
           from public.messages m
          where m.conversation_id = c.id
            and m.created_at > cm.last_read_at
            and m.sender_id <> auth.uid()
            and m.deleted_at is null
       )::int as unread_count,
       (
         select m.body from public.messages m
          where m.conversation_id = c.id and m.deleted_at is null
          order by m.created_at desc limit 1
       ) as last_body,
       (
         select m.created_at from public.messages m
          where m.conversation_id = c.id
          order by m.created_at desc limit 1
       ) as last_at,
       c.general_project_id
  from public.conversations c
  join public.conversation_members cm
    on cm.conversation_id = c.id and cm.user_id = auth.uid();

grant select on public.conversation_overview to authenticated;

-- ---------------------------------------------------------------- admin counts

/** Counts, never content — the same rule the admin console follows for classes. */
create or replace function public.general_counts()
returns table (projects int, active_projects int, archived_projects int, people int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only the program admin reads these counts'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select (select count(*) from public.general_projects)::int,
           (select count(*) from public.general_projects
             where archived_at is null and status not in ('done', 'cancelled'))::int,
           (select count(*) from public.general_projects where archived_at is not null)::int,
           (select count(distinct m.user_id) from public.general_members m)::int;
end;
$$;

grant execute on function public.general_counts() to authenticated;

commit;
