import { useState } from 'react'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { FileDrop } from '../../ui/FileDrop'
import { Icon, Spinner } from '../../ui/Icon'
import { useToast } from '../../ui/Toast'
import { FilePreview } from './FilePreview'
import { deleteTaskFile, uploadTaskFile } from '../../../lib/api/taskDetail'
import { authErrorMessage } from '../../../lib/authError'
import { canChangeFiles } from '../../../lib/types'
import type { TaskDetail, TaskFile } from '../../../lib/types'

/**
 * The work itself. Only the people on the task attach, and only while it is
 * unfinished — a done task is a record.
 */
export function TaskFileGrid({
  task,
  files,
  isAssignee,
  /** The project has been closed, so the deliverable is fixed too. */
  locked = false,
  onChanged,
}: {
  task: TaskDetail
  files: TaskFile[]
  isAssignee: boolean
  locked?: boolean
  onChanged: () => Promise<void> | void
}) {
  const { show } = useToast()
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<TaskFile | null>(null)

  const open = canChangeFiles(task, locked)
  const canAttach = isAssignee && open

  return (
    <section className="surface overflow-hidden rounded-card border border-line">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-[var(--surface-sunken)] px-4 py-3.5 sm:px-5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-navy-600 text-amber-300 dark:bg-navy-500">
          <Icon name="folder" size={16} />
        </span>
        <div>
          <h3>
            Files
            {files.length > 0 && (
              <span className="ml-1.5 font-mono text-[12px] text-faint">
                {files.length}
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-[12px] text-muted">Deliverables stay with the task.</p>
        </div>
        {!open && (
          <span className="ml-auto text-[12px] text-faint">
            {locked ? 'Locked — the project is closed' : 'Locked — the task is done'}
          </span>
        )}
      </header>

      <div className="space-y-3 px-4 py-4 sm:px-5">

      {files.length === 0 ? (
        <p className="text-[13px] text-muted">
          {canAttach
            ? 'Nothing attached yet. Put the deliverable here so it sits with the work.'
            : open
              ? 'Nothing attached yet. Whoever is on this task can add the files.'
              : 'Nothing was attached to this task.'}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {files.map((f) => (
            <FilePreview
              key={f.id}
              file={f}
              canRemove={canAttach}
              onRemove={() => setRemoving(f)}
            />
          ))}
        </div>
      )}

      {canAttach && (
        <div className="space-y-2">
          <FileDrop
            file={null}
            compact={files.length > 0}
            maxSize={20}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.png,.jpg,.jpeg,.gif,.txt,.csv"
            hint="PDF, Office, an image, or a zip. Up to 20 MB."
            onPick={async (picked) => {
              if (!picked) return
              setBusy(true)
              try {
                await uploadTaskFile(task.id, picked)
                show('File attached')
                await onChanged()
              } catch (err) {
                show(authErrorMessage(err, 'Could not attach that file.'), 'error')
              } finally {
                setBusy(false)
              }
            }}
          />
          {busy && (
            <p className="flex items-center gap-2 text-[13px] text-muted">
              <Spinner size={14} />
              Uploading…
            </p>
          )}
        </div>
      )}

      {open && !isAssignee && files.length > 0 && (
        <p className="flex items-center gap-2 text-[12px] text-faint">
          <Icon name="info" size={13} />
          Claim this task to add or remove files.
        </p>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await deleteTaskFile(removing)
          show('File removed')
          await onChanged()
        }}
        title={`Remove ${removing?.file_name ?? ''}?`}
        body="It is deleted from the task for everyone. This cannot be undone."
        confirmLabel="Remove file"
      />
      </div>
    </section>
  )
}
