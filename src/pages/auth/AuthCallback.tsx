import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Spinner } from '../../components/ui/Icon'
import { LogoMark } from '../../components/brand/Logo'
import { useAuth } from '../../context/AuthContext'
import { roleHome } from '../../lib/roleHome'

export default function AuthCallback() {
  const { ready, session, profile } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!ready) return
    if (!session) {
      navigate('/login', { replace: true })
      return
    }
    // Google users arrive with no profile row — send them through onboarding.
    navigate(profile ? roleHome(profile.role, profile.status) : '/onboarding', {
      replace: true,
    })
  }, [ready, session, profile, navigate])

  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="flex flex-col items-center gap-5 text-center">
        <LogoMark size={48} />
        <div className="flex items-center gap-2.5 text-[14.5px] text-muted">
          <Spinner size={17} />
          Signing you in…
        </div>
      </div>
    </div>
  )
}
