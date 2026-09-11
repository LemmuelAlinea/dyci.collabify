# 06 — Class detail (both roles)

Read `00-BRIEF.md` and `01-FOUNDATIONS.md` first.

Routes: `/redesign/student/classes/:classId`, `/redesign/professor/classes/:classId`
One screen, six tabs, two audiences.

---

## What it is for

The workspace for a single class. A professor runs the class from here; a
student lives in it. Six tabs, and the tab is the unit of work — somebody
opening this page has already decided which of the six they came for.

**Announcements · Classmates/Students · Groups · Projects · Syllabus · About**

The header is shared by all six and stays put.

---

## The header

- The class **initial** as its handle, the **name**, and
  `section · semester · school year`.
- Student count.
- Its state: active term, or archived.
- **Professor only:** the **class code** with one-press copy; a **joining
  open/closed** switch; and Edit / Archive actions.

The joining switch is a real control with a real consequence — with it off, the
code stops working — so it must read as a switch that is currently on or off,
not as a button.

---

## Tab 1 — Announcements

The class's notice board. **A student can only read an announcement for 24
hours.** After that it comes off their screen on its own. This is the product's
rule, not a technical limit, and it changes the design:

- The professor's feed keeps everything, and must show **which of their own
  announcements the class can still see** versus which have expired. That
  distinction is the most important thing on this tab for a professor.
- The student's feed only ever has live ones.
- The copy that explains it already exists and is worth keeping in spirit: an
  announcement is on your students' screens for 24 hours and then comes off on
  its own; you keep all of them here; to say something again, post it again.

An announcement has: a title, a body, an author with avatar, a timestamp, a
**pinned** flag, an edited marker, and file **attachments** (name, size,
downloadable).

Professor can post, edit, delete and pin. The compose form asks for a title
("Final defense schedule"), a message ("What your students need to know, and by
when"), and optional attachments.

## Tab 2 — Classmates (student) / Students (professor)

The roster. Each row: avatar, full name, and — **professor only** — the email
address. A student sees names and photos, never addresses.

Professor can: message a student directly, and remove a student from the class.
Removal is confirmed, and it is recoverable — a removed student keeps a record
of having been in the class so a mistake can be undone.

Empty, for a student: they are the first one here; others appear as they join
with the code.

## Tab 3 — Groups

The same groups board as the Groups directory, scoped to this class. See
`07-groups-directory.md` for its full anatomy — do not design it twice; design
it once and place it here.

A professor can create a group set from here, close a set, and delete one.
Deleting a set is guarded: if projects are bound to it, the confirmation says
how many.

## Tab 4 — Projects

The same projects board, scoped to this class. See `09-projects-directory.md`.

## Tab 5 — Syllabus

The class's week map, and the one tab whose rules are subtle. See
`19-syllabus-detail.md` for the week editor; this tab is the **class-side**
view and has three parts:

**Term dates** *(professor only)* — the term's start and end. Week 1 starts on
the first date and every other week counts from it. Until these exist, no week
has a date and nothing in the class can be measured.

**Disruption record** — when a term has been shifted (a typhoon closed the
school, classes were suspended), each shift shows as a line: which week onward
moved, by how much, the reason, and when it was recorded. **Students see this
too** — somebody who planned around the old midterm date is owed the reason,
not just the new date.

**The week map** — every syllabus week in order: number, title, its date range,
its topics, its learning outcomes, and what it expects handed in. Each week is
marked *done*, *this week*, or *upcoming*. A professor can move a week's date,
which moves that week and every week after it.

The header above the map states where the term is. There are four possible
answers and they are genuinely different: in week N; the term has not started;
every week is done; or — after a suspension — **no week is running, and the
next starts on a date**. That fourth case is real and common after a shift.

## Tab 6 — About

Reference. Description, section, year level, semester, school year, professor,
whether joining is open, and links to the attached syllabus and curriculum.

---

## Responsive

- **360px** — the tab bar must stay usable with six tabs. Scroll it
  horizontally or collapse it into a select; do not wrap it into three rows.
  The header collapses but the class code stays copyable.
- **768px** — tabs inline.
- **1280px+** — tab content uses the width. The roster and the week map both
  benefit; neither should be capped narrow.

Deep-link each tab so a tab survives a refresh and can be shared.

---

## States

- **Loading** — header first, then the tab's content.
- **Not available** — a student opening a class they were removed from, or one
  that was archived, gets one clear sentence: the class is no longer available,
  the professor may have archived it or removed them from the roster.
- **Empty per tab** — each tab has its own, listed above.
- **Archived class** — everything is readable, nothing is editable, and the
  header says so.

---

## Keep

- Six tabs, these names, this order.
- The 24-hour announcement window, and the professor being able to see which of
  theirs are still live.
- Email addresses on the roster for professors only.
- Term dates gating everything measurable in the class.
- The disruption record being visible to students, with its reason.
- The four "where the term is" states, including the gap after a suspension.

## Do not carry over

- The navy hero header block.
- The current tab bar styling.
- Per-tab section panels that are all the same card with a bordered header
  strip.
