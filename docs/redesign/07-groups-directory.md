# 07 — Groups directory (both roles)

Read `00-BRIEF.md` and `01-FOUNDATIONS.md` first.

Routes: `/redesign/student/groups`, `/redesign/professor/groups`
Also embedded as the **Groups tab** inside a class. Design it once.

---

## The model, which the design has to make legible

Three levels, and confusing them is the main way this screen goes wrong:

- A **class** contains one or more **group sets**.
- A **group set** is one *way of dividing the class* — "Project Milestone 2
  teams", "Lab pairs". A class can have several at once, for different pieces
  of work.
- A **group** belongs to a set, has a name, a member limit, and members.

A set has a **mode**, chosen when it is created and unchangeable after:

| Mode | Meaning |
|---|---|
| **Manual** | the professor places each student |
| **Random** | shuffle the class, reshuffle until it looks right |
| **Student formed** | publish empty groups and let students pick |

A set is either **open** or **closed** ("final"). Closing it freezes
membership — students can no longer join or leave, and the professor stops
being able to rearrange. A closed set can be reopened.

---

## Professor view

Grouped by set. Each set shows its name, its class, its mode, whether it is
final, and its actions: **Close set** (or Reopen), and **Delete all groups**.

Under each set, its groups. Each group card: name, members out of the limit, a
stack of member avatars, and its project progress — how many projects it holds
and how far its board has moved.

### Creating a set

A wizard:

1. Name the set, pick the mode, set a default member limit.
2. Manual: build the arrangement by placing students. Random: choose a group
   size or count and shuffle, reshuffling until satisfied. Student formed:
   publish the empty groups.
3. Save.

The arrangement saves in **one transaction** — a half-built arrangement must
never land.

### Archive and delete

This is the part the design must get right, because deleting a group takes far
more than the group:

- **Archive** is the everyday action. The group is put away. Its members stay
  placed, its board and every task on it stay whole, and its conversation stays
  whole. Restoring is one press.
- **Delete** exists only for a group created by mistake. It is **refused** the
  moment the group holds a task or a message, with a message naming what is
  there: *"Group 1 has 11 tasks on it. Archive it instead — deleting would
  take that with it."*
- Members alone do not block a delete; a placement can be made again in a
  moment.

The directory has an **Active / Archived** switch so archived groups can be
found and restored. Make archive the obvious action and delete the deliberate
one — the current design has them as a button and an identical-weight trash
icon, which is exactly backwards.

Re-saving an arrangement over a set whose groups already hold work is refused
for the same reason.

## Student view

Two tabs:

**My groups** — the groups the student is in. Each: name, class, set, members
with faces, and the projects the group holds with progress.

**Open to join** — sets in student-formed mode that are still open, with their
groups, each showing how full it is. A student joins a group here. Joining
fails with its own sentence when: the group is full, the set has closed, the
set is not student-formed, or they are not in the class.

---

## Responsive

- **360px** — one group card per row, grouped under a set heading that stays
  legible while scrolling. The avatar stack caps and shows "+3".
- **768px** — two per row.
- **1280px+** — three or more. A professor with twenty groups across four sets
  must not need endless scrolling; consider collapsing sets or a denser row.

The set header carries actions — they must not fall off a phone.

---

## States

- **Loading** — skeletons grouped by set.
- **Empty, professor** — no sets; create one to split a class into teams, by
  hand, at random, or letting students pick.
- **Empty, student "my groups"** — not in a group yet; either the professor
  places them or a set is open for them to pick.
- **Empty, student "open to join"** — nothing open right now.
- **Empty, archived** — nothing archived.
- **Full** — twenty groups of five, several sets, several classes.

---

## Keep

- The three-level model, and the set's mode and open/closed state.
- Mode chosen at creation and fixed after.
- Archive as the default; delete refused when work exists, with the count in
  the message.
- The Active/Archived switch.
- Each join failure having its own sentence.

## Do not carry over

- The navy hero block.
- Archive and delete presented as equal-weight neighbours.
- The current set header strip.
