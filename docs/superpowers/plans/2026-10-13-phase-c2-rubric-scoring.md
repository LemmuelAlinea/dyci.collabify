# Phase C2: Rubric Scoring and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Professors score each board against the project rubric, confirm each student's individual score (suggested from the group score and the final peer round), and release grades. Students then see a "Your grade" card.

**Architecture:** The new `supabase/scoring.sql` adds four tables (`board_scores`, `member_scores`, `score_releases`, `score_history`).
- Every write goes through security-definer functions.
- Triggers keep the history and lock the rubric's points while scores exist.
- The suggestion rule lives in SQL (`suggest_score`) and in TypeScript (`src/lib/scoreMath.ts`), and both are tested against the same hand values.
- The professor works in a Grades table (Work → Summary) and a Score card (the board panel).
- The student reads one RPC, `my_grade`, which carries the peer summary.

**Tech Stack:** Supabase Postgres (plpgsql, RLS), React 19 + TypeScript + Vite, Tailwind tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-phase-c-grading-design.md` (section "C2: rubric scoring and release", plus "Shared rules" and "Testing").

## Spec corrections (rulings made while planning)

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| 1 | The stable-rubric work changes `series_write_criteria` (`supabase/project-series.sql`) to an upsert **by position**. It also deletes the unused `replaceCriteria`. | Editing a project goes through `update_project_series` → `series_write_criteria` (delete-all, insert). `replaceCriteria` has no caller. Criteria inputs carry no id, and one edit can span several sections, each with its own ids. Matching by position is safe because the lock refuses every structural change while scores exist. | A reorder feature added later would need ids. |
| 2 | `board_scores.criterion_id` is `on delete cascade`, not `restrict`. | The lock trigger already refuses criterion deletes while scores exist. With `restrict`, deleting a scored project would fail on the order in which cascades run. | None while the trigger exists. |
| 3 | `projects.total_points` locks with the criteria. | The spec says "points … lock". A total that changes under confirmed scores makes "84 / 100" read as "84 / 50". | A professor must clear scores to change the total. |
| 4 | The history column is `by_user`, not `by`. | `by` is an SQL keyword. | None. |
| 5 | `suggest_score` caps at the total in both branches (with and without a factor). | The spec's testing section says "never above the total". The criteria can sum past the total, because the editor only warns. | None. |
| 6 | A confirmed `final` must be a multiple of 0.5 and at most `total_points`. | Same reasoning as 5. It also matches the 0.5 steps of criterion points. | A professor cannot give a bonus above the total. |
| 7 | `clear_project_scores` also deletes the project's `score_releases` row. | Otherwise new scores would be visible to students the moment they are saved, before anyone confirms them. | None. |
| 8 | The student reads one RPC, `my_grade(p_project)`. It embeds `my_peer_summary(p_project)` as its `peer` field. Both functions exist. | One round trip, and the spec's `my_peer_summary` is still a callable function. | None. |
| 9 | The professor's per-member data comes from a function, `score_sheet(p_project)`, not a view. | A view on `peer_results` would block re-running `peer-evaluation.sql` (it drops its views without cascade). A string-bodied function records no dependency, and the project parameter keeps the read to one project. | None. |
| 10 | `grades_released` is gated by the `announcements` preference. | It is news from the professor, which is what that switch covers. | A student with announcements off misses the notice. The card still appears on the Brief tab. |
| 11 | `scoring.sql` adds its own tables to the `supabase_realtime` publication inline. | `live.sql` runs before `scoring.sql` in a rebuild, so listing the tables there would skip them. | None. |
| 12 | The Clear scores… action in the rubric editor confirms inline (a revealed row), not in a second modal. | The editor already sits inside the project modal, and modals do not stack well. | None. |

## Global Constraints

- Every new SQL file is idempotent: `create … if not exists`, `create or replace`, `drop … if exists`.
- A new notification enum value goes in its own committed transaction before the main `begin;`.
- Every write is a `security definer` function with `set search_path = public`. New tables get no insert, update or delete policies.
- Refusals raise `check_violation` (or `insufficient_privilege` for the wrong person) with a sentence a person can act on.
- New tables enable row-level security. `revoke all … from anon` and `grant select … to authenticated` go inline in the file. Re-run `node scripts/db.mjs supabase/anon-lockdown.sql` after any function change.
- Add every new SQL file to the `scripts/schema-drift.mjs` ORDER string and to **both** rebuild command lines in `docs/07-backup.md` (lines 26 and 53), after `peer-evaluation.sql`.
- The live database is the only database. `node scripts/db.mjs <file>` runs SQL on it. Test files wrap everything in `begin; … rollback;`.
- Colors come only from tokens (`TONE_CELL` in `src/components/charts/format.ts`, `text-ink`, `text-muted`, `text-faint`, `border-line`, `surface`, `surface-sunken`). No raw hex, no `emerald-*` or `red-*`.
- Copy: sentence case, active voice, no "please", no "successfully", no exclamation marks. An error says what happened and what to do next.
- Days are Manila days. Use `timeZone: 'Asia/Manila'` in `Intl.DateTimeFormat`.
- Thresholds are named constants. `PEER_MIN_RATERS = 2` and `FACTOR_CAP = 1.05` live in `src/lib/peerMath.ts`. The SQL repeats them with a comment naming the TypeScript constant.
- Render-time clocks use `useNow()` from `src/hooks/useNow.ts`. The purity lint rule rejects `Date.now()` in render.
- `react-refresh/only-export-components`: a `.tsx` file exports components only. Hooks and types go in `.ts` files.
- An `sr-only` table goes inside an `sr-only` div. An `sr-only` input needs a `relative` parent.
- Never stage `cinema/`, `cinema-portrait/`, `launch-video/`, `.claude/launch.json`, `.gitignore` or `supabase/.temp/`. Stage files by name.
- File edits use the Edit or Write tools, never PowerShell `Set-Content`.
- Before claiming a task is done, run `npm run build` (tsc first), `npx eslint src` and `npx vitest run`.
- The grading suggestion rule, verbatim from the spec:
  ```
  groupTotal = sum(board_scores.points)
  factor     = final-round factor for the student, or null
             (null when there is no final round, it is still open, or there are fewer than PEER_MIN_RATERS raters)
  suggested  = factor == null ? groupTotal
             : min(projects.total_points, roundHalf(groupTotal * min(factor, FACTOR_CAP)))
  roundHalf(x) = round(x * 2) / 2
  ```
  Ruling 5 adds `min(total_points, …)` to the no-factor branch.

## Review Focus

1. **A professor types `7.25`, `abc`, a negative number or nothing into a criterion box.** Save stays disabled, the box says why, and nothing partial reaches the database. *Task 2 tests the server side (quarter points, missing criterion). Task 5 checks the client side in the browser.*
2. **Group membership changes after a confirm** (a student joins or leaves). The next confirm must cover exactly the current members. The newcomer shows up unconfirmed, and the board drops back to "Scored". *Task 2 test: add `d` to the group, a confirm without `d` is refused, and the sheet shows `d` unconfirmed.*
3. **The final peer round is reopened or closed after a confirm.** Today's suggestion differs from the stored one, and the card shows "Suggestion changed". *Task 2 test: confirm while the round is open, close it, and `suggestion_changed` is true.*
4. **Grades are released and the professor then changes a criterion.** The student's breakdown changes at once, while their confirmed score stays until a reconfirm. The card says so. *Task 2 test: after release, a save is allowed, `my_grade.final` is unchanged, `group_total` moves, and `suggestion_changed` is true.*
5. **An edit to a project in a series where one section is scored.** The refusal names the section, and the other sections are left as they were. *Task 4 test: `update_project_series` with changed points on a scored project fails, and the message contains the section label and "Scores exist".*

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/scoring.sql` (new) | Tables, triggers (point bounds, history, rubric and total lock), RLS, functions, `score_sheet`, `my_grade`, `my_peer_summary`, realtime publication. |
| `supabase/tests/scoring.test.sql` (new) | Rolled-back SQL suite for everything above. |
| `supabase/project-series.sql` (modify) | `series_write_criteria` writes the rubric by position. `update_project_series` labels a rubric refusal with its section. |
| `src/lib/scoreMath.ts` + `.test.ts` (new) | `suggestScore`, `isHalfStep`, `formatPoints`, `boardScoreStatus`, `SCORE_STATUS_META`. |
| `src/lib/api/scores.ts` (new) | RPC and table reads and writes for scores. |
| `src/lib/types.ts` (modify) | `ScoreSheetRow`, `BoardScore`, `MyGrade`, `MyPeerSummary`, and the `grades_released` notification type. |
| `src/lib/api/projects.ts` (modify) | Delete the unused `replaceCriteria`. |
| `src/components/projects/{RubricEditor,ProjectForm,ProjectWizard}.tsx` (modify) | Rubric lock display and Clear scores…. |
| `src/pages/app/projects/ProjectDetail.tsx` (modify) | Loads `projectHasScores` for professors, wires the wizard, and mounts `GradeCard` for students. |
| `src/components/scoring/useProjectScores.ts` (new) | Loads everything the professor's grading UI reads. |
| `src/components/scoring/GradesTable.tsx` (new) | The Summary "Grades" table, with Release, Unrelease and Clear. |
| `src/components/scoring/ScoreCard.tsx` (new) | The board panel's criterion inputs and members table. |
| `src/components/scoring/GradeCard.tsx` (new) | The student's "Your grade" card. |
| `src/components/tasks/ProfessorTasksView.tsx` (modify) | Mounts the Grades table and the Score card. |
| `supabase/results.sql`, `supabase/reports.sql`, `handoff.md`, `supabase/tests/reports.test.sql` (modify) | Rewrite the "no grade" rule. |
| `scripts/schema-drift.mjs`, `docs/07-backup.md` (modify) | Rebuild order. |

---

### Task 1: Scoring tables, triggers, lock and row-level security

**Files:**
- Create: `supabase/scoring.sql`
- Create: `supabase/tests/scoring.test.sql`
- Modify: `scripts/schema-drift.mjs` (ORDER string ends `… analytics-trends peer-evaluation`; append ` scoring`)
- Modify: `docs/07-backup.md:26` and `docs/07-backup.md:53` (append ` supabase/scoring.sql` to both command lines), plus one paragraph after the `peer-evaluation.sql` note (~line 185)

**Interfaces:**
- Consumes:
  - `public.is_board_professor(uuid)`, `public.is_board_member(uuid)`, `public.is_project_professor(uuid)` and `public.project_is_live(uuid)` (existing);
  - `public.peer_project_archived(uuid)` (peer-evaluation.sql).
- Produces:
  - Tables `board_scores`, `member_scores`, `score_releases` and `score_history` (columns below).
  - Internal functions `scores_exist(uuid)`, `score_board_project(uuid)` and `project_scores_released(uuid)`.
  - The client function `project_has_scores(uuid) → boolean`, which returns false for anyone not teaching the project.
  - The notification enum value `grades_released`.
  - The fixture table `fx` in the test file, with keys `prof a b c d set group proj solo board solo_board crit_a crit_b crit_s`.

- [ ] **Step 1: Write the failing test file**

Create `supabase/tests/scoring.test.sql`:

