import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { ThemeSync } from './components/ThemeSync'
import { AppShell } from './components/app/AppShell'
import { ErrorBoundary } from './components/app/ErrorBoundary'
import { ProtectedRoute, RequireAdmitted } from './routes/ProtectedRoute'
import { RoleSwitch } from './routes/RoleSwitch'
import { LegacyRedirect } from './routes/LegacyRedirect'
import { PageLoading } from './components/ui/PageLoading'
import { paths } from './lib/paths'

import NotFound from './pages/NotFound'

import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import CheckEmail from './pages/auth/CheckEmail'
import AuthCallback from './pages/auth/AuthCallback'
import Onboarding from './pages/auth/Onboarding'
import Pending from './pages/auth/Pending'
import JoinClassLink from './pages/auth/JoinClassLink'




/**
 * Everything behind the sign-in is loaded when it is first opened.
 *
 * The whole product used to arrive in one 1.15 MB file, so a student reading
 * the landing page downloaded the program chair's console, the analytics bands
 * and the entire print system before the headline could render. Each of these
 * is now its own chunk, fetched on the way to the page that needs it.
 *
 * The landing page and the auth screens stay eager: they are the first thing a
 * visitor sees, and splitting them would trade a smaller download for a blank
 * frame at the worst possible moment.
 */
// Lazy so the landing page's 3D board never lands on a signed-in route.
const Landing = lazy(() => import('./pages/Landing'))
const LegalDocPage = lazy(() => import('./pages/legal/LegalDoc'))
const PrivacyRequest = lazy(() => import('./pages/legal/PrivacyRequest'))
const PrivacyQueue = lazy(() => import('./pages/app/PrivacyQueue'))
const Accounts = lazy(() => import('./pages/app/admin/Accounts'))
const Analytics = lazy(() => import('./pages/app/analytics/Analytics'))
const AuditLog = lazy(() => import('./pages/app/admin/AuditLog'))
const Calendar = lazy(() => import('./pages/app/calendar/Calendar'))
const Cohort = lazy(() => import('./pages/app/admin/Cohort'))
const Curriculum = lazy(() => import('./pages/app/resources/Curriculum'))
const Faculty = lazy(() => import('./pages/app/admin/Faculty'))
const GroupDetail = lazy(() => import('./pages/app/groups/GroupDetail'))
const Home = lazy(() => import('./pages/Home'))
const Messages = lazy(() => import('./pages/app/messages/Messages'))
const MyTasks = lazy(() => import('./pages/app/tasks/MyTasks'))
const Notices = lazy(() => import('./pages/app/admin/Notices'))
const ProfessorApprovals = lazy(() => import('./pages/app/admin/ProfessorApprovals'))
const ProfessorClasses = lazy(() => import('./pages/app/classes/ProfessorClasses'))
const ProfessorGroups = lazy(() => import('./pages/app/groups/ProfessorGroups'))
const ProfessorProjects = lazy(() => import('./pages/app/projects/ProfessorProjects'))
const ProgramClasses = lazy(() => import('./pages/app/admin/ProgramClasses'))
const ProgramLibrary = lazy(() => import('./pages/app/admin/ProgramLibrary'))
const ProjectDetail = lazy(() => import('./pages/app/projects/ProjectDetail'))
const Reassignments = lazy(() => import('./pages/app/reassignments/Reassignments'))
const Submissions = lazy(() => import('./pages/app/submissions/Submissions'))
const Reports = lazy(() => import('./pages/app/reports/Reports'))
const Sections = lazy(() => import('./pages/app/admin/Sections'))
const Settings = lazy(() => import('./pages/Settings'))
const ClassSpace = lazy(() => import('./pages/app/classes/ClassSpace'))
const StudentClasses = lazy(() => import('./pages/app/classes/StudentClasses'))
const StudentGroups = lazy(() => import('./pages/app/groups/StudentGroups'))
const StudentProjects = lazy(() => import('./pages/app/projects/StudentProjects'))
const StudentReports = lazy(() => import('./pages/app/reports/StudentReports'))
const Syllabi = lazy(() => import('./pages/app/resources/Syllabi'))
const SyllabusDetail = lazy(() => import('./pages/app/resources/SyllabusDetail'))
const SpaceHome = lazy(() => import('./pages/general/SpaceHome'))
const GeneralProjects = lazy(() => import('./pages/general/GeneralProjects'))
const GeneralTeams = lazy(() => import('./pages/general/GeneralTeams'))
const SpacePicker = lazy(() => import('./pages/general/SpacePicker'))
const SpaceMembers = lazy(() => import('./pages/general/SpaceMembers'))
const SpaceArchive = lazy(() => import('./pages/general/SpaceArchive'))
const GeneralProject = lazy(() => import('./pages/general/GeneralProject'))
const ProjectArchive = lazy(() => import('./pages/general/ProjectArchive'))
const GeneralReports = lazy(() => import('./pages/general/GeneralReports'))

