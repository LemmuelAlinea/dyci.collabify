import type { GeneralSpaceSummary } from './types'
import { workSection } from '../work/nav'

export type GeneralTabId = 'overview' | 'plan' | 'tasks' | 'conversations' | 'files' | 'settings'

const TABS = new Set<GeneralTabId>(['overview', 'plan', 'tasks', 'conversations', 'files', 'settings'])

const LEGACY: Record<string, GeneralTabId> = {
  'project-progress': 'overview',
  discussion: 'conversations',
  feedback: 'conversations',
  shared: 'files',
  members: 'settings',
  people: 'settings',
}

/** `defaultTab` is the project's own default view: used only when the address names no tab and implies none. */
export function generalTab(params: URLSearchParams, defaultTab: GeneralTabId = 'overview'): GeneralTabId {
  const raw = params.get('tab') ?? ''
  if (raw === 'tasks' && params.get('work') === 'sprints') return 'plan'
  if (params.has('task') && (raw === 'overview' || raw === 'plan' || raw === 'tasks')) return raw
  if (raw === 'tasks') return 'tasks'
  if (raw === 'work' || raw === 'progress' || (!raw && params.has('work'))) {
    const section = workSection(params, 'tasks')
    return section === 'summary' ? 'overview' : section === 'backlog' || section === 'milestones' || section === 'sprints' ? 'plan' : 'tasks'
  }
  if (params.has('task')) return 'tasks'
  if (!raw) return defaultTab
  const value = (LEGACY[raw] ?? raw) as GeneralTabId
  return TABS.has(value) ? value : 'overview'
}

export type SettingsSection = 'general' | 'sprints' | 'tasks' | 'milestones' | 'members' | 'notifications' | 'workflow'

const SETTINGS_SECTIONS = new Set<SettingsSection>(['general', 'sprints', 'tasks', 'milestones', 'members', 'notifications', 'workflow'])

/** The section open inside Settings. Old People links (?tab=people, ?tab=members) open Members. */
export function settingsSection(params: URLSearchParams): SettingsSection {
  const raw = params.get('section') ?? ''
  if (SETTINGS_SECTIONS.has(raw as SettingsSection)) return raw as SettingsSection
  const tab = params.get('tab')
  return tab === 'people' || tab === 'members' ? 'members' : 'general'
}

export function milestoneParams(params: URLSearchParams, id: string): URLSearchParams {
  const next = new URLSearchParams(params)
  next.set('tab', 'plan')
  next.set('work', 'milestones')
  next.set('milestone', id)
  next.delete('task')
  return next
}

export type SpaceSettingsSection = 'details' | 'teams' | 'members' | 'archive'

/** The section open inside a space's Settings. Archive opens only for people who can see it. */
export function spaceSettingsSection(params: URLSearchParams, canSeeArchive: boolean): SpaceSettingsSection {
  const raw = params.get('section')
  if (raw === 'teams' || raw === 'members') return raw
  if (raw === 'archive' && canSeeArchive) return 'archive'
  return 'details'
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
