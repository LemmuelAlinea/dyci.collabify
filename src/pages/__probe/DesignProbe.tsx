// Throwaway. The signed-in chrome and the new page furniture, rendered with
// fabricated content so the design system can be looked at without a session.
// Deleted before this ships.
import { useState } from 'react'
import { FilterPills, PageHeader, StateBand, Stat } from '../../components/app/PageHeader'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import type { IconName } from '../../components/ui/Icon'
import { Tabs } from '../../components/ui/Tabs'

const GROUPS: { title: string; items: { label: string; icon: IconName; on?: boolean }[] }[] = [
  {
    title: 'Teaching',
    items: [
      { label: 'Dashboard', icon: 'board' },
      { label: 'Classes', icon: 'folder', on: true },
      { label: 'Groups', icon: 'users' },
      { label: 'Projects', icon: 'kanban' },
    ],
  },
  {
    title: 'Day to day',
    items: [
      { label: 'Calendar', icon: 'calendar' },
      { label: 'Reassignments', icon: 'refresh' },
      { label: 'Messages', icon: 'message' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { label: 'Analytics', icon: 'chart' },
      { label: 'Reports', icon: 'file' },
    ],
  },
]

const CLASSES = [
  {
    initial: 'QM',
    name: 'Quantitative Methods (Modelling and Simulation)',
    section: 'BSIT-4A',
    students: 16,
    projects: 3,
    week: 'Week 6 of 18',
    state: 'On pace',
  },
  {
    initial: 'ITP',
    name: 'Introduction to Programming',
    section: 'BSIT-4A',
    students: 0,
    projects: 0,
    week: 'No term dates',
    state: 'Not ready',
  },
  {
    initial: 'QME',
    name: 'Quantitative Methods',
    section: 'BSIT-4A',
    students: 12,
    projects: 1,
    week: 'Week 14 of 15',
    state: 'Behind',
  },
]

export default function DesignProbe() {
  const [filter, setFilter] = useState<'live' | 'archived'>('live')
  const [tab, setTab] = useState<'overview' | 'projects' | 'people'>('overview')

  return (
    <div className="app-ui min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="surface sticky top-0 hidden h-dvh flex-col overflow-hidden border-r border-line lg:flex">
        <div className="flex h-[60px] shrink-0 items-center border-b border-line px-5">
          <span className="text-[17px] font-bold text-navy-600 dark:text-white">Collabify</span>
        </div>
        <nav className="flex-1 space-y-7 overflow-y-auto px-4 py-5">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="px-3 pb-2 text-[11.5px] font-medium tracking-wide text-faint uppercase">
                {g.title}
              </p>
              <ul className="space-y-0.5">
                {g.items.map((i) => (
                  <li key={i.label}>
                    <span
                      className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] ${
                        i.on
                          ? 'bg-[var(--surface-sunken)] font-semibold text-ink'
                          : 'text-muted'
                      }`}
                    >
                      {i.on && (
                        <span className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-amber-400" />
                      )}
                      <Icon
                        name={i.icon}
                        size={18}
                        className={i.on ? 'text-navy-600 dark:text-amber-400' : ''}
                      />
                      <span className="flex-1 truncate">{i.label}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="surface sticky top-0 z-40 border-b border-line">
          <div className="flex h-[60px] items-center justify-end gap-1 px-8">
            <span className="grid h-9 w-9 place-items-center rounded-lg text-muted">
              <Icon name="bell" size={19} />
            </span>
            <span className="grid h-9 w-9 place-items-center rounded-lg text-muted">
              <Icon name="sun" size={19} />
            </span>
            <span className="ml-1 flex items-center gap-2.5 rounded-full py-1 pr-2 pl-1">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-navy-600 text-[12px] font-semibold text-white">
                CA
              </span>
              <span className="leading-tight">
                <span className="block text-[13.5px] font-semibold text-ink">Cloud Alinea</span>
                <span className="block text-[11.5px] text-muted">Professor</span>
              </span>
            </span>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-[1120px]">
            <PageHeader
              title="Classes"
              description="Every class you teach this term, and what each one still needs."
              actions={
                <>
                  <Button variant="outline" size="sm">
                    Import a roster
                  </Button>
                  <Button size="sm">
                    <Icon name="plus" size={16} />
                    New class
                  </Button>
                </>
              }
            >
              <div className="space-y-5">
                <FilterPills
                  label="Which classes"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'live', label: 'Running', count: 3 },
                    { value: 'archived', label: 'Archived', count: 1 },
                  ]}
                />
                <StateBand icon="alert" tone="attention" action={<Button size="sm" variant="outline">Set the dates</Button>}>
                  <strong className="font-semibold">Introduction to Programming</strong> has no
                  term dates, so it is missing from your analytics.
                </StateBand>
              </div>
            </PageHeader>

            <section className="card mb-6 p-5">
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                <Stat value={3} label="Classes running" />
                <Stat value={28} label="Students enrolled" />
                <Stat value={4} label="Projects set" />
                <Stat value={1} label="Waiting on you" tone="attention" />
              </div>
            </section>

            <div className="mb-5">
              <Tabs
                tabs={[
                  { id: 'overview' as const, label: 'Overview' },
                  { id: 'projects' as const, label: 'Projects', count: 4 },
                  { id: 'people' as const, label: 'People', count: 28 },
                ]}
                active={tab}
                onChange={setTab}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CLASSES.map((c) => (
                <article key={c.initial} className="card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--surface-sunken)] font-mono text-[13px] font-bold text-navy-600 dark:text-amber-300">
                      {c.initial}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium ${
                        c.state === 'Behind'
                          ? 'bg-amber-400/15 text-amber-700 dark:text-amber-300'
                          : c.state === 'Not ready'
                            ? 'surface-sunken text-muted'
                            : 'bg-navy-600/8 text-navy-600 dark:bg-white/8 dark:text-white'
                      }`}
                    >
                      {c.state}
                    </span>
                  </div>
                  <h3 className="mt-4 text-[15.5px] leading-snug font-semibold text-ink">
                    {c.name}
                  </h3>
                  <p className="mt-1 text-[13px] text-muted">{c.section}</p>
                  <dl className="mt-4 flex items-center gap-5 border-t border-line pt-3.5 text-[12.5px] text-muted">
                    <div className="flex items-center gap-1.5">
                      <dt className="sr-only">Students</dt>
                      <dd className="font-mono text-ink">{c.students}</dd>
                      <span>students</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <dt className="sr-only">Projects</dt>
                      <dd className="font-mono text-ink">{c.projects}</dd>
                      <span>projects</span>
                    </div>
                  </dl>
                  <p className="mt-3 text-[12.5px] text-faint">{c.week}</p>
                </article>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
