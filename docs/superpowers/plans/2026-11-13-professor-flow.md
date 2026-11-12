# Professor Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize what a teaching member sees: the class becomes home, a class project opens on its groups, each group gets its own page, and everything waiting on the professor is on one page.

**Architecture:** Mostly a frontend reorganization of existing components. The professor's half of `ProjectDetail` and `ProfessorTasksView` is split into a project page (five tabs) and a new board page at `/class-projects/:projectId/boards/:boardId`. One pure module (`lib/classProjectNav.ts`) maps every old address onto the new places. The only SQL is one new file that adds read-only policies, so whoever teaches a class can read its groups' working files.

**Tech Stack:** React 18 + TypeScript + React Router + Tailwind tokens, Supabase (Postgres RLS), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-professor-flow-design.md` (read it first; the mockups it names are in `.superpowers/brainstorm/1937-1794506017/content/`).

## Global Constraints

- Design tokens only, never raw hex or `emerald-*`/`red-*`; status ramps `success-*`, `warning-*`, `danger-*`, `pending-soft`/`pending-ink` (`CLAUDE.md` → Design system).
- Desktop layout first, then tablet, then phone; no horizontal page scroll at phone width.
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully"; errors say what happened and what to do next.
- Students' screens do not change. Every student path through `ProjectDetail`, `ClassSpace`, `/groups` keeps today's behaviour.
- Admins keep `/teaching/submissions`, `/teaching/reassignments`, `/teaching/analytics`, `/teaching/reports` exactly as today.
- No change to what a professor may do: the professor still cannot move cards on a class board, and gets read-only access to group files (no write, upload, delete, commit, comment or share).
- Every old address keeps landing somewhere sensible (spec §9).
- `npm run build` and `npm test` pass at the end of every task.
- Commit after each task; do not push (the owner reviews before `main` is pushed).

## Review Focus

1. **An individual project.** Every "group" surface must read "student" and work with `board.group_id = null` (cards, board page header, prev/next, Manage groups hidden). Pinned by `classProjectNav.test.ts` (`boardLabel`) and the Task 3 Step 7 preview check.
2. **A board id in the URL that is not on this project** (stale link, deleted group, another project's board). Expect the project's Groups tab with a "That group is no longer on this project" info alert, not a blank page. Pinned in Task 5, Step 1.
3. **A teacher of class A opening a board of class B's files.** It must be refused, and so must every write by the teacher on their own class's board. Pinned in the Task 7 SQL suite.
4. **Legacy `?tab=work&board=X&task=Y` links** from Submissions, Reassignments, search, insight and announcements. They must open the board page with the task open. Pinned in `classProjectNav.test.ts` (`legacyProfessorTarget`).
5. **A class with no projects, or a project with no boards yet.** Expect empty states with the next step, not empty grids. Pinned in Task 3 Step 6 and Task 11 Step 4.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/paths.ts` (modify) | add `classProjectBoard`, `waiting` |
| `src/lib/classProjectNav.ts` (create) + test | tab types, readers, legacy mapping, `boardStage`, `adjacentBoards`, `boardLabel` |
| `src/components/tasks/useProjectTasks.ts` (modify) | optional `boardId` to pin the active board |
| `src/components/classProject/ProfessorProject.tsx` (create) | the five professor tabs |
| `src/components/classProject/ProjectGroupsView.tsx` (create) | Groups tab: waiting strip, board cards, Manage groups |
| `src/components/classProject/BoardCards.tsx` (create) | one card per board |
| `src/components/classProject/ProjectTasksView.tsx` (create) | Tasks tab: "What you set" + cross-board views |
| `src/components/classProject/BoardPage.tsx` (create) | the group's page and its four tabs |
| `src/pages/app/projects/ProjectDetail.tsx` (modify) | loader + banner; hands professor body to the new components |
| `src/components/tasks/ProfessorTasksView.tsx` (delete in Task 6) | replaced |
| `supabase/class-files-teacher-read.sql` (create) + `supabase/tests/class-files-teacher-read.test.sql` | read access |
| `src/components/tasks/ClassFilesTab.tsx` (modify) | `readOnly` professor mode |
| `src/lib/api/waiting.ts` (create) | `teachingWaitingCount` |
| `src/pages/app/waiting/WaitingOnYou.tsx` (create) | merged Submissions + Reassignments |
| `src/components/app/nav.ts`, `SideNav.tsx` (modify) | teaching rail |
| `src/lib/classSpace.ts`, `src/pages/app/classes/ClassSpace.tsx` (modify) | class tabs |
| `src/components/projects/ProjectWizard.tsx`, `ProjectForm.tsx`, `SectionPicker.tsx`, `src/components/groups/CreateSetWizard.tsx` (modify) | make groups in the wizard |
| `src/App.tsx`, `src/components/app/notificationDestination.ts` (modify) | routes and redirects |

---

### Task 1: Paths and the project navigation module

**Files:**
- Modify: `src/lib/paths.ts` (inside `paths`), `src/lib/paths.test.ts`
- Create: `src/lib/classProjectNav.ts`, `src/lib/classProjectNav.test.ts`

