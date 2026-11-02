/**
 * A work project's workflow rules. The database holds the limits and the
 * refusals (supabase/project-workflow-rules.sql); a refusal comes back as the
 * error to show.
 */
import { supabase } from '../supabase'
import { ruleFromRow } from '../general/workflowRules'
import type { RulePayload, WorkflowRule, WorkflowRuleRow } from '../general/workflowRules'
import { isMissingRelation } from './missingRelation'

const COLUMNS =
  'id, project_id, name, enabled, position, trigger_kind, trigger_stage, trigger_priority, action_kind, notify_to, person_id, action_priority, action_stage, created_by, created_at, updated_at, last_skipped_at, last_skip_reason'

/** Oldest first, the order the rules run in. */
export async function listWorkflowRules(projectId: string): Promise<WorkflowRule[]> {
  const { data, error } = await supabase
    .from('general_workflow_rules')
    .select(COLUMNS)
    .eq('project_id', projectId)
    .order('position')
  if (error) {
    // Until project-workflow-rules.sql is live there are no rules; remove this once it is.
    if (isMissingRelation(error, 'general_workflow_rules')) return []
    throw error
  }
  return ((data ?? []) as unknown as WorkflowRuleRow[]).map(ruleFromRow)
}

function touched(data: unknown[] | null, message: string) {
  if (!data || data.length === 0) throw new Error(message)
}

export async function addWorkflowRule(projectId: string, input: RulePayload) {
  const { error } = await supabase.from('general_workflow_rules').insert({ project_id: projectId, ...input })
  if (error) throw error
}

export async function updateWorkflowRule(id: string, input: RulePayload) {
  const { data, error } = await supabase.from('general_workflow_rules').update(input).eq('id', id).select('id')
  if (error) throw error
  touched(data, 'That rule could not change. It may be gone, or you may not manage rules here. Reload the page and try again.')
}

export async function setWorkflowRuleEnabled(id: string, enabled: boolean) {
  const { data, error } = await supabase.from('general_workflow_rules').update({ enabled }).eq('id', id).select('id')
  if (error) throw error
  touched(data, 'That rule could not change. It may be gone, or you may not manage rules here. Reload the page and try again.')
}

export async function deleteWorkflowRule(id: string) {
  const { data, error } = await supabase.from('general_workflow_rules').delete().eq('id', id).select('id')
  if (error) throw error
  touched(data, 'That rule could not be deleted. Reload the page and try again.')
}