```sql
-- Rubric scoring — rolled back, touches nothing permanently.
--
--   node scripts/db.mjs supabase/tests/scoring.test.sql
--
-- Every refusal is paired with a control that succeeds. Peer factors use the same
-- three students and ratings as peer-evaluation.test.sql:
--   a rates a=5 b=4 c=2 · b rates a=4 b=4 c=2 · c rates a=4 b=3 c=5
-- Received (self excluded): a 4.0 · b 3.5 · c 2.0, team mean 3.1667, so the
-- factors are a 1.263 · b 1.105 · c 0.632. On a group score of 80 the
-- suggestions are a 84 (capped at 1.05) · b 84 (capped) · c 50.5.

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
  if coalesce(p_got, false) then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end;
$$;

/** Points for the group project's two criteria, as save_board_scores takes them. */
create or replace function pg_temp.pts(p_a uuid, s_a numeric, p_b uuid, s_b numeric) returns text
language sql as $$
  select jsonb_build_array(
    jsonb_build_object('criterion_id', p_a, 'points', s_a),
    jsonb_build_object('criterion_id', p_b, 'points', s_b))::text;
$$;

/** Final scores for a, b and c, as confirm_member_scores takes them. */
create or replace function pg_temp.finals(p_a uuid, f_a numeric, p_b uuid, f_b numeric, p_c uuid, f_c numeric)
returns text language sql as $$
  select jsonb_build_array(
    jsonb_build_object('student_id', p_a, 'final', f_a),
    jsonb_build_object('student_id', p_b, 'final', f_b),
    jsonb_build_object('student_id', p_c, 'final', f_c))::text;
$$;

/** Everyone in the order (a, b, c) rated with one score across all five dimensions. */
create or replace function pg_temp.ratings(p_a uuid, s_a int, p_b uuid, s_b int, p_c uuid, s_c int)
returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('ratee_id', p_a, 'contributes', s_a, 'interacts', s_a, 'on_track', s_a,
                       'quality', s_a, 'skills', s_a, 'comment', ''),
    jsonb_build_object('ratee_id', p_b, 'contributes', s_b, 'interacts', s_b, 'on_track', s_b,
                       'quality', s_b, 'skills', s_b, 'comment', ''),
    jsonb_build_object('ratee_id', p_c, 'contributes', s_c, 'interacts', s_c, 'on_track', s_c,
                       'quality', s_c, 'skills', s_c, 'comment', ''));
$$;

-- ---------------------------------------------------------------- fixture

do $$
declare
  v_class uuid; v_prof uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_set uuid; v_g uuid; v_proj uuid; v_solo uuid; v_board uuid; v_solo_board uuid;
  v_ca uuid; v_cb uuid; v_cs uuid;
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
  values (v_class, 'zz-score-fixture', 'manual') returning id into v_set;
  insert into public.groups (set_id, name) values (v_set, 'zz-score-group') returning id into v_g;
  insert into public.group_members (group_id, set_id, student_id)
  values (v_g, v_set, v_a), (v_g, v_set, v_b), (v_g, v_set, v_c);

  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id,
     total_points, due_at)
  values (v_class, v_prof, 'zz-score-proj', 'activity', 1, 2, 'group', v_set, 100,
          now() + interval '5 days')
  returning id into v_proj;
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, total_points, due_at)
  values (v_class, v_prof, 'zz-score-solo', 'activity', 1, 2, 'individual', 50,
          now() + interval '5 days')
  returning id into v_solo;

  insert into public.project_criteria (project_id, position, label, description, max_points)
  values (v_proj, 1, 'zz-Function', 'It works', 60) returning id into v_ca;
  insert into public.project_criteria (project_id, position, label, description, max_points)
  values (v_proj, 2, 'zz-Docs', 'It is explained', 40) returning id into v_cb;
  insert into public.project_criteria (project_id, position, label, description, max_points)
  values (v_solo, 1, 'zz-Solo', 'All of it', 50) returning id into v_cs;

  perform public.ensure_project_boards(v_proj);
  perform public.ensure_project_boards(v_solo);
  select id into v_board from public.project_boards where project_id = v_proj and group_id = v_g;
  select id into v_solo_board from public.project_boards where project_id = v_solo and student_id = v_a;

  create temp table fx (k text primary key, v uuid) on commit drop;
  grant select, insert, update on fx to authenticated;
  insert into fx values
    ('prof', v_prof), ('a', v_a), ('b', v_b), ('c', v_c), ('d', v_d),
    ('set', v_set), ('group', v_g), ('proj', v_proj), ('solo', v_solo),
    ('board', v_board), ('solo_board', v_solo_board),
    ('crit_a', v_ca), ('crit_b', v_cb), ('crit_s', v_cs);
  raise notice 'fixture ready';
end $$;

-- ------------------------------------------------- points and history (Task 1)

do $$
declare
  v_board uuid := (select v from fx where k='board');
  v_ca uuid := (select v from fx where k='crit_a');
  v_cs uuid := (select v from fx where k='crit_s');
  n int;
begin
  perform pg_temp.act_as_service();
  perform pg_temp.must_refuse('points above the criterion''s maximum are refused',
    format('insert into public.board_scores (board_id, criterion_id, points) values (%L, %L, 61)', v_board, v_ca));
  perform pg_temp.must_refuse('points come in whole or half steps',
    format('insert into public.board_scores (board_id, criterion_id, points) values (%L, %L, 2.3)', v_board, v_ca));
  perform pg_temp.must_refuse('negative points are refused',
    format('insert into public.board_scores (board_id, criterion_id, points) values (%L, %L, -1)', v_board, v_ca));
  perform pg_temp.must_refuse('a criterion from another project is refused',
    format('insert into public.board_scores (board_id, criterion_id, points) values (%L, %L, 5)', v_board, v_cs));
  perform pg_temp.must_allow('with no scores yet, the rubric''s points can change',
    format('update public.project_criteria set max_points = 60 where id = %L', v_ca));
  perform pg_temp.must_allow('the maximum itself is a valid score',
    format('insert into public.board_scores (board_id, criterion_id, points) values (%L, %L, 60)', v_board, v_ca));

  select count(*) into n from public.score_history
   where board_id = v_board and action = 'criterion' and old_value is null and new_value = 60;
  perform pg_temp.must_be('a first score writes a history row', n = 1);

  update public.board_scores set points = 52.5 where board_id = v_board and criterion_id = v_ca;
  select count(*) into n from public.score_history
   where board_id = v_board and action = 'criterion' and old_value = 60 and new_value = 52.5;
  perform pg_temp.must_be('a changed score records the old and new points', n = 1);

  update public.board_scores set points = 52.5 where board_id = v_board and criterion_id = v_ca;
  select count(*) into n from public.score_history where board_id = v_board and action = 'criterion';
  perform pg_temp.must_be('saving the same points again writes nothing', n = 2);
end $$;

-- ------------------------------------------------------- the lock (Task 1)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_proj uuid := (select v from fx where k='proj');
  v_ca uuid := (select v from fx where k='crit_a');
  v_cb uuid := (select v from fx where k='crit_b');
begin
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('scores lock a criterion''s points',
    format('update public.project_criteria set max_points = 50 where id = %L', v_ca));
  perform pg_temp.must_refuse('scores lock the order',
    format('update public.project_criteria set position = 3 where id = %L', v_ca));
  perform pg_temp.must_refuse('scores lock out a new criterion',
    format('insert into public.project_criteria (project_id, position, label, max_points) values (%L, 3, ''zz-extra'', 5)', v_proj));
  perform pg_temp.must_refuse('scores lock out removing a criterion',
    format('delete from public.project_criteria where id = %L', v_cb));
  perform pg_temp.must_refuse('scores lock the project total',
    format('update public.projects set total_points = 90 where id = %L', v_proj));
  perform pg_temp.must_allow('wording stays editable',
    format('update public.project_criteria set label = ''zz-Function, renamed'', description = ''zz-said better'' where id = %L', v_ca));
  perform pg_temp.must_be('and the professor can tell the rubric is scored',
    public.project_has_scores(v_proj));

  perform pg_temp.act_as((select v from fx where k='a'));
  perform pg_temp.must_be('a student cannot ask whether scoring has started',
    not public.project_has_scores(v_proj));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('the new wording landed',
    exists (select 1 from public.project_criteria where id = v_ca and label = 'zz-Function, renamed'));
  perform pg_temp.must_be('and the points did not move',
    (select max_points from public.project_criteria where id = v_cb) = 40
    and (select total_points from public.projects where id = v_proj) = 100);
end $$;

-- ------------------------------------------------------- who sees (Task 1)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_d uuid := (select v from fx where k='d');
  v_proj uuid := (select v from fx where k='proj');
  v_board uuid := (select v from fx where k='board');
  v_ca uuid := (select v from fx where k='crit_a');
begin
  perform pg_temp.act_as_service();
  insert into public.member_scores (board_id, student_id, suggested, final, overridden)
  values (v_board, v_a, 80, 80, false), (v_board, v_b, 80, 75, true);

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('before release a member sees no board scores',
    (select count(*) from public.board_scores where board_id = v_board) = 0);
  perform pg_temp.must_be('nor their own member score',
    (select count(*) from public.member_scores where board_id = v_board) = 0);
  perform pg_temp.must_refuse('a student cannot write a score',
    format('insert into public.board_scores (board_id, criterion_id, points) values (%L, %L, 1)', v_board, v_ca));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('the professor sees the board''s scores',
    (select count(*) from public.board_scores where board_id = v_board) = 1);
  perform pg_temp.must_be('and every member score',
    (select count(*) from public.member_scores where board_id = v_board) = 2);
  perform pg_temp.must_be('and the history',
    (select count(*) from public.score_history where project_id = v_proj) > 0);
  perform pg_temp.must_refuse('the professor cannot write a member score outside the functions',
    format('insert into public.member_scores (board_id, student_id, suggested, final, overridden) values (%L, %L, 1, 1, false)',
           v_board, (select v from fx where k='c')));

  perform pg_temp.act_as_service();
  insert into public.score_releases (project_id) values (v_proj);
  perform pg_temp.must_be('releasing writes a history row',
    exists (select 1 from public.score_history where project_id = v_proj and action = 'release'));

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('after release a member sees the board''s scores',
    (select count(*) from public.board_scores where board_id = v_board) = 1);
  perform pg_temp.must_be('and only their own member score',
    (select count(*) from public.member_scores where board_id = v_board) = 1
    and (select student_id from public.member_scores where board_id = v_board) = v_a);
  perform pg_temp.must_be('the release itself is visible to the class',
    exists (select 1 from public.score_releases where project_id = v_proj));
  perform pg_temp.must_be('a student never reads the history',
    (select count(*) from public.score_history where project_id = v_proj) = 0);

  perform pg_temp.act_as(v_d);
  perform pg_temp.must_be('a classmate outside the group sees no board scores',
    (select count(*) from public.board_scores where board_id = v_board) = 0);

  perform pg_temp.act_as_service();
  delete from public.score_releases where project_id = v_proj;
  perform pg_temp.must_be('withdrawing a release is recorded',
    exists (select 1 from public.score_history where project_id = v_proj and action = 'unrelease'));

  -- Task 2 starts from an unscored board.
  delete from public.member_scores where board_id = v_board;
  delete from public.board_scores where board_id = v_board;
end $$;

-- ================================================= Task 2 appends below here

-- ---------------------------------------------- a scored project can go (last)

do $$
declare
  v_class uuid := (select class_id from public.projects where id = (select v from fx where k='proj'));
  v_prof uuid := (select v from fx where k='prof');
  v_set uuid := (select v from fx where k='set');
  v_g uuid := (select v from fx where k='group');
  v_p uuid; v_c uuid; v_b uuid;
begin
  perform pg_temp.act_as_service();
  insert into public.projects
    (class_id, created_by, title, type, start_week, end_week, audience, group_set_id, total_points)
  values (v_class, v_prof, 'zz-score-doomed', 'activity', 1, 2, 'group', v_set, 10)
  returning id into v_p;
  insert into public.project_criteria (project_id, position, label, max_points)
  values (v_p, 1, 'zz-only', 10) returning id into v_c;
  perform public.ensure_project_boards(v_p);
  select id into v_b from public.project_boards where project_id = v_p and group_id = v_g;
  insert into public.board_scores (board_id, criterion_id, points) values (v_b, v_c, 7);
  perform pg_temp.must_allow('a scored project can still be deleted',
    format('delete from public.projects where id = %L', v_p));
  perform pg_temp.must_be('and its scores went with it',
    not exists (select 1 from public.board_scores where criterion_id = v_c));
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/db.mjs supabase/tests/scoring.test.sql`
Expected: FAIL at the first `insert into public.board_scores` with `relation "public.board_scores" does not exist`.

- [ ] **Step 3: Write `supabase/scoring.sql` (tables, triggers, RLS)**

```sql
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
```

- [ ] **Step 4: Apply and run the tests**

Run:
```bash
node scripts/db.mjs supabase/scoring.sql
node scripts/db.mjs supabase/anon-lockdown.sql
node scripts/db.mjs supabase/tests/scoring.test.sql
```
Expected: every notice starts with `PASS`, and the run ends without an exception.

Also run `node scripts/db.mjs supabase/tests/rls-coverage.test.sql` and `node scripts/db.mjs supabase/tests/anon-lockdown.test.sql`. Expected: no `FAIL`.

- [ ] **Step 5: Rebuild order**

In `scripts/schema-drift.mjs`, change the end of the ORDER string from `analytics-trends peer-evaluation\`` to `analytics-trends peer-evaluation scoring\``.

In `docs/07-backup.md`, append ` supabase/scoring.sql` to the end of the command lines at line 26 and line 53. After the paragraph that starts `` `peer-evaluation.sql` drops and recreates the views `` add:

```markdown
`scoring.sql` runs after `peer-evaluation.sql`. Its functions read `peer_results` from
string-bodied functions, so they record no dependency, and `peer-evaluation.sql` can
still be re-run on its own. It adds `board_scores`, `member_scores` and `score_releases`
to the realtime publication itself. Re-run `anon-lockdown.sql` after it.
```

Run: `node scripts/schema-drift.mjs`
Expected: no drift reported for `scoring.sql`. If the script needs a flag to list the order, read its header comment.

- [ ] **Step 6: Commit**

