# Company roles, phase 3: stakeholders — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn on the Stakeholder role for work projects:
- read-only everywhere, enforced by the database;
- kept out of project chat and the discussion;
- a Feedback tab with statuses and notifications;
- a slim sidebar with a stakeholder Home.

**Architecture:**
- Today every member write gate is `is_general_member`, which also drives
  reads, so it cannot be narrowed.
- A new helper, `general_can_write(p_project)`, means "a member who is not a
  stakeholder". It is wired into each write chokepoint from a new late SQL
  file.
- Feedback lives in its own tables, bucket and RPCs, in a second new file.
- The frontend adds a `readOnly` flag, the Feedback tab, the stakeholder
  role in the Members tab, and a stakeholder-only sidebar and Home.

**Tech stack:** React 19 + TypeScript + Vite, Supabase (Postgres RLS,
plpgsql, Storage), Vitest, SQL tests via `node scripts/db.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-23-company-roles-design.md`, the
"Stakeholders" section and rollout phase 3. QA is phase 4 and out of scope.

## Global constraints

- `supabase/*.sql` must stay idempotent.
- **New files.** Append the new files `project-stakeholders.sql` and then
  `project-feedback.sql`, in that order, after `project-team-leads.sql`:
  - in both rebuild lines of `docs/07-backup.md` (26 and 53);
  - in `scripts/schema-drift.mjs` ORDER;
  - with a re-run paragraph per file in `docs/07-backup.md` that names what
    it owns and which earlier files' re-runs require it.
- **Redefining functions.** Start from the LIVE definition
  (`pg_get_functiondef` / `pg_policies` via node + pg + dotenv `quiet:true`)
  and change only what the task lists.
  - The new code needs `general_members.role`, which exists only from
    `project-roles.sql` on, so older files are never edited to reference it.
  - Re-run `anon-lockdown.sql` after applying anything.
- **Scope.** Work projects only (`class_board_id is null`). Class-board
  Files projects keep today's model; their rows are all role `member`, so
  `general_can_write` = `is_general_member` there.
- **Exact names fixed by this plan:**
  - SQL helper: `general_can_write(p_project uuid) returns boolean`
  - Enums:
    - `general_feedback_kind` (`'input','concern','approval_request'`)
    - `general_feedback_status` (`'open','acknowledged','resolved'`)
  - Tables: `general_feedback`, `general_feedback_replies`,
    `general_feedback_files`
  - Storage bucket: `feedback-files`
  - RPCs:
    - `create_general_feedback(p_project uuid, p_kind general_feedback_kind, p_title text, p_body text, p_paths text[] default '{}') returns uuid`
    - `reply_general_feedback(p_feedback uuid, p_body text, p_paths text[] default '{}') returns uuid`
    - `set_general_feedback_status(p_feedback uuid, p_status general_feedback_status)`
    - `my_stakeholder_projects()`
  - `notification_type` values: `'feedback_posted'`, `'feedback_reply'`,
    `'feedback_status'`
  - Frontend:
    - project tab id `'feedback'`
    - `useGeneralProject().readOnly`
    - `src/lib/api/feedback.ts`
    - `src/components/general/FeedbackTab.tsx`
    - `src/pages/app/StakeholderHome.tsx`
    - `Membership.allStakeholder`
- **Copy:**
  - Feedback types: Input · Concern · Approval request
  - Statuses: Open · Acknowledged · Resolved
  - Sentence case, active voice, no exclamation marks, no "please", no
    "successfully". Errors say what happened and what to do next.
  - The stakeholder refusal everywhere: *"Stakeholders can view this
    project but not change it."*
- **UI.** Use design tokens (status ramps: Open = `pending-*`, Acknowledged =
  `warning-*`, Resolved = `success-*`). Desktop first, then tablet, then
  phone. `localStorage` only inside try/catch.
