import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Icon, Spinner } from '../ui/Icon'
import { formatBytes } from '../ui/FileDrop'

const MAX_MB = 10

export function MessageComposer({
  disabled,
  disabledReason,
  onSend,
  onCreatePoll,
}: {
  disabled?: boolean
  disabledReason?: string
  onSend: (body: string, files: File[]) => Promise<void>
  onCreatePoll: () => void
}) {
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)

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
      await onSend(body, files)
      setBody('')
      setFiles([])
      boxRef.current?.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not send. Try again.')
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter is a newline, the convention everywhere else.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  if (disabled) {
    return (
      <div className="border-t border-line px-4 py-4 text-center text-[13.5px] text-muted md:px-6">
        {disabledReason ?? 'You cannot post in this conversation.'}
      </div>
    )
  }

  return (
    <div className="border-t border-line px-3 py-3 md:px-5 md:py-4">
      {error && <p className="mb-2 text-[12.5px] text-red-600 dark:text-red-400">{error}</p>}

      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 rounded-lg surface-sunken py-1.5 pr-1.5 pl-2.5"
            >
              <Icon name="file" size={14} className="text-muted" />
              <span className="max-w-[160px] truncate text-[12.5px]">{f.name}</span>
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
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Attach a file"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
        >
          <Icon name="upload" size={19} />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => pick(e.target.files)}
        />

        <button
          type="button"
          onClick={onCreatePoll}
          aria-label="Create a poll"
          title="Create a poll"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
        >
          <Icon name="chart" size={19} />
        </button>

        <textarea
          ref={boxRef}
          rows={1}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Write a message"
          className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-[14.5px] text-ink transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--ink-faint)] hover:border-[var(--line-strong)] focus:border-navy-400 focus:ring-4 focus:ring-navy-500/12 focus:outline-none"
        />

        <button
          type="button"
          onClick={submit}
          disabled={busy || (!body.trim() && files.length === 0)}
          aria-label="Send message"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-navy-600 text-white transition-[background-color,transform] duration-200 hover:bg-navy-500 active:scale-95 disabled:opacity-40 dark:bg-navy-500 dark:hover:bg-navy-400"
        >
          {busy ? <Spinner size={17} /> : <Icon name="arrowRight" size={19} />}
        </button>
      </div>
    </div>
  )
}