```bash
git add supabase/scoring.sql supabase/tests/scoring.test.sql scripts/schema-drift.mjs docs/07-backup.md
git commit -m "Add score tables with a rubric lock, history and release-gated reads"
```

---

### Task 2: Scoring functions, score sheet and the student's grade

**Files:**
- Modify: `supabase/scoring.sql` (insert a functions section before `-- ---------------------------------------------------------------- policies`, and add grants at the end before `commit;`)
- Modify: `supabase/tests/scoring.test.sql` (insert at the `-- ================================================= Task 2 appends below here` marker, before the "a scored project can go" block)

**Interfaces:**
- Consumes: Task 1's tables and helpers; `public.peer_results`, `public.peer_rounds` and `public.peer_ratings` (C1); `public.open_peer_round`, `public.save_peer_ratings` and `public.close_peer_round` (C1, used by tests).
- Produces (all granted to `authenticated`):
  - `suggest_score(p_group numeric, p_factor numeric, p_max int) → numeric`
  - `peer_final_factors(p_project uuid) → table(board_id uuid, student_id uuid, factor numeric, raters int)`
  - `score_sheet(p_project uuid) → table(board_id uuid, student_id uuid, student_name text, in_group boolean, group_total numeric, scored int, criteria int, total_points int, factor numeric, raters int, suggested_now numeric, suggested_saved numeric, final numeric, overridden boolean, factor_saved numeric, confirmed_at timestamptz, suggestion_changed boolean, released boolean)`
  - `save_board_scores(p_board uuid, p_points jsonb) → integer`, where `p_points = [{criterion_id, points}]` covers every criterion
  - `confirm_member_scores(p_board uuid, p_rows jsonb) → integer`, where `p_rows = [{student_id, final}]` covers every current member; it is ignored on an individual board
  - `release_project_scores(p_project uuid) → integer` (how many students were notified)
  - `unrelease_project_scores(p_project uuid) → void`
  - `clear_project_scores(p_project uuid) → integer`
  - `my_peer_summary(p_project uuid) → jsonb | null`, shaped `{raters, me:{contributes,interacts,on_track,quality,skills}, team:{…}}`
  - `my_grade(p_project uuid) → jsonb | null`, shaped `{final, group_total, total_points, in_group, released_at, criteria:[{label, description, max_points, points}], peer}`

- [ ] **Step 1: Write the failing tests**

Insert this into `supabase/tests/scoring.test.sql` at the Task 2 marker:

```sql
-- ------------------------------------------------- the suggestion (Task 2)

do $$
begin
  perform pg_temp.must_be('no factor: the group score', public.suggest_score(80, null, 100) = 80);
  perform pg_temp.must_be('80 × 0.9 gives 72', public.suggest_score(80, 0.9, 100) = 72);
  perform pg_temp.must_be('the factor caps at 1.05: 80 × 1.2 gives 84', public.suggest_score(80, 1.2, 100) = 84);
  perform pg_temp.must_be('never above the total', public.suggest_score(100, 1.04, 100) = 100);
  perform pg_temp.must_be('never above the total without a factor either', public.suggest_score(110, null, 100) = 100);
  perform pg_temp.must_be('a half rounds up: 10 × 1.025 gives 10.5', public.suggest_score(10, 1.025, 100) = 10.5);
  perform pg_temp.must_be('75.5 × 0.987 gives 74.5', public.suggest_score(75.5, 0.987, 100) = 74.5);
  perform pg_temp.must_be('80 × 0.632 gives 50.5', public.suggest_score(80, 0.632, 100) = 50.5);
  perform pg_temp.must_be('nothing scored, nothing suggested', public.suggest_score(null, 1, 100) is null);
end $$;

-- ------------------------------------------------------ saving (Task 2)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_board uuid := (select v from fx where k='board');
  v_ca uuid := (select v from fx where k='crit_a');
  v_cb uuid := (select v from fx where k='crit_b');
  v_cs uuid := (select v from fx where k='crit_s');
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot score',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board, pg_temp.pts(v_ca, 50, v_cb, 30)));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('every criterion must be scored',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board,
           jsonb_build_array(jsonb_build_object('criterion_id', v_ca, 'points', 50))::text));
  perform pg_temp.must_refuse('a criterion from another project is refused',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board, pg_temp.pts(v_ca, 50, v_cs, 30)));
  perform pg_temp.must_refuse('quarter points are refused',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board, pg_temp.pts(v_ca, 50.25, v_cb, 30)));
  perform pg_temp.must_refuse('a hundredth that would round to a whole point is refused',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board, pg_temp.pts(v_ca, 50.04, v_cb, 30)));
  perform pg_temp.must_refuse('points above the maximum are refused',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board, pg_temp.pts(v_ca, 61, v_cb, 30)));
  perform pg_temp.must_refuse('confirming before scoring is refused',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 0, v_b, 0, v_c, 0)));
  perform pg_temp.must_allow('the professor scores the board',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board, pg_temp.pts(v_ca, 50, v_cb, 30)));
  perform pg_temp.must_be('and the scores are stored',
    (select sum(points) from public.board_scores where board_id = v_board) = 80);
end $$;

-- ------------------------------------------- confirming with peer factors (Task 2)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_d uuid := (select v from fx where k='d');
  v_proj uuid := (select v from fx where k='proj');
  v_board uuid := (select v from fx where k='board');
  v_round uuid;
  s record;
begin
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('with no final round, everyone''s suggestion is the group score',
    (select bool_and(suggested_now = 80 and factor is null) from public.score_sheet(v_proj)));

  perform public.open_peer_round(v_proj, 'final', now() + interval '2 days');
  select id into v_round from public.peer_rounds where project_id = v_proj and kind = 'final';
  perform pg_temp.act_as(v_a);
  perform public.save_peer_ratings(v_round, pg_temp.ratings(v_a, 5, v_b, 4, v_c, 2));
  perform pg_temp.act_as(v_b);
  perform public.save_peer_ratings(v_round, pg_temp.ratings(v_a, 4, v_b, 4, v_c, 2));
  perform pg_temp.act_as(v_c);
  perform public.save_peer_ratings(v_round, pg_temp.ratings(v_a, 4, v_b, 3, v_c, 5));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('a final round still open gives no factor',
    (select bool_and(factor is null and suggested_now = 80) from public.score_sheet(v_proj)));

  perform pg_temp.must_refuse('a confirm must cover the whole group',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           jsonb_build_array(jsonb_build_object('student_id', v_a, 'final', 80))::text));
  perform pg_temp.must_refuse('a confirm cannot name someone outside the group',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 80, v_b, 80, v_d, 80)));
  perform pg_temp.must_refuse('a final above the total is refused',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 101, v_b, 80, v_c, 80)));
  perform pg_temp.must_refuse('a final must be whole or half points',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 80.3, v_b, 80, v_c, 80)));
  perform pg_temp.must_allow('the professor confirms while the round is open',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 80, v_b, 80, v_c, 70)));

  select * into s from public.score_sheet(v_proj) where student_id = v_c;
  perform pg_temp.must_be('a changed final is marked overridden', s.overridden and s.final = 70);
  perform pg_temp.must_be('and nothing has changed under it yet', not s.suggestion_changed);

  perform public.close_peer_round(v_round);
  perform pg_temp.must_be('closing the final round sets the factors (a 1.263, b 1.105, c 0.632)',
    (select factor from public.score_sheet(v_proj) where student_id = v_a) = 1.263
    and (select factor from public.score_sheet(v_proj) where student_id = v_b) = 1.105
    and (select factor from public.score_sheet(v_proj) where student_id = v_c) = 0.632);
  perform pg_temp.must_be('and the suggestions follow (84, 84, 50.5)',
    (select suggested_now from public.score_sheet(v_proj) where student_id = v_a) = 84
    and (select suggested_now from public.score_sheet(v_proj) where student_id = v_b) = 84
    and (select suggested_now from public.score_sheet(v_proj) where student_id = v_c) = 50.5);
  perform pg_temp.must_be('so every earlier confirm reads "suggestion changed"',
    (select bool_and(suggestion_changed) from public.score_sheet(v_proj)));

  perform pg_temp.must_allow('the professor confirms the suggestions',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 84, v_b, 84, v_c, 50.5)));
  perform pg_temp.must_be('now nothing is overridden or stale',
    (select bool_and(not overridden and not suggestion_changed) from public.score_sheet(v_proj)));
  perform pg_temp.must_be('and the factor used is kept with the score',
    (select factor from public.member_scores where board_id = v_board and student_id = v_a) = 1.263);
  perform pg_temp.must_allow('the professor raises c''s score',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 84, v_b, 84, v_c, 55)));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('each confirm that changed a final is in the history',
    (select count(*) from public.score_history
      where board_id = v_board and student_id = v_c and action = 'confirm') = 3);

  -- Somebody joins the group after the confirm.
  insert into public.group_members (group_id, set_id, student_id)
  values ((select v from fx where k='group'), (select v from fx where k='set'), v_d);
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('after a join, the old list no longer covers the group',
    format('select public.confirm_member_scores(%L, %L::jsonb)', v_board,
           pg_temp.finals(v_a, 84, v_b, 84, v_c, 55)));
  perform pg_temp.must_be('the newcomer shows up unconfirmed, with no factor',
    exists (select 1 from public.score_sheet(v_proj)
             where student_id = v_d and confirmed_at is null and factor is null and suggested_now = 80));
  perform pg_temp.must_be('and everyone else''s factor is unchanged',
    (select factor from public.score_sheet(v_proj) where student_id = v_a) = 1.263);
  perform pg_temp.act_as_service();
  delete from public.group_members where group_id = (select v from fx where k='group') and student_id = v_d;
end $$;

-- ------------------------------------------------------- release (Task 2)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_b uuid := (select v from fx where k='b');
  v_c uuid := (select v from fx where k='c');
  v_d uuid := (select v from fx where k='d');
  v_proj uuid := (select v from fx where k='proj');
  v_board uuid := (select v from fx where k='board');
  v_ca uuid := (select v from fx where k='crit_a');
  v_cb uuid := (select v from fx where k='crit_b');
  g jsonb;
  n int;
  expected int;
begin
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('before release a student has no grade', public.my_grade(v_proj) is null);
  perform pg_temp.must_be('and no peer summary', public.my_peer_summary(v_proj) is null);
  perform pg_temp.must_refuse('a student cannot release grades',
    format('select public.release_project_scores(%L)', v_proj));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor releases grades',
    format('select public.release_project_scores(%L)', v_proj));

  perform pg_temp.act_as_service();
  select count(*) into n from public.notifications where project_id = v_proj and type = 'grades_released';
  select count(*) into expected from public.notification_prefs np
   where np.announcements and np.user_id in (v_a, v_b, v_c);
  perform pg_temp.must_be('release tells each confirmed student who has announcements on', n = expected);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_be('releasing again tells nobody twice',
    public.release_project_scores(v_proj) = 0);

  perform pg_temp.act_as(v_a);
  g := public.my_grade(v_proj);
  perform pg_temp.must_be('a sees 84 of 100 from a group score of 80',
    (g ->> 'final')::numeric = 84 and (g ->> 'total_points')::int = 100
    and (g ->> 'group_total')::numeric = 80 and (g ->> 'in_group')::boolean);
  perform pg_temp.must_be('with the rubric breakdown, in order',
    jsonb_array_length(g -> 'criteria') = 2
    and (g -> 'criteria' -> 0 ->> 'points')::numeric = 50
    and (g -> 'criteria' -> 1 ->> 'points')::numeric = 30
    and (g -> 'criteria' -> 1 ->> 'max_points')::int = 40);
  perform pg_temp.must_be('and how teammates saw them: 4.00 from 2 raters, team 3.17',
    (g -> 'peer' ->> 'raters')::int = 2
    and (g -> 'peer' -> 'me' ->> 'contributes')::numeric = 4.00
    and (g -> 'peer' -> 'team' ->> 'contributes')::numeric = 3.17);

  perform pg_temp.act_as(v_c);
  perform pg_temp.must_be('c sees the overridden 55',
    (public.my_grade(v_proj) ->> 'final')::numeric = 55);
  perform pg_temp.act_as(v_d);
  perform pg_temp.must_be('a classmate outside the group has no grade here',
    public.my_grade(v_proj) is null);

  -- Changing a criterion after release.
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor can still correct a criterion after release',
    format('select public.save_board_scores(%L, %L::jsonb)', v_board, pg_temp.pts(v_ca, 55, v_cb, 30)));
  perform pg_temp.must_be('which marks the confirmed scores as stale',
    (select suggestion_changed from public.score_sheet(v_proj) where student_id = v_a));
  perform pg_temp.act_as(v_a);
  g := public.my_grade(v_proj);
  perform pg_temp.must_be('the student sees the new breakdown and keeps the confirmed score',
    (g ->> 'group_total')::numeric = 85 and (g ->> 'final')::numeric = 84);

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor unreleases',
    format('select public.unrelease_project_scores(%L)', v_proj));
  perform pg_temp.act_as(v_a);
  perform pg_temp.must_be('and the grade is hidden again', public.my_grade(v_proj) is null);
end $$;

-- ------------------------------------------------- an individual board (Task 2)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_solo uuid := (select v from fx where k='solo');
  v_sb uuid := (select v from fx where k='solo_board');
  v_cs uuid := (select v from fx where k='crit_s');
begin
  perform pg_temp.act_as(v_prof);
  perform public.save_board_scores(v_sb,
    jsonb_build_array(jsonb_build_object('criterion_id', v_cs, 'points', 45)));
  perform pg_temp.must_allow('an individual board confirms with no list',
    format('select public.confirm_member_scores(%L, ''[]''::jsonb)', v_sb));
  perform pg_temp.must_be('its one student gets the board total, with no factor',
    exists (select 1 from public.member_scores
             where board_id = v_sb and student_id = v_a and final = 45
               and factor is null and not overridden));

  perform pg_temp.act_as_service();
  update public.projects set archived_at = now() where id = v_solo;
  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_refuse('an archived project''s scores cannot change',
    format('select public.save_board_scores(%L, %L::jsonb)', v_sb,
           jsonb_build_array(jsonb_build_object('criterion_id', v_cs, 'points', 40))::text));
  perform pg_temp.act_as_service();
  update public.projects set archived_at = null where id = v_solo;
end $$;

-- ------------------------------------------------------- clearing (Task 2)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_a uuid := (select v from fx where k='a');
  v_proj uuid := (select v from fx where k='proj');
  v_board uuid := (select v from fx where k='board');
  v_cb uuid := (select v from fx where k='crit_b');
begin
  perform pg_temp.act_as(v_prof);
  perform public.release_project_scores(v_proj);

  perform pg_temp.act_as(v_a);
  perform pg_temp.must_refuse('a student cannot clear scores',
    format('select public.clear_project_scores(%L)', v_proj));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('the professor clears the project''s scores',
    format('select public.clear_project_scores(%L)', v_proj));

  perform pg_temp.act_as_service();
  perform pg_temp.must_be('every score and confirm on the project is gone',
    not exists (select 1 from public.board_scores where board_id = v_board)
    and not exists (select 1 from public.member_scores where board_id = v_board));
  perform pg_temp.must_be('the release went with them',
    not exists (select 1 from public.score_releases where project_id = v_proj));
  perform pg_temp.must_be('the history kept everything and recorded the clear',
    exists (select 1 from public.score_history where project_id = v_proj and action = 'clear')
    and exists (select 1 from public.score_history where project_id = v_proj and action = 'confirm'));

  perform pg_temp.act_as(v_prof);
  perform pg_temp.must_allow('clearing unlocks the rubric',
    format('update public.project_criteria set max_points = 45 where id = %L', v_cb));
  perform pg_temp.act_as_service();
  update public.project_criteria set max_points = 40 where id = v_cb;
end $$;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/db.mjs supabase/tests/scoring.test.sql`
Expected: FAIL at the first Task 2 block with `function public.suggest_score(integer, unknown, integer) does not exist`.

