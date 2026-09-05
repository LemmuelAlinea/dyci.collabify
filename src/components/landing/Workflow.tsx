import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { BlueprintField, Glow, Kicker, Shell } from './parts'

/**
 * The sticky workflow, and the best idea in the supplied design.
 *
 * A tall section holds a sticky panel: the six steps on the left, a mock board
 * on the right. Scroll advances the step, the copy under it opens, and a card
 * moves across the mock board's columns. It shows the product working rather
 * than describing it, in the space one screen would otherwise spend on a
 * paragraph.
 *
 * Reworked from the original in two ways. The step is derived from scroll
 * position rather than driven by a scroll handler that writes classes, so
 * there is one source of truth. And under reduced motion the whole thing
 * un-sticks into a plain list — the original kept its sticky pin and only
 * disabled the transitions, which leaves somebody scrolling a tall section
 * whose content does not change.
 */

const STEPS = [
  {
    n: '01',
    title: 'A class, with its syllabus',
    body: 'The syllabus and term dates go in. Its weeks become the measure for everything after.',
  },
  {
    n: '02',
    title: 'Groups the class has',
    body: 'Built by hand, or opened for students to form their own up to a size limit.',
  },
  {
    n: '03',
    title: 'A project bound to weeks',
    body: 'It names the weeks it covers, carries the brief, and gives every group a board.',
  },
  {
    n: '04',
    title: 'Work that has an owner',
    body: 'Students claim tasks off the board, up to a fair share, so nobody holds all of it.',
  },
  {
    n: '05',
    title: 'Work that changes hands',
    body: 'Somebody goes quiet, a groupmate asks with a reason, and the professor rules on it.',
  },
  {
    n: '06',
    title: 'Handing in, and an answer',
    body: 'Handing in freezes the board. The professor accepts it, or sends it back with a note.',
  },
]

/** Where the moving card sits, per step: column index and row offset. */
const CARD_POSITION = [
  { col: 0, y: 0 },
  { col: 0, y: 1 },
  { col: 1, y: 0 },
  { col: 1, y: 1 },
  { col: 2, y: 0 },
  { col: 2, y: 1 },
]

