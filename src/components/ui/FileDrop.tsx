import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Icon } from './Icon'

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type Props = {
  file: File | null
  onPick: (file: File | null) => void
  accept?: string
  /** Megabytes. */
  maxSize?: number
  hint?: string
  /** A slim row rather than a drop zone — for when files are already listed. */
  compact?: boolean
}

export function FileDrop({
  file,
  onPick,
  accept = '.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg',
  maxSize = 10,
  hint,
  compact = false,
}: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function take(next: File | undefined) {
    setError(null)
    if (!next) return
    if (next.size > maxSize * 1024 * 1024) {
      setError(`That file is ${formatBytes(next.size)}. The limit is ${maxSize} MB.`)
      return
    }
    onPick(next)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    take(e.dataTransfer.files?.[0])
  }

  if (file) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-xl border border-line surface-sunken px-4 py-3">
          <Icon name="file" size={20} className="shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium text-ink">{file.name}</p>
            <p className="text-[12px] text-faint">{formatBytes(file.size)}</p>
          </div>
          <button
            type="button"
            onClick={() => onPick(null)}
            aria-label="Remove file"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint hover:bg-[var(--surface)] hover:text-ink"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        {error && <p className="text-[12.5px] text-red-600 dark:text-red-400">{error}</p>}
      </div>
    )
  }

  const dragProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault()
      setOver(true)
    },
    onDragLeave: () => setOver(false),
    onDrop,
  }

  // Once something is already listed above, a full drop zone is just a hole in
  // the page. The slim row still takes a drop.
  if (compact) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          {...dragProps}
          className={`flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-[13px] transition-colors duration-200 ${
            over
              ? 'border-navy-400 bg-navy-50 dark:bg-navy-500/12'
              : 'border-line-strong text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
          }`}
        >
          <Icon name="plus" size={15} />
          Add another file
          <span className="text-[11.5px] text-faint">· up to {maxSize} MB</span>
        </button>
        <input
          ref={input}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => take(e.target.files?.[0])}
        />
        {error && <p className="text-[12.5px] text-red-600 dark:text-red-400">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        {...dragProps}
        className={`flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-9 transition-colors duration-200 ${
          over
            ? 'border-navy-400 bg-navy-50 dark:bg-navy-500/12'
            : 'border-line-strong hover:bg-[var(--surface-sunken)]'
        }`}
      >
        <Icon name="upload" size={22} className="text-faint" />
        <span className="text-[14px] font-medium text-ink">
          Drop a file here, or click to browse
        </span>
        <span className="text-[12px] text-faint">{hint ?? `Up to ${maxSize} MB`}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => take(e.target.files?.[0])}
      />
      {error && <p className="text-[12.5px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
