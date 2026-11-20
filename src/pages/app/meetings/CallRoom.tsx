import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useConnectionState, useLocalParticipant, useLocalParticipantPermissions, useParticipantAttribute, useRoomContext } from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'
import { TrackSource } from '@livekit/protocol'
import { CallPrejoin } from '../../../components/meetings/CallPrejoin'
import type { CallChoices } from '../../../components/meetings/CallPrejoin'
import { CallStage } from '../../../components/meetings/CallStage'
import { CallControls } from '../../../components/meetings/CallControls'
import { CallChat } from '../../../components/meetings/CallChat'
import { CallRecording } from '../../../components/meetings/CallRecording'
import { CallPeople } from '../../../components/meetings/CallPeople'
import type { ModerationAction } from '../../../components/meetings/CallPeople'
import { CallSettings } from '../../../components/meetings/CallSettings'
import { Button } from '../../../components/ui/Button'
import { useLive } from '../../../hooks/useLive'
import { useNow } from '../../../hooks/useNow'
import { callAction } from '../../../lib/api/meetingCall'
import { useCallSession } from '../../../context/CallSessionContext'
import { getMeeting } from '../../../lib/api/meetings'
import type { Meeting } from '../../../lib/meetings'
import { paths } from '../../../lib/paths'

function ConnectedCall({ meeting, choices, setChoices, updateMedia, canHost, onLeave, onError, onRefresh }: {
  meeting: Meeting
  choices: CallChoices
  setChoices: (choices: CallChoices) => void
  updateMedia: (kind: 'camera' | 'microphone', enabled: boolean) => void
  canHost: boolean
  onLeave: () => void
  onError: (message: string | null) => void
  onRefresh: () => void
}) {
  const room = useRoomContext()
  const connection = useConnectionState()
  const now = useNow()
  const local = useLocalParticipant()
  const permissions = useLocalParticipantPermissions()
  const handRaised = useParticipantAttribute('collabify.hand', { participant: local.localParticipant }) === '1'
  const hostMuted = Boolean(permissions?.canPublishSources?.length &&
    !permissions.canPublishSources.includes(TrackSource.MICROPHONE))
  const [panel, setPanel] = useState<'settings' | 'people' | 'chat' | null>(null)

  useEffect(() => {
    if (!panel) return
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('[data-call-panel], [data-call-panel-trigger]')) return
      setPanel(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [panel])

  async function moderate(action: ModerationAction, targetId?: string) {
    try {
      await callAction(action, meeting.id, targetId)
      if (action === 'end') onLeave()
      else onRefresh()
    } catch (err) { onError(err instanceof Error ? err.message : 'Could not change the call.') }
  }

  return <div className="flex h-[calc(100dvh-var(--app-bar,52px)-4rem)] min-h-[24rem] min-w-0 flex-col gap-3 px-3 pb-24 pt-3 sm:px-5 sm:pb-14">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0"><h1 className="truncate text-lg font-semibold text-ink">{meeting.title}</h1><p className="text-xs text-muted">Collabify call · members only</p>
        <CallRecording meetingId={meeting.id} canHost={canHost && meeting.call_state === 'live'} inCall />
      </div>
      <span className="rounded-full bg-success-500/15 px-3 py-1 text-xs text-success-700">{connection === ConnectionState.Connected ? 'In call' : 'Reconnecting…'}</span>
    </div>
    {meeting.started_at && Date.parse(meeting.started_at) + 8 * 3_600_000 - now <= 10 * 60_000 &&
      <p role="status" className="rounded-lg bg-warning-500/15 px-3 py-2 text-sm text-warning-700">This call will end at the eight-hour limit soon.</p>}
    <div className={`flex min-h-0 min-w-0 flex-1 ${panel === 'chat' ? 'md:pr-[21rem]' : ''}`}>
      <CallStage />
    </div>
    {panel === 'chat' && <div data-call-panel className="fixed right-3 bottom-[5rem] top-[calc(var(--app-bar,52px)+1rem)] z-30 w-[min(20rem,calc(100vw-1.5rem))]">
      <CallChat key={meeting.id} meetingId={meeting.id} readOnly={meeting.call_state !== 'live'} onClose={() => setPanel(null)} />
    </div>}
    <CallControls microphone={local.isMicrophoneEnabled} camera={local.isCameraEnabled} screen={local.isScreenShareEnabled}
      hostMuted={hostMuted} handRaised={handRaised}
      onMicrophone={(enabled) => { void room.localParticipant.setMicrophoneEnabled(enabled).then(() => updateMedia('microphone', enabled)).catch(() => onError('Microphone is unavailable.')) }}
      onCamera={(enabled) => { void room.localParticipant.setCameraEnabled(enabled).then(() => updateMedia('camera', enabled)).catch(() => onError('Camera is unavailable.')) }}
      onScreen={(enabled) => { onError(null); void room.localParticipant.setScreenShareEnabled(enabled).catch((err: unknown) => {
        if (err instanceof Error && ['NotAllowedError', 'AbortError', 'NotFoundError'].includes(err.name)) return
        onError('Screen sharing is unavailable. Try again.')
      }) }}
      settingsPanel={panel === 'settings' && <CallSettings room={room} choices={choices} onChange={setChoices} onClose={() => setPanel(null)} />}
      peoplePanel={panel === 'people' && <CallPeople canHost={canHost} locked={Boolean(meeting.locked_at)} onAction={(action, target) => void moderate(action, target)} onClose={() => setPanel(null)} />}
      onSettings={() => setPanel((current) => current === 'settings' ? null : 'settings')}
      onPeople={() => setPanel((current) => current === 'people' ? null : 'people')}
      onChat={() => setPanel((current) => current === 'chat' ? null : 'chat')}
      onHand={() => void room.localParticipant.setAttributes({ 'collabify.hand': handRaised ? '' : '1' }).catch(() => onError('Could not change your raised hand.'))}
      onCopy={() => void navigator.clipboard.writeText(`${window.location.origin}${paths.meetingCall(meeting.id)}`)}
      onLeave={onLeave} />
  </div>
}

export default function CallRoom() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const startChoices = useRef((location.state as { startChoices?: CallChoices } | null)?.startChoices)
  const [meeting, setMeeting] = useState<Meeting | null | undefined>()
  const { active, restoring, issue, clearIssue, begin, leave, updateChoices, updateMedia } = useCallSession()
  const choices = active?.meetingId === id ? active.choices : null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setMeeting(await getMeeting(id)) }
    catch { setMeeting(null) }
  }, [id])
  useEffect(() => { void load() }, [load])
  useLive(load, ['meetings'])
  useEffect(() => {
    if (!meeting || !startChoices.current || restoring) return
    const next = startChoices.current
    startChoices.current = undefined
    if (active?.meetingId === id) return
    void enter(next)
  }, [meeting, restoring, active?.meetingId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!error || !choices) return
    const timer = setTimeout(() => setError(null), 5_000)
    return () => clearTimeout(timer)
  }, [error, choices])
  useEffect(() => {
    if (!issue || !choices) return
    const timer = setTimeout(clearIssue, 5_000)
    return () => clearTimeout(timer)
  }, [issue, choices, clearIssue])
  useEffect(() => {
    if (meeting?.call_state === 'ended' && active?.meetingId === id) leave()
  }, [meeting?.call_state, active?.meetingId, id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!choices) return
    try { localStorage.setItem('collabify.call-choices', JSON.stringify({
      cameraId: choices.cameraId, microphoneId: choices.microphoneId,
      speakerId: choices.speakerId, background: choices.background, mirror: choices.mirror,
    })) } catch { /* Storage may be disabled. */ }
  }, [choices])

  async function enter(next: CallChoices) {
    if (!meeting) return
    setBusy(true)
    setError(null)
    try {
      const action = meeting.can_start && meeting.call_state !== 'live' ? 'start' : 'join'
      const response = await callAction(action, meeting.id)
      if (!('token' in response)) throw new Error('The call did not return a connection.')
      begin({ meetingId: meeting.id, title: meeting.title, choices: next, session: response })
      void load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not enter the call.') }
    finally { setBusy(false) }
  }

  if (meeting === undefined) return <p className="p-6 text-sm text-muted">Loading call…</p>
  if (!meeting || meeting.platform !== 'collabify') return <div className="p-6"><p>This call is unavailable.</p><Link to={paths.meetings}>Back to meetings</Link></div>
  if (meeting.call_state === 'ended' || meeting.cancelled_at) return <div className="space-y-3 p-6"><h1 className="text-xl font-semibold">This call has ended.</h1><Link to={paths.meetings}>Back to meetings</Link></div>
  if (restoring) return <p className="p-6 text-sm text-muted">Rejoining call…</p>
  if (!choices && !meeting.can_start && !meeting.can_join) return <div className="space-y-3 p-6"><h1 className="text-xl font-semibold">{meeting.title}</h1><p className="text-sm text-muted">A host has not started this call, or joining is unavailable.</p><Button variant="outline" onClick={() => void load()}>Refresh</Button></div>
  if (!choices) return <CallPrejoin title={meeting.title} canStart={meeting.can_start && meeting.call_state !== 'live'} onEnter={(next) => void enter(next)} onCancel={() => navigate(paths.meetings)} busy={busy} error={error || issue} />

  return <>
    {(error || issue) && <p role="alert" className="mx-4 text-sm text-danger-600">{error || issue}</p>}
    <ConnectedCall meeting={meeting} choices={choices} setChoices={updateChoices} updateMedia={updateMedia} canHost={meeting.can_host}
      onLeave={() => { leave(); navigate(paths.meetings) }} onError={setError} onRefresh={() => void load()} />
  </>
}
