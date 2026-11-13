import { RoleHome } from './RoleHome'
import type { Upcoming } from './RoleHome'
import { AttentionBand } from './admin/home/AttentionBand'
import { OfficesBand } from './admin/home/OfficesBand'
import { ProgramBand } from './admin/home/ProgramBand'
import { SetupBand } from './admin/home/SetupBand'
import { paths } from '../../lib/paths'

const UPCOMING: Upcoming[] = [
  {
    icon: 'briefcase',
    title: 'Offices',
    body: 'Give each member a home office and file every work space under one.',
    to: paths.admin.offices,
  },
  {
    icon: 'kanban',
    title: 'Work projects',
    body: 'See every running project, its space and who leads it, and assign a project manager where one is missing.',
    to: paths.admin.projects,
  },
  {
    icon: 'bell',
    title: 'Notices',
    body: 'Organization-wide notices that reach members, faculty and students in one send.',
    to: paths.admin.notices,
  },
]

/**
 * The organization at a glance: offices, the projects that need a look,
 * accounts still in setup and privacy requests near their date, with the
 * academic program below. Each band reads, empties and fails on its own.
 * Counts and names only: nothing here opens a project.
 */
export default function AdminHome() {
  return (
    <RoleHome
      headline="Organization overview"
      intro="Offices, work projects, accounts and privacy requests at a glance, with the academic program below. Everything here is counts and names — what happens inside a project or a class stays with the people in it."
      upcoming={UPCOMING}
    >
      <div className="space-y-6">
        <OfficesBand />
        <div className="grid gap-6 lg:grid-cols-3">
          <AttentionBand className="lg:col-span-2" />
          <SetupBand />
        </div>
        <ProgramBand />
      </div>
    </RoleHome>
  )
}
