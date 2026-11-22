import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { LiveKitRoom, RoomAudioRenderer, useConnectionState, useLocalParticipant, useRoomContext } from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'
import type { CallChoices } from './CallPrejoin'
import { applyBackground } from './CallSettings'
import type { CallSession } from '../../lib/api/meetingCall'

function CallMediaSync({ choices, onIssue }: { choices: CallChoices; onIssue: (message: string) => void }) {
  const room = useRoomContext()
  const local = useLocalParticipant()
  const connection = useConnectionState()
  useEffect(() => {
    if (choices.cameraId) void room.switchActiveDevice('videoinput', choices.cameraId).catch(() => undefined)
    if (choices.microphoneId) void room.switchActiveDevice('audioinput', choices.microphoneId).catch(() => undefined)
    if (choices.speakerId) void room.switchActiveDevice('audiooutput', choices.speakerId).catch(() => undefined)
  }, [room]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (local.isCameraEnabled) void applyBackground(room, choices).catch(() => onIssue('Background effect failed. Video continues without it.'))
  }, [local.isCameraEnabled, room]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (connection === ConnectionState.Connected) void room.localParticipant.setAttributes({
      'collabify.mirror': choices.mirror ? '1' : '',
    }).catch(() => onIssue('Could not share your video mirror setting.'))
  }, [connection, room]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function CallConnection({ session, choices, children, onError, onDisconnected, onMediaDeviceFailure, onIssue }: {
  session: CallSession
  choices: CallChoices
  children: ReactNode
  onError: (error: Error) => void
  onDisconnected: () => void
  onMediaDeviceFailure: () => void
  onIssue: (message: string) => void
}) {
  return <LiveKitRoom className="contents" serverUrl={session.serverUrl} token={session.token} connect
    audio={choices.microphone} video={choices.camera} options={{ adaptiveStream: true, dynacast: true }}
    onError={onError} onDisconnected={onDisconnected} onMediaDeviceFailure={onMediaDeviceFailure}>
    <RoomAudioRenderer /><CallMediaSync choices={choices} onIssue={onIssue} />{children}
  </LiveKitRoom>
}
