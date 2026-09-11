# 05 — Classes directory (both roles)

Read `00-BRIEF.md` and `01-FOUNDATIONS.md` first.

Routes: `/redesign/student/classes`, `/redesign/professor/classes`
One screen, two audiences. The differences are listed at the end.

---

## What it is for

A class is the root object of the whole product. Everything else hangs off it:
groups belong to a class, projects belong to a class, a syllabus is attached to
a class, and every message thread traces back to one. This screen is where a
person picks which one they are working in.

It is a **directory**, not a dashboard. It should be fast to scan and dull in
the best sense: the design's job is to get somebody into the right class in one
glance, not to decorate.

---

## What a class card carries

Every one of these is load-bearing — none is decoration:

- **Initial** — a short code like `QM`, used as the class's visual handle
  everywhere in the product. It is how a person recognises a class in a list.
- **Name** — e.g. "Quantitative Methods (Modelling and Simulation)". These are
  long. Design for two lines, not for truncation.
- **Section, semester, school year** — `BSIT-4A · 1st sem · 2026–2027`.
- **Student count.**
- **State** — running, ready for the term, needs setup, or archived.
- **Class code** — e.g. `DBM-1589`, the code a student types to join.
  Professor only, and it must be **copyable in one action**.
- For a professor: whether **joining is open**.

---

## Layout

A page title and a sentence saying what the screen is for; a primary action; a
count or two of the whole set; then the directory itself under a heading that
names the current view.

Cards in a responsive grid. One per class. A class with nothing set up should
say so on the card — that is an action, not a defect to hide.

---

## Flows

### Student — joining a class

1. Presses **Join a class**.
2. A dialog asks for the code. It is uppercase, monospaced, and shaped like
   `DBM-7823`. That format is a genuine hint and the field should show it.
3. On success: the dialog closes, a toast confirms, and they are taken
   **straight into the class** — not back to the list.
4. Already a member: no error. Go to the class.
5. Failures each have their own sentence and must be distinguishable:
   - the code does not match anything
   - the class has closed joining
   - the class is archived
   - they were removed from this class and cannot rejoin
   - they are not a student
   - **too many codes tried in an hour** — guessing a join code is exactly
     what this limit exists for, so the message must say a wait is required,
     not that the code is wrong

### Professor — creating a class

1. Presses **Create class**.
2. A form asks for: name, initial, code, section, year level, semester, school
   year, an optional description, and optionally a **syllabus** and a
   **curriculum** to attach from their library.
3. On success the class appears in the directory.

The syllabus attachment matters: without one, the class has no week map, and
projects cannot be bound to weeks. The form should make that consequence
visible rather than treating it as one more optional field.

### Professor — active and archived

A two-way switch between **Active** and **Archived**. Archiving is how a class
ends; it is never deleted. The heading changes with the view ("This term" /
"Past classes") and so do the counts.

---

## Responsive

- **360px** — one card per row. The card must survive a two-line class name
  and a long section string without truncating either into meaninglessness.
- **768px** — two per row.
- **1280px** — three per row.
- **1920px+** — more per row, or wider cards with more on them. Not three
  cards adrift in grey.

The class code needs to stay copyable at every width, including with a thumb.

---

## States

- **Loading** — card skeletons in the grid.
- **Empty, student** — has not joined a class; needs the code from the
  professor; the code looks like `DBM-7823`. One action.
- **Empty, professor** — no classes; create one and share its code; groups,
  projects and everything else follow from it. One action.
- **Empty, archived view** — nothing archived yet, stated plainly.
- **Error** — inline with retry.

---

## Role differences

| | Student | Professor |
|---|---|---|
| Primary action | Join a class | Create class |
| Class code | not shown | shown, copyable |
| Active/archived switch | no | yes |
| Second figure | classmates across classes | students represented |
| Card links to | the student class detail | the professor class detail |

---

## Keep

- The class initial as the recognisable handle.
- The join code's format and one-press copy.
- Every distinct join failure having its own sentence, including the rate
  limit.
- Joining taking a student into the class, not back to a list.
- Archive as the end of a class; no delete.

## Do not carry over

- The navy hero with a headline split into "title" and an amber "accent
  phrase", a description, an action and two stat tiles. Every directory in the
  current app opens with this block and it is the single most repetitive thing
  in the product.
- The segmented Active/Archived control's current styling.
