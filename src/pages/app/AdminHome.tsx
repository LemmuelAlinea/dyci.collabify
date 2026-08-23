import { RoleHome } from './RoleHome'
import type { Upcoming } from './RoleHome'

const UPCOMING: Upcoming[] = [
  {
    icon: 'folder',
    title: 'Sections and groups',
    body: 'Set up sections each term and assign advisers to capstone groups.',
  },
  {
    icon: 'bell',
    title: 'Announcements',
    body: 'Program-wide notices that reach students and advisers in one send.',
  },
  {
    icon: 'file',
    title: 'Program curriculum',
    body: 'Curriculum and syllabus templates published once, for every section of a course.',
  },
]

export default function AdminHome() {
  return (
    <RoleHome
      headline="Program console is ready"
      intro="Classes, faculty load and cohort progress are live, beside approvals, accounts and the audit log. Everything here is counts — what happens inside a class stays with its professor and their students."
      upcoming={UPCOMING}
      firstRunRole="admin"
    />
  )
}
