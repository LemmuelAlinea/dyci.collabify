import { describe, expect, it } from 'vitest'

import { CONSENT_ITEMS, consentVersions } from './consent'
import { CONTACT_IS_PLACEHOLDER, LEGAL_DOCS, PRIVACY, docBySlug, hasPlaceholder } from './index'
import { parseLinks } from './types'
import type { LegalBlock, LegalDoc } from './types'

/** Every string a reader will actually see, flattened. */
function textOf(doc: LegalDoc): string[] {
  const out: string[] = []
  const push = (block: LegalBlock) => {
    if (block.kind === 'p' || block.kind === 'note') out.push(block.text)
    else if (block.kind === 'list') out.push(...block.items)
    else out.push(...block.head, ...block.rows.flat())
  }
  for (const section of doc.sections) {
    out.push(section.heading)
    for (const block of section.blocks) push(block)
  }
  return out
}

describe('parseLinks', () => {
  it('leaves plain text alone', () => {
    expect(parseLinks('nothing here')).toEqual([{ text: 'nothing here' }])
  })

  it('splits an internal link out of a sentence', () => {
    expect(parseLinks('see [the policy](/privacy) for more')).toEqual([
      { text: 'see ' },
      { text: 'the policy', to: '/privacy' },
      { text: ' for more' },
    ])
  })

  it('keeps the anchor on the href', () => {
    expect(parseLinks('[erasure](/privacy#right-erasure)')).toEqual([
      { text: 'erasure', to: '/privacy#right-erasure' },
    ])
  })

  // The guarantee that matters: a bad edit degrades to plain text rather than
  // turning a legal page into somewhere to send people.
  it('refuses to link anything that is not an internal route', () => {
    for (const href of ['https://evil.test', 'javascript:alert(1)', 'mailto:a@b.c', '//evil.test']) {
      const parsed = parseLinks(`[click](${href})`)
      // The guarantee is that nothing is linkable, not that the leftovers are
      // tidy — an href containing its own `)` leaves a stray bracket behind,
      // which is ugly and harmless. The href itself must never survive.
      expect(parsed.every((part) => !part.to), href).toBe(true)
      expect(parsed.map((part) => part.text).join(''), href).not.toContain(href)
    }
  })

  it('handles two links in one paragraph', () => {
    const parsed = parseLinks('[a](/terms) and [b](/cookies)')
    expect(parsed.filter((part) => part.to)).toHaveLength(2)
  })

  it('marks a bold lead-in without linking it', () => {
    expect(parseLinks('**What you give it.** Your name.')).toEqual([
      { text: 'What you give it.', bold: true },
      { text: ' Your name.' },
    ])
  })

  it('takes bold and a link in the same paragraph', () => {
    const parsed = parseLinks('**Note.** See [the policy](/privacy).')
    expect(parsed.filter((part) => part.bold)).toHaveLength(1)
    expect(parsed.filter((part) => part.to)).toHaveLength(1)
  })

  // The regex is built fresh per call for this reason; a shared `g` regex
  // keeps `lastIndex` and would start the second call partway through.
  it('gives the same answer twice for the same input', () => {
    const once = parseLinks('see [the policy](/privacy)')
    expect(parseLinks('see [the policy](/privacy)')).toEqual(once)
  })
})

