# Phase C1: Peer Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Professors open peer-evaluation rounds on group projects. Students rate every teammate,
and themselves, on the five CATME dimensions. Professors see averages, an adjustment factor and
flags on the project's Work tab and in Analytics.

**Architecture:**
- **Database.** The new file `supabase/peer-evaluation.sql` adds two tables, `peer_rounds` and
  `peer_ratings`. Students and professors never write them directly; every write goes through a
  `security definer` function. Professors read three views: `peer_results`, `peer_round_status`
  and `peer_comments`. Students read their own form through `peer_form(project)`.
- **Client.** The factor and flags are pure TypeScript in `src/lib/peerMath.ts`, unit tested.
  There are two new interface surfaces: the student "Rate your team" modal in the class project
  header, and the professor "Peer evaluation" panel on the Work tab. Analytics gains a Groups
  section and one line in the student drawer.

**Tech stack:** React 19, TypeScript, Vite, Tailwind tokens, Supabase Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-phase-c-grading-design.md`, part **C1**.

### Amendments to the spec (rulings made while planning)

1. **Opening a round on a closed project.** `open_peer_round` refuses **archived** projects only.
   It does not refuse closed (`locked_at`) ones. The final round usually runs right after the
   professor closes the project, so refusing closed projects would block the main use.
2. **The reminder limit reads `notifications`** (type `peer_round_reminder`, same project, last
   20 hours), the same way `nudge_board` does today. The `class_notes` log it should read
   arrives in C3, and C3 switches the limit over.
3. **`my_peer_summary`**, the student's own averages shown after grades are released, is built
   in **C2** next to the release it depends on. It is not built here.
4. **Notification preference.** `peer_round_opened` is sent only to students with
   `notification_prefs.deadline_reminders` turned on. A round is a deadline. `peer_round_reminder`
   is sent by a person, so it ignores preferences, like `nudge`.
5. **Live updates.** No `live.sql` change. The panel and the form refresh through `useLive`'s
   30-second poll and when the window regains focus. Students rating each other do not need
   instant updates.

## Global Constraints

- Colours only from tokens: `surface*`, `text-ink|muted|faint`, `border-line*`, `navy-*`,
  `amber-*`, `success-*`, `warning-*`, `danger-*`, `bg-pending-soft`/`text-pending-ink`. Never a
  raw hex value, never `emerald-*` or `red-*`, never brand amber for a status. Every colour
  works in light and dark mode.
- Copy rules:
  - Sentence case and active voice.
  - No "please", no "successfully", no exclamation marks.
  - An error says what happened and what to do next.
- "Teaching staff" means `public.is_project_professor(project)` / `is_board_professor` /
  `is_class_professor`. These already include co-teachers.
- **Every write** goes through a `security definer` function. The new tables get **no**
  insert, update or delete policies.
- Refusals raise `check_violation` (or `insufficient_privilege` for the wrong person) with a
  sentence a person can act on.
- `peer_ratings` rows are readable only by `rater_id = auth.uid()` or by teaching staff. A ratee
  or a teammate never reads another person's rows.
- SQL files are idempotent: `create … if not exists`, `drop … if exists`, `create or replace`.
  Notification enum values are added in their own committed transaction.
- After adding functions, re-run `supabase/anon-lockdown.sql`. Add the new SQL file to
  `scripts/schema-drift.mjs` ORDER and to both rebuild commands in `docs/07-backup.md`, after
  `analytics-trends.sql`.
- Thresholds are named constants in `src/lib/peerMath.ts`:
  - `PEER_MIN_RATERS = 2`
  - `FACTOR_LOW = 0.85`
  - `FACTOR_HIGH = 1.10`
  - `SELF_GAP = 1.0`
  - `MANIPULATOR_GAP = 1.5`
  - `CONFLICT_SPREAD = 1.0`
  - `FACTOR_CAP = 1.05`
- Gates for every task:
  - `npm run build`
  - `npx eslint src` (repo-wide eslint fails on unrelated untracked folders)
  - `npm test`
  - for SQL tasks, the task's own test file plus `supabase/tests/rls-coverage.test.sql` and
    `supabase/tests/anon-lockdown.test.sql`
- Every commit message ends with a blank line followed by
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never stage `cinema/`, `launch-video/`, `.claude/launch.json`, `.gitignore` or
  `supabase/.temp/`.

## Review Focus

1. **A student leaves the group after rating.** Their ratings, given and received, must drop
   out of every average, and the remaining members' figures must recompute. Pinned by the
   "member leaves" block in Task 1's SQL test.
2. **A teammate tries to read ratings about themselves**, through the table, the results view
   or the comments view. They must see nothing. Pinned by the visibility block in Task 1.
3. **Ratings saved after the round closes, or a half-filled form.** Both must be refused, and
   the form must say why. Pinned in Task 1 (SQL) and Task 3 (the Save button stays disabled
   until every rating is filled).
4. **A group of one or two.** A group of one has nobody to rate. A group of two gives each
   person one rater, so no factor is shown. Pinned in Task 1 (refusal) and Task 2 (unit test:
   one rater gives a null factor and no factor flags).
5. **Two rounds at once, or a second final round.** Both must be refused with a clear sentence.
   Pinned in Task 1.

---

### Task 1: Peer evaluation in the database

**Files:**
- Create: `supabase/peer-evaluation.sql`
- Create: `supabase/tests/peer-evaluation.test.sql`
- Modify: `scripts/schema-drift.mjs` (ORDER: append `peer-evaluation` after `analytics-trends`)
- Modify: `docs/07-backup.md` (append `supabase/peer-evaluation.sql` after `supabase/analytics-trends.sql` on both rebuild command lines, currently lines 26 and 53)

**Interfaces:**
- Produces these SQL objects, all used by later tasks:
  - enum `peer_round_kind ('check_in','final')`
  - tables `peer_rounds(id, project_id, kind, opens_at, closes_at, closed_at, created_by, created_at)` and `peer_ratings(id, round_id, board_id, rater_id, ratee_id, contributes, interacts, on_track, quality, skills, comment, updated_at)`
  - `open_peer_round(p_project uuid, p_kind peer_round_kind, p_closes_at timestamptz) returns peer_rounds`
  - `set_peer_round_close(p_round uuid, p_closes_at timestamptz) returns peer_rounds`
  - `close_peer_round(p_round uuid) returns peer_rounds`
  - `remind_peer_round(p_round uuid) returns integer`
  - `save_peer_ratings(p_round uuid, p_ratings jsonb) returns integer`
  - `peer_form(p_project uuid) returns jsonb`. It returns null when no round is open or the caller isn't in a group. Otherwise it returns `{ round: { id, kind, closes_at }, board_id, team: [{ id, name, avatar_url, is_me }], ratings: [{ ratee_id, contributes, interacts, on_track, quality, skills, comment }] }`.
  - view `peer_results`, one row per (round, board, member). Columns: `round_id, project_id, class_id, kind, opens_at, is_open, board_id, group_name, student_id, student_name, received_avg, raters, received_spread, self_avg, given_avg, contributes_avg, interacts_avg, on_track_avg, quality_avg, skills_avg, team_size, rated_all`.
  - view `peer_round_status`, columns `id, project_id, class_id, kind, opens_at, closes_at, closed_at, is_open, expected, answered`.
  - view `peer_comments`, columns `round_id, board_id, project_id, ratee_id, ratee_name, rater_id, rater_name, comment, updated_at`.
  - notification types `peer_round_opened` and `peer_round_reminder`.

- [ ] **Step 1: Write the failing SQL test**

Create `supabase/tests/peer-evaluation.test.sql`:

```sql
-- Peer evaluation — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/peer-evaluation.test.sql
--
-- Every refusal is paired with a control that succeeds. The averages are checked
-- against a hand computation on three students with known ratings:
--   a rates a=5 b=4 c=2 · b rates a=4 b=4 c=2 · c rates a=4 b=3 c=5
-- (each number is all five dimensions). Received, self excluded:
--   a = (4+4)/2 = 4.0 · b = (4+3)/2 = 3.5 · c = (2+2)/2 = 2.0

begin;

