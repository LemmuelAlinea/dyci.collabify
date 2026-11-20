import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'

export function pushToTalkAllowed(target: EventTarget | null) {
  return !(typeof HTMLElement !== 'undefined' && target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)))
}

export function CallControls({ microphone, camera, screen, hostMuted, handRaised = false, onMicrophone, onCamera, onScreen, onLeave, onSettings, onCopy, onPeople, onHand }: {
  microphone: boolean
  camera: boolean
  screen: boolean
  hostMuted: boolean
  handRaised?: boolean
  onMicrophone: (enabled: boolean) => void
  onCamera: (enabled: boolean) => void
  onScreen: (enabled: boolean) => void
  onLeave: () => void
  onSettings: () => void
  onCopy: () => void
  onPeople?: () => void
  onHand?: () => void
}) {
  const [push, setPush] = useState(false)
  const held = useRef(false)

  function press() {
    if (hostMuted || microphone || held.current) return
    held.current = true
    setPush(true)
    onMicrophone(true)
  }
  function release() {
    if (!held.current) return
    held.current = false
    setPush(false)
    onMicrophone(false)
  }

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || !pushToTalkAllowed(event.target)) return
      event.preventDefault()
      press()
    }
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') release() }
    const blur = () => release()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  })

  return <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-line surface p-3">
    <Button variant="outline" disabled={hostMuted} onClick={() => onMicrophone(!microphone)} aria-label={microphone ? 'Mute microphone' : 'Turn on microphone'}>
      Microphone {microphone ? 'on' : 'off'}
    </Button>
    <button type="button" onPointerDown={press} onPointerUp={release} onPointerCancel={release} onPointerLeave={release}
      disabled={hostMuted || microphone} className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50" aria-label="Push to talk">
      {push ? 'Talking…' : 'Hold to talk'}
    </button>
    <Button variant="outline" onClick={() => onCamera(!camera)} aria-label={camera ? 'Turn off camera' : 'Turn on camera'}>Camera {camera ? 'on' : 'off'}</Button>
    <Button variant="outline" onClick={() => onScreen(!screen)} aria-label={screen ? 'Stop sharing' : 'Share screen'}>{screen ? 'Stop sharing' : 'Share screen'}</Button>
    <Button variant="outline" onClick={onSettings}>Settings</Button>
    {onPeople && <Button variant="outline" onClick={onPeople}>People</Button>}
    {onHand && <Button variant="outline" onClick={onHand}>{handRaised ? 'Lower hand' : 'Raise hand'}</Button>}
    <Button variant="outline" onClick={onCopy}>Copy link</Button>
    <Button variant="outline" onClick={onLeave}>Leave</Button>
  </div>
}
