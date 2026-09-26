import { useEffect, useMemo, useState } from 'react'
import { Bento, BentoCell } from '../../components/dashboard/Bento'
import { DashSection } from '../../components/dashboard/DashSection'
import { DashboardSummary } from '../../components/dashboard/DashboardSummary'
import { Reveal } from '../../components/motion/Reveal'
import {
  ComingUpPanel,
  MyTasksPanel,
  RecentPanel,
  WaitingPanel,
} from '../../components/general/DashboardPanels'
import { JoinProjectDialog } from '../../components/general/JoinProjectDialog'
import { QuickActions } from '../../components/general/QuickActions'
import { NewSpaceDialog } from '../../components/general/SpaceDialogs'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { useUnreadTotal } from '../../hooks/useConversations'
import { useGeneralDashboard } from '../../hooks/useGeneralDashboard'
import { respondToInvitation } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { comingUp, dueCounts, myTasks, recentProjects } from '../../lib/general/dashboard'
import type { MyInvitation } from '../../lib/general/types'
import { plural } from '../../lib/plural'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * Where /general lands: everything on the reader, across every space.
 *
 * It used to redirect into a space, which meant somebody holding projects and
 * no space — the state a project join code puts you in, since joining a project
 * never joins its space — was sent to a page headed "No spaces yet". Nothing
 * here is space-scoped, so it answers for every account.
 *
 * The space dashboard in SpaceHome is the same panels narrowed to one space,
 * and keeps the space's own management alongside them.
 */
export default function GeneralHome() {
  const { profile } = useAuth()
  const { show } = useToast()
  const { myProjects, spaces, error, reload } = useGeneralNavigation()
  const unread = useUnreadTotal(profile?.id, 'general')
  const [answering, setAnswering] = useState<string | null>(null)
  const [joinOpen, setJoinOpen] = useState(false)
  const [newSpaceOpen, setNewSpaceOpen] = useState(false)

  useEffect(() => {
    document.title = 'Home · Collabify'
  }, [])

  const mineProjects = useMemo(
    () => (myProjects ?? []).filter((p) => p.my_level && !p.archived_at),
    [myProjects],
  )
  const ids = useMemo(() => mineProjects.map((p) => p.id), [mineProjects])
  const { data, error: dashError, reload: reloadDash } = useGeneralDashboard(profile?.id, ids)

  const now = data?.at ?? 0
  const names = new Map(mineProjects.map((p) => [p.id, p.name]))
  const projectName = (id: string) => names.get(id) ?? 'A project'
  const mine = profile && data ? myTasks(data.tasks, profile.id) : []
  const { overdue, thisWeek } = dueCounts(mine, now)
  const invitations = data?.invitations ?? []
  const reviews = data?.reviews ?? []
  const requests = mineProjects.filter((p) => p.my_level === 'owner' && p.open_request_count > 0)
  const waiting =
    invitations.length + reviews.length + requests.reduce((n, p) => n + p.open_request_count, 0)
  const days = data ? comingUp(data.tasks, mineProjects, now) : []
  const liveSpaces = (spaces ?? []).filter((s) => s.my_level && !s.archived_at)

  async function answer(inv: MyInvitation, accept: boolean) {
    setAnswering(inv.id)
    try {
      await respondToInvitation(inv.id, accept)
      show(accept ? 'Invitation accepted' : 'Invitation declined')
      await Promise.all([reloadDash(), reload()])
    } catch (err) {
      show(authErrorMessage(err, 'Could not answer that invitation.'), 'error')
    } finally {
      setAnswering(null)
    }
  }

  const line =
    overdue > 0
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
          kicker="Your work"
          line={line}
          urgent={overdue > 0}
          tiles={[
            { label: 'My open tasks', value: mine.length, icon: 'check' },
            { label: 'Due this week', value: thisWeek, icon: 'calendar' },
            {
              label: 'Overdue',
              value: overdue,
              icon: 'clock',
              tone: overdue > 0 ? 'warn' : 'plain',
            },
            { label: 'Waiting on you', value: waiting, icon: 'bell' },
          ]}
        />
      </Reveal>

      <div className="mt-6">
        <QuickActions
          actions={[
            {
              icon: 'plus',
              label: 'New space',
              hint: 'A place to hold projects',
              onClick: () => setNewSpaceOpen(true),
              primary: true,
            },
            {
              icon: 'lock',
              label: 'Join with code',
              hint: 'Eight characters from an Owner',
              onClick: () => setJoinOpen(true),
            },
            {
              icon: 'kanban',
              label: 'Projects',
              hint: `${mineProjects.length} ${plural(mineProjects.length, 'project', 'projects')} you are on`,
              to: '/general/projects',
            },
            {
              icon: 'folder',
              label: 'Spaces',
              hint: `${liveSpaces.length} ${plural(liveSpaces.length, 'space', 'spaces')} you are in`,
              to: '/general/spaces',
            },
            {
              icon: 'message',
              label: 'Messages',
              hint: unread > 0 ? `${unread} unread` : 'Chats and project threads',
              to: '/general/messages',
              count: unread,
            },
          ]}
        />
      </div>

      {(error || dashError) && (
        <div className="mt-6">
          <Alert tone="error" onRetry={() => void Promise.all([reload(), reloadDash()])}>
            {error ?? dashError}
          </Alert>
        </div>
      )}

      {myProjects === null ? (
        <div className="mt-8 flex items-center gap-3 text-[14px] text-muted">
          <Spinner size={16} />
          Loading your work…
        </div>
      ) : (
        <div className="mt-6">
          <Bento>
            <BentoCell>
              <Reveal once delay={0.04}>
                <DashSection icon="bell" title="Waiting on you" count={waiting}>
                  <WaitingPanel
                    invitations={invitations}
                    reviews={reviews}
                    requests={requests}
                    projectName={projectName}
                    answering={answering}
                    onAnswer={(inv, accept) => void answer(inv, accept)}
                  />
                </DashSection>
              </Reveal>
            </BentoCell>
            <BentoCell>
              <Reveal once delay={0.08}>
                <DashSection icon="check" title="My tasks" count={mine.length}>
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
                <DashSection icon="calendar" title="Coming up">
                  <ComingUpPanel days={days} projectName={projectName} now={now} />
                </DashSection>
              </Reveal>
            </BentoCell>
            <BentoCell>
              <Reveal once delay={0.16}>
                <DashSection icon="kanban" title="Jump back in">
                  <RecentPanel projects={recentProjects(mineProjects)} />
                </DashSection>
              </Reveal>
            </BentoCell>
          </Bento>

          {mineProjects.length === 0 && liveSpaces.length === 0 && (
            <div className="mt-6 rounded-card border border-line bg-[var(--surface)] p-6">
              <h2 className="text-[15px] font-semibold text-ink">Nothing here yet</h2>
              <p className="mt-1.5 max-w-[60ch] text-[13.5px] text-muted">
                Make a space to hold your own projects, or join a project somebody else runs with
                the code they give you.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => setNewSpaceOpen(true)}>New space</Button>
                <Button variant="ghost" onClick={() => setJoinOpen(true)}>
                  Join with code
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <JoinProjectDialog open={joinOpen} onClose={() => setJoinOpen(false)} />
      <NewSpaceDialog
        open={newSpaceOpen}
        onClose={() => setNewSpaceOpen(false)}
        onCreated={reload}
      />
    </div>
  )
}
