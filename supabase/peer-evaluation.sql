-- Collabify — peer evaluation: students rate their teammates, the professor reads it.
-- Idempotent: safe to run repeatedly.
-- Run with:  node scripts/db.mjs supabase/peer-evaluation.sql
-- Requires: schema.sql (notification_prefs), classes.sql, groups.sql, projects.sql,
-- tasks.sql (project_boards), one-workplace.sql (is_project_professor with co-teachers).
-- Re-run supabase/anon-lockdown.sql afterwards.

/**
 * A group grade hides who did the work, and task counts are a weak proxy for it.
 * The people who know are the teammates. They rate one another on five behaviours
 * (CATME's dimensions), the professor reads the pattern, and nothing here decides
 * a grade on its own — Phase C2 suggests, the professor confirms.
 *
 * Ratings are private in one direction only: the rater and the class's teaching
 * staff see them. The person rated never does, which is the condition for an
 * honest answer.
 *
 * Teammates are the board's *current* group members. Somebody who left drops out
 * of every average, as rater and as ratee, so a departure cannot skew the rest.
 */

begin;
do $$ begin
  alter type public.notification_type add value if not exists 'peer_round_opened';
  alter type public.notification_type add value if not exists 'peer_round_reminder';
exception when undefined_object then null; end $$;
commit;

begin;

do $$ begin
  create type public.peer_round_kind as enum ('check_in', 'final');
exception when duplicate_object then null; end $$;

create table if not exists public.peer_rounds (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind       public.peer_round_kind not null,
  opens_at   timestamptz not null default clock_timestamp(),
  closes_at  timestamptz not null,
  closed_at  timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint peer_rounds_window check (closes_at > opens_at)
);

-- One final round per project. "Open" depends on the clock, so one-open-at-a-time
-- is enforced in open_peer_round, not by an index.
create unique index if not exists peer_rounds_one_final
  on public.peer_rounds (project_id) where kind = 'final';
create index if not exists peer_rounds_by_project
  on public.peer_rounds (project_id, opens_at desc);

create table if not exists public.peer_ratings (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.peer_rounds (id) on delete cascade,
  board_id    uuid not null references public.project_boards (id) on delete cascade,
  rater_id    uuid not null references public.profiles (id) on delete cascade,
  ratee_id    uuid not null references public.profiles (id) on delete cascade,
  contributes smallint not null check (contributes between 1 and 5),
  interacts   smallint not null check (interacts between 1 and 5),
  on_track    smallint not null check (on_track between 1 and 5),
  quality     smallint not null check (quality between 1 and 5),
  skills      smallint not null check (skills between 1 and 5),
  comment     text not null default '',
  updated_at  timestamptz not null default clock_timestamp(),
  constraint peer_ratings_comment_len check (char_length(comment) <= 1000),
  constraint peer_ratings_once unique (round_id, rater_id, ratee_id)
);

create index if not exists peer_ratings_by_round
  on public.peer_ratings (round_id, board_id);

-- ---------------------------------------------------------------- helpers

