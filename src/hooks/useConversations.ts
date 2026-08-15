import { useCallback, useEffect, useRef, useState } from 'react'
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

  // The nav badge and the Messages page both use this hook, so the topic has to
  // be unique per instance — two channels sharing one topic collide.
  const topic = useRef(`messages:inbox:${Math.random().toString(36).slice(2)}`)

  // One channel for the whole list, so unread counts and previews move without
  // a subscription per conversation.
  useEffect(() => {
    if (!viewerId) return
    const channel = supabase
      .channel(topic.current)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        void load()
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [viewerId, load])

  return { conversations, error, reload: load }
}

/** Total unread across every conversation — the sidebar badge. */
export function useUnreadTotal(viewerId: string | undefined) {
  const { conversations } = useConversations(viewerId)
  return (conversations ?? []).reduce((sum, c) => sum + c.unread_count, 0)
}
