/**
 * Splits plain text into text and web links, so text people write — an
 * announcement, a message, a comment — can show its links as links.
 *
 * Only `http(s)://…` and `www.…` count; a bare `www.` link gets `https://`.
 * Punctuation that ends a sentence is left outside the link, and a closing
 * bracket stays out unless the link opened one (Wikipedia-style URLs).
 */
export type LinkPart = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string }

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi
const TRAILING = /[.,;:!?'"]+$/

function trimLink(raw: string) {
  let url = raw.replace(TRAILING, '')
  while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1).replace(TRAILING, '')
  }
  return url
}

export function linkify(text: string): LinkPart[] {
  const parts: LinkPart[] = []
  let at = 0
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0
    const url = trimLink(match[0])
    if (!url || /^www\.$/i.test(url)) continue
    if (start > at) parts.push({ kind: 'text', text: text.slice(at, start) })
    parts.push({ kind: 'link', text: url, href: /^www\./i.test(url) ? `https://${url}` : url })
    at = start + url.length
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) })
  return parts
}
