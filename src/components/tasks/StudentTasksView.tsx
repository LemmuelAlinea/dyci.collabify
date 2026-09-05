import { Button } from '../ui/Button'
import { Alert } from '../ui/Alert'
import { Icon, Spinner } from '../ui/Icon'
import { EmptyState } from '../ui/EmptyState'
import { useToast } from '../ui/Toast'
import { BoardProgress } from './BoardProgress'
import { BoardVerdict } from './BoardVerdict'
import { GenerateTasksModal } from './GenerateTasksModal'
import { MemberProgress } from './MemberProgress'
import { SubmitProject } from './SubmitProject'
import { TaskBoard } from './TaskBoard'
import { TaskList } from './TaskList'
import { TaskSummary } from './TaskSummary'
import { TaskDetailModal } from './detail/TaskDetailModal'
import { EMPTY_TASK_FILTERS } from './TaskFilters'
import { TaskFilterBar, TaskViewSwitch } from './TaskViewSwitch'
import { canPlanBoard, isBoardSubmitted } from '../../lib/types'
import type { ProjectSummary, Role } from '../../lib/types'
import type { ProjectTasks } from './useProjectTasks'
import { useState } from 'react'

/** One student's own board: what they hold, and what they can still change. */
export function StudentTasksView({
  project,
  role,
  viewerId,
  t,
}: {
  project: ProjectSummary
  role: Role
  viewerId: string | undefined
  t: ProjectTasks
}) {
  const { show } = useToast()
  const [aiOpen, setAiOpen] = useState(false)
  const { active, locked, boards } = t

  return (
    <div className="space-y-4">
      {t.error && <Alert tone="error">{t.error}</Alert>}
      {locked && (
        <Alert tone="info">
          This project is closed, so your tasks can no longer change. You can still read the
          board and comment. Ask your professor to reopen it if you need to finish something.
        </Alert>
      )}

      <GenerateTasksModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        project={project}
        board={active}
        boards={boards ?? []}
        role={role}
        viewerId={viewerId}
        onSaved={async (message) => {
          show(message)
          await t.refresh()
        }}
      />

      {!active ? (
        <EmptyState
          icon="users"
          title="No board for you here"
          body="You are not in a group for this project yet."
        />
      ) : t.boardLoading ? (
        <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
          <Spinner size={16} />
          Loading your board…
        </div>
      ) : (
        <>
          <BoardVerdict board={active} role={role} onChanged={t.refresh} />
          <SubmitProject board={active} locked={locked} onChanged={t.refresh} />
          <BoardProgress board={active} />
          <MemberProgress
            rows={t.progress}
            viewerId={viewerId}
            dense
            title={active.group_id ? 'Your group' : 'Your progress'}
          />

          {/* Drafting is planning, and planning is over once the board is
              handed in — accepting leaves it that way, returning gives it back.
              The database refuses the insert either way; this is what stops the
              button offering something that cannot happen. */}
          {canPlanBoard(active, locked) ? (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="!rounded-lg"
                onClick={() => setAiOpen(true)}
              >
                <Icon name="spark" size={15} />
                Draft tasks with AI
              </Button>
            </div>
          ) : (
            !locked &&
            active.submitted_at && (
              <p className="text-right text-[12px] text-muted">
                {active.result_verdict === 'accepted'
                  ? 'This project is finished, so drafting is off.'
                  : 'Drafting is off while this is handed in. Take it back if something still needs adding.'}
              </p>
            )
          )}

          <TaskViewSwitch
            view={t.view}
            onView={t.setView}
            shown={t.shown.length}
            total={t.scope.length}
          />
          <TaskFilterBar
            filters={t.filters}
            onChange={t.setFilters}
            scope={t.scope}
            boards={boards ?? []}
            showBoards={false}
          />

          {t.view === 'summary' && <TaskSummary rows={t.shown} />}
          {t.view === 'list' && (
            <TaskList
              rows={t.shown}
              boardWeight={t.weightByBoard}
              showOwner={false}
              ownerLabel=""
              ownerFor={t.ownerFor}
              onOpen={t.showTask}
            />
          )}
          {t.view === 'board' && (
            <TaskBoard
              board={active}
              tasks={
                t.filters === EMPTY_TASK_FILTERS
                  ? t.tasks
                  : t.tasks.filter((task) => t.shown.some((r) => r.id === task.id))
              }
              members={t.members}
              progress={t.progress}
              viewerId={viewerId}
              role={role}
              // The same rule as the AI button, for the same reason: a handed-in
              // or closed board refuses new work in the database, so offering
              // "Add task" here only produces an error.
              canWork={canPlanBoard(active, locked)}
              onChanged={t.refresh}
            />
          )}
          {t.view !== 'board' && (
            <TaskDetailModal
              taskId={t.openTask}
              onClose={() => t.showTask(null)}
              viewerId={viewerId}
              role={role}
              boardWeight={
                t.weightByBoard.get(t.rows.find((r) => r.id === t.openTask)?.board_id ?? '') ?? 0
              }
              locked={locked || isBoardSubmitted(active)}
              onChanged={t.refresh}
            />
          )}
        </>
      )}
    </div>
  )
}
