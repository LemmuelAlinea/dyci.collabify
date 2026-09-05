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
          We sent a confirmation link{email ? ' to ' : ''}
          {email && <strong>{email}</strong>}. Open it to activate your account.
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
        </ol>
        <ButtonLink to="/login" variant="outline" size="lg" full className="!rounded-xl">
          I've confirmed — sign in
        </ButtonLink>
      </div>
    </AuthLayout>
  )
}
