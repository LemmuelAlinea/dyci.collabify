# Exact Excel files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `.xlsx`/`.xlsm` uploads are kept byte-for-byte, shown in Microsoft's Office viewer, changed through Edit in
Excel → Upload a new version with the Word hold, and compared by changed cells.

**Architecture:** Excel joins the existing Word machinery: the `binary` kind, `supabase/file-pulls.sql` (pulls, copy
bases, the `general_blobs` guard), `WordVersionPanel`/`HeldPush`/`DraftPanel`/`NewItemDialog`, `OfficeViewer`. A pure
cell-diff over the existing `xlsxToWorkbook` reader feeds an `ExcelDiff` beside `WordDiff`.

**Tech Stack:** React + TypeScript + Vite, Supabase (Postgres, storage, Deno Edge Function), Vitest, ExcelJS (existing,
behind `xlsxToWorkbook`), fflate (existing).

**Spec:** `docs/superpowers/specs/2026-11-16-exact-excel-files-design.md`

## Global Constraints

- Excel extensions: `xlsx`, `xlsm`, `xls`. Cell comparison and the simple preview: `xlsx`, `xlsm` only. `csv` stays
  `sheet` (in-app editable). Word extensions are unchanged: `docx`, `doc`, `odt`, `rtf`.
- Stored bytes are never rewritten. The hold, Replace anyway, pulls, bases and copy behave exactly as for Word.
- Button copy names the app by the file: "Edit in Word" / "Edit in Excel"; held and unknown messages say "combine the
  two in Word" / "in Excel".
- `supabase/file-pulls.sql` stays the only SQL file touched; idempotent; apply live with `anon-lockdown.sql`; suite
  `supabase/tests/file-pulls.test.sql` all PASS. That live apply is approved; no other SQL file runs live.
- Copy rules (CLAUDE.md): sentence case, active voice, no "please", no exclamation marks, no "successfully". Tokens only.
- `npm test` and `npm run build` pass before any commit claims a task works.

## Review Focus

1. A held `.xlsx` behaves exactly like a held `.docx` at all three hold sites (open file, upload dialog, draft panel)
   and in the guard. (Task 1 SQL suite, Task 2 tests)
2. A `.csv` still opens in the in-app editor and is still saved as a sheet. (Task 1 test)
3. A converted `sheet` from an old `.xlsx` still opens, with the re-upload note. (Task 2 test)
4. Cell diff on very large sheets stays bounded (first 200 changes, "and N more"). (Task 3 test)
5. An unreadable or `.xls` file shows a plain note instead of a broken comparison. (Task 3 test)

---

### Task 1: Excel files kept exactly, and the database knows them

**Files:** `src/lib/general/files.ts` (+ `files.test.ts`), `src/components/general/NewItemDialog.tsx` (upload path +
notes), `src/lib/general/office.ts` (`OFFICE_WARNING`), `supabase/file-pulls.sql`, `supabase/tests/file-pulls.test.sql`,
`docs/07-backup.md` / `CLAUDE.md` File pulls notes (one line each: Excel too).

**Interfaces — Produces:** `EXCEL_EXTENSIONS`, `isExcelPath(path)`, `isOfficePath(path)` (Word or Excel),
`isComparableExcel(path)` (`xlsx`/`xlsm`), `officeAppName(path): 'Word' | 'Excel'`.

- [ ] Tests first: `kindForPath('a.xlsx' | 'a.xlsm')` → `binary`; `kindForPath('a.csv')` → `sheet`; the helpers above,
  including upper-case extensions and `officeAppName('x.docx') === 'Word'`.
- [ ] Implement. NewItemDialog: `.xlsx`/`.xlsm` go through `uploadProjectFile` (no `xlsxToWorkbook`); the existing
  Word picked-file note generalizes: "Kept exactly as uploaded. From Google Docs or Google Sheets, download it as a
  Microsoft Word (.docx) or Excel (.xlsx) file first." Every Word-only check in the dialog's upload-over-existing
  flow uses `isOfficePath`.
- [ ] SQL: both `\.(docx|doc|odt|rtf)$` checks accept `xlsx|xlsm|xls` too (and the non-Word message becomes
  "Only a Word or Excel file is pulled to edit."). Suite: an `.xlsx` pull, base, held commit refused, Replace-anyway
  base lets it through, and its removal is not held. Apply live, run the suite.
