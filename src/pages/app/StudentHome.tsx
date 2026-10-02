import { useEffect, useState } from 'react'
import { ProgramNotices } from '../../components/app/ProgramNotices'
import { Reveal } from '../../components/motion/Reveal'
import { AnnouncementSwiper } from '../../components/dashboard/AnnouncementSwiper'
import { BentoGrid, BentoTile } from '../../components/dashboard/Bento'
import { DeadlineList } from '../../components/dashboard/DeadlineList'
import { ProjectStrip } from '../../components/dashboard/ProjectStrip'
import { StandingCard } from '../../components/dashboard/StandingCard'
import { DashboardSummary } from '../../components/dashboard/DashboardSummary'
import { IconAction } from '../../components/ui/IconAction'
import { TaskDigest } from '../../components/dashboard/TaskDigest'
import { TermStrip } from '../../components/dashboard/TermStrip'
import { WaitingOnYou } from '../../components/dashboard/WaitingOnYou'
import { Button } from '../../components/ui/Button'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Icon'
import { EmptyState } from '../../components/ui/EmptyState'
import { JoinClassDialog } from '../../components/classes/JoinClassDialog'
import { useAuth } from '../../context/AuthContext'
import { plural } from '../../lib/plural'
import { useUnreadTotal } from '../../hooks/useConversations'
import { useStudentDashboard } from '../../hooks/useStudentDashboard'
import { useNow } from '../../hooks/useNow'
import { paths } from '../../lib/paths'

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
export default function StudentHome({ onSwitch }: { onSwitch?: () => void } = {}) {
  const { profile } = useAuth()
  const { data, error, reload } = useStudentDashboard(profile?.id)
  const unread = useUnreadTotal(profile?.id)
  const [joinOpen, setJoinOpen] = useState(false)
  const now = useNow()

  useEffect(() => {
    document.title = 'Dashboard · Collabify'
  }, [])

  if (!profile) return null

  // On `/home`, a student who also has work sees this or their work dashboard.
  const switchAction = onSwitch ? (
    <IconAction icon="swap" label="Switch to your work dashboard" onClick={onSwitch} />
  ) : undefined

  const deadlines = data?.deadlines ?? []
  const overdue = deadlines.filter((d) => new Date(d.due_at).getTime() < now).length
  const dueThisWeek = deadlines.length - overdue
  const openProjects = (data?.projects ?? []).filter(
    (p) => !p.archived_at && !p.scheduled,
  ).length
  const tasksInHand = data?.tasks.length ?? 0
  const hasAnnouncements = (data?.announcements.length ?? 0) > 0
  const hasTerm = (data?.currentWeeks.length ?? 0) > 0

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
          <div className="flex items-start justify-between gap-3">
            <h1 className="leading-tight">
              {greeting()}, {profile.first_name}.
            </h1>
            {switchAction}
          </div>
          <div className="mt-8">
            <EmptyState
              icon="folder"
              art="classes"
              title="You are not in a class yet"
              body="Enter the code your professor gives you. Your projects, groups and tasks arrive with the class."
              action={
                <Button onClick={() => setJoinOpen(true)} className="!rounded-xl">
                  Join a class
                </Button>
              }
            />
          </div>
        </>
      ) : (
        <>
          <Reveal once>
            <DashboardSummary
              greeting={greeting()}
              kicker="Your term"
              name={profile.first_name}
              corner={switchAction}
              line={line}
              urgent={overdue > 0}
              tiles={[
                {
                  label: 'Tasks to finish',
                  value: data.tasks.length,
                  to: paths.tasks,
                  icon: 'check',
                },
                {
                  label: overdue === 1 ? 'Deadline passed' : 'Deadlines passed',
                  value: overdue,
                  to: paths.tasks,
                  icon: 'clock',
                  tone: overdue > 0 ? 'warn' : 'plain',
                },
                {
                  label: 'Projects open',
                  value: openProjects,
                  to: paths.classProjects,
                  icon: 'kanban',
                },
                {
                  label: data.classes.length === 1 ? 'Class' : 'Classes',
                  value: data.classes.length,
                  to: paths.classes,
                  icon: 'folder',
                },
              ]}
            />
          </Reveal>

          <div className="mt-7 md:mt-8">
            <ProgramNotices />
          </div>

          {/* A true bento: every tile sits in one rectangle. On a wide screen,
              Due and Tasks run two rows down the first two columns,
              Announcements and Projects stack in the third, and the last row
              is Waiting, Where you stand and the term. A missing tile lets its
              neighbour take the room, so the edges stay square. */}
          <BentoGrid className="mt-7 md:mt-8">
            <Reveal once delay={0.04} className="flex xl:col-start-1 xl:row-span-2 xl:row-start-1">
              <BentoTile
                className="w-full"
                icon="clock"
                title="Due this week"
                count={deadlines.length}
                seeAll={paths.tasks}
              >
                <DeadlineList deadlines={deadlines} />
              </BentoTile>
            </Reveal>

            <Reveal once delay={0.08} className="flex xl:col-start-2 xl:row-span-2 xl:row-start-1">
              <BentoTile
                className="w-full"
                icon="check"
                title="Your unfinished tasks"
                count={data.tasks.length}
                seeAll={paths.tasks}
              >
                <TaskDigest tasks={data.tasks} />
              </BentoTile>
            </Reveal>

            {hasAnnouncements && (
              <Reveal once delay={0.12} className="flex md:col-span-2 xl:col-span-1 xl:col-start-3 xl:row-start-1">
                <BentoTile
                  className="w-full"
                  icon="message"
                  title="Announcements"
                  count={data.announcements.length}
                  seeAll={paths.classes}
                  seeAllLabel="All classes"
                >
                  <AnnouncementSwiper
                    announcements={data.announcements}
                    classes={data.classes}
                    linkBase={paths.classes}
                  />
                </BentoTile>
              </Reveal>
            )}

            <Reveal
              once
              delay={0.16}
              className={`flex md:col-span-2 xl:col-span-1 xl:col-start-3 ${
                hasAnnouncements ? 'xl:row-start-2' : 'xl:row-span-2 xl:row-start-1'
              }`}
            >
              <BentoTile
                className="w-full"
                icon="kanban"
                title="Projects you are on"
                seeAll={paths.classProjects}
              >
                <ProjectStrip
                  projects={data.projects}
                  boards={data.boards}
                  linkBase={paths.classProjects}
                />
              </BentoTile>
            </Reveal>

            <Reveal once delay={0.2} className="flex xl:col-start-1 xl:row-start-3">
              <BentoTile className="w-full" icon="bell" title="Waiting on you">
                <WaitingOnYou unclaimed={data.unclaimed} unread={unread} openSets={data.openSets} />
              </BentoTile>
            </Reveal>

            <Reveal
              once
              delay={0.24}
              className={`flex xl:col-start-2 xl:row-start-3 ${hasTerm ? '' : 'xl:col-span-2'}`}
            >
              <BentoTile className="w-full" icon="chart" title="Where you stand">
                <StandingCard rows={data.standing} />
              </BentoTile>
            </Reveal>

            {hasTerm && (
              <Reveal once delay={0.28} className="flex md:col-span-2 xl:col-span-1 xl:col-start-3 xl:row-start-3">
                <BentoTile className="w-full" icon="calendar" title="Where the term is">
                  <TermStrip
                    weeks={data.currentWeeks}
                    classes={data.classes}
                    linkBase={paths.classes}
                    flat
                  />
                </BentoTile>
              </Reveal>
            )}
          </BentoGrid>
        </>
      )}

      <JoinClassDialog open={joinOpen} onClose={() => setJoinOpen(false)} onJoined={reload} />
    </div>
  )
}
