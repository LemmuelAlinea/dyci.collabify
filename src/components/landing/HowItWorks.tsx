import { Reveal } from '../motion/Reveal'

/** A real sequence — each step is blocked by the one before it, so the numbering carries information. */
const STEPS = [
  {
    n: '01',
    title: 'Create your account',
    body: 'Sign up with email or continue with Google. Students are in immediately; professor accounts are verified by the program admin before they get adviser access.',
  },
  {
    n: '02',
    title: 'Set up the project',
    body: 'Name the group, invite your members, pick an adviser, and lay the milestones down the semester — from title defense to final defense.',
  },
  {
    n: '03',
    title: 'Work the board',
    body: 'Assign tasks, move cards as they progress, attach chapters and builds. Your adviser follows along without a single status email.',
  },
]

export function HowItWorks() {
  return (
    <section
      id="how"
      className="surface-sunken blueprint-ink blueprint relative scroll-mt-24 overflow-hidden border-y border-line py-24 md:py-32"
    >
      <div className="shell relative">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
          <Reveal className="lg:sticky lg:top-28 lg:self-start">
            <p className="eyebrow text-amber-500 dark:text-amber-300">Getting started</p>
            <h2 className="mt-4 text-[clamp(2rem,4.4vw,3.1rem)] leading-[1.05]">
              Three steps to a semester you can see
            </h2>
            <p className="mt-5 max-w-[440px] text-[17px] leading-relaxed text-muted">
              Setup takes one sitting. After that the board is the single place your group and
              your adviser both look.
            </p>
          </Reveal>

          <ol className="space-y-3">
            {STEPS.map((s, i) => (
              <Reveal
                key={s.n}
                as="li"
                delay={i * 0.09}
                className="surface rounded-card border border-line p-6 shadow-card md:p-8"
              >
                <div className="flex gap-5 md:gap-7">
                  <span className="font-mono text-[15px] font-bold text-amber-500 tabular-nums dark:text-amber-300">
                    {s.n}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[21px]">{s.title}</h3>
                    <p className="mt-2.5 text-[15px] leading-relaxed text-muted">{s.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
