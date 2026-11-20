import { createClient } from 'npm:@supabase/supabase-js@2'
import { RoomServiceClient, WebhookReceiver } from 'npm:livekit-server-sdk@2.19.2'

type Call = {
  id: string
  room_name: string
  call_state: 'starting' | 'live'
  starting_at: string | null
  started_at: string | null
  empty_since: string | null
  locked_at: string | null
}
type PendingCall = Omit<Call, 'id'> & { meeting_id: string }

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const livekitUrl = Deno.env.get('LIVEKIT_URL')!
const livekitKey = Deno.env.get('LIVEKIT_API_KEY')!
const livekitSecret = Deno.env.get('LIVEKIT_API_SECRET')!
const cronSecret = Deno.env.get('MEETING_CALL_CRON_SECRET')
const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
const rooms = new RoomServiceClient(livekitUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'), livekitKey, livekitSecret)
const receiver = new WebhookReceiver(livekitKey, livekitSecret)

async function callForRoom(roomName: string): Promise<Call | null> {
  const { data, error } = await admin.from('meetings')
    .select('id,room_name,call_state,starting_at,started_at,empty_since,locked_at')
    .eq('room_name', roomName).in('call_state', ['starting', 'live']).maybeSingle()
  if (error) throw error
  return data as Call | null
}

async function checkParticipants(call: Call) {
  const active = await rooms.listParticipants(call.room_name)
  if (!active.length) return 0
  const { data, error } = await admin.rpc('meeting_call_disallowed_participants', {
    p_meeting: call.id,
    p_identities: active.map((p) => p.identity),
    p_new_joins: active.map((p) => !!call.locked_at
      && Number(p.joinedAt) * 1000 >= Date.parse(call.locked_at)),
  })
  if (error) throw error
  const rejected = (data ?? []) as { identity: string }[]
  for (const row of rejected) await rooms.removeParticipant(call.room_name, row.identity)
  return active.length - rejected.length
}

async function reconcile() {
  const { data, error } = await admin.rpc('meeting_calls_to_reconcile', { p_limit: 500 })
  if (error) throw error
  let checked = 0
  for (const pending of (data ?? []) as PendingCall[]) {
    const row = { ...pending, id: pending.meeting_id }
    const live = await rooms.listRooms([row.room_name])
    if (live.length) {
      const count = await checkParticipants(row)
      if (count > 0) {
        if (row.call_state === 'starting') {
          const result = await admin.rpc('confirm_meeting_live', { p_meeting: row.id, p_room: row.room_name })
          if (result.error) throw result.error
        }
        const result = await admin.rpc('mark_meeting_call_empty', {
          p_meeting: row.id, p_room: row.room_name, p_empty: false,
        })
        if (result.error) throw result.error
      } else if (row.call_state === 'live') {
        const result = await admin.rpc('mark_meeting_call_empty', {
          p_meeting: row.id, p_room: row.room_name, p_empty: true,
        })
        if (result.error) throw result.error
      }
    } else if (row.call_state === 'live') {
      if (row.empty_since && Date.now() - Date.parse(row.empty_since) > 60_000) {
        const result = await admin.rpc('finish_meeting_call', { p_meeting: row.id, p_room: row.room_name })
        if (result.error) throw result.error
      } else {
        const result = await admin.rpc('mark_meeting_call_empty', {
          p_meeting: row.id, p_room: row.room_name, p_empty: true,
        })
        if (result.error) throw result.error
      }
    }
    if (row.started_at && Date.now() - Date.parse(row.started_at) >= 8 * 60 * 60 * 1000) {
      if (live.length) await rooms.deleteRoom(row.room_name)
      const result = await admin.rpc('finish_meeting_call', { p_meeting: row.id, p_room: row.room_name })
      if (result.error) throw result.error
    }
    checked++
  }
  await admin.from('meeting_call_events').delete()
    .lt('received_at', new Date(Date.now() - 7 * 86400_000).toISOString())
  return checked
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Use POST.', { status: 405 })
  if (cronSecret && req.headers.get('Authorization') === `Bearer ${cronSecret}`) {
    try {
      return Response.json({ checked: await reconcile() })
    } catch (error) {
      console.error('meeting-call reconcile:', error)
      return new Response('Reconciliation failed.', { status: 503 })
    }
  }

  let event
  try {
    event = await receiver.receive(await req.text(), req.headers.get('Authorization') ?? '')
  } catch {
    return new Response('Invalid signature.', { status: 401 })
  }
  const roomName = event.room?.name
  if (!roomName || !event.id) return new Response('Ignored.', { status: 200 })
  try {
    const call = await callForRoom(roomName)
    if (!call) return new Response('Ignored.', { status: 200 })
    const { data: stored, error: readError } = await admin.from('meeting_call_events')
      .select('processed_at').eq('event_id', event.id).maybeSingle()
    if (readError) throw readError
    if (stored?.processed_at) return new Response('Duplicate.', { status: 200 })
    if (!stored) {
      const result = await admin.from('meeting_call_events')
        .insert({ event_id: event.id, room_name: roomName })
      if (result.error && result.error.code !== '23505') throw result.error
    }

    if (event.event === 'participant_joined' && event.participant?.identity) {
      const identity = event.participant.identity
      const { data: permitted, error } = await admin.rpc('meeting_call_participant_allowed', {
        p_meeting: call.id, p_user: identity, p_new_join: true,
      })
      if (error) throw error
      if (!permitted) await rooms.removeParticipant(roomName, identity)
      else {
        const result = await admin.rpc('confirm_meeting_live', { p_meeting: call.id, p_room: roomName })
        if (result.error) throw result.error
        await admin.rpc('mark_meeting_call_empty', {
          p_meeting: call.id, p_room: roomName, p_empty: false,
        })
      }
    } else if (event.event === 'participant_left') {
      const present = await rooms.listRooms([roomName])
      const participants = present.length ? await rooms.listParticipants(roomName) : []
      if (!participants.length) {
        const result = await admin.rpc('mark_meeting_call_empty', {
          p_meeting: call.id, p_room: roomName, p_empty: true,
        })
        if (result.error) throw result.error
      }
    } else if (event.event === 'room_finished') {
      const result = await admin.rpc('finish_meeting_call', {
        p_meeting: call.id, p_room: roomName,
      })
      if (result.error) throw result.error
    }
    const done = await admin.from('meeting_call_events')
      .update({ processed_at: new Date().toISOString() }).eq('event_id', event.id)
    if (done.error) throw done.error
    return new Response('ok', { status: 200 })
  } catch (error) {
    console.error('meeting-call event:', error)
    return new Response('Retry event.', { status: 503 })
  }
})
