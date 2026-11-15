# Exact Word files in Files — design

Date: 2026-11-15. Status: draft, waiting for approval. Phase 1 of 2 (phase 2: ONLYOFFICE in-browser editing).

## Why

The user and their group put their thesis (Chapters 1–4, a 2 MB .docx) into a project's Files, saved it to a draft,
committed it to Main and downloaded it. The download came back badly changed. Comparing the two files:

| | Word original | After Collabify |
|---|---|---|
| Margins | 1.5" left, 1.12" right, 1.5" top, 1.23" bottom | 1" all round |
| Sections | 4 (own page numbering, different first page) | 1 |
| Headers | 3, with the school logos | none |
| Fields (table of contents, page numbers, captions) | 396 | 0, now plain text |
| `styles.xml` / `numbering.xml` | 47 KB / 99 KB | 4 KB / 5 KB |
| Pictures | 5 | 2 |
| Default spacing after | 10 pt | 8 pt |

The cause is at upload, not in drafts or Main. `NewItemDialog.savePickedFile` sends every `.docx/.doc/.odt/.rtf`
(`kindForPath` → `rich`) through `docxToHtml`, stores only the HTML and throws the original away. A download rebuilds
a new Word file from that HTML (`htmlToDocx`). Anything the Tiptap editor cannot hold is lost the moment the file is
uploaded. No converter closes that gap: Word's format holds far more than any web editor does.

Students submit these files to their adviser and panel in a strict format, so a file that comes out different from
what went in is worse than no Files tab at all.

## Goals

- A Word file put into Files comes back out **byte-for-byte identical**: download from a draft, from Main, from any
  past commit, from a share, from a change row.
- People see the document inside Collabify as pages that look like Word: paper size, margins, headers and footers,
  page numbers, fonts and sizes, spacing, tables, pictures, lists.
- People change the document in Word (desktop or Word for the web) or Google Docs, then upload the new version to
  their draft or to Main. The draft → submit → Main flow stays as it is.
- Reviewers can see what changed between versions in the words of the document.
- Works the same in work-space projects and in class boards' Files projects (they share `FilesTab`).

## Non-goals

- Editing a Word file in the browser, in this round. The user chose "pull first now, browser editor later":
  ONLYOFFICE Docs is phase 2, once its server (outside Vercel) is decided. Nothing here may block it: the stored
  .docx stays the file, so the phase 2 editor opens and saves the same objects.
- Merging Word files inside Collabify. Word's Compare → Combine does it.
- Excel files. They have the same kind of loss (charts, images) but the user asked about Word and Google Docs. Note
  it as a follow-up.
- Repairing files already uploaded. Their originals were never kept. People upload them again.
- A formatting-level comparison. The comparison is of the words, not of styles or layout.

## Anti-goals

- Any path that rewrites, re-zips or "cleans" the uploaded bytes. The stored object must be the uploaded file.
- A preview that someone mistakes for the file itself. The preview says it is a preview, and the download is always
  one click away.
- Sending a student's document to a third party (Microsoft's or Google's viewers) without their say. No public links.

## Constraints

- Frontend on Vercel, Supabase storage bucket `general-files` (`<project>/files/` objects), 50 MB limit per file
  (`GENERAL_FILE_LIMIT`). Binary blobs already exist end-to-end: `general_blobs.kind = 'binary'` with
  `storage_path`, commit, draft, share, class-teacher read and the storage sweep all already handle them.
- No SQL change is needed for storing. `general_file_kind` already has `binary`.
- Desktop first, then tablet, then phone. The tablet (Xiaomi Pad 7) does not have Times New Roman. See Fonts.
- Heavy libraries load with `import()` when somebody opens a Word file, as `office.ts` does today.
- Copy rules from `CLAUDE.md`. Design tokens only.

## Approaches considered

1. **Keep the original and edit in Word (chosen).** Store the uploaded .docx as a `binary` blob, untouched. Show it
   with a client-side page renderer. Change it in Word or Google Docs and upload a new version. Lossless, no server,
   no cost, smallest build. The cost: nobody types into the document inside Collabify.
2. **In-browser Office editor (ONLYOFFICE Docs).** Near-Word editing and live co-editing, saves a true .docx. Needs a
   Document Server (Docker, about 4 GB RAM, $12–24 a month) outside Vercel, JWT, and a save callback into Supabase.
   The user picked it as phase 2, on top of approach 1, since both keep the real .docx as the file.

