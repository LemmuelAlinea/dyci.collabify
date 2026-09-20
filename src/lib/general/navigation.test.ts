import { describe, expect, it } from 'vitest'
import { chooseLandingSpace, generalTab, projectRouteId, spaceRouteId } from './navigation'
import type { GeneralSpaceSummary } from './types'

const space = (id: string, archived = false, member = true): GeneralSpaceSummary => ({
  id,
  name: id,
  description: '',
  created_by: null,
  archived_at: archived ? '2026-09-20T00:00:00Z' : null,
  created_at: '2026-09-20T00:00:00Z',
  updated_at: '2026-09-20T00:00:00Z',
  my_level: member ? 'member' : null,
  member_count: 1,
  project_count: 0,
  archived_count: 0,
})

describe('general navigation', () => {
  it('reads every supported tab and falls back to overview', () => {
    expect(generalTab(new URLSearchParams())).toBe('overview')
    expect(generalTab(new URLSearchParams('tab=files'))).toBe('files')
    expect(generalTab(new URLSearchParams('tab=unknown'))).toBe('overview')
  })

  it('lets a task deep link override tab', () => {
    expect(generalTab(new URLSearchParams('tab=members&task=abc'))).toBe('tasks')
  })

  it('extracts only General space and project routes', () => {
    expect(spaceRouteId('/general/spaces/space-1/archive')).toBe('space-1')
    expect(spaceRouteId('/general/spaces')).toBeNull()
    expect(projectRouteId('/general/projects/project-1')).toBe('project-1')
    expect(projectRouteId('/student/projects/project-1')).toBeNull()
  })

  it('uses remembered membership, then the sole active space', () => {
    expect(chooseLandingSpace([space('a'), space('b')], 'b')).toBe('b')
    expect(chooseLandingSpace([space('a'), space('b')], 'gone')).toBeNull()
    expect(chooseLandingSpace([space('a'), space('b', true)], null)).toBe('a')
    expect(chooseLandingSpace([space('a', false, false)], 'a')).toBeNull()
  })
})
