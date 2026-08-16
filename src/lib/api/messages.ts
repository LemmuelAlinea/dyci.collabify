import { supabase } from '../supabase'
import { POLL_SELECT } from './polls'
import { fullName } from '../types'
import type {
  ChatMessage,
  ConversationCard,
  ConversationSummary,
  MessageAttachment,
  Profile,
} from '../types'

const BUCKET = 'chat-files'

const MESSAGE_SELECT = `
  id, conversation_id, sender_id, body, edited_at, deleted_at, deleted_by, pinned, created_at,
  attachments:message_attachments (id, message_id, file_path, file_name, mime_type, size_bytes),
  sender:profiles!messages_sender_id_fkey (first_name, last_name, avatar_url),
  ${POLL_SELECT}
`

/* --------------------------------------------------------- conversations */

export async function listConversations() {
  const { data, error } = await supabase
    .from('conversation_overview')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ConversationSummary[]
}

/**
 * Conversations carry only ids, so titles come from the classes, groups, and
 * profiles behind them. Resolved in three batched queries rather than per row.
 */
export async function decorateConversations(
  rows: ConversationSummary[],
  viewerId: string,
): Promise<ConversationCard[]> {
  const classIds = rows.map((r) => r.class_id).filter(Boolean) as string[]
  const groupIds = rows.map((r) => r.group_id).filter(Boolean) as string[]
  const directIds = rows
    .filter((r) => r.kind === 'direct')
    .flatMap((r) => (r.direct_key ?? '').split('|'))
    .filter((id) => id && id !== viewerId)

  const [classes, groups, people] = await Promise.all([
    classIds.length
      ? supabase.from('classes').select('id, name, initial, archived_at').in('id', classIds)
      : Promise.resolve({ data: [] as never[] }),
    groupIds.length
      ? supabase.from('group_overview').select('id, name, set_name, class_id').in('id', groupIds)
      : Promise.resolve({ data: [] as never[] }),
    directIds.length
      ? supabase
          .from('profiles')
          .select('id, first_name, last_name, avatar_url')
          .in('id', directIds)
      : Promise.resolve({ data: [] as never[] }),
  ])

  const classById = new Map(
    ((classes.data ?? []) as { id: string; name: string; initial: string; archived_at: string | null }[]).map(
      (c) => [c.id, c],
    ),
  )
  const groupById = new Map(
    ((groups.data ?? []) as { id: string; name: string; set_name: string; class_id: string }[]).map(
      (g) => [g.id, g],
    ),
  )
  const personById = new Map(
    ((people.data ?? []) as Profile[]).map((p) => [p.id, p]),
  )

  return rows.map((row) => {
    if (row.kind === 'class') {
      const c = row.class_id ? classById.get(row.class_id) : undefined
      return {
        ...row,
        title: c ? c.name : 'Class chat',
        subtitle: c ? `${c.initial} · everyone in the class` : 'Class chat',
        writable: !c?.archived_at,
      }
    }
    if (row.kind === 'group') {
      const g = row.group_id ? groupById.get(row.group_id) : undefined
      const parent = g?.class_id ? classById.get(g.class_id) : undefined
      return {
        ...row,
        title: g ? g.name : 'Group chat',
        subtitle: g ? `${g.set_name}${parent ? ` · ${parent.initial}` : ''}` : 'Group chat',
        writable: !parent?.archived_at,
      }
    }
    const otherId = (row.direct_key ?? '').split('|').find((id) => id !== viewerId)
    const person = otherId ? personById.get(otherId) : undefined
    return {
      ...row,
      title: person ? fullName(person) : 'Direct message',
      subtitle: 'Direct message',
      counterpart: person,
      writable: true,
    }
  })
}

export async function startDirectConversation(studentId: string) {
  const { data, error } = await supabase.rpc('start_direct_conversation', { p_student: studentId })
  if (error) throw error
  return data as {
    result: 'ok' | 'not_professor' | 'not_your_student' | 'not_signed_in'
    conversation_id?: string
  }
}

export async function markRead(conversationId: string) {
  const { error } = await supabase.rpc('mark_conversation_read', { p_conversation: conversationId })
  if (error) throw error
}

