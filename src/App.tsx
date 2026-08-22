import { Route, Routes } from 'react-router-dom'
import { ThemeSync } from './components/ThemeSync'
import { AppShell } from './components/app/AppShell'
import { ProtectedRoute } from './routes/ProtectedRoute'

import Landing from './pages/Landing'
import NotFound from './pages/NotFound'
import Settings from './pages/Settings'

import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import CheckEmail from './pages/auth/CheckEmail'
import AuthCallback from './pages/auth/AuthCallback'
import Onboarding from './pages/auth/Onboarding'
import Pending from './pages/auth/Pending'

import StudentHome from './pages/app/StudentHome'
import ProfessorHome from './pages/app/ProfessorHome'
import AdminHome from './pages/app/AdminHome'
import Accounts from './pages/app/admin/Accounts'
import AuditLog from './pages/app/admin/AuditLog'
import ProfessorApprovals from './pages/app/admin/ProfessorApprovals'

import ProfessorClasses from './pages/app/classes/ProfessorClasses'
import ProfessorClassDetail from './pages/app/classes/ProfessorClassDetail'
import StudentClasses from './pages/app/classes/StudentClasses'
import StudentClassDetail from './pages/app/classes/StudentClassDetail'
import Syllabi from './pages/app/resources/Syllabi'
import SyllabusDetail from './pages/app/resources/SyllabusDetail'
import Analytics from './pages/app/analytics/Analytics'
import Reports from './pages/app/reports/Reports'
import StudentReports from './pages/app/reports/StudentReports'
import Calendar from './pages/app/calendar/Calendar'
import Curriculum from './pages/app/resources/Curriculum'
import Reassignments from './pages/app/reassignments/Reassignments'
import ProfessorGroups from './pages/app/groups/ProfessorGroups'
import StudentGroups from './pages/app/groups/StudentGroups'
import GroupDetail from './pages/app/groups/GroupDetail'
import Messages from './pages/app/messages/Messages'
import ProfessorProjects from './pages/app/projects/ProfessorProjects'
import StudentProjects from './pages/app/projects/StudentProjects'
import ProjectDetail from './pages/app/projects/ProjectDetail'
import MyTasks from './pages/app/tasks/MyTasks'

export default function App() {
  return (
    <>
      <ThemeSync />
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
            <Route path="/admin/audit" element={<AuditLog />} />
            <Route path="/admin/accounts" element={<Accounts />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}
