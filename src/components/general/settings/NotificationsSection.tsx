// src/components/general/settings/NotificationsSection.tsx
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
import { DEFAULT_NOTIFICATION_RULES } from '../../../lib/general/notificationRules'
import type { MilestoneDueDays, NotificationRules, SprintEndDays } from '../../../lib/general/notificationRules'
import { RequestAccessButton } from '../RequestAccessButton'
import type { GeneralProjectState } from '../useGeneralProject'

/** The panel's choices: the project's notification settings plus the milestone switch that moved here. */
type Choices = NotificationRules & { milestoneOverdue: boolean }

const SPRINT_END_OPTIONS = [
  { value: '', label: 'Off' },
  { value: '1', label: '1 day before' },
  { value: '2', label: '2 days before' },
  { value: '3', label: '3 days before' },
]

const MILESTONE_DUE_OPTIONS = [...SPRINT_END_OPTIONS, { value: '7', label: '1 week before' }]

type SwitchKey = 'taskOverdue' | 'milestoneOverdue' | 'assignment' | 'sprintCompletion'

export function NotificationsSection({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const p = state.project
  const editable = state.can('edit_project') && !state.readOnly
  const saved: Choices = {
    ...(p?.notificationRules ?? DEFAULT_NOTIFICATION_RULES),
    milestoneOverdue: (p?.milestoneRules ?? DEFAULT_MILESTONE_RULES).overdueAlerts,
  }
  const [choices, setChoices] = useState<Choices>(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sprintId = useId()
  const milestoneId = useId()

  // Reset when the saved settings or the project change underneath, not on
  // every realtime reload while somebody is choosing.
  const savedKey = JSON.stringify(saved)
  const projectId = p?.id
  useEffect(() => {
    setChoices(saved)
  }, [savedKey, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return null

  const off = !editable || busy
  const flip = (key: SwitchKey) => (v: boolean) => setChoices((c) => ({ ...c, [key]: v }))

  async function save() {
    if (!p) return
    setError(null)
    setBusy(true)
    try {
      await updateGeneralProject(p.id, {
        sprint_end_reminder_days: choices.sprintEndDays,
        task_overdue_alerts: choices.taskOverdue,
        milestone_due_reminder_days: choices.milestoneDueDays,
        milestone_overdue_alerts: choices.milestoneOverdue,
        task_assignment_notices: choices.assignment,
        sprint_completion_notices: choices.sprintCompletion,
      })
      await state.reload()
      show('Notification settings saved')
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the notification settings.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Notifications</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            These decide what this project sends. Each person can still turn notices off for themselves in Account → Notifications.
          </p>
        </div>
        {!editable && <RequestAccessButton state={state} permission="edit_project" />}
      </header>

      {error && (
        <div className="my-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="divide-y divide-[var(--line)]">
        <SettingRow title="Sprint ending reminder" htmlFor={sprintId}>
          <Select
            id={sprintId}
            value={choices.sprintEndDays === null ? '' : String(choices.sprintEndDays)}
            onChange={(e) =>
              setChoices((c) => ({ ...c, sprintEndDays: e.target.value ? (Number(e.target.value) as SprintEndDays) : null }))
            }
            disabled={off}
            options={SPRINT_END_OPTIONS}
          />
        </SettingRow>
        <SettingRow title="Overdue task alerts">
          <Toggle label="Overdue task alerts" checked={choices.taskOverdue} onChange={flip('taskOverdue')} disabled={off} />
        </SettingRow>
        <SettingRow title="Milestone due reminder" htmlFor={milestoneId}>
          <Select
            id={milestoneId}
            value={choices.milestoneDueDays === null ? '' : String(choices.milestoneDueDays)}
            onChange={(e) =>
              setChoices((c) => ({ ...c, milestoneDueDays: e.target.value ? (Number(e.target.value) as MilestoneDueDays) : null }))
            }
            disabled={off}
            options={MILESTONE_DUE_OPTIONS}
          />
        </SettingRow>
        <SettingRow
          title="Overdue milestone alerts"
          help="The project manager and coordinators are told the morning after a missed due date."
        >
          <Toggle
            label="Overdue milestone alerts"
            checked={choices.milestoneOverdue}
            onChange={flip('milestoneOverdue')}
            disabled={off}
          />
        </SettingRow>
        <SettingRow title="Task assignment notices">
          <Toggle label="Task assignment notices" checked={choices.assignment} onChange={flip('assignment')} disabled={off} />
        </SettingRow>
        <SettingRow title="Sprint completion notices">
          <Toggle
            label="Sprint completion notices"
            checked={choices.sprintCompletion}
            onChange={flip('sprintCompletion')}
            disabled={off}
          />
        </SettingRow>
      </div>

      {editable && (
        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <Button onClick={() => void save()} loading={busy}>
            Save notification settings
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
