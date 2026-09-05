import { useCallback, useEffect, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { useParams } from 'react-router-dom'
import { Alert } from '../../../components/ui/Alert'
import { Spinner } from '../../../components/ui/Icon'
import { Tabs } from '../../../components/ui/Tabs'
import { AnnouncementFeed } from '../../../components/classes/AnnouncementFeed'
import { ClassAbout } from '../../../components/classes/ClassAbout'
import { ClassHeader } from '../../../components/classes/ClassHeader'
import { RosterTable } from '../../../components/classes/RosterTable'
import { ClassGroupsTab } from '../../../components/groups/ClassGroupsTab'
import { ClassProjectsTab } from '../../../components/projects/ClassProjectsTab'
import { ClassSyllabusTab } from '../../../components/syllabus/ClassSyllabusTab'
import { useAuth } from '../../../context/AuthContext'
import { listAnnouncements } from '../../../lib/api/announcements'
import { getClass, listMembers } from '../../../lib/api/classes'
import { authErrorMessage } from '../../../lib/authError'
import type { Announcement, ClassMember, ClassSummary } from '../../../lib/types'

type TabId = 'announcements' | 'classmates' | 'groups' | 'projects' | 'syllabus' | 'about'

export default function StudentClassDetail() {
  const { classId = '' } = useParams()
  const { profile } = useAuth()

  const [tab, setTab] = useState<TabId>('announcements')
  const [cls, setCls] = useState<ClassSummary | null>(null)
  const [members, setMembers] = useState<ClassMember[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!classId) return
    try {
      const [c, m, a] = await Promise.all([
        getClass(classId),
        listMembers(classId),
        listAnnouncements(classId),
      ])
      setCls(c)
      setMembers(m)
      setAnnouncements(a)
      setError(
        c
          ? null
          : 'This class is no longer available. Your professor may have archived it, or removed you from the roster.',
      )
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load that class.'))
    } finally {
      setLoading(false)
    }
  }, [classId])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['classes', 'class_members', 'projects', 'announcements', 'group_sets', 'groups', 'group_members', 'syllabus_weeks'])

  useEffect(() => {
    if (cls) document.title = `${cls.name} · Collabify`
  }, [cls])

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 py-16 text-[14px] text-muted">
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

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <ClassHeader cls={cls} backTo="/student/classes" canManage={false} />

      <div className="mt-8">
        <Tabs<TabId>
          tabs={[
            { id: 'announcements', label: 'Announcements', icon: 'message', count: announcements.length },
            { id: 'classmates', label: 'Classmates', icon: 'users', count: members.length },
            { id: 'groups', label: 'Groups', icon: 'kanban' },
            { id: 'projects', label: 'Projects', icon: 'board' },
            { id: 'syllabus', label: 'Syllabus', icon: 'calendar' },
            { id: 'about', label: 'About', icon: 'info' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      <div className="mt-6">
        {tab === 'announcements' && profile && (
          <AnnouncementFeed
            classId={classId}
            authorId={profile.id}
            announcements={announcements}
            canManage={false}
            onChanged={load}
          />
        )}

        {tab === 'classmates' && (
          <RosterTable
            members={members}
            canManage={false}
            showEmail={false}
            emptyBody="You're the first one here. Others show up as they join with the code."
          />
        )}

        {tab === 'groups' && (
          <ClassGroupsTab cls={cls} role="student" viewerId={profile?.id} />
        )}

        {tab === 'projects' && (
          <ClassProjectsTab cls={cls} role="student" viewerId={profile?.id} />
        )}

        {tab === 'syllabus' && <ClassSyllabusTab cls={cls} role="student" />}

        {tab === 'about' && <ClassAbout cls={cls} />}
      </div>
    </div>
  )
}
