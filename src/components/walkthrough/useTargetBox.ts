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
 * markers and a visible box, joined into one. It follows the page as it moves.
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

    const measure = () => {
      frame = 0
      const boxes: Box[] = []
      const found: Element[] = selector ? [...document.querySelectorAll(selector)] : []
      for (const el of found) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) boxes.push({ top: r.top, left: r.left, width: r.width, height: r.height })
      }
      const box = unionBox(boxes)
      const dialogOpen = dialogIsOpen()

      if (box) {
        if (grace) clearTimeout(grace)
        grace = undefined
        if (!scrolled) {
          scrolled = true
          const first = found.find((el) => el.getBoundingClientRect().width > 0)
          first?.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
        }
      } else if (!grace) {
        grace = setTimeout(
          () => setState((s0) => (s0.key === key && s0.missing ? s0 : { ...(s0.key === key ? s0 : IDLE), key, missing: true })),
          TARGET_GRACE_MS,
        )
      }
      setState((s0) => {
        const s = s0.key === key ? s0 : { ...IDLE, key }
        return same(s.box, box) && s.dialogOpen === dialogOpen && (!box || !s.missing) && s0 === s
          ? s0
          : { key, box, dialogOpen, missing: box ? false : s.missing }
      })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }

    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    schedule()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      if (frame) cancelAnimationFrame(frame)
      if (grace) clearTimeout(grace)
    }
  }, [key, active, reduce])

  // State from another step's markers is not this step's.
  return active && state.key === key ? state : IDLE
}
