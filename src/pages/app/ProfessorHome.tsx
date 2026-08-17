import { useEffect } from 'react'
import { Reveal } from '../../components/motion/Reveal'
import { AttentionList } from '../../components/dashboard/AttentionList'
import { ClassProgress } from '../../components/dashboard/ClassProgress'
import { DashSection, StatRow } from '../../components/dashboard/DashSection'
import { StalledGroups } from '../../components/dashboard/StalledGroups'
import { ButtonLink } from '../../components/ui/Button'
import { Alert } from '../../components/ui/Field'
import { Spinner } from '../../components/ui/Icon'
import { EmptyState } from '../../components/ui/Tabs'
import { useAuth } from '../../context/AuthContext'
import { useProfessorDashboard } from '../../hooks/useProfessorDashboard'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function ProfessorHome() {
  const { profile } = useAuth()
  const { data, error } = useProfessorDashboard(profile?.id)

  useEffect(() => {
    document.title = 'Dashboard · Collabify'
  }, [])

  if (!profile) return null

  const live = (data?.projects ?? []).filter((p) => !p.archived_at && !p.scheduled)
  const students = (data?.classes ?? []).reduce((n, c) => n + (c.student_count ?? 0), 0)

  return (
    <div className="mx-auto w-full max-w-[1080px]">
      <Reveal once>
        <p className="eyebrow text-amber-500 dark:text-amber-300">Teaching workspace</p>
        <h1 className="mt-3 text-[clamp(1.9rem,3.4vw,2.5rem)] leading-tight">
          {greeting()}, {profile.first_name}.
        </h1>
      </Reveal>

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
            title="No classes yet"
            body="Create a class and share its code with your section. Groups, projects, and everything on this page follow from it."
            action={
              <ButtonLink to="/professor/classes" className="!rounded-xl">
                Create a class
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <div className="mt-7 space-y-9">
          <Reveal once delay={0.04}>
            <StatRow
              stats={[
                { label: 'Classes', value: data.classes.length, to: '/professor/classes' },
                { label: 'Students', value: students, to: '/professor/classes' },
                { label: 'Projects open', value: live.length, to: '/professor/projects' },
                {
                  label:
                    data.stalled.length === 1 ? 'Group not moving' : 'Groups not moving',
                  value: data.stalled.length,
                  tone: data.stalled.length > 0 ? 'warn' : 'plain',
                },
              ]}
            />
          </Reveal>

          <Reveal once delay={0.06}>
            <DashSection
              icon="alert"
              title="Groups that have stalled"
              count={data.stalled.length}
              seeAll="/professor/projects"
            >
              <StalledGroups boards={data.stalled} />
            </DashSection>
          </Reveal>

          <Reveal once delay={0.08}>
            <DashSection
              icon="chart"
              title="Progress across your classes"
              seeAll="/professor/projects"
            >
              <ClassProgress projects={data.projects} boards={data.boards} />
            </DashSection>
          </Reveal>

          <Reveal once delay={0.1}>
            <DashSection
              icon="checkCircle"
              title="Needs your attention"
              count={data.attention.length}
            >
              <AttentionList items={data.attention} />
            </DashSection>
          </Reveal>
        </div>
      )}
    </div>
  )
}