create or replace function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_as_service() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.must_refuse(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      raise notice 'PASS  %  (refused: %)', p_label, left(sqlerrm, 58);
      return;
  end;
  raise exception 'FAIL  % — it went through and should not have', p_label;
end;
$$;

create or replace function pg_temp.must_allow(p_label text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS  %', p_label;
exception
  when others then
    raise exception 'FAIL  % — refused with: %', p_label, sqlerrm;
end;
$$;

create or replace function pg_temp.must_be(p_label text, p_got boolean) returns void
language plpgsql as $$
begin
  if p_got then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

/** Everyone in the order (a, b, c) rated with one score across all five dimensions. */
create or replace function pg_temp.ratings(
  p_a uuid, s_a int, p_b uuid, s_b int, p_c uuid, s_c int, p_note text default ''
) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('ratee_id', p_a, 'contributes', s_a, 'interacts', s_a, 'on_track', s_a,
                       'quality', s_a, 'skills', s_a, 'comment', ''),
    jsonb_build_object('ratee_id', p_b, 'contributes', s_b, 'interacts', s_b, 'on_track', s_b,
                       'quality', s_b, 'skills', s_b, 'comment', ''),
    jsonb_build_object('ratee_id', p_c, 'contributes', s_c, 'interacts', s_c, 'on_track', s_c,
                       'quality', s_c, 'skills', s_c, 'comment', p_note)
  );
$$;

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_set uuid; v_g uuid; v_proj uuid; v_solo uuid; v_board uuid;
begin
  select c.id, c.professor_id into v_class, v_prof
    from public.classes c
   where c.archived_at is null
     and (select count(*) from public.syllabus_weeks w where w.resource_id = c.syllabus_id) >= 2
     and (select count(*) from public.class_members m
           where m.class_id = c.id and m.status = 'active') >= 4
   order by c.created_at
   limit 1;
  select student_id into v_a from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 0 limit 1;
  select student_id into v_b from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 1 limit 1;
  select student_id into v_c from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 2 limit 1;
  select student_id into v_d from public.class_members
   where class_id = v_class and status = 'active' order by student_id offset 3 limit 1;

  insert into public.group_sets (class_id, name, mode)
  values (v_class, 'zz-peer-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'zz-peer-group') returning id into v_g;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_g, v_set, v_a), (v_g, v_set, v_b), (v_g, v_set, v_c);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, due_at)
  values (v_class, v_prof, 'zz-peer-proj', 'activity', 1, 2, 'group', v_set, now() + interval '5 days')
  returning id into v_proj;
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, due_at)
  values (v_class, v_prof, 'zz-peer-solo', 'activity', 1, 2, 'individual', now() + interval '5 days')
  returning id into v_solo;
  perform public.ensure_project_boards(v_proj);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_g;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert, update on fx to authenticated;
  insert into fx values
    ('prof', v_prof), ('a', v_a), ('b', v_b), ('c', v_c), ('d', v_d),
    ('proj', v_proj), ('solo', v_solo), ('board', v_board), ('group', v_g);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------------------ opening rounds

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_proj uuid := (select v from fx where k='proj');
  v_solo uuid := (select v from fx where k='solo');
  v_round uuid;
  n int;
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot open a round',
    format('select public.open_peer_round(%L, ''check_in'', now() + interval ''2 days'')', v_proj));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('a round must close in the future',
    format('select public.open_peer_round(%L, ''check_in'', now() - interval ''1 hour'')', v_proj));
  perform pg_temp.must_refuse('an individual project has no peer evaluation',
    format('select public.open_peer_round(%L, ''check_in'', now() + interval ''2 days'')', v_solo));
  perform pg_temp.must_allow('the professor opens a check-in round',
    format('select public.open_peer_round(%L, ''check_in'', now() + interval ''2 days'')', v_proj));
  perform pg_temp.must_refuse('only one round is open at a time',
    format('select public.open_peer_round(%L, ''final'', now() + interval ''2 days'')', v_proj));

  select id into v_round from public.peer_rounds where project_id = v_proj;
  perform pg_temp.act_as_service();
  insert into fx values ('round', v_round);

  select count(*) into n from public.notifications
   where project_id = v_proj and type = 'peer_round_opened';
  perform pg_temp.must_be('opening tells the group (those with deadline reminders on)',
    n = (select count(*) from public.notification_prefs np
          where np.deadline_reminders
            and np.user_id in ((select v from fx where k='a'), (select v from fx where k='b'),
                               (select v from fx where k='c'))));
end $$;

-- ------------------------------------------------------------ saving ratings

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_d uuid := (select v from fx where k='d');
  v_prof uuid := (select v from fx where k='prof');
  v_round uuid := (select v from fx where k='round');
  n int;
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a half-filled form is refused',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round,
      jsonb_build_array(jsonb_build_object('ratee_id', v_a, 'contributes', 5, 'interacts', 5,
        'on_track', 5, 'quality', 5, 'skills', 5))));
  perform pg_temp.must_refuse('a score outside 1 to 5 is refused',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round,
      pg_temp.ratings(v_a, 6, v_b, 4, v_c, 2)));
  perform pg_temp.must_allow('a rates everyone, themselves included',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round,
      pg_temp.ratings(v_a, 5, v_b, 4, v_c, 2, 'zz-quiet in meetings')));

  perform pg_temp.act_as(v_d);
  perform pg_temp.must_refuse('someone outside the group cannot rate it',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round,
      pg_temp.ratings(v_a, 3, v_b, 3, v_c, 3)));

  -- Reminders reach only the two who have not answered.
  perform pg_temp.act_as(v_prof);
  select public.remind_peer_round(v_round) into n;
  perform pg_temp.must_be('a reminder reaches only those who have not rated everyone', n = 2);
  perform pg_temp.must_refuse('one reminder a day',
    format('select public.remind_peer_round(%L)', v_round));

  perform pg_temp.act_as(v_b);
  perform public.save_peer_ratings(v_round, pg_temp.ratings(v_a, 4, v_b, 4, v_c, 2));
  perform pg_temp.act_as(v_c);
  perform public.save_peer_ratings(v_round, pg_temp.ratings(v_a, 4, v_b, 3, v_c, 5));

  -- Saving again replaces, it does not duplicate.
  perform pg_temp.act_as(v_c);
  perform public.save_peer_ratings(v_round, pg_temp.ratings(v_a, 4, v_b, 3, v_c, 5));
  perform pg_temp.act_as_service();
  select count(*) into n from public.peer_ratings where round_id = v_round;
  perform pg_temp.must_be('nine ratings, one per pair', n = 9);
end $$;

-- ---------------------------------------------------------------- who sees what

do $$
declare
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_d uuid := (select v from fx where k='d');
  v_proj uuid := (select v from fx where k='proj');
  v_round uuid := (select v from fx where k='round');
  n int;
begin
  perform pg_temp.act_as(v_a);
  select count(*) into n from public.peer_ratings where round_id = v_round;
  perform pg_temp.must_be('a rater reads their own three ratings and no others', n = 3);

  perform pg_temp.act_as(v_b);
  select count(*) into n from public.peer_ratings
   where round_id = v_round and ratee_id = v_b and rater_id <> v_b;
  perform pg_temp.must_be('nobody reads what teammates said about them', n = 0);
  select count(*) into n from public.peer_results where round_id = v_round;
  perform pg_temp.must_be('a student reads no results', n = 0);
  select count(*) into n from public.peer_comments where round_id = v_round;
  perform pg_temp.must_be('a student reads no comments', n = 0);
  select count(*) into n from public.peer_round_status where id = v_round;
  perform pg_temp.must_be('a student reads no round progress', n = 0);
  select count(*) into n from public.peer_rounds where project_id = v_proj;
  perform pg_temp.must_be('a group member can see the round exists', n = 1);

  perform pg_temp.act_as(v_d);
  select count(*) into n from public.peer_rounds where project_id = v_proj;
  perform pg_temp.must_be('someone outside the group cannot see the round', n = 0);
  perform pg_temp.must_be('and gets no form', public.peer_form(v_proj) is null);

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('a member gets their form with the whole team',
    jsonb_array_length(public.peer_form(v_proj) -> 'team') = 3);
  perform pg_temp.must_be('and their own saved ratings',
    jsonb_array_length(public.peer_form(v_proj) -> 'ratings') = 3);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------ the arithmetic

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_round uuid := (select v from fx where k='round');
  ra public.peer_results%rowtype; rb public.peer_results%rowtype; rc public.peer_results%rowtype;
  st public.peer_round_status%rowtype;
  n int;
begin
  perform pg_temp.act_as(v_prof);
  select * into ra from public.peer_results where round_id = v_round and student_id = v_a;
  select * into rb from public.peer_results where round_id = v_round and student_id = v_b;
  select * into rc from public.peer_results where round_id = v_round and student_id = v_c;

  perform pg_temp.must_be('a received 4.0 from two raters', ra.received_avg = 4.0 and ra.raters = 2);
  perform pg_temp.must_be('b received 3.5', rb.received_avg = 3.5);
  perform pg_temp.must_be('c received 2.0', rc.received_avg = 2.0);
  perform pg_temp.must_be('c rated themselves 5', rc.self_avg = 5.0);
  perform pg_temp.must_be('c gave others 3.5 on average', rc.given_avg = 3.5);
  perform pg_temp.must_be('raters disagree about b by a full point', rb.received_spread = 1.0);
  perform pg_temp.must_be('and agree about a', ra.received_spread = 0);
  perform pg_temp.must_be('per-dimension averages follow', rc.contributes_avg = 2.0);
  perform pg_temp.must_be('everyone answered', ra.rated_all and rb.rated_all and rc.rated_all);
  perform pg_temp.must_be('team of three', ra.team_size = 3);

  select * into st from public.peer_round_status where id = v_round;
  perform pg_temp.must_be('progress reads 3 of 3', st.expected = 3 and st.answered = 3 and st.is_open);

  select count(*) into n from public.peer_comments where round_id = v_round;
  perform pg_temp.must_be('the professor reads the one comment, with its rater', n = 1
    and (select rater_id from public.peer_comments where round_id = v_round) = v_a);
  perform pg_temp.act_as_service();
