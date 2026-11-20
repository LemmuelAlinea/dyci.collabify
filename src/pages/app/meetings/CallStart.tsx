import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CallPrejoin } from '../../../components/meetings/CallPrejoin'
import { createMeeting } from '../../../lib/api/meetings'
import type { MeetingInput } from '../../../lib/api/meetings'
import type { MeetingScope } from '../../../lib/meetings'
import { paths } from '../../../lib/paths'

export type CallDraft = { scope: MeetingScope; audienceId: string; input: MeetingInput }

export default function CallStart() {
  const location = useLocation()
  const navigate = useNavigate()
  const draft = (location.state as { draft?: CallDraft } | null)?.draft
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!draft || draft.input.joinUrl !== null) return <div className="space-y-3 p-6">
    <p>This meeting draft is unavailable.</p><Link to={paths.meetings}>Back to meetings</Link>
  </div>

  return <CallPrejoin title={draft.input.title} canStart busy={busy} error={error} onCancel={() => navigate(paths.meetings)}
    onEnter={(choices) => {
      if (busy) return
      setBusy(true)
      setError(null)
      void createMeeting(draft.scope, draft.audienceId, {
        ...draft.input, startsAt: new Date().toISOString(),
      }).then((meeting) => {
        navigate(paths.meetingCall(meeting.id), { replace: true, state: { startChoices: choices } })
      }).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not create the meeting.')
      }).finally(() => setBusy(false))
    }} />
}
