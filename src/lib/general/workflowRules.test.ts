import { describe, expect, it } from 'vitest'
import {
  moveStageChoices,
  ruleDraft,
  ruleFromRow,
  rulePayload,
  ruleProblem,
  ruleSentence,
} from './workflowRules'
import type { RuleDraft, WorkflowRule } from './workflowRules'

const base: WorkflowRule = {
  id: 'r1', projectId: 'p1', name: '', enabled: true, position: 1,
  triggerKind: 'task_released', triggerStage: null, triggerPriority: null,
  actionKind: 'notify', notifyTo: 'team_lead', personId: null, actionPriority: null, actionStage: null,
  createdBy: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  lastSkippedAt: null, lastSkipReason: null,
}
const rule = (over: Partial<WorkflowRule>): WorkflowRule => ({ ...base, ...over })
const STAGES = ['To do', 'Doing', 'Review', 'Done']
const people = (id: string) => (id === 'ana' ? 'Ana Reyes' : undefined)

describe('ruleSentence', () => {
  it('reads every trigger', () => {
    const s = (over: Partial<WorkflowRule>) => ruleSentence(rule(over), STAGES, people)
    expect(s({ triggerKind: 'stage_entered', triggerStage: 'Review' })).toBe('When a task moves to Review, notify the team lead')
    expect(s({ triggerKind: 'task_released' })).toBe('When a task is sent to a team, notify the team lead')
    expect(s({ triggerKind: 'task_overdue' })).toBe('When a task becomes overdue, notify the team lead')
    expect(s({ triggerKind: 'priority_raised', triggerPriority: 'urgent' })).toBe("When a task's priority is raised to Urgent, notify the team lead")
    expect(s({ triggerKind: 'priority_raised', triggerPriority: 'high' })).toBe("When a task's priority is raised to High, notify the team lead")
  })

  it('reads every action', () => {
    const s = (over: Partial<WorkflowRule>) => ruleSentence(rule({ triggerKind: 'task_overdue', ...over }), STAGES, people)
    expect(s({ actionKind: 'notify', notifyTo: 'planners' })).toBe('When a task becomes overdue, notify the project manager and coordinators')
    expect(s({ actionKind: 'notify', notifyTo: 'qa' })).toBe('When a task becomes overdue, notify QA')
    expect(s({ actionKind: 'notify', notifyTo: 'holders' })).toBe("When a task becomes overdue, notify the task's holders")
    expect(s({ actionKind: 'notify', notifyTo: 'person', personId: 'ana' })).toBe('When a task becomes overdue, notify Ana Reyes')
    expect(s({ actionKind: 'set_priority', notifyTo: null, actionPriority: 'low' })).toBe('When a task becomes overdue, set the priority to Low')
    expect(s({ actionKind: 'assign', notifyTo: null, personId: 'ana' })).toBe('When a task becomes overdue, assign Ana Reyes')
    expect(s({ actionKind: 'move_stage', notifyTo: null, actionStage: 'Doing' })).toBe('When a task becomes overdue, move it to Doing')
  })

  it('names someone who has gone as the database does', () => {
    expect(ruleSentence(rule({ actionKind: 'assign', notifyTo: null, personId: 'gone' }), STAGES, people))
      .toBe('When a task is sent to a team, assign someone no longer in the project')
    expect(ruleSentence(rule({ notifyTo: 'person', personId: null }), STAGES, people))
      .toBe('When a task is sent to a team, notify someone no longer in the project')
  })

  it('spells a stage the way the project does', () => {
    expect(ruleSentence(rule({ triggerKind: 'stage_entered', triggerStage: 'review' }), STAGES, people))
      .toBe('When a task moves to Review, notify the team lead')
    expect(ruleSentence(rule({ triggerKind: 'stage_entered', triggerStage: 'Gone' }), STAGES, people))
      .toBe('When a task moves to Gone, notify the team lead')
  })
})

describe('ruleProblem', () => {
  const members = [
    { user_id: 'ana', profile: { first_name: 'Ana', last_name: 'Reyes', status: 'active' } },
    { user_id: 'old', profile: { first_name: 'Old', last_name: 'Timer', status: 'inactive' } },
  ] as never

  it('is null for a rule that still works', () => {
    expect(ruleProblem(rule({ triggerKind: 'stage_entered', triggerStage: 'review', actionKind: 'assign', notifyTo: null, personId: 'ana' }), STAGES, members)).toBeNull()
    expect(ruleProblem(rule({}), null, members)).toBeNull()
  })

  it('names a stage the project no longer has, in the trigger or the action', () => {
    expect(ruleProblem(rule({ triggerKind: 'stage_entered', triggerStage: 'Testing' }), STAGES, members))
      .toBe('Stage Testing no longer exists. Edit the rule.')
    expect(ruleProblem(rule({ actionKind: 'move_stage', notifyTo: null, actionStage: 'QA' }), STAGES, members))
      .toBe('Stage QA no longer exists. Edit the rule.')
  })

  it('names a person who left, whose account is off, or whose account is gone', () => {
    expect(ruleProblem(rule({ actionKind: 'assign', notifyTo: null, personId: 'zed' }), STAGES, members))
      .toBe('A former member is no longer in the project.')
    expect(ruleProblem(rule({ actionKind: 'assign', notifyTo: null, personId: 'old' }), STAGES, members))
      .toBe('Old Timer is no longer in the project.')
    expect(ruleProblem(rule({ notifyTo: 'person', personId: null }), STAGES, members))
      .toBe("The rule's person is no longer in the project.")
  })
})

