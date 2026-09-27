import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { Icon, Spinner } from '../ui/Icon'
import { authErrorMessage } from '../../lib/authError'
import { shownFiles } from '../../lib/general/files'
import type { GeneralTreeFile } from '../../lib/general/types'

/** Every folder the files sit in, parents included: a/b/c.md gives a and a/b. */
function foldersOf(files: GeneralTreeFile[]) {
  const all = new Set<string>()
  for (const f of files) {
    const parts = f.path.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'))
  }
  return [...all].sort((a, b) => a.localeCompare(b))
}

/**
 * Pick a file or a whole folder from the project's Files (Main) to attach to a
 * task. Opens in place under the task's files rather than as a second dialog.
 * A folder asks once before it attaches everything inside it.
 */
export function ProjectFilePicker({
  loadTree,
  onPick,
}: {
  loadTree: () => Promise<GeneralTreeFile[]>
  /** `fromFolder`: picked as a folder, so the names keep their paths. */
  onPick: (files: GeneralTreeFile[], fromFolder: boolean) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<GeneralTreeFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    setFiles(null)
    setError(null)
    setConfirming(null)
    loadTree()
      .then((tree) => live && setFiles(shownFiles(tree).shown))
      .catch((err) => live && setError(authErrorMessage(err, 'Could not load the project files. Try again.')))
    return () => {
      live = false
    }
  }, [open, loadTree])

  const q = query.trim().toLowerCase()
  const all = files ?? []
  const folders = foldersOf(all).filter((f) => (q ? f.toLowerCase().includes(q) : true))
  const shown = all.filter((f) => (q ? f.path.toLowerCase().includes(q) : true))
  const inside = (folder: string) => all.filter((f) => f.path.startsWith(folder + '/'))

  function pick(key: string, picked: GeneralTreeFile[], fromFolder: boolean) {
    setBusy(key)
    void onPick(picked, fromFolder)
      .then(() => setOpen(false))
      .finally(() => {
        setBusy(null)
        setConfirming(null)
      })
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Icon name="folder" size={14} />
        From project files
      </Button>
    )
  }

  const row =
    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-[var(--surface-sunken)] disabled:opacity-60'

  return (
    <div className="w-full rounded-lg border border-line">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Icon name="folder" size={14} className="shrink-0 text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a file or folder in this project"
          aria-label="Find a file or folder in this project"
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
      ) : folders.length + shown.length === 0 ? (
        <p className="px-3 py-3 text-[13px] text-faint">Nothing matches that.</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto py-1">
          {folders.map((folder) => {
            const count = inside(folder).length
            const key = `folder:${folder}`
            return (
              <li key={key} className="flex items-center gap-2 pr-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setConfirming(confirming === key ? null : key)}
                  aria-expanded={confirming === key}
                  className={row}
                >
                  {busy === key ? <Spinner size={13} /> : <Icon name="folder" size={13} className="shrink-0 text-faint" />}
                  <span className="min-w-0 flex-1 truncate">{folder}/</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">{count}</span>
                </button>
                {confirming === key && (
                  <Button size="sm" disabled={busy !== null} onClick={() => pick(key, inside(folder), true)}>
                    Attach {count} {count === 1 ? 'file' : 'files'}
                  </Button>
                )}
              </li>
            )
          })}
          {shown.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => pick(f.id, [f], false)}
                className={row}
              >
                {busy === f.id ? <Spinner size={13} /> : <Icon name="file" size={13} className="shrink-0 text-faint" />}
                <span className="min-w-0 flex-1 truncate">{f.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
