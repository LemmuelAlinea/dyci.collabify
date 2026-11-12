import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Alert } from '../ui/Alert'
import { Icon, Spinner } from '../ui/Icon'
import { Tabs } from '../ui/Tabs'
import type { Tab } from '../ui/Tabs'
import { cls } from '../ui/buttonClass'
import { PeerRoundsPanel } from '../peer/PeerRoundsPanel'
import { ScoreCard } from '../scoring/ScoreCard'
import { useProjectScores } from '../scoring/useProjectScores'
import { BoardProgress } from '../tasks/BoardProgress'
import { BoardVerdict } from '../tasks/BoardVerdict'
import { MemberProgress } from '../tasks/MemberProgress'
import { TaskBoard } from '../tasks/TaskBoard'
import { TaskList } from '../tasks/TaskList'
import { TaskDetailModal } from '../tasks/detail/TaskDetailModal'
import { TaskFilterBar, TaskViewSwitch } from '../tasks/TaskViewSwitch'
import { classTimelineTasks } from '../tasks/classTimeline'
import { classWorkSource } from '../tasks/classWorkSource'
import type { ProjectTasks } from '../tasks/useProjectTasks'
import { BacklogView } from '../work/BacklogView'
import { ScopePicker } from '../work/ScopePicker'
import { SprintsView } from '../work/SprintsView'
import { TaskCalendar } from '../work/TaskCalendar'
import { NO_SPAN, TimelineView } from '../work/TimelineView'
import {
  adjacentBoards, boardLabel, boardLeader, boardStage, readBoardTab, topShare,
} from '../../lib/classProjectNav'
import type { BoardTab } from '../../lib/classProjectNav'
import { paths } from '../../lib/paths'
import { stagesOf } from '../../lib/stages'
import { boardOwnerName, boardWeight } from '../../lib/types'
import type { BoardSummary, ProjectSummary } from '../../lib/types'
import { milestoneCalendarEvents, sprintCalendarEvents, taskCalendarEvents } from '../../lib/work/calendar'
import { scopeOptions } from '../../lib/work/scope'
import { milestoneMarks, sprintBands } from '../../lib/work/timeline'

/** What a tab's own place means; it means nothing on another tab. */
const TAB_PARAMS = ['work', 'layout', 'scope', 'task']

/** The board-page address for a board, on the same tab. */
function boardHref(projectId: string, boardId: string, tab: BoardTab) {
  return paths.classProjectBoard(projectId, boardId) + (tab === 'overview' ? '' : `?tab=${tab}`)
}

/**
 * The compact header of a group's (or a student's) page: where it sits in the
 * class, whose board it is, and a step to the previous and next one.
 */
