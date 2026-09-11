# 03 — Student dashboard

Read `00-BRIEF.md` and `01-FOUNDATIONS.md` first.

Route: `/redesign/student`
Who: a student, on every sign-in. The most-opened screen they have.

---

## What it is for

It answers one question: **what is on me right now, and is anything late.**

Everything else on the page is context for that answer. The design failure to
avoid is the one the current version was built to fix: eight equal sections
stacked in a column, where the numbers, the announcements, the term and the
work all shouted at the same volume, and the largest thing on the page was a
greeting telling a student their own name.

---

## The two passes

The page should read in two passes, and the layout must make that order
survive the fold down to a phone.

**Pass one — what is on me.** A single sentence of the true state, then the
figures, then the work itself in the order a student needs it: what is due,
what they hold, what it belongs to.

**Pass two — what is going on around me.** Anything waiting, what the classes
are saying, how they are doing, where the term has got to. This is context, not
a to-do, and should read as secondary.

---

## Contents

### The state sentence

Computed, and it changes meaning:

- Something overdue → `"3 deadlines have already passed."` and, if there are
  also upcoming ones, `" Another 2 are due this week."`
- Nothing overdue but some due → `"2 deadlines this week, and nothing overdue."`
- Nothing due but work in hand → `"4 tasks in hand, and nothing due this week."`
- Nothing at all → `"Nothing is waiting on you right now."`

When something is overdue the whole block is **urgent** and should look it.
That is the one place amber earns its place on this screen.

A greeting ("Good morning, Lemmuel") exists and may stay, but it is the
smallest thing in the block, not the largest.

### Four figures, each a link

| Figure | Value | Goes to |
|---|---|---|
| Tasks to finish | unfinished tasks the student holds | My tasks |
| Deadlines passed | overdue count — **warns when above zero** | My tasks |
| Projects open | live projects, excluding archived and unreleased | Projects |
| Classes | classes joined | Classes |

### Program notices

A strip of notices from the program office, when there are any. Dismissible.
Above the working content because it is occasionally important and always
brief.

### Due this week

Deadlines across every class, soonest first, each showing what is due, which
project and class it belongs to, and how long is left — with **overdue read
differently from due-soon**. Links to the project. "See all" goes to My tasks.

### Waiting on you

Three specific things, only when present:

- **Unclaimed tasks** on a board the student is on — work nobody has taken
- **Unread messages**
- **Open group sets** — a group the student could still join

These are prompts to act, each linking to where the act happens.

### Your unfinished tasks

A digest of tasks the student holds and has not finished, with status and due
date. Links to My tasks.

### Announcements

Recent announcements across the student's classes: title, a preview of the
body, which class, when, and who posted it. Swipeable or paged — there can be
several. Links into the class.

### Projects you are on

Each project with its class, its deadline, and **how far this student's own
board has moved** — the done/total and a proportion. Links to the project.

### Where you stand

Per class: the student's share of the work their group holds, and how much of
it they have finished. This is **not a grade** and must never look like one.
The product holds no grades at all; if this reads as a mark, it is wrong.

### Where the term is

The current syllabus week per class: week number, its title, its dates. If a
class's term dates are unset it says so rather than showing nothing.

---

## Responsive

- **360px** — one column. The order above *is* the scroll order; priority must
  not depend on a side column existing.
- **768px** — two columns may begin, but the state sentence and figures stay
  full width.
- **1280px** — the two passes can genuinely sit side by side: the work in a
  wider main column, the context in a narrower one.
- **1920px+** — do not simply stretch the cards. Either the columns take more
  content per row or the whole thing settles at a comfortable maximum with
  growing gutters.

The four figures on a phone must not become four stacked full-width cards
consuming a screen and a half. Two-by-two, or a single compact row.

---

## States

- **Loading** — skeletons in the final layout's shape.
- **Empty (no classes)** — the greeting, then a single clear explanation:
  a student is not in a class yet, needs the code from their professor, and
  everything else — projects, groups, tasks — arrives with the class. One
  action: join a class.
- **Empty (in a class, nothing due)** — the page is not blank; the state
  sentence says nothing is waiting, and the context sections still have
  content.
- **Error** — inline, with a retry, and the rest of the page still renders.

---

## Keep

- The two-pass reading order and its survival on a phone.
- The four figures and their destinations.
- The state sentence's four variants, and urgency only when something is
  overdue.
- "Where you stand" never resembling a grade.

## Do not carry over

- The navy hero block with the greeting and the tile row inside it.
- The bento grid of equal-weight cells. It was an improvement on a stacked
  column, but it still gives a deadline and a term strip the same visual
  weight.
- A section header with an icon chip, a title, a count and a "see all" on every
  single block.
