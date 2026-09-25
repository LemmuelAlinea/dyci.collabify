import type { ReactNode } from 'react'
import { ActionMenu } from '../../ui/ActionMenu'
import type { ActionMenuItem } from '../../ui/ActionMenu'
import { Button } from '../../ui/Button'
import { CheckboxList } from '../../ui/CheckboxList'
import { Input, Toggle } from '../../ui/Field'
import { Icon } from '../../ui/Icon'
import { Select, Textarea } from '../../ui/Select'
import type { ReportTemplate, ScopeRow } from '../../../lib/api/generalReports'
import { PRESETS, SECTION_LABELS } from '../../../lib/general/reportConfig'
import type { ReportConfig, ReportPresetId, ReportSectionId, ScoreWeights } from '../../../lib/general/reportConfig'
import { ACTIVITY_KINDS } from '../../../lib/general/history'
import { RANGE_PRESETS } from '../../../lib/general/reportRange'
import type { RangePreset } from '../../../lib/general/reportRange'

const GROUPS: { label: string; ids: ReportSectionId[] }[] = [
  { label: 'Summary', ids: ['summary', 'narrative', 'progress', 'status', 'forecast'] },
  { label: 'People', ids: ['people', 'score'] },
  { label: 'Activity', ids: ['activity'] },
  { label: 'Detail', ids: ['tasks', 'timeLogs', 'commits', 'reviews'] },
  { label: 'Space', ids: ['projectComparison'] },
]

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-4 first:border-t-0 first:pt-0" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="eyebrow text-[11px] text-muted">
        {n}. {title}
      </h2>
      {children}
    </section>
  )
}

export type BuilderProps = {
  config: ReportConfig
  onChange: (next: ReportConfig) => void
  onPreset: (id: ReportPresetId) => void
  scope: ScopeRow[]
  isLead: boolean
  people: { id: string; label: string; hint?: string }[]
  teams: { id: string; label: string; hint?: string }[]
  templates: ReportTemplate[]
  viewerId: string
  canManageSpace: boolean
  onOpenTemplate: (t: ReportTemplate) => void
  onTemplateAction: (t: ReportTemplate, action: 'rename' | 'share' | 'duplicate' | 'delete') => void
  onSave: () => void
  onSaveAs: () => void
  activeTemplate: ReportTemplate | null
  onPrint: () => void
  csvItems: ActionMenuItem[]
  onCopyLink: () => void
}

