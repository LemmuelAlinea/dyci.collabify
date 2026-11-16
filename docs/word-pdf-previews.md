# Word PDF previews

A Word file (`.docx`, `.doc`, `.odt`, `.rtf`) stays exactly as uploaded. What people see in Files is a PDF the
server makes of it, so pages, headers, text boxes and page breaks look as they do in Word. Download always gets
the original Word file.

## How it works

1. An upload (New → Upload, or Upload a new version) calls `warmWordPdf` right away, so the PDF is usually ready
   before anyone opens the file. Opening a file asks again (`wordPdfUrl`); both share one request.
2. The `word-pdf` Edge Function signs the Word file with the caller's own token (storage policies decide who may
   see it), then looks for `file-previews/<storage path>.pdf`. If it is there it answers a 10-minute signed link.
3. If not, it sends the file to the converter (Gotenberg, LibreOffice, on Cloud Run), keeps the PDF in
   `file-previews` and answers the link. New conversions are limited to 60 an hour and 300 a day per person.
4. Uploaded objects never change, so a kept PDF never goes stale. `collabify-preview-sweep` (hourly) removes a
   preview once its Word file is gone from storage.

Excel files keep Microsoft's Office viewer (and the in-app sheet view on localhost).

If the PDF cannot be made, the preview says why and offers **Try again** and, for a `.docx`, **Use the simple
preview** (the in-app page view).

## Parts

- `converter/Dockerfile`: Gotenberg's LibreOffice image for Cloud Run plus Microsoft's core fonts (Times New
  Roman, Arial, Courier New, Georgia, Verdana). Calibri and Cambria are replaced by Carlito and Caladea, which
  have the same widths, so lines and page breaks match.
- `supabase/word-previews.sql`: the private `file-previews` bucket (no policies: service role only) and the
  sweep. Runs after `file-pulls.sql`, before `anon-lockdown.sql`.
- `supabase/functions/word-pdf/index.ts`.
- Frontend: `lib/api/wordPdf.ts`, `components/general/WordPdfPreview.tsx`, routed from `LazyDocxPreview`.

## Deploying the converter

Needs a Google Cloud project with billing on (Cloud Run's free tier covers about 20,000 conversions a month) and
the `gcloud` CLI signed in.

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

```bash
gcloud run deploy collabify-word-pdf --source converter --region asia-southeast1 --memory 2Gi --cpu 2 --timeout 300 --concurrency 2 --max-instances 3 --allow-unauthenticated --set-env-vars "API_ENABLE_BASIC_AUTH=true,GOTENBERG_API_BASIC_AUTH_USERNAME=collabify,GOTENBERG_API_BASIC_AUTH_PASSWORD=<password>,API_TIMEOUT=150s"
```

`--allow-unauthenticated` only opens the door to Cloud Run; Gotenberg's basic auth refuses every request without
the password. Then give the Edge Function the address and password:

```bash
npx supabase secrets set WORD_PDF_URL=https://<service>.run.app WORD_PDF_USER=collabify WORD_PDF_PASSWORD=<password>
```

Rotating the password: redeploy with the new value, then set `WORD_PDF_PASSWORD` again.
