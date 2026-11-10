# First-run walkthroughs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New accounts get a spotlight walkthrough of the real app, shaped to what their account can do, and finish having done the first real thing.

**Architecture:** One small table holds each person's progress. Pure modules decide which walkthrough and step apply from real data, so they test without a browser. A provider mounted once in `AppShell` runs the current step, and a portal overlay lights real buttons found by a `data-walkthrough` marker.

**Tech Stack:** React, TypeScript, React Router, Motion, Tailwind tokens, Supabase (Postgres, RLS), Vitest with happy-dom per file.

**Spec:** `docs/superpowers/specs/2026-11-10-first-run-walkthroughs-design.md`

## Global Constraints

- Design tokens only, in light and dark. No raw hex. The person's own palette must still reach the overlay.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully".
- Auth through `useAuth()`. Motion honors reduced motion through `useReducedMotion`.
- Desktop first, then tablet and phone (`lg` is where the rail appears).
- No new dependency.
- `supabase/walkthroughs.sql` is idempotent and runs after `sprint-organization.sql`, before `anon-lockdown.sql`.
- Never apply SQL to the live database or push `main` until the owner approves it in Task 6. `main` is the live site. Commit locally as you go.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Repo style is a short imperative sentence, no `feat:` prefix.
- `npm run build` passes before anything is called working.
- Never block anyone: if progress cannot load, show no walkthrough. If it cannot save, keep going and warn in the console.

## Review Focus

1. A save fails mid-walkthrough (campus wifi drops): the overlay still advances for this visit and nothing throws. Test in Task 4.
2. A dialog closes and the app navigates before the new space has arrived in the lists: the person is not pulled back to the previous page. Test in Task 4.
3. Skip in one tab while another tab is still on a step, and the other tab presses Next: the walkthrough stays skipped. Test in Task 1.
4. A lit target taller than the screen, like Appearance on a phone: the card stays fully on screen. Test in Task 3.
5. The lit element disappears mid-step (rail section folded, window narrowed): a centered card replaces the spotlight and Skip still works. Test in Task 3.

---

### Task 1: Saved progress

**Files:**
- Create: `supabase/walkthroughs.sql`
- Create: `supabase/tests/walkthroughs.test.sql`
- Create: `src/lib/api/walkthroughs.ts`
- Modify: `docs/07-backup.md` (new `## First-run walkthroughs` section at the end)

**Interfaces:**
- Produces, in `src/lib/api/walkthroughs.ts`:
  - `type ProgressKey = 'account' | 'teaching' | 'project_manager' | 'student' | 'member'`
  - `type FlowStatus = 'active' | 'paused' | 'skipped' | 'done'`
  - `type ProgressRow = { flow: ProgressKey; status: FlowStatus; done_steps: string[] }`
  - `listMyWalkthroughs(): Promise<ProgressRow[]>`
  - `saveWalkthroughs(userId: string, rows: ProgressRow[]): Promise<void>`, an upsert with `onConflict: 'user_id,flow'`. No-op on an empty array.

- [ ] **Step 1: Write the failing suite `supabase/tests/walkthroughs.test.sql`**

Same shape as `supabase/tests/space-roles.test.sql`: `begin;` alone on its line, the `pg_temp` helpers `act_as`, `act_as_service`, `must_be`, `must_refuse_with`, ending in `rollback;`. Seed users through `auth.users` as that suite does, using fixed uuid literals so later blocks can name them: `v_a`, `v_b`, plus `v_later` with `last_sign_in_at` set and no walkthrough rows. Finish seeding in its own `do` block, then leave a line that is exactly `-- @reload` between top-level statements, never inside a `do` body, because the dry run replaces it with the whole file. Assertions, each through `must_be` or `must_refuse_with`:

- `a person saves and reads their own row`
- `another person's row is invisible`
- `saving a row for another person is refused` (needle `row-level security`)
- `updating another person's row changes nothing` (0 rows)
- `an unknown flow is refused` (`flow = 'admin'`, needle `check`)
- `an unknown status is refused` (needle `check`)
- `a skipped row stays skipped` (update `status` to `active`, read back `skipped`, with `done_steps` still writable)
- `a done row stays done`
- `anon has no access`: `not has_table_privilege('anon', 'public.user_walkthroughs', 'select')`
- `people cannot delete rows`: `not has_table_privilege('authenticated', 'public.user_walkthroughs', 'delete')`
- `the backfill runs once`: after `-- @reload`, `v_later` still has no rows

