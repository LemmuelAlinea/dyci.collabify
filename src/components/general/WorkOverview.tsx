import { useMemo, useState } from 'react'
import { Bento, BentoCell } from '../dashboard/Bento'
import { DashSection } from '../dashboard/DashSection'
import { Reveal } from '../motion/Reveal'
import { ComingUpPanel, MyTasksPanel, RecentPanel, WaitingPanel } from './DashboardPanels'
import { JoinProjectDialog } from './JoinProjectDialog'
import { QuickActions } from './QuickActions'
import { NewSpaceDialog } from './SpaceDialogs'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { useUnreadTotal } from '../../hooks/useConversations'
import { useGeneralDashboard } from '../../hooks/useGeneralDashboard'
import { isFaculty } from '../../lib/access'
import { respondToInvitation } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { comingUp, myTasks, recentProjects } from '../../lib/general/dashboard'
import type { MyInvitation } from '../../lib/general/types'
import { plural } from '../../lib/plural'
import { paths } from '../../lib/paths'

/**
 * "Your work" — the General home's panels, without its own greeting or
 * summary, stacked under the role dashboard on `/home`.
 *
 * Spaces here are work spaces only; class spaces (`kind: 'education'`) belong
 * to the classes side of the rail and never count toward this section.
 *
 * Renders nothing for a non-faculty person until we know there is something
 * to show — no flash while `myProjects` is still loading, and nothing at all
 * once loaded if there are no projects, no work spaces and no invitations.
 * Faculty always keep the New space / Join with code doors open, including
 * while this is loading.
 */
export function WorkOverview() {
  const { profile } = useAuth()
  const faculty = isFaculty(profile)
  const isAdmin = profile?.role === 'admin'
  const { show } = useToast()
  const { myProjects, spaces, error, reload } = useGeneralNavigation()
  const unread = useUnreadTotal(profile?.id, 'general')
  const [answering, setAnswering] = useState<string | null>(null)
  const [joinOpen, setJoinOpen] = useState(false)
  const [newSpaceOpen, setNewSpaceOpen] = useState(false)

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
  const invitations = data?.invitations ?? []
  const reviews = data?.reviews ?? []
  const requests = mineProjects.filter((p) => p.my_level === 'owner' && p.open_request_count > 0)
  const waiting =
    invitations.length + reviews.length + requests.reduce((n, p) => n + p.open_request_count, 0)
  const days = data ? comingUp(data.tasks, mineProjects, now) : []
  // Class spaces live under Education; "Your work" only ever counts work spaces.
  const workSpaces = useMemo(() => (spaces ?? []).filter((s) => s.kind === 'work'), [spaces])
  const liveSpaces = workSpaces.filter((s) => s.my_level && !s.archived_at)

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

  const loaded = myProjects !== null
  const hasSomething = mineProjects.length > 0 || liveSpaces.length > 0 || invitations.length > 0

  // Faculty always keep the New space / Join with code doors open, including
  // while this is still loading. Everyone else sees nothing until we know
  // there is something to show — no flash of an empty section on the way in.
  if (!faculty && (!loaded || !hasSomething)) return null

  return (
    <div className="mt-10">
      <div className="border-b border-line pb-4">
        <p className="text-[12px] font-medium text-faint">
          {isAdmin ? 'Projects and spaces' : 'Beyond your classes'}
        </p>
        <h2 className="mt-1">Your work</h2>
      </div>

      <div className="mt-6">
        <QuickActions
          actions={[
            ...(faculty
              ? [
                  {
                    icon: 'plus' as const,
                    label: 'New space',
                    hint: 'A place to hold projects',
                    onClick: () => setNewSpaceOpen(true),
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
              icon: 'kanban',
              label: 'Projects',
              hint: `${mineProjects.length} ${plural(mineProjects.length, 'project', 'projects')} you are on`,
              to: paths.projects,
            },
            {
              icon: 'folder',
              label: 'Spaces',
              hint: `${liveSpaces.length} ${plural(liveSpaces.length, 'space', 'spaces')} you are in`,
              to: paths.spaces,
            },
            {
              icon: 'message',
              label: 'Messages',
              hint: unread > 0 ? `${unread} unread` : 'Chats and project threads',
              to: `${paths.messages}?show=work`,
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
                {faculty
                  ? 'Make a space to hold your own projects, or join a project somebody else runs with the code they give you.'
                  : 'A faculty member can invite you into a space or onto a project. Your classes are listed above.'}
              </p>
              {faculty && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={() => setNewSpaceOpen(true)}>New space</Button>
                  <Button variant="ghost" onClick={() => setJoinOpen(true)}>
                    Join with code
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <JoinProjectDialog open={joinOpen} onClose={() => setJoinOpen(false)} />
      <NewSpaceDialog open={newSpaceOpen} onClose={() => setNewSpaceOpen(false)} onCreated={reload} />
    </div>
  )
}
