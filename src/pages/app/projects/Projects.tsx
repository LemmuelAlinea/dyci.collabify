import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { WorkProjectsView } from '../../../components/general/WorkProjectsView'
import { ClassProjectsView } from '../../../components/projects/ClassProjectsView'
import { ScopeFilter } from '../../../components/ui/ScopeFilter'
import { useAuth } from '../../../context/AuthContext'
import { useGeneralNavigation } from '../../../context/generalNavigation'
import { canTeach, membershipOf } from '../../../lib/access'
import { readScope, writeScope } from '../../../lib/scope'

const OPTIONS = [
  { value: 'classes' as const, label: 'Classes' },
  { value: 'work' as const, label: 'Work' },
]

/**
 * Class projects and workspace projects on one page.
 *
 * Someone with only one kind sees only that kind: a student nobody has
 * invited into a space sees their classes' projects, faculty who do not teach
 * (and admins) see workspace projects. Someone with both — a student invited
 * into a space or project, or faculty who teach — gets a Classes · Work
 * switch, kept in `?show=` like Tasks and Calendar. It has no All: the two
 * kinds have different cards and different filters. Students open on their
 * classes, faculty on their spaces.
 */
export default function Projects() {
  const { profile } = useAuth()
  const navigation = useGeneralNavigation()
  const [params, setParams] = useSearchParams()

  useEffect(() => {
    document.title = 'Projects · Collabify'
  }, [])

  const student = profile?.role === 'student'
  const both = student
    ? Boolean(membershipOf(navigation.spaces, navigation.myProjects)?.hasWork)
    : canTeach(profile)
  const chosen = readScope(params)
  const show = both && chosen !== 'all' ? chosen : student ? 'classes' : 'work'

  const scope = both ? (
    <ScopeFilter
      value={show}
      options={OPTIONS}
      onChange={(next) => setParams(writeScope(params, next), { replace: true })}
    />
  ) : undefined

  return show === 'classes' ? <ClassProjectsView scope={scope} /> : <WorkProjectsView scope={scope} />
}
