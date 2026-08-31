import { Suspense, lazy, useMemo } from 'react'
import { ButtonLink } from '../ui/Button'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { CursorRingField } from './CursorRingField'
import type { BoardHandle } from './board/BoardScene'
import { Rise, WordReveal } from './Anim'

/**
 * Three things that are true at sign-up. "Email confirmation" used to be here
 * and is not: no mail is sent yet, and a landing page is the worst place to
 * promise one.
 */
/**
 * three, fiber and drei are around 200KB gzipped between them — more than the
 * entire rest of this page. Split out, they load after the landing chunk rather
 * than inside it, and the flat board holds the space meanwhile.
 */
const BoardExperience = lazy(() => import('./board/BoardExperience'))

/**
 * The canvas box, at its final height, before anything has loaded.
 *
 * It holds the space and shows nothing. The flat board used to sit in here and
 * it is why the old kanban flashed up on every load: it painted immediately,
 * then had to be faded out again the moment the real board was ready.
 */
const BOX = 'relative h-[360px] w-full sm:h-[420px] lg:h-[540px] xl:h-[580px]'

const TRUST: { icon: IconName; label: string }[] = [
  { icon: 'checkCircle', label: 'Google sign-in' },
  { icon: 'shield', label: 'Professors approved by the program' },
  { icon: 'lock', label: 'A class is private to the people in it' },
]

/** The hero's left column. */
function HeroCopy() {
  return (
    <div className="max-w-[640px]">
      <Rise delay={0.02}>
        <span className="inline-flex items-center gap-2.5 rounded-full border border-white/18 bg-white/8 py-2 pr-4 pl-3 text-[13px] text-white/85 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          Dr. Yanga's Colleges · BSIT program
        </span>
      </Rise>

      {/* Set a word at a time rather than faded in as a block: the sentence is
          the page's whole argument, and watching it be built is the one place a
          heading earns motion. */}
      <WordReveal
        text="Where BSIT programs run the term."
        accent={['run', 'the', 'term']}
        delay={0.12}
        className="mt-6 text-[clamp(2.3rem,5.6vw,3.9rem)] leading-[1.0] font-extrabold text-balance"
      />

      <Rise
        as="p"
        delay={0.18}
        className="mt-6 max-w-[540px] text-[clamp(1rem,1.5vw,1.15rem)] leading-relaxed text-white/72"
      >
        Projects, boards and deadlines for classes at Dr. Yanga's Colleges.
      </Rise>

      <Rise delay={0.26} className="mt-8 flex flex-wrap items-center gap-3">
        <ButtonLink to="/register" variant="accent" size="lg" className="board-cta">
          Create your account
          <Icon name="arrowRight" size={18} />
        </ButtonLink>
        <a
          href="#how"
          className="inline-flex h-[52px] items-center rounded-full border border-white/25 px-7 text-[15.5px] font-medium text-white transition-colors duration-200 hover:bg-white/10"
        >
          See how it works
        </a>
      </Rise>

      <Rise as="ul" delay={0.34} className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        {TRUST.map((t) => (
          <li key={t.label} className="flex items-center gap-2 text-[13.5px] text-white/60">
            <Icon name={t.icon} size={16} className="text-amber-400" />
            {t.label}
          </li>
        ))}
      </Rise>
    </div>
  )
}

export function Hero() {
  // The board reads the pointer through this and nothing else crosses the
  // boundary. useMemo rather than a ref: reading `.current` during render is
  // what React's rules forbid, and a stable object is all this needs to be.
  const handle = useMemo<BoardHandle>(
    () => ({ pointer: { current: { x: 0, y: 0, active: false } } }),
    [],
  )

  return (
    <section className="relative overflow-hidden bg-navy-600 text-white">
      {/* Every decorative layer, grouped so none of them can take a click. The
          particle field spans the whole hero and would otherwise sit between
          the reader and anything the copy does not cover. It tracks the cursor
          from a `window` listener, so it loses nothing by being inert. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
      {/* Depth: a wide radial lift behind the copy, then the blueprint rule on top. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 18% 8%, #33429B 0%, #26327A 42%, #161D4A 100%)',
        }}
      />
      <div aria-hidden className="blueprint absolute inset-0 opacity-70" />
      <div
        aria-hidden
        className="absolute -top-40 -right-32 h-[560px] w-[560px] rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(circle, #F0B429 0%, transparent 62%)' }}
      />

      {/* The field sits on top of the gradient, the grid and the glow, and
          under everything that is read. Its own background is transparent so
          all three still show through — it contributes points, not a ground.
          Under `prefers-reduced-motion` it renders no canvas at all and the
          hero is exactly what it was. */}
      <CursorRingField
        // One stop, so every point is the accent and nothing in the field
        // drifts toward the blues of the ground behind it. The shader skips its
        // ramp entirely at a count of one and every point is this colour, then
        // multiplied by its own ring energy — so the variation left is
        // brightness alone: dim amber at rest, full amber where the ring is.
        colors={['#F0B429']}
        ring={{ radius: 12, width: 9 }}
      />
      </div>

      <div className="shell relative pt-[124px] pb-20 md:pt-[150px] md:pb-28 lg:pt-[168px] lg:pb-32">
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)] lg:gap-16 xl:gap-20">
          <HeroCopy />

          {/* No `Rise` around this one: the board arrives by building itself,
              and a container fading up underneath that entrance would be two
              arrivals for one object. */}
          <div className="relative">
            <Suspense
              fallback={
                <div className="relative w-full">
                  <div className={BOX} />
                </div>
              }
            >
              <BoardExperience handle={handle} />
            </Suspense>
          </div>
        </div>
      </div>

      {/* Section seam: the hero sits on the page surface, not a hard edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
        style={{
          background: 'linear-gradient(to bottom, transparent, rgb(0 0 0 / 0.18))',
        }}
      />
    </section>
  )
}
