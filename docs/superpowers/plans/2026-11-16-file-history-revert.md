# File history, revert and restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revert a commit, see one file's history, and undo or restore one file's change, into Main for
`commit_main` holders and into My draft for everyone else with a draft.

**Architecture:** Two SQL functions build revert and restore commits from stored blobs through
`commit_general_files`, recording the origin in a side table; the upload guard lets a version Main already had
back in. The app adds pure rules (`lib/general/fileHistory.ts`), an API module, revert/undo actions on the
History tab and a History panel on an open file. Draft restores use existing RPCs.

**Tech Stack:** Postgres (Supabase), React + TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-file-history-revert-design.md`

## Global Constraints

- Commits are never edited or deleted; a revert is a new commit (`guard_general_commit`).
- Copy: sentence case, active voice, no exclamation marks, no "please", no "successfully"; errors say what
  happened and what to do next.
- No hardcoded colors; tokens only. Desktop first, then tablet, then phone.
- `supabase/file-history.sql` is idempotent, runs after `word-previews.sql`, before `anon-lockdown.sql`.
- Start the guard redefinition from the live `pg_get_functiondef('general_blobs_pull_guard')`.
- Run `npm run build` before claiming anything works.

## Review Focus

- A revert when someone committed after the screen loaded: `p_base_seq` stale → "Somebody committed…" error,
  shown with a reload hint, nothing written. (Task 1 test `stale base refused`.)
- Undo on a commit that added a file which a later commit removed: later-edit refusal names it, not a crash.
  (Task 1 test `later removal refused`.)
- Restore to my draft when the draft already holds that path: confirmation names it; cancel leaves the draft
  as is. (Task 4 test `asks before replacing a draft copy`.)
- A whole-commit revert where some files are already back as they were: those are skipped; all skipped →
  refused "Nothing to revert". (Task 1 test `no-op files skipped`.)
- A Word version restored into Main keeps its PDF preview (same storage path) and passes the guard, while an
  unrelated old copy is still held. (Task 1 tests `binary restore passes guard`, `stale copy still held`.)

---

### Task 1: SQL — origins table, revert and restore functions, guard rule

**Files:**
- Create: `supabase/file-history.sql`
- Test: `supabase/tests/file-history.test.sql` (pattern of `supabase/tests/file-pulls.test.sql`: `act_as`,
  `must_be`, `must_refuse_with`, `upload`; rolls back)

**Interfaces:**
- Produces:
  - table `general_commit_origins(commit_id uuid pk → general_commits on delete cascade, project_id uuid,
    kind text check in ('revert','restore'), source_commit_id uuid → general_commits on delete set null,
    source_seq int not null, path text null, created_at timestamptz default now())`; RLS on; select policies
    `general_commit_origins_select` (`is_general_member(project_id)`) and
    `general_commit_origins_class_teacher_read` (`class_board_teacher_reads(project_id)`); no write policy.
  - `revert_general_commit(p_commit uuid, p_base_seq int, p_path text default null, p_message text default '')
    returns general_commits`
  - `restore_general_file(p_repo uuid, p_path text, p_seq int, p_base_seq int, p_message text default '')
    returns general_commits`
  - both: `revoke all … from public, anon; grant execute … to authenticated`.

- [ ] **Step 1: Write the failing suite.** Fixture: a project, a repo, a member with `commit_main` (pm), a
  member without it, a stakeholder. Commits: #1 adds `a.md` ("one") and `b.md`; #2 changes `a.md` ("two");
  #3 removes `b.md`; #4 adds `c.docx` (uploaded object X); #5 changes `c.docx` (object Y). Tests:
  - `revert of a change`: revert #2 → new commit with `a.md` changed, content "one"; origin row kind revert,
    source_seq 2, path null.
  - `revert of a removal brings the file back`: revert #3 → `b.md` added with #1's content.
  - `revert of an add removes`: on a fresh commit adding `d.md`, revert it → `d.md` removed.
  - `later edit refused`: revert #1 → refused, message contains `a.md` and `b.md`.
  - `later removal refused`: add `e.md` (#n), remove it (#n+1), revert #n → refused naming `e.md`.
  - `one-path undo`: revert #4 with `p_path => 'c.docx'` is refused (later #5); revert #5 with path → `c.docx`
    changed back to object X; default message `Undo #5 on c.docx`; origin path `c.docx`.
  - `binary restore passes guard`: `restore_general_file(repo,'c.docx',4,…)` after a later change → passes
    with storage_path X.
  - `stale copy still held`: a new object with a recorded base older than Main (as in file-pulls suite) is
    still refused by `commit_general_files`.
  - `restore a deleted file`: `restore_general_file(repo,'b.md',1,…)` → `b.md` added.
  - `restore to a removal refused`: `restore_general_file(repo,'b.md',3,…)` refused.
  - `restore to current refused`: restoring the version that is current → refused "already".
  - `no-op files skipped`: a commit touching two files, one already put back by a restore → revert writes
    only the other; when none remain → refused "Nothing to revert".
  - `stale base refused`: `p_base_seq` one behind → refused "Somebody committed".
  - `member without commit_main refused`, `stakeholder refused`, `archived project refused`.
  - `default messages`: `Revert #2: <message>`, `Restore b.md to #1`.

