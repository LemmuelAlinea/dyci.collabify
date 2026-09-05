import { Suspense, lazy, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useReducedMotion } from 'motion/react'
import type { BoardHandle } from '../landing/board/BoardScene'
import { BlueprintField, Glow, Rise, Shell } from './parts'

const BoardExperience = lazy(() => import('../landing/board/BoardExperience'))

/**
 * The hero: the zip's furniture on the study's ground.
 *
 * From the study — near-black navy, one warm bleed, a wordmark large enough to
 * touch both gutters, mono micro-copy.
 *
 * From the zip — the orbit vectors sweeping behind the board, the two floating
 * labels that make the render read as a product rather than an object, and the
 * status bar ruled off along the bottom.
 *
 * The 3D board is the product's own, imported rather than copied, so the model
 * and its loop stay in one place.
 */

/**
 * The vectors behind the board.
 *
 * Two ellipses, a dashed second orbit, a travelling dash that runs the path,
 * and a slowly turning cross — the zip's exact set, redrawn against this
 * viewBox. All of it is decoration and all of it stops under reduced motion,
 * where the shapes stay and only the movement goes.
 */
function OrbitField({ still }: { still: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 820 620"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      fill="none"
    >
      <ellipse
        cx="410"
        cy="330"
        rx="360"
        ry="252"
        className="stroke-amber-50/12"
        strokeWidth="1.1"
      />
      <ellipse
        cx="410"
        cy="330"
        rx="288"
        ry="196"
        className="stroke-amber-50/10"
        strokeWidth="1.1"
        strokeDasharray="4 7"
      />
      {/* The travelling dash. A long gap and a short dash, offset over the
          whole length, so one bright segment appears to run the orbit. */}
      <ellipse
        cx="410"
        cy="330"
        rx="360"
        ry="252"
        className="stroke-amber-400"
        strokeWidth="2"
        strokeDasharray="90 1900"
        style={still ? undefined : { animation: 'collabify-orbit 16s linear infinite' }}
      />
      <g
        className="stroke-amber-400"
        strokeWidth="2"
        strokeLinecap="round"
        style={
          still
            ? undefined
            : { transformOrigin: '742px 92px', animation: 'collabify-turn 26s linear infinite' }
        }
      >
        <path d="M734 92h16M742 84v16" />
      </g>
      <circle cx="66" cy="392" r="4" className="fill-amber-400" />
    </svg>
  )
}

