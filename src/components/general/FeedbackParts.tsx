import { useRef, useState } from 'react'
import { Badge } from '../ui/Badge'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { feedbackFileUrl, FEEDBACK_FILE_LIMIT, FEEDBACK_FILES_PER_POST } from '../../lib/api/feedback'
import { authErrorMessage } from '../../lib/authError'
import { formatBytes } from '../../lib/formatBytes'
import {
  FEEDBACK_STATUS_LABEL,
  feedbackStatusTone,
} from '../../lib/general/feedback'
import type { FeedbackStatus, GeneralFeedbackFile } from '../../lib/general/feedback'

export function StatusChip({ status }: { status: FeedbackStatus }) {
  return <Badge tone={feedbackStatusTone(status)}>{FEEDBACK_STATUS_LABEL[status]}</Badge>
}

/** Picks files for a post or reply: up to 10, 25 MB each, listed with a way to drop one. */
export function AttachPicker({
  files,
  onChange,
  disabled,
}: {
  files: File[]
  onChange: (files: File[]) => void
  disabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<string | null>(null)

  function take(picked: FileList | null) {
    setProblem(null)
    if (!picked || picked.length === 0) return
    const next = [...files]
    for (const file of Array.from(picked)) {
      if (file.size > FEEDBACK_FILE_LIMIT) {
        setProblem(`${file.name} is ${formatBytes(file.size)}. The limit is 25 MB.`)
        continue
      }
      if (next.length >= FEEDBACK_FILES_PER_POST) {
        setProblem('Attach up to 10 files at a time.')
        break
      }
      next.push(file)
    }
    onChange(next)
    if (input.current) input.current.value = ''
  }

  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center gap-3 rounded-xl border border-line surface-sunken px-3 py-2"
            >
              <Icon name="file" size={16} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{file.name}</span>
              <span className="shrink-0 text-[12px] text-faint">{formatBytes(file.size)}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                aria-label={`Remove ${file.name}`}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint hover:bg-[var(--surface)] hover:text-ink"
              >
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={disabled || files.length >= FEEDBACK_FILES_PER_POST}
        onClick={() => input.current?.click()}
        className="inline-flex items-center gap-2 rounded-xl border border-dashed border-line-strong px-3.5 py-2 text-[13px] text-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink disabled:opacity-60"
      >
        <Icon name="clip" size={15} />
        Attach files
        <span className="text-[12px] text-faint">· up to 25 MB each</span>
      </button>
      <input ref={input} type="file" multiple className="hidden" onChange={(e) => take(e.target.files)} />
      {problem && <p className="text-[12px] text-danger-600 dark:text-danger-400">{problem}</p>}
    </div>
  )
}

/** A post's or reply's attachments. Each opens through a signed link, in a new tab. */
export function FeedbackFiles({ files }: { files: GeneralFeedbackFile[] }) {
  const { show } = useToast()
  if (files.length === 0) return null

  async function open(file: GeneralFeedbackFile) {
    try {
      window.open(await feedbackFileUrl(file.path), '_blank', 'noopener')
    } catch (err) {
      show(authErrorMessage(err, 'Could not open that file.'), 'error')
    }
  }

  return (
    <ul className="mt-3 space-y-1.5">
      {files.map((file) => (
        <li key={file.id}>
          <button
            type="button"
            onClick={() => void open(file)}
            className="flex w-full max-w-[420px] items-center gap-3 rounded-xl border border-line px-3 py-2 text-left transition-colors hover:bg-[var(--surface-sunken)]"
          >
            <Icon name="file" size={16} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{file.name}</span>
            <span className="shrink-0 text-[12px] text-faint">{formatBytes(file.size_bytes)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
