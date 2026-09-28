import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { DirectoryHero } from '../../components/app/DirectoryHero'
import { JoinSpaceDialog, NewSpaceDialog } from '../../components/general/SpaceDialogs'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon, Spinner } from '../../components/ui/Icon'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { rememberSpace } from '../../hooks/useSpaces'
import { canTeach, inAnyClass, isFaculty } from '../../lib/access'
import { levelLabel } from '../../lib/general/permissions'
import type { GeneralSpaceSummary } from '../../lib/general/types'
import { paths } from '../../lib/paths'

/**
 * Every space you are in.
 *
 * A space holds projects, and everyone in a space can see every project in it.
 * That is the whole reason this page exists rather than one long list: work for
 * one group stays with that group.
 *
 * Classes appear here only for faculty the admin has not let teach, and for
 * admins. Anyone with a Classes section in the rail — students and teaching
 * faculty — finds their classes there, so this page stays work spaces only
 * for them. The others get the two kinds in their own sections, with a
 * filter, and only once they have a class at all.
 */
type Show = 'all' | 'classes' | 'spaces'

export default function SpacePicker() {
  const location = useLocation()
  const { profile } = useAuth()
  // Admins are invited in, never make or join a space themselves.
  const faculty = isFaculty(profile) && profile?.role !== 'admin'
  const { spaces, error, reload } = useGeneralNavigation()
  const [newOpen, setNewOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [params, setParams] = useSearchParams()

  useEffect(() => {
    document.title = 'Spaces · Collabify'
  }, [])


  const mine = (spaces ?? []).filter((s) => s.my_level)
  const classSpaces = mine.filter((s) => s.kind === 'education' && !s.archived_at)
  const archivedClassSpaces = mine.filter((s) => s.kind === 'education' && s.archived_at)
  const workSpaces = mine.filter((s) => s.kind === 'work')
  const live = workSpaces.filter((s) => !s.archived_at)
  const archived = workSpaces.filter((s) => s.archived_at)
  const viewingArchived = location.pathname.endsWith('/archive')
  const shown = viewingArchived ? archived : live
  const classesShown = viewingArchived ? archivedClassSpaces : classSpaces

  // Whether this page sorts into Classes and Spaces at all. Judged on every
  // class, archived or not, so the filter does not come and go between tabs.
  const split =
    (profile?.role === 'admin' || (profile?.role === 'faculty' && !canTeach(profile))) &&
    inAnyClass(spaces)
  const requested = params.get('show')
  const filter: Show = split && (requested === 'classes' || requested === 'spaces') ? requested : 'all'

  function setFilter(next: Show) {
    setParams(next === 'all' ? {} : { show: next }, { replace: true })
  }

  const spacesEmpty = (
    <EmptyState
      icon="folder"
      title={viewingArchived ? 'No archived spaces' : 'No spaces yet'}
      body={
        viewingArchived
          ? 'Archived spaces appear here after an Owner archives them.'
          : faculty
            ? 'Create one to hold your projects, or join a space somebody else has opened with a code.'
            : 'A faculty member can invite you into a space.'
      }
      action={!viewingArchived && faculty ? (
        <Button variant="accent" onClick={() => setNewOpen(true)}>
          Create space
        </Button>
      ) : undefined}
    />
  )

  return (
    <div className="w-full">
      <DirectoryHero
        title={viewingArchived ? 'Archived spaces' : 'Your spaces'}
        accent={viewingArchived ? 'kept out of the way.' : 'and the work inside them.'}
        description={
          viewingArchived
            ? 'Archived spaces stay readable, but they no longer show in your active spaces.'
            : 'A space holds projects. Everyone in a space can see every project in it, so keep separate work in separate spaces.'
        }
        action={!viewingArchived && faculty ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="create" onClick={() => setNewOpen(true)}>
              <Icon name="plus" size={17} />
              Create space
            </Button>
            <Button variant="onNavy" onClick={() => setJoinOpen(true)}>
              Join with a code
            </Button>
          </div>
        ) : undefined}
      />

      <div className="mt-6 space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-2 text-[13px]">
          <Link
            to={{ pathname: paths.spaces, search: location.search }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 ${
              !viewingArchived
                ? 'border-line-strong surface-sunken text-ink'
                : 'border-line text-muted hover:border-line-strong hover:text-ink'
            }`}
          >
            <Icon name="folder" size={15} />
            Active spaces
          </Link>
          <Link
            to={{ pathname: paths.spacesArchive, search: location.search }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 ${
              viewingArchived
                ? 'border-line-strong surface-sunken text-ink'
                : 'border-line text-muted hover:border-line-strong hover:text-ink'
            }`}
          >
            <Icon name="archive" size={15} />
            Archived spaces
          </Link>
        </nav>

        {split && (
          <div
            role="group"
            aria-label="Show"
            className="flex rounded-lg border border-line p-0.5 text-[13px]"
          >
            {(['all', 'classes', 'spaces'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={filter === option}
                onClick={() => setFilter(option)}
                className={`rounded-md px-3 py-1 transition-colors ${
                  filter === option
                    ? 'surface-sunken font-medium text-ink'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {option === 'all' ? 'All' : option === 'classes' ? 'Classes' : 'Spaces'}
              </button>
            ))}
          </div>
        )}
        </div>


        {spaces === null ? (
          <div className="grid place-items-center py-16">
            <Spinner size={26} />
          </div>
        ) : !split ? (
          shown.length === 0 ? spacesEmpty : <CardGrid spaces={shown} />
        ) : (
          <>
            {filter !== 'spaces' && (
              <Section title="Classes" count={classesShown.length}>
                {classesShown.length === 0 ? (
                  <p className="text-[13px] text-muted">
                    {viewingArchived ? 'No archived classes.' : 'No active classes.'}
                  </p>
                ) : (
                  <CardGrid spaces={classesShown} />
                )}
              </Section>
            )}
            {filter !== 'classes' && (
              <Section title="Spaces" count={shown.length}>
                {shown.length === 0 ? spacesEmpty : <CardGrid spaces={shown} labelled />}
              </Section>
            )}
          </>
        )}
      </div>

      <NewSpaceDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={reload} />
      <JoinSpaceDialog open={joinOpen} onClose={() => setJoinOpen(false)} onJoined={reload} />
    </div>
  )
}
function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-baseline gap-2 text-[15px]">
        {title}
        <span className="font-mono text-[12px] font-normal text-faint">{count}</span>
      </h2>
      {children}
    </section>
  )
}

function CardGrid({ spaces, labelled = false }: { spaces: GeneralSpaceSummary[]; labelled?: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:gap-5">
      {spaces.map((s, index) => (
        <SpaceCard key={s.id} space={s} labelled={labelled} index={index} />
      ))}
    </div>
  )
}

/**
 * Built like a class card: a numbered eyebrow and a status, a monogram beside
 * the name, a line of description, and counts below a rule.
 *
 * `labelled` tags a work space "Space" to match a class's "Class" tag — only
 * where the two kinds share a page, since on a spaces-only page it would be
 * the same word on every card.
 */
function SpaceCard({
  space: s,
  labelled,
  index,
}: {
  space: GeneralSpaceSummary
  labelled: boolean
  index: number
}) {
  const classId = s.kind === 'education' ? s.class_id : null
  const initial = s.name.trim().charAt(0).toUpperCase() || 'S'
  const status = s.archived_at ? 'Archived' : classId ? 'Class' : labelled ? 'Space' : 'Active'

  return (
    <Link
      to={classId ? paths.class(classId) : paths.space(s.id)}
      onClick={() => {
        if (!classId) rememberSpace(s.id)
      }}
      className="group relative flex min-h-[248px] overflow-hidden rounded-card border border-line bg-[var(--surface)] transition-[border-color,transform] duration-200 hover-safe hover:border-line-strong"
    >
      <div className="flex w-full flex-col p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] tracking-[0.18em] text-faint uppercase">
            {classId ? 'Class' : 'Space'} {String(index + 1).padStart(2, '0')}
          </p>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              s.archived_at
                ? 'surface-sunken text-muted'
                : classId
                  ? 'bg-warning-400/18 text-warning-700 dark:text-warning-300'
                  : 'bg-success-500/10 text-success-700 dark:text-success-300'
            }`}
          >
            {status}
          </span>
        </div>

        <div className="mt-5 flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-icon-tile font-display text-[14px] font-bold text-icon-glyph ring-1 ring-white/10">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-[17px] leading-snug text-ink transition-colors group-hover:text-navy-600 dark:group-hover:text-amber-300">
              {s.name}
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">You are {levelLabel(s.my_level)}</p>
          </div>
        </div>

        <p className="mt-4 line-clamp-2 min-h-[42px] text-[13px] leading-relaxed text-muted">
          {s.description ||
            (classId
              ? 'Open the class workspace for announcements, projects and group work.'
              : 'Open the space for its projects, members, teams and reports.')}
        </p>

        <div className="mt-auto flex items-end justify-between gap-4 border-t border-line pt-4">
          <div className="min-w-0">
            <p className="text-[11px] text-faint">Projects</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <Icon name="kanban" size={14} className="text-muted" />
              {s.project_count} {s.project_count === 1 ? 'project' : 'projects'}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
            <Icon name="users" size={14} />
            {s.member_count} {s.member_count === 1 ? 'member' : 'members'}
          </span>
        </div>
      </div>
    </Link>
  )
}
