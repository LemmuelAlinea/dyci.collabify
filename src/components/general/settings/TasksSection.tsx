// src/components/general/settings/TasksSection.tsx
import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Toggle } from '../../ui/Field'
import { Select } from '../../ui/Select'
import { useToast } from '../../ui/Toast'
import { previewTaskFlow, setTaskFlow, updateGeneralProject } from '../../../lib/api/general'
import { authErrorMessage } from '../../../lib/authError'
import type { TaskFlow } from '../../../lib/general/permissions'
import { DEFAULT_TASK_RULES } from '../../../lib/general/taskRules'
import type { TaskRules } from '../../../lib/general/taskRules'
import { PRIORITIES } from '../../../lib/general/types'
import { checkStages, stagesOf, stagesToSave } from '../../../lib/stages'
import { qaStageIndex } from '../../../lib/work/qa'
import { StagesEditor } from '../../tasks/StagesEditor'
import { StagesView } from '../ProjectInfo'
import { RequestAccessButton } from '../RequestAccessButton'
import type { GeneralProjectState } from '../useGeneralProject'
import { EditButton } from './GeneralSection'

export function TasksSection({ state }: { state: GeneralProjectState }) {
  return (
    <div className="space-y-6">
      {state.project && !state.project.class_board_id && <TaskFlowPanel state={state} />}
      <StagesPanel state={state} />
      <TaskRulesPanel state={state} />
    </div>
  )
}

const FLOWS: { value: TaskFlow; label: string; help: string }[] = [
  {
    value: 'planned',
    label: 'Planned handoff',
    help: 'Tasks start in planning. The project manager or a coordinator sends them to a team.',
  },
  { value: 'open', label: 'Open', help: 'Anyone on the project adds live tasks and assigns them to anyone.' },
]

