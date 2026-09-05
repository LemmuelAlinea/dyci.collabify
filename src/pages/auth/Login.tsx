import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout, OrDivider } from '../../components/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Field, Input, PasswordInput } from '../../components/ui/Field'
import { Alert } from '../../components/ui/Alert'
import { GoogleButton } from '../../components/ui/GoogleButton'
import { useAuth } from '../../context/AuthContext'
import { authErrorMessage } from '../../lib/authError'
import { useCooldown } from '../../components/auth/useCooldown'
import { attemptsLeft } from '../../lib/rateLimit'

export default function Login() {
  const { signInWithEmail, signInWithGoogle, configured } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const cooldown = useCooldown('signIn', email)
  const left = attemptsLeft('signIn', email)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signInWithEmail(email, password)
      navigate('/auth/callback', { replace: true })
    } catch (err) {
      setError(authErrorMessage(err, 'Could not sign you in.'))
      cooldown.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function onGoogle() {
    setError(null)
    setGoogleBusy(true)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(authErrorMessage(err, 'Could not reach Google.'))
      setGoogleBusy(false)
    }
  }

  return (
    <AuthLayout
      kicker="Welcome back"
      title="Sign in"
      subtitle="Pick up where your group left off."
      footer={
        <>
          Don't have an account?{' '}
          <Link to="/register" className="font-semibold text-ink hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {!configured && (
          <Alert tone="info">
            Supabase is not connected yet, so sign-in is disabled. Add your keys to{' '}
            <code className="font-mono text-[12.5px]">.env.local</code>.
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Email">
          {(id) => (
            <Input
              id={id}
              type="email"
              icon="mail"
              autoComplete="email"
              required
              placeholder="you@school.edu.ph"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>

        <Field
          label="Password"
          hint={
            <Link
              to="/forgot-password"
              className="text-[13px] font-medium text-navy-600 hover:underline dark:text-navy-200"
            >
              Forgot password?
            </Link>
          }
        >
          {(id) => (
            <PasswordInput
              id={id}
              autoComplete="current-password"
              required
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>

        {cooldown.blocked && (
          <Alert tone="error">
            Too many failed sign-ins for this email. Try again in {cooldown.label}, or reset your
            password.
          </Alert>
        )}
        {!cooldown.blocked && left > 0 && left <= 2 && (
          <p className="text-[13px] leading-relaxed text-muted">
            {left === 1 ? 'One more attempt' : `${left} more attempts`} before this email is paused
            for a few minutes.
          </p>
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
          Sign in
        </Button>
      </form>

      <OrDivider />
      <GoogleButton onClick={onGoogle} loading={googleBusy} />
    </AuthLayout>
  )
}
