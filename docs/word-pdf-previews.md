# Word PDF previews

A Word file (`.docx`, `.doc`, `.odt`, `.rtf`) stays exactly as uploaded. What people see in Files is a PDF the
server makes of it, so pages, headers, text boxes and page breaks look as they do in Word. Download always gets
the original Word file.

## How it works

1. An upload (New → Upload, or Upload a new version) calls `warmWordPdf` right away, so the PDF is usually ready
   before anyone opens the file. Opening a file asks again (`wordPdfUrl`); both share one request.
2. The `word-pdf` Edge Function signs the Word file with the caller's own token (storage policies decide who may
   see it), then looks for `file-previews/<storage path>.pdf`. If it is there it answers a 10-minute signed link.
3. If not, it sends the file to the converter (Gotenberg, LibreOffice, on Azure Container Apps), keeps the PDF in
   `file-previews` and answers the link. New conversions are limited to 60 an hour and 300 a day per person.
4. Uploaded objects never change, so a kept PDF never goes stale. Only versions in use keep one (below).

Opening a kept PDF is quick: the function answers its link and size, and the viewer reads it in 64 KB ranges, so
page 1 shows after a few hundred KB instead of the whole file. A link is reused for 8 minutes. The label reads
"Opening the PDF preview…" and changes to "Making the PDF preview…" only after 5 seconds, when a conversion is
running. Images are saved at 150 dpi, quality 85 (the 203-page thesis: 3.8 MB instead of 9.6 MB).

Only versions in use keep a PDF, with no expiry: Main's current version of each Word file, files in a draft, an
open review request or a share. When a commit, merge, revert or restore replaces a Word file's version in Main, the
old version's PDF is deleted at once, and the app starts the new current version's PDF. The hourly sweep removes the
rest.

Excel files keep Microsoft's Office viewer (and the in-app sheet view on localhost).

If the PDF cannot be made, the preview says why and offers **Try again** and, for a `.docx`, **Use the simple
preview** (the in-app page view).

## Parts

- `converter/Dockerfile`: Gotenberg's LibreOffice image plus Microsoft's core fonts (Times New
  Roman, Arial, Courier New, Georgia, Verdana). Calibri and Cambria are replaced by Carlito and Caladea, which
  have the same widths, so lines and page breaks match.
- `supabase/word-previews.sql`: the private `file-previews` bucket (no policies: service role only) and the
  sweep. Runs after `file-pulls.sql`, before `anon-lockdown.sql`.
- `supabase/functions/word-pdf/index.ts`.
- Frontend: `lib/api/wordPdf.ts`, `components/general/WordPdfPreview.tsx`, routed from `LazyDocxPreview`.

## Deploying the converter

The converter runs on **Azure Container Apps** under Azure for Students (no card; verified with the school email).
Its consumption plan's monthly free allowance covers Collabify's use, and it scales to zero when idle, so the first
preview after a quiet spell waits for the container to start (about half a minute).

1. **Image.** `.github/workflows/converter-image.yml` builds `converter/Dockerfile` into
   `ghcr.io/lemmuelalinea/collabify-word-pdf:latest` on every push that touches `converter/` (on `main` or the
   `converter-image` branch). GitHub's registry is free for a public repository; Azure's own registry is not. The
   package must be public so Azure can pull it (GitHub → the package → Package settings → Change visibility).
2. **Container app.** In Azure Cloud Shell (Bash), run the script in `converter/azure-cloud-shell.local` (gitignored:
   it holds the password; regenerate it from `WORD_PDF_PASSWORD` in `.env.local` if lost). It creates the resource
   group `collabify-converter`, the environment `collabify-env` (no log workspace, so no log charges) and the app
   `collabify-word-pdf`: 2 CPUs, 4 GiB, 0 to 2 replicas, port 3000, Gotenberg basic auth with the password as a
   Container Apps secret, `API_TIMEOUT=150s`.
3. **Secrets.** `WORD_PDF_USER` and `WORD_PDF_PASSWORD` are set on the Edge Functions. Then:

```bash
npx supabase secrets set WORD_PDF_URL=https://<the app's address>
```

A new image is picked up by a new revision:

```bash
az containerapp update --name collabify-word-pdf --resource-group collabify-converter --image ghcr.io/lemmuelalinea/collabify-word-pdf:latest --revision-suffix v2
```

Rotating the password: `az containerapp secret set ... --secrets pdfpass=<new>`, restart the revision, then set
`WORD_PDF_PASSWORD` again.
