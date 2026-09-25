import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ActionMenu } from '../../components/ui/ActionMenu'
import { Alert } from '../../components/ui/Alert'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Field'
import { Icon, Spinner } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../context/AuthContext'
import {
  archiveTask,
  archiveTaskFile,
  archiveDraftPath,
  deleteArchivedDraftFiles,
  deleteArchivedDraftPath,
  deleteArchivedTask,
  deleteArchivedTaskFile,
  deleteArchivedTaskFiles,
  deleteArchivedTasks,
  generalFileUrl,
  getRepo,
  listArchivedDraftFiles,
  listArchivedTaskFiles,
  listArchivedTasks,
  listRemovedRepoPaths,
  restoreArchivedDraftFiles,
  restoreArchivedTaskFiles,
  restoreArchivedTasks,
} from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { formatDue } from '../../lib/general/dates'
import { buildTree } from '../../lib/general/files'
import type { TreeNode } from '../../lib/general/files'
import { TASK_STATUSES } from '../../lib/general/progress'
import type { ArchivedDraftFile, ArchivedGeneralFile, GeneralDraftFile, GeneralTask, RemovedGeneralRepoPath } from '../../lib/general/types'
import { formatBytes } from '../../components/ui/FileDrop'
import { useGeneralProject } from '../../components/general/useGeneralProject'

