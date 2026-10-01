// src/components/general/OverviewTab.tsx
import { useEffect, useId, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState } from '../ui/EmptyState'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import { clearFieldValue, deleteField, setFieldValue, updateField, updateGeneralProject } from '../../lib/api/general'
import { authErrorMessage } from '../../lib/authError'
import { dateRange } from '../../lib/general/dates'
import { checkFieldValue, formatFieldValue, isEmptyValue } from '../../lib/general/fields'
import { PROJECT_STATUSES, projectStatusLabel } from '../../lib/general/types'
import type { GeneralField, GeneralStatus } from '../../lib/general/types'
import { LIMIT } from '../../lib/limits'
import { FieldDialog } from './FieldDialog'
import { FieldInput } from './FieldInput'
import { RequestAccessButton } from './RequestAccessButton'
import type { GeneralProjectState } from './useGeneralProject'

/**
 * Details and Fields read as plain text for everyone. Whoever may edit the
 * project opens one section at a time with its Edit button, and saving or
 * cancelling puts it back.
 */
export function OverviewTab({ state }: { state: GeneralProjectState }) {
  const editable = state.can('edit_project')
  const [editing, setEditing] = useState(false)
  // Losing the permission mid-edit (an Owner takes it back) closes the form.
  const open = editable && editing

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start">
      <section className="rounded-panel border border-line surface p-4 sm:p-5">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2>Details</h2>
            <p className="mt-0.5 text-[12px] text-muted">What every project has.</p>
          </div>
          {!editable ? (
            <RequestAccessButton state={state} permission="edit_project" />
          ) : (
            !open && <EditButton label="Edit details" onClick={() => setEditing(true)} />
          )}
        </header>
        {open ? <DetailsForm state={state} onDone={() => setEditing(false)} /> : <DetailsView state={state} />}
      </section>

      <FieldsPanel state={state} />
    </div>
  )
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick} aria-label={label}>
      <Icon name="edit" size={14} />
      Edit
    </Button>
  )
}

function DetailsView({ state }: { state: GeneralProjectState }) {
  const p = state.project
  if (!p) return null
  return (
    <dl className="space-y-3 text-[14px]">
      <div>
        <dt className="text-[12px] text-faint">Status</dt>
        <dd className="text-ink">{projectStatusLabel(p.status)}</dd>
      </div>
      <div>
        <dt className="text-[12px] text-faint">Dates</dt>
        <dd className="text-ink">{dateRange(p.starts_on, p.ends_on)}</dd>
      </div>
      <div>
        <dt className="text-[12px] text-faint">About</dt>
        <dd className="whitespace-pre-wrap text-ink">{p.description || 'No description yet.'}</dd>
      </div>
    </dl>
  )
}

