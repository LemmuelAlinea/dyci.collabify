-- Collabify — a record of who changed somebody's access, and when.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/audit.sql

/**
 * An audit log for the program admin, and the hard part is what it leaves out.
 *
 * An admin can already read every profile and every class, and reads **nothing**
 * of projects, tasks, comments, files, messages, submissions, verdicts or the
 * reasons attached to a reassignment. That boundary is deliberate, and this log
 * is exactly the sort of feature that would quietly dissolve it.
 *
 * So it records administrative acts on accounts and structure, and no academic
 * content whatsoever — not even derived facts like how much of a class is late.
 * "Who let this professor in" is the admin's business. "How is that group
 * doing" is the professor's.
 *
 * Two rules hold it up:
 *
 *   - Nothing writes to it but the triggers below, which are security definer.
 *     There is no insert policy, so a client cannot forge an entry.
 *   - There is no update or delete policy either, for anybody, the admin
 *     included. A log its own subject can rewrite is worth nothing.
 */

begin;

do $$ begin
  create type public.audit_action as enum (
    'account_created',
    'role_changed',
    'status_changed',
    'class_created',
    'class_archived',
    'class_restored',
    'class_professor_changed',
    'class_deleted'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.audit_events (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null default clock_timestamp(),
  action        public.audit_action not null,

  -- Null when the database itself did it: the SQL console, or a trigger acting
  -- with no session behind it. Rendered as "system" rather than left blank.
  actor_id      uuid references public.profiles (id) on delete set null,

  -- Who or what it happened to. Labels are snapshots, because the point of a
  -- log is that it still reads correctly after the row it describes is gone.
  subject_id    uuid,
  subject_label text not null default '',
  class_id      uuid,
  class_label   text not null default '',

  before_value  text not null default '',
  after_value   text not null default ''
);

create index if not exists audit_events_recent on public.audit_events (at desc);
create index if not exists audit_events_by_subject on public.audit_events (subject_id, at desc);

-- ---------------------------------------------------------------- writing

/** A person's name as it stood, so a deleted account still reads sensibly. */
create or replace function public.audit_label(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(btrim(first_name || ' ' || last_name), '') from public.profiles where id = p_user;
$$;

/**
 * Role and status are the one thing the project calls a security invariant, so
 * they are the one thing this cannot afford to miss. It watches the column
 * rather than the caller: however the change arrives — the approvals console,
 * the CLI, a hand-written update — it lands here.
 */
create or replace function public.log_profile_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events
      (action, actor_id, subject_id, subject_label, after_value)
    values ('account_created', auth.uid(), new.id,
            coalesce(btrim(new.first_name || ' ' || new.last_name), ''),
            new.role::text || ' · ' || new.status::text);
    return new;
  end if;

  if new.role is distinct from old.role then
    insert into public.audit_events
      (action, actor_id, subject_id, subject_label, before_value, after_value)
    values ('role_changed', auth.uid(), new.id,
            coalesce(btrim(new.first_name || ' ' || new.last_name), ''),
            old.role::text, new.role::text);
  end if;

  if new.status is distinct from old.status then
    insert into public.audit_events
      (action, actor_id, subject_id, subject_label, before_value, after_value)
    values ('status_changed', auth.uid(), new.id,
            coalesce(btrim(new.first_name || ' ' || new.last_name), ''),
            old.status::text, new.status::text);
  end if;

  return new;
end;
$$;

-- After, not before: guard_privileged_columns may pin the change back, and a
-- log of attempts that never happened is noise.
drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit after insert or update on public.profiles
  for each row execute function public.log_profile_change();

/** Class lifecycle. The name and code only — never anything set inside it. */
create or replace function public.log_class_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  label text;
begin
  if tg_op = 'DELETE' then
    insert into public.audit_events
      (action, actor_id, class_id, class_label, subject_id, subject_label)
    values ('class_deleted', auth.uid(), old.id,
            old.initial || ' · ' || old.name,
            old.professor_id, public.audit_label(old.professor_id));
    return old;
  end if;

  label := new.initial || ' · ' || new.name;

  if tg_op = 'INSERT' then
    insert into public.audit_events
      (action, actor_id, class_id, class_label, subject_id, subject_label)
    values ('class_created', auth.uid(), new.id, label,
            new.professor_id, public.audit_label(new.professor_id));
    return new;
  end if;

  if new.archived_at is distinct from old.archived_at then
    insert into public.audit_events
      (action, actor_id, class_id, class_label)
    values (
      -- Cast explicitly: a CASE resolves its branches as text before it meets
      -- the column type.
      (case when new.archived_at is null then 'class_restored' else 'class_archived' end)
        ::public.audit_action,
      auth.uid(), new.id, label);
  end if;

  if new.professor_id is distinct from old.professor_id then
    insert into public.audit_events
      (action, actor_id, class_id, class_label, subject_id, subject_label,
       before_value, after_value)
    values ('class_professor_changed', auth.uid(), new.id, label,
            new.professor_id, public.audit_label(new.professor_id),
            public.audit_label(old.professor_id), public.audit_label(new.professor_id));
  end if;

  return new;
end;
$$;

drop trigger if exists classes_audit on public.classes;
create trigger classes_audit after insert or update or delete on public.classes
  for each row execute function public.log_class_change();

-- ---------------------------------------------------------------- policies

alter table public.audit_events enable row level security;

/**
 * The admin reads it, and that is the whole audience. A person does not see the
 * entries about themselves: a professor learns the outcome from their own
 * account, and naming the admin behind every decision turns a record into
 * something to argue with.
 */
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select using (public.is_admin());

-- No insert, update or delete policy for anybody. The triggers above are
-- security definer and bypass this; a client has no way in at all.

grant select on public.audit_events to authenticated;

/** The log with the actor's name attached. */
drop view if exists public.audit_log;

create view public.audit_log
with (security_invoker = true) as
select e.*,
       coalesce(btrim(a.first_name || ' ' || a.last_name), 'System') as actor_name,
       a.avatar_url as actor_avatar
  from public.audit_events e
  left join public.profiles a on a.id = e.actor_id;

grant select on public.audit_log to authenticated;

-- ------------------------------------------------- an unrelated narrowing

/**
 * An admin could read everybody's notification preferences — which digests they
 * want, whether they get deadline reminders. Personal settings with no
 * administrative purpose, and nothing in the product ever asked for them: every
 * read is already scoped to the signed-in user. Narrowed to the owner.
 */
drop policy if exists prefs_select_own on public.notification_prefs;
create policy prefs_select_own on public.notification_prefs
  for select using (user_id = auth.uid());

commit;
