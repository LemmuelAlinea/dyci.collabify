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
    body: 'The syllabus and the term dates go in, and its weeks become what everything after this is measured against.',
  },
  {
    n: '02',
    icon: 'users',
    title: 'Groups the class actually has',
    body: 'Sets are built by hand, or opened for students to form their own up to a size limit.',
  },
  {
    n: '03',
    icon: 'kanban',
    title: 'A project bound to weeks',
    body: 'A project names the weeks it covers, carries the brief, and gives every group a board of its own.',
  },
  {
    n: '04',
    icon: 'check',
    title: 'Work that has an owner',
    body: 'Students claim tasks off the board, up to a fair share of it, so nobody can end up holding all of it.',
  },
  {
    n: '05',
    icon: 'refresh',
    title: 'Work that can change hands',
    body: 'When somebody goes quiet a groupmate asks for the task, with a reason, and the professor rules on it.',
  },
  {
    n: '06',
    icon: 'upload',
    title: 'Handing in, and an answer',
    body: 'Handing in freezes the board. The professor accepts it, or returns it with a reason.',
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
      className="surface-sunken blueprint-ink blueprint relative scroll-mt-24 overflow-hidden border-y border-line py-20 md:py-24"
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

          <ol ref={list} className="relative space-y-2.5 md:pl-0">
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
                      className="absolute top-6 left-[9px] hidden h-3.5 w-3.5 rounded-full border-2 border-amber-400 md:block"
                    />
                    <div
                      className={`surface group rounded-card border p-4 sm:p-5 shadow-card transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:shadow-lift ${
                        on ? 'border-amber-400/60' : 'border-line'
                      }`}
                    >
                      <div className="flex items-start gap-3.5">
                        <motion.span
                          animate={{ scale: on ? 1.06 : 1 }}
                          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-navy-600 text-amber-400 transition-transform duration-300 group-hover:rotate-3 dark:bg-navy-500"
                        >
                          <Icon name={s.icon} size={17} />
                        </motion.span>
                        <div className="min-w-0">
                          {/* The number sits beside the title rather than above
                              it. On its own line it cost a whole line of height
                              in each of six cards to say two characters. */}
                          <div className="flex items-baseline gap-2.5">
                            <span
                              className={`shrink-0 font-mono text-[11.5px] tracking-widest transition-colors duration-300 ${
                                on ? 'text-amber-600 dark:text-amber-300' : 'text-faint'
                              }`}
                            >
                              {s.n}
                            </span>
                            <h3 className="text-[18px] leading-snug">{s.title}</h3>
                          </div>
                          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
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
