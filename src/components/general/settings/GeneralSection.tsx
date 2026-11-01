// src/components/general/settings/GeneralSection.tsx
import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert } from '../../ui/Alert'
import { Button } from '../../ui/Button'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { EmptyState } from '../../ui/EmptyState'
import { Field, Input } from '../../ui/Field'
import { Icon } from '../../ui/Icon'
import { Modal } from '../../ui/Modal'
import { Select, Textarea } from '../../ui/Select'
import { useToast } from '../../ui/Toast'
import {
  archiveGeneralProject,
  clearFieldValue,
  deleteField,
  deleteGeneralProject,
  setFieldValue,
  updateField,
  updateGeneralProject,
} from '../../../lib/api/general'
import { notifyLooksChanged } from '../../../hooks/useProjectLooks'
import { authErrorMessage } from '../../../lib/authError'
import { paths } from '../../../lib/paths'
import { checkFieldValue, isEmptyValue } from '../../../lib/general/fields'
import { PROJECT_COLORS, PROJECT_ICONS, PROJECT_VIEWS, SWATCH_CLASS, projectLookLabel } from '../../../lib/general/projectLook'
import { PROJECT_STATUSES } from '../../../lib/general/types'
import type {
  GeneralField,
  GeneralStatus,
  ProjectColor,
  ProjectIcon,
  ProjectView,
  ProjectVisibility,
} from '../../../lib/general/types'
import { LIMIT } from '../../../lib/limits'
import { FieldDialog } from '../FieldDialog'
import { FieldInput } from '../FieldInput'
import { HandOverDialog } from '../HandOverDialog'
import { DetailsView, FieldReadRow } from '../ProjectInfo'
import { RequestAccessButton } from '../RequestAccessButton'
import type { GeneralProjectState } from '../useGeneralProject'

export function GeneralSection({ state }: { state: GeneralProjectState }) {
  return (
    <div className="space-y-6">
      <DetailsPanel state={state} />
      <FieldsPanel state={state} />
      <LookPanel state={state} />
      <ArchiveZone state={state} />
    </div>
  )
}

const VISIBILITY: { value: ProjectVisibility; label: string; help: string }[] = [
  { value: 'private', label: 'Private', help: 'Only members and space owners can open it.' },
  { value: 'workspace', label: 'Workspace', help: 'Everyone in the space can view it and ask to join.' },
]

/** What a project's Look and access panel edits. */
type Look = {
  color: ProjectColor | null
  icon: ProjectIcon | null
  default_view: ProjectView
  visibility: ProjectVisibility
}

/**
 * One choice in the color and icon pickers. The radio inside is visually
 * hidden; the tile shows whether it is picked, focused or disabled.
 */
const PICK =
  'relative grid h-11 min-w-11 cursor-pointer place-items-center rounded-xl border border-[var(--control-line)] text-muted transition-colors ' +
  'hover:border-[var(--line-strong)] has-[:checked]:border-navy-500 has-[:checked]:ring-2 has-[:checked]:ring-navy-500/30 ' +
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring)] ' +
  'has-[:disabled]:cursor-default has-[:disabled]:opacity-60 has-[:disabled]:hover:border-[var(--control-line)]'

/**
 * Color, icon, default view and who can see the project. Anybody on it can read
 * how it is set; the controls are live only for somebody who can edit the
 * project, and one button saves all four.
 */
