import { createClient } from 'npm:@supabase/supabase-js@2'
import { AccessToken, EgressClient, EncodedFileOutput, RoomServiceClient } from 'npm:livekit-server-sdk@2.19.2'
import { ParticipantInfo_Kind, RoomConfiguration, TrackSource } from 'npm:@livekit/protocol@1.51.0'
import { cors, denied } from '../_shared/cors.ts'

type Access = {
  room_name: string | null
  call_state: 'scheduled' | 'starting' | 'live' | 'ended'
  can_start: boolean
  can_host: boolean
  can_join: boolean
  max_participants: number
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(headers: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const { headers, allowed } = cors(req)
  if (!allowed) return denied(headers)
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json(headers, { error: 'Use POST.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const livekitUrl = Deno.env.get('LIVEKIT_URL')
  const livekitKey = Deno.env.get('LIVEKIT_API_KEY')
  const livekitSecret = Deno.env.get('LIVEKIT_API_SECRET')
  if (!livekitUrl || !livekitKey || !livekitSecret)
    return json(headers, { error: 'Video calls are unavailable. Try again later.' }, 503)

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: { user }, error: authError } = await caller.auth.getUser()
  if (authError || !user) return json(headers, { error: 'Sign in to use this call.' }, 401)

  const body = await req.json().catch(() => ({})) as {
    action?: unknown; meeting_id?: unknown; target_id?: unknown; recording_id?: unknown
  }
  const meetingId = typeof body.meeting_id === 'string' ? body.meeting_id : ''
  const action = body.action
  if (!uuid.test(meetingId) || !['start', 'join', 'end', 'lock', 'unlock', 'mute', 'stop_share', 'remove', 'clear_hand', 'record_start', 'record_stop', 'record_url'].includes(String(action)))
    return json(headers, { error: 'Choose a valid call action.' }, 400)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const rooms = new RoomServiceClient(livekitUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'), livekitKey, livekitSecret)
  const egress = new EgressClient(livekitUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'), livekitKey, livekitSecret)

  try {
    if (action === 'record_url') {
      const recordingId = typeof body.recording_id === 'string' ? body.recording_id : ''
      if (!uuid.test(recordingId)) return json(headers, { error: 'Choose a recording.' }, 400)
      const { data: mayRead, error: accessError } = await caller.rpc('meeting_call_can_read', { p_meeting: meetingId })
      if (accessError || !mayRead) return json(headers, { error: 'This recording is unavailable to you.' }, 403)
      const { data: recording } = await admin.from('meeting_call_recordings')
        .select('storage_path,status,expires_at').eq('id', recordingId).eq('meeting_id', meetingId).maybeSingle()
      if (!recording || recording.status !== 'ready' || !recording.expires_at
          || Date.parse(recording.expires_at) <= Date.now())
        return json(headers, { error: 'This recording is unavailable.' }, 404)
      const { data: signed, error: signError } = await admin.storage.from('meeting-recordings')
        .createSignedUrl(recording.storage_path, 60)
      if (signError || !signed) throw signError ?? new Error('Could not sign recording URL')
      return json(headers, { url: signed.signedUrl, expiresIn: 60 })
    }

    const { data, error } = await caller.rpc(action === 'start' ? 'begin_meeting_call' : 'meeting_call_access', {
      p_meeting: meetingId,
    })
    const access = (data as Access[] | null)?.[0]
    if (error || !access) return json(headers, { error: 'This call is unavailable to you.' }, 403)

    if (action === 'record_start' || action === 'record_stop') {
      if (!access.can_host || !access.room_name || access.call_state !== 'live')
        return json(headers, { error: 'Only a host can record a live call.' }, 403)
      if (action === 'record_stop') {
        const { data: recording } = await admin.from('meeting_call_recordings')
          .select('id,egress_id').eq('meeting_id', meetingId).eq('status', 'recording').maybeSingle()
        if (!recording?.egress_id) return json(headers, { error: 'No recording is running.' }, 409)
        await egress.stopEgress(recording.egress_id)
        const stopped = await admin.from('meeting_call_recordings').update({ status: 'processing' })
          .eq('id', recording.id).eq('status', 'recording')
        if (stopped.error) throw stopped.error
        return json(headers, { result: 'processing' })
      }
      const s3Key = Deno.env.get('MEETING_RECORDINGS_S3_ACCESS_KEY')
      const s3Secret = Deno.env.get('MEETING_RECORDINGS_S3_SECRET_KEY')
      if (!s3Key || !s3Secret) return json(headers, { error: 'Recording is unavailable. Try again later.' }, 503)
      const connected = (await rooms.listParticipants(access.room_name))
        .some((participant) => participant.identity === user.id && participant.kind === ParticipantInfo_Kind.STANDARD)
      if (!connected) return json(headers, { error: 'Join the call before recording.' }, 409)
      const begun = await admin.rpc('begin_meeting_recording', { p_meeting: meetingId, p_host: user.id })
      if (begun.error || !begun.data) return json(headers, { error: 'This call is already being recorded.' }, 409)
      const recording = begun.data as { id: string; storage_path: string }
      let egressId: string | null = null
      try {
        const ref = new URL(supabaseUrl).hostname.split('.')[0]
        const output = new EncodedFileOutput({
          filepath: recording.storage_path, disableManifest: true,
          output: { case: 's3', value: {
            accessKey: s3Key, secret: s3Secret, bucket: 'meeting-recordings',
            endpoint: `https://${ref}.storage.supabase.co/storage/v1/s3`,
            region: 'ap-southeast-1', forcePathStyle: true,
          } },
        })
        const started = await egress.startRoomCompositeEgress(access.room_name, output, { layout: 'speaker' })
        egressId = started.egressId
        const bound = await admin.rpc('bind_meeting_recording_egress', {
          p_recording: recording.id, p_egress: egressId,
        })
        if (bound.error) throw bound.error
        return json(headers, { result: 'recording' })
      } catch (startError) {
        if (egressId) await egress.stopEgress(egressId).catch(() => undefined)
        await admin.rpc('finish_meeting_recording', {
          p_recording: recording.id, p_egress: egressId, p_success: false,
          p_ended: new Date().toISOString(),
        })
        throw startError
      }
    }

    if (action === 'mute' || action === 'stop_share' || action === 'remove' || action === 'clear_hand') {
      const targetId = typeof body.target_id === 'string' ? body.target_id : ''
      if (!uuid.test(targetId) || targetId === user.id)
        return json(headers, { error: 'Choose another participant.' }, 400)
      if (!access.can_host || !access.room_name || access.call_state !== 'live')
        return json(headers, { error: 'Only a host can moderate this call.' }, 403)
      const target = (await rooms.listParticipants(access.room_name)).find((p) => p.identity === targetId)
      if (!target) return json(headers, { error: 'That participant has left the call.' }, 404)
      if (action === 'clear_hand') {
        await rooms.updateParticipant(access.room_name, targetId, { attributes: { 'collabify.hand': '' } })
      } else if (action === 'remove') {
        const ban = await admin.rpc('ban_meeting_call_participant', {
          p_meeting: meetingId, p_room: access.room_name, p_user: targetId,
        })
        if (ban.error) throw ban.error
        await rooms.removeParticipant(access.room_name, targetId)
      } else {
        const blocked = action === 'mute'
          ? [TrackSource.MICROPHONE]
          : [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
        const all = [TrackSource.CAMERA, TrackSource.MICROPHONE,
                     TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
        const allowed = target.permission?.canPublishSources?.length
          ? target.permission.canPublishSources : all
        for (const track of target.tracks.filter((t) => blocked.includes(t.source)))
          await rooms.mutePublishedTrack(access.room_name, targetId, track.sid, true)
        await rooms.updateParticipant(access.room_name, targetId, {
          permission: { canPublish: true, canPublishSources: allowed.filter((source) => !blocked.includes(source)) },
        })
      }
      return json(headers, { result: 'ok' })
    }

    if (action === 'end' || action === 'lock' || action === 'unlock') {
      if (!access.can_host || !access.room_name || !['starting', 'live'].includes(access.call_state)
          || (action !== 'end' && access.call_state !== 'live'))
        return json(headers, { error: 'Only a host can change this call.' }, 403)
      if (action === 'end') {
        const existing = await rooms.listRooms([access.room_name])
        if (existing.length) await rooms.deleteRoom(access.room_name)
        const result = await admin.rpc('finish_meeting_call', {
          p_meeting: meetingId, p_room: access.room_name,
        })
        if (result.error) throw result.error
      } else {
        const result = await admin.rpc('set_meeting_call_lock', {
          p_meeting: meetingId, p_locked: action === 'lock',
        })
        if (result.error) throw result.error
      }
      return json(headers, { result: 'ok' })
    }

    if (!access.can_join || !access.room_name)
      return json(headers, { error: access.call_state === 'scheduled' ? 'A host has not started this call.' : 'This call is unavailable.' }, 403)

    if (action === 'start') {
      const existing = await rooms.listRooms([access.room_name])
      if (!existing.length) {
        try {
          await rooms.createRoom({ name: access.room_name, maxParticipants: 100,
                                   emptyTimeout: 60, departureTimeout: 60 })
        } catch (error) {
          const raced = await rooms.listRooms([access.room_name])
          if (!raced.length) throw error
        }
      }
    }
    const participants = (await rooms.listParticipants(access.room_name))
      .filter((participant) => participant.kind !== ParticipantInfo_Kind.EGRESS)
    if (participants.length >= 100 && !participants.some((p) => p.identity === user.id))
      return json(headers, { error: 'This call is full.' }, 409)

    const { data: profile } = await admin.from('profiles').select('first_name,last_name').eq('id', user.id).single()
    const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim()
    const token = new AccessToken(livekitKey, livekitSecret, { identity: user.id, name, ttl: 90 })
    token.addGrant({ roomJoin: true, room: access.room_name, canPublish: true, canSubscribe: true,
                     canUpdateOwnMetadata: true })
    token.roomConfig = new RoomConfiguration({ maxParticipants: 100, emptyTimeout: 60,
                                               departureTimeout: 60 })
    return json(headers, {
      serverUrl: livekitUrl,
      token: await token.toJwt(),
      meetingId,
      canHost: access.can_host,
    })
  } catch (error) {
    console.error('meeting-call:', error)
    return json(headers, { error: 'The call could not be updated. Try again.' }, 503)
  }
})
