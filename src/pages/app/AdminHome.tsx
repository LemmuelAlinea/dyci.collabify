import { RoleHome } from './RoleHome'
import type { Upcoming } from './RoleHome'

const UPCOMING: Upcoming[] = [
  {
    icon: 'users',
    title: 'Account management',
    body: 'Search the roster, change a role, or deactivate an account that has left the program.',
  },
  {
    icon: 'folder',
    title: 'Sections and groups',
    body: 'Set up sections each term and assign advisers to capstone groups.',
  },
  {
    icon: 'chart',
    title: 'Cohort progress',
    body: 'Completion across the whole batch, so a stalled group surfaces before defense week.',
  },
  {
    icon: 'bell',
    title: 'Announcements',
    body: 'Program-wide notices that reach students and advisers in one send.',
  },
]

export default function AdminHome() {
  return (
    <RoleHome
      headline="Program console is ready"
      intro="Professor approvals and the audit log are live. Rosters and cohort oversight land here next."
      upcoming={UPCOMING}
    />
  )
}
