import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Kicker, Rise, Shell, Statement } from './parts'

/**
 * Features, then the role switcher.
 *
 * Both are the zip's, on the paper-white ground that gives the page its
 * rhythm — the hero and workflow either side of these are near-black, and the
 * alternation is what stops five sections of dark reading as one long one.
 *
 * The switcher is tabs rather than three stacked panels because the three
 * roles answer the same question and only one answer applies to any reader.
 */

const FEATURES = [
  {
    n: '01',
    title: 'A home for every project',
    body: 'A project names the weeks it covers, carries the brief, and gives every group a board of its own.',
    demo: (
      <div className="mt-6 flex min-h-[84px] items-center gap-3 rounded-xl border border-navy-900/10 bg-navy-50/40 p-4">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy-100 font-mono text-[12px] font-bold text-navy-600">
          PM
        </span>
        <span className="min-w-0">
          <strong className="block text-[13px] font-semibold">Project Milestone 2</strong>
          <span className="font-mono text-[10px] tracking-[0.12em] text-navy-500 uppercase">
            QM · weeks 4–8
          </span>
        </span>
        <span className="ml-auto font-mono text-[11px] text-navy-500">3 groups</span>
      </div>
    ),
  },
  {
    n: '02',
    title: 'Keep everyone in the loop',
    body: 'Announcements, group chat and files sit inside the class, so nothing important lives in somebody else’s inbox.',
    demo: (
      <div className="mt-6 flex min-h-[84px] items-center gap-3 rounded-xl border border-navy-900/10 bg-navy-50/40 p-4">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-400/25 font-mono text-[10px] font-bold text-amber-700">
          MS
        </span>
        <span className="min-w-0">
          <strong className="block text-[13px] font-semibold">Maria posted an update</strong>
          <span className="font-mono text-[10px] tracking-[0.12em] text-navy-500 uppercase">
            Group 1 · 2 hours ago
          </span>
        </span>
      </div>
    ),
  },
  {
    n: '03',
    title: 'See the whole picture',
    body: 'A professor sees what has stopped moving and what is waiting on a decision, across every class at once.',
    demo: (
      <div className="mt-6 min-h-[84px] rounded-xl border border-navy-900/10 bg-navy-50/40 p-4">
        <span className="font-mono text-[10px] tracking-[0.12em] text-navy-500 uppercase">
          4 of 11 tasks done
        </span>
        <span className="mt-3 flex gap-1">
          {Array.from({ length: 11 }, (_, i) => (
            <span
              key={i}
              className={`h-2 flex-1 rounded-sm ${i < 4 ? 'bg-amber-400' : 'bg-navy-900/10'}`}
            />
          ))}
        </span>
      </div>
    ),
  },
]

const ROLES = {
  Students: {
    symbol: 'S',
    headline: 'Know what is on you, and when.',
    body: 'Claim work off the board up to a fair share, log the time it took, and hand in when the group is ready.',
    points: [
      'Your tasks and deadlines in one place',
      'Ask a groupmate to take something over',
      'A class is private to the people in it',
    ],
  },
  Professors: {
    symbol: 'P',
    headline: 'See what has stopped moving.',
    body: 'The dashboard surfaces groups that have gone quiet and decisions waiting on you, before a deadline turns them into a problem.',
    points: [
      'Groups that have stalled, ranked',
      'Rule on reassignments with the reason attached',
      'Accept a submission, or send it back with a note',
    ],
  },
  Admins: {
    symbol: 'A',
    headline: 'Hold the program together.',
    body: 'Approve professors before they can open a class, and keep the curriculum and section registry the rest of the product measures against.',
    points: [
      'Approve or hold a professor account',
      'Curriculum and section registry',
      'An audit trail of who changed what',
    ],
  },
} as const

type RoleName = keyof typeof ROLES

export function Features() {
  return (
    <section id="workspace" className="bg-white py-24 text-navy-900 sm:py-32">
      <Shell>
        <Statement
          tone="light"
          kicker="Inside a class"
          headline={
            <>
              Many moving parts.
              <br />
              One place they live.
            </>
          }
          body="Groups, projects, boards, deadlines and the syllabus they are measured against — all of it inside the class it belongs to."
        />

        <div className="mt-16 grid gap-9 sm:mt-20 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Rise key={f.n} delay={0.06 * i}>
              <div className="border-t border-navy-900/12 pt-6">
                <span className="font-mono text-[10.5px] tracking-[0.18em] text-navy-500 uppercase">
                  {f.n}
                </span>
                <h3 className="mt-7 font-display text-[21px] font-bold tracking-[-0.02em]">
                  {f.title}
                </h3>
                <p className="mt-3.5 text-[14.5px] leading-[1.75] text-navy-600/75">{f.body}</p>
                {f.demo}
              </div>
            </Rise>
          ))}
        </div>
      </Shell>
    </section>
  )
}

export function Roles() {
  const [role, setRole] = useState<RoleName>('Students')
  const active = ROLES[role]

  return (
    <section id="roles" className="bg-white pb-24 text-navy-900 sm:pb-32">
      <Shell>
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <Kicker tone="light">For roles</Kicker>
            <h2 className="mt-6 font-display text-[clamp(30px,4.4vw,50px)] leading-[1.08] font-bold tracking-[-0.04em]">
              Everyone sees
              <br />
              their own half.
            </h2>
            <p className="mt-6 max-w-[42ch] text-[15.5px] leading-[1.8] text-navy-600/75">
              The same term, read three ways. Pick the one that is yours.
            </p>

            <div
              role="tablist"
              aria-label="Choose a role"
              className="mt-8 inline-flex rounded-xl bg-navy-900/6 p-1.5"
            >
              {(Object.keys(ROLES) as RoleName[]).map((name) => (
                <button
                  key={name}
                  role="tab"
                  aria-selected={role === name}
                  onClick={() => setRole(name)}
                  className={`rounded-lg px-4 py-2.5 text-[13.5px] font-semibold transition-[background-color,color,transform] duration-(--dur-press) active:scale-[0.97] ${
                    role === name
                      ? 'bg-navy-900 text-white'
                      : 'text-navy-600 hover:text-navy-900'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="relative overflow-hidden rounded-2xl border border-navy-900/10 bg-navy-50/50 p-9 sm:p-12">
              <span
                aria-hidden
                className="absolute -top-3 right-7 font-display text-[130px] leading-none font-bold text-navy-900/6"
              >
                {active.symbol}
              </span>

              {/* Keyed on the role so the panel re-enters when the tab changes,
                  rather than swapping its text in place. */}
              <div key={role} className="relative">
                <Rise>
                  <Kicker tone="light">{role}</Kicker>
                  <h3 className="mt-6 max-w-[20ch] font-display text-[clamp(22px,2.6vw,30px)] leading-[1.2] font-bold tracking-[-0.025em]">
                    {active.headline}
                  </h3>
                  <p className="mt-5 max-w-[46ch] text-[14.5px] leading-[1.8] text-navy-600/75">
                    {active.body}
                  </p>
                  <ul className="mt-7 space-y-3">
                    {active.points.map((p) => (
                      <li key={p} className="flex gap-3 text-[14px] text-navy-700">
                        <span aria-hidden className="text-amber-500">
                          ✓
                        </span>
                        {p}
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/register"
                    className="mt-8 inline-flex items-center gap-2.5 text-[13.5px] font-semibold text-navy-900 transition-colors duration-200 hover:text-amber-600"
                  >
                    Create your account
                    <span aria-hidden>→</span>
                  </Link>
                </Rise>
              </div>
            </div>
          </div>
        </div>
      </Shell>
    </section>
  )
}
