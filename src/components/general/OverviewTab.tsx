// src/components/general/OverviewTab.tsx
import { useEffect, useState } from 'react'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState } from '../ui/EmptyState'
import { Field, Input } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { Select, Textarea } from '../ui/Select'
import { useToast } from '../ui/Toast'
import {
  clearFieldValue,
  deleteField,
  setFieldValue,
  updateField,
  updateGeneralProject,
} from '../../lib/api/general'
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

export function OverviewTab({ state }: { state: GeneralProjectState }) {
  const editable = state.can('edit_project')
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start">
      <section className="rounded-panel border border-line surface p-4 sm:p-5">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2>Details</h2>
            <p className="mt-0.5 text-[12px] text-muted">What every project has.</p>
          </div>
          {!editable && <RequestAccessButton state={state} permission="edit_project" />}
        </header>
        {editable ? <DetailsForm state={state} /> : <DetailsView state={state} />}
      </section>

      <FieldsPanel state={state} />
    </div>
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
        <dt className="text-[12px] text-faint">Progress</dt>
        <dd className="text-ink">
          {p.points_enabled ? 'Tasks carry points' : 'Every task counts the same'}
        </dd>
      </div>
      <div>
        <dt className="text-[12px] text-faint">About</dt>
        <dd className="whitespace-pre-wrap text-ink">{p.description || 'No description yet.'}</dd>
      </div>
    </dl>
  )
}

function DetailsForm({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const p = state.project
  const [name, setName] = useState('')
  const [status, setStatus] = useState<GeneralStatus>('planning')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [description, setDescription] = useState('')
  const [points, setPoints] = useState(false)
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
    setPoints(p.points_enabled)
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
        points_enabled: points,
      })
      show('Project saved')
      await state.reload()
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
        {(id) => (
          <Input id={id} maxLength={LIMIT.generalName} value={name} onChange={(e) => setName(e.target.value)} />
        )}
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
      <label className="flex items-start gap-3 rounded-xl surface-sunken px-3.5 py-3">
        <input type="checkbox" className="mt-1" checked={points} onChange={(e) => setPoints(e.target.checked)} />
        <span>
          <span className="block text-[14px] font-medium text-ink">Tasks carry points</span>
          <span className="block text-[12px] text-muted">
            On, the project is worth 100 and each task is a share of it. Off, every task counts the same.
          </span>
        </span>
      </label>
      <div className="flex justify-end">
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

  async function move(field: GeneralField, delta: -1 | 1) {
    const list = state.fields
    const i = list.findIndex((f) => f.id === field.id)
    const other = list[i + delta]
    if (!other) return
    try {
      await Promise.all([updateField(field.id, { sort: i + delta }), updateField(other.id, { sort: i })])
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not move that field.'), 'error')
    }
  }

  return (
    <section className="rounded-panel border border-line surface p-4 sm:p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2>Fields</h2>
          <p className="mt-0.5 text-[12px] text-muted">What this project needs to keep track of.</p>
        </div>
        {editable ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} />
            Add field
          </Button>
        ) : (
          <RequestAccessButton state={state} permission="edit_project" />
        )}
      </header>

      {state.fields.length === 0 ? (
        <EmptyState
          icon="file"
          title="No fields yet"
          body={
            editable
              ? 'Add what this project needs: a budget, a venue, an adviser, a grade level.'
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
              editable={editable}
              first={i === 0}
              last={i === state.fields.length - 1}
              onEdit={() => setEditing(f)}
              onRemove={() => setRemoving(f)}
              onMove={(d) => void move(f, d)}
            />
          ))}
        </ul>
      )}

      <FieldDialog open={adding} onClose={() => setAdding(false)} state={state} />
      <FieldDialog open={Boolean(editing)} onClose={() => setEditing(null)} state={state} field={editing ?? undefined} />
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
  editable,
  first,
  last,
  onEdit,
  onRemove,
  onMove,
}: {
  field: GeneralField
  state: GeneralProjectState
  editable: boolean
  first: boolean
  last: boolean
  onEdit: () => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
}) {
  const { show } = useToast()
  const stored = state.values.find((v) => v.field_id === field.id)
  const [draft, setDraft] = useState<unknown>(stored?.value ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const storedAt = stored?.updated_at
  useEffect(() => {
    setDraft(stored?.value ?? '')
  }, [storedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setError(null)
    setBusy(true)
    try {
      if (isEmptyValue(draft)) {
        await clearFieldValue(field.id)
      } else {
        const checked = checkFieldValue(field.type, draft, {
          options: field.options,
          memberIds: state.members.map((m) => m.user_id),
        })
        if (!checked.ok) {
          setError(checked.error)
          return
        }
        await setFieldValue(field.id, checked.value)
      }
      show(`${field.name} saved`)
      await state.reload()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save that value.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-ink">{field.name}</p>
        {editable && (
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
              className="grid h-8 w-8 place-items-center rounded-lg text-faint hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/12 dark:hover:text-red-400"
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        )}
      </div>

      {editable ? (
        <div className="mt-2 space-y-2">
          <FieldInput field={field} value={draft} onChange={setDraft} members={state.members} />
          {error && <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => void save()} loading={busy}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-[14px] text-muted">
          {stored ? formatFieldValue(field.type, stored.value, state.nameOf) : 'Not set'}
        </p>
      )}
    </li>
  )
}
