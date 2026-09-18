import { useEffect, useState } from 'react'
import { RoleHome } from './RoleHome'
import type { Upcoming } from './RoleHome'
import { generalCounts } from '../../lib/api/general'
import type { GeneralCounts } from '../../lib/general/types'

const UPCOMING: Upcoming[] = [
  {
    icon: 'folder',
    title: 'Sections',
    body: 'Keep cohort names, year levels, and advisers consistent.',
    to: '/admin/sections',
  },
  {
    icon: 'bell',
    title: 'Announcements',
    body: 'Program-wide notices that reach students and advisers in one send.',
    to: '/admin/notices',
  },
  {
    icon: 'file',
    title: 'Program curriculum',
    body: 'Curriculum and syllabus templates published once, for every section of a course.',
    to: '/admin/library',
  },
]

export default function AdminHome() {
  return (
    <>
      <RoleHome
        headline="Program overview"
        intro="Classes, faculty load and cohort progress are live, beside approvals, accounts and the audit log. Everything here is counts — what happens inside a class stays with its professor and their students."
        upcoming={UPCOMING}
      />
      <GeneralCountsBand />
    </>
  )
}

/** Counts only. What happens inside a General project stays with the people on it. */
function GeneralCountsBand() {
  const [counts, setCounts] = useState<GeneralCounts | null>(null)

  useEffect(() => {
    void generalCounts()
      .then(setCounts)
      .catch(() => setCounts(null))
  }, [])

  if (!counts) return null

  const items = [
    { label: 'General projects', value: counts.projects },
    { label: 'Running', value: counts.active_projects },
    { label: 'Archived', value: counts.archived_projects },
    { label: 'People on them', value: counts.people },
  ]

  return (
    <section className="mt-8 rounded-panel border border-line surface p-4 sm:p-5">
      <p className="eyebrow">General workplace</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((i) => (
          <div key={i.label} className="rounded-xl surface-sunken px-3 py-2.5">
            <dt className="text-[12px] text-muted">{i.label}</dt>
            <dd className="mt-0.5 font-mono text-[20px] font-bold text-ink">{i.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
