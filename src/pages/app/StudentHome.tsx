import { useEffect } from 'react'
import { ProgramNotices } from '../../components/app/ProgramNotices'
import { Reveal } from '../../components/motion/Reveal'
import { AnnouncementSwiper } from '../../components/dashboard/AnnouncementSwiper'
import { DashSection, StatRow } from '../../components/dashboard/DashSection'
import { DeadlineList } from '../../components/dashboard/DeadlineList'
import { ProjectStrip } from '../../components/dashboard/ProjectStrip'
import { StandingCard } from '../../components/dashboard/StandingCard'
import { TaskDigest } from '../../components/dashboard/TaskDigest'
import { TermStrip } from '../../components/dashboard/TermStrip'
import { WaitingOnYou } from '../../components/dashboard/WaitingOnYou'
import { ButtonLink } from '../../components/ui/Button'
import { Alert } from '../../components/ui/Field'
import { Spinner } from '../../components/ui/Icon'
import { EmptyState } from '../../components/ui/Tabs'
import { useAuth } from '../../context/AuthContext'
import { useUnreadTotal } from '../../hooks/useConversations'
import { useStudentDashboard } from '../../hooks/useStudentDashboard'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function StudentHome() {
  const { profile } = useAuth()
  const { data, error } = useStudentDashboard(profile?.id)
  const unread = useUnreadTotal(profile?.id)

  useEffect(() => {
    document.title = 'Dashboard · Collabify'
  }, [])

  if (!profile) return null

  const overdue = (data?.deadlines ?? []).filter(
    (d) => new Date(d.due_at).getTime() < Date.now(),
  ).length

  return (
    <div className="w-full">
      <Reveal once>
        <h1 className="text-[clamp(1.9rem,3.4vw,2.5rem)] leading-tight">
          {greeting()}, {profile.first_name}.
        </h1>
      </Reveal>

      <div className="mt-6">
        <ProgramNotices />
      </div>

      {error && (
        <div className="mt-6">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {!data ? (
        <div className="flex items-center gap-2.5 py-16 text-[14px] text-muted">
          <Spinner size={16} />
          Loading your dashboard…
        </div>
      ) : data.classes.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon="folder"
            art="classes"
            title="You are not in a class yet"
            body="Ask your professor for the class code, then join. Everything else — projects, groups, tasks — arrives with the class."
            action={
              <ButtonLink to="/student/classes" className="!rounded-xl">
                Join a class
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <div className="mt-7 space-y-9">
          <Reveal once delay={0.04}>
            <StatRow
              stats={[
                { label: 'Classes', value: data.classes.length, to: '/student/classes' },
                {
                  label: 'Tasks to finish',
                  value: data.tasks.length,
                  to: '/student/tasks',
                },
                {
                  label: overdue === 1 ? 'Deadline passed' : 'Deadlines passed',
                  value: overdue,
                  tone: overdue > 0 ? 'warn' : 'plain',
                },
                {
                  label: 'Projects open',
                  value: data.projects.filter((p) => !p.archived_at && !p.scheduled).length,
                  to: '/student/projects',
                },
              ]}
            />
          </Reveal>

          <Reveal once delay={0.06}>
            <WaitingOnYou
              unclaimed={data.unclaimed}
              unread={unread}
              openSets={data.openSets}
            />
          </Reveal>

          {data.announcements.length > 0 && (
            <Reveal once delay={0.08}>
              <DashSection
                icon="message"
                title="Announcements"
                count={data.announcements.length}
                seeAll="/student/classes"
                seeAllLabel="All classes"
              >
                <AnnouncementSwiper
                  announcements={data.announcements}
                  classes={data.classes}
                  linkBase="/student/classes"
                />
              </DashSection>
            </Reveal>
          )}

          <Reveal once delay={0.1}>
            <DashSection
              icon="clock"
              title="Due this week"
              count={data.deadlines.length}
              seeAll="/student/tasks"
            >
              <DeadlineList deadlines={data.deadlines} />
            </DashSection>
          </Reveal>

          <Reveal once delay={0.12}>
            <DashSection
              icon="check"
              title="Your unfinished tasks"
              count={data.tasks.length}
              seeAll="/student/tasks"
            >
              <TaskDigest tasks={data.tasks} />
            </DashSection>
          </Reveal>

          <Reveal once delay={0.14}>
            <DashSection icon="kanban" title="Projects you are on" seeAll="/student/projects">
              <ProjectStrip
                projects={data.projects}
                boards={data.boards}
                linkBase="/student/projects"
              />
            </DashSection>
          </Reveal>

          <Reveal once delay={0.16}>
            <DashSection icon="chart" title="Where you stand">
              <StandingCard rows={data.standing} />
            </DashSection>
          </Reveal>

          {data.currentWeeks.length > 0 && (
            <Reveal once delay={0.18}>
              <DashSection icon="calendar" title="Where the term is">
                <TermStrip
                  weeks={data.currentWeeks}
                  classes={data.classes}
                  linkBase="/student/classes"
                />
              </DashSection>
            </Reveal>
          )}
        </div>
      )}
    </div>
  )
}
