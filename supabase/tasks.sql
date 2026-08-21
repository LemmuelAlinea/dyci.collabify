-- Collabify — tasks. The work inside a project, on a board owned by one group
-- (or by one student, for an individual project).
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/tasks.sql

begin;

-- ---------------------------------------------------------------- enums

do $$ begin
  create type public.task_status as enum ('todo', 'in_progress', 'done');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_author as enum ('professor', 'student');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_event_kind as enum (
    'created', 'edited', 'claimed', 'unclaimed', 'assigned',
    'started', 'finished', 'reopened'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.notification_type add value if not exists 'task_assigned';
exception when undefined_object then null; end $$;

commit;

-- New enum values cannot be used in the transaction that adds them.
begin;

-- ---------------------------------------------------------------- tables

-- One board per place work actually happens. A group project gives every group
-- its own; an individual project gives every student their own.
create table if not exists public.project_boards (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  group_id   uuid references public.groups (id) on delete cascade,
  student_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint project_boards_one_owner check (
    (group_id is null) <> (student_id is null)
  )
);

create unique index if not exists project_boards_group_key
  on public.project_boards (project_id, group_id) where group_id is not null;
create unique index if not exists project_boards_student_key
  on public.project_boards (project_id, student_id) where student_id is not null;
create index if not exists project_boards_project_idx
  on public.project_boards (project_id);

create table if not exists public.project_tasks (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.project_boards (id) on delete cascade,
  -- Ties together the copies of one professor task handed to several groups.
  origin_id    uuid,
  title        text not null,
  details      text not null default '',
  -- Relative, never a percentage. Batch 2 normalises a board to 100.
  weight       int not null default 1,
  status       public.task_status not null default 'todo',
  due_at       timestamptz,
  position     int not null default 1,
  created_by   uuid references public.profiles (id) on delete set null,
  author_role  public.task_author not null default 'student',
  ai_generated boolean not null default false,
  started_at   timestamptz,
  done_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint project_tasks_title_present check (length(btrim(title)) > 0),
  constraint project_tasks_weight_sane check (weight between 1 and 100)
);

create index if not exists project_tasks_board_idx
  on public.project_tasks (board_id, status, position);
create index if not exists project_tasks_origin_idx
  on public.project_tasks (origin_id) where origin_id is not null;

-- No row means unclaimed. Several rows mean the work is shared.
create table if not exists public.task_assignees (
  task_id    uuid not null references public.project_tasks (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  claimed_by uuid references public.profiles (id) on delete set null,
  claimed_at timestamptz not null default now(),
  primary key (task_id, student_id)
);

create index if not exists task_assignees_student_idx
  on public.task_assignees (student_id);

-- Nobody approves a task, so the trail is what makes the number reviewable.
create table if not exists public.task_events (
  id       uuid primary key default gen_random_uuid(),
  task_id  uuid not null references public.project_tasks (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  kind     public.task_event_kind not null,
  detail   text not null default '',
  at       timestamptz not null default now()
);

create index if not exists task_events_task_idx on public.task_events (task_id, at desc);

drop trigger if exists project_tasks_touch on public.project_tasks;
create trigger project_tasks_touch before update on public.project_tasks
  for each row execute function public.touch_updated_at();

alter table public.notifications
  add column if not exists task_id uuid references public.project_tasks (id) on delete cascade;

-- ---------------------------------------------------------------- helpers

/** The class a board belongs to. */
create or replace function public.board_class(p_board uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select p.class_id
    from public.project_boards b
    join public.projects p on p.id = b.project_id
   where b.id = p_board;
$$;

/** The professor of the class this board's project belongs to. */
create or replace function public.is_board_professor(p_board uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_boards b
      join public.projects p on p.id = b.project_id
      join public.classes c on c.id = p.class_id
     where b.id = p_board and c.professor_id = auth.uid()
  );
$$;

/** A student who works on this board: in its group, or its sole owner. */
create or replace function public.is_board_member(p_board uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_boards b
     where b.id = p_board
       and (
         b.student_id = auth.uid()
         or exists (
           select 1 from public.group_members m
            where m.group_id = b.group_id and m.student_id = auth.uid()
         )
       )
  );
$$;

/** Students only see a board once its project is live. */
create or replace function public.can_see_board(p_board uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_board_professor(p_board)
      or (
        public.is_board_member(p_board)
        and exists (
          select 1 from public.project_boards b
           where b.id = p_board and public.project_is_live(b.project_id)
        )
      );
$$;

create or replace function public.task_board(p_task uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select board_id from public.project_tasks where id = p_task;
$$;

-- ---------------------------------------------------------------- boards

/**
 * Every group in the project's set gets a board; an individual project gives
 * one to every active student on the roster. Called on release and whenever
 * somebody joins later, so a board is never missing.
 */
create or replace function public.ensure_project_boards(p_project uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  proj public.projects%rowtype;
begin
  select * into proj from public.projects where id = p_project;
  if not found then
    return;
  end if;

  if proj.audience = 'group' then
    insert into public.project_boards (project_id, group_id)
    select proj.id, g.id
      from public.groups g
     where g.set_id = proj.group_set_id
    on conflict do nothing;
  else
    insert into public.project_boards (project_id, student_id)
    select proj.id, m.student_id
      from public.class_members m
     where m.class_id = proj.class_id and m.status = 'active'
    on conflict do nothing;
  end if;
end;
$$;

create or replace function public.project_boards_on_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_project_boards(new.id);
  return new;
end;
$$;

drop trigger if exists projects_ensure_boards on public.projects;
create trigger projects_ensure_boards after insert or update on public.projects
  for each row execute function public.project_boards_on_project();

-- A student placed in a group after the project was set still needs a board.
create or replace function public.project_boards_on_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_boards (project_id, group_id)
  select p.id, new.id
    from public.projects p
   where p.group_set_id = new.set_id
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists groups_ensure_boards on public.groups;
create trigger groups_ensure_boards after insert on public.groups
  for each row execute function public.project_boards_on_group();

create or replace function public.project_boards_on_class_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'active' then
    return new;
  end if;
  insert into public.project_boards (project_id, student_id)
  select p.id, new.student_id
    from public.projects p
   where p.class_id = new.class_id and p.audience = 'individual'
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists class_members_ensure_boards on public.class_members;
create trigger class_members_ensure_boards after insert or update on public.class_members
  for each row execute function public.project_boards_on_class_member();

-- ---------------------------------------------------------------- task rules

/**
 * A task is open to the group while it is still To do. Starting it freezes the
 * wording, the weight, and the deadline — the professor stays exempt, because
 * the project is theirs.
 */
create or replace function public.guard_task_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  editable boolean;
begin
  if auth.uid() is null or public.is_board_professor(old.board_id) then
    -- Service role, or the professor: only the immutable columns are pinned.
    new.board_id   := old.board_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    return new;
  end if;

  if not public.is_board_member(old.board_id) then
    raise exception 'Only this board can change its tasks';
  end if;

  editable := old.status = 'todo';

  if not editable and (
       new.title    is distinct from old.title
    or new.details  is distinct from old.details
    or new.weight   is distinct from old.weight
    or new.due_at   is distinct from old.due_at
    or new.position is distinct from old.position
  ) then
    raise exception 'This task has already been started, so it can no longer be edited';
  end if;

  new.board_id    := old.board_id;
  new.origin_id   := old.origin_id;
  new.created_by  := old.created_by;
  new.author_role := old.author_role;
  new.created_at  := old.created_at;
  return new;
end;
$$;

drop trigger if exists project_tasks_guard_edit on public.project_tasks;
create trigger project_tasks_guard_edit before update on public.project_tasks
  for each row execute function public.guard_task_edit();

/** Keeps the timestamps honest without the client having to send them. */
create or replace function public.stamp_task_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  new.started_at := case
    when new.status = 'todo' then null
    when new.started_at is null then now()
    else new.started_at
  end;
  new.done_at := case when new.status = 'done' then now() else null end;
  return new;
end;
$$;

drop trigger if exists project_tasks_stamp_status on public.project_tasks;
create trigger project_tasks_stamp_status before insert or update on public.project_tasks
  for each row execute function public.stamp_task_status();

/** Records what happened, since nothing here is approved by anyone. */
create or replace function public.log_task_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, actor_id, kind)
    values (new.id, coalesce(auth.uid(), new.created_by), 'created');
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.task_events (task_id, actor_id, kind, detail)
    values (new.id, auth.uid(),
      (case
        when new.status = 'in_progress' then 'started'
        when new.status = 'done' then 'finished'
        else 'reopened'
      end)::public.task_event_kind,
      old.status::text || ' → ' || new.status::text);
  elsif new.title is distinct from old.title
     or new.details is distinct from old.details
     or new.weight is distinct from old.weight
     or new.due_at is distinct from old.due_at then
    insert into public.task_events (task_id, actor_id, kind)
    values (new.id, auth.uid(), 'edited');
  end if;
  return new;
end;
$$;

drop trigger if exists project_tasks_log on public.project_tasks;
create trigger project_tasks_log after insert or update on public.project_tasks
  for each row execute function public.log_task_event();

-- ---------------------------------------------------------------- assignees

/**
 * Claiming is the group's business. A professor writes the work and never says
 * who does it, so this refuses their insert outright.
 */
create or replace function public.guard_task_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  board uuid := public.task_board(new.task_id);
begin
  if auth.uid() is null then
    return new; -- service role / SQL console
  end if;

  if public.is_board_professor(board) and not public.is_board_member(board) then
    raise exception 'A professor does not assign tasks — the group claims them';
  end if;

  if not public.is_board_member(board) then
    raise exception 'Only this board can claim its tasks';
  end if;

  -- You can only put someone on a task who actually works on that board.
  if not exists (
    select 1 from public.project_boards b
     where b.id = board
       and (
         b.student_id = new.student_id
         or exists (
           select 1 from public.group_members m
            where m.group_id = b.group_id and m.student_id = new.student_id
         )
       )
  ) then
    raise exception 'That student is not on this board';
  end if;

  new.claimed_by := coalesce(new.claimed_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists task_assignees_guard on public.task_assignees;
create trigger task_assignees_guard before insert on public.task_assignees
  for each row execute function public.guard_task_assignee();

create or replace function public.log_task_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, actor_id, kind)
    values (new.task_id, coalesce(auth.uid(), new.claimed_by),
            (case when new.claimed_by = new.student_id then 'claimed' else 'assigned' end)
              ::public.task_event_kind);
    return new;
  end if;
  insert into public.task_events (task_id, actor_id, kind)
  values (old.task_id, auth.uid(), 'unclaimed');
  return old;
end;
$$;

drop trigger if exists task_assignees_log on public.task_assignees;
create trigger task_assignees_log after insert or delete on public.task_assignees
  for each row execute function public.log_task_assignee();

/** Tells someone the work is theirs, if they asked to hear about it. */
create or replace function public.notify_task_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t      public.project_tasks%rowtype;
  proj   public.projects%rowtype;
begin
  if new.claimed_by is not distinct from new.student_id then
    return new; -- claimed it themselves
  end if;

  select * into t from public.project_tasks where id = new.task_id;
  select p.* into proj
    from public.projects p
    join public.project_boards b on b.project_id = p.id
   where b.id = t.board_id;

  insert into public.notifications (user_id, type, class_id, project_id, task_id, title, preview)
  select new.student_id, 'task_assigned', proj.class_id, proj.id, t.id,
         t.title, 'Given to you in ' || proj.title
    from public.notification_prefs np
   where np.user_id = new.student_id and np.task_assignments;
  return new;
end;
$$;

drop trigger if exists task_assignees_notify on public.task_assignees;
create trigger task_assignees_notify after insert on public.task_assignees
  for each row execute function public.notify_task_assigned();

-- Leaving a group hands the work back rather than taking it with you.
create or replace function public.release_tasks_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.task_assignees a
   using public.project_tasks t, public.project_boards b
   where a.task_id = t.id
     and t.board_id = b.id
     and b.group_id = old.group_id
     and a.student_id = old.student_id;
  return old;
end;
$$;

drop trigger if exists group_members_release_tasks on public.group_members;
create trigger group_members_release_tasks after delete on public.group_members
  for each row execute function public.release_tasks_on_leave();

-- ---------------------------------------------------------------- fan-out

/**
 * A professor writes one task and hands it to a single group or to every group
 * in the set. Each board gets its own copy, so a group can edit theirs until
 * they start it. The copies share an origin so the professor sees one row.
 */
create or replace function public.create_professor_task(
  p_project uuid,
  p_title   text,
  p_details text default '',
  p_weight  int default 1,
  p_due_at  timestamptz default null,
  p_board   uuid default null,
  p_ai      boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  proj   public.projects%rowtype;
  origin uuid := gen_random_uuid();
  made   int;
begin
  select * into proj from public.projects where id = p_project;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if not public.is_class_professor(proj.class_id) then
    return jsonb_build_object('result', 'not_allowed');
  end if;
  if length(btrim(coalesce(p_title, ''))) = 0 then
    return jsonb_build_object('result', 'no_title');
  end if;

  perform public.ensure_project_boards(p_project);

  insert into public.project_tasks
    (board_id, origin_id, title, details, weight, due_at, position,
     created_by, author_role, ai_generated)
  select b.id, origin, btrim(p_title), coalesce(p_details, ''),
         greatest(1, least(100, coalesce(p_weight, 1))), p_due_at,
         coalesce((select max(t.position) + 1 from public.project_tasks t
                    where t.board_id = b.id), 1),
         auth.uid(), 'professor', coalesce(p_ai, false)
    from public.project_boards b
   where b.project_id = p_project
     and (p_board is null or b.id = p_board);

  get diagnostics made = row_count;
  return jsonb_build_object('result', 'created', 'origin_id', origin, 'boards', made);
end;
$$;

/**
 * Editing a handed-out task reaches only the copies still untouched. A group
 * that has started theirs keeps what they have, and the count says how many.
 */
create or replace function public.update_professor_task(
  p_origin  uuid,
  p_title   text,
  p_details text default '',
  p_weight  int default 1,
  p_due_at  timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cls     uuid;
  changed int;
  frozen  int;
begin
  select public.board_class(t.board_id) into cls
    from public.project_tasks t where t.origin_id = p_origin limit 1;
  if cls is null then
    return jsonb_build_object('result', 'not_found');
  end if;
  if not public.is_class_professor(cls) then
    return jsonb_build_object('result', 'not_allowed');
  end if;

  update public.project_tasks
     set title = btrim(p_title),
         details = coalesce(p_details, ''),
         weight = greatest(1, least(100, coalesce(p_weight, 1))),
         due_at = p_due_at
   where origin_id = p_origin and status = 'todo';
  get diagnostics changed = row_count;

  select count(*) into frozen
    from public.project_tasks where origin_id = p_origin and status <> 'todo';

  return jsonb_build_object('result', 'updated', 'changed', changed, 'frozen', frozen);
end;
$$;

/** Withdraws the copies nobody has started. Started work is left alone. */
create or replace function public.delete_professor_task(p_origin uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cls     uuid;
  removed int;
  frozen  int;
begin
  select public.board_class(t.board_id) into cls
    from public.project_tasks t where t.origin_id = p_origin limit 1;
  if cls is null then
    return jsonb_build_object('result', 'not_found');
  end if;
  if not public.is_class_professor(cls) then
    return jsonb_build_object('result', 'not_allowed');
  end if;

  delete from public.project_tasks where origin_id = p_origin and status = 'todo';
  get diagnostics removed = row_count;
  select count(*) into frozen
    from public.project_tasks where origin_id = p_origin;

  return jsonb_build_object('result', 'deleted', 'removed', removed, 'kept', frozen);
end;
$$;

-- ---------------------------------------------------------------- RLS

alter table public.project_boards enable row level security;
alter table public.project_tasks  enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_events    enable row level security;

drop policy if exists project_boards_select on public.project_boards;
create policy project_boards_select on public.project_boards
  for select using (public.can_see_board(id));

drop policy if exists project_boards_write on public.project_boards;
create policy project_boards_write on public.project_boards
  for all using (public.is_board_professor(id))
  with check (public.is_board_professor(id));

drop policy if exists project_tasks_select on public.project_tasks;
create policy project_tasks_select on public.project_tasks
  for select using (public.can_see_board(board_id));

drop policy if exists project_tasks_insert on public.project_tasks;
create policy project_tasks_insert on public.project_tasks
  for insert with check (
    public.is_board_professor(board_id)
    or (public.can_see_board(board_id) and public.is_board_member(board_id))
  );

drop policy if exists project_tasks_update on public.project_tasks;
create policy project_tasks_update on public.project_tasks
  for update using (
    public.is_board_professor(board_id)
    or (public.can_see_board(board_id) and public.is_board_member(board_id))
  );

-- Students may withdraw a task only while nobody has started it.
drop policy if exists project_tasks_delete on public.project_tasks;
create policy project_tasks_delete on public.project_tasks
  for delete using (
    public.is_board_professor(board_id)
    or (public.is_board_member(board_id) and status = 'todo')
  );

drop policy if exists task_assignees_select on public.task_assignees;
create policy task_assignees_select on public.task_assignees
  for select using (public.can_see_board(public.task_board(task_id)));

drop policy if exists task_assignees_write on public.task_assignees;
create policy task_assignees_write on public.task_assignees
  for all using (public.is_board_member(public.task_board(task_id)))
  with check (public.is_board_member(public.task_board(task_id)));

drop policy if exists task_events_select on public.task_events;
create policy task_events_select on public.task_events
  for select using (public.can_see_board(public.task_board(task_id)));

-- ---------------------------------------------------------------- views

/** A board with its counts. Batch 2 adds the weighted percentages. */
drop view if exists public.task_board_overview cascade;

create view public.task_board_overview
with (security_invoker = true) as
select b.id,
       b.project_id,
       b.group_id,
       b.student_id,
       p.class_id,
       p.title      as project_title,
       p.due_at     as project_due_at,
       g.name       as group_name,
       g.set_id     as group_set_id,
       (select count(*) from public.project_tasks t where t.board_id = b.id)::int
         as task_count,
       (select count(*) from public.project_tasks t
         where t.board_id = b.id and t.status = 'done')::int as done_count,
       (select count(*) from public.project_tasks t
         where t.board_id = b.id and t.status = 'in_progress')::int as doing_count,
       (select count(*) from public.project_tasks t
         where t.board_id = b.id
           and not exists (select 1 from public.task_assignees a where a.task_id = t.id)
       )::int as unclaimed_count,
       (select count(*) from public.group_members m where m.group_id = b.group_id)::int
         as member_count
  from public.project_boards b
  join public.projects p on p.id = b.project_id
  left join public.groups g on g.id = b.group_id;

grant select on public.task_board_overview to authenticated;

-- ---------------------------------------------------------------- realtime

alter table public.project_tasks  replica identity full;
alter table public.task_assignees replica identity full;
alter table public.project_boards replica identity full;

do $$ begin
  alter publication supabase_realtime add table public.project_tasks;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.task_assignees;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- backfill

-- Projects set before this migration have no boards yet.
do $$
declare
  p uuid;
begin
  for p in select id from public.projects loop
    perform public.ensure_project_boards(p);
  end loop;
end $$;

commit;
