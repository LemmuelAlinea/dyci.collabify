import { useEffect, useMemo, useState } from 'react'
import { Bento, BentoCell } from '../dashboard/Bento'
import { DashboardSummary } from '../dashboard/DashboardSummary'
import { DashSection } from '../dashboard/DashSection'
import { Reveal } from '../motion/Reveal'
import { ComingUpPanel, MyTasksPanel, RecentPanel, WaitingPanel } from './DashboardPanels'
import { JoinProjectDialog } from './JoinProjectDialog'
import { NewSpaceDialog } from './SpaceDialogs'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { IconAction } from '../ui/IconAction'
import { EmptyState } from '../ui/EmptyState'
import { Icon, Spinner } from '../ui/Icon'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { useGeneralDashboard } from '../../hooks/useGeneralDashboard'
import { canTeach, isFaculty } from '../../lib/access'
import { listMyProjectVisits } from '../../lib/api/general'
import { comingUp, dueCounts, firstComing, myTasks, recentlyVisited } from '../../lib/general/dashboard'
import { plural } from '../../lib/plural'
import { paths } from '../../lib/paths'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * "Your work" — the General home's panels, stacked under the role dashboard
 * on `/home` and built the same way: a banner with one line and four figures,
 * then the panels. It takes a title instead of a second greeting, so somebody
 * with classes and work reads one page in two chapters.
 *
 * Spaces here are work spaces only; class spaces (`kind: 'education'`) belong
 * to the classes side of the rail and never count toward this section.
 *
 * Renders nothing for a non-faculty person until we know there is something
 * to show — no flash while `myProjects` is still loading, and nothing at all
 * once loaded if there are no projects, no work spaces and no invitations.
 * Faculty always keep the New space / Join with code doors open, including
 * while this is loading.
 *
 * `standalone` is a teacher's other dashboard rather than a section: it greets
 * instead of titling, and `onSwitch` puts the way back to the class dashboard
 * on its banner.
 */
