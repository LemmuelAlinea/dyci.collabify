# 13 — My tasks (student)

Read `00-BRIEF.md`, `01-FOUNDATIONS.md` and `11-task-workspace.md` first.

Route: `/redesign/student/tasks`
Who: a student. Reached from the dashboard's figures and the navigation.

---

## What it is for

Everything the student has taken on, **across every project and every class**,
in one list ordered by what needs them first. The project board answers "how is
this piece of work going"; this page answers "what do I do next", and it is the
page a student opens when they have twenty minutes and want to use them well.

---

## The spine: six buckets by urgency

Tasks are grouped by deadline, and the grouping is the page's whole structure.
Each bucket has a name and a sentence, and both matter:

| Bucket | Sentence |
|---|---|
| **Past due** | These were expected already. |
| **Due today** | Finish these before the day is out. |
| **This week** | Due in the next seven days. |
| **Later** | Further out than a week. |
| **No deadline** | Nobody put a date on these. |
| **Finished** | Done, and counting toward your grade. |

Empty buckets do not appear at all. A **jump-to** row links to the buckets that
do exist, each with its count — on a long list this is the difference between a
usable page and a scroll.

The urgency runs from alarming to calm and the visual treatment should follow
it. Past due is the only one that should feel loud.

---

## Four figures

| Figure | Value |
|---|---|
| Still open | unfinished tasks |
| Past due | overdue — the number that matters |
| Finished | completed |
| Time logged | total minutes from every work log, formatted as hours |

"Time logged" is the only place in the product where a student sees their
effort totalled. It is not a grade and must not read as one.

---

## A row

Per task: title, the project and class it belongs to, its group, its **share**
(what it is worth as a percentage of that project), the deadline, and its
status.

Each row has an inline action that advances the task, labelled for where it is:

- To do → **Start**
- In progress → **Mark done**
- Done → **Reopen**

Opening a row opens the full task detail (`12-task-detail.md`).

---

## Responsive

- **360px** — bucket headings sticky as you scroll past them, so the urgency
  context never leaves. Rows become two-line cards; the inline action stays a
  44px target. The jump-to row scrolls horizontally rather than wrapping to
  four lines.
- **768px** — rows gain a column.
- **1280px+** — a proper table with aligned columns; deadline and share
  right-aligned in mono so they compare down the column.

The four figures must not take a phone screen to themselves.

---

## States

- **Loading** — bucket skeletons.
- **Empty** — *"Nothing claimed yet. Open a project, find your group's board,
  and take a task. Work nobody has claimed is waiting on somebody."* That last
  sentence is doing real work — it tells a student their inaction has a cost
  for other people. Keep its spirit.
- **All finished** — only the Finished bucket; make this feel like completion,
  not like an error.
- **Error** — inline with retry.
- **Full** — sixty tasks across four projects.

---

## Keep

- The six buckets, their order, their names and their sentences.
- Empty buckets disappearing, and the jump-to row.
- The share percentage on every row.
- The three-way inline action and its labels.
- "Time logged" as the fourth figure.

## Do not carry over

- The navy hero and its tile row.
- Each bucket being a bordered card with a sunken header strip and a pill
  count.
