import { useState } from 'react'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Input } from '../ui/Field'
import { commitFiles } from '../../lib/api/general'
import { fileName } from '../../lib/general/files'
import type { GeneralRepoSummary, GeneralTreeFile } from '../../lib/general/types'

/**
 * Deletes one file from Main as its own commit, after the person types the
 * file's name — the same check as committing a draft file straight to Main.
 * History keeps every earlier version, so the file can be brought back.
 */
export function DeleteMainFileDialog({
  repo,
  file,
  editing,
  onClose,
  onDeleted,
}: {
  repo: GeneralRepoSummary
  file: GeneralTreeFile | null
  /** Who else pulled it to edit in Word or Excel, if anyone. */
  editing: string | null
  onClose: () => void
  onDeleted: () => Promise<void>
}) {
  const [typed, setTyped] = useState('')
  const name = file ? fileName(file.path) : ''

  function close() {
    setTyped('')
    onClose()
  }

  return (
    <ConfirmDialog
      open={file !== null}
      onClose={close}
      onConfirm={async () => {
        if (!file) return
        await commitFiles({
          repoId: repo.id,
          message: `Deleted ${file.path}`,
          baseSeq: repo.commit_count,
          files: [
            {
              path: file.path,
              action: 'removed',
              kind: file.kind,
              content: '',
              storage_path: file.kind === 'binary' ? file.storage_path : null,
            },
          ],
        })
        setTyped('')
        await onDeleted()
      }}
      title={`Delete ${name} from Main?`}
      body={
        <div className="space-y-3">
          <p>
            <span className="font-mono">{file?.path}</span> leaves Main in a new commit, for everyone on the
            project. History keeps every earlier version, so it can be brought back.
          </p>
          {editing && <p className="text-warning-700 dark:text-warning-300">{editing}. Tell them before you delete it.</p>}
          <label htmlFor="delete-main-file-name" className="block text-[13px] text-ink">
            Type <span className="font-mono font-medium">{name}</span> to confirm
          </label>
          <Input id="delete-main-file-name" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
      }
      confirmLabel="Delete file"
      tone="danger"
      blocked={typed.trim() !== name}
    />
  )
}