**Interfaces:**
- Produces:
  - `paths.waiting: '/waiting'`
  - `paths.classProjectBoard(projectId: string, boardId: string): string` → `/class-projects/${projectId}/boards/${boardId}`
  - `type ProfessorProjectTab = 'groups' | 'brief' | 'tasks' | 'milestones' | 'grades'`
  - `const PROFESSOR_PROJECT_TABS: readonly ProfessorProjectTab[]` (that order)
  - `type BoardTab = 'overview' | 'plan' | 'files' | 'grade'`
  - `readProfessorProjectTab(params: URLSearchParams): ProfessorProjectTab`
  - `readBoardTab(params: URLSearchParams): BoardTab`
  - `legacyProfessorTarget(projectId: string, params: URLSearchParams): string | null`, the address an old professor link should be replaced with, or null when the address is already new
  - `boardStage(rows: Pick<ProjectTask, 'status' | 'stage'>[], stages: readonly string[]): string | null`
  - `adjacentBoards(boards: Pick<BoardSummary, 'id'>[], id: string): { prev: string | null; next: string | null }`
  - `boardLabel(solo: boolean): { one: 'group' | 'student'; many: 'groups' | 'students'; title: 'Groups' | 'Students' }`

- [ ] **Step 1: Write the failing tests** in `src/lib/classProjectNav.test.ts`:

```ts
const q = (s: string) => new URLSearchParams(s)

describe('readProfessorProjectTab', () => {
  it('opens on Groups', () => expect(readProfessorProjectTab(q(''))).toBe('groups'))
  it('keeps a named new tab', () => {
    for (const t of PROFESSOR_PROJECT_TABS) expect(readProfessorProjectTab(q(`tab=${t}`))).toBe(t)
  })
  it('maps the old Work sections', () => {
    expect(readProfessorProjectTab(q('tab=work'))).toBe('groups')
    expect(readProfessorProjectTab(q('tab=work&work=summary'))).toBe('groups')
    expect(readProfessorProjectTab(q('tab=work&work=milestones'))).toBe('milestones')
    expect(readProfessorProjectTab(q('tab=work&work=tasks'))).toBe('tasks')
    expect(readProfessorProjectTab(q('tab=progress'))).toBe('groups')
    expect(readProfessorProjectTab(q('tab=tasks'))).toBe('tasks')
    expect(readProfessorProjectTab(q('task=t1'))).toBe('tasks')
  })
  it('sends a teacher-less tab name to Groups', () => {
    expect(readProfessorProjectTab(q('tab=files'))).toBe('groups')
    expect(readProfessorProjectTab(q('tab=shared'))).toBe('groups')
    expect(readProfessorProjectTab(q('tab=discussion'))).toBe('groups')
  })
})

describe('readBoardTab', () => {
  it('opens on Overview', () => expect(readBoardTab(q(''))).toBe('overview'))
  it('reads plan, files and grade', () => {
    expect(readBoardTab(q('tab=plan'))).toBe('plan')
    expect(readBoardTab(q('tab=files'))).toBe('files')
    expect(readBoardTab(q('tab=grade'))).toBe('grade')
  })
  it('maps old Work sections that belong to one board', () => {
    expect(readBoardTab(q('work=backlog'))).toBe('plan')
    expect(readBoardTab(q('work=sprints'))).toBe('plan')
  })
})

describe('legacyProfessorTarget', () => {
  it('opens a named board on its own page, keeping the task and the section', () => {
    expect(legacyProfessorTarget('p1', q('tab=work&board=b1&task=t1')))
      .toBe('/class-projects/p1/boards/b1?task=t1')
    expect(legacyProfessorTarget('p1', q('tab=work&work=sprints&board=b1')))
      .toBe('/class-projects/p1/boards/b1?tab=plan&work=sprints')
  })
  it('rewrites an old tab name in place', () => {
    expect(legacyProfessorTarget('p1', q('tab=work&work=milestones'))).toBe('/class-projects/p1?tab=milestones')
    expect(legacyProfessorTarget('p1', q('tab=work&task=t1'))).toBe('/class-projects/p1?tab=tasks&task=t1')
    expect(legacyProfessorTarget('p1', q('tab=groups'))).toBe('/class-projects/p1?manage=1')
    expect(legacyProfessorTarget('p1', q('tab=files'))).toBe('/class-projects/p1')
  })
  it('leaves a new address alone', () => {
    expect(legacyProfessorTarget('p1', q(''))).toBeNull()
    expect(legacyProfessorTarget('p1', q('tab=grades'))).toBeNull()
    expect(legacyProfessorTarget('p1', q('tab=tasks&task=t1'))).toBeNull()
  })
})

describe('boardStage', () => {
  const stages = ['Planning', 'Design', 'Development', 'Done']
  it('is the earliest stage still holding open work', () => {
    expect(boardStage([
      { status: 'done', stage: 3 }, { status: 'in_progress', stage: 2 }, { status: 'todo', stage: 1 },
    ], stages)).toBe('Design')
  })
  it('is the last stage when everything is done', () =>
    expect(boardStage([{ status: 'done', stage: 3 }], stages)).toBe('Done'))
  it('is null on an empty board', () => expect(boardStage([], stages)).toBeNull())
})

describe('adjacentBoards', () => {
  const b = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('names the neighbours', () => expect(adjacentBoards(b, 'b')).toEqual({ prev: 'a', next: 'c' }))
  it('stops at the ends', () => {
    expect(adjacentBoards(b, 'a')).toEqual({ prev: null, next: 'b' })
    expect(adjacentBoards(b, 'c')).toEqual({ prev: 'b', next: null })
  })
  it('has none for an unknown board', () => expect(adjacentBoards(b, 'z')).toEqual({ prev: null, next: null }))
})

describe('boardLabel', () => {
  it('says students on an individual project', () =>
    expect(boardLabel(true)).toEqual({ one: 'student', many: 'students', title: 'Students' }))
  it('says groups otherwise', () =>
    expect(boardLabel(false)).toEqual({ one: 'group', many: 'groups', title: 'Groups' }))
})
```

