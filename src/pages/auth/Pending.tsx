import { Navigate } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { homeFor } from '../../lib/access'

export default function Pending() {
  const { ready, session, profile, signOut, refreshProfile } = useAuth()

  if (ready && !session) return <Navigate to="/login" replace />
  if (ready && !profile) return <Navigate to="/onboarding" replace />
  if (ready && profile && profile.status === 'active' && profile.role)
    return <Navigate to={homeFor(profile)} replace />

  const rejected = profile?.status === 'rejected'
  const roleless = !rejected && profile?.status === 'active' && !profile.role

  const title = rejected ? 'Account not active' : roleless ? 'No role on this account' : 'Waiting on the program admin'
  const subtitle = rejected
    ? 'The program admin has deactivated this account, or has not let it in yet.'
    : roleless
      ? 'This account was made before registration asked what kind of account it is.'
      : 'Your account is with the program admin.'

  return (
    <AuthLayout title={title} subtitle={subtitle}>
      <div className="space-y-5">
        <Alert tone={rejected ? 'error' : 'info'}>
          {rejected ? (
            <>
              Reach out to your program admin if you think this is a mistake. They can turn the
              account back on from Accounts.
            </>
          ) : roleless ? (
            <>Ask the program admin to set your role. This page opens your dashboard once they do.</>
          ) : (
            <>
              Check again once the program admin lets you in, and this page becomes your
              dashboard. Everything stays locked until then.
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
        <Button
          variant="ghost"
          size="md"
          full
          onClick={signOut}
          className="!text-destructive-600 hover:!bg-destructive-50 dark:!text-destructive-400 dark:hover:!bg-destructive-500/10"
        >
          Sign out
        </Button>
      </div>
    </AuthLayout>
  )
}
