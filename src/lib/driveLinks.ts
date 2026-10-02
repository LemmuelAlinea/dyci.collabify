import type { IconName } from '../components/ui/Icon'
import { linkify } from './linkify'

/**
 * What a Google Drive or Docs link points at, read from the address alone.
 * The address never carries the file's name, so this says the kind and
 * nothing more: no request to Google, nothing to sign in to.
 */
export type DriveLink = { href: string; label: string; icon: IconName }

const DOCS: [RegExp, string, IconName][] = [
  [/^\/document\//, 'Google Doc', 'file'],
  [/^\/spreadsheets\//, 'Google Sheet', 'chart'],
  [/^\/presentation\//, 'Google Slides', 'monitor'],
  [/^\/forms\//, 'Google Form', 'check'],
  [/^\/drawings\//, 'Google Drawing', 'edit'],
]

export function driveLink(href: string): DriveLink | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\./, '')
  const path = url.pathname

  if (host === 'docs.google.com') {
    const hit = DOCS.find(([re]) => re.test(path))
    return hit ? { href, label: hit[1], icon: hit[2] } : null
  }
  if (host === 'forms.gle') return { href, label: 'Google Form', icon: 'check' }
  if (host === 'drive.google.com') {
    if (/\/folders\//.test(path)) return { href, label: 'Google Drive folder', icon: 'folder' }
    if (/^\/file\/d\//.test(path)) return { href, label: 'Google Drive file', icon: 'file' }
    return { href, label: 'Google Drive', icon: 'folder' }
  }
  return null
}

/** Every Drive or Docs link in some text, once each, in the order written. */
export function driveLinksIn(text: string): DriveLink[] {
  const seen = new Set<string>()
  const out: DriveLink[] = []
  for (const part of linkify(text)) {
    if (part.kind !== 'link' || seen.has(part.href)) continue
    const hit = driveLink(part.href)
    if (hit) {
      seen.add(part.href)
      out.push(hit)
    }
  }
  return out
}
