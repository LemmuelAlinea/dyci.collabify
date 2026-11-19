import { expect, it } from 'vitest'
import { listedConversations } from './conversationList'
import type { ConversationCard } from './types'

const card = (id: string, kind: ConversationCard['kind'], last_at: string | null) =>
  ({ id, kind, last_at }) as ConversationCard

it('hides a direct chat nobody has written in', () => {
  const list = [card('a', 'direct', null), card('b', 'direct', 't'), card('c', 'class', null)]
  expect(listedConversations(list, undefined).map((c) => c.id)).toEqual(['b', 'c'])
})

it('keeps the empty direct chat that is open', () => {
  const list = [card('a', 'direct', null)]
  expect(listedConversations(list, 'a').map((c) => c.id)).toEqual(['a'])
})