Add `paths.classProjectBoard('p1', 'b1') === '/class-projects/p1/boards/b1'` and `paths.waiting === '/waiting'` to `paths.test.ts`.

- [ ] **Step 2: Run them to see them fail.** Run `npx vitest run src/lib/classProjectNav.test.ts src/lib/paths.test.ts`. Expected: FAIL (module not found / undefined).

- [ ] **Step 3: Implement** the interfaces above. `boardStage` uses `stageIndex(status, stage, stages.length)` from `lib/stages.ts`. `legacyProfessorTarget` drops `tab`, `work`, `layout`, `board` from the old query and keeps `task`, `layout` (only when it is `list`, `timeline` or `calendar` on the Tasks tab) and `scope`. A board target keeps `work` only for `backlog`/`sprints` (as `tab=plan&work=…`). Order the query keys as the tests show.

- [ ] **Step 4: Run the tests.** Same command. Expected: PASS.

- [ ] **Step 5: Commit** with `git commit -m "Add the professor project navigation module"`.

---

### Task 2: Pin the board in `useProjectTasks`

**Files:**
- Modify: `src/components/tasks/useProjectTasks.ts:36-90`

**Interfaces:**
- Consumes: nothing new.
- Produces: `useProjectTasks({ project, role, boardId }: { project: ProjectSummary; role: TeachingViewRole; boardId?: string | null })`. When `boardId` is given and `role === 'professor'`, `active` is that board (or null if it is not among `boards`). `showBoard` still works for callers without `boardId`. Return type unchanged. Also add `boardMissing: boolean`, true when `boardId` is given, `boards` has loaded, and no board matches.

- [ ] **Step 1: Implement.** `filters.board` initializes from `boardId ?? params.get('board') ?? ''` for professors. Keep the `boardId` prop in sync when it changes (route change between boards via prev/next): an effect sets `filters.board` to `boardId` whenever `boardId` changes.
- [ ] **Step 2: Verify.** Run `npm run typecheck`. Expected: no errors. Callers are unchanged.
- [ ] **Step 3: Commit** with `git commit -m "Let a page pin the board useProjectTasks follows"`.

---

### Task 3: Professor project shell, Groups tab and Brief tab

**Files:**
- Create: `src/components/classProject/ProfessorProject.tsx`, `ProjectGroupsView.tsx`, `BoardCards.tsx`
- Modify: `src/pages/app/projects/ProjectDetail.tsx` (tabs at 68–157 and 414–470; the Brief block at 464 onward becomes a `brief` render prop or a `ProjectBrief` component extracted into `src/components/classProject/ProjectBrief.tsx`)

**Interfaces:**
- Consumes: `readProfessorProjectTab`, `legacyProfessorTarget`, `boardLabel`, `boardStage`, `paths.classProjectBoard` (Task 1); `useProjectTasks` (Task 2).
- Produces:
  - `ProfessorProject({ project, t, viewerId, cls, brief }: { project: ProjectSummary; t: ProjectTasks; viewerId?: string; cls: ClassSummary | null; brief: ReactNode })`, which renders the tab strip and the active tab
  - `BoardCards({ boards, rows, stages, solo, onOpen }: { boards: BoardSummary[]; rows: ProjectTaskRow[]; stages: readonly string[]; solo: boolean; onOpen: (b: BoardSummary) => void })`
  - `ProjectGroupsView({ project, t, cls, viewerId })`

- [ ] **Step 1: Legacy redirect.** In `ProjectDetail`, when `role === 'professor'`, compute `legacyProfessorTarget(project.id, params)` once the project loads. If it is non-null, `navigate(target, { replace: true })`. The student path keeps its current tab code untouched.
- [ ] **Step 2: Shell.** For professors, `ProjectDetail` keeps the banner header. In place of its own `Tabs` and the Work/Groups branches, it renders `<ProfessorProject …/>`. The tab strip lists `PROFESSOR_PROJECT_TABS` with labels `boardLabel(solo).title`, `Brief`, `Tasks`, `Milestones`, `Grades` and icons `users`, `file`, `check`, `target`, `chart`. The tab lives in `?tab=` (omitted for `groups`), written with `replace`, and switching tabs deletes `task`, `layout`, `scope`, `manage`.
- [ ] **Step 3: BoardCards.** Draw a responsive grid of cards: 3 columns at `xl`, 2 at `md`, 1 on phones. Each card shows:
  - the owner name (`boardOwnerName`)
  - a progress bar from `done_pct` (`bg-progress`)
  - "`{done_pct}% · {boardStage(rows of this board, stages) ?? 'No tasks yet'}`"
  - flag chips: **Handed in** (`submitted_at` set, no `result_verdict`, `warning-*`), **Accepted** (`result_verdict === 'accepted'`, `success-*`), **Returned** (`result_verdict === 'returned'`, `danger-*`), **{n} late** (`late_count > 0`, `danger-*`)
  - "{member_count} members" (groups only)
  
  The whole card is a link to `paths.classProjectBoard(project.id, b.id)`.
