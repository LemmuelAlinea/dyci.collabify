import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { LiveKitRoom, useLocalParticipant, useLocalParticipantPermissions, useParticipantAttribute, useRoomContext } from '@livekit/components-react'
import { TrackSource } from '@livekit/protocol'
import { CallPrejoin } from '../../../components/meetings/CallPrejoin'
import type { CallChoices } from '../../../components/meetings/CallPrejoin'
import { CallStage } from '../../../components/meetings/CallStage'
import { CallControls } from '../../../components/meetings/CallControls'
import { CallChat } from '../../../components/meetings/CallChat'
import { CallPeople } from '../../../components/meetings/CallPeople'
import type { ModerationAction } from '../../../components/meetings/CallPeople'
import { applyBackground, CallSettings } from '../../../components/meetings/CallSettings'
import { Button } from '../../../components/ui/Button'
import { useLive } from '../../../hooks/useLive'
import { callAction } from '../../../lib/api/meetingCall'
import type { CallSession } from '../../../lib/api/meetingCall'
import { getMeeting } from '../../../lib/api/meetings'
import type { Meeting } from '../../../lib/meetings'
import { paths } from '../../../lib/paths'

function ConnectedCall({ meeting, choices, setChoices, canHost, onLeave, onError, onRefresh }: {
  meeting: Meeting
  choices: CallChoices
  setChoices: (choices: CallChoices) => void
  canHost: boolean
  onLeave: () => void
  onError: (message: string) => void
  onRefresh: () => void
}) {
  const room = useRoomContext()
  const local = useLocalParticipant()
  const permissions = useLocalParticipantPermissions()
  const handRaised = useParticipantAttribute('collabify.hand', { participant: local.localParticipant }) === '1'
  const hostMuted = Boolean(permissions?.canPublishSources?.length &&
    !permissions.canPublishSources.includes(TrackSource.MICROPHONE))
  const [settings, setSettings] = useState(false)
  const [people, setPeople] = useState(false)
  const [chat, setChat] = useState(false)

  async function moderate(action: ModerationAction, targetId?: string) {
    try {
      await callAction(action, meeting.id, targetId)
      if (action === 'end') onLeave()
      else onRefresh()
    } catch (err) { onError(err instanceof Error ? err.message : 'Could not change the call.') }
  }

  useEffect(() => {
    if (choices.cameraId) void room.switchActiveDevice('videoinput', choices.cameraId).catch(() => undefined)
    if (choices.microphoneId) void room.switchActiveDevice('audioinput', choices.microphoneId).catch(() => undefined)
    if (choices.speakerId) void room.switchActiveDevice('audiooutput', choices.speakerId).catch(() => undefined)
  }, [room]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (local.isCameraEnabled) void applyBackground(room, choices).catch(() => onError('Background effect failed. Video continues without it.'))
  }, [local.isCameraEnabled, room]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="flex min-h-[75vh] min-w-0 flex-col gap-3 px-3 py-3 sm:px-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0"><h1 className="truncate text-lg font-semibold text-ink">{meeting.title}</h1><p className="text-xs text-muted">Collabify call · members only</p></div>
      <span className="rounded-full bg-success-500/15 px-3 py-1 text-xs text-success-700">In call</span>
    </div>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 md:flex-row">
      <CallStage />
      {settings && <CallSettings room={room} choices={choices} onChange={setChoices} onClose={() => setSettings(false)} />}
      {people && <CallPeople canHost={canHost} locked={Boolean(meeting.locked_at)} onAction={(action, target) => void moderate(action, target)} onClose={() => setPeople(false)} />}
      {chat && <CallChat key={meeting.id} meetingId={meeting.id} readOnly={meeting.call_state !== 'live'} onClose={() => setChat(false)} />}
    </div>
    <CallControls microphone={local.isMicrophoneEnabled} camera={local.isCameraEnabled} screen={local.isScreenShareEnabled}
      hostMuted={hostMuted} handRaised={handRaised}
      onMicrophone={(enabled) => { void room.localParticipant.setMicrophoneEnabled(enabled).catch(() => onError('Microphone is unavailable.')) }}
      onCamera={(enabled) => { void room.localParticipant.setCameraEnabled(enabled).catch(() => onError('Camera is unavailable.')) }}
      onScreen={(enabled) => { void room.localParticipant.setScreenShareEnabled(enabled).catch(() => onError('Screen sharing was cancelled or unavailable.')) }}
      onSettings={() => setSettings((value) => !value)}
      onPeople={() => setPeople((value) => !value)}
      onChat={() => setChat((value) => !value)}
      onHand={() => void room.localParticipant.setAttributes({ 'collabify.hand': handRaised ? '' : '1' }).catch(() => onError('Could not change your raised hand.'))}
      onCopy={() => void navigator.clipboard.writeText(`${window.location.origin}${paths.meetingCall(meeting.id)}`)}
      onLeave={onLeave} />
  </div>
}

