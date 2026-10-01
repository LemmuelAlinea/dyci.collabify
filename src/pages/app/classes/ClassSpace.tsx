import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useLive } from '../../../hooks/useLive'
import { Alert } from '../../../components/ui/Alert'
import { Spinner } from '../../../components/ui/Icon'
import type { IconName } from '../../../components/ui/Icon'
import { Tabs } from '../../../components/ui/Tabs'
import { useToast } from '../../../components/ui/Toast'
import { AnnouncementFeed } from '../../../components/classes/AnnouncementFeed'
import { ClassAbout } from '../../../components/classes/ClassAbout'
import { ClassHeader } from '../../../components/classes/ClassHeader'
import { ClassSettings } from '../../../components/classes/ClassSettings'
import { FacultyPanel } from '../../../components/classes/FacultyPanel'
import { RosterTable } from '../../../components/classes/RosterTable'
import { ThisWeek } from '../../../components/classes/ThisWeek'
import { ClassGroupsTab } from '../../../components/groups/ClassGroupsTab'
import { ClassProjectsTab } from '../../../components/projects/ClassProjectsTab'
import { ClassSyllabusTab } from '../../../components/syllabus/ClassSyllabusTab'
import { useAuth } from '../../../context/AuthContext'
import { useGeneralNavigation } from '../../../context/generalNavigation'
import { listAnnouncements } from '../../../lib/api/announcements'
import { getClass, listMembers, removeMember, restoreMember, updateClass } from '../../../lib/api/classes'
import { currentWeekFor } from '../../../lib/api/dashboard'
import { authErrorMessage } from '../../../lib/authError'
import { classTabs, readClassTab, seatKnown, teachesClass } from '../../../lib/classSpace'
import type { ClassTab } from '../../../lib/classSpace'
import { paths } from '../../../lib/paths'
import type { Announcement, ClassMember, ClassSummary, ClassWeek } from '../../../lib/types'

// The faculty tabs pull in whole pages; students never load them.
const Submissions = lazy(() => import('../submissions/Submissions'))
const Analytics = lazy(() => import('../analytics/Analytics'))
const Reports = lazy(() => import('../reports/Reports'))

const TAB_META: Record<ClassTab, { label: string; icon: IconName }> = {
  overview: { label: 'Overview', icon: 'info' },
  projects: { label: 'Projects', icon: 'board' },
  groups: { label: 'Groups', icon: 'kanban' },
  members: { label: 'Members', icon: 'users' },
  syllabus: { label: 'Syllabus', icon: 'calendar' },
  submissions: { label: 'Submissions', icon: 'upload' },
  analytics: { label: 'Analytics', icon: 'chart' },
  reports: { label: 'Reports', icon: 'file' },
  settings: { label: 'Settings', icon: 'settings' },
}

/**
 * A class, opened as its education space. One page for everybody in it:
 * students get the shared tabs, and the faculty who teach it (its professor,
 * co-teachers and advisers) also get the teaching tabs. Which tab is open lives
 * in `?tab=`, so a link can open a class straight at its syllabus.
 */
