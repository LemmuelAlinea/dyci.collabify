import { Reveal } from '../motion/Reveal'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'kanban',
    title: 'Sprint boards',
    body: 'Move work across backlog, in progress, and review. Every card carries one owner and one due date, so nothing sits unclaimed.',
  },
  {
    icon: 'target',
    title: 'Defense milestones',
    body: 'Title defense through final defense on a single timeline, with an adviser sign-off gate at each stage.',
  },
  {
    icon: 'users',
    title: 'Adviser visibility',
    body: 'Professors see where every group stands without chasing anyone for a status update the night before consultation.',
  },
  {
    icon: 'file',
    title: 'Chapters and versions',
    body: 'Manuscripts, ERDs, and build drops live in one place. Every re-upload keeps the version before it.',
  },
  {
    icon: 'chart',
    title: 'Contribution log',
    body: 'A running record of who moved what and when — so a group grade can reflect the work actually done.',
  },
  {
    icon: 'bell',
    title: 'Deadline reminders',
    body: 'Email nudges land before a milestone slips, not in the post-mortem after it already did.',
  },
]

export function Features() {
  return (
    <section id="features" className="relative scroll-mt-24 py-24 md:py-32">
      <div className="shell">
        <Reveal className="mx-auto max-w-[680px] text-center">
          <p className="eyebrow text-amber-500 dark:text-amber-300">
            Everything a capstone needs
          </p>
          <h2 className="mt-4 text-[clamp(2rem,4.4vw,3.1rem)] leading-[1.05]">
            Built around how BSIT projects actually run
          </h2>
          <p className="mt-5 text-[17px] leading-relaxed text-muted">
            Not a generic task list. The workflow follows the semester — proposal, sprints,
            review, defense.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
          {FEATURES.map((f, i) => (
            <Reveal
              key={f.title}
              as="article"
              delay={(i % 3) * 0.08}
              className="group surface rounded-card border border-line p-6 shadow-card transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-1 hover:border-line-strong hover:shadow-lift md:p-7"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-navy-600 text-amber-400 transition-transform duration-300 group-hover:scale-105 dark:bg-navy-500">
                <Icon name={f.icon} size={22} />
              </span>
              <h3 className="mt-5 text-[19px]">{f.title}</h3>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">{f.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