- [ ] **Step 3: Add the functions to `supabase/scoring.sql`**

Insert this block directly before `-- ---------------------------------------------------------------- policies`:

```sql
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
     and np.announcements;

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
     and public.project_is_live(p_project)
   limit 1;
$$;
```

At the end of the file, before the final `commit;` (after the realtime block), add:

```sql
-- ---------------------------------------------------------------- grants

revoke all on function public.suggest_score(numeric, numeric, int) from public, anon;
revoke all on function public.peer_final_factors(uuid) from public, anon;
revoke all on function public.score_guard(uuid) from public, anon, authenticated;
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
```

- [ ] **Step 4: Apply and run the tests**

Run:
```bash
node scripts/db.mjs supabase/scoring.sql
node scripts/db.mjs supabase/anon-lockdown.sql
node scripts/db.mjs supabase/tests/scoring.test.sql
node scripts/db.mjs supabase/tests/peer-evaluation.test.sql
node scripts/db.mjs supabase/tests/anon-lockdown.test.sql
```
Expected: all `PASS`, with no exception.

Also re-run `node scripts/db.mjs supabase/peer-evaluation.sql`, then `node scripts/db.mjs supabase/anon-lockdown.sql`. Expected: it succeeds, which proves `scoring.sql` added no view dependency on `peer_results`.

- [ ] **Step 5: Commit**

```bash
git add supabase/scoring.sql supabase/tests/scoring.test.sql
git commit -m "Score boards, confirm students from the final peer round, release and clear"
```

---

### Task 3: Types, API and the suggestion math in TypeScript

**Files:**
- Create: `src/lib/scoreMath.ts`
- Create: `src/lib/scoreMath.test.ts`
- Create: `src/lib/api/scores.ts`
- Modify: `src/lib/types.ts` (the notification union near line 207; new types after `PeerForm` near the end of the peer types)

