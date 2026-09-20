import type { GeneralSpaceSummary } from './types'

export type GeneralTabId = 'overview' | 'tasks' | 'files' | 'progress' | 'members'

const TABS = new Set<GeneralTabId>(['overview', 'tasks', 'files', 'progress', 'members'])

export function generalTab(params: URLSearchParams): GeneralTabId {
  if (params.has('task')) return 'tasks'
  const value = params.get('tab') as GeneralTabId | null
  return value && TABS.has(value) ? value : 'overview'
}

export function spaceRouteId(pathname: string): string | null {
  return /^\/general\/spaces\/([^/]+)/.exec(pathname)?.[1] ?? null
}

export function projectRouteId(pathname: string): string | null {
  return /^\/general\/projects\/([^/]+)/.exec(pathname)?.[1] ?? null
}

export function chooseLandingSpace(
  spaces: readonly GeneralSpaceSummary[],
  rememberedId: string | null,
): string | null {
  const live = spaces.filter((space) => !space.archived_at && space.my_level)
  if (rememberedId && live.some((space) => space.id === rememberedId)) return rememberedId
  return live.length === 1 ? live[0].id : null
}
