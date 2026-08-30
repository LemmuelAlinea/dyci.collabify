import { useRef } from 'react'
import { motion } from 'motion/react'
import { Reveal } from '../motion/Reveal'
import { ScrollLine } from '../motion/Parallax'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { useActiveIndex } from './useLoop'

/**
 * The shape of the product, in the order it happens.
 *
 * This replaces the old "three steps to get started", which described a
 * capstone workflow the app does not have — advisers, proposals, defense
 * milestones. What follows is the real spine: a class holds groups, a project
 * hangs off syllabus weeks, work is claimed off a board, the group hands in,
 * and the professor answers. Nothing here is aspirational; every step is a
 * screen somebody uses.
 */
const STEPS: { n: string; icon: IconName; title: string; body: string }[] = [
  {
    n: '01',
    icon: 'folder',
    title: 'A class, with its syllabus in it',
    body: 'A professor opens the class, sets the term dates, and attaches the syllabus. Its weeks become the calendar everything else is measured against — including which weeks still have nothing set for them.',
  },
  {
    n: '02',
    icon: 'users',
    title: 'Groups the class actually has',
    body: 'Group sets are built by hand or opened for students to join, with a size limit. Individual work skips this: everyone gets their own board instead.',
  },
  {
    n: '03',
    icon: 'kanban',
    title: 'A project bound to weeks',
    body: 'Every project names the syllabus weeks it covers, carries a brief and its criteria, and can be scheduled to appear later. Each group gets a board of its own the moment it is released.',
  },
  {
    n: '04',
    icon: 'check',
    title: 'Work that has an owner',
    body: 'Students claim tasks off their board — up to a fair share of it, so one person cannot take everything on paper and nothing in practice. Starting one freezes its wording; finishing it after the deadline stamps it late rather than blocking it.',
  },
  {
    n: '05',
    icon: 'refresh',
    title: 'Work that can change hands',
    body: 'When somebody goes quiet, a groupmate asks for the task — to take it on or to put it back — with a reason. The professor rules on it. Nobody is stuck holding work that is not moving.',
  },
  {
    n: '06',
    icon: 'upload',
    title: 'Handing in, and an answer',
    body: 'A group hands in when they say they are done, which freezes the board. The professor accepts it, or returns it with a reason — and returning it gives the work straight back to them.',
  },
]

export function Flow() {
  const list = useRef<HTMLOListElement>(null)
  // The line already shows how far through the section you are. This says
  // which step that is — which matters here because the steps are a chain,
  // not a menu: nothing in step 4 can happen until step 3 has.
  const { setItem, active } = useActiveIndex(STEPS.length)

  return (
    <section
      id="how"
      className="surface-sunken blueprint-ink blueprint relative scroll-mt-24 overflow-hidden border-y border-line py-24 md:py-32"
    >
      <div className="shell relative">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
          <Reveal className="lg:sticky lg:top-28 lg:self-start">
            <p className="eyebrow text-amber-500 dark:text-amber-300">How the work moves</p>
            <h2 className="mt-4 text-[clamp(2rem,4.4vw,3.1rem)] leading-[1.05]">
              A term, from the syllabus to the answer
            </h2>
            <p className="mt-5 max-w-[440px] text-[17px] leading-relaxed text-muted">
              Six steps, each one blocked by the one before it. This is the whole product —
              there is nothing else behind the sign-in.
            </p>
          </Reveal>

          <ol ref={list} className="relative space-y-3 md:pl-0">
            <ScrollLine target={list} />
            {STEPS.map((s, i) => {
              const on = i === active
              return (
                <Reveal key={s.n} as="li" delay={(i % 3) * 0.06}>
                  <div ref={setItem(i)} className="relative md:pl-12">
                    {/* The node on the line — hollow until you reach its step,
                        then filled. Same amber as the line's filled part, so
                        the two read as one object rather than two effects. */}
                    <motion.span
                      aria-hidden
                      animate={{
                        scale: on ? 1.25 : 1,
                        backgroundColor: on ? '#F0B429' : 'var(--page)',
                      }}
                      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                      className="absolute top-7 left-[9px] hidden h-3.5 w-3.5 rounded-full border-2 border-amber-400 md:block"
                    />
                    <div
                      className={`surface group rounded-card border p-4 sm:p-6 shadow-card transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:shadow-lift md:p-7 ${
                        on ? 'border-amber-400/60' : 'border-line'
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <motion.span
                          animate={{ scale: on ? 1.06 : 1 }}
                          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy-600 text-amber-400 transition-transform duration-300 group-hover:rotate-3 dark:bg-navy-500"
                        >
                          <Icon name={s.icon} size={19} />
                        </motion.span>
                        <div className="min-w-0">
                          <p
                            className={`font-mono text-[12px] tracking-widest transition-colors duration-300 ${
                              on ? 'text-amber-600 dark:text-amber-300' : 'text-faint'
                            }`}
                          >
                            {s.n}
                          </p>
                          <h3 className="mt-1 text-[20px] leading-snug">{s.title}</h3>
                          <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">
                            {s.body}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </Reveal>
              )
            })}
          </ol>
        </div>
      </div>
    </section>
  )
}
