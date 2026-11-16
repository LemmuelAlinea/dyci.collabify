import { useState } from 'react'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Input } from '../ui/Field'
import { authErrorMessage } from '../../lib/authError'

/**
 * Confirms putting files back as they were: a revert or an undo, straight into
 * Main as a new commit or into the person's own draft. It names the files, any
 * draft copy it would replace, and any file a later commit changed, which
 * stops it (the database refuses the same case).
 */
export function PutBackDialog({
  title,
  files,
  replacesDraft,
  toMain,
  defaultMessage,
  changedSince = [],
  onConfirm,
  onClose,
}: {
  title: string
  files: string[]
  /** Paths whose copy in the person's draft this replaces. */
  replacesDraft: string[]
  toMain: boolean
  defaultMessage: string
  /** Paths a later commit changed: nothing is offered but Close. */
  changedSince?: string[]
  onConfirm: (message: string) => Promise<void>
  onClose: () => void
}) {
  const [message, setMessage] = useState(defaultMessage)
  const blocked = changedSince.length > 0

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={async () => {
        try {
          await onConfirm(message.trim() || defaultMessage)
        } catch (err) {
          throw new Error(authErrorMessage(err, 'That did not go through. Reload the files and try again.'), {
            cause: err,
          })
        }
      }}
      title={title}
      tone="primary"
      blocked={blocked}
      confirmLabel={toMain ? 'Put back in Main' : 'Put back in my draft'}
      body={
        blocked ? (
          <div className="space-y-3">
            <p>
              Later commits changed these files, so putting them back would overwrite that work. Restore each file
              from its history instead.
            </p>
            <PathList paths={changedSince} marker="data-changed-since" />
          </div>
        ) : (
          <div className="space-y-3">
            <p>
              {toMain
                ? 'These files go back to how they were before it, in a new commit for everyone on the project. History keeps every version.'
                : 'These files go back to how they were before it, in your draft. Main does not change until your draft is reviewed.'}
            </p>
            <PathList paths={files} />
            {replacesDraft.length > 0 && (
              <div className="space-y-1 text-warning-700 dark:text-warning-300">
                <p>Your draft already has its own copy of these files. Putting this back replaces it.</p>
                <PathList paths={replacesDraft} marker="data-replaces-draft" />
              </div>
            )}
            {toMain && (
              <div className="space-y-1">
                <label htmlFor="put-back-message" className="block text-[13px] text-ink">
                  Commit message
                </label>
                <Input
                  id="put-back-message"
                  autoComplete="off"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
            )}
          </div>
        )
      }
    />
  )
}

function PathList({ paths, marker }: { paths: string[]; marker?: 'data-changed-since' | 'data-replaces-draft' }) {
  return (
    <ul {...(marker ? { [marker]: '' } : {})} className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[12px] text-ink">
      {paths.map((p) => (
        <li key={p} className="break-all">
          {p}
        </li>
      ))}
    </ul>
  )
}
