# 10 — Project detail (both roles)

Read `00-BRIEF.md`, `01-FOUNDATIONS.md` and `09-projects-directory.md` first.

Routes: `/redesign/student/projects/:projectId`, `/redesign/professor/projects/:projectId`
Two tabs: **Brief** and **Tasks**. The Tasks tab is large enough to have its
own file — see `11-task-workspace.md`.

---

## Header

Shared by both tabs and both roles:

- The project **type** and its **week span** as small labels.
- Its **status** — open, scheduled, closed, archived.
- **Title**, and the class it belongs to as a link. If it is a group project,
  the group set as well.
- Three facts, side by side: **Deadline**, **Submission** (per group / per
  student), **Points**.
- When scheduled: *"Hidden until [date and time]"*.
- When part of a series: *"Also set for BSIT-4B, BSIT-4C — each has its own
  board and deadline."*

**Professor actions:** Edit, **Close / Reopen**, **Archive / Restore**,
Delete, and **Release now** when it is scheduled. Every one of these on a
series project asks first whether it applies to **this section only or all of
them** — that dialog is a real part of the design, not an afterthought.

---

## Tab 1 — Brief

Four panels. A student reads this to know what to do; a professor reads it to
check what they set.

**Based on the syllabus** — the weeks this project is bound to, each with its
number, title, dates, topics, outcomes, and what the syllabus says is handed in
that week. This is what justifies the project's existence and belongs first.

**Guidelines** — the brief itself, prose. Cap the measure; this is the one
genuinely long-form text in the product.

**Rubric** — the criteria, each with a label, a description and its points,
and the total. When the criteria do not sum to the total, say so.

**Files** — attachments. Professors add and remove; students download. Show
name, size and type. Uploads are capped at 20 MB.

---

## Tab 2 — Tasks

See `11-task-workspace.md`. It differs completely by role:

- A **student** sees their own board and works on it.
- A **professor** sees what they set, every group's progress, and can open any
  one board.

---

## Responsive

- **360px** — header collapses; the three facts become a compact row, not
  three stacked cards. The two tabs stay side by side.
- **768px** — brief panels begin to pair.
- **1280px+** — syllabus and files span wide; guidelines and rubric pair. The
  guidelines measure stays capped however wide the screen.

---

## States

- **Loading** — header, then the tab.
- **Scheduled, seen by a professor** — visible with the release time and a
  "release now" action.
- **Scheduled, seen by a student** — they cannot reach it at all.
- **Closed** — a banner: the project is closed, tasks can no longer change,
  the board is still readable, and a professor can reopen it. For a professor
  the banner also says they are never locked out of a task themselves.
- **Archived** — readable, marked, restorable.
- **Not found / not yours** — one sentence and a way back.

---

## Keep

- Two tabs, this split.
- The syllabus panel first in the brief.
- The three header facts.
- The series scope dialog on every bulk action.
- Points never presented as a grade.
- The closed-project banner's exact meaning, including a professor never being
  locked out.

## Do not carry over

- The navy header with the icon tile and the three-cell bordered `dl` grid.
- Four panels that are four identical bordered cards.
