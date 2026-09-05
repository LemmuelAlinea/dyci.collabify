import { LogoMark } from '../components/brand/Logo'
import { ButtonLink } from '../components/ui/Button'

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="max-w-[420px]">
        <LogoMark size={48} />
        <p className="eyebrow mt-6 text-faint">Error 404</p>
        <h1 className="mt-3 text-[clamp(1.9rem,4vw,2.6rem)]">This page isn't here</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-muted">
          The link may be out of date, or the page moved during a release.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <ButtonLink to="/" size="md">
            Back to home
          </ButtonLink>
          <ButtonLink to="/login" variant="outline" size="md">
            Sign in
          </ButtonLink>
        </div>
      </div>
    </div>
  )
}
