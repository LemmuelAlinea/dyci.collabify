import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../app/Avatar'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { formatBytes } from '../ui/FileDrop'
import { Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { attachmentUrl } from '../../lib/api/messages'
import { authErrorMessage } from '../../lib/authError'
import { isImage, withinEditWindow } from '../../lib/types'
import type { ChatMessage, MessageAttachment } from '../../lib/types'

function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function Attachment({ attachment, mine }: { attachment: MessageAttachment; mine: boolean }) {
  const { show } = useToast()
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!isImage(attachment)) return
    let alive = true
    void attachmentUrl(attachment)
      .then((url) => alive && setPreview(url))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [attachment])

  async function open() {
    try {
      window.open(await attachmentUrl(attachment), '_blank', 'noopener')
    } catch (err) {
      show(authErrorMessage(err, 'Could not open that file.'), 'error')
    }
  }

  if (isImage(attachment)) {
    return (
      <button type="button" onClick={open} className="block overflow-hidden rounded-xl">
        {preview ? (
          <img
            src={preview}
            alt={attachment.file_name}
            className="max-h-[280px] w-auto max-w-full object-cover"
          />
        ) : (
          <span className="flex h-24 w-40 items-center justify-center rounded-xl surface-sunken text-[12px] text-faint">
            Loading image…
          </span>
        )}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={open}
      className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
        mine
          ? 'border-white/20 hover:bg-white/10'
          : 'border-line hover:bg-[var(--surface-sunken)]'
      }`}
    >
      <Icon name="file" size={17} className="shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate text-[13px]">{attachment.file_name}</span>
      <span className="shrink-0 text-[11px] opacity-60">{formatBytes(attachment.size_bytes)}</span>
    </button>
  )
}

type Props = {
  message: ChatMessage
  mine: boolean
  canModerate: boolean
  showSender: boolean
  onEdit: (id: string, body: string) => Promise<void>
  onDeleteForMe: (id: string) => void
  onDeleteForEveryone: (id: string) => void
  onTogglePin: (message: ChatMessage) => void
}

export function MessageBubble({
  message,
  mine,
  canModerate,
  showSender,
  onEdit,
  onDeleteForMe,
  onDeleteForEveryone,
  onTogglePin,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.body)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const deleted = Boolean(message.deleted_at)
  const canEdit = mine && !deleted && withinEditWindow(message)
  const canDeleteForEveryone = (mine || canModerate) && !deleted

  if (deleted) {
    return (
      <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
        <p className="rounded-2xl border border-dashed border-line-strong px-3.5 py-2 text-[13px] text-faint italic">
          Message deleted
        </p>
      </div>
    )
  }

  return (
    <div className={`group flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
      {!mine && (
        <span className="w-8 shrink-0">
          {showSender && message.sender && (
            <Avatar
              profile={{
                first_name: message.sender.first_name,
                last_name: message.sender.last_name,
                avatar_url: message.sender.avatar_url,
              }}
              size={32}
            />
          )}
        </span>
      )}

      <div className={`flex min-w-0 max-w-[min(78%,520px)] flex-col ${mine ? 'items-end' : 'items-start'}`}>
        {showSender && !mine && message.sender && (
          <p className="mb-1 px-1 text-[12px] font-medium text-muted">
            {message.sender.first_name} {message.sender.last_name}
          </p>
        )}

        <div className={`flex items-start gap-1 ${mine ? 'flex-row-reverse' : ''}`}>
          <div
            className={`min-w-0 rounded-2xl px-3.5 py-2.5 ${
              mine
                ? 'bg-navy-600 text-white dark:bg-navy-500'
                : 'surface border border-line text-ink'
            }`}
          >
            {message.pinned && (
              <p
                className={`mb-1.5 flex items-center gap-1 text-[10.5px] font-medium tracking-wide uppercase ${
                  mine ? 'text-amber-300' : 'text-amber-600 dark:text-amber-300'
                }`}
              >
                <Icon name="pin" size={11} />
                Pinned
              </p>
            )}

            {editing ? (
              <div className="w-[min(60vw,320px)] space-y-2">
                <Textarea
                  rows={2}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="!bg-[var(--surface)] !text-ink"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    loading={busy}
                    className="!rounded-lg"
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await onEdit(message.id, draft)
                        setEditing(false)
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {message.body && (
                  <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap break-words">
                    {message.body}
                  </p>
                )}
                {message.attachments.length > 0 && (
                  <div className={`space-y-2 ${message.body ? 'mt-2' : ''}`}>
                    {message.attachments.map((a) => (
                      <Attachment key={a.id} attachment={a} mine={mine} />
                    ))}
                  </div>
                )}
                <p
                  className={`mt-1 text-[10.5px] ${mine ? 'text-white/55' : 'text-faint'}`}
                >
                  {clockTime(message.created_at)}
                  {message.edited_at && ' · edited'}
                </p>
              </>
            )}
          </div>

          {!editing && (
            <div className="relative shrink-0" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Message actions"
                className="grid h-7 w-7 place-items-center rounded-full text-faint opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[var(--surface-sunken)] hover:text-ink"
              >
                <Icon name="dots" size={15} />
              </button>

              {menuOpen && (
                <div
                  className={`surface absolute top-8 z-30 w-52 overflow-hidden rounded-xl border border-line shadow-lift ${
                    mine ? 'right-0' : 'left-0'
                  }`}
                >
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(message.body)
                        setEditing(true)
                        setMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13.5px] text-ink hover:bg-[var(--surface-sunken)]"
                    >
                      <Icon name="edit" size={15} className="text-muted" />
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onTogglePin(message)
                      setMenuOpen(false)
                    }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13.5px] text-ink hover:bg-[var(--surface-sunken)]"
                  >
                    <Icon name="pin" size={15} className="text-muted" />
                    {message.pinned ? 'Unpin' : 'Pin to top'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteForMe(message.id)
                      setMenuOpen(false)
                    }}
                    className="flex w-full items-center gap-2.5 border-t border-line px-3.5 py-2.5 text-left text-[13.5px] text-ink hover:bg-[var(--surface-sunken)]"
                  >
                    <Icon name="eyeOff" size={15} className="text-muted" />
                    Delete for me
                  </button>
                  {canDeleteForEveryone && (
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteForEveryone(message.id)
                        setMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2.5 border-t border-line px-3.5 py-2.5 text-left text-[13.5px] text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                    >
                      <Icon name="trash" size={15} />
                      Delete for everyone
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