function LookPanel({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const group = useId()
  const p = state.project
  const editable = state.can('edit_project') && !state.readOnly
  // Only what somebody has changed; the rest reads from the project, so a save
  // or a reload elsewhere shows through.
  const [draft, setDraft] = useState<Partial<Look>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!p) return null

  const stored: Look = {
    color: p.color ?? null,
    icon: p.icon ?? null,
    default_view: p.default_view ?? 'overview',
    visibility: p.visibility ?? 'private',
  }
  const look: Look = { ...stored, ...draft }
  // A write that changes nothing is refused as a permission error, so Save waits for a change.
  const dirty = (Object.keys(draft) as (keyof Look)[]).some((k) => draft[k] !== stored[k])
  const set = <K extends keyof Look>(key: K, value: Look[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setError(null)
  }

  async function save() {
    if (!p) return
    setBusy(true)
    setError(null)
    try {
      await updateGeneralProject(p.id, look)
      show('Look and access saved')
      await state.reload()
      notifyLooksChanged()
      setDraft({})
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the look and access.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <header className="mb-4">
        <h2>Look and access</h2>
        <p className="mt-0.5 text-[12px] text-muted">
          How the project appears in lists, where it opens, and who can find it.
        </p>
      </header>

      <div className="space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        <fieldset className="min-w-0 space-y-2">
          <legend className="text-[13px] font-medium text-ink">Color</legend>
          <div className="flex flex-wrap gap-2">
            <label className={`${PICK} px-2`} title="No color">
              <input
                type="radio"
                name={`${group}-color`}
                value=""
                aria-label="No color"
                checked={look.color === null}
                disabled={!editable}
                onChange={() => set('color', null)}
                className="sr-only"
              />
              <span aria-hidden className="text-[12px]">None</span>
            </label>
            {PROJECT_COLORS.map((c) => (
              <label key={c} className={PICK} title={projectLookLabel(c)}>
                <input
                  type="radio"
                  name={`${group}-color`}
                  value={c}
                  aria-label={projectLookLabel(c)}
                  checked={look.color === c}
                  disabled={!editable}
                  onChange={() => set('color', c)}
                  className="sr-only"
                />
                <span aria-hidden className={`grid h-7 w-7 place-items-center rounded-lg ${SWATCH_CLASS[c].tile}`}>
                  {look.color === c && <Icon name="check" size={14} />}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="min-w-0 space-y-2">
          <legend className="text-[13px] font-medium text-ink">Icon</legend>
          {/* Columns fill the width at 44px minimum, so a phone gets a grid of tappable tiles, not a scrolling row. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-2">
            <label className={PICK} title="No icon">
              <input
                type="radio"
                name={`${group}-icon`}
                value=""
                aria-label="No icon"
                checked={look.icon === null}
                disabled={!editable}
                onChange={() => set('icon', null)}
                className="sr-only"
              />
              <span aria-hidden className="text-[12px]">None</span>
            </label>
            {PROJECT_ICONS.map((name) => (
              <label key={name} className={PICK} title={projectLookLabel(name)}>
                <input
                  type="radio"
                  name={`${group}-icon`}
                  value={name}
                  aria-label={projectLookLabel(name)}
                  checked={look.icon === name}
                  disabled={!editable}
                  onChange={() => set('icon', name)}
                  className="sr-only"
                />
                <span aria-hidden className={look.icon === name ? 'text-ink' : undefined}>
                  <Icon name={name} size={20} />
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="max-w-sm">
          <Field label="Default view">
            {(id) => (
              <Select
                id={id}
                value={look.default_view}
                disabled={!editable}
                onChange={(e) => set('default_view', e.target.value as ProjectView)}
                options={PROJECT_VIEWS.map((v) => ({ value: v.value, label: v.label }))}
              />
            )}
          </Field>
        </div>

        <fieldset className="min-w-0 space-y-2">
          <legend className="text-[13px] font-medium text-ink">Visibility</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {VISIBILITY.map((v) => (
              <label key={v.value} className="relative block cursor-pointer has-[:disabled]:cursor-default">
                <input
                  type="radio"
                  name={`${group}-visibility`}
                  value={v.value}
                  checked={look.visibility === v.value}
                  disabled={!editable}
                  onChange={() => set('visibility', v.value)}
                  className="peer sr-only"
                />
                <span className="block h-full rounded-xl border border-[var(--control-line)] p-4 transition-colors hover:border-[var(--line-strong)] peer-checked:border-navy-500 peer-checked:ring-2 peer-checked:ring-navy-500/30 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ring)] peer-disabled:opacity-60 peer-disabled:hover:border-[var(--control-line)]">
                  <span className="block text-[14px] font-medium text-ink">{v.label}</span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-muted">{v.help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {editable && (
        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <Button onClick={() => void save()} loading={busy} disabled={!dirty}>
            Save look and access
          </Button>
        </div>
      )}
    </section>
  )
}

/** Details stay together in the panel; editing never expands the page. */
function DetailsPanel({ state }: { state: GeneralProjectState }) {
  const editable = state.can('edit_project') && !state.readOnly
  const [editing, setEditing] = useState(false)
  // Losing the permission mid-edit (an Owner takes it back) closes the form.
  const open = editable && editing

  return (
    <section className="card p-4 shadow-card sm:p-5">
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
  )
}

export function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick} aria-label={label}>
      <Icon name="edit" size={14} />
      Edit
    </Button>
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
      <div className="grid gap-4">
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

const ARCHIVE_NOTE =
  'Nothing in it can change until the project manager restores it, and its join code closes. Everyone on it can still read it.'

/**
 * The project manager's own controls: archive or restore, hand the project
 * over, and (once archived) delete it for good. They sit apart at the bottom
 * and are the project manager's alone.
 */
function ArchiveZone({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const [archiving, setArchiving] = useState(false)
  const [handingOver, setHandingOver] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const p = state.project
  if (!p || !state.isOwner) return null

  async function restore() {
    if (!p) return
    try {
      await archiveGeneralProject(p.id, false)
      show('Project restored')
      await state.reload()
    } catch (err) {
      show(authErrorMessage(err, 'Could not restore the project.'), 'error')
    }
  }

  return (
    <section className="divide-y divide-danger-600/20 rounded-xl border border-danger-600/30">
      <header className="p-4 sm:px-5">
        <h2>Danger zone</h2>
        <p className="mt-0.5 text-[12px] text-muted">Only the project manager can do these.</p>
      </header>

      <DangerRow
        title={state.archived ? 'Restore project' : 'Archive project'}
        body={
          state.archived
            ? 'This project is archived, so nothing in it can change. Restoring it opens it up again.'
            : ARCHIVE_NOTE
        }
      >
        {state.archived ? (
          <Button variant="outline" onClick={() => void restore()} className="shrink-0">
            Restore project
          </Button>
        ) : (
          <Button variant="destroy" onClick={() => setArchiving(true)} className="shrink-0">
            <Icon name="archive" size={14} />
            Archive project
          </Button>
        )}
      </DangerRow>

      <DangerRow
        title="Transfer ownership"
        body="Hand the project to another project manager. You become a coordinator."
      >
        <Button variant="outline" onClick={() => setHandingOver(true)} className="shrink-0">
          Transfer ownership
        </Button>
      </DangerRow>

      {state.archived && (
        <DangerRow
          title="Delete project"
          body="Removes its tasks, files, sprints and milestones for good. This cannot be undone."
        >
          <Button variant="destroy" onClick={() => setDeleting(true)} className="shrink-0">
            <Icon name="trash" size={14} />
            Delete project
          </Button>
        </DangerRow>
      )}

      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        onConfirm={async () => {
          await archiveGeneralProject(p.id, true)
          show('Project archived')
          await state.reload()
        }}
        title={`Archive ${p.name}?`}
        body={ARCHIVE_NOTE}
        confirmLabel="Archive project"
        tone="primary"
      />
      <HandOverDialog open={handingOver} onClose={() => setHandingOver(false)} state={state} />
      <DeleteDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        projectId={p.id}
        name={p.name}
        spaceId={p.space_id}
      />
    </section>
  )
}

function DangerRow({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div>
        <h3 className="text-[14px] font-medium text-ink">{title}</h3>
        <p className="mt-0.5 text-[12px] text-muted">{body}</p>
      </div>
      {children}
    </div>
  )
}

/** Deleting cannot be undone, so it waits for the exact project name, case and spaces included. */
function DeleteDialog({
  open,
  onClose,
  projectId,
  name,
  spaceId,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  name: string
  spaceId: string
}) {
  const { show } = useToast()
  const navigate = useNavigate()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setTyped('')
      setError(null)
    }
  }, [open])

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await deleteGeneralProject(projectId)
      show('Project deleted')
      navigate(paths.spaceProjects(spaceId))
    } catch (err) {
      setError(authErrorMessage(err, 'Could not delete the project.'))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Delete project"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void remove()}
            loading={busy}
            disabled={typed !== name}
            className="!rounded-xl"
          >
            Delete project
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-[14px] leading-relaxed text-muted">
          {`Delete ${name}? This removes its tasks, files, sprints and milestones for good. Type the project name to confirm.`}
        </p>
        <Field label="Project name">
          {(id) => (
            <Input
              id={id}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>
      </div>
    </Modal>
  )
}

function FieldsPanel({ state }: { state: GeneralProjectState }) {
  const { show } = useToast()
  const editable = state.can('edit_project') && !state.readOnly
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
    <section className="card p-4 shadow-card sm:p-5">
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
  const labelId = useId()

  // Read, a field looks like a line of Details: small label, value in ink.
  if (!open) return <FieldReadRow field={field} state={state} />

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
