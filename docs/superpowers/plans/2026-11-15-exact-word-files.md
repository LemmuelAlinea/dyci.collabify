# Exact Word files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Word file put into Files comes back out byte-for-byte identical, shows as pages inside Collabify, and is
changed in Word through a pull → edit → push flow that holds a push made from an old copy.

**Architecture:** Word extensions become `binary` blobs (the original object in `general-files` storage), the path
PDFs already take. A new SQL file records pulls and guards `general_blobs` inserts with a trigger, so a stale push is
refused on every path into Main (direct commit, commit-a-draft-path, merged change) without redefining any function
another file owns. The app checks the same state earlier (draft save, upload) to show the held message, draws pages
with `docx-preview`, and compares versions by their words.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase (Postgres, storage, Edge Functions on Deno), Vitest,
`docx-preview` (new), `fflate` and `mammoth` (existing).

**Spec:** `docs/superpowers/specs/2026-11-15-exact-word-files-design.md`

## Global Constraints

- Word extensions: `docx`, `doc`, `odt`, `rtf`. Only `docx` is previewed and compared; the others are kept,
  versioned and downloaded.
- The stored object is the uploaded file. No code path re-zips, rewrites or converts Word bytes.
- A pull lives 7 days (`PULL_DAYS = 7` in the app, `interval '7 days'` in SQL), or until that person's version of the
  path lands in Main, or until they click I'm done editing.
- Upload limit stays `GENERAL_FILE_LIMIT` (50 MB).
- No third-party viewer, no public link, no new server.
- SQL file `supabase/file-pulls.sql` runs after `space-look.sql`, before `anon-lockdown.sql`; it redefines nothing
  another file owns. Suite `supabase/tests/file-pulls.test.sql`.
- Copy rules from `CLAUDE.md` (sentence case, active voice, no exclamation marks, no "please", no "successfully");
  design tokens only, no raw hex; desktop first, then tablet, then phone.
- The FileAction for a replaced file is `'changed'` (not "modified").
- Run `npm run build` and `npm test` before claiming a task works.

## Review Focus

1. **A pull made from your own draft copy.** Pulling again from your draft keeps your first base; pulling from Main
   moves it to Main's newest. Otherwise a second download silently clears a real conflict. (Task 2 test)
2. **The file was removed from Main after you pulled.** The push is held and says it was removed; there is no
   "Download their version". (Tasks 2 and 6 tests)
3. **A reviewer merges a teammate's stale Word change.** The database refuses; the reviewer sees who must update it,
   not a raw Postgres error. (Task 2 test, Task 6 error mapping test)
4. **A pull older than 7 days.** Treated as no pull: not shown, not enforced. (Task 2 test)
5. **Uploading a different type over a Word path** (a .pdf named like the .docx, or a .doc over a .docx). Refused
   with what to do. (Task 6 test)

---

### Task 1: Word files are kept as uploaded

**Files:**
- Modify: `src/lib/general/files.ts:50` (`RICH`), add helpers below `kindForPath`
- Modify: `src/components/general/NewItemDialog.tsx:67-76,135` (no Word conversion, Word note)
- Modify: `src/lib/general/office.ts:20-21` (`OFFICE_WARNING` loses its Word sentence)
- Modify: `src/lib/general/types.ts:511-516` (doc comment: binary includes Word files)
- Test: `src/lib/general/files.test.ts`

**Interfaces:**
- Produces: `WORD_EXTENSIONS: ReadonlySet<string>` (`docx`, `doc`, `odt`, `rtf`), `isWordPath(path: string): boolean`,
  `isPreviewableWord(path: string): boolean` (docx only), `sameExtension(a: string, b: string): boolean`.

- [ ] **Step 1: Write the failing tests** in `files.test.ts`

```ts
it('keeps Word files as uploaded', () => {
  for (const p of ['ch1.docx', 'old.DOC', 'notes.odt', 'memo.rtf']) expect(kindForPath(p)).toBe('binary')
  expect(isWordPath('Thesis/Chap1-4.docx')).toBe(true)
  expect(isWordPath('scan.pdf')).toBe(false)
  expect(isPreviewableWord('a.docx')).toBe(true)
  expect(isPreviewableWord('a.doc')).toBe(false)
  expect(sameExtension('Chap1-4.docx', 'Chap1-4 final.DOCX')).toBe(true)
  expect(sameExtension('a.docx', 'a.doc')).toBe(false)
})
```

