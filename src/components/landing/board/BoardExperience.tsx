import { Component, Suspense, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { useReducedMotion } from 'motion/react'
import { BoardScene } from './BoardScene'
import type { BoardHandle } from './BoardScene'
import { BoardFallback } from './BoardFallback'

/**
 * The 3D board, and everything that has to be true before it is safe to show.
 *
 * THE FLAT BOARD IS A FAILURE STATE, NOT A LOADING STATE. It renders when
 * WebGL is missing and when the error boundary catches the scene, and at no
 * other time. It used to be mounted underneath from the first paint and faded
 * out once the model was ready, which meant every visitor was shown the old
 * flat kanban for as long as the GLB took to arrive — a picture of a different
 * product, flashing up on every load. The box below holds its own height, so
 * showing nothing there costs a moment of empty space and no reflow.
 *
 * THE CANVAS STOPS WHEN NOBODY IS LOOKING. `frameloop` goes to `never` when the
 * hero scrolls away or the tab is hidden — a continuously rendering WebGL
 * canvas on a page somebody has scrolled past is heat and battery spent on
 * nothing.
 */

/** WebGL, once, without leaving a context behind. */
function webglWorks() {
  if (typeof window === 'undefined') return false
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

class SceneBoundary extends Component<
  { children: ReactNode; onFail: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    // Never take the page down for a decoration.
    console.warn('BoardExperience:', error.message)
    this.props.onFail()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export default function BoardExperience({ handle }: { handle: BoardHandle }) {
  const reduced = useReducedMotion() ?? false
  const host = useRef<HTMLDivElement>(null)
  const [supported] = useState(webglWorks)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [live, setLive] = useState(true)
  const [interactive, setInteractive] = useState(false)

  const use3d = supported && !failed

  // Pointer tilt and card hover are a mouse affordance. A touch screen has no
  // hover, and the tilt would fight the scroll.
  useEffect(() => {
    const q = window.matchMedia('(min-width: 1024px) and (pointer: fine)')
    const sync = () => setInteractive(q.matches && !reduced)
    sync()
    q.addEventListener('change', sync)
    return () => q.removeEventListener('change', sync)
  }, [reduced])

  useEffect(() => {
    if (!use3d) return
    const el = host.current
    if (!el) return

    let onScreen = true
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            ([e]) => {
              onScreen = e.isIntersecting
              setLive(onScreen && !document.hidden)
            },
            { rootMargin: '200px' },
          )
        : null
    io?.observe(el)

    const onVisibility = () => setLive(onScreen && !document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      io?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [use3d])

  // The pointer is read here rather than in the scene so the listener is a
  // plain DOM one and the frame loop only ever reads a ref.
  useEffect(() => {
    if (!use3d || !interactive) return
    const el = host.current
    if (!el) return
    const onMove = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect()
      handle.pointer.current = {
        x: ((ev.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1,
        y: -(((ev.clientY - r.top) / Math.max(r.height, 1)) * 2 - 1),
        active: true,
      }
    }
    const onLeave = () => {
      handle.pointer.current = { ...handle.pointer.current, active: false }
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [use3d, interactive, handle])

  return (
    <div ref={host} className="relative w-full">
      {/* The glows are CSS, not postprocessing. Bloom on a scene this simple
          costs a render target and buys a haze the brand does not want. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(58% 52% at 46% 42%, rgba(93,110,220,0.30) 0%, transparent 70%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(26% 26% at 76% 76%, rgba(240,180,41,0.22) 0%, transparent 72%)',
        }}
      />

      {/* Sized in CSS, not by the model: the canvas box has to exist at its
          final height before the GLB arrives or the hero reflows around it. */}
      <div className="relative h-[340px] w-full sm:h-[400px] lg:h-[470px] xl:h-[500px]">
        {/* Only when there will never be a 3D board to show. */}
        {!use3d && (
          <div className="absolute inset-0">
            <BoardFallback />
          </div>
        )}

        {use3d && (
          <div
            className="absolute inset-0 transition-opacity duration-700"
            style={{ opacity: ready ? 1 : 0 }}
          >
            <SceneBoundary onFail={() => setFailed(true)}>
              <Canvas
                dpr={[1, 1.5]}
                frameloop={live ? 'always' : 'never'}
                camera={{ position: [0, 1.4, 12], fov: 35 }}
                gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
                onCreated={({ camera }) => camera.lookAt(0, 1.4, 0)}
                style={{ background: 'transparent' }}
              >
                <ambientLight intensity={0.85} />
                <directionalLight position={[4, 6, 6]} intensity={2.1} color="#DCE4FF" />
                <pointLight position={[-4, -1.5, 4]} intensity={18} color="#F0B429" />
                <Suspense fallback={null}>
                  <BoardScene
                    handle={handle}
                    reduced={reduced}
                    interactive={interactive}
                  />
                  <Ready onReady={() => setReady(true)} />
                </Suspense>
              </Canvas>
            </SceneBoundary>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Fires once the suspended scene has actually mounted.
 *
 * Suspense resolving is the only honest signal that the GLB is parsed and the
 * first frame can be drawn — a timer would guess, and on a slow connection it
 * would guess wrong and show an empty canvas.
 */
function Ready({ onReady }: { onReady: () => void }) {
  useEffect(onReady, [onReady])
  return null
}
