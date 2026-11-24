import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { Reorder, useDragControls, useReducedMotion } from 'motion/react'
import { authErrorMessage } from '../../lib/authError'
import { isStaleTypes } from '../../lib/api/taskTypes'
import { TYPE_SWATCHES } from '../../lib/taskTypes/colors'
import { presetByKey } from '../../lib/taskTypes/presets'
import { MAX_CUSTOM_TYPES, toDrafts, typeSetProblem } from '../../lib/taskTypes/typeSet'
import type { TaskTypeDraft, TaskTypeEntry, TypeFamily, TypeRow } from '../../lib/taskTypes/typeSet'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { useToast } from '../ui/Toast'
import { TypeEditPanel } from './TypeEditPanel'
import { TypeIcon } from './TypeIcon'

export type TaskTypesEditorProps = {
  family: TypeFamily
  set: TaskTypeEntry[]
  shown: string
  preset: string | null
  editable: boolean
  readOnlyNote: string
  save: (types: TaskTypeDraft[], shown: string, preset?: string | null) => Promise<void>
  loadCounts: () => Promise<Map<string, number>>
  reload: () => Promise<void>
  /** Opens the presets dialog; the editor shows Browse presets when it is given. */
  onBrowsePresets?: () => void
}

type Keyed = TypeRow & { key: string }
type Editing = { index: number | 'new'; draft: TaskTypeEntry }

const SLOT_LABEL: Record<'default' | 'bug', string> = { default: 'Default', bug: "QA's bugs" }
const NEW_KEY = 'new'

function rowsOf(set: TaskTypeEntry[]): Keyed[] {
  return set.map((entry, i) => ({ entry, was: entry.name, key: `${i}:${entry.slot ?? ''}:${entry.name}` }))
}

/**
 * Settings → Task types: the project's types in order. The project manager (a professor on a class
 * project) edits one at a time in an inline panel, adds, deletes and drags to reorder; every change
 * saves the whole set with the fingerprint it was loaded with. Everyone else reads it.
 */
