# Space settings and space roles

Status: awaiting approval. Date: 2026-11-10.

## Why

A work space and a project inside it use two different role languages: Owner, Manager and
Member in the space, then Project manager, Coordinator, Member, QA and Stakeholder in the
project. Someone who coordinates a whole space has to be set by hand on each project. The
space's admin pages are also spread across the top tabs, while a project keeps them in one
Settings tab.

This change gives a work space the same role language as its projects, makes a space role
carry into the person's projects, and moves the space's admin pages into a Settings tab
that works like a project's.

## Scope

In scope: work spaces only (`general_spaces.kind = 'work'`).

Not in scope:

- Class spaces. They redirect to the class page and keep Owner, Manager and Member.
- Project Settings, and the project role rules themselves.
- The account switch `can_manage_projects`, which still decides who may create projects.
- Reports, which stays a top tab.

Failures to avoid:

- Launch must not change anyone's project role.
- A project must never lose or gain a Project manager through a space role change.
- A non-PM must not gain any read of a project they are not on.

## Decisions by the owner

### Tabs and layout

The space's top tabs become Overview, Projects, Reports, Settings.

Settings has a left menu built like `components/general/settings/ProjectSettings.tsx`, with
four sections: Details, Teams, Members, Archive. The Details section holds what the
Settings tab holds today (name, description, archive or restore the space).

### Who sees and changes what

| Section | Space PM | Space Coordinator | Member, QA, Stakeholder |
|---|---|---|---|
| Details | Change | Change, but cannot archive or restore the space | Read only |
| Teams | Change | Change | Read only |
| Members | Change | Change, within the limits below | Read only, and can leave the space |
| Archive | Sees and acts | Sees and acts on projects they are allowed to | Section hidden |

### Space roles

- The space Owner is renamed Project manager, and Manager is retired for work spaces.
- A space has exactly one Project manager, changed through Hand over. Add a co-owner goes
  away. All 8 work spaces have exactly one Owner today.
- Everyone else has one of Coordinator, Member, QA, Stakeholder.
- A Coordinator can invite and remove people and move them among Member, QA and
  Stakeholder. Only the space PM makes or changes a Coordinator, matching the project rule.
- Students can hold all four roles. A student can never be the space PM.
- A space Coordinator reads only the projects they are on. The space PM keeps reading every
  project in the space, as an Owner does today.

### How a space role reaches projects

- Setting a space role updates every project the person is on now, and applies to projects
  they join later.
- A project's PM and Coordinators can still change that person's role in that one project
  afterwards. That change stands until the next space role change.
- A person who is PM of a project stays PM of it. A space role change never touches that row.
- The space PM added to a project someone else leads joins as Coordinator.
- Moving someone to QA or Stakeholder releases every task they hold in the affected
  projects, as the project rule already does, and QA turns on the QA gate in those projects.
  A confirm dialog appears first and states how many projects change and how many tasks are
  released. It is shown only when the change would release tasks or start a QA gate.

### Launch

The current Owner of each work space becomes its Project manager. Everyone else starts as
Member at the space level, and no project role changes. The 7 project Coordinators and 2
project Stakeholders stay as they are until someone sets a space role on purpose.

### Picking a role when adding someone

- Space invite has a role choice that starts on Member.
- Project invite starts on the person's space role, and the inviter can change it.
- Joining by code gives the space role directly. An invitation that is already pending wins,
  as it does today.

## Calls made by Claude (please check)

1. **Space role and level both exist.** A new `general_space_members.role` is the source of
   truth for work spaces, and a trigger derives `level` from it, the way
   `sync_general_member_level` does on projects: pm to owner, coordinator to manager, others
   to member. Existing checks on `level in ('owner', 'manager')`, such as
   `general_space_has_invite`, then keep working without being rewritten.
2. **Old links keep working.** `/spaces/:id/teams`, `/teams/archive`, `/members` and
   `/archive` open the matching Settings section. Links in Archive, Trash and notifications
   keep landing in the right place.
3. **Teams are changed only by the space PM and Coordinators.** Today anyone with the
   Project manager switch can create a team, and a team's own Owner or Manager can edit it.
   Those paths close, following "PM and Coordinator only to change". Team membership itself
   and a team's use on projects are unchanged.
4. **Teams become readable by everyone in the space.** Today only a team's own members and
   the space's Owners and Managers can read it, so the read rule widens for the read-only view.
5. **A Coordinator's space change leaves project Coordinators alone.** If a space Coordinator
   moves someone to QA, any project where that person is a Coordinator keeps them there,
   because only a PM changes a Coordinator. A change by the space PM updates those rows too.
6. **Archived projects are skipped.** A space role change does not rewrite roles in archived
   projects. They pick it up on the next space role change after being restored.
7. **People on a project but not in the space** have no space role and keep working as today.
8. **A project Coordinator may invite someone as Coordinator** when that is already the
   person's space role, because the space PM has made that decision. Other coordinator
   invites stay PM only.
9. **Space PM hand over** requires the new PM to be an active non-student with the
   `can_manage_projects` switch on, the same bar co-owners meet today. The former PM becomes
   a Coordinator. A hand over changes no project role for either person.

## What's left to the builder

- Exact SQL shape: a new file runs after `project-workflow-rules.sql` and before
  `anon-lockdown.sql`, and joins the rerun tail in `docs/07-backup.md`. Each redefinition
  starts from the live `pg_get_functiondef`.
- Whether the cascade lives in a new RPC that replaces `set_general_space_level`. It runs
  with its own authority, because a space Coordinator is often not on the projects it updates.
- Check every `level`-based space check for anything a `manager` level would newly open, in
  particular `project-visibility.sql` and `archive-page.sql`.
- A SQL suite in `supabase/tests/`, component tests for the sections, and the Copy style
  rules in `CLAUDE.md`.
- Desktop first, then tablet and phone, reusing the project menu's sideways scroll on phones.
- The `is_general_space_owner`-gated writes need moving to a PM-or-Coordinator check for
  details and teams. Archive or restore stays PM only.

## Done means

- A space shows Overview, Projects, Reports and Settings, and old links still land correctly.
- Each role sees exactly the table above, enforced in the database as well as in the app.
- Setting a space role changes the person's current projects, never a project PM row, and
  shows the confirm dialog when tasks would be released or a QA gate would start.
- A person joining later gets their space role.
- After launch, a query shows no `general_members.role` changed.
- `npm run build` and the SQL suite pass, and each role is walked through on the live data.
