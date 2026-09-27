import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Reveal } from '../../components/motion/Reveal'
import { Bento, BentoCell } from '../../components/dashboard/Bento'
import { DashSection } from '../../components/dashboard/DashSection'
import { DashboardSummary } from '../../components/dashboard/DashboardSummary'
import {
  ComingUpPanel,
  MyTasksPanel,
  RecentPanel,
  WaitingPanel,
} from '../../components/general/DashboardPanels'
import { NewProjectDialog } from '../../components/general/NewProjectDialog'
import { QuickActions } from '../../components/general/QuickActions'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { FilterField, FilterPopover, FilterSearch } from '../../components/ui/FilterPopover'
import { Icon, Spinner } from '../../components/ui/Icon'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { JoinProjectDialog } from '../../components/general/JoinProjectDialog'
import { WorkProjectCard } from '../../components/general/WorkProjectCard'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { useUnreadTotal } from '../../hooks/useConversations'
import { useGeneralDashboard } from '../../hooks/useGeneralDashboard'
import { forgetSpace } from '../../hooks/useSpaces'
import { isFaculty } from '../../lib/access'
import { archiveSpace, deleteSpace } from '../../lib/api/spaces'
import { comingUp, dueCounts, myTasks, recentProjects } from '../../lib/general/dashboard'
import { PROJECT_STATUSES, projectStatusLabel } from '../../lib/general/types'
import type {
  GeneralStatus,
} from '../../lib/general/types'
import { paths } from '../../lib/paths'
import { plural } from '../../lib/plural'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * One space, as a dashboard: what is on you, where you can go, then every
 * project in it.
 *
 * It reads top to bottom in the order somebody needs it. The masthead says
 * whether anything is late. The shortcuts are the doors out of the page, big
 * enough to hit without reading. The panels are the work — what is waiting on
 * an answer, what is assigned, what is due — each row opening the exact task or
 * tab it names. The full project grid comes last, because by then somebody
 * either found what they came for or is browsing.
 *
 * Everything is scoped to the space in the URL. Everybody in the space can see
 * all of its projects — being on a project is what decides who can change it.
 */
