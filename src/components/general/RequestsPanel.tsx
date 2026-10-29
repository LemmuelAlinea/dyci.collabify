// src/components/general/RequestsPanel.tsx
import { useState } from 'react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { useToast } from '../ui/Toast'
import { answerAccessRequest, withdrawAccessRequest } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { PERMISSIONS, permissionLabel, requestable } from '../../lib/general/permissions'
import type { GeneralAccessRequest } from '../../lib/general/types'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

const STATUS_LABEL: Record<GeneralAccessRequest['status'], string> = {
  open: 'Waiting',
  approved: 'Approved',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
}

/**
 * The project manager or a Coordinator answers here (a Coordinator sees only
 * the requests it can give, by RLS); everybody else sees what they asked for
 * and can ask for more.
 */
export function RequestsPanel({ state }: { state: GeneralProjectState }) {
  if (state.canGrant && !state.archived) return <OwnerRequests state={state} />
  return <MyRequests state={state} />
}

function OwnerRequests({ state }: { state: GeneralProjectState }) {
  const open = state.requests.filter((r) => r.status === 'open')
  return (
    <section>
      <p className="mt-0.5 text-[12px] text-muted">Members asking for a permission their role does not include.</p>
      {open.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
          Nothing waiting on you.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {open.map((r) => (
            <OwnerRequestRow key={r.id} request={r} state={state} />
          ))}
        </ul>
      )}
    </section>
  )
}

function OwnerRequestRow({ request, state }: { request: GeneralAccessRequest; state: GeneralProjectState }) {
  const { show } = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function answer(approve: boolean) {
    setBusy(true)
    try {
      await answerAccessRequest(request.id, approve, note)
      show(approve ? 'Access granted' : 'Request declined')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not answer that request.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-xl border border-warning-300 bg-warning-400/6 p-3.5 dark:border-warning-400/40 dark:bg-warning-400/8">
      <p className="text-[14px] text-ink">
        <strong className="font-medium">{state.nameOf(request.user_id)}</strong> asked for{' '}
        <strong className="font-medium">{permissionLabel(request.permission)}</strong>
      </p>
      {request.reason && (
        <p className="mt-1.5 whitespace-pre-wrap rounded-lg surface px-3 py-2 text-[13px] text-muted">
          {request.reason}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          aria-label="A note back"
          placeholder="A note back (optional)"
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
          className="!h-9 !text-[13px]"
        />
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void answer(false)}>
            Decline
          </Button>
          <Button size="sm" loading={busy} onClick={() => void answer(true)}>
            Approve
          </Button>
        </div>
      </div>
    </li>
  )
}

function MyRequests({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const mine = state.requests.filter((r) => r.user_id === state.viewerId)
  const myExtras = state.myGrants.filter((p) => state.project?.class_board_id || p !== 'commit_main')
  const askable =
    state.me && !state.archived
      ? requestable(state.myRole, state.myGrants, state.myOpenRequests, Boolean(state.project?.class_board_id))
      : []

  async function withdraw(r: GeneralAccessRequest) {
    try {
      await withdrawAccessRequest(r.id)
      show('Request withdrawn')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not withdraw that request.'), 'error')
    }
  }

  if (state.myRole !== 'member') return null

  return (
    <section>
      <p className="mt-0.5 text-[12px] text-muted">
        {myExtras.length > 0
          ? `Beyond Member, you can: ${myExtras.map(permissionLabel).join(', ')}.`
          : 'You have what every Member has. Ask the project manager or a coordinator for more.'}
      </p>

      {mine.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--line)]">
          {mine.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className="min-w-0 flex-1 text-[13px] text-ink">{permissionLabel(r.permission)}</span>
              <span className="rounded-md surface-sunken px-2 py-0.5 text-[12px] text-muted">
                {STATUS_LABEL[r.status]}
              </span>
              {r.status === 'open' && (
                <button
                  type="button"
                  onClick={() => void withdraw(r)}
                  className="text-[12px] font-medium text-muted hover:text-ink"
                >
                  Withdraw
                </button>
              )}
              {r.note && <p className="w-full text-[12px] text-faint">“{r.note}”</p>}
            </li>
          ))}
        </ul>
      )}

      {askable.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <p className="text-[12px] font-medium text-muted">Ask for more</p>
          {askable.map((p) => (
            <div key={p} className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-ink">
                {PERMISSIONS.find((x) => x.value === p)?.label}
              </span>
              <RequestAccessButton state={state} permission={p} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
