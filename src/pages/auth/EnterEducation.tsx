import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { RoleChoice } from '../../components/ui/RoleChoice'
import { useAuth } from '../../context/AuthContext'
import { authErrorMessage } from '../../lib/authError'
import { educationHome } from '../../lib/workplace'
import type { Role } from '../../lib/types'

/**
 * The one time an account that registered for General says whether it takes
 * classes or teaches them. `enter_education` refuses a second call, so this
 * page is never a way to change a role — that stays with the program admin.
 */
export default function EnterEducation() {
  const { ready, session, profile, enterEducation } = useAuth()
  const navigate = useNavigate()
  const [role, setRole] = useState<Exclude<Role, 'admin'>>('student')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Open Education · Collabify'
  }, [])

  if (ready && !session) return <Navigate to="/login" replace />
  if (ready && !profile) return <Navigate to="/onboarding" replace />
  if (profile?.status === 'rejected') return <Navigate to="/pending" replace />
  if (profile?.role) return <Navigate to={educationHome(profile)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const next = await enterEducation(role)
      navigate(educationHome(next), { replace: true })
    } catch (err) {
      setError(authErrorMessage(err, 'Could not open Education for this account.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Open the Education workplace"
      subtitle="Education is for class projects. Say whether you take classes or teach them. You choose this once."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <RoleChoice value={role} onChange={setRole} />

        {role === 'professor' && (
          <Alert tone="info">
            The program office reviews professor accounts before teaching tools unlock. The
            General workplace keeps working while you wait.
          </Alert>
        )}

        <Button type="submit" size="lg" full loading={busy} className="!rounded-xl">
          Open Education
        </Button>

        <Link
          to="/general"
          className="block text-center text-[13px] font-medium text-muted hover:text-ink"
        >
          Back to the General workplace
        </Link>
      </form>
    </AuthLayout>
  )
}
