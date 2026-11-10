/**
 * Which tasks Tasks shows: a running sprint (the default while one runs),
 * everything, the backlog, or one sprint. Kept in the address as `?scope=`.
 */
import { runningSprints } from './sprints'
import type { Sprint } from './types'

/** 'running' | `running:${id}` | 'all' | 'backlog' | `sprint:${id}` */
export type TaskScope = string

/** With several running, plain 'running' means the first entry, so old links keep working. */
function firstRunning(sprints: readonly Sprint[]): TaskScope | null {
  const running = runningSprints(sprints)
  if (running.length === 0) return null
  return running.length === 1 ? 'running' : `running:${running[0].id}`
}

export function defaultScope(sprints: readonly Sprint[]): TaskScope {
  return firstRunning(sprints) ?? 'all'
}

export function readScope(raw: string | null, sprints: readonly Sprint[]): TaskScope {
  if (raw === 'all' || raw === 'backlog') return raw
  if (raw === 'running') return defaultScope(sprints)
  if (raw?.startsWith('running:') && runningSprints(sprints).some((s) => `running:${s.id}` === raw)) return raw
  if (raw?.startsWith('sprint:') && sprints.some((s) => `sprint:${s.id}` === raw)) return raw
  return defaultScope(sprints)
}

export function scopeSprintId(scope: TaskScope, sprints: readonly Sprint[]) {
  if (scope === 'running') return runningSprints(sprints)[0]?.id ?? null
  if (scope.startsWith('running:')) return scope.slice('running:'.length)
  return scope.startsWith('sprint:') ? scope.slice('sprint:'.length) : null
}

/** Where a task made under this scope goes: its sprint, unless that sprint is finished. */
export function scopeTargetSprint(scope: TaskScope, sprints: readonly Sprint[]): string | null {
  const id = scopeSprintId(scope, sprints)
  return id && sprints.find((s) => s.id === id)?.state !== 'completed' ? id : null
}

export function applyScope<T extends { sprint_id: string | null }>(
  items: readonly T[],
  scope: TaskScope,
  sprints: readonly Sprint[],
): T[] {
  if (scope === 'backlog') return items.filter((i) => i.sprint_id === null)
  const id = scopeSprintId(scope, sprints)
  return id ? items.filter((i) => i.sprint_id === id) : [...items]
}

export function scopeOptions(sprints: readonly Sprint[]) {
  const running = runningSprints(sprints)
  const entries =
    running.length === 1
      ? [{ value: 'running', label: `Running sprint · ${running[0].name}` }]
      : running.map((s) => ({ value: `running:${s.id}`, label: `Running · ${s.name}` }))
  return [
    ...entries,
    { value: 'all', label: 'All tasks' },
    { value: 'backlog', label: 'Backlog' },
    ...sprints
      .filter((s) => s.state !== 'active')
      .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
      .map((s) => ({ value: `sprint:${s.id}`, label: s.state === 'completed' ? `${s.name} (finished)` : s.name })),
  ]
}