function ClassSpaceView({ classId }: { classId: string }) {
  const { profile } = useAuth()
  const { spaces, error: navError, reload: reloadNav } = useGeneralNavigation()
  const { show } = useToast()
  const [params, setParams] = useSearchParams()

  const [cls, setCls] = useState<ClassSummary | null>(null)
  const [members, setMembers] = useState<ClassMember[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [weeks, setWeeks] = useState<ClassWeek[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const student = profile?.role === 'student'

  const load = useCallback(async () => {
    if (!classId) return
    try {
      const [c, m, a, w] = await Promise.all([
        getClass(classId),
        listMembers(classId, !student),
        listAnnouncements(classId),
        currentWeekFor([classId]).catch(() => [] as ClassWeek[]),
      ])
      setCls(c)
      setMembers(m)
      setAnnouncements(a)
      setWeeks(w)
      setError(
        c
          ? null
          : 'This class is no longer available. It may have been archived, or you are no longer in it.',
      )
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load that class.'))
    } finally {
      setLoading(false)
    }
  }, [classId, student])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['classes', 'class_members', 'projects', 'announcements', 'group_sets', 'groups', 'group_members', 'syllabus_weeks'])

  useEffect(() => {
    if (cls) document.title = `${cls.name} · Collabify`
  }, [cls])

  const myLevel = spaces?.find((s) => s.id === cls?.space_id)?.my_level ?? null
  const teaching = cls ? teachesClass(profile ?? null, cls.professor_id, myLevel) : false
  // A co-teacher's seat comes from the space list; until it arrives, don't
  // draw the student version of the page and then swap it.
  const knowsSeat = cls
    ? seatKnown(profile?.role, profile?.id, cls.professor_id, spaces !== null)
    : false
  const tab = readClassTab(params.get('tab'), teaching)

  const setTab = (next: ClassTab) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        if (next === 'overview') out.delete('tab')
        else out.set('tab', next)
        return out
      },
      { replace: true },
    )

  if (cls && !knowsSeat && navError) {
    return (
      <div className="mx-auto w-full max-w-[560px] py-10">
        <Alert tone="error" onRetry={reloadNav}>
          {navError}
        </Alert>
      </div>
    )
  }

  if (loading || (cls && !knowsSeat)) {
    return (
      <div className="flex items-center gap-3 py-16 text-[14px] text-muted">
        <Spinner size={16} />
        Loading class…
      </div>
    )
  }

  if (!cls) {
    return (
      <div className="mx-auto w-full max-w-[560px] py-10">
        <Alert tone="error">{error ?? 'That class could not be loaded.'}</Alert>
      </div>
    )
  }

  const active = members.filter((m) => m.status === 'active')
  const removedCount = members.filter((m) => m.status === 'removed').length
  const canManage = teaching && !cls.archived_at

  const tabs = classTabs(teaching).map((id) => ({
    id,
    icon: TAB_META[id].icon,
    label:
      id === 'members' && teaching && removedCount
        ? `Members · ${removedCount} removed`
        : TAB_META[id].label,
    count:
      id === 'overview' ? announcements.length : id === 'members' ? active.length : undefined,
  }))

  const pageLoading = (
    <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
      <Spinner size={16} />
      Loading…
    </div>
  )

  return (
    <div className="w-full">
      <div className="print:hidden">
        <ClassHeader
          cls={cls}
          backTo={paths.classes}
          canManage={teaching}
          onToggleJoin={
            teaching
              ? async (open) => {
                  try {
                    await updateClass(classId, { join_open: open })
                    setCls({ ...cls, join_open: open })
                    show(open ? 'Students can join again' : 'Joining closed')
                  } catch (err) {
                    show(authErrorMessage(err, 'Could not change that.'), 'error')
                  }
                }
              : undefined
          }
        />

        <div className="mt-6">
          <Tabs<ClassTab> tabs={tabs} active={tab} onChange={setTab} variant="panel" />
        </div>
      </div>

      <div className="mx-auto mt-6 w-full max-w-[1280px]">
        {tab === 'overview' && (
          <div className="space-y-6">
            <ThisWeek cls={cls} weeks={weeks} />
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0">
                {profile && (
                  <AnnouncementFeed
                    classId={classId}
                    authorId={profile.id}
                    announcements={announcements}
                    canManage={canManage}
                    onChanged={load}
                  />
                )}
              </div>
              <aside className="min-w-0">
                <ClassAbout cls={cls} />
              </aside>
            </div>
          </div>
        )}

        {tab === 'projects' && (
          <ClassProjectsTab
            cls={cls}
            role={teaching ? 'professor' : 'student'}
            viewerId={profile?.id}
          />
        )}

        {tab === 'groups' &&
          (teaching ? (
            <ClassGroupsTab cls={cls} role="professor" />
          ) : (
            <ClassGroupsTab cls={cls} role="student" viewerId={profile?.id} />
          ))}

        {tab === 'members' && (
          <div className="space-y-6">
            <FacultyPanel cls={cls} />
            <section className="space-y-3">
              <h2 className="text-[15px]">Students</h2>
              {teaching ? (
                <RosterTable
                  members={members}
                  canManage={canManage}
                  canMessage
                  classId={classId}
                  onRecovered={load}
                  showEmail
                  emptyBody={`Share the code ${cls.code} with your section. Students join themselves — you never add them by hand.`}
                  onRemove={async (m) => {
                    if (!profile) return
                    await removeMember(classId, m.student_id, profile.id)
                    await load()
                  }}
                  onRestore={async (m) => {
                    const res = await restoreMember(classId, m.student_id)
                    await load()
                    return res
                  }}
                />
              ) : (
                <RosterTable
                  members={members}
                  canManage={false}
                  showEmail={false}
                  emptyBody="You're the first one here. Others show up as they join with the code."
                />
              )}
            </section>
          </div>
        )}

        {tab === 'syllabus' &&
          (teaching ? (
            <ClassSyllabusTab cls={cls} role="professor" onClassChanged={load} />
          ) : (
            <ClassSyllabusTab cls={cls} role="student" />
          ))}

        {tab === 'submissions' && (
          <Suspense fallback={pageLoading}>
            <Submissions classId={classId} />
          </Suspense>
        )}
        {tab === 'analytics' && (
          <Suspense fallback={pageLoading}>
            <Analytics classId={classId} />
          </Suspense>
        )}
        {tab === 'reports' && (
          <Suspense fallback={pageLoading}>
            <Reports classId={classId} />
          </Suspense>
        )}
        {tab === 'settings' && <ClassSettings cls={cls} onChanged={load} />}
      </div>
    </div>
  )
}

export default function ClassSpace() {
  const { classId = '' } = useParams()
  // Keyed by class: moving to another class starts clean instead of showing
  // (and editing) the last one's state.
  return <ClassSpaceView key={classId} classId={classId} />
}
