import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Toggle } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { getActiveStatus, setActiveStatus } from '../../lib/api/presence'

/** Settings → Profile: whether contacts see you in the Inbox's Active now list. */
export function ActiveStatusSetting() {
  const [on, setOn] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getActiveStatus()
      .then((value) => live && setOn(value))
      .catch(() => live && setOn(true))
    return () => {
      live = false
    }
  }, [])

  const change = async (next: boolean) => {
    setOn(next)
    setError(null)
    try {
      await setActiveStatus(next)
    } catch {
      setOn(!next)
      setError("We couldn't save that. Try again.")
    }
  }

  return (
    <div className="mt-6 space-y-3 border-t border-line pt-5">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex items-start justify-between gap-5">
        <div className="flex min-w-0 gap-3">
          <Icon name="users" size={18} className="mt-0.5 shrink-0 text-muted" />
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-ink">Show when you're active</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
              People you share a class, space or project with can see when you're online. Turn this off and
              you won't see when they're active either.
            </p>
          </div>
        </div>
        <Toggle
          label="Show when you're active"
          checked={on ?? true}
          disabled={on === null}
          onChange={(next) => void change(next)}
        />
      </div>
    </div>
  )
}