end $$;

-- ---------------------------------------------------------------- closing

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_proj uuid := (select v from fx where k='proj');
  v_round uuid := (select v from fx where k='round');
  v_final uuid;
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot close a round',
    format('select public.close_peer_round(%L)', v_round));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor can move the close date',
    format('select public.set_peer_round_close(%L, now() + interval ''4 days'')', v_round));
  perform pg_temp.must_allow('the professor closes it early',
    format('select public.close_peer_round(%L)', v_round));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a closed round takes no more ratings',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round,
      pg_temp.ratings(v_a, 3, v_b, 3, v_c, 3)));
  perform pg_temp.must_be('and offers no form', public.peer_form(v_proj) is null);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('a closed round cannot be moved',
    format('select public.set_peer_round_close(%L, now() + interval ''4 days'')', v_round));

  -- A closed project still takes a final round: that is when it usually runs.
  perform pg_temp.act_as_service();
  update public.projects set locked_at = now() where id = v_proj;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('a closed project can still open its final round',
    format('select public.open_peer_round(%L, ''final'', now() + interval ''3 days'')', v_proj));
  select id into v_final from public.peer_rounds where project_id = v_proj and kind = 'final';
  perform public.close_peer_round(v_final);
  perform pg_temp.must_refuse('a project has one final round',
    format('select public.open_peer_round(%L, ''final'', now() + interval ''3 days'')', v_proj));

  perform pg_temp.act_as_service();
  update public.projects set archived_at = now() where id = v_proj;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('an archived project opens no round',
    format('select public.open_peer_round(%L, ''check_in'', now() + interval ''3 days'')', v_proj));
  perform pg_temp.act_as_service();
  update public.projects set archived_at = null where id = v_proj;
end $$;

-- ----------------------------------------------------------- someone leaves

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_c uuid := (select v from fx where k='c');
  v_g uuid := (select v from fx where k='group');
  v_round uuid := (select v from fx where k='round');
  ra public.peer_results%rowtype;
  n int;
begin
  delete from public.group_members where group_id = v_g and student_id = v_c;

  perform pg_temp.act_as(v_prof);
  select count(*) into n from public.peer_results where round_id = v_round and student_id = v_c;
  perform pg_temp.must_be('someone who left drops out of the results', n = 0);
  select * into ra from public.peer_results where round_id = v_round and student_id = v_a;
  perform pg_temp.must_be('and their ratings of others no longer count',
    ra.raters = 1 and ra.received_avg = 4.0 and ra.team_size = 2);
  perform pg_temp.act_as_service();
end $$;

-- ------------------------------------------------------------ a group of one

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_g uuid := (select v from fx where k='group');
  v_proj uuid := (select v from fx where k='proj');
  v_round uuid;
begin
  delete from public.group_members where group_id = v_g and student_id = v_b;
  perform pg_temp.act_as(v_prof);
  perform public.open_peer_round(v_proj, 'check_in', now() + interval '2 days');
  select id into v_round from public.peer_rounds
   where project_id = v_proj and kind = 'check_in' and closed_at is null;
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('alone in a group there is nobody to rate',
    format('select public.save_peer_ratings(%L, %L::jsonb)', v_round,
      jsonb_build_array(jsonb_build_object('ratee_id', v_a, 'contributes', 3, 'interacts', 3,
        'on_track', 3, 'quality', 3, 'skills', 3, 'comment', ''))));
  perform pg_temp.act_as_service();
end $$;

rollback;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node scripts/db.mjs supabase/tests/peer-evaluation.test.sql`
Expected: an error mentioning `function public.open_peer_round(...) does not exist` or `relation "public.peer_rounds" does not exist`.

- [ ] **Step 3: Write `supabase/peer-evaluation.sql`**

```sql
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
         (r.closed_at is null and now() >= r.opens_at and now() < r.closes_at) as is_open,
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
       (r.closed_at is null and now() >= r.opens_at and now() < r.closes_at) as is_open,
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
```

- [ ] **Step 4: Apply it, lock down anon, and run the tests**

Run:
```bash
node scripts/db.mjs supabase/peer-evaluation.sql
node scripts/db.mjs supabase/anon-lockdown.sql
node scripts/db.mjs supabase/tests/peer-evaluation.test.sql
node scripts/db.mjs supabase/tests/rls-coverage.test.sql
node scripts/db.mjs supabase/tests/anon-lockdown.test.sql
```
Expected: every line is `PASS` and none is `FAIL`.

If the fixture finds no class with four active members, report NEEDS_CONTEXT with the count. Do not weaken the test.

- [ ] **Step 5: Register the file in the rebuild order**

In `scripts/schema-drift.mjs`, change the end of `ORDER` from `anon-lockdown analytics-trends` to
`anon-lockdown analytics-trends peer-evaluation`.

In `docs/07-backup.md`, append ` supabase/peer-evaluation.sql` right after
`supabase/analytics-trends.sql` on **both** rebuild command lines.

Run: `node scripts/schema-drift.mjs`
Expected: exit 0, no drift reported.

- [ ] **Step 6: Commit**

```bash
git add supabase/peer-evaluation.sql supabase/tests/peer-evaluation.test.sql scripts/schema-drift.mjs docs/07-backup.md
git commit -m "$(cat <<'EOF'
Let professors run peer evaluation rounds and students rate their teammates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Types, client calls and the factor arithmetic

**Files:**
- Create: `src/lib/peerMath.ts`
- Test: `src/lib/peerMath.test.ts`
- Create: `src/lib/peerDimensions.ts`
- Create: `src/lib/api/peer.ts`
- Modify: `src/lib/types.ts` (add types after `SprintProgress`; add the two notification types to `AppNotification.type`)

**Interfaces:**
- Consumes: the views and functions from Task 1.
- Produces:
  - Types in `types.ts`:
    - `PeerRoundKind = 'check_in' | 'final'`
    - `PeerRoundStatus = { id; project_id; class_id; kind; opens_at; closes_at; closed_at; is_open: boolean; expected: number; answered: number }`
    - `PeerResult = { round_id; project_id; class_id; kind; opens_at; is_open; board_id; group_name; student_id; student_name; received_avg: number|null; raters: number; received_spread: number|null; self_avg: number|null; given_avg: number|null; contributes_avg; interacts_avg; on_track_avg; quality_avg; skills_avg (each number|null); team_size: number; rated_all: boolean }`
    - `PeerComment = { round_id; board_id; project_id; ratee_id; ratee_name; rater_id; rater_name; comment; updated_at }`
    - `PeerRatingInput = { ratee_id: string; contributes: number; interacts: number; on_track: number; quality: number; skills: number; comment: string }`
    - `PeerForm = { round: { id: string; kind: PeerRoundKind; closes_at: string }; board_id: string; team: { id: string; name: string; avatar_url: string | null; is_me: boolean }[]; ratings: PeerRatingInput[] }`
  - In `peerMath.ts`:
    - constants `PEER_MIN_RATERS`, `FACTOR_LOW`, `FACTOR_HIGH`, `SELF_GAP`, `MANIPULATOR_GAP`, `CONFLICT_SPREAD`, `FACTOR_CAP`
    - `type PeerFlag`, `PEER_FLAG_META: Record<PeerFlag, { label: string; tone: Tone }>`
    - `analyseTeam<T extends PeerInput>(rows: T[]): (T & { factor: number | null; flags: PeerFlag[] })[]`
    - `latestRoundRows(rows: PeerResult[]): PeerResult[]`, which keeps each board's most recent round
  - In `peerDimensions.ts`: `PEER_DIMENSIONS` (key, label, low, mid, high) and `type PeerDimension`.
  - In `api/peer.ts`: `openPeerRound`, `setPeerRoundClose`, `closePeerRound`, `remindPeerRound`, `savePeerRatings`, `peerForm`, `listPeerRounds`, `projectPeerResults`, `classPeerResults`, `peerComments`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/peerMath.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { analyseTeam, latestRoundRows } from './peerMath'
import type { PeerInput } from './peerMath'
import type { PeerResult } from './types'

