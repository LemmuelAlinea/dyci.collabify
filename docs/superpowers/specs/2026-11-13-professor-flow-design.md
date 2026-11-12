# Professor flow — design

Date: 2026-11-13. Status: draft for the owner's review.

## Why

Professors (members with `can_teach` on) and the people the owner showed Collabify to all said the
same thing: the features are there, but the flow is scattered. Every part of the professor's day
gets lost somewhere:

- **Checking a group's progress.** In a class project, a group's standing is spread across the Work
  tab's five sections (Summary, Backlog, Sprints, Milestones, Tasks). Summary alone stacks hand-ins,
  peer rounds, groups, grades, milestones by group, every task and "What you set". A group's own
  board lives under a different section from its tile.
- **Moving between classes.** The same things are reachable two ways: the rail has Projects,
  Groups, Submissions, Reassignments, Analytics and Reports as global pages, and each class has
  tabs with the same names. Neither feels like home.
- **The project's Work tab.** No clean order from "how are the groups doing" to "this group's
  board".
- **Setting up.** A group project dead-ends with "This class has no groups to assign to" and sends
  the professor away to build a group set first.

The goal: a professor goes from making a class, to running it, to making a project, to following
each group's progress and work, without hunting.

## Goals

1. **The class is home.** Everything about a class lives inside it. The rail lists the professor's
   classes directly.
2. **A class project opens on its groups.** The first screen is every group (or every student, for
   an individual project) at a glance.
3. **One page per group in a project**, with progress on top and its board below.
4. **Three clicks from the rail to a group's board:** class → project → group.
5. **Groups can be made inside the new-project wizard.**
6. **One "Waiting on you" page** for everything across classes that needs the professor.

## Anti-goals (what would make this a failure even if it works)

- **A feature goes missing.** Sprints, backlog, milestones, peer rounds, grades and release, AI task
  generation, fan-out, reassignments, bulk accept of hand-ins, cross-class analytics and reports:
  all must stay reachable, just in one clean place each.
- **Too many clicks to a group.** Anything longer than class → project → group from the rail fails
  goal 4.
- **Old links break.** Links in notifications, bookmarks, emails and walkthroughs must land somewhere
  sensible.

## Non-goals

- Students' screens are not the target. The owner did not rule out students' screens changing, but
  nothing here asks for it. Where a page is shared (the class page, the class project page), the
  student view keeps its current tabs and behaviour. *(My call: leave students as they are.)*
