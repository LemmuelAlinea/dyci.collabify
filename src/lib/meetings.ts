/**
 * Meetings: a Zoom or Google Meet link, a time, and who it is for.
 *
 * Collabify does not create the meeting itself — somebody makes it in Zoom or
 * Meet and pastes the link. The rules for who may schedule what live in
 * supabase/meetings.sql; these only keep a screen from offering what the
 * database would refuse.
 */
import type { Scope } from './scope'

export type MeetingScope = 'class' | 'group' | 'space' | 'project' | 'space_team' | 'project_team'
export type MeetingPlatform = 'google_meet' | 'zoom'

/** One row of `list_my_meetings`. */
export type Meeting = {
  id: string
  scope: MeetingScope
  class_id: string | null
  group_id: string | null
  space_id: string | null
  project_id: string | null
  space_team_id: string | null
  project_team_id: string | null
  title: string
  agenda: string
  platform: MeetingPlatform
  join_url: string
  starts_at: string
  duration_min: number
  created_by: string | null
  cancelled_at: string | null
  created_at: string
  audience_label: string | null
  class_initial: string | null
  class_name: string | null
  space_name: string | null
  creator_name: string | null
  can_manage: boolean
}

/** One row of `meeting_audiences`: somewhere the reader belongs. */
export type MeetingAudience = {
  scope: MeetingScope
  audience_id: string
  label: string
  context: string
  class_id: string | null
  space_id: string | null
  can_create: boolean
}

export const SCOPE_LABEL: Record<MeetingScope, string> = {
  class: 'Whole class',
  group: 'Group',
  space: 'Whole space',
  project: 'Project',
  space_team: 'Space team',
  project_team: 'Project team',
}

export const PLATFORM_LABEL: Record<MeetingPlatform, string> = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
}

const MEET = /^https:\/\/meet\.google\.com\/\S+$/i
const ZOOM = /^https:\/\/([a-z0-9-]+\.)*zoom\.(us|com)\/\S+$/i

/** Which platform a pasted link is for, or null when it is neither. Mirrors `meeting_url_ok`. */
export function detectPlatform(url: string): MeetingPlatform | null {
  const u = url.trim()
  if (MEET.test(u)) return 'google_meet'
  if (ZOOM.test(u)) return 'zoom'
  return null
}

/** Classes or Work, for the All · Classes · Work filter. */
export function scopeOf(m: Pick<Meeting, 'scope'>): Exclude<Scope, 'all'> {
  return m.scope === 'class' || m.scope === 'group' ? 'classes' : 'work'
}

export type MeetingState = 'upcoming' | 'live' | 'ended' | 'cancelled'

export function endsAt(m: Pick<Meeting, 'starts_at' | 'duration_min'>) {
  return new Date(m.starts_at).getTime() + m.duration_min * 60_000
}

export function meetingState(m: Pick<Meeting, 'starts_at' | 'duration_min' | 'cancelled_at'>, now: number): MeetingState {
  if (m.cancelled_at) return 'cancelled'
  const start = new Date(m.starts_at).getTime()
  if (now < start) return 'upcoming'
  return now < endsAt(m) ? 'live' : 'ended'
}

/** Join opens fifteen minutes early, the way people actually arrive, and closes when it ends. */
export function canJoin(m: Pick<Meeting, 'starts_at' | 'duration_min' | 'cancelled_at'>, now: number) {
  if (m.cancelled_at) return false
  return now >= new Date(m.starts_at).getTime() - 15 * 60_000 && now < endsAt(m)
}

/** "3:00 – 4:00 PM" on one day, the start alone across midnight. */
export function timeRange(m: Pick<Meeting, 'starts_at' | 'duration_min'>) {
  const start = new Date(m.starts_at)
  const end = new Date(endsAt(m))
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return start.toDateString() === end.toDateString() ? `${t(start)} – ${t(end)}` : t(start)
}

/** Where a meeting sits, in words: "Group A · Database Management". */
export function audienceText(m: Pick<Meeting, 'scope' | 'audience_label'>) {
  return m.audience_label ?? SCOPE_LABEL[m.scope]
}
