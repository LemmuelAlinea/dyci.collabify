# 17 — Reports (both roles)

Read `00-BRIEF.md` and `01-FOUNDATIONS.md` first.

Routes: `/redesign/professor/reports`, `/redesign/student/reports`

---

## What it is for

**The half of the product that leaves it.**

Analytics is read on screen by the person who owns the class. A report is
**printed and handed to somebody else** — a chair, a course file, a student's
own record. That difference drives every decision here:

- It prints on **letterhead** — the college and the program.
- It carries **the date it was made**.
- Its footer says, in words, that **it is not a grade record**.
- Unlike every analytics view, reports **keep archived classes and projects**.
  A report is asked for after the term ends, which is exactly when analytics
  stops answering.

This means you are designing **two layouts for one screen**: the picker, and
the printed sheet. The printed sheet is the deliverable and the screen is only
how you get to it. Design the paper first.

---

## Professor: the catalogue

Seven reports in three groups. The grouping is by **who receives it**, which is
more useful than grouping by what is in it.

**For the chair**

| Report | What it is |
|---|---|
| Class term report | One class on one page: enrolment, what was run, how much finished, what was late. |
| Term summary *(CSV)* | Every class you teach in one table, with the totals underneath. |

**For grading**

| Report | What it is |
|---|---|
| Student contribution | One student: what they held on each board, what they finished, and their share. |
| Class record *(CSV)* | Every student against every project. The sheet you take into your own record. |
| Project comparison *(CSV)* | One project, every group side by side. How the class did on that piece of work. |
| Group project report | One group: members, every task with who held it, what was handed in, your answer. |

**For the course file**

| Report | What it is |
|---|---|
| Syllabus coverage | Week by week: what the syllabus asked for and what was set against it. |

Four of them also export as **CSV**; mark which, because it changes what
somebody picks.

## Student: two reports

- **My work** — their contribution across a class.
- **My group's project** — one group board: members, tasks, what was handed in.

Framed as *"Create a printable record of your contribution or your group's
project work without turning effort into a grade."* That framing is the point.

Only **group** boards are offered for the second: a solo board has no split to
report and no groupmates.

---

## The flow

1. Pick a report.
2. Set its scope — which class, which project, which student, which group.
   Each report needs different things, and the form should ask for **only**
   what this one needs.
3. The sheet renders on screen, exactly as it will print.
4. **Print**, or export CSV where offered.

Until the scope is set, the sheet area says what is still needed — *"Choose
what the report is about"* — rather than showing a broken preview.

---

## The printed sheet

This is the real design work. Requirements:

- **Letterhead**: the college, the program, the report's name.
- **Generated on [date and time]**, and by whom.
- The scope stated in full — a sheet read six months later must say which
  class, which term, which section, without anybody remembering.
- Tables that survive a page break: headers repeat, rows do not split.
- **Black on white.** No screen colours, no dark-mode inversion, no card
  shadows. Status must survive greyscale — use a word or a shape, never a hue
  alone.
- A footer stating it is not a grade record.
- Margins that suit A4.

Use real print CSS. Hide the navigation, the picker and every control at print
time — the current implementation marks those `print:hidden` and that idea is
correct.

---

## Responsive

- **360px** — the picker is a list; the preview is genuinely hard to show.
  Either scale the sheet to fit the width with a "this is how it prints" note,
  or offer the print action without a full preview. Do not render an A4 sheet
  at 360px and call it a preview.
- **768px** — picker above, sheet below.
- **1280px+** — picker beside the sheet, sheet at its true proportions.

---

## States

- **Loading** — *"Gathering your work…"* for a student.
- **Empty, professor** — no classes to report on.
- **Empty, student** — nothing to report yet; work has to exist first.
- **Empty, student group report** — no group work yet.
- **Scope incomplete** — say what is still needed.
- **No data in scope** — the report renders with its headings and says it is
  empty. An empty term report is itself a finding and should print.

---

## Keep

- Three groups by audience, seven reports, their names and descriptions.
- Which four export CSV.
- Archived classes and projects being included.
- Letterhead, generation date, and the not-a-grade footer.
- The student framing: a record of contribution, not a mark.

## Do not carry over

- The navy hero above the picker.
- The current picker chrome.