export const START_DM_MESSAGE = {
  not_professor: 'Only professors can start a direct message.',
  not_your_student: 'You can only message students in your own classes.',
  not_signed_in: 'Sign in first, then try again.',
} as const

/* -------------------------------------------------------------- messages */

export async function listMessages(conversationId: string, limit = 200) {
  const [{ data, error }, hidden] = await Promise.all([
    supabase
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase.from('message_hidden').select('message_id'),
  ])
  if (error) throw error

  const hiddenIds = new Set(((hidden.data ?? []) as { message_id: string }[]).map((h) => h.message_id))
  const rows = (data ?? []) as unknown as ChatMessage[]
  // Oldest first for rendering; "delete for me" is applied here so the row
  // itself stays untouched for everyone else.
  return rows.filter((m) => !hiddenIds.has(m.id)).reverse()
}

export async function getMessage(id: string) {
  const { data, error } = await supabase.from('messages').select(MESSAGE_SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as unknown as ChatMessage | null) ?? null
}

export async function sendMessage(input: {
  conversationId: string
  senderId: string
  body: string
  files?: File[]
}) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: input.conversationId,
      sender_id: input.senderId,
      body: input.body.trim(),
    })
    .select('id')
    .single()
  if (error) throw error

  const messageId = data.id as string
  for (const file of input.files ?? []) {
    await attachToMessage(input.conversationId, messageId, file)
  }
  return messageId
}

export async function attachToMessage(conversationId: string, messageId: string, file: File) {
  const safeName = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${conversationId}/${messageId}/${Date.now()}-${safeName}`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined })
  if (upErr) throw upErr

  const { error } = await supabase.from('message_attachments').insert({
    message_id: messageId,
    file_path: path,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
  })
  if (error) {
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
}

export async function editMessage(id: string, body: string) {
  const { error } = await supabase.from('messages').update({ body: body.trim() }).eq('id', id)
  if (error) throw error
}

/** Hides it for the caller only. */
export async function deleteForMe(messageId: string) {
  const { error } = await supabase.rpc('hide_message', { p_message: messageId })
  if (error) throw error
}

export async function deleteForEveryone(messageId: string) {
  const { data, error } = await supabase.rpc('delete_message_for_all', { p_message: messageId })
  if (error) throw error
  return data as { result: 'deleted' | 'not_allowed' | 'not_found' }
}

export async function setPinned(messageId: string, pinned: boolean) {
  const { data, error } = await supabase.rpc('set_message_pinned', {
    p_message: messageId,
    p_pinned: pinned,
  })
  if (error) throw error
  return data as { result: 'ok' | 'not_allowed' | 'not_found' | 'deleted' }
}

export async function attachmentUrl(attachment: MessageAttachment) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(attachment.file_path, 60 * 60)
  if (error) throw error
  return data.signedUrl
}

/* -------------------------------------------------------------- realtime */

/**
 * Postgres changes for everything shown in a thread. Supabase applies the same
 * RLS to realtime as to reads, so a non-member receives nothing.
 *
 * Polls live in separate tables, so a vote or a new option produces no event on
 * `messages` — each poll table needs its own listener or the card sits stale.
 *
 * The topic is unique per subscription: React remounts effects (StrictMode does
 * it twice in development), and two live channels sharing one topic collide.
 */
export function subscribeToConversation(conversationId: string, onChange: () => void) {
  const topic = `conversation:${conversationId}:${Math.random().toString(36).slice(2)}`
  const watch = ['messages', 'message_attachments', 'polls', 'poll_options', 'poll_votes']

  let channel = supabase.channel(topic)
  for (const table of watch) {
    channel = channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        // Only messages carries the conversation id; the rest are reached
        // through it, and RLS already limits them to this viewer.
        ...(table === 'messages' ? { filter: `conversation_id=eq.${conversationId}` } : {}),
      },
      onChange,
    )
  }

  channel.subscribe((status, err) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn(`[collabify] realtime ${status} on ${topic}`, err?.message ?? '')
    }
  })

  return () => {
    void supabase.removeChannel(channel)
  }
}
