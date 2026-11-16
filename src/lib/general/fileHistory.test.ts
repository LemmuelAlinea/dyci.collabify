import { describe, expect, it } from 'vitest'
import { laterEdits, originLabel, putBack, stateBefore, type FileVersion } from './fileHistory'

const v = (seq: number, over: Partial<FileVersion> = {}): FileVersion => ({
  seq,
  action: 'changed',
  kind: 'text',
  content: `c${seq}`,
  storage_path: null,
  ...over,
})

describe('stateBefore', () => {
  it('returns the newest version with a lower seq', () => {
    expect(stateBefore([v(1), v(5), v(3)], 5)?.seq).toBe(3)
  })
  it('returns null when none is lower', () => {
    expect(stateBefore([v(5)], 5)).toBeNull()
    expect(stateBefore([], 5)).toBeNull()
  })
  it('returns null when the previous version is a removal', () => {
    expect(stateBefore([v(1), v(3, { action: 'removed' })], 5)).toBeNull()
  })
})

describe('putBack', () => {
  it('removes when the target is absent and current is live', () => {
    expect(putBack(null, v(2))).toBe('removed')
  })
  it('adds when the target is live and current is absent', () => {
    expect(putBack(v(2), null)).toBe('added')
  })
  it('changes when both are live and different', () => {
    expect(putBack(v(1), v(2))).toBe('changed')
  })
  it('is null when the same or both absent', () => {
    expect(putBack(v(1, { content: 'x' }), v(2, { content: 'x' }))).toBeNull()
    expect(putBack(null, null)).toBeNull()
  })
  it('treats the same storage_path as the same for binary', () => {
    const a = v(1, { kind: 'binary', content: '', storage_path: 'p/a' })
    const b = v(2, { kind: 'binary', content: '', storage_path: 'p/a' })
    expect(putBack(a, b)).toBeNull()
    expect(putBack(a, { ...b, storage_path: 'p/b' })).toBe('changed')
  })
  it('treats a different kind as different', () => {
    expect(putBack(v(1), v(2, { content: 'c1', kind: 'rich' }))).toBe('changed')
  })
})

describe('laterEdits', () => {
  it('returns sorted unique paths after the seq, ignoring equal seq', () => {
    const blobs = [
      { path: 'b.md', seq: 7 },
      { path: 'a.md', seq: 6 },
      { path: 'b.md', seq: 8 },
      { path: 'c.md', seq: 5 },
      { path: 'd.md', seq: 4 },
    ]
    expect(laterEdits(blobs, 5)).toEqual(['a.md', 'b.md'])
  })
})

describe('originLabel', () => {
  it('names a revert', () => {
    expect(originLabel({ kind: 'revert', source_seq: 12, path: null })).toBe('Reverts #12')
  })
  it('names a single-file undo', () => {
    expect(originLabel({ kind: 'revert', source_seq: 12, path: 'a.md' })).toBe('Undoes #12 on a.md')
  })
  it('names a restore', () => {
    expect(originLabel({ kind: 'restore', source_seq: 5, path: 'a.md' })).toBe('Restores a.md to #5')
  })
})
