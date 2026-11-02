// src/components/general/settings/WorkflowSection.tsx
import { useState } from 'react'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Field, Input, Toggle } from '../../ui/Field'
import { Modal } from '../../ui/Modal'
import { Select } from '../../ui/Select'
import { useToast } from '../../ui/Toast'
import {
  addWorkflowRule,
  deleteWorkflowRule,
  setWorkflowRuleEnabled,
  updateWorkflowRule,
} from '../../../lib/api/workflowRules'
import { authErrorMessage } from '../../../lib/authError'
import { stagesOf } from '../../../lib/stages'
import {
  ACTION_OPTIONS,
  ACTION_PRIORITY_OPTIONS,
  NOTIFY_OPTIONS,
  TRIGGER_OPTIONS,
  TRIGGER_PRIORITY_OPTIONS,
  WORKFLOW_RULE_LIMIT,
  draftProblem,
  moveStageChoices,
  personChoices,
  personName,
  ruleDraft,
  rulePayload,
  ruleProblem,
  ruleSentence,
} from '../../../lib/general/workflowRules'
import type { RuleDraft, WorkflowRule } from '../../../lib/general/workflowRules'
import type { GeneralProjectState } from '../useGeneralProject'

const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function WorkflowSection({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const p = state.project
  const [editing, setEditing] = useState<{ rule: WorkflowRule | null } | null>(null)
  const [deleting, setDeleting] = useState<WorkflowRule | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!p) return null

  const rules = state.workflowRules ?? []
  const editable =
    (state.myRole === 'pm' || state.myRole === 'coordinator') && !state.readOnly && !p.class_board_id
  const full = rules.length >= WORKFLOW_RULE_LIMIT
  const nameFor = (id: string) => {
    const m = state.members.find((x) => x.user_id === id)
    return m ? personName(m.profile) || undefined : undefined
  }

  async function flip(rule: WorkflowRule, enabled: boolean) {
    setError(null)
    setBusyId(rule.id)
    try {
      await setWorkflowRuleEnabled(rule.id, enabled)
      await state.reload()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not change that rule.'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Workflow rules</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Rules act for the project. They follow the project's task rules and never set off other rules.
          </p>
        </div>
        {editable && !full && (
          <Button onClick={() => setEditing({ rule: null })}>Add rule</Button>
        )}
      </header>

      {editable && full && (
        <p className="mb-2 text-[12px] text-muted">A project can have up to {WORKFLOW_RULE_LIMIT} rules.</p>
      )}
      {error && (
        <div className="my-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {rules.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-faint">No rules yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {rules.map((rule) => {
            const sentence = ruleSentence(rule, p.stages, nameFor)
            const title = rule.name || sentence
            const problem = ruleProblem(rule, p.stages, state.members)
            return (
              <li key={rule.id} className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-2 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-ink">{title}</p>
                  {rule.name && <p className="mt-0.5 text-[12px] text-muted">{sentence}</p>}
                  {rule.lastSkippedAt && rule.lastSkipReason && (
                    <p className="mt-1 text-[12px] text-warning-700 dark:text-warning-300">
                      Last skipped {shortDay(rule.lastSkippedAt)}: {rule.lastSkipReason}
                    </p>
                  )}
                  {problem && (
                    <p className="mt-1 text-[12px] text-danger-600 dark:text-danger-400">{problem}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Toggle
                    label={title}
                    checked={rule.enabled}
                    onChange={(v) => void flip(rule, v)}
                    disabled={!editable || busyId === rule.id}
                  />
                  {editable && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setEditing({ rule })}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(rule)}>
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <RuleBuilder
          key={editing.rule?.id ?? 'new'}
          state={state}
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await state.reload()
            show('Rule saved')
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this rule?"
        body={deleting ? deleting.name || ruleSentence(deleting, p.stages, nameFor) : ''}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deleting) return
          try {
            await deleteWorkflowRule(deleting.id)
          } catch (err) {
            throw new Error(authErrorMessage(err, 'Could not delete that rule.'), { cause: err })
          }
          await state.reload()
          show('Rule deleted')
        }}
      />
    </section>
  )
}

/** The dialog that adds a rule, or edits one from what it says now. */
function RuleBuilder({
  state,
  rule,
  onClose,
  onSaved,
}: {
  state: GeneralProjectState
  rule: WorkflowRule | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const p = state.project!
  const stages = stagesOf(p.stages)
  const moveStages = moveStageChoices(p.stages, { hasQa: p.has_qa, qaStage: p.qa_stage })
  const [draft, setDraft] = useState<RuleDraft>(() => fitDraft(ruleDraft(rule ?? undefined), stages, moveStages, state))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const forAssign = draft.actionKind === 'assign'
  const people = personChoices(state.members, forAssign)

  async function save() {
    const missing = draftProblem(draft)
    if (missing) {
      setError(missing)
      return
    }
    setError(null)
    setBusy(true)
    try {
      if (rule) await updateWorkflowRule(rule.id, rulePayload(draft))
      else await addWorkflowRule(p.id, rulePayload(draft))
      await onSaved()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save that rule.'))
      setBusy(false)
    }
  }

  const stageOptions = (list: readonly string[]) => list.map((s) => ({ value: s, label: s }))

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={rule ? 'Edit rule' : 'Add rule'}
      size="md"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Save rule
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name" optional>
          {(id) => (
            <Input id={id} value={draft.name} maxLength={80} onChange={(e) => set('name', e.target.value)} disabled={busy} />
          )}
        </Field>

        <Field label="When">
          {(id) => (
            <div className="space-y-2">
              <Select
                id={id}
                value={draft.triggerKind}
                onChange={(e) => set('triggerKind', e.target.value as RuleDraft['triggerKind'])}
                disabled={busy}
                options={TRIGGER_OPTIONS}
              />
              {draft.triggerKind === 'stage_entered' && (
                <Select
                  aria-label="Stage"
                  value={draft.triggerStage}
                  onChange={(e) => set('triggerStage', e.target.value)}
                  disabled={busy}
                  placeholder="Choose a stage"
                  options={stageOptions(stages)}
                />
              )}
              {draft.triggerKind === 'priority_raised' && (
                <Select
                  aria-label="Priority raised to"
                  value={draft.triggerPriority}
                  onChange={(e) => set('triggerPriority', e.target.value as RuleDraft['triggerPriority'])}
                  disabled={busy}
                  options={TRIGGER_PRIORITY_OPTIONS}
                />
              )}
            </div>
          )}
        </Field>

        <Field label="Then">
          {(id) => (
            <div className="space-y-2">
              <Select
                id={id}
                value={draft.actionKind}
                onChange={(e) => {
                  const actionKind = e.target.value as RuleDraft['actionKind']
                  // A person chosen for one action may not be allowed for the next (QA cannot be given tasks).
                  const keep = actionKind === 'assign' ? personChoices(state.members, true).some((m) => m.user_id === draft.personId) : true
                  setDraft((d) => ({ ...d, actionKind, personId: keep ? d.personId : '' }))
                }}
                disabled={busy}
                options={ACTION_OPTIONS}
              />
              {draft.actionKind === 'notify' && (
                <Select
                  aria-label="Notify"
                  value={draft.notifyTo}
                  onChange={(e) => set('notifyTo', e.target.value as RuleDraft['notifyTo'])}
                  disabled={busy}
                  options={NOTIFY_OPTIONS}
                />
              )}
              {(forAssign || (draft.actionKind === 'notify' && draft.notifyTo === 'person')) && (
                <Select
                  aria-label="Person"
                  value={draft.personId}
                  onChange={(e) => set('personId', e.target.value)}
                  disabled={busy}
                  placeholder="Choose a person"
                  options={people.map((m) => ({ value: m.user_id, label: personName(m.profile) || 'A member' }))}
                />
              )}
              {draft.actionKind === 'set_priority' && (
                <Select
                  aria-label="Priority"
                  value={draft.actionPriority}
                  onChange={(e) => set('actionPriority', e.target.value as RuleDraft['actionPriority'])}
                  disabled={busy}
                  options={ACTION_PRIORITY_OPTIONS}
                />
              )}
              {draft.actionKind === 'move_stage' && (
                <Select
                  aria-label="Move to"
                  value={draft.actionStage}
                  onChange={(e) => set('actionStage', e.target.value)}
                  disabled={busy}
                  placeholder="Choose a stage"
                  options={stageOptions(moveStages)}
                />
              )}
            </div>
          )}
        </Field>
      </div>
    </Modal>
  )
}

/**
 * An edited rule starts from what it says now: a stage as the project spells it,
 * and nothing chosen where its stage or person has gone, so the manager picks again.
 */
function fitDraft(d: RuleDraft, stages: readonly string[], moveStages: readonly string[], state: GeneralProjectState): RuleDraft {
  const spelled = (list: readonly string[], name: string) =>
    list.find((s) => s.trim().toLowerCase() === name.trim().toLowerCase()) ?? ''
  const person = personChoices(state.members, d.actionKind === 'assign').some((m) => m.user_id === d.personId)
  return {
    ...d,
    triggerStage: spelled(stages, d.triggerStage),
    actionStage: spelled(moveStages, d.actionStage),
    personId: person ? d.personId : '',
  }
}
