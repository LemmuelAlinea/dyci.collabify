# Collabify guide map — design

**Date:** 2026-10-22 · **Status:** awaiting approval

## Why

Collabify is large enough that a group can lose its place presenting it. The capstone
group (three members) wants one printed guide that walks the whole website, landing page
to the end, so the panel sees every feature and nobody has to jump back to a page already
covered.

## What it is

A complete, step-by-step map of what Collabify can do, followed as a journey through the
website by three users on three screens:

| Tag | User | Notes |
|---|---|---|
| **F** | Faculty | Teaching faculty. Creates the class, the projects and the work space. |
| **A** | Student A | In the same group as B. Takes the group leader role when the guide needs one. |
| **B** | Student B | In the same group as A. |
| **AI** | (marker) | Added beside a step that uses an AI helper. |

It is a guide to the website, not a script: no timings, no speaker lines, no live/show/say
markers.

## Goals

- **Complete.** Every user-facing page, tab, panel, dialog, setting, rule the user can see,
  and AI helper reachable by a student or a faculty member appears.
- **One pass.** Each feature appears once, at the step where it lives. The order never sends
  a reader back to a section already covered.
- **Who does what.** Every step names the user who acts. Two-user features (request and
  decision, hand-in and answer, invite and accept) appear as consecutive steps with
  different tags.
- **Findable.** Every section states the click path to reach it.

## Non-goals

- Admin pages. The only admin moment is approving the new faculty account, done off-screen
  on the presenter's phone. The guide shows it as one line ("the admin approves the faculty
  account") and nothing more.
- Timings, speaker notes, presentation scripting.
- Explaining how the code works.

## Anti-goals (failure even if it "works")

- A feature that exists in the app and is missing from the guide.
- A feature that is in the guide but not in the app, or worded differently from the app's
  own labels (button names, tab names must match what is on screen).
- A section order that needs the reader to revisit a page.

## Format (decided)

- **Printed on Letter paper** (8.5 × 11 in), portrait.
- **Layout C:** each page has a narrow "you are here" rail down the left listing every
  section in order with the current one highlighted; the main column holds the section.
- **Each section:** number and name, click path (e.g. *Projects → class project → Work tab →
  Tasks*), then numbered steps. Each step starts with its user tag (F / A / B, plus AI where
  it applies). Indented notes under a step carry details and rules ("a board always totals
  100 points", "only the faculty member reads the reason").
- **Each section starts on a new page.**

## Builder's calls (Claude's, open to override)

- Built as a print-designed web page, published as a private Artifact link, plus a PDF
  exported for printing.
- Readable in black-and-white printing: user tags differ by letter and shape, not colour
  alone.
- Two closing indexes after the last section, which point back to step numbers rather than
  repeating content: **AI helpers** (all eleven, with where each lives) and **Two-user
  interactions** (every handoff between users).
- Feature content is taken from the code (pages, tabs, components, database rules, edge
  functions) and every label checked against the app's own wording.
- Home comes early (section 3) at the user's request, before any work exists. The guide
  describes every dashboard panel there once, saying what fills it, rather than returning
  to Home later.
- Pages that open from both the Teaching menu and a class's tabs (Submissions, Analytics,
  Reports) are covered once, at the section where the work happens, with both paths given.

## Section order (decided with the user; detail is the builder's to fill from the code)

1. **Landing page** — hero, the film, "Three ways to work", features, how it runs (two
   spaces, build from the syllabus, plan by voice, board/files/hand-in, templates, teams and
   positions, summarizing long files), legal pages, Sign in / Get started.
2. **Account setup** — F registers as Faculty, A and B as Students (names, email, password,
   role, consent to Privacy Policy, Terms, Cookie Notice); Google sign-up and the onboarding
   page; Check email and confirming; Sign in; Forgot / reset password; F waits on the
   pending page until the admin approves (one line), then Check again; a student with no
   class sees a Home that only offers Join a class.
3. **Home and finding your way** — the dashboard per role (every panel), the side
   navigation and its sections, collapsing the rail, search, the notification bell, the
   profile menu, the "new version" notice.
4. **Settings** — Profile (photo, names, email not editable), Appearance (light / dark /
   system; colour customizer: banners, status highlights, sidebar, icons, progress bars,
   notifications and badges, pop-up messages, project icons, background depth, saved
   palettes up to 12, reset), Notifications (each category, which differ by role), Security
   (reset link, sign out), the link to Your data.
5. **Teaching resources (F)** — Syllabi library: upload, AI reads the weeks, edit weeks,
   mark verified; Curriculum; published program documents; archive and trash.
6. **Creating a class (F)** — Classes page, Create class (every field, section, syllabus,
   curriculum, start from a past class and copy its projects), the class header (code, copy,
   allow joining), class Settings, term dates, inviting a co-teacher.
7. **Joining the class (A, B)** — join with code and with link; the class Overview (feed,
   about, this week); Members; F's roster tools (message a student, remove, put back).
