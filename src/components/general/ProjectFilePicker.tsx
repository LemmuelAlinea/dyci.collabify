import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Icon, Spinner } from '../ui/Icon'
import { getRepo, listTree } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { shownFiles } from '../../lib/general/files'
import type { GeneralTreeFile } from '../../lib/general/types'

/**
 * Pick a file from the project's Files (Main) to attach to a task. Opens in
 * place under the task's Files list rather than as a second dialog.
 */
export function ProjectFilePicker({
  projectId,
  onPick,
}: {
  projectId: string
  onPick: (file: GeneralTreeFile) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<GeneralTreeFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    setFiles(null)
    setError(null)
    void (async () => {
      try {
        const repo = await getRepo(projectId)
        const tree = repo ? await listTree(repo.id) : []
        if (live) setFiles(shownFiles(tree).shown)
      } catch (err) {
        if (live) setError(authErrorMessage(err, 'Could not load the project files. Try again.'))
      }
    })()
    return () => {
      live = false
    }
  }, [open, projectId])

  const q = query.trim().toLowerCase()
  const shown = (files ?? []).filter((f) => (q ? f.path.toLowerCase().includes(q) : true))

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="mt-2" onClick={() => setOpen(true)}>
        <Icon name="folder" size={14} />
        From project files
      </Button>
    )
  }

  return (
    <div className="mt-2 w-full rounded-lg border border-line">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Icon name="folder" size={14} className="shrink-0 text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a file in this project"
          aria-label="Find a file in this project"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close project files"
          className="grid h-7 w-7 place-items-center rounded-lg text-faint hover:text-ink"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      {error ? (
        <p className="px-3 py-3 text-[13px] text-red-600 dark:text-red-400">{error}</p>
      ) : files === null ? (
        <p className="flex items-center gap-2 px-3 py-3 text-[13px] text-muted">
          <Spinner size={14} /> Loading project files…
        </p>
      ) : files.length === 0 ? (
        <p className="px-3 py-3 text-[13px] text-faint">This project has no files yet. Add them on the Files tab.</p>
      ) : shown.length === 0 ? (
        <p className="px-3 py-3 text-[13px] text-faint">No file matches that.</p>
      ) : (
        <ul className="max-h-56 overflow-y-auto py-1">
          {shown.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setBusy(f.path)
                  void onPick(f)
                    .then(() => setOpen(false))
                    .finally(() => setBusy(null))
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-[var(--surface-sunken)] disabled:opacity-60"
              >
                {busy === f.path ? <Spinner size={13} /> : <Icon name="file" size={13} className="shrink-0 text-faint" />}
                <span className="min-w-0 flex-1 truncate">{f.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