- [ ] **Step 2: Run it to see it fail.** `node scripts/db.mjs supabase/tests/file-history.test.sql` →
  fails on the missing function.

- [ ] **Step 3: Write `supabase/file-history.sql`.** Table, policies, the two functions, the guard. Both
  functions: lock nothing themselves; read the repo and project, refuse archived
  (`general_is_archived`, existing message), build the jsonb items and call
  `commit_general_files(repo, message, p_base_seq, items)` (it checks rights, activity, base seq and file
  rules), then insert the origin row. Revert: target = newest blob with `seq < commit.seq` per path;
  later-edit check = any blob for those paths with `seq > commit.seq` → `raise … 'Later commits changed %.
  Restore each file from its history instead.'` (paths joined with ", "), errcode `serialization_failure`.
  Skip a path whose current state equals the target (same action class, kind, content, storage_path). Guard:
  add, before the base lookup, `if exists (select 1 from general_blobs b where b.repo_id = new.repo_id and
  b.path = new.path and b.storage_path = new.storage_path and b.seq < new.seq) then return new; end if;`.
  Header comment states ownership of the guard from `file-pulls.sql`.

- [ ] **Step 4: Apply and run.** `node scripts/db.mjs supabase/file-history.sql supabase/anon-lockdown.sql`,
  then the suite → every line PASS; also re-run `supabase/tests/file-pulls.test.sql` and
  `supabase/tests/anon-lockdown.test.sql` → PASS.

- [ ] **Step 5: Commit** `Add revert and restore for project files`.

### Task 2: Pure rules — `lib/general/fileHistory.ts`

**Files:**
- Create: `src/lib/general/fileHistory.ts`, `src/lib/general/fileHistory.test.ts`

**Interfaces:**
- Produces:
  - `type FileVersion = { seq: number; action: FileAction; kind: FileKind; content: string; storage_path: string | null }`
  - `stateBefore(versions: FileVersion[], seq: number): FileVersion | null` — newest with `seq < seq`; null when
    none or it is a removal.
  - `putBack(target: FileVersion | null, current: FileVersion | null): FileAction | null` — `removed` (target
    null, current live), `added` (target live, current null), `changed` (both live and different), null
    (same, or both null).
  - `laterEdits(blobs: { path: string; seq: number }[], seq: number): string[]` — sorted unique paths with
    `seq > seq`.
  - `originLabel(o: { kind: 'revert' | 'restore'; source_seq: number; path: string | null }): string` —
    `Reverts #12`, `Undoes #12 on a.md`, `Restores a.md to #5`.

- [ ] **Step 1: Tests** for each function, including: `putBack` treats same storage_path as same for binary;
  `stateBefore` returns null when the previous version is a removal; `laterEdits` ignores equal seq.
- [ ] **Step 2:** `npx vitest run src/lib/general/fileHistory.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** `Add the rules for putting files back`.

### Task 3: API — `lib/api/fileHistory.ts`

**Files:**
- Create: `src/lib/api/fileHistory.ts`, `src/lib/api/fileHistory.test.ts` (mock `../supabase`, like other api
  tests; mock `./general` `copyProjectFile`, `saveDraftFile` and `./filePulls` `recordBase`, `mainSeq`)
- Modify: `src/lib/general/types.ts` (add `GeneralCommitOrigin`)

**Interfaces:**
- Consumes: Task 1 RPCs, Task 2 `FileVersion`, `putBack`.
- Produces:
  - `fileVersions(repoId: string, path: string): Promise<(GeneralBlob & { commit: GeneralCommit })[]>`
    (blobs for the path newest first, with `general_commits(*)` embedded)
  - `commitOrigins(repoId: string): Promise<Record<string, GeneralCommitOrigin>>` keyed by commit id
  - `revertCommit(commitId: string, baseSeq: number, path?: string, message?: string): Promise<GeneralCommit>`
  - `restoreFile(repoId: string, path: string, seq: number, baseSeq: number, message?: string): Promise<GeneralCommit>`
  - `restoreToDraft(input: { repoId: string; projectId: string; path: string; target: FileVersion | null;
    mainHas: boolean }): Promise<void>` — action from `putBack`-like rule against Main (`removed` when target
    null, `changed` when Main has it, else `added`); binary: `copyProjectFile` then `saveDraftFile` then
    `recordBase(repoId, path, copy, await mainSeq(repoId, path))`.

- [ ] **Step 1: Tests:** `restoreToDraft` copies a binary and records Main's seq; text goes straight to
  `saveDraftFile` with content; null target saves `removed`; `revertCommit` passes `p_path: null` when absent.
- [ ] **Step 2:** `npx vitest run src/lib/api/fileHistory.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `Add the file history calls`.

