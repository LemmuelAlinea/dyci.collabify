import { supabase } from '../supabase'
import { pageAll } from './paging'
import type {
  PeerComment,
  PeerForm,
  PeerRatingInput,
  PeerResult,
  PeerRoundKind,
  PeerRoundStatus,
} from '../types'

/** Professor: open a round. The database refuses a second open round or a second final. */
export async function openPeerRound(projectId: string, kind: PeerRoundKind, closesAt: string) {
  const { error } = await supabase.rpc('open_peer_round', {
    p_project: projectId,
    p_kind: kind,
    p_closes_at: closesAt,
  })
  if (error) throw error
}

export async function setPeerRoundClose(roundId: string, closesAt: string) {
  const { error } = await supabase.rpc('set_peer_round_close', {
    p_round: roundId,
    p_closes_at: closesAt,
  })
  if (error) throw error
}

export async function closePeerRound(roundId: string) {
  const { error } = await supabase.rpc('close_peer_round', { p_round: roundId })
  if (error) throw error
}

/** Returns how many students were reminded. Once a day per project. */
export async function remindPeerRound(roundId: string) {
  const { data, error } = await supabase.rpc('remind_peer_round', { p_round: roundId })
  if (error) throw error
  return (data as number | null) ?? 0
}

/** Student: save every rating at once. The database refuses a partial form. */
export async function savePeerRatings(roundId: string, ratings: PeerRatingInput[]) {
  const { error } = await supabase.rpc('save_peer_ratings', {
    p_round: roundId,
    p_ratings: ratings,
  })
  if (error) throw error
}

/** Student: the open round's form, or null when there is nothing to rate. */
export async function peerForm(projectId: string) {
  const { data, error } = await supabase.rpc('peer_form', { p_project: projectId })
  if (error) throw error
  return (data as PeerForm | null) ?? null
}

export async function listPeerRounds(projectId: string) {
  const { data, error } = await supabase
    .from('peer_round_status')
    .select('*')
    .eq('project_id', projectId)
    .order('opens_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PeerRoundStatus[]
}

export async function projectPeerResults(projectId: string) {
  return pageAll<PeerResult>(async (from, to) => {
    const { data, error } = await supabase
      .from('peer_results')
      .select('*')
      .eq('project_id', projectId)
      .order('round_id')
      .order('board_id')
      .order('student_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as PeerResult[]
  })
}

/** Every result the professor can read, for Analytics. Paged: a busy term passes a thousand. */
export async function classPeerResults() {
  return pageAll<PeerResult>(async (from, to) => {
    const { data, error } = await supabase
      .from('peer_results')
      .select('*')
      .order('round_id')
      .order('board_id')
      .order('student_id')
      .range(from, to)
    if (error) throw error
    return (data ?? []) as PeerResult[]
  })
}

export async function peerComments(roundId: string) {
  const { data, error } = await supabase
    .from('peer_comments')
    .select('*')
    .eq('round_id', roundId)
    .order('ratee_name')
  if (error) throw error
  return (data ?? []) as PeerComment[]
}
