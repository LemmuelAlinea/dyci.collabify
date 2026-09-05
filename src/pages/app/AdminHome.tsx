import { RoleHome } from './RoleHome'
import type { Upcoming } from './RoleHome'

const UPCOMING: Upcoming[] = [
  {
    icon: 'folder',
    title: 'Sections',
    body: 'Keep cohort names, year levels, and advisers consistent.',
    to: '/admin/sections',
  },
  {
    icon: 'bell',
    title: 'Announcements',
    body: 'Program-wide notices that reach students and advisers in one send.',
    to: '/admin/notices',
  },
  {
    icon: 'file',
    title: 'Program curriculum',
    body: 'Curriculum and syllabus templates published once, for every section of a course.',
    to: '/admin/library',
  },
]

export default function AdminHome() {
  return (
    <RoleHome
      headline="Program overview"
      intro="Classes, faculty load and cohort progress are live, beside approvals, accounts and the audit log. Everything here is counts — what happens inside a class stays with its professor and their students."
      upcoming={UPCOMING}
    />
  )
}
