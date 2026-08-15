import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Alert, Field, Input } from '../../components/ui/Field'
import { useAuth } from '../../context/AuthContext'
import { authErrorMessage } from '../../lib/authError'

export default function ForgotPassword() {
  const { sendPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await sendPasswordReset(email)
      setSent(true)
    } catch (err) {
      setError(authErrorMessage(err, 'Could not send the reset link.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
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
          <Button type="submit" size="lg" full loading={busy} className="!rounded-xl">
            Email me a reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
