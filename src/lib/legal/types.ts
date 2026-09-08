/**
 * The shape of a legal document.
 *
 * These are data, not markup, for three reasons. The version has to sit beside
 * the text it describes, because a consent record stores which version was
 * agreed and a filename convention is a promise somebody eventually forgets.
 * They are edited by whoever owns the wording rather than whoever owns the
 * build, and a string literal cannot break a build the way an unescaped
 * apostrophe in JSX can — the house style is full of them. And being plain
 * data means vitest can assert real things about them without a DOM.
 *
 * Write every string with backticks. Apostrophes are then free, and the copy
 * needs them constantly: "Dr. Yanga's", "you have not", "the professor's".
 */

/** A run of text. Only `[label](/internal-route)` is understood — see `parseLinks`. */
export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  /** Set apart from the run of the text — a caveat, or something uncomfortable. */
  | { kind: 'note'; text: string }

export type LegalSection = {
  /**
   * Stable, kebab-case, and linked to from elsewhere. The rights sections in
   * particular are asserted by id in the test, so renaming one is a deliberate
   * act rather than an accident.
   */
  id: string
  heading: string
  blocks: LegalBlock[]
}

export type LegalSlug = 'privacy' | 'terms' | 'cookies'

export type LegalDoc = {
  slug: LegalSlug
  title: string
  /** The mono label above the title. */
  kicker: string
  /** One sentence, shown under the title and in the section index. */
  summary: string
  /**
   * `YYYY-MM-DD`. This exact string is what `consent_records.version` stores,
   * so it must never be edited in place once anyone has agreed to it — a new
   * wording is a new version, and the old row keeps saying what was agreed on
   * the day it was agreed.
   */
  version: string
  /** When this version took effect. Not always the day it was written. */
  effective: string
  sections: LegalSection[]
}

/** One run of a paragraph: plain, a link, or a bold lead-in. Never both. */
export type LegalPart = { text: string; to?: string; bold?: boolean }

/**
 * An internal route: a slash, then path and optional anchor.
 *
 * Testing `startsWith('/')` is not enough and was the first version of this.
 * `//evil.test` starts with a slash and is a protocol-relative URL — a browser
 * resolves it to `https://evil.test`, so that check would have linked straight
 * off the site. `/\evil.test` is treated the same way by some browsers. An
 * allowlist of the characters a real route here contains rules both out
 * without needing to know which trick comes next.
 */
const ROUTE = /^\/[a-z0-9/-]*(#[a-z0-9-]+)?$/

/**
 * Split a paragraph into plain runs, internal links, and bold lead-ins.
 *
 * Deliberately the smallest thing that works: `[label](/route)`, `**bold**`,
 * and nothing else. No headings, no raw HTML, no external URLs. Bold exists
 * because several paragraphs open by naming what they are about — "What you
 * give it." — and that is a typographic job the alternative would solve by
 * splitting one paragraph into two sections that are not two sections.
 *
 * Anything that is not an internal route is left as literal text rather than
 * being linked, because a document format that can emit arbitrary hrefs is a
 * document format that can be turned into a phishing page by whoever edits the
 * copy, and the CSP work in the previous release was buying exactly that kind
 * of guarantee.
 */
export function parseLinks(text: string): LegalPart[] {
  const out: LegalPart[] = []
  // Declared here rather than at module scope on purpose: a `g` regex carries
  // `lastIndex` between calls, and sharing one would make the second call on
  // any string start partway through it.
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push({ text: text.slice(last, match.index) })
    const [, label, href, bold] = match
    if (bold !== undefined) out.push({ text: bold, bold: true })
    // Internal only. Anything else is rendered as the plain label so a bad
    // edit degrades to something harmless rather than something clickable.
    else out.push(ROUTE.test(href) ? { text: label, to: href } : { text: label })
    last = match.index + match[0].length
  }

  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}
