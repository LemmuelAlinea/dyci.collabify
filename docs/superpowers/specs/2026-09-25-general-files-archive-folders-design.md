# General files, archive and folders — design

Date: 2026-09-25. Scope: the General workplace, inside a project. Three independent
pieces, built in this order.

## Findings that shaped this

- Task archive already exists: "Archive task" at the bottom of `TaskDialog.tsx`, gated by
  `archive_general_task` (creator before anyone takes it, or `manage_tasks`). Archived
  tasks already reach `ProjectArchive.tsx`.
- Withdrawing a review request already exists (`withdrawRepoChange`), but only inside an
  expanded `RepoChangeRow`, with no confirmation.
- The draft 3-dot menu (`DraftActionMenu`) is `absolute` inside the row, so the row's
  container clips it. Only two 3-dot menus exist: `DraftPanel.tsx`, `MessageBubble.tsx`.
- Folders are implicit path prefixes. `general_draft_files_path_shape` rejects a path
  ending in `/`, so an empty folder cannot exist today.
- Archived tasks are read from `general_task_overview` directly, which every project
  reader can query — a UI-only filter would leak.

## Part 1 — quick fixes (no database changes)

**ActionMenu.** New `src/components/ui/ActionMenu.tsx`: trigger plus a panel rendered
through `createPortal` to `document.body`, positioned from the trigger's
`getBoundingClientRect`, repositioned on scroll/resize, closed on outside click and
`Escape`, focus returned to the trigger. Trigger colour `text-ink/70`, `dark:text-white/80`,
hover `text-ink`. Replaces `DraftActionMenu` and the `MessageBubble` menu, and is used by
every new menu below.

**Project archive.** Each row's Restore and Delete buttons move into an `ActionMenu`.
Delete keeps its `ConfirmDialog`.

**Withdraw a request.** On your own open change, an `ActionMenu` on the collapsed row with
"Withdraw request". Confirmation: title "Withdraw this request?", body "The reviewer will
no longer see it. Your draft keeps the files.", confirm "Withdraw request". Uses
`withdrawRepoChange`.

**For review sections.** Three groups, empty ones hidden:
1. Submitted by me — `author_id = me`
2. Submitted to me — `reviewer_id = me`
3. Other open requests — everything else, collapsed by default

**Search.** One search input above the tab content, filtering the active tab; cleared on
tab change.

| Tab | Matches on |
|---|---|
| Main, My draft | path, across the whole tree (results listed flat with their folder) |
| For review | title, author name, paths |
| History | message, author name |

**Task archive placement.** "Archive task" moves from the dialog's foot into its header
actions. Permission unchanged.

## Part 2 — archive visibility

Rule: an archived item is visible to whoever archived it, and to the project's Owners and
Managers. Enforced in the database.

New file `supabase/general-archive-rbac.sql`, idempotent, redefining — not editing the
older files:

- `general_task_overview`: add
  `t.archived_at is null or t.archived_by = auth.uid() or <owner or manager>`.
  Stays `security_invoker`.
- `list_archived_general_task_files`, `list_archived_general_draft_files`: same predicate.
- `list_removed_general_repo_paths`: "own" is the author of the removing commit.
- Every `restore_archived_*` and `delete_archived_*` function, single and bulk, acts only
  on rows the caller may see under that rule.

Register the file in `scripts/schema-drift.mjs` after `general-spaces` and in
`docs/07-backup.md`.

Tests, `supabase/tests/general-archive-rbac.test.sql`:
- a member does not see another member's archived task, task file or removed path
- an Owner and a Manager do
- the archiver sees their own
- a member's bulk restore and bulk delete leave other members' items untouched
- a member cannot delete someone else's archived item by id

## Part 3 — folders

**Navigation.** Main and My draft browse one folder at a time. The folder is in the URL:
`?tab=files&view=draft&path=Chapter%201/Figures`. Breadcrumbs above the list, every
segment a link, the root named after the tab. A folder's page shows its name, a Rename
action, and an `ActionMenu` with Submit for review and Archive. An empty folder shows
"This folder is empty" with a **+ New** button. A stale `path` in the URL falls back to
the tab root.

**+ New.** The header button becomes "+ New" and opens a modal with three choices:

- New folder — asks for a name, then creates `<current>/<name>/.keep` in the caller's
  draft.
- Upload a file — the existing single-file upload.
- Upload a folder — the existing folder upload.

Everything lands in the folder being viewed; the free-text path field is removed. A
picked file's name stays editable. Folder name: 1–120 characters, no `/`, no `..`, not
already used in that folder. Error copy example: "A folder called Figures is already here.
Pick another name."

**`.keep`.** `buildTree`, file counts, search results and diff views skip any path whose
last segment is `.keep`. Submit, review, merge, archive, restore and delete treat it as an
ordinary file, which is what makes a site-made folder and an uploaded folder behave the
same.

**Rename.** New RPC `rename_general_draft_folder(p_repo uuid, p_from text, p_to text)`,
`security definer`, `set search_path = public`, revoked from `public, anon`, one
transaction:

- Folder only in the caller's draft: move every draft path under `p_from` to `p_to`.
- Folder present in Main: for every Main file under `p_from`, write a delete draft entry
  for the old path and an add entry for the new path, carrying the same content or
  `storage_path`. The caller then submits it for review. Main never changes without
  review.
- Raises when `p_to` collides with an existing path in the draft or Main, or when either
  path fails the existing path-shape rules.

Check before building: that a draft entry reusing another path's `storage_path` still
reads under the General files storage policy, and survives the original draft row being
archived or deleted.

Tests, added to the same archive test file or a new `general-folders.test.sql`:
- rename a draft-only folder
- rename a Main folder into a draft move
- name collision refused
- a stranger cannot rename another member's draft

## Out of scope

- Moving a single file between folders (rename covers folders only).
- Drag and drop.
- Folder navigation anywhere outside a General project's Files tab.

## Verification

- `npm run build` green; lint holds at the current baseline.
- `node scripts/db.mjs supabase/general-archive-rbac.sql` twice, second run a no-op.
- New test suites pass; existing suites still pass.
- Browser, signed in, two accounts, both themes, 375px and 1440px: menus not clipped with
  folders closed, archive visibility per account, withdraw confirmation, three review
  sections, search on all four tabs, new folder, both renames, breadcrumbs and Back button.
