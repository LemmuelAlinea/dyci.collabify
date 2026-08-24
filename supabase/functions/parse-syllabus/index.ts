// Reads an uploaded syllabus and drafts its weeks.
//
// Runs as an Edge Function because it needs the Anthropic key, which must stay
// server-side. Parsing is a convenience, never a dependency: every failure path
// leaves the syllabus editable by hand.
//
// Deploy:  supabase functions deploy parse-syllabus
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { extractText, getDocumentProxy } from 'npm:unpdf'
import { unzipSync, strFromU8 } from 'npm:fflate'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MODEL = 'claude-opus-5'

/** The shape the model must return. Structured outputs guarantee it parses. */
const WEEK_SCHEMA = {
  type: 'object',
  properties: {
    weeks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          week_no: { type: 'integer' },
          title: { type: 'string' },
          topics: { type: 'string' },
          outcomes: { type: 'string' },
          assessments: { type: 'string' },
        },
        required: ['week_no', 'title', 'topics', 'outcomes', 'assessments'],
        additionalProperties: false,
      },
    },
  },
  required: ['weeks'],
  additionalProperties: false,
} as const

const SYSTEM = `You read course syllabi from BSIT programs in the Philippines and
extract the weekly schedule.

Rules:
- One entry per teaching week, numbered from 1 in the order the syllabus gives.
- title: a short name for the week, at most about eight words.
- topics: the subject matter for that week, as written in the syllabus, condensed.
  Do not put graded work here — that belongs in assessments.
- outcomes: the learning outcomes for that week, or an empty string when the
  syllabus does not state any for it.
- assessments: exactly what the week expects to be handed in or sat, copied as
  named — "Lab 2: input-data profile", "Quiz 1; Project Milestone 2",
  "Final project bundle and defense". Syllabi usually carry these in a column
  called Assessment, Evidence, Requirements, Output, or Deliverables. Keep the
  names verbatim, since projects are built against them. Empty string when the
  week names none. Do not repeat learning activities here — only assessed work.
- Copy what the document says. Do not invent weeks, topics, outcomes, or
  assessments, and do not fill gaps with what a course like this usually covers.
- Ignore grading tables, class policies, references, and the preamble.
- If the document has no weekly schedule at all, return an empty list.`

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/** DOCX is a zip; the body text lives in word/document.xml. */
function docxToText(bytes: Uint8Array) {
  const files = unzipSync(bytes)
  const xml = files['word/document.xml']
  if (!xml) return ''
  return strFromU8(xml)
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function pdfToText(bytes: Uint8Array) {
  const doc = await getDocumentProxy(bytes)
  const { text } = await extractText(doc, { mergePages: true })
  return (text ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')

  if (!apiKey) {
    return json(
      { result: 'failed', message: 'The AI key is not set on the server yet.' },
      200,
    )
  }

  const admin = createClient(url, serviceKey)
  let resourceId = ''

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user },
    } = await caller.auth.getUser()
    if (!user) return json({ result: 'failed', message: 'Sign in first.' }, 401)

    /**
     * How often this person may ask. Enforced in the database rather than here,
     * so it survives a second copy of this function, a restart, and anybody
     * calling the endpoint directly — an in-memory counter in an edge runtime
     * resets whenever the instance does, which is exactly when it matters.
     *
     * Two windows, because the shapes of misuse differ: a loop hits the hourly
     * one in seconds, while a slow drip that would still run up a bill over a
     * weekend hits the daily one.
     */
    const limited = await caller.rpc('rate_limit', {
      p_bucket: 'ai_parse_syllabus_hour',
      p_max: 8,
      p_per: '01:00:00',
      p_message: 'That is eight syllabus reads in an hour. Wait a while before uploading another.',
    })
    if (limited.error) {
      return json({ result: 'failed', message: limited.error.message }, 429)
    }

    const limitedDay = await caller.rpc('rate_limit', {
      p_bucket: 'ai_parse_syllabus_day',
      p_max: 30,
      p_per: '24:00:00',
      p_message: 'That is thirty syllabus reads today. Come back tomorrow.',
    })
    if (limitedDay.error) {
      return json({ result: 'failed', message: limitedDay.error.message }, 429)
    }

    const body = await req.json().catch(() => ({}))
    resourceId = String(body.resource_id ?? '')
    if (!resourceId) return json({ result: 'failed', message: 'No syllabus given.' }, 400)

    // Ownership is checked against the caller's own JWT, never the id alone.
    const { data: resource } = await caller
      .from('teaching_resources')
      .select('id, file_path, file_name, kind, professor_id')
      .eq('id', resourceId)
      .maybeSingle()

    if (!resource || resource.professor_id !== user.id) {
      return json({ result: 'failed', message: 'That syllabus is not yours.' }, 403)
    }

    await admin
      .from('teaching_resources')
      .update({ parse_status: 'parsing', parse_error: null })
      .eq('id', resourceId)

    const { data: blob, error: dlErr } = await admin.storage
      .from('teaching-resources')
      .download(resource.file_path)
    if (dlErr || !blob) throw new Error('The file could not be downloaded.')

    const bytes = new Uint8Array(await blob.arrayBuffer())
    const name = String(resource.file_name).toLowerCase()

    let text = ''
    if (name.endsWith('.pdf')) text = await pdfToText(bytes)
    else if (name.endsWith('.docx')) text = docxToText(bytes)
    else {
      throw new Error(
        'Only PDF and Word (.docx) files can be read automatically. Add the weeks by hand.',
      )
    }

    if (text.length < 200) {
      throw new Error(
        'No readable text was found — the file may be a scan. Add the weeks by hand.',
      )
    }

    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: WEEK_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: `Extract the weekly schedule from this syllabus.\n\n${text.slice(0, 120_000)}`,
        },
      ],
    })

    if (message.stop_reason === 'refusal') {
      throw new Error('The file could not be read. Add the weeks by hand.')
    }

    const textBlock = message.content.find((b) => b.type === 'text')
    const parsed = JSON.parse(textBlock && 'text' in textBlock ? textBlock.text : '{}')

    const weeks = (parsed.weeks ?? [])
      .filter((w: { week_no?: number }) => Number.isInteger(w.week_no) && w.week_no! > 0)
      // The unique index is per (resource, week_no); drop duplicates rather
      // than failing the whole parse on one repeated number.
      .filter(
        (w: { week_no: number }, i: number, all: { week_no: number }[]) =>
          all.findIndex((o) => o.week_no === w.week_no) === i,
      )
      .slice(0, 60)
      .map((w: Record<string, unknown>) => ({
        resource_id: resourceId,
        week_no: w.week_no,
        title: String(w.title ?? '').slice(0, 200),
        topics: String(w.topics ?? ''),
        outcomes: String(w.outcomes ?? ''),
        assessments: String(w.assessments ?? ''),
      }))

    await admin.from('syllabus_weeks').delete().eq('resource_id', resourceId)
    if (weeks.length > 0) {
      const { error } = await admin.from('syllabus_weeks').insert(weeks)
      if (error) throw new Error(error.message)
    }

    await admin
      .from('teaching_resources')
      .update({
        parse_status: weeks.length > 0 ? 'draft' : 'failed',
        parsed_at: new Date().toISOString(),
        parse_error:
          weeks.length > 0 ? null : 'No weekly schedule was found in this file.',
      })
      .eq('id', resourceId)

    return json({ result: weeks.length > 0 ? 'ok' : 'failed', weeks: weeks.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The file could not be read.'
    if (resourceId) {
      await admin
        .from('teaching_resources')
        .update({ parse_status: 'failed', parse_error: message })
        .eq('id', resourceId)
    }
    return json({ result: 'failed', message })
  }
})
