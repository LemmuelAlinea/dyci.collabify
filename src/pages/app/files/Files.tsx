import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FilesPanel } from '../../../components/files/FilesPanel'
import { Alert } from '../../../components/ui/Field'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { EmptyState } from '../../../components/ui/Tabs'
import { useAuth } from '../../../context/AuthContext'
import { listFiles } from '../../../lib/api/files'
import { authErrorMessage } from '../../../lib/authError'
import { formatBytes } from '../../../lib/types'
import type { FileRow } from '../../../lib/types'

/**
 * Everything, by class.
 *
 * A class is the outer section because that is how a professor thinks about
 * their term; inside it the panel splits the work by whoever handed it up. The
 * same files stay reachable from the class, project and group pages — this is
 * the view for when you do not already know where to look.
 */
export default function Files() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<FileRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await listFiles())
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the files.'))
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const classes = useMemo(() => {
    const map = new Map<
      string,
      { id: string; initial: string; name: string; count: number; bytes: number }
    >()
    for (const f of rows ?? []) {
      const entry = map.get(f.class_id)
      if (entry) {
        entry.count += 1
        entry.bytes += f.size_bytes ?? 0
      } else {
        map.set(f.class_id, {
          id: f.class_id,
          initial: f.class_initial,
          name: f.class_name,
          count: 1,
          bytes: f.size_bytes ?? 0,
        })
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  const base = profile?.role === 'professor' ? '/professor' : '/student'

  if (rows === null) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading files…
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">{profile?.role === 'professor' ? 'Teaching' : 'Workspace'}</p>
        <h1 className="mt-1 text-[30px] leading-tight">Files</h1>
        <p className="mt-2 max-w-[64ch] text-[14.5px] text-muted">
          Everything attached to the work, with the syllabus and curriculum each class is
          built on. Nothing here is a second copy — these are the same files, gathered.
        </p>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      {classes.length === 0 ? (
        <EmptyState
          icon="folder"
          title="No files yet"
          body="Files attached to tasks appear here, along with the syllabus and curriculum of each class."
        />
      ) : (
        classes.map((c) => (
          <section key={c.id} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-2">
              <h2 className="text-[18px]">
                <Link to={`${base}/classes/${c.id}`} className="hover:underline">
                  {c.initial} · {c.name}
                </Link>
              </h2>
              <p className="flex items-center gap-3 font-mono text-[12px] text-faint">
                <span>
                  {c.count} {c.count === 1 ? 'file' : 'files'}
                </span>
                <span className="flex items-center gap-1">
                  <Icon name="folder" size={12} />
                  {formatBytes(c.bytes)}
                </span>
              </p>
            </div>
            <FilesPanel scope={{ classId: c.id }} />
          </section>
        ))
      )}
    </div>
  )
}
