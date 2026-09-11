# 12 — Task detail

Read `00-BRIEF.md`, `01-FOUNDATIONS.md` and `11-task-workspace.md` first.

Opens over any screen showing tasks — the board, the list, My tasks, the
analytics leaf. Currently a dialog; the form is yours to choose, but it must be
dismissible and must return focus where it came from.

---

## What it is for

Everything about one task in one place: what it is, who has it, what has been
done, and the conversation around it. It is the deepest screen in the product
and the one a student spends the longest in.

---

## Contents

**Header** — the task title, and beneath it a summary line: its status, how
many people are on it, how many files are attached.

**Description** — *"What done looks like."* Editable by whoever may change the
task.

**Files** — deliverables stay with the task. Drop a file or browse; PDF,
Office, an image or a zip, up to 20 MB. Each file shows its name, size and
type, previews where it can, and downloads through a link that **expires after
ten minutes**. The empty state says what the space is for: *"Nothing attached
yet. Put the deliverable here so it sits with the work."*

**Task status** — *"Keep the board current."* To do → In progress → Done. For
a group task the note reads *"The group moves its own work."*

**Request reassignment** — asking for the task to change hands. Three things
can be asked for: someone takes it over, it is released back to the group, or
it moves to a named person. **A reason is required**, and it goes **only to the
professor and to whoever wrote it** — never to the person the task is about.
That is a privacy rule, not a UI preference, and the screen should not imply
the subject will read it.

**Details** — a definition list: assignees, status, **worth** (its percentage
of the project), started, due, finished, time logged, and who created it and
when.

**Activity**, in three filters:

- **Comments** — the discussion. *"Nothing said yet. Ask the question here
  rather than in a chat nobody can find later."* Comments are editable and
  deletable by their author.
- **History** — what happened to the task and when: claimed, started, finished,
  moved, reassigned.
- **Work log** — time spent, with what it went on. Each entry: minutes (entered
  as hours and minutes, capped at 24h and 59m), a note *"What the time went
  on"*, and the date. Its own author can remove an entry. This is **evidence of
  effort**, which is the only record of work that does not show up as a
  finished task.

---

## Role and permission differences

- A **professor** is never locked out of a task by the project closing.
- A **student** loses editing when the project is closed, but can still read
  and comment.
- A task that has been **started** cannot be handed back to the group.
- Only the **assignee or author** may edit a comment or remove a work-log
  entry.

---

## Responsive

- **360px** — a full-height sheet, not a small centred dialog. One column:
  header, status, description, files, details, activity. The activity filter
  is a segmented control that fits three options without wrapping.
- **768px** — still one column, wider.
- **1280px+** — two columns: the substance left (description, files,
  activity), the controls right (status, reassignment, details).

Long names appear throughout; nothing here truncates a person's name.

---

## States

- **Loading** — the frame appears immediately, its contents fill in.
- **Empty** — each region has its own, quoted above.
- **Read-only** — project closed, or the viewer has no claim on it.
- **Error** — inline, and the dialog does not close underneath it.

---

## Keep

- The reassignment reason being required, and private to the professor and its
  author.
- The three activity filters and what each holds.
- The work log as evidence of effort, with its own removal rule.
- "Worth" as a percentage of the project.
- Ten-minute file links.
- A professor never being locked out.

## Do not carry over

- The two-column panel layout as it currently stands.
- The icon-chip section headers.
