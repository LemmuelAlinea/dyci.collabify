import { useState } from 'react'
import { Toggle } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { chimeEnabled, playChime, setChimeEnabled } from '../../lib/chime'

/** Settings → Notifications: the chime for this device (lib/chime.ts). */
export function ChimeSetting() {
  const [on, setOn] = useState(chimeEnabled)

  const change = (next: boolean) => {
    setChimeEnabled(next)
    setOn(next)
    // Turning it on plays it once, so the person knows what to listen for.
    if (next) playChime({ force: true })
  }

  return (
    <div className="mb-5 flex items-start justify-between gap-5 rounded-xl border border-line px-4 py-4">
      <div className="flex min-w-0 gap-3">
        <Icon name="bell" size={18} className="mt-0.5 shrink-0 text-muted" />
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-ink">Sound on this device</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
            A short chime when a notification arrives while Collabify is open.{' '}
            <button
              type="button"
              onClick={() => playChime({ force: true })}
              className="font-medium text-ink underline underline-offset-2 hover:text-navy-600 dark:hover:text-navy-200"
            >
              Play it
            </button>
          </p>
        </div>
      </div>
      <Toggle label="Sound on this device" checked={on} onChange={change} />
    </div>
  )
}
