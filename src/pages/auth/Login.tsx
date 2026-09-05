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

export default function Login() {
  const { signInWithEmail, signInWithGoogle, configured } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signInWithEmail(email, password)
      navigate('/auth/callback', { replace: true })
    } catch (err) {
      setError(authErrorMessage(err, 'Could not sign you in.'))
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

        <Button type="submit" size="lg" full loading={busy} className="!rounded-xl">
          Sign in
        </Button>
      </form>

      <OrDivider />
      <GoogleButton onClick={onGoogle} loading={googleBusy} />
    </AuthLayout>
  )
}
