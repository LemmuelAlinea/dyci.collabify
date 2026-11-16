# Faster Word previews, one PDF per current version

## Why

Opening a long Word file felt like it was converted every time. It was not: the PDF is made once and kept. The
wait was the label ("Making the PDF preview…" shown while only asking for the link), the whole PDF downloading
before page 1 (the thesis: 9.6 MB, 8.7 MB of it full-quality screenshots), and a new link request on every open.
The owner also wants storage kept to what is current: one PDF per Word file's current version, never expiring,
replaced when a commit, merge or restore changes it.

## Decisions (the owner's)

- Keep a PDF for the current Main version of every Word file, with no expiry. A draft copy, an open review request's
  copy and a shared copy keep theirs while they exist. Everything else (an old version, a discarded draft, a closed
  request) loses its PDF.
- Compress images in the PDF: Gotenberg `nativeQuality=85`, `nativeReduceImageResolution=true`,
  `nativeMaxImageResolution=150`. The thesis goes from 9.6 MB to 3.6 MB. The Word file never changes.

## The how

- **Storage rule** (`supabase/word-previews.sql`):
  - `word_preview_keep()` lists the objects whose PDF stays: Main's newest non-removed blob per repo and path,
    draft files, open requests' files and shares' files.
  - `word_preview_orphans(p_limit, p_grace)` lists every other preview older than the grace (15 minutes, so a
    just-uploaded file's preview survives until its draft row or commit lands).
  - The hourly `collabify-preview-sweep` removes them.
  - When a Word blob lands in Main, the trigger `general_blobs_word_preview_drop` removes the replaced version's
    PDF at once, through pg_net, unless something on the keep list still uses that object.
- **Edge function** (`word-pdf`): sends the three image options; answers `size` with the link, so the viewer can
  read the PDF in pieces.
- **Viewer**: `PdfPreview` takes `size` and loads through a `PDFDataRangeTransport` that fetches ranges itself
  (Storage serves `Range` but does not expose its range headers to the browser). `wordPdfUrl` keeps a link for 8
  of its 10 minutes. `WordPdfPreview` says "Opening the PDF preview…" and only after 5 seconds "Making the PDF
  preview…".
- **Restore and revert** warm the restored Word version's PDF, like an upload does.
- **One-off**: existing previews are deleted once so they remake compressed.

## Not doing

- Linearized PDFs (Gotenberg has no option; ranges work without it).
- A PDF for a version nobody can open from the app.
