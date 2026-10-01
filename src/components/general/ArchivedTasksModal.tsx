import { useState } from 'react'
import { archiveTask, deleteArchivedTask } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import type { GeneralTask } from '../../lib/general/types'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Icon, Spinner } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'

function archivedOn(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}

/**
 * Archived work tasks across every live project the reader is on, each one
 * restorable or deletable where it stands.
 *
 * Deleting asks again inside its own row rather than in a second dialog over
 * this one. Whether either action is allowed is the database's call — it
 * refuses with a sentence, and that sentence is what the person sees.
 */
export function ArchivedTasksModal({
  open,
  onClose,
  tasks,
  viewerId,
  projectName,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  /** Null while loading. */
  tasks: GeneralTask[] | null
  viewerId: string | undefined
  projectName: (id: string) => string
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

  return (
    <Modal
      open={open}
      onClose={() => {
        setConfirming(null)
        onClose()
      }}
      title="Archived tasks"
      description="Work tasks you archived, and every archived task on a project you lead. Restoring one puts it back on its project."
      size="lg"
    >
      {tasks === null ? (
        <div className="flex items-center gap-3 py-8 text-[14px] text-muted">
          <Spinner size={16} />
          Loading archived tasks…
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState icon="archive" title="Nothing archived" body="Tasks archived on your projects show up here." />
      ) : (
        <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-line">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-[var(--surface)] px-4 py-3">
              <div className="min-w-[12rem] flex-1">
                <p className="line-clamp-2 text-[14px] font-medium text-ink">{t.title}</p>
                <p className="mt-0.5 truncate text-[12px] text-muted">
                  {projectName(t.project_id)} · Archived {archivedOn(t.archived_at)}
                  {t.archived_by === viewerId ? ' by you' : ''}
                </p>
              </div>
              {confirming === t.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-danger-600 dark:text-danger-400">Delete for good?</span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={busy === t.id}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy === t.id}
                    onClick={() =>
                      void run(t.id, () => deleteArchivedTask(t.id), 'Task deleted', 'Could not delete that task.')
                    }
                  >
                    Delete
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busy === t.id}
                    onClick={() =>
                      void run(t.id, () => archiveTask(t.id, false), 'Task restored', 'Could not restore that task.')
                    }
                  >
                    <Icon name="refresh" size={14} />
                    Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => setConfirming(t.id)}
                    aria-label={`Delete ${t.title}`}
                  >
                    <Icon name="trash" size={14} />
                    Delete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