### Task 4: History tab — revert a commit, undo one file, origin labels

**Files:**
- Modify: `src/components/general/FilesTab.tsx` (`HistoryView`, `CommitFiles`; load `commitOrigins` with
  the commits; pass `repo`, `draftFiles`, `onDone`)
- Create: `src/components/general/PutBackDialog.tsx` (confirm dialog: what will happen, the files, an
  editable message for Main; for the draft path, names any draft copy it replaces)
- Test: `src/components/general/PutBackDialog.test.tsx`, extend `FilesTab.test.tsx`

**Interfaces:**
- Consumes: Task 3 calls, Task 2 `originLabel`, `laterEdits`.
- Produces: `PutBackDialog` props `{ title: string; files: string[]; replacesDraft: string[]; toMain: boolean;
  defaultMessage: string; onConfirm(message: string): Promise<void>; onClose(): void }`.

- [ ] **Step 1: Tests:** a committer sees **Revert commit** on an expanded commit and **Undo this change** per
  file; a member without `commit_main` sees **Revert in my draft** and **Undo in my draft**; a stakeholder and
  a class teacher see neither; a commit with an origin shows `Reverts #2`; `asks before replacing a draft
  copy` (dialog lists the path; cancel calls nothing).
- [ ] **Step 2:** `npx vitest run src/components/general/FilesTab.test.tsx src/components/general/PutBackDialog.test.tsx` → FAIL.
- [ ] **Step 3:** Implement. Later edits are checked in the app first (button still shown; the dialog says
  which files changed since and offers nothing but Close); the SQL refusal remains the authority. On success:
  toast `Reverted #12` / `Put #12 back in your draft`, reload.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Commit** `Revert commits and undo file changes from History`.

### Task 5: File history panel

**Files:**
- Create: `src/components/general/FileHistoryPanel.tsx`
- Modify: `src/components/general/FileEditor.tsx` (a **History** button in the header for files Main has or
  had; opens the panel beside the file on desktop, full width under 768 px)
- Test: `src/components/general/FileHistoryPanel.test.tsx`

**Interfaces:**
- Consumes: `fileVersions`, `restoreFile`, `revertCommit` (with path), `restoreToDraft`, `PutBackDialog`,
  and the diff rendering used by `CommitFiles` (move it into a shared `VersionDiff` component in the same
  file as `CommitFiles` or its own file; both callers use it).
- Produces: `FileHistoryPanel` props `{ repo: GeneralRepoSummary; path: string; state: GeneralProjectState;
  draftFiles: GeneralDraftFile[]; onDone(): void; onClose(): void }`.

- [ ] **Step 1: Tests:** lists versions newest first with `#seq`, message, author and action, the newest
  marked `Current`; a removal row has no restore; committers get **Restore this version** on older live
  versions and **Undo this change** on every version; others get the draft variants; read-only gets none.
- [ ] **Step 2:** `npx vitest run src/components/general/FileHistoryPanel.test.tsx` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; `npm run build` clean.
- [ ] **Step 5: Commit** `Show a file's history and restore its versions`.

### Task 6: Docs, checks and the real app

**Files:**
- Modify: `CLAUDE.md` (a "File history" bullet after Word PDF previews), `docs/07-backup.md` (run order;
  `file-pulls.sql` re-run means re-running `file-history.sql` after it), `handoff.md` (new section).

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** `npm run build`, `npx vitest run`, `npm run lint`, `node scripts/contrast.mjs`,
  `node scripts/a11y-names.mjs`, `node scripts/schema-drift.mjs` → all clean.
- [ ] **Step 3:** In the dev server, signed in, on a test project: revert a commit, undo one file, restore a
  deleted file, restore a Word version (its PDF preview shows at once), and as a member without
  `commit_main` restore to draft. Screenshot the History tab and the file History panel.
- [ ] **Step 4: Commit** `Document file history and revert`.
