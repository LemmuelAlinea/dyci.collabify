-- Collabify — work can change hands, with a reason and the professor's say-so.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/reassignments.sql

/**
 * A group project finishes when every task on its board finishes, and until now
 * a started task could never change hands: guard_task_unclaim refuses the
 * delete, and nobody is exempt. A member who claims work, starts it and then
 * goes quiet holds it for good, and the students who finished their own work
 * are marked against a project that cannot complete.
 *
 * The way out was deleting the task, which throws away its files, comments and
 * work log with it. This adds the missing path: ask, say why, and let the
 * professor decide.
 *
 * The reason is written about a person, so it is read only by the professor and
 * whoever wrote it. The holder learns the task moved — the trail already logs
 * that, because releasing and assigning are ordinary events — but never what
 * was said about them.
 */

-- Adding a label to an existing enum is the one change that cannot be used in
-- the transaction that makes it, so these commit on their own first.
begin;

do $$ begin
  alter type public.notification_type add value if not exists 'reassign_requested';
exception when undefined_object then null; end $$;

do $$ begin
  alter type public.notification_type add value if not exists 'reassign_decided';
exception when undefined_object then null; end $$;

commit;

begin;

-- ---------------------------------------------------------------- enums

do $$ begin
  -- What the student is asking for. The professor may still decide otherwise.
  create type public.reassignment_outcome as enum ('take_over', 'release');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.reassignment_status as enum (
    'pending', 'approved', 'declined', 'withdrawn'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- table

create table if not exists public.task_reassignments (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.project_tasks (id) on delete cascade,
  requested_by  uuid not null references public.profiles (id) on delete cascade,

  -- Who held it when the request was made. Recorded rather than derived, so the
  -- record still reads true after the task has moved on.
  from_student  uuid references public.profiles (id) on delete set null,

  wants         public.reassignment_outcome not null,
  reason        text not null,

  status        public.reassignment_status not null default 'pending',
  -- Who actually received it. Null on a release: it went back to the group.
  to_student    uuid references public.profiles (id) on delete set null,
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  decision_note text not null default '',
  created_at    timestamptz not null default now(),

  constraint task_reassignments_reason_present check (length(btrim(reason)) > 0)
);

-- One live request per task. A second would give the professor two answers to
-- the same question.
create unique index if not exists task_reassignments_one_pending
  on public.task_reassignments (task_id) where status = 'pending';

create index if not exists task_reassignments_by_task
  on public.task_reassignments (task_id, created_at desc);

create index if not exists task_reassignments_by_requester
  on public.task_reassignments (requested_by, created_at desc);

-- ---------------------------------------------------------------- guard

/**
 * Everything that decides whether a request may exist, so the refusal says what
 * went wrong rather than reading as a bare policy violation. It also pins the
 * columns a student does not get to set — most of all `status`, since a request
 * that could be inserted as 'approved' would be no approval at all.
 */
create or replace function public.guard_reassignment_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  board  uuid;
  state  public.task_status;
  holder uuid;
  held   int;
begin
  board := public.task_board(new.task_id);
  if board is null then
    raise exception 'That task no longer exists';
  end if;

  -- A request is always pending, whoever writes it.
  new.status        := 'pending';
  new.to_student    := null;
  new.decided_by    := null;
  new.decided_at    := null;
  new.decision_note := '';

  if auth.uid() is null then
    return new; -- service role, and the test fixtures
  end if;

  new.requested_by := auth.uid();

  if not public.is_board_member(board) then
    raise exception 'Only this board can ask for its work to change hands'
      using errcode = 'check_violation';
  end if;

  if public.board_project_locked(board) then
    raise exception
      'This project is closed, so its work can no longer change hands. Ask your professor to reopen it.'
      using errcode = 'check_violation';
  end if;

  select status into state from public.project_tasks where id = new.task_id;
  if state = 'done' then
    raise exception 'That task is finished, so there is nothing to hand over'
      using errcode = 'check_violation';
  end if;

  -- An individual board has one owner and no one to hand anything to, so a
  -- request on one has no answer the professor could give.
  if exists (select 1 from public.project_boards b
              where b.id = board and b.student_id is not null) then
    raise exception 'This is an individual project, so its work cannot change hands'
      using errcode = 'check_violation';
  end if;

  -- Who holds it now. Shared work has several people on it, and naming one of
  -- them would be a guess, so it is left null and the whole task moves.
  select count(*) into held from public.task_assignees a where a.task_id = new.task_id;
  if held = 1 then
    select a.student_id into holder
      from public.task_assignees a where a.task_id = new.task_id;
  end if;
  new.from_student := case when held = 1 then holder else null end;

  if held = 0 and new.wants = 'release' then
    raise exception 'Nobody holds that task, so there is nothing to release'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists task_reassignments_guard on public.task_reassignments;
create trigger task_reassignments_guard before insert on public.task_reassignments
  for each row execute function public.guard_reassignment_request();

-- ---------------------------------------------------------------- notify

/** The professor has something to decide. Never carries the reason. */
create or replace function public.notify_reassignment_requested()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t    public.project_tasks%rowtype;
  proj public.projects%rowtype;
  prof uuid;
  who  text;
begin
  select * into t from public.project_tasks where id = new.task_id;
  select p.* into proj
    from public.projects p
    join public.project_boards b on b.project_id = p.id
   where b.id = t.board_id;
  select c.professor_id into prof from public.classes c where c.id = proj.class_id;
  if prof is null then return new; end if;

  select btrim(pr.first_name || ' ' || pr.last_name) into who
    from public.profiles pr where pr.id = new.requested_by;

  -- Deliberately not gated on notification_prefs. This is a decision somebody
  -- is waiting on, and a preference quietly swallowing it would strand them.
  insert into public.notifications
    (user_id, type, class_id, project_id, task_id, title, preview)
  values (prof, 'reassign_requested', proj.class_id, proj.id, t.id,
          t.title,
          coalesce(who, 'A student') || ' asked for this to change hands in ' || proj.title);
  return new;
end;
$$;

drop trigger if exists task_reassignments_notify on public.task_reassignments;
create trigger task_reassignments_notify after insert on public.task_reassignments
  for each row execute function public.notify_reassignment_requested();

-- ---------------------------------------------------------------- deciding

/**
 * The professor's answer, and the only thing that moves a claim.
 *
 * The move reuses the escape hatches that already exist for a member leaving a
 * group — `collabify.releasing` makes guard_task_unclaim stand down, and
 * `collabify.restoring` does the same for guard_task_assignee — rather than
 * weakening either guard for everybody. The second of those also skips the
 * fair-share cap, which is intended: this is a professor deciding, and refusing
 * their decision because the receiving student is near their share would be the
 * wrong answer.
 */
create or replace function public.decide_reassignment(
  p_request  uuid,
  p_approve  boolean,
  p_to_student uuid default null,
  p_note     text default ''
) returns public.task_reassignments
language plpgsql security definer set search_path = public as $$
declare
  req    public.task_reassignments%rowtype;
  board  uuid;
  target uuid;
  t      public.project_tasks%rowtype;
  proj   public.projects%rowtype;
  losers uuid[];
begin
  select * into req from public.task_reassignments where id = p_request for update;
  if req.id is null then
    raise exception 'That request no longer exists';
  end if;
  if req.status <> 'pending' then
    raise exception 'That request has already been decided';
  end if;

  board := public.task_board(req.task_id);

  if auth.uid() is not null and not public.is_board_professor(board) then
    raise exception 'Only the professor of this class decides reassignments'
      using errcode = 'insufficient_privilege';
  end if;

  select * into t from public.project_tasks where id = req.task_id;
  select p.* into proj
    from public.projects p
    join public.project_boards b on b.project_id = p.id
   where b.id = t.board_id;

  if not p_approve then
    update public.task_reassignments
       set status = 'declined',
           decided_by = auth.uid(),
           decided_at = now(),
           decision_note = coalesce(p_note, '')
     where id = p_request
    returning * into req;

    insert into public.notifications
      (user_id, type, class_id, project_id, task_id, title, preview)
    values (req.requested_by, 'reassign_decided', proj.class_id, proj.id, t.id,
            t.title, 'Your professor declined the reassignment in ' || proj.title);
    return req;
  end if;

  -- Who receives it: the professor's choice, else what was asked for. A release
  -- leaves it with nobody, which is the point of asking for one.
  target := coalesce(
    p_to_student,
    case when req.wants = 'take_over' then req.requested_by else null end
  );

  if target is not null and not exists (
    select 1 from public.project_boards b
     where b.id = board
       and (
         b.student_id = target
         or exists (
           select 1 from public.group_members m
            where m.group_id = b.group_id and m.student_id = target
         )
       )
  ) then
    raise exception 'That student is not on this board';
  end if;

  -- Remember who to tell before the rows go. Shared work has several holders,
  -- and all of them are losing it.
  select array_agg(a.student_id) into losers
    from public.task_assignees a
   where a.task_id = req.task_id
     and a.student_id is distinct from target
     and a.student_id <> req.requested_by;

  perform set_config('collabify.releasing', 'on', true);
  delete from public.task_assignees where task_id = req.task_id;
  perform set_config('collabify.releasing', '', true);

  if target is not null then
    perform set_config('collabify.restoring', 'on', true);
    insert into public.task_assignees (task_id, student_id, claimed_by)
    values (req.task_id, target, auth.uid())
    on conflict do nothing;
    perform set_config('collabify.restoring', '', true);
  end if;

  -- Whoever has it now has not started it. stamp_task_status clears started_at
  -- and the late stamp on the way out, so the slate is genuinely clean.
  update public.project_tasks
     set status = 'todo'
   where id = req.task_id and status <> 'todo';

  update public.task_reassignments
     set status = 'approved',
         to_student = target,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = coalesce(p_note, '')
   where id = p_request
  returning * into req;

  insert into public.notifications
    (user_id, type, class_id, project_id, task_id, title, preview)
  values (req.requested_by, 'reassign_decided', proj.class_id, proj.id, t.id,
          t.title, 'Your professor approved the reassignment in ' || proj.title);

  -- The people it came off hear that it moved, and nothing about why.
  insert into public.notifications
    (user_id, type, class_id, project_id, task_id, title, preview)
  select u, 'reassign_decided', proj.class_id, proj.id, t.id,
         t.title, 'Your professor moved this to someone else in ' || proj.title
    from unnest(coalesce(losers, '{}'::uuid[])) as u;

  return req;
end;
$$;

/** Called it off before it was answered. Only the person who asked. */
create or replace function public.withdraw_reassignment(p_request uuid)
returns public.task_reassignments
language plpgsql security definer set search_path = public as $$
declare
  req public.task_reassignments%rowtype;
begin
  select * into req from public.task_reassignments where id = p_request for update;
  if req.id is null then
    raise exception 'That request no longer exists';
  end if;
  if auth.uid() is not null and req.requested_by <> auth.uid() then
    raise exception 'Only the person who asked can withdraw it'
      using errcode = 'insufficient_privilege';
  end if;
  if req.status <> 'pending' then
    raise exception 'That request has already been decided';
  end if;

  update public.task_reassignments
     set status = 'withdrawn', decided_at = now()
   where id = p_request
  returning * into req;
  return req;
end;
$$;

-- ---------------------------------------------------------------- policies

alter table public.task_reassignments enable row level security;

/**
 * The reason names a person, so it is read by the professor who decides and the
 * student who wrote it, and by nobody else — the holder included. They are told
 * their task moved through the ordinary trail, which carries no reason.
 */
drop policy if exists task_reassignments_select on public.task_reassignments;
create policy task_reassignments_select on public.task_reassignments
  for select using (
    requested_by = auth.uid()
    or public.is_class_professor(public.board_class(public.task_board(task_id)))
  );

drop policy if exists task_reassignments_insert on public.task_reassignments;
create policy task_reassignments_insert on public.task_reassignments
  for insert with check (
    public.is_board_member(public.task_board(task_id))
  );

-- No update or delete policy on purpose. Status only ever changes through
-- decide_reassignment or withdraw_reassignment, which check who is asking;
-- an update policy wide enough to let a student withdraw would also be wide
-- enough to let them approve.

grant select, insert on public.task_reassignments to authenticated;
grant execute on function public.decide_reassignment(uuid, boolean, uuid, text) to authenticated;
grant execute on function public.withdraw_reassignment(uuid) to authenticated;

-- ---------------------------------------------------------------- view

/** A request with the names and the project around it, for both consoles. */
drop view if exists public.reassignment_overview;

create view public.reassignment_overview
with (security_invoker = true) as
select r.*,
       t.title       as task_title,
       t.status      as task_status,
       b.id          as board_id,
       b.group_id,
       g.name        as group_name,
       p.id          as project_id,
       p.title       as project_title,
       p.class_id,
       c.name        as class_name,
       c.initial     as class_initial,
       btrim(rq.first_name || ' ' || rq.last_name) as requested_by_name,
       rq.avatar_url as requested_by_avatar,
       btrim(fs.first_name || ' ' || fs.last_name) as from_student_name,
       btrim(ts.first_name || ' ' || ts.last_name) as to_student_name
  from public.task_reassignments r
  join public.project_tasks t   on t.id = r.task_id
  join public.project_boards b  on b.id = t.board_id
  join public.projects p        on p.id = b.project_id
  join public.classes c         on c.id = p.class_id
  left join public.groups g     on g.id = b.group_id
  join public.profiles rq       on rq.id = r.requested_by
  left join public.profiles fs  on fs.id = r.from_student
  left join public.profiles ts  on ts.id = r.to_student;

grant select on public.reassignment_overview to authenticated;

commit;