export default function CallRoom() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [meeting, setMeeting] = useState<Meeting | null | undefined>()
  const [session, setSession] = useState<CallSession | null>(null)
  const [choices, setChoices] = useState<CallChoices | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setMeeting(await getMeeting(id)) }
    catch { setMeeting(null) }
  }, [id])
  useEffect(() => { void load() }, [load])
  useLive(load, ['meetings'])
  useEffect(() => () => { if (choices?.photoUrl.startsWith('blob:')) URL.revokeObjectURL(choices.photoUrl) }, [choices?.photoUrl])

  async function enter(next: CallChoices) {
    if (!meeting) return
    setBusy(true)
    setError(null)
    try {
      const action = meeting.can_start && meeting.call_state !== 'live' ? 'start' : 'join'
      const response = await callAction(action, meeting.id)
      if (!('token' in response)) throw new Error('The call did not return a connection.')
      setChoices(next)
      setSession(response)
      void load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not enter the call.') }
    finally { setBusy(false) }
  }

  if (meeting === undefined) return <p className="p-6 text-sm text-muted">Loading call…</p>
  if (!meeting || meeting.platform !== 'collabify') return <div className="p-6"><p>This call is unavailable.</p><Link to={paths.meetings}>Back to meetings</Link></div>
  if (meeting.call_state === 'ended' || meeting.cancelled_at) return <div className="space-y-3 p-6"><h1 className="text-xl font-semibold">This call has ended.</h1><Link to={paths.meetings}>Back to meetings</Link></div>
  if (!session && !meeting.can_start && !meeting.can_join) return <div className="space-y-3 p-6"><h1 className="text-xl font-semibold">{meeting.title}</h1><p className="text-sm text-muted">A host has not started this call, or joining is unavailable.</p><Button variant="outline" onClick={() => void load()}>Refresh</Button></div>
  if (!session || !choices) return <CallPrejoin title={meeting.title} canStart={meeting.can_start && meeting.call_state !== 'live'} onEnter={(next) => void enter(next)} busy={busy} error={error} />

  return <LiveKitRoom serverUrl={session.serverUrl} token={session.token} connect audio={choices.microphone} video={choices.camera}
    options={{ adaptiveStream: true, dynacast: true }}
    connectOptions={{ autoSubscribe: false }}
    onDisconnected={() => { setSession(null); setError('The call disconnected. You can try joining again.'); void load() }}
    onError={(err) => { setSession(null); setError(err.message) }}
    onMediaDeviceFailure={() => setError('A camera or microphone is unavailable. You can continue without it.')}>
    {error && <p role="alert" className="mx-4 text-sm text-danger-600">{error}</p>}
    <ConnectedCall meeting={meeting} choices={choices} setChoices={setChoices} canHost={session.canHost}
      onLeave={() => navigate(paths.meetings)} onError={setError} onRefresh={() => void load()} />
  </LiveKitRoom>
}
