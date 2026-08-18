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
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-ink">
          Files
          {files.length > 0 && (
            <span className="ml-1.5 font-mono text-[12px] text-faint">{files.length}</span>
          )}
        </h3>
        {!open && (
          <span className="text-[12px] text-faint">
            {locked ? 'Locked — the project is closed' : 'Locked — the task is done'}
          </span>
        )}
      </div>

      {files.length === 0 ? (
        <p className="text-[13.5px] text-muted">
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
        <p className="flex items-center gap-1.5 text-[12px] text-faint">
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
    </section>
  )
}
