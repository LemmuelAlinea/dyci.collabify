import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/ui/Icon'
import type { IconName } from '../../components/ui/Icon'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { spaceSettingsSection } from '../../lib/general/navigation'
import type { SpaceSettingsSection } from '../../lib/general/navigation'
import { canEditSpace } from '../../lib/general/permissions'
import GeneralTeams from './GeneralTeams'
import SpaceArchive from './SpaceArchive'
import SpaceDetails from './SpaceDetails'
import SpaceMembers from './SpaceMembers'

const SECTIONS: { id: SpaceSettingsSection; label: string; icon: IconName }[] = [
  { id: 'details', label: 'Details', icon: 'settings' },
  { id: 'teams', label: 'Teams', icon: 'target' },
  { id: 'members', label: 'Members', icon: 'users' },
  { id: 'archive', label: 'Archive', icon: 'archive' },
]

/** A space's Settings: a left menu of Details, Teams, Members and Archive, the open one in the URL. */
export default function SpaceSettings() {
  const { currentSpace: space } = useGeneralNavigation()
  const [params, setParams] = useSearchParams()
  const nav = useRef<HTMLElement>(null)
  const canSeeArchive = canEditSpace(space?.my_role ?? null)
  const active = spaceSettingsSection(params, canSeeArchive)

  // On a phone the menu scrolls sideways: keep the open section in view.
  useEffect(() => {
    if (!window.matchMedia?.('(max-width: 767px)').matches) return
    const current = nav.current?.querySelector<HTMLElement>('[aria-current="page"]')
    if (typeof current?.scrollIntoView === 'function') current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  if (!space) return null

  function open(next: SpaceSettingsSection) {
    const changed = new URLSearchParams(params)
    changed.set('section', next)
    // archived=1 only means something inside Teams.
    if (next !== 'teams') changed.delete('archived')
    setParams(changed, { replace: true })
  }

  const counts: Partial<Record<SpaceSettingsSection, number>> = {
    members: space.member_count,
    archive: space.archived_count || undefined,
  }

  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-8">
      <nav
        ref={nav}
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:sticky md:top-4 md:w-[200px] md:shrink-0 md:flex-col md:overflow-visible"
      >
        {SECTIONS.filter((s) => s.id !== 'archive' || canSeeArchive).map((s) => {
          const on = s.id === active
          const count = counts[s.id]
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
              <Icon name={s.icon} size={17} className={on ? 'shrink-0' : 'shrink-0 text-nav-icon'} />
              {s.label}
              {count !== undefined && count > 0 && (
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[12px] ${
                    on ? 'bg-navy-600 text-white dark:bg-amber-400 dark:text-navy-900' : 'surface-sunken text-faint'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </nav>
      <div className="min-w-0 flex-1">
        {active === 'teams' ? (
          <GeneralTeams />
        ) : active === 'members' ? (
          <SpaceMembers />
        ) : active === 'archive' ? (
          <SpaceArchive />
        ) : (
          <SpaceDetails />
        )}
      </div>
    </div>
  )
}
