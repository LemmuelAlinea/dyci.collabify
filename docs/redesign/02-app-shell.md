# 02 — The application shell

Read `00-BRIEF.md` and `01-FOUNDATIONS.md` first.

Route: wraps every `/redesign/*` screen.
Who sees it: every signed-in person. The role decides what is in the menu.

---

## What it is for

The shell answers three questions at all times: **who am I**, **where am I**,
and **what has arrived for me**. Nothing else belongs in it.

It is the single most-seen surface in the product. It is also the one the
current design gets least right — the navigation is a two-row bar 105px tall
that eats a sixth of a laptop screen on every page, and on phones it collapses
into a drawer that most people never open.

---

## What is in it

**Identity** — the Collabify wordmark, linking to the role's home.

**Primary navigation**, which differs by role. These are the exact
destinations; do not invent, rename, or drop any.

Student:

| Group | Items |
|---|---|
| Workspace | Dashboard · Classes · Groups · Projects |
| Day to day | My tasks · Calendar · Messages *(carries an unread count)* |
| Your record | Reports |
| Account | Settings · Your data |

Professor:

| Group | Items |
|---|---|
| Teaching | Dashboard · Classes · Groups · Projects |
| Day to day | Calendar · Reassignments · Messages *(unread count)* |
| Insights | Analytics · Reports |
| Course documents | Curriculum · Syllabi |
| Account | Settings · Your data |

The grouping is meaningful and worth preserving: the first group is the spine
— class holds groups, groups hold projects — the second is what arrives on its
own schedule, the third reads the work back, the fourth is reference material.
A professor has **twelve** destinations. That is the real design problem here.

**Notifications** — a bell with an unread count, opening a panel of recent
items. Each item has a title, a one-line preview, a relative time, and a read /
unread state. There is a "mark all read" action. Types that appear: an
announcement, a group placement, a group closing, a project release, a task
assignment, a reassignment request or decision, a result recorded, a deadline
approaching, a comment, a weekly digest, a term shift.

**Messages** — a direct link with its own unread count, separate from the bell.

**Theme toggle** — light / dark / follow the system.

**Account menu** — avatar, full name, role; links to Settings and Sign out.

**Offline bar** — a strip that appears when the connection drops and disappears
when it returns. Do not remove it; it prevents a person blaming themselves for
a failed save.

**Skip link** — first in the tab order, jumps to the main content.

---

## Flow

1. A person signs in and lands on their role's dashboard.
2. They move between destinations. **The current page must be unmistakable**
   in the navigation — this is a product where somebody is deep in a task on
   week nine and needs to know where they are without reading.
3. The bell count rises as things arrive; opening the panel and reading an item
   clears it.
4. On a phone the navigation collapses. Whatever you choose must keep the
   spine — Dashboard, Classes, Groups, Projects — reachable in **one** press.

---

## Responsive

- **360px** — identity, one nav affordance, bell, avatar. Nothing else. The
  main content gets the rest of the screen.
- **768px** — the spine may be visible inline; the remaining groups collapse.
- **1280px** — full navigation, whichever arrangement you chose.
- **1920px+** — the content area must not become a narrow column centred in
  grey. Gutters grow with the screen; individual pieces that have a natural
  maximum enforce it themselves.

A real constraint from the live product worth carrying: **do not cap the main
content at a fixed width**. Tables were scrolling inside a narrow column while
a third of a wide monitor sat empty.

---

## Decision you have to make

A twelve-destination product with a two-row top bar is the current design's
central mistake. You are not obliged to repeat its structure. A persistent side
rail, a collapsible rail, or a single slim bar with grouped menus are all
legitimate — pick one deliberately and justify it in `src/redesign/README.md`.

Whatever you pick must satisfy: the spine is one press from anywhere, the
current location is obvious, a professor's twelve items do not require a
scroll, and vertical space on a laptop is not squandered.

---

## States

- **Loading** — the shell renders immediately with the identity and the nav
  skeleton; only the counts and the avatar are pending.
- **Empty** — a professor with no classes still sees the whole navigation.
  Destinations do not disappear because they are empty; the page inside
  explains.
- **Error** — a failed count is simply absent, never a zero and never a broken
  badge.
- **Offline** — the bar appears; nothing else changes position.

---

## Keep

- Every destination, its grouping, and its label.
- Separate unread counts for the bell and for Messages.
- The offline bar and the skip link.
- The theme toggle's three options.

## Do not carry over

- The 105px two-row bar.
- The near-black `#050718` bar with the blueprint texture. That is the landing
  page's ground wearing a different hat; decide the shell's surface on its own
  terms.
- The drawer as the only mobile navigation.
