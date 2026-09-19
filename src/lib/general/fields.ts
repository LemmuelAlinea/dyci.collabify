/**
 * The fields a project creator adds on top of the core ones.
 *
 * A value is stored as JSON, so the database cannot lean on column types to
 * keep it honest. `guard_general_field_value()` in supabase/general.sql checks
 * every rule below; this file runs the same checks first so the form can say
 * what is wrong before a save is refused. Keep the two in step.
 */

export type FieldType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'money'
  | 'date'
  | 'single_choice'
  | 'multi_choice'
  | 'yes_no'
  | 'member'
  | 'link'

export type FieldValue = string | number | boolean | string[]

export const FIELD_TYPES: { value: FieldType; label: string; hint: string }[] = [
  { value: 'short_text', label: 'Short text', hint: 'A name, a venue, a code' },
  { value: 'long_text', label: 'Long text', hint: 'Notes, objectives, a rationale' },
  { value: 'number', label: 'Number', hint: 'A count or a measurement' },
  { value: 'money', label: 'Money', hint: 'An amount in pesos' },
  { value: 'date', label: 'Date', hint: 'A single day' },
  { value: 'single_choice', label: 'Single choice', hint: 'One option from a list you write' },
  { value: 'multi_choice', label: 'Multiple choice', hint: 'Any options from a list you write' },
  { value: 'yes_no', label: 'Yes or no', hint: 'A simple answer' },
  { value: 'member', label: 'Project member', hint: 'One person on this project' },
  { value: 'link', label: 'Link', hint: 'A web address' },
]

export const FIELD_LIMIT = {
  name: 80,
  shortText: 200,
  longText: 10000,
  link: 2000,
  option: 80,
  options: 50,
  number: 1e12,
} as const

type Check = { ok: true; value: FieldValue } | { ok: false; error: string }

const fail = (error: string): Check => ({ ok: false, error })

export function isChoice(type: FieldType) {
  return type === 'single_choice' || type === 'multi_choice'
}

export function isEmptyValue(raw: unknown) {
  if (raw === null || raw === undefined) return true
  if (typeof raw === 'string') return raw.trim() === ''
  if (Array.isArray(raw)) return raw.length === 0
  return false
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

function realDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

export function checkFieldValue(
  type: FieldType,
  raw: unknown,
  ctx: { options: string[]; memberIds: string[] },
): Check {
  switch (type) {
    case 'short_text':
    case 'long_text': {
      if (typeof raw !== 'string') return fail('Write some text.')
      const text = raw.trim()
      const max = type === 'short_text' ? FIELD_LIMIT.shortText : FIELD_LIMIT.longText
      if (!text) return fail('Write some text.')
      if (text.length > max) return fail(`Keep this under ${max.toLocaleString()} characters.`)
      return { ok: true, value: text }
    }
    case 'number': {
      const n = toNumber(raw)
      if (n === null) return fail('Enter a number.')
      if (Math.abs(n) > FIELD_LIMIT.number) return fail('That number is too large.')
      return { ok: true, value: n }
    }
    case 'money': {
      const n = toNumber(raw)
      if (n === null) return fail('Enter an amount.')
      if (n < 0) return fail('An amount cannot be negative.')
      if (n > FIELD_LIMIT.number) return fail('That amount is too large.')
      // A tolerance, not strict equality: 0.07 * 100 is 7.000000000000001.
      if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return fail('Use at most two decimal places.')
      return { ok: true, value: n }
    }
    case 'date': {
      if (typeof raw !== 'string' || !realDate(raw)) return fail('Pick a date.')
      return { ok: true, value: raw }
    }
    case 'single_choice': {
      if (typeof raw !== 'string' || !ctx.options.includes(raw)) return fail('Pick one of the options.')
      return { ok: true, value: raw }
    }
    case 'multi_choice': {
      if (!Array.isArray(raw) || raw.length === 0) return fail('Pick at least one option.')
      if (!raw.every((o) => typeof o === 'string' && ctx.options.includes(o)))
        return fail('Pick from the options.')
      if (new Set(raw).size !== raw.length) return fail('Each option can be picked once.')
      return { ok: true, value: raw as string[] }
    }
    case 'yes_no': {
      if (typeof raw !== 'boolean') return fail('Choose yes or no.')
      return { ok: true, value: raw }
    }
    case 'member': {
      if (typeof raw !== 'string' || !ctx.memberIds.includes(raw))
        return fail('Pick somebody on this project.')
      return { ok: true, value: raw }
    }
    case 'link': {
      if (typeof raw !== 'string') return fail('Paste a web address.')
      const text = raw.trim()
      if (text.length > FIELD_LIMIT.link) return fail('That address is too long.')
      if (!/^https?:\/\/\S+$/i.test(text)) return fail('Start the address with http:// or https://.')
      try {
        new URL(text)
      } catch {
        return fail('That is not a web address.')
      }
      return { ok: true, value: text }
    }
  }
}

/** Null when the options suit the type, otherwise the reason they do not. */
export function checkOptions(type: FieldType, options: string[]): string | null {
  if (!isChoice(type)) return options.length === 0 ? null : 'Only choice fields have options.'
  if (options.length === 0) return 'Add at least one option.'
  if (options.length > FIELD_LIMIT.options) return `Keep it to ${FIELD_LIMIT.options} options.`
  const seen = new Set<string>()
  for (const option of options) {
    const text = option.trim()
    if (!text) return 'An option cannot be blank.'
    if (text.length > FIELD_LIMIT.option) return `Keep each option under ${FIELD_LIMIT.option} characters.`
    const key = text.toLowerCase()
    if (seen.has(key)) return `"${text}" is listed twice.`
    seen.add(key)
  }
  return null
}

const PESOS = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

export function formatFieldValue(
  type: FieldType,
  value: FieldValue,
  nameOf: (id: string) => string,
): string {
  switch (type) {
    case 'money':
      return PESOS.format(Number(value))
    case 'date': {
      const [y, m, d] = String(value).split('-').map(Number)
      return new Date(y, m - 1, d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    }
    case 'yes_no':
      return value ? 'Yes' : 'No'
    case 'multi_choice':
      return (value as string[]).join(', ')
    case 'member':
      return nameOf(String(value))
    case 'number':
      return Number(value).toLocaleString('en-US')
    default:
      return String(value)
  }
}