// The same three students as supabase/tests/peer-evaluation.test.sql.
const row = (over: Partial<PeerInput> & { student_id: string }): PeerInput => ({
  received_avg: null, self_avg: null, given_avg: null, raters: 0,
  received_spread: null, rated_all: true, team_size: 3, ...over,
})
const team = [
  row({ student_id: 'a', received_avg: 4, self_avg: 5, given_avg: 3, raters: 2, received_spread: 0 }),
  row({ student_id: 'b', received_avg: 3.5, self_avg: 4, given_avg: 3, raters: 2, received_spread: 1 }),
  row({ student_id: 'c', received_avg: 2, self_avg: 5, given_avg: 3.5, raters: 2, received_spread: 0 }),
]

describe('analyseTeam', () => {
  const out = Object.fromEntries(analyseTeam(team).map((r) => [r.student_id, r]))

  it('divides each received average by the team mean', () => {
    expect(out.a.factor).toBe(1.263)
    expect(out.b.factor).toBe(1.105)
    expect(out.c.factor).toBe(0.632)
  })

  it('flags each pattern in a fixed order', () => {
    expect(out.a.flags).toEqual(['high', 'overconfident'])
    expect(out.b.flags).toEqual(['high', 'conflict'])
    expect(out.c.flags).toEqual(['low', 'overconfident', 'manipulator'])
  })

  it('gives no factor, and no factor flags, with fewer than two raters', () => {
    const [x] = analyseTeam([
      row({ student_id: 'x', received_avg: 1, self_avg: 5, given_avg: 1, raters: 1, received_spread: 0, team_size: 2 }),
      row({ student_id: 'y', received_avg: 5, self_avg: 5, given_avg: 1, raters: 1, received_spread: 0, team_size: 2 }),
    ])
    expect(x.factor).toBeNull()
    expect(x.flags).toEqual([])
  })

  it('leaves people with too few raters out of the team mean', () => {
    const out2 = analyseTeam([
      row({ student_id: 'p', received_avg: 4, raters: 2 }),
      row({ student_id: 'q', received_avg: 4, raters: 2 }),
      row({ student_id: 'r', received_avg: 1, raters: 1 }),
    ])
    expect(out2.map((r) => r.factor)).toEqual([1, 1, null])
  })

  it('flags someone who has not rated everyone', () => {
    const [x] = analyseTeam([row({ student_id: 'x', rated_all: false })])
    expect(x.flags).toEqual(['no_response'])
  })

  it('does not flag a group of one for not rating', () => {
    const [x] = analyseTeam([row({ student_id: 'x', rated_all: false, team_size: 1 })])
    expect(x.flags).toEqual([])
  })

  it('flags underconfidence', () => {
    const [x] = analyseTeam([
      row({ student_id: 'x', received_avg: 4.5, self_avg: 3, raters: 2, received_spread: 0 }),
      row({ student_id: 'y', received_avg: 4.5, self_avg: 4.5, raters: 2, received_spread: 0 }),
    ])
    expect(x.flags).toEqual(['underconfident'])
  })
})