- [ ] **Step 2: Build the dry run and watch it fail**

The dry run splices the file into the suite and rolls back, so nothing reaches the live database. The file loads twice after `begin;`, which proves it is idempotent, and once more at `-- @reload`.

```bash
node -e "const fs=require('fs');const strip=s=>s.split('\n').filter(l=>!/^(begin|commit);\s*$/.test(l)).join('\n');const t=fs.readFileSync('supabase/tests/walkthroughs.test.sql','utf8');const w=strip(fs.readFileSync('supabase/walkthroughs.sql','utf8'));fs.mkdirSync('.tmp',{recursive:true});fs.writeFileSync('.tmp/walkthroughs-dry.sql',t.replace(/^begin;\s*$/m,()=>'begin;\n'+w+'\n'+w+'\n').replace('-- @reload',()=>w))"
```

Create `supabase/walkthroughs.sql` as an empty file before running that command. Then run: `node scripts/db.mjs .tmp/walkthroughs-dry.sql`
Expected: FAIL, `relation "public.user_walkthroughs" does not exist`.

- [ ] **Step 3: Write `supabase/walkthroughs.sql`**

Header comment in the repo's style, then `begin;` and `commit;` each alone on a line.

- Table `public.user_walkthroughs`: `user_id uuid not null references public.profiles (id) on delete cascade`, `flow text not null check (flow in ('account','teaching','project_manager','student','member'))`, `status text not null default 'active' check (status in ('active','paused','skipped','done'))`, `done_steps text[] not null default '{}'`, primary key `(user_id, flow)`.
- A `do $$` block creates the table and runs the backfill **only when `to_regclass('public.user_walkthroughs') is null`**, because this repo re-runs SQL files and a second backfill would silently mark later accounts as finished.
- Backfill: for `profiles p join auth.users u on u.id = p.id` where `p.status = 'active'`, `p.role in ('student','member')` and `u.last_sign_in_at is not null`, insert `status = 'done'` rows for `account`, plus `student` when the role is student; `member` for every role-member account (so a teacher whose switch is later turned off is not walked through as new); `teaching` when `can_teach`; `project_manager` when role is member and `can_manage_projects`.
- `enable row level security`. Own-row policies, each preceded by `drop policy if exists`: select, insert with check, update with check, all on `user_id = auth.uid()`. `revoke all ... from anon, public`; `grant select, insert, update ... to authenticated`.
- `before update` trigger `user_walkthroughs_keep_finished` calling `public.keep_walkthrough_finished()`: when `old.status in ('skipped','done')`, set `new.status := old.status`. Written with `create or replace`, `drop trigger if exists`, `set search_path = public`.

- [ ] **Step 4: Rebuild the dry run and run it**

Run the Step 2 `node -e` command again, then `node scripts/db.mjs .tmp/walkthroughs-dry.sql`
Expected: only `PASS` notices, then `Done.`

- [ ] **Step 5: Dry-run the backfill**

```bash
node -e "const fs=require('fs');const w=fs.readFileSync('supabase/walkthroughs.sql','utf8').split('\n').filter(l=>!/^(begin|commit);\s*$/.test(l)).join('\n');const q=\"select (select count(*) from profiles p join auth.users u on u.id=p.id where p.status='active' and p.role in ('student','member') and u.last_sign_in_at is not null and not exists (select 1 from user_walkthroughs w where w.user_id=p.id and w.flow='account' and w.status='done')) missing, (select count(*) from user_walkthroughs w join auth.users u on u.id=w.user_id where u.last_sign_in_at is null) never_signed_in;\";fs.writeFileSync('.tmp/walkthroughs-backfill.sql','begin;\n'+w+'\n'+q+'\nrollback;')"
```

Run: `node scripts/db.mjs .tmp/walkthroughs-backfill.sql`
Expected: `missing` 0, `never_signed_in` 0. Then confirm the table did not persist: `node scripts/db.mjs -c "select to_regclass('public.user_walkthroughs')"` prints null.

- [ ] **Step 6: Write `src/lib/api/walkthroughs.ts`** to the Interfaces above, following `src/lib/api/consent.ts`. `saveWalkthroughs` adds `user_id` to each row and throws on error.

- [ ] **Step 7: Add the `docs/07-backup.md` section.** Runs after `sprint-organization.sql`, before `anon-lockdown.sql`. Owns the table and `keep_walkthrough_finished`. Nothing earlier supersedes it. The backfill runs only when the table is first created. Suite: `supabase/tests/walkthroughs.test.sql`, which needs the file applied or spliced in. Apply it right before pushing the frontend.

