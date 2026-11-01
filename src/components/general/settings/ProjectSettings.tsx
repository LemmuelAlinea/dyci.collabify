// src/components/general/settings/ProjectSettings.tsx
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../../ui/Icon'
import type { IconName } from '../../ui/Icon'
import { settingsSection } from '../../../lib/general/navigation'
import type { SettingsSection } from '../../../lib/general/navigation'
import type { GeneralProjectState } from '../useGeneralProject'
import { GeneralSection } from './GeneralSection'
import { MembersSection } from './MembersSection'
import { openSettingsRequests } from './openRequests'
import { SprintsSection } from './SprintsSection'
import { TasksSection } from './TasksSection'

const SECTIONS: { id: SettingsSection; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'sprints', label: 'Sprints', icon: 'target' },
  { id: 'tasks', label: 'Tasks', icon: 'kanban' },
  { id: 'members', label: 'Members & permissions', icon: 'users' },
]

export function ProjectSettings({ state }: { state: GeneralProjectState }) {
  const [params, setParams] = useSearchParams()
  const active = settingsSection(params)
  const nav = useRef<HTMLElement>(null)
  const openRequests = openSettingsRequests(state)

  // On a phone the menu scrolls sideways: keep the open section in view.
  useEffect(() => {
    if (!window.matchMedia?.('(max-width: 767px)').matches) return
    const current = nav.current?.querySelector<HTMLElement>('[aria-current="page"]')
    if (typeof current?.scrollIntoView === 'function') current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  function open(next: SettingsSection) {
    const changed = new URLSearchParams(params)
    changed.set('tab', 'settings')
    changed.set('section', next)
    setParams(changed, { replace: true })
  }

  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-8">
      <nav
        ref={nav}
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:sticky md:top-4 md:w-[200px] md:shrink-0 md:flex-col md:overflow-visible"
      >
        {SECTIONS.map((s) => {
          const on = s.id === active
          return (
            <button
              key={s.id}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => open(s.id)}
              className={`relative flex h-9 shrink-0 items-center gap-3 whitespace-nowrap rounded-lg px-3 text-left text-[14px] transition-colors md:w-full ${
                on
                  ? 'bg-nav-active font-semibold text-nav-active-ink'
                  : 'font-medium text-muted hover:bg-[var(--surface-sunken)] hover:text-ink'
              }`}
            >
              {on && (
                <span
                  aria-hidden
                  className="absolute inset-y-1.5 left-0 hidden w-[3px] rounded-full bg-nav-marker md:block"
                />
              )}
              <Icon name={s.icon} size={17} className={on ? undefined : 'text-nav-icon'} />
              {s.label}
              {s.id === 'members' && openRequests > 0 && (
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[12px] ${
                    on ? 'bg-navy-600 text-white dark:bg-amber-400 dark:text-navy-900' : 'surface-sunken text-faint'
                  }`}
                >
                  {openRequests}
                </span>
              )}
            </button>
          )
        })}
      </nav>
      <div className="min-w-0 flex-1">
        {active === 'members' ? (
          <MembersSection state={state} />
        ) : active === 'general' ? (
          <GeneralSection state={state} />
        ) : active === 'tasks' ? (
          <TasksSection state={state} />
        ) : (
          <SprintsSection state={state} />
        )}
      </div>
    </div>
  )
}
