// src/components/general/FieldInput.tsx
import { Input } from '../ui/Field'
import { Select, Textarea } from '../ui/Select'
import { FIELD_LIMIT } from '../../lib/general/fields'
import type { GeneralField, GeneralMember } from '../../lib/general/types'
import { fullName } from '../../lib/types'

/**
 * One control per field type. The value it hands back is raw — a string from a
 * text box, a boolean, a list — and `checkFieldValue` turns it into what is
 * stored, so validation lives in one place.
 *
 * A caller gives it a name one of two ways: `id`, to be the target of a
 * `<label htmlFor>`, or `labelledBy`, pointing at text already on the page.
 * Multiple choice is a group of checkboxes rather than one control, so only
 * `labelledBy` names it.
 */
export function FieldInput({
  field,
  value,
  onChange,
  members,
  id,
  labelledBy,
}: {
  field: GeneralField
  value: unknown
  onChange: (next: unknown) => void
  members: GeneralMember[]
  id?: string
  labelledBy?: string
}) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''

  switch (field.type) {
    case 'short_text':
      return (
        <Input id={id} aria-labelledby={labelledBy} maxLength={FIELD_LIMIT.shortText} value={text} onChange={(e) => onChange(e.target.value)} />
      )
    case 'long_text':
      return (
        <Textarea id={id} aria-labelledby={labelledBy} rows={4} maxLength={FIELD_LIMIT.longText} value={text} onChange={(e) => onChange(e.target.value)} />
      )
    case 'number':
      return <Input id={id} aria-labelledby={labelledBy} type="number" value={text} onChange={(e) => onChange(e.target.value)} />
    case 'money':
      return (
        <Input id={id} aria-labelledby={labelledBy} type="number" min={0} step="0.01" value={text} onChange={(e) => onChange(e.target.value)} />
      )
    case 'date':
      return <Input id={id} aria-labelledby={labelledBy} type="date" value={text} onChange={(e) => onChange(e.target.value)} />
    case 'link':
      return (
        <Input
          id={id} aria-labelledby={labelledBy}
          type="url"
          maxLength={FIELD_LIMIT.link}
          placeholder="https://"
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'single_choice':
      return (
        <Select
          id={id} aria-labelledby={labelledBy}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Not set"
          options={field.options.map((o) => ({ value: o, label: o }))}
        />
      )
    case 'yes_no':
      return (
        <Select
          id={id} aria-labelledby={labelledBy}
          value={value === true ? 'yes' : value === false ? 'no' : ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value === 'yes')}
          placeholder="Not set"
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
        />
      )
    case 'member':
      return (
        <Select
          id={id} aria-labelledby={labelledBy}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Nobody"
          options={members.map((m) => ({
            value: m.user_id,
            label: m.profile ? fullName(m.profile) : 'A member',
          }))}
        />
      )
    case 'multi_choice': {
      const chosen = Array.isArray(value) ? (value as string[]) : []
      return (
        <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
          {field.options.map((o) => {
            const on = chosen.includes(o)
            return (
              <label
                key={o}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] ${
                  on ? 'border-navy-400 bg-navy-500/10 text-ink' : 'border-line text-muted'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onChange(on ? chosen.filter((x) => x !== o) : [...chosen, o])}
                />
                {o}
              </label>
            )
          })}
        </div>
      )
    }
  }
}
