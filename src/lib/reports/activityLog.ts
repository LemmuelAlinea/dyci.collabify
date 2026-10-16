import type { Tone } from '../analyticsMath'
import { manilaDay } from '../analyticsMath'
import type { ReportEventRow, TaskEventKind } from '../types'
import type { Block, Cell, ReportDoc } from './doc'
import type { ReportHead } from './grading'
import { rangeText } from './range'
import type { DayRange } from './range'

/** Rows drawn on screen and in print. Excel and CSV carry every row. */
export const EVENT_CAP = 500

export const EVENT_META: Record<TaskEventKind, { label: string; tone: Tone }> = {
  created: { label: 'Created', tone: 'pending' },
  edited: { label: 'Edited', tone: 'pending' },
  claimed: { label: 'Claimed', tone: 'pending' },
  unclaimed: { label: 'Handed back', tone: 'warning' },
  assigned: { label: 'Assigned', tone: 'pending' },
  started: { label: 'Started', tone: 'pending' },
  finished: { label: 'Finished', tone: 'success' },
  reopened: { label: 'Reopened', tone: 'warning' },
  commented: { label: 'Commented', tone: 'pending' },
  logged: { label: 'Logged time', tone: 'pending' },
  file_added: { label: 'Added a file', tone: 'pending' },
  file_removed: { label: 'Removed a file', tone: 'warning' },
}

export type ActivityFilters = { kinds: TaskEventKind[]; projectId: string; boardId: string; actorId: string }

/** An id the address carries that this class does not have reads as no filter, not as an empty log. */
export function activityFilters(
  raw: ActivityFilters,
  known: { projects: ReadonlySet<string>; boards: ReadonlySet<string>; actors: ReadonlySet<string> },
): ActivityFilters {
  return {
    kinds: raw.kinds.filter((k) => Object.hasOwn(EVENT_META, k)),
    projectId: known.projects.has(raw.projectId) ? raw.projectId : '',
    boardId: known.boards.has(raw.boardId) ? raw.boardId : '',
    actorId: known.actors.has(raw.actorId) ? raw.actorId : '',
  }
}

export function activityLogDoc(input: ReportHead & {
  range: DayRange
  events: ReportEventRow[]
  filters: ActivityFilters
  /** What the page calls the chosen project, group and person, for the header. */
  labels: { project: string | null; board: string | null; actor: string | null }
}): ReportDoc {
  const { range, filters } = input
  const shown = input.events
    .filter((e) => {
      const day = manilaDay(e.at)
      return day >= range.from && day <= range.to
    })
    .filter((e) => filters.kinds.length === 0 || filters.kinds.includes(e.kind))
    .filter((e) => !filters.projectId || e.project_id === filters.projectId)
    .filter((e) => !filters.boardId || e.board_id === filters.boardId)
    .filter((e) => !filters.actorId || e.actor_id === filters.actorId)
    // Newest first: capped on screen, the recent events are the ones a dispute is about.
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id))

  const blocks: Block[] = []
  if (shown.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'No activity in these dates. Widen the dates or clear a filter.' })
  } else {
    blocks.push({
      kind: 'table',
      id: 'events',
      title: 'Events',
      cap: EVENT_CAP,
      columns: [
        { key: 'time', label: 'Time', type: 'datetime' },
        { key: 'who', label: 'Who', type: 'text' },
        { key: 'event', label: 'Event', type: 'status' },
        { key: 'task', label: 'Task', type: 'text' },
        { key: 'board', label: 'Group or student', type: 'text' },
        { key: 'project', label: 'Project', type: 'text' },
        { key: 'detail', label: 'Detail', type: 'text' },
      ],
      rows: shown.map<Cell[]>((e) => {
        const meta = EVENT_META[e.kind] ?? { label: e.kind, tone: 'pending' as const }
        return [
          e.at,
          e.actor_name ?? 'Not recorded',
          { value: meta.label, tone: meta.tone },
          e.task_title,
          e.board_name ?? 'A board',
          e.project_archived_at ? { value: e.project_title, tag: 'Archived', tone: 'pending' } : e.project_title,
          e.detail || null,
        ]
      }),
    })
  }

  const parts = [
    filters.kinds.length ? filters.kinds.map((k) => EVENT_META[k].label).join(', ') : null,
    filters.projectId ? `Project: ${input.labels.project ?? 'one project'}` : null,
    filters.boardId ? `Group: ${input.labels.board ?? 'one group'}` : null,
    filters.actorId ? `Who: ${input.labels.actor ?? 'one person'}` : null,
  ].filter(Boolean)

  return {
    header: {
      title: 'Activity log',
      subtitle: rangeText(range),
      classLine: input.classLine,
      rangeLabel: parts.length ? parts.join(' · ') : null,
      madeAt: input.madeAt,
    },
    blocks,
    footer: {
      lines: ['Times are Manila time, to the minute.', 'Archived and deleted tasks are left out, and so is their history.'],
      signatures: [{ role: 'Prepared by', name: input.professor }],
    },
  }
}
