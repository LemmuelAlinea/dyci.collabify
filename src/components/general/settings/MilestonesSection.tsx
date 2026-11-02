// src/components/general/settings/MilestonesSection.tsx
import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { Toggle } from '../../ui/Field'
import { Select } from '../../ui/Select'
import { useToast } from '../../ui/Toast'
import { updateGeneralProject } from '../../../lib/api/general'
import { authErrorMessage } from '../../../lib/authError'
import { DEFAULT_MILESTONE_RULES } from '../../../lib/general/milestoneRules'
import type { MilestoneCompletion, MilestoneRules } from '../../../lib/general/milestoneRules'
import { RequestAccessButton } from '../RequestAccessButton'
import type { GeneralProjectState } from '../useGeneralProject'

const COMPLETION_OPTIONS: { value: MilestoneCompletion; label: string }[] = [
  { value: 'automatic', label: 'Automatic — when all its tasks are done' },
  { value: 'manual', label: 'Manual — when someone marks it' },
]

type SwitchKey = Exclude<keyof MilestoneRules, 'completion'>

const SWITCHES: { label: string; key: SwitchKey; help?: string }[] = [
  { label: 'Require a due date', key: 'requireDue', help: 'Turn this off to let milestones go without a due date.' },
  { label: 'Allow milestone dependencies', key: 'allowDependencies', help: 'A milestone can wait for others to be reached first. Links already made stay.' },
  {
    label: 'Overdue milestone alerts',
    key: 'overdueAlerts',
    help: 'The project manager and coordinators are told the morning after a missed due date.',
  },
]

export function MilestonesSection({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const p = state.project
  const editable = state.can('edit_project') && !state.readOnly
  const saved = p?.milestoneRules ?? DEFAULT_MILESTONE_RULES
  const [rules, setRules] = useState<MilestoneRules>(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const completionId = useId()

  // Reset when the saved settings or the project change underneath, not on
  // every realtime reload while somebody is choosing.
  const savedKey = JSON.stringify(saved)
  const projectId = p?.id
  useEffect(() => {
    setRules(saved)
  }, [savedKey, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return null

  const off = !editable || busy

  async function save() {
    if (!p) return
    setError(null)
    setBusy(true)
    try {
      await updateGeneralProject(p.id, {
        milestone_completion: rules.completion,
        require_milestone_due: rules.requireDue,
        allow_milestone_dependencies: rules.allowDependencies,
        milestone_overdue_alerts: rules.overdueAlerts,
      })
      await state.reload()
      show('Milestone settings saved')
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the milestone settings.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Milestones</h2>
          <p className="mt-0.5 text-[12px] text-muted">How this project's milestones are reached, dated and linked.</p>
        </div>
        {!editable && <RequestAccessButton state={state} permission="edit_project" />}
      </header>

      {error && (
        <div className="my-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="divide-y divide-[var(--line)]">
        <SettingRow title="Completion" htmlFor={completionId}>
          <Select
            id={completionId}
            value={rules.completion}
            onChange={(e) => setRules((r) => ({ ...r, completion: e.target.value as MilestoneCompletion }))}
            disabled={off}
            options={COMPLETION_OPTIONS}
          />
        </SettingRow>
        {SWITCHES.map((s) => (
          <SettingRow key={s.key} title={s.label} help={s.help}>
            <Toggle label={s.label} checked={rules[s.key]} onChange={(v) => setRules((r) => ({ ...r, [s.key]: v }))} disabled={off} />
          </SettingRow>
        ))}
      </div>

      {editable && (
        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <Button onClick={() => void save()} loading={busy}>
            Save milestone settings
          </Button>
        </div>
      )}
    </section>
  )
}

/** One setting: its name and help on the left, its control on the right. */
function SettingRow({
  title,
  help,
  htmlFor,
  children,
}: {
  title: string
  help?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2 py-4 first:pt-2 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,300px)] sm:items-center sm:gap-6">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
            {title}
          </label>
        ) : (
          <p className="text-[13px] font-medium text-ink">{title}</p>
        )}
        {help && <p className="mt-0.5 text-[12px] text-muted">{help}</p>}
      </div>
      <div className="min-w-0 sm:justify-self-end sm:w-full">{children}</div>
    </div>
  )
}
