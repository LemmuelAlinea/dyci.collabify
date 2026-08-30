import { LayoutGroup, motion } from 'motion/react'
import { Icon } from '../ui/Icon'
import { useLoop } from './useLoop'

/**
 * The board, playing the thing the page claims.
 *
 * The headline says nobody carries the work alone. This is that sentence as a
 * mechanism: a task is claimed, the person's share of the board goes up, the
 * next claim is **refused** because they are at their share, the work is
 * finished, the group hands in and the board freezes, and the professor
 * answers. Six beats, on a loop, and every one of them is a rule that really
 * exists in the database.
 *
 * A still screenshot could show any of those states. It could not show the
 * refusal, which is the only part somebody would not otherwise believe.
 *
 * The travel between columns is Motion's shared-layout animation — a card is
 * one element that changes parent, not two elements cross-fading — which is
 * why it reads as the card moving rather than a slide changing.
 */

type Col = 'todo' | 'doing' | 'done'
type Tone = 'plain' | 'amber' | 'late'

type Card = {
  id: string
  title: string
  meta: string
  col: Col
  tone?: Tone
}

/** The one card that travels, plus the board around it that does not. */
function boardAt(step: number): Card[] {
  const claimed = step >= 1
  const finished = step >= 3

  return [
    {
      id: 'distribution',
      title: 'Fit the input distribution',
      meta: finished
        ? 'Bianca · finished today'
        : claimed
          ? 'Bianca · started just now'
          : 'Unclaimed · due Fri',
      col: finished ? 'done' : claimed ? 'doing' : 'todo',
      tone: claimed && !finished ? 'amber' : 'plain',
    },
    { id: 'summary', title: 'Write the summary', meta: 'Unclaimed', col: 'todo' },
    {
      id: 'collect',
      title: 'Collect the input data',
      meta: 'Ann · started Mon',
      col: 'doing',
    },
    { id: 'erd', title: 'Build the ERD', meta: 'Miguel · started Tue', col: 'doing' },
    { id: 'model', title: 'Conceptual model', meta: 'Ann · finished Aug 19', col: 'done' },
    {
      id: 'statement',
      title: 'Problem statement',
      meta: 'Handed in late',
      col: 'done',
      tone: 'late',
    },
  ]
}

/** Share of the board each member holds — what the claim limit is checked against. */
function shareAt(step: number) {
  const up = step >= 1
  return [
    { name: 'Ann', pct: up ? 36 : 42 },
    { name: 'Bianca', pct: up ? 38 : 25 },
    { name: 'Miguel', pct: up ? 26 : 25 },
  ]
}

const CAPTIONS = [
  'Two tasks on the board that nobody has taken.',
  'Bianca claims one. Her share of the board goes up with it.',
  'She cannot take the next one — she is at her share. That is the whole point.',
  'Finished, and the board says who finished it.',
  'The group hands in, and the board freezes.',
  'The professor answers. Returned would have handed it straight back.',
]

const COLUMNS: { key: Col; name: string }[] = [
  { key: 'todo', name: 'To do' },
  { key: 'doing', name: 'In progress' },
  { key: 'done', name: 'Done' },
]

const AVATAR = ['#F0B429', '#F7C74A', '#FBD982']