function DetailsForm({ state, onDone }: { state: GeneralProjectState; onDone: () => void }) {
  const { show } = useToast()
  const p = state.project
  const [name, setName] = useState('')
  const [status, setStatus] = useState<GeneralStatus>('planning')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset when the project changes underneath, not on every realtime reload
  // while somebody is typing.
  const updatedAt = p?.updated_at
  useEffect(() => {
    if (!p) return
    setName(p.name)
    setStatus(p.status)
    setStartsOn(p.starts_on ?? '')
    setEndsOn(p.ends_on ?? '')
    setDescription(p.description)
  }, [updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return null

  async function save() {
    if (!p) return
    setError(null)
    if (!name.trim()) return setError('A project needs a name.')
    if (startsOn && endsOn && endsOn < startsOn) return setError('The end date is before the start date.')
    setBusy(true)
    try {
      await updateGeneralProject(p.id, {
        name: name.trim(),
        status,
        starts_on: startsOn || null,
        ends_on: endsOn || null,
        description,
      })
      show('Project saved')
      await state.reload()
      onDone()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the project.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Name">
        {(id) => <Input id={id} maxLength={LIMIT.generalName} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Status">
          {(id) => (
            <Select
              id={id}
              value={status}
              onChange={(e) => setStatus(e.target.value as GeneralStatus)}
              options={PROJECT_STATUSES}
            />
          )}
        </Field>
        <Field label="Starts" optional>
          {(id) => <Input id={id} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}
        </Field>
        <Field label="Ends" optional>
          {(id) => <Input id={id} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />}
        </Field>
      </div>
      <Field label="About" optional>
        {(id) => (
          <Textarea
            id={id}
            rows={5}
            maxLength={LIMIT.generalDescription}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={busy}>
          Save details
        </Button>
      </div>
    </div>
  )
}

function FieldsPanel({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const editable = state.can('edit_project')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<GeneralField | null>(null)
  const [removing, setRemoving] = useState<GeneralField | null>(null)
  const [moving, setMoving] = useState(false)
  const [editingValues, setEditingValues] = useState(false)
  // Only the values someone has touched. The rest read from what is stored, so
  // a field added or saved elsewhere meanwhile still shows its current value.
  const [drafts, setDrafts] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const open = editable && editingValues

  const storedOf = (id: string) => state.values.find((v) => v.field_id === id)

  function close() {
    setDrafts({})
    setErrors({})
    setEditingValues(false)
  }

  /**
   * Checks every changed value before writing any, so one bad entry does not
   * leave the others half saved. Writes go one after another, like `move`.
   */
  async function saveValues() {
    const nextErrors: Record<string, string> = {}
    const writes: (() => Promise<unknown>)[] = []
    for (const f of state.fields) {
      if (!(f.id in drafts)) continue
      const draft = drafts[f.id]
      const stored = storedOf(f.id)
      if (JSON.stringify(draft ?? '') === JSON.stringify(stored?.value ?? '')) continue
      if (isEmptyValue(draft)) {
        // Clearing what was already empty deletes no row, and a write that
        // changes nothing is reported as a permission refusal. Nothing to do.
        if (stored) writes.push(() => clearFieldValue(f.id))
        continue
      }
      const checked = checkFieldValue(f.type, draft, {
        options: f.options,
        memberIds: state.members.map((m) => m.user_id),
      })
      if (checked.ok) writes.push(() => setFieldValue(f.id, checked.value))
      else nextErrors[f.id] = checked.error
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    if (writes.length === 0) return close()

    setSaving(true)
    try {
      for (const write of writes) await write()
      show(writes.length === 1 ? 'Field saved' : 'Fields saved')
      await state.reload()
      close()
    } catch (err) {
      show(authErrorMessage(err, 'Could not save the fields. Check them and try again.'), 'error')
      await state.reload()
    } finally {
      setSaving(false)
    }
  }

  /**
   * Swaps the two fields' own sort values rather than their list positions, so
   * a list whose stored sorts have drifted apart still moves one step. The two
   * writes run in order, not together: a failed second write would otherwise
   * leave both fields holding the same sort.
   */
  async function move(field: GeneralField, delta: -1 | 1) {
    if (moving) return
    const list = state.fields
    const i = list.findIndex((f) => f.id === field.id)
    const other = list[i + delta]
    if (!other) return
    const mine = field.sort === other.sort ? i : field.sort
    const theirs = field.sort === other.sort ? i + delta : other.sort
    setMoving(true)
    try {
      await updateField(field.id, { sort: theirs })
      await updateField(other.id, { sort: mine })
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not move that field.'), 'error')
    } finally {
      setMoving(false)
    }
  }

  return (
    <section className="rounded-panel border border-line surface p-4 sm:p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Fields</h2>
          <p className="mt-0.5 text-[12px] text-muted">What this project needs to keep track of.</p>
        </div>
        {!editable ? (
          <RequestAccessButton state={state} permission="edit_project" />
        ) : open ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} />
            Add field
          </Button>
        ) : (
          <EditButton label="Edit fields" onClick={() => setEditingValues(true)} />
        )}
      </header>

      {state.fields.length === 0 ? (
        <EmptyState
          icon="file"
          title="No fields yet"
          body={
            open
              ? 'Add what this project needs: a budget, a venue, an adviser, a grade level.'
              : editable
                ? 'Choose Edit to add what this project needs: a budget, a venue, an adviser, a grade level.'
                : 'Nobody has added fields to this project.'
          }
        />
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {state.fields.map((f, i) => (
            <FieldRow
              key={f.id}
              field={f}
              state={state}
              open={open}
              draft={f.id in drafts ? drafts[f.id] : (storedOf(f.id)?.value ?? '')}
              onDraft={(value) => setDrafts((d) => ({ ...d, [f.id]: value }))}
              error={errors[f.id] ?? null}
              first={i === 0}
              last={i === state.fields.length - 1}
              onEdit={() => setEditing(f)}
              onRemove={() => setRemoving(f)}
              onMove={(d) => void move(f, d)}
            />
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
          {state.fields.length === 0 ? (
            <Button onClick={close}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void saveValues()} loading={saving}>
                Save fields
              </Button>
            </>
          )}
        </div>
      )}

      <FieldDialog open={adding} onClose={() => setAdding(false)} state={state} />
      <FieldDialog
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        state={state}
        field={editing ?? undefined}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return
          await deleteField(removing.id)
          show('Field removed')
          await state.reload()
        }}
        title={`Remove ${removing?.name ?? 'this field'}?`}
        body={
          removing && state.values.some((v) => v.field_id === removing.id)
            ? 'It holds a value, and the value is removed with it. This cannot be undone.'
            : 'It holds no value yet.'
        }
        confirmLabel="Remove field"
      />
    </section>
  )
}

function FieldRow({
  field,
  state,
  open,
  draft,
  onDraft,
  error,
  first,
  last,
  onEdit,
  onRemove,
  onMove,
}: {
  field: GeneralField
  state: GeneralProjectState
  /** The panel is in edit mode: show the input and the field's own controls. */
  open: boolean
  draft: unknown
  onDraft: (value: unknown) => void
  error: string | null
  first: boolean
  last: boolean
  onEdit: () => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
}) {
  const stored = state.values.find((v) => v.field_id === field.id)
  const labelId = useId()

  // Read, a field looks like a line of Details: small label, value in ink.
  if (!open) {
    return (
      <li className="py-3 first:pt-0 last:pb-0">
        <p className="text-[12px] text-faint">{field.name}</p>
        <p className={`mt-0.5 text-[14px] whitespace-pre-wrap ${stored ? 'text-ink' : 'text-muted'}`}>
          {stored ? formatFieldValue(field.type, stored.value, state.nameOf) : 'Not set'}
        </p>
      </li>
    )
  }

  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <p id={labelId} className="text-[13px] font-medium text-ink">
          {field.name}
        </p>
        <div className="flex items-center">
          <button
            type="button"
            aria-label={`Move ${field.name} up`}
            disabled={first}
            onClick={() => onMove(-1)}
            className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-ink disabled:opacity-30"
          >
            <Icon name="chevronDown" size={15} className="rotate-180" />
          </button>
          <button
            type="button"
            aria-label={`Move ${field.name} down`}
            disabled={last}
            onClick={() => onMove(1)}
            className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-ink disabled:opacity-30"
          >
            <Icon name="chevronDown" size={15} />
          </button>
          <button
            type="button"
            aria-label={`Edit ${field.name}`}
            onClick={onEdit}
            className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-[var(--surface-sunken)] hover:text-ink"
          >
            <Icon name="edit" size={15} />
          </button>
          <button
            type="button"
            aria-label={`Remove ${field.name}`}
            onClick={onRemove}
            className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-destructive-50 hover:text-destructive-600 dark:hover:bg-destructive-500/12 dark:hover:text-destructive-400"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>

      <div className="mt-2 space-y-2">
        <FieldInput field={field} value={draft} onChange={onDraft} members={state.members} labelledBy={labelId} />
        {error && <p className="text-[12px] text-danger-600 dark:text-danger-400">{error}</p>}
      </div>
    </li>
  )
}
