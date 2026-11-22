import { expect, it } from 'vitest'
import { balanceWorkPlan, dependencyGroups } from '../../../supabase/functions/_shared/workloadPlan.ts'

it('balances the login module against existing commitments and confirmed leave', () => {
  const people = [
    { id: 'a', skills: ['auth'], positions: [], current: 360, capacity: 960 },
    { id: 'b', skills: ['ui'], positions: [], current: 240, capacity: 960 },
    { id: 'c', skills: ['test'], positions: [], current: 120, capacity: 960 },
  ]
  const rows = [
    { key: 'auth', minutes: 360, skills: ['auth'] },
    { key: 'contract', minutes: 120, skills: ['auth'] },
    { key: 'interface', minutes: 600, skills: ['ui'] },
    { key: 'integration', minutes: 720, skills: ['test'] },
  ]
  expect(balanceWorkPlan(rows, people).map(row => row.owner)).toEqual(['a', 'a', 'b', 'c'])
  const onLeave = [{ ...people[0], current: 600, capacity: 720 }, ...people.slice(1)]
  expect(balanceWorkPlan(rows, onLeave)[0]).toMatchObject({ owner: null, reason: 'capacity' })
})

it('orders independent work together and rejects broken prerequisite links', () => {
  expect(dependencyGroups([
    { key: 'integrate', dependsOn: ['api', 'ui'] },
    { key: 'api', dependsOn: [] },
    { key: 'ui', dependsOn: [] },
  ])).toEqual([['api', 'ui'], ['integrate']])
  expect(() => dependencyGroups([{ key: 'a', dependsOn: ['a'] }])).toThrow()
  expect(() => dependencyGroups([{ key: 'a', dependsOn: ['missing'] }])).toThrow()
})
