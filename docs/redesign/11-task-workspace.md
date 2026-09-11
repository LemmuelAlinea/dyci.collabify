# 11 — The task workspace (Tasks tab)

Read `00-BRIEF.md`, `01-FOUNDATIONS.md` and `10-project-detail.md` first.

Lives inside: project detail, Tasks tab. Also reachable from group detail.
This is where the actual work of the product happens. Design it carefully.

---

## The model — read this twice

**A board is worth 100.** Not the tasks: the board.

Adding a task does not add points; it **shrinks every other task's slice**. So
a task's weight is a *proportion of the project*, and a board's progress bar is
always the whole project, never a running total. Every number on this screen
follows from that and the design must not imply otherwise.

Two numbers exist per member, and they mean different things:

- **Their own 100** — how much of what they hold is finished.
- **The slice of the group's 100 they are carrying.**

A member can be at 100% personally and still be carrying a fifth of the
project. The current design puts these side by side, the personal one large.
Keep that distinction however you present it — collapsing them into one number
would destroy the most useful thing the screen says.

A student cannot claim past a **fair share** of the board. The database refuses
it; the interface should say so before the click, not after.

---

## Student view — their own board

**Board progress** — the group's 100, split: done, in progress, not started.
With a legend, because colour alone must not carry it.

**Everyone in the group** — each member with both numbers.

**The tasks**, in one of three views the student switches between:

- **Summary** — counts finished, updated, created, due soon; a status
  breakdown; recent activity.
- **Board** — columns To do / In progress / Done, each with a count.
- **List** — a table: title, owner, status, weight, deadline.

**Filters** — search, owner ("Anyone"), status, and for a professor the group.

**Task cards** carry: title, its weight as a percentage of the project, a
description preview, the faces of who is on it, a deadline, and its status. The
card has an inline **Start / Mark done / Reopen** action, and for the person
who owns it, edit and delete.

**Claiming.** An unclaimed task shows *Claim it*, or *Your share is full* when
they cannot take more. A claimed task shows the faces and a control to change
who is on it. That control lists every group member with their avatar and full
name, a tick beside those already on it, whether each has room, and a **Hand it
back to the group** action. Shared tasks show what each person earns — *"15.4%
each"* — and the panel explains that splitting gives each person less as more
join. Once a task is **started**, it stays with whoever is on it: it can no
longer be handed back, and the panel says so rather than failing silently.

**Handing in** — a single action for the whole project, not per task. It is
**reversible while the project is open**: the group can take it back. It can be
handed in with tasks unfinished, and the screen says so plainly — *"1 task is
still unfinished. You can hand in anyway — your professor sees where the work
got to."*

**The verdict** — once the professor answers, the board shows it: accepted, or
returned with what needs fixing. A return **un-submits** the board, which is
what gives the group their work back.

**AI draft** — a student can ask for a first breakdown of the project into
tasks. A draft, editable, clearly marked as one.

---

## Professor view — everyone at once

**What you set** — the tasks the professor handed to every group. Each with its
title, how many groups have it, how many started, how many finished; and edit
and withdraw actions. Withdrawing pulls it from every board.

**Where the groups are** — one tile per board. Each: the group's name, its
progress as a proportion and a bar, done out of total, member count, and
whether it has been **handed in**. Tiles needing attention are marked — a board
with no tasks, or with work nobody has claimed.

Tiles can be sorted by **needs attention**, **furthest along**, or **name**,
and searched. Only the first eight show until asked for more.

An **accept** control sits on a tile that is handed in and **not yet
answered**. Subtle but reachable — one press to accept a finished board without
opening it. The rule for showing it is exact: *the board was submitted more
recently than the last decision on it*. A board that was returned and handed
back in must show it again.

Opening a tile reveals that board below: its progress, its members, and its
tasks in the same three views.

**The verdict panel** — accept, or return with a written note saying what is
missing and what would make it acceptable. The note is required on a return.

---

## Responsive

- **360px** — the board view scrolls horizontally, one column at a time, with
  the column headings sticky. Do not stack the three columns vertically; it
  destroys the kanban's meaning. The list view drops to cards. Filters collapse
  behind one control.
- **768px** — two columns of the board visible, or all three compressed.
- **1280px** — the whole board, plus progress and members beside it.
- **1920px+** — more board tiles per row, wider columns; not more air.

Every popover here — the claim control especially — must stay on screen when
its anchor is near a viewport edge.

---

## States

- **Loading** — skeletons in the board's shape.
- **Empty, student** — the board has no tasks; the group can break the project
  down themselves, or wait for the professor.
- **Empty, professor** — *"You have set none. A group can still break the
  project down themselves."*
- **Locked** — the project is closed: tasks cannot change, the board is still
  readable, comments still work.
- **Handed in** — the board is submitted and waiting on a verdict.
- **Returned** — the note is visible and the work is editable again.
- **Full** — sixty tasks, twenty boards.

---

## Keep

- The board being worth 100 and tasks being slices of it.
- Both member numbers, and their distinction.
- The fair-share limit surfaced before the click.
- A started task staying with whoever is on it.
- Hand-in being for the whole project, reversible while open, and possible
  with tasks unfinished.
- A return un-submitting the board.
- The accept control's exact visibility rule.
- Three views, and the filter set.

## Do not carry over

- The current card anatomy and its stacked meta rows.
- The view switch and filter bar's styling.
- The progress panel's large-number-plus-legend block.