describe('latestRoundRows', () => {
  const r = (round: string, board: string, opens: string) =>
    ({ round_id: round, board_id: board, opens_at: opens, student_id: 's' }) as PeerResult
  it('keeps each board’s most recent round only', () => {
    const rows = [r('old', 'b1', '2026-10-01T00:00:00Z'), r('new', 'b1', '2026-10-10T00:00:00Z'),
                  r('only', 'b2', '2026-10-02T00:00:00Z')]
    expect(latestRoundRows(rows).map((x) => x.round_id).sort()).toEqual(['new', 'only'])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/peerMath.test.ts`
Expected: FAIL with "Failed to resolve import ./peerMath".

- [ ] **Step 3: Add the types to `src/lib/types.ts`**

In the `AppNotification` `type:` union, add after `| 'meeting_cancelled'`:

```ts
    | 'peer_round_opened'
    | 'peer_round_reminder'
```

After the `SprintProgress` type, add:

```ts
export type PeerRoundKind = 'check_in' | 'final'

/** peer_round_status: a round and how many have answered. */
export type PeerRoundStatus = {
  id: string
  project_id: string
  class_id: string
  kind: PeerRoundKind
  opens_at: string
  closes_at: string
  closed_at: string | null
  is_open: boolean
  expected: number
  answered: number
}

/** peer_results: one member of one group in one round. */
export type PeerResult = {
  round_id: string
  project_id: string
  class_id: string
  kind: PeerRoundKind
  opens_at: string
  is_open: boolean
  board_id: string
  group_name: string | null
  student_id: string
  student_name: string
  received_avg: number | null
  raters: number
  received_spread: number | null
  self_avg: number | null
  given_avg: number | null
  contributes_avg: number | null
  interacts_avg: number | null
  on_track_avg: number | null
  quality_avg: number | null
  skills_avg: number | null
  team_size: number
  rated_all: boolean
}

/** peer_comments: what one teammate wrote about another. Teaching staff only. */
export type PeerComment = {
  round_id: string
  board_id: string
  project_id: string
  ratee_id: string
  ratee_name: string
  rater_id: string
  rater_name: string
  comment: string
  updated_at: string
}

export type PeerRatingInput = {
  ratee_id: string
  contributes: number
  interacts: number
  on_track: number
  quality: number
  skills: number
  comment: string
}

/** peer_form(): what the student's form shows. */
export type PeerForm = {
  round: { id: string; kind: PeerRoundKind; closes_at: string }
  board_id: string
  team: { id: string; name: string; avatar_url: string | null; is_me: boolean }[]
  ratings: PeerRatingInput[]
}
```

- [ ] **Step 4: Write `src/lib/peerDimensions.ts`**

```ts
/**
 * The five CATME behaviours, in our own words. A rating is 1–5. Points 2 and 4
 * sit between the anchors shown for 1, 3 and 5.
 */
export const PEER_DIMENSIONS = [
  {
    key: 'contributes',
    label: "Contributes to the team's work",
    low: 'Does not do a fair share; poor quality',
    mid: 'Does a fair share of acceptable quality',
    high: 'Does more than a fair share; high quality',
  },
  {
    key: 'interacts',
    label: 'Interacts with teammates',
    low: 'Interrupts, ignores or bosses others',
    mid: 'Listens, shares and respects others',
    high: "Asks for and shows interest in others' ideas; makes sure everyone is heard",
  },
  {
    key: 'on_track',
    label: 'Keeps the team on track',
    low: 'Unaware of progress; lets problems slide',
    mid: 'Notices and helps fix problems',
    high: 'Watches progress, gives feedback and helps the team plan',
  },
  {
    key: 'quality',
    label: 'Expects quality',
    low: 'Satisfied with weak work',
    mid: 'Encourages the team to do good work',
    high: 'Motivates the team to excellent work',
  },
  {
    key: 'skills',
    label: 'Has the knowledge and skills the work needs',
    low: 'Missing basic skills the work needs',
    mid: 'Has enough skill to contribute',
    high: 'Has skills that make a real difference, and helps others learn',
  },
] as const

export type PeerDimension = (typeof PEER_DIMENSIONS)[number]['key']
```

- [ ] **Step 5: Write `src/lib/peerMath.ts`**

```ts
import type { Tone } from './analyticsMath'
import type { PeerResult } from './types'

/** Thresholds for reading peer ratings. Each one is a named, tested constant. */
export const PEER_MIN_RATERS = 2
export const FACTOR_LOW = 0.85
export const FACTOR_HIGH = 1.1
export const SELF_GAP = 1.0
export const MANIPULATOR_GAP = 1.5
export const CONFLICT_SPREAD = 1.0
/** Phase C2 caps a suggested score at this multiple of the group score. */
export const FACTOR_CAP = 1.05

// Averages arrive rounded to three places, so a gap of exactly 1.0 must count.
const EPS = 1e-9

export type PeerFlag =
  | 'low'
  | 'high'
  | 'overconfident'
  | 'underconfident'
  | 'manipulator'
  | 'conflict'
  | 'no_response'

export const PEER_FLAG_META: Record<PeerFlag, { label: string; tone: Tone }> = {
  low: { label: 'Rated low by teammates', tone: 'danger' },
  high: { label: 'Rated high by teammates', tone: 'success' },
  overconfident: { label: 'Rates self higher than teammates do', tone: 'warning' },
  underconfident: { label: 'Rates self lower than teammates do', tone: 'pending' },
  manipulator: { label: 'Rates self far above others', tone: 'danger' },
  conflict: { label: 'Teammates disagree', tone: 'warning' },
  no_response: { label: "Didn't rate everyone", tone: 'warning' },
}

export type PeerInput = {
  student_id: string
  received_avg: number | null
  self_avg: number | null
  given_avg: number | null
  raters: number
  received_spread: number | null
  rated_all: boolean
  team_size: number
}

const num = (v: number | null) => (v === null ? null : Number(v))
const round3 = (x: number) => Math.round(x * 1000) / 1000

/**
 * One group in one round: each member's adjustment factor (their average from
 * teammates ÷ the team's mean of the same) and the patterns worth a conversation.
 * Members with fewer than PEER_MIN_RATERS raters get no factor and stay out of
 * the mean, so one person's opinion never moves anyone.
 */
export function analyseTeam<T extends PeerInput>(rows: T[]): (T & { factor: number | null; flags: PeerFlag[] })[] {
  const counted = rows.filter((r) => r.raters >= PEER_MIN_RATERS && r.received_avg !== null)
  const mean = counted.length
    ? counted.reduce((s, r) => s + Number(r.received_avg), 0) / counted.length
    : null

  return rows.map((r) => {
    const received = num(r.received_avg)
    const factor =
      mean && received !== null && r.raters >= PEER_MIN_RATERS ? round3(received / mean) : null
    return { ...r, factor, flags: peerFlags(r, factor) }
  })
}

function peerFlags(r: PeerInput, factor: number | null): PeerFlag[] {
  const out: PeerFlag[] = []
  const received = num(r.received_avg)
  const self = num(r.self_avg)
  const given = num(r.given_avg)
  const spread = num(r.received_spread)
  const enough = r.raters >= PEER_MIN_RATERS

  if (factor !== null && factor < FACTOR_LOW) out.push('low')
  if (factor !== null && factor > FACTOR_HIGH) out.push('high')
  if (enough && self !== null && received !== null) {
    if (self - received >= SELF_GAP - EPS) out.push('overconfident')
    if (received - self >= SELF_GAP - EPS) out.push('underconfident')
  }
  if (factor !== null && factor < 1 && self !== null && given !== null && self - given >= MANIPULATOR_GAP - EPS) {
    out.push('manipulator')
  }
  if (enough && spread !== null && spread >= CONFLICT_SPREAD - EPS) out.push('conflict')
  if (!r.rated_all && r.team_size > 1) out.push('no_response')
  return out
}

/** Each board's most recent round only, which is what a summary should show. */
export function latestRoundRows(rows: PeerResult[]): PeerResult[] {
  const latest = new Map<string, string>()
  for (const r of rows) {
    const cur = latest.get(r.board_id)
    if (!cur || r.opens_at > cur) latest.set(r.board_id, r.opens_at)
  }
  return rows.filter((r) => latest.get(r.board_id) === r.opens_at)
}
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run src/lib/peerMath.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Write `src/lib/api/peer.ts`**

```ts
import { supabase } from '../supabase'
import { pageAll } from './paging'
import type {
  PeerComment,
  PeerForm,
  PeerRatingInput,
  PeerResult,
  PeerRoundKind,
  PeerRoundStatus,
} from '../types'

/** Professor: open a round. The database refuses a second open round or a second final. */
export async function openPeerRound(projectId: string, kind: PeerRoundKind, closesAt: string) {
  const { error } = await supabase.rpc('open_peer_round', {
    p_project: projectId,
    p_kind: kind,
    p_closes_at: closesAt,
  })
  if (error) throw error
}

export async function setPeerRoundClose(roundId: string, closesAt: string) {
  const { error } = await supabase.rpc('set_peer_round_close', {
    p_round: roundId,
    p_closes_at: closesAt,
  })
  if (error) throw error
}

export async function closePeerRound(roundId: string) {
  const { error } = await supabase.rpc('close_peer_round', { p_round: roundId })
  if (error) throw error
}

/** Returns how many students were reminded. Once a day per project. */
export async function remindPeerRound(roundId: string) {
  const { data, error } = await supabase.rpc('remind_peer_round', { p_round: roundId })
  if (error) throw error
  return (data as number | null) ?? 0
}

/** Student: save every rating at once. The database refuses a partial form. */
export async function savePeerRatings(roundId: string, ratings: PeerRatingInput[]) {
  const { error } = await supabase.rpc('save_peer_ratings', {
    p_round: roundId,
    p_ratings: ratings,
  })
  if (error) throw error
}

/** Student: the open round's form, or null when there is nothing to rate. */
export async function peerForm(projectId: string) {
  const { data, error } = await supabase.rpc('peer_form', { p_project: projectId })
  if (error) throw error
  return (data as PeerForm | null) ?? null
}

export async function listPeerRounds(projectId: string) {
  const { data, error } = await supabase
    .from('peer_round_status')
    .select('*')
    .eq('project_id', projectId)
    .order('opens_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PeerRoundStatus[]
}

export async function projectPeerResults(projectId: string) {
  return pageAll<PeerResult>(async (from, to) => {
    const { data, error } = await supabase
      .from('peer_results')
      .select('*')
      .eq('project_id', projectId)
      .order('round_id')
      .order('board_id')
      .order('student_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as PeerResult[]
  })
}

/** Every result the professor can read, for Analytics. Paged: a busy term passes a thousand. */
export async function classPeerResults() {
  return pageAll<PeerResult>(async (from, to) => {
    const { data, error } = await supabase
      .from('peer_results')
      .select('*')
      .order('round_id')
      .order('board_id')
      .order('student_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as PeerResult[]
  })
}

export async function peerComments(roundId: string) {
  const { data, error } = await supabase
    .from('peer_comments')
    .select('*')
    .eq('round_id', roundId)
    .order('ratee_name')
  if (error) throw error
  return (data ?? []) as PeerComment[]
}
```

- [ ] **Step 8: Build, lint, test**

Run: `npm run build && npx eslint src && npm test`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/peerMath.ts src/lib/peerMath.test.ts src/lib/peerDimensions.ts src/lib/api/peer.ts src/lib/types.ts
git commit -m "$(cat <<'EOF'
Add the peer evaluation types, client calls and adjustment factor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The student's "Rate your team" form

**Files:**
- Create: `src/components/peer/RateTeamModal.tsx`
- Create: `src/components/peer/RateTeamButton.tsx`
- Modify: `src/pages/app/projects/ProjectDetail.tsx` (header, next to `SubmitProject` at about line 297)

**Interfaces:**
- Consumes: `peerForm` and `savePeerRatings` (Task 2), `PeerForm`, `PeerRatingInput`, `PEER_DIMENSIONS`, `Modal`, `Button`, `useToast`, `authErrorMessage`.
- Produces: `<RateTeamButton projectId={string} />`. It renders nothing when there is no open round, the student isn't in a group, or the group has one member.

- [ ] **Step 1: Write `src/components/peer/RateTeamModal.tsx`**

```tsx
import { useState } from 'react'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'
import { savePeerRatings } from '../../lib/api/peer'
import { authErrorMessage } from '../../lib/authError'
import { PEER_DIMENSIONS } from '../../lib/peerDimensions'
import type { PeerDimension } from '../../lib/peerDimensions'
import type { PeerForm, PeerRatingInput } from '../../lib/types'

type Draft = Record<string, Partial<Record<PeerDimension, number>> & { comment: string }>

const SCORES = [1, 2, 3, 4, 5] as const

function startDraft(form: PeerForm): Draft {
  const saved = new Map(form.ratings.map((r) => [r.ratee_id, r]))
  return Object.fromEntries(
    form.team.map((m) => {
      const r = saved.get(m.id)
      return [
        m.id,
        r
          ? { contributes: r.contributes, interacts: r.interacts, on_track: r.on_track,
              quality: r.quality, skills: r.skills, comment: r.comment }
          : { comment: '' },
      ]
    }),
  )
}

/**
 * Every teammate, yourself first, on the five behaviours. Save waits until every
 * box is answered, because the database refuses a partial form and a half-saved
 * one would read as "rated low" to the professor.
 */
export function RateTeamModal({
  form,
  open,
  onClose,
  onSaved,
}: {
  form: PeerForm
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { show } = useToast()
  const [draft, setDraft] = useState<Draft>(() => startDraft(form))
  const [saving, setSaving] = useState(false)

  const complete = form.team.every((m) => PEER_DIMENSIONS.every((d) => draft[m.id]?.[d.key]))

  const set = (member: string, key: PeerDimension | 'comment', value: number | string) =>
    setDraft((d) => ({ ...d, [member]: { ...d[member], [key]: value } }))

  const save = async () => {
    setSaving(true)
    try {
      const rows: PeerRatingInput[] = form.team.map((m) => {
        const r = draft[m.id]
        return {
          ratee_id: m.id,
          contributes: r.contributes as number,
          interacts: r.interacts as number,
          on_track: r.on_track as number,
          quality: r.quality as number,
          skills: r.skills as number,
          comment: r.comment.trim(),
        }
      })
      await savePeerRatings(form.round.id, rows)
      show('Ratings saved. You can change them until the round closes.')
      onSaved()
      onClose()
    } catch (err) {
      show(authErrorMessage(err, 'Could not save your ratings. Try again.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Rate your team"
      description="Rate everyone in your group, yourself included. Your teammates never see what you write or who gave which rating."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!complete || saving}>Save ratings</Button>
        </div>
      }
    >
      <div className="space-y-6">
        {form.team.map((m) => (
          <section key={m.id} className="space-y-4 rounded-card border border-line p-4">
            <h3 className="text-ink">{m.is_me ? `You (${m.name})` : m.name}</h3>
            {PEER_DIMENSIONS.map((d) => (
              <fieldset key={d.key} className="space-y-2">
                <legend className="text-[14px] font-medium text-ink">{d.label}</legend>
                <div className="flex flex-wrap gap-1.5" role="radiogroup">
                  {SCORES.map((s) => {
                    const checked = draft[m.id]?.[d.key] === s
                    return (
                      <label
                        key={s}
                        className={`grid h-9 w-11 cursor-pointer place-items-center rounded-lg border font-mono text-[13px] transition-colors ${
                          checked
                            ? 'border-navy-600 bg-navy-600 text-white dark:border-navy-300 dark:bg-navy-300 dark:text-navy-950'
                            : 'border-line text-muted hover:border-line-strong'
                        }`}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name={`${m.id}-${d.key}`}
                          value={s}
                          checked={checked}
                          onChange={() => set(m.id, d.key, s)}
                        />
                        {s}
                      </label>
                    )
                  })}
                </div>
                <p className="grid gap-1 text-[12px] text-faint sm:grid-cols-3">
                  <span>1 · {d.low}</span>
                  <span>3 · {d.mid}</span>
                  <span>5 · {d.high}</span>
                </p>
              </fieldset>
            ))}
            <label className="block space-y-1.5">
              <span className="text-[13px] text-muted">
                Comment <span className="text-faint">(optional, only your professor sees this)</span>
              </span>
              <textarea
                value={draft[m.id]?.comment ?? ''}
                onChange={(e) => set(m.id, 'comment', e.target.value)}
                maxLength={1000}
                rows={2}
                className="w-full rounded-lg border border-line surface px-3 py-2 text-[14px] text-ink"
              />
            </label>
          </section>
        ))}
        {!complete && (
          <p className="text-[13px] text-muted">Answer every row for everyone to save.</p>
        )}
      </div>
    </Modal>
  )
}
```

`Modal` (`src/components/ui/Modal.tsx`) takes `open, onClose, title, description, children, footer, size`. `Button` takes `variant` (`primary | accent | outline | ghost | create | destroy | danger`), `size` and `loading`.

- [ ] **Step 2: Write `src/components/peer/RateTeamButton.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { peerForm } from '../../lib/api/peer'
import type { PeerForm } from '../../lib/types'
import { RateTeamModal } from './RateTeamModal'

const dateFmt = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * Shown in the class project header while a peer evaluation is open for the
 * student's group. It disappears when there is nothing to rate: no open round,
 * not in a group, or alone in one.
 */
export function RateTeamButton({ projectId }: { projectId: string }) {
  const [form, setForm] = useState<PeerForm | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setForm(await peerForm(projectId))
    } catch {
      setForm(null)
    }
  }, [projectId])

  useEffect(() => {
    void load()
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  if (!form || form.team.length < 2) return null

  const done = form.team.every((m) => form.ratings.some((r) => r.ratee_id === m.id))
  const closes = dateFmt.format(new Date(form.round.closes_at))

  return (
    <>
      <Button
        size="sm"
        variant={done ? 'outline' : 'accent'}
        onClick={() => setOpen(true)}
        title={`Closes ${closes}`}
      >
        {done ? 'Edit ratings' : 'Rate your team'}
      </Button>
      {open && (
        <RateTeamModal form={form} open={open} onClose={() => setOpen(false)} onSaved={load} />
      )}
    </>
  )
}
```

`variant="accent"` (amber) marks a call to action here, not a status, which the colour rules allow.

- [ ] **Step 3: Mount it in the class project header**

In `src/pages/app/projects/ProjectDetail.tsx`, replace:

```tsx
            {!canManage && t.active && (
              <SubmitProject variant="header" board={t.active} locked={t.locked} onChanged={t.refresh} />
            )}
```

with:

```tsx
            {!canManage && t.active && (
              <div className="flex flex-wrap items-center gap-2">
                {project.audience === 'group' && <RateTeamButton projectId={project.id} />}
                <SubmitProject variant="header" board={t.active} locked={t.locked} onChanged={t.refresh} />
              </div>
            )}
```

Add `import { RateTeamButton } from '../../../components/peer/RateTeamButton'` beside the other component imports. (`project.audience` is the `ProjectAudience` field, `'group' | 'individual'`, on the project types in `src/lib/types.ts`.)

- [ ] **Step 4: Build and lint**

Run: `npm run build && npx eslint src`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/peer/RateTeamModal.tsx src/components/peer/RateTeamButton.tsx src/pages/app/projects/ProjectDetail.tsx
git commit -m "$(cat <<'EOF'
Let students rate their team from the class project header

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The professor's peer evaluation panel

**Files:**
- Create: `src/components/peer/PeerResultsTable.tsx`
- Create: `src/components/peer/PeerComments.tsx`
- Create: `src/components/peer/PeerRoundsPanel.tsx`
- Modify: `src/components/tasks/ProfessorTasksView.tsx` (Summary section, right after `<HandInQueue … />`)

**Interfaces:**
- Consumes: `listPeerRounds`, `projectPeerResults`, `peerComments`, `openPeerRound`, `setPeerRoundClose`, `closePeerRound`, `remindPeerRound` (Task 2); `analyseTeam`, `PEER_FLAG_META`, `PEER_MIN_RATERS`, `latestRoundRows`; `PEER_DIMENSIONS`; `TONE_CELL` from `src/components/charts/format.ts`; `addDays` and `manilaDay` from `src/lib/analyticsMath.ts`.
- Produces:
  - `<PeerResultsTable rows={PeerResult[]} />`, one board's members.
  - `<PeerComments roundId={string} boardId={string} />`
  - `<PeerRoundsPanel projectId={string} />`

- [ ] **Step 1: Write `src/components/peer/PeerResultsTable.tsx`**

```tsx
import { Fragment, useState } from 'react'
import { TONE_CELL } from '../charts/format'
import { PEER_DIMENSIONS } from '../../lib/peerDimensions'
import { PEER_FLAG_META, PEER_MIN_RATERS, analyseTeam } from '../../lib/peerMath'
import type { PeerResult } from '../../lib/types'

const fmt = (v: number | null, places = 1) => (v === null ? '—' : Number(v).toFixed(places))

/** One group in one round. The factor appears only with enough raters to mean something. */
export function PeerResultsTable({ rows }: { rows: PeerResult[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const team = analyseTeam(rows).sort((a, b) => (a.factor ?? 9) - (b.factor ?? 9))

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13px]">
        <caption className="sr-only">How teammates rated each other</caption>
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-faint">
            <th scope="col" className="px-2 py-2 font-medium">Member</th>
            <th scope="col" className="px-2 py-2 font-medium">From teammates</th>
            <th scope="col" className="px-2 py-2 font-medium">Self</th>
            <th scope="col" className="px-2 py-2 font-medium">Factor</th>
            <th scope="col" className="px-2 py-2 font-medium">Raters</th>
            <th scope="col" className="px-2 py-2 font-medium">Flags</th>
          </tr>
        </thead>
        <tbody>
          {team.map((m) => (
            <Fragment key={m.student_id}>
              <tr className="border-b border-line last:border-0">
                <th scope="row" className="px-2 py-2 text-left font-normal">
                  <button
                    type="button"
                    aria-expanded={openId === m.student_id}
                    onClick={() => setOpenId((v) => (v === m.student_id ? null : m.student_id))}
                    className="text-ink hover:underline"
                  >
                    {m.student_name}
                  </button>
                </th>
                <td className="px-2 py-2 font-mono text-muted">{fmt(m.received_avg)}</td>
                <td className="px-2 py-2 font-mono text-muted">{fmt(m.self_avg)}</td>
                <td className="px-2 py-2 font-mono text-ink">{m.factor === null ? '—' : m.factor.toFixed(2)}</td>
                <td className="px-2 py-2 font-mono text-muted">{m.raters}</td>
                <td className="px-2 py-2">
                  <span className="flex flex-wrap gap-1">
                    {m.flags.map((f) => (
                      <span key={f} className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[PEER_FLAG_META[f].tone]}`}>
                        {PEER_FLAG_META[f].label}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
              {openId === m.student_id && (
                <tr className="border-b border-line">
                  <td colSpan={6} className="px-2 pb-3">
                    <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                      {PEER_DIMENSIONS.map((d) => (
                        <div key={d.key} className="flex justify-between gap-3 text-[12px]">
                          <dt className="text-muted">{d.label}</dt>
                          <dd className="font-mono text-ink">{fmt(m[`${d.key}_avg`], 2)}</dd>
                        </div>
                      ))}
                    </dl>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[12px] text-faint">
        Factor is a member's average from teammates divided by the team's. It appears once at
        least {PEER_MIN_RATERS} teammates have rated them.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Write `src/components/peer/PeerComments.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { peerComments } from '../../lib/api/peer'
import type { PeerComment } from '../../lib/types'

/**
 * What teammates wrote, grouped by who it is about. Rater names stay hidden until
 * asked for, so a professor reads the substance before the source.
 */
export function PeerComments({ roundId, boardId }: { roundId: string; boardId: string }) {
  const [rows, setRows] = useState<PeerComment[] | null>(null)
  const [showRaters, setShowRaters] = useState(false)

  useEffect(() => {
    let live = true
    peerComments(roundId)
      .then((all) => live && setRows(all.filter((c) => c.board_id === boardId)))
      .catch(() => live && setRows([]))
    return () => {
      live = false
    }
  }, [roundId, boardId])

  if (rows === null) return null
  if (rows.length === 0) return <p className="text-[12px] text-faint">No written comments.</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium text-muted">Comments ({rows.length})</p>
        <button
          type="button"
          onClick={() => setShowRaters((v) => !v)}
          aria-pressed={showRaters}
          className="text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
        >
          {showRaters ? 'Hide raters' : 'Show raters'}
        </button>
      </div>
      <ul className="space-y-1.5">
        {rows.map((c) => (
          <li key={`${c.rater_id}-${c.ratee_id}`} className="rounded-lg surface-sunken px-3 py-2 text-[13px]">
            <span className="text-faint">About {c.ratee_name}{showRaters && `, from ${c.rater_name}`}: </span>
            <span className="text-ink">{c.comment}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Write `src/components/peer/PeerRoundsPanel.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useLive } from '../../hooks/useLive'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import {
  closePeerRound,
  listPeerRounds,
  openPeerRound,
  projectPeerResults,
  remindPeerRound,
  setPeerRoundClose,
} from '../../lib/api/peer'
import { authErrorMessage } from '../../lib/authError'
import { addDays, manilaDay } from '../../lib/analyticsMath'
import { latestRoundRows } from '../../lib/peerMath'
import type { PeerResult, PeerRoundKind, PeerRoundStatus } from '../../lib/types'
import { PeerComments } from './PeerComments'
import { PeerResultsTable } from './PeerResultsTable'

const KIND: Record<PeerRoundKind, string> = { check_in: 'Check-in', final: 'Final' }
const dateFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })
/** A date input's day, closing at the end of that Manila day. */
const endOfDay = (day: string) => `${day}T23:59:00+08:00`

/**
 * Peer evaluation on one group project: open a round, watch who has answered,
 * remind the rest, and read the results group by group. Only the final round
 * will feed scores (Phase C2); a check-in is an early warning.
 */
export function PeerRoundsPanel({ projectId }: { projectId: string }) {
  const { show } = useToast()
  const [rounds, setRounds] = useState<PeerRoundStatus[]>([])
  const [results, setResults] = useState<PeerResult[]>([])
  const [kind, setKind] = useState<PeerRoundKind>('check_in')
  const [day, setDay] = useState(() => addDays(manilaDay(new Date()), 5))
  const [extendDay, setExtendDay] = useState('')
  const [closing, setClosing] = useState<PeerRoundStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [r, res] = await Promise.all([listPeerRounds(projectId), projectPeerResults(projectId)])
      setRounds(r)
      setResults(res)
    } catch (err) {
      show(authErrorMessage(err, 'Could not load the peer evaluation.'), 'error')
    }
  }, [projectId, show])

  useEffect(() => {
    void load()
  }, [load])
  useLive(load, ['peer_rounds', 'peer_ratings', 'group_members'])

  const openRound = rounds.find((r) => r.is_open) ?? null
  const hasFinal = rounds.some((r) => r.kind === 'final')
  const missing = openRound
    ? results.filter((r) => r.round_id === openRound.id && !r.rated_all && r.team_size > 1)
    : []
  const latest = latestRoundRows(results)
  const boards = [...new Set(latest.map((r) => r.board_id))]

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await fn()
      show(done)
      await load()
    } catch (err) {
      show(authErrorMessage(err, 'That did not go through. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-panel border border-line p-4 sm:p-5">
      <header>
        <h3>Peer evaluation</h3>
        <p className="mt-0.5 max-w-[66ch] text-[13px] text-muted">
          Students rate everyone in their group, themselves included, on five behaviours. A check-in
          warns early. Only the final round will feed scores.
        </p>
      </header>

      {openRound ? (
        <div className="space-y-3 rounded-card surface-sunken p-3">
          <p className="text-[14px] text-ink">
            {KIND[openRound.kind]} round open until {dateFmt.format(new Date(openRound.closes_at))} ·{' '}
            <span className="font-mono">{openRound.answered} of {openRound.expected}</span> answered
          </p>
          {missing.length > 0 && (
            <p className="text-[13px] text-muted">
              Still to answer: {missing.map((m) => m.student_name).join(', ')}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || missing.length === 0}
              onClick={() =>
                act(async () => {
                  const n = await remindPeerRound(openRound.id)
                  return n
                }, 'Reminder sent to those who have not answered')
              }
            >
              Send reminder
            </Button>
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Extend to
              <input
                type="date"
                value={extendDay}
                min={addDays(manilaDay(new Date()), 1)}
                onChange={(e) => setExtendDay(e.target.value)}
                className="h-9 rounded-lg border border-line surface px-2 text-ink"
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !extendDay}
              onClick={() => act(() => setPeerRoundClose(openRound.id, endOfDay(extendDay)), 'Closing date moved')}
            >
              Extend
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setClosing(openRound)}>
              Close now
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-[13px] text-muted">
            <span className="block">Round</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as PeerRoundKind)}
              className="h-9 rounded-lg border border-line surface px-2 text-ink"
            >
              <option value="check_in">Check-in</option>
              <option value="final" disabled={hasFinal}>
                Final{hasFinal ? ' (already run)' : ''}
              </option>
            </select>
          </label>
          <label className="space-y-1 text-[13px] text-muted">
            <span className="block">Closes at the end of</span>
            <input
              type="date"
              value={day}
              min={manilaDay(new Date())}
              onChange={(e) => setDay(e.target.value)}
              className="h-9 rounded-lg border border-line surface px-2 text-ink"
            />
          </label>
          <Button
            size="sm"
            disabled={busy || !day}
            onClick={() => act(() => openPeerRound(projectId, kind, endOfDay(day)), 'Round opened. The groups have been told.')}
          >
            Open round
          </Button>
        </div>
      )}

      {rounds.length > 0 && (
        <ul className="space-y-1 text-[12px] text-faint">
          {rounds.map((r) => (
            <li key={r.id}>
              {KIND[r.kind]} · {dateFmt.format(new Date(r.opens_at))} to {dateFmt.format(new Date(r.closed_at ?? r.closes_at))} ·{' '}
              {r.answered} of {r.expected} answered{r.is_open ? ' · open' : ''}
            </li>
          ))}
        </ul>
      )}

      {boards.length > 0 && (
        <div className="space-y-5 border-t border-line pt-4">
          {boards.map((b) => {
            const rows = latest.filter((r) => r.board_id === b)
            const first = rows[0]
            return (
              <div key={b} className="space-y-2">
                <p className="text-[13px] font-medium text-ink">
                  {first.group_name ?? 'Group'} · {KIND[first.kind]}
                  {first.is_open && <span className="text-faint"> · in progress</span>}
                </p>
                <PeerResultsTable rows={rows} />
                <PeerComments roundId={first.round_id} boardId={b} />
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={closing !== null}
        title="Close this round now?"
        body="Students can no longer save or change ratings. You can still open a new round afterwards."
        confirmLabel="Close round"
        onClose={() => setClosing(null)}
        onConfirm={() => {
          const r = closing
          setClosing(null)
          if (r) void act(() => closePeerRound(r.id), 'Round closed')
        }}
      />
    </section>
  )
}
```

`ConfirmDialog` (`src/components/ui/ConfirmDialog.tsx`) takes `open`, `onClose`, `onConfirm`, `title`, `body`, `confirmLabel` and an optional `tone`.

- [ ] **Step 4: Mount the panel on the Work tab**

In `src/components/tasks/ProfessorTasksView.tsx`, inside `t.section === 'summary'`, add this right after the `<HandInQueue … />` element:

```tsx
          {!solo && <PeerRoundsPanel projectId={project.id} />}
```

Also add `import { PeerRoundsPanel } from '../peer/PeerRoundsPanel'`.

- [ ] **Step 5: Build and lint**

Run: `npm run build && npx eslint src`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/peer/PeerResultsTable.tsx src/components/peer/PeerComments.tsx src/components/peer/PeerRoundsPanel.tsx src/components/tasks/ProfessorTasksView.tsx
git commit -m "$(cat <<'EOF'
Add a peer evaluation panel to a group project's Work tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Peer results in Analytics

**Files:**
- Modify: `src/pages/app/analytics/useAnalytics.ts` (load and narrow peer results)
- Modify: `src/pages/app/analytics/views/GroupsView.tsx` (new section)
- Modify: `src/components/analytics/StudentDrawer.tsx` (one line on the student's latest factor and flags)

**Interfaces:**
- Consumes: `classPeerResults` (Task 2), `latestRoundRows`, `analyseTeam`, `PEER_FLAG_META` (Task 2), `PeerResultsTable` (Task 4), `TONE_CELL`.
- Produces: `AnalyticsData.shownPeer: PeerResult[]`, filtered to live boards and to the scope (class, project, board).

- [ ] **Step 1: Load peer results in `useAnalytics.ts`**

Import `classPeerResults` from `../../../lib/api/peer` and the `PeerResult` type. Add `const [peer, setPeer] = useState<PeerResult[]>([])`. Then add `classPeerResults()` as the last entry of the `Promise.all` array and add its result to the destructuring as `pe`.

After the existing live-board filtering (the `live` set built from `cy`), add `setPeer(pe.filter((r) => live.has(r.board_id)))`.

Add `'peer_ratings'` and `'peer_rounds'` to the `useLive` table list.

After the other `shown*` memos, add:

```ts
  const shownPeer = useMemo(
    () =>
      peer
        .filter((r) => (scope.classId ? r.class_id === scope.classId : true))
        .filter((r) => (scope.projectId ? r.project_id === scope.projectId : true))
        .filter((r) => (scope.boardId ? r.board_id === scope.boardId : true)),
    [peer, scope],
  )
```

Return `shownPeer` from the hook, next to `shownSprints`.

- [ ] **Step 2: Add the Groups section**

In `src/pages/app/analytics/views/GroupsView.tsx`:
- import `latestRoundRows` from `../../../../lib/peerMath`;
- import `PeerResultsTable` from `../../../../components/peer/PeerResultsTable`.

Add this section after "Who holds the work":

```tsx
      <Section
        title="How teammates rated each other"
        subtitle="Each group's latest peer evaluation. A factor below 0.85 means teammates rated someone well under the group's average. Use it to start a conversation, not to decide a grade."
      >
        {(() => {
          const latest = latestRoundRows(data.shownPeer)
          const boards = [...new Set(latest.map((r) => r.board_id))]
          if (boards.length === 0) {
            return (
              <p className="text-[13px] text-muted">
                No peer evaluation yet. Open one from a group project's Work tab.
              </p>
            )
          }
          return (
            <div className="space-y-6">
              {boards.map((b) => {
                const rows = latest.filter((r) => r.board_id === b)
                const first = rows[0]
                return (
                  <div key={b} className="space-y-2">
                    <p className="text-[13px] text-ink">
                      {first.group_name ?? 'Group'}{' '}
                      <span className="text-faint">
                        · {first.kind === 'final' ? 'Final' : 'Check-in'}
                        {first.is_open ? ' · in progress' : ''}
                      </span>
                    </p>
                    <PeerResultsTable rows={rows} />
                  </div>
                )
              })}
            </div>
          )
        })()}
      </Section>
```

- [ ] **Step 3: Add the line to the student drawer**

In `src/components/analytics/StudentDrawer.tsx`:
- import `analyseTeam`, `latestRoundRows` and `PEER_FLAG_META` from `../../lib/peerMath`.

Before the `return (`, compute:

```ts
  const peerRows = latestRoundRows(data.shownPeer.filter((r) => r.class_id === entry.class_id))
  const myPeerBoard = peerRows.find((r) => r.student_id === entry.student_id)?.board_id
  const myPeer = myPeerBoard
    ? analyseTeam(peerRows.filter((r) => r.board_id === myPeerBoard)).find(
        (r) => r.student_id === entry.student_id,
      )
    : undefined
```

Inside the drawer, right after the flags paragraph, render:

```tsx
        <p className="text-[13px] text-muted">
          {myPeer
            ? <>Teammates' rating: <span className="font-mono text-ink">{myPeer.factor === null ? 'too few raters' : `factor ${myPeer.factor.toFixed(2)}`}</span>
              {myPeer.flags.map((f) => (
                <span key={f} className={`ml-1.5 rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[PEER_FLAG_META[f].tone]}`}>
                  {PEER_FLAG_META[f].label}
                </span>
              ))}</>
            : 'No peer evaluation yet.'}
        </p>
```

`StudentDrawer` has an early `if (!entry) return null`. Its hooks must stay above that line. These new lines are plain computations, not hooks, so they go after the early return.

- [ ] **Step 4: Build, lint, test**

Run: `npm run build && npx eslint src && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/app/analytics/useAnalytics.ts src/pages/app/analytics/views/GroupsView.tsx src/components/analytics/StudentDrawer.tsx
git commit -m "$(cat <<'EOF'
Show peer evaluation results in Analytics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Check it in the browser, record, ship

**Files:**
- Modify: `handoff.md` (append a section)

- [ ] **Step 1: Run every gate again**

Run:
```bash
npm run build && npx eslint src && npm test
node scripts/db.mjs supabase/tests/peer-evaluation.test.sql
node scripts/db.mjs supabase/tests/rls-coverage.test.sql
node scripts/db.mjs supabase/tests/anon-lockdown.test.sql
node scripts/db.mjs supabase/tests/analytics-trends.test.sql
```
Expected: all pass.

- [ ] **Step 2: The professor's side, in the dev server**

Start `preview_start` with the name `collabify`. Signed in as the faculty account, open a **group** project's Work tab and check:
- The Peer evaluation panel shows.
- Open a check-in round closing in 2 days. It shows as "open until …" with "0 of N answered".
- A toast confirms the round is open.

- [ ] **Step 3: The student's side**

This needs a student account in the same group. Ask the user to sign in as a student in the browser pane, or to provide a test student login. Do not create accounts or enter passwords without the user, per the testing rules. As the student:
- "Rate your team" shows in the project header.
- The modal lists the team with "You" first.
- Save stays disabled until every row is answered.
- Saving shows the toast, and the button changes to "Edit ratings".

- [ ] **Step 4: Back to the professor**

- The panel shows "1 of N answered" and lists who is still to answer.
- Send reminder works once. A second try the same day shows the refusal.
- Close now asks for confirmation, then the round closes.
- The results table appears for the group. Expanding a member shows the five dimensions. Show raters reveals names.
- Analytics → Groups has "How teammates rated each other".
- The student drawer shows the peer line.
- Check light and dark at 1440 and 375 widths. The console is clean.

- [ ] **Step 5: Record it in `handoff.md`**

Append:

```markdown
## Phase C1 — peer evaluation (2026-10-13)

Spec: `docs/superpowers/specs/2026-10-13-phase-c-grading-design.md` (C1).
Plan: `docs/superpowers/plans/2026-10-13-phase-c1-peer-evaluation.md`.

**What.**
- Professors open check-in or final rounds on a group project from its Work tab, in the Peer evaluation panel.
- Students rate every group member, themselves included, on five CATME behaviours (1–5, anchors in `lib/peerDimensions.ts`) through "Rate your team" in the project header.
- Results appear in the panel, in Analytics → Groups, and in the student drawer.

**Data.** `supabase/peer-evaluation.sql`.
- Tables: `peer_rounds` and `peer_ratings`.
- Writes go through functions only: `open_peer_round`, `set_peer_round_close`, `close_peer_round`, `remind_peer_round`, `save_peer_ratings`. The student's form is read with `peer_form`.
- Views, readable by teaching staff only: `peer_results`, `peer_round_status`, `peer_comments`.
- Ratings are readable by the rater and teaching staff, never by the person rated.
- Teammates are current group members, so anyone who leaves drops out of every average.

**Arithmetic.** `lib/peerMath.ts`.
- factor = received average ÷ the team's mean, shown only with at least 2 raters.
- Flags: low < 0.85, high > 1.10, over/underconfident ±1.0, manipulator (self 1.5 above what they gave others, factor < 1), conflict (raters spread ≥ 1.0), didn't rate.
- `FACTOR_CAP` 1.05 is for C2.

**Decided while planning.**
- A closed project can still open a final round. Only archived projects are refused.
- The reminder limit reads notifications until C3 moves it to the notes log.
- `my_peer_summary` is built in C2.

**Next.** C2: rubric scoring, individual adjustment from the final round, release, the student grade card.
```

- [ ] **Step 6: Commit, merge, push, verify live**

```bash
git add handoff.md
git commit -m "$(cat <<'EOF'
Record peer evaluation in the handoff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

Fast-forward `main` to the branch and push. Wait for the Vercel status on the commit to read `success`. Then confirm the live bundle contains "Rate your team" and "Peer evaluation".
