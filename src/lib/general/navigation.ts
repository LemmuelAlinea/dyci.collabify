import type { GeneralSpaceSummary } from './types'
import { workSection } from '../work/nav'

export type GeneralTabId = 'overview' | 'plan' | 'tasks' | 'conversations' | 'files' | 'people'

const TABS = new Set<GeneralTabId>(['overview', 'plan', 'tasks', 'conversations', 'files', 'people'])

const LEGACY: Record<string, GeneralTabId> = {
  'project-progress': 'overview',
  discussion: 'conversations',
  feedback: 'conversations',
  shared: 'files',
  members: 'people',
}

export function generalTab(params: URLSearchParams): GeneralTabId {
  const raw = params.get('tab') ?? ''
  if (raw === 'tasks' && params.get('work') === 'sprints') return 'plan'
  if (params.has('task') && (raw === 'overview' || raw === 'plan' || raw === 'tasks')) return raw
  if (raw === 'tasks') return 'tasks'
  if (raw === 'work' || raw === 'progress' || (!raw && params.has('work'))) {
    const section = workSection(params, 'tasks')
    return section === 'summary' ? 'overview' : section === 'backlog' || section === 'milestones' || section === 'sprints' ? 'plan' : 'tasks'
  }
  if (params.has('task')) return 'tasks'
  const value = (LEGACY[raw] ?? raw) as GeneralTabId
  return TABS.has(value) ? value : 'overview'
}

export function milestoneParams(params: URLSearchParams, id: string): URLSearchParams {
  const next = new URLSearchParams(params)
  next.set('tab', 'plan')
  next.set('work', 'milestones')
  next.set('milestone', id)
  next.delete('task')
  return next
}

export function spaceRouteId(pathname: string): string | null {
  const id = /^\/spaces\/([^/]+)/.exec(pathname)?.[1] ?? null
  return id === 'archive' ? null : id
}

export function projectRouteId(pathname: string): string | null {
  return /^\/projects\/([^/]+)/.exec(pathname)?.[1] ?? null
}

export function chooseLandingSpace(
  spaces: readonly GeneralSpaceSummary[],
  rememberedId: string | null,
): string | null {
  const live = spaces.filter((space) => space.kind === 'work' && !space.archived_at && space.my_level)
  if (rememberedId && live.some((space) => space.id === rememberedId)) return rememberedId
  return live.length === 1 ? live[0].id : null
}