- [ ] `npm test`, `npm run build`, commit "Keep Excel files exactly as uploaded".

### Task 2: Edit in Excel, the viewer and the notes

**Files:** `WordVersionPanel.tsx`, `HeldPush.tsx`, `DraftPanel.tsx`, `FileEditor.tsx`, `RepoChangeRow.tsx`,
`FilesTab.tsx`, `LazyDocxPreview.tsx`, `OfficeViewer.tsx`, `src/lib/general/newVersion.ts` (+ tests).

**Interfaces — Consumes:** Task 1 helpers.

- [ ] Every Word-only check in the pull/push flow and the viewer uses `isOfficePath` (pull, base, hold, unknown,
  Replace anyway, Get theirs, heads-up, Ask/summary eligibility where it gates on Word).
- [ ] Copy by file: `officeAppName` in "Edit in …", the held message's "combine the two in …", `stalePushMessage`, the
  panel note "Edit it in Excel, then upload it here as a new version."
- [ ] Viewer: `.xlsx`/`.xlsm`/`.xls` binaries open in `OfficeViewer` on the live site. The simple preview for
  `.xlsx`/`.xlsm` is the existing `ExcelEditor` with `readOnly`, built from the bytes via `xlsxToWorkbook`, under the
  line "A simplified view. Download to see it exactly as Excel shows it."; `.xls` keeps the generic note. The viewer's
  Google line names Google Sheets for Excel files.
- [ ] Old converted sheets (`kind: 'sheet'` whose path ends `.xlsx`/`.xlsm`): an info Alert above the editor with the
  spec's copy. A `.csv` sheet gets no note.
- [ ] Tests: Edit in Excel label and a held `.xlsx` in `WordVersionPanel`; the converted-sheet note shows for
  `Budget.xlsx` (sheet) and not for `data.csv`.
- [ ] `npm test`, `npm run build`, commit "Edit Excel files in Excel".

### Task 3: Changed cells

**Files:** Create `src/lib/general/sheetCellChanges.ts` (+ test), `src/components/general/ExcelDiff.tsx`; wire it where
`WordDiff` is used in `DraftPanel.tsx`, `RepoChangeRow.tsx`, `FilesTab.tsx` (commit view).

**Interfaces — Produces:** `sheetCellChanges(before: Workbook | null, after: Workbook | null): CellChange[]` with
`CellChange = { sheet: string; cell: string; before: string; after: string }` (cell like `C7`; a formula shows as
`=SUM(A1:A3)`, else the value; a whole added or removed sheet is one entry with `cell: ''`). `ExcelDiff({ before,
after, caption })` takes storage paths (or null, or lazy `() => Promise<string | null>`) like `WordDiff`.

- [ ] Tests: one changed value; a changed formula; an added cell (before `''`); a removed cell (after `''`); an added
  sheet; no changes → `[]`; 1,000 changes are all returned (the cap is the component's).
- [ ] Implement the pure function over `Workbook` (sheets → rows → cells as `sheet.ts` holds them; check its shape).
- [ ] `ExcelDiff`: loads both via `projectFileBlob` + `xlsxToWorkbook`, groups by sheet, shows the first 200 with
  "and N more", caption "Compares cell values and formulas. Formatting and charts do not show here." A load failure
  shows "Could not read one of the versions. Download them to compare in Excel." `.xls` keeps the plain sentence.
- [ ] `npm test`, `npm run build`, commit "Compare Excel versions by their changed cells".

### Task 4: The AI helpers read Excel cells

**Files:** `supabase/functions/work-ai/index.ts`.

- [ ] `xlsxText(bytes)`: unzip `xl/sharedStrings.xml` and `xl/worksheets/sheet*.xml` (plus `xl/workbook.xml` for
  sheet names) with fflate; output `[Sheet: name]` then tab-separated rows, shared-string and inline values resolved.
  `readText` uses it for `.xlsx`/`.xlsm` through the caller's client; `kindOf` returns `binary` for them (`csv` stays
  `sheet`). Existing caps unchanged.
- [ ] `npx -y deno@2.1.4 check --node-modules-dir=none supabase/functions/work-ai/index.ts` passes; commit
  "Let the AI helpers read Excel files kept as uploaded". Deploy waits for the release.
