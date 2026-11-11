import { useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import {
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  applyZoom,
  clampZoom,
  readStoredZoom,
  stepZoom,
  zoomFill,
  zoomSupported,
} from '../../lib/zoom'

/**
 * Page size for this device: the whole app drawn larger or smaller, so a phone or
 * tablet does not need pinching. See lib/zoom.ts for how it is applied.
 */
export function PageZoom() {
  const labelId = useId()
  const [zoom, setZoom] = useState(readStoredZoom)
  const control = useRef<HTMLDivElement>(null)

  if (!zoomSupported()) return null

  const set = (value: number) => {
    const next = clampZoom(value)
    setZoom(next)
    // The page grows from its top, which would carry the buttons away from the
    // finger on every tap. Scroll by the shift so the control stays put.
    const before = control.current?.getBoundingClientRect().top
    applyZoom(next)
    const after = control.current?.getBoundingClientRect().top
    if (before !== undefined && after !== undefined) window.scrollBy({ top: after - before, behavior: 'instant' })
  }

  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 id={labelId}>Page size</h3>
          <p className="mt-1 max-w-[62ch] text-[13px] text-muted">
            Make everything bigger or smaller on this device. Your other devices keep their own size.
          </p>
        </div>
        <output
          htmlFor={`${labelId}-range`}
          aria-live="polite"
          className="shrink-0 font-mono text-[15px] font-semibold text-ink tabular-nums"
        >
          {zoom}%
        </output>
      </div>

      <div ref={control} className="mt-3 flex items-center gap-2.5 sm:gap-3">
        <StepButton icon="minus" label="Zoom out" disabled={zoom <= ZOOM_MIN} onPress={() => set(stepZoom(zoom, -1))} />
        <input
          id={`${labelId}-range`}
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={ZOOM_STEP}
          value={zoom}
          onChange={(e) => set(Number(e.target.value))}
          aria-labelledby={labelId}
          aria-valuetext={`${zoom} percent`}
          className="zoom-range min-w-0 flex-1"
          style={{ '--fill': `${zoomFill(zoom)}%` } as CSSProperties}
        />
        <StepButton icon="plus" label="Zoom in" disabled={zoom >= ZOOM_MAX} onPress={() => set(stepZoom(zoom, 1))} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 font-mono text-[11.5px] text-faint">
        <span>{ZOOM_MIN}%</span>
        <button
          type="button"
          onClick={() => set(ZOOM_DEFAULT)}
          aria-disabled={zoom === ZOOM_DEFAULT}
          className="rounded-md border border-line px-2.5 py-1 font-sans text-[12px] text-muted transition-colors hover:border-line-strong hover:text-ink aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:border-line aria-disabled:hover:text-muted"
        >
          Reset to {ZOOM_DEFAULT}%
        </button>
        <span>{ZOOM_MAX}%</span>
      </div>
    </div>
  )
}

function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: IconName
  label: string
  disabled: boolean
  onPress: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // aria-disabled, not disabled: a focused button that hits the end keeps focus.
      aria-disabled={disabled}
      onClick={onPress}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line text-ink transition-colors hover:border-line-strong hover:bg-[var(--surface-sunken)] aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:border-line aria-disabled:hover:bg-transparent"
    >
      <Icon name={icon} size={18} strokeWidth={2.4} />
    </button>
  )
}
