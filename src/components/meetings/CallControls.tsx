import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

export function pushToTalkAllowed(target: EventTarget | null) {
  return !(typeof HTMLElement !== 'undefined' && target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)))
}

export function CallControls({ microphone, camera, screen, hostMuted, handRaised = false, onMicrophone, onCamera, onScreen, onLeave, onSettings, onCopy, onPeople, onHand, onChat, settingsPanel, peoplePanel }: {
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
  onChat?: () => void
  settingsPanel?: ReactNode
  peoplePanel?: ReactNode
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

  const control = (label: string, icon: IconName, action: () => void, disabled = false, pressed?: boolean, variant: 'outline' | 'danger' = 'outline') =>
    <Button variant={variant} size="sm" className="!h-10 !w-10 !rounded-full !p-0" disabled={disabled}
      onClick={action} aria-label={label} title={label} aria-pressed={pressed}><Icon name={icon} size={19} /></Button>

  return <div role="toolbar" aria-label="Call controls" className="fixed inset-x-3 bottom-3 z-40 mx-auto flex w-max max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-2xl border border-line surface p-2 shadow-lift">
    {control(microphone ? 'Mute microphone' : 'Turn on microphone', microphone ? 'mic' : 'micOff', () => onMicrophone(!microphone), hostMuted, microphone)}
    <button type="button" onPointerDown={press} onPointerUp={release} onPointerCancel={release} onPointerLeave={release}
      disabled={hostMuted || microphone} className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink disabled:opacity-50"
      aria-label="Push to talk" title="Hold to talk (Space)" aria-pressed={push}>
      <Icon name="walkieTalkie" size={19} />
    </button>
    {control(camera ? 'Turn off camera' : 'Turn on camera', camera ? 'video' : 'videoOff', () => onCamera(!camera), false, camera)}
    {control(screen ? 'Stop sharing' : 'Share screen', 'monitor', () => onScreen(!screen), false, screen)}
    <div className="relative">{control('Settings', 'settings', onSettings, false, Boolean(settingsPanel))}
      {settingsPanel && <div className="absolute bottom-full right-0 z-50 mb-2 max-h-[calc(100dvh-7rem)] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl shadow-lift">{settingsPanel}</div>}
    </div>
    {onPeople && <div className="relative">{control('People', 'users', onPeople, false, Boolean(peoplePanel))}
      {peoplePanel && <div className="absolute bottom-full left-0 z-50 mb-2 max-h-[calc(100dvh-7rem)] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl shadow-lift md:right-0 md:left-auto">{peoplePanel}</div>}
    </div>}
    {onChat && control('Chat', 'message', onChat)}
    {onHand && control(handRaised ? 'Lower hand' : 'Raise hand', 'hand', onHand, false, handRaised)}
    {control('Copy link', 'copy', onCopy)}
    {control('Leave', 'logout', onLeave, false, undefined, 'danger')}
  </div>
}
