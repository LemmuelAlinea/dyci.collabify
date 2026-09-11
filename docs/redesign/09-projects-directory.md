# 09 — Projects directory (both roles)

Read `00-BRIEF.md` and `01-FOUNDATIONS.md` first.

Routes: `/redesign/student/projects`, `/redesign/professor/projects`
Also embedded as the **Projects tab** inside a class. Design it once.

---

## What a project is

A piece of assessed work a professor sets against **syllabus weeks**. It is the
centre of the product: a project produces **boards**, a board holds **tasks**,
and a student's whole term is the sum of them.

Every project has:

- **Title** and **type** — project, activity, laboratory, quiz, exam, or
  *other*, which requires a custom label.
- **Who does it** — per **group** (bound to a group set) or per **student**.
- **A week span** — `start_week..end_week` in the class's syllabus. A project
  cannot be bound to weeks the class's syllabus does not have.
- **Guidelines** — the brief.
- **Total points** — the weight of the whole thing. **Not a grade**; the
  product records no grades.
- **A deadline**, optional.
- **A release time**, optional — until it arrives, students cannot see it.
- **A rubric** — criteria, each with a label, a description and points.
- **Attachments.**

### The four states, which the design must distinguish

| State | Meaning |
|---|---|
| **Open** | live and accepting work |
| **Scheduled** | released later; students cannot see it yet |
| **Closed** | shut by the professor — **not** the same as past its deadline |
| **Archived** | put away |

That third distinction is important and currently carried by one word. A
project past its deadline is still open unless somebody closed it.

### A series

One project can be set for several sections at once. They share a title and
brief but **each has its own board and its own deadline**. Where a project is
part of a series the screen says so and names the other sections, and every
bulk action asks whether it applies to this one or to all of them.

---

## Professor view

Grouped by class. Each card: title, type, who does it, the week span, the
deadline, the status, and progress across its boards — how many groups started,
how far the average has got, how many handed in.

**Creating a project** is a wizard, and the order matters because each step
constrains the next:

1. **Class** — everything downstream depends on it.
2. **Weeks** — picked from that class's syllabus. The picker shows each week's
   title and dates and warns when a chosen week has already passed. A class
   with no syllabus cannot get past here, and the screen should say why rather
   than showing an empty list.
3. **Name, type** — and a custom label when the type is *other*.
4. **Who does it** — per group (then which group set) or per student.
5. **Guidelines.**
6. **Points and rubric** — criteria with labels, descriptions and points.
7. **Deadline**, and optionally a **release time**.
8. **Other sections** — fan the same project out to more of the professor's
   sections, creating a series.

There is also an **AI draft**: the professor supplies a brief or a rubric and
gets a first list of tasks. Everything it returns is a draft, editable before
it is used. Mark it as a draft plainly — it is a starting point, not an answer.

## Student view

Every project across their classes. Each card: title, class, type, deadline,
status, and **how far their own board has moved**. Scheduled projects do not
appear at all until they are released.

---

## Responsive

- **360px** — one card per row. The deadline drops its time-of-day: *"Due in
  3 days · Aug 27, 4:17 PM"* wraps to three lines in a narrow card, which is
  more than a deadline deserves. Show the long form from tablet up.
- **768px** — two per row.
- **1280px+** — three or more, grouped under class headings.

The wizard is the hardest responsive problem on this screen: eight steps, a
week picker and a rubric editor. On a phone it should be a full-height flow
with one step visible and clear progress, never a cramped dialog.

---

## States

- **Loading** — card skeletons grouped by class.
- **Empty, professor** — no projects; set one against the syllabus weeks. If
  the class has **no syllabus**, say that instead — it is the actual blocker.
- **Empty, student** — nothing set yet; when a professor releases something it
  appears here.
- **Archived view** — empty until something is archived.
- **Full** — several classes, a dozen projects, some in series.

---

## Keep

- The four states, and closed ≠ past deadline.
- Week binding, and a project being impossible without a syllabus.
- Series projects sharing a brief but not a board or a deadline, and every
  bulk action asking about scope.
- Scheduled projects being genuinely invisible to students.
- Points never reading as a grade.
- The short deadline on narrow cards.

## Do not carry over

- The navy hero block.
- The current status pills' styling.
- The wizard's current step chrome.
