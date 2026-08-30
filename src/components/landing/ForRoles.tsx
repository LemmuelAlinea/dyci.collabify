import { Reveal } from '../motion/Reveal'
import { DrawnCheck, Spotlight } from './Anim'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'

/**
 * Three roles, and only what each one can really do.
 *
 * The old copy gave students version history, professors a milestone sign-off,
 * and the admin a roster of advisers. None of that exists. What is here is what
 * each rail actually opens.
 */
const ROLES: { icon: IconName; role: string; line: string; points: string[] }[] = [
  {
    icon: 'user',
    role: 'Students',
    line: 'Know what you hold and when it is due.',
    points: [
      'Claim work off your group board, up to a fair share of it',
      'One list of everything you owe, soonest first',
      'Hand in when the group is done, and read the answer',
      'Print your own record of what you did',
    ],
  },
  {
    icon: 'users',
    role: 'Professors',
    line: 'Run the term without chasing anybody.',
    points: [
      'Set projects against syllabus weeks, released when you choose',
      'See why a group is behind, not only that it is',
      'Rule on work that needs to change hands',
      'Accept a hand-in, or return it with a reason',
    ],
  },
  {
    icon: 'shield',
    role: 'Program chair',
    line: 'Keep the program in order, and stay out of the classes.',
    points: [
      'Approve professor accounts before they get a class',
      'Keep the sections and publish the syllabus once for all of them',
      'See which classes are not ready to run this term',
      'Counts only — never a task, a comment or a student’s work',
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
            <Reveal key={r.role} as="div" delay={i * 0.09}>
              <Spotlight className="surface group flex h-full flex-col rounded-card border border-line p-4 sm:p-5 sm:p-7 shadow-card transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-lift md:p-8">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-400/15 text-amber-600 transition-transform duration-300 group-hover:scale-105 dark:text-amber-300">
                  <Icon name={r.icon} size={21} />
                </span>
                <h3 className="mt-5 text-[22px]">{r.role}</h3>
                <p className="mt-2 text-[15px] text-muted">{r.line}</p>
                <ul className="mt-6 space-y-3 border-t border-line pt-6">
                  {r.points.map((p, n) => (
                    <li
                      key={p}
                      className="flex gap-2.5 text-[14.5px] leading-relaxed text-muted"
                    >
                      {/* Drawn rather than faded: the point of the mark is that
                          somebody can do the thing beside it, and a stroke being
                          made is closer to that than a shape appearing. */}
                      <span className="mt-1 text-amber-500 dark:text-amber-300">
                        <DrawnCheck delay={i * 0.09 + n * 0.09} />
                      </span>
                      {p}
                    </li>
                  ))}
                </ul>
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
