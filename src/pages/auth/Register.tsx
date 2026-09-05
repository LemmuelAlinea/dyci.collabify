import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout, OrDivider } from '../../components/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Field, Input, PasswordInput } from '../../components/ui/Field'
import { Alert } from '../../components/ui/Alert'
import { GoogleButton } from '../../components/ui/GoogleButton'
import { RoleChoice } from '../../components/ui/RoleChoice'
import { useAuth } from '../../context/AuthContext'
import { authErrorMessage } from '../../lib/authError'
import { useCooldown } from '../../components/auth/useCooldown'
import type { Role } from '../../lib/types'

export default function Register() {
  const { signUpWithEmail, signInWithGoogle, configured } = useAuth()
  const navigate = useNavigate()

  const [role, setRole] = useState<Exclude<Role, 'admin'>>('student')
  const [firstName, setFirstName] = useState('')
  const [middleName, setMiddleName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const cooldown = useCooldown('signUp', email)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.')
      return
    }
    setBusy(true)
    try {
      const { needsConfirmation } = await signUpWithEmail({
        firstName,
        middleName,
        lastName,
        email,
        password,
        role,
      })
      if (needsConfirmation) {
        navigate(`/check-email?email=${encodeURIComponent(email.trim())}`, { replace: true })
      } else {
        navigate('/auth/callback', { replace: true })
      }
    } catch (err) {
      setError(authErrorMessage(err, 'Could not create your account.'))
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
      kicker="Get started"
      title="Create your account"
      subtitle="Set up your workspace for this semester."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-ink hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {!configured && (
          <Alert tone="info">
            Supabase is not connected yet, so registration is disabled. Add your keys to{' '}
            <code className="font-mono text-[12.5px]">.env.local</code>.
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}

        <RoleChoice value={role} onChange={setRole} />

        {role === 'professor' && (
          <Alert tone="info">
            Professor accounts are reviewed by the program office. You can sign in straight
            away; teaching tools open once you are approved.
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            {(id) => (
              <Input
                id={id}
                required
                autoComplete="given-name"
                placeholder="Juan"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Last name">
            {(id) => (
              <Input
                id={id}
                required
                autoComplete="family-name"
                placeholder="Dela Cruz"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Middle name" optional>
          {(id) => (
            <Input
              id={id}
              autoComplete="additional-name"
              placeholder="Santos"
              value={middleName}
              onChange={(e) => setMiddleName(e.target.value)}
            />
          )}
        </Field>

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

        <Field label="Password">
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

        {cooldown.blocked && (
          <Alert tone="error">
            Too many sign-up attempts for this email. Try again in {cooldown.label}, or sign in if
            the account already exists.
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
          Create account
        </Button>

        <p className="text-center text-[12.5px] leading-relaxed text-faint">
          We'll email a confirmation link before your first sign-in.
        </p>
      </form>

      <OrDivider />
      <GoogleButton onClick={onGoogle} loading={googleBusy} label="Sign up with Google" />
    </AuthLayout>
  )
}
