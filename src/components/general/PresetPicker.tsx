import { useState } from 'react'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { Select } from '../ui/Select'
import { AUDIENCE_LABEL, presetSummary, presetsFor } from '../../lib/general/presets'
import { payloadSummary } from '../../lib/general/templates'
import type { GeneralTemplate } from '../../lib/api/general'
import type { PresetAudience } from '../../lib/general/presets'

/**
 * A head start, not a category.
 *
 * The filter asks who runs the project rather than what the project is, because
 * a school event looks the same whether a Grade 4 adviser or the dean is
 * running it — what differs is the list you want to see first. Everything a
 * preset writes can be renamed, reordered or removed the moment the project
 * opens, so picking the wrong one costs nothing.
 */
export function PresetPicker({
  value,
  onChange,
  audience,
  onAudienceChange,
  templates = [],
  onDeleteTemplate,
}: {
  value: string
  onChange: (next: string) => void
  audience: PresetAudience | ''
  onAudienceChange: (next: PresetAudience | '') => void
  /** The person's own, saved from projects they were on. Picked as `tpl:<id>`. */
  templates?: GeneralTemplate[]
  onDeleteTemplate?: (id: string) => Promise<void>
}) {
  const shown = presetsFor(audience)
  const [removing, setRemoving] = useState<GeneralTemplate | null>(null)

  return (
    <fieldset>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <legend className="text-[12px] font-medium text-ink">Start from</legend>
        <Select
          aria-label="Who runs this kind of project"
          value={audience}
          onChange={(e) => onAudienceChange(e.target.value as PresetAudience | '')}
          placeholder="Everyone"
          options={Object.entries(AUDIENCE_LABEL).map(([v, label]) => ({ value: v, label }))}
          className="!h-8 !w-[13rem] !text-[12px]"
        />
      </div>

      <div className="grid max-h-[15rem] gap-2 overflow-y-auto pr-0.5 sm:grid-cols-2">
        {templates.length > 0 && (
          <p className="text-[11px] font-medium text-faint sm:col-span-2">Your templates</p>
        )}
        {templates.map((t) => {
          const on = value === `tpl:${t.id}`
          return (
            <div key={t.id} className="relative">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onChange(`tpl:${t.id}`)}
                className={`w-full rounded-xl border px-3 py-2.5 pr-9 text-left transition-[border-color,background-color,box-shadow] duration-200 ${
                  on
                    ? 'border-navy-500 bg-navy-50 ring-4 ring-navy-500/12 dark:bg-navy-500/15'
                    : 'surface border-[var(--line)] hover:border-[var(--line-strong)]'
                }`}
              >
                <span
                  className={`flex items-center gap-1.5 text-[13px] font-semibold ${
                    on ? 'text-navy-700 dark:text-navy-100' : 'text-ink'
                  }`}
                >
                  <Icon name="copy" size={15} />
                  <span className="truncate">{t.name}</span>
                </span>
                {t.blurb && <span className="mt-1 block text-[11px] leading-snug text-muted">{t.blurb}</span>}
                <span className="mt-1.5 block font-mono text-[10px] text-faint">{payloadSummary(t.payload)}</span>
              </button>
              {onDeleteTemplate && (
                <button
                  type="button"
                  aria-label={`Remove the template ${t.name}`}
                  title="Remove template"
                  onClick={() => setRemoving(t)}
                  className="absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-md text-faint hover:bg-[var(--surface-sunken)] hover:text-destructive-600"
                >
                  <Icon name="trash" size={13} />
                </button>
              )}
            </div>
          )
        })}
        {templates.length > 0 && (
          <p className="mt-1 text-[11px] font-medium text-faint sm:col-span-2">Built in</p>
        )}
        {shown.map((p) => {
          const on = p.id === value
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(p.id)}
              className={`rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color,box-shadow] duration-200 ${
                on
                  ? 'border-navy-500 bg-navy-50 ring-4 ring-navy-500/12 dark:bg-navy-500/15'
                  : 'surface border-[var(--line)] hover:border-[var(--line-strong)]'
              }`}
            >
              <span
                className={`flex items-center gap-1.5 text-[13px] font-semibold ${
                  on ? 'text-navy-700 dark:text-navy-100' : 'text-ink'
                }`}
              >
                <Icon name={p.icon} size={15} />
                {p.name}
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-muted">{p.blurb}</span>
              <span className="mt-1.5 block font-mono text-[10px] text-faint">{presetSummary(p)}</span>
            </button>
          )
        })}
      </div>
      {onDeleteTemplate && (
        <ConfirmDialog
          open={Boolean(removing)}
          onClose={() => setRemoving(null)}
          onConfirm={() => (removing ? onDeleteTemplate(removing.id) : undefined)}
          title={`Remove ${removing?.name ?? 'template'}?`}
          confirmLabel="Remove template"
          body="Projects already started from it keep everything they have."
        />
      )}
      <p className="mt-1.5 text-[11px] text-faint">
        Whatever a preset adds is yours to rename, reorder or remove once the project opens.
      </p>
    </fieldset>
  )
}
