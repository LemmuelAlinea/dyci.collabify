import { useEffect, useMemo, useState } from 'react'
import { FilesTab } from '../general/FilesTab'
import { useGeneralProject } from '../general/useGeneralProject'
import { Alert } from '../ui/Alert'
import { EmptyState } from '../ui/EmptyState'
import { Spinner } from '../ui/Icon'
import { Select } from '../ui/Select'
import { ensureClassBoardRepo } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import type { BoardSummary } from '../../lib/types'
import type { ProjectTasks } from './useProjectTasks'

function boardLabel(b: BoardSummary) {
  return b.group_name ?? b.student_name ?? 'Board'
}

/**
 * A class project's Files: each group's own repository, the same page a work
 * project has. Students write to their board's; teachers pick a group and read.
 * Handing in, or the professor closing the project, freezes them.
 */
export function ClassFilesTab({
  t,
  viewerId,
}: {
  t: ProjectTasks
  viewerId: string | undefined
}) {
  const boards = useMemo(() => t.boards ?? [], [t.boards])
  const [picked, setPicked] = useState<string>('')
  const board = t.isProfessor ? (boards.find((b) => b.id === picked) ?? boards[0] ?? null) : t.active
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
        body={
          t.isProfessor
            ? 'Files appear for each group once the project reaches them.'
            : 'You are not in a group for this project yet, so there are no files to work on.'
        }
      />
    )
  }

  const frozen = Boolean(board.submitted_at) || t.locked
  // Teachers read; a handed-in or closed board is read-only for everyone.
  // FilesTab already turns every control off for an archived project.
  const view = { ...state, archived: state.archived || t.isProfessor || frozen }

  return (
    <div className="space-y-4">
      {t.isProfessor && boards.length > 1 && (
        <div className="max-w-xs">
          <Select
            aria-label="Whose files"
            value={board.id}
            onChange={(e) => setPicked(e.target.value)}
            options={boards.map((b) => ({ value: b.id, label: boardLabel(b) }))}
          />
        </div>
      )}
      {t.isProfessor ? (
        <Alert tone="info">You are reading {boardLabel(board)}'s files. Only the group changes them.</Alert>
      ) : (
        frozen && (
          <Alert tone="info">
            {board.submitted_at
              ? 'This project is handed in, so its files are fixed. Take the submission back to change them.'
              : 'This project is closed, so its files are fixed. Ask your professor to reopen it.'}
          </Alert>
        )
      )}
      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : !projectId || state.loading ? (
        <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
          <Spinner size={16} />
          Opening files…
        </div>
      ) : (
        <FilesTab state={view} />
      )}
    </div>
  )
}
