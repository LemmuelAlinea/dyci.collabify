import { useEffect } from 'react'
import { ProgramNotices } from '../../components/app/ProgramNotices'
import { Reveal } from '../../components/motion/Reveal'
import { AnnouncementSwiper } from '../../components/dashboard/AnnouncementSwiper'
import { DashSection } from '../../components/dashboard/DashSection'
import { Bento, BentoCell } from '../../components/dashboard/Bento'
import { DeadlineList } from '../../components/dashboard/DeadlineList'
import { ProjectStrip } from '../../components/dashboard/ProjectStrip'
import { StandingCard } from '../../components/dashboard/StandingCard'
import { DashboardSummary } from '../../components/dashboard/DashboardSummary'
import { TaskDigest } from '../../components/dashboard/TaskDigest'
import { TermStrip } from '../../components/dashboard/TermStrip'
import { WaitingOnYou } from '../../components/dashboard/WaitingOnYou'
import { ButtonLink } from '../../components/ui/Button'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Icon'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../context/AuthContext'
import { plural } from '../../lib/plural'
import { useUnreadTotal } from '../../hooks/useConversations'
import { useStudentDashboard } from '../../hooks/useStudentDashboard'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * A student's dashboard.
 *
 * It used to be eight sections of equal weight stacked in one column, which
 * meant nothing led: the numbers, the announcements, the term strip and the
 * work all shouted at the same volume, and the largest thing on the page was a
 * greeting that told a student their own name.
 *
 * It reads in two passes now. **What is on me** — the summary line and four
 * figures, then the work itself, down the main column in the order somebody
 * actually needs it: what is due, what they hold, what it belongs to. **What is
 * going on around me** — anything waiting, what the class is saying, how they
 * are doing, where the term is — sits in a narrower column beside it, because
 * it is context rather than a thing to act on.
 *
 * On a phone the columns collapse and that same order is what you scroll
 * through, so the priority survives the layout rather than depending on it.
 */
export default function StudentHome() {
  const { profile } = useAuth()
  const { data, error, reload } = useStudentDashboard(profile?.id)
  const unread = useUnreadTotal(profile?.id)

  useEffect(() => {
    document.title = 'Dashboard · Collabify'
  }, [])

  if (!profile) return null

  const now = Date.now()
  const deadlines = data?.deadlines ?? []
  const overdue = deadlines.filter((d) => new Date(d.due_at).getTime() < now).length
  const dueThisWeek = deadlines.length - overdue
  const openProjects = (data?.projects ?? []).filter(
    (p) => !p.archived_at && !p.scheduled,
  ).length
  const tasksInHand = data?.tasks.length ?? 0

  // A student is behind when a deadline has gone by. Everything else is a
  // report on how the week looks.
  const line =
    overdue > 0
      ? `${overdue} ${plural(overdue, 'deadline has', 'deadlines have')} already passed.` +
        (dueThisWeek > 0
          ? ` Another ${dueThisWeek} ${plural(dueThisWeek, 'is', 'are')} due this week.`
          : '')
      : dueThisWeek > 0
        ? `${dueThisWeek} ${plural(dueThisWeek, 'deadline', 'deadlines')} this week, and nothing overdue.`
        : tasksInHand > 0
          ? `${tasksInHand} ${plural(tasksInHand, 'task', 'tasks')} in hand, and nothing due this week.`
          : 'Nothing is waiting on you right now.'

  return (
    <div className="w-full">
      {error && (
        <div className="mb-6">
          <Alert tone="error" onRetry={reload}>
            {error}
          </Alert>
        </div>
      )}

      {!data ? (
        <div className="flex items-center gap-3 py-16 text-[14px] text-muted">
          <Spinner size={16} />
          Loading your dashboard…
        </div>
      ) : data.classes.length === 0 ? (
        <>
          <h1 className="leading-tight">
            {greeting()}, {profile.first_name}.
          </h1>
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
        </>
      ) : (
        <>
          <Reveal once>
            <DashboardSummary
              greeting={greeting()}
              name={profile.first_name}
              line={line}
              urgent={overdue > 0}
              tiles={[
                {
                  label: 'Tasks to finish',
                  value: data.tasks.length,
                  to: '/student/tasks',
                  icon: 'check',
                },
                {
                  label: overdue === 1 ? 'Deadline passed' : 'Deadlines passed',
                  value: overdue,
                  to: '/student/tasks',
                  icon: 'clock',
                  tone: overdue > 0 ? 'warn' : 'plain',
                },
                {
                  label: 'Projects open',
                  value: openProjects,
                  to: '/student/projects',
                  icon: 'kanban',
                },
                {
                  label: data.classes.length === 1 ? 'Class' : 'Classes',
                  value: data.classes.length,
                  to: '/student/classes',
                  icon: 'folder',
                },
              ]}
            />
          </Reveal>

          <div className="mt-7 md:mt-8">
            <ProgramNotices />
          </div>

          <div className="mt-7 md:mt-8">
            <Bento>
              <BentoCell>
                <Reveal once delay={0.04}>
                  <DashSection
                    icon="clock"
                    title="Due this week"
                    count={deadlines.length}
                    seeAll="/student/tasks"
                  >
                    <DeadlineList deadlines={deadlines} />
                  </DashSection>
                </Reveal>
              </BentoCell>

              <BentoCell>
                <Reveal once delay={0.08}>
                  <WaitingOnYou
                    unclaimed={data.unclaimed}
                    unread={unread}
                    openSets={data.openSets}
                    stacked
                  />
                </Reveal>
              </BentoCell>

              <BentoCell>
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
              </BentoCell>

              {data.announcements.length > 0 && (
                <BentoCell>
                  <Reveal once delay={0.16}>
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
                </BentoCell>
              )}

              <BentoCell>
                <Reveal once delay={0.2}>
                  <DashSection
                    icon="kanban"
                    title="Projects you are on"
                    seeAll="/student/projects"
                  >
                    <ProjectStrip
                      projects={data.projects}
                      boards={data.boards}
                      linkBase="/student/projects"
                    />
                  </DashSection>
                </Reveal>
              </BentoCell>

              <BentoCell>
                <Reveal once delay={0.24}>
                  <DashSection icon="chart" title="Where you stand">
                    <StandingCard rows={data.standing} />
                  </DashSection>
                </Reveal>
              </BentoCell>

              {data.currentWeeks.length > 0 && (
                <BentoCell>
                  <Reveal once delay={0.28}>
                    <DashSection icon="calendar" title="Where the term is">
                      <TermStrip
                        weeks={data.currentWeeks}
                        classes={data.classes}
                        linkBase="/student/classes"
                      />
                    </DashSection>
                  </Reveal>
                </BentoCell>
              )}
            </Bento>
          </div>
        </>
      )}
    </div>
  )
}
