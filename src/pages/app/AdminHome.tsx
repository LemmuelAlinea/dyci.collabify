import { RoleHome } from './RoleHome'
import type { Upcoming } from './RoleHome'

const UPCOMING: Upcoming[] = [
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
      intro="Approvals, accounts and the audit log are live. Cohort oversight lands here next."
      upcoming={UPCOMING}
    />
  )
}
