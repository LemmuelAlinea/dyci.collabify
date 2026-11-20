import { expect, it } from 'vitest'
import { stageText, validStageTerms } from './stageTerms'

it('uses the board label without rewriting a saved numbered name', () => {
  const terms = { singular: 'Phase', plural: 'Phases' }
  expect(stageText('Start the sprint. Two sprints planned. Sprint 1 stays.', terms))
    .toBe('Start the phase. Two phases planned. Sprint 1 stays.')
  expect(validStageTerms(terms)).toBe(true)
  expect(validStageTerms({ singular: 'Phase;', plural: 'Phases' })).toBe(false)
})
