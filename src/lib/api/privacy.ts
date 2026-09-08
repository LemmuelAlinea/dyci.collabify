import { supabase } from '../supabase'

/**
 * Data-subject requests under RA 10173.
 *
 * Nothing here writes a row directly. Both writes go through database
 * functions: `make_privacy_request` because that is where the throttle and the
 * name snapshot live, and `answer_privacy_request` because a status that moved
 * without an author is a record of nothing. The table grants the client no
 * insert, update or delete at all — same shape as reassignments.
 */

export type PrivacyKind =
  | 'access'
  | 'correction'
  | 'erasure'
  | 'objection'
  | 'portability'
  | 'withdraw_consent'

export type PrivacyStatus = 'open' | 'acknowledged' | 'completed' | 'refused'

export type PrivacyRequestRow = {
  id: string
  requester_id: string | null
  requester_name: string
  requester_email: string
  kind: PrivacyKind
  detail: string
  status: PrivacyStatus
  acknowledge_by: string
  complete_by: string
  answered_by: string | null
  answer: string | null
  answered_at: string | null
  created_at: string
}

const COLUMNS =
  'id, requester_id, requester_name, requester_email, kind, detail, status, acknowledge_by, complete_by, answered_by, answer, answered_at, created_at'

/**
 * Every request the viewer may read.
 *
 * One query for two audiences: the row-level-security policy returns your own
 * requests if you are a student, and every request if you are the privacy
 * handler. A second endpoint for the queue would be a second place to get the
 * visibility rule wrong.
 */
export async function listPrivacyRequests(): Promise<PrivacyRequestRow[]> {
  const { data, error } = await supabase
    .from('privacy_requests')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PrivacyRequestRow[]
}

export async function makePrivacyRequest(
  kind: PrivacyKind,
  detail: string,
): Promise<PrivacyRequestRow> {
  const { data, error } = await supabase.rpc('make_privacy_request', {
    p_kind: kind,
    p_detail: detail,
  })
  if (error) throw error
  return data as PrivacyRequestRow
}

export async function answerPrivacyRequest(
  id: string,
  status: Exclude<PrivacyStatus, 'open'>,
  answer?: string,
): Promise<PrivacyRequestRow> {
  const { data, error } = await supabase.rpc('answer_privacy_request', {
    p_request: id,
    p_status: status,
    p_answer: answer ?? null,
  })
  if (error) throw error
  return data as PrivacyRequestRow
}

/**
 * Days until a date, negative once it has passed.
 *
 * The queue's whole job is showing the clock, and a date on its own does not
 * do that — "3 Oct" tells a reader nothing without a calendar beside it.
 * Compared as dates, not timestamps, so a request made at 23:00 does not read
 * as a day shorter than one made at 09:00.
 */
export function daysLeft(iso: string, now = new Date()): number {
  const due = new Date(iso + 'T00:00:00')
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((due.getTime() - today.getTime()) / 86_400_000)
}

/** What each kind means, in the words the privacy policy uses. */
export const PRIVACY_KINDS: ReadonlyArray<{
  value: PrivacyKind
  label: string
  help: string
}> = [
  {
    value: 'access',
    label: 'A copy of what is held about me',
    help: `Everything Collabify holds about you, sent as a file. The reason somebody gave when asking for one of your tasks to be reassigned is not included — it is also about them.`,
  },
  {
    value: 'portability',
    label: 'My information in a portable format',
    help: `What you have given, as a structured file you can open elsewhere.`,
  },
  {
    value: 'correction',
    label: 'Something corrected',
    help: `Your name and photo you can change in Settings. Use this for your email address, your role, or something somebody else wrote about you.`,
  },
  {
    value: 'erasure',
    label: 'My information erased or its use suspended',
    help: `Your profile, messages, comments, work log, files and photo. Entries in the administrative log are kept — say so below if you want to know exactly which.`,
  },
  {
    value: 'objection',
    label: 'To object to how something is used',
    help: `Including the measurements a professor sees about your share of a board's work. Say which use you object to.`,
  },
  {
    value: 'withdraw_consent',
    label: 'To withdraw my consent',
    help: `Withdrawal stops future processing that rests on consent. It is not the same as erasure — ask for that separately if it is what you mean.`,
  },
]

/**
 * Whether the signed-in person answers privacy requests.
 *
 * The navigation is built from a static list per role, so it cannot know which
 * professor was named handler — and putting "Privacy requests" on every
 * professor's rail would give almost all of them a permanently empty screen.
 * Instead the one person who does answer them finds the queue linked from
 * their own request page, which is where they would look anyway.
 */
export async function amPrivacyHandler(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_privacy_handler')
  if (error) return false
  return data === true
}
