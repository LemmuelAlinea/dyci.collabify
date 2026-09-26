import { LayoutGroup, motion } from 'motion/react'
import { Icon } from '../ui/Icon'
import { useLoop } from './useLoop'

/**
 * The board, playing the thing the page claims.
 *
 * The headline says the work is shared and nobody writes over anybody. This is
 * that sentence as a mechanism: a task is picked up, the person's share of the
 * work goes up, their file is **held for review** because they cannot write to
 * the main copy, the work is finished, the change waits on its reviewer, and it
 * is applied with the history keeping it. Six beats, on a loop, and every one
 * of them is a rule that really exists in the database.
 *
 * A still screenshot could show any of those states. It could not show the
 * review gate, which is the only part somebody would not otherwise believe.
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
      title: 'Clean the responses',
      meta: finished
        ? 'Bianca · finished today'
        : claimed
          ? 'Bianca · started just now'
          : 'Unassigned · due Fri',
      col: finished ? 'done' : claimed ? 'doing' : 'todo',
      tone: claimed && !finished ? 'amber' : 'plain',
    },
    { id: 'summary', title: 'Write the summary', meta: 'Unassigned', col: 'todo' },
    {
      id: 'collect',
      title: 'Collect the survey data',
      meta: 'Ann · started Mon',
      col: 'doing',
    },
    { id: 'erd', title: 'Cost the materials', meta: 'Miguel · started Tue', col: 'doing' },
    { id: 'model', title: 'Draft chapter two', meta: 'Ann · finished Aug 19', col: 'done' },
    {
      id: 'statement',
      title: 'Problem statement',
      meta: 'Finished late',
      col: 'done',
      tone: 'late',
    },
  ]
}

/** Share of the work each member holds, the figure a report's contribution table is built from. */
function shareAt(step: number) {
  const up = step >= 1
  return [
    { name: 'Ann', pct: up ? 36 : 42 },
    { name: 'Bianca', pct: up ? 38 : 25 },
    { name: 'Miguel', pct: up ? 26 : 25 },
  ]
}

const CAPTIONS = [
  'Two tasks on the board that nobody has picked up.',
  'Bianca picks one up. Her share of the work goes up with it.',
  'Her file cannot go straight to the main copy — it goes for review first.',
  'Finished, and the board says who finished it.',
  'The change waits on its reviewer.',
  'Applied, and the history keeps it. Declined would have sent it back with a note.',
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
        A project board. A task moves from "To do" to "In progress" when somebody picks it
        up, their share of the work rises, a file has to go through review instead of
        straight to the main copy, the task is finished, the change waits on its reviewer,
        and it is applied and kept in the history.
      </figcaption>

      <div
        aria-hidden
        className="relative rounded-[26px] border border-white/14 bg-white/7 p-3.5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:p-5"
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between gap-3 px-1">
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] font-semibold text-white">
              Feasibility study · Marketing team
            </p>
            <p className="eyebrow mt-1 text-white/45">Due in 6 days</p>
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

        {/* The board. Dimmed rather than hidden once the change is in review:
            attention belongs on the strip below, and the board stays readable. */}
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

                        {/* The review gate, drawn on the card it applies to. */}
                        {refused && c.id === 'summary' && (
                          <motion.p
                            initial={reduce ? false : { opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            transition={{ duration: 0.32 }}
                            className="mt-2 flex items-center gap-1 overflow-hidden text-[10px] leading-tight font-medium text-amber-200"
                          >
                            <Icon name="lock" size={11} className="shrink-0" />
                            Her draft goes through review
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

        {/* Share of the work. The bar is what a report's contribution table
            counts, so it moves when somebody picks work up and not otherwise. */}
        <div className="mt-4 rounded-2xl bg-navy-950/28 px-3.5 py-3.5">
          <div className="flex items-center justify-between">
            <span className="eyebrow text-white/55">Share of the work</span>
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

        {/* In review, then applied. One strip that changes what it says rather
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
                    {verdict ? 'Applied' : 'In review · waiting on the reviewer'}
                  </p>
                  <p className="truncate text-[10.5px] text-white/50">
                    {verdict
                      ? 'The history keeps who changed what'
                      : 'The main copy does not change until it is applied'}
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
