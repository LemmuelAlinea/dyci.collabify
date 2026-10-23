import { describe, expect, it } from 'vitest'
import { badgesFor } from './RoleBadge'

describe('badgesFor', () => {
  it('gives a plain Member nothing to wear', () => {
    expect(badgesFor('member', false)).toEqual([])
  })

  it('tags a Member who leads a team', () => {
    expect(badgesFor('member', true)).toEqual(['Lead'])
  })

  it('puts the role before the Lead tag', () => {
    expect(badgesFor('coordinator', true)).toEqual(['Coordinator', 'Lead'])
  })

  it('shortens the project manager to PM', () => {
    expect(badgesFor('pm', false)).toEqual(['PM'])
  })
})
