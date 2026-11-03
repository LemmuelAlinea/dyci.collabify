import { expect, it, vi } from 'vitest'
import { fullName } from '../types'
import { listGeneralMembers } from './general'

vi.mock('../supabase', () => ({
  supabase: { from: () => ({
    select: (columns: string) => {
      const profile = {
        id: 'u1', first_name: 'Adrian', last_name: 'Reyes', avatar_url: null,
        status: 'active', role: 'member', can_manage_projects: true,
        ...(columns.includes('middle_name') ? { middle_name: 'Mendoza' } : {}),
      }
      return { eq: () => ({ order: async () => ({ data: [{ project_id: 'p1', user_id: 'u1', level: 'owner', role: 'pm', joined_at: '', profile }], error: null }) }) }
    },
  }) },
}))

it('loads full project member names for roster matching', async () => {
  const [member] = await listGeneralMembers('p1')
  expect(fullName(member.profile!)).toBe('Adrian Mendoza Reyes')
})
