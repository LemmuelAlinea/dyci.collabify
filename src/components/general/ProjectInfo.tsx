// src/components/general/ProjectInfo.tsx
import { dateRange } from '../../lib/general/dates'
import { checkFieldValue, formatFieldValue } from '../../lib/general/fields'
import type { FieldValue } from '../../lib/general/fields'
import { projectStatusLabel } from '../../lib/general/types'
import type { GeneralField } from '../../lib/general/types'
import { stagesOf } from '../../lib/stages'
import type { GeneralProjectState } from './useGeneralProject'

/*
 * The read-only look of a project's details, stages and fields. Overview's
 * Project info and the Settings sections share it, so a value reads the same
 * wherever it is shown.
 */

export function StoredFieldValue({
  field,
  value,
  nameOf,
}: {
  field: GeneralField
  value: FieldValue | undefined
  nameOf: (id: string) => string
}) {
  if (value === undefined) return 'Not set'
  const text = formatFieldValue(field.type, value, nameOf)
  const link = field.type === 'link' ? checkFieldValue('link', value, { options: [], memberIds: [] }) : null
  return link?.ok && typeof link.value === 'string' ? (
    <a
      href={link.value}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-navy-600 underline decoration-navy-600/35 underline-offset-2 hover:decoration-current dark:text-navy-200 dark:decoration-navy-200/35"
    >
      {text}
    </a>
  ) : text
}

export function DetailsView({ state }: { state: GeneralProjectState }) {
  const p = state.project
  if (!p) return null
  return (
    <dl className="space-y-3 text-[14px]">
      <div>
        <dt className="text-[12px] text-faint">Name</dt>
        <dd className="text-ink">{p.name}</dd>
      </div>
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

export function StagesView({ state }: { state: GeneralProjectState }) {
  const p = state.project
  if (!p) return null
  return (
    <dl className="space-y-3 text-[14px]">
      <div>
        <dt className="text-[12px] text-faint">Progress stages</dt>
        <dd className="text-ink">{stagesOf(p.stages).join(' → ')}</dd>
      </div>
      {p.qa_stage && (
        <div>
          <dt className="text-[12px] text-faint">QA stage</dt>
          <dd className="text-ink">{p.qa_stage}</dd>
        </div>
      )}
    </dl>
  )
}

/** A field, read: small label, value in ink. */
export function FieldReadRow({ field, state }: { field: GeneralField; state: GeneralProjectState }) {
  const stored = state.values.find((v) => v.field_id === field.id)
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <p className="text-[12px] text-faint">{field.name}</p>
      <p className={`mt-0.5 text-[14px] whitespace-pre-wrap ${stored ? 'text-ink' : 'text-muted'}`}>
        <StoredFieldValue field={field} value={stored?.value} nameOf={state.nameOf} />
      </p>
    </li>
  )
}

export function FieldsView({ state }: { state: GeneralProjectState }) {
  if (state.fields.length === 0) return <p className="text-[14px] text-muted">Nobody has added fields to this project.</p>
  return (
    <ul className="divide-y divide-[var(--line)]">
      {state.fields.map((f) => (
        <FieldReadRow key={f.id} field={f} state={state} />
      ))}
    </ul>
  )
}
