import { describe, expect, it } from 'vitest'
import type { TaskTypeEntry } from './typeSet'
import {
  defaultTypeSet, isReadableTypeSet, parseTypeSet, removedNames, resolveType, toDrafts, typeKey, typeOptions, typeSetProblem,
} from './typeSet'

const e = (slot: TaskTypeEntry['slot'], name: string, extra: Partial<TaskTypeEntry> = {}): TaskTypeEntry => ({
  slot, name, description: '', color: '#0891b2', icon: 'tag', ...extra,
})
const work = (...more: TaskTypeEntry[]) => [e('default', 'Task', { color: '#2563eb' }), e('bug', 'Bug', { color: '#dc2626' }), ...more]
const NAMES = 'Use distinct names of 1 to 40 characters. Task and Bug stay reserved for the built-in types.'

describe('defaultTypeSet', () => {
  it('gives work Task and Bug, and class Task only', () => {
    expect(defaultTypeSet('work').map((t) => [t.slot, t.name, t.color, t.icon])).toEqual([
      ['default', 'Task', '#2563eb', 'square-check'],
      ['bug', 'Bug', '#dc2626', 'bug'],
    ])
    expect(defaultTypeSet('work')[0].description).toBe('Standard actionable work.')
    expect(defaultTypeSet('work')[1].description).toBe('Errors, defects, and issues requiring fixes.')
    expect(defaultTypeSet('class').map((t) => t.name)).toEqual(['Task'])
  })
})

describe('typeSetProblem', () => {
  it('passes a valid set', () => {
    expect(typeSetProblem(work(e(null, 'Epic')), 'work')).toBeNull()
    expect(typeSetProblem([e('default', 'Task'), e(null, 'Bug')], 'class')).toBeNull()
  })
  it('says what is wrong, as the database does', () => {
    expect(typeSetProblem([...work(), e('default', 'Other')], 'work')).toBe('Keep one default type.')
    expect(typeSetProblem([e('default', 'Task')], 'work')).toBe('Keep one bug type.')
    expect(typeSetProblem(work(), 'class')).toBe('Class projects have no bug type.')
    const many = Array.from({ length: 21 }, (_, i) => e(null, `Type ${i}`))
    expect(typeSetProblem(work(...many), 'work')).toBe('Keep at most 20 custom task types.')
    expect(typeSetProblem(work(...many.slice(1)), 'work')).toBeNull()
    expect(typeSetProblem(work(e(null, 'epic'), e(null, 'Epic')), 'work')).toBe(NAMES)
    expect(typeSetProblem(work(e(null, 'BUG')), 'work')).toBe(NAMES)
    expect(typeSetProblem(work(e(null, ' Epic')), 'work')).toBe(NAMES)
    expect(typeSetProblem(work(e(null, 'x'.repeat(41))), 'work')).toBe(NAMES)
    expect(typeSetProblem([e('default', 'Research Task'), e(null, 'task')], 'class'))
      .toBe('Use distinct names of 1 to 40 characters. Task stays reserved for the built-in type.')
    expect(typeSetProblem(work(e(null, 'Epic', { description: 'x'.repeat(121) })), 'work'))
      .toBe('Keep each description to 120 characters.')
    expect(typeSetProblem(work(e(null, 'Epic', { color: '#DB2777' })), 'work')).toBe('Choose a color as #rrggbb.')
    expect(typeSetProblem(work(e(null, 'Epic', { icon: 'rocket-ship' as never })), 'work')).toBe('Choose an icon from the list.')
  })
  it('lets a slot carry any name', () => {
    expect(typeSetProblem([e('default', 'Task'), e('bug', 'Bug Task')], 'work')).toBeNull()
  })
})

