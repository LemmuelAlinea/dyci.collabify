import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'

export type CallChoices = {
  camera: boolean
  microphone: boolean
  cameraId: string
  microphoneId: string
  speakerId: string
  background: 'off' | 'blur' | 'photo'
  photoUrl: string
}

export function CallPrejoin({ title, canStart, onEnter, onCancel, busy, error }: {
  title: string
  canStart: boolean
  onEnter: (choices: CallChoices) => void
  onCancel?: () => void
  busy: boolean
  error: string | null
}) {
  const [choices, setChoices] = useState<CallChoices>(() => {
    let saved: Partial<CallChoices> = {}
    try { saved = JSON.parse(localStorage.getItem('collabify.call-choices') || '{}') as Partial<CallChoices> } catch { /* Reset invalid preferences. */ }
    return {
      camera: false, microphone: false, cameraId: saved.cameraId || '',
      microphoneId: saved.microphoneId || '', speakerId: saved.speakerId || '',
      background: saved.background === 'blur' ? 'blur' : 'off', photoUrl: '',
    }
  })
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceError, setDeviceError] = useState('')
  const preview = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)

  useEffect(() => () => {
    stream.current?.getTracks().forEach((track) => track.stop())
  }, [])

  useEffect(() => {
    try { localStorage.setItem('collabify.call-choices', JSON.stringify({
      cameraId: choices.cameraId, microphoneId: choices.microphoneId,
      speakerId: choices.speakerId, background: choices.background === 'blur' ? 'blur' : 'off',
    })) } catch { /* Storage may be disabled. */ }
  }, [choices.cameraId, choices.microphoneId, choices.speakerId, choices.background])

  async function toggle(kind: 'camera' | 'microphone') {
    const enabled = !choices[kind]
    if (!enabled) {
      if (kind === 'camera') {
        stream.current?.getTracks().forEach((track) => track.stop())
        stream.current = null
        if (preview.current) preview.current.srcObject = null
      }
      setChoices((current) => ({ ...current, [kind]: false }))
      return
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia(kind === 'camera'
        ? { video: choices.cameraId ? { deviceId: { exact: choices.cameraId } } : true, audio: false }
        : { audio: choices.microphoneId ? { deviceId: { exact: choices.microphoneId } } : true, video: false })
      if (kind === 'camera') {
        stream.current?.getTracks().forEach((track) => track.stop())
        stream.current = media
        if (preview.current) preview.current.srcObject = media
      } else media.getTracks().forEach((track) => track.stop())
      setDevices(await navigator.mediaDevices.enumerateDevices())
      setChoices((current) => ({ ...current, [kind]: true }))
      setDeviceError('')
    } catch {
      setDeviceError(`${kind === 'camera' ? 'Camera' : 'Microphone'} access was denied or unavailable. You can join without it.`)
    }
  }

  const select = (kind: MediaDeviceKind, label: string, value: string, field: keyof CallChoices) => {
    const options = devices.filter((device) => device.kind === kind)
    return <label className="block text-sm text-muted">{label}
      <select className="mt-1 block w-full rounded-lg border border-line surface px-3 py-2 text-ink" value={value}
        onChange={(event) => setChoices((current) => ({ ...current, [field]: event.target.value }))}>
        <option value="">System default</option>
        {options.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || label}</option>)}
      </select>
    </label>
  }

  return <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 lg:grid-cols-2">
    <div className="flex aspect-video items-center justify-center overflow-hidden rounded-2xl bg-slate-900 text-white">
      <video ref={preview} autoPlay playsInline muted className={choices.camera ? 'h-full w-full object-cover' : 'hidden'} />
      {!choices.camera && <span>Camera off</span>}
    </div>
    <div className="space-y-4">
      <div><h1 className="text-2xl font-semibold text-ink">{title}</h1><p className="text-sm text-muted">Check your devices before joining.</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant={choices.microphone ? 'primary' : 'outline'} onClick={() => void toggle('microphone')}>Microphone {choices.microphone ? 'on' : 'off'}</Button>
        <Button variant={choices.camera ? 'primary' : 'outline'} onClick={() => void toggle('camera')}>Camera {choices.camera ? 'on' : 'off'}</Button>
      </div>
      {deviceError && <p role="alert" className="text-sm text-danger-600">{deviceError}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {select('audioinput', 'Microphone', choices.microphoneId, 'microphoneId')}
        {select('videoinput', 'Camera', choices.cameraId, 'cameraId')}
        {select('audiooutput', 'Speaker', choices.speakerId, 'speakerId')}
      </div>
      <label className="block text-sm text-muted">Background
        <select className="mt-1 block w-full rounded-lg border border-line surface px-3 py-2 text-ink"
          value={choices.background} onChange={(event) => setChoices((current) => ({ ...current, background: event.target.value as CallChoices['background'] }))}>
          <option value="off">Off</option><option value="blur">Blur</option><option value="photo">Photo</option>
        </select>
      </label>
      {choices.background === 'photo' && <label className="block text-sm text-muted">Background photo
        <input type="file" accept="image/*" className="mt-1 block w-full text-sm" onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) setChoices((current) => ({ ...current, photoUrl: URL.createObjectURL(file) }))
        }} />
      </label>}
      {error && <p role="alert" className="text-sm text-danger-600">{error}</p>}
      <div className="flex gap-2">
        {onCancel && <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button onClick={() => onEnter(choices)} loading={busy}>{canStart ? 'Start call' : 'Join call'}</Button>
      </div>
    </div>
  </div>
}
