import { useEffect, useState } from 'react'
import { DiscussionTab } from '../general/DiscussionTab'
import { FilesTab } from '../general/FilesTab'
import { SharedTab } from '../general/SharedTab'
import { useGeneralProject } from '../general/useGeneralProject'
import { Alert } from '../ui/Alert'
import { EmptyState } from '../ui/EmptyState'
import { Spinner } from '../ui/Icon'
import { classBoardRepoId, ensureClassBoardRepo } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import { boardLabel } from '../../lib/classProjectNav'
import type { ProjectTasks } from './useProjectTasks'

/**
 * A class project's Files: the group's own repository, the same page a work
 * project has. Only the group's students change them. Whoever teaches the
 * class reads them, through `class-files-teacher-read.sql`, with `readOnly`:
 * nothing is created for them, and no control that writes shows. Handing in,
 * or the professor closing the project, freezes them. `show` picks the same
 * group's Shared with me or Discussion instead.
 */
export function ClassFilesTab({
  t,
  viewerId,
  show = 'files',
  readOnly = false,
}: {
  t: ProjectTasks
  viewerId: string | undefined
  show?: 'files' | 'shared' | 'discussion'
  /** A teacher reading the group's files: never opens them, never writes. */
  readOnly?: boolean
}) {
  const board = t.active
  // undefined while it is being found; null when a teacher finds the group never opened Files.
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  // A teacher's view, refused because this viewer does not teach the class (an
  // adviser can see the project but not its groups' files).
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    let live = true
    setProjectId(undefined)
    setError(null)
    setRefused(false)
    if (!board) return
    ;(readOnly ? classBoardRepoId(board.id) : ensureClassBoardRepo(board.id))
      .then((id) => live && setProjectId(id))
      .catch((err) => {
        if (!live) return
        if (readOnly && (err as { code?: string } | null)?.code === '42501') setRefused(true)
        else setError(authErrorMessage(err, 'Could not open these files. Try again.'))
      })
    return () => {
      live = false
    }
  }, [board, readOnly])

  const state = useGeneralProject(projectId ?? undefined, viewerId)

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
  // control off for an archived project. A teacher's view is always read-only.
  const view = readOnly
    ? { ...state, archived: true, readOnly: true, classTeacher: true, can: () => false }
    : { ...state, archived: state.archived || frozen }

  if (readOnly && refused) {
    return (
      <EmptyState
        icon="folder"
        title="Files are for the class's teachers"
        body="Only the class's teachers can read a group's files."
      />
    )
  }

  if (readOnly && projectId === null) {
    return (
      <EmptyState
        icon="folder"
        title="No files yet"
        body={`This ${boardLabel(t.solo).one} has not added any files.`}
      />
    )
  }

  return (
    <div className="space-y-4">
      {frozen && !readOnly && (
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
        show === 'shared' ? (
          <SharedTab state={view} />
        ) : show === 'discussion' && !readOnly ? (
          <DiscussionTab state={view} />
        ) : (
          <FilesTab state={view} />
        )
      )}
    </div>
  )
}
