import { Suspense, useMemo, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Reveal } from '../../components/motion/Reveal'
import { DashboardSummary } from '../../components/dashboard/DashboardSummary'
import { JoinProjectDialog } from '../../components/general/JoinProjectDialog'
import { NewProjectDialog } from '../../components/general/NewProjectDialog'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Icon, Spinner } from '../../components/ui/Icon'
import type { IconName } from '../../components/ui/Icon'
import { IconAction } from '../../components/ui/IconAction'
import { Tabs } from '../../components/ui/Tabs'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { useGeneralDashboard } from '../../hooks/useGeneralDashboard'
import { forgetSpace } from '../../hooks/useSpaces'
import { isFaculty } from '../../lib/access'
import { archiveSpace, deleteSpace } from '../../lib/api/spaces'
import { dueCounts, myTasks } from '../../lib/general/dashboard'
import { paths } from '../../lib/paths'
import { plural } from '../../lib/plural'
import type { SpaceOutlet } from './spaceOutlet'

type SpaceTab = 'overview' | 'projects' | 'teams' | 'members' | 'reports' | 'archive'

const TABS: { id: SpaceTab; label: string; icon: IconName; to: (id: string) => string }[] = [
  { id: 'overview', label: 'Overview', icon: 'info', to: paths.space },
  { id: 'projects', label: 'Projects', icon: 'board', to: paths.spaceProjects },
  { id: 'teams', label: 'Teams', icon: 'target', to: paths.spaceTeams },
  { id: 'members', label: 'Members', icon: 'users', to: paths.spaceMembers },
  { id: 'reports', label: 'Reports', icon: 'chart', to: paths.spaceReports },
  { id: 'archive', label: 'Archive', icon: 'archive', to: paths.spaceArchive },
]

