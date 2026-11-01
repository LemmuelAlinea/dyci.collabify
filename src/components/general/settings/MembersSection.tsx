// src/components/general/settings/MembersSection.tsx
import { useEffect, useState } from 'react'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { Toggle } from '../../ui/Field'
import { Modal } from '../../ui/Modal'
import { useToast } from '../../ui/Toast'
import { updateGeneralProject } from '../../../lib/api/general'
import { authErrorMessage } from '../../../lib/authError'
import { DEFAULT_MEMBER_RULES } from '../../../lib/general/permissions'
import type { MemberRules } from '../../../lib/general/permissions'
import { MemberList } from '../MembersTab'
import { InvitePanel } from '../InvitePanel'
import { RequestsPanel } from '../RequestsPanel'
import { JoinRequestsPanel } from './JoinRequestsPanel'
import { RoleGuide } from '../RoleGuide'
import { StructurePanel } from '../StructurePanel'
import type { GeneralProjectState } from '../useGeneralProject'

export function MembersSection({ state }: { state: GeneralProjectState }) {
  const [requestsOpen, setRequestsOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const canSeeRequests = (state.canGrant && !state.archived) || state.myRole === 'member'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        {canSeeRequests && (
          <Button type="button" variant="outline" onClick={() => setRequestsOpen(true)}>
            Access requests
          </Button>
        )}
        <Button type="button" onClick={() => setInviteOpen(true)}>
          Invite people
        </Button>
      </div>
      <JoinRequestsPanel state={state} />
      <MemberList state={state} />
      <MemberOptionsPanel state={state} />
      <RoleGuide memberRules={state.project?.memberRules} />
      <StructurePanel state={state} />
      <Modal open={requestsOpen} onClose={() => setRequestsOpen(false)} title={state.canGrant && !state.archived ? 'Access requests' : 'Your access'} size="md">
        <RequestsPanel state={state} />
      </Modal>
      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Bring people in" size="md" focusField>
        <InvitePanel state={state} />
      </Modal>
    </div>
  )
}

const OPTIONS: { key: keyof MemberRules; label: string; help: string }[] = [
  {
    key: 'manageMilestones',
    label: 'Members can manage milestones',
    help: 'Create, edit and mark milestones reached. Tagging tasks still needs Manage tasks.',
  },
  {
    key: 'createTasks',
    label: 'Members can create tasks',
    help: 'Their tasks start in planning for the project manager or a coordinator to send.',
  },
]

/** What a plain Member may do in this work project. Only the project manager changes it. */
function MemberOptionsPanel({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const p = state.project
  const editable = state.can('edit_project') && !state.readOnly
  const saved = p?.memberRules ?? DEFAULT_MEMBER_RULES
  const [rules, setRules] = useState<MemberRules>(saved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset when the saved options or the project change underneath, not on every
  // realtime reload while somebody is choosing.
  const savedKey = JSON.stringify(saved)
  const projectId = p?.id
  useEffect(() => {
    setRules(saved)
  }, [savedKey, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Class boards keep their own rules.
  if (!p || p.class_board_id) return null

  async function save() {
    if (!p) return
    setError(null)
    setBusy(true)
    try {
      await updateGeneralProject(p.id, {
        members_manage_milestones: rules.manageMilestones,
        members_create_tasks: rules.createTasks,
      })
      await state.reload()
      show('Member options saved')
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the member options.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <header className="mb-2">
        <h2>Member options</h2>
        <p className="mt-0.5 text-[12px] text-muted">What a plain Member may do in this project.</p>
      </header>

      {error && (
        <div className="my-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="divide-y divide-[var(--line)]">
        {OPTIONS.map((o) => (
          <div key={o.key} className="grid gap-2 py-4 first:pt-2 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">{o.label}</p>
              <p className="mt-0.5 text-[12px] text-muted">{o.help}</p>
            </div>
            <Toggle
              label={o.label}
              checked={rules[o.key]}
              onChange={(v) => setRules((r) => ({ ...r, [o.key]: v }))}
              disabled={!editable || busy}
            />
          </div>
        ))}
      </div>

      {editable && (
        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <Button onClick={() => void save()} loading={busy}>
            Save member options
          </Button>
        </div>
      )}
    </section>
  )
}