export default function ProjectArchive() {
  const { projectId } = useParams<{ projectId: string }>()
  const { profile } = useAuth()
  const { show } = useToast()
  const state = useGeneralProject(projectId, profile?.id)
  const [tasks, setTasks] = useState<GeneralTask[] | null>(null)
  const [files, setFiles] = useState<ArchivedGeneralFile[] | null>(null)
  const [draftFiles, setDraftFiles] = useState<ArchivedDraftFile[] | null>(null)
  const [repoPaths, setRepoPaths] = useState<RemovedGeneralRepoPath[] | null>(null)
  const [repoId, setRepoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [confirm, setConfirm] = useState<{
    title: string
    body: ReactNode
    label: string
    action: () => Promise<void>
  } | null>(null)

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const repo = await getRepo(projectId)
      setRepoId(repo?.id ?? null)
      const [archivedTasks, archivedFiles, archivedDraftFiles, removedPaths] = await Promise.all([
        listArchivedTasks(projectId),
        listArchivedTaskFiles(projectId),
        repo ? listArchivedDraftFiles(repo.id) : Promise.resolve([]),
        listRemovedRepoPaths(projectId),
      ])
      setTasks(archivedTasks)
      setFiles(archivedFiles)
      setDraftFiles(archivedDraftFiles)
      setRepoPaths(removedPaths)
      setError(null)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load the project archive.'))
      setTasks([])
      setFiles([])
      setDraftFiles([])
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
    () => tasks?.length === 0 && files?.length === 0 && draftFiles?.length === 0 && repoPaths?.length === 0,
    [draftFiles, files, repoPaths, tasks],
  )
  const loading = state.loading || tasks === null || files === null || draftFiles === null || repoPaths === null
  const canActInArchive = !state.archived
  const q = query.trim().toLowerCase()
  const archivedTasks = q
    ? tasks?.filter((task) => `${task.title} ${task.status}`.toLowerCase().includes(q)) ?? []
    : tasks ?? []
  const archivedFiles = q
    ? files?.filter((file) => `${file.file_name} ${file.task_title}`.toLowerCase().includes(q)) ?? []
    : files ?? []
  const archivedDraftFiles = q
    ? draftFiles?.filter((file) => `${file.path} ${file.kind} ${file.action}`.toLowerCase().includes(q)) ?? []
    : draftFiles ?? []
  const removedPaths = q
    ? repoPaths?.filter((path) => `${path.path} ${path.repo_name} ${path.kind}`.toLowerCase().includes(q)) ?? []
    : repoPaths ?? []

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

      <DirectoryHero
        title="Project"
        accent="archive."
        description="Archived tasks, draft files, folders and removed paths stay recoverable until you choose to delete them."
        stats={[]}
      />

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
          <Input
            icon="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search archive"
            className="max-w-md"
          />

          <ArchiveSection
            title="Archived tasks"
            count={archivedTasks.length}
            actions={
              canActInArchive && tasks.length > 0 ? (
                <SectionActions
                  label="Actions for all archived tasks"
                  onRestore={() =>
                    void run('tasks:restore', () => restoreArchivedTasks(projectId), 'Tasks restored', 'Could not restore tasks.')
                  }
                  onDelete={() =>
                    setConfirm({
                      title: 'Delete all archived tasks?',
                      body: 'This permanently deletes every archived task in this project.',
                      label: 'Delete tasks',
                      action: () => deleteArchivedTasks(projectId),
                    })
                  }
                />
              ) : null
            }
          >
            {archivedTasks.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-faint">No archived tasks.</p>
            ) : (
              <ul className="divide-y divide-line">
                {archivedTasks.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
                    <div className="min-w-[14rem] flex-1">
                      <p className="font-medium text-ink">{task.title}</p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {TASK_STATUSES.find((s) => s.value === task.status)?.label ?? task.status}
                        {task.due_at ? ` · Due ${formatDue(task.due_at)}` : ''}
                        {task.archived_at ? ` · Archived ${formatDue(task.archived_at)}` : ''}
                      </p>
                    </div>
                    {canActInArchive && (
                      <ActionMenu
                        label={`Actions for ${task.title}`}
                        disabled={busy === task.id}
                        items={[
                          { label: 'Restore', icon: 'refresh', onSelect: () => void run(task.id, () => archiveTask(task.id, false), 'Task restored', 'Could not restore that task.') },
                          {
                            label: 'Delete permanently',
                            icon: 'trash',
                            tone: 'danger',
                            separated: true,
                            onSelect: () =>
                              setConfirm({ title: 'Delete this task?', body: 'This permanently deletes this archived task.', label: 'Delete', action: () => deleteArchivedTask(task.id) }),
                          },
                        ]}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </ArchiveSection>

          <ArchiveSection
            title="Archived task files"
            count={archivedFiles.length}
            actions={
              canActInArchive && files.length > 0 ? (
                <SectionActions
                  label="Actions for all archived task files"
                  onRestore={() =>
                    void run('task-files:restore', () => restoreArchivedTaskFiles(projectId), 'Task files restored', 'Could not restore task files.')
                  }
                  onDelete={() =>
                    setConfirm({
                      title: 'Delete all archived task files?',
                      body: 'This permanently deletes every archived task file in this project.',
                      label: 'Delete files',
                      action: () => deleteArchivedTaskFiles(projectId, files),
                    })
                  }
                />
              ) : null
            }
          >
            {archivedFiles.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-faint">No archived task files.</p>
            ) : (
              <ul className="divide-y divide-line">
                {archivedFiles.map((file) => (
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
                    {canActInArchive && (
                      <ActionMenu
                        label={`Actions for ${file.file_name}`}
                        disabled={busy === file.id}
                        items={[
                          { label: 'Restore', icon: 'refresh', onSelect: () => void run(file.id, () => archiveTaskFile(file.id, false), 'File restored', 'Could not restore that file.') },
                          {
                            label: 'Delete permanently',
                            icon: 'trash',
                            tone: 'danger',
                            separated: true,
                            onSelect: () =>
                              setConfirm({ title: 'Delete this task file?', body: 'This permanently deletes this archived task file.', label: 'Delete', action: () => deleteArchivedTaskFile(file) }),
                          },
                        ]}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </ArchiveSection>

          <ArchiveSection
            title="Archived draft files"
            count={archivedDraftFiles.length}
            actions={
              canActInArchive && repoId && draftFiles.length > 0 ? (
                <SectionActions
                  label="Actions for all archived draft files"
                  onRestore={() =>
                    void run('draft-files:restore', () => restoreArchivedDraftFiles(repoId), 'Draft files restored', 'Could not restore draft files.')
                  }
                  onDelete={() =>
                    setConfirm({
                      title: 'Delete all archived draft files?',
                      body: 'This permanently deletes every archived draft file in this project.',
                      label: 'Delete files',
                      action: () => deleteArchivedDraftFiles(repoId),
                    })
                  }
                />
              ) : null
            }
          >
            {archivedDraftFiles.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-faint">No archived draft files.</p>
            ) : (
              <div className="divide-y divide-line">
                {[...new Set(archivedDraftFiles.map((f) => f.owner_id))]
                  .sort((a, b) => (a === profile?.id ? -1 : b === profile?.id ? 1 : 0))
                  .map((ownerId) => {
                    const yours = ownerId === profile?.id
                    const rows = archivedDraftFiles.filter((f) => f.owner_id === ownerId)
                    return (
                      <div key={ownerId}>
                        {!yours && (
                          <p className="bg-[var(--surface-sunken)] px-4 py-2 text-[12px] font-medium text-muted sm:px-5">
                            From {state.nameOf(ownerId)}'s draft
                          </p>
                        )}
                        <ul className="divide-y divide-line">
                          {buildTree(rows as unknown as Parameters<typeof buildTree>[0]).map((node) => (
                            <DraftArchiveNode
                              key={node.path}
                              node={node}
                              depth={0}
                              canEdit={canActInArchive && Boolean(repoId)}
                              canRestore={yours}
                              busy={busy}
                              restore={(path) =>
                                repoId
                                  ? run(`draft:${path}:restore`, () => archiveDraftPath(repoId, path, false), 'Draft restored', 'Could not restore it.')
                                  : Promise.resolve()
                              }
                              remove={(path) =>
                                setConfirm({
                                  title: 'Delete this archived draft item?',
                                  body: 'This permanently deletes this archived draft file or folder.',
                                  label: 'Delete',
                                  action: () => (repoId ? deleteArchivedDraftPath(repoId, path, yours ? undefined : ownerId) : Promise.resolve()),
                                })
                              }
                            />
                          ))}
                        </ul>
                      </div>
                    )
                  })}
              </div>
            )}
          </ArchiveSection>

          <ArchiveSection title="Removed project file paths" count={removedPaths.length}>
            {removedPaths.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-faint">No removed project file paths.</p>
            ) : (
              <ul className="divide-y divide-line">
                {removedPaths.map((path) => (
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

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return
          await confirm.action()
          show('Deleted')
          await Promise.all([load(), state.reload()])
        }}
        title={confirm?.title ?? 'Delete?'}
        body={confirm?.body ?? ''}
        confirmLabel={confirm?.label ?? 'Delete'}
      />
    </div>
  )
}

function ArchiveSection({
  title,
  count,
  actions,
  children,
}: {
  title: string
  count: number
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-panel border border-line surface">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-[var(--surface-sunken)] px-4 py-3 sm:px-5">
        <h2>{title}</h2>
        <div className="flex items-center gap-2">
          {actions}
          <span className="rounded-full surface px-2.5 py-1 font-mono text-[12px] text-muted">{count}</span>
        </div>
      </header>
      {children}
    </section>
  )
}

function SectionActions({ label, onRestore, onDelete }: { label: string; onRestore: () => void; onDelete: () => void }) {
  return (
    <ActionMenu
      label={label}
      items={[
        { label: 'Restore all', icon: 'refresh', onSelect: onRestore },
        { label: 'Delete all permanently', icon: 'trash', tone: 'danger', separated: true, onSelect: onDelete },
      ]}
    />
  )
}

function DraftArchiveNode({
  node,
  depth,
  canEdit,
  canRestore,
  busy,
  restore,
  remove,
}: {
  node: TreeNode
  depth: number
  canEdit: boolean
  canRestore: boolean
  busy: string | null
  restore: (path: string) => Promise<void>
  remove: (path: string) => void
}) {
  const [open, setOpen] = useState(depth === 0)
  const f = node.type === 'file' ? (node.file as unknown as GeneralDraftFile) : null

  return (
    <li>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5" style={{ paddingLeft: `${depth * 1.25 + 1}rem` }}>
        {node.type === 'folder' ? (
          <button type="button" className="flex min-w-[14rem] flex-1 items-center gap-2 text-left" onClick={() => setOpen(!open)}>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="text-faint" />
            <Icon name="folder" size={15} className="text-faint" />
            <span className="font-medium text-ink">{node.path}</span>
            <span className="font-mono text-[11px] text-faint">{node.fileCount}</span>
          </button>
        ) : (
          <div className="min-w-[14rem] flex-1">
            <p className="font-medium text-ink">{f?.path}</p>
            <p className="mt-0.5 text-[12px] text-muted">
              {f?.kind} · {f?.action}
              {f?.archived_at ? ` · Archived ${formatDue(f.archived_at)}` : ''}
            </p>
          </div>
        )}
        {canEdit && (
          <ActionMenu
            label={`Actions for ${node.name}`}
            disabled={busy === `draft:${node.path}:restore`}
            items={[
              canRestore && { label: 'Restore', icon: 'refresh', onSelect: () => void restore(node.path) },
              { label: 'Delete permanently', icon: 'trash', tone: 'danger', separated: true, onSelect: () => remove(node.path) },
            ]}
          />
        )}
      </div>
      {node.type === 'folder' && open && (
        <ul>
          {node.children.map((child) => (
            <DraftArchiveNode
              key={child.path}
              node={child}
              depth={depth + 1}
              canEdit={canEdit}
              canRestore={canRestore}
              busy={busy}
              restore={restore}
              remove={remove}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
