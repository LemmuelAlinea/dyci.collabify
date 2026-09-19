import { Link, Navigate } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { homeFor } from '../../lib/workplace'

export default function Pending() {
  const { ready, session, profile, signOut, refreshProfile } = useAuth()

  if (ready && !session) return <Navigate to="/login" replace />
  if (ready && profile && profile.status === 'active')
    return <Navigate to={homeFor(profile)} replace />

  const rejected = profile?.status === 'rejected'

  return (
    <AuthLayout
      title={rejected ? 'Account not active' : 'Waiting on approval'}
      subtitle={
        rejected
          ? 'The program admin has not approved this account, or has deactivated it.'
          : 'Your professor account is with the program admin.'
      }
    >
      <div className="space-y-5">
        <Alert tone={rejected ? 'error' : 'info'}>
          {rejected ? (
            <>
              Reach out to your program admin if you think this is a mistake. They can approve
              the account from the admin console.
            </>
          ) : (
            <>
              Sign in again to check — the moment the program office approves you, this
              page becomes your dashboard. Teaching tools stay locked until then, which is
              what keeps a class visible only to the faculty who run it.
            </>
          )}
        </Alert>

        <div className="card p-4 sm:p-5">
          <p className="eyebrow text-faint">Signed in as</p>
          <p className="mt-2 text-[14px] font-medium text-ink">{profile?.email ?? '—'}</p>
          <p className="mt-1 text-[13px] text-muted">
            Status: {rejected ? 'Not active' : 'Pending review'}
          </p>
        </div>

        {!rejected && (
          <Button variant="outline" size="lg" full className="!rounded-xl" onClick={refreshProfile}>
            Check again
          </Button>
        )}
        {!rejected && (
          <Link
            to="/general"
            className="block rounded-xl border border-line px-4 py-3 text-center text-[14px] font-medium text-ink transition-colors hover:bg-[var(--surface-sunken)]"
          >
            Use the General workplace while you wait
          </Link>
        )}
        <Button variant="ghost" size="md" full onClick={signOut}>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  )
}
