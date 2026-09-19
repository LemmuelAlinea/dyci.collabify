# Progress page for a General project — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Progress tab to a General project showing where it stands, a Gantt timeline, whether it will finish in time, and what is late or landing next.

**Architecture:** One nullable `starts_at` column on `general_tasks` gives the Gantt its left edge; everything else is computed from data `useGeneralProject` already loads. The arithmetic lives in three pure modules under `src/lib/general/` with vitest tests; four components only draw. Charts are hand-built HTML and CSS, the way `src/components/analytics/PressureChart.tsx` already is — no chart library.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, Supabase (Postgres 17.6), vitest.

## Global Constraints

Copied from `.superpowers/sdd/global-constraints.md`. Every task's requirements implicitly include this section.

- Colors come only from tokens in `src/styles/index.css` (`surface`, `surface-raised`, `surface-sunken`, `text-ink`, `text-muted`, `text-faint`, `border-line`, `border-line-strong`, `navy-*`, `amber-*`). No raw hex in components.
- Copy is sentence case and active voice, with no exclamation marks, no "please" and no "successfully". Errors say what happened and what to do next.
- Every SQL file is idempotent and re-runnable.
- `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` never appear in frontend code or any committed file.
- Every new SQL file is appended to `ORDER` in `scripts/schema-drift.mjs` and to the rebuild command in `docs/07-backup.md`, in the same order.
- Vitest runs in the `node` environment over `src/**/*.test.ts`. Only pure logic is unit-tested. There are no component tests.
- Motion goes through `components/motion/Reveal.tsx` or Motion's `useReducedMotion`. `scripts/motion-lint.mjs` rejects ungated `hover:translate-*`.
- Icon-only buttons need an `aria-label` (`scripts/a11y-names.mjs`).
- Design desktop first, then tablet, then phone. Wide content scrolls inside its own container, and the page never scrolls sideways — `AppShell` sets `overflow-x-clip` at `src/components/app/AppShell.tsx:175`, so anything that overflows the viewport is silently cut off rather than scrollable.
- Lint holds at **23 warnings, 0 errors**, run as `npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs`.
- Education behavior does not change.

### Running SQL

`db.<ref>.supabase.co` is IPv6-only on this machine. Every `node scripts/db.mjs` command runs in a shell prepared like this first, in the same Bash call:

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
set -a && . ./.env.local; set +a
PW=$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's|^postgresql://[^:]+:([^@]+)@.*|\1|')
POOL=$(cat supabase/.temp/pooler-url)
export SUPABASE_DB_URL="postgresql://$(printf '%s' "$POOL" | sed -E 's|^postgresql://([^:@]+).*|\1|'):${PW}@$(printf '%s' "$POOL" | sed -E 's|^.*@||')"
```

Never print `SUPABASE_DB_URL` or the password. There is one live database. SQL test files end in `rollback`; schema files are applied for real.

---

## File Structure

| Path | Responsibility |
|---|---|
| `supabase/general-schedule.sql` | The `starts_at` column, its constraint, the overview column, the history trigger |
| `supabase/tests/general-schedule.test.sql` | Proves the constraint, the history and the overview |
| `src/lib/general/timeline.ts` | Where a task sits on a timeline. No React, no dates formatting |
| `src/lib/general/timeline.test.ts` | Its tests |
| `src/lib/general/forecast.ts` | Whether the remaining work fits before the end date |
| `src/lib/general/forecast.test.ts` | Its tests |
| `src/lib/general/pressure.ts` | What is overdue and what falls due in the coming weeks |
| `src/lib/general/pressure.test.ts` | Its tests |
| `src/components/general/GanttChart.tsx` | Draws the timeline |
| `src/components/general/ForecastPanel.tsx` | Draws the finish-in-time answer |
| `src/components/general/PressurePanel.tsx` | Draws late and next |
| `src/components/general/ProgressTab.tsx` | The four panels in order |
| `src/lib/general/types.ts` | `starts_at` on `GeneralTask`, `starts_from`/`starts_to` on the event detail |
| `src/lib/api/general.ts` | `starts_at` in `createTask` and `TaskPatch` |
| `src/components/general/TaskDialog.tsx` | A Start field beside Due |
| `src/components/general/TasksTab.tsx` | A Start field on the new-task dialog |
| `src/lib/general/history.ts` | Renders a start-date change as a sentence |
| `src/pages/general/GeneralProject.tsx` | The Progress tab |

---

## Task 1: A start date on a task, in the database

**Files:**
- Create: `supabase/general-schedule.sql`
- Create: `supabase/tests/general-schedule.test.sql`
- Modify: `scripts/schema-drift.mjs:26-32` (the `ORDER` list)
- Modify: `docs/07-backup.md:26` (the rebuild command)

**Interfaces:**
- Consumes: `public.general_tasks`, `public.general_task_overview` and `public.record_general_task_event` as `supabase/general-tasks.sql` and `supabase/general-history.sql` leave them.
- Produces:
  - `general_tasks.starts_at timestamptz` — nullable
  - constraint `general_tasks_starts_before_due`
  - `general_task_overview.starts_at` — appended last
  - `record_general_task_event` records `starts_from` and `starts_to` in an `updated` event's `detail` when the start changes, and adds `starts_at` to its `fields` array

- [ ] **Step 1: Write the SQL file**

Create `supabase/general-schedule.sql`:

```sql
-- When a task is meant to start.
--
-- A Gantt bar needs two ends and a task only had one. `due_at` says when the
-- work is wanted; `starts_at` says when it is meant to begin, and the two
-- together are what a timeline draws.
--
-- Nullable on purpose. Every task that exists today has no start, including all
-- ten a capstone preset creates, and the chart draws those as a marker on their
-- due day rather than refusing to draw at all.
--
-- Redefines record_general_task_event, whose previous definition is in
-- supabase/general-history.sql, and general_task_overview, whose previous
-- definition is in supabase/general-tasks.sql.
--
-- Idempotent. Safe to re-run.

begin;

alter table public.general_tasks
  add column if not exists starts_at timestamptz;

comment on column public.general_tasks.starts_at is
  'When the work is meant to begin. Null means nobody has said yet.';

do $$ begin
  alter table public.general_tasks
    add constraint general_tasks_starts_before_due check (
      starts_at is null or due_at is null or starts_at <= due_at
    );
exception when duplicate_object then null; end $$;

commit;

begin;

/*
 * The overview carries it too, appended last because `create or replace view`
 * can only add columns at the end. Body copied from supabase/general-tasks.sql;
 * keep the two in step.
 */
create or replace view public.general_task_overview
with (security_invoker = true) as
select t.id,
       t.project_id,
       t.team_id,
       t.title,
       t.description,
       t.status,
       t.due_at,
       t.weight,
       t.created_by,
       t.completed_at,
       t.created_at,
       t.updated_at,
       coalesce(
         (select array_agg(a.user_id order by a.assigned_at)
            from public.general_task_assignees a where a.task_id = t.id),
         '{}'::uuid[]
       ) as assignee_ids,
       (select count(*) from public.general_task_comments c where c.task_id = t.id)::int as comment_count,
       (select count(*) from public.general_task_files f where f.task_id = t.id)::int as file_count,
       (select coalesce(sum(l.minutes), 0) from public.general_task_logs l where l.task_id = t.id)::int
         as logged_minutes,
       t.starts_at
  from public.general_tasks t;

grant select on public.general_task_overview to authenticated;

commit;

begin;

/*
 * A start that moves is how a plan slips, so the history keeps the old one —
 * the same treatment the title, status, due date and points already get.
 */
create or replace function public.record_general_task_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  changed text[] := array[]::text[];
  detail  jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
    values (new.id, new.project_id, auth.uid(), 'created', jsonb_build_object('title', new.title));
    return new;
  end if;

  detail := jsonb_build_object('status', new.status);

  if new.title is distinct from old.title then
    changed := array_append(changed, 'title');
    detail := detail || jsonb_build_object('title_from', old.title, 'title_to', new.title);
  end if;

  if new.description is distinct from old.description then
    changed := array_append(changed, 'description');
  end if;

  if new.status is distinct from old.status then
    changed := array_append(changed, 'status');
    detail := detail || jsonb_build_object('status_from', old.status);
  end if;

  if new.due_at is distinct from old.due_at then
    changed := array_append(changed, 'due_at');
    detail := detail || jsonb_build_object('due_from', old.due_at, 'due_to', new.due_at);
  end if;

  if new.starts_at is distinct from old.starts_at then
    changed := array_append(changed, 'starts_at');
    detail := detail || jsonb_build_object('starts_from', old.starts_at, 'starts_to', new.starts_at);
  end if;

  if new.team_id is distinct from old.team_id then
    changed := array_append(changed, 'team_id');
  end if;

  if new.weight is distinct from old.weight then
    changed := array_append(changed, 'weight');
    detail := detail || jsonb_build_object('weight_from', old.weight, 'weight_to', new.weight);
  end if;

  if array_length(changed, 1) > 0 then
    insert into public.general_task_events (task_id, project_id, actor_id, kind, detail)
    values (new.id, new.project_id, auth.uid(), 'updated',
            detail || jsonb_build_object('fields', to_jsonb(changed)));
  end if;

  return new;
