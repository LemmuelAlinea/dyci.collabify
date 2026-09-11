# 20 — Reassignments (professor)

Read `00-BRIEF.md`, `01-FOUNDATIONS.md` and `12-task-detail.md` first.

Route: `/redesign/professor/reassignments`

---

## What it is for

A queue of one decision, made repeatedly.

A student cannot take work off a groupmate, and a task that has been **started**
cannot change hands at all. So when a member goes quiet, this is the **only**
way the rest of the group gets unblocked. That is why the screen exists and why
an unanswered request is worse than it looks: somebody is stuck.

---

## A request

| Field | What it is |
|---|---|
| **Task** | title, and the project and class it belongs to |
| **From** | who currently holds it |
| **Asked by** | who raised it |
| **What they want** | to **take it over**, or for it to be **released back to the group** |
| **Reason** | required, written by the requester |
| **When** | how long it has been waiting |
| **Status** | pending, approved, declined, withdrawn |

**The reason is private.** It goes to the professor and to whoever wrote it,
and never to the person the task is about — a reassignment reason is usually
written about somebody, and disclosing it would be disclosing another student's
words about them. It is also withheld from a data-access request for the same
reason. The design must not put it anywhere the subject could read it.

---

## Layout

Two sections:

**Waiting on you** — pending requests. This is the page. Each card carries
everything above and one action: decide.

**Decision history** — everything already settled, quieter, with what was
decided and when.

Two figures: waiting on you, and resolved.

---

## The decision

A dialog, and it is more considered than approve/decline:

**Who gets it** — a list of the group's members, or *"Nobody — put it back to
the group"*. The choice is **pre-filled from what was asked**, but the
professor can override it:

- They asked to take it on → they are preselected, with *"Choose somebody else
  if it suits the group better."*
- They asked for it to go back → nobody is preselected, with *"Name someone to
  hand it straight over instead."*

**A note back** — optional, and it goes to the requester.

**Three actions: Cancel, Decline, Approve.** Decline must not look like a
secondary shade of Approve; it is a real, separate answer.

---

## What happens after

- **Approved** — the task moves. The requester is told. **The people it came
  off are told that it moved, and nothing about why.** That asymmetry is
  deliberate: they learn the fact, not the reason written about them.
- **Declined** — only the requester is told.

Both notifications arrive **regardless of notification settings**, under the
product's rule that anything a person must act on, or asked for themselves,
cannot be swallowed by a preference.

---

## Responsive

- **360px** — one card per row. The reason is the tallest part and must wrap,
  never truncate — a professor deciding on half a sentence is the failure this
  page cannot afford. The decide action is a full-width target.
- **768px** — two per row, or a denser single column.
- **1280px+** — a comfortable grid for pending, a table for history.

---

## States

- **Loading** — card skeletons.
- **Empty** — *"Nothing to decide. Requests from your classes land here.
  Students can only ask about work on their own board."*
- **No history** — omit the section entirely.
- **Full** — a dozen pending across three classes.
- **Stale** — a request whose task or project has since been archived should
  still be answerable or clearly closed, not a dead card.

---

## Keep

- The two sections and the two figures.
- The reason being required, and private to the professor and its author.
- The pre-filled target with its two different hints.
- Decline as a distinct third action.
- The losing side hearing that it moved and not why.
- Both notifications bypassing preferences.

## Do not carry over

- The navy hero block.
- The two sections as identical bordered cards with sunken header strips.
