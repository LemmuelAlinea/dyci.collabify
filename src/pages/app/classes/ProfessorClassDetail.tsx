import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Alert } from '../../../components/ui/Field'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Modal } from '../../../components/ui/Modal'
import { Tabs } from '../../../components/ui/Tabs'
import { FilesPanel } from '../../../components/files/FilesPanel'
import { useToast } from '../../../components/ui/Toast'
import { AnnouncementFeed } from '../../../components/classes/AnnouncementFeed'
import { ClassAbout } from '../../../components/classes/ClassAbout'
import { ClassForm } from '../../../components/classes/ClassForm'
import { ClassHeader } from '../../../components/classes/ClassHeader'
import { RosterTable } from '../../../components/classes/RosterTable'
import { ClassGroupsTab } from '../../../components/groups/ClassGroupsTab'
import { ClassProjectsTab } from '../../../components/projects/ClassProjectsTab'
import { ClassSyllabusTab } from '../../../components/syllabus/ClassSyllabusTab'
import { useAuth } from '../../../context/AuthContext'
import { listAnnouncements } from '../../../lib/api/announcements'
import {
  deleteClassPermanently,
  getClass,
  listMembers,
  removeMember,
  setArchived,
  restoreMember,
  updateClass,
} from '../../../lib/api/classes'
import type { ClassInput } from '../../../lib/api/classes'
import { listResources } from '../../../lib/api/resources'
import { authErrorMessage } from '../../../lib/authError'
import type { Announcement, ClassMember, ClassSummary, TeachingResource } from '../../../lib/types'

type TabId =
  | 'announcements'
  | 'students'
  | 'groups'
  | 'projects'
  | 'files'
  | 'syllabus'
  | 'about'

export default function ProfessorClassDetail() {
  const { classId = '' } = useParams()
  const { profile } = useAuth()
  const { show } = useToast()
  const navigate = useNavigate()

  const [tab, setTab] = useState<TabId>('announcements')
  const [cls, setCls] = useState<ClassSummary | null>(null)
  const [members, setMembers] = useState<ClassMember[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [syllabi, setSyllabi] = useState<TeachingResource[]>([])
  const [curricula, setCurricula] = useState<TeachingResource[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [archivePrompt, setArchivePrompt] = useState(false)
  const [deletePrompt, setDeletePrompt] = useState(false)

  const load = useCallback(async () => {
    if (!classId) return
    try {
      const [c, m, a] = await Promise.all([
        getClass(classId),
        listMembers(classId, true),
        listAnnouncements(classId),
      ])
      setCls(c)
      setMembers(m)
      setAnnouncements(a)
      setError(c ? null : 'That class does not exist, or you do not have access to it.')
    } catch (err) {
      setError(authErrorMessage(err, 'Could not load that class.'))
    } finally {
      setLoading(false)
    }
  }, [classId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (cls) document.title = `${cls.name} · Collabify`
  }, [cls])

  useEffect(() => {
    if (!profile || !editOpen) return
    void Promise.all([
      listResources(profile.id, 'syllabus'),
      listResources(profile.id, 'curriculum'),
    ]).then(([s, c]) => {
      setSyllabi(s)
      setCurricula(c)
    })
  }, [profile, editOpen])

  async function saveEdits(input: ClassInput) {
    setEditError(null)
    setEditBusy(true)
    try {
      await updateClass(classId, input)
      setEditOpen(false)
      show('Class updated')
      await load()
    } catch (err) {
      setEditError(authErrorMessage(err, 'Could not save those changes.'))
    } finally {
      setEditBusy(false)
    }
  }

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

  const activeCount = members.filter((m) => m.status === 'active').length
  const removedCount = members.filter((m) => m.status === 'removed').length

  return (
    <div className="mx-auto w-full max-w-[900px]">
      <ClassHeader
        cls={cls}
        backTo="/professor/classes"
        canManage
        onToggleJoin={async (open) => {
          try {
            await updateClass(classId, { join_open: open })
            setCls({ ...cls, join_open: open })
            show(open ? 'Students can join again' : 'Joining closed')
          } catch (err) {
            show(authErrorMessage(err, 'Could not change that.'), 'error')
          }
        }}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="onNavy" size="sm" onClick={() => setEditOpen(true)}>
              <Icon name="edit" size={15} />
              Edit
            </Button>
            {cls.archived_at ? (
              <>
                <Button
                  variant="onNavy"
                  size="sm"
                  onClick={async () => {
                    await setArchived(classId, false)
                    show('Class restored')
                    await load()
                  }}
                >
                  Restore
                </Button>
                <Button variant="danger" size="sm" onClick={() => setDeletePrompt(true)}>
                  Delete
                </Button>
              </>
            ) : (
              <Button variant="onNavy" size="sm" onClick={() => setArchivePrompt(true)}>
                <Icon name="archive" size={15} />
                Archive
              </Button>
            )}
          </div>
        }
      />

      <div className="mt-8">
        <Tabs<TabId>
          tabs={[
            { id: 'announcements', label: 'Announcements', icon: 'message', count: announcements.length },
            {
              id: 'students',
              label: removedCount
                ? `Students · ${removedCount} removed`
                : 'Students',
              icon: 'users',
              count: activeCount,
            },
            { id: 'groups', label: 'Groups', icon: 'kanban' },
            { id: 'projects', label: 'Projects', icon: 'board' },
            { id: 'files', label: 'Files', icon: 'folder' },
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
            canManage={!cls.archived_at}
            onChanged={load}
          />
        )}

        {tab === 'students' && (
          <RosterTable
            members={members}
            canManage={!cls.archived_at}
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
        )}

        {tab === 'groups' && <ClassGroupsTab cls={cls} role="professor" />}
        {tab === 'projects' && (
          <ClassProjectsTab cls={cls} role="professor" viewerId={profile?.id} />
        )}
        {tab === 'syllabus' && (
          <ClassSyllabusTab cls={cls} role="professor" onClassChanged={load} />
        )}

        {tab === 'files' && <FilesPanel scope={{ classId }} />}

        {tab === 'about' && <ClassAbout cls={cls} />}
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit class"
        description="The join code never changes."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={editBusy}>
              Cancel
            </Button>
            <Button form="edit-class" type="submit" loading={editBusy} className="!rounded-xl">
              Save changes
            </Button>
          </>
        }
      >
        <ClassForm
          formId="edit-class"
          defaults={cls}
          syllabi={syllabi}
          curricula={curricula}
          error={editError}
          onSubmit={saveEdits}
        />
      </Modal>

      <ConfirmDialog
        open={archivePrompt}
        onClose={() => setArchivePrompt(false)}
        onConfirm={async () => {
          await setArchived(classId, true)
          show(`${cls.name} archived`)
          await load()
        }}
        title={`Archive ${cls.name}?`}
        body="Students lose access immediately and it disappears from their class list. The roster and announcements are kept, and you can restore it any time."
        confirmLabel="Archive class"
      />

      <ConfirmDialog
        open={deletePrompt}
        onClose={() => setDeletePrompt(false)}
        onConfirm={async () => {
          await deleteClassPermanently(classId)
          show(`${cls.name} deleted`)
          navigate('/professor/classes')
        }}
        title={`Delete ${cls.name} for good?`}
        body="The class, its roster, and every announcement are destroyed. This cannot be undone."
        confirmLabel="Delete permanently"
      />
    </div>
  )
}
