import { supabase } from '../supabase'

export type CallSession = { serverUrl: string; token: string; meetingId: string; canHost: boolean }

export async function callAction(action: 'start' | 'join' | 'end' | 'lock' | 'unlock', meetingId: string) {
  const { data, error } = await supabase.functions.invoke('meeting-call', {
    body: { action, meeting_id: meetingId },
  })
  if (error) {
    const context = (error as { context?: unknown }).context
    const body = context instanceof Response ? await context.clone().json().catch(() => null) : null
    throw new Error(typeof body?.error === 'string' ? body.error : 'Could not connect to the call.')
  }
  return data as CallSession | { result: 'ok' }
}
