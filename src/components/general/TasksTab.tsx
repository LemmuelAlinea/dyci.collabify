// src/components/general/TasksTab.tsx
import { EstimateSpent } from './TaskTimer'
import { newTaskRoom, projectCovers, type NewTaskRoom } from '../../lib/api/workload'
import { WorkloadPlanDialog } from './WorkloadPlanDialog'
import { formatDayLabel, formatDayRange, formatHours, manilaToday } from '../../lib/work/hours'
import { useAwayRanges } from '../../lib/work/useAwayRanges'
import { awayText } from '../../lib/work/away'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from '../app/Avatar'
import { BoardColumn, MoveToStage } from '../tasks/BoardColumn'
import { StageBadge, StageSelect } from '../tasks/StageSelect'
import { useBoardDrag } from '../tasks/useBoardDrag'
import type { BoardDrag } from '../tasks/useBoardDrag'
import { TaskViewMenu } from '../tasks/TaskViewSwitch'
import { Alert } from '../ui/Alert'
import { CheckboxList } from '../ui/CheckboxList'
import { Button } from '../ui/Button'
import { BoardScroller } from './BoardScroller'
import { TaskRoutingPanel } from './TaskRoutingPanel'
import { TasksFromNotes } from './TasksFromNotes'
import { EmptyState } from '../ui/EmptyState'
import { Field, Input } from '../ui/Field'
import { FilterField, FilterPopover, FilterSearch } from '../ui/FilterPopover'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { createMemberTask, createOpenTask, createTask, updateTask } from '../../lib/api/general'
import { suggestEstimateFromText } from '../../lib/api/workAi'
import { parseHours } from '../../lib/work/hours'
import { useHolderHours } from '../../lib/work/useHolderHours'
import { authErrorMessage } from '../../lib/authError'
import { stageText } from '../../lib/work/stageTerms'
import { formatDue, fromLocalInput, isOverdue } from '../../lib/general/dates'
import { DEFAULT_MEMBER_RULES, canCreateWorkTask, canCreateWorkTaskWith, canEditTask, holderCandidates } from '../../lib/general/permissions'
import { EMPTY_PRIORITY_VIEW, filterByPriority, priorityActive, prioritySummary, sortByPriority } from '../../lib/general/taskFilters'
import { DEFAULT_TASK_RULES, blockersOf, subtasksOf, taskMarkIndex } from '../../lib/general/taskRules'
import type { TaskMarkData } from '../../lib/general/taskRules'
import { projectProgress } from '../../lib/general/progress'
import { routingViewer, routingWaitingCount, showsRouting } from '../../lib/general/routing'
import { STAGE_TONE, nextStep, stageIndex, stagesOf, statusForStage } from '../../lib/stages'
import type { GeneralTaskStatus } from '../../lib/general/progress'
import { PRIORITIES, taskTypeOf } from '../../lib/general/types'
import { defaultTypeSet, removedNames, resolveType, typeOptions as buildTypeOptions } from '../../lib/taskTypes/typeSet'
import type { GeneralTask, TaskKind, TaskPriority } from '../../lib/general/types'
import { LIMIT } from '../../lib/limits'
import { formatMinutes } from '../../lib/types'
import { landingIndex, workDropRefusal } from '../../lib/work/boardDrop'
import { reachedIn } from '../../lib/work/milestones'
import { QA_PASSES } from '../../lib/work/qa'
import { milestoneCalendarEvents, sprintCalendarEvents, taskCalendarEvents } from '../../lib/work/calendar'
import type { TaskLayout } from '../../lib/work/nav'
import { applyScope, scopeOptions, scopeSprintId, scopeTargetSprint } from '../../lib/work/scope'
import type { TaskScope } from '../../lib/work/scope'
import { filterByTeam, teamSelection } from '../../lib/work/teamFilter'
import { milestoneMarks, sprintBands } from '../../lib/work/timeline'
import { ScopePicker } from '../work/ScopePicker'
import { TaskCalendar } from '../work/TaskCalendar'
import { TimelineView } from '../work/TimelineView'
import { TypeChip } from '../taskTypes/TypeChip'
import { TypePicker } from '../taskTypes/TypePicker'
import { PriorityBadge } from './PriorityBadge'
import { PriorityFilter } from './PriorityFilter'
import { SubtaskCount, WaitingMarker } from './TaskMarks'
import { usePriorityView } from './usePriorityView'
import { PersonBadge } from './RoleBadge'
import { useTeamFilter } from '../work/useTeamFilter'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * A work project's tasks: Board, List, Timeline and Calendar over the same
 * filtered set. Summary lives beside it in Work (WorkSummary.tsx).
 */
