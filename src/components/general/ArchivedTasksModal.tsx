import { useState } from 'react'
import { archiveTask, deleteArchivedTask } from '../../lib/api/general'
import { archiveClassTask, deleteArchivedClassTask } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'

/** One archived task, class or work, as the modal lists it. */
export type ArchivedTaskItem = {
  kind: 'class' | 'work'
  id: string
  title: string
  /** "QM · Capstone · Group 3", or a work project's name. */
  where: string
  archived_at: string | null
}

function archivedOn(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}

/**
 * The tasks the reader archived — class tasks they added to a board and work
 * tasks alike — each restorable or deletable where it stands.
 *
 * Deleting asks again inside its own row rather than in a second dialog over
 * this one. Whether either action is allowed is the database's call — it
 * refuses with a sentence, and that sentence is what the person sees.
 */
export function ArchivedTasksModal({
  open,
  onClose,
  tasks,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  /** Null while loading. */
  tasks: ArchivedTaskItem[] | null
  onChanged: () => Promise<void>
}) {
  const { show } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  async function run(id: string, action: () => Promise<void>, done: string, failed: string) {
    setBusy(id)
    try {
      await action()
      show(done)
      setConfirming(null)
      await onChanged()
    } catch (err) {
      show(authErrorMessage(err, failed), 'error')
    } finally {
      setBusy(null)
    }
  }

  const restore = (t: ArchivedTaskItem) =>
    t.kind === 'class' ? archiveClassTask(t.id, false) : archiveTask(t.id, false)
  const remove = (t: ArchivedTaskItem) =>
    t.kind === 'class' ? deleteArchivedClassTask(t.id) : deleteArchivedTask(t.id)

  return (
    <Modal
      open={open}
      onClose={() => {
        setConfirming(null)
        onClose()
      }}
      title="Archived tasks"
      description="Tasks you archived, from your class projects and your work. Restoring one puts it back where it was."
      size="lg"
    >
      {tasks === null ? (
        <div className="flex items-center gap-3 py-8 text-[14px] text-muted">
          <Spinner size={16} />
          Loading archived tasks…
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState icon="archive" title="Nothing archived" body="Tasks you archive show up here." />
      ) : (
        <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-line">
          {tasks.map((t) => {
            const key = `${t.kind}:${t.id}`
            return (
              <li key={key} className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-[var(--surface)] px-4 py-3">
                <div className="min-w-[12rem] flex-1">
                  <p className="line-clamp-2 text-[14px] font-medium text-ink">{t.title}</p>
                  <p className="mt-0.5 truncate text-[12px] text-muted">
                    <span className="mr-1.5 rounded surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-faint">
                      {t.kind === 'class' ? 'Class' : 'Work'}
                    </span>
                    {t.where} · Archived {archivedOn(t.archived_at)}
                  </p>
                </div>
                {confirming === key ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] text-danger-600 dark:text-danger-400">Delete for good?</span>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={busy === key}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy === key}
                      onClick={() => void run(key, () => remove(t), 'Task deleted', 'Could not delete that task.')}
                    >
                      Delete
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busy === key}
                      onClick={() => void run(key, () => restore(t), 'Task restored', 'Could not restore that task.')}
                    >
                      <Icon name="refresh" size={14} />
                      Restore
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => setConfirming(key)}
                      aria-label={`Delete ${t.title}`}
                    >
                      <Icon name="trash" size={14} />
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
