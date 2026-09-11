# 18 — Syllabi and Curriculum (professor)

Read `00-BRIEF.md` and `01-FOUNDATIONS.md` first.

Routes: `/redesign/professor/syllabi`, `/redesign/professor/curriculum`
One screen, two kinds. They differ only in wording and in what happens next.

---

## What it is for

A professor's shelf of course documents, and the place a class gets its
syllabus attached.

| Kind | What it is | Why it matters |
|---|---|---|
| **Syllabus** | *"Course outlines you can attach to a class, so students always open the version you meant."* | A syllabus can be **read into a week map** — the thing the whole product measures against |
| **Curriculum** | *"Program curricula for the BSIT track. Attach one to a class so its place in the program is clear."* | Reference only |

Only a **syllabus** gets parsed into weeks. That asymmetry is the most
important thing on the screen and the current design barely shows it.

---

## Two shelves in one place

- **Your files** — uploaded by this professor.
- **Program files** — published by the program office, readable by every
  professor, not editable by them.

Both appear here. A professor must be able to tell instantly which is which,
because they can attach either but can only delete one.

---

## A file row

- Title — e.g. *"Database Management — 1st sem 2025–2026"*.
- Original file name, size, upload date.
- Whether it is **program-wide**.
- **Syllabus only:** its parse state, which is the row's most useful fact:

| State | Meaning |
|---|---|
| Not read yet | uploaded, never parsed |
| Reading… | in progress |
| **Draft — needs your check** | the AI read it; nobody has verified it |
| Verified | a person checked it |
| Couldn't be read | it failed, and the reason is available |

Actions: open, download, replace, delete. Deleting one attached to a class
leaves the class without a week map — say so before it happens.

---

## Uploading

Drop or browse. **PDF, DOC or DOCX only, up to 20 MB** — that is enforced by
the storage layer, not only by the file picker, so the limits are real and the
form should state them rather than letting somebody discover them.

A title is asked for separately from the file name, because the file name is
usually `syllabus_final_v3.pdf` and the title is what everybody else will read.

---

## Responsive

- **360px** — rows become cards; the parse state stays visible because it is
  the reason somebody came. The upload control stays reachable without
  scrolling past the whole list.
- **768px** — a proper row layout.
- **1280px+** — a table: title, kind, state, size, date, actions. Aligned
  columns; mono for size and date.

---

## States

- **Loading** — row skeletons.
- **Empty, syllabi** — *"No syllabi yet. Upload a course outline and it becomes
  selectable when you create or edit a class."*
- **Empty, curriculum** — the same shape, its own words.
- **Empty program shelf** — nothing published by the office yet.
- **Upload failed** — the reason: too large, wrong type, or the network.

---

## Keep

- Two shelves — the professor's and the program's — visibly distinct.
- The five parse states, only on syllabi.
- The real upload limits stated up front.
- A separate title from the file name.
- Warning when deleting a file a class depends on.

## Do not carry over

- The navy hero block.
- The two shelves rendered as two identical sections with different headings.
