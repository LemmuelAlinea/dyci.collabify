import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BlueprintField, Kicker, Rise, Shell, Statement } from './parts'

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
      <div className="mt-6 flex min-h-[84px] items-center gap-3 rounded-xl border border-amber-50/12 bg-white/7 p-4">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-400 font-mono text-[12px] font-bold text-navy-950">
          PM
        </span>
        <span className="min-w-0">
          <strong className="block text-[13px] font-semibold">Project Milestone 2</strong>
          <span className="font-mono text-[10px] tracking-[0.12em] text-amber-50/55 uppercase">
            QM · weeks 4–8
          </span>
        </span>
        <span className="ml-auto font-mono text-[11px] text-amber-50/55">3 groups</span>
      </div>
    ),
  },
  {
    n: '02',
    title: 'Keep everyone in the loop',
    body: 'Announcements, group chat and files sit inside the class, so nothing important lives in somebody else’s inbox.',
    demo: (
      <div className="mt-6 flex min-h-[84px] items-center gap-3 rounded-xl bg-navy-950 p-4 text-amber-50">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-amber-400 font-mono text-[10px] font-bold text-navy-950">
          MS
        </span>
        <span className="min-w-0">
          <strong className="block text-[13px] font-semibold">Maria posted an update</strong>
          <span className="font-mono text-[10px] tracking-[0.12em] text-amber-50/55 uppercase">
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
      <div className="mt-6 min-h-[84px] rounded-xl border border-navy-900/10 bg-white p-4">
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
    number: '01',
    label: 'Own the work',
    headline: 'Know what is on you, and when.',
    body: 'Claim work off the board up to a fair share, log the time it took, and hand in when the group is ready.',
    points: [
      'Your tasks and deadlines in one place',
      'Ask a groupmate to take something over',
      'A class is private to the people in it',
    ],
    signals: [
      { value: '1 place', label: 'Tasks + deadlines' },
      { value: 'Fair share', label: 'Claim limit' },
      { value: 'Private', label: 'Class access' },
    ],
  },
  Professors: {
    symbol: 'P',
    number: '02',
    label: 'See the signal',
    headline: 'See what has stopped moving.',
    body: 'The dashboard surfaces groups that have gone quiet and decisions waiting on you, before a deadline turns them into a problem.',
    points: [
      'Groups that have stalled, ranked',
      'Rule on reassignments with the reason attached',
      'Accept a submission, or send it back with a note',
    ],
    signals: [
      { value: 'Early', label: 'Stalled groups' },
      { value: 'In context', label: 'Decisions' },
      { value: 'One view', label: 'Every class' },
    ],
  },
  Admins: {
    symbol: 'A',
    number: '03',
    label: 'Keep the rules',
    headline: 'Hold the program together.',
    body: 'Approve professors before they can open a class, and keep the curriculum and section registry the rest of the product measures against.',
    points: [
      'Approve or hold a professor account',
      'Curriculum and section registry',
      'An audit trail of who changed what',
    ],
    signals: [
      { value: 'Approved', label: 'Professor access' },
      { value: 'Canonical', label: 'Curriculum' },
      { value: 'Recorded', label: 'Every change' },
    ],
  },
} as const

type RoleName = keyof typeof ROLES

