import { useState } from 'react'
import { inkFor, normalizeHex } from '../../lib/palette'
import { TYPE_SWATCHES } from '../../lib/taskTypes/colors'
import { TASK_TYPE_ICONS, TYPE_ICON_GLYPH, typeIconLabel } from '../../lib/taskTypes/icons'
import type { TaskTypeEntry } from '../../lib/taskTypes/typeSet'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Field, Input, Textarea } from '../ui/Field'
import { Icon } from '../ui/Icon'
import { TypeChip } from './TypeChip'

/** The inline "Edit task type" panel: name, description, color, icon and a preview. */
export function TypeEditPanel({
  draft,
  onChange,
  onSave,
  onCancel,
  onDelete,
  busy,
  error,
}: {
  draft: TaskTypeEntry
  onChange: (next: TaskTypeEntry) => void
  onSave: () => void
  onCancel: () => void
  /** Custom types only; slots can't be deleted. */
  onDelete?: () => void
  busy: boolean
  error: string | null
}) {
  const [hex, setHex] = useState(draft.color)
  const set = <K extends keyof TaskTypeEntry>(key: K, value: TaskTypeEntry[K]) => onChange({ ...draft, [key]: value })

  function pickColor(next: string) {
    setHex(next)
    set('color', next)
  }

  return (
    <div className="mt-2 rounded-xl border border-line-strong p-4 sm:p-5" data-type-panel="">
      <p className="mb-4 text-[13px] font-medium text-ink">Edit task type</p>
      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name">
          {(id) => (
            <Input id={id} aria-label="Name" value={draft.name} maxLength={40} disabled={busy}
              onChange={(e) => set('name', e.target.value)} />
          )}
        </Field>
        <Field label="Description" optional>
          {(id) => (
            <Textarea id={id} aria-label="Description" value={draft.description} maxLength={120} rows={2} disabled={busy}
              onChange={(e) => set('description', e.target.value)} />
          )}
        </Field>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-[13px] font-medium text-ink">Color</legend>
        <div className="flex flex-wrap items-center gap-2">
          {TYPE_SWATCHES.map((swatch) => {
            const on = draft.color === swatch.hex
            return (
              <button
                key={swatch.hex}
                type="button"
                aria-label={swatch.name}
                aria-pressed={on}
                disabled={busy}
                onClick={() => pickColor(swatch.hex)}
                className={`flex h-7 w-7 items-center justify-center rounded-full ring-offset-2 ring-offset-[var(--surface)] transition-shadow ${on ? 'ring-2 ring-[var(--ink)]' : 'hover:ring-2 hover:ring-[var(--line-strong)]'}`}
                style={{ background: swatch.hex }}
              >
                {on && <Icon name="check" size={14} style={{ color: inkFor(swatch.hex) }} />}
              </button>
            )
          })}
          <Input
            aria-label="Hex color"
            value={hex}
            maxLength={7}
            disabled={busy}
            className="!h-9 w-28 font-mono !text-[13px]"
            onChange={(e) => {
              setHex(e.target.value)
              const clean = normalizeHex(e.target.value)
              if (clean) set('color', clean)
            }}
            onBlur={() => setHex(draft.color)}
          />
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="mb-2 text-[13px] font-medium text-ink">Icon</legend>
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-10 lg:grid-cols-12">
          {TASK_TYPE_ICONS.map((key) => {
            const on = draft.icon === key
            return (
              <button
                key={key}
                type="button"
                aria-label={typeIconLabel(key)}
                title={typeIconLabel(key)}
                aria-pressed={on}
                disabled={busy}
                onClick={() => set('icon', key)}
                className={`flex h-9 items-center justify-center rounded-lg border transition-colors ${on ? 'border-navy-600 bg-navy-500/12 text-ink dark:border-amber-400' : 'border-transparent text-muted hover:border-line-strong hover:text-ink'}`}
              >
                <Icon name={TYPE_ICON_GLYPH[key]} size={18} />
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="mt-4 border-t border-line pt-4" data-type-preview="">
        <p className="mb-2 text-[13px] font-medium text-ink">Preview</p>
        <TypeChip entry={{ ...draft, name: draft.name.trim() || 'Untitled', removed: false }} size="md" />
      </div>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>{onDelete && <Button variant="ghost" className="text-danger-700 dark:text-danger-300" onClick={onDelete} disabled={busy}>Delete type</Button>}</div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={onSave} loading={busy}>Save type</Button>
        </div>
      </div>
    </div>
  )
}