/** How new work reaches people: planned handoff or open. Only the project manager changes it. */
function TaskFlowPanel({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const p = state.project
  const saved: TaskFlow = p?.taskFlow ?? 'planned'
  const editable = state.myRole === 'pm' && !state.readOnly
  const [flow, setFlow] = useState<TaskFlow>(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [waiting, setWaiting] = useState<number | null>(null)

  const projectId = p?.id
  useEffect(() => {
    setFlow(saved)
  }, [saved, projectId])

  if (!p) return null

  async function apply(next: TaskFlow) {
    if (!p) return
    const released = await setTaskFlow(p.id, next)
    await state.reload()
    if (next === 'planned') show('Task flow is planned handoff.')
    else show(released > 0 ? `Task flow is open. ${released} ${released === 1 ? 'task is' : 'tasks are'} live.` : 'Task flow is open.')
  }

  async function save() {
    if (!p) return
    setError(null)
    setBusy(true)
    try {
      if (flow === 'open') {
        const counts = await previewTaskFlow(p.id)
        setWaiting(counts.planning + counts.review)
      } else {
        await apply('planned')
      }
    } catch (err) {
      setError(authErrorMessage(err, 'Could not change the task flow.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <header className="mb-4">
        <h2>Task flow</h2>
        <p className="mt-0.5 text-[12px] text-muted">
          How new tasks reach people.{!editable && ' Only the project manager changes this.'}
        </p>
      </header>
      {error && (
        <div className="mb-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <div role="radiogroup" aria-label="Task flow" className="grid gap-2 sm:grid-cols-2">
        {FLOWS.map((f) => {
          const selected = flow === f.value
          return (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!editable || busy}
              onClick={() => setFlow(f.value)}
              className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-default ${
                selected ? 'border-navy-600 bg-navy-500/12 dark:border-amber-400' : 'border-line-strong hover:border-navy-400'
              }`}
            >
              <span className="block text-[13px] font-medium text-ink">{f.label}</span>
              <span className="mt-0.5 block text-[12px] text-muted">{f.help}</span>
            </button>
          )
        })}
      </div>
      {editable && flow !== saved && (
        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <Button onClick={() => void save()} loading={busy}>
            Save task flow
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={waiting !== null}
        onClose={() => setWaiting(null)}
        onConfirm={() => apply('open')}
        title="Open the task flow?"
        tone="primary"
        confirmLabel="Open the task flow"
        body={
          <div className="space-y-2 text-[13px] text-muted">
            <p>Anyone on the project can add live tasks and assign them to anyone. Nobody reviews them first.</p>
            <p>
              {waiting
                ? `${waiting} ${waiting === 1 ? 'task waiting in planning or review goes' : 'tasks waiting in planning or review go'} live now.`
                : 'Nothing is waiting in planning.'}
            </p>
          </div>
        }
      />
    </section>
  )
}

function StagesPanel({ state }: { state: GeneralProjectState }) {
  const editable = state.can('edit_project') && !state.readOnly
  const [editing, setEditing] = useState(false)
  // Losing the permission mid-edit (an Owner takes it back) closes the form.
  const open = editable && editing

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Stages</h2>
          <p className="mt-0.5 text-[12px] text-muted">The columns this project's tasks move through.</p>
        </div>
        {!editable ? (
          <RequestAccessButton state={state} permission="edit_project" />
        ) : (
          !open && <EditButton label="Edit stages" onClick={() => setEditing(true)} />
        )}
      </header>
      {open ? <StagesForm state={state} onDone={() => setEditing(false)} /> : <StagesView state={state} />}
    </section>
  )
}

function StagesForm({ state, onDone }: { state: GeneralProjectState; onDone: () => void }) {
  const { show } = useToast()
  const p = state.project
  const [stages, setStages] = useState<string[]>([])
  const [qaStage, setQaStage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset when the project changes underneath, not on every realtime reload
  // while somebody is typing.
  const updatedAt = p?.updated_at
  useEffect(() => {
    if (!p) return
    setStages([...stagesOf(p.stages)])
    setQaStage(p.qa_stage ?? null)
  }, [updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return null

  async function save() {
    if (!p) return
    setError(null)
    const stageProblem = checkStages(stages)
    if (stageProblem) return setError(`Progress stages: ${stageProblem}`)
    setBusy(true)
    try {
      await updateGeneralProject(p.id, {
        stages: stagesToSave(stages),
        qa_stage: qaStage?.trim() || null,
      })
      show('Project saved')
      await state.reload()
      onDone()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the project.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <StagesEditor
        value={stages}
        onChange={setStages}
        disabled={busy}
        qaStage={qaStage}
        onQaStageChange={setQaStage}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={busy}>
          Save stages
        </Button>
      </div>
    </div>
  )
}

/**
 * The last stage a new task can start in: never the last (that is Done), and
 * never past an active QA stage. Mirrors the checks in project-task-rules.sql.
 */
function lastStartIndex(p: NonNullable<GeneralProjectState['project']>) {
  const last = stagesOf(p.stages).length - 2
  return p.has_qa ? Math.min(last, qaStageIndex(p.stages, p.qa_stage)) : last
}

type SwitchKey = Exclude<keyof TaskRules, 'defaultPriority' | 'defaultStage'>

function TaskRulesPanel({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const p = state.project
  const editable = state.can('edit_project') && !state.readOnly
  const saved = p?.taskRules ?? DEFAULT_TASK_RULES
  const [rules, setRules] = useState<TaskRules>(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const priorityId = useId()
  const stageId = useId()

  // Reset when the saved rules or the project change underneath, not on every
  // realtime reload while somebody is choosing.
  const savedKey = JSON.stringify(saved)
  const projectId = p?.id
  useEffect(() => {
    setRules(saved)
  }, [savedKey, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return null

  const stages = stagesOf(p.stages)
  const lastStart = lastStartIndex(p)
  const shownStage = Math.min(Math.max(rules.defaultStage, 0), lastStart)
  const stageOptions = stages.slice(0, lastStart + 1).map((name, i) => ({ value: String(i), label: name }))
  const qaMoved = p.has_qa && qaStageIndex(p.stages, p.qa_stage) < stages.length - 2 && rules.defaultStage > lastStart
  const set = <K extends keyof TaskRules>(key: K, value: TaskRules[K]) => setRules((r) => ({ ...r, [key]: value }))
  const off = !editable || busy

  async function save() {
    if (!p) return
    setError(null)
    setBusy(true)
    try {
      await updateGeneralProject(p.id, {
        default_priority: rules.defaultPriority,
        default_stage: shownStage,
        allow_subtasks: rules.allowSubtasks,
        allow_dependencies: rules.allowDependencies,
        allow_multiple_assignees: rules.allowMultipleAssignees,
        require_assignee: rules.requireAssignee,
        require_subtasks_done: rules.requireSubtasksDone,
      })
      await state.reload()
      show('Task rules saved')
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the task rules.'))
    } finally {
      setBusy(false)
    }
  }

  const switches: { label: string; key: SwitchKey; help?: string }[] = [
    { label: 'Allow subtasks', key: 'allowSubtasks' },
    { label: 'Allow dependencies', key: 'allowDependencies' },
    {
      label: 'Allow multiple holders',
      key: 'allowMultipleAssignees',
      help: "Turning this off keeps current holders; tasks just can't get another.",
    },
    { label: 'Require a holder before work starts', key: 'requireAssignee' },
    { label: 'Require all subtasks to be done first', key: 'requireSubtasksDone' },
  ]

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Task rules</h2>
          <p className="mt-0.5 text-[12px] text-muted">What new tasks start with, and what this project's tasks may do.</p>
        </div>
        {!editable && <RequestAccessButton state={state} permission="edit_project" />}
      </header>

      {error && (
        <div className="my-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="divide-y divide-[var(--line)]">
        <RuleRow title="Default priority" htmlFor={priorityId}>
          <Select
            id={priorityId}
            value={rules.defaultPriority}
            onChange={(e) => set('defaultPriority', e.target.value as TaskRules['defaultPriority'])}
            disabled={off}
            options={PRIORITIES.map((x) => ({ value: x.value, label: x.label }))}
          />
        </RuleRow>
        <RuleRow
          title="New tasks start in"
          htmlFor={stageId}
          note={qaMoved ? `Tasks start at ${stages[shownStage]} because of the QA stage.` : undefined}
        >
          <Select
            id={stageId}
            value={String(shownStage)}
            onChange={(e) => set('defaultStage', Number(e.target.value))}
            disabled={off}
            options={stageOptions}
          />
        </RuleRow>
        {switches.map((s) => (
          <RuleRow key={s.key} title={s.label} help={s.help}>
            <Toggle label={s.label} checked={rules[s.key]} onChange={(v) => set(s.key, v)} disabled={off} />
          </RuleRow>
        ))}
      </div>

      {editable && (
        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <Button onClick={() => void save()} loading={busy}>
            Save task rules
          </Button>
        </div>
      )}
    </section>
  )
}

/** One rule: its name and help on the left, its control on the right. */
function RuleRow({
  title,
  help,
  note,
  htmlFor,
  children,
}: {
  title: string
  help?: string
  note?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2 py-4 first:pt-2 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,260px)] sm:items-center sm:gap-6">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
            {title}
          </label>
        ) : (
          <p className="text-[13px] font-medium text-ink">{title}</p>
        )}
        {help && <p className="mt-0.5 text-[12px] text-muted">{help}</p>}
        {note && <p className="mt-1 text-[12px] text-muted">{note}</p>}
      </div>
      <div className="min-w-0 sm:justify-self-end sm:w-full">{children}</div>
    </div>
  )
}