export function Features() {
  return (
    <section
      id="workspace"
      className="relative overflow-hidden bg-[#eef2f8] py-24 text-navy-900 sm:py-32"
    >
      <BlueprintField tone="light" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-56 -right-52 h-[620px] w-[620px] rounded-full bg-amber-300/25 blur-[140px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-72 -left-56 h-[600px] w-[600px] rounded-full bg-navy-200/45 blur-[150px]"
      />

      <Shell className="relative">
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

        <div className="mt-16 grid gap-4 sm:mt-20 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Rise key={f.n} delay={0.06 * i} className="h-full">
              <article
                className={`relative flex h-full min-h-[340px] flex-col overflow-hidden rounded-2xl border p-6 sm:p-7 ${
                  i === 0
                    ? 'border-navy-950 bg-navy-950 text-amber-50'
                    : i === 1
                      ? 'border-amber-400 bg-amber-400 text-navy-950'
                      : 'border-navy-900/10 bg-white/90 text-navy-900'
                }`}
              >
                <span
                  aria-hidden
                  className={`absolute -top-6 right-2 font-display text-[110px] leading-none font-bold ${
                    i === 0
                      ? 'text-amber-50/5'
                      : i === 1
                        ? 'text-navy-950/7'
                        : 'text-navy-950/5'
                  }`}
                >
                  {f.n}
                </span>
                <span className={`relative font-mono text-[10.5px] tracking-[0.18em] uppercase ${
                  i === 0 ? 'text-amber-300' : i === 1 ? 'text-navy-800/65' : 'text-navy-500'
                }`}>
                  {f.n}
                </span>
                <h3 className="relative mt-7 font-display text-[21px] font-bold tracking-[-0.02em]">
                  {f.title}
                </h3>
                <p className={`relative mt-3.5 text-[14.5px] leading-[1.75] ${
                  i === 0 ? 'text-amber-50/62' : i === 1 ? 'text-navy-900/72' : 'text-navy-600/75'
                }`}>
                  {f.body}
                </p>
                <div className="relative mt-auto">{f.demo}</div>
              </article>
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
    <section
      id="roles"
      className="relative overflow-hidden bg-[#eef2f8] py-24 text-navy-900 sm:py-32"
    >
      <BlueprintField tone="light" />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-56 -bottom-64 h-[620px] w-[620px] rounded-full bg-amber-300/25 blur-[150px]"
      />

      <Shell className="relative">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <Rise>
              <Kicker tone="light">For roles</Kicker>
              <h2 className="mt-6 max-w-[760px] font-display text-[clamp(34px,5.4vw,64px)] leading-[1.02] font-bold tracking-[-0.04em]">
                One term.
                <br />
                <span className="text-navy-500">Three clear points of view.</span>
              </h2>
            </Rise>
          </div>
          <div className="lg:col-span-4 lg:col-start-9">
            <Rise delay={0.08}>
              <p className="max-w-[45ch] text-[15.5px] leading-[1.8] text-navy-600/75">
                The same work, shaped around the decisions each person needs to make next.
              </p>
            </Rise>
          </div>
        </div>

        <Rise delay={0.12} className="mt-12 sm:mt-16">
          <div className="overflow-hidden rounded-[28px] border border-navy-950/10 bg-navy-950 shadow-[0_34px_90px_-42px_rgb(8_11_33_/_0.75)]">
            <div className="grid lg:grid-cols-[0.8fr_1.5fr]">
              <div className="border-b border-amber-50/10 p-4 sm:p-6 lg:border-r lg:border-b-0 lg:p-7">
                <div className="flex items-center justify-between px-2 pb-4">
                  <span className="font-mono text-[9.5px] tracking-[0.2em] text-amber-50/42 uppercase">
                    Choose your view
                  </span>
                  <span className="font-mono text-[9.5px] tracking-[0.16em] text-amber-300/70 uppercase">
                    {active.number} / 03
                  </span>
                </div>

                <div
                  role="tablist"
                  aria-label="Choose a role"
                  className="grid grid-cols-3 gap-2 lg:grid-cols-1"
                >
                  {(Object.keys(ROLES) as RoleName[]).map((name) => {
                    const item = ROLES[name]
                    const selected = role === name
                    return (
                      <button
                        key={name}
                        role="tab"
                        aria-selected={selected}
                        onClick={() => setRole(name)}
                        className={`group rounded-2xl border p-3 text-left transition-[background-color,border-color,color,transform] duration-300 active:scale-[0.98] sm:p-4 lg:p-5 ${
                          selected
                            ? 'border-amber-300 bg-amber-300 text-navy-950'
                            : 'border-amber-50/10 bg-white/[0.035] text-amber-50 hover:border-amber-50/22 hover:bg-white/[0.06]'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span
                            className={`font-mono text-[9px] tracking-[0.16em] uppercase ${
                              selected ? 'text-navy-700/65' : 'text-amber-50/38'
                            }`}
                          >
                            {item.number}
                          </span>
                          <span
                            aria-hidden
                            className={`grid h-6 w-6 place-items-center rounded-full text-[11px] transition-transform duration-300 ${
                              selected
                                ? 'translate-x-0 bg-navy-950 text-amber-200'
                                : '-translate-x-1 bg-white/[0.06] text-amber-50/42 group-hover:translate-x-0'
                            }`}
                          >
                            →
                          </span>
                        </span>
                        <strong className="mt-4 block font-display text-[14px] font-semibold sm:text-[16px]">
                          {name}
                        </strong>
                        <span
                          className={`mt-1 hidden text-[11.5px] lg:block ${
                            selected ? 'text-navy-800/68' : 'text-amber-50/42'
                          }`}
                        >
                          {item.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="relative min-h-[520px] overflow-hidden bg-[#f8f7f2] p-6 sm:p-9 lg:p-12">
                <div
                  aria-hidden
                  className="absolute inset-0 opacity-70"
                  style={{
                    backgroundImage:
                      'linear-gradient(rgb(23 37 83 / 0.045) 1px, transparent 1px), linear-gradient(90deg, rgb(23 37 83 / 0.045) 1px, transparent 1px)',
                    backgroundSize: '42px 42px',
                    maskImage: 'linear-gradient(120deg, transparent 8%, #000 74%)',
                    WebkitMaskImage: 'linear-gradient(120deg, transparent 8%, #000 74%)',
                  }}
                />
                <span
                  aria-hidden
                  className="absolute -right-2 -bottom-16 font-display text-[clamp(180px,27vw,330px)] leading-none font-bold text-navy-950/[0.035]"
                >
                  {active.symbol}
                </span>

                <div key={role} className="relative flex min-h-[448px] flex-col">
                  <Rise>
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-950 font-display text-[16px] font-bold text-amber-300">
                        {active.symbol}
                      </span>
                      <span className="font-mono text-[10px] tracking-[0.2em] text-navy-500 uppercase">
                        {role} · {active.label}
                      </span>
                    </div>

                    <h3 className="mt-7 max-w-[17ch] font-display text-[clamp(28px,4vw,46px)] leading-[1.08] font-bold tracking-[-0.035em]">
                      {active.headline}
                    </h3>
                    <p className="mt-5 max-w-[54ch] text-[14.5px] leading-[1.8] text-navy-600/75">
                      {active.body}
                    </p>

                    <div className="mt-8 grid gap-2.5 sm:grid-cols-3">
                      {active.signals.map((signal) => (
                        <div
                          key={signal.label}
                          className="rounded-xl border border-navy-950/8 bg-white/75 p-4 backdrop-blur-sm"
                        >
                          <strong className="block font-display text-[15px] font-semibold text-navy-900">
                            {signal.value}
                          </strong>
                          <span className="mt-1 block font-mono text-[8.5px] tracking-[0.12em] text-navy-500 uppercase">
                            {signal.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Rise>

                  <div className="relative mt-auto flex flex-col gap-5 border-t border-navy-950/10 pt-6 sm:flex-row sm:items-end sm:justify-between">
                    <ul className="space-y-2.5">
                      {active.points.map((point) => (
                        <li key={point} className="flex gap-3 text-[13px] text-navy-700">
                          <span
                            aria-hidden
                            className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-amber-300 text-[9px] font-bold text-navy-950"
                          >
                            ✓
                          </span>
                          {point}
                        </li>
                      ))}
                    </ul>
                    <Link
                      to="/register"
                      className="inline-flex shrink-0 items-center justify-center gap-2.5 rounded-xl bg-navy-950 px-5 py-3 text-[13px] font-semibold text-amber-50 transition-[background-color,transform] duration-200 hover:bg-navy-800 active:scale-[0.98]"
                    >
                      Get started
                      <span aria-hidden>→</span>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Rise>
      </Shell>
    </section>
  )
}
