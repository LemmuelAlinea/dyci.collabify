# 15 — Messages (both roles)

Read `00-BRIEF.md` and `01-FOUNDATIONS.md` first.

Routes: `/redesign/{role}/messages` and `/redesign/{role}/messages/:conversationId`

---

## What it is for

Every conversation in the product, in one place, kept next to the work rather
than in a separate app. Three kinds exist and they are **created
automatically**, not by people:

| Kind | Exists because |
|---|---|
| **Class** | every class has one, for everybody in it |
| **Group** | every group has one, for its members |
| **Direct** | one person to one person |

Class and group chats cannot be created or deleted — they arrive with the class
or the group and go when it goes. Only a **direct** conversation is started by
a person, and only a **professor** can start one.

---

## Layout

Two panes: a list of conversations, and the thread.

**The list** — searchable. Each row: an avatar or a class/group mark, the
conversation's name, a preview of the last message, when it was, and an
**unread count**. Unread rows must be obvious at a glance.

**The thread** — messages in order. Each: author avatar and name, the body, the
time, and an edited marker where it applies. Consecutive messages from one
person group together. A message that was **deleted** leaves a marker saying a
message was removed — its text is blanked and any attachment destroyed, but the
gap is honest rather than silent.

**Actions on a message** — edit, delete, pin. Pinned messages surface at the
top of the thread.

**The composer** — a text box, attach a file, and **create a poll**. Enter
sends, Shift+Enter breaks the line. Attachments show as removable chips before
sending. A message is capped at 5000 characters and the field should show that
as it approaches.

**Polls** — a question, options, and settings for whether several answers are
allowed and whether members may add options. A poll can be closed. Results show
each option's count and **the avatars of who voted for it** — poll votes are
**not anonymous**, and the design must make that unmistakable *before* somebody
votes, not after. This is the single most important honesty requirement on this
screen.

---

## Figures

Four, in a compact row: conversations, unread, class & group chats, direct
chats.

---

## Flows

**Reading** — pick a conversation, the thread loads, the unread count clears.

**Sending** — type, optionally attach, send. The message appears immediately
and arrives for everybody else without a refresh.

**Starting a direct conversation** *(professor only)* — pick a person from
their classes. If a thread already exists with that person it opens rather than
duplicating: a professor and a student share **one** thread however many
classes they have in common.

**Making a poll** — question, options, the two settings, send. It appears in
the thread as a card people vote in.

---

## Responsive

- **360px** — one pane at a time. The list is the page; opening a conversation
  replaces it, with a back control returning to the list. The composer sits
  above the keyboard and does not lose the send button.
- **768px** — list and thread side by side, list narrower.
- **1280px+** — the same, more comfortable. The thread's message measure stays
  capped; full-width lines of chat are hard to read.

The thread needs a real, bounded scroll area — the page itself must not grow
with the conversation.

---

## States

- **Loading** — the list, then the thread.
- **No conversation chosen** — *"Every class and group you're in has its own
  chat, created for you automatically."* That sentence does real work; keep its
  meaning.
- **Empty thread** — nothing said yet.
- **Empty list** — a student not yet in a class has no conversations.
- **Error** — inline in the affected pane.
- **Full** — two hundred messages, several with attachments and polls.

---

## Keep

- Three kinds, and only direct ones being created by people.
- One direct thread per pair, however many classes they share.
- A deleted message leaving a marker.
- Poll votes being visibly non-anonymous **before** voting.
- Enter to send, Shift+Enter for a newline.

## Do not carry over

- The navy hero above a two-pane box.
- The fixed-height clamped container the panes currently live in.
