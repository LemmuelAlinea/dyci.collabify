import { COOKIES } from './cookies'
import { UNSET } from './contact'
import { PRIVACY } from './privacy'
import { TERMS } from './terms'
import type { LegalDoc, LegalSlug } from './types'

export { CONSENT_ITEMS, consentVersions } from './consent'
export type { ConsentItem } from './consent'
export { CONTACT_IS_PLACEHOLDER, PRIVACY_CONTACT, REGULATOR, SCHOOL_DPO, UNSET } from './contact'
export { parseLinks } from './types'
export type { LegalBlock, LegalDoc, LegalPart, LegalSection, LegalSlug } from './types'
export { COOKIES, PRIVACY, TERMS }

/** In the order they are listed in footers. Privacy first — it is the one people look for. */
export const LEGAL_DOCS: readonly LegalDoc[] = [PRIVACY, TERMS, COOKIES] as const

export function docBySlug(slug: string): LegalDoc | undefined {
  return LEGAL_DOCS.find((doc) => doc.slug === slug)
}

/**
 * Whether this particular document still has a name missing from it.
 *
 * Asked per document rather than globally: the cookies notice names nobody, so
 * a banner there saying a contact is unnamed would be warning about something
 * the reader cannot find. Checks the text itself, so a new document that
 * references the contact is covered without anybody remembering to add it to a
 * list.
 */
export function hasPlaceholder(doc: LegalDoc): boolean {
  return doc.sections.some((section) =>
    section.blocks.some((block) => {
      if (block.kind === 'p' || block.kind === 'note') return block.text.includes(UNSET)
      if (block.kind === 'list') return block.items.some((item) => item.includes(UNSET))
      return [...block.head, ...block.rows.flat()].some((cell) => cell.includes(UNSET))
    }),
  )
}

/** Footer and auth-page link rows both read this, so the two cannot drift. */
export const LEGAL_LINKS: ReadonlyArray<{ to: string; label: string; slug: LegalSlug }> =
  LEGAL_DOCS.map((doc) => ({ to: `/${doc.slug}`, label: doc.title, slug: doc.slug }))
