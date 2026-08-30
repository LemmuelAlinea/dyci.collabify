import { Reveal } from '../motion/Reveal'
import { Parallax } from '../motion/Parallax'
import { Spotlight } from './Anim'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

/**
 * What is actually behind the sign-in.
 *
 * The previous version of this page sold defense milestones, chapter version
 * history and email reminders. None of the three exist: milestones were decided
 * against, the file drive was built and removed, and no mail is sent. Every
 * card below is a screen that ships.
 */
const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'calendar',
    title: 'Projects hang off the syllabus',
    body: 'A project names the weeks it covers, so a class can be asked the one question that matters: is the syllabus being taught within the term, or are there weeks with nothing set against them.',
  },
  {
    icon: 'kanban',
    title: 'Boards with a fair share',
    body: 'Tasks carry a weight, an owner and a date. Nobody can claim more than their share of a board, so the split is real rather than something argued about at the end.',
  },
  {
    icon: 'clock',
    title: 'Deadlines that record, not block',
    body: 'Work finished after its date is stamped late and still counts. A professor closes a project when they mean to close it — a date passing is not the same as the work being over.',
  },
  {
    icon: 'refresh',
    title: 'Work can change hands',
    body: 'A task nobody is moving can be asked for, with a reason, and the professor rules on it. The reason reaches them and its author, and no one else.',
  },
  {
    icon: 'chart',
    title: 'Analytics that show their working',
    body: 'What happened, why it is behind, what is coming, and what to do about it. Every forward figure is a division printed beside its own answer — no model, no score.',
  },
  {
    icon: 'file',
    title: 'Reports you can hand in',
    body: 'Print a class term report for the chair, a contribution report behind an individual mark, or a syllabus coverage sheet for the course file. Students get their own copy of what they did.',
  },
]

export function Features() {
  return (
    <section id="features" className="relative scroll-mt-24 py-24 md:py-32">
      {/* A slab of colour that drifts against the scroll, so the section has a
          floor without another border. */}
      <Parallax
        distance={40}
        className="pointer-events-none absolute inset-x-0 top-24 -z-10 flex justify-center"
      >
        <div
          aria-hidden
          className="h-[420px] w-[min(900px,92vw)] rounded-full opacity-[0.07] blur-3xl"
          style={{ background: 'radial-gradient(circle, #26327A 0%, transparent 68%)' }}
        />
      </Parallax>

      <div className="shell">
        <Reveal className="mx-auto max-w-[700px] text-center">
          <p className="eyebrow text-amber-500 dark:text-amber-300">What is inside</p>
          <h2 className="mt-4 text-[clamp(2rem,4.4vw,3.1rem)] leading-[1.05]">
            Six things, and it does all six
          </h2>
          <p className="mt-5 text-[17px] leading-relaxed text-muted">
            Coursework for a BSIT program — activities, laboratories, a research or capstone
            project, whatever the syllabus asks for. Not a generic task list, and not a
            promise of one.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} as="div" delay={(i % 3) * 0.08}>
              <Spotlight className="group surface h-full rounded-card border border-line p-4 sm:p-6 shadow-card transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-lift md:p-7">
                {/* The tile turns amber under the pointer and the mark inside it
                    leans — one gesture per card, not a different trick each. */}
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-navy-600 text-amber-400 transition-[transform,background-color] duration-300 group-hover:scale-105 group-hover:bg-amber-400 group-hover:text-navy-800 dark:bg-navy-500">
                  <Icon
                    name={f.icon}
                    size={22}
                    className="transition-transform duration-500 group-hover:-rotate-6"
                  />
                </span>
                <h3 className="mt-5 text-[19px] leading-snug">{f.title}</h3>
                <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">{f.body}</p>
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
