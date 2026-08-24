import { Navigate } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Alert } from '../../components/ui/Field'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { roleHome } from '../../lib/roleHome'

export default function Pending() {
  const { ready, session, profile, signOut, refreshProfile } = useAuth()

  if (ready && !session) return <Navigate to="/login" replace />
  if (ready && profile && profile.status === 'active')
    return <Navigate to={roleHome(profile.role, profile.status)} replace />

  const rejected = profile?.status === 'rejected'

  return (
    <AuthLayout
      title={rejected ? 'Account not approved' : 'Waiting on approval'}
      subtitle={
        rejected
          ? 'The program admin did not approve this professor account.'
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

        <div className="surface rounded-card border border-line p-4 sm:p-5">
          <p className="eyebrow text-faint">Signed in as</p>
          <p className="mt-2 text-[15px] font-medium text-ink">{profile?.email ?? '—'}</p>
          <p className="mt-1 text-[13.5px] text-muted">
            Status: {rejected ? 'Not approved' : 'Pending review'}
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
