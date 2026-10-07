import { describe, expect, it } from 'vitest'
import { applyScope, defaultScope, readScope, scopeOptions, scopeSprintId, scopeTargetSprint } from './scope'
import type { Sprint } from './types'

const sprint = (over: Partial<Sprint>): Sprint => ({
  id: 's', name: 'Sprint', goal: '', starts_on: '2026-10-05', ends_on: '2026-10-18',
  state: 'planned', started_at: null, completed_at: null, created_at: '2026-10-01T00:00:00Z', milestone_id: null, ...over,
})

const running = sprint({ id: 'r', name: 'Sprint 2', state: 'active' })
const planned = sprint({ id: 'p', name: 'Sprint 3', starts_on: '2026-10-19' })
const finished = sprint({ id: 'f', name: 'Sprint 1', state: 'completed', starts_on: '2026-09-21' })
const all = [running, planned, finished]
const items = [
  { id: 'a', sprint_id: 'r' },
  { id: 'b', sprint_id: 'p' },
  { id: 'c', sprint_id: null },
]

describe('scope', () => {
  it('defaults to the running sprint, or everything', () => {
    expect(defaultScope(all)).toBe('running')
    expect(defaultScope([planned])).toBe('all')
  })

  it('reads a scope from the address, falling back when it no longer fits', () => {
    expect(readScope('backlog', all)).toBe('backlog')
    expect(readScope('sprint:p', all)).toBe('sprint:p')
    expect(readScope('sprint:gone', all)).toBe('running')
    expect(readScope('running', [planned])).toBe('all')
    expect(readScope(null, all)).toBe('running')
  })

  it('names the sprint a scope points at', () => {
    expect(scopeSprintId('running', all)).toBe('r')
    expect(scopeSprintId('sprint:p', all)).toBe('p')
    expect(scopeSprintId('all', all)).toBeNull()
  })

  it('puts a new task in the scoped sprint, unless that sprint is finished', () => {
    expect(scopeTargetSprint('running', all)).toBe('r')
    expect(scopeTargetSprint('sprint:p', all)).toBe('p')
    expect(scopeTargetSprint('sprint:f', all)).toBeNull()
    expect(scopeTargetSprint('backlog', all)).toBeNull()
    expect(scopeTargetSprint('all', all)).toBeNull()
  })

  it('filters tasks by scope', () => {
    expect(applyScope(items, 'running', all).map((i) => i.id)).toEqual(['a'])
    expect(applyScope(items, 'sprint:p', all).map((i) => i.id)).toEqual(['b'])
    expect(applyScope(items, 'backlog', all).map((i) => i.id)).toEqual(['c'])
    expect(applyScope(items, 'all', all).map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('offers the running sprint first, then everything, the backlog and each other sprint by date', () => {
    expect(scopeOptions(all)).toEqual([
      { value: 'running', label: 'Running sprint · Sprint 2' },
      { value: 'all', label: 'All tasks' },
      { value: 'backlog', label: 'Backlog' },
      { value: 'sprint:f', label: 'Sprint 1 (finished)' },
      { value: 'sprint:p', label: 'Sprint 3' },
    ])
  })
})
