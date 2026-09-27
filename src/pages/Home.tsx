import { lazy } from 'react'
import { RoleSwitch } from '../routes/RoleSwitch'
import { WorkOverview } from '../components/general/WorkOverview'

// Lazy, same as every other role page: a student opening /home never fetches
// the admin console, and the reverse.
const StudentHome = lazy(() => import('./app/StudentHome'))
const ProfessorHome = lazy(() => import('./app/ProfessorHome'))
const AdminHome = lazy(() => import('./app/AdminHome'))

/**
 * `/home` — one address for every role's dashboard.
 *
 * Which page that means is still decided by role, same as before; only the
 * URL stopped saying so. Task 6 stacks the General work section onto this
 * page, so a dashboard reads as one place instead of two workplaces to check.
 */
export default function Home() {
  return (
    <>
      <RoleSwitch student={<StudentHome />} faculty={<ProfessorHome />} admin={<AdminHome />} />
      <WorkOverview />
    </>
  )
}
