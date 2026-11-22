import { supabase } from '../supabase'
import type { Meeting, MeetingAudience, MeetingScope } from '../meetings'

/**
 * Meetings the reader can see, from thirty days back on. The database applies
 * every rule — which class, group, space, project or team they are in — and
 * fills in the labels, so this needs to know nothing about roles.
 */
export async function listMeetings(since = new Date(Date.now() - 30 * 86_400_000)) {
  const { data, error } = await supabase.rpc('list_my_meetings', { p_since: since.toISOString() })
  if (error) throw error
  return (data ?? []) as Meeting[]
}

export async function listMeetingPage(
  since = new Date(Date.now() - 30 * 86_400_000),
  before = new Date('9999-12-31T23:59:59Z'),
) {
  const { data, error } = await supabase.rpc('list_my_meetings_v2', {
    p_since: since.toISOString(), p_before: before.toISOString(), p_limit: 100,
  })
  if (error) throw error
  return (data ?? []) as Meeting[]
}

export async function getMeeting(id: string) {
  const { data, error } = await supabase.rpc('get_my_meeting_v2', { p_meeting: id })
  if (error) throw error
  return ((data ?? []) as Meeting[])[0] ?? null
}

export async function meetingCallsEnabled() {
  const { data, error } = await supabase.from('organization_settings').select('meeting_calls_enabled').single()
  if (error) throw error
  return Boolean(data.meeting_calls_enabled)
}

/** Every audience the reader is in, and whether they may schedule for it. */
export async function listMeetingAudiences() {
  const { data, error } = await supabase.rpc('meeting_audiences')
  if (error) throw error
  return (data ?? []) as MeetingAudience[]
}

export type MeetingInput = {
  title: string
  agenda: string
  joinUrl: string | null
  startsAt: string
  durationMin: number
  requestKey?: string
}

export async function createMeeting(scope: MeetingScope, audienceId: string, input: MeetingInput) {
  const { data, error } = input.requestKey
    ? await supabase.rpc('create_collabify_meeting_once', {
      p_scope: scope, p_audience: audienceId, p_title: input.title, p_agenda: input.agenda,
      p_duration_min: input.durationMin, p_request_key: input.requestKey,
    })
    : await supabase.rpc('create_meeting', {
      p_scope: scope, p_audience: audienceId, p_title: input.title, p_agenda: input.agenda,
      p_join_url: input.joinUrl, p_starts_at: input.startsAt, p_duration_min: input.durationMin,
    })
  if (error) throw error
  return data as { id: string }
}

export async function updateMeeting(id: string, input: MeetingInput) {
  const { error } = await supabase.rpc('update_meeting', {
    p_meeting: id,
    p_title: input.title,
    p_agenda: input.agenda,
    p_join_url: input.joinUrl,
    p_starts_at: input.startsAt,
    p_duration_min: input.durationMin,
  })
  if (error) throw error
}

export async function cancelMeeting(id: string) {
  const { error } = await supabase.rpc('cancel_meeting', { p_meeting: id })
  if (error) throw error
}

export type CallMessage = {
  id: string
  meeting_id: string
  sender_id: string | null
  body: string
  created_at: string
  sender: { first_name: string | null; last_name: string | null } | null
}

const MESSAGE_COLUMNS = 'id,meeting_id,sender_id,body,created_at,sender:profiles!meeting_call_messages_sender_id_fkey(first_name,last_name)'

export async function listCallMessages(meetingId: string, before?: string, limit = 50) {
  let query = supabase.from('meeting_call_messages').select(MESSAGE_COLUMNS)
    .eq('meeting_id', meetingId).order('created_at', { ascending: false }).limit(limit)
  if (before) query = query.lt('created_at', before)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as CallMessage[]
}

export async function sendCallMessage(meetingId: string, body: string) {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) throw new Error('Sign in to chat in this call.')
  const { data, error } = await supabase.from('meeting_call_messages')
    .insert({ meeting_id: meetingId, sender_id: user.id, body: body.trim() })
    .select(MESSAGE_COLUMNS).single()
  if (error) throw error
  return data as unknown as CallMessage
}

export type MeetingRecording = {
  id: string
  meeting_id: string
  status: 'starting' | 'recording' | 'processing' | 'ready' | 'failed' | 'deleting'
  started_at: string
  ended_at: string | null
  expires_at: string | null
}

export async function listMeetingRecordings(meetingId: string) {
  const { data, error } = await supabase.from('meeting_call_recordings')
    .select('id,meeting_id,status,started_at,ended_at,expires_at')
    .eq('meeting_id', meetingId).order('started_at', { ascending: false }).limit(50)
  if (error) throw error
  return (data ?? []) as MeetingRecording[]
}