- [ ] **Step 4: ProjectGroupsView.** From top to bottom:
  1. A "Waiting on you" strip, shown only when non-empty. It holds `HandInQueue` with `onOpen = navigate to the board page`, plus one line "`{n}` reassignment `{request/requests}` on this project" linking to `${paths.waiting}?section=reassignments`. The count comes from `listReassignments()` filtered to `project_id === project.id && status === 'pending'`; check the status field name on `ReassignmentRequest` in `lib/types.ts`. Show the reassignment line only when `canTeach(profile)`: `/waiting` sits behind `RequireTeaching`, and a class adviser without the teaching switch also gets this page.
  2. A heading `boardLabel(solo).title` with a **Manage groups** button (group projects only). It toggles an inline panel rendering today's `ProjectGroupsTab` and opens by default when `?manage=1`.
  3. `BoardCards`.
- [ ] **Step 5: Brief.** Move the Brief markup into `ProjectBrief` and render it for the `brief` tab, keeping the student render as it is (the student page still shows Brief as before).
- [ ] **Step 6: Empty state.** With `boards` loaded and empty, the Groups tab shows `EmptyState`. For a group project with no group set it says "No groups on this project yet", body "Make groups for this project, then they show here.", with **Manage groups**. For an individual project it says "No students yet", body "Students show here once they join the class."
- [ ] **Step 7: Verify.** Run `npm run build`. Expected: passes. In the preview, sign in as a teaching account and open a group project and an individual project. Each opens on the cards, labels match the project type, and a card opens `/class-projects/:id/boards/:boardId` (a blank page until Task 5 is fine). Open `?tab=work&work=milestones` and see the address become `?tab=milestones`. As a student, the same project shows today's tabs.
- [ ] **Step 8: Commit** with `git commit -m "Open a class project on its groups for professors"`.

---

### Task 4: Tasks, Milestones and Grades tabs; remove the old Work tab

**Files:**
- Create: `src/components/classProject/ProjectTasksView.tsx`
- Modify: `src/components/classProject/ProfessorProject.tsx`, `src/components/tasks/ProjectTasksTab.tsx` (professor branch removed; student branch unchanged)
- Delete: `src/components/tasks/ProfessorTasksView.tsx` (check `grep -rn ProfessorTasksView src` is empty afterwards)

**Interfaces:**
- Consumes: `ProjectTasks` (`t`), and everything `ProfessorTasksView` used.
- Produces: `ProjectTasksView({ project, t, viewerId }: { project: ProjectSummary; t: ProjectTasks; viewerId?: string })`

- [ ] **Step 1: Tasks tab.** `ProjectTasksView` holds three parts in this order:
  1. **What you set.** Lift today's section (the `ProfessorTasksView` block under the heading "What you set", with `FanOutForm`, `GenerateTasksModal`, edit and delete via `deleteProfessorTask` and their dialogs) verbatim.
  2. **Every {one} task.** `TaskViewSwitch` limited to `list`, `timeline` and `calendar`, plus `TaskFilterBar` with `showBoards`, the `TaskList`, `TimelineView` and `TaskCalendar` exactly as the `active === null` branches render them today, then `TaskSummary rows={t.scope} showLoad`.
  3. `TaskDetailModal`, driven by `t.openTask` / `t.showTask`, as today.
  
  If `t.view === 'board'` on this tab, render the list (a board belongs to one group).
- [ ] **Step 2: Milestones tab.** `MilestonesView source={classMilestoneSource(t, project.id)}`, then the "Milestones by {one}" `GroupMilestoneGrid` section with `onOpenGroup = navigate to the board page`.
- [ ] **Step 3: Grades tab.** The `GradesTable` section (its `onOpen` navigates to the board page with `?tab=grade`), then `PeerRoundsPanel projectId` (group projects only).
- [ ] **Step 4: Delete `ProfessorTasksView`.** Remove its import and branch from `ProjectTasksTab`; the student branch is untouched. Remove `'summary'` from the professor fallback in `useProjectTasks` (the fallback becomes `'tasks'` for both roles).
- [ ] **Step 5: Verify.** Run `npm run build && npm test`. Expected: both pass. In the preview as a teacher, use each tab: set a task to every group, open a task from the list, view the timeline and calendar, set a milestone, open Grades, and open peer rounds on a group project. Confirm that nothing from today's Summary, Backlog, Sprints, Milestones and Tasks sections is unreachable; tick each off against spec §5 and §6.
- [ ] **Step 6: Commit** with `git commit -m "Split the professor Work tab into Tasks, Milestones and Grades"`.

---

### Task 5: The group's page

**Files:**
- Create: `src/components/classProject/BoardPage.tsx`
- Modify: `src/App.tsx` (route), `src/pages/app/projects/ProjectDetail.tsx` (read `:boardId`), `src/components/peer/PeerRoundsPanel.tsx` (optional `boardId`)

**Interfaces:**
- Consumes: `readBoardTab`, `adjacentBoards`, `boardLabel`, `paths.classProjectBoard` (Task 1); `useProjectTasks({ boardId })` and `boardMissing` (Task 2).
- Produces:
  - Route `/class-projects/:projectId/boards/:boardId` → `RoleSwitch member={<ProjectDetail role="professor" />}`, with student → `Navigate` to `paths.classProject(projectId)`
  - `BoardPage({ project, t, viewerId }: { project: ProjectSummary; t: ProjectTasks; viewerId?: string })`
  - `PeerRoundsPanel({ projectId, boardId }: { projectId: string; boardId?: string })`. With `boardId`, it shows only that board's results and comments and hides round controls.