For two people editing the same file, three ways were weighed: a check-out lock (nobody else may push while one person
edits), warn-then-replace, and keeping both copies side by side. The user chose a GitHub-like pull first / push with a
held conflict, plus a heads-up showing who has pulled (section 2a).
3. **A better converter.** Rejected: it can never reach 100%, which is exactly the user's complaint.

For the preview, Microsoft's Office web viewer would draw it most like Word, but it needs a link Microsoft can fetch,
which sends the document to Microsoft. That conflicts with the anti-goal above, so it is not used.

## The design

### 1. Upload keeps the file

- `kindForPath` treats `docx`, `doc`, `odt` and `rtf` as `binary` (drop them from `RICH`). From then on uploads go
  through `uploadProjectFile` and `saveDraftFile({ kind: 'binary', storagePath })`, the path PDFs already take.
  Folder uploads take the same path.
- The upload dialog's Word note (`OFFICE_WARNING` about what does not come across) goes, for Word. Excel's line stays.

### 2. Upload a new version

Today a second upload to an existing path is refused ("The project already has a file with that name here"), so a
binary file can never change. Add **Upload a new version** to the open file (`FileEditor`) for every `binary` file,
not only Word: it is the same action and the gap is the same.

- It picks a file, checks it has the same extension (a .docx replaces a .docx; otherwise say so and stop), uploads
  it, and saves a draft row with `action: 'modified'` (or the existing draft row is replaced).
- For whoever holds `commit_main`, it offers the same two choices the editor has today: **Save to my draft** and
  **Commit to Main** (with the commit message field and the "write it for me" helper).
- The old version stays in history, so nothing is lost.

**Upload dialog (my call).** Students will re-upload from New → Upload, not only from the open file. So when a picked
file's name already exists in Main or the draft, the dialog stops refusing: it says "<name> is already here" and
offers **Upload as a new version** (same path, `modified`) or **Rename**. A folder upload that contains existing names
lists them and asks once, "Upload N files as new versions?", before it saves anything. The same-extension rule
applies.

### 2a. Pull, edit in Word, push (the user's choice)

Collabify cannot merge two Word files, so it works like GitHub: you pull the latest before you edit, and a push made
from an old copy is held until it is brought up to date. Word does the merging (Review → Compare → Combine).

- **Pull.** An open Word file has **Edit in Word**. It downloads the exact file and records a pull: who, which repo
  and path, which version (the blob seq / commit it came from, Main's or their own draft's), and when. Plain Download
  stays as it is and records nothing. Needs a new table (e.g. `general_file_pulls`, one live row per person and path),
  readable by anyone who can read the project, written only by the person through an RPC. New SQL file after
  `space-look.sql`, before `anon-lockdown.sql`, with a test suite, and listed in `docs/07-backup.md`.
- **Who is working on it.** The file row and the open file show "Ana pulled this 2 hours ago" for every live pull
  other than yours. A heads-up only, never a lock. A pull ends when that person pushes the path, clicks
  **I'm done editing**, or after 7 days (my call).