end;
$$;

drop trigger if exists general_tasks_history on public.general_tasks;
create trigger general_tasks_history after insert or update on public.general_tasks
  for each row execute function public.record_general_task_event();

revoke all on function public.record_general_task_event() from public, anon;

commit;
```

- [ ] **Step 2: Check the overview body against the live one before applying**

The view body above is a copy. Confirm it still matches, so re-applying does not
silently drop a column somebody added since:

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
sed -n '/^create view public.general_task_overview/,/from public.general_tasks t;/p' supabase/general-tasks.sql
```

Expected: the same column list as Step 1, in the same order, minus `t.starts_at`.
If it differs, copy the live body into Step 1's file and keep `t.starts_at` last.

- [ ] **Step 3: Write the test file**

Create `supabase/tests/general-schedule.test.sql`:

```sql
-- A task's start date. Rolls back; nothing here survives.
begin;

create or replace function pg_temp.act_as(p uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.ok(p_label text, p_true boolean) returns void
language plpgsql as $$
begin
  if p_true then raise notice 'PASS  %', p_label;
  else raise notice 'FAIL  %', p_label; end if;
end;
$$;

do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  proj     public.general_projects%rowtype;
  t        uuid;
  d        jsonb;
  n        int;
  ts       timestamptz := now();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                          raw_user_meta_data, created_at, updated_at, aud, role, instance_id)
  select v.id, v.em, 'x', now(),
         jsonb_build_object('first_name', 'Sched', 'last_name', v.ln, 'workplace', 'general'),
         now(), now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (owner_id, 'sched-owner@test.local', 'Owner'),
                 (other_id, 'sched-other@test.local', 'Other')) as v(id, em, ln);

  perform pg_temp.act_as(owner_id);
  proj := public.create_general_project('Schedule project', '');

  insert into public.general_tasks (project_id, title, created_by)
  values (proj.id, 'Plan it', owner_id) returning id into t;

  ------------------------------------------------------------------ the column
  perform pg_temp.ok('a task starts with no start date',
                     (select starts_at from public.general_tasks where id = t) is null);

  update public.general_tasks
     set starts_at = ts, due_at = ts + interval '5 days' where id = t;
  perform pg_temp.ok('a start before its due date is accepted',
                     (select starts_at from public.general_tasks where id = t) = ts);

  begin
    update public.general_tasks set starts_at = ts + interval '9 days' where id = t;
    perform pg_temp.ok('a start after its due date is refused', false);
  exception when check_violation then
    perform pg_temp.ok('a start after its due date is refused', true);
  end;

  -- A control: the same start on the same day as the due date is fine.
  update public.general_tasks set starts_at = ts + interval '5 days' where id = t;
  perform pg_temp.ok('a start on the due date is accepted',
                     (select starts_at from public.general_tasks where id = t) = ts + interval '5 days');

  begin
    insert into public.general_tasks (project_id, title, created_by, starts_at)
    values (proj.id, 'No due date', owner_id, ts);
    perform pg_temp.ok('a start with no due date is accepted', true);
  exception when others then
    perform pg_temp.ok('a start with no due date is accepted', false);
  end;

  ------------------------------------------------------------------ the history
  update public.general_tasks set starts_at = ts + interval '1 day' where id = t;
  select detail into d from public.general_task_events
   where task_id = t and kind = 'updated' order by created_at desc limit 1;
  perform pg_temp.ok('the history names the start among the changed fields',
                     (d -> 'fields') ? 'starts_at');
  perform pg_temp.ok('the history keeps where the start came from',
                     (d ->> 'starts_from')::timestamptz = ts + interval '5 days');
  perform pg_temp.ok('the history keeps where the start went',
                     (d ->> 'starts_to')::timestamptz = ts + interval '1 day');

  update public.general_tasks set starts_at = null where id = t;
  select detail into d from public.general_task_events
   where task_id = t and kind = 'updated' order by created_at desc limit 1;
  perform pg_temp.ok('taking the start off is recorded as a change',
                     (d -> 'fields') ? 'starts_at' and d ->> 'starts_to' is null);

  update public.general_tasks set title = 'Plan it properly' where id = t;
  select detail into d from public.general_task_events
   where task_id = t and kind = 'updated' order by created_at desc limit 1;
  perform pg_temp.ok('a change that leaves the start alone does not mention it',
                     not ((d -> 'fields') ? 'starts_at'));

  ------------------------------------------------------------------ the overview
  select count(*) into n from public.general_task_overview where id = t;
  perform pg_temp.ok('the overview still returns the task', n = 1);

  update public.general_tasks set starts_at = ts where id = t;
  perform pg_temp.ok('the overview carries the start date',
                     (select starts_at from public.general_task_overview where id = t) = ts);

  ------------------------------------------------------------------ reading
  perform pg_temp.act_as(other_id);
  select count(*) into n from public.general_task_overview where id = t;
  perform pg_temp.ok('a stranger still reads nothing', n = 0);
end $$;

rollback;
```

- [ ] **Step 4: Run the test against the current database and watch it fail**

The column does not exist yet, so this must fail rather than pass.

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
set -a && . ./.env.local; set +a
PW=$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's|^postgresql://[^:]+:([^@]+)@.*|\1|')
POOL=$(cat supabase/.temp/pooler-url)
export SUPABASE_DB_URL="postgresql://$(printf '%s' "$POOL" | sed -E 's|^postgresql://([^:@]+).*|\1|'):${PW}@$(printf '%s' "$POOL" | sed -E 's|^.*@||')"
node scripts/db.mjs supabase/tests/general-schedule.test.sql 2>&1 | tail -5
```

Expected: `SQL failed: column "starts_at" does not exist`.

- [ ] **Step 5: Apply the schema file twice**

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
set -a && . ./.env.local; set +a
PW=$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's|^postgresql://[^:]+:([^@]+)@.*|\1|')
POOL=$(cat supabase/.temp/pooler-url)
export SUPABASE_DB_URL="postgresql://$(printf '%s' "$POOL" | sed -E 's|^postgresql://([^:@]+).*|\1|'):${PW}@$(printf '%s' "$POOL" | sed -E 's|^.*@||')"
node scripts/db.mjs supabase/general-schedule.sql 2>&1 | grep -iE "SQL failed|Done"
node scripts/db.mjs supabase/general-schedule.sql 2>&1 | grep -iE "SQL failed|Done"
```

Expected: `Done.` twice, no `SQL failed`.

- [ ] **Step 6: Run the test and watch it pass**

Same shell preamble, then:

```bash
node scripts/db.mjs supabase/tests/general-schedule.test.sql 2>&1 | grep -E "PASS|FAIL|SQL failed"
```

Expected: 12 `PASS` lines, no `FAIL`, no `SQL failed`.

- [ ] **Step 7: Re-run the suites this file redefines objects for**

Same shell preamble, then:

```bash
for f in general-tasks general general-files general-drafts; do
  out=$(node scripts/db.mjs supabase/tests/$f.test.sql 2>&1)
  printf '%-16s %3s PASS  %s fail\n' "$f" "$(printf '%s' "$out"|grep -c PASS)" "$(printf '%s' "$out"|grep -ci 'NOTICE: FAIL\|^SQL failed')"
done
```

Expected: `general-tasks 48 PASS 0 fail`, `general 74 PASS 0 fail`, `general-files 20 PASS 0 fail`, `general-drafts 35 PASS 0 fail`.

- [ ] **Step 8: Register the file**

In `scripts/schema-drift.mjs`, the `ORDER` list currently ends
`... presets general-repo general-files general-drafts general-history`.
Append `general-schedule`:

```js
consent privacy-requests term-shifts hardening workplaces general general-tasks general-notify
presets general-repo general-files general-drafts general-history general-schedule`.split(/\s+/)
```

In `docs/07-backup.md`, the rebuild command ends `... supabase/general-history.sql`.
Append ` supabase/general-schedule.sql` to it.

- [ ] **Step 9: Check the drift report**

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
node scripts/schema-drift.mjs 2>&1 | grep -E "record_general_task_event|general_task_overview"
```

Expected two lines, each `ok`, each ending in `general-schedule`, and each
longer than the definition before it.

- [ ] **Step 10: Commit**

