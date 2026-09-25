import { describe, expect, it } from 'vitest'
import { defaultConfig, fromSearchParams, parseConfig, presetConfig, toSearchParams } from './reportConfig'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('URL round trip', () => {
  it('reads back exactly what it wrote', () => {
    const config = {
      ...defaultConfig('project'),
      projectIds: [A],
      range: { preset: 'custom' as const, from: '2026-09-01', to: '2026-09-15' },
      compare: true,
      people: [B],
      includeArchived: true,
      activityKinds: ['comment', 'commit'],
      groupActivityBy: 'person' as const,
      score: { weights: { points: 40, hours: 30, repo: 20, comments: 10 } },
      title: 'Week 3, café team',
      note: 'Two tasks waited on the printer.',
    }
    expect(fromSearchParams(new URLSearchParams(toSearchParams(config).toString()))).toEqual(config)
  })

  it('round-trips every preset', () => {
    for (const id of ['weekly', 'person', 'closeout', 'overview'] as const) {
      const config = presetConfig(id, { projectId: A, personId: B })
      expect(fromSearchParams(toSearchParams(config))).toEqual(config)
    }
  })
})

describe('parseConfig', () => {
  it('falls back to defaults for anything it does not recognise', () => {
    expect(parseConfig(null)).toEqual(defaultConfig('space'))
    expect(parseConfig('nonsense')).toEqual(defaultConfig('space'))
  })

  it('drops bad values and unknown keys', () => {
    const parsed = parseConfig({
      scope: 'project',
      projectIds: ['not-a-uuid', A, A],
      range: { preset: 'fortnight', from: '2026-02-30' },
      people: [B, 42],
      sections: { tasks: false, bogus: true },
      activityKinds: ['comment', 'DROP TABLE'],
      score: { weights: { points: 500, hours: -3, repo: 'x' } },
      extra: 'ignored',
    })
    expect(parsed.scope).toBe('project')
    expect(parsed.projectIds).toEqual([A])
    expect(parsed.range).toEqual({ preset: 'last30' })
    expect(parsed.people).toEqual([B])
    expect(parsed.sections.tasks).toBe(false)
    expect('bogus' in parsed.sections).toBe(false)
    expect(parsed.activityKinds).toEqual(['comment'])
    expect(parsed.score.weights).toEqual({ points: 100, hours: 0, repo: 20, comments: 10 })
    expect('extra' in parsed).toBe(false)
  })
})
