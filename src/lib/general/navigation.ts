import type { GeneralSpaceSummary } from './types'

export type GeneralTabId = 'overview' | 'discussion' | 'work' | 'files' | 'shared' | 'members'

const TABS = new Set<GeneralTabId>(['overview', 'discussion', 'work', 'files', 'shared', 'members'])

/** Work replaced two tabs; links written before it still name them. */
const LEGACY: Record<string, GeneralTabId> = { tasks: 'work', progress: 'work' }

export function generalTab(params: URLSearchParams): GeneralTabId {
  if (params.has('task')) return 'work'
  const raw = params.get('tab') ?? ''
  const value = (LEGACY[raw] ?? raw) as GeneralTabId
  return TABS.has(value) ? value : 'overview'
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
