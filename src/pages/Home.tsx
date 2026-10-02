import { lazy, useState } from 'react'
import { RoleSwitch } from '../routes/RoleSwitch'
import { WorkOverview } from '../components/general/WorkOverview'
import { useAuth } from '../context/AuthContext'
import { useGeneralNavigation } from '../context/generalNavigation'
import { canTeach, membershipOf } from '../lib/access'

// Lazy, same as every other role page: a student opening /home never fetches
// the admin console, and the reverse.
const StudentHome = lazy(() => import('./app/StudentHome'))
const ProfessorHome = lazy(() => import('./app/ProfessorHome'))
const AdminHome = lazy(() => import('./app/AdminHome'))

type View = 'classes' | 'work'
const VIEW_KEY = 'collabify:home-view'

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'work' ? 'work' : 'classes'
  } catch {
    return 'classes'
  }
}

/**
 * `/home` — one address for every role's dashboard.
 *
 * Which page that means is still decided by role, same as before; only the
 * URL stopped saying so. Everyone else gets their role dashboard with "Your
 * work" stacked under it. Faculty who teach, and students who have work too,
 * run two full dashboards, so they see one at a time and trade with the swap
 * button at the top right of its banner; the last one they chose is
 * remembered on this device.
 */
export default function Home() {
  const { profile } = useAuth()
  const [view, setView] = useState<View>(readView)
  const { spaces, myProjects } = useGeneralNavigation()
  // Still loading counts as no work, so the class dashboard shows meanwhile.
  const studentWithWork =
    profile?.role === 'student' && Boolean(membershipOf(spaces, myProjects)?.hasWork)

  function choose(next: View) {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Private windows can refuse storage; the switch still works for this visit.
    }
  }

  if (canTeach(profile)) {
    return view === 'work' ? (
      <WorkOverview standalone onSwitch={() => choose('classes')} />
    ) : (
      <ProfessorHome onSwitch={() => choose('work')} />
    )
  }

  if (studentWithWork) {
    return view === 'work' ? (
      <WorkOverview standalone onSwitch={() => choose('classes')} />
    ) : (
      <StudentHome onSwitch={() => choose('work')} />
    )
  }

  return (
    <>
      <RoleSwitch student={<StudentHome />} faculty={<ProfessorHome />} admin={<AdminHome />} />
      <WorkOverview />
    </>
  )
}