create or replace function public.peer_round_project(p_round uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select project_id from public.peer_rounds where id = p_round;
$$;

create or replace function public.peer_round_open(p_round uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.peer_rounds r
     where r.id = p_round
       and r.closed_at is null
       and clock_timestamp() >= r.opens_at
       and clock_timestamp() < r.closes_at
  );
$$;

/** The caller's group board on a project, or null. */
create or replace function public.peer_my_board(p_project uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select b.id
    from public.project_boards b
    join public.group_members gm on gm.group_id = b.group_id
   where b.project_id = p_project and gm.student_id = auth.uid()
   limit 1;
$$;

-- ---------------------------------------------------------------- rounds

create or replace function public.open_peer_round(
  p_project   uuid,
  p_kind      public.peer_round_kind,
  p_closes_at timestamptz
) returns public.peer_rounds
language plpgsql security definer set search_path = public as $$
declare
  proj public.projects%rowtype;
  r    public.peer_rounds%rowtype;
begin
  select * into proj from public.projects where id = p_project;
  if proj.id is null then
    raise exception 'That project no longer exists';
  end if;
  if not public.is_project_professor(p_project) then
    raise exception 'Only someone teaching this class can open a peer evaluation'
      using errcode = 'insufficient_privilege';
  end if;
  if proj.audience <> 'group' then
    raise exception 'Peer evaluation is for group projects, and this one is individual'
      using errcode = 'check_violation';
  end if;
  if proj.archived_at is not null then
    raise exception 'That project is archived. Restore it to run a peer evaluation'
      using errcode = 'check_violation';
  end if;
  if p_closes_at is null or p_closes_at <= clock_timestamp() then
    raise exception 'Pick a closing time in the future'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.peer_rounds x
     where x.project_id = p_project and x.closed_at is null and clock_timestamp() < x.closes_at
  ) then
    raise exception 'A round is already open on this project. Close it before opening another'
      using errcode = 'check_violation';
  end if;
  if p_kind = 'final' and exists (
    select 1 from public.peer_rounds x where x.project_id = p_project and x.kind = 'final'
  ) then
    raise exception 'This project already has a final round'
      using errcode = 'check_violation';
  end if;

  insert into public.peer_rounds (project_id, kind, closes_at, created_by)
  values (p_project, p_kind, p_closes_at, auth.uid())
  returning * into r;

  insert into public.notifications (user_id, type, class_id, project_id, group_id, title, preview)
  select gm.student_id, 'peer_round_opened', proj.class_id, proj.id, b.group_id, proj.title,
         'Rate your teammates by '
           || to_char(p_closes_at at time zone 'Asia/Manila', 'Mon FMDD, FMHH12:MI AM')
    from public.project_boards b
    join public.group_members gm on gm.group_id = b.group_id
    join public.notification_prefs np on np.user_id = gm.student_id
   where b.project_id = p_project
     and np.deadline_reminders;

  return r;
end;
$$;

create or replace function public.set_peer_round_close(p_round uuid, p_closes_at timestamptz)
returns public.peer_rounds
language plpgsql security definer set search_path = public as $$
declare
  r public.peer_rounds%rowtype;
begin
  select * into r from public.peer_rounds where id = p_round for update;
  if r.id is null then
    raise exception 'That peer evaluation no longer exists';
  end if;
  if not public.is_project_professor(r.project_id) then
    raise exception 'Only someone teaching this class can change a peer evaluation'
      using errcode = 'insufficient_privilege';
  end if;
  if r.closed_at is not null then
    raise exception 'That round is closed. Open a new one instead'
      using errcode = 'check_violation';
  end if;
  if p_closes_at is null or p_closes_at <= clock_timestamp() then
    raise exception 'Pick a closing time in the future'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from public.peer_rounds x
     where x.project_id = r.project_id and x.id <> r.id
       and x.closed_at is null and clock_timestamp() < x.closes_at
  ) then
    raise exception 'Another round is open on this project. Close it first'
      using errcode = 'check_violation';
  end if;

  update public.peer_rounds set closes_at = p_closes_at where id = p_round returning * into r;
  return r;
end;
$$;

create or replace function public.close_peer_round(p_round uuid)
returns public.peer_rounds
language plpgsql security definer set search_path = public as $$
declare
  r public.peer_rounds%rowtype;
begin
  select * into r from public.peer_rounds where id = p_round for update;
  if r.id is null then
    raise exception 'That peer evaluation no longer exists';
  end if;
  if not public.is_project_professor(r.project_id) then
    raise exception 'Only someone teaching this class can close a peer evaluation'
      using errcode = 'insufficient_privilege';
  end if;
  update public.peer_rounds
     set closed_at = coalesce(closed_at, clock_timestamp())
   where id = p_round
  returning * into r;
  return r;
end;
$$;

/**
 * Remind the students who have not rated everyone yet. Once a day per project:
 * counted from the reminders already sent, as nudge_board does. Phase C3 moves
 * this count to the professor's notes log, which students cannot delete.
 */