export function WorkOverview({
  standalone = false,
  onSwitch,
}: { standalone?: boolean; onSwitch?: () => void } = {}) {
  const { profile } = useAuth()
  // Admins are invited in, never make or join a space themselves.
  const faculty = isFaculty(profile) && profile?.role !== 'admin'
  const { myProjects, spaces, error, reload } = useGeneralNavigation()
  const [joinOpen, setJoinOpen] = useState(false)
  const [newSpaceOpen, setNewSpaceOpen] = useState(false)

  const mineProjects = useMemo(
    () => (myProjects ?? []).filter((p) => p.my_level && !p.archived_at),
    [myProjects],
  )
  const ids = useMemo(() => mineProjects.map((p) => p.id), [mineProjects])
  const { data, error: dashError, reload: reloadDash } = useGeneralDashboard(profile?.id, ids)
  // When this person last opened each project. "Jump back in" leads with those;
  // a failed read only loses the order, so it falls back quietly.
  const [seen, setSeen] = useState<ReadonlyMap<string, string>>(new Map())
  useEffect(() => {
    if (!profile?.id) return
    let live = true
    listMyProjectVisits(profile.id)
      .then((m) => live && setSeen(m))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [profile?.id])

  useEffect(() => {
    if (standalone) document.title = 'Dashboard · Collabify'
  }, [standalone])

  const now = data?.at ?? 0
  const names = new Map(mineProjects.map((p) => [p.id, p.name]))
  const projectName = (id: string) => names.get(id) ?? 'A project'
  const mine = profile && data ? myTasks(data.tasks, profile.id) : []
  const reviews = data?.reviews ?? []
  const requests = mineProjects.filter((p) => p.my_level === 'owner' && p.open_request_count > 0)
  const waiting =
    reviews.length + requests.reduce((n, p) => n + p.open_request_count, 0)
  const days = data ? firstComing(comingUp(data.tasks, mineProjects, now)) : []
  // Class spaces live under Education; "Your work" only ever counts work spaces.
  const workSpaces = useMemo(() => (spaces ?? []).filter((s) => s.kind === 'work'), [spaces])
  const liveSpaces = workSpaces.filter((s) => s.my_level && !s.archived_at)

  const loaded = myProjects !== null
  const hasSomething = mineProjects.length > 0 || liveSpaces.length > 0

  // Faculty always keep the New space / Join with code doors open, including
  // while this is still loading. Everyone else sees nothing until we know
  // there is something to show — no flash of an empty section on the way in.
  if (!faculty && (!loaded || !hasSomething)) return null

  const { overdue, thisWeek } = dueCounts(mine, now)
  // The same one sentence the class dashboard above opens with, about work.
  const line = !loaded
    ? 'Loading your spaces and projects.'
    : !hasSomething
      ? 'No spaces or projects yet.'
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
    <div className={standalone ? 'w-full' : 'mt-10'}>
      <Reveal once>
        <DashboardSummary
          kicker={
            standalone
              ? 'Your work'
              : profile?.role === 'student' || canTeach(profile)
                ? 'Beyond your classes'
                : 'Spaces and projects'
          }
          {...(standalone
            ? { greeting: greeting(), name: profile?.first_name ?? 'there' }
            : { title: 'Your work' })}
          line={line}
          urgent={overdue > 0}
          action={
            faculty ? (
              <>
                <Button size="sm" variant="create" onClick={() => setNewSpaceOpen(true)}>
                  <Icon name="plus" size={15} />
                  New space
                </Button>
                <Button size="sm" variant="onNavy" onClick={() => setJoinOpen(true)}>
                  <Icon name="lock" size={15} />
                  Join with code
                </Button>
              </>
            ) : undefined
          }
          corner={
            onSwitch ? (
              <IconAction icon="swap" label="Switch to your class dashboard" onClick={onSwitch} />
            ) : undefined
          }
          tiles={[
            {
              label: 'Waiting on you',
              value: waiting,
              icon: 'bell',
              tone: waiting > 0 ? 'warn' : 'plain',
            },
            {
              label: overdue === 1 ? 'Task overdue' : 'Tasks overdue',
              value: overdue,
              to: paths.tasks,
              icon: 'clock',
              tone: overdue > 0 ? 'warn' : 'plain',
            },
            {
              label: plural(mineProjects.length, 'Project you are on', 'Projects you are on'),
              value: mineProjects.length,
              to: paths.projects,
              icon: 'kanban',
            },
            {
              label: plural(liveSpaces.length, 'Space', 'Spaces'),
              value: liveSpaces.length,
              to: paths.spaces,
              icon: 'folder',
            },
          ]}
        />
      </Reveal>

      {(error || dashError) && (
        <div className="mt-7 md:mt-8">
          <Alert tone="error" onRetry={() => void Promise.all([reload(), reloadDash()])}>
            {error ?? dashError}
          </Alert>
        </div>
      )}

      {myProjects === null ? (
        <div className="mt-7 flex items-center gap-3 text-[14px] text-muted md:mt-8">
          <Spinner size={16} />
          Loading your work…
        </div>
      ) : !hasSomething ? (
        <div className="mt-7 md:mt-8">
          <EmptyState
            icon="folder"
            title="No spaces or projects yet"
            body={
              faculty
                ? 'Make a space to hold your own projects, or join a project somebody else runs with the code they give you.'
                : 'A faculty member can invite you into a space or onto a project. Your classes are listed above.'
            }
            action={
              faculty ? (
                <Button onClick={() => setNewSpaceOpen(true)} className="!rounded-xl">
                  New space
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="mt-7 md:mt-8">
          <Bento>
            <BentoCell>
              <Reveal once delay={0.04}>
                <DashSection icon="bell" title="Waiting on you" count={waiting}>
                  <WaitingPanel
                    reviews={reviews}
                    requests={requests}
                    projectName={projectName}
                  />
                </DashSection>
              </Reveal>
            </BentoCell>
            <BentoCell>
              <Reveal once delay={0.08}>
                <DashSection icon="check" title="My tasks" count={mine.length} seeAll={paths.tasks}>
                  <MyTasksPanel
                    tasks={mine}
                    projectName={projectName}
                    now={now}
                    empty="No open tasks are assigned to you."
                  />
                </DashSection>
              </Reveal>
            </BentoCell>
            <BentoCell>
              <Reveal once delay={0.12}>
                <DashSection icon="calendar" title="Coming up" seeAll={paths.calendar}>
                  <ComingUpPanel days={days} projectName={projectName} now={now} />
                </DashSection>
              </Reveal>
            </BentoCell>
            <BentoCell>
              <Reveal once delay={0.16}>
                <DashSection icon="kanban" title="Jump back in" seeAll={paths.projects}>
                  <RecentPanel projects={recentlyVisited(mineProjects, seen)} />
                </DashSection>
              </Reveal>
            </BentoCell>
          </Bento>
        </div>
      )}

      <JoinProjectDialog open={joinOpen} onClose={() => setJoinOpen(false)} />
      <NewSpaceDialog open={newSpaceOpen} onClose={() => setNewSpaceOpen(false)} onCreated={reload} />
    </div>
  )
}
