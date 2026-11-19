# Task and project mentions in the Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing `#` in an Inbox composer finds tasks and projects the writer is on; the sent message shows a chip that opens it, or a locked chip with no name for a reader who can't.

**Architecture:** A mention is a code in `messages.body` (`#[t:<uuid>]` and the other kinds below). An invoker SQL function, so row security applies, searches what the writer is on. A definer function counts chat members who would see a lock (counts only). Readers resolve codes to titles with ordinary reads under row security, and anything that comes back empty is shown locked.

**Tech Stack:** Postgres/Supabase SQL, React 19 + TypeScript, Vitest with happy-dom (`createRoot` + `act`; there is no Testing Library), Tailwind tokens.

**Spec:** `docs/superpowers/specs/2026-11-20-message-mentions-design.md`

## Global Constraints

- **Mention codes:** `#[t:<uuid>]` work task, `#[p:<uuid>]` work project, `#[ct:<uuid>]` class task copy, `#[co:<uuid>]` class set task (an `origin_id`), `#[cp:<uuid>]` class project. The regex is `/#\[(t|p|ct|co|cp):([0-9a-f-]{36})\]/g`.
- **Plan ruling (extends the spec):** set tasks have no row; their group copies share `project_tasks.origin_id`. So `co` is a fifth kind. When the writer picks a class task that has an `origin_id`, the search returns it as `co`. Each reader then opens their own group's copy, which is what the spec gives a teacher's mention, now for a student's too. A task without an origin is `ct`, and other groups see it locked.
- **Limits:** at most 10 mentions per message (any after the 10th are sent as plain text); search returns at most 8 rows.
- **Links:** work task `/projects/<project>?task=<task>`, work project `/projects/<project>`, class task `/class-projects/<project>?task=<copy>`, class project `/class-projects/<project>`. A `co` for a teacher (who has no copy) opens `/class-projects/<project>?tab=tasks`.
- **SQL file:** `supabase/message-mentions.sql`, after `active-status.sql` and before `anon-lockdown.sql`. It is idempotent and redefines nothing.
- **Copy:** "Task you can't open", "Project you can't open", "No tasks or projects match", "{n} people in this chat aren't on {project}. They'll see a locked chip." (1 → "1 person … isn't on …"), "Only the project manager and coordinators can open it until it's sent." Chat list preview: "#task" or "#project". Sentence case, no exclamation marks.
- Colors from tokens only. `npm run build` passes before any task is called done. Commit locally; never push without the user's review.

## Review Focus

1. **A reader who can't open a mention** must never see its title: not in the chip, not in the list preview, not through the blind-spot counts. Pinned in Task 1 (`blind spots: counts only, refuses a ref the caller can't reach`) and Task 4 (`locked chip shows no title`).
2. **A label the writer edits by hand** must not send a broken or half-converted code. Pinned in Task 2 (`encodeMentions: an edited label stays plain text`).
3. **Editing an old message** must keep mentions the editor can't resolve. Pinned in Task 2 (`decodeForEdit keeps unresolved codes`).
4. **`#` inside a word or a URL** (`issue#3`, `site.com/#top`) must not open the picker. Pinned in Task 2 (`mentionQueryAt ignores # inside a word`).
5. **Planning tasks** must reach only planners, in search and in chips. Pinned in Task 1 (`search: a private planning task is offered only to planners`).

---

### Task 1: Search and blind spots in SQL

**Files:**
- Create: `supabase/message-mentions.sql`
- Create: `supabase/tests/message-mentions.test.sql`
- Modify: `docs/07-backup.md` (both full run lists: insert after `supabase/active-status.sql`; add a section), `CLAUDE.md` (a bullet after Active now)

**Interfaces — Produces:**
- `public.search_mentionables(p_query text, p_conversation uuid) returns table (kind text, id uuid, title text, project_id uuid, project_title text)`, **security invoker**, stable.
  - Work projects (`p`): `general_projects` with `class_board_id is null`, `archived_at is null`, and the caller in `general_members`.
  - Work tasks (`t`): `general_tasks` with `archived_at is null` in those projects, read under row security (so the release boundary applies as it does everywhere).
  - Class projects (`cp`): `projects` with `archived_at is null`, whose class is live and the caller is an active `class_members` student of it or teaches it (`is_class_professor(class_id)`).
  - Class tasks: `project_tasks` with `archived_at is null` on boards of those projects, under row security. A row with `origin_id` becomes one `co` row per origin (`id = origin_id`); one without becomes `ct`.
  - Title `ilike '%' || query || '%'` (escape `%` and `_`; an empty or null query lists everything). Order: rows in the conversation's own place first (`conversations.general_project_id` matching the project; for class and group chats, `conversations.class_id`, or the group's class, matching the class), then `updated_at desc`, then `limit 8`. The caller must be a member of `p_conversation` (`conversation_members`), or the function returns no rows.
