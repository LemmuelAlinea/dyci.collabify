import { useCallback, useRef, useState } from 'react'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Icon, Spinner } from '../../ui/Icon'
import { useToast } from '../../ui/Toast'
import { ProjectFilePicker } from '../../general/ProjectFilePicker'
import { ensureClassBoardRepo } from '../../../lib/api/tasks'
import { attachFromRepo, attachSummary, repoTree } from '../../../lib/general/attachFromRepo'
import { deleteTaskFile, taskFileUrl, uploadTaskFile } from '../../../lib/api/taskDetail'
import { authErrorMessage } from '../../../lib/authError'
import { formatBytes } from '../../../lib/formatBytes'
import { canChangeFiles } from '../../../lib/types'
import type { TaskDetail, TaskFile } from '../../../lib/types'

/** The class task-files bucket takes up to this, so the picker refuses more up front. */
const MAX_BYTES = 20 * 1024 * 1024
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.png,.jpg,.jpeg,.gif,.txt,.csv'

/**
 * The work itself, as the work task dialog lists it: a row per file. Only the
 * people on the task attach, and only while it is unfinished — a done task is
 * a record.
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
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<TaskFile | null>(null)

  const open = canChangeFiles(task, locked)
  const canAttach = isAssignee && open
  // The group's Files, opened (and set up the first time) only when asked for.
  const boardId = task.board_id
  const loadRepoTree = useCallback(
    async () => repoTree(await ensureClassBoardRepo(boardId)),
    [boardId],
  )

  async function upload(file: File) {
    if (file.size > MAX_BYTES) {
      show(`${file.name} is ${formatBytes(file.size)}. Files can be up to 20 MB.`, 'error')
      return
    }
    setBusy(true)
    try {
      await uploadTaskFile(task.id, file)
      show('File attached')
      await onChanged()
    } catch (err) {
      show(authErrorMessage(err, 'Could not attach that file.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14px]">Files</h3>
        {!open && (
          <span className="text-[12px] text-faint">
            {locked ? 'Locked, the project is closed' : 'Locked, the task is done'}
          </span>
        )}
      </div>

      <ul className="mt-2 space-y-1.5">
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
            <Icon name="file" size={15} className="shrink-0 text-faint" />
            <button
              type="button"
              onClick={() =>
                void taskFileUrl(f.file_path)
                  .then((url) => window.open(url, '_blank', 'noopener'))
                  .catch((err) => show(authErrorMessage(err, 'Could not open that file.'), 'error'))
              }
              className="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:underline"
            >
              {f.file_name}
            </button>
            <span className="shrink-0 font-mono text-[11px] text-faint">{formatBytes(f.size_bytes)}</span>
            {canAttach && (
              <button
                type="button"
                aria-label={`Remove ${f.file_name}`}
                disabled={busy}
                onClick={() => setRemoving(f)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint hover:text-destructive-600 dark:hover:text-destructive-400"
              >
                <Icon name="trash" size={13} />
              </button>
            )}
          </li>
        ))}
        {files.length === 0 && (
          <li className="text-[13px] text-faint">
            {canAttach
              ? 'No files. Put the deliverable here so it sits with the work.'
              : open
                ? 'No files. Whoever is on this task can add them.'
                : 'No files.'}
          </li>
        )}
      </ul>

      {canAttach && (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void upload(file)
            }}
          />
          <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <Spinner size={14} /> : <Icon name="upload" size={14} />}
            Add a file
          </Button>
          <ProjectFilePicker
            loadTree={loadRepoTree}
            onPick={async (picked, fromFolder) => {
              setBusy(true)
              try {
                const result = await attachFromRepo(
                  picked,
                  fromFolder,
                  (file) => uploadTaskFile(task.id, file),
                  MAX_BYTES,
                )
                const summary = attachSummary(result)
                show(summary.message, summary.tone)
                await onChanged()
              } finally {
                setBusy(false)
              }
            }}
          />
        </div>
      )}

      {open && !isAssignee && files.length > 0 && (
        <p className="mt-2 text-[12px] text-faint">Claim this task to add or remove files.</p>
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