export default function SpaceHome() {
  const { spaceId } = useParams<{ spaceId: string }>()
  const { profile } = useAuth()
  const { show } = useToast()
  const {
    spaces,
    currentSpace: space,
    projects,
    error: navigationError,
    reload: reloadNavigation,
  } = useGeneralNavigation()
  const navigate = useNavigate()
  const [newOpen, setNewOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<GeneralStatus | ''>('')

  useEffect(() => {
    document.title = space ? `${space.name} · Collabify` : 'Space · Collabify'
  }, [space])

  const all = useMemo(() => (projects ?? []).filter((p) => !p.archived_at), [projects])
  const ids = useMemo(() => all.map((p) => p.id), [all])
  const { data, error: dashError, reload } = useGeneralDashboard(profile?.id, ids)
  const unread = useUnreadTotal(profile?.id, 'general')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter((p) => (status ? p.status === status : true))
      .filter((p) => (q ? `${p.name} ${p.description}`.toLowerCase().includes(q) : true))
  }, [all, query, status])


  if (spaceId && spaces !== null && !space) {
    return <Navigate to={paths.spaces} replace />
  }
  if (space?.kind === 'education' && space.class_id) {
    return <Navigate to={paths.class(space.class_id)} replace />
  }

  const error = navigationError ?? dashError
  const isOwner = space?.my_level === 'owner'
  const archived = Boolean(space?.archived_at)
  // Students are invited onto projects; only faculty open or join one here.
  const canStart = !archived && isFaculty(profile)

  const now = data?.at ?? 0
  const names = new Map(all.map((p) => [p.id, p.name]))
  const projectName = (id: string) => names.get(id) ?? 'A project'
  const mine = profile && data ? myTasks(data.tasks, profile.id) : []
  const { overdue, thisWeek } = dueCounts(mine, now)
  const reviews = data?.reviews ?? []
  const requests = all.filter((p) => p.my_level === 'owner' && p.open_request_count > 0)
  const waiting =
    reviews.length + requests.reduce((n, p) => n + p.open_request_count, 0)
  const days = data ? comingUp(data.tasks, all, now) : []

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

  return (
    <div className="w-full">
      <Reveal once>
        <DashboardSummary
          greeting={greeting()}
          name={profile?.first_name ?? 'there'}
          kicker={space ? `${space.name}${archived ? ' · archived' : ''}` : 'Space'}
          line={line}
          urgent={overdue > 0}
          action={
            isOwner && space ? (
              <>
                <Button
                  variant="onNavy"
                  size="sm"
                  className="!h-8 !rounded-lg !px-3"
                  onClick={() => setArchiveOpen(true)}
                >
                  <Icon name={archived ? 'refresh' : 'archive'} size={14} />
                  {archived ? 'Restore space' : 'Archive space'}
                </Button>
                {/* Deleting is the second of two steps: archive first, then delete. */}
                {archived && (
                  <Button
                    variant="onNavy"
                    size="sm"
                    className="!h-8 !rounded-lg !px-3 hover:!border-red-300/50 hover:!bg-red-500/15 hover:!text-red-200"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Icon name="trash" size={14} />
                    Delete space
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
      </Reveal>

      {spaceId && (
        <div className="mt-6">
          <QuickActions
            actions={[
              ...(canStart
                ? [
                    {
                      icon: 'plus' as const,
                      label: 'New project',
                      hint: 'Start from a preset or blank',
                      onClick: () => setNewOpen(true),
                      primary: true,
                    },
                    {
                      icon: 'lock' as const,
                      label: 'Join with code',
                      hint: 'Eight characters from an Owner',
                      onClick: () => setJoinOpen(true),
                    },
                  ]
                : []),
              {
                icon: 'users',
                label: 'Members',
                hint: space ? `${space.member_count} in this space` : 'Who is in this space',
                to: spaceId ? paths.spaceMembers(spaceId) : paths.spaces,
              },
              {
                icon: 'target',
                label: 'Teams',
                hint: 'Groups across projects',
                to: spaceId ? paths.spaceTeams(spaceId) : paths.spaces,
              },
              {
                icon: 'chart',
                label: 'Reports',
                hint: 'Who did what, over any dates',
                to: spaceId ? paths.spaceReports(spaceId) : paths.spaces,
              },
              {
                icon: 'message',
                label: 'Inbox',
                hint: unread > 0 ? `${unread} unread` : 'Chats and project threads',
                to: paths.inbox,
                count: unread,
              },
              {
                icon: 'archive',
                label: 'Archive',
                hint: space ? `${space.archived_count} archived ${plural(space.archived_count, 'project', 'projects')}` : 'Finished work',
                to: spaceId ? paths.spaceArchive(spaceId) : paths.spaces,
              },
            ]}
          />
        </div>
      )}

      <div className="mt-7 space-y-8 md:mt-8">
        {error && (
          <Alert tone="error" onRetry={() => void Promise.all([reload(), reloadNavigation()])}>
            {error}
          </Alert>
        )}

        {projects === null || (!data && !dashError) ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading this space…
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            icon="kanban"
            title="No projects yet"
            body={
              isFaculty(profile)
                ? 'Create one for anything this space is running, or join one with a code somebody shared with you.'
                : 'A faculty member can add you to a project in this space.'
            }
            action={
              canStart ? (
                <Button onClick={() => setNewOpen(true)} className="!rounded-xl">
                  New project
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Bento>
              <BentoCell>
                <Reveal once delay={0.04}>
                  <DashSection icon="bell" title="Waiting on you" count={waiting}>
                    <WaitingPanel reviews={reviews} requests={requests} projectName={projectName} />
                  </DashSection>
                </Reveal>
              </BentoCell>
              <BentoCell>
                <Reveal once delay={0.08}>
                  <DashSection icon="check" title="My tasks" count={mine.length}>
                    <MyTasksPanel tasks={mine} projectName={projectName} now={now} />
                  </DashSection>
                </Reveal>
              </BentoCell>
              <BentoCell>
                <Reveal once delay={0.12}>
                  <DashSection icon="calendar" title="Coming up">
                    <ComingUpPanel days={days} projectName={projectName} now={now} />
                  </DashSection>
                </Reveal>
              </BentoCell>
              <BentoCell>
                <Reveal once delay={0.16}>
                  <DashSection icon="kanban" title="Jump back in">
                    <RecentPanel projects={recentProjects(all)} />
                  </DashSection>
                </Reveal>
              </BentoCell>
            </Bento>

            {all.length > 0 && (
              <section id="all-projects" className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="mr-auto">All projects</h2>
                  <FilterPopover
                    align="right"
                    label="Filter projects"
                    active={[query.trim(), status].filter(Boolean).length}
                    summary={[query.trim() && `“${query.trim()}”`, status && projectStatusLabel(status)]
                      .filter(Boolean)
                      .join(' · ')}
                    onClear={() => {
                      setQuery('')
                      setStatus('')
                    }}
                  >
                    <FilterField label="Search">
                      <FilterSearch value={query} onChange={setQuery} placeholder="Name or description" />
                    </FilterField>
                    <FilterField label="Status">
                      <Select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as GeneralStatus | '')}
                        placeholder="Any status"
                        options={PROJECT_STATUSES}
                        className="!h-10 !text-[13px]"
                      />
                    </FilterField>
                  </FilterPopover>
                </div>

                {shown.length === 0 ? (
                  <EmptyState
                    icon="search"
                    title="Nothing matches"
                    body="No project fits these filters. Clear them to see every project in this space."
                  />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {shown.map((p, index) => (
                      <WorkProjectCard key={p.id} project={p} index={index} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
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
