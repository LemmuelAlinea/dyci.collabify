/**
 * Task and project mentions in a message body (supabase/message-mentions.sql).
 *
 * A mention is a code, `#[t:<uuid>]`, never a title: each reader's app looks
 * the title up under their own access and shows a locked chip when it can't.
 *   t  work task      p  work project
 *   ct class task (one group's copy)
 *   co class set task (its origin_id; each reader opens their own copy)
 *   cp class project
 */

export type MentionKind = 't' | 'p' | 'ct' | 'co' | 'cp'
export type MentionRef = { kind: MentionKind; id: string }
export type Segment = { type: 'text'; text: string } | { type: 'mention'; ref: MentionRef }
export type Picked = { label: string; ref: MentionRef }

export const MAX_MENTIONS = 10

const CODE = /#\[(t|p|ct|co|cp):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/g
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export const mentionKey = (ref: MentionRef) => `${ref.kind}:${ref.id}`
export const mentionCode = (ref: MentionRef) => `#[${ref.kind}:${ref.id}]`
export const isTaskKind = (kind: MentionKind) => kind === 't' || kind === 'ct' || kind === 'co'

/** Text and mentions, in order. Only the first ten codes count; the rest stay text. */
export function parseMentions(body: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  let count = 0
  for (const m of body.matchAll(CODE)) {
    if (count === MAX_MENTIONS) break
    const at = m.index ?? 0
    if (at > last) out.push({ type: 'text', text: body.slice(last, at) })
    out.push({ type: 'mention', ref: { kind: m[1] as MentionKind, id: m[2] } })
    last = at + m[0].length
    count += 1
  }
  if (last < body.length) out.push({ type: 'text', text: body.slice(last) })
  return out
}

/** Every mention in a body, each once, in order. */
export function mentionRefs(body: string): MentionRef[] {
  const seen = new Set<string>()
  const refs: MentionRef[] = []
  for (const seg of parseMentions(body)) {
    if (seg.type !== 'mention' || seen.has(mentionKey(seg.ref))) continue
    seen.add(mentionKey(seg.ref))
    refs.push(seg.ref)
  }
  return refs
}

/** The chat list's one-line preview: codes become "#task" or "#project". */
export function previewText(body: string): string {
  return body.replace(CODE, (_m, kind: MentionKind) => (isTaskKind(kind) ? '#task' : '#project'))
}

/** A Collabify task or project link on this site, as a mention; anything else is null. */
export function linkToMention(url: string, origin: string): MentionRef | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.origin !== origin) return null
  const m = new RegExp(`^/(projects|class-projects)/(${UUID})/?$`).exec(u.pathname)
  if (!m) return null
  const task = u.searchParams.get('task')
  const others = [...u.searchParams.keys()].filter((k) => k !== 'task')
  if (others.length > 0) return null
  const work = m[1] === 'projects'
  if (task) return new RegExp(`^${UUID}$`).test(task) ? { kind: work ? 't' : 'ct', id: task } : null
  return { kind: work ? 'p' : 'cp', id: m[2] }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The body to send: each picked `#Label` (exactly as inserted, longest first)
 * and each pasted Collabify link becomes its code, up to ten in all. A label
 * the writer changed by hand no longer matches and stays plain text.
 */
export function encodeMentions(text: string, picked: Picked[], origin: string): string {
  let count = [...text.matchAll(CODE)].length
  let out = text
  const labels = [...picked].sort((a, b) => b.label.length - a.label.length)
  for (const { label, ref } of labels) {
    if (!label) continue
    const re = new RegExp(`#${escapeRe(label)}(?![\\p{L}\\p{N}])`, 'gu')
    out = out.replace(re, (m) => {
      if (count >= MAX_MENTIONS) return m
      count += 1
      return mentionCode(ref)
    })
  }
  const links = new RegExp(`${escapeRe(origin)}/(?:class-)?projects/\\S+`, 'g')
  out = out.replace(links, (m) => {
    const trail = /[.,;:!?)]+$/.exec(m)?.[0] ?? ''
    const url = trail ? m.slice(0, -trail.length) : m
    const ref = linkToMention(url, origin)
    if (!ref || count >= MAX_MENTIONS) return m
    count += 1
    return mentionCode(ref) + trail
  })
  return out
}

/** A sent body back into an editable draft: codes with a known title become `#Title`; the rest stay as codes. */
export function decodeForEdit(body: string, titles: Map<string, string>): { text: string; picked: Picked[] } {
  const picked: Picked[] = []
  const text = body.replace(CODE, (m, kind: MentionKind, id: string) => {
    const ref = { kind, id }
    const title = titles.get(mentionKey(ref))
    if (!title) return m
    if (!picked.some((p) => p.label === title && mentionKey(p.ref) === mentionKey(ref))) picked.push({ label: title, ref })
    return `#${title}`
  })
  return { text, picked }
}

/** The longest `#query` the picker follows; titles are matched in part, so this is plenty. */
export const MAX_QUERY = 40

/**
 * The `#query` being typed at the caret, when the `#` starts a word. Spaces
 * are allowed, so a multi-word title can be narrowed down, but a new line, a
 * code, a query past 40 characters, or the text after a mention already
 * picked (`#Sample Task is done`) is not a query.
 */
export function mentionQueryAt(
  text: string,
  caret: number,
  picked: Picked[] = [],
): { start: number; query: string } | null {
  for (let i = caret - 1; i >= 0 && caret - i <= MAX_QUERY + 1; i -= 1) {
    const ch = text[i]
    if (ch === '\n' || ch === '\r') return null
    if (ch === '#') {
      if (i > 0 && !/\s/.test(text[i - 1])) return null
      const query = text.slice(i + 1, caret)
      if (query.includes('[') || /^\s/.test(query)) return null
      if (picked.some((p) => query === p.label || query.startsWith(`${p.label} `))) return null
      return { start: i, query }
    }
  }
  return null
}
