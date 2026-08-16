import { useCallback, useEffect, useState } from 'react'
import { decorateConversations, listConversations } from '../lib/api/messages'
import { authErrorMessage } from '../lib/authError'
import { supabase } from '../lib/supabase'
import type { ConversationCard } from '../lib/types'

/** The viewer's conversations, titles resolved, refreshed when a message lands. */
export function useConversations(viewerId: string | undefined) {
  const [conversations, setConversations] = useState<ConversationCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!viewerId) return
    try {
      setConversations(await decorateConversations(await listConversations(), viewerId))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load your conversations.'))
      setConversations([])
    }
  }, [viewerId])

  useEffect(() => {
    void load()
  }, [load])

  // One channel for the whole list, so unread counts and previews move without
  // a subscription per conversation. The topic is generated inside the effect —
  // a ref would be reused across a remount and collide with the channel still
  // being torn down.
  useEffect(() => {
    if (!viewerId) return
    const channel = supabase
      .channel(`messages:inbox:${Math.random().toString(36).slice(2)}`)
      // Edits and deletes change the preview too, so '*' rather than INSERT.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        void load()
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [viewerId, load])

  // Same safety net as the thread, at a slower cadence.
  useEffect(() => {
    if (!viewerId) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 20_000)
    return () => clearInterval(id)
  }, [viewerId, load])

  return { conversations, error, reload: load }
}

/** Total unread across every conversation — the sidebar badge. */
export function useUnreadTotal(viewerId: string | undefined) {
  const { conversations } = useConversations(viewerId)
  return (conversations ?? []).reduce((sum, c) => sum + c.unread_count, 0)
}