create or replace function public.remind_peer_round(p_round uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  r    public.peer_rounds%rowtype;
  proj public.projects%rowtype;
  sent integer;
begin
  select * into r from public.peer_rounds where id = p_round;
  if r.id is null then
    raise exception 'That peer evaluation no longer exists';
  end if;
  if not public.is_project_professor(r.project_id) then
    raise exception 'Only someone teaching this class can send a reminder'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.peer_round_open(p_round) then
    raise exception 'That round is closed, so there is nothing to remind them about'
      using errcode = 'check_violation';
  end if;
  select * into proj from public.projects where id = r.project_id;
  if exists (
    select 1 from public.notifications n
     where n.type = 'peer_round_reminder'
       and n.project_id = proj.id
       and n.created_at > now() - interval '20 hours'
  ) then
    raise exception 'They were reminded today already. Try again tomorrow'
      using errcode = 'check_violation';
  end if;

  insert into public.notifications (user_id, type, class_id, project_id, group_id, title, preview)
  select t.student_id, 'peer_round_reminder', proj.class_id, proj.id, t.group_id,
         'Reminder: ' || proj.title,
         'Rate your teammates before '
           || to_char(r.closes_at at time zone 'Asia/Manila', 'Mon FMDD, FMHH12:MI AM')
    from (
      select b.id as board_id, b.group_id, gm.student_id
        from public.project_boards b
        join public.group_members gm on gm.group_id = b.group_id
       where b.project_id = proj.id
    ) t
    join (
      select b.id as board_id, count(*) as n
        from public.project_boards b
        join public.group_members gm on gm.group_id = b.group_id
       where b.project_id = proj.id
       group by b.id
    ) s on s.board_id = t.board_id
    left join (
      select pr.rater_id, count(*) as n
        from public.peer_ratings pr
        join public.project_boards b on b.id = pr.board_id
        join public.group_members gm on gm.group_id = b.group_id and gm.student_id = pr.ratee_id
       where pr.round_id = p_round
       group by pr.rater_id
    ) d on d.rater_id = t.student_id
   where s.n > 1 and coalesce(d.n, 0) < s.n;

  get diagnostics sent = row_count;
  return sent;
end;
$$;

-- ---------------------------------------------------------------- rating

create or replace function public.save_peer_ratings(p_round uuid, p_ratings jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  r       public.peer_rounds%rowtype;
  v_board uuid;
  v_team  uuid[];
  v_given uuid[];
  saved   integer;
begin
  select * into r from public.peer_rounds where id = p_round;
  if r.id is null then
    raise exception 'That peer evaluation no longer exists';
  end if;
  if not public.peer_round_open(p_round) then
    raise exception 'This peer evaluation is closed, so ratings can no longer change'
      using errcode = 'check_violation';
  end if;
  v_board := public.peer_my_board(r.project_id);
  if v_board is null then
    raise exception 'You are not in a group on this project, so there is nobody for you to rate'
      using errcode = 'insufficient_privilege';
  end if;

  select array_agg(gm.student_id order by gm.student_id) into v_team
    from public.project_boards b
    join public.group_members gm on gm.group_id = b.group_id
   where b.id = v_board;
  if coalesce(array_length(v_team, 1), 0) < 2 then
    raise exception 'You are the only member of your group, so there is nobody to rate'
      using errcode = 'check_violation';
  end if;

  if p_ratings is null or jsonb_typeof(p_ratings) <> 'array' then
    raise exception 'Send the ratings as a list'
      using errcode = 'check_violation';
  end if;
  select array_agg((e ->> 'ratee_id')::uuid order by (e ->> 'ratee_id')::uuid) into v_given
    from jsonb_array_elements(p_ratings) e;
  if v_given is distinct from v_team then
    raise exception 'Rate everyone in your group, yourself included'
      using errcode = 'check_violation';
  end if;

  insert into public.peer_ratings
    (round_id, board_id, rater_id, ratee_id, contributes, interacts, on_track, quality, skills, comment)
  select p_round, v_board, auth.uid(), (e ->> 'ratee_id')::uuid,
         (e ->> 'contributes')::smallint, (e ->> 'interacts')::smallint,
         (e ->> 'on_track')::smallint, (e ->> 'quality')::smallint, (e ->> 'skills')::smallint,
         coalesce(btrim(e ->> 'comment'), '')
    from jsonb_array_elements(p_ratings) e
  on conflict (round_id, rater_id, ratee_id) do update
     set board_id    = excluded.board_id,
         contributes = excluded.contributes,
         interacts   = excluded.interacts,
         on_track    = excluded.on_track,
         quality     = excluded.quality,
         skills      = excluded.skills,
         comment     = excluded.comment,
         updated_at  = clock_timestamp();

  get diagnostics saved = row_count;
  return saved;
end;
$$;

/** Everything the student's form needs in one call; null when there is nothing to rate. */
create or replace function public.peer_form(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r       public.peer_rounds%rowtype;
  v_board uuid;
begin
  select * into r from public.peer_rounds x
   where x.project_id = p_project
     and x.closed_at is null
     and clock_timestamp() >= x.opens_at
     and clock_timestamp() < x.closes_at
   order by x.opens_at desc
   limit 1;
  if r.id is null then
    return null;
  end if;
  v_board := public.peer_my_board(p_project);
  if v_board is null then
    return null;
  end if;

  return jsonb_build_object(
    'round', jsonb_build_object('id', r.id, 'kind', r.kind, 'closes_at', r.closes_at),
    'board_id', v_board,
    'team', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id,
               'name', btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')),
               'avatar_url', p.avatar_url,
               'is_me', p.id = auth.uid())
             order by (p.id <> auth.uid()), p.first_name, p.last_name), '[]'::jsonb)
        from public.project_boards b
        join public.group_members gm on gm.group_id = b.group_id
        join public.profiles p on p.id = gm.student_id
       where b.id = v_board
    ),
    'ratings', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'ratee_id', pr.ratee_id, 'contributes', pr.contributes,
               'interacts', pr.interacts, 'on_track', pr.on_track,
               'quality', pr.quality, 'skills', pr.skills, 'comment', pr.comment)), '[]'::jsonb)
        from public.peer_ratings pr
       where pr.round_id = r.id and pr.rater_id = auth.uid()
    )
  );
