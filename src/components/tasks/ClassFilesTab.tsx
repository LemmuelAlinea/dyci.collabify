import { useEffect, useState } from 'react'
import { FilesTab } from '../general/FilesTab'
import { SharedTab } from '../general/SharedTab'
import { useGeneralProject } from '../general/useGeneralProject'
import { Alert } from '../ui/Alert'
import { EmptyState } from '../ui/EmptyState'
import { Spinner } from '../ui/Icon'
import { ensureClassBoardRepo } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import type { ProjectTasks } from './useProjectTasks'

/**
 * A class project's Files: the group's own repository, the same page a work
 * project has. Students only: a group's working files are theirs, and the
 * database refuses teachers too. Handing in, or the professor closing the
 * project, freezes them. `show="shared"` is the same group's Shared with me.
 */
export function ClassFilesTab({
  t,
  viewerId,
  show = 'files',
}: {
  t: ProjectTasks
  viewerId: string | undefined
  show?: 'files' | 'shared'
}) {
  const board = t.active
  const [projectId, setProjectId] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setProjectId(undefined)
    setError(null)
    if (!board) return
    ensureClassBoardRepo(board.id)
      .then((id) => live && setProjectId(id))
      .catch((err) => live && setError(authErrorMessage(err, 'Could not open these files. Try again.')))
    return () => {
      live = false
    }
  }, [board])

  const state = useGeneralProject(projectId, viewerId)

  if (t.boards === null) {
    return (
      <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
        <Spinner size={16} />
        Loading files…
      </div>
    )
  }
  if (!board) {
    return (
      <EmptyState
        icon="folder"
        title="No files here yet"
        body="You are not in a group for this project yet, so there are no files to work on."
      />
    )
  }

  const frozen = Boolean(board.submitted_at) || t.locked
  // A handed-in or closed board is read-only. FilesTab already turns every
  // control off for an archived project.
  const view = { ...state, archived: state.archived || frozen }

  return (
    <div className="space-y-4">
      {frozen && (
        <Alert tone="info">
          {board.submitted_at
            ? 'This project is handed in, so its files are fixed. Take the submission back to change them.'
            : 'This project is closed, so its files are fixed. Ask your professor to reopen it.'}
        </Alert>
      )}
      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : !projectId || state.loading ? (
        <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
          <Spinner size={16} />
          Opening files…
        </div>
      ) : (
        show === 'shared' ? <SharedTab state={view} /> : <FilesTab state={view} />
      )}
    </div>
  )
}
