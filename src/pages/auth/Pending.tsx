import { Navigate } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { homeFor } from '../../lib/workplace'

export default function Pending() {
  const { ready, session, profile, signOut, refreshProfile } = useAuth()

  if (ready && !session) return <Navigate to="/login" replace />
  if (ready && !profile) return <Navigate to="/onboarding" replace />
  if (ready && profile && profile.status === 'active' && profile.role)
    return <Navigate to={homeFor(profile)} replace />

  const rejected = profile?.status === 'rejected'
  const roleless = !rejected && profile?.status === 'active' && !profile.role

  const title = rejected ? 'Account not active' : roleless ? 'No role on this account' : 'Waiting on approval'
  const subtitle = rejected
    ? 'The program admin has not approved this account, or has deactivated it.'
    : roleless
      ? 'This account was made before registration asked for student or faculty.'
      : 'Your faculty account is with the program admin.'

  return (
    <AuthLayout title={title} subtitle={subtitle}>
      <div className="space-y-5">
        <Alert tone={rejected ? 'error' : 'info'}>
          {rejected ? (
            <>
              Reach out to your program admin if you think this is a mistake. They can approve
              the account from the admin console.
            </>
          ) : roleless ? (
            <>Ask the program admin to set your role. This page opens your dashboard once they do.</>
          ) : (
            <>
              Check again once the program admin approves you, and this page becomes your
              dashboard. Everything stays locked until then, so the only people running a class or
              a space are faculty the school has checked.
            </>
          )}
        </Alert>

        <div className="card p-4 sm:p-5">
          <p className="eyebrow text-faint">Signed in as</p>
          <p className="mt-2 text-[14px] font-medium text-ink">{profile?.email ?? '—'}</p>
          <p className="mt-1 text-[13px] text-muted">
            Status: {rejected ? 'Not active' : roleless ? 'No role' : 'Pending review'}
          </p>
        </div>

        {!rejected && (
          <Button variant="outline" size="lg" full className="!rounded-xl" onClick={refreshProfile}>
            Check again
          </Button>
        )}
        <Button variant="ghost" size="md" full onClick={signOut}>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  )
}
