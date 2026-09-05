import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Field, PasswordInput } from '../../components/ui/Field'
import { Alert } from '../../components/ui/Alert'
import { useAuth } from '../../context/AuthContext'
import { authErrorMessage } from '../../lib/authError'
import { supabase } from '../../lib/supabase'

export default function ResetPassword() {
  const { updatePassword } = useAuth()
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [hasRecovery, setHasRecovery] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // The recovery link puts a session in the URL; detectSessionInUrl consumes it.
    supabase.auth.getSession().then(({ data }) => {
      setHasRecovery(Boolean(data.session))
      setChecking(false)
    })
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Those two passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await updatePassword(password)
      navigate('/auth/callback', { replace: true })
    } catch (err) {
      setError(authErrorMessage(err, 'Could not update your password.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Choose something you haven't used on this account before."
      footer={
        <Link to="/login" className="font-semibold text-ink hover:underline">
          Back to sign in
        </Link>
      }
    >
      {checking ? (
        <p className="text-[14px] text-muted">Checking your link…</p>
      ) : !hasRecovery ? (
        <div className="space-y-4">
          <Alert tone="error">
            This reset link is expired or already used. Request a fresh one — links are good
            for one hour.
          </Alert>
          <Button size="lg" full className="!rounded-xl" onClick={() => navigate('/forgot-password')}>
            Send a new link
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="New password">
            {(id) => (
              <PasswordInput
                id={id}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Field label="Confirm new password">
            {(id) => (
              <PasswordInput
                id={id}
                required
                autoComplete="new-password"
                placeholder="Type it again"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" size="lg" full loading={busy} className="!rounded-xl">
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
