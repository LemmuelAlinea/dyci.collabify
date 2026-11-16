// A Word file's PDF preview, made once and kept.
//
//   POST { storage_path }  ->  { result: 'ok', url, size }   (a 10-minute signed link, and
//                                                    the PDF's bytes so the viewer can read it in ranges)
//
// The Word file itself is never changed. Its PDF lives in the private
// file-previews bucket at `<storage_path>.pdf` (supabase/word-previews.sql), made
// by the Gotenberg converter on Azure Container Apps (converter/Dockerfile) the first time
// anyone asks. Uploaded objects never change, so a kept PDF never goes stale.
// supabase/word-previews.sql keeps one PDF per version in use (Main's current
// version, drafts, open requests, shares) and drops the rest.
//
// Images are saved at most 150 dpi, JPEG quality 85: the thesis's screenshots went
// from 8.7 MB to about 3 MB, and the PDF is only what people see.
//
// Access: the caller's own token signs the Word file first, so the storage
// policies decide who may see it; only then does the service role read the
// preview bucket. Nobody can plant a PDF: the bucket has no policies.
//
// Deploy:  supabase functions deploy word-pdf
// Secrets: supabase secrets set WORD_PDF_URL=https://<app>.azurecontainerapps.io \
//            WORD_PDF_USER=collabify WORD_PDF_PASSWORD=<the converter's password>
//   (WORD_PDF_URL is the Azure Container App's https address.)

import { createClient } from 'npm:@supabase/supabase-js@2'
import { strFromU8, strToU8, unzipSync, zipSync } from 'npm:fflate'
import { cors, denied } from '../_shared/cors.ts'
import { pageAlignedSections } from '../_shared/wordSections.ts'

const SOURCE = 'general-files'
const PREVIEWS = 'file-previews'
/** `<project uuid>/files/<object name>.<word extension>`, as uploadProjectFile names them. */
const WORD_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/files\/[^/]+\.(docx|doc|odt|rtf)$/i
const LINK_SECONDS = 600
/** Long theses take a while in LibreOffice; starting a scaled-to-zero container adds more. */
const CONVERT_MS = 140_000
/** Gotenberg 9's LibreOffice image options. */
const IMAGE_OPTIONS: Record<string, string> = {
  nativeQuality: '85',
  nativeReduceImageResolution: 'true',
  nativeMaxImageResolution: '150',
}

/** The kept preview's size in bytes, or null when there is none. */
async function keptSize(admin: ReturnType<typeof createClient>, previewPath: string): Promise<number | null> {
  const slash = previewPath.lastIndexOf('/')
  const folder = previewPath.slice(0, slash)
  const file = previewPath.slice(slash + 1)
  const { data, error } = await admin.storage.from(PREVIEWS).list(folder, { search: file, limit: 5 })
  if (error) return null
  const found = (data ?? []).find((o) => o.name === file)
  const size = Number((found?.metadata as { size?: number } | undefined)?.size)
  return found && Number.isFinite(size) && size > 0 ? size : null
}

