import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { discussionFileUrl } from '../../lib/api/discussions'
import { authErrorMessage } from '../../lib/authError'
import { formatBytes } from '../../lib/formatBytes'
import type { GeneralDiscussionFile } from '../../lib/general/types'

const isPicture = (f: GeneralDiscussionFile) => (f.mime_type ?? '').startsWith('image/')

function Picture({ file, onOpen }: { file: GeneralDiscussionFile; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void discussionFileUrl(file.file_path)
      .then((u) => live && setUrl(u))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [file.file_path])
  return (
    <button type="button" onClick={onOpen} className="block overflow-hidden rounded-xl" aria-label={`Open ${file.file_name}`}>
      {url ? (
        <img src={url} alt={file.file_name} className="max-h-[220px] w-auto max-w-full object-cover" />
      ) : (
        <span className="flex h-20 w-36 items-center justify-center rounded-xl bg-current/8 text-[12px] opacity-70">
          Loading image…
        </span>
      )}
    </button>
  )
}

/** Files shared in a discussion message. Each opens in a new tab. */
export function DiscussionFiles({ files, mine }: { files: GeneralDiscussionFile[]; mine: boolean }) {
  const { show } = useToast()

  async function open(file: GeneralDiscussionFile) {
    try {
      window.open(await discussionFileUrl(file.file_path), '_blank', 'noopener')
    } catch (err) {
      show(authErrorMessage(err, 'Could not open that file.'), 'error')
    }
  }

  if (files.length === 0) return <p className="text-[12px] opacity-70">Loading the files…</p>

  return (
    <ul className="w-[300px] max-w-full space-y-2">
      {files.map((f) => (
        <li key={f.id}>
          {isPicture(f) ? (
            <Picture file={f} onOpen={() => void open(f)} />
          ) : (
            <button
              type="button"
              onClick={() => void open(f)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                mine ? 'border-white/20 hover:bg-white/10' : 'border-line hover:bg-[var(--surface)]'
              }`}
            >
              <Icon name="file" size={17} className="shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate text-[13px]">{f.file_name}</span>
              <span className="shrink-0 text-[12px] opacity-60">{formatBytes(f.size_bytes)}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
