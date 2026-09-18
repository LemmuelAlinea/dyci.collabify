import { describe, expect, it } from 'vitest'
import {
  collapseUnchanged,
  describeDiff,
  diffLines,
  diffStat,
  documentFileName,
  isGap,
  toLines,
} from './diff'

describe('toLines', () => {
  it('reads empty text as no lines rather than one blank one', () => {
    expect(toLines('')).toEqual([])
  })

  it('does not turn a trailing newline into a blank line', () => {
    expect(toLines('one\ntwo\n')).toEqual(['one', 'two'])
  })

  it('treats Windows line endings the same as any other', () => {
    expect(toLines('one\r\ntwo')).toEqual(['one', 'two'])
  })

  it('keeps a blank line that is really in the middle', () => {
    expect(toLines('one\n\ntwo')).toEqual(['one', '', 'two'])
  })
})

describe('diffLines', () => {
  it('says nothing changed when nothing changed', () => {
    const d = diffLines('one\ntwo', 'one\ntwo')
    expect(d.every((l) => l.kind === 'same')).toBe(true)
    expect(describeDiff(diffStat(d))).toBe('No changes')
  })

  it('finds a line added in the middle without rewriting the rest', () => {
    const d = diffLines('one\nthree', 'one\ntwo\nthree')
    expect(d.map((l) => l.kind)).toEqual(['same', 'added', 'same'])
    expect(d[1].text).toBe('two')
    expect(d[1].oldLine).toBeNull()
    expect(d[1].newLine).toBe(2)
  })

  it('finds a line removed', () => {
    const d = diffLines('one\ntwo\nthree', 'one\nthree')
    expect(d.map((l) => l.kind)).toEqual(['same', 'removed', 'same'])
    expect(d[1].newLine).toBeNull()
    expect(d[1].oldLine).toBe(2)
  })

  it('reads a rewritten line as one removal and one addition', () => {
    const d = diffLines('one\nold\nthree', 'one\nnew\nthree')
    expect(diffStat(d)).toEqual({ added: 1, removed: 1, unchanged: 2 })
  })

  it('numbers both sides so a reviewer can find the line', () => {
    const d = diffLines('a\nb\nc', 'a\nx\nc')
    const same = d.filter((l) => l.kind === 'same')
    expect(same.map((l) => [l.oldLine, l.newLine])).toEqual([
      [1, 1],
      [3, 3],
    ])
  })

  it('handles a document written from nothing', () => {
    expect(diffStat(diffLines('', 'one\ntwo'))).toEqual({ added: 2, removed: 0, unchanged: 0 })
  })

  it('handles a document emptied out', () => {
    expect(diffStat(diffLines('one\ntwo', ''))).toEqual({ added: 0, removed: 2, unchanged: 0 })
  })

  it('does not lose a repeated line', () => {
    const d = diffLines('x\nx\nx', 'x\nx')
    expect(diffStat(d)).toEqual({ added: 0, removed: 1, unchanged: 2 })
  })

  it('falls back to a whole-document replacement past the size it can compare', () => {
    const big = Array.from({ length: 4001 }, (_, i) => `line ${i}`).join('\n')
    const d = diffLines(big, big)
    // Identical texts, but past the limit it reports every line replaced rather
    // than spending a 4001x4001 table to prove they match.
    expect(diffStat(d)).toEqual({ added: 4001, removed: 4001, unchanged: 0 })
  })
})

describe('describeDiff', () => {
  it('counts in words a reviewer can read', () => {
    expect(describeDiff({ added: 1, removed: 0, unchanged: 9 })).toBe('1 line added')
    expect(describeDiff({ added: 3, removed: 1, unchanged: 9 })).toBe('3 lines added, 1 line removed')
    expect(describeDiff({ added: 0, removed: 2, unchanged: 9 })).toBe('2 lines removed')
  })
})

describe('collapseUnchanged', () => {
  it('hides a long untouched stretch and says how much it hid', () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 15', 'line fifteen')
    const rows = collapseUnchanged(diffLines(before, after), 3)
    const gaps = rows.filter(isGap)
    expect(gaps.length).toBe(2)
    expect(gaps.reduce((n, g) => n + g.gap, 0)).toBe(30 - 1 - 6)
  })

  it('keeps context either side of every change', () => {
    const rows = collapseUnchanged(diffLines('a\nb\nc\nd\ne\nf\ng\nh', 'a\nb\nc\nd\nE\nf\ng\nh'), 1)
    const kept = rows.filter((r) => !isGap(r))
    expect(kept.map((r) => (r as { text: string }).text)).toEqual(['d', 'e', 'E', 'f'])
  })

  it('leaves a short document whole', () => {
    const rows = collapseUnchanged(diffLines('a\nb', 'a\nc'), 3)
    expect(rows.some(isGap)).toBe(false)
  })
})

describe('documentFileName', () => {
  it('turns a title into a safe name with its version', () => {
    expect(documentFileName('Chapter 1 — Background', 3, 'md')).toBe('Chapter-1-Background-v3.md')
  })

  it('never produces a path, an empty name or a hidden file', () => {
    expect(documentFileName('../../etc/passwd', 1, 'txt')).toBe('etcpasswd-v1.txt')
    expect(documentFileName('   ', 2, 'md')).toBe('document-v2.md')
    expect(documentFileName('***', 1, 'html')).toBe('document-v1.html')
  })

  it('keeps letters from other scripts rather than stripping the whole title', () => {
    expect(documentFileName('Pagsusuri ng Wika', 1, 'md')).toBe('Pagsusuri-ng-Wika-v1.md')
  })
})
