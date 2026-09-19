import { Icon } from '../ui/Icon'
import { Select } from '../ui/Select'
import { AUDIENCE_LABEL, presetSummary, presetsFor } from '../../lib/general/presets'
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
}: {
  value: string
  onChange: (next: string) => void
  audience: PresetAudience | ''
  onAudienceChange: (next: PresetAudience | '') => void
}) {
  const shown = presetsFor(audience)

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
      <p className="mt-1.5 text-[11px] text-faint">
        Whatever a preset adds is yours to rename, reorder or remove once the project opens.
      </p>
    </fieldset>
  )
}
