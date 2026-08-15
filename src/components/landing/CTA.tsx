import { Reveal } from '../motion/Reveal'
import { ButtonLink } from '../ui/Button'
import { Icon } from '../ui/Icon'

export function CTA() {
  return (
    <section className="pb-24 md:pb-32">
      <div className="shell">
        <Reveal className="relative overflow-hidden rounded-panel bg-navy-600 px-7 py-16 text-center text-white md:px-16 md:py-20">
          <div aria-hidden className="blueprint absolute inset-0 opacity-60" />
          <div
            aria-hidden
            className="absolute -bottom-32 left-1/2 h-[420px] w-[620px] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
            style={{ background: 'radial-gradient(circle, #F0B429 0%, transparent 65%)' }}
          />
          <div className="relative mx-auto max-w-[620px]">
            <h2 className="text-[clamp(2rem,4.6vw,3.2rem)] leading-[1.03]">
              Start the semester <span className="text-amber-400">already organized</span>.
            </h2>
            <p className="mt-5 text-[17px] leading-relaxed text-white/70">
              Create your account, set up your group, and put the whole capstone on one board.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <ButtonLink to="/register" variant="accent" size="lg">
                Create your account
                <Icon name="arrowRight" size={18} />
              </ButtonLink>
              <ButtonLink to="/login" variant="onNavy" size="lg">
                I already have one
              </ButtonLink>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
