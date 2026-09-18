/**
 * Line-by-line comparison of two versions of a document.
 *
 * A proposed change is only trustworthy if a reviewer can see exactly what it
 * would do, so this is the thing the review screen is built on. It is a plain
 * longest-common-subsequence over lines: enough for prose and for the short
 * files a school project keeps, and small enough to read.
 *
 * Nothing here touches the document itself. Applying a change is the database's
 * job, because that is where the version number is decided.
 */

export type DiffKind = 'same' | 'added' | 'removed'

export type DiffLine = {
  kind: DiffKind
  text: string
  /** 1-based line number in the old text, or null when the line is new. */
  oldLine: number | null
  /** 1-based line number in the new text, or null when the line was removed. */
  newLine: number | null
}

export type DiffStat = { added: number; removed: number; unchanged: number }

/** Splits the way a text editor does: a trailing newline is not a blank line. */
export function toLines(text: string) {
  if (text === '') return []
  return text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
}

/**
 * The limit exists because the table below is O(n*m). 4000 lines a side is far
 * past anything a research paper reaches, and past it the diff falls back to
 * "the whole thing changed", which is honest rather than slow.
 */
const MAX_LINES = 4000

export function diffLines(before: string, after: string): DiffLine[] {
  const a = toLines(before)
  const b = toLines(after)

  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map((text, i): DiffLine => ({ kind: 'removed', text, oldLine: i + 1, newLine: null })),
      ...b.map((text, i): DiffLine => ({ kind: 'added', text, oldLine: null, newLine: i + 1 })),
    ]
  }

  // lcs[i][j] is the length of the longest common run of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i], oldLine: i + 1, newLine: j + 1 })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'removed', text: a[i], oldLine: i + 1, newLine: null })
      i++
    } else {
      out.push({ kind: 'added', text: b[j], oldLine: null, newLine: j + 1 })
      j++
    }
  }
  while (i < a.length) {
    out.push({ kind: 'removed', text: a[i], oldLine: i + 1, newLine: null })
    i++
  }
  while (j < b.length) {
    out.push({ kind: 'added', text: b[j], oldLine: null, newLine: j + 1 })
    j++
  }
  return out
}

export function diffStat(lines: DiffLine[]): DiffStat {
  const stat: DiffStat = { added: 0, removed: 0, unchanged: 0 }
  for (const l of lines) {
    if (l.kind === 'added') stat.added++
    else if (l.kind === 'removed') stat.removed++
    else stat.unchanged++
  }
  return stat
}

/** "3 added, 1 removed", or "No changes" when the two texts match. */
export function describeDiff(stat: DiffStat) {
  const parts: string[] = []
  if (stat.added) parts.push(`${stat.added} ${stat.added === 1 ? 'line' : 'lines'} added`)
  if (stat.removed) parts.push(`${stat.removed} ${stat.removed === 1 ? 'line' : 'lines'} removed`)
  return parts.length === 0 ? 'No changes' : parts.join(', ')
}

/**
 * Hides long runs of untouched text, keeping a few lines either side so a
 * reader can tell where a change sits. A run shorter than twice the context is
 * left alone, because collapsing two lines to save one is not worth the gap.
 */
export function collapseUnchanged(lines: DiffLine[], context = 3) {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((l, i) => {
    if (l.kind === 'same') return
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) {
      keep[k] = true
    }
  })

  const out: ({ gap: number } | DiffLine)[] = []
  let run = 0
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (run > 0) {
        out.push({ gap: run })
        run = 0
      }
      out.push(l)
    } else {
      run++
    }
  })
  if (run > 0) out.push({ gap: run })
  return out
}

export function isGap(row: { gap: number } | DiffLine): row is { gap: number } {
  return 'gap' in row
}

/** What a download of the document is called. Never empty, never a path. */
export function documentFileName(title: string, version: number, extension: 'md' | 'txt' | 'html') {
  const stem =
    title
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-')
      .slice(0, 80)
      .replace(/^-+|-+$/g, '') || 'document'
  return `${stem}-v${version}.${extension}`
}