Remove or update any existing assertion that expects `kindForPath('*.docx')` to be `'rich'`.

- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/lib/general/files.test.ts`
- [ ] **Step 3: Implement.** Drop `docx`, `doc`, `odt`, `rtf` from `RICH` (leave `RICH` empty-capable or remove it if
  nothing else reads it). In `NewItemDialog.savePickedFile` remove the `rich` branch so Word files take
  `uploadProjectFile`. The dialog's `office` note (line ~135) shows only for sheets now; add one line under the file
  picker when the picked file is a Word file: "Kept exactly as uploaded. From Google Docs, download it as Microsoft
  Word (.docx) first." `OFFICE_WARNING` becomes the Excel sentence only.
- [ ] **Step 4: Run, expect PASS:** `npx vitest run src/lib/general/files.test.ts` then `npm run build`
- [ ] **Step 5: Commit** "Keep Word files exactly as uploaded"

### Task 2: Pulls in the database

**Files:**
- Create: `supabase/file-pulls.sql`
- Create: `supabase/tests/file-pulls.test.sql` (same harness as `space-look.test.sql`: `begin`, `pg_temp.act_as`,
  `pg_temp.must_be`, rolls back)
- Modify: `docs/07-backup.md` (add `supabase/file-pulls.sql` after `space-look.sql` in both run lines at :26 and :53,
  plus a paragraph like the `space-look.sql` one at :988)
- Modify: `CLAUDE.md` (one bullet after Space look)

**Interfaces:**
- Produces (SQL):
  - table `general_file_pulls(repo_id uuid, project_id uuid, path text, user_id uuid, base_seq int not null,
    pulled_at timestamptz not null default now(), primary key (repo_id, path, user_id))`, FK `(repo_id, project_id)` →
    `general_repos (id, project_id)` on delete cascade, `user_id` → `profiles` on delete cascade. RLS on; select policy
    `public.can_read_general_project(project_id) and pulled_at > now() - interval '7 days'`; no write policy;
    `grant select` to authenticated.
  - `general_main_seq(p_repo uuid, p_path text, p_before int default null) returns int` — max blob seq for the path
    (any action), below `p_before` when given, else 0.
  - `pull_general_file(p_repo uuid, p_path text, p_from_main boolean) returns general_file_pulls` — caller must
    `general_can_write(project)`; path must be a Word extension and present (not removed) in Main, else raise "That
    file is not in Main yet." With `p_from_main`, or no live row, upsert `base_seq = general_main_seq(...)`,
    `pulled_at = now()`; otherwise only `pulled_at = now()`.
  - `end_general_file_pull(p_repo uuid, p_path text) returns void` — deletes the caller's row.
  - `general_file_push_state(p_repo uuid, p_path text, p_user uuid default null) returns table (base_seq int,
    main_seq int, main_author uuid, main_at timestamptz, main_removed boolean)` — for `coalesce(p_user, auth.uid())`'s
    live pull; no row when there is none; caller must `can_read_general_project`. `main_*` describe the newest blob for
    the path and its commit.
  - trigger `general_blobs_pull_guard` (BEFORE INSERT on `general_blobs`, security definer function): the commit's
    `author_id` has a live pull on `(repo_id, path)` and `general_main_seq(repo, path, new.seq) > base_seq` → raise
    `'Main has a newer version of % than the copy this was made from. Get the newer version, combine the two in Word, then upload again.'`
    with `errcode = 'serialization_failure'`.
  - trigger `general_blobs_pull_end` (AFTER INSERT on `general_blobs`): delete the commit author's pull on that path.

- [ ] **Step 1: Write the suite** `file-pulls.test.sql` with these PASS lines (seed one work project, its repo, a PM
  "ana", a member "ben", a stakeholder "sam", and `chap.docx` committed at seq 1 as binary):
  - ana pulls from Main → `base_seq = 1`
  - sam's pull is refused (stakeholder)
  - pulling `notes.txt` is refused; pulling a path not in Main is refused
  - ben commits `chap.docx` at seq 2 after his own pull at 1 → passes, and ben's pull row is gone afterwards
  - ana commits `chap.docx` with her pull still at base 1 → refused with the "Main has a newer version" message
  - ana pulls again with `p_from_main = false` → base stays 1; with `true` → base becomes 2; her commit then passes
  - ben removes `chap.docx`; ana's `general_file_push_state` shows `main_removed = true` and `main_author = ben`
  - a pull with `pulled_at` 8 days ago is not returned by the table select or push state, and does not block a commit
  - the guard holds on the merge path: ben opens a change on `chap.docx` from a stale pull, ana answers with merge →
    refused with the same message
  - another member's pull is readable by ana (heads-up) but `end_general_file_pull` only removes the caller's row
- [ ] **Step 2: Run, expect FAIL** (functions missing): `node scripts/db.mjs supabase/tests/file-pulls.test.sql`
- [ ] **Step 3: Write `supabase/file-pulls.sql`** per Interfaces, idempotent (`create table if not exists`,
  `drop trigger if exists`, `create or replace function`), each function `set search_path = public`, grants to
  `authenticated` only, revoke from `anon`.
- [ ] **Step 4: Apply and run:** `node scripts/db.mjs supabase/file-pulls.sql supabase/anon-lockdown.sql` then
  `node scripts/db.mjs supabase/tests/file-pulls.test.sql` — expect every line `PASS`, no `FAIL`. The live app is
  unaffected until it creates pulls.
- [ ] **Step 5: Commit** "Record Word file pulls and hold a stale push"

### Task 3: Pull and push state in the app

**Files:**
- Create: `src/lib/api/filePulls.ts`
- Create: `src/lib/general/pushCheck.ts`, test `src/lib/general/pushCheck.test.ts`
- Modify: `src/lib/api/general.ts` (add `storagePathAt` beside `contentAt` at :1606)
- Modify: `src/lib/general/types.ts` (types below)

**Interfaces:**
- Consumes: Task 2's RPCs and table.
- Produces:
  - `type FilePull = { repo_id: string; project_id: string; path: string; user_id: string; base_seq: number; pulled_at: string }`
  - `type PushState = { base_seq: number; main_seq: number; main_author: string | null; main_at: string | null; main_removed: boolean }`
  - `pullFile(repoId: string, path: string, fromMain: boolean): Promise<FilePull>`
  - `endPull(repoId: string, path: string): Promise<void>`
  - `listPulls(repoId: string): Promise<FilePull[]>`
  - `pushState(repoId: string, path: string, userId?: string): Promise<PushState | null>`
  - `storagePathAt(repoId: string, path: string, seq: number): Promise<string | null>` (null when absent or removed)
  - `type PushVerdict = { kind: 'clear' } | { kind: 'unknown' } | { kind: 'held'; by: string | null; at: string | null; removed: boolean; mainSeq: number; baseSeq: number }`
  - `pushVerdict(state: PushState | null, existsInMain: boolean): PushVerdict` — `unknown` when no pull and the path
    exists in Main; `clear` when no pull and it does not, or `main_seq <= base_seq`; else `held`.
  - `isStalePushError(err: unknown): boolean` — matches the Task 2 message prefix "Main has a newer version of".
  - `PULL_DAYS = 7`

- [ ] **Step 1: Write failing tests** in `pushCheck.test.ts`: `pushVerdict(null, true)` → `unknown`;
  `pushVerdict(null, false)` → `clear`; base 3 / main 3 → `clear`; base 3 / main 5 by "ben" → `held` with `by: 'ben'`,
  `removed: false`; `main_removed: true` → `held` with `removed: true`; `isStalePushError({ message: 'Main has a newer version of chap.docx than…' })`
  → true, a plain Error → false.
- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/lib/general/pushCheck.test.ts`
- [ ] **Step 3: Implement** the two files and `storagePathAt` (same query as `contentAt`, selecting
  `action, storage_path`).
