# Active now in the Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Inbox shows which people you share a class, space or project with are online, and tapping one opens a direct chat with them.

**Architecture:** Each open tab calls `touch_presence()` about once a minute, which stamps `user_presence.last_seen_at`. The Inbox polls `my_active_contacts()`, a security-definer function that returns only the caller's contacts (people who share a live class, work space or work project) who have not hidden their status. `start_contact_conversation()` opens or creates the direct chat under the same contact rule. No realtime channels are used.

**Tech Stack:** Postgres/Supabase SQL (security-definer RPCs, RLS), React 19 + TypeScript, Vitest with happy-dom (component and hook tests render with `createRoot` + `act`, as `src/components/messages/InboxInvitations.test.tsx` does; there is no Testing Library), Tailwind tokens.

**Spec:** `docs/superpowers/specs/2026-11-20-active-now-design.md`

## Global Constraints

- New SQL lives in `supabase/active-status.sql`, runs after `send-to-planner.sql` and before `anon-lockdown.sql`, is idempotent and redefines nothing another file owns.
- `user_presence` has RLS on and no policies; every read and write goes through the functions.
- "Active now" = `last_seen_at` within 2 minutes. The strip lists contacts seen within the last 1 hour. The heartbeat runs every 60 seconds while the tab is visible; the server skips a write when the last one was less than 45 seconds ago.
- A person with `show_active = false` stores no `last_seen_at`, appears to nobody, and sees nobody (`my_active_contacts` returns no rows for them).
- A direct chat reuses `start_direct_conversation`'s key: `least(a::text, b::text) || '|' || greatest(a::text, b::text)`.
- Colors from tokens only: `bg-presence`, `text-ink`, `text-muted`, `text-faint`, `border-line`, `ring-[var(--surface)]`. No raw hex.
- Copy: "Active now", "Show when you're active", "{n}m" labels. Sentence case, active voice, no exclamation marks, no "please", no "successfully".
- `npm run build` must pass before any task is called done.
- Commit locally after each task. Never push `main` without the user's review.

## Review Focus

1. **Someone who left a place** (removed class member, archived class, space or project) must drop out of the strip and can no longer be messaged through it. Pinned in Task 1 (`removed`, `archived` cases).
2. **A hidden person** must not appear anywhere, even while their tab keeps beating, but others can still message them. Pinned in Task 1 (`hidden` cases).
3. **Two people who share several places** must appear once, not once per place. Pinned in Task 1 (`one row per person`).
4. **A student who taps their teacher** must land in the same thread the teacher's New message opened. Pinned in Task 1 (`same thread as start_direct_conversation`).
5. **A background tab** must stop stamping, so someone who walked away goes quiet. Pinned in Task 3 (`does not beat while hidden`).

---

### Task 1: Presence and contact rules in SQL

**Files:**
- Create: `supabase/active-status.sql`
- Create: `supabase/tests/active-status.test.sql`
- Modify: `docs/07-backup.md` (both full run lists, lines 26 and 53: insert `supabase/active-status.sql` between `supabase/send-to-planner.sql` and the final `supabase/anon-lockdown.sql`; add a short section like the other owners)
- Modify: `CLAUDE.md` (a bullet under Project roles, after "Send to planner")

**Interfaces:**
- Produces (all `security definer`, `set search_path = public`):
  - table `public.user_presence (user_id uuid primary key references public.profiles(id) on delete cascade, last_seen_at timestamptz, show_active boolean not null default true)`, plus an index on `last_seen_at`
  - `public.contacts_of(p_user uuid) returns setof uuid`, internal; `revoke all ... from public, anon, authenticated`
  - `public.touch_presence() returns void`
  - `public.set_active_status(p_show boolean) returns void`
  - `public.my_active_status() returns boolean` (true when the caller has no row)
  - `public.my_active_contacts() returns table (id uuid, first_name text, last_name text, avatar_url text, last_seen_at timestamptz)`, ordered by `last_seen_at desc`
  - `public.start_contact_conversation(p_person uuid) returns jsonb`: `{result: 'ok', conversation_id}` | `{result: 'not_signed_in'}` | `{result: 'not_contact'}`

