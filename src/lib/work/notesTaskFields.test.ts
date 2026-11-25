import { expect, it } from 'vitest'
import { normalizeNoteTaskFields, noteTypeChoices } from '../../../supabase/functions/_shared/notesTaskFields'

const types = [
  { value: 'task', label: 'Task' },
  { value: 'bug', label: 'Deficiency' },
  { value: 'Research', label: 'Research' },
]

it('uses project type names while keeping their saved values', () => {
  expect(noteTypeChoices([
    { slot: 'default', name: 'Action' }, { slot: 'bug', name: 'Deficiency' }, { slot: null, name: 'Research' },
  ])).toEqual([
    { value: 'task', label: 'Action' }, { value: 'bug', label: 'Deficiency' }, { value: 'Research', label: 'Research' },
  ])
})

it('keeps stated priority, named type and hours', () => {
  expect(normalizeNoteTaskFields(
    { priority: 'HIGH', task_type: 'deficiency', estimated_hours: '1.5' }, types, 'normal',
  )).toEqual({ priority: 'high', task_type: 'bug', estimated_hours: '1.5' })
})

it('uses project defaults when the source leaves fields out', () => {
  expect(normalizeNoteTaskFields({}, types, 'low')).toEqual({ priority: 'low', task_type: 'task', estimated_hours: '' })
})

it('rejects unknown types and invalid hour values before review', () => {
  expect(normalizeNoteTaskFields(
    { priority: 'immediate', task_type: 'Unlisted', estimated_hours: '1001' }, types, 'normal',
  )).toEqual({ priority: 'normal', task_type: 'task', estimated_hours: '' })
  expect(normalizeNoteTaskFields({ estimated_hours: '0' }, types, 'normal').estimated_hours).toBe('')
  expect(normalizeNoteTaskFields({ estimated_hours: '0.5' }, types, 'normal').estimated_hours).toBe('0.5')
})