- [ ] **Step 1: Missing board.** When `t.boardMissing`, `ProjectDetail` navigates to `paths.classProject(project.id)` with state `{ notice: 'missing-board' }`. The Groups tab shows `Alert tone="info"` reading "That group is no longer on this project." once. Check by opening `/class-projects/<real>/boards/00000000-0000-0000-0000-000000000000`.
- [ ] **Step 2: Header.** With `:boardId` present, `ProjectDetail` renders a compact header in place of the banner:
  - a breadcrumb: class (`paths.class`) › project (`paths.classProject`) › `boardLabel(solo).title`
  - the owner name as `h1`
  - for groups, "Leader {name} · {member_count} members"; the leader comes from `t.members` (check the leader field used by `LeaderBadge`)
  - Previous and Next buttons from `adjacentBoards(t.boards, boardId)`, linking to `paths.classProjectBoard`, disabled at the ends, with `aria-label` "Previous {one}" / "Next {one}"
- [ ] **Step 3: Tabs.** `?tab=` holds `overview` (omitted), `plan`, `files`, `grade`, labelled Overview, Plan, Files, Hand-in & grade:
  - **Overview:**
    - The strip, a 4-cell grid on desktop and 2×2 on phones: `done_pct`% done, `boardStage` stage, `late_count` late, and the top share from `t.progress`, i.e. "{first name} {group_pct}%" for the member with the highest `group_pct` (groups only; on an individual project show `task_count` tasks).
    - Then `BoardProgress` and `MemberProgress rows={t.progress}` side by side at `xl` (as today).
    - Then `ScopePicker` (when `t.sprints.length > 0`), `TaskViewSwitch` (board/list/timeline/calendar), `TaskFilterBar` (no `showBoards`), and the matching view. `TaskBoard` gets `canWork={false}` exactly as today.
  - **Plan:** a two-option switch, Backlog and Sprints, in `?work=`, defaulting to backlog. It renders `BacklogView` / `SprintsView` with `classWorkSource(t, viewerId)` as today.
  - **Files:** "Files open in the next update" placeholder until Task 8.
  - **Hand-in & grade:** `BoardVerdict board={t.active} role="professor"`, `ScoreCard`, then `PeerRoundsPanel projectId boardId` (group projects).
  - `TaskDetailModal` opens over any tab from `?task=`.
- [ ] **Step 4: Verify.** Run `npm run build && npm test`. Expected: pass. In the preview as a teacher:
  1. From a card, open a group; check the strip, the board, and each tab.
  2. Step through every group with Next.
  3. Accept or return a hand-in from Hand-in & grade.
  4. Open an old `?tab=work&board=<id>&task=<id>` link and land on this page with the task open.
  5. Open an individual project's student page.
  6. At phone width there is no horizontal scroll except inside the board's own scroller.
- [ ] **Step 5: Commit** with `git commit -m "Give each group its own page in a class project"`.

---

### Task 6: Point existing links at the new places

**Files:**
- Modify:
  - `src/pages/app/submissions/Submissions.tsx:559`
  - `src/pages/app/reassignments/Reassignments.tsx:196`
  - `src/lib/insight.ts:319,468`
  - `src/lib/api/search.ts:39`
  - `src/components/classes/AnnouncementLinks.tsx:183-188`
  - `src/components/groups/GroupWork.tsx:180`
  - `src/components/dashboard/StalledGroups.tsx:62`
  - `src/components/app/notificationDestination.ts` and its test

**Interfaces:**
- Consumes: `paths.classProjectBoard`, `paths.waiting`.

- [ ] **Step 1: Failing tests** in `notificationDestination.test.ts`:
  - `board_submitted` for a teacher with `project_id: 'p1'` → `/class-projects/p1`
  - with no `project_id` but `class_id` → `/waiting?status=waiting`
  - `reassign_requested` for a teacher → `/waiting?section=reassignments`
  - a student's `board_submitted` is unchanged from today's result (assert the current value)
- [ ] **Step 2: Run them.** `npx vitest run src/components/app/notificationDestination.test.ts` → FAIL.
- [ ] **Step 3: Implement** the destinations. Replace each listed link with a direct new address:
  - board links: `paths.classProjectBoard(projectId, boardId)`, adding `?task=` where one was named
  - the search task link and the announcement copy link: `${paths.classProject(id)}?tab=tasks&task=${id}` for professors
  - links that are role-neutral (search, announcements, `GroupWork`, which students also use): leave the old form, since `legacyProfessorTarget` rewrites it for professors and the student page ignores it
- [ ] **Step 4: Run the tests and build.** `npm test && npm run build` → PASS.
- [ ] **Step 5: Commit** with `git commit -m "Send professor links straight to the new project pages"`.

---

### Task 7: SQL — professors read their groups' files

**Files:**
- Create: `supabase/class-files-teacher-read.sql`, `supabase/tests/class-files-teacher-read.test.sql`
- Modify: `docs/07-backup.md` (full order list at line 26, the rerun tail at line 53, plus a paragraph), `supabase/class-files.sql` header comment (the "class teachers no access" line now points at the new file)

