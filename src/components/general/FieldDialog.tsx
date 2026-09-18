// src/components/general/FieldDialog.tsx
import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { Select, Textarea } from '../ui/Select'
import { createField, updateField } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { FIELD_LIMIT, FIELD_TYPES, checkOptions, isChoice } from '../../lib/general/fields'
import type { FieldType } from '../../lib/general/fields'
import type { GeneralField } from '../../lib/general/types'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * Add a field, or rename one and change its options.
 *
 * The type is fixed once the field holds a value — the database refuses the
 * change — so the select says why it is locked instead of failing on save.
 */
export function FieldDialog({
  open,
  onClose,
  state,
  field,
}: {
  open: boolean
  onClose: () => void
  state: GeneralProjectState
  field?: GeneralField
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<FieldType>('short_text')
  const [options, setOptions] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(field?.name ?? '')
    setType(field?.type ?? 'short_text')
    setOptions((field?.options ?? []).join('\n'))
    setError(null)
  }, [open, field])

  const hasValue = Boolean(field && state.values.some((v) => v.field_id === field.id))

  async function save() {
    if (!state.project) return
    const list = isChoice(type) ? options.split('\n').map((o) => o.trim()).filter(Boolean) : []
    if (!name.trim()) return setError('Give the field a name.')
    const problem = checkOptions(type, list)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      if (field) {
        await updateField(field.id, { name: name.trim(), type, options: list })
      } else {
        await createField({
          projectId: state.project.id,
          name,
          type,
          options: list,
          sort: state.fields.length,
        })
      }
      await state.reload()
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save that field.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={field ? 'Edit field' : 'Add a field'}
      description="Fields are yours to name. Everyone on the project sees them."
      focusField
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            {field ? 'Save field' : 'Add field'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              maxLength={FIELD_LIMIT.name}
              placeholder="Budget, Venue, Adviser"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Type"
          hint={hasValue ? <span className="text-[12px] text-faint">Locked: it holds a value</span> : undefined}
        >
          {(id) => (
            <Select
              id={id}
              value={type}
              disabled={hasValue}
              onChange={(e) => setType(e.target.value as FieldType)}
              options={FIELD_TYPES.map((t) => ({ value: t.value, label: `${t.label} — ${t.hint}` }))}
            />
          )}
        </Field>
        {isChoice(type) && (
          <Field label="Options" hint={<span className="text-[12px] text-faint">One per line</span>}>
            {(id) => (
              <Textarea
                id={id}
                rows={5}
                placeholder={'Gym\nCovered court\nAudio-visual room'}
                value={options}
                onChange={(e) => setOptions(e.target.value)}
              />
            )}
          </Field>
        )}
      </div>
    </Modal>
  )
}
