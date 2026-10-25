# Space Member Invite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a work-space Owner invite an existing account as an ordinary space Member from the Members tab, without giving project access.

**Architecture:** Store the offered level on the existing space invitation row. Keep the current co-owner and class paths, add one Owner-only regular-member RPC, and have acceptance apply the stored level. Reuse the existing search dialog in Space Members and show the offered level to both sides.

**Tech Stack:** Postgres/Supabase, React 19, TypeScript, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-space-member-invite-design.md`

## Global Constraints

- The regular invite is for active work spaces and their Owners; accepting adds space level `member` and no project membership or project visibility.
- The current co-owner invite requires Project manager and accepts into `owner`; class/co-teacher invitations keep their behavior.
- Existing pending invitations retain their co-owner meaning; never demote an existing member or Owner. Decline and withdraw stay unchanged.
- The server checks authorization, archive state, eligible account, existing membership, pending duplicate and existing student-invite restrictions. The UI only reflects those checks.
- Use existing search, dialog and invitations; no dependency or new table. SQL files remain idempotent; `anon-lockdown.sql` runs last after function changes.
- Preserve unrelated work. Stage explicit files only. Run `python -m graphify update .` after code changes.

## Review Focus

1. A legacy pending co-owner invitation still accepts into Owner: Task 1 tests default `owner` on old rows.
2. A regular invitee already on a project keeps that project role, and an existing Owner is never demoted: Task 1 tests both.
3. A non-Owner, an archived space and an education space cannot use the regular-member RPC: Task 1 tests all three.
4. An invitee whose Project manager switch is off may accept a regular invite, but cannot accept a co-owner invite: Task 1 tests both.
5. The Owner and invitee can tell whether a pending invite offers Member or co-owner access, and other roles see no invite button: Task 2 checks UI/Inbox copy and browser behavior.

## File Map

| File | Responsibility |
| --- | --- |
| `supabase/general-spaces.sql` | Idempotent base invitation column and base pending-list shape. |
| `supabase/project-visibility.sql` | Final Owner-only work-space invite and acceptance rules. |
| `supabase/inbox.sql` | Final invitee pending-list shape. |
| `supabase/tests/project-visibility.test.sql` | Transaction-rollback security and level tests. |
| `docs/07-backup.md` | Restore order and new function ownership. |
| `src/lib/api/spaces.ts`, `src/lib/general/types.ts` | Member-invite RPC and offered-level fields. |
| `src/components/general/InviteToSpaceDialog.tsx`, `src/pages/general/SpaceMembers.tsx` | Second invite action and Owner pending labels. |
| `src/components/messages/InboxInvitations.tsx` | Invitee access-level copy. |

### Task 1: Store and enforce invitation level

**Files:** Modify `supabase/general-spaces.sql`, `supabase/project-visibility.sql`, `supabase/inbox.sql`, `supabase/tests/project-visibility.test.sql`, `docs/07-backup.md`.

**Interfaces:** `general_space_invitations.invited_level public.general_level NOT NULL DEFAULT 'owner'`; new `public.invite_general_space_member(p_space uuid, p_user uuid)` returns the invitation row; `list_general_space_invitations(uuid)` and `list_my_general_space_invitations()` append `invited_level public.general_level` to their existing columns. The current `invite_to_general_space(uuid,uuid)` stays co-owner-only. Acceptance uses `invited_level` only for work spaces.

- [ ] **Write failing SQL assertions:** a new non-PM account accepts a regular invite and has `general_space_members.level = 'member'` but no `general_members` row for the fixture project; a pending legacy/default invite has `invited_level = 'owner'`; old co-owner acceptance still produces Owner; a current Owner cannot be demoted; non-Owner, archived and class-space attempts fail; an already seated Member cannot receive another regular invite; the Owner and invitee list the offered level.
- [ ] **Run** `supabase/tests/project-visibility.test.sql` against the configured database through the existing `scripts/db.mjs`; expect the new assertions to fail before migration. The test file rolls back its fixtures.
- [ ] **Implement** the column in both base and final SQL (`ADD COLUMN IF NOT EXISTS` for live upgrades). Add the Member RPC in `project-visibility.sql`, set `invited_level = 'member'` on insert, keep co-owner defaults, and branch acceptance on the stored value without updating an existing higher level down. Change the two list functions' return types by dropping/recreating them in their final owner files; preserve authenticated grants and rerun anonymous lockdown after deployment. Update base list definitions for full restore. Document restore order in `docs/07-backup.md`.
- [ ] **Apply** the migration to the configured database in its required order: `project-visibility.sql`, `inbox.sql`, `project-team-leads.sql`, `project-stakeholders.sql`, `project-feedback.sql`, `project-qa.sql`, `anon-lockdown.sql`; never apply `general-spaces.sql` alone. Verify no direct write policy exposes the level field.
- [ ] **Run** `project-visibility.test.sql`, `general-spaces.test.sql`, `access.test.sql`, `anon-lockdown.test.sql`; expect the new and existing assertions to pass. Run `git diff --check`, review the SQL diff, stage only named files and commit `feat: allow regular space invitations`.

### Task 2: Offer regular invitations in Members and Inbox

**Files:** Modify `src/lib/api/spaces.ts`, `src/lib/general/types.ts`, `src/components/general/InviteToSpaceDialog.tsx`, `src/pages/general/SpaceMembers.tsx`, `src/components/messages/InboxInvitations.tsx`; add a focused `.test.ts` only for nontrivial shared behavior, not for a button that mirrors a boolean.

**Interfaces:** `inviteSpaceMember(spaceId: string, userId: string): Promise<void>` calls `invite_general_space_member`; `InviteToSpaceDialog` accepts optional `invite?: (spaceId: string, userId: string) => Promise<void>` defaulting to the existing `inviteToSpace`. `SpaceInvitation` and `MySpaceInvitation` gain `invited_level: GeneralLevel`.

- [ ] **Write a failing focused check** for the shared dialog calling its injected invite function with the selected person and space; confirm RED before adding the prop. Keep the test in `src/components/general/InviteToSpaceDialog.test.ts` with installed happy-dom/ReactDOM only.
- [ ] **Implement** **Invite a member** beside **Add a co-owner** for an active work-space Owner. Use the regular search and new RPC in the first dialog, keep the existing co-owner search/dialog, label pending Owner versus Member invitations in Members and Inbox, and keep class behavior unchanged. Copy says joining a space does not grant project access.
- [ ] **Run** focused Vitest, full `npm run test`, `npm run lint`, `npm run build`, and `python -m graphify update .`; expect passes apart from documented baseline warnings. Review the diff, stage only named files and commit `feat: invite space members from Members`.

## Final verification

- Review both task diffs and the whole branch. Check SQL return-column order against TypeScript types and the existing class invite path.
- In an owner-signed-in browser, check both invite buttons, pending labels, acceptance as Member, project invisibility, co-owner behavior, and phone layout. The owner signs in; the agent does not.
