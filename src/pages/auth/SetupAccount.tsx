import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { ConsentChecks } from '../../components/legal/ConsentChecks'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Field, PasswordInput } from '../../components/ui/Field'
import { useAuth } from '../../context/AuthContext'
import { completeBulkRegistration } from '../../lib/api/accounts'
import { recordAllConsent } from '../../lib/api/consent'
import { authErrorMessage } from '../../lib/authError'
import { allConsented, emptyConsent } from '../../lib/legal'
import type { ConsentState } from '../../lib/legal'
import { paths } from '../../lib/paths'
import { homeFor } from '../../lib/access'

export default function SetupAccount() {
  const { ready, session, profile, refreshProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [consent, setConsent] = useState<ConsentState>(emptyConsent)
  const [showConsentErrors, setShowConsentErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (ready && !session) return <Navigate to="/login" replace />
  if (ready && !profile) return <Navigate to="/onboarding" replace />
  if (ready && profile?.status === 'rejected') return <Navigate to="/pending" replace />
  if (ready && profile && (!profile.bulk_setup_required || profile.status !== 'pending')) {
    return <Navigate to={homeFor(profile)} replace />
  }

  async function finish(changePassword: boolean) {
    setError(null)
    if (!allConsented(consent)) {
      setShowConsentErrors(true)
      return
    }
    if (changePassword && (password.length < 8 || password.length > 128)) {
      setError('Use 8 to 128 characters for the new password.')
      return
    }
    if (changePassword && password !== confirm) {
      setError('Those two passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await recordAllConsent('onboarding')
      await completeBulkRegistration(changePassword ? { newPassword: password } : { deferPasswordChange: true })
      setPassword('')
      setConfirm('')
      await refreshProfile()
      navigate(paths.home, { replace: true })
    } catch (err) {
      setError(authErrorMessage(err, 'Could not finish setting up your account. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void finish(true)
  }

  return (
    <AuthLayout
      title="Finish your account"
      subtitle="Accept the terms and privacy policy, then change your temporary password now or later in Settings."
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-[13px] text-muted">Signed in as {profile?.email}</p>
        <ConsentChecks value={consent} onChange={setConsent} showErrors={showConsentErrors} disabled={busy} />
        <Field label="New password">
          {(id) => <PasswordInput id={id} minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
        </Field>
        <Field label="Confirm new password">
          {(id) => <PasswordInput id={id} minLength={8} maxLength={128} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />}
        </Field>
        <Button type="submit" size="lg" full loading={busy}>Change password and continue</Button>
        <Button type="button" variant="outline" full disabled={busy} onClick={() => void finish(false)}>Change password later</Button>
        <p className="text-[12px] text-muted">Your temporary password will keep working until you change it in Settings → Security.</p>
        <Button type="button" variant="ghost" full disabled={busy} onClick={() => void signOut()}>Sign out</Button>
      </form>
    </AuthLayout>
  )
}
