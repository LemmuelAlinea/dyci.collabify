import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform, useVelocity } from 'motion/react'
import { edgeSpeed } from '../../lib/work/boardDrop'

/** A press on one of these stays that control's. The card's own open button can start a drag. */
const NOT_A_HANDLE = 'a, input, select, textarea, label, button:not([data-card-open]), [data-no-drag]'
/** A finger holds this long to pick a card up, so a swipe still scrolls the page. */
const HOLD_MS = 200
const TOUCH_SLOP = 10
const MOUSE_SLOP = 5
const LIFTED_SCALE = 1.03
const SPRING = { type: 'spring', stiffness: 520, damping: 42, restDelta: 0.5, restSpeed: 2 } as const
const STILL = { duration: 0 } as const

export type BoardDragOptions = {
  /** Why this card may not land on this column, or null when it may. */
  refusal: (cardId: string, column: number) => string | null
  /** Moves the card and reloads. False when the move failed and was already reported. */
  commit: (cardId: string, column: number) => Promise<boolean>
  /** A drop on a column that refuses the card. */
  onRefused: (reason: string) => void
}

export type BoardDragActive = {
  id: string
  column: number
  width: number
  height: number
  phase: 'dragging' | 'returning' | 'landing'
  refusals: ReadonlyMap<number, string>
  clone: HTMLElement
}

export type BoardDrag = {
  active: BoardDragActive | null
  over: number | null
  /** The column a card is shown in while its move is on the way, if one is. */
  pendingColumn: (id: string) => number | undefined
  cardProps: (id: string, column: number, draggable: boolean) => {
    'data-board-card': string
    'data-grab'?: string
    onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void
  }
  cardClass: (id: string) => string
  /** Moves a card without dragging it, for the Move to menu. */
  moveTo: (id: string, column: number) => void
  layer: ReactNode
}

type Session = {
  id: string
  column: number
  el: HTMLElement
  grabX: number
  grabY: number
  px: number
  py: number
  over: number | null
  refusals: ReadonlyMap<number, string>
  live: boolean
  stop: () => void
}

type Rects = Map<string, DOMRect>

function snapshot(root: HTMLElement): Rects {
  const rects: Rects = new Map()
  root.querySelectorAll<HTMLElement>('[data-board-card]').forEach((el) => {
    rects.set(el.dataset.boardCard!, el.getBoundingClientRect())
  })
  return rects
}

/** Glides every card from where it was to where the last render put it. */
function glide(root: HTMLElement, before: Rects, skip: string | null, reduce: boolean) {
  if (reduce) return
  root.querySelectorAll<HTMLElement>('[data-board-card]').forEach((el) => {
    const id = el.dataset.boardCard!
    const was = before.get(id)
    if (!was || id === skip) return
    const now = el.getBoundingClientRect()
    const dx = was.left - now.left
    const dy = was.top - now.top
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
    // A card that crosses columns stays above the ones it passes.
    if (dx !== 0) el.style.zIndex = '20'
    const run = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration: 240,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    })
    run.onfinish = () => {
      el.style.zIndex = ''
    }
  })
}

function scrollerOf(start: Element | undefined, axis: 'x' | 'y'): Element | null {
  for (let n: Element | null = start ?? null; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const style = getComputedStyle(n)
    const flow = axis === 'y' ? style.overflowY : style.overflowX
    const spills = axis === 'y' ? n.scrollHeight > n.clientHeight + 1 : n.scrollWidth > n.clientWidth + 1
    if ((flow === 'auto' || flow === 'scroll') && spills) return n
  }
  return axis === 'y' ? document.scrollingElement : null
}

/** A click right after a drag belongs to the drag, not to whatever is under the pointer. */
function swallowNextClick() {
  const swallow = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 60)
}

/**
 * Drag between a board's columns. The lifted card is a copy in a layer over the
 * page, so a scrolling board cannot clip it, and it follows the pointer through
 * motion values, so a drag re-renders the board only when it enters a column.
 * A mouse lifts after a few pixels; a finger lifts after a short hold, which
 * leaves swipes to the page. Motion is honored off with reduced motion.
 */
