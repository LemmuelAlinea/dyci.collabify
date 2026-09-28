// Turns one line ("quiz moved to Friday") into an announcement's title and
// message, in the app's own voice.
//
// A draft only: it fills the composer and the sender edits and posts it. For a
// class it may be sent by someone teaching that class; for the whole program,
// by an admin. Everything is read through the caller's JWT.
//
// Deploy:  supabase functions deploy draft-notice
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, corsMode, denied } from '../_shared/cors.ts'

const MODEL = 'claude-opus-5'

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['title', 'body'],
  additionalProperties: false,
} as const

const SYSTEM = `You write short announcements for a BSIT program in the
Philippines, from a one-line intent given by a professor or the program office.

Rules:
- title: at most 8 words, sentence case, says what changed. No trailing period.
- body: two to four short sentences. What changed, what students must do, and
  by when. Plain text, no markdown, no greeting, no sign-off.
- Voice: active, direct, calm. Sentence case. No exclamation marks, no
  "please", no "kindly", no "successfully", no emoji.
- Use only facts in the intent and the context given. Never invent a date,
  time, room, link or requirement. If the intent names a day ("Friday"),
  resolve it against today's date and write the full date.
- Write in English unless the intent is in Filipino, then match it.`

function json(headers: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
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
    const intent = String(body.intent ?? '').trim().slice(0, 500)
    const scope = body.scope === 'program' ? 'program' : 'class'
    const classId = body.class_id ? String(body.class_id) : ''
    if (intent.length < 4) {
      return json(CORS, { result: 'failed', message: 'Say in a few words what the announcement is about.' }, 400)
    }

    const context: string[] = []
    if (scope === 'class') {
      const { data: teaches } = await caller.rpc('is_class_professor', { p_class: classId })
      if (!classId || !teaches) {
        return json(CORS, { result: 'failed', message: 'Only someone teaching this class can post to it.' }, 403)
      }
      const [{ data: cls }, { data: projects }] = await Promise.all([
        caller.from('classes').select('name, section').eq('id', classId).maybeSingle(),
        caller
          .from('projects')
          .select('title, due_at')
          .eq('class_id', classId)
          .is('archived_at', null)
          .gt('due_at', new Date().toISOString())
          .order('due_at')
          .limit(5),
      ])
      if (cls) context.push(`Class: ${cls.name}${cls.section ? `, section ${cls.section}` : ''}`)
      for (const p of projects ?? []) {
        context.push(
          `Upcoming: ${p.title}, due ${new Date(p.due_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'full', timeStyle: 'short' })}`,
        )
      }
    } else {
      const { data: me } = await caller.from('profiles').select('role').eq('id', user.id).maybeSingle()
      if (me?.role !== 'admin') {
        return json(CORS, { result: 'failed', message: 'Only the program office sends notices.' }, 403)
      }
      context.push('Audience: every professor and student in the program')
    }

    for (const [bucket, max, per, message] of [
      ['ai_draft_notice_hour', 20, '01:00:00', 'That is twenty drafts in an hour. Edit what you have, or try again later.'],
      ['ai_draft_notice_day', 60, '24:00:00', 'That is sixty drafts today. Come back tomorrow.'],
    ] as const) {
      const limited = await caller.rpc('rate_limit', {
        p_bucket: bucket,
        p_max: max,
        p_per: per,
        p_message: message,
      })
      if (limited.error) return json(CORS, { result: 'failed', message: limited.error.message }, 429)
    }

    const today = new Date().toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'full' })
    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: `Today is ${today}.\n${context.join('\n')}\n\nIntent: ${intent}`,
        },
      ],
    })

    if (message.stop_reason === 'refusal') {
      return json(CORS, { result: 'failed', message: 'No draft could be written for that.' })
    }

    const textBlock = message.content.find((b) => b.type === 'text')
    const parsed = JSON.parse(textBlock && 'text' in textBlock ? textBlock.text : '{}')
    return json(CORS, {
      result: 'ok',
      title: String(parsed.title ?? '').slice(0, 120),
      body: String(parsed.body ?? '').slice(0, 2000),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The draft could not be written.'
    return json(CORS, { result: 'failed', message })
  }
})
