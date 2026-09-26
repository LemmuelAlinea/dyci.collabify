import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Icon'
import { useAuth } from '../../context/AuthContext'
import { JOIN_MESSAGE, joinClass, previewJoin, type JoinPreview } from '../../lib/api/classes'
import { authErrorMessage } from '../../lib/authError'
import { forgetJoin, rememberJoin } from '../../lib/pendingJoin'
import type { JoinResult } from '../../lib/types'
import { homeFor } from '../../lib/workplace'

/**
 * /join/:code — a class invite link.
 *
 * Signed out, it keeps the code and sends somebody to sign in; AuthCallback and
 * Onboarding bring them back here. Signed in as a student, it previews the
 * class and asks before joining. Anyone else is told the link is for students.
 */
export default function JoinClassLink() {
  const { code = '' } = useParams()
  const { ready, session, profile } = useAuth()
  const navigate = useNavigate()
  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState<JoinPreview | null>(null)
  const [joining, setJoining] = useState(false)
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
        const p = await previewJoin(code)
        if (p.result === 'already_member' && p.class_id) {
          navigate(`/student/classes/${p.class_id}`, { replace: true })
          return
        }
        if (p.result !== 'ok') {
          setMessage(JOIN_MESSAGE[p.result as Exclude<JoinResult, 'joined'>])
          return
        }
        setPreview(p)
      } catch (err) {
        setMessage(authErrorMessage(err, 'Could not join that class.'))
      }
    })()
  }, [ready, session, profile, code, navigate])

  async function handleJoin() {
    setJoining(true)
    try {
      const { result, class_id } = await joinClass(code)
      if ((result === 'joined' || result === 'already_member') && class_id) {
        navigate(`/student/classes/${class_id}`, { replace: true })
        return
      }
      setPreview(null)
      setMessage(JOIN_MESSAGE[result as Exclude<JoinResult, 'joined'>])
    } catch (err) {
      setPreview(null)
      setMessage(authErrorMessage(err, 'Could not join that class.'))
    } finally {
      setJoining(false)
    }
  }

  if (preview) {
    return (
      <AuthLayout title="Join this class?" subtitle={`Class code ${code.toUpperCase()}`}>
        <div className="space-y-5">
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-[15px] font-medium text-ink">{preview.name}</p>
            <p className="mt-1 text-[13.5px] text-muted">
              {preview.section} · {preview.professor}
            </p>
          </div>
          <p className="text-[13.5px] text-muted">
            Your professor and classmates will see your name and profile once you join.
          </p>
          <div className="flex gap-3">
            <Button variant="primary" full loading={joining} onClick={handleJoin}>
              Join class
            </Button>
            <Button
              variant="ghost"
              full
              disabled={joining}
              onClick={() => navigate(homeFor(profile))}
            >
              Not now
            </Button>
          </div>
        </div>
      </AuthLayout>
    )
  }

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