/** One of the two cards that sit over the render. */
function FloatingLabel({
  className,
  icon,
  title,
  meta,
  delay = '0s',
  still,
}: {
  className: string
  icon: string
  title: string
  meta: string
  delay?: string
  still: boolean
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute z-10 hidden items-center gap-3 rounded-xl border border-amber-50/12 bg-navy-900/70 px-4 py-3 backdrop-blur-md sm:flex ${className}`}
      style={still ? undefined : { animation: `collabify-bob 6s ease-in-out ${delay} infinite` }}
    >
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-400/15 text-[15px] text-amber-300">
        {icon}
      </span>
      <span>
        <strong className="block text-[13px] font-semibold text-amber-50">{title}</strong>
        <span className="mt-0.5 block font-mono text-[9.5px] tracking-[0.14em] text-amber-50/45 uppercase">
          {meta}
        </span>
      </span>
    </div>
  )
}

export function Hero() {
  const reduce = useReducedMotion()
  const still = !!reduce

  // The board reads the pointer through this and nothing else crosses the
  // boundary. A memo rather than a ref, because reading `.current` during
  // render is what React's rules forbid.
  const handle = useMemo<BoardHandle>(
    () => ({ pointer: { current: { x: 0, y: 0, active: false } } }),
    [],
  )

  return (
    <section id="intro" className="relative overflow-hidden bg-navy-950 pt-24 pb-0">
      <Glow corner="left" />
      <BlueprintField />

      <Shell className="relative">
        <div className="grid items-center gap-8 lg:grid-cols-12">
          {/* ------------------------------------------------------- copy */}
          <div className="lg:col-span-5">
            <Rise>
              <p className="flex items-center gap-3">
                <span className="h-px w-7 bg-amber-400" />
                <span className="font-mono text-[10.5px] tracking-[0.22em] text-amber-200/80 uppercase">
                  Dr. Yanga's Colleges · BSIT
                </span>
              </p>
            </Rise>

            <Rise delay={0.06}>
              <h1 className="mt-7 font-display text-[clamp(44px,6.6vw,78px)] leading-[0.98] font-bold tracking-[-0.045em] text-amber-50">
                Where BSIT
                <br />
                programs
                <br />
                {/* The underlined word is the zip's one flourish, kept because
                    it lands on the word the sentence turns on. The stroke draws
                    itself once; under reduced motion it is simply already
                    drawn. */}
                <span className="relative inline-block">
                  <span className="text-amber-400">run the term.</span>
                  <svg
                    aria-hidden
                    viewBox="0 0 300 14"
                    preserveAspectRatio="none"
                    className="absolute -bottom-1.5 left-0 h-3 w-full overflow-visible"
                    fill="none"
                  >
                    <path
                      d="M3 9c58-7 176-8 294-3"
                      className="stroke-amber-400"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray="320"
                      strokeDashoffset={still ? 0 : 320}
                      style={
                        still
                          ? undefined
                          : { animation: 'collabify-draw 1.4s .5s var(--ease-out-soft) forwards' }
                      }
                    />
                  </svg>
                </span>
              </h1>
            </Rise>

            <Rise delay={0.14}>
              <p className="mt-9 max-w-[46ch] text-[16px] leading-[1.8] text-amber-50/60">
                Projects, boards and deadlines for classes at Dr. Yanga's Colleges. Six steps, each
                blocked by the one before it.
              </p>
            </Rise>

            <Rise delay={0.2}>
              <div className="mt-9 flex flex-wrap items-center gap-4">
                <Link
                  to="/register"
                  className="group inline-flex items-center gap-4 rounded-xl bg-amber-400 px-6 py-4 text-[15px] font-semibold text-navy-950 transition-[background-color,transform,box-shadow] duration-200 hover:bg-amber-300 hover:shadow-[0_10px_30px_-8px_rgb(240_180_41_/_0.5)] active:scale-[0.98]"
                >
                  Create your account
                  <span className="transition-transform duration-200 group-hover:translate-x-1">
                    →
                  </span>
                </Link>
                <a
                  href="#how"
                  className="inline-flex items-center gap-3 text-[14px] font-semibold text-amber-50/80 transition-colors duration-200 hover:text-amber-50"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-full border border-amber-50/25 text-[12px]">
                    ▶
                  </span>
                  See how it works
                </a>
              </div>
            </Rise>

            <Rise delay={0.26}>
              <p className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10.5px] tracking-[0.14em] text-amber-50/40 uppercase">
                <span>Google sign-in</span>
                <span aria-hidden>·</span>
                <span>Professors approved by the program</span>
                <span aria-hidden>·</span>
                <span>A class is private to the people in it</span>
              </p>
            </Rise>
          </div>

          {/* ------------------------------------------------------ visual */}
          <div className="relative lg:col-span-7">
            <OrbitField still={still} />

            <FloatingLabel
              className="top-6 left-2 rotate-[-3deg] lg:left-8"
              icon="◧"
              title="Project Milestone 2"
              meta="QM · Week 5"
              still={still}
            />
            <FloatingLabel
              className="right-2 bottom-16 rotate-[2deg] lg:right-6"
              icon="✓"
              title="4 of 11 done"
              meta="Group 1"
              delay="-3s"
              still={still}
            />

            <div className="relative">
              <Suspense fallback={<div className="aspect-[16/11] w-full" />}>
                <BoardExperience handle={handle} />
              </Suspense>
            </div>
          </div>
        </div>

        {/* The ruled status bar along the bottom of the hero, from the zip. */}
        <Rise delay={0.32}>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-amber-50/12 py-7">
            <p className="max-w-[52ch] text-[13px] leading-relaxed text-amber-50/45">
              <strong className="font-semibold text-amber-50/80">
                The syllabus is the measure.
              </strong>{' '}
              Its weeks become what every deadline after it is counted against.
            </p>
            <div className="flex items-center gap-7 font-mono text-[10.5px] tracking-[0.16em] text-amber-50/40 uppercase">
              <span>6 steps</span>
              <span>3 roles</span>
              <span>1 board per group</span>
            </div>
          </div>
        </Rise>
      </Shell>

      <div className="relative flex items-center justify-center gap-3 pb-9">
        <span className="h-px w-8 bg-amber-50/20" />
        <span className="font-mono text-[10px] tracking-[0.26em] text-amber-50/40 uppercase">
          Scroll to continue
        </span>
        <span className="h-px w-8 bg-amber-50/20" />
      </div>
    </section>
  )
}