export function TasksTab({
  state,
  layout,
  onLayout,
  scope,
  onScope,
  onOpenTask,
  onViewBoard,
}: {
  state: GeneralProjectState
  layout: TaskLayout
  onLayout: (l: TaskLayout) => void
  scope: TaskScope
  onScope: (s: TaskScope) => void
  onViewBoard: () => void
  onOpenTask: (id: string | null) => void
}) {
  const { show } = useToast()
  // Open covers on a work project's tasks: one read for the board's markers.
  const [covers, setCovers] = useState<Map<string, { away_id: string; until: string }>>(new Map())
  const coverProject = state.project && !state.project.class_board_id ? state.project.id : null
  const taskStamp = state.tasks.map((t) => `${t.id}:${t.assignee_ids.join('.')}`).join(',')
  useEffect(() => {
    if (!coverProject) return
    let current = true
    projectCovers(coverProject)
      .then((rows) => { if (current) setCovers(new Map(rows.map((r) => [r.task_id, r]))) })
      .catch(() => {})
    return () => { current = false }
  }, [coverProject, taskStamp])
  const [query, setQuery] = useState('')
  const [team, setTeam] = useTeamFilter(state.project?.id, state.viewerId, state.teams)
  const [assignee, setAssignee] = useState('')
  // A stage index as text, or '' for every stage.
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  // Which priorities to show, and whether to sort by priority; remembered per project.
  const [priorityView, setPriorityView] = usePriorityView(state.project?.id)
  const [creating, setCreating] = useState(false)
  const [fromNotes, setFromNotes] = useState(false)
  const [routingOpen, setRoutingOpen] = useState(false)
  const showTask = onOpenTask

  const project = state.project
  const stages = stagesOf(project?.stages)
  const released = useMemo(() => state.tasks.filter(t => project?.class_board_id || (t.routing_state ?? 'released') === 'released'), [state.tasks, project?.class_board_id])
  const scoped = useMemo(() => applyScope(released, scope, state.sprints), [released, scope, state.sprints])
  // Subtask counts and blockers for every card, from lookups built once per change.
  const dependencies = state.dependencies
  const marksFor = useMemo(() => taskMarkIndex(released, dependencies ?? []), [released, dependencies])
  const ownUnsentBugs = state.myRole === 'qa' && !project?.class_board_id && state.viewerId
    ? state.tasks.filter(t => t.created_by === state.viewerId && t.kind === 'bug' && t.routing_state && t.routing_state !== 'released')
    : []
  const projectStages = state.project?.stages
  const teamLinks = state.teamMembers
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const stageCount = stagesOf(projectStages).length
    const matching = filterByTeam(scoped, teamSelection(teamLinks, team), (t) => ({ teamId: t.team_id, holders: t.assignee_ids }))
      .filter((t) =>
        assignee === ''
          ? true
          : assignee === 'nobody'
            ? t.assignee_ids.length === 0
            : t.assignee_ids.includes(assignee),
      )
      .filter((t) => (status ? stageIndex(t.status, t.stage, stageCount) === Number(status) : true))
      .filter((t) => (type ? taskTypeOf(t) === type : true))
      .filter((t) => (q ? `${t.title} ${t.description}`.toLowerCase().includes(q) : true))
    const byPriority = filterByPriority(matching, priorityView.priorities)
    return priorityView.sort === 'priority' ? sortByPriority(byPriority) : byPriority
  }, [scoped, query, team, teamLinks, assignee, status, type, projectStages, priorityView])

  if (!project) return null
  // The project's types in order, then names tasks still carry from types since removed.
  const typeSet = project.taskTypeSet ?? defaultTypeSet('work')
  const typeOptions = [
    ...buildTypeOptions(typeSet, { family: 'work' }).map((option) => ({ value: option.value, label: option.entry.name })),
    ...removedNames(typeSet, state.tasks.map((task) => task.task_type), 'work').map((name) => ({ value: name, label: `${name} (removed)` })),
  ]
  const progress = projectProgress(scoped)
  // Subtasks and waiting are a work project's; a class board's tasks have neither.
  const marksOf = (t: GeneralTask): TaskMarkData | null =>
    project.class_board_id ? null : marksFor(t)
  // What waits in Plan & route work for this viewer, by the panel's own rules.
  const waiting = routingWaitingCount(routingViewer(state), state.tasks)
  const unassigned = scoped.filter((t) => t.assignee_ids.length === 0 && t.status !== 'done').length
  // QA raises bugs and passes tasks; it does not draft task lists from notes.
  const mayDraft = project.class_board_id ? state.myRole !== 'qa' : canCreateWorkTask(state.myRole, 'task')
  const mayCreate = project.class_board_id || canCreateWorkTaskWith(state.myRole, state.myRole === 'qa' ? 'bug' : 'task', project.memberRules ?? DEFAULT_MEMBER_RULES, project.taskFlow)
  const assigneeOptions = [
    ...(state.viewerId ? [{ value: state.viewerId, label: 'Me' }] : []),
    { value: 'nobody', label: 'Nobody yet' },
    ...state.members
      .filter((m) => m.user_id !== state.viewerId)
      .map((m) => ({ value: m.user_id, label: state.nameOf(m.user_id) })),
  ]

  /**
   * Who may move a task along: whoever may change it (its holders, its creator
   * while nobody holds it, a leader of a holder, anyone who manages tasks).
   */
  const mayMove = (t: GeneralTask) =>
    canEditTask(
      {
        viewerId: state.viewerId,
        manageTasks: state.can('manage_tasks'),
        archived: state.readOnly,
        leadsUser: state.leadsUser,
        role: project.class_board_id ? null : state.myRole,
        holds: (id) => state.tasks.some((x) => x.id === id && x.assignee_ids.includes(state.viewerId ?? '')),
      },
      t,
    )

  /** Every stage change on this tab, the board's drag included. True when it went through. */
  async function move(t: GeneralTask, to: GeneralTaskStatus, stage: number) {
    try {
      await updateTask(t.id, { status: to, stage })
      await state.reload()
      return true
    } catch (err) {
      show(authErrorMessage(err, 'Could not move that task.'), 'error')
      return false
    }
  }

  return (
    <div className="space-y-4">
      {!project.class_board_id && (state.myRole === 'pm' || state.myRole === 'coordinator') && <>
        <Modal open={routingOpen} onClose={() => setRoutingOpen(false)} title="Plan & route work" size="xl">
          <TaskRoutingPanel key={project.id} state={state} onOpenTask={onOpenTask} onViewBoard={() => {
            setRoutingOpen(false)
            setQuery(''); setTeam(''); setAssignee(''); setStatus(''); setType(''); setPriorityView(EMPTY_PRIORITY_VIEW)
            onViewBoard()
          }} />
        </Modal>
      </>}
      {ownUnsentBugs.length > 0 && <section aria-label="Your unsent bugs" className="surface space-y-3 rounded-xl border border-line p-4 sm:p-5">
        <h3 className="text-[14px] font-semibold text-ink">Your unsent bugs</h3>
        <p className="text-[13px] text-muted">Planners review these bugs before sending them to a team.</p>
        <ul className="divide-y divide-line">
          {ownUnsentBugs.map(task => <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <button type="button" className="text-left text-[14px] font-medium break-words text-ink hover:underline" onClick={() => showTask(task.id)}>{task.title}</button>
            <span className="text-[12px] text-muted">{task.routing_state === 'coordinator_review' ? 'Coordinator review' : 'Planning'}</span>
          </li>)}
        </ul>
      </section>}
      {!project.class_board_id && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-ink">Released work</h3>
          {(state.myRole === 'pm' || state.myRole === 'coordinator') && showsRouting(project.taskFlow, state.tasks) && (
            <Button size="sm" variant="outline" aria-label={waiting > 0 ? `Plan & route work, ${waiting} waiting` : undefined} onClick={() => setRoutingOpen(true)}>
              Plan & route work
              {waiting > 0 && (
                <span aria-hidden="true" data-testid="routing-waiting" className="grid h-5 min-w-5 place-items-center rounded-full bg-badge px-1.5 font-mono text-[11px] font-bold text-badge-ink">
                  {waiting}
                </span>
              )}
            </Button>
          )}
        </div>
      )}
      {released.length > 0 && (
        <>
          <div className="flex items-center gap-2 sm:gap-3">
            <TaskViewMenu view={layout} onView={onLayout} />
            <FilterPopover
              label="Filter tasks"
              active={[query.trim(), team, assignee, status, type].filter(Boolean).length + priorityActive(priorityView)}
              summary={[
                query.trim() && `“${query.trim()}”`,
                team && state.teams.find((t) => t.id === team)?.name,
                assignee && assigneeOptions.find((o) => o.value === assignee)?.label,
                status && stages[Number(status)],
                type && typeOptions.find((option) => option.value === type)?.label,
                ...prioritySummary(priorityView),
              ]
                .filter(Boolean)
                .join(' · ')}
              onClear={() => {
                setQuery('')
                setTeam('')
                setAssignee('')
                setStatus('')
                setType('')
                setPriorityView(EMPTY_PRIORITY_VIEW)
              }}
            >
              <FilterField label="Search">
                <FilterSearch value={query} onChange={setQuery} placeholder="Title or description" />
              </FilterField>
              {state.teams.length > 0 && (
                <FilterField label="Team">
                  <Select
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                    placeholder="All teams"
                    options={state.teams.map((t) => ({ value: t.id, label: t.name }))}
                    className="!h-10 !text-[13px]"
                  />
                </FilterField>
              )}
              <FilterField label="Held by">
                <Select
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder="Anyone"
                  options={assigneeOptions}
                  className="!h-10 !text-[13px]"
                />
              </FilterField>
              <FilterField label="Stage">
                <Select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  placeholder="Every stage"
                  options={stages.map((name, i) => ({ value: String(i), label: name }))}
                  className="!h-10 !text-[13px]"
                />
              </FilterField>
              <FilterField label="Type">
                <Select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  placeholder="All"
                  options={typeOptions}
                  className="!h-10 !text-[13px]"
                />
              </FilterField>
              {!project.class_board_id && <PriorityFilter value={priorityView} onChange={setPriorityView} />}
            </FilterPopover>
            {state.sprints.length > 0 && (
              <div className="min-w-0 flex-1 sm:flex-none">
                <ScopePicker value={scope} options={scopeOptions(state.sprints, state.sprintSettings.terms)} onChange={onScope} />
              </div>
            )}
            <p className="ml-auto shrink-0 text-[12px] text-faint">
              {shown.length === scoped.length
                ? `${scoped.length} ${scoped.length === 1 ? 'task' : 'tasks'}`
                : `${shown.length} of ${scoped.length} tasks`}
            </p>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-[13px] text-muted">
          <strong className="text-ink">
            {progress.done} of {progress.total}
          </strong>{' '}
          done
          {progress.total > 0 && (
            <span className="text-faint">
              {' · '}
              {progress.pct}%
            </span>
          )}
          {unassigned > 0 && (
            <>
              {' · '}
              <span className="text-warning-700 dark:text-warning-300">{unassigned} with nobody on them</span>
            </>
          )}
        </p>
        {!state.readOnly && (
          <div className="flex flex-wrap gap-2">
            {mayDraft && (
              <Button size="sm" variant="outline" className="!rounded-lg" onClick={() => setFromNotes(true)}>
                <Icon name="spark" size={15} />
                From notes
              </Button>
            )}
            {mayCreate && (
              <Button size="sm" className="!rounded-lg" onClick={() => setCreating(true)}>
                <Icon name="plus" size={15} />
                Add task
              </Button>
            )}
          </div>
        )}
      </div>

      {state.tasks.length === 0 ? (
        <EmptyState
          icon="check"
          title="No tasks yet"
          body={project.class_board_id
            ? 'Break the project into pieces somebody can pick up. Anyone on the project can add one.'
            : project.taskFlow === 'open'
              ? 'Anyone on the project adds tasks and assigns them.'
              : state.myRole === 'member' && project.memberRules?.createTasks
              ? 'Tasks you add go to the project manager and coordinators for review.'
              : 'The project manager or a coordinator plans tasks, then sends them to a team.'}
          action={
            !state.readOnly && mayCreate ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button className="!rounded-xl" onClick={() => setCreating(true)}>
                  Add the first task
                </Button>
                {mayDraft && (
                  <Button variant="outline" className="!rounded-xl" onClick={() => setFromNotes(true)}>
                    <Icon name="spark" size={15} />
                    Draft from notes
                  </Button>
                )}
              </div>
            ) : undefined
          }
        />
      ) : scoped.length === 0 ? (
        <EmptyState
          icon="target"
          title={project.class_board_id ? 'No tasks here' : 'No released tasks here'}
          body={
            scope === 'backlog'
              ? stageText('Every released task is in a sprint.', state.sprintSettings.terms)
              : state.sprints.find((s) => s.id === scopeSprintId(scope, state.sprints))?.state === 'completed'
                ? stageText('Nothing was recorded in this sprint.', state.sprintSettings.terms)
                : stageText('This sprint has no tasks yet. Move some in from Backlog.', state.sprintSettings.terms)
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title="Nothing matches" body="No task fits these filters. Clear one and try again." />
      ) : layout === 'board' ? (
        <StageBoard
          tasks={shown}
          state={state}
          stages={stages}
          marksOf={marksOf}
          coverOf={(id) => {
            const c = covers.get(id)
            return c ? `Covering for ${state.nameOf(c.away_id)} until ${formatDayLabel(c.until)}` : null
          }}
          mayMove={mayMove}
          onMove={move}
          onOpen={showTask}
        />
      ) : layout === 'list' ? (
        <TaskTable tasks={shown} state={state} stages={stages} marksOf={marksOf} onOpen={showTask} mayMove={mayMove} onMove={async (t, to, stage) => { await move(t, to, stage) }} />
      ) : layout === 'timeline' ? (
        <TimelineView
          terms={state.sprintSettings.terms}
          tasks={shown.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            starts_at: t.starts_at,
            due_at: t.due_at,
            group_id: t.team_id,
            owner_names: t.assignee_ids.map(state.nameOf),
          }))}
          groups={state.teams}
          span={project}
          bands={sprintBands(state.sprints)}
          marks={milestoneMarks(state.milestones)}
          onOpen={showTask}
        />
      ) : (
        <TaskCalendar
          events={[
            ...taskCalendarEvents(shown, (t) => state.teams.find((x) => x.id === t.team_id)?.name ?? ''),
            ...sprintCalendarEvents(state.sprints),
            ...milestoneCalendarEvents(state.milestones, reachedIn(released, state.project?.milestoneRules?.completion)),
          ]}
          onOpen={showTask}
        />
      )}

      <NewTaskDialog
        open={creating && Boolean(mayCreate) && !state.readOnly}
        onClose={() => setCreating(false)}
        state={state}
        sprintId={state.can('manage_tasks') ? scopeTargetSprint(scope, state.sprints) : null}
        onCreated={showTask}
      />
      {mayDraft && <TasksFromNotes open={fromNotes} onClose={() => setFromNotes(false)} state={state} />}
    </div>
  )
}