- **Who sets the stakeholder role:**
  - The PM can make anyone except themself a stakeholder.
  - A coordinator can switch people between Member and Stakeholder, and can
    invite as Member or Stakeholder.
  - QA stays refused until phase 4, with the existing message.
- Run `npm run build` before claiming anything works.

## Review focus

1. **A stakeholder calling the API directly** cannot create, edit, claim,
   comment on, archive or log tasks; upload files; draft, submit or share;
   comment on reviews; schedule project meetings; or ask for grants. Each
   case is refused with the stakeholder message. *(Task 1.)*
2. **Changing someone's role to Stakeholder** removes them from the project
   chat and the discussion at once (read and write). Changing them back to
   Member restores both. *(Task 2.)*
3. **A plain member** (not PM, coordinator or stakeholder) cannot post
   feedback or reply, but can read it. A stakeholder cannot change a status.
   *(Task 3.)*
4. **On an archived project**, feedback is read-only for everyone. *(Task 3.)*
5. **A teacher, student or Project-manager-enabled person** who is also a
   stakeholder somewhere keeps the normal sidebar. Only someone whose every
   role is Stakeholder, with no classes and no switches, gets the slim one.
   *(Task 6.)*

---

### Task 1: `project-stakeholders.sql`, read-only enforcement of member writes

**Files:**
- Create: `supabase/project-stakeholders.sql`,
  `supabase/tests/project-stakeholders.test.sql`. Test style: copy
  `supabase/tests/project-roles.test.sql`, with `act_as`,
  `must_refuse_with` and paired allowed cases. Create the stakeholder
  fixture with a service-role update of `general_members.role`.
- Modify: `docs/07-backup.md` (both lines and the re-run paragraph),
  `scripts/schema-drift.mjs`.

**Interfaces:**
- Produces: `general_can_write(p_project uuid) returns boolean`.
  - It is `security definer stable` with `search_path = public`.
  - It returns true when the caller is an active member of the project and,
    for a work project, their role is not `stakeholder`.
  - Grant it to `authenticated`.
- Every refusal below raises *"Stakeholders can view this project but not
  change it."* with errcode `insufficient_privilege` when the caller is a
  stakeholder. Non-member refusals keep their existing messages.

**Gates to change** (live line refs from recon; verify each live). In each,
replace or extend the `is_general_member` test with `general_can_write`:

| Area | Objects |
|---|---|
| Tasks | policies `general_tasks_insert`, `general_tasks_update`, `general_tasks_delete`; triggers `guard_general_task`, `sync_general_task_stage`, `guard_general_task_plan` (member branch); `guard_general_task_child` |
| Task children | policies `general_task_assignees_insert` / `_delete` (the self branch), `general_task_comments_insert` / `_update` / `_delete`, `general_task_files_insert`, `general_task_logs_insert` / `_delete` |
| Archive / trash | `archive_general_task`, `general_archive_guard`, and the `is_general_member` checks in `trash.sql` (`:301`, `:585`, `:598`, `:740`, `:750`) |
| Drafts and review | policy `general_drafts_own` (write side: split into a SELECT using `is_general_member` and an INSERT/UPDATE/DELETE using `general_can_write`); `my_general_draft`, `submit_general_draft`, `submit_general_draft_file`, `submit_general_draft_folder`, `commit_general_draft_path`; policies `general_repo_changes_insert`, `general_repo_comments_insert`; `general_review_reviewers` excludes stakeholders |
| Shares | `share_general_draft_path`: the sender must pass `general_can_write`, and stakeholder recipients are refused (*"Stakeholders can't receive shared files."*). `copy_general_share_to_draft` |
| Storage | `general_project_files_write`, `general_files_write` |
| Access requests | `request_general_access`: refuse role `stakeholder`, and also `qa` (*"QA can't ask for more access."*) |
| Meetings | `create_meeting`: scope `project` and `project_team` need `general_can_write`. `meeting_audiences`: `can_create` false for projects where the caller is a stakeholder |

