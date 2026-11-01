// src/components/general/JoinRequestButton.tsx
import { useState } from 'react'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { requestToJoin, withdrawJoinRequest } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * For somebody who can read a Workspace project but is not on it: ask to join,
 * then see that the request is out and take it back. The request lives in
 * `state.joinRequests`; `sent` carries the answer until the next load agrees.
 */
export function JoinRequestButton({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const [busy, setBusy] = useState(false)
  // undefined: go by the loaded requests. A string or null: what this viewer just did.
  const [sent, setSent] = useState<string | null | undefined>(undefined)

  const projectId = state.project?.id
  if (!projectId) return null

  const loaded = state.joinRequests.find((r) => r.user_id === state.viewerId && r.status === 'open')?.id ?? null
  const requestId = sent === undefined ? loaded : sent
  const stillOpen = requestId !== null && (state.joinRequests.find((r) => r.id === requestId)?.status ?? 'open') === 'open'

  async function ask() {
    setBusy(true)
    try {
      setSent(await requestToJoin(projectId as string))
      show('Request sent')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not send that request. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function withdraw() {
    if (!requestId) return
    setBusy(true)
    try {
      await withdrawJoinRequest(requestId)
      setSent(null)
      show('Request withdrawn')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not withdraw that request. Try again.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (stillOpen) {
    return (
      <span className="inline-flex items-center gap-2 text-[13px]">
        <span className="font-medium">Request sent</span>
        <span aria-hidden>·</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void withdraw()}
          className="font-medium underline underline-offset-2 disabled:opacity-60"
        >
          Withdraw
        </button>
      </span>
    )
  }

  return (
    <Button size="sm" loading={busy} onClick={() => void ask()}>
      Ask to join
    </Button>
  )
}
