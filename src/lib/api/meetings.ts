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

/** Every audience the reader is in, and whether they may schedule for it. */
export async function listMeetingAudiences() {
  const { data, error } = await supabase.rpc('meeting_audiences')
  if (error) throw error
  return (data ?? []) as MeetingAudience[]
}

export type MeetingInput = {
  title: string
  agenda: string
  joinUrl: string
  startsAt: string
  durationMin: number
}

export async function createMeeting(scope: MeetingScope, audienceId: string, input: MeetingInput) {
  const { data, error } = await supabase.rpc('create_meeting', {
    p_scope: scope,
    p_audience: audienceId,
    p_title: input.title,
    p_agenda: input.agenda,
    p_join_url: input.joinUrl,
    p_starts_at: input.startsAt,
    p_duration_min: input.durationMin,
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
