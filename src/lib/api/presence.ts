import { supabase } from '../supabase'

/** A person you share a class, space or project with, seen in the last hour. */
export type ActiveContact = {
  id: string
  first_name: string
  last_name: string
  avatar_url: string | null
  last_seen_at: string
}

export async function touchPresence(): Promise<void> {
  const { error } = await supabase.rpc('touch_presence')
  if (error) throw error
}

export async function setActiveStatus(show: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_active_status', { p_show: show })
  if (error) throw error
}

export async function getActiveStatus(): Promise<boolean> {
  const { data, error } = await supabase.rpc('my_active_status')
  if (error) throw error
  return data !== false
}

export async function listActiveContacts(): Promise<ActiveContact[]> {
  const { data, error } = await supabase.rpc('my_active_contacts')
  if (error) throw error
  return (data ?? []) as ActiveContact[]
}

export async function startContactConversation(personId: string) {
  const { data, error } = await supabase.rpc('start_contact_conversation', { p_person: personId })
  if (error) throw error
  return data as {
    result: 'ok' | 'not_contact' | 'not_signed_in'
    conversation_id?: string
  }
}
