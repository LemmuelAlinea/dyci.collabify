import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLive } from '../../hooks/useLive'
import { Link } from 'react-router-dom'
import { Avatar } from '../app/Avatar'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Alert } from '../ui/Alert'
import { Icon, Spinner } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { CreatePollDialog } from './CreatePollDialog'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'
import {
  deleteForEveryone,
  deleteForMe,
  editMessage,
  listMessages,
  markRead,
  sendMessage,
  setPinned,
  subscribeToConversation,
} from '../../lib/api/messages'
import { authErrorMessage } from '../../lib/authError'
import type { ChatMessage, ConversationCard } from '../../lib/types'

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

export function MessageThread({
  conversation,
  viewerId,
  canModerate,
  backTo,
}: {
  conversation: ConversationCard
  viewerId: string
  canModerate: boolean
  backTo: string
}) {
  const { show } = useToast()
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Both deletes confirm first; the scope decides the wording and the call.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; scope: 'me' | 'all' } | null>(
    null,
  )
  const [showPins, setShowPins] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)

  const load = useCallback(
    async (markSeen = false) => {
      try {
        const rows = await listMessages(conversation.id)
        setMessages(rows)
        setError(null)
        if (markSeen) await markRead(conversation.id)
      } catch (err) {
        setError(authErrorMessage(err, 'Could not load this conversation.'))
      }
    },
    [conversation.id],
  )

  useEffect(() => {
    setMessages(null)
    void load(true)
  }, [load])

  // Realtime carries the same RLS as a read, so a non-member gets nothing.
  useEffect(() => {
    return subscribeToConversation(conversation.id, () => {
      void load(true)
    })
  }, [conversation.id, load])

  // Safety net: a dropped socket, a sleeping phone, or a proxy that kills long
  // connections would otherwise leave the thread silently frozen. The cadence
  // is this thread's own — a conversation is the one place a minute of staleness
  // is actually noticeable — and useLive adds the focus and back-online cases
  // the hand-rolled version here was missing.
  useLive(load, [], { every: 12_000 })

  useEffect(() => {
    if (atBottomRef.current) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const pinned = useMemo(
    () => (messages ?? []).filter((m) => m.pinned && !m.deleted_at),
    [messages],
  )

  async function onSend(body: string, files: File[]) {
    await sendMessage({ conversationId: conversation.id, senderId: viewerId, body, files })
    atBottomRef.current = true
    await load(true)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 md:px-5">
        <Link
          to={backTo}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:bg-[var(--surface-sunken)] hover:text-ink lg:hidden"
          aria-label="Back to conversations"
        >
          <Icon name="arrowLeft" size={18} />
        </Link>
        {conversation.counterpart ? (
          <Avatar profile={conversation.counterpart} size={38} />
        ) : (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-navy-600 text-amber-400 dark:bg-navy-500">
            <Icon name={conversation.kind === 'class' ? 'board' : 'users'} size={18} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] leading-tight">{conversation.title}</h2>
          <p className="truncate text-[12px] text-muted">{conversation.subtitle}</p>
        </div>
      </header>

      {pinned.length > 0 && (
        <div className="border-b border-line bg-amber-400/10 px-4 py-2.5 md:px-5">
          <button
            type="button"
            onClick={() => setShowPins((v) => !v)}
            className="flex w-full items-start gap-2.5 text-left"
          >
            <Icon
              name="pin"
              size={14}
              className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink">
                {pinned[pinned.length - 1].body || 'Attachment'}
              </span>
              {pinned.length > 1 && (
                <span className="text-[11.5px] text-muted">
                  {showPins ? 'Hide' : `and ${pinned.length - 1} more pinned`}
                </span>
              )}
            </span>
            {pinned.length > 1 && (
              <Icon
                name="chevronDown"
                size={15}
                className={`mt-0.5 shrink-0 text-muted transition-transform ${showPins ? 'rotate-180' : ''}`}
              />
            )}
          </button>
          {showPins && pinned.length > 1 && (
            <ul className="mt-2 space-y-1.5 border-t border-amber-400/25 pt-2">
              {pinned.slice(0, -1).map((m) => (
                <li key={m.id} className="truncate text-[12.5px] text-muted">
                  {m.body || 'Attachment'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5"
        onScroll={(e) => {
          const el = e.currentTarget
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {error && <Alert tone="error">{error}</Alert>}

        {messages === null ? (
          <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading messages…
          </div>
        ) : messages.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl surface-sunken text-faint">
                <Icon name="message" size={22} />
              </span>
              <p className="mt-4 text-[15px] font-medium text-ink">No messages yet</p>
              <p className="mt-1 text-[13.5px] text-muted">Say something to get it started.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {messages.map((m, i) => {
              const prev = messages[i - 1]
              const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at)
              const showSender = newDay || !prev || prev.sender_id !== m.sender_id
              return (
                <div key={m.id} className="space-y-2.5">
                  {newDay && (
                    <p className="py-2 text-center font-mono text-[10.5px] tracking-wider text-faint uppercase">
                      {dayLabel(m.created_at)}
                    </p>
                  )}
                  <MessageBubble
                    message={m}
                    mine={m.sender_id === viewerId}
                    canModerate={canModerate}
                    showSender={showSender}
                    viewerId={viewerId}
                    onPollChanged={load}
                    onEdit={async (id, body) => {
                      try {
                        await editMessage(id, body)
                        await load()
                      } catch (err) {
                        show(authErrorMessage(err, 'Could not edit that message.'), 'error')
                      }
                    }}
                    onDeleteForMe={(id) => setPendingDelete({ id, scope: 'me' })}
                    onDeleteForEveryone={(id) => setPendingDelete({ id, scope: 'all' })}
                    onTogglePin={async (msg) => {
                      const { result } = await setPinned(msg.id, !msg.pinned)
                      if (result === 'ok') {
                        await load()
                      } else {
                        show('Could not change the pin.', 'error')
                      }
                    }}
                  />
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <MessageComposer
        disabled={!conversation.writable}
        disabledReason="This class is archived, so the chat is read-only."
        onSend={onSend}
        onCreatePoll={() => setPollOpen(true)}
      />

      <CreatePollDialog
        open={pollOpen}
        onClose={() => setPollOpen(false)}
        conversationId={conversation.id}
        onCreated={async () => {
          atBottomRef.current = true
          await load(true)
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return
          if (pendingDelete.scope === 'me') {
            await deleteForMe(pendingDelete.id)
            show('Hidden for you')
          } else {
            const { result } = await deleteForEveryone(pendingDelete.id)
            if (result !== 'deleted') throw new Error('You cannot delete that message.')
            show('Deleted for everyone')
          }
          await load()
        }}
        title={pendingDelete?.scope === 'me' ? 'Delete for you?' : 'Delete for everyone?'}
        body={
          pendingDelete?.scope === 'me'
            ? 'The message disappears from your view of this chat. Everyone else still sees it, and you cannot bring it back.'
            : 'The message and any files on it are removed for everyone in this conversation. A note saying it was deleted stays in its place.'
        }
        confirmLabel={pendingDelete?.scope === 'me' ? 'Delete for me' : 'Delete for everyone'}
      />
    </div>
  )
}
