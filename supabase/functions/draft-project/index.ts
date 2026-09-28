// Drafts a project brief and its rubric from the syllabus weeks it covers.
//
// Same rules as generate-tasks: the key stays server-side, everything is read
// through the caller's JWT, and it only ever returns a draft. The professor
// sees it in the ordinary guidelines and rubric fields and edits it there;
// nothing reaches students until they save the project themselves.
//
// Deploy:  supabase functions deploy draft-project
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, corsMode, denied } from '../_shared/cors.ts'

const MODEL = 'claude-opus-5'

const SCHEMA = {
  type: 'object',
  properties: {
    guidelines: { type: 'string' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          description: { type: 'string' },
          weight: { type: 'integer' },
        },
        required: ['label', 'description', 'weight'],
        additionalProperties: false,
      },
    },
    note: { type: 'string' },
  },
  required: ['guidelines', 'criteria', 'note'],
  additionalProperties: false,
} as const

const SYSTEM = `You draft the brief and the marking rubric for a BSIT course
project, for a professor in the Philippines to edit. You are given the kind of
project, who does it, and the syllabus weeks it is built on: their topics,
learning outcomes and the assessments the syllabus expects.

Rules:
- Build only on what the weeks give. Do not add topics the weeks do not cover,
  tools the syllabus does not name, or requirements nobody asked for.
- guidelines: the brief students read. Plain text, no markdown headings. Two to
  five short paragraphs or a short list: what to make, what to hand in, and how
  it will be checked. Address the students directly ("you" or "your group").
  Sentence case. No exclamation marks, no "please", no filler.
- criteria: 3 to 6 rubric rows that follow from the outcomes. label: a few
  words naming what is judged. description: one sentence on what full marks
  looks like. weight: 1 to 10, how much this row matters next to the others;
  the app turns weights into points.
- If a project title is given, fit the brief to it.
- note: one short sentence on what you based this on, or what the weeks left
  unclear. Never advice, never encouragement.
- If the weeks give too little to draft anything honest, return empty
  guidelines and no criteria, and say so in note.`

function json(headers: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

/**
 * Weights into whole points that add up to exactly `total`. Largest
 * remainders take the leftover points, so rounding never loses or invents one.
 */
function toPoints(weights: number[], total: number) {
  const sum = weights.reduce((n, w) => n + w, 0)
  if (sum <= 0 || total <= 0) return weights.map(() => 0)
  const raw = weights.map((w) => (w / sum) * total)
  const out = raw.map(Math.floor)
  let left = total - out.reduce((n, p) => n + p, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (left <= 0) break
    out[i]++
    left--
  }
  return out
}

console.log(`[cors] ${corsMode()}`)

Deno.serve(async (req) => {
  const { headers: CORS, allowed } = cors(req)
  if (!allowed) return denied(CORS)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json(CORS, { result: 'failed', message: 'The AI key is not set on the server yet.' })
  }

  try {
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const {
      data: { user },
    } = await caller.auth.getUser()
    if (!user) return json(CORS, { result: 'failed', message: 'Sign in first.' }, 401)

    const body = await req.json().catch(() => ({}))
    const classId = String(body.class_id ?? '')
    const startWeek = Number(body.start_week)
    const endWeek = Number(body.end_week)
    const total = Math.max(1, Math.min(1000, Math.round(Number(body.total_points) || 100)))
    if (!classId || !Number.isInteger(startWeek) || !Number.isInteger(endWeek)) {
      return json(CORS, { result: 'failed', message: 'Pick the weeks first.' }, 400)
    }

    // Only someone teaching the class drafts its projects.
    const { data: teaches } = await caller.rpc('is_class_professor', { p_class: classId })
    if (!teaches) {
      return json(CORS, { result: 'failed', message: 'Only someone teaching this class can draft its projects.' }, 403)
    }

    for (const [bucket, max, per, message] of [
      ['ai_draft_project_hour', 12, '01:00:00', 'That is twelve drafts in an hour. Edit what you have, or try again later.'],
      ['ai_draft_project_day', 50, '24:00:00', 'That is fifty drafts today. Come back tomorrow.'],
    ] as const) {
      const limited = await caller.rpc('rate_limit', {
        p_bucket: bucket,
        p_max: max,
        p_per: per,
        p_message: message,
      })
      if (limited.error) return json(CORS, { result: 'failed', message: limited.error.message }, 429)
    }

    const [{ data: cls }, { data: weeks }] = await Promise.all([
      caller.from('classes').select('name').eq('id', classId).maybeSingle(),
      caller
        .from('class_week_map')
        .select('week_no, title, topics, outcomes, assessments')
        .eq('class_id', classId)
        .gte('week_no', Math.min(startWeek, endWeek))
        .lte('week_no', Math.max(startWeek, endWeek))
        .order('week_no'),
    ])

    type Week = { week_no: number; title: string; topics: string; outcomes: string; assessments: string }
    const brief = [
      `Course: ${cls?.name ?? 'BSIT course'}`,
      body.title ? `Project title: ${String(body.title).slice(0, 200)}` : '',
      `Type: ${String(body.type_label || body.type || 'activity').slice(0, 60)}`,
      `Done by: ${body.audience === 'group' ? 'a group together' : 'each student alone'}`,
      `Worth: ${total} points`,
      '',
      `Syllabus weeks ${startWeek}–${endWeek}:`,
      ((weeks ?? []) as Week[])
        .map((w) =>
          [
            `Week ${w.week_no}: ${w.title}`,
            w.topics ? `  Topics: ${w.topics}` : '',
            w.outcomes ? `  Outcomes: ${w.outcomes}` : '',
            w.assessments ? `  Expected: ${w.assessments}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        )
        .join('\n') || '(no week detail)',
    ]
      .filter((line) => line !== '')
      .join('\n')

    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      messages: [{ role: 'user', content: `Draft the brief and rubric.\n\n${brief}` }],
    })

    if (message.stop_reason === 'refusal') {
      return json(CORS, { result: 'failed', message: 'No draft could be produced for these weeks.' })
    }

    const textBlock = message.content.find((b) => b.type === 'text')
    const parsed = JSON.parse(textBlock && 'text' in textBlock ? textBlock.text : '{}')

    const rows = (parsed.criteria ?? [])
      .filter((c: { label?: string }) => String(c.label ?? '').trim().length > 0)
      .slice(0, 6)
      .map((c: Record<string, unknown>) => ({
        label: String(c.label ?? '').slice(0, 120),
        description: String(c.description ?? '').slice(0, 400),
        weight: Math.max(1, Math.min(10, Number(c.weight) || 1)),
      }))
    const points = toPoints(
      rows.map((r: { weight: number }) => r.weight),
      total,
    )

    return json(CORS, {
      result: 'ok',
      guidelines: String(parsed.guidelines ?? '').slice(0, 4000),
      criteria: rows.map((r: { label: string; description: string }, i: number) => ({
        label: r.label,
        description: r.description,
        max_points: points[i],
      })),
      note: String(parsed.note ?? '').slice(0, 300),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The draft could not be produced.'
    return json(CORS, { result: 'failed', message })
  }
})