- Work projects and spaces (`general_*`) are untouched, including their Work tab.
- Admin rails, stakeholder rails and members without `can_teach` are untouched.
- No new data model. Apart from one read permission (the group's files, section 6), this is a
  reorganization of existing screens and queries. Any SQL follows the rerun rules in `CLAUDE.md`.

## Who this is for

Any member with `can_teach` on, which is `canTeach(profile)` in `lib/access.ts`. The class pages
apply to anyone who teaches that class (`teachesClass`: the class professor, and co-teachers or
advisers with `can_teach` at owner or manager level). A teaching member who also has work (spaces,
work projects, or the Project manager switch) keeps a Work section in the rail. Everything else
about that member's work-side experience is unchanged.

- **The rail** changes only for `canTeach` members.
- **The class project page.** Today, any member who opens it gets `ProjectDetail role="professor"`,
  including an adviser without `can_teach`. All of them get the new layout, so the old Work tab and
  `ProfessorTasksView` can be deleted instead of kept alongside. *(My call: one professor layout,
  not two.)*
- **Admins** keep `/teaching/submissions`, `/teaching/reassignments`, `/teaching/analytics` and
  `/teaching/reports` as they are today, for reading across the program (`RequireTeaching`,
  `opensTeaching`). Only teaching members are redirected (section 9). *(My call: admin access stays
  unchanged.)*

## The design

Mockups from the session are in `.superpowers/brainstorm/1937-1794506017/content/`
(`flow-v1.html`, `group-page.html`, `feature-map.html`). They are wireframes for layout and
placement, not visual design. The design system rules in `CLAUDE.md` apply as usual.

### 1. The rail (teaching members)

Top to bottom:

- **Home**
- **Waiting on you**, with a count badge *(my call: badge the count of items waiting)*
- **Inbox**, **Calendar**, **Meetings**
- **Classes**: each of the professor's live classes, then **+ New class**. Archived classes stay on
  the Archive page.
  - *(My call: the class you are in expands to list its live projects, so the project is one click
    from the rail too. This replaces Quick access for teaching members.)*
- **Work**: only when the member has work or the Project manager switch. Holds their spaces, the
  Projects page and My tasks, as today.
- **Resources**: Syllabi, Curriculum
- **Account**: Settings, Archive, Trash

Gone from the teaching rail: Projects, Groups, My tasks (unless they have work), Quick access,
Submissions, Reassignments, Analytics, Reports. Each one's content moves as shown below. The rail is
built in `components/app/nav.ts` (`navFor`, the `canTeach` branch) and rendered by `SideNav`.

### 2. Home

Home (`ProfessorHome`) stays. Its "Needs your attention" tile links to Waiting on you. "Groups that
have stalled" and "Progress across your classes" stay. *(My call: Home keeps cross-class progress,
so the overview of all classes has a home that isn't the rail.)*

### 3. Waiting on you (new page)

One page that merges today's **Submissions** (`pages/app/submissions/Submissions.tsx`) and
**Reassignments** (`pages/app/reassignments/Reassignments.tsx`), across every class the professor
teaches:

- **Hand-ins**: today's whole Submissions tracker, which opens on its Waiting status. It keeps the
  status tabs (`SUBMISSION_STATUSES`: waiting, accepted, returned and the rest), class and project
  filters, counts, accept-from-the-row and accept-a-class's-rows-at-once. Returning still happens
  on the group's page, where the note is written. *(My call: keep the full tracker so accepted and
  returned hand-ins aren't lost; old `?status=` links keep working.)*
- Reassignment requests waiting for a decision, with today's decision history reachable.
- *(My call: grades scored but not yet released also appear here, linking to that project's Grades
  tab. Drop it if it turns out to need new queries.)*

Every row opens the group's page in its project (section 6).

### 4. A class (`/classes/:classId`, `ClassSpace`)

Teaching tabs, in order:

| Tab | Holds |
|---|---|
| **Overview** (opens here) | Today's announcements and This week, plus two new tiles for this class: what's waiting on you here (hand-ins, reassignments) and groups behind (late tasks or stalled). |
| **Projects** | Today's Projects tab, with **+ New project** (section 7). |
| **Groups** | The class's group sets: today's class Groups tab plus what the global Groups page did for this class. Making and deleting sets lives here. |
| **Students** | Today's Members tab, renamed. |
| **Reports** | Today's Analytics and Reports for this class, with a switch to show all my classes at once. *(My call on the name and the switch.)* |
| **Syllabus**, **Settings** | Unchanged. |

Submissions and Analytics stop being separate class tabs. Hand-ins show on Overview and in each
project; figures show in Reports. Tab ids live in `lib/classSpace.ts` (`classTabs`, `readClassTab`).
Old `?tab=submissions` and `?tab=analytics` must land on Overview and Reports respectively.

### 5. A class project (`/class-projects/:projectId`, `ProjectDetail`, professor view)

Tabs, in order:

| Tab | Holds (from today) |
|---|---|
| **Groups** (opens here; **Students** on an individual project) | One card per group with done %, current stage and flags (handed in, late tasks, returned, accepted). Above the cards, a "Waiting on you" strip for this project: hand-ins and reassignment requests. A **Manage groups** action opens who's in which group (today's project Groups tab). Clicking a card opens the group's page. |
| **Brief** | Today's Brief: syllabus link, guidelines, rubric, files. |
| **Tasks** | Today's "What you set" (tasks given to every group, AI generate, fan-out, edit, delete), plus every task across groups as list, timeline or calendar, filterable by group. Today's "Every group" task summary moves here. *(My call on putting authoring and the cross-group view together.)* |
| **Milestones** | Setting milestones, plus the groups × milestones grid. |
| **Grades** | The grades table, peer rounds, and release to students. |

The project header (title, type, due date, close and reopen) stays as it is. Today's Work tab and
its Summary, Backlog, Sprints, Milestones and Tasks sections go away for professors. Every piece is
placed in this table or in section 6.

### 6. A group's page in a project (new)

Opened from a group card. For an individual project it is the student's page, with the same layout.
It shows one board: one group's (or student's) work in this project.

- **Header:** breadcrumb (class › project › Groups ›), group name, leader, member count, and
  previous and next group buttons. *(My call: previous and next, so checking every group isn't a
  trip back each time.)*
- **Tabs:**

| Tab | Holds (from today) |
|---|---|
| **Overview** (opens here) | Progress strip: done %, current stage, late tasks, members' share (`BoardProgress`, `MemberProgress`). Under it, the board (`TaskBoard`, read-only for the professor as today), with a switch to list, timeline or calendar, the sprint scope picker, and filters. |
| **Plan** | The group's backlog and sprints (today's Backlog and Sprints sections, `BacklogView`, `SprintsView`). |
| **Files** | The group's working files, read-only. **This is new access:** today the database refuses teachers (`ClassFilesTab` is students-only, and the class Files project keeps students' files their own). The owner decided professors may read them. See "Professor read access to group files" below. |
| **Hand-in & grade** | The verdict (accept, send back with a note: `BoardVerdict`), the score card against the rubric (`ScoreCard`), and this group's peer results. |

Opening a task from anywhere opens the existing task detail (`TaskDetailModal`) over the page.

#### Professor read access to group files (owner's decision)

- Whoever teaches the class (the SQL equivalent of `teachesClass`) can read a group's working files
  in that class's projects at any time, not only after hand-in. They cannot write, upload, delete,
  commit, comment or share. Students' own rights don't change.
- This is a new SQL file. Place it in the chain after the files that own the class Files project's
  storage and repository policies, and before `anon-lockdown.sql`, following `CLAUDE.md`. List it
  in `docs/07-backup.md` with what re-running it requires, and add a test suite under
  `supabase/tests/` covering: the teacher reads, the teacher's writes are refused, another class's
  professor is refused, and a student in another group is still refused.