/** The board: a column per stage, with cards that drag between them. */
function StageBoard({
  tasks,
  state,
  stages,
  marksOf,
  coverOf,
  mayMove,
  onMove,
  onOpen,
}: {
  tasks: GeneralTask[]
  state: GeneralProjectState
  stages: readonly string[]
  marksOf: (t: GeneralTask) => TaskMarkData | null
  coverOf: (taskId: string) => string | null
  mayMove: (t: GeneralTask) => boolean
  onMove: (t: GeneralTask, to: GeneralTaskStatus, stage: number) => Promise<boolean>
  onOpen: (id: string) => void
}) {
  const { show } = useToast()
  const count = stages.length
  const isClassBoard = Boolean(state.project?.class_board_id)
  const rules = isClassBoard ? null : (state.project?.taskRules ?? DEFAULT_TASK_RULES)

  const refusalOf = (t: GeneralTask, to: number) =>
    workDropRefusal({
      task: t,
      to,
      stageCount: count,
      qaBlocks: state.qaBlocks,
      rules,
      openSubtasks: subtasksOf(state.tasks, t.id).filter((c) => c.status !== 'done').length,
      blockers: blockersOf(state.dependencies ?? [], state.tasks, t.id),
      parentDone: state.tasks.some((p) => p.id === t.parent_id && p.status === 'done'),
    })

  const { attach, ...drag } = useBoardDrag({
    refusal: (id, column) => {
      const t = tasks.find((x) => x.id === id)
      return t ? refusalOf(t, column) : 'That task is no longer on this board.'
    },
    commit: async (id, column) => {
      const t = tasks.find((x) => x.id === id)
      return t ? onMove(t, statusForStage(column, count), column) : false
    },
    onRefused: (reason) => show(reason, 'error'),
  })

  // While its move is on the way a card reads as already being where it landed.
  const placed = tasks.map((t) => {
    const column = drag.pendingColumn(t.id)
    return column === undefined ? t : { ...t, status: statusForStage(column, count), stage: column }
  })
  const order = placed.map((t) => t.id)

  return (
    <div ref={attach} className="space-y-4">
      {/* Three stages share the width; more run side by side and scroll. */}
      <BoardScroller
        className={`-mx-1.5 grid gap-4 px-1.5 ${
          count === 3
            ? 'lg:grid-cols-3'
            : 'sm:grid-cols-2 lg:-my-1.5 lg:auto-cols-[minmax(250px,1fr)] lg:grid-flow-col lg:grid-cols-none lg:overflow-x-auto lg:pt-1.5 lg:pb-3.5'
        }`}
      >
        {stages.map((name, index) => {
          const column = placed.filter((t) => stageIndex(t.status, t.stage, count) === index)
          const movable = (t: GeneralTask) => mayMove(t) && drag.pendingColumn(t.id) === undefined
          return (
            <BoardColumn
              key={`${index}-${name}`}
              drag={drag}
              column={index}
              slotAt={drag.active ? landingIndex(order, column.map((t) => t.id), drag.active.id) : 0}
              header={
                <header className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
                  <h3 className={`truncate font-semibold ${STAGE_TONE[statusForStage(index, count)]}`}>{name}</h3>
                  <span className="font-mono text-[12px] text-faint">{column.length}</span>
                </header>
              }
              empty={
                <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12px] text-faint">
                  Nothing here
                </p>
              }
              cards={column.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  state={state}
                  canMove={mayMove(t)}
                  stages={stages}
                  marks={marksOf(t)}
                  cover={coverOf(t.id)}
                  drag={drag}
                  column={index}
                  draggable={movable(t)}
                  moveOptions={movable(t)
                    ? stages.flatMap((label, value) => (value !== index && !refusalOf(t, value) ? [{ value, label }] : []))
                    : []}
                  onMove={(to, stage) => void onMove(t, to, stage)}
                  onOpen={() => onOpen(t.id)}
                />
              ))}
            />
          )
        })}
      </BoardScroller>
      {drag.layer}
    </div>
  )
}

