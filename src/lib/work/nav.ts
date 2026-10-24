import type { ProjectRole } from '../general/permissions'

/**
 * Where you are inside a project's Work tab, kept in the address so a link,
 * a reload or the back button lands on the same section and layout.
 *
 * `work` names the section and `layout` names how Tasks are drawn. Both are
 * their own keys because `view` is already taken by the Files tab
 * (`?tab=files&view=draft`).
 */
export type WorkSection = 'summary' | 'backlog' | 'sprints' | 'tasks' | 'milestones' | 'qa'
export type TaskLayout = 'board' | 'list' | 'timeline' | 'calendar'

export const WORK_SECTIONS: readonly WorkSection[] = ['summary', 'backlog', 'sprints', 'tasks', 'milestones', 'qa']

/**
 * The sections this viewer is offered. The QA queue shows once the project has
 * active QA, and for QA and the project manager even before it does, so they
 * can see where it will appear.
 */
export function workSectionsFor(gate: { hasQa: boolean; role: ProjectRole | null }): readonly WorkSection[] {
  const queue = gate.hasQa || gate.role === 'qa' || gate.role === 'pm'
  return queue ? WORK_SECTIONS : WORK_SECTIONS.filter((s) => s !== 'qa')
}
export const TASK_LAYOUTS: readonly TaskLayout[] = ['board', 'list', 'timeline', 'calendar']

/** The tab names Work replaced. Links written before it still arrive with them. */
const LEGACY_TABS = new Set(['tasks', 'progress'])

export function workSection(params: URLSearchParams, fallback: WorkSection): WorkSection {
  const named = params.get('work')
  if (named && (WORK_SECTIONS as readonly string[]).includes(named)) return named as WorkSection
  if (params.get('tab') === 'progress') return 'summary'
  if (params.get('tab') === 'tasks' || params.has('board') || params.has('task')) return 'tasks'
  return fallback
}

export function taskLayout(params: URLSearchParams): TaskLayout {
  const named = params.get('layout')
  return named && (TASK_LAYOUTS as readonly string[]).includes(named) ? (named as TaskLayout) : 'board'
}

export function withWork(
  params: URLSearchParams,
  patch: { section?: WorkSection; layout?: TaskLayout; scope?: string },
): URLSearchParams {
  const next = new URLSearchParams(params)
  if (patch.section) next.set('work', patch.section)
  if (patch.layout) next.set('layout', patch.layout)
  if (patch.scope) next.set('scope', patch.scope)
  if (LEGACY_TABS.has(next.get('tab') ?? '')) next.set('tab', 'work')
  return next
}
