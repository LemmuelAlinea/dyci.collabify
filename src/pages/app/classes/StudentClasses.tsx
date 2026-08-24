import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../../components/ui/Button'
import { Alert, Field, Input } from '../../../components/ui/Field'
import { Icon, Spinner } from '../../../components/ui/Icon'
import { Modal } from '../../../components/ui/Modal'
import { EmptyState } from '../../../components/ui/Tabs'
import { useToast } from '../../../components/ui/Toast'
import { ClassCard } from '../../../components/classes/ClassCard'
import { useAuth } from '../../../context/AuthContext'
import { JOIN_MESSAGE, joinClass, listStudentClasses } from '../../../lib/api/classes'
import { authErrorMessage } from '../../../lib/authError'
import type { ClassSummary } from '../../../lib/types'

export default function StudentClasses() {
  const { profile } = useAuth()
  const { show } = useToast()
  const navigate = useNavigate()

  const [classes, setClasses] = useState<ClassSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [joinOpen, setJoinOpen] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

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

  async function submit(e: FormEvent) {
    e.preventDefault()
    setJoinError(null)
    setBusy(true)
    try {
      const { result, class_id } = await joinClass(code)
      if (result === 'joined') {
        setJoinOpen(false)
        setCode('')
        show('You joined the class')
        await load()
        if (class_id) navigate(`/student/classes/${class_id}`)
      } else if (result === 'already_member' && class_id) {
        setJoinOpen(false)
        setCode('')
        navigate(`/student/classes/${class_id}`)
      } else {
        setJoinError(JOIN_MESSAGE[result])
      }
    } catch (err) {
      setJoinError(authErrorMessage(err, 'Could not join that class.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1080px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-amber-500 dark:text-amber-300">Workspace</p>
          <h1 className="mt-3 text-[clamp(1.9rem,3.4vw,2.5rem)] leading-tight">Classes</h1>
          <p className="mt-2.5 max-w-[560px] text-[15.5px] text-muted">
            Every class you've joined this term. Your professor gives you the code.
          </p>
        </div>
        <Button onClick={() => setJoinOpen(true)} className="!rounded-xl">
          <Icon name="plus" size={17} />
          Join a class
        </Button>
      </header>

      <div className="mt-8">
        {loadError && <Alert tone="error">{loadError}</Alert>}

        {classes === null ? (
          <div className="flex items-center gap-2.5 py-10 text-[14px] text-muted">
            <Spinner size={16} />
            Loading classes…
          </div>
        ) : classes.length === 0 ? (
          <EmptyState
            icon="board"
            title="You haven't joined a class yet"
            body="Ask your professor for the class code — it looks like DBM-7823 — then enter it here."
            action={
              <Button onClick={() => setJoinOpen(true)} className="!rounded-xl">
                Join a class
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3 max-sm:[&>*:only-child]:col-span-2">
            {classes.map((c) => (
              <ClassCard key={c.id} cls={c} to={`/student/classes/${c.id}`} />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        title="Join a class"
        description="Enter the code your professor gave you."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setJoinOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button form="join-class" type="submit" loading={busy} className="!rounded-xl">
              Join class
            </Button>
          </>
        }
      >
        <form id="join-class" onSubmit={submit} className="space-y-4">
          {joinError && <Alert tone="error">{joinError}</Alert>}
          <Field label="Class code">
            {(id) => (
              <Input
                id={id}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="DBM-7823"
                autoComplete="off"
                className="font-mono tracking-widest"
              />
            )}
          </Field>
        </form>
      </Modal>
    </div>
  )
}