describe('documents', () => {
  it('has one document per slug', () => {
    const slugs = LEGAL_DOCS.map((doc) => doc.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(docBySlug(slug)?.slug).toBe(slug)
  })

  it('dates every version, because consent records store this exact string', () => {
    for (const doc of LEGAL_DOCS) {
      expect(doc.version, doc.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(doc.effective, doc.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('gives every section a stable kebab-case id, used once', () => {
    for (const doc of LEGAL_DOCS) {
      const ids = doc.sections.map((section) => section.id)
      expect(new Set(ids).size, doc.slug).toBe(ids.length)
      for (const id of ids) expect(id, doc.slug).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('leaves no section empty', () => {
    for (const doc of LEGAL_DOCS) {
      for (const section of doc.sections) {
        expect(section.blocks.length, `${doc.slug}/${section.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('keeps every table rectangular', () => {
    for (const doc of LEGAL_DOCS) {
      for (const section of doc.sections) {
        for (const block of section.blocks) {
          if (block.kind !== 'table') continue
          for (const row of block.rows) {
            expect(row.length, `${doc.slug}/${section.id}`).toBe(block.head.length)
          }
        }
      }
    }
  })

  // An unclosed `**` or a bracket the parser does not recognise reaches the
  // reader as raw markup on a legal page, which reads as carelessness about
  // the one document that has to look careful.
  it('leaves no markup visible after parsing', () => {
    for (const doc of LEGAL_DOCS) {
      for (const text of textOf(doc)) {
        const rendered = parseLinks(text)
          .map((part) => part.text)
          .join('')
        expect(rendered, `${doc.slug}: ${text.slice(0, 60)}`).not.toMatch(/\*\*|\]\(/)
      }
    }
  })

  // A link to a section that was renamed lands on the page and scrolls nowhere,
  // which is exactly the kind of quiet rot a legal document cannot afford.
  it('points every internal link at a route and anchor that exists', () => {
    const routes = new Set(['/privacy', '/terms', '/cookies', '/privacy/request'])
    for (const doc of LEGAL_DOCS) {
      for (const text of textOf(doc)) {
        for (const part of parseLinks(text)) {
          if (!part.to) continue
          const [path, anchor] = part.to.split('#')
          expect(routes.has(path), `${doc.slug} → ${part.to}`).toBe(true)
          if (!anchor) continue
          const target = docBySlug(path.slice(1))
          expect(target?.sections.some((s) => s.id === anchor), `${doc.slug} → ${part.to}`).toBe(
            true,
          )
        }
      }
    }
  })
})

describe('the unfinished-contact banner', () => {
  // Whichever way this reads today, it has to read the same way on the page
  // and in `npm run check`. The banner and the publish guard disagreeing is
  // how a placeholder reaches production quietly.
  it('agrees with whether a placeholder is actually in the text', () => {
    expect(LEGAL_DOCS.some(hasPlaceholder)).toBe(CONTACT_IS_PLACEHOLDER)
  })

  it('does not warn on a document that names nobody', () => {
    expect(hasPlaceholder(docBySlug('cookies') as LegalDoc)).toBe(false)
  })
})

describe('the privacy policy', () => {
  /**
   * The eight rights in RA 10173 §§16–18. Asserted by id because the failure
   * this guards against is one of them quietly disappearing during an edit to
   * the wording — which would leave the document silently claiming less than
   * the law grants, and nobody would notice by reading it.
   */
  const RIGHTS = [
    'right-informed',
    'right-access',
    'right-object',
    'right-rectification',
    'right-erasure',
    'right-portability',
    'right-damages',
    'right-complaint',
  ]

  it('has a section for each of the eight rights', () => {
    const ids = new Set(PRIVACY.sections.map((section) => section.id))
    for (const right of RIGHTS) expect(ids.has(right), right).toBe(true)
  })

  it('still discloses the four things that are uncomfortable to say', () => {
    const all = textOf(PRIVACY).join(' ').toLowerCase()
    // Each of these is a fact somebody would be tempted to soften. If one is
    // reworded, this fails and the rewording gets a second look.
    expect(all).toContain('email address')
    expect(all).toContain('does not expire')
    expect(all).toContain('cannot be altered')
    expect(all).toContain('no grades')
  })

  it('names the profiling section, which §16 requires to be disclosed', () => {
    expect(PRIVACY.sections.some((section) => section.id === 'profiling')).toBe(true)
  })
})

describe('consent', () => {
  it('asks separately about the terms and the privacy policy', () => {
    expect(CONSENT_ITEMS.map((item) => item.document).sort()).toEqual(['privacy', 'terms'])
  })

  it('takes each version from the document it belongs to', () => {
    for (const item of CONSENT_ITEMS) {
      expect(docBySlug(item.document)?.version, item.document).toBe(item.version)
    }
  })

  it('links each checkbox to the document it is about', () => {
    for (const item of CONSENT_ITEMS) {
      const links = parseLinks(item.label).filter((part) => part.to)
      expect(links.map((part) => part.to), item.document).toContain(`/${item.document}`)
    }
  })

  it('sends both versions in the shape the database reads', () => {
    expect(consentVersions()).toEqual({
      consent_terms: docBySlug('terms')?.version,
      consent_privacy: docBySlug('privacy')?.version,
    })
  })
})
