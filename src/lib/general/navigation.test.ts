import { describe, expect, it } from 'vitest'
import { chooseLandingSpace, generalTab, projectRouteId, spaceRouteId } from './navigation'
import type { GeneralSpaceSummary } from './types'

const space = (
  id: string,
  archived = false,
  member = true,
  kind: GeneralSpaceSummary['kind'] = 'work',
): GeneralSpaceSummary => ({
  id,
  kind,
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
  class_id: null,
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

  it('extracts only Space and project routes', () => {
    expect(spaceRouteId('/spaces/space-1/archive')).toBe('space-1')
    expect(spaceRouteId('/spaces')).toBeNull()
    expect(spaceRouteId('/spaces/archive')).toBeNull()
    expect(projectRouteId('/projects/project-1')).toBe('project-1')
    expect(projectRouteId('/class-projects/project-1')).toBeNull()
  })

  it('uses remembered membership, then the sole active space', () => {
    expect(chooseLandingSpace([space('a'), space('b')], 'b')).toBe('b')
    expect(chooseLandingSpace([space('a'), space('b')], 'gone')).toBeNull()
    expect(chooseLandingSpace([space('a'), space('b', true)], null)).toBe('a')
    expect(chooseLandingSpace([space('a', false, false)], 'a')).toBeNull()
  })

  it('never lands on an education space', () => {
    expect(chooseLandingSpace([space('a', false, true, 'education')], null)).toBeNull()
    expect(chooseLandingSpace([space('a', false, true, 'education')], 'a')).toBeNull()
    expect(chooseLandingSpace([space('a', false, true, 'education'), space('b')], null)).toBe('b')
  })
})
