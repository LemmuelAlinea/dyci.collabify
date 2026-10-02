import { useEffect, useState } from 'react'
import { ClassForm } from './ClassForm'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useToast } from '../ui/Toast'
import { useAuth } from '../../context/AuthContext'
import { setArchived, updateClass } from '../../lib/api/classes'
import type { ClassInput } from '../../lib/api/classes'
import { listResources } from '../../lib/api/resources'
import { authErrorMessage } from '../../lib/authError'
import type { ClassSummary, TeachingResource } from '../../lib/types'

/**
 * Everything about a class that its faculty can change, in one tab: the
 * details it was made with, and archiving. Restore only shows once it is
 * archived; deleting goes through Archive → Trash. The join code is on the
 * header and never changes.
 */
export function ClassSettings({
  cls,
  onChanged,
}: {
  cls: ClassSummary
  onChanged: () => Promise<void>
}) {
  const { profile } = useAuth()
  const { show } = useToast()

  const [syllabi, setSyllabi] = useState<TeachingResource[]>([])
  const [curricula, setCurricula] = useState<TeachingResource[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [archivePrompt, setArchivePrompt] = useState(false)

  useEffect(() => {
    if (!profile) return
    void Promise.all([listResources(profile.id, 'syllabus'), listResources(profile.id, 'curriculum')])
      .then(([s, c]) => {
        setSyllabi(s)
        setCurricula(c)
      })
      .catch(() => {
        // The dropdowns stay as they are; saving the other fields does not need them.
      })
  }, [profile])

  async function save(input: ClassInput) {
    setError(null)
    setBusy(true)
    try {
      await updateClass(cls.id, input)
      show('Class updated')
      await onChanged()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save those changes.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-6">
      <section className="rounded-panel border border-line p-4 sm:p-5">
        <h2 className="text-[15px]">Class details</h2>
        <p className="mt-1 text-[13px] text-muted">The join code never changes.</p>
        <div className="mt-4">
          <ClassForm
            formId="class-settings"
            defaults={cls}
            syllabi={syllabi}
            curricula={curricula}
            error={error}
            onSubmit={save}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button form="class-settings" type="submit" loading={busy} className="!rounded-xl">
            Save changes
          </Button>
        </div>
      </section>

      <section className="rounded-panel border border-line p-4 sm:p-5">
        <h2 className="text-[15px]">{cls.archived_at ? 'Restore class' : 'Archive class'}</h2>
        <p className="mt-1 text-[13px] text-muted">
          {cls.archived_at
            ? 'Students get the class back in their list, with its roster and announcements.'
            : 'Students lose access and it leaves their class list. The roster and announcements are kept.'}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={async () => {
            if (!cls.archived_at) return setArchivePrompt(true)
            try {
              await setArchived(cls.id, false)
              show('Class restored')
              await onChanged()
            } catch (err) {
              show(authErrorMessage(err, 'Could not restore the class.'), 'error')
            }
          }}
        >
          {cls.archived_at ? 'Restore class' : 'Archive class'}
        </Button>
      </section>

      <ConfirmDialog
        open={archivePrompt}
        onClose={() => setArchivePrompt(false)}
        onConfirm={async () => {
          await setArchived(cls.id, true)
          show(`${cls.name} archived`)
          await onChanged()
        }}
        title={`Archive ${cls.name}?`}
        body="Students lose access immediately and it disappears from their class list. The roster and announcements are kept, and you can restore it any time."
        confirmLabel="Archive class"
      />
    </div>
  )
}
