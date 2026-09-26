import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Alert } from '../../components/ui/Alert'
import { Spinner } from '../../components/ui/Icon'
import { useAuth } from '../../context/AuthContext'
import { JOIN_MESSAGE, joinClass } from '../../lib/api/classes'
import { authErrorMessage } from '../../lib/authError'
import { forgetJoin, rememberJoin } from '../../lib/pendingJoin'
import { homeFor } from '../../lib/workplace'

/**
 * /join/:code — a class invite link.
 *
 * Signed out, it keeps the code and sends somebody to sign in; AuthCallback and
 * Onboarding bring them back here. Signed in as a student, it joins and opens
 * the class. Anyone else is told the link is for students.
 */
export default function JoinClassLink() {
  const { code = '' } = useParams()
  const { ready, session, profile } = useAuth()
  const navigate = useNavigate()
  const [message, setMessage] = useState<string | null>(null)
  const started = useRef<string | null>(null)

  useEffect(() => {
    if (!ready || started.current === code) return
    if (!session) {
      rememberJoin(code)
      navigate('/login', { replace: true })
      return
    }
    if (!profile) {
      rememberJoin(code)
      navigate('/onboarding', { replace: true })
      return
    }
    started.current = code
    forgetJoin()
    if (profile.status !== 'active') {
      navigate('/pending', { replace: true })
      return
    }
    if (profile.role !== 'student') {
      setMessage('Class links are for student accounts. Faculty open classes from their own dashboard.')
      return
    }
    void (async () => {
      try {
        const { result, class_id } = await joinClass(code)
        if ((result === 'joined' || result === 'already_member') && class_id) {
          navigate(`/student/classes/${class_id}`, { replace: true })
          return
        }
        setMessage(result === 'joined' ? 'You joined the class.' : JOIN_MESSAGE[result])
      } catch (err) {
        setMessage(authErrorMessage(err, 'Could not join that class.'))
      }
    })()
  }, [ready, session, profile, code, navigate])

  return (
    <AuthLayout title="Joining your class" subtitle={`Class code ${code.toUpperCase()}`}>
      {message ? (
        <div className="space-y-4">
          <Alert tone="error">{message}</Alert>
          <Link
            to={homeFor(profile!)}
            className="block rounded-xl border border-line px-4 py-3 text-center text-[14px] font-medium text-ink transition-colors hover:bg-[var(--surface-sunken)]"
          >
            Go to your dashboard
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-[14px] text-muted">
          <Spinner size={16} />
          Opening the class…
        </div>
      )}
    </AuthLayout>
  )
}
