import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon, Spinner } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../context/AuthContext'
import {
  archiveTask,
  archiveTaskFile,
  generalFileUrl,
  listArchivedTaskFiles,
  listArchivedTasks,
  listRemovedRepoPaths,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import { TASK_STATUSES } from '../../lib/general/progress'
import type { ArchivedGeneralFile, GeneralTask, RemovedGeneralRepoPath } from '../../lib/general/types'
import { formatBytes } from '../../components/ui/FileDrop'
import { useGeneralProject } from '../../components/general/useGeneralProject'

export default function ProjectArchive() {
  const { projectId } = useParams<{ projectId: string }>()
  const { profile } = useAuth()
  const { show } = useToast()
  const state = useGeneralProject(projectId, profile?.id)
  const [tasks, setTasks] = useState<GeneralTask[] | null>(null)
  const [files, setFiles] = useState<ArchivedGeneralFile[] | null>(null)
  const [repoPaths, setRepoPaths] = useState<RemovedGeneralRepoPath[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const [archivedTasks, archivedFiles, removedPaths] = await Promise.all([
        listArchivedTasks(projectId),
        listArchivedTaskFiles(projectId),
        listRemovedRepoPaths(projectId),
      ])
      setTasks(archivedTasks)
      setFiles(archivedFiles)
      setRepoPaths(removedPaths)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the project archive.'))
      setTasks([])
      setFiles([])
      setRepoPaths([])
    }
  }, [projectId])

  useEffect(() => {
    document.title = state.project ? `Archive · ${state.project.name} · Collabify` : 'Project archive · Collabify'
  }, [state.project])

  useEffect(() => {
    void load()
  }, [load])

  const empty = useMemo(
    () => tasks?.length === 0 && files?.length === 0 && repoPaths?.length === 0,
    [files, repoPaths, tasks],
  )
  const loading = state.loading || tasks === null || files === null || repoPaths === null
  const canRestoreTasks = state.can('manage_tasks') && !state.archived
  const canRestoreFiles = state.can('edit_files') && !state.archived

  async function run(id: string, action: () => Promise<void>, success: string, failure: string) {
    setBusy(id)
    try {
      await action()
      show(success)
      await Promise.all([load(), state.reload()])
    } catch (err) {
      show(authErrorMessage(err, failure), 'error')
    } finally {
      setBusy(null)
    }
  }

  if (!projectId) return null

  return (
    <div className="w-full space-y-6">
      <Link
        to={`/general/projects/${projectId}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <Icon name="arrowLeft" size={14} />
        Back to project
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{state.project?.name ?? 'Project'}</p>
          <h1 className="mt-1 font-display">Project archive</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            Archived tasks and task files stay out of active work without being deleted. Removed repository paths are shown here from file history.
          </p>
        </div>
      </header>

      {(error || state.error) && <Alert tone="error">{error ?? state.error}</Alert>}

      {loading ? (
        <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
          <Spinner size={16} />
          Loading archive…
        </div>
      ) : empty ? (
        <EmptyState
          icon="archive"
          title="Nothing archived"
          body="Archived tasks, task files, and removed file paths will appear here."
        />
      ) : (
        <div className="space-y-5">
          <ArchiveSection title="Archived tasks" count={tasks.length}>
            {tasks.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-faint">No archived tasks.</p>
            ) : (
              <ul className="divide-y divide-line">
                {tasks.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
                    <div className="min-w-[14rem] flex-1">
                      <p className="font-medium text-ink">{task.title}</p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {TASK_STATUSES.find((s) => s.value === task.status)?.label ?? task.status}
                        {task.due_at ? ` · Due ${formatDue(task.due_at)}` : ''}
                        {task.archived_at ? ` · Archived ${formatDue(task.archived_at)}` : ''}
                      </p>
                    </div>
                    {canRestoreTasks && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busy === task.id}
                        onClick={() =>
                          void run(
                            task.id,
                            () => archiveTask(task.id, false),
                            'Task restored',
                            'Could not restore that task.',
                          )
                        }
                      >
                        Restore
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </ArchiveSection>

          <ArchiveSection title="Archived task files" count={files.length}>
            {files.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-faint">No archived task files.</p>
            ) : (
              <ul className="divide-y divide-line">
                {files.map((file) => (
                  <li key={file.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
                    <div className="min-w-[14rem] flex-1">
                      <button
                        type="button"
                        className="font-medium text-ink hover:underline"
                        onClick={() =>
                          void generalFileUrl(file.file_path)
                            .then((url) => window.open(url, '_blank', 'noopener'))
                            .catch((err) => show(authErrorMessage(err, 'Could not open that file.'), 'error'))
                        }
                      >
                        {file.file_name}
                      </button>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {file.task_title} · {formatBytes(Number(file.size_bytes))}
                        {file.archived_at ? ` · Archived ${formatDue(file.archived_at)}` : ''}
                      </p>
                    </div>
                    {canRestoreFiles && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busy === file.id}
                        onClick={() =>
                          void run(
                            file.id,
                            () => archiveTaskFile(file.id, false),
                            'File restored',
                            'Could not restore that file.',
                          )
                        }
                      >
                        Restore
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </ArchiveSection>

          <ArchiveSection title="Removed project file paths" count={repoPaths.length}>
            {repoPaths.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-faint">No removed project file paths.</p>
            ) : (
              <ul className="divide-y divide-line">
                {repoPaths.map((path) => (
                  <li key={`${path.repo_id}:${path.path}`} className="px-4 py-3.5 sm:px-5">
                    <p className="font-medium text-ink">{path.path}</p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {path.repo_name} · {path.kind} · Removed {formatDue(path.removed_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </ArchiveSection>
        </div>
      )}
    </div>
  )
}

function ArchiveSection({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-panel border border-line surface">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-[var(--surface-sunken)] px-4 py-3 sm:px-5">
        <h2>{title}</h2>
        <span className="rounded-full surface px-2.5 py-1 font-mono text-[12px] text-muted">{count}</span>
      </header>
      {children}
    </section>
  )
}
