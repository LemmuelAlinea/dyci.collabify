import { describe, expect, it } from 'vitest'
import { TASK_TYPE_ICONS } from './icons'
import { applyPreset, presetByKey, TASK_TYPE_PRESETS } from './presets'
import { defaultTypeSet, typeSetProblem } from './typeSet'
import type { TaskTypeEntry } from './typeSet'

describe('TASK_TYPE_PRESETS', () => {
  it('holds the 14 presets in order', () => {
    expect(TASK_TYPE_PRESETS.map((p) => p.key)).toEqual([
      'general', 'software', 'research', 'feasibility', 'construction', 'real-estate', 'business', 'marketing',
      'events', 'creative', 'hr', 'operations', 'product', 'finance',
    ])
    expect(TASK_TYPE_PRESETS.map((p) => p.types.length)).toEqual([7, 8, 10, 9, 10, 10, 9, 9, 9, 9, 9, 9, 9, 9])
    expect(TASK_TYPE_PRESETS[1].name).toBe('System and Software Development')
  })

  it('gives each one default type and the bug types the spec names', () => {
    const bugs: Record<string, string> = {
      general: 'Issue', software: 'Bug Task', construction: 'Deficiency', operations: 'Incident',
      product: 'Product Defect', finance: 'Discrepancy',
    }
    for (const p of TASK_TYPE_PRESETS) {
      expect(p.types.filter((t) => t.slot === 'default'), p.key).toHaveLength(1)
      const bug = p.types.filter((t) => t.slot === 'bug')
      expect(bug.map((t) => t.name), p.key).toEqual(bugs[p.key] ? [bugs[p.key]] : [])
    }
    expect(presetByKey('construction')!.types.find((t) => t.slot === 'default')!.name).toBe('Construction Task')
  })

  it('makes valid sets with known icons and lowercase hex', () => {
    for (const p of TASK_TYPE_PRESETS) {
      const { set } = applyPreset(defaultTypeSet('work'), p, 'work')
      expect(typeSetProblem(set, 'work'), p.key).toBeNull()
      expect(typeSetProblem(applyPreset(defaultTypeSet('class'), p, 'class').set, 'class'), p.key).toBeNull()
      for (const t of p.types) {
        expect(TASK_TYPE_ICONS).toContain(t.icon)
        expect(t.color).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('finds a preset by key', () => {
    expect(presetByKey('hr')!.name).toBe('Human Resources')
    expect(presetByKey('nope')).toBeNull()
    expect(presetByKey(null)).toBeNull()
  })
})

describe('applyPreset', () => {
  const custom = (name: string): TaskTypeEntry => ({ slot: null, name, description: '', color: '#0891b2', icon: 'tag' })

  it('keeps the current bug type last when the preset has none', () => {
    const current = [...defaultTypeSet('work').map((t) => (t.slot === 'bug' ? { ...t, name: 'Defect' } : t))]
    const { set } = applyPreset(current, presetByKey('research')!, 'work')
    expect(set.at(-1)).toMatchObject({ slot: 'bug', name: 'Defect' })
    expect(set[0]).toMatchObject({ slot: 'default', name: 'Research Task' })
    expect(set).toHaveLength(11)
  })

  it('turns the bug type into a custom one on a class project', () => {
    const { set } = applyPreset(defaultTypeSet('class'), presetByKey('software')!, 'class')
    expect(set.find((t) => t.name === 'Bug Task')).toMatchObject({ slot: null })
    expect(set.some((t) => t.slot === 'bug')).toBe(false)
  })

  it('lists the custom names that leave', () => {
    const general = applyPreset(defaultTypeSet('work'), presetByKey('general')!, 'work').set
    const { removed } = applyPreset(general, presetByKey('software')!, 'work')
    expect(removed).toEqual(['Deliverable', 'Planning', 'Documentation', 'Review', 'Approval'])
  })

  it('does not list a name the preset also has', () => {
    const { removed } = applyPreset([...defaultTypeSet('work'), custom('Feature'), custom('Old')], presetByKey('software')!, 'work')
    expect(removed).toEqual(['Old'])
  })
})
