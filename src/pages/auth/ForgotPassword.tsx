import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Field, Input } from '../../components/ui/Field'
import { Alert } from '../../components/ui/Alert'
import { useAuth } from '../../context/AuthContext'
import { authErrorMessage } from '../../lib/authError'
import { useCooldown } from '../../components/auth/useCooldown'

export default function ForgotPassword() {
  const { sendPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cooldown = useCooldown('passwordReset', email)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await sendPasswordReset(email)
      setSent(true)
      cooldown.refresh()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not send the reset link.'))
      cooldown.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      kicker="Account recovery"
      title="Reset your password"
      subtitle="We'll email you a link that signs you in and lets you set a new one."
      footer={
        <Link to="/login" className="font-semibold text-ink hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="space-y-4">
          <Alert tone="success">
            If an account exists for <strong>{email}</strong>, a reset link is on its way. The
            link expires in one hour.
          </Alert>
          <p className="text-[13.5px] leading-relaxed text-muted">
            Nothing in your inbox after a minute? Check spam, then try again — the address has
            to match the one you registered with.
          </p>
          <Button variant="outline" size="lg" full className="!rounded-xl" onClick={() => setSent(false)}>
            Use a different email
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Email">
            {(id) => (
              <Input
                id={id}
                type="email"
                icon="mail"
                required
                autoComplete="email"
                placeholder="you@school.edu.ph"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          {cooldown.blocked && (
            <Alert tone="error">
              A link has already gone out to this address. Wait {cooldown.label} before asking for
              another — check spam in the meantime.
            </Alert>
          )}

          <Button
            type="submit"
            variant="accent"
            size="lg"
            full
            loading={busy}
            disabled={cooldown.blocked}
            className="!rounded-xl"
          >
            Email me a reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