**Interfaces:**
- Consumes: Task 2's RPCs; `FACTOR_CAP` from `src/lib/peerMath.ts`; `Tone` from `src/lib/analyticsMath.ts`; `PeerDimension` from `src/lib/peerDimensions.ts`.
- Produces:
  - `suggestScore(groupTotal: number | null, factor: number | null, totalPoints: number): number | null`
  - `isHalfStep(n: number): boolean`
  - `formatPoints(n: number | null): string`
  - `type ScoreStatus = 'not_scored' | 'scored' | 'confirmed' | 'released'`
  - `boardScoreStatus(rows: ScoreSheetRow[]): ScoreStatus` (`rows` are one board's sheet rows)
  - `SCORE_STATUS_META: Record<ScoreStatus, { label: string; tone: Tone }>`
  - Types `ScoreSheetRow`, `BoardScore`, `MyGrade` and `MyPeerSummary`
  - API functions: `saveBoardScores`, `confirmMemberScores`, `releaseProjectScores`, `unreleaseProjectScores`, `clearProjectScores`, `scoreSheet`, `projectBoardScores`, `projectHasScores` and `myGrade` (signatures below)

- [ ] **Step 1: Add the types**

In `src/lib/types.ts`, add `| 'grades_released'` after `| 'peer_round_reminder'` in the notification `type` union (line 208).

After the `PeerForm` type, add:

```ts
/** score_sheet(): one board and person, with today's suggestion beside what was confirmed. */
export type ScoreSheetRow = {
  board_id: string
  student_id: string
  student_name: string
  /** False on an individual board, which has no teammates and no factor. */
  in_group: boolean
  group_total: number | null
  scored: number
  criteria: number
  total_points: number
  factor: number | null
  raters: number
  suggested_now: number | null
  suggested_saved: number | null
  final: number | null
  overridden: boolean | null
  factor_saved: number | null
  confirmed_at: string | null
  suggestion_changed: boolean
  released: boolean
}

export type BoardScore = {
  board_id: string
  criterion_id: string
  points: number
  scored_at: string
}

/** my_peer_summary(): the student's averages from teammates beside the team's. */
export type MyPeerSummary = {
  raters: number
  me: Record<PeerDimension, number>
  team: Record<PeerDimension, number>
}

/** my_grade(): a released grade, as the student sees it. */
export type MyGrade = {
  final: number
  group_total: number
  total_points: number
  in_group: boolean
  released_at: string
  criteria: { label: string; description: string; max_points: number; points: number | null }[]
  peer: MyPeerSummary | null
}
```

If `types.ts` does not already import `PeerDimension`, add `import type { PeerDimension } from './peerDimensions'` at the top. Check first that `peerDimensions.ts` does not import from `types.ts`. If it does, inline the union `'contributes' | 'interacts' | 'on_track' | 'quality' | 'skills'` as a local `type ScoreDimension` instead.

- [ ] **Step 2: Write the failing unit tests**

Create `src/lib/scoreMath.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { boardScoreStatus, formatPoints, isHalfStep, suggestScore } from './scoreMath'
import type { ScoreSheetRow } from './types'

// The same hand values as supabase/tests/scoring.test.sql.
describe('suggestScore', () => {
  it('is the group score without a factor', () => {
    expect(suggestScore(80, null, 100)).toBe(80)
  })
  it('scales by the factor', () => {
    expect(suggestScore(80, 0.9, 100)).toBe(72)
    expect(suggestScore(80, 0.632, 100)).toBe(50.5)
    expect(suggestScore(75.5, 0.987, 100)).toBe(74.5)
  })
  it('caps the factor at 1.05', () => {
    expect(suggestScore(80, 1.2, 100)).toBe(84)
    expect(suggestScore(80, 1.263, 100)).toBe(84)
  })
  it('never goes above the total', () => {
    expect(suggestScore(100, 1.04, 100)).toBe(100)
    expect(suggestScore(110, null, 100)).toBe(100)
  })
  it('rounds a half up, exactly as Postgres does', () => {
    // 10 × 1.025 is 10.249999… in floating point; it must still land on 10.5.
    expect(suggestScore(10, 1.025, 100)).toBe(10.5)
  })
  it('suggests nothing before anything is scored', () => {
    expect(suggestScore(null, 1, 100)).toBeNull()
  })
})

describe('isHalfStep', () => {
  it('accepts whole and half points from zero up', () => {
    expect(isHalfStep(0)).toBe(true)
    expect(isHalfStep(7)).toBe(true)
    expect(isHalfStep(7.5)).toBe(true)
  })
  it('refuses quarters, negatives and non-numbers', () => {
    expect(isHalfStep(7.25)).toBe(false)
    expect(isHalfStep(-1)).toBe(false)
    expect(isHalfStep(Number.NaN)).toBe(false)
  })
})

describe('formatPoints', () => {
  it('drops a trailing .0 and keeps a half', () => {
    expect(formatPoints(84)).toBe('84')
    expect(formatPoints(50.5)).toBe('50.5')
    expect(formatPoints(null)).toBe('—')
  })
})

const sheetRow = (over: Partial<ScoreSheetRow>): ScoreSheetRow => ({
  board_id: 'b', student_id: 's', student_name: 'S', in_group: true,
  group_total: null, scored: 0, criteria: 2, total_points: 100,
  factor: null, raters: 0, suggested_now: null, suggested_saved: null,
  final: null, overridden: null, factor_saved: null, confirmed_at: null,
  suggestion_changed: false, released: false, ...over,
})

describe('boardScoreStatus', () => {
  it('is not scored until every criterion has points', () => {
    expect(boardScoreStatus([])).toBe('not_scored')
    expect(boardScoreStatus([sheetRow({ scored: 1 })])).toBe('not_scored')
    expect(boardScoreStatus([sheetRow({ scored: 0, criteria: 0 })])).toBe('not_scored')
  })
  it('is scored until every member is confirmed', () => {
    expect(boardScoreStatus([
      sheetRow({ scored: 2, student_id: 'a', confirmed_at: '2026-10-13T00:00:00Z' }),
      sheetRow({ scored: 2, student_id: 'b' }),
    ])).toBe('scored')
  })
  it('is confirmed, then released', () => {
    const done = { scored: 2, confirmed_at: '2026-10-13T00:00:00Z' }
    expect(boardScoreStatus([sheetRow(done)])).toBe('confirmed')
    expect(boardScoreStatus([sheetRow({ ...done, released: true })])).toBe('released')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/scoreMath.test.ts`
Expected: FAIL with `Failed to resolve import "./scoreMath"`.

- [ ] **Step 4: Write `src/lib/scoreMath.ts`**

```ts
import type { Tone } from './analyticsMath'
import { FACTOR_CAP } from './peerMath'
import type { ScoreSheetRow } from './types'

/**
 * The suggested individual score. Same rule as suggest_score in
 * supabase/scoring.sql, with the same hand values tested on both sides:
 * the group score × the peer factor (capped at FACTOR_CAP), in half points,
 * never above the project total.
 *
 * Worked in integers (halves × thousandths), because 10 × 1.025 is
 * 10.249999… in floating point and would round the other way from Postgres.
 */
export function suggestScore(groupTotal: number | null, factor: number | null, totalPoints: number): number | null {
  if (groupTotal === null) return null
  const capHalves = Math.round(totalPoints * 2)
  const halves = Math.round(groupTotal * 2)
  if (factor === null) return Math.min(halves, capHalves) / 2
  const milli = Math.min(Math.round(factor * 1000), Math.round(FACTOR_CAP * 1000))
  const scaled = Math.floor((halves * milli + 500) / 1000)
  return Math.min(scaled, capHalves) / 2
}

/** Whole or half points, from zero up: what a score box accepts. */
export function isHalfStep(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n * 2)
}

export function formatPoints(n: number | null): string {
  if (n === null) return '—'
  const v = Number(n)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

export type ScoreStatus = 'not_scored' | 'scored' | 'confirmed' | 'released'

export const SCORE_STATUS_META: Record<ScoreStatus, { label: string; tone: Tone }> = {
  not_scored: { label: 'Not scored', tone: 'pending' },
  scored: { label: 'Scored', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  released: { label: 'Released', tone: 'success' },
}

/** One board's standing, from its score_sheet rows. */
export function boardScoreStatus(rows: ScoreSheetRow[]): ScoreStatus {
  const first = rows[0]
  if (!first || first.criteria === 0 || first.scored < first.criteria) return 'not_scored'
  if (!rows.every((r) => r.confirmed_at)) return 'scored'
  return first.released ? 'released' : 'confirmed'
}
```

- [ ] **Step 5: Write `src/lib/api/scores.ts`**

```ts
import { supabase } from '../supabase'
import type { BoardScore, MyGrade, ScoreSheetRow } from '../types'

export type CriterionPoints = { criterion_id: string; points: number }
export type MemberFinal = { student_id: string; final: number }

/** Professor: every criterion's points for one board. The database refuses a partial list. */
export async function saveBoardScores(boardId: string, points: CriterionPoints[]) {
  const { error } = await supabase.rpc('save_board_scores', { p_board: boardId, p_points: points })
  if (error) throw error
}

/** Professor: each member's score. An individual board takes an empty list. */
export async function confirmMemberScores(boardId: string, rows: MemberFinal[]) {
  const { error } = await supabase.rpc('confirm_member_scores', { p_board: boardId, p_rows: rows })
  if (error) throw error
}

/** Returns how many students were notified. Zero when it was already released. */
export async function releaseProjectScores(projectId: string) {
  const { data, error } = await supabase.rpc('release_project_scores', { p_project: projectId })
  if (error) throw error
  return (data as number | null) ?? 0
}

export async function unreleaseProjectScores(projectId: string) {
  const { error } = await supabase.rpc('unrelease_project_scores', { p_project: projectId })
  if (error) throw error
}

export async function clearProjectScores(projectId: string) {
  const { error } = await supabase.rpc('clear_project_scores', { p_project: projectId })
  if (error) throw error
}

export async function scoreSheet(projectId: string) {
  const { data, error } = await supabase.rpc('score_sheet', { p_project: projectId })
  if (error) throw error
  return ((data ?? []) as ScoreSheetRow[]).map((r) => ({
    ...r,
    group_total: r.group_total === null ? null : Number(r.group_total),
    factor: r.factor === null ? null : Number(r.factor),
    suggested_now: r.suggested_now === null ? null : Number(r.suggested_now),
    suggested_saved: r.suggested_saved === null ? null : Number(r.suggested_saved),
    final: r.final === null ? null : Number(r.final),
    factor_saved: r.factor_saved === null ? null : Number(r.factor_saved),
  }))
}

/** Criterion points on the given boards. A project's boards number in the tens. */
export async function projectBoardScores(boardIds: string[]) {
  if (boardIds.length === 0) return []
  const { data, error } = await supabase
    .from('board_scores')
    .select('board_id, criterion_id, points, scored_at')
    .in('board_id', boardIds)
  if (error) throw error
  return ((data ?? []) as BoardScore[]).map((s) => ({ ...s, points: Number(s.points) }))
}

/** Professor: whether the rubric is locked by scores. False for anyone else. */
export async function projectHasScores(projectId: string) {
  const { data, error } = await supabase.rpc('project_has_scores', { p_project: projectId })
  if (error) throw error
  return Boolean(data)
}

/** Student: the released grade, or null. */
export async function myGrade(projectId: string) {
  const { data, error } = await supabase.rpc('my_grade', { p_project: projectId })
  if (error) throw error
  return (data as MyGrade | null) ?? null
}
```

- [ ] **Step 6: Run the tests and the build**

Run: `npx vitest run src/lib/scoreMath.test.ts`
Expected: PASS (all cases).

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/scoreMath.ts src/lib/scoreMath.test.ts src/lib/api/scores.ts src/lib/types.ts
git commit -m "Add the score suggestion in TypeScript and the scoring API"
```

---

### Task 4: A stable rubric that locks once scored

**Files:**
- Modify: `supabase/project-series.sql:181-197` (`series_write_criteria`) and `:340-342` (the call inside `update_project_series`)
- Modify: `supabase/tests/scoring.test.sql` (append a block before `-- ---------------------------------------------- a scored project can go (last)`)
- Modify: `src/lib/api/projects.ts:269-289` (delete `replaceCriteria`; keep the `CriterionInput` type)
- Modify: `src/components/projects/RubricEditor.tsx`
- Modify: `src/components/projects/ProjectForm.tsx` (props near line 95-113; Total points input and RubricEditor near lines 518-532)
- Modify: `src/components/projects/ProjectWizard.tsx` (props near lines 29-47; `<ProjectForm …>` near line 260)
- Modify: `src/pages/app/projects/ProjectDetail.tsx` (state near line 98, `load` near lines 156-181, `<ProjectWizard …>` near line 643)

**Interfaces:**
- Consumes: `projectHasScores(projectId)` and `clearProjectScores(projectId)` from `src/lib/api/scores.ts` (Task 3); the lock trigger (Task 1).
- Produces:
  - `RubricEditor` gains `locked?: boolean` and `onClearScores?: () => Promise<void>`.
  - `ProjectForm` and `ProjectWizard` gain `rubricLocked?: boolean` and `onClearScores?: () => Promise<void>`.

- [ ] **Step 1: Write the failing SQL test**

Append to `supabase/tests/scoring.test.sql`, directly before the `a scored project can go (last)` block:

```sql
-- ------------------------------------------- the rubric write path (Task 4)

do $$
declare
  v_prof uuid := (select v from fx where k='prof');
  v_proj uuid := (select v from fx where k='proj');
  v_board uuid := (select v from fx where k='board');
  v_ca uuid := (select v from fx where k='crit_a');
  v_cb uuid := (select v from fx where k='crit_b');
  same_points text := '[{"label":"zz-Function, again","description":"x","max_points":60},'
                      '{"label":"zz-Docs","description":"y","max_points":40}]';
  new_points text := '[{"label":"zz-Function","description":"x","max_points":50},'
                     '{"label":"zz-Docs","description":"y","max_points":50}]';
  one_row text := '[{"label":"zz-Function","description":"x","max_points":60}]';
  p public.projects%rowtype;
  msg text;
begin
  perform pg_temp.act_as(v_prof);
  perform public.save_board_scores(v_board, pg_temp.pts(v_ca, 50, v_cb, 30)::jsonb);

  perform pg_temp.must_allow('a scored rubric can be reworded through the edit path',
    format('select public.series_write_criteria(%L, %L::jsonb)', v_proj, same_points));
  perform pg_temp.must_be('and each criterion keeps its id, so its score still points at it',
    (select label from public.project_criteria where id = v_ca) = 'zz-Function, again'
    and (select count(*) from public.board_scores where board_id = v_board) = 2);
  perform pg_temp.must_refuse('new points on a scored rubric are refused',
    format('select public.series_write_criteria(%L, %L::jsonb)', v_proj, new_points));
  perform pg_temp.must_refuse('dropping a criterion from a scored rubric is refused',
    format('select public.series_write_criteria(%L, %L::jsonb)', v_proj, one_row));

  select * into p from public.projects where id = v_proj;
  begin
    perform public.update_project_series(
      array[v_proj], p.title, p.type, p.type_label, p.guidelines, p.start_week, p.end_week,
      p.total_points, p.due_at, p.release_at, new_points::jsonb);
    msg := null;
  exception when others then
    msg := sqlerrm;
  end;
  perform pg_temp.must_be('a project edit that changes scored points names the section and the reason',
    msg like '%·%' and msg like '%Scores exist%');

  perform public.clear_project_scores(v_proj);
  perform pg_temp.must_allow('once cleared, the points change',
    format('select public.series_write_criteria(%L, %L::jsonb)', v_proj, new_points));
  perform pg_temp.must_be('in place, keeping the ids',
    (select max_points from public.project_criteria where id = v_ca) = 50
    and (select max_points from public.project_criteria where id = v_cb) = 50);
  perform pg_temp.must_allow('and a criterion can be dropped',
    format('select public.series_write_criteria(%L, %L::jsonb)', v_proj, one_row));
  perform pg_temp.must_be('leaving just the first',
    (select count(*) from public.project_criteria where project_id = v_proj) = 1
    and exists (select 1 from public.project_criteria where id = v_ca));
end $$;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/db.mjs supabase/tests/scoring.test.sql`
Expected: FAIL at `a scored rubric can be reworded through the edit path`. The old delete-all path trips the lock with `Scores exist for this project…`.

- [ ] **Step 3: Rewrite `series_write_criteria` and label its refusal**

In `supabase/project-series.sql`, replace the whole `series_write_criteria` function (the comment line `/** Writes a rubric wholesale, the same way the client always has. */` through its closing `$$;`) with:

```sql
/**
 * Writes a rubric onto one project, matched by position: row 1 updates row 1,
 * rows past the new list go, and missing rows are added. Matching rather than
 * delete-and-insert keeps each criterion's id, which scores point at
 * (scoring.sql). While scores exist the lock there refuses anything but new
 * wording, and an edit that keeps the same rows and points is exactly that.
 */
/** The rubric as the form sent it: named rows only, numbered from 1 in order. */
create or replace function public.series_rubric_rows(p_criteria jsonb)
returns table (pos int, label text, description text, max_points int)
language sql immutable set search_path = public as $$
  select (row_number() over (order by c.ord))::int,
         btrim(c.v ->> 'label'),
         coalesce(c.v ->> 'description', ''),
         coalesce((c.v ->> 'max_points')::int, 10)
    from jsonb_array_elements(p_criteria) with ordinality as c(v, ord)
   where btrim(coalesce(c.v ->> 'label', '')) <> '';
$$;

create or replace function public.series_write_criteria(p_project uuid, p_criteria jsonb)
returns void language plpgsql set search_path = public as $$
declare
  n int;
begin
  if p_criteria is null then return; end if;

  select count(*) into n from public.series_rubric_rows(p_criteria);

  delete from public.project_criteria
   where project_id = p_project and position > n;

  -- Only rows that change are touched, so an untouched rubric passes the lock.
  update public.project_criteria pc
     set label = i.label, description = i.description, max_points = i.max_points
    from public.series_rubric_rows(p_criteria) i
   where pc.project_id = p_project
     and pc.position = i.pos
     and (pc.label, pc.description, pc.max_points)
         is distinct from (i.label, i.description, i.max_points);

  insert into public.project_criteria (project_id, position, label, description, max_points)
  select p_project, i.pos, i.label, i.description, i.max_points
    from public.series_rubric_rows(p_criteria) i
   where not exists (
     select 1 from public.project_criteria pc
      where pc.project_id = p_project and pc.position = i.pos
   );
end;
$$;
```

In the grants near the end of `project-series.sql` (beside the existing `series_write_criteria` lines ~485-488), add:

```sql
revoke all on function public.series_rubric_rows(jsonb) from public;
grant execute on function public.series_rubric_rows(jsonb) to authenticated;
```

In `update_project_series`, replace:

```sql
    if p_criteria is not null then
      perform public.series_write_criteria(r.id, p_criteria);
    end if;
```

with:

```sql
    if p_criteria is not null then
      begin
        perform public.series_write_criteria(r.id, p_criteria);
      exception when others then
        raise exception '% — %', label, sqlerrm;
      end;
    end if;
```

Apply and test:
```bash
node scripts/db.mjs supabase/project-series.sql
node scripts/db.mjs supabase/anon-lockdown.sql
node scripts/db.mjs supabase/tests/scoring.test.sql
```
Expected: all `PASS`. If a project-series test file exists (`ls supabase/tests | grep series`), run it too. Expected: all `PASS`.

- [ ] **Step 4: Delete the unused `replaceCriteria`**

In `src/lib/api/projects.ts`, delete the `replaceCriteria` function. Keep `export type CriterionInput = { label: string; description: string; max_points: number }`.

Run: `npx grep -rn "replaceCriteria" src` (or the Grep tool). Expected: no matches.

- [ ] **Step 5: Show the lock in `RubricEditor`**

Replace `src/components/projects/RubricEditor.tsx` with:

```tsx
import { useState } from 'react'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Input } from '../ui/Field'
import { authErrorMessage } from '../../lib/authError'
import type { CriterionInput } from '../../lib/api/projects'

const BLANK: CriterionInput = { label: '', description: '', max_points: 10 }

