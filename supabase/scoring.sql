-- Collabify — rubric scores: the professor marks each board, confirms each student, releases.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/scoring.sql
-- Requires: projects.sql, tasks.sql (project_boards, is_board_member), one-workplace.sql
-- (is_project_professor / is_board_professor with co-teachers), peer-evaluation.sql.
-- Re-run supabase/anon-lockdown.sql afterwards.

/**
 * Collabify used to keep no grade at all (see results.sql). The professors asked
 * for one: a group project is marked against its rubric, and a group mark hides
 * who did the work. So grades now live here, on three rules:
 *
 *   - The rubric is the basis. A board gets points per criterion, nothing else.
 *   - The professor decides each student's score. Collabify suggests one from
 *     the group score and the final peer round (suggest_score), and the
 *     professor confirms or changes it. Nothing here grades on its own.
 *   - Students see nothing until the professor releases the project, and then
 *     only their own score and their own board's breakdown.
 *
 * Once anything is scored, the rubric's points and criteria lock (wording stays
 * editable), so a score never ends up pointing at a criterion that changed under
 * it. Clearing the scores is the deliberate, recorded way to unlock it.
 */

begin;
do $$ begin
  alter type public.notification_type add value if not exists 'grades_released';
exception when undefined_object then null; end $$;
commit;

begin;

create table if not exists public.board_scores (
  board_id     uuid not null references public.project_boards (id) on delete cascade,
  -- Cascade, not restrict: the lock trigger already refuses deleting a scored
  -- criterion, and restrict would block deleting a scored project outright.
  criterion_id uuid not null references public.project_criteria (id) on delete cascade,
  points       numeric(6,1) not null,
  scored_by    uuid references public.profiles (id) on delete set null,
  scored_at    timestamptz not null default clock_timestamp(),
  primary key (board_id, criterion_id),
  constraint board_scores_points_min check (points >= 0),
  constraint board_scores_half_steps check (points * 2 = trunc(points * 2))
);

create index if not exists board_scores_by_criterion on public.board_scores (criterion_id);

create table if not exists public.member_scores (
  board_id     uuid not null references public.project_boards (id) on delete cascade,
  student_id   uuid not null references public.profiles (id) on delete cascade,
  suggested    numeric(6,1) not null,
  final        numeric(6,1) not null,
  overridden   boolean not null,
  -- The factor the suggestion used when it was confirmed, for the record.
  factor       numeric(5,3),
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz not null default clock_timestamp(),
  primary key (board_id, student_id),
  constraint member_scores_final_min check (final >= 0),
  constraint member_scores_final_half check (final * 2 = trunc(final * 2))
);

create index if not exists member_scores_by_student on public.member_scores (student_id);

create table if not exists public.score_releases (
  project_id  uuid primary key references public.projects (id) on delete cascade,
  released_at timestamptz not null default clock_timestamp(),
  released_by uuid references public.profiles (id) on delete set null
);

create table if not exists public.score_history (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  board_id     uuid references public.project_boards (id) on delete set null,
  student_id   uuid references public.profiles (id) on delete set null,
  criterion_id uuid references public.project_criteria (id) on delete set null,
  action       text not null,
  old_value    numeric(6,1),
  new_value    numeric(6,1),
  by_user      uuid references public.profiles (id) on delete set null default auth.uid(),
  at           timestamptz not null default clock_timestamp(),
  constraint score_history_action
    check (action in ('criterion', 'confirm', 'release', 'unrelease', 'clear'))
);

create index if not exists score_history_by_project on public.score_history (project_id, at desc);

-- ---------------------------------------------------------------- helpers

