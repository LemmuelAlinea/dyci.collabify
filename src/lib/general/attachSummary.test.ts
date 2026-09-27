import { describe, expect, it } from 'vitest'
import { attachSummary } from './attachSummary'

describe('attachSummary', () => {
  it('counts what went', () => {
    expect(attachSummary({ added: ['a.md'], failed: [] })).toEqual({ message: '1 file added', tone: 'success' })
    expect(attachSummary({ added: ['a', 'b'], failed: [] }).message).toBe('2 files added')
  })

  it('names the first file that did not go, and how many more', () => {
    expect(
      attachSummary({
        added: ['a'],
        failed: [
          { path: 'big.zip', reason: 'over 20 MB' },
          { path: 'x', reason: 'could not be attached' },
        ],
      }),
    ).toEqual({ message: '1 file added. Not attached: big.zip (over 20 MB) and 1 more.', tone: 'error' })
  })

  it('says only what failed when nothing went', () => {
    expect(attachSummary({ added: [], failed: [{ path: 'big.zip', reason: 'over 20 MB' }] }).message).toBe(
      'Not attached: big.zip (over 20 MB).',
    )
  })
})
