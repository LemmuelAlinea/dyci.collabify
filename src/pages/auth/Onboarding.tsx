import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Button } from '../../components/ui/Button'
import { Field, Input } from '../../components/ui/Field'
import { Alert } from '../../components/ui/Alert'
import { RoleChoice } from '../../components/ui/RoleChoice'
import { useAuth } from '../../context/AuthContext'
import { authErrorMessage } from '../../lib/authError'
import { roleHome } from '../../lib/roleHome'
import type { Role } from '../../lib/types'

/** Google sign-in carries no role, so first-time OAuth users finish their profile here. */
export default function Onboarding() {
  const { ready, session, profile, user, completeOnboarding } = useAuth()
  const navigate = useNavigate()

  const meta = user?.user_metadata ?? {}
  const guessed = String(meta.full_name ?? meta.name ?? '').trim().split(/\s+/)

  const [role, setRole] = useState<Exclude<Role, 'admin'>>('student')
  const [firstName, setFirstName] = useState(guessed[0] ?? '')
  const [middleName, setMiddleName] = useState('')
  const [lastName, setLastName] = useState(guessed.length > 1 ? guessed[guessed.length - 1] : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (ready && !session) return <Navigate to="/login" replace />
  if (ready && profile) return <Navigate to={roleHome(profile.role, profile.status)} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await completeOnboarding({ firstName, middleName, lastName, role })
      navigate(role === 'professor' ? '/pending' : roleHome(role, 'active'), { replace: true })
    } catch (err) {
      setError(authErrorMessage(err, 'Could not finish setting up your account.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Finish your profile"
      subtitle="Two details and you're in. You can change these later in settings."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}

        <RoleChoice value={role} onChange={setRole} />

        {role === 'professor' && (
          <Alert tone="info">
            The program office reviews professor accounts before teaching tools unlock.
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            {(id) => (
              <Input
                id={id}
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Juan"
              />
            )}
          </Field>
          <Field label="Last name">
            {(id) => (
              <Input
                id={id}
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Dela Cruz"
              />
            )}
          </Field>
        </div>

        <Field label="Middle name" optional>
          {(id) => (
            <Input
              id={id}
              value={middleName}
              onChange={(e) => setMiddleName(e.target.value)}
              placeholder="Santos"
            />
          )}
        </Field>

        <Button type="submit" size="lg" full loading={busy} className="!rounded-xl">
          Enter Collabify
        </Button>
      </form>
    </AuthLayout>
  )
}
