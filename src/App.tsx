import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import DesignProbe from './pages/__probe/DesignProbe'
import { ThemeSync } from './components/ThemeSync'
import { AppShell } from './components/app/AppShell'
import { ErrorBoundary } from './components/app/ErrorBoundary'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { PageLoading } from './components/ui/PageLoading'

import Landing from './pages/Landing'
import NotFound from './pages/NotFound'

import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import CheckEmail from './pages/auth/CheckEmail'
import AuthCallback from './pages/auth/AuthCallback'
import Onboarding from './pages/auth/Onboarding'
import Pending from './pages/auth/Pending'




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
const Accounts = lazy(() => import('./pages/app/admin/Accounts'))
const AdminHome = lazy(() => import('./pages/app/AdminHome'))
const Analytics = lazy(() => import('./pages/app/analytics/Analytics'))
const AuditLog = lazy(() => import('./pages/app/admin/AuditLog'))
const Calendar = lazy(() => import('./pages/app/calendar/Calendar'))
const Cohort = lazy(() => import('./pages/app/admin/Cohort'))
const Curriculum = lazy(() => import('./pages/app/resources/Curriculum'))
const Faculty = lazy(() => import('./pages/app/admin/Faculty'))
const GroupDetail = lazy(() => import('./pages/app/groups/GroupDetail'))
const Messages = lazy(() => import('./pages/app/messages/Messages'))
const MyTasks = lazy(() => import('./pages/app/tasks/MyTasks'))
const Notices = lazy(() => import('./pages/app/admin/Notices'))
const ProfessorApprovals = lazy(() => import('./pages/app/admin/ProfessorApprovals'))
const ProfessorClassDetail = lazy(() => import('./pages/app/classes/ProfessorClassDetail'))
const ProfessorClasses = lazy(() => import('./pages/app/classes/ProfessorClasses'))
const ProfessorGroups = lazy(() => import('./pages/app/groups/ProfessorGroups'))
const ProfessorHome = lazy(() => import('./pages/app/ProfessorHome'))
const ProfessorProjects = lazy(() => import('./pages/app/projects/ProfessorProjects'))
const ProgramClasses = lazy(() => import('./pages/app/admin/ProgramClasses'))
const ProgramLibrary = lazy(() => import('./pages/app/admin/ProgramLibrary'))
const ProjectDetail = lazy(() => import('./pages/app/projects/ProjectDetail'))
const Reassignments = lazy(() => import('./pages/app/reassignments/Reassignments'))
const Reports = lazy(() => import('./pages/app/reports/Reports'))
const Sections = lazy(() => import('./pages/app/admin/Sections'))
const Settings = lazy(() => import('./pages/Settings'))
const StudentClassDetail = lazy(() => import('./pages/app/classes/StudentClassDetail'))
const StudentClasses = lazy(() => import('./pages/app/classes/StudentClasses'))
const StudentGroups = lazy(() => import('./pages/app/groups/StudentGroups'))
const StudentHome = lazy(() => import('./pages/app/StudentHome'))
const StudentProjects = lazy(() => import('./pages/app/projects/StudentProjects'))
const StudentReports = lazy(() => import('./pages/app/reports/StudentReports'))
const Syllabi = lazy(() => import('./pages/app/resources/Syllabi'))
const SyllabusDetail = lazy(() => import('./pages/app/resources/SyllabusDetail'))

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
          <Route path="/__design" element={<DesignProbe />} />

          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/check-email" element={<CheckEmail />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/pending" element={<Pending />} />

          <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/settings" element={<Settings />} />
          </Route>
          </Route>

          <Route element={<ProtectedRoute allow={['student']} />}>
          <Route element={<AppShell />}>
            <Route path="/student" element={<StudentHome />} />
            <Route path="/student/classes" element={<StudentClasses />} />
            <Route path="/student/classes/:classId" element={<StudentClassDetail />} />
            <Route path="/student/groups" element={<StudentGroups />} />
            <Route path="/student/projects" element={<StudentProjects />} />
            <Route path="/student/calendar" element={<Calendar />} />
            <Route path="/student/reports" element={<StudentReports />} />
            <Route path="/student/tasks" element={<MyTasks />} />
            <Route
              path="/student/projects/:projectId"
              element={<ProjectDetail role="student" />}
            />
            <Route path="/student/groups/:groupId" element={<GroupDetail role="student" />} />
            <Route path="/student/messages" element={<Messages role="student" />} />
            <Route
              path="/student/messages/:conversationId"
              element={<Messages role="student" />}
            />
          </Route>
          </Route>

          <Route element={<ProtectedRoute allow={['professor']} />}>
          <Route element={<AppShell />}>
            <Route path="/professor" element={<ProfessorHome />} />
            <Route path="/professor/classes" element={<ProfessorClasses />} />
            <Route path="/professor/classes/:classId" element={<ProfessorClassDetail />} />
            <Route path="/professor/groups" element={<ProfessorGroups />} />
            <Route path="/professor/projects" element={<ProfessorProjects />} />
            <Route
              path="/professor/projects/:projectId"
              element={<ProjectDetail role="professor" />}
            />
            <Route path="/professor/groups/:groupId" element={<GroupDetail role="professor" />} />
            <Route path="/professor/messages" element={<Messages role="professor" />} />
            <Route
              path="/professor/messages/:conversationId"
              element={<Messages role="professor" />}
            />
            <Route path="/professor/syllabi" element={<Syllabi />} />
            <Route path="/professor/syllabi/:resourceId" element={<SyllabusDetail />} />
            <Route path="/professor/curriculum" element={<Curriculum />} />
            <Route path="/professor/reassignments" element={<Reassignments />} />
            <Route path="/professor/calendar" element={<Calendar />} />
            <Route path="/professor/analytics" element={<Analytics />} />
            <Route path="/professor/reports" element={<Reports />} />
          </Route>
          </Route>

          <Route element={<ProtectedRoute allow={['admin']} />}>
          <Route element={<AppShell />}>
            <Route path="/admin" element={<AdminHome />} />
            <Route path="/admin/approvals" element={<ProfessorApprovals />} />
            <Route path="/admin/notices" element={<Notices />} />
            <Route path="/admin/sections" element={<Sections />} />
            <Route path="/admin/library" element={<ProgramLibrary />} />
            <Route path="/admin/classes" element={<ProgramClasses />} />
            <Route path="/admin/faculty" element={<Faculty />} />
            <Route path="/admin/cohort" element={<Cohort />} />
            <Route path="/admin/audit" element={<AuditLog />} />
            <Route path="/admin/accounts" element={<Accounts />} />
          </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
          </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