export function BoardHeader({
  project,
  t,
  boardId,
}: {
  project: ProjectSummary
  t: ProjectTasks
  boardId: string
}) {
  const [params] = useSearchParams()
  const tab = readBoardTab(params)
  const label = boardLabel(project.audience === 'individual')
  const { prev, next } = adjacentBoards(t.boards ?? [], boardId)
  const board = t.active
  const leader = boardLeader(t.progress)

  const step = (id: string | null, dir: 'Previous' | 'Next') => {
    const body = (
      <>
        {dir === 'Previous' && <Icon name="chevronLeft" size={15} />}
        <span className="hidden sm:inline">{dir}</span>
        {dir === 'Next' && <Icon name="chevronRight" size={15} />}
      </>
    )
    const look = cls({ variant: 'outline', size: 'sm', className: '!px-3', children: body })
    const aria = `${dir} ${label.one}`
    return id ? (
      <Link to={boardHref(project.id, id, tab)} aria-label={aria} className={look}>
        {body}
      </Link>
    ) : (
      <button type="button" disabled aria-label={aria} className={look}>
        {body}
      </button>
    )
  }

  return (
    <header className="space-y-3">
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-muted">
          <li className="min-w-0 truncate">
            <Link to={paths.class(project.class_id)} className="hover:text-ink hover:underline">
              {project.class_initial}
            </Link>
          </li>
          <li aria-hidden className="text-faint">›</li>
          <li className="min-w-0 max-w-full truncate">
            <Link to={paths.classProject(project.id)} className="hover:text-ink hover:underline">
              {project.title}
            </Link>
          </li>
          <li aria-hidden className="text-faint">›</li>
          <li>
            <Link to={paths.classProject(project.id)} className="hover:text-ink hover:underline">
              {label.title}
            </Link>
          </li>
        </ol>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate">{board ? boardOwnerName(board) : t.boards === null ? 'Loading…' : ''}</h1>
          {board && project.audience === 'group' && (
            <p className="mt-1 text-[13px] text-muted">
              {leader && <>Leader {leader} · </>}
              {board.member_count} {board.member_count === 1 ? 'member' : 'members'}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {step(prev, 'Previous')}
          {step(next, 'Next')}
        </div>
      </div>
    </header>
  )
}

/**
 * One group's (or one student's) work in a class project, as its professor
 * reads it: Overview, Plan, Files, and Hand-in & grade, in `?tab=`.
 */
export function BoardPage({
  project,
  t,
  viewerId,
}: {
  project: ProjectSummary
  t: ProjectTasks
  viewerId?: string
}) {
  const [params, setParams] = useSearchParams()
  const tab = readBoardTab(params)

  const changeTab = useCallback(
    (next: BoardTab) => {
      const changed = new URLSearchParams(params)
      if (next === 'overview') changed.delete('tab')
      else changed.set('tab', next)
      for (const key of TAB_PARAMS) changed.delete(key)
      setParams(changed, { replace: true })
    },
    [params, setParams],
  )

  const tabs: Tab<BoardTab>[] = [
    { id: 'overview', label: 'Overview', icon: 'chart' },
    { id: 'plan', label: 'Plan', icon: 'kanban' },
    { id: 'files', label: 'Files', icon: 'folder' },
    { id: 'grade', label: 'Hand-in & grade', icon: 'checkCircle' },
  ]

  const board = t.active

  return (
    <>
      <div className="mt-6">
        <Tabs<BoardTab> tabs={tabs} active={tab} onChange={changeTab} variant="panel" />
      </div>

      <div className="mt-6 space-y-6">
        {t.error && <Alert tone="error">{t.error}</Alert>}
        {!board ? (
          <Loading />
        ) : (
          <>
            {tab === 'overview' && <BoardOverview project={project} t={t} board={board} viewerId={viewerId} />}
            {tab === 'plan' && <BoardPlan t={t} viewerId={viewerId} />}
            {tab === 'files' && (
              <p className="rounded-card border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
                Files open in the next update.
              </p>
            )}
            {tab === 'grade' && <BoardGrade project={project} t={t} board={board} />}
          </>
        )}
      </div>

      {/* Over any tab: a task opened from the board, the list or a link. */}
      <TaskDetailModal
        taskId={t.openTask}
        onClose={() => t.showTask(null)}
        viewerId={viewerId}
        role="professor"
        boardWeight={t.weightByBoard.get(t.rows.find((r) => r.id === t.openTask)?.board_id ?? '') ?? 0}
        // A professor is never locked out of a task by the project closing.
        locked={false}
        onChanged={t.refresh}
      />
    </>
  )
}

function Loading() {
  return (
    <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
      <Spinner size={16} />
      Loading that board…
    </div>
  )
}

/** One figure on the progress strip. */
function Cell({ value, label, tone }: { value: ReactNode; label: string; tone?: 'danger' }) {
  return (
    <div className="min-w-0 surface px-4 py-3.5">
      <p
        className={`truncate font-display text-[20px] font-semibold leading-tight ${
          tone === 'danger' ? 'text-danger-600 dark:text-danger-300' : 'text-ink'
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-[12px] text-muted">{label}</p>
    </div>
  )
}

function BoardOverview({
  project,
  t,
  board,
  viewerId,
}: {
  project: ProjectSummary
  t: ProjectTasks
  board: BoardSummary
  viewerId?: string
}) {
  const solo = project.audience === 'individual'
  const stages = stagesOf(project.stages)
  const stage = boardStage(t.tasks, stages)
  const top = topShare(t.progress)
  // A professor's rows cover the project; this page is one board's.
  const rows = t.scope.filter((r) => r.board_id === board.id)

  return (
    <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-[var(--line)] lg:grid-cols-4">
        <Cell value={<span className="font-mono">{board.done_pct}%</span>} label="done" />
        <Cell value={stage ?? '—'} label="stage" />
        <Cell
          value={<span className="font-mono">{board.late_count}</span>}
          label="late"
          tone={board.late_count > 0 ? 'danger' : undefined}
        />
        {solo ? (
          <Cell value={<span className="font-mono">{board.task_count}</span>} label="tasks" />
        ) : (
          <Cell
            value={top ? <>{top.name} <span className="font-mono">{top.pct}%</span></> : '—'}
            label="top share"
          />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.6fr)] xl:items-start">
        <BoardProgress board={board} />
        <MemberProgress rows={t.progress} title="Share of the group" dense />
      </div>

      <div className="space-y-3">
        {t.sprints.length > 0 && (
          <ScopePicker value={t.sprintScope} options={scopeOptions(t.sprints)} onChange={t.setSprintScope} />
        )}
        <TaskViewSwitch view={t.view} onView={t.setView} shown={t.shown.length} total={rows.length} />
        {/* The board is the page, so it stays out of the filter and out of its count. */}
        <TaskFilterBar
          filters={{ ...t.filters, board: '' }}
          onChange={(f) => t.setFilters({ ...f, board: board.id })}
          scope={rows}
          boards={t.boards ?? []}
          showBoards={false}
        />

        {t.view === 'list' && (
          <TaskList
            rows={t.shown}
            boardWeight={t.weightByBoard}
            showOwner={false}
            ownerLabel={solo ? 'Student' : 'Group'}
            ownerFor={t.ownerFor}
            onOpen={t.showTask}
            stages={stages}
          />
        )}
        {t.view === 'board' &&
          (t.boardLoading ? (
            <Loading />
          ) : (
            <TaskBoard
              board={board}
              tasks={t.boardTasks}
              totalWeight={boardWeight(t.tasks)}
              members={t.members}
              progress={t.progress}
              viewerId={viewerId}
              role="professor"
              canWork={false}
              stages={project.stages}
              onChanged={t.refresh}
            />
          ))}
        {t.view === 'timeline' && (
          <TimelineView
            tasks={classTimelineTasks(t.shown, false)}
            groups={[]}
            span={NO_SPAN}
            bands={sprintBands(t.sprints)}
            marks={milestoneMarks(t.milestones)}
            looseLabel={boardOwnerName(board)}
            onOpen={t.showTask}
          />
        )}
        {t.view === 'calendar' && (
          <TaskCalendar
            events={[
              ...taskCalendarEvents(t.shown),
              ...sprintCalendarEvents(t.sprints),
              ...milestoneCalendarEvents(t.milestones),
            ]}
            onOpen={t.showTask}
          />
        )}
      </div>
    </>
  )
}

/** The group's backlog and sprints, as they keep them; `?work=` picks one. */
function BoardPlan({ t, viewerId }: { t: ProjectTasks; viewerId?: string }) {
  const [params] = useSearchParams()
  const part = params.get('work') === 'sprints' ? 'sprints' : 'backlog'
  const source = classWorkSource(t, viewerId)

  return (
    <div className="space-y-4">
      <div className="surface-sunken flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg p-0.5">
        {(['backlog', 'sprints'] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={part === p}
            onClick={() => t.setSection(p)}
            className={`flex shrink-0 items-center rounded-md px-3 py-1.5 text-[13px] transition-colors ${
              part === p ? 'surface font-medium text-ink ring-1 ring-[var(--line-strong)]' : 'text-muted hover:text-ink'
            }`}
          >
            {p === 'backlog' ? 'Backlog' : 'Sprints'}
          </button>
        ))}
      </div>
      {source &&
        (part === 'backlog' ? (
          <BacklogView source={source} />
        ) : (
          <SprintsView source={source} milestones={t.milestones} onPlan={() => t.setSection('backlog')} />
        ))}
    </div>
  )
}

/** The verdict on the hand-in, the score against the rubric, and the group's peer results. */
function BoardGrade({ project, t, board }: { project: ProjectSummary; t: ProjectTasks; board: BoardSummary }) {
  const scores = useProjectScores(project.id, [board.id])

  return (
    <div className="space-y-4">
      <BoardVerdict board={board} role="professor" onChanged={t.refresh} />
      <ScoreCard key={board.id} board={board} scores={scores} />
      {project.audience === 'group' && <PeerRoundsPanel projectId={project.id} boardId={board.id} />}
    </div>
  )
}
