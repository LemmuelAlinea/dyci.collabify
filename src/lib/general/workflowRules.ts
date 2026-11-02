// src/lib/general/workflowRules.ts
/**
 * A work project's workflow rules: "When {trigger}, then {action}". The
 * database owns them (supabase/project-workflow-rules.sql); this is the app's
 * copy of the types, the option lists and the rule as a sentence, which must
 * read as general_workflow_rule_sentence does.
 */
import { stagesOf } from '../stages'
import { qaStageIndex } from '../work/qa'
import type { GeneralMember } from './types'

export type WorkflowTrigger = 'stage_entered' | 'task_released' | 'task_overdue' | 'priority_raised'
export type WorkflowAction = 'notify' | 'set_priority' | 'assign' | 'move_stage'
export type NotifyTo = 'team_lead' | 'planners' | 'qa' | 'holders' | 'person'
export type RulePriority = 'low' | 'normal' | 'high' | 'urgent'
export type TriggerPriority = 'high' | 'urgent'

/** One general_workflow_rules row, as the database returns it. */
export type WorkflowRuleRow = {
  id: string
  project_id: string
  name: string
  enabled: boolean
  position: number
  trigger_kind: WorkflowTrigger
  trigger_stage: string | null
  trigger_priority: TriggerPriority | null
  action_kind: WorkflowAction
  notify_to: NotifyTo | null
  person_id: string | null
  action_priority: RulePriority | null
  action_stage: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  last_skipped_at: string | null
  last_skip_reason: string | null
}

export type WorkflowRule = {
  id: string
  projectId: string
  name: string
  enabled: boolean
  position: number
  triggerKind: WorkflowTrigger
  triggerStage: string | null
  triggerPriority: TriggerPriority | null
  actionKind: WorkflowAction
  notifyTo: NotifyTo | null
  personId: string | null
  actionPriority: RulePriority | null
  actionStage: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  lastSkippedAt: string | null
  lastSkipReason: string | null
}

export const WORKFLOW_RULE_LIMIT = 20

export function ruleFromRow(r: WorkflowRuleRow): WorkflowRule {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    enabled: r.enabled,
    position: r.position,
    triggerKind: r.trigger_kind,
    triggerStage: r.trigger_stage,
    triggerPriority: r.trigger_priority,
    actionKind: r.action_kind,
    notifyTo: r.notify_to,
    personId: r.person_id,
    actionPriority: r.action_priority,
    actionStage: r.action_stage,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastSkippedAt: r.last_skipped_at,
    lastSkipReason: r.last_skip_reason,
  }
}

type Option<T extends string> = { value: T; label: string }

export const TRIGGER_OPTIONS: Option<WorkflowTrigger>[] = [
  { value: 'stage_entered', label: 'A task moves to a stage' },
  { value: 'task_released', label: 'A task is sent to a team' },
  { value: 'task_overdue', label: 'A task becomes overdue' },
  { value: 'priority_raised', label: "A task's priority is raised to" },
]

export const ACTION_OPTIONS: Option<WorkflowAction>[] = [
  { value: 'notify', label: 'Notify' },
  { value: 'set_priority', label: 'Set the priority to' },
  { value: 'assign', label: 'Assign' },
  { value: 'move_stage', label: 'Move it to' },
]

export const NOTIFY_OPTIONS: Option<NotifyTo>[] = [
  { value: 'team_lead', label: 'The team lead' },
  { value: 'planners', label: 'The project manager and coordinators' },
  { value: 'qa', label: 'QA' },
  { value: 'holders', label: "The task's holders" },
  { value: 'person', label: 'A specific person' },
]