function json(headers: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

/**
 * The copy sent to the converter: a .docx whose continuous section breaks start
 * new headers at a page top gets those as page breaks (_shared/wordSections.ts),
 * so LibreOffice switches the header where Word does. Anything it cannot read
 * goes as it is.
 */
function forLibreOffice(bytes: Uint8Array, path: string): Uint8Array {
  if (!/\.docx$/i.test(path)) return bytes
  try {
    const files = unzipSync(bytes)
    const document = files['word/document.xml']
    if (!document) return bytes
    const fixed = pageAlignedSections(strFromU8(document))
    if (fixed.changed === 0) return bytes
    files['word/document.xml'] = strToU8(fixed.xml)
    return zipSync(files)
  } catch {
    return bytes
  }
}

function fail(headers: Record<string, string>, message: string, status = 400) {
  return json(headers, { result: 'failed', message }, status)
}

Deno.serve(async (req) => {
  const { headers: CORS, allowed } = cors(req)
  if (!allowed) return denied(CORS)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const converter = Deno.env.get('WORD_PDF_URL')
  const user = Deno.env.get('WORD_PDF_USER') ?? ''
  const password = Deno.env.get('WORD_PDF_PASSWORD') ?? ''

  try {
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user: me } } = await caller.auth.getUser()
    if (!me) return fail(CORS, 'Sign in first.', 401)

    const body = (await req.json().catch(() => ({}))) as { storage_path?: unknown }
    const path = String(body.storage_path ?? '')
    if (!WORD_PATH.test(path)) return fail(CORS, 'Only Word files get a PDF preview.')

    // The caller's own token: storage policies decide whether they may see the file.
    const signed = await caller.storage.from(SOURCE).createSignedUrl(path, 60)
    if (signed.error || !signed.data?.signedUrl) return fail(CORS, 'You cannot open this file.', 403)

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
    const previewPath = `${path}.pdf`

    const size = await keptSize(admin, previewPath)
    if (size) {
      const kept = await admin.storage.from(PREVIEWS).createSignedUrl(previewPath, LINK_SECONDS)
      if (!kept.error && kept.data?.signedUrl) return json(CORS, { result: 'ok', url: kept.data.signedUrl, size })
    }

    if (!converter) return fail(CORS, 'The PDF converter is not set up on the server yet.', 503)

    // A new conversion is real work: hold each person to a fair share.
    for (const [suffix, max, per, message] of [
      ['hour', 60, '01:00:00', 'That is 60 new previews in an hour. Try again later, or download the file.'],
      ['day', 300, '24:00:00', 'That is 300 new previews today. Download the file, or come back tomorrow.'],
    ] as const) {
      const limited = await caller.rpc('rate_limit', {
        p_bucket: `word_pdf_${suffix}`,
        p_max: max,
        p_per: per,
        p_message: message,
      })
      if (limited.error) return fail(CORS, limited.error.message, 429)
    }

    const source = await fetch(signed.data.signedUrl)
    if (!source.ok) return fail(CORS, 'Could not read the Word file. Reopen it and try again.', 502)
    const bytes = forLibreOffice(new Uint8Array(await source.arrayBuffer()), path)

    const name = path.slice(path.lastIndexOf('/') + 1).replace(/^[0-9a-f-]{36}-/i, '') || 'file.docx'
    const form = new FormData()
    form.append('files', new Blob([bytes]), name)
    for (const [field, value] of Object.entries(IMAGE_OPTIONS)) form.append(field, value)

    const converted = await fetch(`${converter.replace(/\/$/, '')}/forms/libreoffice/convert`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${user}:${password}`)}` },
      body: form,
      signal: AbortSignal.timeout(CONVERT_MS),
    })
    if (!converted.ok) {
      console.error('word-pdf: converter answered', converted.status, (await converted.text()).slice(0, 300))
      return fail(CORS, 'Could not turn this file into a PDF. Download it to open it in Word.', 502)
    }
    const pdf = new Uint8Array(await converted.arrayBuffer())

    const stored = await admin.storage.from(PREVIEWS).upload(previewPath, pdf, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (stored.error) {
      console.error('word-pdf: storing the preview failed', stored.error.message)
      return fail(CORS, 'The PDF was made but could not be kept. Try again.', 500)
    }

    const link = await admin.storage.from(PREVIEWS).createSignedUrl(previewPath, LINK_SECONDS)
    if (link.error || !link.data?.signedUrl) return fail(CORS, 'Could not open the PDF preview. Try again.', 500)
    return json(CORS, { result: 'ok', url: link.data.signedUrl, size: pdf.byteLength })
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError'
    console.error('word-pdf:', err)
    return fail(
      CORS,
      timedOut
        ? 'This file is taking too long to turn into a PDF. Download it to open it in Word.'
        : 'Could not make the PDF preview. Try again.',
      timedOut ? 504 : 500,
    )
  }
})
