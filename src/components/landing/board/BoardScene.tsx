/* eslint-disable react-hooks/immutability -- The frame loop mutates Three
   objects in place, which is what React Three Fiber prescribes and what the
   whole file exists to do: a scene graph is retained, not re-rendered, and
   rebuilding it each frame is the thing this design avoids. The rule is about
   render purity and nothing here runs during render. Scoped to this file, not
   the project. */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { HERO_UNTIL, LOOP, LOOP_SECONDS, ramp, storyProgress } from './story'

const MODEL = '/models/board.glb'
useGLTF.preload(MODEL)

/**
 * The model's navy, lifted a long way up the brand ramp.
 *
 * The GLB ships its three navies around navy-700, which is roughly the value of
 * the hero sitting behind it — the board read as a silhouette of itself rather
 * than as an object in front of something. These are two steps lighter and they
 * keep the model's own ordering, so it still reads as one object: the panel
 * faces lightest, the plate and cards a step below them, the bars darkest.
 *
 * Named as tokens, not hexes, because the ramp is the ramp — see the design
 * notes. The fallbacks are the same values and exist only for the case where
 * the stylesheet has not resolved, which would otherwise leave the board white.
 */
const NAVY: Record<string, [token: string, fallback: string]> = {
  PanelGlass: ['--color-navy-400', '#5a6bbd'],
  MatteNavy: ['--color-navy-500', '#3d4da3'],
  DeepNavy: ['--color-navy-600', '#26327a'],
}

function token([name, fallback]: [string, string]) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/**
 * The board itself.
 *
 * ONE NESTED GROUP PER SOURCE OF MOTION, and that is the whole architecture:
 *
 *     story → entrance → pointer → float → the model
 *
 * Four things move this board and they run on different clocks — the entrance
 * builds it, the float loops forever, the pointer chases a cursor, the story
 * runs its timeline. Written onto one transform they would each be overwriting
 * the others every frame, and the last one to run each frame would win. On
 * separate groups the matrices simply compose and none of them has to know
 * about the rest.
 *
 * THE TIMELINE LOOPS, AND THE DISSOLVE IS WHAT MAKES THAT POSSIBLE. Every pose
 * here is a pure function of the story fraction, so the fraction can be reset
 * to its start at any moment — but doing that while the board is visible would
 * teleport the flying card home. So the last second of every turn scales the
 * parts away and walks the entrance backwards to its own starting transform.
 * At the wrap the board is already in exactly the state the next entrance
 * begins from, and there is nothing on screen to snap.
 *
 * NO REACT STATE IN THE FRAME LOOP. The timeline is read off the render
 * clock and every animated value is set straight onto a Three object. A
 * component that re-rendered each tick would re-render the whole canvas tree
 * sixty times a second.
 *
 * THE GLTF SCENE IS CLONED. `useGLTF` caches by URL and hands every caller the
 * same object; mutating it would follow the model into any other mount, and in
 * StrictMode that is the second mount of this very component.
 */

/**
 * How the board is framed in its box.
 *
 * Done on the camera rather than on the model, because the model's groups are
 * all written to on every frame and a static transform put on any of them
 * would be overwritten before it was ever seen.
 *
 * `fill` is the share of the box the board spans on whichever axis binds
 * first — raise it to make the board bigger. `offset` slides it around inside
 * the box as a fraction of what is visible, so it sits in the same place at
 * every width rather than drifting as the column changes size.
 */
const FRAME = {
  /**
   * Deliberately not near 1. The fit is measured against the model's REST
   * pose, but almost nothing on this board is ever at rest: it turns 9 degrees
   * toward the reader, the panels step forward — which is toward the camera,
   * so they are magnified — the whole thing floats, and the card leaves the
   * body of the model entirely on its arc. The leftover is the room all of
   * that plays in. At 0.97 there was none, and the plate lost its bottom right
   * corner every time the board turned.
   */
  fill: 0.8,
  /** -x is left, +y is up. */
  offset: { x: -0.045, y: 0.055 },
}

/** power3.out — the brief's entrance easing, as a function rather than a tween. */
const power3Out = (t: number) => 1 - Math.pow(1 - t, 3)

const ENTRANCE_MS = 1400
/** Panels, then cards, then bars: each group's reveal is offset by this much. */
const REVEAL_STEP = 0.075

type Named = Record<string, THREE.Object3D>

export type BoardHandle = {
  pointer: { current: { x: number; y: number; active: boolean } }
}