Unchanged: `leave_general_project`, `join_general_project` (always joins as
member), every read path, and anything already gated by
`general_has`/`general_can`.

**Tests** (`project-stakeholders.test.sql`). Fixture: work project P with
PM, member M, stakeholder S, and one task held by M:
- S inserts a task: refused with the stakeholder message. M inserts a task:
  allowed.
- S updates M's task title: refused.
- S self-claims an unheld task: refused. M self-claims: allowed.
- S comments on a task: refused. M comments: allowed.
- S inserts a task log: refused.
- S uploads to `<P>/files/x.txt` in `general-files`: refused. M: allowed.
- S calls `my_general_draft(P)` or inserts a draft: refused.
- S calls `submit_general_draft`: refused.
- S inserts a review comment: refused.
- PM shares a draft path with S: refused with the share message.
- S calls `create_meeting` with project scope: refused.
- `meeting_audiences` for S has `can_create = false` on P.
- S calls `request_general_access(P, 'edit_files', …)`: refused.
- S archives a task they created before becoming a stakeholder: refused.
- S can still read P, its tasks, comments, files, sprints and milestones,
  and can leave P.
- A class-board project member keeps every write they had (pick one task
  insert and one comment from the existing class-board fixture pattern).

- [ ] **Step 1:** Write the test and run it. Expected: FAIL (no
  `general_can_write`).
- [ ] **Step 2:** Write the file.
- [ ] **Step 3:** Apply it:
  `node scripts/db.mjs supabase/project-stakeholders.sql supabase/anon-lockdown.sql`.
  Apply a second time; the re-run must change nothing.