- [ ] **Step 4: Run, expect PASS**, then `npm run build`
- [ ] **Step 5: Commit** "Read Word file pulls and push state"

### Task 4: Compare Word versions by their words

**Files:**
- Create: `src/lib/general/docx/text.ts`, test `src/lib/general/docx/text.test.ts`
- Create: `src/components/general/WordDiff.tsx`
- Modify: `src/components/general/DraftPanel.tsx:500-504`, `src/components/general/RepoChangeRow.tsx:244-248`,
  `src/components/general/FilesTab.tsx:970-974` (the three "Its contents are not compared here" branches)

**Interfaces:**
- Consumes: `storagePathAt` (Task 3), `projectFileBlob` (`lib/api/general.ts`), `DiffView`, `isPreviewableWord`.
- Produces:
  - `docxParagraphs(bytes: Uint8Array): string` — unzip `word/document.xml` with `fflate`, one line per `<w:p>`,
    `<w:tab/>` as a tab, entities decoded, other tags dropped. Never throws: a broken file gives `''`.
  - `<WordDiff before={storagePath | null} after={storagePath | null} caption={string} />` — loads both, shows
    `DiffView`, and under it "Compares the words only. Formatting changes do not show here." Spinner while loading;
    an `Alert` with "Could not read one of the versions. Download them to compare in Word." on failure.