describe('moveStageChoices', () => {
  const stages = ['Planning', 'Development', 'Testing', 'Revision', 'Completed']
  it('leaves out the last stage', () => {
    expect(moveStageChoices(stages, { hasQa: false, qaStage: null })).toEqual(['Planning', 'Development', 'Testing', 'Revision'])
    expect(moveStageChoices(null, { hasQa: false, qaStage: null })).toEqual(['To do', 'In progress'])
  })
  it('leaves out the stages past an active QA stage', () => {
    expect(moveStageChoices(stages, { hasQa: true, qaStage: null })).toEqual(['Planning', 'Development', 'Testing'])
    expect(moveStageChoices(stages, { hasQa: true, qaStage: 'Development' })).toEqual(['Planning', 'Development'])
  })
})

describe('rulePayload', () => {
  const draft = (over: Partial<RuleDraft>): RuleDraft => ({ ...ruleDraft(), ...over })

  it('starts as a notify rule on a task sent to a team', () => {
    expect(rulePayload(draft({ name: '  Heads up  ' }))).toEqual({
      name: 'Heads up', trigger_kind: 'task_released', trigger_stage: null, trigger_priority: null,
      action_kind: 'notify', notify_to: 'team_lead', person_id: null, action_priority: null, action_stage: null,
    })
  })
  it('carries the trigger field its kind needs and clears the rest', () => {
    expect(rulePayload(draft({ triggerKind: 'stage_entered', triggerStage: 'Review', triggerPriority: 'urgent' })))
      .toMatchObject({ trigger_kind: 'stage_entered', trigger_stage: 'Review', trigger_priority: null })
    expect(rulePayload(draft({ triggerKind: 'priority_raised', triggerStage: 'Review', triggerPriority: 'urgent' })))
      .toMatchObject({ trigger_kind: 'priority_raised', trigger_stage: null, trigger_priority: 'urgent' })
    expect(rulePayload(draft({ triggerKind: 'task_overdue', triggerStage: 'Review', triggerPriority: 'urgent' })))
      .toMatchObject({ trigger_stage: null, trigger_priority: null })
  })
  it('carries the action field its kind needs and clears the rest', () => {
    const rest = { actionPriority: 'high', actionStage: 'Doing', personId: 'ana', notifyTo: 'person' } as const
    expect(rulePayload(draft({ actionKind: 'notify', ...rest })))
      .toMatchObject({ action_kind: 'notify', notify_to: 'person', person_id: 'ana', action_priority: null, action_stage: null })
    expect(rulePayload(draft({ actionKind: 'notify', ...rest, notifyTo: 'qa' })))
      .toMatchObject({ notify_to: 'qa', person_id: null })
    expect(rulePayload(draft({ actionKind: 'set_priority', ...rest })))
      .toMatchObject({ action_kind: 'set_priority', notify_to: null, person_id: null, action_priority: 'high', action_stage: null })
    expect(rulePayload(draft({ actionKind: 'assign', ...rest })))
      .toMatchObject({ action_kind: 'assign', notify_to: null, person_id: 'ana', action_priority: null, action_stage: null })
    expect(rulePayload(draft({ actionKind: 'move_stage', ...rest })))
      .toMatchObject({ action_kind: 'move_stage', notify_to: null, person_id: null, action_priority: null, action_stage: 'Doing' })
  })
})

describe('ruleFromRow', () => {
  it('turns a row into a rule and back into a draft', () => {
    const r = ruleFromRow({
      id: 'r1', project_id: 'p1', name: 'N', enabled: false, position: 3, trigger_kind: 'stage_entered', trigger_stage: 'Review',
      trigger_priority: null, action_kind: 'assign', notify_to: null, person_id: 'ana', action_priority: null, action_stage: null,
      created_by: 'x', created_at: 'c', updated_at: 'u', last_skipped_at: 's', last_skip_reason: 'why',
    })
    expect(r).toMatchObject({ projectId: 'p1', enabled: false, triggerStage: 'Review', personId: 'ana', lastSkipReason: 'why' })
    expect(rulePayload(ruleDraft(r))).toMatchObject({ name: 'N', trigger_kind: 'stage_entered', trigger_stage: 'Review', action_kind: 'assign', person_id: 'ana' })
  })
})
