import { useEffect, useState } from 'react'
import { TasksFromNotes } from '../general/TasksFromNotes'
import { attachSharedFiles } from '../../lib/general/sharedFiles'
import type { NotePlan, NoteTaskRow, NotesPlanScope } from '../general/TasksFromNotes'
import { useGeneralProject } from '../general/useGeneralProject'
import { useToast } from '../ui/Toast'
import { tagTasks } from '../../lib/api/milestones'
import { createSprint } from '../../lib/api/sprints'
import { addTask, claimTask, ensureClassBoardRepo } from '../../lib/api/tasks'
import { uploadTaskFile } from '../../lib/api/taskDetail'
import type { DraftSharedFile } from '../../lib/api/workAi'
import { authErrorMessage } from '../../lib/authError'
import { canPlanBoard } from '../../lib/types'
import type { BoardSummary } from '../../lib/types'
import { addedMessage, byMilestone, commitPlan, endOfDay, resolveKey, startOfDay } from '../../lib/work/notesPlan'
import type { Milestone, Sprint } from '../../lib/work/types'

/**
 * Tasks from notes on a group's board. The notes and discussions live in the
 * board's hidden project (the same one its Files and Discussion use); the tasks
 * and sprints go onto the board itself, the way "Draft tasks with AI" saves
 * them. Milestones are the professor's: a task joins one only when the file
 * names a milestone the professor already set.
 */
export function ClassTasksFromNotes({
  board,
  viewerId,
  sprints,
  milestones,
  locked,
  open,
  onClose,
  onSaved,
}: {
  board: BoardSummary
  viewerId: string
  /** The board's sprints. */
  sprints: Sprint[]
  /** The class project's milestones. */
  milestones: Milestone[]
  locked: boolean
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
  const mayPlan = canPlanBoard(board, locked)
  const plan: NotesPlanScope = {
    sprints,
    milestones,
    maySprint: mayPlan,
    mayCreateMilestones: false,
    mayTag: mayPlan,
    noSprints: 'This board is handed in or the project is closed, so the tasks from the file go to the backlog.',
    noMilestones:
      'Your professor sets the milestones in a class, so the ones in the file that are not set yet were left out.',
  }

  async function save(rows: NoteTaskRow[], shared: DraftSharedFile[], drafted: NotePlan) {
    // A holder the board refuses (a full share already) still leaves the task
    // saved, open for someone to claim. Counted and said, not thrown.
    let unclaimed = 0
    let missed = 0
    let untagged = 0
    try {
      const created = await commitPlan(drafted.sprints, [], {
        sprint: (input, milestoneId) => createSprint({ kind: 'class', boardId: board.id }, input, milestoneId),
        milestone: () => Promise.reject(new Error('Only the professor sets milestones.')),
      })
      const tagged: { taskId: string; milestoneId: string | null }[] = []
      for (const r of rows) {
        const task = await addTask(
          board.id,
          {
            title: r.title,
            details: r.description,
            weight: 1,
            dueAt: endOfDay(r.due),
            startsAt: r.start && (!r.due || r.start <= r.due) ? startOfDay(r.start) : null,
            sprintId: resolveKey(r.sprintKey, created),
          },
          viewerId,
          true,
        )
        tagged.push({ taskId: task.id, milestoneId: resolveKey(r.milestoneKey, created) })
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
      for (const [milestoneId, ids] of byMilestone(tagged)) {
        try {
          await tagTasks({ kind: 'class', projectId: board.project_id }, ids, milestoneId)
        } catch {
          untagged += ids.length
        }
      }
    } finally {
      // Reload even after a failure: a partly saved plan still changed rows.
      await onSaved()
    }
    return (
      addedMessage(rows.length, drafted.sprints.filter((s) => s.keep).length, 0) +
      (unclaimed > 0 ? `. ${unclaimed} could not go to the person named and ${unclaimed === 1 ? 'is' : 'are'} open to claim.` : '') +
      (missed > 0 ? `. ${missed} ${missed === 1 ? 'file' : 'files'} could not be added to ${missed === 1 ? 'its task' : 'their tasks'}.` : '') +
      (untagged > 0 ? `. ${untagged} could not be put on their milestone; tag them from Milestones.` : '')
    )
  }

  return (
    <TasksFromNotes
      state={state}
      open={open && Boolean(state.project)}
      onClose={onClose}
      onSave={save}
      plan={plan}
      mayAssign={Boolean(board.group_id)}
    />
  )
}
