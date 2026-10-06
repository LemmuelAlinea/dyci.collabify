import { useState } from 'react'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Alert } from '../ui/Alert'
import { Icon, Spinner } from '../ui/Icon'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { BoardProgress } from './BoardProgress'
import { BoardVerdict } from './BoardVerdict'
import { FanOutForm } from './FanOutForm'
import { GenerateTasksModal } from './GenerateTasksModal'
import { GroupProgressTable } from './GroupProgressTable'
import { HandInQueue } from './HandInQueue'
import { MemberProgress } from './MemberProgress'
import { TaskBoard } from './TaskBoard'
import { TaskList } from './TaskList'
import { TaskSummary } from './TaskSummary'
import { TaskDetailModal } from './detail/TaskDetailModal'
import { TaskFilterBar, TaskViewSwitch } from './TaskViewSwitch'
import { classTimelineTasks } from './classTimeline'
import { BacklogView } from '../work/BacklogView'
import { ScopePicker } from '../work/ScopePicker'
import { MilestonesView } from '../work/MilestonesView'
import { SprintsView } from '../work/SprintsView'
import { TaskCalendar } from '../work/TaskCalendar'
import { NO_SPAN, TimelineView } from '../work/TimelineView'
import { classMilestoneSource, classWorkSource } from './classWorkSource'
import { milestoneCalendarEvents, sprintCalendarEvents, taskCalendarEvents } from '../../lib/work/calendar'
import { scopeOptions } from '../../lib/work/scope'
import { milestoneMarks, sprintBands } from '../../lib/work/timeline'
import { deleteProfessorTask } from '../../lib/api/tasks'
import { recordResult } from '../../lib/api/results'
import type { ProfessorTaskGroup } from '../../lib/api/tasks'
import { boardOwnerName, boardWeight } from '../../lib/types'
import { authErrorMessage } from '../../lib/authError'
import type { ProjectSummary, TeachingViewRole } from '../../lib/types'
import type { ProjectTasks } from './useProjectTasks'

/**
 * The professor's side of a project, ordered by what they came for.
 *
 * It used to run: what you set → where the groups are → a view switch over
 * every task → and, far below all of that, the board you had actually clicked.
 * Four sections that each made sense alone and added up to a page nobody could
 * navigate. The specific failures:
 *
 *   - The view switch sat between the group tiles and the group's own board,
 *     so its scope was ambiguous. "Who is carrying what" appeared with no
 *     group chosen and nothing saying whose work it described.
 *   - Choosing a group pushed its board *below* the task views, so the thing
 *     you clicked appeared off-screen and the tile you clicked scrolled away.
 *   - Work that had been handed in — the only thing on the page genuinely
 *     waiting on the professor — was a small chip on one tile among twenty.
 *   - Authoring ("set a task") led, above every monitoring section, though it
 *     is what a professor does once and the monitoring is what they return to.
 *
 * It now runs in the order the questions actually arrive:
 *
 *   1. **Waiting on you** — what needs a decision, answerable in place.
 *   2. **The groups** — where everybody is, and the place you pick one.
 *   3. **The work** — one area whose scope is named at its top, so it is never
 *      a guess whose tasks are on screen. Choosing a group narrows it here
 *      rather than opening a second region somewhere else.
 *   4. **What you set** — authoring, last, because it is the part that is
 *      already done by the time any of the above matters.
 */