/** `/spaces/:id/teams/archive` is still the Teams tab. */
function tabOf(pathname: string, spaceId: string): SpaceTab {
  const rest = pathname.slice(paths.space(spaceId).length).split('/')[1] ?? ''
  return TABS.some((t) => t.id === rest) ? (rest as SpaceTab) : 'overview'
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * A work space, laid out like a class: one banner, then a strip of tabs, each
 * tab its own URL so a link can open a space straight at its members. Starting
 * or joining a project lives in the banner because it is the space's main step,
 * not a place to go.
 */
export default function SpaceLayout() {
  const { spaceId = '' } = useParams<{ spaceId: string }>()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { show } = useToast()
  const { spaces, currentSpace: space, projects, reload: reloadNavigation } = useGeneralNavigation()
  const [newOpen, setNewOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const all = useMemo(() => (projects ?? []).filter((p) => !p.archived_at), [projects])
  const ids = useMemo(() => all.map((p) => p.id), [all])
  const dashboard = useGeneralDashboard(profile?.id, ids)

  if (spaces !== null && !space) return <Navigate to={paths.spaces} replace />
  if (space?.kind === 'education' && space.class_id) {
    return <Navigate to={paths.class(space.class_id)} replace />
  }

  const isOwner = space?.my_level === 'owner'
  const archived = Boolean(space?.archived_at)
  // Students are invited onto projects; only faculty open or join one here.
  const canStart = !archived && isFaculty(profile)

  const data = dashboard.data
  const now = data?.at ?? 0
  const mine = profile && data ? myTasks(data.tasks, profile.id) : []
  const { overdue, thisWeek } = dueCounts(mine, now)
  const waiting =
    (data?.reviews.length ?? 0) +
    all.filter((p) => p.my_level === 'owner').reduce((n, p) => n + p.open_request_count, 0)

  const line = archived
    ? 'This space is archived. Everything stays readable, and nothing can change until an Owner restores it.'
    : overdue > 0
      ? `${overdue} of your tasks ${plural(overdue, 'is', 'are')} overdue.` +
        (thisWeek > 0 ? ` Another ${thisWeek} ${plural(thisWeek, 'is', 'are')} due this week.` : '')
      : thisWeek > 0
        ? `${thisWeek} ${plural(thisWeek, 'task', 'tasks')} due this week, and nothing overdue.`
        : waiting > 0
          ? `${waiting} ${plural(waiting, 'thing is', 'things are')} waiting on your answer.`
          : mine.length > 0
            ? `${mine.length} open ${plural(mine.length, 'task', 'tasks')} in hand, and nothing due this week.`
            : 'Nothing is waiting on you right now.'

  const tab = tabOf(pathname, spaceId)
  const counts: Partial<Record<SpaceTab, number>> = {
    projects: projects ? all.length : undefined,
    members: space?.member_count,
    archive: space?.archived_count || undefined,
  }
  const tabs = TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, count: counts[t.id] }))

  const outlet: SpaceOutlet = { all, dashboard, canStart, openNewProject: () => setNewOpen(true) }

  return (
    <div className="w-full">
      <div className="print:hidden">
        <Reveal once>
          <DashboardSummary
            greeting={greeting()}
            name={profile?.first_name ?? 'there'}
            kicker={space ? `${space.name}${archived ? ' · archived' : ''}` : 'Space'}
            line={line}
            urgent={overdue > 0}
            action={
              <>
                {canStart && (
                  <>
                    <Button size="sm" variant="create" onClick={() => setNewOpen(true)}>
                      <Icon name="plus" size={15} />
                      New project
                    </Button>
                    <Button size="sm" variant="onNavy" onClick={() => setJoinOpen(true)}>
                      <Icon name="lock" size={15} />
                      Join with code
                    </Button>
                  </>
                )}
                {isOwner && space && (
                  <IconAction
                    icon={archived ? 'refresh' : 'archive'}
                    label={archived ? 'Restore space' : 'Archive space'}
                    variant={archived ? 'onNavy' : 'destroy'}
                    onClick={() => setArchiveOpen(true)}
                  />
                )}
                {/* Deleting is the second of two steps: archive first, then delete. */}
                {isOwner && space && archived && (
                  <IconAction icon="trash" label="Delete space" variant="danger" onClick={() => setDeleteOpen(true)} />
                )}
              </>
            }
          />
        </Reveal>

        <div className="mt-6">
          <Tabs<SpaceTab>
            tabs={tabs}
            active={tab}
            onChange={(next) => navigate(TABS.find((t) => t.id === next)!.to(spaceId))}
            variant="panel"
          />
        </div>
      </div>

      <div className="mx-auto mt-6 w-full max-w-[1280px] print:mt-0">
        {/* Its own boundary, so opening a tab for the first time keeps the banner up. */}
        <Suspense
          fallback={
            <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
              <Spinner size={16} />
              Loading…
            </div>
          }
        >
          <Outlet context={outlet} />
        </Suspense>
      </div>

      <NewProjectDialog open={newOpen} onClose={() => setNewOpen(false)} spaceId={spaceId} />
      <JoinProjectDialog open={joinOpen} onClose={() => setJoinOpen(false)} />
      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={async () => {
          if (!space) return
          await archiveSpace(space.id, !archived)
          show(archived ? 'Space restored' : 'Space archived')
          await reloadNavigation()
        }}
        title={archived ? 'Restore this space?' : 'Archive this space?'}
        body={
          archived
            ? 'Projects return to normal and members can make changes again.'
            : 'Every project stays readable, but no member can change the space until an Owner restores it.'
        }
        confirmLabel={archived ? 'Restore space' : 'Archive space'}
        tone="primary"
      />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          if (!space) return
          await deleteSpace(space.id)
          forgetSpace()
          await reloadNavigation()
          show('Space deleted')
          navigate(paths.spaces, { replace: true })
        }}
        title="Delete this space?"
        body="This permanently deletes the space and everything inside it, including its projects, tasks, files, members, invitations, and project chats."
        confirmLabel="Delete space"
      />
    </div>
  )
}