- **Push.** Uploading a new version (the button or the upload dialog) compares the version you pulled with Main's
  current version of that path:
  - Same: it goes to your draft or Main as usual.
  - Main moved since you pulled: it is **held**. The message names who changed it and when ("Ben updated this
    since you pulled, 3:10 PM"), shows the words Ben changed (section 5), and offers **Download Ben's version**.
    The person combines the two in Word and pushes again; that download counts as a new pull. They can also choose
    **Replace it anyway**, which asks once more and names whose changes will be gone.
  - No pull on record (they got the file some other way): treat Main's current version as the base, and say so:
    "Collabify doesn't know which copy you started from. If it wasn't Main's version from <date>, someone's changes
    may be lost." (my call)
- **Checked again at the end.** The same check runs when a draft is submitted and when a reviewer brings it into
  Main, since Main can move after the draft was saved. A held file shows in the draft panel with the same message.
  The database enforcing the check, rather than only the app, is the builder's call, following the file-ownership
  rules in `CLAUDE.md` for whichever function it touches.

### 3. See the pages (preview)

- New `DocxPreview` component, lazy-loaded, rendering with the `docx-preview` library (Apache-2.0, v0.4.x) from the
  stored object's bytes, the way `PdfPreview` renders PDFs. Options: real page breaks (`breakPages`), headers and
  footers, footnotes and endnotes on, `ignoreLastRenderedPageBreak: false` so pages break where Word last broke them.
- Shown in `FileEditor` for Word files (draft, Main, past commit, shared copy), and in `RepoChangeRow` where PDFs and
  images get a preview today.
- Pages sit on the sunken surface with the paper white in both themes (a document is paper; dark mode does not invert
  it). Fit to width on tablet and phone, with zoom.
- A short line above it: "A preview. Download to see it exactly as Word shows it." Download and Edit in Word sit
  next to it.
- `.doc` (old binary Word) and `.rtf` cannot be drawn by the library: they show the existing "kept and versioned
  here but opened elsewhere" note. `.odt` likewise.
- If rendering fails, show that note with Download, never a blank panel.
- **The preview is best effort (my call).** Fields such as PAGE numbers and the table of contents show whatever
  `docx-preview` draws (often the values Word last saved). No server-side or third-party renderer is added to make
  the preview exact; the exact copy is always the download.

### 4. Fonts

Word lays out with the fonts it has. The preview can only match if the browser has metric-compatible fonts. Ship the
common thesis fonts' metric twins as web fonts scoped to the preview: Liberation Serif for Times New Roman, Liberation
Sans for Arial, Carlito for Calibri, Caladea for Cambria, mapped by `@font-face` family names so the document's own
font names resolve to them. Loaded only with the preview.

### 5. What changed (review)

- Where a change row or the commit view says "An uploaded file. Its contents are not compared here," Word files get
  a words comparison instead: extract the text of the before and after versions (`mammoth.extractRawText`, already a
  dependency, as `notesFile.ts` does) and show it in the existing `DiffView`, one paragraph per line.
- Caption it as a comparison of the words: "Compares the words only. Formatting changes do not show here."

### 6. AI helpers read Word text (my call)

Today `work-ai` reads Word content through `rich` blobs; its `fileText` returns `''` for `binary` and `askAction`
skips binary files. After this change every helper would go quiet on theses, so all of them read `.docx` text from
the stored object with the function's existing `docxText` helper: the file summary (`summarizable` in `FileEditor`
extends to `.docx`), "write it for me" (`describeAction`), the change summary (`summarizeChangeAction` /
`beforeAfter`), project Q&A (`askAction`) and `tasksAction`. Text is capped with the limits those paths already use.
`work-ai` is redeployed with the frontend.

### 7. Files already converted

Existing `rich` blobs keep opening in today's Word editor, so nothing breaks. Above them, an info note: "This copy was
converted when it was uploaded, so some Word formatting may be gone. Upload the original .docx as a new version to
keep it exactly." Uploading a new version stores it as `binary` from then on.

### 8. Google Docs

Google Docs files reach Files as .docx (File → Download → Microsoft Word). The upload dialog and the preview note say
one line on it: editing a .docx in Google Docs keeps it as a Word file, while converting it to a Google Doc and back
can change the formatting, which happens in Google, not in Collabify.

## Left to the builder

- Component names, file layout and test layout, within the repo's conventions (Vitest beside the code).
- How `docx-preview` is styled to fit the tokens (its own CSS is scoped to the preview).
- Whether the words comparison runs on both versions at open or on demand.
- Where the font files are hosted (self-hosted in `public/` is fine).
- Whether `htmlToDocx`, `docxToHtml` and the Tiptap Word editor stay. They do while `rich` blobs exist (section 7)
  and Discussions and Reports still export with `htmlToDocx`.

## Done means

- Upload the user's Chap1-4 .docx, save to a draft, commit to Main, download from Main: the SHA-256 of the download
  equals the original's.
- The preview shows the logos in the header and the 1.5" left margin, with page numbers where `docx-preview` draws
  them.
- Upload a changed copy as a new version; the change row shows the changed words; the old version still downloads
  identical to the first upload.
- Two accounts pull the same file. A pushes; B's push is held, names A, shows A's changed words and offers A's
  version. B pushes again after pulling A's version and it goes through. Each sees the other's "pulled" heads-up
  until they push.
- Works in a work-space project and a class board's Files project. `npm run build` and the tests pass.