function Holders({ task, state, size = 22 }: { task: GeneralTask; state: GeneralProjectState; size?: number }) {
  const awayRanges = useAwayRanges(state.project && !state.project.class_board_id ? state.project.space_id : null)
  const today = manilaToday()
  const away = task.assignee_ids
    .map((id) => ({ id, text: awayText(awayRanges.get(id) ?? [], today, 'holder') }))
    .filter((a): a is { id: string; text: string } => a.text !== null)
  const awayChip = away.length > 0 && (
    <span data-away-chip title={away.map((a) => `${state.nameOf(a.id)}: ${a.text}`).join('; ')} className="shrink-0 rounded-md bg-warning-50 px-1.5 py-0.5 text-[11px] text-warning-700 dark:bg-warning-500/15 dark:text-warning-300">
      {away.length === 1 ? away[0].text : 'Away'}
    </span>
  )
  if (task.assignee_ids.length === 0) {
    return <span className="text-[12px] text-warning-700 dark:text-warning-300">Nobody yet</span>
  }
  const profiles = task.assignee_ids.map((id) => ({ id, profile: state.members.find((m) => m.user_id === id)?.profile }))
  const first = state.nameOf(task.assignee_ids[0])
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex shrink-0">
        {profiles.slice(0, 3).map(
          ({ id, profile }) =>
            profile && (
              <span
                key={id}
                title={state.nameOf(id)}
                className="-ml-1.5 rounded-full ring-2 ring-[var(--surface)] first:ml-0"
              >
                <Avatar profile={profile} size={size} />
              </span>
            ),
        )}
      </span>
      <span className="min-w-0 truncate text-[12px] text-muted">
        {task.assignee_ids.length > 1 ? `${first.split(' ')[0]} +${task.assignee_ids.length - 1}` : first}
      </span>
      {awayChip}
      {/* With several holders the name stands for the first of them, so a badge would point at one of many. */}
      {task.assignee_ids.length === 1 && (
        <span className="shrink-0">
          <PersonBadge userId={task.assignee_ids[0]} roles={state} />
        </span>
      )}
    </span>
  )
}