/** An old /messages/<id> link, kept on its conversation and query in the Inbox. */
function MessagesRedirect() {
  const { conversationId } = useParams()
  const { search } = useLocation()
  return <Navigate to={`${paths.conversation(conversationId ?? '')}${search}`} replace />
}

export default function App() {
  return (
    // The outer net. The shell has its own boundary around the page area, which
    // catches almost everything and keeps the navigation; this one is for what
    // escapes that — a failure in the shell itself, or on a page outside it.
    <ErrorBoundary home="/">
      <ThemeSync />
      {/* The shell has its own Suspense around the page area, so this one only
          catches a lazy route that renders outside it. */}
      <Suspense fallback={<PageLoading />}>
          <Routes>
          <Route path="/" element={<Landing />} />

          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/check-email" element={<CheckEmail />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/pending" element={<Pending />} />
          <Route path="/join/:code" element={<JoinClassLink />} />

          {/* Public on purpose. Somebody deciding whether to register has to be
              able to read what they would be agreeing to before they have an
              account, and a policy behind a sign-in is not a notice. */}
          <Route path="/privacy" element={<LegalDocPage slug="privacy" />} />
          <Route path="/terms" element={<LegalDocPage slug="terms" />} />
          <Route path="/cookies" element={<LegalDocPage slug="cookies" />} />

          {/* One shell for every signed-in account, admitted or not. Crossing
              between Home, Settings, /record, /teaching/* and /admin/* used
              to remount <AppShell> and its GeneralNavigationProvider — now the
              shell mounts once here, and RequireAdmitted below narrows what
              each group inside it may see without tearing it down. */}
          <Route element={<ProtectedRoute open />}>
          <Route element={<AppShell />}>
            <Route path="/settings" element={<Settings />} />
            <Route path="/privacy/request" element={<PrivacyRequest />} />

            {/* One rail for every admitted account, whatever their role. Which
                page a role-shaped route renders is decided inside it by
                RoleSwitch, not by which URL got you there. */}
            <Route element={<RequireAdmitted />}>
              <Route path="/home" element={<Home />} />
              {/* One My tasks for every role: it reads class boards for students
                  and General work for everyone, so admin belongs here too. */}
              <Route path="/tasks" element={<MyTasks />} />
              <Route
                path="/calendar"
                element={
                  <RoleSwitch student={<Calendar />} faculty={<Calendar />} admin={<Calendar />} />
                }
              />
              <Route path="/inbox" element={<Messages />} />
              <Route path="/inbox/:conversationId" element={<Messages />} />
              {/* Messages became the Inbox; old links and bookmarks still land. */}
              <Route path="/messages" element={<Navigate to={paths.inbox} replace />} />
              <Route path="/messages/:conversationId" element={<MessagesRedirect />} />

              {/* Work spaces, open to every admitted account — a professor's
                  capstone side project is exactly as valid as a student's. */}
              <Route path="/spaces" element={<SpacePicker />} />
              <Route path="/spaces/archive" element={<SpacePicker />} />
              <Route path="/spaces/:spaceId" element={<SpaceHome />} />
              <Route path="/spaces/:spaceId/members" element={<SpaceMembers />} />
              <Route path="/spaces/:spaceId/teams" element={<GeneralTeams />} />
              <Route path="/spaces/:spaceId/teams/archive" element={<GeneralTeams />} />
              <Route path="/spaces/:spaceId/archive" element={<SpaceArchive />} />
              <Route path="/spaces/:spaceId/reports" element={<GeneralReports />} />

              {/* Flat, not nested under the space: a project id is unique on its
                  own, and nesting would break every link and deep link already
                  out there. The space is derived from the project. */}
              <Route path="/projects" element={<GeneralProjects />} />
              <Route path="/projects/:projectId" element={<GeneralProject />} />
              <Route path="/projects/:projectId/archive" element={<ProjectArchive />} />

              <Route
                path="/classes"
                element={
                  <RoleSwitch
                    student={<StudentClasses />}
                    faculty={<ProfessorClasses />}
                    admin={<Navigate to={paths.admin.classes} replace />}
                  />
                }
              />
              <Route
                path="/classes/:classId"
                element={<RoleSwitch student={<ClassSpace />} faculty={<ClassSpace />} />}
              />

              <Route
                path="/groups"
                element={<RoleSwitch student={<StudentGroups />} faculty={<ProfessorGroups />} />}
              />
              <Route
                path="/groups/:groupId"
                element={
                  <RoleSwitch
                    student={<GroupDetail role="student" />}
                    faculty={<GroupDetail role="professor" />}
                  />
                }
              />

              <Route
                path="/class-projects"
                element={<RoleSwitch student={<StudentProjects />} faculty={<ProfessorProjects />} />}
              />
              <Route
                path="/class-projects/:projectId"
                element={
                  <RoleSwitch
                    student={<ProjectDetail role="student" />}
                    faculty={<ProjectDetail role="professor" />}
                  />
                }
              />
            </Route>

            <Route element={<RequireAdmitted allow={['student']} />}>
              <Route path="/record" element={<StudentReports />} />
            </Route>

            <Route element={<RequireAdmitted allow={['faculty', 'admin']} />}>
              <Route path="/teaching/submissions" element={<Submissions />} />
              <Route path="/teaching/reassignments" element={<Reassignments />} />
              <Route path="/teaching/analytics" element={<Analytics />} />
              <Route path="/teaching/reports" element={<Reports />} />
              <Route path="/teaching/syllabi" element={<Syllabi />} />
              <Route path="/teaching/syllabi/:resourceId" element={<SyllabusDetail />} />
              <Route path="/teaching/curriculum" element={<Curriculum />} />
              {/* The queue is the same page for both roles. is_privacy_handler()
                  decides what it returns, so a professor who is not the handler
                  sees only their own requests rather than an empty screen with a
                  nav entry pointing at it. */}
              <Route path="/privacy/queue" element={<PrivacyQueue />} />
            </Route>

            <Route element={<RequireAdmitted allow={['admin']} />}>
              <Route path="/admin/approvals" element={<ProfessorApprovals />} />
              <Route path="/admin/notices" element={<Notices />} />
              <Route path="/admin/sections" element={<Sections />} />
              <Route path="/admin/library" element={<ProgramLibrary />} />
              <Route path="/admin/classes" element={<ProgramClasses />} />
              <Route path="/admin/faculty" element={<Faculty />} />
              <Route path="/admin/cohort" element={<Cohort />} />
              <Route path="/admin/audit" element={<AuditLog />} />
              <Route path="/admin/privacy" element={<PrivacyQueue />} />
              <Route path="/admin/accounts" element={<Accounts />} />
            </Route>
          </Route>
          </Route>

          {/* Old sections, kept working for whatever still links to them. Listed
              before the 404 catch-all, and /admin plus /admin/settings are
              named exactly so they never shadow the real admin pages above. */}
          <Route path="/student/*" element={<LegacyRedirect />} />
          <Route path="/professor/*" element={<LegacyRedirect />} />
          <Route path="/general/*" element={<LegacyRedirect />} />
          <Route path="/general" element={<LegacyRedirect />} />
          <Route path="/student" element={<LegacyRedirect />} />
          <Route path="/professor" element={<LegacyRedirect />} />
          <Route path="/admin" element={<LegacyRedirect />} />
          <Route path="/admin/settings" element={<LegacyRedirect />} />
          <Route path="/education/*" element={<LegacyRedirect />} />

          <Route path="*" element={<NotFound />} />
          </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
