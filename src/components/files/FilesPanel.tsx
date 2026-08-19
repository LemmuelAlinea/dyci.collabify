import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert } from '../ui/Field'
import { Icon, Spinner } from '../ui/Icon'
import { Select } from '../ui/Select'
import { EmptyState } from '../ui/Tabs'
import { useToast } from '../ui/Toast'
import { fileUrl, listFiles } from '../../lib/api/files'
import { authErrorMessage } from '../../lib/authError'
import { FILE_SOURCES, fileOwnerName, formatBytes } from '../../lib/types'
import type { FileRow, FileSource } from '../../lib/types'

const ICON: Record<FileSource, 'file' | 'kanban' | 'calendar' | 'chart'> = {
  task: 'file',
  project: 'kanban',
  syllabus: 'calendar',
  curriculum: 'chart',
}

function when(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Files under one scope, sectioned the way a professor looks for them: course
 * material for the class first, then the work itself split by whoever handed it
 * up — the group on a group project, the student on an individual one.
 *
 * The same panel serves the standalone page and the class, project and group
 * pages; only the scope changes. Nothing here knows about roles, because the
 * view it reads decides that already.
 */
export function FilesPanel({
  scope,
  /** Group the work by project as well, which the class-wide views want. */
  showProject = true,
  /** Repeated on a page that already says which class this is. */
  showClass = false,
}: {
  scope: { classId?: string; projectId?: string; groupId?: string; boardId?: string }
  showProject?: boolean
  showClass?: boolean
}) {
  const { show } = useToast()
  const [rows, setRows] = useState<FileRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState('')
  const [query, setQuery] = useState('')

  const { classId, projectId, groupId, boardId } = scope

  const load = useCallback(async () => {
    try {
      setRows(await listFiles({ classId, projectId, groupId, boardId }))
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the files.'))
      setRows([])
    }
  }, [classId, projectId, groupId, boardId])

  useEffect(() => {
    void load()
  }, [load])

  async function open(f: FileRow) {
    try {
      window.open(await fileUrl(f.bucket, f.file_path), '_blank', 'noopener')
    } catch (err) {
      show(authErrorMessage(err, 'Could not open that file.'), 'error')
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? [])
      .filter((f) => (kind ? f.source === kind : true))
      .filter((f) =>
        q
          ? `${f.file_name} ${f.project_title ?? ''} ${fileOwnerName(f) ?? ''}`
              .toLowerCase()
              .includes(q)
          : true,
      )
  }, [rows, kind, query])

  // Course material sits above the work; it is what the work was set from.
  const material = shown.filter((f) => f.source !== 'task')
  const work = shown.filter((f) => f.source === 'task')

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; project: string | null; files: FileRow[] }>()
    for (const f of work) {
      const owner = fileOwnerName(f) ?? 'Unassigned board'
      const key = `${f.project_id ?? ''}:${f.board_id ?? owner}`
      const entry = map.get(key)
      if (entry) entry.files.push(f)
      else map.set(key, { label: owner, project: f.project_title, files: [f] })
    }
    return [...map.values()].sort(
      (a, b) => (a.project ?? '').localeCompare(b.project ?? '') || a.label.localeCompare(b.label),
    )
  }, [work])

  if (rows === null) {
    return (
      <div className="flex items-center gap-2.5 py-8 text-[14px] text-muted">
        <Spinner size={16} />
        Loading files…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="error">{error}</Alert>}

      {(rows.length > 4 || kind) && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Icon
              name="search"
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a file"
              className="h-9 w-[200px] rounded-lg border border-[var(--line)] bg-[var(--surface)] pr-3 pl-8 text-[13px] text-ink placeholder:text-[var(--ink-faint)] hover:border-[var(--line-strong)] focus:border-navy-400 focus:outline-none"
            />
          </div>
          <Select
            aria-label="Filter by kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            placeholder="Everything"
            options={FILE_SOURCES}
            className="!h-9 !w-[170px] !text-[13px]"
          />
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState
          icon="folder"
          title="Nothing here yet"
          body="Files attached to tasks show up here, along with the syllabus and curriculum the class is built on."
        />
      ) : (
        <div className="space-y-6">
          {material.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[15px] font-semibold text-ink">Course material</h3>
              <ul className="space-y-1.5">
                {material.map((f) => (
                  <FileLine key={`${f.source}:${f.id}`} file={f} onOpen={open} showClass={showClass} />
                ))}
              </ul>
            </section>
          )}

          {groups.map((g) => (
            <section key={`${g.project}:${g.label}`} className="space-y-2">
              <h3 className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold text-ink">
                {g.label}
                {showProject && g.project && (
                  <span className="text-[12.5px] font-normal text-muted">{g.project}</span>
                )}
                <span className="font-mono text-[12px] font-normal text-faint">
                  {g.files.length}
                </span>
              </h3>
              <ul className="space-y-1.5">
                {g.files.map((f) => (
                  <FileLine key={`${f.source}:${f.id}`} file={f} onOpen={open} showClass={showClass} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function FileLine({
  file,
  onOpen,
  showClass,
}: {
  file: FileRow
  onOpen: (f: FileRow) => void
  showClass: boolean
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(file)}
        className="surface flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line px-3.5 py-2.5 text-left transition-colors hover:border-line-strong"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg surface-sunken text-muted">
          <Icon name={ICON[file.source]} size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] text-ink">{file.file_name}</span>
          <span className="block truncate text-[12px] text-faint">
            {showClass && `${file.class_initial} · `}
            {file.task_title ? file.task_title : file.project_title ?? file.class_name}
            {file.uploaded_by_name ? ` · ${file.uploaded_by_name}` : ''}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[11.5px] text-faint">
          {formatBytes(file.size_bytes)}
        </span>
        <span className="shrink-0 font-mono text-[11.5px] text-faint">
          {when(file.uploaded_at)}
        </span>
        <Icon name="download" size={15} className="shrink-0 text-faint" />
      </button>
    </li>
  )
}