- [ ] **Step 8: Run `npm run typecheck`.** Expected: no errors.

- [ ] **Step 9: Commit** `supabase/walkthroughs.sql`, the suite, the API module and `docs/07-backup.md` as "Save walkthrough progress per person".

---

### Task 2: Which walkthrough, which step

**Files:**
- Create: `src/lib/walkthrough/flows.ts`, `src/lib/walkthrough/flows.test.ts`
- Create: `src/lib/walkthrough/progress.ts`, `src/lib/walkthrough/progress.test.ts`

**Interfaces:**
- Consumes: `ProgressKey`, `FlowStatus`, `ProgressRow` from Task 1. `AccessProfile`, `canTeach`, `canManageProjects`, `isMember` from `lib/access`. `GeneralSpaceSummary`.
- Produces, in `flows.ts`:
  - `type FlowId = Exclude<ProgressKey, 'account'>`
  - `type StepId = 'account-photo' | 'account-look' | 'create-space' | 'start-project' | 'create-class' | 'share-code' | 'join-class' | 'find-work' | 'watch-inbox'`
  - `type WalkthroughFacts = { profile: AccessProfile; stakeholderOnly: boolean; inClass: boolean; hasWork: boolean; spaces: GeneralSpaceSummary[] }`
  - `type StepDef = { id: StepId; owner: ProgressKey; title: string; body: string; targets: readonly string[]; route: (f: WalkthroughFacts) => string | null; isDone?: (f: WalkthroughFacts) => boolean; press?: 'Next' | 'Done'; pauseLabel?: string }`
  - `ACCOUNT_STEPS: readonly StepDef[]`, `FLOWS: Record<FlowId, readonly StepDef[]>`, `END_CARDS: Partial<Record<FlowId, { title: string; body: string }>>`
  - `flowsFor(f: WalkthroughFacts): FlowId[]`, `pmSpaces(spaces)` (live work spaces with `my_role === 'pm'`, newest `created_at` first), `taughtClasses(spaces)` (live `education` spaces with a `class_id` and `my_level` owner or manager, newest first)
- Produces, in `progress.ts`:
  - `type ProgressMap = Partial<Record<ProgressKey, ProgressRow>>`, `toMap(rows: ProgressRow[]): ProgressMap`
  - `stepsOf(flow: FlowId, p: ProgressMap): readonly StepDef[]` (account steps first unless the `account` row is `done` or `skipped`)
  - `type Run = { kind: 'none' } | { kind: 'paused'; flow: FlowId } | { kind: 'finished'; flow: FlowId } | { kind: 'step'; flow: FlowId; step: StepDef; index: number; total: number }` (`index` is 1-based)
  - `resolveRun(f: WalkthroughFacts, p: ProgressMap, opts: { openedWith: ReadonlySet<FlowId>; held: boolean }): Run`
  - `type Change = { progress: ProgressMap; writes: ProgressRow[] }`
  - `markStep(p, step): Change`, `markSkipped(p, flow): Change`, `markPaused(p, flow): Change`, `markFinished(p, flow): Change`
  - `replaySteps(f): readonly StepDef[]` (account steps, then every step of every `flowsFor` flow in order, or empty when there are none)

- [ ] **Step 1: Write the failing tests in `flows.test.ts`**

```ts
const facts = (over: Partial<WalkthroughFacts> = {}): WalkthroughFacts => ({
  profile: { role: 'member', status: 'active', can_teach: false, can_manage_projects: false },
  stakeholderOnly: false, inClass: false, hasWork: false, spaces: [], ...over,
})
const manager = { role: 'member', status: 'active', can_teach: false, can_manage_projects: true } as const
const both = { ...manager, can_teach: true }

it('orders teaching before project manager', () =>
  expect(flowsFor(facts({ profile: both }))).toEqual(['teaching', 'project_manager']))
it('gives a student the student walkthrough', () =>
  expect(flowsFor(facts({ profile: { ...manager, role: 'student', can_manage_projects: false } }))).toEqual(['student']))
it('gives a plain member the member walkthrough', () => expect(flowsFor(facts())).toEqual(['member']))
it('gives a stakeholder-only member nothing', () => expect(flowsFor(facts({ stakeholderOnly: true }))).toEqual([]))
it('gives an admin with the switch nothing', () =>
  expect(flowsFor(facts({ profile: { ...manager, role: 'admin' } }))).toEqual([]))
it('gives a pending account nothing', () =>
  expect(flowsFor(facts({ profile: { ...manager, status: 'pending' } }))).toEqual([]))
```

