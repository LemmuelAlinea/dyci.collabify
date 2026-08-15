import { Reveal } from '../motion/Reveal'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

const ROLES: { icon: IconName; role: string; line: string; points: string[] }[] = [
  {
    icon: 'user',
    role: 'Students',
    line: 'Know what you owe and when it is due.',
    points: [
      'Your tasks, sorted by what is due next',
      'Upload chapters and builds without losing a version',
      'A contribution log that shows your share of the work',
    ],
  },
  {
    icon: 'users',
    role: 'Professors',
    line: 'Advise more groups without losing the thread.',
    points: [
      'Every advisee group on one progress view',
      'Sign off on milestones and leave comments in place',
      'Spot a stalled group in the week it stalls',
    ],
  },
  {
    icon: 'shield',
    role: 'Program admin',
    line: 'Keep the roster and the semester in order.',
    points: [
      'Verify professor accounts before they get access',
      'Manage sections, advisers, and group assignments',
      'See completion across the whole cohort',
    ],
  },
]

export function ForRoles() {
  return (
    <section id="roles" className="scroll-mt-24 py-24 md:py-32">
      <div className="shell">
        <Reveal className="mx-auto max-w-[680px] text-center">
          <p className="eyebrow text-amber-500 dark:text-amber-300">One workspace, three views</p>
          <h2 className="mt-4 text-[clamp(2rem,4.4vw,3.1rem)] leading-[1.05]">
            Everyone sees the part they own
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-3 lg:gap-5">
          {ROLES.map((r, i) => (
            <Reveal
              key={r.role}
              as="article"
              delay={i * 0.09}
              className="surface flex flex-col rounded-card border border-line p-7 shadow-card md:p-8"
            >
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-400/15 text-amber-600 dark:text-amber-300">
                <Icon name={r.icon} size={21} />
              </span>
              <h3 className="mt-5 text-[22px]">{r.role}</h3>
              <p className="mt-2 text-[15px] text-muted">{r.line}</p>
              <ul className="mt-6 space-y-3 border-t border-line pt-6">
                {r.points.map((p) => (
                  <li key={p} className="flex gap-2.5 text-[14.5px] leading-relaxed text-muted">
                    <Icon
                      name="check"
                      size={16}
                      className="mt-1 shrink-0 text-amber-500 dark:text-amber-300"
                      strokeWidth={2.4}
                    />
                    {p}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
