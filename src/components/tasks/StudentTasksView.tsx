import { Button } from '../ui/Button'
import { Alert } from '../ui/Alert'
import { Icon, Spinner } from '../ui/Icon'
import { EmptyState } from '../ui/EmptyState'
import { useToast } from '../ui/Toast'
import { ClassTasksFromNotes } from './ClassTasksFromNotes'
import { GenerateTasksModal } from './GenerateTasksModal'
import { BoardProgress } from './BoardProgress'
import { MemberProgress } from './MemberProgress'
import { TaskBoard } from './TaskBoard'
import { TaskList } from './TaskList'
import { TaskSummary } from './TaskSummary'
import { TaskDetailModal } from './detail/TaskDetailModal'
import { TaskFilterBar, TaskViewSwitch } from './TaskViewSwitch'
import { classTimelineTasks } from './classTimeline'
import { BacklogView } from '../work/BacklogView'
import { ScopePicker } from '../work/ScopePicker'
import { SprintsView } from '../work/SprintsView'
import { TaskCalendar } from '../work/TaskCalendar'
import { NO_SPAN, TimelineView } from '../work/TimelineView'
import { classWorkSource } from './classWorkSource'
import { sprintCalendarEvents, taskCalendarEvents } from '../../lib/work/calendar'
import { scopeOptions, scopeTargetSprint } from '../../lib/work/scope'
import { sprintBands } from '../../lib/work/timeline'
import { setTaskStatus } from '../../lib/api/tasks'
import { authErrorMessage } from '../../lib/authError'
import { canPlanBoard, isBoardSubmitted, isMine } from '../../lib/types'
import type { ProjectSummary, TeachingViewRole } from '../../lib/types'
import type { ProjectTasks } from './useProjectTasks'
import { useCallback, useState } from 'react'

/** One student's own board: what they hold, and what they can still change. */
export function StudentTasksView({
  project, role,
  viewerId,
  t,
}: {
  project: ProjectSummary
  role: TeachingViewRole
  viewerId: string | undefined
  t: ProjectTasks
}) {
  const { show } = useToast()
  const [aiOpen, setAiOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const closeNotes = useCallback(() => setNotesOpen(false), [])
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

      {active && viewerId && (
        <ClassTasksFromNotes
          board={active}
          viewerId={viewerId}
          open={notesOpen}
          onClose={closeNotes}
          onSaved={t.refresh}
        />
      )}

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
          {t.section === 'summary' ? (
            <div className="space-y-4">
              <BoardProgress board={active} />
              <MemberProgress
                rows={t.progress}
                viewerId={viewerId}
                title={active.group_id ? 'Your group' : 'Your progress'}
              />
              <TaskSummary rows={t.scope} />
            </div>
          ) : t.section === 'backlog' || t.section === 'sprints' ? (
            (() => {
              const source = classWorkSource(t, viewerId)
              if (!source) return null
              return t.section === 'backlog' ? (
                <BacklogView source={source} />
              ) : (
                <SprintsView source={source} onPlan={() => t.setSection('backlog')} />
              )
            })()
          ) : (
            <>
              {/* Handing in and the professor's answer sit in the project header;
                  progress is on Summary. */}

              {/* Drafting is planning, and planning is over once the board is
                  handed in — accepting leaves it that way, returning gives it back.
                  The database refuses the insert either way; this is what stops the
                  button offering something that cannot happen. */}
              {canPlanBoard(active, locked) ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="!rounded-lg"
                    onClick={() => setNotesOpen(true)}
                  >
                    <Icon name="spark" size={15} />
                    From notes
                  </Button>
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

              {t.sprints.length > 0 && (
                <ScopePicker
                  value={t.sprintScope}
                  options={scopeOptions(t.sprints)}
                  onChange={t.setSprintScope}
                />
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

              {t.view === 'list' && (
                <TaskList
                  rows={t.shown}
                  boardWeight={t.weightByBoard}
                  showOwner={false}
                  ownerLabel=""
                  ownerFor={t.ownerFor}
                  onOpen={t.showTask}
                  // The board's rule: whoever is on a task moves it, and on a solo
                  // board that is always its owner. Nothing moves once handed in or closed.
                  canMove={(row) =>
                    canPlanBoard(active, locked) &&
                    Boolean(viewerId && (isMine(row, viewerId) || active?.student_id))
                  }
                  onStatus={async (row, to) => {
                    try {
                      await setTaskStatus(row.id, to)
                      await t.refresh()
                    } catch (err) {
                      show(authErrorMessage(err, 'Could not move that task.'), 'error')
                    }
                  }}
                />
              )}
              {t.view === 'board' && (
                <TaskBoard
                  board={active}
                  tasks={t.boardTasks}
                  members={t.members}
                  progress={t.progress}
                  viewerId={viewerId}
                  role={role}
                  // The same rule as the AI button, for the same reason: a handed-in
                  // or closed board refuses new work in the database, so offering
                  // "Add task" here only produces an error.
                  canWork={canPlanBoard(active, locked)}
                  newTaskSprint={scopeTargetSprint(t.sprintScope, t.sprints)}
                  onChanged={t.refresh}
                />
              )}
              {t.view === 'timeline' && (
                <TimelineView
                  tasks={classTimelineTasks(t.shown, false)}
                  groups={[]}
                  span={NO_SPAN}
                  bands={sprintBands(t.sprints)}
                  looseLabel={active.group_id ? 'Your group' : 'Your tasks'}
                  onOpen={t.showTask}
                />
              )}
              {t.view === 'calendar' && (
                <TaskCalendar events={[...taskCalendarEvents(t.shown), ...sprintCalendarEvents(t.sprints)]} onOpen={t.showTask} />
              )}
            </>
          )}
          {(t.section !== 'tasks' || t.view !== 'board') && (
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
