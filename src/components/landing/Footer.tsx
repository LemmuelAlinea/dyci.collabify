import { Link } from 'react-router-dom'
import { Logo } from '../brand/Logo'

const GROUPS = [
  {
    title: 'Product',
    links: [
      { label: 'How the work moves', to: '/#how' },
      { label: 'What is inside', to: '/#features' },
      { label: 'For roles', to: '/#roles' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Sign in', to: '/login' },
      { label: 'Create account', to: '/register' },
      { label: 'Reset password', to: '/forgot-password' },
    ],
  },
]

export function Footer() {
  return (
    <footer className="surface border-t border-line">
      <div className="shell py-14 md:py-16">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))] md:gap-8">
          <div>
            <Logo tone="brand" subtitle="Project workspace" />
            <p className="mt-5 max-w-[320px] text-[14.5px] leading-relaxed text-muted">
              Coursework for the BSIT program at Dr. Yanga's Colleges: boards that hang off
              the syllabus, work with an owner, and a professor's answer at the end of it.
            </p>
          </div>
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="eyebrow text-faint">{g.title}</p>
              <ul className="mt-4 space-y-2.5">
                {g.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      to={l.to}
                      className="text-[14.5px] text-muted transition-colors hover:text-ink"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-7 text-[13px] text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} Collabify. Built for the BSIT program at Dr. Yanga's
            Colleges, Inc.
          </p>
          <p className="font-mono text-[11.5px] tracking-wide">No grades are recorded here</p>
        </div>
      </div>
    </footer>
  )
}