export function ReportBuilder(p: BuilderProps) {
  const { config: c, onChange } = p
  const set = (patch: Partial<ReportConfig>) => onChange({ ...c, ...patch, preset: undefined })
  const setSection = (id: ReportSectionId, on: boolean) => set({ sections: { ...c.sections, [id]: on } })
  const live = p.scope.filter((x) => c.includeArchived || !x.archived)
  const mine = p.templates.filter((t) => t.owner_id === p.viewerId)
  const shared = p.templates.filter((t) => t.owner_id !== p.viewerId)
  const weights = c.score.weights
  const weightTotal = weights.points + weights.hours + weights.repo + weights.comments

  function setWeight(key: keyof ScoreWeights, value: number) {
    // The other three share what is left, in proportion, so the four always make 100.
    const others = (Object.keys(weights) as (keyof ScoreWeights)[]).filter((k) => k !== key)
    const rest = 100 - value
    const otherSum = others.reduce((s, k) => s + weights[k], 0)
    const next = { ...weights, [key]: value }
    let used = 0
    others.forEach((k, i) => {
      const share = i === others.length - 1 ? rest - used : Math.round(otherSum ? (weights[k] / otherSum) * rest : rest / others.length)
      next[k] = Math.max(0, share)
      used += next[k]
    })
    set({ score: { weights: next } })
  }

  const templateRow = (t: ReportTemplate) => {
    const own = t.owner_id === p.viewerId
    const items: ActionMenuItem[] = [
      { label: 'Open', icon: 'file', onSelect: () => p.onOpenTemplate(t) },
      { label: 'Duplicate', icon: 'copy', onSelect: () => p.onTemplateAction(t, 'duplicate') },
    ]
    if (own || p.canManageSpace) {
      items.push(
        { label: 'Rename', icon: 'edit', onSelect: () => p.onTemplateAction(t, 'rename') },
        { label: t.shared ? 'Stop sharing' : 'Share with the space', icon: 'users', onSelect: () => p.onTemplateAction(t, 'share') },
        { label: 'Delete', icon: 'trash', tone: 'danger', separated: true, onSelect: () => p.onTemplateAction(t, 'delete') },
      )
    }
    return (
      <li key={t.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${p.activeTemplate?.id === t.id ? 'surface-sunken' : ''}`}>
        <button type="button" onClick={() => p.onOpenTemplate(t)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] text-ink">{t.name}</span>
          <span className="block truncate text-[11px] text-faint">
            {t.shared ? 'Shared with the space' : 'Only you'}
            {t.description ? ` · ${t.description}` : ''}
          </span>
        </button>
        <ActionMenu label={`Actions for ${t.name}`} items={items} size="sm" />
      </li>
    )
  }

  return (
    <div className="space-y-5">
      <Step n={1} title="Start from">
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((pr) => (
            <button
              key={pr.id}
              type="button"
              onClick={() => p.onPreset(pr.id)}
              aria-pressed={c.preset === pr.id}
              className={`rounded-card border p-2.5 text-left transition-colors ${
                c.preset === pr.id ? 'border-navy-600 bg-navy-600/6 dark:border-navy-300' : 'border-line hover:border-line-strong'
              }`}
            >
              <span className="block text-[13px] font-medium text-ink">{pr.label}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted">{pr.body}</span>
            </button>
          ))}
        </div>
        {(mine.length > 0 || shared.length > 0) && (
          <div className="space-y-2">
            {mine.length > 0 && (
              <div>
                <p className="text-[12px] font-medium text-muted">Your saved reports</p>
                <ul className="mt-1 space-y-0.5">{mine.map(templateRow)}</ul>
              </div>
            )}
            {shared.length > 0 && (
              <div>
                <p className="text-[12px] font-medium text-muted">Shared in this space</p>
                <ul className="mt-1 space-y-0.5">{shared.map(templateRow)}</ul>
              </div>
            )}
          </div>
        )}
      </Step>

      <Step n={2} title="Scope">
        <div role="radiogroup" aria-label="Report on" className="grid grid-cols-2 rounded-xl border border-line p-1">
          {(['project', 'space'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={c.scope === s}
              onClick={() => {
                const first = live[0]?.project_id
                set({ scope: s, projectIds: s === 'project' ? (c.projectIds !== 'all' && c.projectIds[0] ? [c.projectIds[0]] : first ? [first] : 'all') : 'all' })
              }}
              className={`rounded-lg py-1.5 text-[13px] font-medium ${c.scope === s ? 'bg-navy-600 text-white dark:bg-navy-500' : 'text-muted hover:text-ink'}`}
            >
              {s === 'project' ? 'One project' : 'Whole space'}
            </button>
          ))}
        </div>
        {c.scope === 'project' ? (
          <Select
            aria-label="Project"
            value={c.projectIds === 'all' ? '' : c.projectIds[0] ?? ''}
            onChange={(e) => set({ projectIds: e.target.value ? [e.target.value] : 'all' })}
            options={live.map((x) => ({ value: x.project_id, label: `${x.name}${x.is_lead ? '' : ' (your work only)'}${x.archived ? ' (archived)' : ''}` }))}
            className="!h-10 !text-[13px]"
          />
        ) : (
          <>
            <label className="flex items-center gap-2.5 px-2 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={c.projectIds === 'all'}
                onChange={(e) => set({ projectIds: e.target.checked ? 'all' : live.map((x) => x.project_id) })}
                className="h-4 w-4 accent-navy-600"
              />
              All projects ({live.length})
            </label>
            {c.projectIds !== 'all' && (
              <CheckboxList
                label="Projects"
                searchable
                items={live.map((x) => ({
                  id: x.project_id,
                  label: x.name,
                  hint: [x.is_lead ? '' : 'Your work only', x.archived ? 'Archived' : ''].filter(Boolean).join(' · ') || undefined,
                }))}
                selected={c.projectIds}
                onChange={(ids) => set({ projectIds: ids.length ? ids : 'all' })}
              />
            )}
          </>
        )}
      </Step>

      <Step n={3} title="Dates">
        <Select
          aria-label="Date range"
          value={c.range.preset}
          onChange={(e) => set({ range: { ...c.range, preset: e.target.value as RangePreset } })}
          options={RANGE_PRESETS}
          className="!h-10 !text-[13px]"
        />
        {c.range.preset === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[12px] text-muted">
              From
              <Input type="date" value={c.range.from ?? ''} onChange={(e) => set({ range: { ...c.range, from: e.target.value } })} className="!h-10 !text-[13px]" />
            </label>
            <label className="text-[12px] text-muted">
              To
              <Input type="date" value={c.range.to ?? ''} onChange={(e) => set({ range: { ...c.range, to: e.target.value } })} className="!h-10 !text-[13px]" />
            </label>
          </div>
        )}
        {c.range.preset === 'day' && (
          <label className="block text-[12px] text-muted">
            Day
            <Input type="date" value={c.range.from ?? ''} onChange={(e) => set({ range: { ...c.range, from: e.target.value } })} className="!h-10 !text-[13px]" />
          </label>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink">Compare with the previous period</span>
          <Toggle label="Compare with the previous period" checked={c.compare} onChange={(v) => set({ compare: v })} />
        </div>
      </Step>

      <Step n={4} title="People">
        {p.isLead ? (
          <>
            <p className="text-[12px] text-muted">Leave both empty for everyone.</p>
            <p className="text-[12px] font-medium text-muted">People</p>
            <CheckboxList label="People" searchable items={p.people} selected={c.people} onChange={(ids) => set({ people: ids })} empty="Nobody else is in this space." />
            <p className="text-[12px] font-medium text-muted">Teams</p>
            <CheckboxList label="Teams" searchable items={p.teams} selected={c.teams} onChange={(ids) => set({ teams: ids })} empty="There are no teams here." />
          </>
        ) : (
          <div className="space-y-2">
            <span className="inline-flex items-center gap-1.5 rounded-full surface-sunken px-2.5 py-1 text-[12px] font-medium text-ink">
              <Icon name="lock" size={12} /> You
            </span>
            <p className="text-[12px] text-muted">Your reports show your own work. Owners and Managers see everyone.</p>
          </div>
        )}
      </Step>

      <Step n={5} title="Sections">
        {GROUPS.map((g) => {
          const ids = g.ids.filter((id) => id !== 'projectComparison' || c.scope === 'space').filter((id) => id !== 'score' || p.isLead)
          if (ids.length === 0) return null
          return (
            <fieldset key={g.label}>
              <legend className="text-[12px] font-medium text-muted">{g.label}</legend>
              <div className="mt-1 grid gap-0.5">
                {ids.map((id) => (
                  <label key={id} className="flex items-center gap-2.5 rounded-lg px-2 py-1 text-[13px] text-ink hover:bg-[var(--surface-sunken)]">
                    <input type="checkbox" checked={c.sections[id]} onChange={(e) => setSection(id, e.target.checked)} className="h-4 w-4 accent-navy-600" />
                    {SECTION_LABELS[id]}
                  </label>
                ))}
              </div>
              {g.label === 'Activity' && c.sections.activity && (
                <div className="mt-2 space-y-2 pl-2">
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Activity kinds">
                    {ACTIVITY_KINDS.map((k) => {
                      const on = k.kinds.every((x) => c.activityKinds.includes(x))
                      return (
                        <button
                          key={k.label}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            set({
                              activityKinds: on
                                ? c.activityKinds.filter((x) => !k.kinds.includes(x))
                                : [...new Set([...c.activityKinds, ...k.kinds])],
                            })
                          }
                          className={`rounded-full border px-2.5 py-0.5 text-[12px] ${on ? 'border-navy-600 bg-navy-600 text-white dark:border-navy-400 dark:bg-navy-500' : 'border-line text-muted hover:text-ink'}`}
                        >
                          {k.label}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[11px] text-faint">{c.activityKinds.length ? 'Only the kinds picked.' : 'Every kind. Pick some to narrow it.'}</p>
                  <Select
                    aria-label="Group activity by"
                    value={c.groupActivityBy}
                    onChange={(e) => set({ groupActivityBy: e.target.value as ReportConfig['groupActivityBy'] })}
                    options={[
                      { value: 'day', label: 'Group by day' },
                      { value: 'person', label: 'Group by person' },
                      { value: 'project', label: 'Group by project' },
                    ]}
                    className="!h-9 !text-[13px]"
                  />
                </div>
              )}
            </fieldset>
          )
        })}
      </Step>

      {c.sections.score && p.isLead && (
        <Step n={6} title="Score weights">
          {(['points', 'hours', 'repo', 'comments'] as const).map((k) => (
            <label key={k} className="block">
              <span className="flex justify-between text-[12px] text-muted">
                <span>{k === 'repo' ? 'Repository work' : k[0].toUpperCase() + k.slice(1)}</span>
                <span className="font-mono tabular-nums text-ink">{weights[k]}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={weights[k]}
                onChange={(e) => setWeight(k, Number(e.target.value))}
                className="w-full accent-navy-600"
              />
            </label>
          ))}
          <p className="text-[11px] text-faint">Total {weightTotal}%. Each weight applies to that person&apos;s share of the report&apos;s total.</p>
        </Step>
      )}

      <Step n={c.sections.score && p.isLead ? 7 : 6} title="Options">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-ink">Include archived work</span>
          <Toggle label="Include archived work" checked={c.includeArchived} onChange={(v) => set({ includeArchived: v })} />
        </div>
        <label className="block text-[12px] text-muted">
          Report title
          <Input value={c.title ?? ''} maxLength={120} placeholder="Leave empty for the default" onChange={(e) => set({ title: e.target.value || undefined })} className="!h-10 !text-[13px]" />
        </label>
        <label className="block text-[12px] text-muted">
          Note from you
          <Textarea value={c.note ?? ''} maxLength={2000} rows={3} placeholder="Printed under the summary, with your name" onChange={(e) => set({ note: e.target.value || undefined })} />
        </label>
      </Step>

      <Step n={c.sections.score && p.isLead ? 8 : 7} title="Actions">
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={p.onSave}>{p.activeTemplate && (p.activeTemplate.owner_id === p.viewerId || p.canManageSpace) ? 'Save' : 'Save report'}</Button>
          <Button size="sm" variant="outline" onClick={p.onSaveAs}>Save as new</Button>
          <Button size="sm" variant="outline" onClick={p.onPrint}>
            <Icon name="file" size={14} /> Print or PDF
          </Button>
          <div className="flex h-9 items-center justify-between rounded-xl border border-[var(--line-strong)] pr-0.5 pl-3 text-[13px] text-ink">
            <span className="flex items-center gap-1.5"><Icon name="download" size={14} /> CSV</span>
            <ActionMenu label="Download a table as CSV" items={p.csvItems} align="start" size="sm" />
          </div>
          <Button size="sm" variant="ghost" onClick={p.onCopyLink} className="col-span-2">
            <Icon name="copy" size={14} /> Copy link to this report
          </Button>
        </div>
      </Step>
    </div>
  )
}
