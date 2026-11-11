import { Button } from '../ui/Button'
import { Icon, Spinner } from '../ui/Icon'
import { useDevicePush } from '../../lib/push'
import type { PushState } from '../../lib/push'

const COPY: Record<PushState, string> = {
  loading: 'Checking this device…',
  elsewhere:
    'Device notifications work on dyci-collabify.vercel.app. Open Collabify there to turn them on.',
  'ios-tab':
    'On iPhone and iPad, Collabify can send notifications only from the Home Screen. Add it there first.',
  unsupported: 'This browser cannot show notifications. Use Chrome, Edge, Firefox or Safari.',
  blocked:
    'Notifications are blocked for Collabify here. Allow them in the browser’s site settings (on iPhone and iPad: Settings → Notifications → Collabify), then reload this page.',
  off: 'Get everything that shows under the bell on this device, even when Collabify is closed.',
  on: 'On. Everything that shows under the bell also arrives on this device.',
  failed:
    'Could not reach the notification service. Check the connection or turn off an ad blocker for this site, then reload.',
}

/** Settings → Notifications: push for the device this page is open on. */
export function DevicePush() {
  const { state, busy, turnOn, turnOff } = useDevicePush()

  return (
    <div className="mb-5 rounded-xl border border-line bg-[var(--surface-sunken)] px-4 py-4">
      <div className="flex items-start justify-between gap-5">
        <div className="flex min-w-0 gap-3">
          <Icon name="bell" size={18} className="mt-0.5 shrink-0 text-muted" />
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-ink">This device</p>
            <p className="mt-0.5 flex items-center gap-2 text-[13px] leading-relaxed text-muted">
              {state === 'loading' && <Spinner size={14} />}
              {COPY[state]}
            </p>
          </div>
        </div>
        {state === 'off' && (
          <Button variant="primary" size="sm" loading={busy} onClick={turnOn}>
            Turn on
          </Button>
        )}
        {state === 'on' && (
          <Button variant="outline" size="sm" loading={busy} onClick={turnOff}>
            Turn off
          </Button>
        )}
      </div>

      {state === 'ios-tab' && (
        <ol className="mt-3 ml-7 list-decimal space-y-1 pl-4 text-[13px] leading-relaxed text-muted">
          <li>
            In Safari, tap <span className="font-medium text-ink">Share</span>.
          </li>
          <li>
            Choose <span className="font-medium text-ink">Add to Home Screen</span>, then{' '}
            <span className="font-medium text-ink">Add</span>.
          </li>
          <li>Open Collabify from the new icon and sign in.</li>
          <li>Come back to Settings → Notifications and turn them on.</li>
          <li className="list-none text-faint">Needs iOS or iPadOS 16.4 or later.</li>
        </ol>
      )}
    </div>
  )
}