export function ProfessorTasksView({
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
  const [setTaskOpen, setSetTaskOpen] = useState(false)
  const [editingOrigin, setEditingOrigin] = useState<ProfessorTaskGroup | null>(null)
  const [deletingOrigin, setDeletingOrigin] = useState<ProfessorTaskGroup | null>(null)
  const { active, solo, boards } = t

  const who = solo ? 'student' : 'group'
  const whoPlural = solo ? 'students' : 'groups'

  /** From Summary, opening a group means going to its tasks. */
  const openBoard = (boardId: string) => {
    t.showBoard(boardId)
    t.setSection('tasks')
  }

  return (
    <div className="space-y-6">
      {t.error && <Alert tone="error">{t.error}</Alert>}
      {t.locked && (
        <Alert tone="info">
          This project is closed. Students can no longer change their tasks — reopen it from
          the project header to let them back in.
        </Alert>
      )}

      {t.section === 'summary' && (
        <>
          {/* 1 ── what needs a decision */}
          <HandInQueue
            boards={boards ?? []}
            solo={solo}
            onOpen={(b) => openBoard(b.id)}
            onChanged={t.refresh}
          />

          {/* 2 ── where everybody is, and where a group is chosen */}
          <section className="space-y-3">
            <div>
              <h3>{solo ? 'Students' : 'Groups'}</h3>
              <p className="mt-0.5 text-[13px] text-muted">
                Open {solo ? 'a student' : 'a group'} to see its tasks and answer its work.
              </p>
            </div>
            <GroupProgressTable
              boards={boards ?? []}
              activeId={active?.id}
              solo={solo}
              onOpen={(b) => openBoard(b.id)}
              onAccept={async (b) => {
                try {
                  await recordResult({ boardId: b.id, verdict: 'accepted' })
                  show(`${boardOwnerName(b)} accepted`)
                  await t.refresh()
                } catch (err) {
                  show(authErrorMessage(err, 'Could not accept that.'), 'error')
                }
              }}
            />
          </section>

          <section className="space-y-3 border-t border-line pt-6">
            <div>
              <h3>Every {who}</h3>
              <p className="mt-0.5 text-[13px] text-muted">
                All tasks across the project, by stage, and who carries them.
              </p>
            </div>
            <TaskSummary rows={t.scope} showLoad />
          </section>
        </>
      )}

      {(t.section === 'backlog' || t.section === 'sprints') && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h3>{active ? boardOwnerName(active) : `Choose a ${who}`}</h3>
              <p className="mt-0.5 text-[13px] text-muted">
                {active ? `This ${who}'s plan, as they keep it.` : `Each ${who} plans its own sprints. Pick one to follow its plan.`}
              </p>
            </div>
            <div className="w-full max-w-xs">
              <Select
                value={active?.id ?? ''}
                onChange={(e) => t.showBoard(e.target.value || null)}
                placeholder={`Choose a ${who}`}
                options={(boards ?? []).map((b) => ({ value: b.id, label: boardOwnerName(b) }))}
                aria-label={`Which ${who}`}
                className="!h-10 !text-[13px]"
              />
            </div>
          </div>
          {(() => {
            const source = classWorkSource(t, viewerId)
            if (!source) return null
            return t.section === 'backlog' ? (
              <BacklogView source={source} />
            ) : (
              <SprintsView source={source} onPlan={() => t.setSection('backlog')} />
            )
          })()}
        </section>
      )}

      {t.section === 'milestones' && (
        <section className="space-y-4">
          <MilestonesView source={classMilestoneSource(t, project.id)} />
        </section>
      )}

      {t.section === 'tasks' && (
        <>
          {/* 3 ── the work, with its scope named at the top of it */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate">
                  {active ? boardOwnerName(active) : `Every ${who}`}
                </h3>
                <p className="mt-0.5 text-[13px] text-muted">
                  {active
                    ? `This ${who}'s board, and the work on it.`
                    : `Every task across all ${whoPlural}. Choose one in the filter to narrow this.`}
                </p>
              </div>
              {active && (
                <Button variant="ghost" size="sm" onClick={() => t.showBoard(null)}>
                  <Icon name="x" size={15} />
                  Back to every {who}
                </Button>
              )}
            </div>

            {/* The chosen board's own standing, above its tasks rather than in a
                separate region further down. A professor answering work wants the
                verdict, the progress and who carried it in one place. */}
            {active &&
              (t.boardLoading ? (
                <div className="flex items-center gap-3 py-8 text-[14px] text-muted">
                  <Spinner size={16} />
                  Loading that board…
                </div>
              ) : (
                <div className="space-y-4">
                  <BoardVerdict board={active} role={role} onChanged={t.refresh} />
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.6fr)] xl:items-start">
                    <BoardProgress board={active} />
                    <MemberProgress rows={t.progress} title="Share of the group" dense />
                  </div>
                </div>
              ))}

            <div className="space-y-3">
              {active && t.sprints.length > 0 && (
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
                showBoards
              />

              {t.view === 'list' && (
                <TaskList
                  rows={t.shown}
                  boardWeight={t.weightByBoard}
                  showOwner={!active}
                  ownerLabel={solo ? 'Student' : 'Group'}
                  ownerFor={t.ownerFor}
                  onOpen={t.showTask}
                />
              )}
              {t.view === 'board' &&
                (active ? (
                  !t.boardLoading && (
                    <TaskBoard
                      board={active}
                      tasks={t.boardTasks}
                      totalWeight={boardWeight(t.tasks)}
                      members={t.members}
                      progress={t.progress}
                      viewerId={viewerId}
                      role={role}
                      canWork={false}
                      onChanged={t.refresh}
                    />
                  )
                ) : (
                  <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
                    A board belongs to one {who}. Choose one in the filter above, or switch to the
                    list, timeline or calendar to see every {who} at once.
                  </p>
                ))}
              {t.view === 'timeline' && (
                <TimelineView
                  tasks={classTimelineTasks(t.shown, !active)}
                  groups={active ? [] : (boards ?? []).map((b) => ({ id: b.id, name: boardOwnerName(b) }))}
                  span={NO_SPAN}
                  bands={active ? sprintBands(t.sprints) : []}
                  marks={milestoneMarks(t.milestones)}
                  looseLabel={active ? boardOwnerName(active) : 'Unknown board'}
                  onOpen={t.showTask}
                />
              )}
              {t.view === 'calendar' && (
                <TaskCalendar
                  events={[
                    ...taskCalendarEvents(t.shown, active ? undefined : t.ownerFor),
                    ...(active ? sprintCalendarEvents(t.sprints) : []),
                    ...milestoneCalendarEvents(t.milestones),
                  ]}
                  onOpen={t.showTask}
                />
              )}
            </div>
          </section>

          {/* 4 ── authoring, last */}
          <section className="space-y-3 border-t border-line pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3>What you set</h3>
                <p className="mt-0.5 text-[13px] text-muted">
                  Handed to every {who}. They decide who does it.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="!rounded-lg"
                  onClick={() => setAiOpen(true)}
                >
                  <Icon name="spark" size={15} />
                  Draft with AI
                </Button>
                <Button size="sm" className="!rounded-lg" onClick={() => setSetTaskOpen(true)}>
                  <Icon name="plus" size={15} />
                  Set a task
                </Button>
              </div>
            </div>

            {t.mine.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">
                You have set none. A {who} can still break the project down themselves.
              </p>
            ) : (
              <ul className="space-y-2">
                {t.mine.map((task) => (
                  <li
                    key={task.origin_id}
                    className="surface flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-ink">{task.title}</p>
                      <p className="mt-0.5 text-[12px] text-faint">
                        {task.boards} {task.boards === 1 ? who : whoPlural} · {task.started}{' '}
                        started · {task.done} done
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingOrigin(task)}
                      aria-label={`Edit ${task.title}`}
                      className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                    >
                      <Icon name="edit" size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingOrigin(task)}
                      aria-label={`Withdraw ${task.title}`}
                      className="grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-destructive-50 hover:text-destructive-600 dark:hover:bg-destructive-500/12 dark:hover:text-destructive-400"
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* Outside the sections: a task opened from the list, or from Summary,
        must still open. */}
      <TaskDetailModal
        taskId={t.openTask}
        onClose={() => t.showTask(null)}
        viewerId={viewerId}
        role={role}
        boardWeight={
          t.weightByBoard.get(t.rows.find((r) => r.id === t.openTask)?.board_id ?? '') ?? 0
        }
        // A professor is never locked out of a task by the project closing.
        locked={false}
        onChanged={t.refresh}
      />

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

      <FanOutForm
        open={setTaskOpen || Boolean(editingOrigin)}
        onClose={() => {
          setSetTaskOpen(false)
          setEditingOrigin(null)
        }}
        projectId={project.id}
        boards={boards ?? []}
        milestones={t.milestones}
        editing={editingOrigin ?? undefined}
        onSaved={async (message, tone) => {
          show(message, tone)
          await t.refresh()
        }}
      />

      <ConfirmDialog
        open={Boolean(deletingOrigin)}
        onClose={() => setDeletingOrigin(null)}
        onConfirm={async () => {
          if (!deletingOrigin) return
          const res = await deleteProfessorTask(deletingOrigin.origin_id)
          show(
            res.kept
              ? `Withdrawn from ${res.removed} ${whoPlural}. ${res.kept} had already started and keep theirs.`
              : 'Task withdrawn',
          )
          setDeletingOrigin(null)
          await t.refresh()
        }}
        title={`Withdraw ${deletingOrigin?.title ?? 'this task'}?`}
        body={`It comes off every ${who} that has not started it. Anyone already working on it keeps it.`}
        confirmLabel="Withdraw"
        tone="danger"
      />
    </div>
  )
}
