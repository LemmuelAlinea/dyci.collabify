import { motion, useReducedMotion } from 'motion/react'
import { Icon } from '../ui/Icon'

type Card = { title: string; meta: string; tint?: 'amber' | 'plain' }

const COLUMNS: { name: string; count: string; cards: Card[] }[] = [
  {
    name: 'Backlog',
    count: '4',
    cards: [
      { title: 'Chapter 4 — results', meta: 'Due Sep 2' },
      { title: 'Usability test, 10 users', meta: 'Unassigned' },
    ],
  },
  {
    name: 'In progress',
    count: '3',
    cards: [
      { title: 'Auth + role guard', meta: 'Rhea · today', tint: 'amber' },
      { title: 'ERD + data dictionary', meta: 'Miguel · Fri' },
    ],
  },
  {
    name: 'For review',
    count: '2',
    cards: [{ title: 'System proposal', meta: 'Adviser review' }],
  },
]

const MILESTONES = [
  { label: 'Title defense', done: true },
  { label: 'Proposal', done: true },
  { label: 'Sprint 3', done: false, current: true },
  { label: 'Final defense', done: false },
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
            IT Capstone 2 · Group 4
          </p>
          <p className="eyebrow mt-1 text-white/45">Sprint 3 · 6 days left</p>
        </div>
        <div className="flex -space-x-2">
          {['RM', 'MC', 'JD'].map((i, n) => (
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
                      : 'border-white/10 bg-white/8'
                  }`}
                >
                  <p className="text-[12px] leading-snug font-medium text-white">{c.title}</p>
                  <p className="mt-1.5 truncate text-[10.5px] text-white/45">{c.meta}</p>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </motion.div>

      {/* Milestone spine — the through-line from title defense to final defense. */}
      <div className="mt-4 rounded-2xl bg-navy-950/28 px-3.5 py-3.5">
        <div className="relative flex items-start justify-between">
          <div aria-hidden className="absolute top-[7px] right-2 left-2 h-px bg-white/12" />
          <motion.div
            aria-hidden
            className="absolute top-[7px] left-2 h-px bg-amber-400"
            initial={reduce ? undefined : { width: 0 }}
            animate={reduce ? undefined : { width: 'calc(66% - 8px)' }}
            transition={{ duration: 1.1, delay: 1.15, ease: [0.22, 1, 0.36, 1] }}
          />
          {MILESTONES.map((m) => (
            <div key={m.label} className="relative flex min-w-0 flex-1 flex-col items-center">
              <span
                className={`grid h-3.5 w-3.5 place-items-center rounded-full ring-4 ring-navy-800 ${
                  m.done
                    ? 'bg-amber-400'
                    : m.current
                      ? 'bg-amber-400/30 outline-2 outline-amber-400'
                      : 'bg-white/25'
                }`}
              >
                {m.done && <Icon name="check" size={9} className="text-navy-900" strokeWidth={3.5} />}
              </span>
              <span
                className={`mt-2 truncate px-0.5 text-center text-[10px] ${
                  m.current ? 'font-semibold text-amber-400' : 'text-white/45'
                }`}
              >
                {m.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