export function useBoardDrag(options: BoardDragOptions): BoardDrag & { attach: (node: HTMLDivElement | null) => void } {
  const reduce = Boolean(useReducedMotion())
  const [root, attach] = useState<HTMLDivElement | null>(null)
  const [active, setActive] = useState<BoardDragActive | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [pending, setPending] = useState<ReadonlyMap<string, number>>(() => new Map())
  const latest = useRef(options)
  const session = useRef<Session | null>(null)
  const afterRender = useRef<(() => void)[]>([])

  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const scale = useMotionValue(1)
  const opacity = useMotionValue(1)
  const tilt = useTransform(useVelocity(x), [-1400, 0, 1400], [-5, 0, 5], { clamp: true })
  const rotate = useSpring(tilt, { stiffness: 300, damping: 30 })

  useLayoutEffect(() => {
    latest.current = options
    const run = afterRender.current
    afterRender.current = []
    run.forEach((fn) => fn())
  })

  // Once a card is up, the finger moves the card and not the page. This has to
  // be registered before the touch starts for the browser to honor it.
  useEffect(() => {
    if (!root) return
    const hold = (e: TouchEvent) => {
      if (session.current?.live) e.preventDefault()
    }
    root.addEventListener('touchmove', hold, { passive: false })
    return () => {
      root.removeEventListener('touchmove', hold)
      session.current?.stop()
      session.current = null
      document.documentElement.classList.remove('board-dragging')
    }
  }, [root])

  const transition = reduce ? STILL : SPRING

  const fly = (left: number, top: number) =>
    Promise.all([animate(x, left, transition), animate(y, top, transition), animate(scale, 1, transition)])

  const fade = () =>
    Promise.all([
      animate(opacity, 0, reduce ? STILL : { duration: 0.16 }),
      animate(scale, reduce ? 1 : 0.96, reduce ? STILL : { duration: 0.16 }),
    ])

  const clear = (s: Session) => {
    if (session.current !== s) return
    session.current = null
    setActive(null)
  }

  const add = (id: string, column: number) => setPending((p) => new Map(p).set(id, column))

  async function send(id: string, column: number) {
    const moved = await latest.current.commit(id, column).catch(() => false)
    if (!moved && root) {
      const before = snapshot(root)
      afterRender.current.push(() => glide(root, before, null, reduce))
    }
    setPending((p) => {
      const next = new Map(p)
      next.delete(id)
      return next
    })
  }

  function land(s: Session, column: number) {
    if (!root) return clear(s)
    const before = snapshot(root)
    afterRender.current.push(() => {
      glide(root, before, s.id, reduce)
      const rect = root.querySelector(`[data-board-card="${s.id}"]`)?.getBoundingClientRect()
      const inView = rect && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
      void (rect && inView ? fly(rect.left, rect.top) : fade()).then(() => clear(s))
    })
    add(s.id, column)
    setActive((a) => a && { ...a, phase: 'landing' })
    setOver(null)
    void send(s.id, column)
  }

  function settleBack(s: Session) {
    setActive((a) => a && { ...a, phase: 'returning' })
    setOver(null)
    if (!s.el.isConnected) {
      void fade().then(() => clear(s))
      return
    }
    const rect = s.el.getBoundingClientRect()
    void fly(rect.left, rect.top).then(() => clear(s))
  }

  function finish(s: Session, dropped: boolean) {
    if (!s.live) return
    s.live = false
    s.stop()
    document.documentElement.classList.remove('board-dragging')
    swallowNextClick()
    const target = s.over
    if (dropped && target !== null && target !== s.column) {
      const reason = s.refusals.get(target)
      if (!reason) return land(s, target)
      latest.current.onRefused(reason)
    }
    settleBack(s)
  }

  function lift(el: HTMLElement, id: string, column: number, pointer: number, grabX: number, grabY: number, px: number, py: number) {
    if (!root || !el.isConnected) return
    const rect = el.getBoundingClientRect()
    const clone = el.cloneNode(true) as HTMLElement
    clone.removeAttribute('data-board-card')
    clone.removeAttribute('data-grab')
    clone.inert = true
    clone.style.margin = '0'

    const columns = [...root.querySelectorAll<HTMLElement>('[data-board-column]')]
    const refusals = new Map<number, string>()
    for (const c of columns) {
      const n = Number(c.dataset.boardColumn)
      if (n === column) continue
      const reason = latest.current.refusal(id, n)
      if (reason) refusals.set(n, reason)
    }
    const vertical = scrollerOf(root, 'y')
    const horizontal = scrollerOf(columns[0], 'x')
    const page = vertical === document.scrollingElement

    x.jump(rect.left)
    y.jump(rect.top)
    scale.jump(1)
    opacity.jump(1)

    const s: Session = {
      id,
      column,
      el,
      grabX: grabX - rect.left,
      grabY: grabY - rect.top,
      px,
      py,
      over: null,
      refusals,
      live: true,
      stop: () => undefined,
    }

    let last = performance.now()
    const tick = (now: number) => {
      if (!s.live) return
      // Somebody else moved or removed this card while it was up.
      if (!s.el.isConnected) return finish(s, false)
      const dt = Math.min(32, now - last) / 16.67
      last = now

      const hit = document.elementFromPoint(s.px, s.py)?.closest<HTMLElement>('[data-board-column]')
      const box = root.getBoundingClientRect()
      const inside = s.px >= box.left && s.px <= box.right && s.py >= box.top && s.py <= box.bottom
      // The gap between two columns keeps the last one, so the slot doesn't flicker.
      const next = hit && root.contains(hit) ? Number(hit.dataset.boardColumn) : inside ? s.over : null
      if (next !== s.over) {
        s.over = next
        setOver(next)
      }

      if (vertical) {
        const area = page ? null : vertical.getBoundingClientRect()
        const by = edgeSpeed(s.py, area?.top ?? 0, area?.bottom ?? window.innerHeight) * dt
        if (by) vertical.scrollBy({ top: by, behavior: 'instant' })
      }
      if (horizontal) {
        const area = horizontal.getBoundingClientRect()
        const by = edgeSpeed(s.px, area.left, area.right, 64, 14) * dt
        if (by) horizontal.scrollBy({ left: by, behavior: 'instant' })
      }
      raf = requestAnimationFrame(tick)
    }
    let raf = requestAnimationFrame(tick)

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return
      s.px = e.clientX
      s.py = e.clientY
      x.set(e.clientX - s.grabX)
      y.set(e.clientY - s.grabY)
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === pointer) finish(s, true)
    }
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId === pointer) finish(s, false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(s, false)
    }
    const onBlur = () => finish(s, false)
    const noMenu = (e: Event) => e.preventDefault()

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    window.addEventListener('contextmenu', noMenu)
    s.stop = () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('contextmenu', noMenu)
    }

    session.current = s
    document.documentElement.classList.add('board-dragging')
    window.getSelection()?.removeAllRanges()
    setActive({ id, column, width: rect.width, height: rect.height, phase: 'dragging', refusals, clone })
    void animate(scale, reduce ? 1 : LIFTED_SCALE, transition)
  }

  function press(e: ReactPointerEvent<HTMLElement>, id: string, column: number) {
    if (e.button !== 0 || !e.isPrimary || session.current) return
    if ((e.target as Element).closest(NOT_A_HANDLE)) return
    const el = e.currentTarget
    const pointer = e.pointerId
    const mouse = e.pointerType === 'mouse'
    const startX = e.clientX
    const startY = e.clientY
    let px = startX
    let py = startY
    let timer = 0

    const release = () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
    const begin = () => {
      release()
      lift(el, id, column, pointer, startX, startY, px, py)
    }
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return
      px = ev.clientX
      py = ev.clientY
      const far = Math.hypot(px - startX, py - startY)
      if (mouse && far > MOUSE_SLOP) begin()
      else if (!mouse && far > TOUCH_SLOP) release()
    }
    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId === pointer) release()
    }
    if (!mouse) timer = window.setTimeout(begin, HOLD_MS)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  function moveTo(id: string, column: number) {
    if (root) {
      const before = snapshot(root)
      afterRender.current.push(() => glide(root, before, null, reduce))
    }
    add(id, column)
    void send(id, column)
  }

  const layer =
    active &&
    createPortal(
      <motion.div
        aria-hidden="true"
        className="app-ui pointer-events-none fixed top-0 left-0 z-[75] rounded-xl"
        style={{ x, y, scale, rotate: reduce ? 0 : rotate, opacity, width: active.width, willChange: 'transform' }}
      >
        <motion.div
          className="absolute inset-0 rounded-xl shadow-lift"
          initial={{ opacity: reduce ? 1 : 0 }}
          animate={{ opacity: active.phase === 'dragging' ? 1 : 0 }}
          transition={{ duration: reduce ? 0 : 0.18 }}
        />
        <div
          className="relative"
          ref={(node) => {
            if (node && node.firstChild !== active.clone) node.replaceChildren(active.clone)
          }}
        />
      </motion.div>,
      document.body,
    )

  return {
    attach,
    active,
    over,
    pendingColumn: (id) => pending.get(id),
    cardProps: (id, column, draggable) => ({
      'data-board-card': id,
      ...(draggable ? { 'data-grab': '', onPointerDown: (e: ReactPointerEvent<HTMLElement>) => press(e, id, column) } : {}),
    }),
    cardClass: (id) => {
      if (active?.id !== id) return ''
      if (active.phase === 'landing') return 'invisible'
      return active.phase === 'dragging' ? 'opacity-35' : ''
    },
    moveTo,
    layer,
  }
}
