# 21 — Settings (both roles)

Read `00-BRIEF.md` and `01-FOUNDATIONS.md` first.

Route: `/redesign/settings`
Who: everybody. Identical for students and professors.

---

## What it is for

The small set of things a person controls about their own account. Four
sections, reachable from a side index.

---

## Profile

*"How your name appears to your group and advisers."*

- **Avatar** — upload a photo. **PNG or JPG only, under 2 MB.** Enforced by the
  storage layer, not just the file picker, and validated by the file's real
  type rather than its extension. Replacing a photo deletes the previous one.
- **First, middle, last name** — editable.
- **Email** — shown, **not editable**. Changing it is a request to an
  administrator.
- **Role** — shown, not editable. Nobody can change their own role or account
  status; the database refuses it, not just the screen.

One honest disclosure belongs near the avatar: profile photos are stored in a
**public** location. Anybody with the link can open one, signed in or not, and
the link does not expire. The privacy policy already says this; the settings
page is where it is actually useful.

---

## Appearance

Three choices, not two:

| | |
|---|---|
| **Light** | Always bright |
| **Dark** | Always dim |
| **System** | Follow device |

Show them as a real choice with a preview, not a single toggle — "system" is
the default and a two-state switch cannot express it.

---

## Notifications

Six switches, each with a sentence saying exactly what it does. The sentences
are precise on purpose — they describe what the system actually does now, not
what the label sounds like:

| Switch | What it does |
|---|---|
| **Task assignments** | When a task on one of your boards is given to you. |
| **Deadline reminders** | One nudge the day before a task you hold is due. Never twice for the same task. |
| **Comments** | When somebody writes on a task you hold, or one you have written on yourself. |
| **Groups and new projects** | When you are placed in a group, when a group is made final, and when a project opens to you. |
| **Weekly progress digest** | Monday morning: what you finished last week, what is due next, and anything past its date. |
| **Announcements** | Notices from your class, and from the program office to everybody. |

**Say what these cannot turn off.** Some notifications arrive regardless: a
reassignment request a professor has to answer, the answer to a request you
raised yourself, the verdict on work your group handed in, a deadline that
moved. The rule is that anything you must act on, or asked for, is not
swallowed by a preference — and a settings page that implies otherwise is
lying. One line is enough.

---

## Security

- **Change password** — current, new, confirm. Minimum eight characters.
- **Sign out.**
- A link to **your data** — the privacy request page (`22-privacy.md`).

---

## Two figures

Current theme, and how many notifications are switched on.

---

## Responsive

- **360px** — the side index becomes a top row of anchors, or is dropped in
  favour of a plain scroll. Switches are full-width rows with the label and
  sentence stacked, the control right-aligned and a 44px target.
- **768px** — side index appears.
- **1280px+** — index beside the content; the content measure stays capped.

---

## States

- **Loading** — the form with values pending, not a blank page.
- **Saving** — per field, inline, with a confirmation that fades.
- **Save failed** — inline on the field, with the value preserved.
- **Avatar rejected** — the reason: wrong type, or too large.
- **Password rejected** — too short, wrong current password, or reused.

---

## Keep

- Four sections and their order.
- Email and role visible but not editable, and why.
- Three appearance options.
- The six notification sentences, verbatim in meaning.
- The disclosure about which notifications cannot be turned off.
- PNG/JPG under 2 MB, checked by type.

## Do not carry over

- The navy hero and its two stat tiles.
- The icon-chip section headers.