function TaskCard({
  task,
  state,
  canMove,
  stages,
  marks,
  cover,
  drag,
  column,
  draggable,
  moveOptions,
  onMove,
  onOpen,
}: {
  task: GeneralTask
  state: GeneralProjectState
  canMove: boolean
  stages: readonly string[]
  marks: TaskMarkData | null
  /** "Covering for Ivan until Fri 28 Nov" when someone holds it for an away holder. */
  cover?: string | null
  drag: BoardDrag
  column: number
  draggable: boolean
  moveOptions: { value: number; label: string }[]
  onMove: (to: GeneralTaskStatus, stage: number) => void
  onOpen: () => void
}) {
  const teamName = state.teams.find((t) => t.id === task.team_id)?.name
  const overdue = isOverdue(task.due_at, task.status)
  const yours = Boolean(state.viewerId && task.assignee_ids.includes(state.viewerId))
  const from = stageIndex(task.status, task.stage, stages.length)
  const next = nextStep(from, stages)
  const gated = state.qaBlocks(from, next.stage)

  return (
    <article
      {...drag.cardProps(task.id, column, draggable)}
      className={`surface group relative rounded-xl border p-3.5 shadow-card transition-[border-color,opacity] duration-200 ${
        yours
          ? 'border-warning-300 hover:border-warning-400 dark:border-warning-400/50'
          : 'border-line hover:border-line-strong'
      } ${drag.cardClass(task.id)}`}
    >
      {/* A stretched button rather than a wrapping one: the card holds its own controls. */}
      <button type="button" data-card-open="" onClick={onOpen} aria-label={`Open ${task.title}`} className="absolute inset-0 z-0 rounded-xl" />
      {/* The title keeps at least 8rem; badges that don't fit beside it wrap onto their own line. */}
      <div className="pointer-events-none flex flex-wrap items-start justify-between gap-x-2 gap-y-1.5">
        <h4
          className={`min-w-0 flex-[1_1_8rem] text-[14px] leading-snug font-medium break-words group-hover:underline ${
            task.status === 'done' ? 'text-muted line-through' : 'text-ink'
          }`}
        >
          {task.title}
        </h4>
        <div className="flex max-w-full min-w-0 flex-wrap items-center gap-1">
          {cover && (
            <span data-cover-marker title={cover} className="rounded-md bg-warning-50 px-1.5 py-0.5 text-[12px] text-warning-700 dark:bg-warning-500/15 dark:text-warning-300">
              Cover
            </span>
          )}
          <TypeChip entry={resolveType(state.project?.taskTypeSet ?? defaultTypeSet('work'), task, 'work')} />
          <PriorityBadge priority={task.priority} />
          {teamName && (
            <span className="max-w-[8rem] truncate rounded-md bg-navy-50 px-1.5 py-0.5 text-[12px] text-navy-700 dark:bg-navy-500/18 dark:text-navy-100">
              {teamName}
            </span>
          )}
        </div>
      </div>

      {task.description && (
        <p className="pointer-events-none mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-muted">
          {task.description}
        </p>
      )}

      {marks && (marks.partOf || marks.subtasks || marks.blockers.length > 0) && (
        <div className="pointer-events-none mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-faint">
          {marks.partOf && <span className="max-w-full truncate">{marks.partOf}</span>}
          <SubtaskCount progress={marks.subtasks} />
          <WaitingMarker blockers={marks.blockers} onOpen={onOpen} />
        </div>
      )}

      {task.estimated_minutes != null && (
        <p className="pointer-events-none mt-2 text-[12px]">
          <EstimateSpent estimate={task.estimated_minutes} spent={task.logged_minutes ?? 0} />
        </p>
      )}

      <div className="pointer-events-none mt-3 flex flex-wrap items-center justify-between gap-2">
        <Holders task={task} state={state} />
        {(task.file_count > 0 || task.comment_count > 0) && (
          <span className="flex items-center gap-3 text-[12px] text-faint">
            {task.file_count > 0 && (
              <span className="flex items-center gap-1" title="Files attached">
                <Icon name="file" size={12} />
                {task.file_count}
              </span>
            )}
            {task.comment_count > 0 && (
              <span className="flex items-center gap-1" title="Comments">
                <Icon name="message" size={12} />
                {task.comment_count}
              </span>
            )}
          </span>
        )}
        {task.due_at && (
          <span
            className={`flex items-center gap-1 font-mono text-[12px] ${
              overdue ? 'text-danger-600 dark:text-danger-400' : 'text-faint'
            }`}
          >
            <Icon name="clock" size={12} />
            {formatDue(task.due_at)}
          </span>
        )}
      </div>

      <div className="relative z-10 mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
        {canMove && gated ? (
          <span className="px-2 text-[12px] text-faint">{QA_PASSES}</span>
        ) : canMove ? (
          <button
            type="button"
            onClick={() => onMove(next.status, next.stage)}
            className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] font-medium text-navy-600 transition-colors hover:bg-[var(--surface-sunken)] dark:text-navy-200"
          >
            <Icon name={next.icon} size={14} />
            {next.label}
          </button>
        ) : (
          <span className="px-2 text-[12px] text-faint">
            {task.assignee_ids.length === 0 ? 'Open to the project' : 'Whoever is on it moves it'}
          </span>
        )}
        <div className="flex items-center gap-0.5">
          <MoveToStage title={task.title} options={moveOptions} onMove={(to) => drag.moveTo(task.id, to)} />
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Edit ${task.title}`}
            className="grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
          >
            <Icon name="edit" size={14} />
          </button>
        </div>
      </div>
    </article>
  )
}

function TaskTable({
  tasks,
  state,
  stages,
  marksOf,
  onOpen,
  mayMove,
  onMove,
}: {
  tasks: GeneralTask[]
  state: GeneralProjectState
  stages: readonly string[]
  marksOf: (t: GeneralTask) => TaskMarkData | null
  onOpen: (id: string) => void
  mayMove: (t: GeneralTask) => boolean
  onMove: (t: GeneralTask, to: GeneralTaskStatus, stage: number) => Promise<void>
}) {
  return (
    <div className="surface overflow-x-auto rounded-card border border-line shadow-card">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-[12px] tracking-wide text-faint uppercase">
            <th className="py-2.5 pr-3 pl-4 font-medium">Task</th>
            <th className="py-2.5 pr-3 font-medium">Held by</th>
            <th className="py-2.5 pr-3 font-medium">Stage</th>
            <th className="py-2.5 pr-3 font-medium">Due</th>
            <th className="py-2.5 pr-4 font-medium" />
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const overdue = isOverdue(t.due_at, t.status)
            const teamName = state.teams.find((x) => x.id === t.team_id)?.name
            const marks = marksOf(t)
            return (
              <tr key={t.id} className="border-b border-line transition-colors last:border-0 hover:bg-[var(--surface-sunken)]">
                <td className="py-2.5 pr-3 pl-4">
                  <button
                    type="button"
                    onClick={() => onOpen(t.id)}
                    className={`block max-w-[320px] truncate text-left text-[14px] font-medium hover:underline ${
                      t.status === 'done' ? 'text-muted line-through' : 'text-ink'
                    }`}
                  >
                    {t.title}
                  </button>
                  <span className="mt-0.5 flex items-center gap-3 text-[12px] text-faint">
                    <TypeChip entry={resolveType(state.project?.taskTypeSet ?? defaultTypeSet('work'), t, 'work')} />
                    <PriorityBadge priority={t.priority} />
                    {marks?.partOf && <span className="max-w-[200px] truncate">{marks.partOf}</span>}
                    <SubtaskCount progress={marks?.subtasks ?? null} />
                    <WaitingMarker blockers={marks?.blockers ?? []} onOpen={() => onOpen(t.id)} />
                    {teamName && <span>{teamName}</span>}
                    {t.file_count > 0 && (
                      <span className="flex items-center gap-1">
                        <Icon name="file" size={11} />
                        {t.file_count}
                      </span>
                    )}
                    {t.comment_count > 0 && (
                      <span className="flex items-center gap-1">
                        <Icon name="message" size={11} />
                        {t.comment_count}
                      </span>
                    )}
                    {t.logged_minutes > 0 && (
                      <span className="flex items-center gap-1">
                        <Icon name="clock" size={11} />
                        {formatMinutes(t.logged_minutes)}
                      </span>
                    )}
                  </span>
                </td>
                <td className="max-w-[180px] py-2.5 pr-3">
                  <Holders task={t} state={state} />
                </td>
                <td className="py-2.5 pr-3">
                  {mayMove(t) ? (
                    <StageSelect
                      status={t.status}
                      stage={t.stage}
                      stages={stages}
                      title={t.title}
                      blocked={(to) => state.qaBlocks(stageIndex(t.status, t.stage, stages.length), to)}
                      blockedReason={QA_PASSES}
                      onChange={(to, stage) => onMove(t, to, stage)}
                    />
                  ) : (
                    <StageBadge status={t.status} stage={t.stage} stages={stages} />
                  )}
                </td>
                <td className={`py-2.5 pr-3 font-mono text-[12px] ${overdue ? 'text-danger-600 dark:text-danger-400' : 'text-faint'}`}>
                  {t.due_at ? formatDue(t.due_at) : '—'}
                </td>
                <td className="py-2.5 pr-4 text-right">
                  <button
                    type="button"
                    onClick={() => onOpen(t.id)}
                    aria-label={`Open ${t.title}`}
                    className="grid h-7 w-7 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
                  >
                    <Icon name="chevronRight" size={15} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Adds a task: planned work goes to planning, open work is live with its holders. */
export function NewTaskDialog({
  open,
  onClose,
  state,
  sprintId,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  state: GeneralProjectState
  sprintId: string | null
  onCreated: (id: string) => void
}) {
  const { show } = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [due, setDue] = useState('')
  const [starts, setStarts] = useState('')
  const [team, setTeam] = useState('')
  const [pickedKind, setPickedKind] = useState<TaskKind>('task')
  const [pickedType, setPickedType] = useState('task')
  const [pickedPriority, setPickedPriority] = useState<TaskPriority | ''>('')
  const [holders, setHolders] = useState<string[]>([])
  const [estimate, setEstimate] = useState('')
  // Suggest estimate: busy, then the model's reason or why it failed.
  const [suggesting, setSuggesting] = useState(false)
  const [suggestion, setSuggestion] = useState<{ reason: string } | { error: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Holders this task would put over their hours, shown before it is added.
  const [over, setOver] = useState<NewTaskRoom[] | null>(null)
  // The task just added for Add and split with AI: Break down and balance opens on it.
  const [planFor, setPlanFor] = useState<string | null>(null)
  const project = state.project
  const work = Boolean(project && !project.class_board_id)
  // QA creates bug tasks only, so the type is fixed for them.
  const isQa = state.myRole === 'qa'
  const kind: TaskKind = isQa || (work ? pickedType === 'bug' : pickedKind === 'bug') ? 'bug' : 'task'
  const taskType = work && kind === 'task' && pickedType !== 'task' ? pickedType : null
  // An open project's tasks are live at once, with holders anyone picks; QA assigns nobody.
  const isOpen = work && project?.taskFlow === 'open'
  // A planned project's Member sends a plain task to the planners; it starts in planning and they cannot read it back.
  const isMember = work && !isOpen && state.myRole === 'member'
  const newTypeSet = project?.taskTypeSet ?? defaultTypeSet('work')
  const bugTypeName = newTypeSet.find((t) => t.slot === 'bug')?.name ?? 'Bug'
  // A planned project's QA bug goes to the planners, who set its priority.
  const showPriority = work && !isMember && (isOpen || !isQa)
  const showHolders = isOpen && !isQa
  const rules = project?.taskRules ?? DEFAULT_TASK_RULES
  const priority: TaskPriority = pickedPriority || rules.defaultPriority
  const candidates = showHolders ? holderCandidates(state.members, state.roleOf) : []
  // Planners see hours beside holders; there is no task yet, so a Member sees no room status here
  // and learns of a full person from the refusal when the task is added.
  const holderLabels = useHolderHours({
    spaceId: project?.space_id,
    userIds: candidates,
    taskId: null,
    viewer: open && showHolders && (state.myRole === 'pm' || state.myRole === 'coordinator') ? 'planner' : 'none',
  })
  const planner = state.myRole === 'pm' || state.myRole === 'coordinator'
  const canSplit = rules.allowSubtasks
  // A change to what the check read makes its answer stale.
  useEffect(() => setOver(null), [holders, estimate, starts, due])
  // The pause sits at the end of the form, where the buttons that answer it are.
  const overRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (over) overRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [over])
  const awayRanges = useAwayRanges(showHolders ? project?.space_id : null)
  const holderName = (uid: string) => {
    const hours = holderLabels.get(uid)
    const away = awayText(awayRanges.get(uid) ?? [], manilaToday(), 'picker')
    return [state.nameOf(uid), away, hours?.text].filter(Boolean).join(' · ')
  }

  async function suggest() {
    if (!project || suggesting) return
    setSuggesting(true)
    setSuggestion(null)
    try {
      const out = await suggestEstimateFromText(project.id, title.trim(), description)
      if (out.result === 'ok') {
        setEstimate(String(Math.round((out.minutes / 60) * 100) / 100))
        setSuggestion({ reason: out.reason })
      } else setSuggestion({ error: out.message })
    } catch (err) {
      setSuggestion({ error: authErrorMessage(err, 'Could not suggest an estimate. Try again.') })
    } finally {
      setSuggesting(false)
    }
  }

  function reset() {
    setTitle('')
    setDescription('')
    setDue('')
    setStarts('')
    setTeam('')
    setPickedKind('task')
    setPickedType('task')
    setPickedPriority('')
    setHolders([])
    setEstimate('')
    setSuggestion(null)
    setOver(null)
  }

  /** After Break down and balance closes on a task New task added: back to the board, on that task. */
  async function planDone(id: string) {
    setPlanFor(null)
    reset()
    onClose()
    await state.reload()
    onCreated(id)
  }

  /**
   * Adds the task. A planner adding holders and an estimate in an Open project
   * is first told who it would put over their hours (`check`); then `anyway`
   * adds it as it is and `split` adds it and opens Break down and balance.
   */
  async function create(mode: 'check' | 'anyway' | 'split' = 'check') {
    if (!project) return
    if (state.readOnly || (!project.class_board_id && !canCreateWorkTaskWith(state.myRole, kind, project.memberRules ?? DEFAULT_MEMBER_RULES, project.taskFlow))) return
    setError(null)
    if (!title.trim()) return setError('A task needs a title.')
    const startsAt = fromLocalInput(starts)
    const dueAt = fromLocalInput(due)
    if (startsAt && dueAt && startsAt > dueAt)
      return setError('A task cannot start after it is due. Move one of the two dates.')
    const estimateMinutes = isOpen ? parseHours(estimate) : null
    if (estimateMinutes === 'invalid') return setError('Enter the estimate in hours, up to 1000.')
    setBusy(true)
    try {
      if (mode === 'check' && isOpen && planner && showHolders && typeof estimateMinutes === 'number' && holders.length > 0) {
        // Advisory: a failed read never stops the task.
        const rows = await newTaskRoom(project.id, holders, estimateMinutes, startsAt, dueAt).catch(() => [])
        const past = rows.filter((r) => r.available_minutes != null && r.load_minutes + r.share_minutes > r.available_minutes)
        if (past.length > 0) {
          setOver(past)
          return
        }
      }
      if (isMember) {
        await createMemberTask(project.id, title, description, dueAt, team || undefined, taskType)
        show('Sent to planners for review')
        setTitle('')
        setDescription('')
        setDue('')
        setTeam('')
        setPickedType('task')
        onClose()
        await state.reload()
        return
      }
      const id = isOpen
        ? await createOpenTask({
            projectId: project.id,
            title,
            description,
            startsAt,
            dueAt,
            teamId: team || null,
            priority,
            kind,
            taskType,
            holderIds: showHolders ? holders : [],
            estimateMinutes,
          })
        : await createTask({
            projectId: project.id,
            title,
            description,
            dueAt,
            startsAt,
            teamId: team || null,
            sprintId,
            kind,
            taskType,
            ...(showPriority ? { priority } : {}),
          })
      show('Task added')
      if (mode === 'split') {
        setPlanFor(id)
        return
      }
      reset()
      onClose()
      await state.reload()
      onCreated(id)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not add that task.'))
    } finally {
      setBusy(false)
    }
  }

  if (planFor && project?.space_id) {
    const id = planFor
    return (
      <WorkloadPlanDialog
        parentId={id}
        projectId={project.id}
        spaceId={project.space_id}
        parentEstimateMinutes={typeof parseHours(estimate) === 'number' ? (parseHours(estimate) as number) : null}
        preselect={candidates}
        onClose={() => void planDone(id)}
        onSaved={(ids) => {
          show(ids.length === 1 ? '1 subtask created' : `${ids.length} subtasks created`)
          void planDone(id)
        }}
      />
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      description={isMember ? 'It goes to the project manager and coordinators for review. You won\'t see it until they send it.' : undefined}
      focusField
      footer={
        over ? (
          <>
            <Button variant="ghost" onClick={() => setOver(null)} disabled={busy}>
              Go back
            </Button>
            <Button variant="outline" onClick={() => void create('anyway')} disabled={busy}>
              Add anyway
            </Button>
            {canSplit && (
              <Button onClick={() => void create('split')} loading={busy}>
                <Icon name="spark" size={15} />
                Add and split with AI
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void create()} loading={busy}>
              Add task
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Title">
          {(id) => (
            <Input id={id} maxLength={LIMIT.taskTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {work && (
            <Field label="Type" hint={isQa ? `QA creates ${bugTypeName} tasks only.` : undefined}>
              {(id) => (
                <TypePicker
                  id={id}
                  label="Type"
                  value={isQa ? 'bug' : pickedType}
                  disabled={isQa}
                  onChange={setPickedType}
                  options={buildTypeOptions(newTypeSet, { family: 'work', role: isQa ? 'qa' : undefined, memberPlanned: isMember })}
                />
              )}
            </Field>
          )}
          {!isMember && (
            <>
              {!work && <Field label="Type" hint={isQa ? `QA creates ${bugTypeName} tasks only.` : undefined}>
                {(id) => (
                  <TypePicker
                    id={id}
                    label="Type"
                    value={kind}
                    disabled={isQa}
                    onChange={(value) => setPickedKind(value as TaskKind)}
                    options={buildTypeOptions(newTypeSet, { family: 'work', role: isQa ? 'qa' : undefined })}
                  />
                )}
              </Field>}
              <Field label="Starts" optional>
                {(id) => (
                  <Input id={id} type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
                )}
              </Field>
            </>
          )}
          <Field label="Due" optional>
            {(id) => <Input id={id} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />}
          </Field>
          {showPriority && (
            <Field label="Priority">
              {(id) => (
                <Select
                  id={id}
                  value={priority}
                  onChange={(e) => setPickedPriority(e.target.value as TaskPriority)}
                  options={PRIORITIES.map((x) => ({ value: x.value, label: x.label }))}
                />
              )}
            </Field>
          )}
          {showHolders && !rules.allowMultipleAssignees && (
            <Field label="Holder" optional>
              {(id) => (
                <Select
                  id={id}
                  value={holders[0] ?? ''}
                  onChange={(e) => setHolders(e.target.value ? [e.target.value] : [])}
                  placeholder="Nobody yet"
                  options={candidates.map((uid) => ({ value: uid, label: holderName(uid) }))}
                />
              )}
            </Field>
          )}
          {state.teams.length > 0 && (
            <Field label="Team" optional>
              {(id) => (
                <Select
                  id={id}
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  placeholder="Whole project"
                  options={state.teams.map((t) => ({ value: t.id, label: t.name }))}
                />
              )}
            </Field>
          )}
        </div>
        {showHolders && rules.allowMultipleAssignees && (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-ink">
              Holders<span className="ml-1.5 text-[12px] text-faint">optional</span>
            </p>
            <CheckboxList
              label="Holders"
              items={candidates.map((uid) => ({ id: uid, label: holderName(uid) }))}
              selected={holders}
              onChange={setHolders}
              searchable
              empty="Nobody on this project can hold tasks yet."
              maxHeight={160}
            />
          </div>
        )}
        {isOpen && (
          <Field
            label="Estimated effort (hours)"
            optional
            hint={
              <Button type="button" variant="ghost" size="sm" loading={suggesting} disabled={!title.trim()} onClick={() => void suggest()}>
                {!suggesting && <Icon name="spark" size={15} />}
                Suggest estimate
              </Button>
            }
            error={suggestion && 'error' in suggestion ? suggestion.error : undefined}
          >
            {(id) => (
              <>
                <Input id={id} type="number" min={0.25} max={1000} step="any" value={estimate} onChange={(e) => setEstimate(e.target.value)} />
                {suggestion && 'reason' in suggestion && (
                  <p className="text-[12px] leading-snug text-muted">
                    Suggested from the title and description. Check it before adding the task.
                    {suggestion.reason && <span className="mt-1 block text-faint">{suggestion.reason}</span>}
                  </p>
                )}
              </>
            )}
          </Field>
        )}
        <Field label="Description" optional>
          {(id) => (
            <Textarea
              id={id}
              rows={4}
              maxLength={LIMIT.generalDescription}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        {over && (
          <div ref={overRef} role="status" className="scroll-mb-4 space-y-2 rounded-xl border border-warning-300 bg-warning-50 px-4 py-3 dark:border-warning-400/40 dark:bg-warning-400/15">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-warning-800 dark:text-warning-300">
              <Icon name="alert" size={14} />
              This task puts {over.length === 1 ? 'someone' : 'people'} over their hours
            </p>
            <ul className="space-y-1 text-[13px] text-ink">
              {over.map((r) => (
                <li key={r.user_id}>
                  {state.nameOf(r.user_id)} would be {formatHours(r.load_minutes + r.share_minutes - (r.available_minutes ?? 0))} over:{' '}
                  {formatHours(r.load_minutes + r.share_minutes).replace(/ h$/, '')} / {formatHours(r.available_minutes ?? 0)} for{' '}
                  {formatDayRange(r.from_on, r.to_on)}.
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-muted">
              {canSplit
                ? 'Split it with AI to share the work with people who have the skills and the room, or add it as it is.'
                : 'Subtasks are off in this project, so it can’t be split here. Add it as it is, or go back and change the holders.'}
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
