import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useReducedMotion } from 'motion/react'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import {
  ZOOM_DEFAULT,
  ZOOM_GLIDE_MS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  announceZoom,
  clampZoom,
  drawZoom,
  easeZoom,
  pageZoom,
  readStoredZoom,
  saveZoom,
  stepZoom,
  zoomFill,
  zoomSupported,
} from '../../lib/zoom'

/** A held minus or plus starts repeating after this long, then steps this often. */
const HOLD_MS = 400
const REPEAT_MS = 45

/**
 * Page size for this device: the whole app drawn larger or smaller, so a phone or
 * tablet does not need pinching. See lib/zoom.ts for how it is applied.
 *
 * The slider moves in 1% stops. Each change glides the page from the size it is
 * drawn at to the new one; a new change mid-glide sets off from wherever the page
 * is, so dragging or holding a button reads as one smooth grow or shrink.
 */
export function PageZoom() {
  const labelId = useId()
  const reduce = useReducedMotion()
  const [zoom, setZoom] = useState(readStoredZoom)
  const control = useRef<HTMLDivElement>(null)
  /** Where the page is headed, and where it is drawn right now (fractions mid-glide). */
  const target = useRef(zoom)
  const drawn = useRef(pageZoom() * 100)
  const frame = useRef(0)

  // Leaving Settings mid-glide lands on the size that was chosen.
  useEffect(
    () => () => {
      if (!frame.current) return
      cancelAnimationFrame(frame.current)
      drawZoom(target.current)
      announceZoom()
    },
    [],
  )

  if (!zoomSupported()) return null

  // The page grows from its top, which would carry the buttons away from the
  // finger. Each frame scrolls by the shift so the control stays put.
  const paint = (value: number) => {
    const before = control.current?.getBoundingClientRect().top
    drawZoom(value)
    drawn.current = value
    const after = control.current?.getBoundingClientRect().top
    if (before !== undefined && after !== undefined && after !== before) {
      window.scrollBy({ top: after - before, behavior: 'instant' })
    }
  }

  const set = (value: number) => {
    const next = clampZoom(value)
    target.current = next
    setZoom(next)
    saveZoom(next)
    cancelAnimationFrame(frame.current)
    frame.current = 0

    const from = drawn.current
    if (reduce || Math.abs(from - next) < 0.01) {
      paint(next)
      announceZoom()
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const t = (now - start) / ZOOM_GLIDE_MS
      paint(from + (next - from) * easeZoom(t))
      if (t < 1) {
        frame.current = requestAnimationFrame(tick)
      } else {
        frame.current = 0
        announceZoom()
      }
    }
    frame.current = requestAnimationFrame(tick)
  }

  // Read from the ref, not the render's state: a held button steps many times
  // before React draws again.
  const step = (direction: -1 | 1) => set(stepZoom(target.current, direction))

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
          className="shrink-0 font-mono text-[15px] font-semibold text-ink tabular-nums"
        >
          {zoom}%
        </output>
      </div>

      <div ref={control} className="mt-3 flex items-center gap-2.5 sm:gap-3">
        <StepButton icon="minus" label="Zoom out" disabled={zoom <= ZOOM_MIN} onStep={() => step(-1)} />
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
        <StepButton icon="plus" label="Zoom in" disabled={zoom >= ZOOM_MAX} onStep={() => step(1)} />
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

/** One step per tap or Enter; held down with a finger or mouse, it keeps stepping. */
function StepButton({
  icon,
  label,
  disabled,
  onStep,
}: {
  icon: IconName
  label: string
  disabled: boolean
  onStep: () => void
}) {
  const hold = useRef(0)
  const repeat = useRef(0)
  /** Set once a hold has stepped, so the click that ends it does not add one more. */
  const held = useRef(false)

  const stop = () => {
    window.clearTimeout(hold.current)
    window.clearInterval(repeat.current)
  }
  useEffect(() => stop, [])

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // aria-disabled, not disabled: a focused button that hits the end keeps focus.
      aria-disabled={disabled}
      onClick={() => {
        if (held.current) {
          held.current = false
          return
        }
        onStep()
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        held.current = false
        stop()
        hold.current = window.setTimeout(() => {
          held.current = true
          onStep()
          repeat.current = window.setInterval(onStep, REPEAT_MS)
        }, HOLD_MS)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      className="grid h-10 w-10 shrink-0 touch-manipulation place-items-center rounded-xl border border-line text-ink transition-colors select-none hover:border-line-strong hover:bg-[var(--surface-sunken)] aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:border-line aria-disabled:hover:bg-transparent"
    >
      <Icon name={icon} size={18} strokeWidth={2.4} />
    </button>
  )
}
