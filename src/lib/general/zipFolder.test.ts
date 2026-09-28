import { describe, expect, it } from 'vitest'
import { filesUnder } from './zipFolder'

describe('filesUnder', () => {
  const files = [
    { path: 'docs/a.docx' },
    { path: 'docs/sub/b.txt' },
    { path: 'docs/.keep' },
    { path: 'docsx/c.txt' },
    { path: 'top.txt' },
  ]
  it('takes a folder and everything under it, without placeholders', () => {
    expect(filesUnder(files, 'docs').map((f) => f.path)).toEqual(['docs/a.docx', 'docs/sub/b.txt'])
  })
  it('takes everything at the top', () => {
    expect(filesUnder(files, '')).toHaveLength(4)
  })
})
