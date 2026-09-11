# 16 — Analytics (professor)

Read `00-BRIEF.md` and `01-FOUNDATIONS.md` first.

Route: `/redesign/professor/analytics`
Who: professors only.

---

## What it is for

Moving from *what happened* to *why*, *what is coming*, and *what to do next*.
It is the most information-dense screen in the product and the one where a
generic dashboard aesthetic will do the most damage.

The governing principle, and it is unusual enough to state plainly:

> **Everything here is counted or arithmetic, and the arithmetic is shown.**
> No model, no score, no confidence percentage. One class and a handful of
> finished tasks would train something confident and wrong. A professor asked
> to act on a number is owed the sum behind it.

Your design must not add the visual language of machine learning — no
"insights" badges, no sparkline-with-a-percentage-and-an-arrow, no AI framing.
The credibility of this screen is that it never guesses.

---

## The filter chain

Above everything: **class → project → group → student → task**, each choice
narrowing the next.

It cascades rather than being five independent dropdowns, because most free
combinations are nonsense — a student who is not in the chosen group, a task
that is not in the chosen project. Choosing higher up **clears everything
below it**, so the chain can never be left in an impossible state.

This control is the spine of the screen. Design it as a first-class element,
not as a filter bar bolted to the top.

---

## Four bands, in this order

### 1. Descriptive — *"Where the work stands"*

What has happened. Counted, never estimated.

Tiles: tasks done out of total, boards, handed in, accepted, returned, handed
in late. Plus per-class health.

### 2. Diagnostic — *"Why it is behind"*

Causes **with evidence behind them**, and nothing else. Unclaimed tasks. A
board nobody has opened. Work held by somebody who left. One member holding
half of it.

Boards with nothing wrong are **not listed at all** — a card saying "no
problems" is noise on a page whose whole job is exceptions.

A second part shows participation: per member, their share held and finished,
so the "one person carrying the group" case is visible rather than inferred.

The database does not know whether a group has fallen out, and a page that
guessed at that would be worse than one that stays quiet. Do not design a
placeholder for a cause the product cannot know.

### 3. Predictive — *"Will the work land"*

Arithmetic, and the arithmetic is printed: work finished per day since a board
started, extended across what is left, against the days remaining.

Per board: where it lands at its current rate. **Boards nobody has started are
counted apart** — a board at nought a day is not slow, it is not begun, and
mixing them makes the whole projection meaningless.

Plus a pressure view: where deadlines cluster across the term.

### 4. Prescriptive — *"What to do now"*

The payoff. Recommendations, worst first, **six at a time** — a list of thirty
is a list nobody finishes.

Each carries the evidence that produced it and **links to the place that
already performs the fix**. It advises and points; it never acts. An
irreversible act belongs where the professor can see what they are doing, not
one click from a chart.

### The leaf

When the chain is narrowed to a group, student or task, a task list appears
beneath: title, whose board, project, assignees, status, late flag, due date.
Opening one opens the task detail.

It appears **only** when the question is narrow. A list of every task in every
class is not an answer to anything.

---

## Responsive

- **360px** — the filter chain becomes a stacked sequence or a single
  progressive control; it must not become five full-width selects filling a
  screen. Charts become ranked lists with numbers — a 40px-wide bar chart is
  decoration, and this screen has no room for decoration.
- **768px** — two tiles per row, charts legible.
- **1280px** — bands at full width, charts at a readable size.
- **1920px+** — more per row. The pressure chart benefits from real width.

Every chart scrolls inside itself rather than compressing to illegibility.

---

## States

- **Loading** — band skeletons.
- **Empty** — *"Nothing to measure yet."* This is the common first-term state
  and it should explain what makes measurement possible: a class with a
  syllabus, term dates, and a project with a board.
- **A band with nothing in it** — Diagnostic and Prescriptive are *supposed*
  to be empty when things are going well. Make that read as good news, not as
  a failure to load.
- **Narrowed to nothing** — the chain excludes everything; offer a way back up.

---

## Keep

- Four bands, this order, these titles.
- Counted-or-arithmetic only, with the arithmetic shown.
- Empty bands meaning "nothing wrong", and boards with no problem not being
  listed.
- Unstarted boards counted apart from slow ones.
- Six recommendations, each with evidence and a link, never an action.
- The cascade clearing everything below.

## Do not carry over

- The navy hero block.
- The current band header treatment.
- Any impulse to make this look like a BI dashboard.
