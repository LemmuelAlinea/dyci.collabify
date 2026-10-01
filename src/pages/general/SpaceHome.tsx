import { useEffect } from 'react'
import { Reveal } from '../../components/motion/Reveal'
import { Bento, BentoCell } from '../../components/dashboard/Bento'
import { DashSection } from '../../components/dashboard/DashSection'
import {
  ComingUpPanel,
  MyTasksPanel,
  RecentPanel,
  WaitingPanel,
} from '../../components/general/DashboardPanels'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Spinner } from '../../components/ui/Icon'
import { useAuth } from '../../context/AuthContext'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { isFaculty } from '../../lib/access'
import { comingUp, myTasks, recentProjects } from '../../lib/general/dashboard'
import { useSpaceOutlet } from './spaceOutlet'

/**
 * A space's Overview tab: what is on you, then where you left off. Each row
 * opens the exact task or tab it names. The full project list is the Projects
 * tab; the banner above holds New project and Join with code.
 *
 * Everybody in the space can see all of its projects — being on a project is
 * what decides who can change it.
 */
export default function SpaceHome() {
  const { profile } = useAuth()
  const { currentSpace: space, projects, error: navigationError, reload: reloadNavigation } = useGeneralNavigation()
  const { all, dashboard, canStart, openNewProject } = useSpaceOutlet()
  const { data, error: dashError, reload } = dashboard

  useEffect(() => {
    document.title = space ? `${space.name} · Collabify` : 'Space · Collabify'
  }, [space])

  const error = navigationError ?? dashError
  const now = data?.at ?? 0
  const names = new Map(all.map((p) => [p.id, p.name]))
  const projectName = (id: string) => names.get(id) ?? 'A project'
  const mine = profile && data ? myTasks(data.tasks, profile.id) : []
  const reviews = data?.reviews ?? []
  const requests = all.filter((p) => p.my_level === 'owner' && p.open_request_count > 0)
  const waiting = reviews.length + requests.reduce((n, p) => n + p.open_request_count, 0)
  const days = data ? comingUp(data.tasks, all, now) : []

  return (
    <div className="space-y-8">
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
              <Button onClick={openNewProject} className="!rounded-xl">
                New project
              </Button>
            ) : undefined
          }
        />
      ) : (
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
      )}
    </div>
  )
}
