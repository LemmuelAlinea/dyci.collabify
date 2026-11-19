import { describe, expect, it } from 'vitest'
import { buildClassBrief, normalizeFit, type ClassBriefData } from '../../../supabase/functions/_shared/classBrief'

const sample: ClassBriefData = {
  project: {
    title: 'Prototype', type: 'prototype', type_label: 'Project prototype', audience: 'group', total_points: 100,
    due_at: null, guidelines: 'Build a simulation.', start_week: 5, end_week: 8,
  },
  criteria: [{ label: 'Design', description: 'Clear model', max_points: 40 }, { label: 'Demo', description: '', max_points: 60 }],
  weeks: [
    { week_no: 5, title: 'Modeling', topics: 'Entities', outcomes: '', assessments: '' },
    { week_no: 6, title: 'Testing', topics: '', outcomes: 'Run it', assessments: 'Lab' },
  ],
}

// What generate-tasks built before the helper existed, for the same input.
const SAMPLE_BRIEF = [
  'Project: Prototype',
  'Type: Project prototype',
  'Done by: a group together',
  'Team size: 4',
  'Worth: 100 points',
  'No deadline set',
  'Guidelines from the professor:',
  'Build a simulation.',
  'Rubric:',
  '- Design (40 pts): Clear model\n- Demo (60 pts)',
  'Syllabus weeks 5–8 it is built on:',
  'Week 5: Modeling\n  Topics: Entities\nWeek 6: Testing\n  Outcomes: Run it\n  Expected: Lab',
  '\nTasks the team already has, do not repeat them:\n- Write the proposal',
].join('\n')

const empty: ClassBriefData = {
  project: { ...sample.project, guidelines: '  ' },
  criteria: [],
  weeks: [{ week_no: 5, title: 'Modeling', topics: '', outcomes: '', assessments: '' }],
}

describe('buildClassBrief', () => {
  it('builds the same brief Draft with AI sends today', () => {
    expect(buildClassBrief(sample, { teamSize: 4, existing: ['Write the proposal'] }).text).toBe(SAMPLE_BRIEF)
  })
  it('leaves out the board lines when none are given', () => {
    const text = buildClassBrief(sample).text
    expect(text).not.toContain('Team size')
    expect(text).not.toContain('already has')
  })
  it('is thin only when guidelines, rubric and week detail are all missing', () => {
    expect(buildClassBrief(empty).thin).toBe(true)
    expect(buildClassBrief({ ...empty, criteria: [sample.criteria[0]] }).thin).toBe(false)
    expect(buildClassBrief({ ...empty, project: { ...empty.project, guidelines: 'Build a model' } }).thin).toBe(false)
    expect(buildClassBrief({ ...empty, weeks: [sample.weeks[0]] }).thin).toBe(false)
  })
})

describe('normalizeFit', () => {
  it('marks off only for "off", with the reason trimmed', () => {
    expect(normalizeFit('off', ' Not in weeks 5–8. ', false)).toEqual({ fit: 'off', fit_reason: 'Not in weeks 5–8.' })
  })
  it('treats any other value as fits and never drops the task', () => {
    for (const raw of ['fits', 'Fits', 'maybe', '', undefined, null]) {
      expect(normalizeFit(raw, 'x', false)).toEqual({ fit: 'fits', fit_reason: '' })
    }
  })
  it('never marks off when the brief is thin', () => {
    expect(normalizeFit('off', 'x', true)).toEqual({ fit: 'fits', fit_reason: '' })
  })
  it('cuts a long reason to 200 characters', () => {
    expect(normalizeFit('off', 'a'.repeat(300), false).fit_reason).toHaveLength(200)
  })
})
