import { useEffect, useState } from 'react'
import { TasksFromNotes } from '../general/TasksFromNotes'
import { attachSharedFiles } from '../../lib/general/sharedFiles'
import type { NoteTaskRow } from '../general/TasksFromNotes'
import { useGeneralProject } from '../general/useGeneralProject'
import { useToast } from '../ui/Toast'
import { addTask, claimTask, ensureClassBoardRepo } from '../../lib/api/tasks'
import { uploadTaskFile } from '../../lib/api/taskDetail'
import type { DraftSharedFile } from '../../lib/api/workAi'
import { authErrorMessage } from '../../lib/authError'
import type { BoardSummary } from '../../lib/types'

/** 11:59 pm on a local `YYYY-MM-DD`, as ISO. Null for an empty or bad day. */
function endOfDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T23:59`).toISOString() : null
}

/**
 * Tasks from notes on a group's board. The notes and discussions live in the
 * board's hidden project (the same one its Files and Discussion use); the tasks
 * go onto the board itself, the way "Draft tasks with AI" saves them.
 */
export function ClassTasksFromNotes({
  board,
  viewerId,
  open,
  onClose,
  onSaved,
}: {
  board: BoardSummary
  viewerId: string
  open: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const { show } = useToast()
  const [projectId, setProjectId] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!open || projectId) return
    let live = true
    void ensureClassBoardRepo(board.id)
      .then((id) => live && setProjectId(id))
      .catch((err) => {
        if (!live) return
        show(authErrorMessage(err, 'Could not open the notes for this board. Try again.'), 'error')
        onClose()
      })
    return () => {
      live = false
    }
  }, [open, projectId, board.id, onClose, show])

  const state = useGeneralProject(projectId, viewerId)

  async function save(rows: NoteTaskRow[], shared: DraftSharedFile[]) {
    // A holder the board refuses (a full share already) still leaves the task
    // saved, open for someone to claim. Counted and said, not thrown.
    let unclaimed = 0
    let missed = 0
    for (const r of rows) {
      const task = await addTask(
        board.id,
        { title: r.title, details: r.description, weight: 1, dueAt: endOfDay(r.due) },
        viewerId,
        true,
      )
      if (r.assignee) {
        try {
          await claimTask(task.id, r.assignee, viewerId)
        } catch {
          unclaimed++
        }
      }
      // A class task's Files hold up to 20 MB each.
      missed += await attachSharedFiles(r.files, shared, 20 * 1024 * 1024, (file) => uploadTaskFile(task.id, file))
    }
    await onSaved()
    return (
      `${rows.length} ${rows.length === 1 ? 'task' : 'tasks'} added` +
      (unclaimed > 0 ? `. ${unclaimed} could not go to the person named and ${unclaimed === 1 ? 'is' : 'are'} open to claim.` : '') +
      (missed > 0 ? `. ${missed} ${missed === 1 ? 'file' : 'files'} could not be added to ${missed === 1 ? 'its task' : 'their tasks'}.` : '')
    )
  }

  return (
    <TasksFromNotes
      state={state}
      open={open && Boolean(state.project)}
      onClose={onClose}
      onSave={save}
      mayAssign={Boolean(board.group_id)}
    />
  )
}
