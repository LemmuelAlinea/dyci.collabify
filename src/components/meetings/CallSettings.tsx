import { useEffect, useState } from 'react'
import { LocalVideoTrack, Room, Track } from 'livekit-client'
import type { CallChoices } from './CallPrejoin'
import { Button } from '../ui/Button'

export async function applyBackground(room: Room, choices: CallChoices) {
  const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track
  if (!(track instanceof LocalVideoTrack)) return
  if (choices.background === 'off' || (choices.background === 'photo' && !choices.photoUrl)) {
    await track.stopProcessor()
    return
  }
  const { BackgroundProcessor, supportsBackgroundProcessors } = await import('@livekit/track-processors')
  if (!supportsBackgroundProcessors()) throw new Error('Background effects are unavailable in this browser.')
  await track.setProcessor(BackgroundProcessor(choices.background === 'blur'
    ? { mode: 'background-blur', blurRadius: 10 }
    : { mode: 'virtual-background', imagePath: choices.photoUrl }))
}

export function CallSettings({ room, choices, onChange, onClose }: {
  room: Room
  choices: CallChoices
  onChange: (choices: CallChoices) => void
  onClose: () => void
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState('')
  useEffect(() => { void navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => setDevices([])) }, [])

  async function device(kind: MediaDeviceKind, id: string, field: 'microphoneId' | 'cameraId' | 'speakerId') {
    onChange({ ...choices, [field]: id })
    if (!id) return
    try { await room.switchActiveDevice(kind, id) }
    catch { setError(`Could not switch ${field === 'microphoneId' ? 'microphone' : field === 'cameraId' ? 'camera' : 'speaker'}.`) }
  }

  async function background(next: CallChoices) {
    onChange(next)
    try { await applyBackground(room, next); setError('') }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Background effect failed.')
      await applyBackground(room, { ...next, background: 'off' }).catch(() => undefined)
      onChange({ ...next, background: 'off' })
    }
  }

  const select = (kind: MediaDeviceKind, label: string, field: 'microphoneId' | 'cameraId' | 'speakerId') => <label className="block text-sm text-muted">{label}
    <select className="mt-1 block w-full rounded-lg border border-line surface px-3 py-2 text-ink" value={choices[field]}
      onChange={(event) => void device(kind, event.target.value, field)}>
      <option value="">System default</option>
      {devices.filter((item) => item.kind === kind).map((item) => <option key={item.deviceId} value={item.deviceId}>{item.label || label}</option>)}
    </select>
  </label>

  return <aside aria-label="Call settings" className="w-full space-y-4 rounded-xl border border-line surface p-4 md:w-72">
    <div className="flex items-center justify-between"><h2 className="font-semibold text-ink">Settings</h2><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>
    {select('audioinput', 'Microphone', 'microphoneId')}
    {select('videoinput', 'Camera', 'cameraId')}
    {select('audiooutput', 'Speaker', 'speakerId')}
    <label className="block text-sm text-muted">Background
      <select value={choices.background} className="mt-1 block w-full rounded-lg border border-line surface px-3 py-2 text-ink"
        onChange={(event) => void background({ ...choices,
          background: event.target.value as CallChoices['background'],
          photoUrl: event.target.value === 'photo' ? choices.photoUrl || '/video/call-background.png' : choices.photoUrl,
        })}>
        <option value="off">Off</option><option value="blur">Blur</option><option value="photo">Study room photo</option>
      </select>
    </label>
    {choices.background === 'photo' && <label className="block text-sm text-muted">Photo
      <input type="file" accept="image/*" onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) void background({ ...choices, photoUrl: URL.createObjectURL(file) })
      }} />
    </label>}
    {error && <p role="alert" className="text-sm text-danger-600">{error}</p>}
  </aside>
}