end;
$$;

-- ---------------------------------------------------------------- reading

drop view if exists public.peer_round_status;
drop view if exists public.peer_comments;
drop view if exists public.peer_results;

/**
 * One row per (round, board, current member). Averages are of each rater's mean
 * across the five dimensions; "received" excludes the person's own rating of
 * themselves. Only ratings whose rater and ratee are both still in the group count.
 */
create view public.peer_results
with (security_invoker = true) as
with team as (
  select r.id as round_id, r.project_id, r.kind, r.opens_at,
         (r.closed_at is null and clock_timestamp() >= r.opens_at and clock_timestamp() < r.closes_at) as is_open,
         p.class_id, b.id as board_id, g.name as group_name, gm.student_id
    from public.peer_rounds r
    join public.projects p on p.id = r.project_id
    join public.project_boards b on b.project_id = r.project_id
    join public.groups g on g.id = b.group_id
    join public.group_members gm on gm.group_id = b.group_id
),
rt as (
  select pr.round_id, pr.board_id, pr.rater_id, pr.ratee_id,
         (pr.contributes + pr.interacts + pr.on_track + pr.quality + pr.skills) / 5.0 as mean5,
         pr.contributes, pr.interacts, pr.on_track, pr.quality, pr.skills
    from public.peer_ratings pr
    join team a on a.round_id = pr.round_id and a.board_id = pr.board_id and a.student_id = pr.rater_id
    join team e on e.round_id = pr.round_id and e.board_id = pr.board_id and e.student_id = pr.ratee_id
),
sizes as (
  select round_id, board_id, count(*)::int as team_size
    from team group by round_id, board_id
),
recv as (
  select round_id, board_id, ratee_id,
         count(*)::int              as raters,
         avg(mean5)                 as received_avg,
         max(mean5) - min(mean5)    as received_spread,
         avg(contributes)           as contributes_avg,
         avg(interacts)             as interacts_avg,
         avg(on_track)              as on_track_avg,
         avg(quality)               as quality_avg,
         avg(skills)                as skills_avg
    from rt
   where rater_id <> ratee_id
   group by round_id, board_id, ratee_id
),
selfr as (
  select round_id, board_id, rater_id, mean5 as self_avg
    from rt where rater_id = ratee_id
),
given as (
  select round_id, board_id, rater_id,
         avg(mean5) filter (where rater_id <> ratee_id) as given_avg,
         count(*)::int                                   as rows_given
    from rt group by round_id, board_id, rater_id
)
select t.round_id, t.project_id, t.class_id, t.kind, t.opens_at, t.is_open,
       t.board_id, t.group_name, t.student_id,
       btrim(coalesce(pf.first_name, '') || ' ' || coalesce(pf.last_name, '')) as student_name,
       round(rc.received_avg, 3)     as received_avg,
       coalesce(rc.raters, 0)        as raters,
       round(rc.received_spread, 3)  as received_spread,
       round(sf.self_avg, 3)         as self_avg,
       round(gv.given_avg, 3)        as given_avg,
       round(rc.contributes_avg, 2)  as contributes_avg,
       round(rc.interacts_avg, 2)    as interacts_avg,
       round(rc.on_track_avg, 2)     as on_track_avg,
       round(rc.quality_avg, 2)      as quality_avg,
       round(rc.skills_avg, 2)       as skills_avg,
       s.team_size,
       coalesce(gv.rows_given, 0) = s.team_size as rated_all
  from team t
  join sizes s on s.round_id = t.round_id and s.board_id = t.board_id
  join public.profiles pf on pf.id = t.student_id
  left join recv rc
    on rc.round_id = t.round_id and rc.board_id = t.board_id and rc.ratee_id = t.student_id
  left join selfr sf
    on sf.round_id = t.round_id and sf.board_id = t.board_id and sf.rater_id = t.student_id
  left join given gv
    on gv.round_id = t.round_id and gv.board_id = t.board_id and gv.rater_id = t.student_id
 where public.is_project_professor(t.project_id);