export function BoardPreview() {
  const { ref, step, reduce } = useLoop(CAPTIONS.length)

  const cards = boardAt(step)
  const share = shareAt(step)
  const refused = step === 2
  const frozen = step >= 4
  const verdict = step >= 5

  const spring = reduce
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 260, damping: 30, mass: 0.7 }

  return (
    <figure ref={ref} className="relative m-0">
      <figcaption className="sr-only">
        A group's project board. A task moves from "To do" to "In progress" when a student
        claims it, their share of the board rises, a second claim is refused because they
        are at their share, the task is finished, the group hands in and the board freezes,
        and the professor accepts it.
      </figcaption>

      <div
        aria-hidden
        className="relative rounded-[26px] border border-white/14 bg-white/7 p-3.5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:p-5"
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between gap-3 px-1">
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] font-semibold text-white">
              Project Milestone 2 · Group 1
            </p>
            <p className="eyebrow mt-1 text-white/45">Weeks 5–6 · due in 6 days</p>
          </div>
          <div className="flex -space-x-2">
            {['AD', 'BD', 'MS'].map((i, n) => (
              <span
                key={i}
                className="grid h-8 w-8 place-items-center rounded-full border-2 border-navy-700 text-[11px] font-semibold text-navy-900"
                style={{ background: AVATAR[n] }}
              >
                {i}
              </span>
            ))}
          </div>
        </div>

        {/* The board. Dimmed rather than hidden once it freezes: a frozen board
            is still readable, which is what "frozen" means here. */}
        <motion.div
          animate={{ opacity: frozen ? 0.55 : 1 }}
          transition={{ duration: reduce ? 0 : 0.5 }}
          className="grid grid-cols-3 gap-2 sm:gap-3"
        >
          <LayoutGroup id="board">
            {COLUMNS.map((col) => {
              const here = cards.filter((c) => c.col === col.key)
              return (
                <div
                  key={col.key}
                  className="min-w-0 rounded-2xl bg-navy-950/28 p-2 sm:p-2.5"
                >
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="eyebrow truncate text-white/55">{col.name}</span>
                    <motion.span
                      key={here.length}
                      initial={reduce ? undefined : { opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-[11px] font-semibold text-white/35"
                    >
                      {here.length}
                    </motion.span>
                  </div>

                  <div className="space-y-2">
                    {here.map((c) => (
                      <motion.div
                        key={c.id}
                        layoutId={c.id}
                        layout
                        transition={spring}
                        className={`rounded-xl border p-2.5 ${
                          c.tone === 'amber'
                            ? 'border-amber-400/45 bg-amber-400/12'
                            : c.tone === 'late'
                              ? 'border-red-400/40 bg-red-400/10'
                              : 'border-white/10 bg-white/8'
                        }`}
                      >
                        <motion.p
                          layout="position"
                          className="text-[12px] leading-snug font-medium text-white"
                        >
                          {c.title}
                        </motion.p>
                        <p
                          className={`mt-1.5 truncate text-[10.5px] ${
                            c.tone === 'late' ? 'text-red-200/80' : 'text-white/45'
                          }`}
                        >
                          {c.meta}
                        </p>

                        {/* The refusal, drawn on the card it was tried on. */}
                        {refused && c.id === 'summary' && (
                          <motion.p
                            initial={reduce ? false : { opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            transition={{ duration: 0.32 }}
                            className="mt-2 flex items-center gap-1 overflow-hidden text-[10px] leading-tight font-medium text-amber-200"
                          >
                            <Icon name="lock" size={11} className="shrink-0" />
                            Bianca is at her share
                          </motion.p>
                        )}
                      </motion.div>
                    ))}
                  </div>
                </div>
              )
            })}
          </LayoutGroup>
        </motion.div>

        {/* Share of the board. The bar is the figure the claim limit is
            enforced against, so it moves when a claim lands and not otherwise. */}
        <div className="mt-4 rounded-2xl bg-navy-950/28 px-3.5 py-3.5">
          <div className="flex items-center justify-between">
            <span className="eyebrow text-white/55">Share of the board</span>
            <span className="flex items-center gap-1.5 text-[10.5px] text-white/45">
              <Icon name="users" size={12} />3 members
            </span>
          </div>

          <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-white/10">
            {share.map((s, n) => (
              <motion.span
                key={s.name}
                className="block h-full"
                style={{ background: AVATAR[n] }}
                animate={{ width: `${s.pct}%` }}
                transition={
                  reduce ? { duration: 0 } : { duration: 0.7, ease: [0.22, 1, 0.36, 1] }
                }
              />
            ))}
          </div>

          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {share.map((s, n) => (
              <li
                key={s.name}
                className="flex items-center gap-1.5 text-[10.5px] text-white/50"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: AVATAR[n] }}
                />
                {s.name}
                <span className="font-mono text-white/35">{s.pct}%</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Handed in, then answered. One strip that changes what it says rather
            than two that stack, because the board only ever has one of them. */}
        {frozen && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            transition={{ duration: reduce ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
              <div
                className={`mt-3 flex items-center gap-2.5 rounded-2xl border px-3.5 py-3 ${
                  verdict
                    ? 'border-emerald-400/40 bg-emerald-400/12'
                    : 'border-white/14 bg-white/8'
                }`}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                    verdict ? 'bg-emerald-400/22 text-emerald-200' : 'bg-white/12 text-white/70'
                  }`}
                >
                  <Icon name={verdict ? 'checkCircle' : 'lock'} size={15} />
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-white">
                    {verdict ? 'Accepted' : 'Handed in · board frozen'}
                  </p>
                  <p className="truncate text-[10.5px] text-white/50">
                    {verdict
                      ? 'Answered by Prof. Alinea'
                      : 'Nobody can change a task until it is answered'}
                  </p>
                </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* What is happening, in the product's own words. Sits outside the panel
          so it reads as narration rather than another element of the UI. */}
      <div aria-hidden className="relative mt-4 h-9 px-1">
        <motion.p
          // Keyed so each caption is a fresh element that animates in. There is
          // deliberately no exit animation anywhere in this component: an exit
          // has to *finish* before its element is removed, and anything that
          // stops it finishing — a throttled tab, a browser that is not
          // compositing — leaves the stale one on screen for good. Presence is
          // React's to decide here, not an animation's.
          key={step}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-x-1 top-0 text-[12.5px] leading-snug text-white/55"
        >
          <span className="font-mono text-amber-400/80">
            {String(step + 1).padStart(2, '0')}
          </span>{' '}
          {CAPTIONS[step]}
        </motion.p>
      </div>
    </figure>
  )
}