**The contact rule (`contacts_of`)**: the distinct people, other than `p_user`, whose profile `status = 'active'` and who share with `p_user` at least one of the following:
- **A class** `c` with `c.archived_at is null`. The class's people are its active students (`class_members.status = 'active'`), `c.professor_id`, and members of `c.space_id` at level `owner` or `manager` whose profile is `role = 'member' and can_teach` (co-teachers, the same test `teaches_in_space` uses).
- **A work space** `s` with `s.kind <> 'education'` and `s.archived_at is null`, through `general_space_members`.
- **A work project** `p` with `p.class_board_id is null` and `p.archived_at is null` (trashed implies archived), through `general_members`.

**Behaviors:**
- `touch_presence`: does nothing unless `am_i_admitted()`. Upserts `last_seen_at = now()` only when `show_active` is true and the existing stamp is null or older than 45 seconds.
- `set_active_status(false)` sets `show_active = false, last_seen_at = null`; `set_active_status(true)` sets `show_active = true`.
- `my_active_contacts`: returns no rows unless `am_i_admitted()` and the caller's own `show_active` (default true) is on. Otherwise it returns contacts with `show_active` on and `last_seen_at > now() - interval '1 hour'`.
- `start_contact_conversation`: refuses with `not_signed_in` or `not_contact` (a non-admitted caller or a non-contact is `not_contact`). Otherwise it finds or creates the `direct` conversation for the key above with both people in `conversation_members`. The insert uses `on conflict do nothing` on the partial unique index from `messages.sql` and then re-selects, so two concurrent taps make one thread. `show_active` is ignored here.
- Grants: `execute` on the five public functions to `authenticated` only.

