// @vitest-environment happy-dom
// src/lib/general/taskFilters.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_PRIORITY_VIEW, filterByPriority, readPriorityView, sortByPriority, writePriorityView } from './taskFilters'
import type { TaskPriority } from './types'

const t = (id: string, priority?: TaskPriority) => ({ id, priority })

describe('filterByPriority', () => {
  const tasks = [t('a', 'urgent'), t('b', 'normal'), t('c', 'low'), t('d', 'high'), t('e')]

  it('keeps every task when no priority is chosen', () => {
    expect(filterByPriority(tasks, []).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('keeps only the chosen priorities', () => {
    expect(filterByPriority(tasks, ['urgent', 'low']).map((x) => x.id)).toEqual(['a', 'c'])
  })

  it('counts a task without a priority as normal', () => {
    expect(filterByPriority(tasks, ['normal']).map((x) => x.id)).toEqual(['b', 'e'])
  })
})

describe('sortByPriority', () => {
  it('puts urgent first and keeps the current order within a priority', () => {
    const tasks = [t('a', 'low'), t('b', 'normal'), t('c', 'urgent'), t('d', 'high'), t('e', 'urgent'), t('f', 'normal')]
    expect(sortByPriority(tasks).map((x) => x.id)).toEqual(['c', 'e', 'd', 'b', 'f', 'a'])
  })

  it('leaves the input alone', () => {
    const tasks = [t('a', 'low'), t('b', 'urgent')]
    sortByPriority(tasks)
    expect(tasks.map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('the saved priority view', () => {
  beforeEach(() => localStorage.clear())

  it('reads back what was written, per key', () => {
    writePriorityView('p1', { priorities: ['urgent', 'high'], sort: 'priority' })
    expect(readPriorityView('p1')).toEqual({ priorities: ['urgent', 'high'], sort: 'priority' })
    expect(readPriorityView('p2')).toEqual(EMPTY_PRIORITY_VIEW)
  })

  it('drops values it does not know', () => {
    localStorage.setItem('collabify:task-priority:p1', JSON.stringify({ priorities: ['urgent', 'bogus', 7], sort: 'nope' }))
    expect(readPriorityView('p1')).toEqual({ priorities: ['urgent'], sort: '' })
  })

  it('falls back to empty on bad json or no key', () => {
    localStorage.setItem('collabify:task-priority:p1', '{not json')
    expect(readPriorityView('p1')).toEqual(EMPTY_PRIORITY_VIEW)
    expect(readPriorityView(undefined)).toEqual(EMPTY_PRIORITY_VIEW)
  })
})