**Interfaces:**
- Produces:
  - `public.class_board_teacher_reads(p_project uuid) returns boolean`. It is `stable security definer`, `search_path = public`, and true when `general_projects.class_board_id` is set and `public.is_class_professor(projects.class_id)` holds for that board's project. It joins `general_projects gp → project_boards b on b.id = gp.class_board_id → projects pr on pr.id = b.project_id`.
  - `public.class_board_repo_id(p_board uuid) returns uuid`. It is `stable security definer`; it returns the hidden project's id when `is_class_professor` of the board's class, else raises `insufficient_privilege`. It returns null when the group has never opened Files. It never creates anything.
  - New permissive **SELECT-only** policies, each named `<table>_class_teacher_read` and each `using (public.class_board_teacher_reads(project_id))` (or `id` for `general_projects`), on: `general_projects`, `general_members`, `general_repos`, `general_commits`, `general_blobs`, `general_repo_changes`, `general_repo_comments`, and every other table the Files and Shared views read whose SELECT policy is `is_general_member(project_id)`. Find them with `grep -n "for select using (public.is_general_member(project_id))" supabase/*.sql` and confirm in the preview's network panel in Task 8. Add the same pattern on `general_shares` / `general_share_recipients` through the share's project. On `storage.objects`, add the same bucket condition as `general_project_files_read` (`supabase/general-files.sql:262`) with `class_board_teacher_reads(general_safe_uuid((storage.foldername(name))[1]))`.
  - No existing function or policy is redefined. Start any reference from the live definitions (`pg_get_functiondef`, `pg_policies`), not the files.

- [ ] **Step 1: Write the suite** in the style of `supabase/tests/task-comment-scope.test.sql` (rolls back, `pg_temp.act_as`). Seed:
  - class A taught by T, class B taught by U
  - a group board on a class A project with students S1 and S2, and its hidden repo (call `ensure_class_board_repo` as S1)
  - one committed file
  - a student S3 in another group of class A
  
  Assert:
  1. T selects the `general_projects` row, the commit and the blob, and `class_board_repo_id(board)` returns the repo id.
  2. T's insert into `general_commits`, `general_repo_comments` and `general_drafts`, and any update or delete of the file row, each fail.
  3. U sees zero rows and `class_board_repo_id` raises.
  4. S3 sees zero rows.
  5. S1 still commits.
  6. `ensure_class_board_repo(board)` as T still raises.
- [ ] **Step 2: Run the suite before the file exists.** `node scripts/db.mjs supabase/tests/class-files-teacher-read.test.sql`. Expected: FAIL at assertion 1 (or "function does not exist").
- [ ] **Step 3: Write `class-files-teacher-read.sql`.** It is idempotent (`create or replace`, `drop policy if exists` then `create policy`) and wrapped in `begin; … commit;`. It `revoke`s execute on both functions from `public, anon` and grants to `authenticated`. Its header states it runs after `task-comment-scope.sql` and before `anon-lockdown.sql`, and that re-running `general-repo.sql`, `general-files.sql`, `general-shares.sql`, `class-files.sql` or `project-settings-general.sql` means re-running it afterwards.
- [ ] **Step 4: Apply and test.** Run `node scripts/db.mjs supabase/class-files-teacher-read.sql supabase/anon-lockdown.sql`, then the suite. Expected: PASS, nothing left behind.
- [ ] **Step 5: Backup doc.** Add the file after `task-comment-scope.sql` in both run lists in `docs/07-backup.md`, with a paragraph stating what it owns and its rerun rule. Add a `CLAUDE.md` bullet under Project roles in the house style (one paragraph: what, where in the chain, rerun rule, suite).
- [ ] **Step 6: Commit** with `git commit -m "Let whoever teaches a class read its groups' files"`.

---

### Task 8: Group Files tab (read-only)

**Files:**
- Modify: `src/components/tasks/ClassFilesTab.tsx`, `src/lib/api/` (the file holding `ensureClassBoardRepo`; add `classBoardRepoId` beside it), `src/components/classProject/BoardPage.tsx`

**Interfaces:**
- Consumes: `class_board_repo_id` RPC (Task 7).
- Produces:
  - `classBoardRepoId(boardId: string): Promise<string | null>`
  - `ClassFilesTab({ t, viewerId, show, readOnly }: {…; readOnly?: boolean })`. With `readOnly`, it calls `classBoardRepoId` in place of `ensureClassBoardRepo`, forces `archived: true` on the state it passes down (as frozen boards do today), and hides every write control.

- [ ] **Step 1: Implement.** With `readOnly` and a null repo id, show `EmptyState` "No files yet" / "This {one} has not added any files." On the board page, the Files tab shows a two-option switch, Files and Shared, rendering `ClassFilesTab readOnly show="files" | "shared"`. Discussion is not shown. Update the header comment of `ClassFilesTab` to say teachers read through `class-files-teacher-read.sql`.
- [ ] **Step 2: Verify.** Run `npm run build`. In the preview as a teacher:
  - open a group that has files: the tree and a file preview load, no upload, commit, draft or delete control shows, and the network panel shows no 4xx on any read
  - open a group with no files: the empty state shows
  - as a student in that group, Files still works and writes as before
- [ ] **Step 3: Commit** with `git commit -m "Show a group's files, read-only, on its page"`.

---

### Task 9: Waiting on you

**Files:**
- Create: `src/lib/api/waiting.ts`, `src/pages/app/waiting/WaitingOnYou.tsx`
- Modify:
  - `src/pages/app/submissions/Submissions.tsx` (export an embeddable body)
  - `src/pages/app/reassignments/Reassignments.tsx` (same)
  - `src/App.tsx`
  - `src/lib/access.ts` if a helper is needed

