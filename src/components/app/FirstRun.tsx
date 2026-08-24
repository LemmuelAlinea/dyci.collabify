import { useEffect, useState } from 'react'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import type { Role } from '../../lib/types'

/**
 * The three things each role needs to know, shown once.
 *
 * A dashboard full of empty panels is the worst first impression this product
 * makes: nothing has happened yet, so every card says "nothing yet", and it
 * reads as broken rather than new. This says what the page will fill with and
 * what to do first — then gets out of the way permanently.
 *
 * Dismissal is per-role and kept in localStorage rather than the database. It
 * is a preference about one browser, not a fact about the person, and putting
 * it in `profiles` would mean a migration and a write on first paint for
 * something nobody needs synced.
 */
const KEY = 'collabify.firstrun'

type Step = { icon: IconName; title: string; body: string }

const STEPS: Record<Role, { heading: string; steps: Step[] }> = {
  student: {
    heading: 'Three things worth knowing',
    steps: [
      {
        icon: 'users',
        title: 'Your professor adds you to a class',
        body: 'Classes and groups are not something you join yourself. Once you are added, the class and its projects appear here on their own.',
      },
      {
        icon: 'kanban',
        title: 'You claim tasks, nobody assigns them',
        body: 'Open a project board and take the work you will do. There is a ceiling on how much of a board one person can hold, so the split stays fair.',
      },
      {
        icon: 'upload',
        title: 'Hand in when the group is ready',
        body: 'Handing in locks the board so the work stops moving while it is being marked. You can take a submission back if your professor has not answered yet.',
      },
    ],
  },
  professor: {
    heading: 'Three things worth knowing',
    steps: [
      {
        icon: 'file',
        title: 'Start with a class and its syllabus',
        body: 'Upload the syllabus and set the term dates. Every week then gets its real calendar dates, and projects can be pinned to the weeks they belong to.',
      },
      {
        icon: 'board',
        title: 'Projects go to groups, not to people',
        body: 'Make a group set, then a project against it. Each group gets its own board, and the class analytics fill in as the work moves.',
      },
      {
        icon: 'chart',
        title: 'Analytics answers "who needs me this week"',
        body: 'It reads the boards you already have — no extra marking. Reports turns the same figures into something you can hand to the program office.',
      },
    ],
  },
  admin: {
    heading: 'Three things worth knowing',
    steps: [
      {
        icon: 'shield',
        title: 'New professors wait for you',
        body: 'A professor cannot teach until their account is approved. Approvals is the first place to look, and every decision is written to the audit log.',
      },
      {
        icon: 'folder',
        title: 'Sections and curriculum are program-wide',
        body: 'What you set here is what every professor picks from when they make a class, so the naming stays consistent across the program.',
      },
      {
        icon: 'bell',
        title: 'Announcements reach the whole program',
        body: 'Unlike a class announcement, these show for every student and professor in BSIT — and only for 24 hours, so the dashboards stay current. Send it again if it still matters.',
      },
    ],
  },
}

export function FirstRun({ role }: { role: Role }) {
  const [open, setOpen] = useState(false)

  // Read in an effect, not in useState: this renders inside a lazy route, and
  // touching localStorage during render would run before the theme script has
  // settled on some browsers.
  useEffect(() => {
    try {
      const seen = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>
      setOpen(!seen[role])
    } catch {
      setOpen(true)
    }
  }, [role])

  function dismiss() {
    setOpen(false)
    try {
      const seen = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>
      localStorage.setItem(KEY, JSON.stringify({ ...seen, [role]: true }))
    } catch {
      /* a browser refusing storage should not keep the panel on screen */
    }
  }

  if (!open) return null
  const { heading, steps } = STEPS[role]

  return (
    <section
      aria-label="Getting started"
      className="surface relative overflow-hidden rounded-panel border border-line p-5 shadow-card md:p-6"
    >
      <div className="blueprint pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow text-navy-600 dark:text-navy-200">New here</p>
            <h2 className="mt-1 text-[19px]">{heading}</h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="-mt-1 -mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
            aria-label="Dismiss getting started"
          >
            <Icon name="x" size={17} />
          </button>
        </div>

        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span
                className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-navy-500/10 text-navy-600 dark:text-navy-200"
                aria-hidden="true"
              >
                <Icon name={s.icon} size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold">
                  <span className="font-mono text-[12px] text-faint">{i + 1}. </span>
                  {s.title}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={dismiss}
          className="mt-5 text-[13px] font-semibold text-navy-600 hover:underline dark:text-navy-200"
        >
          Got it, hide this
        </button>
      </div>
    </section>
  )
}