- [ ] **Step 1: Write failing tests** in `text.test.ts` (happy-dom, build fixtures with the `docx` package as
  `docx.test.ts` does): two paragraphs → `'First\nSecond'`; a tab run → contains `'\t'`; `&amp;` → `&`; random bytes
  → `''`.
- [ ] **Step 2: Run, expect FAIL:** `npx vitest run src/lib/general/docx/text.test.ts`
- [ ] **Step 3: Implement** `text.ts` and `WordDiff`; in the three places, a binary `isPreviewableWord(path)` file
  renders `WordDiff` (before = Main's/the earlier version's storage path via `storagePathAt` or the tree row; after =
  the row's `storage_path`, null when removed); other binaries keep the existing sentence.
- [ ] **Step 4: Run tests, then `npm run build`**
- [ ] **Step 5: Commit** "Compare Word versions by their words"

### Task 5: See the pages

**Files:**
- Create: `src/components/general/DocxPreview.tsx`, `src/components/general/docxPreview.css`
- Create: `public/fonts/word/` (Liberation Serif, Liberation Sans, Carlito, Caladea — regular, bold, italic,
  bold italic, `.woff2`, with their OFL/licence files)
- Modify: `src/components/general/FileEditor.tsx:389-397` (Word branch before the generic binary note),
  `src/components/general/RepoChangeRow.tsx:410-440` (`ReviewFilePreview` gets Word)
- Modify: `package.json` (`docx-preview@0.4.1`)

**Interfaces:**
- Consumes: `projectFileBlob`, `isPreviewableWord`.
- Produces: `<DocxPreview storagePath={string} label={string} fill?={boolean} />`, lazy-loaded like `PdfPreview`.

- [ ] **Step 1: Install** `npm install docx-preview@0.4.1`
- [ ] **Step 2: Implement `DocxPreview`.** `renderAsync(blob, container, styleContainer, { className: 'docx',
  inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false, renderHeaders: true, renderFooters: true,
  renderFootnotes: true, renderEndnotes: true, experimental: true, useBase64URL: true })`. The CSS declares
  `@font-face` families named `Times New Roman`, `Arial`, `Calibri`, `Cambria` pointing at the metric twins in
  `public/fonts/word/`, scoped by loading the stylesheet only from this component. Pages stay white paper on a
  `surface-sunken` ground in both themes; the wrapper scales pages to fit the width under 900 px with a zoom control.
  Above it: "A preview. Download to see it exactly as Word shows it." If `renderAsync` throws, show the existing
  "kept and versioned here but opened elsewhere" note with Download — never a blank panel.
- [ ] **Step 3: Wire it.** `FileEditor` shows `DocxPreview` for `isPreviewableWord(file.path)` binaries;
  `.doc/.odt/.rtf` keep the generic note. `ReviewFilePreview` treats a previewable Word file like a PDF.
- [ ] **Step 4: Check by eye** with `npm run dev`: upload the user's `C:\Users\Lemmuel Alinea\Downloads\Chap1-4_main (1).docx`
  to a test project draft; the header logos and the 1.5" left margin show; page numbers show where the library draws
  them; light and dark both readable; tablet width (1024) and phone (390) fit without sideways scroll.
- [ ] **Step 5: `npm run build`, commit** "Show Word files as pages"

### Task 6: Edit in Word, upload a new version, held pushes

**Files:**
- Create: `src/components/general/WordVersionPanel.tsx` (Edit in Word, pulls heads-up, I'm done, Upload a new version)
- Create: `src/components/general/HeldPush.tsx` (the held message), test `src/components/general/HeldPush.test.tsx`
- Create: `src/lib/general/newVersion.ts`, test `src/lib/general/newVersion.test.ts`
- Modify: `src/components/general/FileEditor.tsx` (render the panel for binaries; Word-only parts for Word paths)
- Modify: `src/components/general/FilesTab.tsx` (file row: "Ana is editing" chip from `listPulls`)
- Modify: `src/components/general/DraftPanel.tsx` (held files from `pushState`, shown with `HeldPush`; map
  `isStalePushError` on submit/commit), `src/components/general/RepoChangeRow.tsx` (map it on merge)

**Interfaces:**
- Consumes: Tasks 1, 3, 4; `uploadProjectFile`, `saveDraftFile`, `commitFiles`, `discardDraftFile`,
  `writeChangeMessage`, `projectFileUrl`.
- Produces:
  - `newVersionProblem(currentPath: string, picked: File): string | null` — null when fine; "Pick a .docx file. This
    one replaces <name>, so it has to be the same type." when `!sameExtension`; the 50 MB message when too large.
  - `<HeldPush state={PushVerdict & { kind: 'held' }} path={string} names={(id) => string} onGetTheirs={() => void}
    onReplaceAnyway={() => void} />`

- [ ] **Step 1: Write failing tests.** `newVersion.test.ts`: same type passes; `.pdf` for a `.docx` fails with the
  copy above; `.doc` for `.docx` fails. `HeldPush.test.tsx` (Testing Library): held by Ben not removed → text "Ben
  updated this since you pulled" and buttons "Download Ben's version" and "Replace it anyway"; removed → "Ben removed
  this file since you pulled", no download button.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement.**
  - **Edit in Word** (Word paths, not read-only, not a teacher, not a stakeholder): `pullFile(repo, path,
    !file.fromDraft)` then open `projectFileUrl(storagePath, name)`. Toast: "Downloaded. Edit it in Word, then upload
    it here as a new version."
  - **Heads-up:** other people's live pulls on this path: "Ana pulled this 2 hours ago" (names from the project
    members the tab already has; relative time). Own pull: "You pulled this <time>" with **I'm done editing**
    (`endPull`).
  - **Upload a new version** (every binary file, not read-only): pick → `newVersionProblem` → for Word paths
    `pushVerdict(await pushState(...), existsInMain)`:
    - `held` → `HeldPush`. "Download <name>'s version" = Edit in Word from Main. "Replace it anyway" opens a confirm
      naming whose changes will be gone; on yes `pullFile(repo, path, true)` (no download) and continue.
    - `unknown` → inline warning "Collabify doesn't know which copy you started from. If it wasn't Main's version from
      <date>, someone's changes may be lost." with Continue.
    - then `uploadProjectFile` and the same two buttons the editor has: **Save to my draft**
      (`saveDraftFile({ action: 'changed', kind: 'binary', storagePath })`) and, with `commit_main`, **Commit to Main**
      with the commit message field and Write it (`writeChangeMessage(projectId, { files: [{ path, kind: 'binary',
      storage_path }] }`, see Task 8).
  - Any save, submit, commit or merge that fails with `isStalePushError` shows "Main has a newer version of <path>
    than the copy <person> started from. <Person> has to get the newer version, combine the two in Word and upload
    again." instead of the raw error.
- [ ] **Step 4: Run tests, `npm run build`**, then walk it in `npm run dev` with two accounts (from the project's seed
  or test accounts): A and B pull; A commits; B's upload is held naming A and showing A's words in `WordDiff`; B gets
  A's version, uploads again and it goes through; each saw the other's heads-up until they pushed.
- [ ] **Step 5: Commit** "Pull Word files, upload new versions, hold a stale push"

### Task 7: Upload over an existing name, old converted files, Google Docs

**Files:**
- Modify: `src/components/general/NewItemDialog.tsx:106-113` (existing-name refusal)
- Modify: `src/components/general/FileEditor.tsx` (note above `rich` files)
- Test: `src/components/general/NewItemDialog.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `newVersionProblem`, `pushState`/`pushVerdict`, `HeldPush` (Task 6).

- [ ] **Step 1: Write failing tests:** picking `Chap1-4.docx` where Main has it shows "Chap1-4.docx is already here"
  with **Upload as a new version** and **Rename**; a folder upload containing two existing names asks "Upload 2 files
  as new versions?" before saving anything; Cancel saves nothing.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement.** New version from the dialog goes through the same checks as Task 6 (type, held,
  unknown) and saves with `action: 'changed'`. A name already in the person's draft replaces the draft row the same
  way. Old `rich` files: an info `Alert` above the Word editor: "This copy was converted when it was uploaded, so some
  Word formatting may be gone. Upload the original .docx as a new version to keep it exactly."
- [ ] **Step 4: Run tests, `npm run build`**
- [ ] **Step 5: Commit** "Offer a new version when an upload's name exists"

### Task 8: AI helpers read Word text

**Files:**
- Modify: `supabase/functions/work-ai/index.ts:86-98` (`kindOf`, `fileText`), `:466-485` (`beforeAfter`),
  `:487-523` (`describeAction`), `:540-555` (`summarizeChangeAction`), `:578-590` (`summarizeFileAction`),
  `:642` (`askAction`), plus `tasksAction` if it reads Main files

**Interfaces:**
- Produces: `async function readText(caller: SupabaseClient, f: FileRow): Promise<string>` — Word `binary` with a
  `storage_path`: download through the caller's client and `docxText`; PDF: `pdfText`; else `fileText(f)`. `kindOf`
  returns `'binary'` for Word extensions, matching `files.ts`.

- [ ] **Step 1: Implement.** Every caller of `fileText` above uses `readText` (make `beforeAfter` async). Given files
  in `describeAction` accept `storage_path` (downloaded through the caller's client, so storage policy applies).
  `summarizeChangeAction` passes each file's `storage_path`. `askAction` keeps binaries that are Word files. Existing
  caps (`cap`, the 80 000 / 250 000 budgets) stay.
- [ ] **Step 2: Type-check the function:** `deno check supabase/functions/work-ai/index.ts` (or the repo's existing
  check if `deno` is absent: `npx tsc --noEmit -p supabase/functions` when configured). Expect no errors.
- [ ] **Step 3: Commit** "Let the AI helpers read Word files kept as uploaded". Deploy of `work-ai` waits for the
  release in Task 9.

### Task 9: Prove it and hand over

**Files:**
- Create: `scripts/word-roundtrip.mjs` (computes SHA-256 of two files)
- Modify: `handoff.md` (new section at the end)

- [ ] **Step 1:** In `npm run dev`, upload `Chap1-4_main (1).docx` to a test project's draft, commit it to Main,
  download from Main and from the commit view. Run `node scripts/word-roundtrip.mjs "<original>" "<download>"` →
  prints `identical`. Repeat in a class board's Files project.
- [ ] **Step 2:** Upload a changed copy as a new version: the change row shows the changed words; the first version
  still downloads `identical` to the first upload.
- [ ] **Step 3:** `npm run build`, `npm test`, `node scripts/db.mjs supabase/tests/file-pulls.test.sql` — all pass.
- [ ] **Step 4:** Append the handoff section: what shipped, `file-pulls.sql` in the run order, `work-ai` to redeploy
  with the frontend, existing converted files need a re-upload, phase 2 (ONLYOFFICE) and Excel as Deferred.
- [ ] **Step 5: Commit** "Hand over exact Word files". Ask the user to review before pushing `main` and deploying
  `work-ai` (`npx supabase functions deploy work-ai`).