**Interfaces:**
- Produces:
  - `teachingWaitingCount(userId: string): Promise<number>`. It counts waiting hand-ins plus pending reassignments. Hand-ins: `listProfessorClasses(userId)` → `listProjectsForClasses` (unarchived) → `listHandedInBoards` → `toSubmissions` → `submissionStatus(row) === 'waiting'`. Reassignments: `listReassignments()` rows with pending status.
  - `Submissions({ classId, embedded }: { classId?: string; embedded?: boolean })`. `embedded` drops its own page header and document title.
  - `Reassignments({ embedded }: { embedded?: boolean })`, the same idea.
  - Route `/waiting` → `WaitingOnYou`, inside `RequireTeaching`.

- [ ] **Step 1: Page.** `WaitingOnYou` has a page header "Waiting on you" and two sections, each with an `h2` and an anchor id: **Hand-ins** (`id="hand-ins"`, `<Submissions embedded />`, opening on `status=waiting` when no `?status=` is given) and **Reassignment requests** (`id="reassignments"`, `<Reassignments embedded />`). `?section=reassignments` scrolls to the second on load. Unreleased grades are not listed: the spec drops them when they would need new queries, and they would (per-project score reads).
- [ ] **Step 2: Redirects for teaching members.**
  - `/teaching/submissions` → `/waiting` (query kept)
  - `/teaching/reassignments` → `/waiting?section=reassignments`
  
  Do this through a small `TeachingRedirect` element that renders the old page for `role === 'admin'` and `Navigate replace` for members. `/teaching/analytics` and `/teaching/reports` stay live for everyone. They are the "all my classes" views Task 11 links to.

  Home's "Needs your attention" tile (`ProfessorHome.tsx:191`) gets a "See everything waiting" link to `paths.waiting`.
- [ ] **Step 3: Verify.** Run `npm run build && npm test`. In the preview as a teacher:
  1. `/waiting` lists hand-ins on Waiting.
  2. Accept one from its row; the count drops.
  3. Open a row's board, which lands on the board page.
  4. `/teaching/submissions?status=accepted` lands on `/waiting?status=accepted` showing accepted.
  5. As an admin, `/teaching/submissions` still shows the old page.
- [ ] **Step 4: Commit** with `git commit -m "Gather hand-ins and reassignments on one page"`.

---

### Task 10: The teaching rail

**Files:**
- Modify: `src/components/app/nav.ts`, `src/components/app/nav.test.ts`, `src/components/app/SideNav.tsx`, `src/components/app/SideNav.test.tsx` if it covers the teaching rail

**Interfaces:**
- Consumes: `paths.waiting`, `teachingWaitingCount` (Task 9).
- Produces:
  - `NavItem.badge` widens to `'inbox' | 'waiting'`.
  - `NavGroup` gains `classList?: true`: a section whose live rows are the reader's taught classes, each linking to `paths.class(id)`. The class matching the current route (`/classes/:id`, or a class project's `class_id`) expands to list its live projects, capped at `PROJECT_CAP`. It is followed by a `+ New class` row to `${paths.classes}?new=1`.

- [ ] **Step 1: Failing tests** in `nav.test.ts` for `navFor(teacher, true)`. Group titles in order are `['Main', 'Classes', 'Resources', 'Account']`, plus `'Work'` between Classes and Resources when `membership.hasWork` or `can_manage_projects`. Main labels are `['Home', 'Waiting on you', 'Inbox', 'Calendar', 'Meetings']`, and Waiting on you has `badge: 'waiting'`. Classes has `classList: true`. Work labels are `['Projects', 'My tasks']`, with the spaces card (`picker: ['spaces']`) above them. No group contains `Groups`, `Submissions`, `Reassignments`, `Analytics`, `Reports` or `Quick access`. Update the old teaching tests (lines 63, 134–147) to the new shape; the student and non-teaching tests stay as they are.
- [ ] **Step 2: Run them.** `npx vitest run src/components/app/nav.test.ts` → FAIL.
- [ ] **Step 3: Implement `navFor`'s `canTeach` branch** and the `classList` rendering in `SideNav`:
  - The taught classes come from `classRows(spaces)`, already loaded.
  - The projects come from `navigation.classProjects` filtered by `class_id`.
  - The collapsed rail shows only class initials with the hint tooltip.
  - The waiting badge reads `teachingWaitingCount`, refreshed with `useLive` on `['project_boards', 'board_results', 'reassignment_requests']` (check the reassignment table name in `supabase/reassignments.sql`), and only for teaching accounts.
- [ ] **Step 4: `?new=1`.** `ProfessorClasses` opens its new-class form when `?new=1` is present, then removes the param. Keep the `data-walkthrough="create-class"` marker on the real button. After a class is created, navigate to `paths.class(newId)` (its Overview), if `ProfessorClasses` does not already. Check that the `share-code` walkthrough step still finds `class-code` there.
- [ ] **Step 5: Run tests and build.** `npm test && npm run build` → PASS (including `lib/walkthrough/markers.test.ts`).
- [ ] **Step 6: Verify** in the preview as a teacher with and without work: the rail matches the spec mockup. Opening a class expands it. A project inside it opens and keeps the class expanded. The badge counts what `/waiting` shows. The collapsed rail and phone drawer work. A student's rail is unchanged.
- [ ] **Step 7: Commit** with `git commit -m "Organize the teaching rail around classes"`.

---

### Task 11: Class tabs

**Files:**
- Modify: `src/lib/classSpace.ts`, `src/lib/classSpace.test.ts`, `src/pages/app/classes/ClassSpace.tsx`, `src/App.tsx` (`/groups` for members)
- Create: `src/components/classes/ClassAttention.tsx`

