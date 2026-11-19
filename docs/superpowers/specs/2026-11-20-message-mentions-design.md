# Task and project mentions in the Inbox — design

Date: 2026-11-20. Status: approved.

## Intent

People talk about work in the Inbox but have to describe a task or paste a long link to point at it. A mention
lets the writer type `#`, pick a task or project, and send a chip that opens it in one tap. It is for easy
access: fewer "which task?" replies and less hunting through boards.

## Goals

- Type `#` in any chat composer (class, group, project, direct) to search tasks and projects, and pick one.
- The message shows a chip with the task or project name; tapping it opens it.
- Pasted task or project links from Collabify turn into the same chip.
- Work and class both: work projects and their tasks, class projects and their tasks.

## Non-goals

- Mentioning people (`@name`), files, milestones, sprints or meetings.
- Notifications for being mentioned, or for a task being mentioned.
- Rich previews (status, due date, assignee) on the chip. The name and an icon only.

## Anti-goals

- A task or project name reaching someone who could not open it.
- Mentions that only work for some people: a reader without access must still see that something was
  mentioned, as a locked chip.

## Decided with the user

- **How:** type `#` to search; pasted Collabify task and project links also become chips.
- **What the writer can mention:** only what they can reach as a participant: projects they are on (work:
  `general_members`; class: a class project of a class they are in or teach) and tasks inside those projects
  that they can read. A project they can only view (Workspace visibility, a space PM's read) is not offered.
- **A reader who cannot open it:** sees a locked chip with no name ("Task you can't open", "Project you can't
  open"). Before sending, the writer sees a note when someone in the chat can't open a mention.
- **Approach:** a short code in the message text, swapped for a chip when shown.

## Approaches

- **1. A code in the text (chosen).** The message saves `#[t:<uuid>]` and each reader's app swaps it for a chip
  through one lookup that only names what that reader can open. No change to how messages are stored, edits keep
  working, and no title is ever stored in the message, so nothing leaks.
- **2. A mentions table.** Mentions get their own rows, checked at send. A stronger guarantee, but every send and
  edit path changes, and the text still needs a placeholder. The reader-side check already prevents leaks.
- **3. Plain links.** `#` inserts the real web address. The least backend work, but messages fill with long links
  and the chip still needs a name lookup.

## Design

### The code

A mention is `#[<kind>:<uuid>]` inside `messages.body`, with four kinds:

| Code | What | Opens |
|------|------|-------|
| `t` | work task (`general_tasks`) | `/projects/<project>?task=<task>` |
| `p` | work project (`general_projects`, `class_board_id is null`) | `/projects/<project>` |
| `ct` | class task (`project_tasks`) | `/class-projects/<project>?task=<task>` |
| `cp` | class project (`projects`) | `/class-projects/<project>` |

*My call:* at most 10 mentions per message; any after that are sent as plain text. A malformed code is shown as
plain text.

### Database: `supabase/message-mentions.sql`

Runs after `active-status.sql` and before `anon-lockdown.sql`, and redefines nothing another file owns. Two new
functions:

- `search_mentionables(p_query text, p_conversation uuid) returns table (kind text, id uuid, title text,
  project_id uuid, project_title text)`. It is **security invoker**, so row security decides what the caller can
  read, and it adds the participant filter on top: work rows only where the caller is in `general_members`, class
  rows only where the caller is an active member of the class or teaches it. It matches the title
  case-insensitively, returns at most 8 rows, and ranks the conversation's own place first (a project chat's
  project, a class or group chat's class), then the most recently updated. Archived and trashed projects and
  tasks are left out. An empty query lists the current place's most recent items.
- `mention_blind_spots(p_conversation uuid, p_refs jsonb) returns table (kind text, id uuid, members_without
  int, private_task boolean)`. It is **security definer**, for the writer's note. It refuses unless the caller is
  a member of the conversation and can read each ref (via the same check as above). For each ref it counts the
  conversation's members who are not on its project (work: `general_members`; class project: active class
  members and the class's teachers; class task: not in the task's group and not teaching the class).
  `private_task` is true for a work task still in private planning. It returns counts only, never names.

Reading a chip needs no new function. The app reads the titles under row security, and a ref that comes back
empty is shown locked. *My call:* this keeps every visibility rule (release boundary, Workspace visibility, a
teacher's reach) exactly as the rest of the app has it, with no copy of those rules to drift.

For class tasks, a teacher's mention points at the task they set (the origin). A student opens their own group's
copy (`project_tasks.origin_id`, the same lookup announcement links use). A student's mention points at their
group's copy, which classmates in other groups see as locked. *My call:* this mirrors announcement links.

Suite: `supabase/tests/message-mentions.test.sql`. It covers: the participant filter (a Workspace-only reader is
not offered the project), a private planning task offered only to planners, archived items left out, the ranking
of the current place, `mention_blind_spots` refusing a non-member and a ref the caller can't read, and its counts
for work, class project and class task.

### App

- **Codes** (`lib/mentions.ts`): `parseMentions(body)` (text and mention segments), `mentionCode(kind, id)`,
  `linkToMention(url)` (Collabify links → code, for pasting) and `previewText(body)` (codes → "#task" or
  "#project" for the chat list preview). Pure, with Vitest tests.
- **Picker:** typing `#` at the start or after a space opens a list above the composer: icon, title and project
  name, up to 8 rows from `search_mentionables`, refreshing as you type (debounced). ↑/↓ moves, Enter or Tab
  picks, Esc closes, and a space with no match closes it. Picking puts `#Title` in the text box. The composer
  keeps a map from each inserted label to its code and swaps them on send; a label the writer edits by hand
  becomes plain text.
- **Writer's note:** after a pick, the composer calls `mention_blind_spots` and, when anyone would see a lock,
  shows a quiet line under the box: "2 people in this chat aren't on Website redesign. They'll see a locked
  chip." A private planning task adds: "Only the project manager and coordinators can open it until it's sent."
  It never blocks sending.
- **Chip in a message:** `MessageBubble` renders the parsed segments: text through the existing `Linkify`, and
  each mention as an inline chip (icon and title, `navy` tones, one tap opens it). Locked: a lock icon and
  "Task you can't open" or "Project you can't open" in `text-muted`, not a link. Gone (deleted or not found for
  anyone): "Task no longer available". Titles for every mention in the loaded messages come in one batch per
  kind.
- **Editing a message:** the draft shows `#Title` for mentions the editor can read and keeps the raw code for
  the rest, so editing never drops a mention.
- **Pasting:** on send, a Collabify task or project link (this site's origin) becomes its code.
- **Chat list preview:** `previewText` shows "#task" or "#project" in place of codes.
- Copy: sentence case, no exclamation marks. "Task you can't open", "Project you can't open", "Task no longer
  available", "No tasks or projects match".

## Constraints

- Tokens only (`navy-*`, `text-muted`, `text-faint`, `border-line`), working in light and dark.
- Desktop first; on a phone the picker spans the composer's width and sits above the keyboard.
- `npm run build`, Vitest and the SQL suite all pass; the SQL file is applied, then `anon-lockdown.sql`.

## Risks

- An app version older than this one shows the raw code (`#[t:…]`) until it reloads.
- The writer's note is project-level (and group-level for class tasks). The chip itself always comes from the
  reader's own access, so a wrong count never leaks a name.

## Left to the builder

- The exact debounce, and the picker's empty and loading states.
- The class tables' join path (`projects`, `project_boards`, `group_members`) for the class filters.
