import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { unionBox } from '../../lib/walkthrough/geometry'
import type { Box } from '../../lib/walkthrough/geometry'

/** How long a step waits for its target before the card stands alone. */
export const TARGET_GRACE_MS = 1500

type Result = { box: Box | null; dialogOpen: boolean; missing: boolean }
const IDLE: Result = { box: null, dialogOpen: false, missing: false }

const same = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)

/** Any open modal dialog not behind an inert ancestor. This also catches the phone drawer. */
export function dialogIsOpen() {
  return [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some((d) => !d.closest('[inert]'))
}

/**
 * Finds the lit target for a step: every element marked `data-walkthrough` with one of the
 * markers and a visible box, joined into one. It measures every frame while active, since
 * a transform or a layout shift moves the target without any event or mutation to hear.
 */
export function useTargetBox(markers: readonly string[], active: boolean): Result {
  const [state, setState] = useState<Result & { key: string }>({ ...IDLE, key: '' })
  const reduce = useReducedMotion()
  const key = markers.join('|')

  useEffect(() => {
    if (!active) return
    const selector = key
      .split('|')
      .filter(Boolean)
      .map((m) => `[data-walkthrough="${m.replace(/["\\]/g, '\\$&')}"]`)
      .join(',')
    let frame = 0
    let grace: ReturnType<typeof setTimeout> | undefined
    let scrolled = false
    let last: Result | null = null

    // A frame that changes nothing must not render anything.
    const report = (next: Result) => {
      if (last && same(last.box, next.box) && last.dialogOpen === next.dialogOpen && last.missing === next.missing) return
      last = next
      setState({ ...next, key })
    }

    const measure = () => {
      frame = requestAnimationFrame(measure)
      const boxes: Box[] = []
      const found: Element[] = selector ? [...document.querySelectorAll(selector)] : []
      for (const el of found) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) boxes.push({ top: r.top, left: r.left, width: r.width, height: r.height })
      }
      const box = unionBox(boxes)

      if (box) {
        if (grace) clearTimeout(grace)
        grace = undefined
        if (!scrolled) {
          scrolled = true
          const first = found.find((el) => el.getBoundingClientRect().width > 0)
          first?.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
        }
      } else if (!grace) {
        grace = setTimeout(() => report({ box: null, dialogOpen: dialogIsOpen(), missing: true }), TARGET_GRACE_MS)
      }
      report({ box, dialogOpen: dialogIsOpen(), missing: box ? false : (last?.missing ?? false) })
    }

    frame = requestAnimationFrame(measure)
    return () => {
      cancelAnimationFrame(frame)
      if (grace) clearTimeout(grace)
    }
  }, [key, active, reduce])

  // State from another step's markers is not this step's.
  return active && state.key === key ? state : IDLE
}
