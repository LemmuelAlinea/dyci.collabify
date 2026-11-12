import { paths } from './paths'
import { stageIndex } from './stages'
import type { BoardSummary, ProjectTask } from './types'

export type ProfessorProjectTab = 'groups' | 'brief' | 'tasks' | 'milestones' | 'grades'
export const PROFESSOR_PROJECT_TABS: readonly ProfessorProjectTab[] = [
  'groups', 'brief', 'tasks', 'milestones', 'grades',
]

export type BoardTab = 'overview' | 'plan' | 'files' | 'grade'
const BOARD_TABS: readonly BoardTab[] = ['overview', 'plan', 'files', 'grade']

const TASK_LAYOUTS = ['list', 'timeline', 'calendar']

/** The professor project tab an address means, old Work addresses included. */
export function readProfessorProjectTab(params: URLSearchParams): ProfessorProjectTab {
  const tab = params.get('tab')
  if (tab && (PROFESSOR_PROJECT_TABS as readonly string[]).includes(tab)) {
    return tab as ProfessorProjectTab
  }
  if (tab === 'work') {
    const work = params.get('work')
    if (work === 'milestones') return 'milestones'
    if (work === 'tasks') return 'tasks'
    return params.get('task') ? 'tasks' : 'groups'
  }
  if (!tab && params.get('task')) return 'tasks'
  return 'groups'
}

export function readBoardTab(params: URLSearchParams): BoardTab {
  const tab = params.get('tab')
  if (tab && (BOARD_TABS as readonly string[]).includes(tab)) return tab as BoardTab
  const work = params.get('work')
  if (work === 'backlog' || work === 'sprints') return 'plan'
  return 'overview'
}

function query(entries: [string, string | null][]): string {
  const out = new URLSearchParams()
  for (const [k, v] of entries) if (v) out.set(k, v)
  const s = out.toString()
  return s ? `?${s}` : ''
}

/**
 * Where an old professor link should go instead, or null when the address is
 * already in the new shape.
 */
export function legacyProfessorTarget(projectId: string, params: URLSearchParams): string | null {
  const tab = params.get('tab')
  const work = params.get('work')
  const board = params.get('board')
  const task = params.get('task')
  const layout = params.get('layout')
  const scope = params.get('scope')
  const base = paths.classProject(projectId)

  if (board) {
    const plan = work === 'backlog' || work === 'sprints'
    return paths.classProjectBoard(projectId, board) + query([
      ['tab', plan ? 'plan' : null],
      ['work', plan ? work : null],
      ['task', task],
    ])
  }

  const old = tab === 'work' || tab === 'progress' || tab === 'groups' ||
    tab === 'files' || tab === 'shared' || tab === 'discussion'
  const keepsTask = !tab && !!task
  if (!old && !keepsTask) return null

  if (tab === 'groups') return `${base}?manage=1`
  const next = readProfessorProjectTab(params)
  const keepLayout = next === 'tasks' && layout && TASK_LAYOUTS.includes(layout) ? layout : null
  return base + query([
    ['tab', next === 'groups' ? null : next],
    ['task', task],
    ['layout', keepLayout],
    ['scope', scope],
  ])
}

/** The earliest stage still holding open work, else the last stage; null when empty. */
export function boardStage(
  rows: Pick<ProjectTask, 'status' | 'stage'>[],
  stages: readonly string[],
): string | null {
  if (!rows.length || !stages.length) return null
  const idx = rows.map((r) => stageIndex(r.status, r.stage, stages.length))
  const open = rows.map((r, i) => (r.status === 'done' ? null : idx[i])).filter((n): n is number => n !== null)
  return stages[open.length ? Math.min(...open) : stages.length - 1] ?? null
}

export function adjacentBoards(
  boards: Pick<BoardSummary, 'id'>[],
  id: string,
): { prev: string | null; next: string | null } {
  const i = boards.findIndex((b) => b.id === id)
  if (i < 0) return { prev: null, next: null }
  return { prev: boards[i - 1]?.id ?? null, next: boards[i + 1]?.id ?? null }
}

export function boardLabel(solo: boolean): {
  one: 'group' | 'student'
  many: 'groups' | 'students'
  title: 'Groups' | 'Students'
} {
  return solo
    ? { one: 'student', many: 'students', title: 'Students' }
    : { one: 'group', many: 'groups', title: 'Groups' }
}
