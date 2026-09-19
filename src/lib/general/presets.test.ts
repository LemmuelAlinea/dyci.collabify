import { describe, expect, it } from 'vitest'
import { FIELD_TYPES, FIELD_LIMIT } from './fields'
import { PRESETS, presetById, presetPayload, presetSummary, presetsFor } from './presets'

/**
 * A preset writes real rows through `create_general_project`, so anything the
 * database would refuse has to be caught here — a bad field type, a name over
 * its limit, or a task pointing at a team the preset never creates.
 */

describe('every preset is one the database would accept', () => {
  const types = new Set(FIELD_TYPES.map((t) => t.value))

  it.each(PRESETS.map((p) => [p.id, p] as const))('%s', (_id, preset) => {
    expect(preset.name.length).toBeGreaterThan(0)

    for (const f of preset.fields) {
      expect(types.has(f.type)).toBe(true)
      expect(f.name.trim().length).toBeGreaterThan(0)
      expect(f.name.length).toBeLessThanOrEqual(FIELD_LIMIT.name)
      const choice = f.type === 'single_choice' || f.type === 'multi_choice'
      // A choice field with no options is a control nobody can answer.
      expect(choice).toBe((f.options?.length ?? 0) > 0)
      for (const o of f.options ?? []) expect(o.length).toBeLessThanOrEqual(FIELD_LIMIT.option)
    }

    for (const t of preset.teams) expect(t.length).toBeLessThanOrEqual(80)
    for (const p of preset.positions) expect(p.name.length).toBeLessThanOrEqual(80)
    for (const t of preset.tasks) {
      expect(t.title.trim().length).toBeGreaterThan(0)
      expect(t.title.length).toBeLessThanOrEqual(200)
    }
  })

  it('gives every preset a distinct id, and keeps blank first', () => {
    const ids = PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe('blank')
  })

  it('names no team a task or position cannot point at', () => {
    for (const preset of PRESETS) {
      const payload = presetPayload(preset)
      for (const t of payload.tasks) if (t.team) expect(payload.teams).toContain(t.team)
      for (const p of payload.positions) if (p.team) expect(payload.teams).toContain(p.team)
    }
  })

  it('drops a team reference the preset never creates rather than sending it', () => {
    const payload = presetPayload({
      id: 'x',
      name: 'x',
      blurb: '',
      icon: 'folder',
      audience: ['school'],
      fields: [],
      teams: ['Real'],
      positions: [{ name: 'Ghost lead', team: 'Imaginary' }],
      tasks: [{ title: 'Do it', team: 'Imaginary' }],
    })
    expect(payload.positions[0].team).toBeNull()
    expect(payload.tasks[0].team).toBeNull()
  })

  it('numbers the fields in the order they are written', () => {
    const payload = presetPayload(presetById('research_paper')!)
    expect(payload.fields.map((f) => f.sort)).toEqual(payload.fields.map((_, i) => i))
  })
})

describe('the picker', () => {
  it('finds a preset by id and answers null for anything else', () => {
    expect(presetById('blank')?.name).toBe('Blank project')
    expect(presetById('not-a-preset')).toBeNull()
    expect(presetById(null)).toBeNull()
  })

  it('narrows by who runs the project, and shows everything with no filter', () => {
    expect(presetsFor('')).toHaveLength(PRESETS.length)
    const basic = presetsFor('basic').map((p) => p.id)
    expect(basic).toContain('class_group')
    expect(basic).not.toContain('accreditation')
  })

  it('says what a preset adds without listing all of it', () => {
    expect(presetSummary(presetById('blank')!)).toBe('Nothing added')
    expect(presetSummary(presetById('class_group')!)).toBe('6 fields, 2 positions and 6 tasks')
    expect(presetSummary(presetById('capstone')!)).toBe('7 fields, 3 teams, 5 positions and 10 tasks')
  })
})
