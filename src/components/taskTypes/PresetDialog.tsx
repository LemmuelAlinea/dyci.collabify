import { useEffect, useState } from 'react'
import { authErrorMessage } from '../../lib/authError'
import { applyPreset, presetByKey, TASK_TYPE_PRESETS } from '../../lib/taskTypes/presets'
import { typeSetProblem } from '../../lib/taskTypes/typeSet'
import type { TaskTypeEntry, TypeFamily } from '../../lib/taskTypes/typeSet'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/Select'
import { TypeIcon } from './TypeIcon'

type Leaving = { name: string; tasks: number }

/**
 * "Explore task type presets": one preset at a time, each type with its icon, description and color.
 * Apply preset replaces the project's list; when tasks would lose their type it asks first and names
 * them, and those tasks keep the name, shown in gray.
 */
export function PresetDialog({
  open,
  family,
  current,
  currentPreset,
  loadCounts,
  onApply,
  onClose,
}: {
  open: boolean
  family: TypeFamily
  current: TaskTypeEntry[]
  currentPreset: string | null
  loadCounts: () => Promise<Map<string, number>>
  onApply: (set: TaskTypeEntry[], presetKey: string) => Promise<void>
  onClose: () => void
}) {
  const [key, setKey] = useState(presetByKey(currentPreset)?.key ?? TASK_TYPE_PRESETS[0].key)
  const [leaving, setLeaving] = useState<Leaving[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setKey(presetByKey(currentPreset)?.key ?? TASK_TYPE_PRESETS[0].key)
    setLeaving(null)
    setError(null)
  }, [open, currentPreset])

  const preset = presetByKey(key) ?? TASK_TYPE_PRESETS[0]
  const result = applyPreset(current, preset, family)
  const shownTypes = family === 'class' ? result.set : preset.types.map((t) => result.set.find((r) => r.name === t.name) ?? t)

  async function apply() {
    const problem = typeSetProblem(result.set, family)
    if (problem) return setError(problem)
    await run(result.set)
  }

  async function check() {
    setError(null)
    setBusy(true)
    try {
      const counts = result.removed.length ? await loadCounts() : new Map<string, number>()
      const withTasks = result.removed.map((name) => ({ name, tasks: counts.get(name) ?? 0 })).filter((l) => l.tasks > 0)
      if (withTasks.length) setLeaving(withTasks)
      else await apply()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not apply the preset.'))
    } finally {
      setBusy(false)
    }
  }

  async function run(set: TaskTypeEntry[]) {
    setBusy(true)
    setError(null)
    try {
      await onApply(set, preset.key)
      onClose()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not apply the preset.'))
    } finally {
      setBusy(false)
    }
  }

  const slotClash = (leaving ?? [])
    .map((l) => ({ ...l, slot: result.set.find((t) => t.slot !== null && t.name === l.name)?.slot }))
    .filter((l) => l.slot)

  const footer = leaving ? (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="ghost" onClick={() => setLeaving(null)} disabled={busy}>Go back</Button>
      <Button onClick={() => void apply()} loading={busy}>Apply preset</Button>
    </div>
  ) : (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button onClick={() => void check()} loading={busy}>Apply preset</Button>
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title={leaving ? `Apply ${preset.name}?` : 'Explore task type presets'} size="lg" footer={footer}>
      {error && <div className="mb-3"><Alert tone="error">{error}</Alert></div>}
      {leaving ? (
        <div className="space-y-2 text-[13px] text-muted">
          <p>
            These types leave the list: {leaving.map((l) => `${l.name} (${l.tasks} ${l.tasks === 1 ? 'task' : 'tasks'})`).join(', ')}.
            {' '}Their tasks keep the name, shown in gray.
          </p>
          {slotClash.map((l) => (
            <p key={l.name}>
              {l.name} tasks from the old list stay gray. {l.slot === 'bug' ? "They aren't QA's bugs." : "They aren't the default type."}
            </p>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <Select
            aria-label="Preset"
            value={preset.key}
            onChange={(e) => setKey(e.target.value)}
            options={TASK_TYPE_PRESETS.map((p) => ({ value: p.key, label: p.name }))}
          />
          <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
            <h3 className="flex min-w-0 items-center gap-2 font-display text-[16px] font-semibold text-ink">
              <Icon name={preset.icon} size={18} className="shrink-0 text-muted" />
              <span className="truncate">{preset.name}</span>
            </h3>
            <span className="shrink-0 font-mono text-[12px] text-muted">{preset.types.length} types</span>
          </div>
          <ul className="divide-y divide-[var(--line)]">
            {shownTypes.map((t) => (
              <li key={t.name} data-preset-row="" className="flex items-center gap-3 py-2.5">
                <TypeIcon entry={t} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink">{t.name}</p>
                  <p className="truncate text-[12px] text-muted">
                    {t.description}
                    {t.slot === 'default' && <span className="eyebrow ml-2 text-faint">Default</span>}
                    {t.slot === 'bug' && <span className="eyebrow ml-2 text-faint">QA's bugs</span>}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span aria-hidden="true" className="h-2 w-8 rounded-full" style={{ background: t.color }} />
                  <span className="font-mono text-[11px] text-muted">{t.color.toUpperCase()}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}