- [ ] **Step 1: Write the failing suite** `supabase/tests/active-status.test.sql`

  Copy the harness from `supabase/tests/space-look.test.sql`: `act_as`, `act_as_service`, `must_be`, users inserted into `auth.users` + `profiles`, everything in one transaction that rolls back. Fixture: a teacher T, a co-teacher C (owner/manager on the class's space, `can_teach`), students S1 and S2 in class K, a removed student S3 in K, a stranger X, members M1 and M2 in work space W, and members P1 and P2 in work project J (J has its own space, not W). Then add a second class K2 owned by T in which S1 and S2 are also active, so they share two places. Checks, labelled exactly:
  - `class: student sees classmate` — S2 stamped, act as S1 → `my_active_contacts` contains S2
  - `class: student sees teacher` and `class: student sees co-teacher`
  - `class: teacher sees student`
  - `one row per person` — S1 sees S2 exactly once
  - `space: members see each other` (M1↔M2) and `project: members see each other` (P1↔P2)
  - `stranger sees nobody` — X gets 0 rows; S1 does not see X
  - `removed: a removed student is not a contact` — S1 does not see S3 even when S3 is stamped
  - `archived: an archived class drops out` — after setting `archived_at` on K and K2, S1 does not see S2
  - `class space: a class's own space links nobody` — S1 and M1 do not see each other even when M1 is also added to K's space as a member
  - `stale: seen over an hour ago is not listed` — S2's stamp set to `now() - interval '61 minutes'`
  - `hidden: a hidden person appears to nobody` — S2 calls `set_active_status(false)` then `touch_presence()`; S2's `last_seen_at` is null and S1 does not see S2
  - `hidden: a hidden person sees nobody` — S2 gets 0 rows
  - `hidden: still messageable` — S1's `start_contact_conversation(S2)` gives `ok`
  - `skip: a stamp under 45 s old is kept` — set S1's stamp to `now() - interval '30 seconds'`, touch, and it is unchanged; at `61 seconds`, touch, and it equals `now()`
  - `dm: same thread as start_direct_conversation` — T's `start_direct_conversation(S1)` id equals S1's `start_contact_conversation(T)` id
  - `dm: calling twice returns the same thread`
  - `dm: a stranger is refused` — X → S1 gives `not_contact`, and no conversation is created
  - `internal: contacts_of is not callable` — as S1, `select public.contacts_of(S1)` is refused with "permission denied"

- [ ] **Step 2: Run it and see it fail**

  Run: `node scripts/db.mjs supabase/tests/active-status.test.sql`
  Expected: fails on the first call with `function public.touch_presence() does not exist` (or similar).

- [ ] **Step 3: Write `supabase/active-status.sql`** to the interfaces and behaviors above. Use a header comment in the style of the other owner files: what it owns, where it runs, and its suite.

- [ ] **Step 4: Apply and run the suite**

  Run: `node scripts/db.mjs supabase/active-status.sql supabase/anon-lockdown.sql`
  Then: `node scripts/db.mjs supabase/tests/active-status.test.sql`
  Expected: every check prints `PASS`, then the transaction rolls back.

- [ ] **Step 5: Re-apply to prove it is idempotent, then run the neighbors**

  Run: `node scripts/db.mjs supabase/active-status.sql supabase/anon-lockdown.sql`, then the suite again, then `node scripts/db.mjs supabase/tests/send-to-planner.test.sql`
  Expected: all PASS.

- [ ] **Step 6: Update `docs/07-backup.md` and `CLAUDE.md`**, then commit

```bash
git add supabase/active-status.sql supabase/tests/active-status.test.sql docs/07-backup.md CLAUDE.md
git commit -m "Add active status and contact direct messages in SQL"
```

---

### Task 2: Client API and presence helpers

**Files:**
- Create: `src/lib/api/presence.ts`
- Create: `src/lib/api/presence.test.ts`
- Create: `src/lib/presence.ts`
- Create: `src/lib/presence.test.ts`

**Interfaces:**
- Consumes: the Task 1 RPCs.
- Produces:
  - `type ActiveContact = { id: string; first_name: string; last_name: string; avatar_url: string | null; last_seen_at: string }`
  - `touchPresence(): Promise<void>`
  - `setActiveStatus(show: boolean): Promise<void>`
  - `getActiveStatus(): Promise<boolean>`
  - `listActiveContacts(): Promise<ActiveContact[]>`
  - `startContactConversation(personId: string): Promise<{ result: 'ok' | 'not_contact' | 'not_signed_in'; conversation_id?: string }>`
  - In `src/lib/presence.ts`: `ACTIVE_NOW_MS = 120_000`, `HEARTBEAT_MS = 60_000`, `isActiveNow(lastSeen: string, now: number): boolean`, `seenLabel(lastSeen: string, now: number): string | null` (null when active now, else `${minutes}m`, with a floor of 2 and a cap of 59)

- [ ] **Step 1: Write the failing tests**
  - `presence.test.ts` (in `src/lib/`): `isActiveNow` is true at 0 s and 119 s, false at 121 s; `seenLabel` is null at 60 s, `'2m'` at 121 s, `'12m'` at 12 min 30 s, `'59m'` at 59 min.
  - `api/presence.test.ts`: mock `../supabase` the way `src/lib/api/milestones.test.ts` does. Each function calls the matching RPC name with the right args (`start_contact_conversation` with `{ p_person: id }`, `set_active_status` with `{ p_show: false }`); an RPC error is thrown; `listActiveContacts` returns `[]` when data is null.

- [ ] **Step 2: Run** `npx vitest run src/lib/presence.test.ts src/lib/api/presence.test.ts`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement both modules.**

- [ ] **Step 4: Run the same command.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/presence.ts src/lib/presence.test.ts src/lib/api/presence.ts src/lib/api/presence.test.ts
git commit -m "Add presence helpers and API"
```

---

### Task 3: Heartbeat in the app shell

**Files:**
- Create: `src/hooks/usePresenceHeartbeat.ts`
- Create: `src/hooks/usePresenceHeartbeat.test.tsx`
- Modify: `src/components/app/AppShell.tsx` (call the hook once, next to `WalkthroughProvider`)

**Interfaces:**
- Consumes: `touchPresence`, `HEARTBEAT_MS`.
- Produces: `usePresenceHeartbeat(enabled: boolean): void`. AppShell passes `Boolean(profile && profile.status === 'active')`; the server's `am_i_admitted` check covers the rest.

**Behavior:** beat on mount; every `HEARTBEAT_MS` while `document.visibilityState === 'visible'`; on `focus` and on `visibilitychange` to visible. Errors are swallowed (`console.warn` once), since a missed beat only delays a dot. Clean up all listeners and the interval.

- [ ] **Step 1: Write the failing tests** (fake timers, `touchPresence` mocked):
  - `beats on mount`
  - `beats every 60 seconds while visible` — advance 120 s → 3 calls
  - `does not beat while hidden` — set `visibilityState` to `'hidden'`, advance 180 s → still 1 call; set it to `'visible'` and dispatch `visibilitychange` → 2 calls
  - `does nothing when disabled`
  - `stops after unmount`

- [ ] **Step 2: Run** `npx vitest run src/hooks/usePresenceHeartbeat.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement the hook and wire it into AppShell.**

- [ ] **Step 4: Run the test, then `npm run build`.** Expected: PASS, and the build is clean.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePresenceHeartbeat.ts src/hooks/usePresenceHeartbeat.test.tsx src/components/app/AppShell.tsx
git commit -m "Stamp presence from every open tab"
```

---

### Task 4: Active now strip, tap to chat, and dots on direct rows

**Files:**
- Create: `src/hooks/useActiveContacts.ts`
- Create: `src/components/messages/ActiveNowStrip.tsx`
- Create: `src/components/messages/ActiveNowStrip.test.tsx`
- Modify: `src/components/messages/ConversationList.tsx` (new optional prop and the dot)
- Modify: `src/pages/app/messages/Messages.tsx` (render the strip above the list and handle the tap)

**Interfaces:**
- Consumes: `listActiveContacts`, `startContactConversation`, `isActiveNow`, `seenLabel`, `ActiveContact`, `useLive` (`src/hooks/useLive.ts`), `Avatar` (`src/components/app/Avatar.tsx`).
- Produces:
  - `useActiveContacts(enabled: boolean): ActiveContact[] | null` — `useLive(load, [], { every: 60_000, enabled })`, keeping the last good list on error.
  - `ActiveNowStrip({ contacts, onOpen, busyId }: { contacts: ActiveContact[]; onOpen: (id: string) => void; busyId: string | null })` — returns `null` when `contacts` is empty.
  - `ConversationList` gains `activeIds?: ReadonlySet<string>`; a `direct` row whose `counterpart.id` is in it gets a `bg-presence` dot on the avatar (`h-2.5 w-2.5 rounded-full ring-2 ring-[var(--surface)]`, bottom-right) with `aria-label="Active now"`.

**Strip layout:** an `.eyebrow` "Active now" heading, then a horizontally scrolling row (`overflow-x-auto`, no wrap) of 56 px buttons. Each button has a 44 px `Avatar`, the dot when `isActiveNow` (else the `seenLabel` in `text-faint` mono under the name), and the first name truncated in `text-[12px] text-muted`. The accessible name is the full name plus ", active now" or ", active {n}m ago". It sits at the top of the list column with `border-b border-line`, and the same layout works on a phone. A busy button shows a `Spinner` over the avatar and is disabled.

**Tap in `Messages.tsx`:** `startContactConversation(id)`. On `ok`: `await reload()`, then `navigate(`${paths.conversation(conversation_id)}${location.search}`)`. On `not_contact`, show an `Alert` above the panel: "You no longer share a class, space or project with this person, so you can't message them." On a thrown error: "We couldn't open that chat. Check your connection and try again." Only one tap runs at a time (`busyId`). The `activeIds` passed to the list are the ids of contacts for which `isActiveNow` holds.

- [ ] **Step 1: Write the failing tests** in `ActiveNowStrip.test.tsx`:
  - `renders nothing when empty`
  - `shows a dot for active now and a minute label otherwise` — one contact at now-30 s (dot present, no label), one at now-12 min (shows `12m`)
  - `calls onOpen with the person's id`
  - `disables the busy person's button`
  - `names each person with their status` — a button whose `aria-label` is `Ana Cruz, active now`

- [ ] **Step 2: Run** `npx vitest run src/components/messages/ActiveNowStrip.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement the hook, the strip, the `ConversationList` prop and the `Messages.tsx` wiring.**

- [ ] **Step 4: Run** `npx vitest run src/components/messages` **and** `npm run build`. Expected: PASS, including the existing `InboxInvitations.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useActiveContacts.ts src/components/messages/ActiveNowStrip.tsx src/components/messages/ActiveNowStrip.test.tsx src/components/messages/ConversationList.tsx src/pages/app/messages/Messages.tsx
git commit -m "Show who is active in the Inbox and open a chat on tap"
```

---

### Task 5: "Show when you're active" in Settings

**Files:**
- Modify: `src/pages/Settings.tsx` (Profile section, below the profile form, separated by `border-t border-line pt-5`)

**Interfaces:**
- Consumes: `getActiveStatus`, `setActiveStatus`, and `Toggle` from `src/components/ui/Field`.

**Behavior:** load the value on mount (the switch is disabled until it loads). Flip it optimistically, and roll back with an `Alert`, "We couldn't save that. Try again.", if the call throws. Label: "Show when you're active". Note under it: "People you share a class, space or project with can see when you're online. Turn this off and you won't see when they're active either."

- [ ] **Step 1: Implement**, following the existing Notifications toggle rows (lines ~518–530) for markup.
- [ ] **Step 2: Run** `npm run build`. Expected: clean.
- [ ] **Step 3: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "Let people hide their active status"
```

---

### Task 6: Check it in the running app and hand off

**Files:**
- Modify: `handoff.md` (a new section at the end: what shipped, the SQL file and its suite, and Deferred)

- [ ] **Step 1: Run** `npm run build` **and** `npx vitest run`. Expected: all green.
- [ ] **Step 2: Start the dev server** with `preview_start` (`.claude/launch.json`) and open `/inbox` signed in as a test account that shares a class or project with a second account. If the pane is not signed in, ask the user to sign in there and wait. Using `node scripts/db.mjs`, stamp the second account's `user_presence.last_seen_at = now()`. Within 60 seconds the strip shows them with a dot, and the matching direct row (if any) shows the dot. Tap them: the thread opens. Stamp them at `now() - interval '12 minutes'` and reload: `12m` shows.
- [ ] **Step 3: In Settings → Profile,** turn the switch off. The strip disappears from the Inbox, and the account's own `last_seen_at` is null in the database. Turn it back on.
- [ ] **Step 4: Check the phone width** (`resize_window` preset `mobile`): the strip scrolls sideways and the page does not. Check dark mode for the dot and labels. Reset to desktop. Take a screenshot as proof.
- [ ] **Step 5: Write the handoff section.** Under Deferred: blocking and reporting in direct chats; teachers cannot see student-to-student direct chats; presence is shown only in the Inbox. Then commit:

```bash
git add handoff.md
git commit -m "Note Active now in the handoff"
```

- [ ] **Step 6: Ask the user to review** before pushing `main`.