- Change the comment in `ClassFilesTab` ("the database refuses teachers too") to match.
- *(My call: the Files tab shows the group's files, then the Shared and Discussion views the students
  see, all read-only. If Discussion turns out to be messages rather than files, leave it out; the
  owner asked about files.)*

The route is the builder's call. *(Suggestion: `/class-projects/:projectId/boards/:boardId`, so the
group is in the address and a link from Waiting on you or a notification opens it directly.)*

### 7. Making a project, and groups inside the wizard

The new-project wizard (`ProjectWizard`, `ProjectForm`) keeps its steps. For a group project, the
"Which groups" step offers:

- **Use an existing set** from this class (today's select), or
- **Make groups now**, with the same three ways `CreateSetWizard` offers today (random, by hand,
  let students pick). It is saved as a class group set, so later projects can reuse it.

The "This class has no groups to assign to" dead end goes away. With no sets, "Make groups now" is
the default.

- **Extra sections.** The "Where it runs" step (`SectionPicker`) copies the project into other
  sections, and each one needs its own set. Every section without a set gets the same choice: use
  one or make one now. *(My call. Otherwise the dead end comes back on every extra section.)*
- **When the sets are saved.** New sets are written when the project is created, not while the
  wizard is still open, so cancelling leaves no orphan sets. *(My call. If the existing APIs make
  that impractical, deleting the new sets on cancel is acceptable.)*

### 8. Making a class

The flow stays (+ New class from the rail or the Classes page, `ClassForm`). After creating one, the
professor lands on the new class's Overview, which points to the next step for an empty class: add
students (Students tab), then make a project. *(My call: a short next-step card on an empty class's
Overview. It is not a walkthrough.)*

### 9. Old links

Every old address keeps working through a redirect or a tab fallback:

| Old | New |
|---|---|
| `/teaching/submissions` (with its status filter) | Waiting on you |
| `/teaching/reassignments` | Waiting on you, reassignments section |
| `/teaching/analytics`, `/teaching/reports` | Reports with "all my classes" on. Which class page hosts it, or a standalone route behind it, is the builder's call. |
| `/groups` (professor) | The Classes page, or the only class's Groups tab if there is one class *(my call)* |
| `/groups/:groupId` (professor) | Stays; that class group page still exists. It links into each project's group page. |
| `/class-projects/:id?tab=work&…` (any section, `board=`, `task=`) | The matching new tab, the group's page when a board is named, the task opened when a task is named |
| `/class-projects/:id?tab=groups` | Groups tab, Manage groups open |
| `/classes/:id?tab=submissions` / `?tab=analytics` / `?tab=reports` / `?tab=members` | Overview / Reports / Reports / Students |

Notification links (`/n/:id`, `OpenNotification`) that resolve to any of these must end on the new
place. Students' links (`/groups`, the student project page) are unchanged.

## Constraints

- Follow `CLAUDE.md`: design tokens only, desktop first, then tablet, then phone. Copy rules apply
  (sentence case, no "please", no "successfully"). Use `useAuth()` and route conventions.
- **Walkthroughs.** The teaching steps in `lib/walkthrough/flows.ts` (`create-class`, `share-code`)
  and any other step whose element moves must point at the new places, with
  `data-walkthrough` markers on the real elements. `markers.test.ts` must pass.
- No change to permissions or what a professor can do. The professor still cannot move cards on a
  class board. Everything a professor could do before, they can do after, from one place.
- `npm run build` and the test suite pass. Verify in the preview as a teaching account and as a
  student (to confirm student views are unchanged).

## Left to the builder

- Exact routes for the group page and Waiting on you, and the redirect mechanics.
- Whether the class-expands-in-rail list caps the number of projects shown.
- Visual design of the group cards and the progress strip, within the design system.
- How Reports' "all my classes" switch is hosted.
- How the work is split into shippable steps. *(Suggestion: rail and Waiting on you first, then the
  project page and group page, then class tabs, then the wizard. Each step keeps old links working.)*

## Calls I made (for the owner to check)

1. Students' screens stay as they are.
2. The only SQL is the professor read access to group files, which you decided.
3. Waiting on you has a count badge and keeps the whole Submissions tracker (all statuses). It also
   lists grades not yet released.
4. The class you are in expands in the rail to list its projects, replacing Quick access.
5. Home keeps cross-class progress.
6. The project's Tasks tab holds both "What you set" and the cross-group task views.
7. The class tab is named Reports and has an "all my classes" switch.
8. The group page has previous and next group buttons.
9. A professor's `/groups` goes to Classes, or to the only class's Groups tab.
10. An empty class's Overview shows a next-step card.
11. Anyone who gets the professor project view, including an adviser without `can_teach`, gets the
    new layout, and the old Work tab is deleted.
12. Admins keep the `/teaching/*` pages; only teaching members are redirected.
13. "Make groups now" covers every section in "Where it runs", and new sets are saved only when the
    project is created.
14. The group Files tab also shows the Shared view read-only.
