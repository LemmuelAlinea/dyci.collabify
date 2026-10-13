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

-- ---------------------------------------------------------------- the rule

/**
 * The suggested score. Same rule as suggestScore in src/lib/scoreMath.ts, tested
 * on both sides with the same hand values. 1.05 is FACTOR_CAP in peerMath.ts.
 * Never above the project total, with or without a factor.
 */
create or replace function public.suggest_score(p_group numeric, p_factor numeric, p_max int)
returns numeric language sql immutable set search_path = public as $$
  select case
    when p_group is null then null
    when p_factor is null then least(p_group, p_max::numeric)
    else least(p_max::numeric, round(p_group * least(round(p_factor, 3), 1.05) * 2) / 2)
  end;
$$;

/**
 * Each current member's factor from the project's final round, once that round
 * has stopped taking answers: their average from teammates ÷ the team's mean of
 * the same, counting only members with at least 2 raters (PEER_MIN_RATERS), as
 * analyseTeam in src/lib/peerMath.ts does.
 *
 * Reads peer_results, so only teaching staff get rows. The body is a string, so
 * no dependency is recorded and peer-evaluation.sql can still drop and recreate
 * that view.
 */
create or replace function public.peer_final_factors(p_project uuid)
returns table (board_id uuid, student_id uuid, factor numeric, raters int)
language sql stable set search_path = public as $$
  with fin as (
    select r.id
      from public.peer_rounds r
     where r.project_id = p_project
       and r.kind = 'final'
       and not (r.closed_at is null
                and clock_timestamp() >= r.opens_at
                and clock_timestamp() < r.closes_at)
  ),
  res as (
    select pr.board_id as bid, pr.student_id as sid, pr.received_avg, pr.raters as n
      from public.peer_results pr
     where pr.project_id = p_project
       and pr.round_id in (select fin.id from fin)
  ),
  team as (
    select res.bid, avg(res.received_avg) as mean
      from res
     where res.n >= 2 and res.received_avg is not null
     group by res.bid
  )
  select res.bid, res.sid,
         case when res.n >= 2 and res.received_avg is not null and team.mean > 0
              then round(res.received_avg / team.mean, 3) end,
         res.n
    from res
    left join team on team.bid = res.bid;
$$;

