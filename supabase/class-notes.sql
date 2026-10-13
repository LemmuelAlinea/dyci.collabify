-- Collabify — intervention notes: what the teaching staff saw and did, kept as a record.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/class-notes.sql
-- Requires: classes.sql, groups.sql, projects.sql, tasks.sql (project_boards),
-- one-workplace.sql (is_class_professor with co-teachers).
-- Re-run supabase/anon-lockdown.sql afterwards.

/**
 * Analytics raises a flag; the professor talks to the student; then what? The
 * conversation lived nowhere, so next week's flag looked brand new and an
 * accreditation visit could not see that anybody acted.
 *
 * A note is the professor's own record: a meeting, a follow-up, or a plain
 * note, about one student or one group. Reminders the professor sends are
 * logged here automatically (nudge_board, remind_peer_round), and their
 * once-a-day limits read this log, because students can delete their
 * notifications and the old limit counted those.
 *
 * Staff only, in both directions. A student never reads a note, not even one
 * about themselves. A note is never deleted: it is resolved, with an outcome.
 */

begin;

do $$ begin
  create type public.class_note_kind as enum ('note', 'nudge', 'meeting', 'follow_up', 'peer_reminder');
exception when duplicate_object then null; end $$;

create table if not exists public.class_notes (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes (id) on delete cascade,
  student_id   uuid references public.profiles (id) on delete cascade,
  board_id     uuid references public.project_boards (id) on delete cascade,
  kind         public.class_note_kind not null,
  body         text not null,
  follow_up_on date,
  resolved_at  timestamptz,
  outcome      text not null default '',
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  constraint class_notes_subject check (student_id is not null or board_id is not null),
  constraint class_notes_body_len check (char_length(btrim(body)) between 1 and 2000),
  constraint class_notes_outcome_len check (char_length(outcome) <= 1000)
);

create index if not exists class_notes_by_class on public.class_notes (class_id, created_at desc);
create index if not exists class_notes_by_student on public.class_notes (student_id) where student_id is not null;
create index if not exists class_notes_by_board on public.class_notes (board_id, kind, created_at desc)
  where board_id is not null;

-- ---------------------------------------------------------------- writing

/**
 * Add a note by hand. Reminders are not added here: nudge_board and
 * remind_peer_round log those when they actually send, so the log cannot claim
 * a reminder that never went out.
 */
create or replace function public.add_class_note(
  p_class     uuid,
  p_student   uuid,
  p_board     uuid,
  p_kind      public.class_note_kind,
  p_body      text,
  p_follow_up date
) returns public.class_notes
language plpgsql security definer set search_path = public as $$
declare
  c    public.classes%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  n    public.class_notes%rowtype;
begin
  select * into c from public.classes where id = p_class;
  if c.id is null then
    raise exception 'That class no longer exists';
  end if;
  if not public.is_class_professor(p_class) then
    raise exception 'Only someone teaching this class can add a note'
      using errcode = 'insufficient_privilege';
  end if;
  if c.archived_at is not null then
    raise exception 'That class is archived. Restore it to add notes'
      using errcode = 'check_violation';
  end if;
  if p_kind not in ('note', 'meeting', 'follow_up') then
    raise exception 'Reminders are logged when you send them. Choose note, meeting or follow-up'
      using errcode = 'check_violation';
  end if;
  if p_student is null and p_board is null then
    raise exception 'Say who the note is about: a student or a group'
      using errcode = 'check_violation';
  end if;
  if v_body = '' then
    raise exception 'Write the note before saving it'
      using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'Keep the note under 2000 characters'
      using errcode = 'check_violation';
  end if;
  if p_student is not null and not exists (
    select 1 from public.class_members m where m.class_id = p_class and m.student_id = p_student
  ) then
    raise exception 'That student is not in this class'
      using errcode = 'check_violation';
  end if;
  if p_board is not null and not exists (
    select 1 from public.project_boards b
      join public.projects p on p.id = b.project_id
     where b.id = p_board and p.class_id = p_class
  ) then
    raise exception 'That group is not on a project in this class'
      using errcode = 'check_violation';
  end if;

  insert into public.class_notes (class_id, student_id, board_id, kind, body, follow_up_on)
  values (p_class, p_student, p_board, p_kind, v_body, p_follow_up)
  returning * into n;
  return n;
end;
$$;

/** Close a note with what came of it. Once resolved, it stays resolved. */
create or replace function public.resolve_class_note(p_note uuid, p_outcome text)
returns public.class_notes
language plpgsql security definer set search_path = public as $$
declare
  n       public.class_notes%rowtype;
  v_outcome text := btrim(coalesce(p_outcome, ''));
begin
  select * into n from public.class_notes where id = p_note for update;
  if n.id is null then
    raise exception 'That note no longer exists';
  end if;
  if not public.is_class_professor(n.class_id) then
    raise exception 'Only someone teaching this class can resolve a note'
      using errcode = 'insufficient_privilege';
  end if;
  if n.resolved_at is not null then
    raise exception 'That note is already resolved. Add a new note instead'
      using errcode = 'check_violation';
  end if;
  if char_length(v_outcome) > 1000 then
    raise exception 'Keep the outcome under 1000 characters'
      using errcode = 'check_violation';
  end if;

  update public.class_notes
     set resolved_at = clock_timestamp(), outcome = v_outcome
   where id = p_note
  returning * into n;
  return n;
end;
$$;

-- ---------------------------------------------------------------- policies

alter table public.class_notes enable row level security;

-- Teaching staff of the class, and nobody else: not the student, not an admin
-- who does not teach it.
drop policy if exists class_notes_select on public.class_notes;
create policy class_notes_select on public.class_notes
  for select using (public.is_class_professor(class_id));

-- Anon gets nothing here, inline, so a rebuild that runs this file after
-- anon-lockdown.sql stays locked down.
revoke all on public.class_notes from anon;
grant select on public.class_notes to authenticated;

revoke all on function public.add_class_note(uuid, uuid, uuid, public.class_note_kind, text, date) from public, anon;
revoke all on function public.resolve_class_note(uuid, text) from public, anon;
grant execute on function public.add_class_note(uuid, uuid, uuid, public.class_note_kind, text, date) to authenticated;
grant execute on function public.resolve_class_note(uuid, text) to authenticated;

-- ---------------------------------------------------------------- realtime

-- Listed here, not in live.sql: live.sql runs earlier in a rebuild.
do $$
begin
  begin
    alter publication supabase_realtime add table public.class_notes;
  exception
    when duplicate_object then null;
    when undefined_object then null;   -- no realtime publication on this database
  end;
  alter table public.class_notes replica identity full;
end $$;

commit;
