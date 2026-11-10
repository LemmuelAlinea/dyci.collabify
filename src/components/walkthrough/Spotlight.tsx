import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'motion/react'
import { Button } from '../ui/Button'
import { dialogIsOpen } from './useTargetBox'
import { DUR } from '../../lib/motion'
import { holeFor, placeCard, scrimPanels } from '../../lib/walkthrough/geometry'
import type { Box, Viewport } from '../../lib/walkthrough/geometry'

type Props = {
  title: string
  body: string
  /** The step count, such as "Step 2 of 5". */
  eyebrow: string
  /** The raw target box. The hole around it is worked out here. */
  box: Box | null
  /** A replay covers the target so nothing under the light can be pressed. */
  blockTarget: boolean
  actions: { label: string; onPress: () => void; primary?: boolean }[]
  /** The light glides only when this changes. Any other move, such as a scroll, is instant. */
  stepId?: string
}

const SCRIM = 'bg-[color-mix(in_oklab,var(--scrim,var(--color-navy-950))_60%,transparent)]'
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

const readViewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight })
/** TopNav writes the app bar's height on the root element; 0 when there is no bar. */
const readTopInset = () => parseFloat(document.documentElement.style.getPropertyValue('--app-bar')) || 0
const style = (b: Box) => ({ top: b.top, left: b.left, width: b.width, height: b.height })

/**
 * The step card, and the light around its target. Purely presentational: whoever renders it
 * decides when a dialog or a missing target means it should not show.
 */
export function Spotlight({ title, body, eyebrow, box, blockTarget, actions, stepId }: Props) {
  const reduce = useReducedMotion()
  const titleId = useId()
  const card = useRef<HTMLDivElement>(null)
  const [vp, setVp] = useState<Viewport>(readViewport)
  const [size, setSize] = useState({ width: 340, height: 200 })

  useEffect(() => {
    const onResize = () => setVp(readViewport())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const cardWidth = Math.min(340, vp.width - 32)
  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const { height } = el.getBoundingClientRect()
    setSize((s) => (s.width === cardWidth && s.height === (height || s.height) ? s : { width: cardWidth, height: height || s.height }))
  }, [cardWidth, title, body, actions.length, vp.height])

  // Each step starts with focus on its card, so keyboard and screen reader users follow along.
  useEffect(() => {
    card.current?.focus({ preventScroll: true })
  }, [title])

  const topInset = readTopInset()
  const hole = box ? holeFor(box, vp, topInset) : null
  const placed = placeCard(hole, size, vp, topInset)

  // Differs for the one commit that starts the step's glide. A move already running keeps its
  // own transition, so settling this does not cut it short.
  const [settledStep, setSettledStep] = useState(stepId)
  useEffect(() => setSettledStep(stepId), [stepId])
  const ease = { duration: reduce || settledStep === stepId ? 0 : DUR.base / 1000, ease: 'easeOut' as const }

  // Tab stays on the card's buttons and whatever is lit under the hole.
  // Listened for on the document, since focus leaves the card once it reaches the lit target.
  const onTab = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    // A real dialog on top has its own focus trap; Tab is its to handle.
    if (dialogIsOpen()) return
    const own = [...(card.current?.querySelectorAll<HTMLElement>('button') ?? [])]
    const lit =
      hole && !blockTarget
        ? [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
            if (card.current?.contains(el)) return false
            const r = el.getBoundingClientRect()
            const cx = r.left + r.width / 2
            const cy = r.top + r.height / 2
            return r.width > 0 && cx >= hole.left && cx <= hole.left + hole.width && cy >= hole.top && cy <= hole.top + hole.height
          })
        : []
    const ring = [...lit, ...own]
    if (ring.length === 0) return
    const at = ring.indexOf(document.activeElement as HTMLElement)
    const next = e.shiftKey ? (at <= 0 ? ring.length - 1 : at - 1) : at === -1 || at === ring.length - 1 ? 0 : at + 1
    e.preventDefault()
    ring[next].focus()
  }
  const tabRef = useRef(onTab)
  useEffect(() => {
    tabRef.current = onTab
  })
  useEffect(() => {
    const listen = (e: KeyboardEvent) => tabRef.current(e)
    document.addEventListener('keydown', listen, true)
    return () => document.removeEventListener('keydown', listen, true)
  }, [])

  return createPortal(
    <div className="app-ui depth-ground" data-spotlight-layer="">
      {hole &&
        scrimPanels(hole, vp).map((panel, i) => (
          <motion.div
            key={i}
            data-spotlight="scrim"
            aria-hidden="true"
            className={`fixed z-[55] ${SCRIM}`}
            initial={false}
            animate={style(panel)}
            transition={ease}
          />
        ))}
      {hole && blockTarget && (
        <motion.div
          data-spotlight="block"
          aria-hidden="true"
          className="fixed z-[55]"
          initial={false}
          animate={style(hole)}
          transition={ease}
        />
      )}
      {hole && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none fixed z-[55] rounded-card ring-2 ring-amber-400"
          initial={false}
          animate={style(hole)}
          transition={ease}
        />
      )}
      <motion.div
        ref={card}
        data-spotlight="card"
        role="group"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="surface fixed z-[55] rounded-card border border-line p-4 shadow-card outline-none"
        style={{ width: cardWidth }}
        initial={false}
        animate={{ top: placed.top, left: placed.left, opacity: 1 }}
        transition={ease}
      >
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId} className="mt-1 font-display text-[18px] leading-snug">
          {title}
        </h2>
        <p className="mt-2 text-[14px] text-muted">{body}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {actions.map((a) => (
            <Button key={a.label} size="sm" variant={a.primary ? 'primary' : 'ghost'} onClick={a.onPress}>
              {a.label}
            </Button>
          ))}
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
