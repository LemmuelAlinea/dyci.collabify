import { useEffect } from 'react'
import { ProgramNotices } from '../../components/app/ProgramNotices'
import { Reveal } from '../../components/motion/Reveal'
import { AttentionList } from '../../components/dashboard/AttentionList'
import { ClassProgress } from '../../components/dashboard/ClassProgress'
import { ClassRail } from '../../components/dashboard/ClassRail'
import { DashSection } from '../../components/dashboard/DashSection'
import { Bento, BentoCell } from '../../components/dashboard/Bento'
import { DashboardSummary } from '../../components/dashboard/DashboardSummary'
import { StalledGroups } from '../../components/dashboard/StalledGroups'
import { ButtonLink } from '../../components/ui/Button'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Icon'
import { EmptyState } from '../../components/ui/EmptyState'
import { useAuth } from '../../context/AuthContext'
import { plural } from '../../lib/plural'
import { useProfessorDashboard } from '../../hooks/useProfessorDashboard'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/**
 * A professor's dashboard, laid out the way the student's is.
 *
 * The question it answers is a different one — not "what do I owe" but "what
 * needs me, and is anything going wrong" — so the summary line is built from
 * different figures. What is shared is the shape: one sentence of what is true
 * now, four counts you can press, then the things to act on down the main
 * column and the things to know beside it.
 *
 * The order in the main column is deliberate. **Needs your attention** is
 * first because everything in it is something only a professor can clear.
 * **Stalled groups** second: they are a person's problem rather than a
 * setting's, and they get worse quietly. Progress across the classes is last,
 * because it is a reading rather than a task.
 */
export default function ProfessorHome() {
  const { profile } = useAuth()
  const { data, error, reload } = useProfessorDashboard(profile?.id)

  useEffect(() => {
    document.title = 'Dashboard · Collabify'
  }, [])

  if (!profile) return null

  const live = (data?.projects ?? []).filter((p) => !p.archived_at && !p.scheduled)
  const classes = data?.classes ?? []
  const students = classes.reduce((n, c) => n + (c.student_count ?? 0), 0)
  const stalled = data?.stalled.length ?? 0
  const waiting = data?.attention.length ?? 0
  const notReady = classes.filter((c) => !c.syllabus_id || !c.term_start || !c.term_end).length

  // A professor is behind when something is sitting on them, or when a group
  // has gone quiet. A class that was never finished being set up counts too:
  // nothing in it can be measured until it is.
  const line =
    waiting > 0 || stalled > 0
      ? [
          waiting > 0
            ? `${waiting} ${plural(waiting, 'thing is', 'things are')} waiting on you.`
            : '',
          stalled > 0
            ? `${stalled} ${plural(stalled, 'group has', 'groups have')} stopped moving.`
            : '',
        ]
          .filter(Boolean)
          .join(' ')
      : notReady > 0
        ? `Every group is moving, but ${notReady} ${plural(notReady, 'class is', 'classes are')} not set up yet.`
        : live.length > 0
          ? `${live.length} ${plural(live.length, 'project is', 'projects are')} open and every group is moving.`
          : 'Nothing is waiting on you. Set a project when you are ready.'

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
        <div className="flex items-center gap-2.5 py-16 text-[14px] text-muted">
          <Spinner size={16} />
          Loading your dashboard…
        </div>
      ) : classes.length === 0 ? (
        <>
          <h1 className="leading-tight">
            {greeting()}, {profile.first_name}.
          </h1>
          <div className="mt-8">
            <EmptyState
              icon="folder"
              art="classes"
              title="No classes yet"
              body="Create a class and share its code with your section. Groups, projects, and everything on this page follow from it."
              action={
                <ButtonLink to="/professor/classes" className="!rounded-xl">
                  Create a class
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
              urgent={waiting > 0 || stalled > 0}
              tiles={[
                {
                  label: 'Waiting on you',
                  value: waiting,
                  icon: 'checkCircle',
                  tone: waiting > 0 ? 'warn' : 'plain',
                },
                {
                  label: stalled === 1 ? 'Group not moving' : 'Groups not moving',
                  value: stalled,
                  to: '/professor/projects',
                  icon: 'alert',
                  tone: stalled > 0 ? 'warn' : 'plain',
                },
                {
                  label: 'Projects open',
                  value: live.length,
                  to: '/professor/projects',
                  icon: 'kanban',
                },
                {
                  label: students === 1 ? 'Student' : 'Students',
                  value: students,
                  to: '/professor/classes',
                  icon: 'users',
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
                  <DashSection icon="checkCircle" title="Needs your attention" count={waiting}>
                    <AttentionList items={data.attention} />
                  </DashSection>
                </Reveal>
              </BentoCell>

              <BentoCell>
                <Reveal once delay={0.08}>
                  <DashSection
                    icon="folder"
                    title="Your classes"
                    count={classes.length}
                    seeAll="/professor/classes"
                  >
                    <ClassRail classes={classes} />
                  </DashSection>
                </Reveal>
              </BentoCell>

              <BentoCell>
                <Reveal once delay={0.12}>
                  <DashSection
                    icon="alert"
                    title="Groups that have stalled"
                    count={stalled}
                    seeAll="/professor/projects"
                  >
                    <StalledGroups boards={data.stalled} />
                  </DashSection>
                </Reveal>
              </BentoCell>

              {/* Wide: a progress table across every class needs the full row,
                  and packing it into a column squeezes the bars to noise. */}
              <BentoCell wide>
                <Reveal once delay={0.16}>
                  <DashSection
                    icon="chart"
                    title="Progress across your classes"
                    seeAll="/professor/projects"
                  >
                    <ClassProgress projects={data.projects} boards={data.boards} />
                  </DashSection>
                </Reveal>
              </BentoCell>
            </Bento>
          </div>
        </>
      )}
    </div>
  )
}
