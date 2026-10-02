import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Field, Input } from '../../components/ui/Field'
import { Textarea } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { useGeneralNavigation } from '../../context/generalNavigation'
import { archiveSpace, updateSpace } from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import { paths } from '../../lib/paths'

/**
 * Everything about a space its Owner can change, in one tab: its name and
 * description, and archiving. Archive comes first; Restore only shows once the
 * space is archived. Deleting a space goes through Archive → Trash.
 */
export default function SpaceSettings() {
  const { show } = useToast()
  const { spaces, currentSpace: space, reload } = useGeneralNavigation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)

  useEffect(() => {
    if (!space) return
    setName(space.name)
    setDescription(space.description)
  }, [space])

  useEffect(() => {
    document.title = space ? `Settings · ${space.name} · Collabify` : 'Settings · Collabify'
  }, [space])

  if (spaces !== null && space && space.my_level !== 'owner') {
    return <Navigate to={paths.space(space.id)} replace />
  }
  if (!space) return null

  const archived = Boolean(space.archived_at)
  const changed = name.trim() !== space.name || description !== space.description

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!space) return
    setError(null)
    setBusy(true)
    try {
      await updateSpace(space.id, name, description)
      show('Space updated')
      await reload()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save those changes.'))
    } finally {
      setBusy(false)
    }
  }

  async function restore() {
    if (!space) return
    try {
      await archiveSpace(space.id, false)
      show('Space restored')
      await reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not restore the space.'), 'error')
    }
  }

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-6">
      <section className="rounded-panel border border-line p-4 sm:p-5">
        <h2 className="text-[15px]">Space details</h2>
        <p className="mt-1 text-[13px] text-muted">
          {archived ? 'Restore the space to change these.' : 'How this space shows up for everyone in it.'}
        </p>
        <form id="space-settings" onSubmit={save} className="mt-4 space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Name">
            {(id) => (
              <Input
                id={id}
                required
                maxLength={80}
                disabled={archived}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field label="Description" hint="Optional. What the space is for.">
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={400}
                disabled={archived}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>
        </form>
        <div className="mt-4 flex justify-end">
          <Button
            form="space-settings"
            type="submit"
            loading={busy}
            disabled={archived || !changed || name.trim().length === 0}
            className="!rounded-xl"
          >
            Save changes
          </Button>
        </div>
      </section>

      <section className="rounded-panel border border-line p-4 sm:p-5">
        <h2 className="text-[15px]">{archived ? 'Restore space' : 'Archive space'}</h2>
        <p className="mt-1 text-[13px] text-muted">
          {archived
            ? 'Projects return to normal and members can make changes again.'
            : 'Every project stays readable, but nobody can change the space until you restore it.'}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => (archived ? void restore() : setArchiveOpen(true))}
        >
          {archived ? 'Restore space' : 'Archive space'}
        </Button>
      </section>

      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={async () => {
          await archiveSpace(space.id, true)
          show(`${space.name} archived`)
          await reload()
        }}
        title={`Archive ${space.name}?`}
        body="Every project stays readable, but no member can change the space until you restore it."
        confirmLabel="Archive space"
        tone="primary"
      />
    </div>
  )
}
