# Exact Excel files in Files — design

Date: 2026-11-16. Status: draft, waiting for approval. Builds on `2026-11-15-exact-word-files-design.md` (shipped).

## Why

Excel uploads (`.xlsx`, `.xlsm`) go through the same lossy path Word files used to: `NewItemDialog` converts them to
Collabify's sheet JSON (`kind: 'sheet'`) and throws the original away. Values, formulas, fonts, fills, borders,
merges and widths survive; charts, pictures, pivot tables, macros, conditional formatting, data validation and
comments do not. The owner wants Excel to work the way Word now does.

## Decisions (the owner's)

- **Same as Word.** `.xlsx` and `.xlsm` are kept byte-for-byte as uploaded (`binary`), shown in Microsoft's Office
  viewer, and changed with **Edit in Excel** → **Upload a new version**, with the same pull, hold, Replace anyway and
  "is editing" heads-up. The in-app spreadsheet editor no longer opens `.xlsx`/`.xlsm` uploads.
- **Changed cells.** Reviewers see, per sheet, the cells whose value or formula changed between two versions, e.g.
  `Budget!C7: 12,500 → 13,000`. Formatting and chart changes are not listed.

## My calls (stated, correctable)

- `.csv` stays an in-app editable sheet: it is plain text, nothing is lost.
- `.xls` (already `binary`) joins the Excel flow: Edit in Excel, new versions, the hold and the viewer. No cell
  comparison for `.xls` (the reader handles `.xlsx` only); it says so.
- Sheets already converted (`kind: 'sheet'` from an `.xlsx`) keep opening in the in-app editor with a note: "This copy
  was converted when it was uploaded, so charts, pictures and some formatting may be gone. Upload the original .xlsx
  as a new version to keep it exactly."
- On a developer machine, where Microsoft's viewer cannot reach the file, the "simple preview" of an Excel file is the
  existing in-app sheet view, read-only, built from the file's bytes; it says it is a simplified view.
- Google Sheets: "From Google Sheets, download it as Microsoft Excel (.xlsx) before uploading."
- `work-ai` reads cell text from `.xlsx` files (summary, Ask, Write it, change summary), like `.docx`.
- The ⋯ menu (Download, Delete file) already covers every file, Excel included.

## How

- `files.ts`: drop `xlsx`/`xlsm` from `SHEET` (keep `csv`); add `EXCEL_EXTENSIONS` (`xlsx`, `xlsm`, `xls`),
  `isExcelPath`, `isOfficePath` (Word or Excel), `isComparableExcel` (`xlsx`, `xlsm`), and an `officeAppName(path)`
  ("Word" / "Excel") for button copy.
- `supabase/file-pulls.sql` (our file): `pull_general_file` and `record_general_file_base` accept Excel extensions too;
  suite cases for an `.xlsx` pull, base and hold; apply live with `anon-lockdown.sql`.
- App: every Word-only check in the pull/push flow (`WordVersionPanel`, `NewItemDialog`, `DraftPanel`, `FileEditor`,
  `LazyDocxPreview`/`OfficeViewer`) uses `isOfficePath`; copy names Word or Excel by the file. Microsoft's viewer
  already renders `.xlsx`, `.xlsm` and `.xls`.
- Changed cells: `sheetCellChanges(before: Workbook, after: Workbook)` → `{ sheet, cell, before, after }[]` (value or
  formula text; added and removed sheets reported as a whole), read with the existing `xlsxToWorkbook`. An
  `ExcelDiff` component shows them grouped by sheet, capped (first 200 changes, then "and N more"), and sits where
  `WordDiff` sits (draft, change and commit views).
- `work-ai`: an `xlsxText(bytes)` that unzips shared strings and sheet XML into tab-separated rows, used by `readText`.

## Done means

- An `.xlsx` with a chart uploaded, committed and downloaded from Main has the same SHA-256 as the original.
- The live viewer shows the chart. A second version shows its changed cells. Two accounts get the same hold as Word.
- `npm test`, `npm run build`, the SQL suite and the `work-ai` type check pass.

## Out of scope

In-browser editing of `.xlsx` (ONLYOFFICE phase 2), comparing formatting or charts, `.xls` cell comparison.
