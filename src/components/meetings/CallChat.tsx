import { useCallback, useEffect, useRef, useState } from 'react'
import { useLive } from '../../hooks/useLive'
import { getMeeting, listCallMessages, sendCallMessage } from '../../lib/api/meetings'
import type { CallMessage } from '../../lib/api/meetings'
import { Button } from '../ui/Button'

function combine(current: CallMessage[], incoming: CallMessage[]) {
  const rows = new Map([...current, ...incoming].map((row) => [row.id, row]))
  return [...rows.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
}

export function CallChat({ meetingId, readOnly, onClose, compact = false }: {
  meetingId: string
  readOnly: boolean
  onClose?: () => void
  compact?: boolean
}) {
  const [messages, setMessages] = useState<CallMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [older, setOlder] = useState(false)
  const [error, setError] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const previousHeight = useRef(0)
  const loadingOlder = useRef(false)

  useEffect(() => {
    const box = scroll.current
    if (!box) return
    if (loadingOlder.current) box.scrollTop += box.scrollHeight - previousHeight.current
    else if (!previousHeight.current || box.scrollTop + box.clientHeight >= previousHeight.current - 80)
      box.scrollTop = box.scrollHeight
    previousHeight.current = box.scrollHeight
    loadingOlder.current = false
  }, [messages])

  const load = useCallback(async () => {
    try {
      if (!await getMeeting(meetingId)) {
        setMessages([])
        setOlder(false)
        setError('This chat is unavailable to you.')
        return
      }
      const rows = await listCallMessages(meetingId)
      setMessages((current) => combine(current, rows))
      setOlder(rows.length === 50)
      setError('')
    } catch { setMessages([]); setError('Could not load the meeting chat.') }
  }, [meetingId])
  useEffect(() => { setMessages([]); void load() }, [load])
  useLive(load, ['meeting_call_messages'], { enabled: !readOnly })

  async function loadOlder() {
    if (!messages.length) return
    loadingOlder.current = true
    try {
      const rows = await listCallMessages(meetingId, messages[0].created_at)
      setMessages((current) => combine(current, rows))
      setOlder(rows.length === 50)
    } catch { loadingOlder.current = false; setError('Could not load older messages.') }
  }

  async function send() {
    const body = draft.trim()
    if (!body || busy || readOnly) return
    setBusy(true)
    try {
      const row = await sendCallMessage(meetingId, body)
      setMessages((current) => combine(current, [row]))
      setDraft('')
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not send your message.') }
    finally { setBusy(false) }
  }

  return <aside aria-label="Meeting chat" className={`flex min-h-72 w-full flex-col rounded-xl border border-line surface ${compact ? '' : 'md:w-80'}`}>
    <div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="font-semibold text-ink">Chat</h2>{onClose && <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>}</div>
    <div ref={scroll} className="max-h-96 min-h-48 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
      {older && <button className="text-xs text-navy-600 hover:underline" onClick={() => void loadOlder()}>Load older messages</button>}
      {messages.map((message) => <div key={message.id} className="text-sm">
        <p className="flex gap-2 text-xs text-muted"><span className="font-semibold text-ink">{[message.sender?.first_name, message.sender?.last_name].filter(Boolean).join(' ') || 'Former member'}</span><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time></p>
        <p className="whitespace-pre-wrap break-words text-ink">{message.body}</p>
      </div>)}
      {!messages.length && <p className="text-sm text-muted">No messages yet.</p>}
    </div>
    {error && <p role="alert" className="px-4 text-xs text-danger-600">{error}</p>}
    {!readOnly && <form className="flex gap-2 border-t border-line p-3" onSubmit={(event) => { event.preventDefault(); void send() }}>
      <input aria-label="Message" maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message everyone" className="min-w-0 flex-1 rounded-lg border border-line surface px-3 py-2 text-sm text-ink" />
      <Button type="submit" size="sm" loading={busy} disabled={!draft.trim()}>Send</Button>
    </form>}
  </aside>
}
