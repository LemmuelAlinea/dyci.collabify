// src/pages/general/SpaceLookPanel.tsx
import { useEffect, useId, useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { ProjectMark } from '../../components/general/ProjectMark'
import { CustomColor, PICK } from '../../components/general/settings/GeneralSection'
import { notifySpaceLooksChanged } from '../../hooks/useSpaceLooks'
import { listSpaceLooks, setSpaceLook } from '../../lib/api/spaces'
import { authErrorMessage } from '../../lib/authError'
import {
  PROJECT_COLORS,
  PROJECT_ICONS,
  SWATCH_CLASS,
  isCustomColor,
  projectLookLabel,
} from '../../lib/general/projectLook'
import type { GeneralSpaceSummary, ProjectColor, ProjectIcon } from '../../lib/general/types'

type Look = { color: ProjectColor | null; icon: ProjectIcon | null }

const PLAIN: Look = { color: null, icon: null }

/**
 * A work space's color and icon (supabase/space-look.sql), from the same sets
 * as a project's. Everybody in the space reads how it is set; only the project
 * manager changes it, and not while the space is archived.
 */
export function SpaceLookPanel({ space }: { space: GeneralSpaceSummary }) {
  const { show } = useToast()
  const group = useId()
  const [stored, setStored] = useState<Look | null>(null)
  // Only what somebody has changed; the rest reads from the saved look.
  const [draft, setDraft] = useState<Partial<Look>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setStored(null)
    setDraft({})
    listSpaceLooks([space.id]).then(
      (rows) => {
        if (live) setStored(rows[0] ? { color: rows[0].color, icon: rows[0].icon } : PLAIN)
      },
      () => {
        if (live) setStored(PLAIN)
      },
    )
    return () => {
      live = false
    }
  }, [space.id])

  const archived = Boolean(space.archived_at)
  const editable = space.my_role === 'pm' && !archived && stored !== null
  const base = stored ?? PLAIN
  const look: Look = { ...base, ...draft }
  const dirty = (Object.keys(draft) as (keyof Look)[]).some((k) => draft[k] !== base[k])
  const set = <K extends keyof Look>(key: K, value: Look[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setError(null)
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await setSpaceLook(space.id, look.color, look.icon)
      setStored(look)
      setDraft({})
      notifySpaceLooksChanged()
      show('Look saved')
    } catch (err) {
      setError(authErrorMessage(err, 'Could not save the look. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-panel border border-line p-4 sm:p-5" aria-labelledby={`${group}-title`}>
      <h2 id={`${group}-title`} className="text-[15px]">Look</h2>
      <p className="mt-1 text-[13px] text-muted">
        {archived
          ? 'Restore the space to change its look.'
          : space.my_role === 'pm'
            ? 'How the space appears on its card and in the side menu.'
            : 'How the space appears on its card and in the side menu. Only the project manager changes it.'}
      </p>

      <div className="mt-4 space-y-6">
        {error && <Alert tone="error">{error}</Alert>}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_232px] lg:items-start">
          <div className="min-w-0 space-y-6">
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
                <CustomColor
                  group={group}
                  value={isCustomColor(look.color) ? look.color : null}
                  disabled={!editable}
                  onPick={(hex) => set('color', hex)}
                />
              </div>
            </fieldset>

            <fieldset className="min-w-0 space-y-2">
              <legend className="text-[13px] font-medium text-ink">Icon</legend>
              <p className="text-[12px] text-muted">With no icon, the tile shows the space&apos;s first letter.</p>
              {/* Columns fill the width at 44px minimum, so a phone gets a grid of tappable tiles. */}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-2">
                <label className={PICK} title="First letter">
                  <input
                    type="radio"
                    name={`${group}-icon`}
                    value=""
                    aria-label="First letter"
                    checked={look.icon === null}
                    disabled={!editable}
                    onChange={() => set('icon', null)}
                    className="sr-only"
                  />
                  <span aria-hidden className="font-display text-[14px] font-bold">
                    {space.name.trim().charAt(0).toUpperCase() || 'S'}
                  </span>
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
          </div>

          <SpaceLookPreview name={space.name} look={look} />
        </div>
      </div>

      {space.my_role === 'pm' && !archived && (
        <div className="mt-5 flex justify-end border-t border-line pt-4">
          <Button onClick={() => void save()} loading={busy} disabled={!dirty} className="!rounded-xl">
            Save look
          </Button>
        </div>
      )}
    </section>
  )
}

/** How the chosen color and icon will look: the space card and the side menu. */
function SpaceLookPreview({ name, look }: { name: string; look: Look }) {
  return (
    <section aria-label="Preview" className="space-y-3 lg:sticky lg:top-4">
      <p className="eyebrow text-faint">Preview</p>

      <div className="rounded-xl border border-line bg-[var(--surface)] p-3.5">
        <div className="flex items-center gap-3">
          <ProjectMark color={look.color} icon={look.icon} name={name} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] font-semibold text-ink">{name}</p>
            <p className="text-[12px] text-muted">Space card</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-[var(--surface-sunken)] p-2.5">
        <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
          <ProjectMark color={look.color} icon={look.icon} name={name} size="sm" />
          <span className="min-w-0 truncate text-[13px] text-ink">{name}</span>
        </div>
        <p className="mt-1 px-2 text-[11px] text-faint">Side menu</p>
      </div>
    </section>
  )
}