export function TaskTypesEditor({
  family, set, shown, preset, editable, readOnlyNote, save, loadCounts, reload, onBrowsePresets,
}: TaskTypesEditorProps) {
  const { show } = useToast()
  const reduce = useReducedMotion()
  const [rows, setRows] = useState<Keyed[]>(() => rowsOf(set))
  const [editing, setEditing] = useState<Editing | null>(null)
  const [pending, setPending] = useState<number | 'new' | null>(null)
  const [deleting, setDeleting] = useState<{ index: number; tasks: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [live, setLive] = useState('')
  const dragged = useRef(false)

  // A new set from the server (after a save or someone else's) resets the rows and the panel.
  useEffect(() => {
    setRows(rowsOf(set))
    setEditing(null)
  }, [shown]) // eslint-disable-line react-hooks/exhaustive-deps

  const customs = rows.filter((r) => r.entry.slot === null).length
  const presetName = presetByKey(preset)?.name

  async function commit(next: TypeRow[], toast: string): Promise<boolean> {
    const problem = typeSetProblem(next.map((r) => r.entry), family)
    if (problem) {
      setError(problem)
      return false
    }
    setBusy(true)
    setError(null)
    setStale(false)
    try {
      await save(toDrafts(next), shown)
      show(toast)
      return true
    } catch (err) {
      setStale(isStaleTypes(err))
      setError(authErrorMessage(err, 'Could not save the task types.'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const dirty = (e: Editing | null) => {
    if (!e) return false
    if (e.index === 'new') return Boolean(e.draft.name.trim() || e.draft.description.trim())
    return JSON.stringify(e.draft) !== JSON.stringify(rows[e.index]?.entry)
  }

  function open(index: number | 'new') {
    if (dirty(editing)) {
      setPending(index)
      return
    }
    start(index)
  }

  function start(index: number | 'new') {
    setError(null)
    if (index === 'new') {
      const used = new Set(rows.map((r) => r.entry.color))
      const color = TYPE_SWATCHES.find((s) => !used.has(s.hex))?.hex ?? TYPE_SWATCHES[0].hex
      setEditing({ index, draft: { slot: null, name: '', description: '', color, icon: 'tag' } })
    } else {
      setEditing({ index, draft: { ...rows[index].entry } })
    }
  }

  async function saveEditing() {
    if (!editing) return
    const draft = { ...editing.draft, name: editing.draft.name.trim(), description: editing.draft.description.trim() }
    const next: TypeRow[] = editing.index === 'new'
      ? [...rows, { entry: draft }]
      : rows.map((r, i) => (i === editing.index ? { ...r, entry: draft } : r))
    if (await commit(next, 'Task type saved')) setEditing(null)
  }

  async function askDelete() {
    if (!editing || editing.index === 'new') return
    const index = editing.index
    let tasks = 0
    try {
      tasks = (await loadCounts()).get(rows[index].entry.name) ?? 0
    } catch {
      // The count is a courtesy; the delete still asks.
    }
    setDeleting({ index, tasks })
  }

  async function confirmDelete() {
    if (!deleting) return
    const next = rows.filter((_, i) => i !== deleting.index)
    if (await commit(next, 'Task type deleted')) setEditing(null)
  }

  async function move(index: number, by: -1 | 1) {
    const to = index + by
    if (to < 0 || to >= rows.length || busy) return
    const next = [...rows]
    const [row] = next.splice(index, 1)
    next.splice(to, 0, row)
    setRows(next)
    setEditing(null)
    if (await commit(next, 'Task types reordered')) setLive(`${row.entry.name} moved to position ${to + 1}.`)
  }

  async function dropped() {
    if (!dragged.current) return
    dragged.current = false
    const order = rows.map((r) => r.key).join('|')
    if (order === rowsOf(set).map((r) => r.key).join('|')) return
    setEditing(null)
    await commit(rows, 'Task types reordered')
  }

  const deletingName = deleting ? rows[deleting.index]?.entry.name : ''

  return (
    <section className="card p-4 shadow-card sm:p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2>Task types</h2>
          <p className="mt-0.5 text-[12px] text-muted">Manage how work is categorized within this project.</p>
          {presetName && <p className="mt-1 text-[12px] text-faint">Based on the {presetName} preset.</p>}
          {!editable && <p className="mt-1 text-[12px] text-muted">{readOnlyNote}</p>}
        </div>
        {editable && (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            {onBrowsePresets && <Button variant="outline" size="sm" onClick={onBrowsePresets} disabled={busy}>Browse presets</Button>}
            <Button
              variant="outline"
              size="sm"
              onClick={() => open('new')}
              disabled={busy || customs >= MAX_CUSTOM_TYPES}
              title={customs >= MAX_CUSTOM_TYPES ? 'Keep at most 20 custom task types.' : undefined}
              className={onBrowsePresets ? '' : 'col-span-2'}
            >
              + Add type
            </Button>
          </div>
        )}
      </header>

      {error && !editing && (
        <div className="mb-3">
          <Alert tone="error">
            <span>{error}</span>
            {stale && <Button variant="ghost" size="sm" className="ml-2" onClick={() => void reload()}>Reload</Button>}
          </Alert>
        </div>
      )}

      <Reorder.Group
        as="ul"
        axis="y"
        values={rows}
        onReorder={(next) => {
          dragged.current = true
          setRows(next)
        }}
        className="space-y-2"
      >
        {rows.map((row, index) => (
          <TypeRowItem
            key={row.key}
            row={row}
            index={index}
            editable={editable && !busy}
            reduce={Boolean(reduce)}
            onEdit={() => open(index)}
            onMove={(by) => void move(index, by)}
            onDrop={() => void dropped()}
          >
            {editing?.index === index && (
              <TypeEditPanel
                key={`edit-${row.key}`}
                draft={editing.draft}
                onChange={(draft) => setEditing({ index, draft })}
                onSave={() => void saveEditing()}
                onCancel={() => { setEditing(null); setError(null) }}
                onDelete={row.entry.slot === null ? () => void askDelete() : undefined}
                busy={busy}
                error={error}
              />
            )}
          </TypeRowItem>
        ))}
      </Reorder.Group>

      {editing?.index === 'new' && (
        <TypeEditPanel
          key={NEW_KEY}
          draft={editing.draft}
          onChange={(draft) => setEditing({ index: 'new', draft })}
          onSave={() => void saveEditing()}
          onCancel={() => { setEditing(null); setError(null) }}
          busy={busy}
          error={error}
        />
      )}
      {stale && editing && (
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => void reload()}>Reload</Button>
        </div>
      )}

      <p aria-live="polite" className="sr-only">{live}</p>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={`Delete ${deletingName}?`}
        confirmLabel="Delete"
        body={deleting && deleting.tasks > 0 ? (
          <p className="text-[13px] text-muted">
            {deleting.tasks === 1 ? '1 task keeps the name, shown in gray.' : `${deleting.tasks} tasks keep the name, shown in gray.`}
          </p>
        ) : undefined}
      />
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => { if (pending !== null) start(pending) }}
        title={`Discard changes to ${editing?.draft.name.trim() || 'this type'}?`}
        confirmLabel="Discard changes"
        tone="primary"
        body={<p className="text-[13px] text-muted">Your edits to this type aren't saved.</p>}
      />
    </section>
  )
}

function TypeRowItem({
  row, index, editable, reduce, onEdit, onMove, onDrop, children,
}: {
  row: Keyed
  index: number
  editable: boolean
  reduce: boolean
  onEdit: () => void
  onMove: (by: -1 | 1) => void
  onDrop: () => void
  children: ReactNode
}) {
  const controls = useDragControls()
  const { entry } = row

  function onHandleKey(event: KeyboardEvent) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      onMove(event.key === 'ArrowUp' ? -1 : 1)
    }
  }

  return (
    <Reorder.Item
      as="li"
      value={row}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDrop}
      transition={reduce ? { duration: 0 } : undefined}
      data-type-row=""
      data-index={index}
    >
      <div className="flex items-center gap-2 rounded-xl border border-line bg-[var(--surface-raised)] px-2 py-2 sm:gap-3 sm:px-3">
        {editable && (
          <button
            type="button"
            aria-label={`Move ${entry.name}`}
            title="Drag, or use the arrow keys, to reorder"
            onPointerDown={(event: PointerEvent) => controls.start(event)}
            onKeyDown={onHandleKey}
            className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-faint hover:text-ink active:cursor-grabbing"
          >
            <Icon name="dots" size={16} />
          </button>
        )}
        <TypeIcon entry={entry} size={36} />
        <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
          <p data-type-name="" className="truncate text-[14px] font-medium text-ink sm:w-48 sm:shrink-0">{entry.name}</p>
          <p className="truncate text-[12px] text-muted sm:flex-1 sm:text-[13px]">{entry.description}</p>
        </div>
        {entry.slot && <span className="eyebrow hidden shrink-0 text-faint sm:inline">{SLOT_LABEL[entry.slot]}</span>}
        {editable && (
          <button
            type="button"
            aria-label={`Edit ${entry.name}`}
            onClick={onEdit}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-[var(--surface-sunken)] hover:text-ink"
          >
            <Icon name="pen" size={15} />
          </button>
        )}
      </div>
      {entry.slot && <span className="eyebrow mt-1 block pl-12 text-faint sm:hidden">{SLOT_LABEL[entry.slot]}</span>}
      {children}
    </Reorder.Item>
  )
}