- `public.mention_blind_spots(p_conversation uuid, p_refs jsonb) returns table (kind text, id uuid, project_title text, members_without int, private_task boolean)`, **security definer**. `p_refs` is `[{"kind":"t","id":"…"}, …]` (at most 10).
  - It raises `insufficient_privilege` unless the caller is a conversation member and each ref passes the search's participant rule for the caller (a ref that fails is refused, not skipped).
  - `members_without` counts conversation members (other than the caller) who are not on the ref's project. Work: not in `general_members`. Class project and `co`: not an active student of the class and not its professor or a co-teacher (owner or manager on the class space with `can_teach`). `ct`: not in the copy's board group (`group_members` for `project_boards.group_id`, or `project_boards.student_id`) and not teaching the class.
  - `private_task` is `routing_state <> 'released'` for `t`, otherwise false.
- Grants: `execute` to `authenticated` only on both functions.

- [ ] **Step 1: Write the failing suite.** Use the harness from `supabase/tests/active-status.test.sql` (`act_as`, `act_as_service`, `must_be`, `auth.users` + `profiles` inserts, roll back). Fixture: a work project J (PM P, member M, and a coordinator C) with a released task "Zz Login page" and a planning task "Zz Secret plan"; a Workspace-visible project V in J's space that M is not on; a class K (teacher T, students S1 in group G1 and S2 in group G2); a class project KP with a set task (copies in G1 and G2 sharing an origin) and a G1-only task with no origin; an archived work task. Conversations: J's project chat (P, M, C), and a direct chat between M and S1. Checks:
  - `search: finds a released work task by part of its title` (M, query "login", kind `t`)
  - `search: a private planning task is offered only to planners` (C sees "Zz Secret plan", M does not)
  - `search: a project you only view is not offered` (M never gets V)
  - `search: archived tasks are left out`
  - `search: the chat's own project ranks first` (M in J's chat with an empty query, so the first row's `project_id = J`)
  - `search: a set task comes back once, as co` (T and S1 each get one `co` row for the origin)
  - `search: a group-only task comes back as ct` (S1)
  - `search: nothing for a non-member of the conversation`
  - `search: at most 8 rows`
  - `blind spots: counts work members outside the project` (M in the M–S1 direct chat, ref `t` Login page, so `members_without = 1`)
  - `blind spots: flags a planning task` (C in J's chat, the Secret plan ref, so `private_task`)
  - `blind spots: ct counts other groups, co counts nobody in the class` (in a class chat with T, S1 and S2)
  - `blind spots: counts only, refuses a ref the caller can't reach` (S2 passing the G1-only `ct` raises `insufficient_privilege`)
  - `blind spots: refuses a non-member of the conversation`
- [ ] **Step 2: Run it and see it fail.** Run: `node scripts/db.mjs supabase/tests/message-mentions.test.sql`. Expected: `function public.search_mentionables(...) does not exist`.
- [ ] **Step 3: Write `supabase/message-mentions.sql`** to the interfaces above, with a header comment like `active-status.sql`.
- [ ] **Step 4: Apply and run.** Run: `node scripts/db.mjs supabase/message-mentions.sql supabase/anon-lockdown.sql`, then the suite. Expected: every check prints PASS.
- [ ] **Step 5: Re-apply, re-run the suite, and run `supabase/tests/active-status.test.sql`.** Expected: all PASS.
- [ ] **Step 6: Update the docs and commit** ("Add mention search and blind spots in SQL").

---

### Task 2: Mention codes, pure

**Files:**
- Create: `src/lib/mentions.ts`
- Create: `src/lib/mentions.test.ts`

**Interfaces — Produces:**
- `type MentionKind = 't' | 'p' | 'ct' | 'co' | 'cp'`
- `type MentionRef = { kind: MentionKind; id: string }`
- `type Segment = { type: 'text'; text: string } | { type: 'mention'; ref: MentionRef }`
- `MAX_MENTIONS = 10`
- `mentionCode(ref: MentionRef): string` → `#[t:<id>]`
- `parseMentions(body: string): Segment[]`; only the first 10 codes become mention segments, and the rest stay text
- `mentionRefs(body: string): MentionRef[]` (unique, in order, at most 10)
- `previewText(body: string): string` (codes → `#task` for t, ct and co, `#project` for p and cp)
- `linkToMention(url: string, origin: string): MentionRef | null`: same-origin `/projects/<id>?task=<id>` → `t`, `/projects/<id>` → `p`, `/class-projects/<id>?task=<id>` → `ct`, `/class-projects/<id>` → `cp`; anything else, or another origin → null
- `encodeMentions(text: string, picked: { label: string; ref: MentionRef }[], origin: string): string` turns each exact `#<label>` into its code (longest label first) and same-origin Collabify links into codes, with a cap of 10.
- `decodeForEdit(body: string, titles: Map<string, string>): { text: string; picked: { label: string; ref: MentionRef }[] }` (key `kind:id`); a code with no title stays as its raw code.
- `mentionQueryAt(text: string, caret: number): { start: number; query: string } | null`: the `#` must be at index 0 or follow whitespace, and the query runs to the caret with no whitespace and no `[`.

- [ ] **Step 1: Write the failing tests** — each name below is one `it`:
  - `parseMentions splits text and codes`; `parseMentions leaves a malformed code as text`; `parseMentions caps at 10`
  - `previewText names the kind`
  - `linkToMention reads each link shape`; `linkToMention ignores another origin`
  - `encodeMentions turns picked labels into codes`; `encodeMentions: an edited label stays plain text` (picked label "Login page", text "#Login pages" stays plain); `encodeMentions turns a pasted link into a code`; `encodeMentions prefers the longer label` ("#Login page v2" vs "#Login page")
  - `decodeForEdit shows titles`; `decodeForEdit keeps unresolved codes`
  - `mentionQueryAt finds # after a space and at the start`; `mentionQueryAt ignores # inside a word` (`issue#3`, `a.com/#top` → null); `mentionQueryAt stops at whitespace`
- [ ] **Step 2: Run** `npx vitest run src/lib/mentions.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it.** Expected: PASS. Commit ("Add mention codes").

---

### Task 3: API and title lookup

**Files:**
- Create: `src/lib/api/mentions.ts`
- Create: `src/lib/api/mentions.test.ts`
- Create: `src/hooks/useMentionTitles.ts`

**Interfaces:**
- Consumes: Task 1 functions and Task 2 types.
- Produces:
  - `type Mentionable = { kind: MentionKind; id: string; title: string; project_id: string; project_title: string }`
  - `searchMentionables(query: string, conversationId: string): Promise<Mentionable[]>`
  - `type BlindSpot = { kind: MentionKind; id: string; project_title: string; members_without: number; private_task: boolean }`
  - `mentionBlindSpots(conversationId: string, refs: MentionRef[]): Promise<BlindSpot[]>`
  - `type ResolvedMention = { state: 'open'; title: string; href: string; archived: boolean } | { state: 'locked' }`
  - `resolveMentions(refs: MentionRef[]): Promise<Map<string, ResolvedMention>>` (key `kind:id`). One read per kind present, under row security:
    - `general_tasks` `id, title, project_id, archived_at`
    - `general_projects` `id, name, archived_at`
    - `project_tasks` `id, title, archived_at, board:project_boards(project_id)` for `ct`
    - `project_tasks` `id, title, origin_id, archived_at, board:project_boards(project_id)` filtered `.in('origin_id', …)` for `co`: the first copy per origin; a teacher reaching several copies gets `href` `/class-projects/<project>?tab=tasks`, a student with one copy gets `?task=<copy>`
    - `projects` `id, title, archived_at`

    A ref with no row is `locked`. A row with `archived_at` or `trashed_at` set opens with `archived: true`.
  - `useMentionTitles(refs: MentionRef[]): Map<string, ResolvedMention>`: batches by the sorted ref keys, keeps earlier results, and on a read error leaves those refs unresolved (rendered as locked).
- **Plan ruling:** the spec's "Task no longer available" can't be told apart from "can't open" under row security without a definer read. Both show as locked: the safer one, which never confirms a hidden item exists.

- [ ] **Step 1: Failing tests** in `api/mentions.test.ts`, mocking `../supabase` like `src/lib/api/presence.test.ts` with a `from()` chain:
  - `searchMentionables calls the function with the query and chat`
  - `mentionBlindSpots sends refs as json`
  - `resolveMentions opens what comes back and locks what doesn't`
  - `resolveMentions opens a teacher's set task on the Tasks tab`
  - `resolveMentions marks archived rows`
- [ ] **Step 2: Run** `npx vitest run src/lib/api/mentions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the API and the hook.**
- [ ] **Step 4: Run it, then `npm run build`.** Expected: PASS and a clean build. Commit ("Add mention search and lookup").

---

### Task 4: Chips in messages and the list preview

**Files:**
- Create: `src/components/messages/MessageText.tsx`
- Create: `src/components/messages/MessageText.test.tsx`
- Modify: `src/components/messages/MessageBubble.tsx` (body at ~236: `<Linkify text={message.body} …>` becomes `<MessageText body={message.body} titles={titles} />`; the edit draft at ~131 and ~270 uses `decodeForEdit` and is saved through `encodeMentions`)
- Modify: `src/components/messages/MessageThread.tsx` (one `useMentionTitles` over every loaded message's `mentionRefs`, passed to each bubble)
- Modify: `src/components/messages/ConversationList.tsx:151` (`previewText(c.last_body)`, also in the search filter at :55)

**Interfaces:** `MessageText({ body, titles }: { body: string; titles: Map<string, ResolvedMention> })` renders the segments. Text goes through `Linkify` (`tone="inherit"`). A resolved `open` mention is a `react-router` `Link` chip: `inline-flex items-center gap-1 rounded-md bg-navy-50 px-1.5 py-0.5 text-[13px] font-medium text-navy-700 dark:bg-navy-500/20 dark:text-navy-100`, a `check` icon for tasks and `kanban` for projects, the title truncated at 40ch, and " · archived" in `text-faint` when archived. `locked`, or not yet resolved, is a `span` with the `lock` icon, the copy from Global Constraints, `text-muted`, and `aria-label` equal to that copy. Check that `lock` exists in `Icon`'s `PATHS`, and add it if missing.

- [ ] **Step 1: Failing tests:**
  - `renders text and an open chip that links`
  - `locked chip shows no title` (the title must not appear anywhere in `host.textContent`)
  - `unresolved shows as locked`
  - `keeps links in the text clickable`
- [ ] **Step 2: Run** `npx vitest run src/components/messages/MessageText.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement and wire into the bubble, the thread and the list.**
- [ ] **Step 4: Run** `npx vitest run src/components/messages` **and** `npm run build`. Expected: PASS. Commit ("Show task and project mentions as chips").

---

### Task 5: The `#` picker and the writer's note

**Files:**
- Create: `src/components/messages/MentionPicker.tsx`
- Create: `src/components/messages/MentionPicker.test.tsx`
- Modify: `src/components/messages/MessageComposer.tsx` (new prop `conversationId: string`; picker state; `encodeMentions` on submit)
- Modify: `src/components/messages/MessageThread.tsx:250` (pass `conversationId={conversation.id}`)

**Interfaces:**
- `MentionPicker({ items, active, loading, onPick, onHover }: { items: Mentionable[]; active: number; loading: boolean; onPick: (m: Mentionable) => void; onHover: (i: number) => void })` is a `role="listbox"` above the composer (`absolute bottom-full left-0 right-0 mb-2`, `surface`, `border-line`, `shadow`). Each row is a `role="option"` with `aria-selected`, showing the icon, the title and `project_title` in `text-muted`. While `loading` with no items it shows a `Spinner`; when empty and not loading, "No tasks or projects match".
- **Composer behavior:**
  - On every change and caret move, `mentionQueryAt(body, caret)`. When non-null, debounce 200 ms, then `searchMentionables(query, conversationId)`.
  - ↑/↓ move the active row, Enter or Tab pick it, Esc closes. While the picker is open with items, Enter picks rather than sends.
  - Picking replaces `#query` with `#<title> ` and records `{ label: title, ref }` in `picked` (state, cleared on send).
  - After each pick, `mentionBlindSpots(conversationId, refs)` for the refs still in the text. It shows one muted line per spot with `members_without > 0` ("{n} people in this chat aren't on {project_title}. They'll see a locked chip.") and the planning line for `private_task`. Errors are ignored silently, since the note is advisory.
  - `submit` sends `encodeMentions(body, picked, window.location.origin)`.

- [ ] **Step 1: Failing tests** in `MentionPicker.test.tsx`:
  - `lists items with their project`
  - `marks the active option`
  - `picks on click`
  - `says when nothing matches`
- [ ] **Step 2: Run** `npx vitest run src/components/messages/MentionPicker.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement the picker and the composer wiring.**
- [ ] **Step 4: Run** `npx vitest run src/components/messages` **and** `npm run build`. Expected: PASS. Commit ("Pick tasks and projects with # in the Inbox").

---

### Task 6: Check it in the running app and hand off

**Files:** Modify `handoff.md` (a new section at the end, with Deferred).

- [ ] **Step 1: Run** `npx vitest run` **and** `npm run build`. Expected: all green.
- [ ] **Step 2: Check on the dev server** (`preview_start` collabify; ask the user to sign in if the pane isn't). In a project chat:
  - type `#`, see that project's tasks first, filter by typing, pick with Enter, and see the blind-spot line where it applies
  - send, see the chip, and tap it: the task dialog opens
  - edit the message: the draft shows `#Title`, and saving keeps the chip
  - check the chat list preview reads "#task"
  - check a phone width of 375 (the picker fits) and dark mode

  Send only in a chat where a test message is acceptable, and delete it afterwards with "Delete for everyone". Ask the user which chat to use if there is no obvious one.
- [ ] **Step 3: Write the handoff section** (what shipped, the codes, the SQL file and suite, Deferred: no mention notifications, no @people, the chip shows locked for deleted items too). Commit.
- [ ] **Step 4: Ask the user to review** before pushing `main`.