grant select on public.peer_results to authenticated;

/** A round and how many have answered. Groups of one have nobody to rate and do not count. */
create view public.peer_round_status
with (security_invoker = true) as
select r.id, r.project_id, p.class_id, r.kind, r.opens_at, r.closes_at, r.closed_at,
       (r.closed_at is null and clock_timestamp() >= r.opens_at and clock_timestamp() < r.closes_at) as is_open,
       coalesce(s.expected, 0)::int as expected,
       coalesce(s.answered, 0)::int as answered
  from public.peer_rounds r
  join public.projects p on p.id = r.project_id
  left join (
    select round_id,
           count(*) filter (where team_size > 1)              as expected,
           count(*) filter (where team_size > 1 and rated_all) as answered
      from public.peer_results
     group by round_id
  ) s on s.round_id = r.id
 where public.is_project_professor(r.project_id);

grant select on public.peer_round_status to authenticated;

/** Written comments, for teaching staff only. The page hides rater names until asked. */
create view public.peer_comments
with (security_invoker = true) as
select pr.round_id, pr.board_id, r.project_id, pr.ratee_id,
       btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')) as ratee_name,
       pr.rater_id,
       btrim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')) as rater_name,
       pr.comment, pr.updated_at
  from public.peer_ratings pr
  join public.peer_rounds r on r.id = pr.round_id
  join public.project_boards b on b.id = pr.board_id
  join public.group_members ga on ga.group_id = b.group_id and ga.student_id = pr.rater_id
  join public.group_members ge on ge.group_id = b.group_id and ge.student_id = pr.ratee_id
  join public.profiles a on a.id = pr.rater_id
  join public.profiles e on e.id = pr.ratee_id
 where btrim(pr.comment) <> ''
   and public.is_project_professor(r.project_id);

grant select on public.peer_comments to authenticated;

-- ---------------------------------------------------------------- policies

alter table public.peer_rounds enable row level security;
alter table public.peer_ratings enable row level security;

drop policy if exists peer_rounds_select on public.peer_rounds;
create policy peer_rounds_select on public.peer_rounds
  for select using (
    public.is_project_professor(project_id) or public.peer_my_board(project_id) is not null
  );

-- The rater and the teaching staff. Never the ratee, never a teammate.
drop policy if exists peer_ratings_select on public.peer_ratings;
create policy peer_ratings_select on public.peer_ratings
  for select using (
    rater_id = auth.uid() or public.is_project_professor(public.peer_round_project(round_id))
  );

grant select on public.peer_rounds, public.peer_ratings to authenticated;

grant execute on function public.peer_round_project(uuid) to authenticated;
grant execute on function public.peer_round_open(uuid) to authenticated;
grant execute on function public.peer_my_board(uuid) to authenticated;
grant execute on function public.open_peer_round(uuid, public.peer_round_kind, timestamptz) to authenticated;
grant execute on function public.set_peer_round_close(uuid, timestamptz) to authenticated;
grant execute on function public.close_peer_round(uuid) to authenticated;
grant execute on function public.remind_peer_round(uuid) to authenticated;
grant execute on function public.save_peer_ratings(uuid, jsonb) to authenticated;
grant execute on function public.peer_form(uuid) to authenticated;

commit;
