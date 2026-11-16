# File history, revert and restore

## Intent

A group's Files can only move forward today: History lists commits and shows what each changed, but a bad
commit, a deleted chapter or an overwritten Word file can only be fixed by rebuilding it by hand. This adds the
three ways back: revert a whole commit, see one file's own history, and undo or restore a change to one file.
It serves both work projects and a class group's hidden Files project (the same `FilesTab`).

## Goals

- Revert a commit: put every file it touched back as it was before it.
- File history: from an open file, the list of its versions (commit, message, author, date, what happened),
  each with what it changed.
- Undo one file's change in a commit, and restore a file to any earlier version, including bringing back a
  deleted file.
- Two paths, matching the permission model: whoever holds `commit_main` does it straight into Main as a new
  commit; everyone else who has a draft gets **Restore to my draft** and submits it for review as usual.

## Non-goals

- No rewriting history. A commit is never edited or deleted; a revert is a new commit.
- No line-by-line merging. A revert never combines an old version with later edits.
- No revert of a request (change) as a unit; its merged commit is reverted like any other commit.

## Anti-goals

- Losing later work silently. A revert that would overwrite a later commit's edit refuses and names the files.
- A second way past the Word/Excel upload check for copies made from an old version. Only a version Main
  itself already had passes.

## Decisions (the user's)

- Both paths: Main for `commit_main`, My draft for everyone else with a draft.
- Reverting an older commit when a later commit changed one of its files: refuse and name the files. The
  person can still restore each file to a chosen version from its history.
- Approach A: the database builds the revert or restore commit.

## Approaches

- **A. Server builds it (picked).** New SQL functions read the stored versions and call
  `commit_general_files` once. Binary files reuse their original Storage object, so nothing is copied and the
  Word PDF preview at `<storage path>.pdf` already exists. Atomic.
- **B. The app builds it.** The browser copies old objects and calls `commitFiles`. No guard change, but
  doubles storage, remakes previews, and a copy can land without its commit.

## The how

### SQL: `supabase/file-history.sql` (after `word-previews.sql`, before `anon-lockdown.sql`)

- **`general_commit_origins`**: `commit_id` (pk, references `general_commits` on delete cascade), `project_id`,
  `kind` (`revert` | `restore`), `source_commit_id` (the commit reverted or restored from; on delete set null),
  `source_seq int`, `path text` (null for a whole-commit revert). Select for whoever reads the project
  (`can_read_general_project`, plus the class teacher read like the other repo tables); no write policy, only
  the functions write.
- **`revert_general_commit(p_commit uuid, p_base_seq int, p_path text default null, p_message text default '')`
  returns `general_commits`**. For each blob of the commit (or only `p_path`): the state before it is the newest
  blob for that path with `seq < commit.seq`. None or `removed` gives `removed`; the commit removed it gives
  `added` with the old content; otherwise `changed`. Refuses, naming the paths, when any blob for those paths
  has `seq > commit.seq`. Skips a file already as it was (refusing when none is left; builder's call),
  and refuses an archived project and more than 100 files. Default message: `Revert #<seq>: <message>` (with `p_path`: `Undo #<seq> on <path>`).
  Rights, the active check and `p_base_seq` come from `commit_general_files`. Writes one origin row.
- **`restore_general_file(p_repo uuid, p_path text, p_seq int, p_base_seq int, p_message text default '')`
  returns `general_commits`**. Puts `p_path` back to its state at version `p_seq` (a blob with that seq and
  path, not a removal). `changed` if live, `added` if gone; refuses when it is already that content.
  Default message: `Restore <path> to #<seq>`. Writes one origin row.
- **Upload check**: `general_blobs_pull_guard` gains one rule before its base check: a blob whose
  `storage_path` already appears on an earlier blob of the same repo and path passes (a version Main already
  had is not a stale copy). This file takes ownership of the guard from `file-pulls.sql`, so re-running
  `file-pulls.sql` means re-running this file afterwards. Its pull-end trigger is unchanged.
- `.keep` rows are reverted like any file, so a folder a commit added goes with it.
- Suite `supabase/tests/file-history.test.sql`: revert of change, add and remove; one-path undo; the later-edit
  refusal; restore of a deleted file; binary reuse passes the guard while an old non-Main copy is still held;
  a member without `commit_main`, a stakeholder and an archived project refused; origin rows written.

### Draft path (app, existing RPCs)

**Restore to my draft** writes the chosen version into the caller's draft with `saveDraftFile`: action
`changed` if Main has the path, `added` if not, `removed` for undoing an add. A binary version is first copied
with `copyProjectFile` (draft files own their object), then `record_general_file_base` with Main's current seq,
the same as Replace anyway, so its later commit passes the check. An existing draft copy of that path is
replaced only after a confirmation that names it. For a whole commit, the same for each of its files; the
later-edit rule applies here too.

### App

- `lib/api/fileHistory.ts`: `fileVersions(repoId, path)` (blobs for the path, newest first, with their
  commits and origins), `revertCommit`, `restoreFile`, `restoreToDraft`. The rules (state before a commit,
  later-edit check, which action) are plain functions in `lib/general/fileHistory.ts` with Vitest tests.
- **History tab**: each expanded commit gets **Revert commit** (committers) or **Revert in my draft**
  (others with a draft); each file in it gets **Undo this change**. A commit with an origin row shows
  "Reverts #12" or "Restores <path> to #5", linked to that commit. Confirmation dialog states the files and
  the message, editable.
- **File history**: the open file's header (`FileEditor`) gets **History**, a panel listing the path's
  versions: `#seq`, message, author, date, action, current version marked. Expanding one shows what it changed
  with the existing `DiffView` / `WordDiff` / `ExcelDiff` (as `CommitFiles` does). Each older version offers
  **Restore this version** (committers) or **Restore to my draft** (others), and **Undo this change**.
- A deleted file is brought back from History (Undo on the removal) since it is not in the tree.
- Stakeholders, read-only viewers and the class teacher see History and file history only. Errors from the
  later-edit refusal and a stale `p_base_seq` say what happened and to reload.
- Copy follows the house rules; new `data-walkthrough` markers only if a flow names them (none planned).

### Docs

`CLAUDE.md` bullet, `docs/07-backup.md` run order and the guard ownership note, `handoff.md` section.

## Left to the builder

- Exact panel layout of file history inside `FileEditor` (side panel on desktop, full width on phone).
- Whether a whole-commit draft revert is one confirmation or per file (one, naming the files, is the default).