**Interfaces:**
- Produces:
  - `ClassTab` becomes `'overview' | 'projects' | 'groups' | 'members' | 'syllabus' | 'reports' | 'settings'`; `submissions` and `analytics` are dropped.
  - `classTabs(true)` → `['overview', 'projects', 'groups', 'members', 'reports', 'syllabus', 'settings']`.
  - `classTabs(false)` is unchanged.
  - `readClassTab('submissions', true) === 'overview'`, `readClassTab('analytics', true) === 'reports'`.
  - `ClassAttention({ cls }: { cls: ClassSummary })`.

- [ ] **Step 1: Failing tests** in `classSpace.test.ts` for the four facts above. Run `npx vitest run src/lib/classSpace.test.ts` → FAIL.
- [ ] **Step 2: Implement** `classSpace.ts`, then run the tests → PASS.
- [ ] **Step 3: ClassSpace.**
  - The tab label for `members` is "Students" when teaching, "Members" otherwise.
  - **Reports** shows a two-option switch, Figures (`<Analytics classId>`) and Reports (`<Reports classId>`), with a link "All my classes" to `paths.analytics` / `paths.teachingReports` respectively.
  - A `?tab=submissions` link with `status=` goes to `${paths.waiting}?status=…`.
  - **Overview (teaching only)** puts `ClassAttention` above `ThisWeek`. It has two tiles:
    - "Waiting on you here": waiting hand-ins in this class (the Task 9 count logic narrowed to `classId`) and pending reassignments with `class_id`, linking to `/waiting`.
    - "Groups behind": `findStalled(boardsFor(this class's live project ids))` plus boards with `late_count > 0`, each linking to its board page, at most 5, with "Nothing is behind" when empty.
- [ ] **Step 4: Empty class.** With no projects and no students, the Overview shows a next-step card in place of the two tiles: "Add your students" (copy the class code, with Students tab link), then "Set your first project" (Projects tab link). It hides once either exists.
- [ ] **Step 5: `/groups` for members.** It becomes a `ProfessorGroupsRedirect`: one live taught class → `${paths.class(id)}?tab=groups`, otherwise `paths.classes`. `/groups/:groupId` is unchanged.
- [ ] **Step 6: Verify.** Run `npm run build && npm test`. In the preview as a teacher:
  - each tab works
  - `?tab=analytics` opens Reports
  - `?tab=submissions&status=waiting` opens `/waiting?status=waiting`
  - an empty class shows the next-step card
  - `/groups` redirects
  
  As a student, class tabs and `/groups` are unchanged.
- [ ] **Step 7: Commit** with `git commit -m "Run a class from its own tabs"`.

---

### Task 12: Make groups inside the new-project wizard

**Files:**
- Modify: `src/components/groups/CreateSetWizard.tsx:22-155`, `src/components/projects/ProjectWizard.tsx`, `src/components/projects/ProjectForm.tsx:437-465`, `src/components/projects/SectionPicker.tsx`

**Interfaces:**
- Produces:
  - `CreateSetWizard.onCreated: (set: GroupSet) => Promise<void> | void`. Existing callers that ignore the argument keep compiling.
  - `ProjectForm` and `SectionPicker` gain `onMakeGroups: (classId: string) => void`.
  - `ProjectWizard` owns one `CreateSetWizard` with `fixedClassId` and a `madeSetIds: string[]` state.

- [ ] **Step 1: Implement.**
  - **"Which groups"** shows the select plus a **Make groups now** button. With no sets for the class, the `Alert` is replaced by a short line "This class has no groups yet." and the button.
  - **SectionPicker:** each section row whose class has no set shows the same button in place of the empty select.
  - **On created:** `ProjectWizard` reloads its sets, selects the new set for that class (main or section), and appends its id to `madeSetIds`.
  - **On a successful save:** clear `madeSetIds`.
  - **When the wizard closes without saving:** for each id in `madeSetIds`, call `projectsUsingSet(id)` and `deleteSet(id)` when it is 0, then toast "Groups made for this project were removed." if any were.
- [ ] **Step 2: Verify.** Run `npm run build`. In the preview as a teacher, in a class with no group set:
  1. Start a group project, choose Make groups now, and make random groups. They are selected and the project saves.
  2. The set appears in the class Groups tab.
  3. Start another, make groups, then cancel. The set is gone.
  4. Add a second section with no set and make groups for it from its row.
- [ ] **Step 3: Commit** with `git commit -m "Make groups without leaving the new-project wizard"`.

---

### Task 13: Final check and handoff

**Files:**
- Modify: `handoff.md` (append a section, in the style of the recent ones)

- [ ] **Step 1:** Run `npm run build && npm test`. Expected: both pass. Run `node scripts/db.mjs supabase/tests/class-files-teacher-read.test.sql` → PASS.
- [ ] **Step 2:** Walk the whole flow in the preview as a teaching account:
  1. Create a class from the rail.
  2. Make a group project with groups made in the wizard.
  3. Open it to the cards.
  4. Open a group, step to the next, and read its files.
  5. Accept a hand-in from Waiting on you.
  6. Read Reports for the class and for all classes.
  
  Repeat the key screens as a student (unchanged) and an admin (`/teaching/*` unchanged). Check the old links in spec §9, one by one.
- [ ] **Step 3:** Append the handoff section:
  - what shipped
  - the new SQL file and its place in the chain
  - verified and not verified (phone touch, real notifications)
  - the next step (owner review, then push and apply the SQL to live)
- [ ] **Step 4: Commit** with `git commit -m "Record the professor flow in the handoff"`.