export function BoardScene({
  handle,
  reduced,
  interactive,
}: {
  handle: BoardHandle
  reduced: boolean
  /** Desktop only: pointer tilt and card hover. */
  interactive: boolean
}) {
  const { scene } = useGLTF(MODEL)
  const { invalidate, camera, size: box } = useThree()

  const storyGroup = useRef<THREE.Group>(null)
  const entranceGroup = useRef<THREE.Group>(null)
  const pointerGroup = useRef<THREE.Group>(null)
  const floatGroup = useRef<THREE.Group>(null)

  const started = useRef(0)
  const hovered = useRef<THREE.Object3D | null>(null)
  /** How lifted each card currently is, 0–1. Eased here, applied as a factor. */
  const lift = useRef(new Map<THREE.Object3D, number>())
  const tilt = useRef({ x: 0, y: 0 })

  // Cloned once per mount. Materials that get an emissive lift are cloned too —
  // they are shared across meshes inside the GLTF, so writing to the original
  // would tint every other instance of the model as well.
  const model = useMemo(() => {
    const root = scene.clone(true)
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = false
      mesh.receiveShadow = false
      const mat = mesh.material as THREE.MeshStandardMaterial
      if (!mat || !mat.name) return
      if (mat.name === 'Amber' || mat.name === 'TrailAmber') {
        const clone = mat.clone()
        clone.emissive = new THREE.Color('#F0B429')
        // The trail is allowed to be the brightest thing on the board; the
        // amber cards are an accent, not a light source.
        clone.emissiveIntensity = mat.name === 'TrailAmber' ? 0.85 : 0.35
        mesh.material = clone
      } else if (NAVY[mat.name]) {
        // Cloned for the same reason the amber is: `useGLTF` caches by URL and
        // hands every caller the same material.
        const clone = mat.clone()
        clone.color = new THREE.Color(token(NAVY[mat.name]))
        mesh.material = clone
      }
    })
    return root
  }, [scene])

  /** Every object the story addresses, looked up once. */
  const named = useMemo(() => {
    const map: Named = {}
    model.traverse((o) => {
      if (o.name) map[o.name] = o
    })
    return map
  }, [model])

  /** Where each part sits in the finished model — every animation returns here. */
  const home = useMemo(() => {
    const rest = new Map<
      THREE.Object3D,
      { p: THREE.Vector3; r: THREE.Euler; s: THREE.Vector3 }
    >()
    Object.values(named).forEach((o) => {
      rest.set(o, { p: o.position.clone(), r: o.rotation.clone(), s: o.scale.clone() })
    })
    return rest
  }, [named])

  /**
   * The plate is revealed like any other part, and that is load-bearing for the
   * loop rather than for the entrance. It is the one piece the staggered reveal
   * used to skip, so it sat at full scale while everything above it scaled
   * away — the dissolve ended on a bare slab hanging in the hero instead of on
   * an empty stage the next turn could build on.
   */
  const plate = useMemo(() => [named.BasePlate].filter(Boolean), [named])
  /**
   * The model's own extents, measured once from the clone.
   *
   * Padded upward because the flying card leaves the rest bounds on its arc,
   * and the trail above it goes further still — fitting to the rest pose alone
   * crops the one gesture the whole scene is built around.
   */
  const bounds = useMemo(() => {
    const b = new THREE.Box3().setFromObject(model)
    const size = b.getSize(new THREE.Vector3())
    const center = b.getCenter(new THREE.Vector3())
    // Up for the card's arc and the trail above it; out for the swing the
    // plate's far corner takes as the board turns. Raising the centre with the
    // height is what keeps the card in frame without dropping the plate out of
    // the bottom of it.
    size.y += 0.9
    center.y += 0.45
    size.x += 0.45
    return { size, center }
  }, [model])

  /**
   * FIT TO BOTH AXES, NOT JUST HEIGHT.
   *
   * A perspective camera's fov is vertical, so a fixed camera distance sizes
   * the board against the box's height and ignores its width entirely. The
   * board is wider than it is tall and the column it sits in narrows with the
   * viewport, so on anything under about a square box the sides were simply
   * cut off — the base plate was sliced at both ends at 1024px wide and had
   * been since the board landed. Taking whichever axis needs more distance
   * means it is framed the same way at every width.
   */
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    const aspect = Math.max(box.width, 1) / Math.max(box.height, 1)
    const halfV = Math.tan((cam.fov * Math.PI) / 180 / 2)
    const dist = Math.max(
      bounds.size.y / 2 / (halfV * FRAME.fill),
      bounds.size.x / 2 / (halfV * aspect * FRAME.fill),
    )
    // Panned, not rotated: the view axis stays parallel to Z so the offset
    // cannot introduce a perspective skew the model was never posed for.
    const visibleH = 2 * halfV * dist
    cam.position.set(
      bounds.center.x - FRAME.offset.x * visibleH * aspect,
      bounds.center.y - FRAME.offset.y * visibleH,
      bounds.center.z + dist,
    )
    cam.lookAt(cam.position.x, cam.position.y, bounds.center.z)
    cam.updateProjectionMatrix()
    invalidate()
  }, [camera, box, bounds, invalidate])

  const panels = useMemo(
    () => ['Panel_0', 'Panel_1', 'Panel_2'].map((n) => named[n]).filter(Boolean),
    [named],
  )
  const cards = useMemo(
    () => Object.keys(named).filter((n) => n.startsWith('Card_')).map((n) => named[n]),
    [named],
  )
  const bars = useMemo(
    () => Object.keys(named).filter((n) => n.startsWith('CardBar_')).map((n) => named[n]),
    [named],
  )

  // Reduced motion gets the finished board and nothing else — no entrance to
  // wait through, no float, no tilt. The frame loop below returns early, so
  // this is the only place the transforms are ever set.
  useEffect(() => {
    if (!reduced) return
    const e = entranceGroup.current
    if (!e) return
    e.position.set(0, 0, 0)
    e.rotation.set(0.04, -0.16, -0.01)
    e.scale.setScalar(1)
    Object.values(named).forEach((o) => {
      const rest = home.get(o)
      if (rest) o.scale.copy(rest.s)
    })
    invalidate()
  }, [reduced, named, home, invalidate])

  useFrame((state, delta) => {
    if (reduced) return
    const now = state.clock.elapsedTime
    if (!started.current) started.current = now

    // Where we are in this turn of the loop. Everything below reads from these
    // three and nothing carries over between turns.
    const cyc = (now - started.current) % LOOP_SECONDS
    const since = cyc * 1000
    // The dissolve. 0 for almost the whole turn, 1 at the wrap — so `alive`
    // takes every visible part to nothing and the entrance back to its start.
    const alive = 1 - ramp(cyc, LOOP_SECONDS - LOOP.outro, LOOP_SECONDS)

    /* ---------------------------------------------------------- entrance */
    const e = entranceGroup.current
    if (e) {
      const t = power3Out(Math.min(1, since / ENTRANCE_MS)) * alive
      e.position.set(0.65 * (1 - t), -0.35 * (1 - t), 0)
      e.rotation.set(
        0.18 + (0.04 - 0.18) * t,
        -0.42 + (-0.16 + 0.42) * t,
        -0.04 + (-0.01 + 0.04) * t,
      )
      e.scale.setScalar(0.78 + 0.22 * t)
    }

    // Parts arrive after the board does, in the order somebody would build one:
    // the columns, then what is in them, then the bars on the cards.
    const partReveal = (list: THREE.Object3D[], startAt: number) => {
      list.forEach((o, i) => {
        const rest = home.get(o)
        if (!rest) return
        const t = power3Out(
          Math.min(1, Math.max(0, since / 1000 - startAt - i * REVEAL_STEP) / 0.45),
        )
        o.scale.copy(rest.s).multiplyScalar(t * alive)
      })
    }
    // The plate first, then what stands on it.
    partReveal(plate, 0)
    partReveal(panels, 0.25)
    partReveal(cards, 0.55)
    partReveal(bars, 0.8)

    const flying = named.FlyingCard
    const trail = named.Trail
    const flyIn = power3Out(Math.min(1, Math.max(0, since / 1000 - 1.05) / 0.6))
    if (flying && trail) {
      const rest = home.get(flying)
      const trailRest = home.get(trail)
      if (rest) {
        // It comes in along the trail's own direction, so the two read as one
        // gesture rather than a card and a separate streak.
        flying.scale.copy(rest.s).multiplyScalar(flyIn * alive)
      }
      if (trailRest) trail.scale.copy(trailRest.s).multiplyScalar(flyIn * alive)
    }

    /* ------------------------------------------------------------ story */
    const p = storyProgress(cyc)
    const s = storyGroup.current
    if (s) {
      // Turning toward the reader as the story runs, and never past front —
      // this board explains itself, it does not present itself.
      // `alive` unwinds the turn along with everything else, so the base plate
      // — which is not part of the staggered reveal and stays visible right up
      // to the wrap — is square-on again by the time the next turn starts.
      const toFront = ramp(p, HERO_UNTIL, 0.9) * alive
      s.rotation.y = 0.16 * toFront
      s.rotation.x = -0.02 * toFront
      // Stage five: settle back very slightly rather than drifting away.
      s.scale.setScalar(1 - 0.04 * ramp(p, 0.9, 1) * alive)
    }

    // Stage two — the columns step forward, left to right.
    const create = ramp(p, HERO_UNTIL, 0.4)
    panels.forEach((o, i) => {
      const rest = home.get(o)
      if (!rest) return
      const own = ramp(p, HERO_UNTIL + i * 0.03, 0.4)
      o.position.z = rest.p.z + 0.18 * own * create
    })

    // Card_0_0's step forward is applied in the hover pass below, which is the
    // only place a card's z is written — two writers meant the later one won.
    const first = named.Card_0_0

    // Stages three and four — the card crosses the board on an arc, turning as
    // it goes, and the trail fades out behind it as it lands.
    if (flying && trail) {
      const rest = home.get(flying)
      const trailRest = home.get(trail)
      const target1 = named.Panel_1
      const target2 = named.Panel_2
      if (rest && target1 && target2 && flyIn > 0.99) {
        const move = ramp(p, 0.4, 0.68)
        const land = ramp(p, 0.68, 0.9)
        const mid = home.get(target1)?.p ?? rest.p
        const end = home.get(target2)?.p ?? rest.p

        const x = THREE.MathUtils.lerp(
          THREE.MathUtils.lerp(rest.p.x, mid.x, move),
          end.x,
          land,
        )
        const y = THREE.MathUtils.lerp(
          THREE.MathUtils.lerp(rest.p.y, mid.y + 0.35, move),
          end.y,
          land,
        )
        // The arc: up over the gap, down into the column. Peaks mid-move.
        const arc = Math.sin(Math.PI * move) * 0.28 * (1 - land)
        flying.position.set(x, y + arc, rest.p.z + 0.25 * (1 - land))
        flying.rotation.set(
          rest.r.x * (1 - land),
          rest.r.y * (1 - land),
          rest.r.z * (1 - move) * (1 - land),
        )

        const trailMat = (trail as THREE.Mesh).material as THREE.MeshStandardMaterial
        if (trailMat) {
          trailMat.emissiveIntensity = 0.85 + 1.1 * Math.sin(Math.PI * move) * (1 - land)
          trailMat.transparent = true
          trailMat.opacity = 1 - land
        }
        if (trailRest) trail.scale.copy(trailRest.s).multiplyScalar(1 - land)
      }
    }

    // Completion: the right column's amber lifts once as the card settles.
    const done = ramp(p, 0.72, 0.9)
    bars.forEach((o) => {
      const mesh = o as THREE.Mesh
      const mat = mesh.material as THREE.MeshStandardMaterial
      if (!mat || mat.name !== 'Amber') return
      const right = o.name.startsWith('CardBar_2')
      const left = o.name.startsWith('CardBar_0')
      mat.emissiveIntensity = 0.35 + (right ? 0.9 * done : 0) + (left ? 0.5 * create : 0)
    })

    /* ------------------------------------------------- float and pointer */
    const f = floatGroup.current
    if (f) {
      // Damped while the card lands, so the arrival reads as settling.
      const calm = 1 - 0.75 * ramp(p, 0.68, 0.9)
      f.position.y = Math.sin(now * 1.15) * 0.04 * calm
      f.rotation.z = Math.sin(now * 0.85) * 0.012 * calm
    }

    const g = pointerGroup.current
    if (g && interactive) {
      const { x, y, active } = handle.pointer.current
      const tx = active ? -y * 0.026 : 0 // ±1.5°
      const ty = active ? x * 0.044 : 0 // ±2.5°
      // Chased, not followed: a board pinned to the cursor is hard to read.
      const k = 1 - Math.pow(0.001, delta)
      tilt.current.x += (tx - tilt.current.x) * k
      tilt.current.y += (ty - tilt.current.y) * k
      g.rotation.x = tilt.current.x
      g.rotation.y = tilt.current.y
    }

    // Card hover, and never on the flying card while the story owns it.
    //
    // THE LIFT IS A FACTOR, NOT A TARGET. This used to ease each card's scale
    // toward its full size, and because it runs after the reveal it won every
    // frame — the entrance was quietly damped, and through the dissolve the
    // cards held at a fraction of full size while everything around them went
    // to nothing. Easing the 0–1 lift instead and multiplying whatever the
    // reveal left means a hover can never resurrect a card the story has
    // already taken away.
    const lifted = hovered.current
    const k = 1 - Math.pow(0.0005, delta)
    cards.forEach((o) => {
      const rest = home.get(o)
      if (!rest) return
      const on = o === lifted ? 1 : 0
      const next = (lift.current.get(o) ?? 0) * (1 - k) + on * k
      lift.current.set(o, next)

      o.position.z = rest.p.z + (o === first ? 0.12 * create : 0) + 0.07 * next
      o.scale.x *= 1 + 0.02 * next
      o.scale.y *= 1 + 0.02 * next
    })
  })

  return (
    <group ref={storyGroup}>
      <group ref={entranceGroup}>
        <group ref={pointerGroup}>
          <group ref={floatGroup}>
            <primitive
              object={model}
              onPointerOver={(ev: { object: THREE.Object3D; stopPropagation: () => void }) => {
                if (!interactive) return
                const o = ev.object
                if (o.name.startsWith('Card_')) {
                  hovered.current = o
                  ev.stopPropagation()
                }
              }}
              onPointerOut={() => {
                hovered.current = null
              }}
            />
          </group>
        </group>
      </group>
    </group>
  )
}
