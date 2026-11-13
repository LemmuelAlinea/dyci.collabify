import { useEffect, useState } from 'react'
import { Alert } from '../../../../components/ui/Alert'
import { Button } from '../../../../components/ui/Button'
import { Field, Input } from '../../../../components/ui/Field'
import { Icon } from '../../../../components/ui/Icon'
import { Modal } from '../../../../components/ui/Modal'
import { Textarea } from '../../../../components/ui/Select'
import { useToast } from '../../../../components/ui/Toast'
import { createOffice, renameOffice } from '../../../../lib/api/offices'
import { authErrorMessage } from '../../../../lib/authError'
import type { Office } from '../../../../lib/offices'

/**
 * New office, or Rename for an existing one. The database refuses a name that
 * clashes with another office (case and spaces aside) and names it, so its
 * message is shown as it comes.
 */
export function OfficeDialog({
  open,
  office,
  onClose,
  onSaved,
}: {
  open: boolean
  /** The office being renamed; null makes a new one. */
  office: Office | null
  onClose: () => void
  onSaved: (name: string) => Promise<void>
}) {
  const { show } = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fresh each time it opens, from the office as it is now.
  useEffect(() => {
    if (!open) return
    setName(office?.name ?? '')
    setDescription(office?.description ?? '')
    setError(null)
  }, [open, office])

  function close() {
    if (!busy) onClose()
  }

  async function save() {
    const next = name.trim()
    setBusy(true)
    setError(null)
    try {
      if (office) await renameOffice(office.id, next, description.trim())
      else await createOffice(next, description.trim())
      show(office ? `${next} saved` : `${next} added`)
      await onSaved(next)
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save that office. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={office ? `Rename ${office.name}` : 'New office'}
      description={
        office
          ? 'Its people and spaces stay filed under it.'
          : 'Members and work spaces are filed under an office, and the overview counts each one.'
      }
      size="md"
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button className="!rounded-xl" loading={busy} disabled={!name.trim()} onClick={save}>
            {office ? (
              'Save changes'
            ) : (
              <>
                <Icon name="plus" size={15} />
                Add office
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Office name">
          {(id) => (
            <Input
              id={id}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="IT services"
            />
          )}
        </Field>
        <Field label="Description" optional>
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this office looks after"
            />
          )}
        </Field>
      </div>
    </Modal>
  )
}
