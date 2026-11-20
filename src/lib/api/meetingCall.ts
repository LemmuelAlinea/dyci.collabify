import { supabase } from '../supabase'

export type CallSession = { serverUrl: string; token: string; meetingId: string; canHost: boolean }

export type CallAction = 'start' | 'join' | 'end' | 'lock' | 'unlock' | 'mute' | 'stop_share' | 'remove' | 'clear_hand'

export async function callAction(action: CallAction, meetingId: string, targetId?: string) {
  const { data, error } = await supabase.functions.invoke('meeting-call', {
    body: { action, meeting_id: meetingId, target_id: targetId },
  })
  if (error) {
    const context = (error as { context?: unknown }).context
    const body = context instanceof Response ? await context.clone().json().catch(() => null) : null
    throw new Error(typeof body?.error === 'string' ? body.error : 'Could not connect to the call.')
  }
  return data as CallSession | { result: 'ok' }
}