8. **Announcements** — F posts one (AI draft from one line, links to a class / project /
   task, attachments, pin, edit, delete); A and B see it on the feed and the dashboard and
   are notified.
9. **Syllabus and the term** — the week map; F shifts weeks after a suspension with a
   reason, then picks which deadlines move.
10. **Groups** — F creates a set (manual, random that avoids past groupmates, student
    choice; set name, members per group, number of groups); A and B join under student
    choice; picking and passing the leader; renaming; leaving; F's edits (move, limit,
    leader, place the unplaced, delete, close the set); the Groups page and a group's page.
11. **Creating a class project (F)** — Projects page (Classes / Work switch); the wizard
    (class, syllabus week span, name and type, individual or group and which set,
    guidelines and rubric with AI draft, total points, criteria, progress stages presets or
    custom, other sections of the course, deadline, release date, files); after saving:
    publish now, change deadline, close, archive, delete, series actions.
12. **The project page (A, B)** — Brief (guidelines, rubric, files, the syllabus weeks it
    is based on), the release notification, project card states.
13. **Tasks** — F sets a task copied to every board and can draft tasks with AI; A drafts
    tasks with AI and from notes; adding a task and its weight (board totals 100); claiming
    up to a fair share; individual projects auto-assign; moving through stages; handing a
    task back before it starts; task detail (comments, files, files from the project, time
    log, history); archiving own tasks; late marking; filters and views (board, list,
    timeline, calendar); F's view of every board (group progress, member progress, share of
    the group); F reminds a quiet board; **reassignment**: B asks for a task to change hands
    with a reason, F decides in Teaching → Reassignments, both notified.
14. **Planning the work** — Summary, Backlog, Sprints (start, burndown, finish and where
    unfinished work goes), Milestones (F sets them; students tag tasks and add sprints to
    them), Timeline.
15. **Files and Shared with me** — the board's repository (Main, My draft, For review,
    History); new file, folder, upload; Word, Excel and code editors, PDF preview; AI key
    points of a file; AI commit message; commit to Main (leader) and Commit access for
    groupmates; submit for review, compare, comment, merge or return, AI change summary;
    Ask about these files (AI); formula help (AI); sharing a draft to a teammate and copying
    it to one's own draft; downloads and folder ZIP; archive and trash.
16. **Discussion** — rooms and folders, start and stop, messages, polls, files, voice
    messages with AI transcripts (editable), downloading as Word or PDF, using a discussion
    as the source for task drafting.
17. **Hand-in and the answer** — A hands in (board freezes), taking it back; F's
    Submissions page (filters, late flags), accept or return with a note; the group is
    notified; returned work is fixed and handed in again; F closes the project.
18. **Peer evaluation** — F opens a round (check-in or final), sets its close, reminds,
    closes, reopens; A and B rate their team (five behaviours, comments; private from the
    person rated); F reads the results (factor, flags, comments).
19. **Scoring and grades** — F scores each board on the rubric, the suggested individual
    score, overriding and confirming, releasing and unreleasing, clearing scores and the
    rubric lock; A and B see their grade card.
20. **Analytics (F)** — the scope bar, Needs attention and See why, Class, Groups,
    Students and Projects views, the student panel, intervention notes and resolving them.
21. **Reports** — F's eight reports with their filters, print, Excel and Word; A and B's
    Your record (contribution, group project report, print).
22. **Staying in touch** — Inbox (class, group, project and direct conversations; F starts
    a direct message; text, attachments, voice, polls; pin, edit, delete for me / everyone;
    invitations), notifications, Calendar, Meetings (schedule for a class, group, space,
    project or team with a Meet or Zoom link; start now; join window; edit; cancel), My
    tasks.
23. **Work spaces** — F creates a Work space and invites A and B, who accept in the Inbox;
    space Overview, Projects, Teams, Members (invite, join code, remove, leave), Reports,
    Archive, Settings; a new work project (preset or saved template, space team); the
    project's Overview (details, status, dates, stages, custom fields, teams and
    **positions**, since your last visit, forecast); Members (Owner / Manager / Member, the
    six permissions, an access request from B approved by F); joining a project with its
    code; Work (tasks with team and start date, AI tasks from notes / a file / a discussion
    that also creates sprints and milestones, backlog, sprints, milestones, timeline);
    Files, Shared with me and Discussion as in sections 15–16 with work-project permissions;
    the report builder (saved and shared reports, sections, compare with the previous
    period, score weights, print / PDF, CSV); save as template; archive a project and its
    Project archive.
24. **Putting things away and your data** — Archive, Trash (30 days), Your data (privacy
    requests, what you agreed to), the legal pages, archiving the class at term end, signing
    out. The end.

Then the two indexes (AI helpers; two-user interactions).

## Left to the builder

- Exact step wording, provided button and tab names match the app.
- Which detail goes in a step and which in an indented note.
- Where a feature that two sections could claim is placed, as long as it appears once and
  the choice avoids a revisit.
- Visual styling within the decided layout.
