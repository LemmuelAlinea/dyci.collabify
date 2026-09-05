import { useEffect, useState } from 'react'
import { Icon, Spinner } from '../../ui/Icon'
import { formatBytes } from '../../ui/FileDrop'
import { taskFileUrl } from '../../../lib/api/taskDetail'
import { isImage } from '../../../lib/types'
import type { TaskFile } from '../../../lib/types'

function isPdf(file: TaskFile) {
  return file.mime_type === 'application/pdf' || file.file_name.toLowerCase().endsWith('.pdf')
}

/**
 * One file, shown rather than listed. Images render, PDFs frame, and anything
 * else is a card — a spreadsheet cannot be previewed honestly, so it is not
 * pretended at.
 */
export function FilePreview({
  file,
  canRemove,
  onRemove,
}: {
  file: TaskFile
  canRemove: boolean
  onRemove: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const previewable = isImage(file) || isPdf(file)

  useEffect(() => {
    if (!previewable) return
    let live = true
    void taskFileUrl(file.file_path)
      .then((signed) => live && setUrl(signed))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [file.file_path, previewable])

  async function open() {
    try {
      window.open(url ?? (await taskFileUrl(file.file_path)), '_blank', 'noopener')
    } catch {
      setFailed(true)
    }
  }

  return (
    <figure className="surface overflow-hidden rounded-xl border border-line">
      {previewable && !failed && (
        <div className="surface-sunken flex min-h-[140px] items-center justify-center">
          {!url ? (
            <span className="flex items-center gap-2 py-10 text-[13px] text-muted">
              <Spinner size={14} />
              Loading…
            </span>
          ) : isImage(file) ? (
            <button type="button" onClick={open} className="block w-full">
              <img
                src={url}
                alt={file.file_name}
                loading="lazy"
                className="max-h-[260px] w-full object-contain"
                onError={() => setFailed(true)}
              />
            </button>
          ) : (
            // Not every mobile browser will frame a PDF, so the link stays.
            <object data={url} type="application/pdf" className="h-[260px] w-full">
              <button
                type="button"
                onClick={open}
                className="flex h-[260px] w-full flex-col items-center justify-center gap-2 text-[13px] text-muted"
              >
                <Icon name="file" size={22} />
                Open the PDF
              </button>
            </object>
          )}
        </div>
      )}

      <figcaption className="flex items-center gap-3 px-3.5 py-2.5">
        <Icon name="file" size={16} className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">
            {file.file_name}
          </span>
          <span className="block text-[12px] text-faint">
            {formatBytes(file.size_bytes)}
            {file.uploader && ` · ${file.uploader.first_name} ${file.uploader.last_name}`}
          </span>
        </span>

        <button
          type="button"
          onClick={open}
          aria-label={`Open ${file.file_name}`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
        >
          <Icon name="download" size={15} />
        </button>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${file.file_name}`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
          >
            <Icon name="trash" size={15} />
          </button>
        )}
      </figcaption>
    </figure>
  )
}