Plus, using a `space(over)` factory with `kind: 'work'`, `my_role: 'pm'`, `project_count: 0`, `archived_at: null`, `class_id: null`:

- `create-space` is done with a live PM space, and not with only an archived one or a space where `my_role` is `member`.
- `start-project` routes to `paths.spaceProjects` of the newest PM space, and is done when any PM space has `project_count > 0`.
- `create-class` is done with a live education space where `my_level` is `owner`. `share-code` routes to `paths.class(class_id)` of the newest one, and to `null` with none.
- `join-class` is done when `inClass`. `watch-inbox` is done when `hasWork` or `inClass`. `find-work` has `route` returning `null`.
- `join-class` has `pauseLabel` `"I don't have a code yet"`.

- [ ] **Step 2: Run `npx vitest run src/lib/walkthrough/flows.test.ts`.** Expected: FAIL, module not found.

- [ ] **Step 3: Implement `flows.ts`.** Admins, pending accounts and roleless accounts get `[]`. Each step's values:

| id | owner | title | body | targets | route | finish |
|---|---|---|---|---|---|---|
| account-photo | account | Set up your account | Add a photo so your team knows who you are. | `account-photo` | `paths.settings` | press Next |
| account-look | account | Pick your look | Choose light or dark, and your own colors. | `account-look` | `paths.settings` | press Next |
| create-space | project_manager | Create a space | A space holds your projects. | `create-space` | `paths.spaces` | data |
| start-project | project_manager | Start your first project | Name it and pick a starting shape. | `new-project` | newest PM space's projects page, else null | data |
| create-class | teaching | Create a class | Name it and set its section and term. | `create-class` | `paths.classes` | data |
| share-code | teaching | Share this code with your section | Students join with it, so you never add them by hand. | `class-code` | newest class, else null | press Done |
| join-class | student | Join your class | Enter the code from your professor. | `join-class` | `paths.home` | data |
| find-work | student | Find your work | My tasks and Groups fill up from your class. | `nav-tasks`, `nav-groups` | null | press Done |
| watch-inbox | member | Invitations land in your Inbox | Work opens once you accept one. | `open-inbox` | `paths.home` | press Done, or data |

`END_CARDS.project_manager`: title `Your project is ready`, body `Invite your people from Settings → Members on this project.`

- [ ] **Step 4: Run the same test.** Expected: PASS.

- [ ] **Step 5: Write the failing tests in `progress.test.ts`**

```ts
const opened = new Set<FlowId>(['teaching', 'project_manager', 'student', 'member'])
const run = (f: WalkthroughFacts, p: ProgressMap = {}, held = false) => resolveRun(f, p, { openedWith: opened, held })
```

- `starts with the account step`: plain member, empty progress gives `kind: 'step'`, step `account-photo`, `index: 1`, `total: 3`.
- `the account step appears once`: `{ account: done }` with both switches on gives step `create-class`, `index: 1`, `total: 2`.
- `teaching comes first, project manager after`: `{ account: done, teaching: done }` with both gives step `create-space`.
- `a done step is resumed past`: `{ account: done }`, a teacher with a class and no `done_steps` gives step `share-code`.
- `a skipped walkthrough never returns`: `{ student: skipped }` gives `kind: 'none'`.
- `held waits for the next open`: both switches, teaching skipped, `held: true` gives `kind: 'none'`, and `held: false` gives step `create-space`.
- `a switch turned on after opening waits`: `openedWith` without `project_manager` gives `kind: 'none'` for a manager with account done.
- `a switch turned off stops that walkthrough`: `{ project_manager: active }` with no switches gives the `member` flow.
- `paused holds at the join step`: `{ account: done, student: paused }`, not in class, gives `kind: 'paused'`.
- `paused resumes after joining`: the same with `inClass: true` gives step `find-work`.
- `everything satisfied is finished`: student in class with `find-work` in `done_steps` gives `kind: 'finished'`.
- `a member with work gets the account step only`: `{ account: done }`, `hasWork: true` gives `kind: 'finished'`, flow `member`.
- `markStep on the last account step closes the account row`: `writes` holds `{ flow: 'account', status: 'done', done_steps: ['account-photo', 'account-look'] }`.
- `markSkipped consumes an unfinished account step`: `writes` has two rows, the flow and `account`, both `skipped`.
- `markSkipped leaves a done account row alone`: one write.
- `replaySteps` for a student lists `account-photo, account-look, join-class, find-work`.

