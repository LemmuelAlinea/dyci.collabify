import { describe, expect, it } from 'vitest'
import { chooseLandingSpace, generalTab, milestoneParams, projectRouteId, spaceRouteId } from './navigation'
import { workSection } from '../work/nav'
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
  it('opens project progress in Overview and task links in Tasks', () => {
    expect(generalTab(new URLSearchParams('tab=project-progress'))).toBe('overview')
    expect(generalTab(new URLSearchParams('tab=project-progress&task=t1'))).toBe('tasks')
  })

  it('reads the six project sections and falls back to Overview', () => {
    expect(generalTab(new URLSearchParams())).toBe('overview')
    for (const tab of ['overview', 'plan', 'tasks', 'conversations', 'files', 'people']) {
      expect(generalTab(new URLSearchParams(`tab=${tab}`))).toBe(tab)
    }
    expect(generalTab(new URLSearchParams('tab=unknown'))).toBe('overview')
  })

  it('keeps task dialogs on their current new section, but sends old links to Tasks', () => {
    expect(generalTab(new URLSearchParams('tab=overview&task=abc'))).toBe('overview')
    expect(generalTab(new URLSearchParams('tab=plan&task=abc'))).toBe('plan')
    expect(generalTab(new URLSearchParams('tab=members&task=abc'))).toBe('tasks')
  })

  it('maps every old tab and Work section to its new home', () => {
    const destinations = {
      'tab=work': 'tasks',
      'tab=work&work=summary': 'overview',
      'tab=work&work=backlog': 'plan',
      'tab=work&work=milestones': 'plan',
      'tab=work&work=sprints': 'plan',
      'tab=tasks&work=sprints': 'plan',
      'tab=tasks&work=sprints&task=t1': 'plan',
      'tab=work&work=qa': 'tasks',
      'tab=tasks': 'tasks',
      'tab=progress': 'overview',
      'tab=discussion': 'conversations',
      'tab=feedback': 'conversations',
      'tab=shared': 'files',
      'tab=members': 'people',
    }
    for (const [query, tab] of Object.entries(destinations)) {
      expect(generalTab(new URLSearchParams(query))).toBe(tab)
    }
  })

  it('links to a milestone without changing the source query', () => {
    const params = new URLSearchParams('tab=project-progress&scope=a&task=t1')
    const next = milestoneParams(params, 'm1')
    expect(Object.fromEntries(next)).toEqual({ tab: 'plan', scope: 'a', work: 'milestones', milestone: 'm1' })
    expect(generalTab(next)).toBe('plan')
    expect(workSection(next, 'tasks')).toBe('milestones')
    expect(params.toString()).toBe('tab=project-progress&scope=a&task=t1')
  })

  it('preserves legacy Work destinations', () => {
    const progress = new URLSearchParams('tab=progress')
    expect(generalTab(progress)).toBe('overview')
    expect(workSection(progress, 'tasks')).toBe('summary')
    expect(generalTab(new URLSearchParams('tab=members&task=t1'))).toBe('tasks')
    expect(generalTab(new URLSearchParams('tab=work&work=summary&task=t1'))).toBe('overview')
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
