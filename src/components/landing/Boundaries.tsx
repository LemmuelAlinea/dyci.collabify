import { Reveal } from '../motion/Reveal'
import { Marquee, Parallax } from '../motion/Parallax'
import { Icon } from '../ui/Icon'

/**
 * What Collabify deliberately does not do.
 *
 * Unusual on a landing page and the most useful section on this one. Each of
 * these was decided rather than deferred, and saying so is what stops somebody
 * signing up expecting a grade book, a file drive, or an email that never
 * arrives.
 */
const NOT: { title: string; body: string }[] = [
  {
    title: 'It holds no grades',
    body: 'Not a mark anywhere, on purpose. A second grade record beside the school’s is the one nobody trusts. Every figure here is effort and completion, and every printed sheet says so at the bottom.',
  },
  {
    title: 'It is not a file drive',
    body: 'Files attach to the task they are evidence for and stop there. Students and professors already have somewhere to keep documents, and a second home only competes with it.',
  },
  {
    title: 'It is not the registrar',
    body: 'No enrolment, no tuition, no rooms and no timetable. A class here is a place work happens, not the record that the class exists.',
  },
]

const WORDS = [
  'claimed',
  'in progress',
  'handed in',
  'accepted',
  'returned',
  'late',
  'unclaimed',
  'share of the board',
  'week 7',
  'reassigned',
]

export function Boundaries() {
  return (
    <section className="relative overflow-hidden py-24 md:py-32">
      <Parallax
        distance={70}
        className="pointer-events-none absolute -top-10 -left-40 -z-10"
      >
        <div
          aria-hidden
          className="h-[520px] w-[520px] rounded-full opacity-[0.09] blur-3xl"
          style={{ background: 'radial-gradient(circle, #F0B429 0%, transparent 65%)' }}
        />
      </Parallax>

      <div className="shell">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <Reveal>
            <p className="eyebrow text-amber-500 dark:text-amber-300">Where it stops</p>
            <h2 className="mt-4 text-[clamp(2rem,4.4vw,3.1rem)] leading-[1.05]">
              The three things it will not do
            </h2>
            <p className="mt-5 max-w-[440px] text-[17px] leading-relaxed text-muted">
              Each of these was tried, argued about, and decided. A tool that says what it is
              not is easier to trust with what it is.
            </p>
          </Reveal>

          <ul className="space-y-3">
            {NOT.map((n, i) => (
              <Reveal
                key={n.title}
                as="li"
                delay={i * 0.08}
                className="surface flex gap-4 rounded-card border border-line p-4 sm:p-6 shadow-card md:p-7"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full surface-sunken text-muted">
                  <Icon name="x" size={17} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[19px] leading-snug">{n.title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{n.body}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-20">
        <Marquee words={WORDS} />
      </div>
    </section>
  )
}
