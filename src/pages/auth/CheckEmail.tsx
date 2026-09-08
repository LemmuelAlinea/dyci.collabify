import { Link, useSearchParams } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Alert } from '../../components/ui/Alert'
import { ButtonLink } from '../../components/ui/Button'

export default function CheckEmail() {
  const [params] = useSearchParams()
  const email = params.get('email')

  return (
    <AuthLayout
      title="Confirm your email"
      subtitle="One link stands between you and your workspace."
      footer={
        <Link to="/login" className="font-semibold text-ink hover:underline">
          Back to sign in
        </Link>
      }
    >
      <div className="space-y-5">
        <Alert tone="success">
          If{email ? ' ' : ''}
          {email && <strong>{email}</strong>} is not already registered, a confirmation link is on
          its way. Open it to activate your account.
        </Alert>
        <ol className="space-y-3 text-[14px] leading-relaxed text-muted">
          <li className="flex gap-3">
            <span className="font-mono text-[12px] font-bold text-amber-500">01</span>
            Open the email from Collabify and tap <strong className="text-ink">Confirm my email</strong>.
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-[12px] font-bold text-amber-500">02</span>
            You'll land back here, already signed in.
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-[12px] font-bold text-amber-500">03</span>
            Not there? Check spam — the sender is your school's Collabify address.
          </li>
          {/*
            The signup form sends an address that already has an account to
            this same screen, deliberately, so it cannot be used to find out
            who holds one. That leaves somebody who had simply forgotten
            waiting for an email nobody sent, so the way out is spelled out
            here rather than left to be worked out.
          */}
          <li className="flex gap-3">
            <span className="font-mono text-[12px] font-bold text-amber-500">04</span>
            Nothing arrives and you think you already had an account?{' '}
            <span>
              <Link to="/login" className="font-semibold text-ink hover:underline">
                Sign in
              </Link>{' '}
              or{' '}
              <Link to="/forgot-password" className="font-semibold text-ink hover:underline">
                reset your password
              </Link>
              .
            </span>
          </li>
        </ol>
        <ButtonLink to="/login" variant="outline" size="lg" full className="!rounded-xl">
          I've confirmed — sign in
        </ButtonLink>
      </div>
    </AuthLayout>
  )
}
