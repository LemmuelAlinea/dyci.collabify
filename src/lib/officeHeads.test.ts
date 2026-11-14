import { expect, it } from 'vitest'
import { headByOffice, headNameByOffice } from './officeHeads'

const heads = [{ office_id: 'o1', head_id: 'p1', head_name: 'Ana Cruz' }]

it('maps each office to its head', () => {
  expect(headByOffice(heads).get('o1')).toBe('p1')
  expect(headNameByOffice(heads).get('o1')).toBe('Ana Cruz')
  expect(headNameByOffice(heads).get('o2')).toBeUndefined()
})