- [ ] **Step 4:** The test → PASS. Run every `supabase/tests/*.test.sql` →
  PASS (class-files' 2 known live-data notices excepted).
  `node scripts/schema-drift.mjs` → no new suspects.
- [ ] **Step 5:** `npm run build`. Commit and push.

### Task 2: Discussions, project chat, spaces, and turning the role on

**Files:**
- Modify: `supabase/project-stakeholders.sql` (append),
  `supabase/tests/project-stakeholders.test.sql`.

**Interfaces:**
- Consumes: `general_can_write` (Task 1).
- Produces:
  - `set_general_member_role` and `invite_to_general_project` accept
    `'stakeholder'`.
  - Stakeholders are excluded from discussions and the project chat.

**Rules:**
- **Discussions.**
  - Reads: `general_discussion_folders_read`, `general_discussions_read`,
    `general_discussion_messages_read`, `general_discussion_polls_read`,
    `_poll_options_read`, `_poll_votes_read`, `general_discussion_files_read`
    and storage `discussion_voice_readable`.
  - Writes: `general_discussion_check`, `discussion_voice_path_ok`.
  - Replace `is_general_member` with `general_can_write` in all of them.
  - `notify_discussion_started` skips stakeholders.
- **Project chat.**
  - Redefine `sync_general_conversation_member` so that:
    - an INSERT of a stakeholder adds no chat row;
    - an UPDATE OF role to `stakeholder` deletes their row for that
      project's conversation;
    - an UPDATE away from `stakeholder` re-adds it (`on conflict do
      nothing`);
    - a DELETE removes it, as today.
  - Recreate trigger `general_members_conversation` as
    `after insert or update of role or delete`.
  - Cleanup statement: delete `conversation_members` rows of current
    stakeholders (live count 0).
- **Spaces.** The add-to-space trigger (`project-visibility.sql:~94`) does
  not add a stakeholder to the space. *(My call: space membership would
  let them create space meetings and shared templates; a stakeholder needs
  only the project.)* Becoming a stakeholder later does not remove existing
  space membership; the spec never removes space membership.
- **Turning the role on.**
  - `set_general_member_role`:
    - the PM may set `stakeholder` on anyone but themself (a coordinator
      too);
    - a coordinator may switch Member ↔ Stakeholder, but not touch
      coordinators or the PM;
    - moving to `stakeholder` deletes grants and withdraws requests, as
      leaving Member already does;
    - moving away from Member already clears a team leadership through the
      Task 4 trigger of phase 2, so check that it fires.
  - `invite_to_general_project`: the PM may invite as
    member/coordinator/stakeholder; a coordinator as member/stakeholder.
  - `qa` stays refused with the existing message.
  - `join_general_project` with a pending stakeholder invitation joins as
    stakeholder; this follows from phase 2's "keep the invitation's role".

**Tests:**
- PM sets M to stakeholder: allowed. M's chat row is gone, M's
  `general_discussions` select returns 0 rows, and M posting a discussion
  message is refused.
- PM sets them back to member: the chat row is back, and discussions are
  readable again.
- Coordinator sets a member to stakeholder: allowed. Coordinator sets a
  coordinator to stakeholder: refused.
- PM invites X as stakeholder; X accepts: X's role is `stakeholder`, X has
  no chat row, and X is not added to the space. PM invites as `qa`: refused.
- A stakeholder who led a team: `leader_id` is cleared when they become a
  stakeholder.
- Moving a member who had grants to stakeholder deletes their grants.

- [ ] **Step 1:** Add the tests and run them. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Apply twice with anon-lockdown.
- [ ] **Step 4:** Run the test plus `general-discussions*`, `messages*`,
  `general-notify*`, `project-roles`, `project-visibility` and
  `project-team-leads` → PASS. `schema-drift` → clean.
- [ ] **Step 5:** `npm run build`. Commit and push.

### Task 3: `project-feedback.sql`, Feedback storage, RPCs, notifications

**Files:**
- Create: `supabase/project-feedback.sql`,
  `supabase/tests/project-feedback.test.sql`.
- Modify: `supabase/storage-sweep.sql` (add bucket `feedback-files` and
  `general_feedback_files.path` to the `used` set; it runs earlier in the
  rebuild order, so add a re-run note), `docs/07-backup.md`,
  `scripts/schema-drift.mjs`.

**Interfaces:**
- Consumes: `general_role_of`, `general_can_write`, `is_general_member`.
- Produces: the enums, the tables, the bucket, the three RPCs and the
  notification types.

**Schema:**
- `general_feedback`:
  - `id uuid pk`
  - `project_id uuid not null references general_projects on delete cascade`
  - `author_id uuid not null references profiles`
  - `kind general_feedback_kind not null`
  - `title text not null check (char_length(btrim(title)) between 1 and 120)`
  - `body text not null check (char_length(body) between 1 and 4000)`
  - `status general_feedback_status not null default 'open'`
  - `status_changed_by uuid`, `status_changed_at timestamptz`
  - `created_at timestamptz not null default now()`
  - index on `(project_id, status, created_at desc)`
- `general_feedback_replies`:
  - `id`, `feedback_id … on delete cascade`, `project_id`, `author_id`
  - `body` (1–4000)
  - `created_at`
- `general_feedback_files`:
  - `id`, `feedback_id`, `reply_id` (nullable), `project_id`
  - `path` (unique), `name`, `size_bytes`
  - `created_at`
- RLS:
  - SELECT on all three = `is_general_member(project_id)`, so every role
    reads, stakeholders included.
  - No direct writes; RPCs only.
- Bucket `feedback-files`:
  - private, 25 MB
  - path `<project>/<feedback>/<uuid>-<safe-name>`
  - insert allowed for a caller whose role on `<project>` is
    pm/coordinator/stakeholder
  - read = `is_general_member` of the project
  - copy the `discussion-files` policies and adapt them

**RPCs** (security definer; a work project only; refuse on archived:
*"This project is archived. Its feedback is read-only."*):
- **`create_general_feedback`**
  - The caller's role must be pm, coordinator or stakeholder. Otherwise:
    *"Only stakeholders, the project manager and coordinators post
    feedback."*
  - Title and body are trimmed and checked.
  - Each path must exist in `storage.objects` (bucket `feedback-files`,
    `owner_id = auth.uid()`, prefix `<project>/`) before a file row is
    inserted, as `send_general_discussion_files` does.
  - Returns the id.
- **`reply_general_feedback`**: same roles and the same file rules (rows
  carry `reply_id`). Returns the reply id.
- **`set_general_feedback_status`**
  - The caller's role must be pm or coordinator. Otherwise: *"Only the
    project manager and coordinators change a feedback status."*
  - Any status → any status.
  - Sets `status_changed_by` and `status_changed_at`.
  - No-op if unchanged.

**Notifications** (enum values added in their own committed block, as in
`general-notify.sql:24-37`):
- `feedback_posted`: on insert of `general_feedback`, notify the project's
  pm and coordinators except the author.
- `feedback_reply`: on insert of a reply, notify the post's author unless
  they wrote the reply.
- `feedback_status`: on a status change, notify the post's author unless
  they made the change.
- Fill `general_project_id`. Title and preview:
  - posted: *"New feedback: {title}"*
  - reply: *"{name} replied to {title}"*
  - status: *"{title} is now {status label}"*
- Respect `notification_prefs.project_updates`, as
  `notify_discussion_started` does.

**Tests** (`project-feedback.test.sql`). Fixture: PM, coordinator C, member
M, stakeholder S:
- S creates a Concern: allowed, and PM and C each get one `feedback_posted`
  row. M creates: refused with the role message. PM creates: allowed, and C
  gets a row but PM does not.
- M reads the feedback: allowed. S reads PM's post: allowed.
- C replies to S's post: S gets `feedback_reply`. S replies to their own
  post: no notification to S.
- C sets status `acknowledged`: S gets `feedback_status`. S sets status:
  refused with the status message.
- Title of 121 chars: refused. Empty body: refused.
- A file path not owned by the caller, or under another project's prefix:
  refused.
- Archive the project, then S posts: refused with the archived message.
- An outsider selects `general_feedback`: 0 rows.

- [ ] **Step 1:** Write the test and run it. Expected: FAIL.
- [ ] **Step 2:** Write the file and update the sweep.
- [ ] **Step 3:** Apply `project-feedback.sql`, then the sweep file, then
  anon-lockdown, all in rebuild order. Apply `project-feedback.sql` twice.
- [ ] **Step 4:** Run the test, `storage-sweep*`, `rls-coverage` and
  `anon-lockdown` → PASS. `schema-drift` → clean.
- [ ] **Step 5:** `npm run build`. Commit and push.

### Task 4: Read-only project UI and the Stakeholder role in the Members tab

**Files:**
- Modify:
  - `src/components/general/useGeneralProject.ts` (add
    `readOnly = archived || myRole === 'stakeholder'`)
  - `src/lib/general/permissions.ts` (`assignableRoles`, invite roles,
    `ROLE_MATRIX` Feedback rows lose their "later" caption)
- Modify the write-control sites listed by recon, swapping `state.archived`
  for `state.readOnly` where it gates a write:
  - `TasksTab.tsx:208,228`
  - `TaskDialog.tsx:136,197,250,359`
  - `workSource.ts:57,62`
  - `FilesTab.tsx:225`
  - `DraftPanel.tsx:142,157,229,256`
  - `FileEditor.tsx:167`
  - `RepoChangeRow.tsx:75,154,270,292,327`
  - `SharedTab.tsx:159`
  - `DiscussionTab.tsx:142`
- Modify: `src/pages/general/GeneralProject.tsx`. Hide the Discussion and
  "Shared with me" tabs for stakeholders, and redirect those tab ids to
  Overview.
- Modify: `src/components/general/MembersTab.tsx`, `InvitePanel.tsx` (role
  options from the updated helpers).
- Test: `src/lib/general/permissions.test.ts`.

**Interfaces:**
- Produces:
  - `useGeneralProject().readOnly: boolean`
  - `assignableRoles(actor, target)`:
    - PM, non-PM target → `['coordinator','member','stakeholder']`
    - coordinator, member/stakeholder target → `['member','stakeholder']`
    - else `[]`
  - `inviteRoles(actor: ProjectRole): ProjectRole[]`:
    - PM → `['member','coordinator','stakeholder']`
    - coordinator → `['member','stakeholder']`
    - else `[]`

**Steps:**
- [ ] **Step 1:** Tests:
  - `assignableRoles('pm','member')` equals
    `['coordinator','member','stakeholder']`
  - `assignableRoles('coordinator','stakeholder')` equals
    `['member','stakeholder']`
  - `assignableRoles('coordinator','coordinator')` equals `[]`
  - `inviteRoles('coordinator')` equals `['member','stakeholder']`
  - The Feedback rows of `ROLE_MATRIX` have no `later` caption.

  Run `npx vitest run src/lib/general/permissions.test.ts`. Expected: FAIL.
- [ ] **Step 2:** Implement. A read-only stakeholder sees a one-line note at
  the top of the project: *"You're a stakeholder here. You can view
  everything and post in Feedback."* (`Alert` tone info).
- [ ] **Step 3:** `npx vitest run` → PASS. `npm run build` → clean.
- [ ] **Step 4:** Commit and push.

### Task 5: Feedback tab

**Files:**
- Create: `src/lib/api/feedback.ts`, `src/components/general/FeedbackTab.tsx`
  (split the list, composer and thread into sibling files if it grows
  past ~300 lines), `src/lib/general/feedback.ts` (labels, status tones,
  pure helpers).
- Modify:
  - `src/lib/general/navigation.ts` (add `'feedback'` to `GeneralTabId` and
    `TABS`)
  - `src/pages/general/GeneralProject.tsx` (tab after Discussion, shown to
    every role on work projects, hidden on class-board projects)
  - `src/lib/types.ts` (notification union)
  - `src/components/app/NotificationBell.tsx` (`destination()` for the
    three types → `${paths.project(id)}?tab=feedback`)
- Test: `src/lib/general/feedback.test.ts`.

**Interfaces:**
- Consumes: Task 3's RPCs and tables.
- Produces, in `src/lib/general/feedback.ts`:
  - `FEEDBACK_KIND_LABEL`, `FEEDBACK_STATUS_LABEL`
  - `feedbackStatusTone(status): 'pending' | 'warning' | 'success'`
  - `canPostFeedback(role: ProjectRole | null): boolean` (pm, coordinator,
    stakeholder)
  - `canSetFeedbackStatus(role): boolean` (pm, coordinator)
- Produces, in `src/lib/api/feedback.ts`:
  - `listFeedback(projectId)`, returning posts with reply count and files
  - `getFeedbackThread(feedbackId)`
  - `createFeedback(projectId, kind, title, body, files: File[])`
  - `replyFeedback(feedbackId, body, files)`
  - `setFeedbackStatus(feedbackId, status)`
  - Files upload first to `feedback-files` at
    `<project>/<feedback-or-new-uuid>/<uuid>-<safe-name>`. To get the
    feedback id before posting, create a client UUID for the path segment
    and pass the paths; the RPC only checks the project prefix and the
    owner.

**UI:**
- **List.**
  - A status filter (All · Open · Acknowledged · Resolved), defaulting to
    Open.
  - Rows show the kind chip, title, author with `PersonBadge`, created
    date, reply count and status chip.
  - Empty state: *"No feedback yet. Stakeholders, the project manager and
    coordinators can post here."*
- **New feedback** (only when `canPostFeedback(myRole)` and not archived):
  - kind select, title, body, optional attachments (25 MB each)
  - submit label "Post feedback"
- **Thread.**
  - Body, attachments (signed URLs), and replies with badges.
  - The reply box shows for the posting roles.
  - The status select shows for PM and coordinators.
  - Errors go through `authErrorMessage` into a toast.
- Desktop: list and thread side by side. Phone: the thread replaces the
  list, with a back link.

**Tests** (`feedback.test.ts`):
- `canPostFeedback('member')` is false; true for `'stakeholder'`.
- `canSetFeedbackStatus('stakeholder')` is false; true for
  `'coordinator'`.
- `feedbackStatusTone('resolved')` is `'success'`.

- [ ] **Step 1:** Write the tests and run them. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** `npx vitest run` → PASS. `npm run build` → clean.
- [ ] **Step 4:** Check in a temporary harness with mocked data (delete it,
  don't commit), at desktop and 375 px, light and dark.
- [ ] **Step 5:** Commit and push.

### Task 6: Slim sidebar and stakeholder Home, then hand off

**Files:**
- SQL: append `my_stakeholder_projects()` to `project-feedback.sql`.
  - It is `security definer stable`.
  - It returns, for the caller's live work projects where their role is
    `stakeholder`: `project_id`, `name`, `space_name`, `progress_pct` (done
    tasks over all, 0 when none), `next_milestone_name`,
    `next_milestone_due` (the earliest unreached milestone due today or
    later, else null), and `open_feedback` (count of open items).
  - Re-apply, and add a test case to `project-feedback.test.sql`.
- Modify: `src/lib/access.ts` (`Membership.allStakeholder?: boolean`,
  computed in `membershipOf` from `myProjects`: the live projects with
  `my_level` all have `my_role === 'stakeholder'`, and there is at least
  one).
- Modify: `src/components/app/nav.ts` (`navFor`), `src/pages/Home.tsx`.
- Create: `src/pages/app/StakeholderHome.tsx`.
- Modify: `handoff.md` (new section in house style), `CLAUDE.md` (phase 3
  live, the new files' re-run rule, phase 4 next).
- Test: `src/components/app/nav.test.ts`, `src/lib/access.test.ts`.

**Interfaces:**
- Consumes: `my_stakeholder_projects()`.
- Produces: the slim rail
  `[ {Home, Projects, Inbox, Calendar}, ACCOUNT ]`. Reuse existing
  constants and labels. Projects → `paths.projects`, Calendar →
  `paths.calendar`.

**Rule** (spec plus the phase-1 ruling). Slim when **all** of these hold:
- `membership.allStakeholder`
- not `inClass`
- not `canTeach(profile)`
- not `canManageProjects(profile)`
- role is not admin

Otherwise the existing rails apply. `Home.tsx` renders `StakeholderHome`
under the same condition, after the existing waiting-home branch.

**StakeholderHome:**
- A banner (`.banner-fill`) with *"Your projects"* and a one-line intro.
- One card per project: name, space, progress bar (`ProgressBar` from
  `MilestoneBits`), next milestone (name and date, or "No milestone set"),
  and an open-feedback count linking to `?tab=feedback`.
- Desktop: a grid of cards. Phone: one column.

**Tests:**
- `membershipOf` with two live projects both `my_role: 'stakeholder'` →
  `allStakeholder` true. With one stakeholder and one member project →
  false.
- `navFor(member without switches, true, { inClass:false, hasWork:true, allStakeholder:true })`
  → labels Home, Projects, Inbox, Calendar, then Account's labels.
- Same with `can_teach: true` → the normal teaching rail.
- Same for a student → the normal student rail.

- [ ] **Step 1:** Write the tests and run them. Expected: FAIL.
- [ ] **Step 2:** Implement the SQL, nav, Home and StakeholderHome.
- [ ] **Step 3:** `npx vitest run`, `npm run build`, `npx eslint src` →
  clean. All SQL tests → PASS. `schema-drift` → clean.
- [ ] **Step 4:** Write the handoff section:
  - What, files, Checked
  - Still to check by you: a live walk as a stakeholder (make a test
    account a stakeholder on a project), and posting, replying to and
    changing the status of feedback
  - Deferred
  - Next = phase 4 (QA)

  Update `CLAUDE.md`.
- [ ] **Step 5:** Commit and push.