export function RubricEditor({
  rows,
  onChange,
  totalPoints,
  locked = false,
  onClearScores,
}: {
  rows: CriterionInput[]
  onChange: (next: CriterionInput[]) => void
  totalPoints: number
  /** Scores exist: points and criteria are fixed, wording is not. */
  locked?: boolean
  onClearScores?: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  const sum = rows.reduce((n, r) => n + (Number.isFinite(r.max_points) ? r.max_points : 0), 0)
  const named = rows.filter((r) => r.label.trim()).length
  const mismatch = named > 0 && sum !== totalPoints

  function patch(i: number, next: Partial<CriterionInput>) {
    onChange(rows.map((r, n) => (n === i ? { ...r, ...next } : r)))
  }

  async function clear() {
    if (!onClearScores) return
    setClearError(null)
    setClearing(true)
    try {
      await onClearScores()
      setConfirming(false)
    } catch (err) {
      setClearError(authErrorMessage(err, 'Could not clear the scores. Try again.'))
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="space-y-3">
      {locked && (
        <div className="space-y-3 rounded-xl border border-line surface-sunken p-3 text-[13px] text-muted">
          <div className="flex flex-wrap items-start gap-3">
            <Icon name="lock" size={15} className="mt-0.5 shrink-0 text-faint" />
            <p className="min-w-0 flex-1">
              Scores exist for this project, so its points and criteria are locked. You can still
              reword them.
            </p>
            {onClearScores && !confirming && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                Clear scores…
              </Button>
            )}
          </div>
          {confirming && (
            <div className="space-y-2 border-t border-line pt-3">
              <p className="text-ink">
                This deletes every score and confirmed grade on this project and hides released
                grades. The history keeps a record.
              </p>
              {clearError && <p className="text-danger-700 dark:text-danger-300">{clearError}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="danger" size="sm" loading={clearing} onClick={clear}>
                  Clear scores
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Keep them
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted">
          No rubric yet. Add the criteria you will mark against — a project needs at least
          one.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li
              key={i}
              className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[minmax(0,1fr)_96px_auto] sm:items-start"
            >
              <div className="space-y-2">
                <Input
                  value={r.label}
                  onChange={(e) => patch(i, { label: e.target.value })}
                  placeholder="Criterion, e.g. Functionality"
                  aria-label={`Criterion ${i + 1} name`}
                  className="!h-10"
                />
                <Input
                  value={r.description}
                  onChange={(e) => patch(i, { description: e.target.value })}
                  placeholder="What earns full marks here"
                  aria-label={`Criterion ${i + 1} description`}
                  className="!h-10 !text-[13px]"
                />
              </div>
              <Input
                type="number"
                min={1}
                max={1000}
                value={r.max_points}
                disabled={locked}
                onChange={(e) => patch(i, { max_points: Number(e.target.value) })}
                aria-label={`Criterion ${i + 1} points`}
                className="!h-10 text-center"
              />
              {!locked && (
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((_, n) => n !== i))}
                  aria-label={`Remove criterion ${i + 1}`}
                  className="grid h-10 w-10 place-items-center justify-self-end rounded-full text-faint transition-colors hover:bg-destructive-50 hover:text-destructive-600 dark:hover:bg-destructive-500/12 dark:hover:text-destructive-400"
                >
                  <Icon name="trash" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {!locked && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="!rounded-lg"
            onClick={() => onChange([...rows, { ...BLANK }])}
          >
            <Icon name="plus" size={15} />
            Add criterion
          </Button>
        )}

        {named > 0 && (
          <p
            className={`font-mono text-[12px] ${
              mismatch ? 'text-warning-700 dark:text-warning-300' : 'text-faint'
            }`}
          >
            {sum} / {totalPoints} points
            {mismatch && ' · does not add up to the total'}
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Pass the lock through `ProjectForm` and `ProjectWizard`**

In `src/components/projects/ProjectForm.tsx`:
- Add `rubricLocked = false,` and `onClearScores,` to the destructured props.
- Add these to the props type:
  ```ts
  /** Scores exist: the total and the rubric's points are fixed. */
  rubricLocked?: boolean
  onClearScores?: () => Promise<void>
  ```
- On the Total points `<Input>`, add `disabled={rubricLocked}`.
- Change the editor line to:

```tsx
          <RubricEditor
            rows={criteria}
            onChange={setCriteria}
            totalPoints={totalPoints}
            locked={rubricLocked}
            onClearScores={onClearScores}
          />
```

In `src/components/projects/ProjectWizard.tsx`, add the same two optional props to the component's props (destructure them and type them with the same doc comment), and pass `rubricLocked={rubricLocked}` and `onClearScores={onClearScores}` to `<ProjectForm …>`.

- [ ] **Step 7: Load the lock in `ProjectDetail`**

In `src/pages/app/projects/ProjectDetail.tsx`:
- Add `import { clearProjectScores, projectHasScores } from '../../../lib/api/scores'`.
- Add `const [scored, setScored] = useState(false)` after the `criteria` state.
- In `load`, extend the `Promise.all` to:

```ts
      const [c, f, w, m, s] = await Promise.all([
        listCriteria(p.id),
        listAttachments(p.id),
        classWeekMap(p.class_id),
        listSeriesMembers(p.series_id),
        role === 'professor' ? projectHasScores(p.id) : Promise.resolve(false),
      ])
```

  After `setMembers(m)`, add `setScored(s)`. Change the `useCallback` dependency list from `[projectId]` to `[projectId, role]`.
- Add `'board_scores'` to the `useLive(load, [...])` table list.
- On `<ProjectWizard …>`, add:

```tsx
          rubricLocked={scored}
          onClearScores={async () => {
            await clearProjectScores(project.id)
            setScored(false)
            show('Scores cleared. The rubric is unlocked.')
          }}
```

- [ ] **Step 8: Build and lint**

Run: `npm run build`, then `npx eslint src`, then `npx vitest run`
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add supabase/project-series.sql supabase/tests/scoring.test.sql src/lib/api/projects.ts src/components/projects/RubricEditor.tsx src/components/projects/ProjectForm.tsx src/components/projects/ProjectWizard.tsx src/pages/app/projects/ProjectDetail.tsx
git commit -m "Keep criterion ids on edit and lock a scored rubric's points"
```

---

### Task 5: The professor's Grades table and Score card

**Files:**
- Create: `src/components/scoring/useProjectScores.ts`
- Create: `src/components/scoring/GradesTable.tsx`
- Create: `src/components/scoring/ScoreCard.tsx`
- Modify: `src/components/tasks/ProfessorTasksView.tsx` (imports; hook call after line 84; the Summary section after the Groups section ending line 140; the board panel at lines 242-248)

**Interfaces:**
- Consumes:
  - From Task 3: `saveBoardScores`, `confirmMemberScores`, `releaseProjectScores`, `unreleaseProjectScores`, `clearProjectScores`, `scoreSheet` and `projectBoardScores`; `suggestScore`, `isHalfStep`, `formatPoints`, `boardScoreStatus` and `SCORE_STATUS_META`; the `ScoreSheetRow` and `BoardScore` types.
  - Existing: `listCriteria` (`src/lib/api/projects.ts`); `projectPeerResults` (`src/lib/api/peer.ts`); `analyseTeam` and `peerFlagLabel` (`src/lib/peerMath.ts`); `TONE_CELL` (`src/components/charts/format.ts`); the `BoardSummary` type and `boardOwnerName` (`src/lib/types.ts`).
- Produces:
  - `useProjectScores(projectId: string, boardIds: string[]): ProjectScores`
  - `GradesTable({ projectId, boards, solo, scores, onOpen })`
  - `ScoreCard({ board, scores })`

- [ ] **Step 1: Write the data hook**

Create `src/components/scoring/useProjectScores.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLive } from '../../hooks/useLive'
import { useToast } from '../ui/Toast'
import { projectPeerResults } from '../../lib/api/peer'
import { listCriteria } from '../../lib/api/projects'
import { projectBoardScores, scoreSheet } from '../../lib/api/scores'
import { authErrorMessage } from '../../lib/authError'
import type { BoardScore, PeerResult, ProjectCriterion, ScoreSheetRow } from '../../lib/types'

type ScoreData = {
  criteria: ProjectCriterion[]
  boardScores: BoardScore[]
  sheet: ScoreSheetRow[]
  /** The final round's peer results, for the flags beside each member. */
  finalPeer: PeerResult[]
}

export type ProjectScores = ScoreData & {
  loaded: boolean
  reload: () => Promise<void>
}

const EMPTY: ScoreData = { criteria: [], boardScores: [], sheet: [], finalPeer: [] }

/** Everything the grading table and score card read, loaded once for the page. */
export function useProjectScores(projectId: string, boardIds: string[]): ProjectScores {
  const { show } = useToast()
  const [data, setData] = useState<ScoreData>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  // Live updates retry the load often; one toast until it works again is enough.
  const erroredRef = useRef(false)
  const key = boardIds.join(',')

  const reload = useCallback(async () => {
    try {
      const ids = key ? key.split(',') : []
      const [criteria, boardScores, sheet, peer] = await Promise.all([
        listCriteria(projectId),
        projectBoardScores(ids),
        scoreSheet(projectId),
        projectPeerResults(projectId),
      ])
      setData({ criteria, boardScores, sheet, finalPeer: peer.filter((r) => r.kind === 'final') })
      setLoaded(true)
      erroredRef.current = false
    } catch (err) {
      if (erroredRef.current) return
      erroredRef.current = true
      show(authErrorMessage(err, 'Could not load the grades. Reload the page to try again.'), 'error')
    }
  }, [projectId, key, show])

  useEffect(() => {
    void reload()
  }, [reload])
  useLive(reload, ['board_scores', 'member_scores', 'score_releases', 'project_criteria', 'peer_rounds'])

  return { ...data, loaded, reload }
}
```

- [ ] **Step 2: Write the Grades table**

Create `src/components/scoring/GradesTable.tsx`:

```tsx
import { useState } from 'react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { TONE_CELL } from '../charts/format'
import { clearProjectScores, releaseProjectScores, unreleaseProjectScores } from '../../lib/api/scores'
import { authErrorMessage } from '../../lib/authError'
import { SCORE_STATUS_META, boardScoreStatus, formatPoints } from '../../lib/scoreMath'
import { boardOwnerName } from '../../lib/types'
import type { BoardSummary, ScoreSheetRow } from '../../lib/types'
import type { ProjectScores } from './useProjectScores'

function handIn(b: BoardSummary) {
  if (b.result_verdict === 'accepted') return 'Accepted'
  if (b.result_verdict === 'returned') return 'Returned'
  return b.submitted_at ? 'Handed in' : 'Not handed in'
}

/**
 * Every board against every criterion, with where its grading stands. Opening a
 * row goes to that board's panel, where the scoring happens.
 */
export function GradesTable({
  projectId,
  boards,
  solo,
  scores,
  onOpen,
}: {
  projectId: string
  boards: BoardSummary[]
  solo: boolean
  scores: ProjectScores
  onOpen: (boardId: string) => void
}) {
  const { show } = useToast()
  const [busy, setBusy] = useState(false)
  const [clearing, setClearing] = useState(false)
  const { criteria, boardScores, sheet } = scores
  const totalPoints = boards[0]?.total_points ?? 0
  const released = sheet.some((r) => r.released)
  const anyConfirmed = sheet.some((r) => r.confirmed_at)

  const points = new Map(boardScores.map((s) => [`${s.board_id}:${s.criterion_id}`, s.points]))
  const rowsOf = new Map<string, ScoreSheetRow[]>()
  for (const r of sheet) rowsOf.set(r.board_id, [...(rowsOf.get(r.board_id) ?? []), r])
  const ordered = [...boards].sort((a, b) => boardOwnerName(a).localeCompare(boardOwnerName(b)))

  const act = async (fn: () => Promise<string>) => {
    setBusy(true)
    try {
      show(await fn())
      await scores.reload()
    } catch (err) {
      show(authErrorMessage(err, 'That did not go through. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!scores.loaded) return null
  if (criteria.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        This project has no rubric yet. Edit the project to add the criteria you mark against.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-[13px] text-muted">
          {released
            ? 'Released. Students see their confirmed score and their board’s breakdown.'
            : 'Students see nothing until you release grades.'}
        </p>
        {released ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await unreleaseProjectScores(projectId)
                return 'Grades hidden from students'
              })
            }
          >
            Unrelease
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy || !anyConfirmed}
            onClick={() =>
              act(async () => {
                const n = await releaseProjectScores(projectId)
                return n > 0 ? `Grades released · ${n} notified` : 'Grades released'
              })
            }
          >
            Release grades
          </Button>
        )}
        {boardScores.length > 0 && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setClearing(true)}>
            Clear scores…
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <caption className="sr-only">Grades by {solo ? 'student' : 'group'}</caption>
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-faint">
              <th scope="col" className="px-2 py-2 font-medium">{solo ? 'Student' : 'Group'}</th>
              <th scope="col" className="px-2 py-2 font-medium">Hand-in</th>
              {criteria.map((c) => (
                <th key={c.id} scope="col" className="px-2 py-2 font-medium" title={c.description || undefined}>
                  {c.label} <span className="font-mono">/{c.max_points}</span>
                </th>
              ))}
              <th scope="col" className="px-2 py-2 font-medium">Total</th>
              <th scope="col" className="px-2 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((b) => {
              const cells = criteria.map((c) => points.get(`${b.id}:${c.id}`) ?? null)
              const scored = cells.every((v) => v !== null)
              const total = scored ? cells.reduce<number>((s, v) => s + (v ?? 0), 0) : null
              const status = SCORE_STATUS_META[boardScoreStatus(rowsOf.get(b.id) ?? [])]
              return (
                <tr key={b.id} className="border-b border-line last:border-0">
                  <th scope="row" className="px-2 py-2 text-left font-normal">
                    <button type="button" onClick={() => onOpen(b.id)} className="text-ink hover:underline">
                      {boardOwnerName(b)}
                    </button>
                  </th>
                  <td className="px-2 py-2 text-muted">{handIn(b)}</td>
                  {cells.map((v, i) => (
                    <td key={criteria[i].id} className="px-2 py-2 font-mono text-muted">
                      {formatPoints(v)}
                    </td>
                  ))}
                  <td className="px-2 py-2 font-mono text-ink">
                    {formatPoints(total)} <span className="text-faint">/ {totalPoints}</span>
                  </td>
                  <td className="px-2 py-2">
                    <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[status.tone]}`}>
                      {status.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={clearing}
        onClose={() => setClearing(false)}
        onConfirm={async () => {
          await clearProjectScores(projectId)
          show('Scores cleared. The rubric is unlocked.')
          await scores.reload()
        }}
        title="Clear every score?"
        body="This deletes every criterion score and confirmed grade on this project and hides released grades. The history keeps a record, and the rubric unlocks."
        confirmLabel="Clear scores"
      />
    </div>
  )
}
```

- [ ] **Step 3: Write the Score card**

Create `src/components/scoring/ScoreCard.tsx`:

```tsx
import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { TONE_CELL } from '../charts/format'
import { confirmMemberScores, saveBoardScores } from '../../lib/api/scores'
import { authErrorMessage } from '../../lib/authError'
import { analyseTeam, peerFlagLabel } from '../../lib/peerMath'
import { SCORE_STATUS_META, boardScoreStatus, formatPoints, isHalfStep, suggestScore } from '../../lib/scoreMath'
import type { BoardSummary, ProjectCriterion, ScoreSheetRow } from '../../lib/types'
import type { ProjectScores } from './useProjectScores'

const dateFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })
const box =
  'h-9 w-20 rounded-lg border border-line surface px-2 text-right font-mono text-[13px] text-ink aria-[invalid=true]:border-danger-500'

/**
 * Score one board against the rubric, then confirm each member's score. Inputs
 * hold only what was edited, so a live reload never wipes what is being typed.
 */
export function ScoreCard({ board, scores }: { board: BoardSummary; scores: ProjectScores }) {
  const { show } = useToast()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [finals, setFinals] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  if (!scores.loaded) return null
  const { criteria } = scores
  if (criteria.length === 0) {
    return (
      <p className="rounded-panel border border-line p-4 text-[13px] text-muted">
        Add a rubric to this project to score it.
      </p>
    )
  }

  const solo = board.student_id !== null
  const total = board.total_points
  const rows = scores.sheet.filter((r) => r.board_id === board.id)
  const saved = new Map(scores.boardScores.filter((s) => s.board_id === board.id).map((s) => [s.criterion_id, s.points]))

  const value = (c: ProjectCriterion) => edits[c.id] ?? (saved.has(c.id) ? String(saved.get(c.id)) : '')
  const problem = (c: ProjectCriterion) => {
    const v = value(c).trim()
    if (v === '') return 'Score this criterion'
    const n = Number(v)
    if (!isHalfStep(n)) return 'Use whole or half points'
    if (n > c.max_points) return `At most ${c.max_points}`
    return null
  }
  const complete = criteria.every((c) => !problem(c))
  const liveTotal = complete ? criteria.reduce((s, c) => s + Number(value(c)), 0) : null
  const dirty = Object.keys(edits).length > 0
  const fullySaved = criteria.every((c) => saved.has(c.id))
  const savedTotal = fullySaved ? criteria.reduce((s, c) => s + (saved.get(c.id) ?? 0), 0) : null

  const team = new Map(analyseTeam(scores.finalPeer.filter((r) => r.board_id === board.id)).map((m) => [m.student_id, m]))
  const suggested = (r: ScoreSheetRow) => suggestScore(savedTotal, r.in_group ? r.factor : null, total)
  const finalText = (r: ScoreSheetRow) =>
    finals[r.student_id] ?? (r.final !== null ? String(r.final) : String(suggested(r) ?? ''))
  const finalProblem = (r: ScoreSheetRow) => {
    const n = Number(finalText(r))
    if (finalText(r).trim() === '' || !isHalfStep(n)) return 'Use whole or half points'
    if (n > total) return `At most ${total}`
    return null
  }
  const canConfirm = fullySaved && !dirty && rows.length > 0 && (solo || rows.every((r) => !finalProblem(r)))
  const status = SCORE_STATUS_META[boardScoreStatus(rows)]
  const handedIn = Boolean(board.submitted_at || board.result_verdict)
  const released = rows[0]?.released ?? false

  const run = async (fn: () => Promise<void>, done: string, reset: () => void) => {
    setBusy(true)
    try {
      await fn()
      await scores.reload()
      reset()
      show(done)
    } catch (err) {
      show(authErrorMessage(err, 'That did not go through. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-panel border border-line p-4 sm:p-5" aria-labelledby={`score-${board.id}`}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 id={`score-${board.id}`} className="mr-auto">Score</h3>
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[status.tone]}`}>{status.label}</span>
      </header>

      {!handedIn && <Alert tone="info">This has not been handed in. You can still score it.</Alert>}
      {released && (
        <Alert tone="info">
          Grades are released. Students see a changed criterion as soon as you save, and a changed
          score once you confirm.
        </Alert>
      )}

      <ul className="space-y-3">
        {criteria.map((c) => {
          const err = edits[c.id] !== undefined ? problem(c) : null
          return (
            <li key={c.id} className="flex flex-wrap items-start gap-3">
              <label htmlFor={`pts-${board.id}-${c.id}`} className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-ink">{c.label}</span>
                {c.description && <span className="block text-[12px] text-muted">{c.description}</span>}
              </label>
              <span className="flex items-center gap-2">
                <input
                  id={`pts-${board.id}-${c.id}`}
                  type="number"
                  inputMode="decimal"
                  step={0.5}
                  min={0}
                  max={c.max_points}
                  value={value(c)}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={err ? `pts-${board.id}-${c.id}-err` : undefined}
                  onChange={(e) => setEdits((d) => ({ ...d, [c.id]: e.target.value }))}
                  className={box}
                />
                <span className="font-mono text-[12px] text-faint">/ {c.max_points}</span>
              </span>
              {err && (
                <p id={`pts-${board.id}-${c.id}-err`} className="basis-full text-right text-[12px] text-danger-700 dark:text-danger-300">
                  {err}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <p className="mr-auto font-mono text-[14px] text-ink" aria-live="polite">
          {formatPoints(liveTotal)} <span className="text-faint">/ {total}</span>
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !complete || !dirty}
          onClick={() =>
            run(
              () => saveBoardScores(board.id, criteria.map((c) => ({ criterion_id: c.id, points: Number(value(c)) }))),
              'Scores saved',
              () => setEdits({}),
            )
          }
        >
          Save scores
        </Button>
      </div>

      {!solo && rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-[12px] text-faint">
            The factor comes from the final peer round once it closes, and needs at least two
            raters. Without one, the suggestion is the group score. Groups of two never get one.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <caption className="sr-only">Individual scores for {board.group_name ?? 'this group'}</caption>
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-faint">
                  <th scope="col" className="px-2 py-2 font-medium">Member</th>
                  <th scope="col" className="px-2 py-2 font-medium">Factor</th>
                  <th scope="col" className="px-2 py-2 font-medium">Flags</th>
                  <th scope="col" className="px-2 py-2 font-medium">Suggested</th>
                  <th scope="col" className="px-2 py-2 font-medium">Final</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = suggested(r)
                  const err = finals[r.student_id] !== undefined ? finalProblem(r) : null
                  const over = s !== null && Number(finalText(r)) !== s
                  const peer = team.get(r.student_id)
                  return (
                    <tr key={r.student_id} className="border-b border-line last:border-0">
                      <th scope="row" className="px-2 py-2 text-left font-normal text-ink">{r.student_name}</th>
                      <td className="px-2 py-2 font-mono text-muted">{r.factor === null ? '—' : r.factor.toFixed(2)}</td>
                      <td className="px-2 py-2">
                        <span className="flex flex-wrap gap-1">
                          {(peer?.flags ?? []).map((f) => {
                            const w = peerFlagLabel(f, peer?.is_open)
                            return (
                              <span key={f} className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[w.tone]}`}>
                                {w.label}
                              </span>
                            )
                          })}
                        </span>
                      </td>
                      <td className="px-2 py-2 font-mono text-muted">{formatPoints(s)}</td>
                      <td className="px-2 py-2">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <input
                            type="number"
                            inputMode="decimal"
                            step={0.5}
                            min={0}
                            max={total}
                            value={finalText(r)}
                            disabled={!fullySaved}
                            aria-label={`Final score for ${r.student_name}`}
                            aria-invalid={err ? true : undefined}
                            onChange={(e) => setFinals((d) => ({ ...d, [r.student_id]: e.target.value }))}
                            className={box}
                          />
                          {over && (
                            <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL.pending}`}>Overridden</span>
                          )}
                          {r.suggestion_changed && (
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL.warning}`}
                              title={`Confirmed with ${formatPoints(r.suggested_saved)}; today it would be ${formatPoints(r.suggested_now)}. Confirm again to bring it up to date.`}
                            >
                              Suggestion changed
                            </span>
                          )}
                          {err && <span className="text-[12px] text-danger-700 dark:text-danger-300">{err}</span>}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto text-[12px] text-faint">
          {dirty
            ? 'Save the scores before confirming.'
            : rows[0]?.confirmed_at
              ? `Confirmed ${dateFmt.format(new Date(rows[0].confirmed_at))}`
              : solo
                ? 'Confirming sets the student’s score to the board total.'
                : 'Confirm once each member’s score is right.'}
        </p>
        <Button
          size="sm"
          disabled={busy || !canConfirm}
          onClick={() =>
            run(
              () =>
                confirmMemberScores(
                  board.id,
                  solo ? [] : rows.map((r) => ({ student_id: r.student_id, final: Number(finalText(r)) })),
                ),
              solo ? 'Score confirmed' : 'Scores confirmed',
              () => setFinals({}),
            )
          }
        >
          {solo ? 'Confirm score' : 'Confirm scores'}
        </Button>
      </div>
    </section>
  )
}
```

`TONE_CELL` is keyed by `Tone` (`success | warning | danger | pending`), so `TONE_CELL.pending` and `TONE_CELL.warning` are valid.

- [ ] **Step 4: Mount both in `ProfessorTasksView`**

In `src/components/tasks/ProfessorTasksView.tsx`:
- Add the imports:
  ```ts
  import { GradesTable } from '../scoring/GradesTable'
  import { ScoreCard } from '../scoring/ScoreCard'
  import { useProjectScores } from '../scoring/useProjectScores'
  ```
- After `const { active, solo, boards } = t`, add:
  ```ts
  const scores = useProjectScores(project.id, (boards ?? []).map((b) => b.id))
  ```
- In the Summary branch, directly after the Groups `</section>` (the one wrapping `GroupProgressTable`), add:

```tsx
          {/* 2b ── grading against the rubric */}
          <section className="space-y-3 border-t border-line pt-6">
            <div>
              <h3>Grades</h3>
              <p className="mt-0.5 text-[13px] text-muted">
                Score each {who} against the rubric, confirm each student, then release. Open a{' '}
                {who} to score it.
              </p>
            </div>
            <GradesTable
              projectId={project.id}
              boards={boards ?? []}
              solo={solo}
              scores={scores}
              onOpen={openBoard}
            />
          </section>
```

- In the board panel, replace:

```tsx
                <div className="space-y-4">
                  <BoardVerdict board={active} role={role} onChanged={t.refresh} />
```

with:

```tsx
                <div className="space-y-4">
                  <BoardVerdict board={active} role={role} onChanged={t.refresh} />
                  <ScoreCard key={active.id} board={active} scores={scores} />
```

`key={active.id}` resets the drafts when the professor switches boards.

- [ ] **Step 5: Build, lint, test**

Run: `npm run build`, then `npx eslint src`, then `npx vitest run`
Expected: all clean.

- [ ] **Step 6: Browser check (professor)**

Start the preview with `preview_start` (name from `.claude/launch.json`). The user must be signed in as faculty; if the page shows a sign-in screen, ask the user to sign in and wait. Open the class project used for C1 testing (Lab 6) → Work → Summary.
- The Grades table lists every group with "Not scored".
- Open a group. In the Score card:
  - type `7.25` → "Use whole or half points" and Save stays disabled;
  - type a value above the maximum → "At most N";
  - leave a box empty → Save stays disabled.
- Do **not** save or confirm on live data without asking the user: saving writes real scores, and confirming locks the rubric. Ask the user before pressing Save scores, Confirm, or Release on a live project.
- Check `read_console_messages` for errors. Expected: none.

- [ ] **Step 7: Commit**

```bash
git add src/components/scoring/useProjectScores.ts src/components/scoring/GradesTable.tsx src/components/scoring/ScoreCard.tsx src/components/tasks/ProfessorTasksView.tsx
git commit -m "Add the Grades table and the board Score card for professors"
```

---

### Task 6: The student's grade card

**Files:**
- Create: `src/components/scoring/GradeCard.tsx`
- Modify: `src/pages/app/projects/ProjectDetail.tsx` (import; the Brief grid near line 467)

**Interfaces:**
- Consumes: `myGrade(projectId)` (Task 3); `formatPoints` (Task 3); `PEER_DIMENSIONS` (`src/lib/peerDimensions.ts`); `ProgressBar` (`src/components/charts/ProgressBar.tsx`, `{ value: number; label?: string }`); `useLive`.
- Produces: `GradeCard({ projectId })`, which renders nothing until a grade is released.

- [ ] **Step 1: Write the card**

Create `src/components/scoring/GradeCard.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useLive } from '../../hooks/useLive'
import { Alert } from '../ui/Alert'
import { ProgressBar } from '../charts/ProgressBar'
import { myGrade } from '../../lib/api/scores'
import { authErrorMessage } from '../../lib/authError'
import { PEER_DIMENSIONS } from '../../lib/peerDimensions'
import { formatPoints } from '../../lib/scoreMath'
import type { MyGrade } from '../../lib/types'

const dateFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })

/**
 * The student's released grade: the score, the board's rubric breakdown, any
 * teamwork adjustment, and how teammates saw them beside the team's average.
 * Nothing shows before release.
 */
export function GradeCard({ projectId }: { projectId: string }) {
  const [grade, setGrade] = useState<MyGrade | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setGrade(await myGrade(projectId))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your grade. Reload the page to try again.'))
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])
  useLive(load, ['score_releases', 'member_scores', 'board_scores'])

  if (error) {
    return (
      <div className="lg:col-span-2">
        <Alert tone="error">{error}</Alert>
      </div>
    )
  }
  if (!grade) return null

  const final = Number(grade.final)
  const group = Number(grade.group_total)
  const adjust = grade.in_group ? Math.round((final - group) * 2) / 2 : 0

  return (
    <section
      aria-labelledby="your-grade"
      className="rounded-panel border border-line surface p-4 shadow-card sm:p-6 lg:col-span-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="your-grade">Your grade</h2>
        <p className="font-mono text-[12px] text-faint">
          Released {dateFmt.format(new Date(grade.released_at))}
        </p>
      </div>

      <p className="mt-3 font-display text-[40px] leading-none text-ink">
        {formatPoints(final)}
        <span className="text-[18px] text-muted"> / {grade.total_points}</span>
      </p>
      {adjust !== 0 && (
        <p className="mt-2 text-[13px] text-muted">
          Adjusted for teamwork: {adjust > 0 ? '+' : '−'}
          {formatPoints(Math.abs(adjust))} from your group’s {formatPoints(group)}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="eyebrow">Rubric</h3>
          <ul className="mt-3 space-y-3">
            {grade.criteria.map((c) => (
              <li key={c.label} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] text-ink">{c.label}</span>
                  <span className="font-mono text-[12px] text-muted">
                    {formatPoints(c.points === null ? null : Number(c.points))} / {c.max_points}
                  </span>
                </div>
                <ProgressBar
                  value={c.points === null ? 0 : (Number(c.points) / c.max_points) * 100}
                  label=" "
                />
              </li>
            ))}
          </ul>
        </div>

        {grade.peer && (
          <div>
            <h3 className="eyebrow">How your teammates saw you</h3>
            <p className="mt-1 text-[12px] text-faint">
              Averages from {grade.peer.raters} teammates in the final round, out of 5, next to your
              team’s. Nobody sees who gave which rating.
            </p>
            <dl className="mt-3 space-y-2">
              {PEER_DIMENSIONS.map((d) => (
                <div key={d.key} className="flex items-baseline justify-between gap-3 text-[13px]">
                  <dt className="text-muted">{d.label}</dt>
                  <dd className="shrink-0 font-mono text-ink">
                    {Number(grade.peer!.me[d.key]).toFixed(1)}
                    <span className="text-faint"> · team {Number(grade.peer!.team[d.key]).toFixed(1)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </section>
  )
}
```

If `eslint` flags the non-null assertions (`grade.peer!`), bind `const peer = grade.peer` before the JSX and use `peer &&` / `peer.me` instead.

- [ ] **Step 2: Mount it on the Brief tab**

In `src/pages/app/projects/ProjectDetail.tsx`, import `GradeCard` from `'../../../components/scoring/GradeCard'`. Inside `<div className="grid gap-6 lg:grid-cols-2">` on the Brief tab, as its first child (before the "Based on the syllabus" section), add:

```tsx
        {role === 'student' && <GradeCard projectId={project.id} />}
```

The `grades_released` notification needs no routing change. `NotificationBell` sends any notification with a `project_id` to `paths.classProject(project_id)`, and that page opens on Brief by default.

- [ ] **Step 3: Build, lint, test**

Run: `npm run build`, then `npx eslint src`, then `npx vitest run`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/scoring/GradeCard.tsx src/pages/app/projects/ProjectDetail.tsx
git commit -m "Show students their released grade on the project brief"
```

---

### Task 7: Rewrite the "no grade" rule, relax the report check, verify and ship

**Files:**
- Modify: `supabase/results.sql:13-16` (header comment paragraph)
- Modify: `supabase/reports.sql:26-29` (rule 2 of the header)
- Modify: `supabase/tests/reports.test.sql:310-331` (the "no marks in here" block)
- Modify: `handoff.md:323-325`

**Interfaces:**
- Consumes: Task 1's tables.
- Produces: a report test that asserts no report view reads `board_scores` or `member_scores` without also reading `score_releases`.

- [ ] **Step 1: Rewrite the report rule test**

In `supabase/tests/reports.test.sql`, replace from `-- -------------------------------------------------------- no marks in here` through the end of that `do $$ … end $$;` block with:

```sql
-- -------------------------------------------------- no unreleased marks in here

/**
 * Grades live in Collabify now (scoring.sql), but a student sees one only once
 * the professor releases it, and a printed report must not leak one earlier.
 * So any report view that reads a score table must also read score_releases.
 * Phase B adds released scores to reports; this keeps that honest.
 */
do $$
declare
  bad text;
begin
  select string_agg(distinct u.view_name, ', ') into bad
    from information_schema.view_table_usage u
   where u.view_schema = 'public'
     and u.view_name like 'report\_%'
     and u.table_name in ('board_scores', 'member_scores')
     and not exists (
       select 1 from information_schema.view_table_usage r
        where r.view_schema = 'public' and r.view_name = u.view_name
          and r.table_name = 'score_releases'
     );
  perform pg_temp.must_be('no report view carries a score that has not been released',
    bad is null);
end $$;
```

Check that the file defines `pg_temp.must_be` with the same `(text, boolean)` signature. The old block already called it, so it does.

Run: `node scripts/db.mjs supabase/tests/reports.test.sql`
Expected: all `PASS`.

- [ ] **Step 2: Rewrite the comments**

In `supabase/results.sql`, replace the paragraph starting ` * Deliberately no score. A number here would be a second grade record beside` (4 lines, through ` * belong where the work is rather than in a spreadsheet away from it.`) with:

```sql
 * The verdict carries no number. Grades live in scoring.sql as rubric scores
 * the professor confirms, and students see them only after release. A verdict
 * and a reason stay separate from the mark: "fix this and hand it in again" is
 * a different message from "this earned 72".
```

In `supabase/reports.sql`, replace rule 2 (from ` *   2. **No grade, no score, no mark.**` through ` *      column here is named anything a mark could hide behind.`) with:

```sql
 *   2. **No unreleased grade.** Grades live in scoring.sql, and a student sees
 *      one only after the professor releases it. These views carry none yet;
 *      Phase B adds released scores. The suite asserts that any report view
 *      reading a score table also reads score_releases.
```

These are comment-only edits. Re-run both files to confirm they still apply:
```bash
node scripts/db.mjs supabase/results.sql
node scripts/db.mjs supabase/reports.sql
node scripts/db.mjs supabase/anon-lockdown.sql
```
Expected: no errors.

In `handoff.md`, replace the paragraph starting `**Deliberately no score**, decided with the user:` (through `and `project_criteria` remain unused — that is not an oversight.`) with:

```markdown
**Grades now live in Collabify** (reversed with the user on 2026-10-13, Phase C2). A board
result stays a verdict and a reason with no number. The mark is a rubric score the professor
confirms per student in `scoring.sql`, and students see it only after release. See the
Phase C2 section at the end of this file.
```

- [ ] **Step 3: Full verification**

Run, in order:
```bash
node scripts/db.mjs supabase/tests/scoring.test.sql
node scripts/db.mjs supabase/tests/peer-evaluation.test.sql
node scripts/db.mjs supabase/tests/reports.test.sql
node scripts/db.mjs supabase/tests/rls-coverage.test.sql
node scripts/db.mjs supabase/tests/anon-lockdown.test.sql
node scripts/schema-drift.mjs
npm run build
npx eslint src
npx vitest run
```
Expected: no `FAIL` anywhere, a clean build, and 0 lint errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/results.sql supabase/reports.sql supabase/tests/reports.test.sql handoff.md
git commit -m "Retire the no-grade rule: reports may carry only released scores"
```

---

## After the tasks (controller)

1. **Browser walk-through on live data.** It needs the user's go-ahead, because each step writes real scores or notifies real students.
   - As faculty: score one Lab 6 group, confirm and release.
   - As the student (Lemmuel Rodge): see the card on the Brief tab.
   - Unrelease and clear afterwards if the user wants the data gone.
   - Check light and dark, at 375, 768 and 1440 widths.
2. **Ship.**
   - Fast-forward the feature branch into `main` and push.
   - Append a "Phase C2" section to `handoff.md`: what shipped, the spec rulings above, and Deferred notes.
   - Update the `collabify-current-state` memory: C2 is live, next is C3.

---

## Self-review

- **Spec coverage.**
  - Stable rubric: Task 4 (ruling 1).
  - Data: Task 1.
  - Functions: Task 2.
  - Suggestion rule: Tasks 2 and 3, tested on both sides with the same values.
  - Row-level security: Task 1.
  - Professor interface: Task 5.
  - Student interface: Task 6.
  - Rule changes: Task 7.
  - The spec's testing list for C2, item by item:

    | Spec test item | Task |
    |---|---|
    | Students see nothing before release; after release, only their own `member_scores` and their board's `board_scores` | 1 |
    | Lock: points, inserts and deletes refused; wording allowed | 1 |
    | Points above the maximum and non-half points refused | 1, 2 |
    | Suggestion hand values, including the cap and fewer than 2 raters | 2 (the newcomer `d` with 0 raters gets the group score) |
    | History rows written | 1, 2 |
    | Clearing unlocks the rubric | 2, 4 |
- **Placeholders:** none. Every code step carries its code.
- **Type consistency.**
  - `ScoreSheetRow` fields match the `score_sheet` return table, column for column.
  - `MyGrade` matches the `my_grade` jsonb keys.
  - `ProjectScores` is used identically in `GradesTable` and `ScoreCard`.
  - `suggestScore(groupTotal, factor, totalPoints)` has the same argument order as `suggest_score(p_group, p_factor, p_max)`.
- **Review Focus:** each of the five lines has its test in the owning task (items 2–4 in Task 2, item 5 in Task 4, and item 1 server-side in Task 2 with the client side in Task 5 Step 6).
