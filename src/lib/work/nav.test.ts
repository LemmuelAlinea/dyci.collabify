import { describe, expect, it } from 'vitest'
import { taskLayout, withWork, workSection } from './nav'

const p = (q: string) => new URLSearchParams(q)

describe('workSection', () => {
  it('reads a named section', () => {
    expect(workSection(p('tab=work&work=summary'), 'tasks')).toBe('summary')
    expect(workSection(p('tab=work&work=tasks'), 'summary')).toBe('tasks')
  })

  it('falls back when nothing or something unknown is named', () => {
    expect(workSection(p(''), 'tasks')).toBe('tasks')
    expect(workSection(p('work=archive'), 'summary')).toBe('summary')
  })

  it('sends the old Progress tab to Summary', () => {
    expect(workSection(p('tab=progress'), 'tasks')).toBe('summary')
  })

  it('sends the old Tasks tab and board links to Tasks', () => {
    expect(workSection(p('tab=tasks'), 'summary')).toBe('tasks')
    expect(workSection(p('tab=tasks&board=b1'), 'summary')).toBe('tasks')
    expect(workSection(p('board=b1'), 'summary')).toBe('tasks')
  })

  it('sends a task link to Tasks', () => {
    expect(workSection(p('tab=work&task=t1'), 'summary')).toBe('tasks')
  })

  it('lets an explicit section win over a legacy tab', () => {
    expect(workSection(p('tab=tasks&work=summary'), 'tasks')).toBe('summary')
    expect(workSection(p('work=summary&task=t1'), 'tasks')).toBe('summary')
  })

  it('reads the planning sections', () => {
    expect(workSection(p('work=backlog'), 'tasks')).toBe('backlog')
    expect(workSection(p('work=sprints'), 'tasks')).toBe('sprints')
    expect(workSection(p('work=milestones'), 'tasks')).toBe('milestones')
  })
})

describe('taskLayout', () => {
  it('reads each layout and defaults to board', () => {
    expect(taskLayout(p('layout=list'))).toBe('list')
    expect(taskLayout(p('layout=timeline'))).toBe('timeline')
    expect(taskLayout(p('layout=calendar'))).toBe('calendar')
    expect(taskLayout(p(''))).toBe('board')
    expect(taskLayout(p('layout=gantt'))).toBe('board')
  })
})

describe('withWork', () => {
  it('sets section and layout and keeps other params', () => {
    const next = withWork(p('tab=work&task=t1'), { section: 'tasks', layout: 'calendar' })
    expect(next.get('work')).toBe('tasks')
    expect(next.get('layout')).toBe('calendar')
    expect(next.get('task')).toBe('t1')
  })

  it('renames a legacy tab so the address reads Work', () => {
    expect(withWork(p('tab=tasks'), { layout: 'list' }).get('tab')).toBe('work')
    expect(withWork(p('tab=progress'), { section: 'summary' }).get('tab')).toBe('work')
  })

  it('leaves another tab alone', () => {
    expect(withWork(p('tab=files'), { layout: 'list' }).get('tab')).toBe('files')
  })

  it('does not change the params it was given', () => {
    const before = p('tab=work')
    withWork(before, { section: 'summary' })
    expect(before.has('work')).toBe(false)
  })

  it('writes the tasks scope', () => {
    expect(withWork(p('tab=work'), { scope: 'sprint:s1' }).get('scope')).toBe('sprint:s1')
  })
})