- [ ] **Step 6: Run `npx vitest run src/lib/walkthrough/progress.test.ts`.** Expected: FAIL, module not found.

- [ ] **Step 7: Implement `progress.ts`.** `resolveRun` walks `flowsFor` intersected with `openedWith`, ignoring flows whose row is `done` or `skipped`, and looks only at the first left. `held` returns `none` before that. A step counts as done if `step.isDone?.(f)` or its id is in its owner's `done_steps`. A `paused` row returns `kind: 'paused'` only while the current step has a `pauseLabel`.

- [ ] **Step 8: Run `npx vitest run src/lib/walkthrough`.** Expected: PASS.

- [ ] **Step 9: Commit** both modules and tests as "Decide which walkthrough and step apply".

---

### Task 3: The spotlight

**Files:**
- Create: `src/lib/walkthrough/geometry.ts`, `src/lib/walkthrough/geometry.test.ts`
- Create: `src/components/walkthrough/useTargetBox.ts`
- Create: `src/components/walkthrough/Spotlight.tsx`, `src/components/walkthrough/Spotlight.test.tsx`

**Interfaces:**
- Produces, in `geometry.ts`: `type Box = { top: number; left: number; width: number; height: number }`, `type Viewport = { width: number; height: number }`, `unionBox(boxes: Box[]): Box | null`, `holeFor(box: Box, vp: Viewport): Box` (pad 6, clamped to the viewport), `scrimPanels(hole: Box, vp: Viewport): Box[]` (four, covering everything but the hole), `placeCard(hole: Box | null, card: { width: number; height: number }, vp: Viewport): { top: number; left: number; mode: 'anchored' | 'sheet' | 'center' }`
- Produces: `TARGET_GRACE_MS = 1500`, and `useTargetBox(markers: readonly string[], active: boolean): { box: Box | null; dialogOpen: boolean; missing: boolean }` (`missing` turns true once no visible target has shown for `TARGET_GRACE_MS`)
- Produces: `Spotlight` with props `{ title: string; body: string; eyebrow: string; box: Box | null; blockTarget: boolean; actions: { label: string; onPress: () => void; primary?: boolean }[] }`

- [ ] **Step 1: Write the failing tests in `geometry.test.ts`**

```ts
const vp = { width: 1280, height: 800 }
it('joins two rows into one box', () =>
  expect(unionBox([{ top: 10, left: 0, width: 100, height: 20 }, { top: 90, left: 0, width: 120, height: 20 }]))
    .toEqual({ top: 10, left: 0, width: 120, height: 100 }))
it('has no box for no rows', () => expect(unionBox([])).toBeNull())
it('leaves the hole uncovered', () => {
  const hole = { top: 100, left: 200, width: 50, height: 40 }
  const area = scrimPanels(hole, vp).reduce((sum, b) => sum + b.width * b.height, 0)
  expect(area).toBe(vp.width * vp.height - hole.width * hole.height)
})
it('centers with no hole', () => expect(placeCard(null, { width: 340, height: 200 }, vp).mode).toBe('center'))
it('is a sheet on a phone', () =>
  expect(placeCard({ top: 100, left: 20, width: 80, height: 40 }, { width: 340, height: 200 }, { width: 375, height: 812 }).mode).toBe('sheet'))
it('sits under a target with room', () => {
  const placed = placeCard({ top: 100, left: 900, width: 100, height: 40 }, { width: 340, height: 200 }, vp)
  expect(placed.mode).toBe('anchored'); expect(placed.top).toBeGreaterThan(140)
})
it('stays on screen beside the right edge', () => {
  const placed = placeCard({ top: 100, left: 1200, width: 70, height: 40 }, { width: 340, height: 200 }, vp)
  expect(placed.left + 340).toBeLessThanOrEqual(vp.width - 16)
})
it('keeps the card on screen for a target taller than the screen', () => {
  const placed = placeCard({ top: -50, left: 300, width: 600, height: 1400 }, { width: 340, height: 200 }, vp)
  expect(placed.top).toBeGreaterThanOrEqual(16); expect(placed.top + 200).toBeLessThanOrEqual(vp.height - 16)
})
```

- [ ] **Step 2: Run `npx vitest run src/lib/walkthrough/geometry.test.ts`.** Expected: FAIL, module not found.