export const TRIGGER_PRIORITY_OPTIONS: Option<TriggerPriority>[] = [
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

export const ACTION_PRIORITY_OPTIONS: Option<RulePriority>[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const cap = (s: string) => `${s[0]?.toUpperCase() ?? ''}${s.slice(1)}`

/** A stage as the project spells it (the database matches without regard to case or edge spaces). */
function stageAs(stages: readonly string[], name: string): string | undefined {
  const want = name.trim().toLowerCase()
  return stages.find((s) => s.trim().toLowerCase() === want)
}

/** A person's name as the database writes it into a sentence: first and last name. */
export function personName(profile: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  return [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim()
}

const GONE = 'someone no longer in the project'

/**
 * The rule as one sentence, e.g. "When a task moves to Review, notify the team
 * lead". Mirrors general_workflow_rule_sentence. A stage reads as the project
 * spells it now; `people` gives a person's name, or nothing for somebody gone.
 */
export function ruleSentence(
  rule: WorkflowRule,
  stages: readonly string[] | null | undefined,
  people: (userId: string) => string | undefined,
): string {
  const list = stagesOf(stages)
  const who = (rule.personId ? people(rule.personId) : undefined) || GONE
  const stage = (name: string | null) => (name ? (stageAs(list, name) ?? name) : '')

  const when =
    rule.triggerKind === 'stage_entered'
      ? `a task moves to ${stage(rule.triggerStage)}`
      : rule.triggerKind === 'task_released'
        ? 'a task is sent to a team'
        : rule.triggerKind === 'task_overdue'
          ? 'a task becomes overdue'
          : `a task's priority is raised to ${cap(rule.triggerPriority ?? '')}`

  let then: string
  switch (rule.actionKind) {
    case 'notify':
      then = `notify ${
        rule.notifyTo === 'team_lead'
          ? 'the team lead'
          : rule.notifyTo === 'planners'
            ? 'the project manager and coordinators'
            : rule.notifyTo === 'qa'
              ? 'QA'
              : rule.notifyTo === 'holders'
                ? "the task's holders"
                : who
      }`
      break
    case 'set_priority':
      then = `set the priority to ${cap(rule.actionPriority ?? '')}`
      break
    case 'assign':
      then = `assign ${who}`
      break
    default:
      then = `move it to ${stage(rule.actionStage)}`
  }
  return `When ${when}, ${then}`
}

type MemberLike = Pick<GeneralMember, 'user_id'> & { profile: (Pick<NonNullable<GeneralMember['profile']>, 'first_name' | 'last_name'> & { status?: string }) | null }

/**
 * What no longer holds for a rule, in words to show under it, or null: a stage
 * the project dropped, or a person who left (or whose account is off). The
 * database skips such a rule when it fires; this tells the manager to edit it.
 */
export function ruleProblem(
  rule: WorkflowRule,
  stages: readonly string[] | null | undefined,
  members: readonly MemberLike[],
): string | null {
  const list = stagesOf(stages)
  const missing = [
    rule.triggerKind === 'stage_entered' ? rule.triggerStage : null,
    rule.actionKind === 'move_stage' ? rule.actionStage : null,
  ].find((name) => name !== null && !stageAs(list, name))
  if (missing) return `Stage ${missing} no longer exists. Edit the rule.`

  const usesPerson = rule.actionKind === 'assign' || (rule.actionKind === 'notify' && rule.notifyTo === 'person')
  if (!usesPerson) return null
  if (!rule.personId) return "The rule's person is no longer in the project."
  const member = members.find((m) => m.user_id === rule.personId)
  if (member && (!member.profile || !member.profile.status || member.profile.status === 'active')) return null
  const name = member ? personName(member.profile) : ''
  return `${name || 'A former member'} is no longer in the project.`
}

/**
 * The stages a "move it to" rule may name: not the last stage, and not a stage
 * past an active QA stage. Mirrors the checks in apply_general_workflow_rule.
 */
export function moveStageChoices(
  stages: readonly string[] | null | undefined,
  qa: { hasQa: boolean; qaStage: string | null | undefined },
): string[] {
  const list = stagesOf(stages)
  const last = list.length - 2
  const limit = qa.hasQa ? Math.min(last, qaStageIndex(stages, qa.qaStage)) : last
  return list.slice(0, limit + 1)
}

/** What the builder holds while somebody fills it in. */
export type RuleDraft = {
  name: string
  triggerKind: WorkflowTrigger
  triggerStage: string
  triggerPriority: TriggerPriority
  actionKind: WorkflowAction
  notifyTo: NotifyTo
  personId: string
  actionPriority: RulePriority
  actionStage: string
}

/** A new rule: "When a task is sent to a team, notify the team lead", ready to adjust. */
export function ruleDraft(rule?: WorkflowRule): RuleDraft {
  return {
    name: rule?.name ?? '',
    triggerKind: rule?.triggerKind ?? 'task_released',
    triggerStage: rule?.triggerStage ?? '',
    triggerPriority: rule?.triggerPriority ?? 'high',
    actionKind: rule?.actionKind ?? 'notify',
    notifyTo: rule?.notifyTo ?? 'team_lead',
    personId: rule?.personId ?? '',
    actionPriority: rule?.actionPriority ?? 'high',
    actionStage: rule?.actionStage ?? '',
  }
}

/** The columns a save writes: the fields the chosen kinds use, and null for the rest (the table's checks require it). */
export type RulePayload = {
  name: string
  trigger_kind: WorkflowTrigger
  trigger_stage: string | null
  trigger_priority: TriggerPriority | null
  action_kind: WorkflowAction
  notify_to: NotifyTo | null
  person_id: string | null
  action_priority: RulePriority | null
  action_stage: string | null
}

export function rulePayload(d: RuleDraft): RulePayload {
  const notify = d.actionKind === 'notify'
  return {
    name: d.name.trim(),
    trigger_kind: d.triggerKind,
    trigger_stage: d.triggerKind === 'stage_entered' ? d.triggerStage : null,
    trigger_priority: d.triggerKind === 'priority_raised' ? d.triggerPriority : null,
    action_kind: d.actionKind,
    notify_to: notify ? d.notifyTo : null,
    person_id: d.actionKind === 'assign' || (notify && d.notifyTo === 'person') ? d.personId : null,
    action_priority: d.actionKind === 'set_priority' ? d.actionPriority : null,
    action_stage: d.actionKind === 'move_stage' ? d.actionStage : null,
  }
}

/** What the builder still needs before it can save, or null. */
export function draftProblem(d: RuleDraft): string | null {
  const p = rulePayload(d)
  if (d.triggerKind === 'stage_entered' && !p.trigger_stage) return 'Choose a stage for the rule to watch.'
  if (d.actionKind === 'move_stage' && !p.action_stage) return 'Choose the stage to move tasks to.'
  if ((d.actionKind === 'assign' || (d.actionKind === 'notify' && d.notifyTo === 'person')) && !p.person_id) {
    return 'Choose a person.'
  }
  return null
}

/** Who a notify or assign rule may name: current members, never a stakeholder; QA may be told but not given tasks. */
export function personChoices(members: readonly GeneralMember[], forAssign: boolean): GeneralMember[] {
  return members.filter(
    (m) =>
      m.role !== 'stakeholder' &&
      !(forAssign && m.role === 'qa') &&
      (!m.profile || m.profile.status === 'active'),
  )
}
