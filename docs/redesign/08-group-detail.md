# 08 — Group detail (both roles)

Read `00-BRIEF.md`, `01-FOUNDATIONS.md` and `07-groups-directory.md` first.

Routes: `/redesign/student/groups/:groupId`, `/redesign/professor/groups/:groupId`

---

## What it is for

One group: who is in it, and what it is carrying. A student comes here to see
their team; a professor comes here to fix a team that is not working.

---

## Header

- Group **name**, the class it belongs to, and its **set**.
- The set's state — open or final.
- Members out of the limit.
- How the group was formed: manual, random, or student formed.

**Professor actions:** rename the group; set the **member limit**, with the
option to apply it to **every group in the set** rather than only this one;
**Archive** / **Restore**; and Delete.

Delete carries the warning from `07`: it takes the group's board and its whole
conversation — every task, comment, work log entry, file and message — and the
database refuses it outright once either holds anything. Archive is the action
that should be in reach; delete is the one that should require intent.

**Student action:** on a student-formed, still-open set, a **Join this group**
button, disabled and labelled *"Group is full"* when it is.

---

## Projects and tasks

Everything assigned to this group. Per project: the project, its progress,
and its tasks with status and owner. This is how somebody answers "what is
this group actually meant to be doing" without leaving the page.

---

## Members

The roster: avatar, full name, and when they were placed.

**Professor:** add a student from a list of the class's **unplaced** students —
those in the class but not yet in any group in this set. The control is
disabled when the group is at its limit and says *"Group is full"*. A professor
can also move a member to another group, and remove them.

A real constraint worth designing around: **names here are long**. "Ricardo
Batumbakaldimagibababy" is a real member. Any list, select or avatar tooltip
must wrap rather than truncate a name somebody has to choose between.

---

## Responsive

- **360px** — one column: header, work, members. The member-limit and add
  controls stay reachable.
- **768px** — still one column; the header actions may move into a menu.
- **1280px+** — two columns: the work wider, the members beside it.

---

## States

- **Loading** — header, then both panels.
- **Empty members** — nobody in this group yet, with the professor's way to
  add somebody right there.
- **Empty work** — no projects assigned to this group yet.
- **Archived group** — clearly marked, everything readable, Restore offered.
- **Error / not found** — one sentence and a way back to the directory.

---

## Keep

- The member limit applying to one group or the whole set.
- The unplaced-students source for adding members, and the full-group disabled
  state.
- Join only on an open, student-formed set.
- Archive prominent, delete deliberate, and the delete refusal naming what the
  group holds.

## Do not carry over

- The navy header block with the inline icon tile.
- The two panels each being a bordered card with a sunken header strip.
