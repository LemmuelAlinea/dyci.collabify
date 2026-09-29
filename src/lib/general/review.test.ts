import { describe, expect, it } from 'vitest'
import { groupChanges, isReviewer } from './review'

const c = (id: string, author: string | null, reviewer: string | null, status = 'open', reviewers: string[] = []) => ({
  id, author_id: author, reviewer_id: reviewer, reviewer_ids: reviewers, status,
})

describe('groupChanges', () => {
  const all = [
    c('a', 'me', 'x'),
    c('b', 'x', 'me'),
    c('c', 'x', 'y'),
    c('d', 'x', 'y', 'applied'),
    c('e', 'me', 'me'),
    c('f', 'me', 'x', 'declined'),
  ]

  it('puts what I opened under mine, whatever its status', () => {
    expect(groupChanges(all, 'me').mine.map((x) => x.id)).toEqual(['a', 'e', 'f'])
  })

  it('puts what I was asked to review under to me, but never twice', () => {
    expect(groupChanges(all, 'me').toMe.map((x) => x.id)).toEqual(['b'])
  })

  it('keeps only open requests between other people', () => {
    expect(groupChanges(all, 'me').others.map((x) => x.id)).toEqual(['c'])
  })

  it('counts me as a reviewer when I am one of several', () => {
    const many = [c('g', 'x', 'y', 'open', ['y', 'me', 'z'])]
    expect(groupChanges(many, 'me').toMe.map((x) => x.id)).toEqual(['g'])
    expect(isReviewer(many[0], 'me')).toBe(true)
    expect(isReviewer(many[0], 'q')).toBe(false)
  })

  it('treats a signed-out viewer as involved in nothing', () => {
    const g = groupChanges(all, null)
    expect(g.mine).toEqual([])
    expect(g.toMe).toEqual([])
    expect(g.others.map((x) => x.id)).toEqual(['a', 'b', 'c', 'e'])
  })
})
