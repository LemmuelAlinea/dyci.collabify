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

import ProfessorClasses from './pages/app/classes/ProfessorClasses'
import ProfessorClassDetail from './pages/app/classes/ProfessorClassDetail'
import StudentClasses from './pages/app/classes/StudentClasses'
import StudentClassDetail from './pages/app/classes/StudentClassDetail'
import Syllabi from './pages/app/resources/Syllabi'
import SyllabusDetail from './pages/app/resources/SyllabusDetail'
import Curriculum from './pages/app/resources/Curriculum'
import ProfessorGroups from './pages/app/groups/ProfessorGroups'
import StudentGroups from './pages/app/groups/StudentGroups'
import GroupDetail from './pages/app/groups/GroupDetail'
import Messages from './pages/app/messages/Messages'

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
            <Route path="/professor/groups/:groupId" element={<GroupDetail role="professor" />} />
            <Route path="/professor/messages" element={<Messages role="professor" />} />
            <Route
              path="/professor/messages/:conversationId"
              element={<Messages role="professor" />}
            />
            <Route path="/professor/syllabi" element={<Syllabi />} />
            <Route path="/professor/syllabi/:resourceId" element={<SyllabusDetail />} />
            <Route path="/professor/curriculum" element={<Curriculum />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allow={['superadmin']} />}>
          <Route element={<AppShell />}>
            <Route path="/admin" element={<AdminHome />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}
