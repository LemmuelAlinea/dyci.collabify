# Project Settings, phase 2 group 1 — General and Danger zone (design)

Date: 2026-11-01. Source: the owner's "Project Settings Recommendations 1–5" PDF,
section A (General) and G (Archive & Danger Zone). Phase 1
(`2026-11-01-project-settings-design.md`) is live. The owner's goal is to build
everything the PDF recommends, group by group, in the PDF's priority order:
1) General + Danger zone (this document), 2) Task Management, 3) Members &
Permissions, 4) Milestone Management, 5) Notifications, 6) Workflow rules.

## Decided by the owner

- **Color**: a swatch from a fixed set; shows on project cards (space list and
  Home), the sidebar Quick access square (replacing the letter), and as the
  accent of the project banner. Projects without a choice keep today's look.
- **Icon**: picked from Collabify's own icon set (`components/ui/Icon.tsx`),
  not emoji. Same three places as the color.
- **Default view**: which tab opens first (Overview, Plan or Tasks). One
  setting per project, set by the project manager, for everyone.
- **Visibility**: Private (today: members and space Owners) or Workspace
  (every member of the space can open the project read-only, like a
  stakeholder). Writes still need membership.
- **Ask to join**: a space member viewing a Workspace project they are not on
  sees an "Ask to join" button. The request appears for the project manager
  and coordinators in Settings → Members & permissions, who approve (choosing
  the role, within the existing role-change rules) or decline. Both sides are
  notified.
- **Delete project**: in the Danger zone, only after the project is archived,
  confirmed by typing the project name. Project manager only (the existing
  `delete_general_project` already requires an Owner and an archived project).
- **Transfer ownership**: in the Danger zone, opening the existing Hand over
  dialog.

## My calls (owner to check)

1. Swatches: navy, amber, green, teal, violet, rose, orange, slate — each
   defined as tokens in `src/styles/index.css` for light and dark (no raw hex in
   components).
2. About 20 icons from the existing `Icon` set (website/globe, code, book,
   chart, megaphone, calendar, folder, users, target, kanban, file, message,
   shield, check, pin, history, settings, …), only ones that already exist.
3. New `general_projects` columns: `color text`, `icon text`,
   `default_view text check in ('overview','plan','tasks') default 'overview'`,
   `visibility text check in ('private','workspace') default 'private'`. Edited
   through the existing General form (`edit_project`).
4. Visibility is enforced in `can_read_general_project` (owned by
   `project-visibility.sql`): add "or the project is Workspace and the reader is
   a space member" for work projects. Every reader already goes through that
   function. Non-member viewers reuse the existing read-only "watching from the
   space" path; the release boundary for private planning tasks is unchanged.
5. Join requests: new table `general_join_requests` (project, user, status
   open/approved/declined, answered_by, answered_at, chosen role), one open
   request per person per project, RPCs to request, withdraw and answer, and
   two notification types (request received; request answered). Approving adds
   the member with the chosen role.
6. Opening a project with no `tab` in the URL goes to its default view; links
   that name a tab are unchanged.
7. New SQL goes in one new file after the current chain (before
   `anon-lockdown.sql`), and `docs/07-backup.md` records it.

## Non-goals

Anything from groups 2–6. No free color picker. No change to class boards.

## Constraints

Same as phase 1: tokens only, copy rules, desktop → tablet → phone,
idempotent SQL, owner reviews before any live SQL or push.