/** Throws unless the caller teaches the project and it is not archived. */
create or replace function public.score_guard(p_project uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'That project no longer exists';
  end if;
  if not public.is_project_professor(p_project) then
    raise exception 'Only someone teaching this class can score this project'
      using errcode = 'insufficient_privilege';
  end if;
  if public.peer_project_archived(p_project) then
    raise exception 'That project is archived. Restore it to change its scores'
      using errcode = 'check_violation';
  end if;
end;
$$;

/**
 * Is this student still on this board: its own student, or a member of its group
 * (not archived)? A confirmed row outlives a move to another group, so reads and
 * notifications go through this instead of trusting member_scores alone.
 * Only security-definer functions call it.
 */
create or replace function public.score_member_current(p_board uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.project_boards b
     where b.id = p_board
       and (b.student_id = p_student
            or exists (select 1
                         from public.groups g
                         join public.group_members gm on gm.group_id = g.id
                        where g.id = b.group_id and g.archived_at is null
                          and gm.student_id = p_student))
  );
$$;

-- ---------------------------------------------------------------- reading

/**
 * One row per board and person: the board's current group members, or an
 * individual board's student. Teaching staff only. suggested_now is today's
 * suggestion; suggestion_changed marks a confirmed score whose stored
 * suggestion no longer matches it.
 */
create or replace function public.score_sheet(p_project uuid)
returns table (
  board_id uuid, student_id uuid, student_name text, in_group boolean,
  group_total numeric, scored int, criteria int, total_points int,
  factor numeric, raters int, suggested_now numeric,
  suggested_saved numeric, final numeric, overridden boolean, factor_saved numeric,
  confirmed_at timestamptz, suggestion_changed boolean, released boolean
)
language sql stable set search_path = public as $$
  with people as (
    select b.id as bid, gm.student_id as sid, true as grp
      from public.project_boards b
      join public.groups g on g.id = b.group_id and g.archived_at is null
      join public.group_members gm on gm.group_id = b.group_id
     where b.project_id = p_project
    union all
    select b.id, b.student_id, false
      from public.project_boards b
     where b.project_id = p_project and b.student_id is not null
  ),
  totals as (
    select s.board_id as bid, sum(s.points) as total, count(*)::int as n
      from public.board_scores s
      join public.project_boards b on b.id = s.board_id
     where b.project_id = p_project
     group by s.board_id
  ),
  facs as (
    select f.board_id as bid, f.student_id as sid, f.factor as fac, f.raters as n
      from public.peer_final_factors(p_project) f
  ),
  base as (
    select pe.bid, pe.sid, pe.grp, t.total, coalesce(t.n, 0) as n,
           case when pe.grp then fx.fac end as fac,
           coalesce(fx.n, 0) as raters
      from people pe
      left join totals t on t.bid = pe.bid
      left join facs fx on fx.bid = pe.bid and fx.sid = pe.sid
  )
  select x.bid, x.sid,
         btrim(coalesce(pf.first_name, '') || ' ' || coalesce(pf.last_name, '')),
         x.grp, x.total, x.n,
         (select count(*)::int from public.project_criteria c where c.project_id = p_project),
         p.total_points, x.fac, x.raters,
         public.suggest_score(x.total, x.fac, p.total_points),
         ms.suggested, ms.final, ms.overridden, ms.factor, ms.confirmed_at,
         (ms.board_id is not null
          and ms.suggested is distinct from public.suggest_score(x.total, x.fac, p.total_points)),
         exists (select 1 from public.score_releases r where r.project_id = p_project)
    from base x
    join public.projects p on p.id = p_project
    join public.profiles pf on pf.id = x.sid
    left join public.member_scores ms on ms.board_id = x.bid and ms.student_id = x.sid
   where public.is_project_professor(p_project)
   order by x.bid, 3;
$$;

-- ---------------------------------------------------------------- writing

create or replace function public.save_board_scores(p_board uuid, p_points jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_project uuid := public.score_board_project(p_board);
  v_el      jsonb;
  v_need    uuid[];
  v_got     uuid[];
  saved     integer;
begin
  if v_project is null then
    raise exception 'That board no longer exists';
  end if;
  perform public.score_guard(v_project);

  if p_points is null or jsonb_typeof(p_points) <> 'array' then
    raise exception 'Send the scores as a list'
      using errcode = 'check_violation';
  end if;
  for v_el in select value from jsonb_array_elements(p_points) loop
    if jsonb_typeof(v_el) <> 'object'
       or jsonb_typeof(v_el -> 'criterion_id') is distinct from 'string'
       or (v_el ->> 'criterion_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_el -> 'points') is distinct from 'number' then
      raise exception 'Each score needs its criterion and a number of points'
        using errcode = 'check_violation';
    end if;
    -- Checked on the raw number: numeric(6,1) would round 50.04 to 50.0 first.
    if (v_el ->> 'points')::numeric < 0
       or (v_el ->> 'points')::numeric * 2 <> trunc((v_el ->> 'points')::numeric * 2) then
      raise exception 'Scores go in whole or half points, from zero up'
        using errcode = 'check_violation';
    end if;
  end loop;

  select array_agg(c.id order by c.id) into v_need
    from public.project_criteria c where c.project_id = v_project;
  if v_need is null then
    raise exception 'This project has no rubric yet. Add criteria before scoring'
      using errcode = 'check_violation';
  end if;
  select array_agg((e ->> 'criterion_id')::uuid order by (e ->> 'criterion_id')::uuid) into v_got
    from jsonb_array_elements(p_points) e;
  if v_got is distinct from v_need then
    raise exception 'Score every criterion on the rubric, once each'
      using errcode = 'check_violation';
  end if;

  insert into public.board_scores (board_id, criterion_id, points, scored_by)
  select p_board, (e ->> 'criterion_id')::uuid, (e ->> 'points')::numeric, auth.uid()
    from jsonb_array_elements(p_points) e
  on conflict (board_id, criterion_id) do update
     set points    = excluded.points,
         scored_by = excluded.scored_by,
         scored_at = clock_timestamp()
   where public.board_scores.points is distinct from excluded.points;

  get diagnostics saved = row_count;
  return saved;
end;
$$;

/**
 * Confirm each student's score on a board. The suggestion and factor are worked
 * out here, not taken from the page, so a stale page cannot store a wrong one.
 * A group board needs exactly its current members; an individual board's one
 * student gets the board total.
 */
create or replace function public.confirm_member_scores(p_board uuid, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  b         public.project_boards%rowtype;
  v_total   int;
  v_criteria int;
  v_scored  int;
  v_group   numeric;
  v_team    uuid[];
  v_given   uuid[];
  v_el      jsonb;
  v_final   numeric;
  saved     integer;
begin
  select * into b from public.project_boards where id = p_board;
  if b.id is null then
    raise exception 'That board no longer exists';
  end if;
  perform public.score_guard(b.project_id);

  select p.total_points into v_total from public.projects p where p.id = b.project_id;
  select count(*)::int into v_criteria from public.project_criteria where project_id = b.project_id;
  select count(*)::int, sum(points) into v_scored, v_group
    from public.board_scores where board_id = p_board;
  if v_criteria = 0 or v_scored < v_criteria then
    raise exception 'Score every criterion before confirming'
      using errcode = 'check_violation';
  end if;

  if b.student_id is not null then
    insert into public.member_scores
      (board_id, student_id, suggested, final, overridden, factor, confirmed_by, confirmed_at)
    values (p_board, b.student_id, public.suggest_score(v_group, null, v_total),
            public.suggest_score(v_group, null, v_total), false, null, auth.uid(), clock_timestamp())
    on conflict (board_id, student_id) do update
       set suggested    = excluded.suggested,
           final        = excluded.final,
           overridden   = false,
           factor       = null,
           confirmed_by = excluded.confirmed_by,
           confirmed_at = excluded.confirmed_at;
    return 1;
  end if;

  select array_agg(gm.student_id order by gm.student_id) into v_team
    from public.groups g
    join public.group_members gm on gm.group_id = g.id
   where g.id = b.group_id and g.archived_at is null;
  if v_team is null then
    raise exception 'This group has nobody in it to score'
      using errcode = 'check_violation';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Send the scores as a list'
      using errcode = 'check_violation';
  end if;
  for v_el in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_el) <> 'object'
       or jsonb_typeof(v_el -> 'student_id') is distinct from 'string'
       or (v_el ->> 'student_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_el -> 'final') is distinct from 'number' then
      raise exception 'Each score needs its student and a number of points'
        using errcode = 'check_violation';
    end if;
    v_final := (v_el ->> 'final')::numeric;
    if v_final < 0 or v_final > v_total or v_final * 2 <> trunc(v_final * 2) then
      raise exception 'Each score goes in whole or half points, from 0 to %', v_total
        using errcode = 'check_violation';
    end if;
  end loop;
  select array_agg((e ->> 'student_id')::uuid order by (e ->> 'student_id')::uuid) into v_given
    from jsonb_array_elements(p_rows) e;
  if v_given is distinct from v_team then
    raise exception 'Confirm a score for everyone in the group, once each. Reload if somebody joined or left.'
      using errcode = 'check_violation';
  end if;

  -- Somebody who left the group since an earlier confirm has no score here now.
  delete from public.member_scores where board_id = p_board and student_id <> all (v_team);

  insert into public.member_scores
    (board_id, student_id, suggested, final, overridden, factor, confirmed_by, confirmed_at)
  select p_board, (e ->> 'student_id')::uuid,
         public.suggest_score(v_group, f.factor, v_total),
         (e ->> 'final')::numeric,
         (e ->> 'final')::numeric <> public.suggest_score(v_group, f.factor, v_total),
         f.factor, auth.uid(), clock_timestamp()
    from jsonb_array_elements(p_rows) e
    left join public.peer_final_factors(b.project_id) f
      on f.board_id = p_board and f.student_id = (e ->> 'student_id')::uuid
  on conflict (board_id, student_id) do update
     set suggested    = excluded.suggested,
         final        = excluded.final,
         overridden   = excluded.overridden,
         factor       = excluded.factor,
         confirmed_by = excluded.confirmed_by,
         confirmed_at = excluded.confirmed_at;

  get diagnostics saved = row_count;
  return saved;
end;
$$;

/** Show students their confirmed scores. Returns how many were notified. */
create or replace function public.release_project_scores(p_project uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  proj public.projects%rowtype;
  sent integer;
begin
  perform public.score_guard(p_project);
  -- Locked so two releases take turns and only one notifies.
  select * into proj from public.projects where id = p_project for update;
  if not exists (
    select 1 from public.member_scores ms
      join public.project_boards b on b.id = ms.board_id
     where b.project_id = p_project
  ) then
    raise exception 'Confirm at least one score before releasing grades'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.score_releases where project_id = p_project) then
    return 0;
  end if;

  insert into public.score_releases (project_id, released_by) values (p_project, auth.uid());

  insert into public.notifications (user_id, type, class_id, project_id, group_id, title, preview)
  select ms.student_id, 'grades_released', proj.class_id, proj.id, b.group_id, proj.title,
         'Your grade for this project is ready'
    from public.member_scores ms
    join public.project_boards b on b.id = ms.board_id
    join public.notification_prefs np on np.user_id = ms.student_id
   where b.project_id = p_project
     and np.announcements
     and public.score_member_current(ms.board_id, ms.student_id);

  get diagnostics sent = row_count;
  return sent;
end;
$$;

/** Hide grades again. Sends nothing. */
create or replace function public.unrelease_project_scores(p_project uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.score_guard(p_project);
  delete from public.score_releases where project_id = p_project;
end;
$$;

/**
 * Delete every score and confirm on the project, and its release, so the rubric
 * unlocks. The history keeps everything and records the clear.
 */
create or replace function public.clear_project_scores(p_project uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  perform public.score_guard(p_project);
  perform 1 from public.projects where id = p_project for update;
  delete from public.score_releases where project_id = p_project;
  delete from public.member_scores ms
   using public.project_boards b
   where b.id = ms.board_id and b.project_id = p_project;
  delete from public.board_scores s
   using public.project_boards b
   where b.id = s.board_id and b.project_id = p_project;
  get diagnostics n = row_count;
  insert into public.score_history (project_id, action) values (p_project, 'clear');
  return n;
end;
$$;

-- ---------------------------------------------------------------- the student

/**
 * How the caller's teammates rated them in the final round, next to the team's
 * average, once grades are released. Null with fewer than 2 raters
 * (PEER_MIN_RATERS) or no closed final round. Never says who gave what.
 * Read straight from peer_ratings: peer_results is for teaching staff only.
 */
create or replace function public.my_peer_summary(p_project uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select b.id as bid
      from public.project_boards b
      join public.groups g on g.id = b.group_id and g.archived_at is null
      join public.group_members gm on gm.group_id = b.group_id and gm.student_id = auth.uid()
     where b.project_id = p_project
     limit 1
  ),
  fin as (
    select r.id
      from public.peer_rounds r
     where r.project_id = p_project
       and r.kind = 'final'
       and not (r.closed_at is null
                and clock_timestamp() >= r.opens_at
                and clock_timestamp() < r.closes_at)
  ),
  members as (
    select gm.student_id as sid
      from public.project_boards b
      join public.group_members gm on gm.group_id = b.group_id
     where b.id = (select mine.bid from mine)
  ),
  rt as (
    select pr.ratee_id, pr.contributes, pr.interacts, pr.on_track, pr.quality, pr.skills
      from public.peer_ratings pr
     where pr.round_id in (select fin.id from fin)
       and pr.board_id = (select mine.bid from mine)
       and pr.rater_id <> pr.ratee_id
       and pr.rater_id in (select members.sid from members)
       and pr.ratee_id in (select members.sid from members)
  ),
  me as (
    select count(*)::int as raters,
           round(avg(rt.contributes), 2) as contributes, round(avg(rt.interacts), 2) as interacts,
           round(avg(rt.on_track), 2) as on_track, round(avg(rt.quality), 2) as quality,
           round(avg(rt.skills), 2) as skills
      from rt where rt.ratee_id = auth.uid()
  ),
  team as (
    select round(avg(rt.contributes), 2) as contributes, round(avg(rt.interacts), 2) as interacts,
           round(avg(rt.on_track), 2) as on_track, round(avg(rt.quality), 2) as quality,
           round(avg(rt.skills), 2) as skills
      from rt
  )
  select case
           when public.project_scores_released(p_project) and me.raters >= 2 then
             jsonb_build_object(
               'raters', me.raters,
               'me', jsonb_build_object('contributes', me.contributes, 'interacts', me.interacts,
                                        'on_track', me.on_track, 'quality', me.quality,
                                        'skills', me.skills),
               'team', jsonb_build_object('contributes', team.contributes, 'interacts', team.interacts,
                                          'on_track', team.on_track, 'quality', team.quality,
                                          'skills', team.skills))
         end
    from me cross join team;
$$;

/** The caller's released grade on a project, or null before release or with none. */
create or replace function public.my_grade(p_project uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'final', ms.final,
           'group_total', (select sum(s.points) from public.board_scores s where s.board_id = ms.board_id),
           'total_points', p.total_points,
           'in_group', b.group_id is not null,
           'released_at', r.released_at,
           'criteria', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'label', c.label, 'description', c.description,
                      'max_points', c.max_points, 'points', s.points)
                    order by c.position), '[]'::jsonb)
               from public.project_criteria c
               left join public.board_scores s on s.criterion_id = c.id and s.board_id = ms.board_id
              where c.project_id = p_project),
           'peer', public.my_peer_summary(p_project))
    from public.member_scores ms
    join public.project_boards b on b.id = ms.board_id and b.project_id = p_project
    join public.projects p on p.id = p_project
    join public.score_releases r on r.project_id = p_project
   where ms.student_id = auth.uid()
     and public.score_member_current(ms.board_id, ms.student_id)
     and public.project_is_live(p_project)
   limit 1;
$$;

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

-- ---------------------------------------------------------------- grants

revoke all on function public.suggest_score(numeric, numeric, int) from public, anon;
revoke all on function public.peer_final_factors(uuid) from public, anon;
revoke all on function public.score_guard(uuid) from public, anon, authenticated;
revoke all on function public.score_member_current(uuid, uuid) from public, anon, authenticated;
revoke all on function public.score_sheet(uuid) from public, anon;
revoke all on function public.save_board_scores(uuid, jsonb) from public, anon;
revoke all on function public.confirm_member_scores(uuid, jsonb) from public, anon;
revoke all on function public.release_project_scores(uuid) from public, anon;
revoke all on function public.unrelease_project_scores(uuid) from public, anon;
revoke all on function public.clear_project_scores(uuid) from public, anon;
revoke all on function public.my_peer_summary(uuid) from public, anon;
revoke all on function public.my_grade(uuid) from public, anon;

grant execute on function public.suggest_score(numeric, numeric, int) to authenticated;
grant execute on function public.peer_final_factors(uuid) to authenticated;
grant execute on function public.score_sheet(uuid) to authenticated;
grant execute on function public.save_board_scores(uuid, jsonb) to authenticated;
grant execute on function public.confirm_member_scores(uuid, jsonb) to authenticated;
grant execute on function public.release_project_scores(uuid) to authenticated;
grant execute on function public.unrelease_project_scores(uuid) to authenticated;
grant execute on function public.clear_project_scores(uuid) to authenticated;
grant execute on function public.my_peer_summary(uuid) to authenticated;
grant execute on function public.my_grade(uuid) to authenticated;

commit;