describe('resolveType', () => {
  const set = work(e(null, 'Epic'))
  it('maps work tasks by kind, then name', () => {
    expect(resolveType(set, { kind: 'bug', task_type: null }, 'work').name).toBe('Bug')
    expect(resolveType(set, { kind: 'task', task_type: null }, 'work').name).toBe('Task')
    expect(resolveType(set, { kind: 'task', task_type: 'Epic' }, 'work')).toMatchObject({ name: 'Epic', removed: false })
  })
  it('marks a type no longer in the set as removed', () => {
    expect(resolveType(set, { kind: 'task', task_type: 'Gone' }, 'work'))
      .toMatchObject({ name: 'Gone', removed: true, icon: 'tag', slot: null })
  })
  it('never matches a slot by name', () => {
    const renamed = [e('default', 'Task'), e('bug', 'Issue')]
    expect(resolveType(renamed, { kind: 'task', task_type: 'Issue' }, 'work')).toMatchObject({ name: 'Issue', removed: true })
  })
  it('maps class tasks by Task, then name', () => {
    const cls = [e('default', 'Research Task'), e(null, 'Review')]
    expect(resolveType(cls, { task_type: 'Task' }, 'class').name).toBe('Research Task')
    expect(resolveType(cls, { task_type: 'Review' }, 'class').removed).toBe(false)
    expect(resolveType(cls, { task_type: 'Old' }, 'class').removed).toBe(true)
  })
})

describe('typeKey', () => {
  it('keeps the values tasks already store', () => {
    const set = work(e(null, 'Epic'))
    expect(set.map((t) => typeKey(t, 'work'))).toEqual(['task', 'bug', 'Epic'])
    expect(typeKey(e('default', 'Research Task'), 'class')).toBe('Task')
  })
})

describe('typeOptions', () => {
  const set = work(e(null, 'Epic'))
  it('lists the set in order for a project manager', () => {
    expect(typeOptions(set, { family: 'work', role: 'pm' }).map((o) => o.value)).toEqual(['task', 'bug', 'Epic'])
  })
  it('leaves the bug type out for a planned-project member', () => {
    expect(typeOptions(set, { family: 'work', role: 'member', memberPlanned: true }).map((o) => o.value)).toEqual(['task', 'Epic'])
  })
  it('gives QA the bug type only', () => {
    expect(typeOptions(set, { family: 'work', role: 'qa' }).map((o) => o.value)).toEqual(['bug'])
  })
  it('appends a removed current type', () => {
    const current = resolveType(set, { kind: 'task', task_type: 'Gone' }, 'work')
    const options = typeOptions(set, { family: 'work', role: 'pm', current })
    expect(options.map((o) => o.value)).toEqual(['task', 'bug', 'Epic', 'Gone'])
    expect(options[3].entry.removed).toBe(true)
  })
  it('uses Task as the class default value', () => {
    expect(typeOptions([e('default', 'Research Task'), e(null, 'Review')], { family: 'class' }).map((o) => o.value))
      .toEqual(['Task', 'Review'])
  })
})

describe('removedNames', () => {
  it('lists names not in the set, once each', () => {
    expect(removedNames(work(e(null, 'Epic')), ['Epic', null, 'Gone', 'Gone', undefined, 'Old'], 'work')).toEqual(['Gone', 'Old'])
    expect(removedNames([e('default', 'Research Task')], ['Task', 'Old'], 'class')).toEqual(['Old'])
  })
})

describe('toDrafts', () => {
  it('marks renamed custom types only', () => {
    const drafts = toDrafts([
      { entry: e('default', 'Research Task'), was: 'Task' },
      { entry: e(null, 'Initiative'), was: 'Epic' },
      { entry: e(null, 'Feature'), was: 'Feature' },
      { entry: e(null, 'New') },
    ])
    expect(drafts[1]).toMatchObject({ name: 'Initiative', was: 'Epic' })
    expect(drafts[0]).not.toHaveProperty('was')
    expect(drafts[2]).not.toHaveProperty('was')
    expect(drafts[3]).not.toHaveProperty('was')
  })
})

describe('parseTypeSet', () => {
  it('falls back to the default set', () => {
    expect(parseTypeSet(null, 'work')).toEqual(defaultTypeSet('work'))
    expect(parseTypeSet([{ nope: 1 }], 'class')).toEqual(defaultTypeSet('class'))
  })
  it('keeps a valid stored set', () => {
    const set = work(e(null, 'Epic'))
    expect(parseTypeSet(set, 'work')).toEqual(set)
  })
})

describe('isReadableTypeSet', () => {
  it('knows a stored set it can show from one it would replace with the default', () => {
    expect(isReadableTypeSet(work(e(null, 'Epic')), 'work')).toBe(true)
    expect(isReadableTypeSet(null, 'work')).toBe(true)
    expect(isReadableTypeSet(work(e(null, 'Epic', { icon: 'new-icon' as never })), 'work')).toBe(false)
    expect(isReadableTypeSet([{ nope: 1 }], 'class')).toBe(false)
  })
})