```bash
git add supabase/general-schedule.sql supabase/tests/general-schedule.test.sql scripts/schema-drift.mjs docs/07-backup.md
git commit -m "Give a task a start date, and keep the old one in its history"
```

---

## Task 2: The start date in the interface

**Files:**
- Modify: `src/lib/general/types.ts` (the `GeneralTask` type and `GeneralTaskEvent['detail']`)
- Modify: `src/lib/api/general.ts` (`createTask` input and `TaskPatch`)
- Modify: `src/lib/general/history.ts` (render a start change)
- Modify: `src/lib/general/history.test.ts`
- Modify: `src/components/general/TaskDialog.tsx` (a Start field)
- Modify: `src/components/general/TasksTab.tsx` (a Start field on the new-task dialog)

**Interfaces:**
- Consumes: Task 1's `starts_at` column and `starts_from`/`starts_to` event detail.
- Produces:
  - `GeneralTask.starts_at: string | null`
  - `createTask({ …, startsAt: string | null })`
  - `TaskPatch` accepts `starts_at: string | null`
  - `describeEvent` renders a lone `starts_at` change as a sentence

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/general/history.test.ts`:

```ts
describe('describeEvent on a start date', () => {
  it('reads a start being set', () => {
    expect(
      describeEvent(
        event({
          kind: 'updated',
          detail: { fields: ['starts_at'], starts_from: null, starts_to: '2026-10-10T06:00:00Z' },
        }),
        nameOf,
      ),
    ).toMatch(/^Ana Reyes set the start to /)
  })

  it('reads a start moving', () => {
    expect(
      describeEvent(
        event({
          kind: 'updated',
          detail: {
            fields: ['starts_at'],
            starts_from: '2026-10-03T06:00:00Z',
            starts_to: '2026-10-10T06:00:00Z',
          },
        }),
        nameOf,
      ),
    ).toMatch(/^Ana Reyes moved the start from .* to /)
  })

  it('reads a start being taken off', () => {
    expect(
      describeEvent(
        event({
          kind: 'updated',
          detail: { fields: ['starts_at'], starts_from: '2026-10-03T06:00:00Z', starts_to: null },
        }),
        nameOf,
      ),
    ).toBe('Ana Reyes took the start date off')
  })

  it('names the start in a list when several things changed', () => {
    expect(
      describeEvent(
        event({ kind: 'updated', detail: { fields: ['starts_at', 'due_at'] } }),
        nameOf,
      ),
    ).toBe('Ana Reyes changed the start date and due date')
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
npx vitest run src/lib/general/history.test.ts
```

Expected: 4 failures. The first three report the field-list fallback
(`"Ana Reyes changed the start date"`) instead of a sentence; the fourth
reports `changed the starts_at and due date`, because `FIELD_WORDS` has no
entry for `starts_at`.

- [ ] **Step 3: Widen the event detail type**

In `src/lib/general/types.ts`, inside `GeneralTaskEvent['detail']`, add two
members after `due_to`:

```ts
    starts_from?: string | null
    starts_to?: string | null
```

In the same file, add `starts_at` to `GeneralTask`, after `due_at`:

```ts
  due_at: string | null
  /** When the work is meant to begin. Null until somebody says. */
  starts_at: string | null
```

- [ ] **Step 4: Render the start change**

In `src/lib/general/history.ts`, add an entry to `FIELD_WORDS`:

```ts
const FIELD_WORDS: Record<string, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  due_at: 'due date',
  starts_at: 'start date',
  team_id: 'team',
  weight: 'points',
}
```

In the same file, inside `case 'updated'`, after the `due_at` branch and before
the `weight` branch, add:

```ts
        if (fields[0] === 'starts_at' && d.starts_to !== undefined) {
          if (!d.starts_to) return `${actor} took the start date off`
          return d.starts_from
            ? `${actor} moved the start from ${formatDue(d.starts_from)} to ${formatDue(d.starts_to)}`
            : `${actor} set the start to ${formatDue(d.starts_to)}`
        }
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
npx vitest run src/lib/general/history.test.ts
```

Expected: `Tests  20 passed (20)`.

- [ ] **Step 6: Carry the field through the API**

In `src/lib/api/general.ts`, `createTask` takes a new member. Replace its input
type and insert:

```ts
export async function createTask(input: {
  projectId: string
  title: string
  description: string
  dueAt: string | null
  startsAt: string | null
  teamId: string | null
  weight: number
}) {
```

and inside the `.insert({ … })` object, after the `due_at` line, add:

```ts
      starts_at: input.startsAt,
```

In the same file, find `export type TaskPatch` and add `starts_at` to it:

```ts
export type TaskPatch = Partial<{
  title: string
  description: string
  status: GeneralTaskStatus
  due_at: string | null
  starts_at: string | null
  team_id: string | null
  weight: number
}>
```

That is the whole of `TaskPatch` as it stands at `src/lib/api/general.ts:604`;
only the `starts_at` line is new.

- [ ] **Step 7: Add the Start field to the task dialog**

In `src/components/general/TaskDialog.tsx`, inside `TaskDetails`:

Add state beside the existing `due` state:

```ts
  const [starts, setStarts] = useState('')
```

In the effect that fills the form from the task, after `setDue(...)`:

```ts
    setStarts(toLocalInput(task.starts_at))
```

In `save()`, inside the `updateTask` call, after the `due_at` line:

```ts
        starts_at: fromLocalInput(starts),
```

Before that call, after the existing title check, add the guard the database
also enforces, so somebody is told before the save is refused:

```ts
    const startsAt = fromLocalInput(starts)
    const dueAt = fromLocalInput(due)
    if (startsAt && dueAt && startsAt > dueAt)
      return setError('A task cannot start after it is due. Move one of the two dates.')
```

and use those two values in the `updateTask` call instead of calling
`fromLocalInput` twice:

```ts
      await updateTask(task.id, {
        title: title.trim(),
        description,
        status,
        due_at: dueAt,
        starts_at: startsAt,
        team_id: team || null,
        ...(canManage && points ? { weight: w } : {}),
      })
```

In the form, add a Start field immediately before the existing Due field:

```tsx
        <Field label="Starts" optional>
          {(id) => (
            <Input id={id} type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
          )}
        </Field>
```

In the read-only branch of `TaskDetails` (the `if (!canEdit)` return), add a
Starts entry to the `<dl>`, immediately before the Due entry:

```tsx
          <div>
            <dt className="text-[12px] text-faint">Starts</dt>
            <dd className="text-ink">{task.starts_at ? formatDue(task.starts_at) : 'Not set'}</dd>
          </div>
```

- [ ] **Step 8: Add the Start field to the new-task dialog**

In `src/components/general/TasksTab.tsx`, find the component that creates a
task. Add state beside its `due` state:

```ts
  const [starts, setStarts] = useState('')
```

Add a field immediately before its Due field:

```tsx
        <Field label="Starts" optional>
          {(id) => (
            <Input id={id} type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
          )}
        </Field>
```

Add the same guard before the `createTask` call:

```ts
    const startsAt = fromLocalInput(starts)
    const dueAt = fromLocalInput(due)
    if (startsAt && dueAt && startsAt > dueAt)
      return setError('A task cannot start after it is due. Move one of the two dates.')
```

and pass both in the call:

```ts
      await createTask({
        projectId: project.id,
        title,
        description,
        dueAt,
        startsAt,
        teamId: team || null,
        weight: points && canManage ? Number(weight) : 1,
      })
```

Reset it wherever the dialog resets its other fields:

```ts
    setStarts('')
```

`TasksTab.tsx` already imports `fromLocalInput` at line 15, so no new import is
needed. The component holding the new-task dialog has its `due` state at line
300, its `createTask` call at 316, its reset at 327 and its Due field at 366.

- [ ] **Step 9: Typecheck and lint**

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
npm run typecheck
npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs
```

Expected: typecheck prints only its two banner lines; lint ends
`23 problems (0 errors, 23 warnings)`.

- [ ] **Step 10: Run the whole unit suite**

```bash
npm run test
```

Expected: every file passes, and the total is 4 higher than before this task.

- [ ] **Step 11: Commit**

```bash
git add src/lib/general/types.ts src/lib/api/general.ts src/lib/general/history.ts src/lib/general/history.test.ts src/components/general/TaskDialog.tsx src/components/general/TasksTab.tsx
git commit -m "Let somebody say when a task starts"
```

---

## Task 3: Where a task sits on a timeline

**Files:**
- Create: `src/lib/general/timeline.ts`
- Create: `src/lib/general/timeline.test.ts`

**Interfaces:**
- Consumes: `GeneralTask` and `GeneralTeam` from `src/lib/general/types.ts`, and `GeneralTaskStatus` from `src/lib/general/progress.ts`.
- Produces:

```ts
export type TimelineWindow = { start: number; end: number; source: 'project' | 'tasks' | 'none' }
export type Placement =
  | { shape: 'bar'; left: number; width: number }
  | { shape: 'diamond'; left: number }
  | { shape: 'none' }
export type Tick = { at: number; left: number; label: string }
export type TimelineRow = { team: string | null; teamName: string; tasks: TimelineTask[] }
export type TimelineTask = Pick<GeneralTask, 'id' | 'title' | 'status' | 'due_at' | 'starts_at' | 'team_id'>

export function timelineWindow(
  project: { starts_on: string | null; ends_on: string | null },
  tasks: readonly TimelineTask[],
): TimelineWindow
export function placeTask(task: TimelineTask, window: TimelineWindow): Placement
export function axisTicks(window: TimelineWindow): Tick[]
export function groupRows(
  tasks: readonly TimelineTask[],
  teams: readonly { id: string; name: string }[],
): TimelineRow[]
export function nowMarker(window: TimelineWindow, now?: number): number | null
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/general/timeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  axisTicks,
  groupRows,
  nowMarker,
  placeTask,
  timelineWindow,
} from './timeline'
import type { TimelineTask } from './timeline'

const day = (iso: string) => new Date(iso).getTime()

function task(over: Partial<TimelineTask> = {}): TimelineTask {
  return {
    id: 't',
    title: 'A task',
    status: 'todo',
    due_at: null,
    starts_at: null,
    team_id: null,
    ...over,
  }
}

const project = (starts_on: string | null, ends_on: string | null) => ({ starts_on, ends_on })

describe('timelineWindow', () => {
  it('uses the project\u2019s own dates when it has them', () => {
    const w = timelineWindow(project('2026-10-01', '2026-12-01'), [])
    expect(w.source).toBe('project')
    expect(new Date(w.start).getMonth()).toBe(9)
    expect(new Date(w.end).getMonth()).toBe(11)
  })

  it('falls back to the tasks when the project has no dates', () => {
    const w = timelineWindow(project(null, null), [
      task({ starts_at: '2026-10-05T00:00:00Z', due_at: '2026-10-09T00:00:00Z' }),
      task({ due_at: '2026-11-20T00:00:00Z' }),
    ])
    expect(w.source).toBe('tasks')
    expect(w.start).toBe(day('2026-10-05T00:00:00Z'))
    expect(w.end).toBe(day('2026-11-20T00:00:00Z'))
  })

  it('falls back when the project has only one of its two dates', () => {
    const w = timelineWindow(project('2026-10-01', null), [task({ due_at: '2026-11-01T00:00:00Z' })])
    expect(w.source).toBe('tasks')
  })

  it('says it has nothing to draw when neither has a date', () => {
    expect(timelineWindow(project(null, null), [task()]).source).toBe('none')
    expect(timelineWindow(project(null, null), []).source).toBe('none')
  })

  it('never returns a window of zero width', () => {
    const w = timelineWindow(project(null, null), [task({ due_at: '2026-10-05T00:00:00Z' })])
    expect(w.end).toBeGreaterThan(w.start)
  })
})

describe('placeTask', () => {
  const w = timelineWindow(project('2026-10-01', '2026-10-11'), [])

  it('draws a bar for a task with both dates', () => {
    const p = placeTask(
      task({ starts_at: '2026-10-01T00:00:00Z', due_at: '2026-10-06T00:00:00Z' }),
      w,
    )
    expect(p.shape).toBe('bar')
    if (p.shape !== 'bar') return
    expect(p.left).toBeGreaterThanOrEqual(0)
    expect(p.left + p.width).toBeLessThanOrEqual(100)
    expect(p.width).toBeGreaterThan(0)
  })

  it('draws a diamond for a task with only a due date', () => {
    const p = placeTask(task({ due_at: '2026-10-06T00:00:00Z' }), w)
    expect(p.shape).toBe('diamond')
  })

  it('draws a diamond for a task with only a start date', () => {
    const p = placeTask(task({ starts_at: '2026-10-06T00:00:00Z' }), w)
    expect(p.shape).toBe('diamond')
  })

  it('draws nothing for a task with no dates at all', () => {
    expect(placeTask(task(), w).shape).toBe('none')
  })

  it('draws nothing when there is no window', () => {
    const none = timelineWindow(project(null, null), [])
    expect(placeTask(task({ due_at: '2026-10-06T00:00:00Z' }), none).shape).toBe('none')
  })

  it('keeps a task that runs past the window inside it', () => {
    const p = placeTask(
      task({ starts_at: '2026-09-01T00:00:00Z', due_at: '2026-12-01T00:00:00Z' }),
      w,
    )
    expect(p.shape).toBe('bar')
    if (p.shape !== 'bar') return
    expect(p.left).toBe(0)
    expect(p.width).toBe(100)
  })

  it('gives a one-day bar a width somebody can see', () => {
    const p = placeTask(
      task({ starts_at: '2026-10-05T00:00:00Z', due_at: '2026-10-05T00:00:00Z' }),
      w,
    )
    expect(p.shape).toBe('bar')
    if (p.shape !== 'bar') return
    expect(p.width).toBeGreaterThanOrEqual(1)
  })
})

describe('axisTicks', () => {
  it('ticks by week over a short project', () => {
    const ticks = axisTicks(timelineWindow(project('2026-10-01', '2026-11-01'), []))
    expect(ticks.length).toBeGreaterThan(2)
    expect(ticks.length).toBeLessThanOrEqual(8)
    expect(ticks[0].left).toBeGreaterThanOrEqual(0)
    expect(ticks[ticks.length - 1].left).toBeLessThanOrEqual(100)
  })

  it('ticks by month over a long one', () => {
    const ticks = axisTicks(timelineWindow(project('2026-01-01', '2026-12-31'), []))
    expect(ticks.length).toBeLessThanOrEqual(13)
    expect(ticks.some((t) => /Jan|Feb|Mar/.test(t.label))).toBe(true)
  })

  it('has nothing to tick with no window', () => {
    expect(axisTicks(timelineWindow(project(null, null), []))).toEqual([])
  })
})

describe('groupRows', () => {
  const teams = [
    { id: 'a', name: 'Development' },
    { id: 'b', name: 'Testing' },
  ]

  it('puts project-wide work first, then teams by name', () => {
    const rows = groupRows(
      [
        task({ id: '1', team_id: 'b' }),
        task({ id: '2', team_id: null }),
        task({ id: '3', team_id: 'a' }),
      ],
      teams,
    )
    expect(rows.map((r) => r.teamName)).toEqual(['Whole project', 'Development', 'Testing'])
  })

  it('leaves out a team with no tasks', () => {
    const rows = groupRows([task({ team_id: 'a' })], teams)
    expect(rows.map((r) => r.teamName)).toEqual(['Development'])
  })

  it('orders tasks by start, then due, then title', () => {
    const rows = groupRows(
      [
        task({ id: 'late', title: 'B', due_at: '2026-10-09T00:00:00Z' }),
        task({ id: 'early', title: 'A', starts_at: '2026-10-01T00:00:00Z', due_at: '2026-10-09T00:00:00Z' }),
        task({ id: 'none', title: 'C' }),
      ],
      [],
    )
    expect(rows[0].tasks.map((t) => t.id)).toEqual(['early', 'late', 'none'])
  })

  it('returns nothing for a project with no tasks', () => {
    expect(groupRows([], teams)).toEqual([])
  })
})

describe('nowMarker', () => {
  const w = timelineWindow(project('2026-10-01', '2026-10-11'), [])

  it('places today inside the window', () => {
    const at = nowMarker(w, day('2026-10-06T00:00:00Z'))
    expect(at).not.toBeNull()
    expect(at as number).toBeGreaterThan(0)
    expect(at as number).toBeLessThan(100)
  })

  it('says nothing when today is outside the window', () => {
    expect(nowMarker(w, day('2026-09-01T00:00:00Z'))).toBeNull()
    expect(nowMarker(w, day('2026-12-01T00:00:00Z'))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
npx vitest run src/lib/general/timeline.test.ts
```

Expected: the file fails to import — `Failed to resolve import "./timeline"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/general/timeline.ts`:

```ts
/**
 * Where a task sits on a project's timeline.
 *
 * Everything here answers in percentages of the window, because the chart is
 * drawn with CSS widths and offsets rather than a canvas — the same way
 * `src/components/analytics/PressureChart.tsx` draws its bars. Nothing in this
 * file knows about React or about how a date should read to a person.
 */
import type { GeneralTask } from './types'

export type TimelineTask = Pick<
  GeneralTask,
  'id' | 'title' | 'status' | 'due_at' | 'starts_at' | 'team_id'
>

/**
 * The span the chart covers, and where it came from.
 *
 * `source` is on the record so the panel can say "from this project's dates"
 * or "from its tasks" — a reader who does not know which is being shown cannot
 * tell whether a gap at the end is slack or a missing end date.
 */
export type TimelineWindow = { start: number; end: number; source: 'project' | 'tasks' | 'none' }

export type Placement =
  | { shape: 'bar'; left: number; width: number }
  | { shape: 'diamond'; left: number }
  | { shape: 'none' }

export type Tick = { at: number; left: number; label: string }

export type TimelineRow = { team: string | null; teamName: string; tasks: TimelineTask[] }

const DAY = 86_400_000

/** A project's dates are calendar days, so they are parsed as local midnight. */
function dayStart(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function instant(iso: string | null) {
  return iso ? new Date(iso).getTime() : null
}

function taskDates(task: TimelineTask) {
  return [instant(task.starts_at), instant(task.due_at)].filter((n): n is number => n !== null)
}

export function timelineWindow(
  project: { starts_on: string | null; ends_on: string | null },
  tasks: readonly TimelineTask[],
): TimelineWindow {
  if (project.starts_on && project.ends_on) {
    const start = dayStart(project.starts_on)
    // The end day is a whole day, not the instant it begins.
    const end = dayStart(project.ends_on) + DAY
    if (end > start) return { start, end, source: 'project' }
  }

  const all = tasks.flatMap(taskDates)
  if (all.length === 0) return { start: 0, end: 0, source: 'none' }

  const start = Math.min(...all)
  const end = Math.max(...all)
  // A project whose every date is the same day still needs a width to draw in.
  return { start, end: end > start ? end : start + DAY, source: 'tasks' }
}

const clamp = (n: number) => Math.min(100, Math.max(0, n))

function offset(at: number, window: TimelineWindow) {
  return clamp(((at - window.start) / (window.end - window.start)) * 100)
}

export function placeTask(task: TimelineTask, window: TimelineWindow): Placement {
  if (window.source === 'none') return { shape: 'none' }

  const from = instant(task.starts_at)
  const to = instant(task.due_at)

  if (from !== null && to !== null) {
    const left = offset(Math.min(from, to), window)
    const right = offset(Math.max(from, to), window)
    // A task that starts and ends the same day would otherwise be invisible.
    return { shape: 'bar', left, width: Math.max(1, Math.min(100 - left, right - left)) }
  }

  const only = from ?? to
  if (only === null) return { shape: 'none' }
  return { shape: 'diamond', left: offset(only, window) }
}

export function axisTicks(window: TimelineWindow): Tick[] {
  if (window.source === 'none') return []

  const span = window.end - window.start
  const byMonth = span > 70 * DAY
  const out: Tick[] = []

  const cursor = new Date(window.start)
  cursor.setHours(0, 0, 0, 0)
  if (byMonth) cursor.setDate(1)

  // Guarded rather than while(true): a bad window must not hang the page.
  for (let i = 0; i < 400; i++) {
    const at = cursor.getTime()
    if (at > window.end) break
    if (at >= window.start) {
      out.push({
        at,
        left: offset(at, window),
        label: cursor.toLocaleDateString('en-US',
          byMonth ? { month: 'short' } : { month: 'short', day: 'numeric' }),
      })
    }
    if (byMonth) cursor.setMonth(cursor.getMonth() + 1)
    else cursor.setDate(cursor.getDate() + 7)
  }

  return out
}

export function groupRows(
  tasks: readonly TimelineTask[],
  teams: readonly { id: string; name: string }[],
): TimelineRow[] {
  const order = (a: TimelineTask, b: TimelineTask) => {
    const av = instant(a.starts_at) ?? instant(a.due_at) ?? Number.MAX_SAFE_INTEGER
    const bv = instant(b.starts_at) ?? instant(b.due_at) ?? Number.MAX_SAFE_INTEGER
    if (av !== bv) return av - bv
    return a.title.localeCompare(b.title)
  }

  const rows: TimelineRow[] = []

  // Work that belongs to everybody reads first; it is the project's own spine.
  const loose = tasks.filter((t) => !t.team_id)
  if (loose.length) rows.push({ team: null, teamName: 'Whole project', tasks: [...loose].sort(order) })

  for (const team of [...teams].sort((a, b) => a.name.localeCompare(b.name))) {
    const mine = tasks.filter((t) => t.team_id === team.id)
    if (mine.length) rows.push({ team: team.id, teamName: team.name, tasks: [...mine].sort(order) })
  }

  return rows
}

/** Where today sits, or null when today is outside the window. */
export function nowMarker(window: TimelineWindow, now = Date.now()): number | null {
  if (window.source === 'none') return null
  if (now < window.start || now > window.end) return null
  return offset(now, window)
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
npx vitest run src/lib/general/timeline.test.ts
```

Expected: `Tests  20 passed (20)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/general/timeline.ts src/lib/general/timeline.test.ts
git commit -m "Work out where a task sits on a project's timeline"
```

---

## Task 4: Whether the work fits before the end date

**Files:**
- Create: `src/lib/general/forecast.ts`
- Create: `src/lib/general/forecast.test.ts`

**Interfaces:**
- Consumes: `GeneralTask` from `src/lib/general/types.ts`.
- Produces:

```ts
export type ForecastState =
  | 'no_tasks'
  | 'not_started'
  | 'finished'
  | 'no_end_date'
  | 'on_track'
  | 'overrunning'

export type Forecast = {
  state: ForecastState
  done: number
  total: number
  /** Tasks finished per week so far, rounded to one decimal. 0 before any are. */
  rate: number
  /** Days from now until the projected finish. Null when there is no rate. */
  daysLeft: number | null
  /** The projected finish, as an ISO string. Null when there is no rate. */
  finishesOn: string | null
  /** Days past the project's end date. 0 when it fits or cannot be judged. */
  overrunDays: number
}

export type ForecastTask = Pick<GeneralTask, 'status' | 'completed_at'>

export function projectForecast(
  tasks: readonly ForecastTask[],
  endsOn: string | null,
  now?: number,
): Forecast
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/general/forecast.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { projectForecast } from './forecast'
import type { ForecastTask } from './forecast'

const DAY = 86_400_000
const NOW = new Date('2026-10-29T00:00:00Z').getTime()
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

const done = (days: number): ForecastTask => ({ status: 'done', completed_at: ago(days) })
const open = (): ForecastTask => ({ status: 'todo', completed_at: null })

describe('projectForecast', () => {
  it('has nothing to say about a project with no tasks', () => {
    const f = projectForecast([], '2026-12-01', NOW)
    expect(f.state).toBe('no_tasks')
    expect(f.total).toBe(0)
  })

  it('calls a project nobody has started its own thing, not a rate of zero', () => {
    const f = projectForecast([open(), open()], '2026-12-01', NOW)
    expect(f.state).toBe('not_started')
    expect(f.rate).toBe(0)
    expect(f.finishesOn).toBeNull()
  })

  it('knows when everything is done', () => {
    const f = projectForecast([done(3), done(1)], '2026-12-01', NOW)
    expect(f.state).toBe('finished')
    expect(f.done).toBe(2)
    expect(f.total).toBe(2)
  })

  it('still projects a finish with no end date, and says the date is missing', () => {
    const f = projectForecast([done(14), done(7), open(), open()], null, NOW)
    expect(f.state).toBe('no_end_date')
    expect(f.rate).toBeGreaterThan(0)
    expect(f.finishesOn).not.toBeNull()
    expect(f.overrunDays).toBe(0)
  })

  it('says a project is on track when the work fits', () => {
    // Two finished in the last fortnight, two left: about two more weeks.
    const f = projectForecast([done(14), done(7), open(), open()], '2026-12-31', NOW)
    expect(f.state).toBe('on_track')
    expect(f.overrunDays).toBe(0)
    expect(f.daysLeft).toBeGreaterThan(0)
  })

  it('says by how many days a project will overrun', () => {
    const f = projectForecast([done(14), done(7), open(), open()], '2026-11-01', NOW)
    expect(f.state).toBe('overrunning')
    expect(f.overrunDays).toBeGreaterThan(0)
  })

  it('does not divide by zero when the only task finished today', () => {
    const f = projectForecast([done(0), open()], '2026-12-01', NOW)
    expect(Number.isFinite(f.rate)).toBe(true)
    expect(f.rate).toBeGreaterThan(0)
    expect(f.finishesOn).not.toBeNull()
  })

  it('treats a done task with no completion date as done, not as progress', () => {
    const f = projectForecast(
      [{ status: 'done', completed_at: null }, open()],
      '2026-12-01',
      NOW,
    )
    expect(f.done).toBe(2 - 1)
    expect(f.state).toBe('not_started')
  })

  it('reports an end date already past as an overrun', () => {
    const f = projectForecast([done(14), open()], '2026-10-01', NOW)
    expect(f.state).toBe('overrunning')
    expect(f.overrunDays).toBeGreaterThan(0)
  })

  it('counts every done task, whatever its completion date', () => {
    const f = projectForecast([done(20), done(2), open()], '2026-12-01', NOW)
    expect(f.done).toBe(2)
    expect(f.total).toBe(3)
  })

  it('rounds the rate to one decimal so it reads as a sentence', () => {
    const f = projectForecast([done(7), done(7), done(7), open()], '2026-12-01', NOW)
    expect(f.rate).toBe(Math.round(f.rate * 10) / 10)
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
npx vitest run src/lib/general/forecast.test.ts
```

Expected: `Failed to resolve import "./forecast"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/general/forecast.ts`:

```ts
/**
 * Whether the work still open fits before the project's end date.
 *
 * Counting, not clairvoyance: the rate is what has happened so far, and the
 * projection is that rate continuing. It is on the page because it is the one
 * question a group asks in week six that nothing else in the product answers.
 *
 * `not_started` is its own state rather than a rate of zero, which is the
 * judgement Education's BurnCard makes too. A project moving at zero per day
 * reads as slow; a project nobody has opened is a different problem with a
 * different fix, and it is the one worth catching early.
 */
import type { GeneralTask } from './types'

export type ForecastState =
  | 'no_tasks'
  | 'not_started'
  | 'finished'
  | 'no_end_date'
  | 'on_track'
  | 'overrunning'

export type Forecast = {
  state: ForecastState
  done: number
  total: number
  rate: number
  daysLeft: number | null
  finishesOn: string | null
  overrunDays: number
}

export type ForecastTask = Pick<GeneralTask, 'status' | 'completed_at'>

const DAY = 86_400_000
const WEEK = 7 * DAY

/** A project's end is a calendar day, so it is parsed as local midnight. */
function endOfDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).getTime() + DAY
}

export function projectForecast(
  tasks: readonly ForecastTask[],
  endsOn: string | null,
  now = Date.now(),
): Forecast {
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'done').length
  const empty = { done, total, rate: 0, daysLeft: null, finishesOn: null, overrunDays: 0 }

  if (total === 0) return { state: 'no_tasks', ...empty, done: 0, total: 0 }
  if (done === total) return { state: 'finished', ...empty }

  // Only a task that says when it finished can tell us how fast work goes.
  const stamps = tasks
    .filter((t) => t.status === 'done' && t.completed_at)
    .map((t) => new Date(t.completed_at as string).getTime())
    .sort((a, b) => a - b)

  if (stamps.length === 0) return { state: 'not_started', ...empty }

  // From the first finish to now, floored at a day: a project whose first task
  // finished an hour ago is not running at twenty-four tasks a day.
  const elapsed = Math.max(DAY, now - stamps[0])
  const rate = Math.round((stamps.length / (elapsed / WEEK)) * 10) / 10
  const remaining = total - done
  const daysLeft = Math.ceil((remaining / stamps.length) * (elapsed / DAY))
  const finish = now + daysLeft * DAY
  const finishesOn = new Date(finish).toISOString()

  if (!endsOn) {
    return { state: 'no_end_date', done, total, rate, daysLeft, finishesOn, overrunDays: 0 }
  }

  const deadline = endOfDay(endsOn)
  const overrunDays = Math.max(0, Math.ceil((finish - deadline) / DAY))

  return {
    state: overrunDays > 0 ? 'overrunning' : 'on_track',
    done,
    total,
    rate,
    daysLeft,
    finishesOn,
    overrunDays,
  }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
npx vitest run src/lib/general/forecast.test.ts
```

Expected: `Tests  11 passed (11)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/general/forecast.ts src/lib/general/forecast.test.ts
git commit -m "Work out whether a project's remaining tasks fit before its end"
```

---

## Task 5: What is late, and what lands next

**Files:**
- Create: `src/lib/general/pressure.ts`
- Create: `src/lib/general/pressure.test.ts`

**Interfaces:**
- Consumes: `GeneralTask` from `src/lib/general/types.ts`.
- Produces:

```ts
export type PressureTask = Pick<GeneralTask, 'id' | 'title' | 'status' | 'due_at' | 'team_id'>
export type DueWeek = { start: number; label: string; count: number }

export function overdueTasks(tasks: readonly PressureTask[], now?: number): PressureTask[]
export function dueByWeek(tasks: readonly PressureTask[], now?: number, weeks?: number): DueWeek[]
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/general/pressure.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { dueByWeek, overdueTasks } from './pressure'
import type { PressureTask } from './pressure'

const DAY = 86_400_000
const NOW = new Date('2026-10-29T12:00:00Z').getTime()
const inDays = (n: number) => new Date(NOW + n * DAY).toISOString()

function task(over: Partial<PressureTask> = {}): PressureTask {
  return { id: 't', title: 'A task', status: 'todo', due_at: null, team_id: null, ...over }
}

describe('overdueTasks', () => {
  it('finds an open task past its date', () => {
    const late = task({ id: 'late', due_at: inDays(-2) })
    expect(overdueTasks([late, task({ due_at: inDays(3) })], NOW).map((t) => t.id)).toEqual(['late'])
  })

  it('leaves a finished task alone however late it was', () => {
    expect(overdueTasks([task({ status: 'done', due_at: inDays(-9) })], NOW)).toEqual([])
  })

  it('leaves a task with no date alone', () => {
    expect(overdueTasks([task()], NOW)).toEqual([])
  })

  it('puts the longest overdue first', () => {
    const rows = overdueTasks(
      [
        task({ id: 'a', due_at: inDays(-1) }),
        task({ id: 'c', due_at: inDays(-9) }),
        task({ id: 'b', due_at: inDays(-4) }),
      ],
      NOW,
    )
    expect(rows.map((t) => t.id)).toEqual(['c', 'b', 'a'])
  })

  it('counts a task in progress as overdue too', () => {
    expect(overdueTasks([task({ status: 'in_progress', due_at: inDays(-1) })], NOW)).toHaveLength(1)
  })
})

describe('dueByWeek', () => {
  it('returns one bucket per week asked for', () => {
    expect(dueByWeek([], NOW, 4)).toHaveLength(4)
  })

  it('counts a task in the week it falls due', () => {
    const weeks = dueByWeek([task({ due_at: inDays(2) }), task({ due_at: inDays(9) })], NOW, 4)
    expect(weeks[0].count).toBe(1)
    expect(weeks[1].count).toBe(1)
  })

  it('leaves out anything already overdue', () => {
    expect(dueByWeek([task({ due_at: inDays(-1) })], NOW, 4).every((w) => w.count === 0)).toBe(true)
  })

  it('leaves out anything finished', () => {
    expect(
      dueByWeek([task({ status: 'done', due_at: inDays(2) })], NOW, 4).every((w) => w.count === 0),
    ).toBe(true)
  })

  it('leaves out anything past the window', () => {
    expect(dueByWeek([task({ due_at: inDays(60) })], NOW, 4).every((w) => w.count === 0)).toBe(true)
  })

  it('labels every bucket', () => {
    for (const w of dueByWeek([], NOW, 4)) expect(w.label.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
npx vitest run src/lib/general/pressure.test.ts
```

Expected: `Failed to resolve import "./pressure"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/general/pressure.ts`:

```ts
/**
 * What is already late, and what lands in the weeks ahead.
 *
 * The only part of the progress page somebody can still act on before it
 * happens. A week with eleven tasks in it is a week to move something out of.
 */
import type { GeneralTask } from './types'

export type PressureTask = Pick<GeneralTask, 'id' | 'title' | 'status' | 'due_at' | 'team_id'>
export type DueWeek = { start: number; label: string; count: number }

const DAY = 86_400_000
const WEEK = 7 * DAY

const at = (task: PressureTask) => (task.due_at ? new Date(task.due_at).getTime() : null)

export function overdueTasks(tasks: readonly PressureTask[], now = Date.now()): PressureTask[] {
  return tasks
    .filter((t) => t.status !== 'done' && at(t) !== null && (at(t) as number) < now)
    .sort((a, b) => (at(a) as number) - (at(b) as number))
}

export function dueByWeek(
  tasks: readonly PressureTask[],
  now = Date.now(),
  weeks = 4,
): DueWeek[] {
  const out: DueWeek[] = Array.from({ length: weeks }, (_, i) => {
    const start = now + i * WEEK
    return {
      start,
      label: new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count: 0,
    }
  })

  for (const task of tasks) {
    if (task.status === 'done') continue
    const due = at(task)
    if (due === null || due < now) continue
    const index = Math.floor((due - now) / WEEK)
    if (index >= 0 && index < weeks) out[index].count++
  }

  return out
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
npx vitest run src/lib/general/pressure.test.ts
```

Expected: `Tests  11 passed (11)`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/general/pressure.ts src/lib/general/pressure.test.ts
git commit -m "Work out what is overdue and what falls due next"
```

---

## Task 6: The Progress tab

**Files:**
- Create: `src/components/general/GanttChart.tsx`
- Create: `src/components/general/ForecastPanel.tsx`
- Create: `src/components/general/PressurePanel.tsx`
- Create: `src/components/general/ProgressTab.tsx`
- Modify: `src/pages/general/GeneralProject.tsx`

**Interfaces:**
- Consumes: `GeneralProjectState` from `src/components/general/useGeneralProject.ts`; `timelineWindow`, `placeTask`, `axisTicks`, `groupRows`, `nowMarker` from Task 3; `projectForecast` from Task 4; `overdueTasks`, `dueByWeek` from Task 5; `projectProgress` from `src/lib/general/progress.ts`; `formatDue`, `formatDay` from `src/lib/general/dates.ts`.
- Produces: `<ProgressTab state />`, and a `progress` tab on the project page reached by `?tab=progress`.

- [ ] **Step 1: Write the Gantt chart**

Create `src/components/general/GanttChart.tsx`:

```tsx
import { Icon } from '../ui/Icon'
import { formatDue } from '../../lib/general/dates'
import { axisTicks, groupRows, nowMarker, placeTask, timelineWindow } from '../../lib/general/timeline'
import type { TimelineTask } from '../../lib/general/timeline'
import type { GeneralProjectState } from './useGeneralProject'

const BAR = {
  todo: 'bg-navy-500/35',
  in_progress: 'bg-amber-400/70',
  done: 'bg-emerald-500/60',
} as const

/**
 * The project's whole timeline.
 *
 * A task with a start date draws a bar; one without draws a marker on the day
 * it is due. That difference is deliberate and the legend says so: no task in
 * the product has a start date until somebody sets one, and a chart that drew
 * nothing at all would read as broken rather than as a prompt.
 *
 * Drawn with CSS offsets rather than a chart library. The two shapes needed
 * here are a horizontal bar and a marker, and the entry bundle is 312 KB.
 */
export function GanttChart({ state }: { state: GeneralProjectState }) {
  const project = state.project
  if (!project) return null

  const tasks: TimelineTask[] = state.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    due_at: t.due_at,
    starts_at: t.starts_at,
    team_id: t.team_id,
  }))

  const window = timelineWindow(project, tasks)
  const rows = groupRows(tasks, state.teams)
  const ticks = axisTicks(window)
  const today = nowMarker(window)

  if (window.source === 'none' || rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
        No task has a date yet, so there is nothing to lay out. Give a task a start or a due date
        and it appears here.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-faint">
        {window.source === 'project'
          ? "Across this project's own dates."
          : 'Across the dates its tasks carry — the project has no dates of its own.'}
      </p>

      <div className="overflow-x-auto rounded-panel border border-line surface">
        <div className="min-w-[44rem]">
          <div className="relative flex border-b border-line px-3 py-1.5">
            <div className="w-[14rem] shrink-0" />
            <div className="relative h-4 flex-1">
              {ticks.map((t) => (
                <span
                  key={t.at}
                  className="absolute top-0 -translate-x-1/2 font-mono text-[10px] text-faint"
                  style={{ left: `${t.left}%` }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          {rows.map((row) => (
            <section key={row.team ?? 'loose'}>
              <p className="border-b border-line px-3 py-1 text-[11px] font-medium text-faint uppercase">
                {row.teamName}
              </p>
              {row.tasks.map((task) => {
                const place = placeTask(task, window)
                return (
                  <div key={task.id} className="flex items-center border-b border-line last:border-0">
                    <p className="w-[14rem] shrink-0 truncate px-3 py-2 text-[13px] text-ink">
                      {task.title}
                    </p>
                    <div className="relative h-8 flex-1">
                      {today !== null && (
                        <span
                          aria-hidden="true"
                          className="absolute top-0 bottom-0 w-px bg-amber-400/70"
                          style={{ left: `${today}%` }}
                        />
                      )}
                      {place.shape === 'bar' && (
                        <span
                          title={`${task.starts_at ? formatDue(task.starts_at) : ''} – ${task.due_at ? formatDue(task.due_at) : ''}`}
                          className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-full ${BAR[task.status]}`}
                          style={{ left: `${place.left}%`, width: `${place.width}%` }}
                        />
                      )}
                      {place.shape === 'diamond' && (
                        <span
                          title={task.due_at ? formatDue(task.due_at) : undefined}
                          className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 ${BAR[task.status]}`}
                          style={{ left: `${place.left}%` }}
                        />
                      )}
                    </div>
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-6 rounded-full bg-navy-500/35" />a task with a start and a due date
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rotate-45 bg-navy-500/35" />
          due on that day, with no start set yet
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-px bg-amber-400/70" />
          today
        </span>
        <span className="flex items-center gap-1.5">
          <Icon name="info" size={12} />
          Set a start date on a task to give it a bar.
        </span>
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Write the forecast panel**

Create `src/components/general/ForecastPanel.tsx`:

```tsx
import { Alert } from '../ui/Alert'
import { projectForecast } from '../../lib/general/forecast'
import { formatDay } from '../../lib/general/dates'
import type { GeneralProjectState } from './useGeneralProject'

/** An ISO instant as the calendar day it falls on, locally. */
function asDay(iso: string) {
  const d = new Date(iso)
  return formatDay(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
}

/**
 * Whether the work still open fits before the end date.
 *
 * The arithmetic is shown beside the answer for the same reason Education's
 * pace card shows it: a group asked to act on a projection is owed the sum
 * behind it.
 */
export function ForecastPanel({ state }: { state: GeneralProjectState }) {
  const project = state.project
  if (!project) return null

  const f = projectForecast(state.tasks, project.ends_on)

  if (f.state === 'no_tasks') {
    return <p className="text-[13px] text-muted">This project has no tasks yet.</p>
  }

  if (f.state === 'not_started') {
    return (
      <Alert tone="info">
        Nothing has been finished yet, so there is no pace to go on. This reads differently from
        moving slowly — it usually means nobody has picked the work up.
      </Alert>
    )
  }

  if (f.state === 'finished') {
    return (
      <p className="text-[14px] text-ink">
        Every task is done — all {f.total} of them.
      </p>
    )
  }

  const sum = (
    <p className="text-[12px] text-faint">
      {f.done} of {f.total} finished, about {f.rate} a week so far, {f.total - f.done} left.
    </p>
  )

  if (f.state === 'no_end_date') {
    return (
      <div className="space-y-1.5">
        <p className="text-[14px] text-ink">
          At this pace the last task lands around {asDay(f.finishesOn as string)}.
        </p>
        {sum}
        <p className="text-[12px] text-muted">
          This project has no end date, so there is nothing to compare that against. An Owner can
          set one on the Overview tab.
        </p>
      </div>
    )
  }

  if (f.state === 'overrunning') {
    return (
      <div className="space-y-1.5">
        <p className="text-[14px] text-red-700 dark:text-red-300">
          At this pace the work runs {f.overrunDays} {f.overrunDays === 1 ? 'day' : 'days'} past the
          end date — finishing around {asDay(f.finishesOn as string)} against{' '}
          {formatDay(project.ends_on as string)}.
        </p>
        {sum}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[14px] text-emerald-700 dark:text-emerald-300">
        At this pace the work finishes around {asDay(f.finishesOn as string)}, inside the{' '}
        {formatDay(project.ends_on as string)} end date.
      </p>
      {sum}
    </div>
  )
}
```

- [ ] **Step 3: Write the pressure panel**

Create `src/components/general/PressurePanel.tsx`:

```tsx
import { formatDue } from '../../lib/general/dates'
import { dueByWeek, overdueTasks } from '../../lib/general/pressure'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * What is already late, and what lands in the next four weeks.
 *
 * Bars are drawn against the busiest week in view, so the shape is the
 * comparison; the number beside each is the figure itself. The same reading
 * Education's PressureChart offers, for the same reason.
 */
export function PressurePanel({
  state,
  onOpen,
}: {
  state: GeneralProjectState
  onOpen: (taskId: string) => void
}) {
  const late = overdueTasks(state.tasks)
  const weeks = dueByWeek(state.tasks)
  const peak = Math.max(1, ...weeks.map((w) => w.count))
  const ahead = weeks.reduce((n, w) => n + w.count, 0)

  if (late.length === 0 && ahead === 0) {
    return (
      <p className="text-[13px] text-muted">
        Nothing is overdue, and no open task falls due in the next four weeks.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {late.length > 0 && (
        <div>
          <p className="flex items-center gap-2 text-[13px]">
            <span className="rounded-md bg-red-500/15 px-2 py-0.5 font-mono text-[12px] text-red-700 dark:text-red-300">
              {late.length} overdue
            </span>
            <span className="text-muted">past the date and not done</span>
          </p>
          <ul className="mt-2 divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-line">
            {late.slice(0, 6).map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onOpen(t.id)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--surface-sunken)]"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{t.title}</span>
                  <span className="shrink-0 text-[12px] text-red-700 dark:text-red-300">
                    {t.due_at ? formatDue(t.due_at) : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {late.length > 6 && (
            <p className="mt-1.5 text-[12px] text-faint">
              and {late.length - 6} more on the Tasks tab
            </p>
          )}
        </div>
      )}

      <div>
        <p className="text-[13px] text-muted">Falling due, week by week</p>
        <ul className="mt-2 space-y-1.5">
          {weeks.map((w) => (
            <li key={w.start} className="flex items-center gap-2">
              <span className="w-16 shrink-0 font-mono text-[11px] text-faint">{w.label}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full surface-sunken">
                <span
                  className="block h-full rounded-full bg-navy-500/45"
                  style={{ width: `${(w.count / peak) * 100}%` }}
                />
              </span>
              <span className="w-6 shrink-0 text-right font-mono text-[11px] text-muted">
                {w.count}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Write the tab**

Create `src/components/general/ProgressTab.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { dateRange } from '../../lib/general/dates'
import { projectProgress } from '../../lib/general/progress'
import { ForecastPanel } from './ForecastPanel'
import { GanttChart } from './GanttChart'
import { PressurePanel } from './PressurePanel'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * Where the project stands, in the order somebody asks the questions.
 *
 * Read-only, and readable by every member: nothing here is a fact a member
 * could not reach by clicking through the tasks — the arrangement is the point.
 */
export function ProgressTab({ state }: { state: GeneralProjectState }) {
  const navigate = useNavigate()
  const project = state.project
  if (!project) return null

  const progress = projectProgress(state.tasks, project.points_enabled)

  return (
    <div className="space-y-6">
      <section className="rounded-panel border border-line surface p-4 sm:p-5">
        <h2>Where we are</h2>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-display text-[32px] leading-none font-bold text-ink">
            {progress.pct}%
          </span>
          <span className="text-[13px] text-muted">
            {progress.done} of {progress.total} tasks done
            {project.points_enabled ? ' · counted by points' : ''}
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full surface-sunken">
          <span
            className="block h-full rounded-full bg-emerald-500"
            style={{ width: `${Math.min(100, progress.pct)}%` }}
          />
        </div>
        <p className="mt-2 text-[12px] text-faint">{dateRange(project.starts_on, project.ends_on)}</p>
      </section>

      <section className="rounded-panel border border-line surface p-4 sm:p-5">
        <h2>Timeline</h2>
        <p className="mt-0.5 mb-3 text-[12px] text-muted">
          Every task with a date, laid out across the project.
        </p>
        <GanttChart state={state} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-panel border border-line surface p-4 sm:p-5">
          <h2>Will we finish in time</h2>
          <p className="mt-0.5 mb-3 text-[12px] text-muted">
            The pace so far, carried forward. Counting, not a promise.
          </p>
          <ForecastPanel state={state} />
        </section>

        <section className="rounded-panel border border-line surface p-4 sm:p-5">
          <h2>Late, and landing next</h2>
          <p className="mt-0.5 mb-3 text-[12px] text-muted">
            The part of this page you can still act on.
          </p>
          <PressurePanel
            state={state}
            onOpen={(taskId) => navigate(`/general/projects/${project.id}?task=${taskId}`)}
          />
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Add the tab to the project page**

In `src/pages/general/GeneralProject.tsx`:

Add the import beside the other tab imports:

```ts
import { ProgressTab } from '../../components/general/ProgressTab'
```

Widen the tab id:

```ts
type TabId = 'overview' | 'tasks' | 'files' | 'progress' | 'members'
```

In the `useState` that reads the query string, add a `progress` branch. The
chain currently reads task → members → files → overview; insert `progress`
before the final `'overview'`:

```ts
  const [tab, setTab] = useState<TabId>(() =>
    params.has('task')
      ? 'tasks'
      : params.get('tab') === 'members'
        ? 'members'
        : params.get('tab') === 'files'
          ? 'files'
          : params.get('tab') === 'progress'
            ? 'progress'
            : 'overview',
  )
```

Add the tab to the `Tabs` list, after `files` and before `members`:

```tsx
          { id: 'progress', label: 'Progress', icon: 'chart' },
```

Add the panel beside the others:

```tsx
      {tab === 'progress' && <ProgressTab state={state} />}
```

- [ ] **Step 6: Typecheck, lint and the checks**

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
npm run typecheck
npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs
node scripts/a11y-names.mjs
node scripts/contrast.mjs
node scripts/motion-lint.mjs
npm run test
npm run build
```

Expected: typecheck silent; lint `23 problems (0 errors, 23 warnings)`;
`0 icon-only buttons with no accessible name`; `0 failing pairs.`;
`motion-lint: ok`; every test passes; the build succeeds.

If lint reports a new `react-refresh/only-export-components` warning, the file
is exporting something that is not a component — move it to a `lib` module
rather than raising the baseline.

- [ ] **Step 7: Commit**

```bash
git add src/components/general/GanttChart.tsx src/components/general/ForecastPanel.tsx src/components/general/PressurePanel.tsx src/components/general/ProgressTab.tsx src/pages/general/GeneralProject.tsx
git commit -m "Show a project where it stands, on a timeline"
```

---

## Task 7: Verify it, end to end

**Files:** none new. Any fix found here goes in the file it belongs to, with its own commit.

- [ ] **Step 1: Run every database suite**

```bash
cd "C:/Users/Lemmuel Alinea/Desktop/Collabify"
set -a && . ./.env.local; set +a
PW=$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's|^postgresql://[^:]+:([^@]+)@.*|\1|')
POOL=$(cat supabase/.temp/pooler-url)
export SUPABASE_DB_URL="postgresql://$(printf '%s' "$POOL" | sed -E 's|^postgresql://([^:@]+).*|\1|'):${PW}@$(printf '%s' "$POOL" | sed -E 's|^.*@||')"
total=0
for f in workplaces general general-tasks general-notify presets general-repo general-files \
         general-drafts general-schedule accounts approvals notifications rate-limit results \
         submissions reassignments; do
  out=$(node scripts/db.mjs supabase/tests/$f.test.sql 2>&1)
  p=$(printf '%s' "$out" | grep -c 'PASS')
  fl=$(printf '%s' "$out" | grep -ci 'NOTICE: FAIL\|^SQL failed')
  total=$((total+p)); [ "$fl" != "0" ] && echo "!! $f has $fl failures"
done
echo "TOTAL $total PASS"
```

Expected: no `!!` line, and a total of 463 (the 451 before this plan, plus this
plan's 12).

- [ ] **Step 2: Run the full check**

```bash
npm run typecheck && npx eslint . --ignore-pattern docs/redesign/serve-dashboard-preview.mjs && npm run test && npm run build && node scripts/contrast.mjs && node scripts/a11y-names.mjs && node scripts/schema-drift.mjs && node scripts/motion-lint.mjs
```

Expected: every step passes. `schema-drift` reports `3 to check by hand`, which
is the pre-existing count — anything higher is this plan's doing.

- [ ] **Step 3: Walk it in the browser**

Signed in, on a project that has tasks:

1. Open the project and click **Progress**. The percentage matches the one on the Tasks tab.
2. The timeline shows a diamond for every preset task, since none has a start yet.
3. Open a task, set **Starts** a few days before its due date, save. Return to Progress: that task now draws a bar.
4. Open the same task and set **Starts** after its due date. The save is refused with "A task cannot start after it is due. Move one of the two dates."
5. Task history reads "set the start to …", then "moved the start from … to …".
6. Before any task is done, the forecast reads "Nothing has been finished yet". Mark one done and it reads a projection.
7. Give a task a due date in the past. It appears at the top of the late panel, and clicking it opens that task.
8. Check the page at 375px and 1440px, in light and dark. The timeline scrolls sideways inside its own panel; the page does not scroll sideways at all.

- [ ] **Step 4: Report anything found, and fix it in its own commit**

Each fix names the task it belongs to in its commit message.

- [ ] **Step 5: Push**

```bash
git push
```
