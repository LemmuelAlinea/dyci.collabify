import { motion, useReducedMotion } from 'motion/react'
import { Icon } from '../ui/Icon'

/**
 * The board, as it really looks.
 *
 * The columns are the three task states the product has, the meta lines are the
 * things a card really carries — who holds it, when it is due, whether it went
 * in late — and the strip underneath is the share of the board each member
 * holds, which is the figure the whole fair-share rule exists to keep honest.
 *
 * It used to show a defense-milestone timeline. There are no milestones, so
 * there is no timeline.
 */
type Card = { title: string; meta: string; tint?: 'amber' | 'late' | 'plain' }

const COLUMNS: { name: string; count: string; cards: Card[] }[] = [
  {
    name: 'To do',
    count: '4',
    cards: [
      { title: 'Fit the input distribution', meta: 'Unclaimed · due Fri' },
      { title: 'Write the summary', meta: 'Unclaimed' },
    ],
  },
  {
    name: 'In progress',
    count: '2',
    cards: [
      { title: 'Collect the input data', meta: 'Bianca · started Mon', tint: 'amber' },
      { title: 'Build the ERD', meta: 'Miguel · started Tue' },
    ],
  },
  {
    name: 'Done',
    count: '5',
    cards: [
      { title: 'Conceptual model', meta: 'Ann · finished Aug 19' },
      { title: 'Problem statement', meta: 'Handed in late', tint: 'late' },
    ],
  },
]

/** Held share of the board, the way task_member_progress computes it. */
const SHARE = [
  { name: 'Ann', pct: 42 },
  { name: 'Bianca', pct: 33 },
  { name: 'Miguel', pct: 25 },
]

export function BoardPreview() {
  const reduce = useReducedMotion()

  const container = reduce
    ? {}
    : {
        initial: 'hidden' as const,
        animate: 'show' as const,
        variants: {
          hidden: {},
          show: { transition: { staggerChildren: 0.075, delayChildren: 0.55 } },
        },
      }

  const item = reduce
    ? {}
    : {
        variants: {
          hidden: { opacity: 0, y: 14, scale: 0.97 },
          show: {
            opacity: 1,
            y: 0,
            scale: 1,
            transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] as const },
          },
        },
      }

  return (
    <div className="relative rounded-[26px] border border-white/14 bg-white/7 p-3.5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:p-5">
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
              style={{ background: ['#F0B429', '#F7C74A', '#FBD982'][n] }}
            >
              {i}
            </span>
          ))}
        </div>
      </div>

      <motion.div {...container} className="grid grid-cols-3 gap-2 sm:gap-3">
        {COLUMNS.map((col) => (
          <div key={col.name} className="min-w-0 rounded-2xl bg-navy-950/28 p-2 sm:p-2.5">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="eyebrow truncate text-white/55">{col.name}</span>
              <span className="text-[11px] font-semibold text-white/35">{col.count}</span>
            </div>
            <div className="space-y-2">
              {col.cards.map((c) => (
                <motion.div
                  key={c.title}
                  {...item}
                  className={`rounded-xl border p-2.5 ${
                    c.tint === 'amber'
                      ? 'border-amber-400/45 bg-amber-400/12'
                      : c.tint === 'late'
                        ? 'border-red-400/40 bg-red-400/10'
                        : 'border-white/10 bg-white/8'
                  }`}
                >
                  <p className="text-[12px] leading-snug font-medium text-white">{c.title}</p>
                  <p
                    className={`mt-1.5 truncate text-[10.5px] ${
                      c.tint === 'late' ? 'text-red-200/80' : 'text-white/45'
                    }`}
                  >
                    {c.meta}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </motion.div>

      {/* Who is carrying it. The bar is the share of the board's weight each
          member holds — the number the claim limit is enforced against. */}
      <div className="mt-4 rounded-2xl bg-navy-950/28 px-3.5 py-3.5">
        <div className="flex items-center justify-between">
          <span className="eyebrow text-white/55">Share of the board</span>
          <span className="flex items-center gap-1.5 text-[10.5px] text-white/45">
            <Icon name="users" size={12} />3 members
          </span>
        </div>

        <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-white/10">
          {SHARE.map((s, n) => (
            <motion.span
              key={s.name}
              className="block h-full"
              style={{ background: ['#F0B429', '#F7C74A', '#FBD982'][n] }}
              initial={reduce ? undefined : { width: 0 }}
              animate={reduce ? undefined : { width: `${s.pct}%` }}
              transition={{ duration: 0.9, delay: 1.05 + n * 0.12, ease: [0.22, 1, 0.36, 1] }}
            />
          ))}
        </div>

        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
          {SHARE.map((s, n) => (
            <li key={s.name} className="flex items-center gap-1.5 text-[10.5px] text-white/50">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: ['#F0B429', '#F7C74A', '#FBD982'][n] }}
              />
              {s.name}
              <span className="font-mono text-white/35">{s.pct}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
