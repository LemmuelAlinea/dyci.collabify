import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Icon, Spinner } from '../ui/Icon'
import { formatBytes } from '../../lib/formatBytes'
import { LIMIT } from '../../lib/limits'
import { canRecordVoice, voiceFileName } from '../../lib/voice'
import { VoiceRecorder } from '../general/VoiceRecorder'
import { ActionMenu } from '../ui/ActionMenu'
import { useAutoGrow } from '../../hooks/useAutoGrow'
import { MentionPicker } from './MentionPicker'
import { mentionBlindSpots, searchMentionables, type BlindSpot, type Mentionable } from '../../lib/api/mentions'
import { encodeMentions, mentionQueryAt, uniqueLabel, type Picked } from '../../lib/mentions'

const MAX_MB = 10

export function MessageComposer({
  disabled,
  disabledReason,
  onSend,
  onCreatePoll,
  conversationId,
}: {
  conversationId: string
  disabled?: boolean
  disabledReason?: string
  onSend: (body: string, files: File[]) => Promise<void>
  onCreatePoll: () => void
}) {
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(boxRef, body)

  // ---- # mentions: the query at the caret, its results, and what was picked
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [items, setItems] = useState<Mentionable[]>([])
  const [active, setActive] = useState(0)
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<Picked[]>([])
  const [spots, setSpots] = useState<BlindSpot[]>([])
  const open = mention !== null && mention.start !== dismissed
  // Only the text after # drives the search; a caret move that keeps it does not.
  const query = open ? mention.query : null

  useEffect(() => {
    if (query === null) {
      setItems([])
      setSearching(false)
      return
    }
    let live = true
    // A new query drops the old results, so Enter can't pick one meant for an earlier search.
    setItems([])
    setSearching(true)
    const timer = setTimeout(() => {
      searchMentionables(query, conversationId)
        .then((found) => {
          if (!live) return
          setItems(found)
          setActive(0)
        })
        .catch(() => live && setItems([]))
        .finally(() => live && setSearching(false))
    }, 200)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, conversationId])

  // The writer's note: who in this chat would see a mention locked.
  useEffect(() => {
    if (picked.length === 0) {
      setSpots([])
      return
    }
    let live = true
    mentionBlindSpots(conversationId, picked.map((p) => p.ref))
      .then((found) => live && setSpots(found))
      .catch(() => live && setSpots([]))
    return () => {
      live = false
    }
  }, [picked, conversationId])

  function trackCaret(text: string, caret: number | null) {
    const q = caret === null ? null : mentionQueryAt(text, caret, picked)
    setMention(q)
    if (!q) setDismissed(null)
  }

  function pickMention(m: Mentionable) {
    if (!mention) return
    const end = mention.start + 1 + mention.query.length
    const ref = { kind: m.kind, id: m.id }
    // Two mentions never share a label, so each `#label` sends its own target.
    const label = uniqueLabel(m.title, m.project_title, picked, ref)
    const insert = `#${label} `
    const next = body.slice(0, mention.start) + insert + body.slice(end)
    setBody(next)
    setPicked((list) =>
      list.some((p) => p.ref.kind === ref.kind && p.ref.id === ref.id)
        ? list
        : [...list, { label, ref, project: m.project_title }],
    )
    setMention(null)
    const caret = mention.start + insert.length
    requestAnimationFrame(() => {
      boxRef.current?.focus()
      boxRef.current?.setSelectionRange(caret, caret)
    })
  }

  function pick(list: FileList | null) {
    if (!list) return
    const next: File[] = []
    for (const file of Array.from(list)) {
      if (file.size > MAX_MB * 1024 * 1024) {
        setError(`${file.name} is ${formatBytes(file.size)}. The limit is ${MAX_MB} MB.`)
        continue
      }
      next.push(file)
    }
    if (next.length) setError(null)
    setFiles((f) => [...f, ...next])
    if (fileRef.current) fileRef.current.value = ''
  }

  async function submit() {
    if (busy || disabled) return
    if (!body.trim() && files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await onSend(encodeMentions(body, picked, window.location.origin), files)
      setBody('')
      setFiles([])
      setPicked([])
      setMention(null)
      boxRef.current?.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not send. Try again.')
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open && mention) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(mention.start)
        return
      }
      // Enter while results are still on their way waits for them rather than sending "#que".
      if (searching && items.length === 0 && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        return
      }
      if (items.length > 0) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const step = e.key === 'ArrowDown' ? 1 : -1
          setActive((i) => (i + step + items.length) % items.length)
          return
        }
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
          e.preventDefault()
          pickMention(items[Math.min(active, items.length - 1)])
          return
        }
      }
    }
    // Enter sends; Shift+Enter is a newline, the convention everywhere else.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  if (disabled) {
    return (
      <div className="border-t border-line px-4 py-4 text-center text-[13px] text-muted md:px-6">
        {disabledReason ?? 'You cannot post in this conversation.'}
      </div>
    )
  }

  // A voice message is an audio attachment named for its length, sent on its own.
  async function sendVoice(blob: Blob, ms: number) {
    setError(null)
    try {
      await onSend('', [new File([blob], voiceFileName(ms, blob.type), { type: blob.type.split(';')[0] })])
      setRecording(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The voice message did not send. Try again.')
    }
  }

  if (recording) {
    return (
      <div className="border-t border-line bg-[var(--surface)] px-3 py-3 md:px-5 md:py-4">
        {error && <p className="mb-2 text-[12px] text-danger-600 dark:text-danger-400">{error}</p>}
        <VoiceRecorder onSend={sendVoice} onCancel={() => setRecording(false)} />
      </div>
    )
  }

  return (
    <div className="relative border-t border-line bg-[var(--surface)] px-3 py-3 md:px-5 md:py-4">
      {open && (
        <MentionPicker
          items={items}
          active={active}
          loading={searching}
          onPick={pickMention}
          onHover={setActive}
        />
      )}
      {error && <p className="mb-2 text-[12px] text-danger-600 dark:text-danger-400">{error}</p>}

      {spots
        .filter((s) => s.members_without > 0 || s.private_task)
        .filter((s) => picked.some((p) => p.ref.id === s.id && body.includes(`#${p.label}`)))
        .map((s) => {
          const pick = picked.find((p) => p.ref.id === s.id)
          const label = pick?.label ?? ''
          const project = pick?.project ?? 'this project'
          return (
            <p key={`${s.kind}:${s.id}`} className="mb-2 flex items-start gap-1.5 text-[12px] text-muted">
              <Icon name="lock" size={12} className="mt-0.5 shrink-0" />
              <span>
                {s.members_without > 0 &&
                  (s.members_without === 1
                    ? `1 person in this chat isn't on ${project}. They'll see a locked chip.`
                    : `${s.members_without} people in this chat aren't on ${project}. They'll see a locked chip.`)}
                {s.members_without > 0 && s.private_task && ' '}
                {s.private_task &&
                  `Only the project manager and coordinators can open #${label} until it's sent.`}
              </span>
            </p>
          )
        })}

      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 rounded-lg surface-sunken py-1.5 pr-1.5 pl-2.5"
            >
              <Icon name="file" size={14} className="text-muted" />
              <span className="max-w-[160px] truncate text-[12px]">{f.name}</span>
              <button
                type="button"
                onClick={() => setFiles((list) => list.filter((_, n) => n !== i))}
                aria-label={`Remove ${f.name}`}
                className="grid h-6 w-6 place-items-center rounded-full text-faint hover:text-ink"
              >
                <Icon name="x" size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => pick(e.target.files)}
        />
        {/* A phone gets one clip button for these three; wider screens show them side by side. */}
        <div className="sm:hidden">
          <ActionMenu
            label="Attach"
            icon="clip"
            align="start"
            triggerClassName="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
            items={[
              { label: 'Attach files', icon: 'upload', onSelect: () => fileRef.current?.click() },
              { label: 'Create a poll', icon: 'chart', onSelect: onCreatePoll },
              canRecordVoice() && { label: 'Voice message', icon: 'mic', onSelect: () => setRecording(true) },
            ]}
          />
        </div>
        <div className="hidden shrink-0 items-end gap-2 sm:flex">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Attach a file"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
          >
            <Icon name="upload" size={19} />
          </button>
          <button
            type="button"
            onClick={onCreatePoll}
            aria-label="Create a poll"
            title="Create a poll"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
          >
            <Icon name="chart" size={19} />
          </button>
          {canRecordVoice() && (
            <button
              type="button"
              onClick={() => setRecording(true)}
              aria-label="Record a voice message"
              title="Record a voice message (up to 5 minutes)"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
            >
              <Icon name="mic" size={19} />
            </button>
          )}
        </div>

        <textarea
          ref={boxRef}
          rows={1}
          maxLength={LIMIT.messageBody}
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
            trackCaret(e.target.value, e.target.selectionStart)
          }}
          onSelect={(e) => trackCaret(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => setMention(null)}
          onKeyDown={onKeyDown}
          aria-expanded={open}
          aria-haspopup="listbox"
          placeholder="Write a message"
          className="min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-[var(--control-line)] bg-[var(--surface)] px-4 py-3 text-[14px] text-ink transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--ink-faint)] hover:border-[var(--line-strong)] focus:border-navy-400 focus:ring-4 focus:ring-navy-500/12"
        />

        <button
          type="button"
          onClick={submit}
          disabled={busy || (!body.trim() && files.length === 0)}
          aria-label="Send message"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-navy-600 text-white transition-[background-color,scale] duration-(--dur-press) hover:bg-navy-500 active:scale-95 disabled:opacity-40 dark:bg-navy-500 dark:hover:bg-navy-400"
        >
          {busy ? <Spinner size={17} /> : <Icon name="arrowRight" size={19} />}
        </button>
      </div>
    </div>
  )
}
