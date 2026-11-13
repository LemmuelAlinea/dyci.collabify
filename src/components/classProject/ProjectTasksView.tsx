import { useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { ScrollTenList } from '../ui/ScrollTenList'
import { useToast } from '../ui/Toast'
import { FanOutForm } from '../tasks/FanOutForm'
import { GenerateTasksModal } from '../tasks/GenerateTasksModal'
import { TaskList } from '../tasks/TaskList'
import { TaskSummary } from '../tasks/TaskSummary'
import { TaskDetailModal } from '../tasks/detail/TaskDetailModal'
import { TaskFilterBar, TaskViewSwitch } from '../tasks/TaskViewSwitch'
import type { TaskView } from '../tasks/TaskViewSwitch'
import { classTimelineTasks } from '../tasks/classTimeline'
import type { ProjectTasks } from '../tasks/useProjectTasks'
import { TaskCalendar } from '../work/TaskCalendar'
import { NO_SPAN, TimelineView } from '../work/TimelineView'
import { deleteProfessorTask } from '../../lib/api/tasks'
import type { ProfessorTaskGroup } from '../../lib/api/tasks'
import { boardLabel } from '../../lib/classProjectNav'
import { stagesOf } from '../../lib/stages'
import { boardOwnerName } from '../../lib/types'
import type { ProjectSummary } from '../../lib/types'
import { milestoneCalendarEvents, taskCalendarEvents } from '../../lib/work/calendar'
import { milestoneMarks } from '../../lib/work/timeline'

/** A board belongs to one group, so the project-wide view offers the other three. */
const VIEWS: readonly TaskView[] = ['list', 'timeline', 'calendar']

/**
 * The professor's Tasks tab on a class project: what they set for every group,
 * then every task across the groups as a list, timeline or calendar.
 */
export function ProjectTasksView({
  project,
  t,
  viewerId,
}: {
  project: ProjectSummary
  t: ProjectTasks
  viewerId?: string
}) {
  const { show } = useToast()
  const [aiOpen, setAiOpen] = useState(false)
  const [setTaskOpen, setSetTaskOpen] = useState(false)
  const [editingOrigin, setEditingOrigin] = useState<ProfessorTaskGroup | null>(null)
  const [deletingOrigin, setDeletingOrigin] = useState<ProfessorTaskGroup | null>(null)
  // Both sections fold, so a long project reads as two headings until opened.
  const [setOpen, setSetOpen] = useState(true)
  const [allOpen, setAllOpen] = useState(true)
  const { active, solo, boards } = t
  const { one: who, many: whoPlural } = boardLabel(solo)
  // An address left on the board layout reads as the list here.
  const view = t.view === 'board' ? 'list' : t.view

  return (
    <div className="space-y-6">
      {t.error && <Alert tone="error">{t.error}</Alert>}
      {t.locked && (
        <Alert tone="info">
          This project is closed. Students can no longer change their tasks — reopen it from
          the project header to let them back in.
        </Alert>
      )}

      {/* 1 ── what you set for every group */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionToggle
            open={setOpen}
            onToggle={() => setSetOpen((o) => !o)}
            controls="tasks-set"
            title="What you set"
            count={t.mine.length}
            sub={`Handed to every ${who}. They decide who does it.`}
          />
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

        <div id="tasks-set" hidden={!setOpen}>
          {t.mine.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">
              You have set none. A {who} can still break the project down themselves.
            </p>
          ) : (
            <ScrollTenList
              ids={t.mine.map((task) => task.origin_id)}
              label="What you set"
              visibleRows={5}
              className="-mr-1 space-y-2 pr-1"
            >
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
            </ScrollTenList>
          )}
        </div>
      </section>

      {/* 2 ── every task across the groups */}
      <section className="space-y-4 border-t border-line pt-6">
        <SectionToggle
          open={allOpen}
          onToggle={() => setAllOpen((o) => !o)}
          controls="tasks-all"
          title={`Every ${who} task`}
          count={t.scope.length}
          sub={`Every task across all ${whoPlural}. Choose one in the filter to narrow this.`}
        />

        <div id="tasks-all" hidden={!allOpen} className="space-y-3">
          <TaskViewSwitch
            view={view}
            onView={t.setView}
            shown={t.shown.length}
            total={t.scope.length}
            views={VIEWS}
          />
          <TaskFilterBar
            filters={t.filters}
            onChange={t.setFilters}
            scope={t.scope}
            boards={boards ?? []}
            showBoards
          />

          {view === 'list' && (
            <TaskList
              rows={t.shown}
              boardWeight={t.weightByBoard}
              showOwner
              ownerLabel={solo ? 'Student' : 'Group'}
              ownerFor={t.ownerFor}
              onOpen={t.showTask}
              stages={stagesOf(project.stages)}
              visibleRows={5}
            />
          )}
          {view === 'timeline' && (
            <TimelineView
              tasks={classTimelineTasks(t.shown, true)}
              groups={(boards ?? []).map((b) => ({ id: b.id, name: boardOwnerName(b) }))}
              span={NO_SPAN}
              bands={[]}
              marks={milestoneMarks(t.milestones)}
              looseLabel="Unknown board"
              onOpen={t.showTask}
            />
          )}
          {view === 'calendar' && (
            <TaskCalendar
              events={[
                ...taskCalendarEvents(t.shown, t.ownerFor),
                ...milestoneCalendarEvents(t.milestones),
              ]}
              onOpen={t.showTask}
            />
          )}
        </div>

        {/* Outside the fold, so the summary stays when the list is put away. */}
        <TaskSummary rows={t.scope} showLoad />
      </section>

      {/* 3 ── a task opened from the list, timeline or calendar */}
      <TaskDetailModal
        taskId={t.openTask}
        onClose={() => t.showTask(null)}
        viewerId={viewerId}
        role="professor"
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
        role="professor"
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

/** A section heading that folds the section away. */
function SectionToggle({
  open,
  onToggle,
  controls,
  title,
  count,
  sub,
}: {
  open: boolean
  onToggle: () => void
  controls: string
  title: string
  count: number
  sub: string
}) {
  return (
    <div className="min-w-0">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={controls}
          className="group -ml-1 flex items-center gap-2 rounded-lg px-1 text-left"
        >
          <Icon
            name="chevronDown"
            size={16}
            className={`shrink-0 text-faint transition-transform group-hover:text-ink motion-reduce:transition-none ${open ? '' : '-rotate-90'}`}
          />
          {title}
          <span className="font-mono text-[12px] font-normal text-faint">{count}</span>
        </button>
      </h3>
      <p className="mt-0.5 pl-6 text-[13px] text-muted">{sub}</p>
    </div>
  )
}