export function Workflow() {
  const reduce = useReducedMotion()
  const wrap = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (reduce) return
    const onScroll = () => {
      const node = wrap.current
      if (!node) return
      const { top, height } = node.getBoundingClientRect()
      // How far through the tall wrapper the sticky panel has travelled.
      const travelled = -top
      const travel = height - window.innerHeight
      const p = travel > 0 ? Math.min(1, Math.max(0, travelled / travel)) : 0
      setStep(Math.min(STEPS.length - 1, Math.floor(p * STEPS.length)))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [reduce])

  const pos = CARD_POSITION[step]

  return (
    <section id="how" className="relative bg-white text-amber-50">
      {/* Reduced motion collapses the tall wrapper, so the section becomes an
          ordinary block instead of a long scroll that changes nothing. */}
      <div ref={wrap} className={reduce ? '' : 'h-[230vh]'}>
        <div
          className={
            reduce
              ? 'relative overflow-hidden bg-navy-950 py-24'
              : 'sticky top-0 flex min-h-[100svh] items-center overflow-hidden bg-navy-950 py-8 sm:py-10'
          }
        >
          <BlueprintField />
          <Glow corner="right" />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-amber-50/10"
          />
          <Shell className="relative">
            <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
              {/* ---------------------------------------------------- steps */}
              <div className="lg:col-span-5">
                <div className="rounded-[26px] border border-amber-50/10 bg-white/[0.035] p-5 backdrop-blur-sm sm:p-7">
                  <div className="flex items-center justify-between gap-4">
                    <Kicker>How it runs</Kicker>
                    <span className="rounded-full border border-amber-50/12 bg-white/[0.05] px-3 py-1.5 font-mono text-[10px] tracking-[0.16em] text-amber-200/65 uppercase">
                      {String(step + 1).padStart(2, '0')} / 06
                    </span>
                  </div>
                  <h2 className="mt-5 font-display text-[clamp(25px,3.8vw,40px)] leading-[1.1] font-bold tracking-[-0.035em] text-amber-50">
                    A term, from the
                    <br />
                    <span className="text-amber-300">syllabus to the answer.</span>
                  </h2>

                  <ol className="mt-6 space-y-1">
                  {STEPS.map((s, i) => {
                    const active = reduce || i === step
                    return (
                      <li
                        key={s.n}
                        // Only the live step is shown on a phone. All six plus
                        // a board does not fit one screen, and the board going
                        // off the bottom costs more than the list does — the
                        // moving card is the thing this section exists to show.
                        className={`rounded-xl border px-3 py-2.5 transition-[background-color,border-color,color] duration-500 ${
                          active
                            ? 'border-amber-50/12 bg-white/[0.07] text-amber-50'
                            : 'hidden border-transparent text-amber-50/38 lg:block'
                        }`}
                      >
                        <div className="flex gap-3.5">
                          <span
                            className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg font-mono text-[10px] transition-colors duration-500 ${
                              active
                                ? 'bg-amber-400 font-bold text-navy-950'
                                : 'bg-white/[0.04] text-amber-50/28'
                            }`}
                          >
                            {s.n}
                          </span>
                          <div className="min-w-0">
                            <h3 className="font-display text-[16px] font-semibold tracking-[-0.015em]">
                              {s.title}
                            </h3>
                            {/* Height is animated rather than display toggled,
                                so the list does not jump as the step changes. */}
                            <div
                              className="grid transition-[grid-template-rows,opacity] duration-500"
                              style={{
                                gridTemplateRows: active ? '1fr' : '0fr',
                                opacity: active ? 1 : 0,
                              }}
                            >
                              <p className="overflow-hidden text-[13px] leading-relaxed text-amber-50/55">
                                <span className="block pt-2">{s.body}</span>
                              </p>
                            </div>
                          </div>
                        </div>
                      </li>
                    )
                    })}
                  </ol>

                  {!reduce && (
                    <div aria-hidden className="mt-4 flex gap-1.5">
                      {STEPS.map((s, i) => (
                        <span
                          key={s.n}
                          className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
                            i <= step ? 'bg-amber-400' : 'bg-amber-50/12'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ----------------------------------------------- mock board */}
              <div className="lg:col-span-7">
                <div
                  className="relative rounded-[28px] border border-amber-50/10 bg-white/[0.045] p-2.5 shadow-[0_34px_100px_-24px_rgb(0_0_0_/_0.85)] sm:p-3"
                  style={
                    reduce
                      ? undefined
                      : { transform: 'perspective(1600px) rotateY(-5deg) rotateX(2deg)' }
                  }
                >
                  <div className="mb-2.5 flex items-center justify-between px-2 py-1 font-mono text-[9px] tracking-[0.18em] text-amber-50/45 uppercase">
                    <span>Group 1 · Project Milestone 2</span>
                    <span>Live example</span>
                  </div>

                  <div className="overflow-hidden rounded-[20px] bg-white text-navy-900">
                    <div className="flex h-14 items-center gap-3 bg-navy-900 px-5 text-amber-50">
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-400 font-display text-[12px] font-bold text-navy-950">
                        C
                      </span>
                      <span className="font-display text-[15px] font-bold tracking-tight">Collabify</span>
                      <span className="ml-auto rounded-full border border-amber-50/12 bg-white/[0.06] px-2.5 py-1 font-mono text-[8px] tracking-[0.18em] text-amber-50/65 uppercase">
                        Project board
                      </span>
                    </div>

                  <div className="relative grid grid-cols-3 gap-2.5 bg-[#eef2f8] p-4">
                    {['To do', 'Doing', 'Done'].map((col, ci) => (
                      <div
                        key={col}
                        className={`rounded-xl p-2 ${
                          ci === 0
                            ? 'bg-white/75'
                            : ci === 1
                              ? 'bg-amber-50/85'
                              : 'bg-emerald-50/75'
                        }`}
                      >
                        <div className="mb-3 flex items-center justify-between px-1">
                          <span className="text-[11px] font-semibold text-navy-800">{col}</span>
                          <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-navy-900/8 font-mono text-[9px] text-navy-500">
                            {ci === 2 ? 4 : 3}
                          </span>
                        </div>
                        <div className="space-y-2.5">
                          {[0, 1].map((r) => (
                            <div
                              key={r}
                              className="rounded-lg border border-navy-900/8 bg-white p-2.5 shadow-[0_5px_14px_-12px_rgb(23_37_83_/_0.7)]"
                            >
                              <span className="inline-block rounded bg-navy-100 px-1.5 py-0.5 font-mono text-[7.5px] tracking-wide text-navy-600 uppercase">
                                {['Research', 'Model', 'Write'][(ci + r) % 3]}
                              </span>
                              <p className="mt-2 text-[10.5px] leading-snug font-semibold">
                                {
                                  [
                                    'Collect input data',
                                    'Fit the distributions',
                                    'Draft chapter two',
                                    'Run the simulation',
                                    'Check the results',
                                    'Write the summary',
                                  ][(ci * 2 + r) % 6]
                                }
                              </p>
                              <div className="mt-3 flex items-center justify-between">
                                <span className="grid h-5 w-5 place-items-center rounded-full bg-navy-100 font-mono text-[7px] text-navy-600">
                                  {['MS', 'AB', 'JR'][(ci + r) % 3]}
                                </span>
                                <span className="font-mono text-[7.5px] text-navy-400">
                                  W{5 + ci}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    {/* The card that moves. Absolute over the columns so it can
                        travel between them without disturbing their layout. */}
                    <div
                      aria-hidden
                      className="absolute rounded-lg border border-amber-300 bg-amber-300 p-2.5 text-navy-950 shadow-[0_12px_30px_-8px_rgb(240_180_41_/_0.7)]"
                      style={{
                        width: 'calc((100% - 2rem - 1.25rem) / 3)',
                        left: `calc(1rem + (100% - 2rem - 1.25rem) / 3 * ${pos.col} + 0.625rem * ${pos.col})`,
                        top: `calc(4.25rem + ${pos.y} * 6.25rem)`,
                        transition: reduce
                          ? 'none'
                          : 'left .85s var(--ease-out-soft), top .85s var(--ease-out-soft)',
                      }}
                    >
                      <span className="inline-block rounded bg-navy-950 px-1.5 py-0.5 font-mono text-[7.5px] tracking-wide text-amber-200 uppercase">
                        Yours
                      </span>
                      <p className="mt-2 text-[10.5px] leading-snug font-semibold">
                        Summarize with descriptive statistics
                      </p>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-navy-950 font-mono text-[7px] text-amber-200">
                          LA
                        </span>
                        <span className="font-mono text-[7.5px] text-navy-400">W5</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 bg-navy-900 px-5 py-3.5 text-amber-50">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-amber-400 text-[10px] text-navy-950">
                      ●
                    </span>
                    <span className="text-[11px] text-amber-50/65">
                      {
                        [
                          'The class and its syllabus are in.',
                          'Groups are set for the term.',
                          'A project covers weeks 4 to 8.',
                          'The task has an owner.',
                          'A reassignment is waiting on the professor.',
                          'Handed in. The board is frozen.',
                        ][step]
                      }
                    </span>
                  </div>
                  </div>
                </div>
              </div>
            </div>
          </Shell>
        </div>
      </div>
    </section>
  )
}
