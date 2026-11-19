import type { ConversationCard } from './types'

/**
 * What the Inbox lists. A direct chat appears once someone writes in it, so a
 * tap on Active now that goes nowhere leaves nothing in the other person's
 * Inbox; the one you have open stays so you can write the first message.
 */
export function listedConversations(conversations: ConversationCard[], activeId: string | undefined) {
  return conversations.filter((c) => c.kind !== 'direct' || c.last_at !== null || c.id === activeId)
}