- [ ] **Step 3: Implement `geometry.ts`.** Phone is width under 640: `sheet`, bottom-anchored with a 16 gutter. Otherwise below the hole if the card fits, then above, else `sheet`-position inside the viewport.

- [ ] **Step 4: Run the same test.** Expected: PASS.

- [ ] **Step 5: Write the failing tests in `Spotlight.test.tsx`** with `// @vitest-environment happy-dom` and the React setup at the top of `SideNav.test.tsx`:

- `renders four scrim panels around the target and leaves it clickable`: with `blockTarget: false`, no scrim element covers the box.
- `covers the target in a replay`: `blockTarget: true` renders one more blocking element at the hole.
- `shows a centered card with no scrim when there is no box`.
- `runs an action`: pressing the `Skip` action calls `onPress`.
- `moves focus to the card when the step changes`.
- `is not itself an aria-modal dialog`, so `useTargetBox` does not read the card as an open dialog.
- `falls back to a card when the target goes away`: a test harness rendering `useTargetBox(['x'], true)` with fake timers. An element with `data-walkthrough="x"` and a stubbed non-zero rect gives a `box`. Removing it, then advancing `TARGET_GRACE_MS`, gives `box: null, missing: true`.
- `reports an open dialog`: adding `<div role="dialog" aria-modal="true">` sets `dialogOpen`, and the same element inside `<div inert>` does not.

- [ ] **Step 6: Run `npx vitest run src/components/walkthrough`.** Expected: FAIL, module not found.

- [ ] **Step 7: Implement `useTargetBox.ts`.** Match every `[data-walkthrough="<marker>"]`, keep those with a non-zero rect, take the union. Recompute through one `requestAnimationFrame`, driven by a `MutationObserver` on `document.body` (`childList`, `subtree`, `attributes` with `attributeFilter: ['inert']`), `resize`, and capture-phase `scroll`. Do all this only while `active`. `dialogOpen` is any `[role="dialog"][aria-modal="true"]` with no `[inert]` ancestor, which also catches the phone drawer. On first finding a target, `scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })`.

- [ ] **Step 8: Implement `Spotlight.tsx`.** `createPortal` to `document.body`, root class `app-ui`, `z-[55]` (above the drawer at 50, below `Modal` at 60). Scrim panels `fixed`, using Modal's `bg-[color-mix(in_oklab,var(--scrim,var(--color-navy-950))_60%,transparent)]`. An amber-400 ring with `pointer-events-none` around the hole. The card uses `surface`, `border-line`, `rounded-card`, `.eyebrow` for the step count, `font-display` for the title, `text-muted` for the body, and `Button`. Use `aria-labelledby` and a polite live region so screen readers announce each step. Tab moves only among the card's buttons and the lit target. Animate with Motion unless `useReducedMotion()`.

- [ ] **Step 9: Run `npx vitest run src/components/walkthrough src/lib/walkthrough`.** Expected: PASS.

- [ ] **Step 10: Commit** as "Add the walkthrough spotlight".

---

### Task 4: Running a walkthrough

**Files:**
- Create: `src/components/walkthrough/WalkthroughProvider.tsx`, `src/components/walkthrough/WalkthroughProvider.test.tsx`
- Create: `src/context/walkthrough.ts`
- Modify: `src/components/app/AppShell.tsx`

**Interfaces:**
- Consumes: Task 1's API, Task 2's `resolveRun`, `toMap`, `mark*`, `replaySteps`, `END_CARDS`, Task 3's `useTargetBox`, `Spotlight`.
- Produces, in `src/context/walkthrough.ts`: `useWalkthrough(): { canReplay: boolean; startReplay: () => void }` and its context, following `src/context/generalNavigation.ts`. Outside the provider it returns `{ canReplay: false, startReplay: () => {} }`.
- Produces: `WalkthroughProvider` with `{ children }`.

- [ ] **Step 1: Write the failing tests in `WalkthroughProvider.test.tsx`.** Happy-dom, `MemoryRouter`, and `vi.mock` for `AuthContext`, `generalNavigation`, `lib/api/walkthroughs` and `./useTargetBox`, so each test sets `box`, `dialogOpen` and `missing` directly:

- `shows nothing while spaces are loading`
- `shows nothing when progress cannot load`: `listMyWalkthroughs` rejects, no card appears, nothing throws.
- `opens a new student's first step`: card reads `Set up your account`, route is `/settings`.
- `Next saves the step and moves on`: `saveWalkthroughs` receives `done_steps: ['account-photo']`, card reads `Pick your look`.
- `a failed save still advances`: `saveWalkthroughs` rejects, card still moves on, `console.warn` called.
- `Skip ends it and saves`: writes `skipped`, card gone, and stays gone on rerender.
- `teaching finishing runs into project manager straight away`
- `skipping teaching holds project manager until the next open`: no card after Skip, card reads `Create a space` after a fresh mount with teaching skipped.
- `does not pull someone back when a dialog navigates before the data arrives`: on step `create-space` at `/spaces`, navigate to `/spaces/s1` with `spaces` unchanged, location stays `/spaces/s1`.
- `reloads the lists when a dialog closes`: `dialogOpen` going true then false calls `reload`.
- `offers Take me there once the target is missing`: `missing` true on a route other than the step's route shows that action, and it navigates.
- `the no-code button pauses`: on `join-class`, pressing `I don't have a code yet` writes `paused`, card gone.
- `shows the end card once after a walked project manager finishes`, and `not after a walkthrough that was all passed over`.
- `a replay writes nothing and blocks the target`: `startReplay()`, press `Next` through every step, `saveWalkthroughs` never called, `blockTarget` true, and the live walkthrough resumes after.
- `canReplay is false for an account with no walkthroughs`.

- [ ] **Step 2: Run `npx vitest run src/components/walkthrough/WalkthroughProvider.test.tsx`.** Expected: FAIL, module not found.

- [ ] **Step 3: Implement `WalkthroughProvider.tsx`.**
  - Facts come from `useAuth().profile` and `useGeneralNavigation()`: `membershipOf(spaces, myProjects)`, `isStakeholderOnly`. Null until both lists load.
  - Load progress once per `profile.id`. A failed load leaves progress null for the visit.
  - `openedWith` is a ref set to `flowsFor(facts)` the first time facts and progress are both ready. This is what makes a switch turned on mid-visit wait for the next open.
  - `held` is state, set on Skip when another flow remains.
  - `kind: 'finished'`: write `markFinished` and continue. Show `END_CARDS[flow]` only if a step of that flow was shown in this mount.
  - Navigate to `step.route(facts)` in an effect keyed on **the step id only**, never on the pathname. Create dialogs navigate on success before lists refresh, and a pathname-keyed effect would pull the person back.
  - When `dialogOpen` goes from true to false, call `navigation.reload()` so data-finished steps advance at once. Dialogs close only after their write succeeds.
  - Render no `Spotlight` while `dialogOpen`, or while `box` is null and `missing` is false (the grace period). With `box` null and `missing` true, render it as the centered card.
  - Saves run in the background: update local state first, then `saveWalkthroughs(...).catch(console.warn)`.
  - Actions: `Next` or `Done` per `step.press`, `step.pauseLabel` if set, `Take me there` when `missing` and the route differs, and `Skip`. A data-finished step has only the last three.
  - Eyebrow: `Step {index} of {total}`.
  - Replay state holds `replaySteps(facts)` and an index, takes precedence over the run, passes `blockTarget`, always offers `Next` and `Skip`, and writes nothing. No `Take me there` in a replay.

- [ ] **Step 4: Mount it in `AppShell.tsx`,** wrapping the `app-ui` div inside `GeneralNavigationProvider`. Always render it, so the page is never remounted when the profile changes. An account that is not active with a role has no flows from `flowsFor`, so it shows nothing.

- [ ] **Step 5: Run `npx vitest run src/components/walkthrough`, then `npm run typecheck`.** Expected: PASS, no errors.

- [ ] **Step 6: Commit** as "Run the walkthrough inside the app".

---

### Task 5: Mark the real buttons and add Replay

**Files:**
- Modify: `src/pages/Settings.tsx` (`Section` at line 119, the photo control near line 374, the Security section near line 545)
- Modify: `src/pages/general/SpacePicker.tsx:99`, `src/pages/general/SpaceLayout.tsx:117`, `src/pages/app/classes/ProfessorClasses.tsx:60`, `src/components/classes/ClassHeader.tsx:133`, `src/pages/app/StudentHome.tsx:123`, `src/components/app/WaitingHome.tsx:49`, `src/components/app/SideNav.tsx:534`
- Test: `src/lib/walkthrough/markers.test.ts` (create)

**Interfaces:**
- Consumes: `useWalkthrough()` from Task 4, `ACCOUNT_STEPS` and `FLOWS` from Task 2.

