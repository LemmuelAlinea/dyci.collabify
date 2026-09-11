# 19 — Syllabus detail and the week editor (professor)

Read `00-BRIEF.md`, `01-FOUNDATIONS.md` and `18-course-documents.md` first.

Route: `/redesign/professor/syllabi/:resourceId`

---

## What it is for

Turning an uploaded document into the **week map** — the structure every
project in the product is bound to, and the thing analytics measures a class
against. Nothing downstream works until this is right, which makes this small
page unusually important.

---

## The header

The syllabus's title and its file, and its **parse state**, which drives what
the page offers:

| State | What the page says and offers |
|---|---|
| Not read yet | it has not been read; offer to read it with AI |
| Reading… | in progress |
| **Draft — needs your check** | the AI produced this; **nothing here is verified**; check it and mark it verified |
| Verified | a person has checked it |
| Couldn't be read | it failed, with the reason, and the weeks can be added by hand |

The draft state is the one that matters most. A professor must not be able to
mistake an unchecked AI reading for a confirmed one, because a wrong week map
silently corrupts every project bound to it.

**Read with AI** parses the document into weeks. On a syllabus that already has
weeks it asks first: *"This replaces all 18 weeks with a fresh draft. Anything
you have corrected by hand will be lost."* That warning is required.

A privacy note worth surfacing somewhere honest: the file is sent to an
external AI service in full, and a syllabus usually carries the professor's own
name, department and office hours.

---

## The week list

Weeks in order. Each is **edited inline** — no dialog, no save button.
Autosaves on blur, shows a spinner while saving, and reverts on failure.

Per week:

| Field | What it is |
|---|---|
| **Week number** | its position — not editable |
| **Title** | e.g. *"Building a DES in SimPy"* |
| **Topics** | what is covered |
| **Outcomes** | what a student should be able to do |
| **Assessments** | what the week expects handed in — e.g. *"Lab 6; Project Milestone 4"* |

**Assessments is the field with consequences.** It is what a project binds to,
and it drives the analytics gap list — *the syllabus says Lab 6 happens in week
11; nothing does*. It should not look like the fourth of four equal textareas.

Weeks can be **added** (the next number) and **deleted**. Deleting says what it
costs: any class using this syllabus loses that week from its map.

The document itself should be openable beside the weeks — checking a parse
against the source is the main activity on this page, and making somebody
download the PDF to do it is the current design's biggest miss here.

---

## Responsive

- **360px** — one week per card, fields stacked, autosave state visible per
  field. Eighteen weeks is a long scroll: give it a week index or sticky week
  numbers.
- **768px** — title on its own line, the three long fields stacked.
- **1280px+** — the real opportunity: the source document on one side, the
  weeks on the other. This is the layout the task actually wants.

---

## States

- **Loading** — header, then weeks.
- **Never parsed** — read it with AI, or add weeks by hand.
- **Parsing** — in progress, with the list disabled rather than empty.
- **Failed** — the reason, and the manual path still open.
- **No weeks** — the file is there but nothing was extracted.
- **Saving / save failed** — per field, not per page.

---

## Keep

- The five parse states and the draft's unmistakable meaning.
- The re-parse warning naming the week count and the loss of hand corrections.
- Inline autosaving edits with per-field state.
- Assessments carrying more weight than the other fields.
- Delete saying what a class loses.

## Do not carry over

- The current alert-strip-above-a-plain-list layout.
- Four identical textareas per week.
