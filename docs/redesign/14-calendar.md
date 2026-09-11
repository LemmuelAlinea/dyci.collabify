# 14 — Calendar (both roles)

Read `00-BRIEF.md` and `01-FOUNDATIONS.md` first.

Routes: `/redesign/student/calendar`, `/redesign/professor/calendar`

---

## What it is for

Every date in the term on one surface. Not a scheduling tool — nothing is
created here. It is a **read** of dates that already exist elsewhere, and its
job is to stop a deadline arriving as a surprise.

---

## What is on it

Four kinds of event, and which a role sees differs:

| Kind | Meaning | Student | Professor |
|---|---|---|---|
| **Project due** | a project's deadline | ✓ | ✓ |
| **Task due** | one task's deadline | ✓ | — |
| **Opens to students** | a scheduled project's release | — | ✓ |
| **Handed in** | a board was submitted | ✓ | ✓ |

A professor does not see individual task deadlines — there are hundreds, and
they are the groups' business. A student does not see release times, because a
project they cannot see yet is not a date they can plan around.

Behind the events sit the **syllabus week bands**: the term's weeks drawn
across the grid so a date can be read as "week 11" and not only as "October
12th". This is the calendar's most distinctive feature and the thing that makes
it a *course* calendar rather than a generic one. A shifted term moves these
bands, so a gap after a suspension appears here too.

---

## Two views

**Month** — a grid. Each day carries its events as compact chips: the kind, the
title, the class. Today is marked. Days outside the month are dimmed but
present. A day with more events than fit says how many more.

**Agenda** — a chronological list from now forward, grouped by day, each entry
with its time, kind, title, class, and a link to the thing itself.

Agenda is the better default on a phone; month is the better default on a
laptop. Choose deliberately rather than defaulting to month everywhere.

---

## Filters

Two, and both collapse into a single control when space is tight:

- **Class** — every class, or one. Only offered when there is more than one.
- **What to show** — everything, or one kind, from the role's list above.

The screen states how many dates are in view and how many classes they span.

---

## Flow

1. Open it; see this month, or the agenda from today.
2. Optionally narrow to a class or a kind.
3. Press an event to go to the project, board or task it belongs to.

---

## Responsive

- **360px** — the month grid is genuinely hard here. Either default to agenda,
  or render a compact month where a day shows a dot per event and tapping a day
  reveals its list. Do not render seven columns of unreadable chips.
- **768px** — the month grid works; chips show a title.
- **1280px+** — full grid with week bands, several chips per day.

The grid scrolls inside itself if it must; the page does not scroll sideways.

---

## States

- **Loading** — the grid's shape, empty.
- **Empty** — no dates yet: a student's classes have set nothing, or a
  professor has set no deadlines. Say which.
- **No term dates** — the week bands cannot be drawn. Say so rather than
  silently omitting them; for a professor, link to where the dates are set.
- **Filtered to nothing** — "no dates match", with a way to clear.
- **Full** — a week with five deadlines on one day.

---

## Keep

- The four event kinds and the per-role split.
- The syllabus week bands, and saying so when term dates are missing.
- Both views, and both filters.
- Every event linking to its source.

## Do not carry over

- The navy hero block.
- The current view switch and its button styling.