create or replace function public.score_board_project(p_board uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.project_boards where id = p_board;
$$;

/** Whether any board on the project has a score. No caller check: the triggers use it. */
create or replace function public.scores_exist(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.board_scores s
      join public.project_boards b on b.id = s.board_id
     where b.project_id = p_project
  );
$$;

/** The same question for the page, answered only for the project's teaching staff. */
create or replace function public.project_has_scores(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_project_professor(p_project) and public.scores_exist(p_project);
$$;

create or replace function public.project_scores_released(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.score_releases where project_id = p_project);
$$;

-- ---------------------------------------------------------------- triggers

/** A score fits its criterion: on this project's rubric, and no more than it is worth. */
create or replace function public.guard_board_score()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_max int;
begin
  select c.max_points into v_max
    from public.project_criteria c
    join public.project_boards b on b.project_id = c.project_id
   where c.id = new.criterion_id and b.id = new.board_id;
  if v_max is null then
    raise exception 'That criterion is not on this project''s rubric'
      using errcode = 'check_violation';
  end if;
  if new.points > v_max then
    raise exception 'A score cannot be more than its criterion is worth (%)', v_max
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists board_scores_guard on public.board_scores;
create trigger board_scores_guard
  before insert or update on public.board_scores
  for each row execute function public.guard_board_score();

/**
 * Points, criteria and order lock while scores exist; wording does not. A project
 * being deleted takes its criteria and scores with it, so that is let through.
 */
create or replace function public.guard_scored_criteria()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project uuid := coalesce(new.project_id, old.project_id);
begin
  if not exists (select 1 from public.projects where id = v_project) then
    return coalesce(new, old);
  end if;
  if not public.scores_exist(v_project) then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE'
     and new.project_id = old.project_id
     and new.max_points = old.max_points
     and new.position = old.position then
    return new;
  end if;
  raise exception 'Scores exist for this project. Clear them before changing points or criteria.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists project_criteria_score_lock on public.project_criteria;
create trigger project_criteria_score_lock
  before insert or update or delete on public.project_criteria
  for each row execute function public.guard_scored_criteria();

create or replace function public.guard_scored_total()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.total_points is distinct from old.total_points and public.scores_exist(new.id) then
    raise exception 'Scores exist for this project. Clear them before changing points or criteria.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_score_total_lock on public.projects;
create trigger projects_score_total_lock
  before update of total_points on public.projects
  for each row execute function public.guard_scored_total();

-- History. Deletes are not logged row by row: clear_project_scores writes one
-- 'clear' entry, and a board or project going away takes its history's subject
-- with it.

create or replace function public.log_board_score()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.points = old.points then
    return null;
  end if;
  insert into public.score_history (project_id, board_id, criterion_id, action, old_value, new_value)
  select b.project_id, new.board_id, new.criterion_id, 'criterion',
         case when tg_op = 'UPDATE' then old.points end, new.points
    from public.project_boards b
   where b.id = new.board_id;
  return null;
end;
$$;

drop trigger if exists board_scores_history on public.board_scores;
create trigger board_scores_history
  after insert or update on public.board_scores
  for each row execute function public.log_board_score();

create or replace function public.log_member_score()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.final = old.final then
    return null;
  end if;
  insert into public.score_history (project_id, board_id, student_id, action, old_value, new_value)
  select b.project_id, new.board_id, new.student_id, 'confirm',
         case when tg_op = 'UPDATE' then old.final end, new.final
    from public.project_boards b
   where b.id = new.board_id;
  return null;
end;
$$;

drop trigger if exists member_scores_history on public.member_scores;
create trigger member_scores_history
  after insert or update on public.member_scores
  for each row execute function public.log_member_score();

create or replace function public.log_score_release()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.score_history (project_id, action) values (new.project_id, 'release');
  elsif exists (select 1 from public.projects where id = old.project_id) then
    insert into public.score_history (project_id, action) values (old.project_id, 'unrelease');
  end if;
  return null;
end;
$$;

drop trigger if exists score_releases_history on public.score_releases;
create trigger score_releases_history
  after insert or delete on public.score_releases
  for each row execute function public.log_score_release();

-- ---------------------------------------------------------------- policies

alter table public.board_scores enable row level security;
alter table public.member_scores enable row level security;
alter table public.score_releases enable row level security;
alter table public.score_history enable row level security;

-- Teaching staff always; a member of the board once the project is released.
drop policy if exists board_scores_select on public.board_scores;
create policy board_scores_select on public.board_scores
  for select using (
    public.is_board_professor(board_id)
    or (public.is_board_member(board_id)
        and public.project_scores_released(public.score_board_project(board_id)))
  );

-- Teaching staff always; the student, for their own row, once released.
drop policy if exists member_scores_select on public.member_scores;
create policy member_scores_select on public.member_scores
  for select using (
    public.is_board_professor(board_id)
    or (student_id = auth.uid()
        and public.project_scores_released(public.score_board_project(board_id)))
  );

-- Whoever can see the project (the projects policy decides that).
drop policy if exists score_releases_select on public.score_releases;
create policy score_releases_select on public.score_releases
  for select using (exists (select 1 from public.projects p where p.id = project_id));

drop policy if exists score_history_select on public.score_history;
create policy score_history_select on public.score_history
  for select using (public.is_project_professor(project_id));

-- Anon gets nothing here, inline, so a rebuild that runs this file after
-- anon-lockdown.sql stays locked down.
revoke all on public.board_scores, public.member_scores, public.score_releases,
              public.score_history from anon;
grant select on public.board_scores, public.member_scores, public.score_releases,
                public.score_history to authenticated;

revoke all on function public.score_board_project(uuid) from public, anon;
revoke all on function public.scores_exist(uuid) from public, anon, authenticated;
revoke all on function public.project_has_scores(uuid) from public, anon;
revoke all on function public.project_scores_released(uuid) from public, anon;

-- The policies above call these as the reader, so the reader needs them.
grant execute on function public.score_board_project(uuid) to authenticated;
grant execute on function public.project_scores_released(uuid) to authenticated;
grant execute on function public.project_has_scores(uuid) to authenticated;

-- ---------------------------------------------------------------- realtime

-- Listed here, not in live.sql: live.sql runs earlier in a rebuild, before these
-- tables exist.
do $$
declare
  t text;
begin
  foreach t in array array['board_scores', 'member_scores', 'score_releases'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;   -- no realtime publication on this database
    end;
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

commit;
