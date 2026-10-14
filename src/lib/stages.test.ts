import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAGES,
  STAGE_PRESETS,
  checkStages,
  nextStep,
  isDefaultStages,
  presetOf,
  stageIndex,
  stageName,
  stagesOf,
  stagesToSave,
  statusForStage,
} from './stages'

const SYSTEM = STAGE_PRESETS.find((p) => p.id === 'system')!.stages

describe('stagesOf', () => {
  it('reads null as the default three', () => {
    expect(stagesOf(null)).toEqual(DEFAULT_STAGES)
  })
  it('keeps a project list', () => {
    expect(stagesOf(SYSTEM)).toEqual(SYSTEM)
  })
})

describe('stageIndex', () => {
  it('puts todo first and done last, whatever is stored', () => {
    expect(stageIndex('todo', 3, 5)).toBe(0)
    expect(stageIndex('done', 1, 5)).toBe(4)
  })
  it('reads an in-progress task from its stored middle stage', () => {
    expect(stageIndex('in_progress', 3, 5)).toBe(3)
  })
  it('lands an in-progress task with no stage on the first middle stage', () => {
    expect(stageIndex('in_progress', null, 5)).toBe(1)
  })
  it('keeps a stage left over from a longer list inside the middle', () => {
    expect(stageIndex('in_progress', 6, 4)).toBe(2)
    expect(stageIndex('in_progress', 0, 4)).toBe(1)
  })
})

describe('statusForStage', () => {
  it('maps first, middle and last', () => {
    expect(statusForStage(0, 5)).toBe('todo')
    expect(statusForStage(2, 5)).toBe('in_progress')
    expect(statusForStage(4, 5)).toBe('done')
  })
})

describe('stageName', () => {
  it('names a task by its project list', () => {
    expect(stageName(SYSTEM, { status: 'in_progress', stage: 2 })).toBe('Testing')
    expect(stageName(null, { status: 'in_progress', stage: 2 })).toBe('In progress')
  })
})

describe('presets', () => {
  it('recognises a preset and a custom list', () => {
    expect(presetOf(null)).toBe('default')
    expect(presetOf(SYSTEM)).toBe('system')
    expect(presetOf(['Idea', 'Build', 'Ship'])).toBe('custom')
  })
  it('stores the default as null', () => {
    expect(stagesToSave([' To do', 'In progress ', 'Done'])).toBeNull()
    expect(isDefaultStages(null)).toBe(true)
    expect(stagesToSave(['Idea ', 'Build', 'Ship'])).toEqual(['Idea', 'Build', 'Ship'])
  })
})

describe('checkStages', () => {
  it('accepts every preset', () => {
    for (const p of STAGE_PRESETS) expect(checkStages(p.stages)).toBeNull()
  })
  it('refuses too few, too many, blank and repeated names', () => {
    expect(checkStages(['A', 'B'])).toMatch(/at least 3/)
    expect(checkStages(['1', '2', '3', '4', '5', '6', '7', '8', '9'])).toMatch(/8 stages/)
    expect(checkStages(['A', ' ', 'C'])).toMatch(/needs a name/)
    expect(checkStages(['A', 'b', 'B '])).toMatch(/same name/)
  })
})

describe('nextStep', () => {
  it('keeps the default words', () => {
    expect(nextStep(0, DEFAULT_STAGES).label).toBe('Start')
    expect(nextStep(1, DEFAULT_STAGES)).toMatchObject({ stage: 2, status: 'done', label: 'Mark done' })
    expect(nextStep(2, DEFAULT_STAGES)).toMatchObject({ stage: 0, status: 'todo', label: 'Reopen' })
  })
  it('names the next stage on a custom list', () => {
    expect(nextStep(0, SYSTEM)).toMatchObject({ stage: 1, status: 'in_progress', label: 'Start' })
    expect(nextStep(2, SYSTEM)).toMatchObject({ stage: 3, status: 'in_progress', label: 'Move to Revision' })
    expect(nextStep(3, SYSTEM)).toMatchObject({ stage: 4, status: 'done', label: 'Move to Completed' })
  })
})
