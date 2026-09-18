import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout, OrDivider } from '../../components/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Field, Input, PasswordInput } from '../../components/ui/Field'
import { Alert } from '../../components/ui/Alert'
import { GoogleButton } from '../../components/ui/GoogleButton'
import { RoleChoice } from '../../components/ui/RoleChoice'
import { WorkplaceChoice } from '../../components/auth/WorkplaceChoice'
import { ConsentChecks } from '../../components/legal/ConsentChecks'
import { allConsented, emptyConsent } from '../../lib/legal'
import type { ConsentState } from '../../lib/legal'
import { useAuth } from '../../context/AuthContext'
import { authErrorMessage, isAlreadyRegistered } from '../../lib/authError'
import { useCooldown } from '../../components/auth/useCooldown'
import { LIMIT } from '../../lib/limits'
import type { Role } from '../../lib/types'
import type { Workplace } from '../../lib/workplace'

export default function Register() {
  const { signUpWithEmail, signInWithGoogle, configured } = useAuth()
  const navigate = useNavigate()

  const [role, setRole] = useState<Exclude<Role, 'admin'>>('student')
  const [workplace, setWorkplace] = useState<Workplace>('education')
  const [firstName, setFirstName] = useState('')
  const [middleName, setMiddleName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [consent, setConsent] = useState<ConsentState>(emptyConsent)
  const [showConsentErrors, setShowConsentErrors] = useState(false)
  const cooldown = useCooldown('signUp', email)
  const consented = allConsented(consent)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    // Before the password check: an unticked box is the more likely reason the
    // form did not go through, and reporting the password first would send
    // somebody to fix the thing that was already fine.
    if (!consented) {
      setShowConsentErrors(true)
      return
    }
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
        workplace,
        role: workplace === 'education' ? role : null,
      })
      if (needsConfirmation) {
        navigate(`/check-email?email=${encodeURIComponent(email.trim())}`, { replace: true })
      } else {
        navigate('/auth/callback', { replace: true })
      }
    } catch (err) {
      /**
       * An email that already has an account goes to the same screen as a new
       * one, and the screen says nothing about which happened.
       *
       * The alternative reply — "that email already has an account" — is an
       * oracle: anybody could put an address in this form and learn whether
       * the person holds one. That is worth closing even though the roster is
       * hardly secret, because the answer also confirms the address is live.
       *
       * The cost is real and is paid on the CheckEmail screen, which now
       * covers both outcomes and points somebody who already has an account at
       * sign-in and password reset.
       */
      if (isAlreadyRegistered(err)) {
        navigate(`/check-email?email=${encodeURIComponent(email.trim())}`, { replace: true })
        return
      }
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
      variant="register"
      compact
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
      <form onSubmit={onSubmit} className="space-y-3">
        {!configured && (
          <Alert tone="info">
            Supabase is not connected yet, so registration is disabled. Add your keys to{' '}
            <code className="font-mono text-[12px]">.env.local</code>.
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}

        <WorkplaceChoice value={workplace} onChange={setWorkplace} />

        {workplace === 'education' ? (
          <>
            <RoleChoice value={role} onChange={setRole} />
            {role === 'professor' && (
              <Alert tone="info">
                Professor accounts are reviewed by the program office. You can sign in straight
                away; teaching tools open once you are approved.
              </Alert>
            )}
          </>
        ) : (
          <Alert tone="info">
            General opens straight away. You see a project once somebody invites you or you
            create one, and you can open Education later from the top bar.
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            {(id) => (
              <Input
                id={id}
                required
                autoComplete="given-name"
                maxLength={LIMIT.firstName}
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
                maxLength={LIMIT.lastName}
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
              maxLength={LIMIT.middleName}
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
              maxLength={LIMIT.email}
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

        <ConsentChecks
          value={consent}
          onChange={setConsent}
          showErrors={showConsentErrors}
          disabled={busy}
        />

        {cooldown.blocked && (
          <Alert tone="error">
            Too many sign-up attempts for this email. Try again in {cooldown.label}, or sign in if
            the account already exists.
          </Alert>
        )}

        {/* The button stays enabled while a box is unticked, deliberately. A
            disabled button explains nothing and leaves somebody clicking a
            dead control; submitting shows exactly which box is missing and
            why. Disabled is right for the cooldown, where the reason is
            already on screen above it. */}
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

        <p className="text-center text-[12px] leading-relaxed text-faint">
          We'll email a confirmation link before your first sign-in.
        </p>
      </form>

      <OrDivider compact />
      <GoogleButton onClick={onGoogle} loading={googleBusy} label="Sign up with Google" />
    </AuthLayout>
  )
}
