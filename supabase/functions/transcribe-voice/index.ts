// Writes the transcript of a discussion voice message (discussion-polls-voice.sql).
//
//   POST { message_id }  ->  { result: 'ok', status, body } | { result: 'failed', message }
//
// The caller's JWT reads the message, so only someone on the project gets
// anywhere. The audio goes to Groq's Whisper (whisper-large-v3: English,
// Filipino and Taglish alike), primed with the project's and its members'
// names so they come back spelled right. The transcript is then written with
// the service role, the only role that may write it; the sender can still
// correct it afterwards.
//
// Deploy:  supabase functions deploy transcribe-voice
// Secret:  supabase secrets set GROQ_API_KEY=gsk_...

import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, corsMode, denied } from '../_shared/cors.ts'

const BUCKET = 'discussion-voice'
const MODEL = 'whisper-large-v3'
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const STUCK_MS = 3 * 60_000

function json(headers: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

const EXT: Record<string, string> = { webm: 'audio/webm', ogg: 'audio/ogg', mp4: 'audio/mp4', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' }

Deno.serve(async (req) => {
  const { headers: CORS, allowed } = cors(req)
  if (!allowed) return denied(CORS)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const groqKey = Deno.env.get('GROQ_API_KEY')
  if (!groqKey) return json(CORS, { result: 'failed', message: 'Voice transcription is not set up on the server yet.' })

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const admin = createClient(url, serviceKey)

  const {
    data: { user },
  } = await caller.auth.getUser()
  if (!user) return json(CORS, { result: 'failed', message: 'Sign in first.' }, 401)

  const body = (await req.json().catch(() => ({}))) as { message_id?: unknown }
  const messageId = String(body.message_id ?? '')

  // Through the caller's token: a message they cannot read is not there.
  const { data: message } = await caller
    .from('general_discussion_messages')
    .select('id, project_id, kind, audio_path, transcript_status, body, created_at')
    .eq('id', messageId)
    .maybeSingle()
  if (!message || message.kind !== 'voice' || !message.audio_path) {
    return json(CORS, { result: 'failed', message: 'That voice message is not here.' }, 404)
  }
  // A run that died part-way leaves 'working' behind; after this long it may go again.
  const stale = new Date(Date.now() - STUCK_MS).toISOString()
  const stuck = message.transcript_status === 'working' && message.created_at < stale
  if (message.transcript_status === 'done' || (message.transcript_status === 'working' && !stuck)) {
    return json(CORS, { result: 'ok', status: message.transcript_status, body: message.body })
  }

  const limited = await caller.rpc('rate_limit', {
    p_bucket: 'transcribe_voice_hour',
    p_max: 60,
    p_per: '01:00:00',
    p_message: 'That is 60 voice messages in an hour. Try again later.',
  })
  if (limited.error) return json(CORS, { result: 'failed', message: limited.error.message }, 429)

  // Claim it, so two members opening the discussion at once do not both send it.
  const { data: claimed } = await admin
    .from('general_discussion_messages')
    .update({ transcript_status: 'working' })
    .eq('id', messageId)
    .or(`transcript_status.in.(pending,failed),and(transcript_status.eq.working,created_at.lt.${stale})`)
    .select('id')
  if (!claimed || claimed.length === 0) {
    return json(CORS, { result: 'ok', status: 'working', body: '' })
  }

  const fail = async (text: string) => {
    await admin.from('general_discussion_messages').update({ transcript_status: 'failed' }).eq('id', messageId)
    return json(CORS, { result: 'failed', message: text })
  }

  try {
    const { data: audio, error: dlError } = await admin.storage.from(BUCKET).download(message.audio_path)
    if (dlError || !audio) return await fail('The recording could not be read. Try again.')

    // Names Whisper would otherwise guess at: the project and its people.
    const [{ data: project }, { data: members }] = await Promise.all([
      admin.from('general_projects').select('name').eq('id', message.project_id).maybeSingle(),
      admin
        .from('general_members')
        .select('profile:profiles (first_name, last_name)')
        .eq('project_id', message.project_id)
        .limit(40),
    ])
    type M = { profile: { first_name: string; last_name: string } | null }
    const names = ((members ?? []) as unknown as M[])
      .map((m) => (m.profile ? `${m.profile.first_name} ${m.profile.last_name}`.trim() : ''))
      .filter(Boolean)
    const prompt = [
      'A student project discussion in English, Filipino or Taglish.',
      project?.name ? `Project: ${project.name}.` : '',
      names.length ? `People: ${names.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 800)

    const ext = message.audio_path.slice(message.audio_path.lastIndexOf('.') + 1).toLowerCase()
    const form = new FormData()
    form.append('file', new File([audio], `voice.${ext}`, { type: EXT[ext] ?? audio.type ?? 'audio/webm' }))
    form.append('model', MODEL)
    form.append('response_format', 'json')
    form.append('temperature', '0')
    form.append('prompt', prompt)

    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey}` },
      body: form,
    })
    if (!res.ok) {
      console.error('groq', res.status, await res.text().catch(() => ''))
      return await fail(
        res.status === 429
          ? 'The transcription service is busy. Try again in a minute.'
          : 'The recording could not be transcribed. Try again.',
      )
    }
    const out = (await res.json()) as { text?: string }
    const text = String(out.text ?? '').trim().slice(0, 8000)

    const { error: upError } = await admin
      .from('general_discussion_messages')
      .update({ body: text, transcript_status: 'done' })
      .eq('id', messageId)
      .eq('transcript_status', 'working')
    if (upError) return await fail('The transcript could not be saved. Try again.')

    return json(CORS, { result: 'ok', status: 'done', body: text })
  } catch (err) {
    console.error('transcribe-voice', corsMode(), err)
    return await fail('The recording could not be transcribed. Try again.')
  }
})