- [ ] **Step 1: Write the failing test `markers.test.ts`.** Read the source of each modified file with `fs` and assert every marker named by any step's `targets` appears as `data-walkthrough="<marker>"` somewhere in those files. `nav-tasks` and `nav-groups` may be matched by the literal marker string in `SideNav.tsx`. This stops a renamed marker from silently breaking a step.

- [ ] **Step 2: Run `npx vitest run src/lib/walkthrough/markers.test.ts`.** Expected: FAIL, listing the missing markers.

- [ ] **Step 3: Add the markers.**

| Marker | Element |
|---|---|
| `account-photo` | The `relative` wrapper holding `Avatar` and the upload button in `Settings.tsx` |
| `account-look` | The Appearance `Section`, through a new optional `marker?: string` prop placed on its `<section>` |
| `create-space` | The hero `Create space` button in `SpacePicker.tsx`, not the empty-state one |
| `new-project` | The `New project` button in `SpaceLayout.tsx`, not the empty-state one in `SpaceProjects.tsx` |
| `create-class` | The hero `Create class` button in `ProfessorClasses.tsx` |
| `class-code` | The copy-code `<button>` in `ClassHeader.tsx` |
| `join-class` | The `Join a class` button in `StudentHome.tsx` |
| `open-inbox` | The `Open your Inbox` link in `WaitingHome.tsx` |
| `nav-tasks`, `nav-groups` | The item `NavLink` in `SideNav.tsx`, computed from `item.to` against `paths.tasks` and `paths.groups` |

- [ ] **Step 4: Add Replay to Settings.** In the Security section, above `Your data`, a row in the same `rounded-xl border border-line p-5` shape, shown only when `canReplay`. Title `Walkthrough`, text `See the getting-started steps again. Nothing changes in your account.`, outline button `Replay walkthrough` calling `startReplay`.

- [ ] **Step 5: Run `npx vitest run src/lib/walkthrough`, `npm run lint` and `npm run build`.** Expected: all pass.

- [ ] **Step 6: Commit** as "Mark walkthrough targets and add Replay".

---

### Task 6: Walk it, document it, roll it out

**Files:**
- Modify: `CLAUDE.md` (a `## First-run walkthroughs` note), `handoff.md` (new section at the end)

- [ ] **Step 1: Run the full checks.** `npm test`, `npm run lint`, `npm run build`. Expected: all pass. Report any failure that was already there rather than hiding it.

- [ ] **Step 2: Add the notes.** `CLAUDE.md`: the marker convention (a target needs `data-walkthrough`, and `markers.test.ts` holds it), the SQL file's place in the run order, and that the backfill is one-shot. `handoff.md`: what shipped, the owner calls in the spec, deferred items.

- [ ] **Step 3: Ask the owner for approval and test accounts.** Say the SQL is ready to apply and that the local dev server talks to the live database. Ask which accounts to use for the four account types. Do not apply or create anything until they answer.

- [ ] **Step 4: Apply the SQL once approved.**

Run: `node scripts/db.mjs supabase/walkthroughs.sql supabase/anon-lockdown.sql`, then `node scripts/db.mjs supabase/tests/walkthroughs.test.sql supabase/tests/anon-lockdown.test.sql`
Expected: `Done.` and only `PASS` notices.

- [ ] **Step 5: Walk each account type in the browser pane at 1280 wide and at phone width, in light and dark.** `npm run dev` through `preview_start`.

| Account | Check |
|---|---|
| New project manager | Account steps, Create space through the real dialog, the spotlight comes back on cancel, New project in the new space, end card on the real project |
| New teacher | Create class, the class code lit, Done |
| Both switches | Teaching then project manager, account step once. Skip teaching, reload, project manager starts |
| New student | Join a class. Also `I don't have a code yet`, then join, then Find your work. On a phone, Find your work is a centered card |
| Plain member | Inbox step on `WaitingHome` |
| Existing account | Nothing appears |
| Any | Close the tab mid-step and resume at the same step. Replay from Settings creates nothing. Reduced motion has no animation. A custom palette reaches the card |

Expected: each row passes, with no console errors. Screenshot the project manager spotlight for the owner.

- [ ] **Step 6: Commit** the notes as "Document the first-run walkthroughs".

- [ ] **Step 7: Ask the owner to review before pushing `main`.** Push only on their yes. The table is already applied by then, so the new frontend finds it the moment it deploys.
