import { useCallback, useEffect, useState } from 'react'
import { useLive } from '../../../hooks/useLive'
import { Button } from '../../../components/ui/Button'
import { Alert } from '../../../components/ui/Alert'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ClassCard } from '../../../components/classes/ClassCard'
import { JoinClassDialog } from '../../../components/classes/JoinClassDialog'
import { DirectoryHero } from '../../../components/app/DirectoryHero'
import { useAuth } from '../../../context/AuthContext'
import { listStudentClasses } from '../../../lib/api/classes'
import { authErrorMessage } from '../../../lib/authError'
import type { ClassSummary } from '../../../lib/types'

export default function StudentClasses() {
  const { profile } = useAuth()

  const [classes, setClasses] = useState<ClassSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [joinOpen, setJoinOpen] = useState(false)

  useEffect(() => {
    document.title = 'Classes · Collabify'
  }, [])

  const load = useCallback(async () => {
    if (!profile) return
    try {
      setClasses(await listStudentClasses(profile.id))
      setLoadError(null)
    } catch (err) {
      setLoadError(authErrorMessage(err, 'Could not load your classes.'))
      setClasses([])
    }
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  useLive(load, ['classes', 'class_members'])

  const peerTotal = classes?.reduce((total, cls) => total + cls.student_count, 0) ?? 0

  return (
    <div className="w-full">
      <DirectoryHero
        title="Every class, one"
        accent="shared rhythm."
        description="Move from announcements to projects and group work without losing the class, term or people each decision belongs to."
        action={
          <Button variant="accent" onClick={() => setJoinOpen(true)}>
            <Icon name="plus" size={17} />
            Join a class
          </Button>
        }
        stats={[
          { value: classes === null ? '—' : classes.length, label: 'Classes this term' },
          { value: classes === null ? '—' : peerTotal, label: 'Classmates across classes' },
        ]}
      />

      <div className="mt-8 border-b border-line pb-4">
        <p className="text-[12px] font-medium text-faint">Class directory</p>
        <h2 className="mt-1">Your term</h2>
      </div>

      <div className="mt-5">
        {loadError && <Alert tone="error">{loadError}</Alert>}

        {classes === null ? (
          <div className="flex items-center gap-3 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading classes…
          </div>
        ) : classes.length === 0 ? (
          <EmptyState
            icon="board"
            art="classes"
            title="You haven't joined a class yet"
            body="Ask your professor for the class code — it looks like DBM-7823 — then enter it here."
            action={
              <Button onClick={() => setJoinOpen(true)} className="!rounded-xl">
                Join a class
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:gap-5">
            {classes.map((c, index) => (
              <ClassCard
                key={c.id}
                cls={c}
                to={`/student/classes/${c.id}`}
                audience="student"
                index={index}
              />
            ))}
          </div>
        )}
      </div>

      <JoinClassDialog open={joinOpen} onClose={() => setJoinOpen(false)} onJoined={load} />
    </div>
  )
}
