# 22 — Your data, and the privacy queue

Read `00-BRIEF.md` and `01-FOUNDATIONS.md` first.

Routes: `/redesign/privacy/request` (everybody), `/redesign/professor/privacy` (the handler)

---

## Why this exists

Collabify holds education records, which the Philippine Data Privacy Act treats
as **sensitive** personal information. Every right the privacy policy promises
is exercised **by request**, and these two screens are that process. The policy
commits to acknowledging within **five working days** and answering within
**fifteen**.

The design consequence: this is not a settings sub-page. It is a promise with a
clock on it, and both screens should look like something with consequences.

---

## Screen 1 — Your data

Reached by anybody signed in, from the Account group in the navigation.

### Making a request

A form with **six kinds**, each with its own explanation, and the explanations
are honest about limits:

| Kind | What it says |
|---|---|
| **A copy of what is held about me** | Everything Collabify holds about you, sent as a file. The reason somebody gave when asking for one of your tasks to be reassigned is not included — it is also about them. |
| **My information in a portable format** | What you have given, as a structured file you can open elsewhere. |
| **Something corrected** | Your name and photo you can change in Settings. Use this for your email address, your role, or something somebody else wrote about you. |
| **My information erased or its use suspended** | Your profile, messages, comments, work log, files and photo. Entries in the administrative log are kept. |
| **To object to how something is used** | Including the measurements a professor sees about your share of a board's work. |
| **To withdraw my consent** | Withdrawal stops future processing that rests on consent. It is not the same as erasure. |

Plus a free-text detail field.

### Your requests

Each with its kind, status (open, acknowledged, completed, refused), what you
wrote, the answer if there is one, when you asked — and **the clock**:
*"Answer due in 12 days"*, or *"4 days overdue"*. Showing the clock to the
person who is owed the answer is the point.

### Who sees this

A panel naming the supervising professor who receives requests, the college's
Data Protection Officer as the escalation, and the National Privacy Commission
beyond that — with the plain statement that you do not need the college's
permission to go there. Do not bury this.

### What you agreed to

Each legal document, the **exact version** you agreed to, and the day. Marked
withdrawn where it has been.

---

## Screen 2 — The privacy queue

For the professor who handles requests, and for administrators.

**Its whole job is the clock.** Three figures: waiting on you, past their date,
answered. Requests sort **most overdue first**, and an overdue one says so
loudly. A banner when anything is past its date states the real consequence: a
student can take an unanswered request to the National Privacy Commission.

Each request: who asked, their email, the kind, what they wrote, when, and
whether acknowledgement or completion is the next deadline.

**Per-kind steps** are shown with the request — the actual checklist for that
kind, including the command to run for an export and the warning that some
tables are append-only. This screen records what was done; it does not do it.

**Recording an answer**: acknowledged, completed, or refused — and a refusal
**requires a written ground**, because the person has the right to know why and
to challenge it.

---

## Responsive

- **360px** — the kind picker is a list of six with their explanations
  readable, not a select that hides them. The clock stays visible on every
  request card.
- **768px** — form and list side by side.
- **1280px+** — form, list and the contacts panel in three regions.

---

## States

- **Loading** — skeletons.
- **Empty, your requests** — *"You have not asked for anything. Requests you
  make appear here with the date they are due to be answered."*
- **Empty queue** — nothing outstanding, and that is good news.
- **No consent record** — somebody who registered before the documents existed;
  say so plainly.
- **Overdue** — the loudest state either screen has.

---

## Keep

- Six kinds with their honest explanations, including what access **excludes**.
- The clock on both screens, and sorting by most overdue.
- The escalation path named in full.
- The exact version and date of each consent.
- A refusal requiring a ground.
- The queue recording decisions rather than performing them.

## Do not carry over

- The navy hero block.
- The three-panel card layout as it stands.
