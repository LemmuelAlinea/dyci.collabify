import { ButtonLink } from '../ui/Button'
import { Icon } from '../ui/Icon'
import type { IconName } from '../ui/Icon'
import { BoardPreview } from './BoardPreview'
import { Rise, WordReveal } from './Anim'

/**
 * Three things that are true at sign-up. "Email confirmation" used to be here
 * and is not: no mail is sent yet, and a landing page is the worst place to
 * promise one.
 */
const TRUST: { icon: IconName; label: string }[] = [
  { icon: 'checkCircle', label: 'Google sign-in' },
  { icon: 'shield', label: 'Professors approved by the program' },
  { icon: 'lock', label: 'A class is private to the people in it' },
]

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-navy-600 text-white">
      {/* Depth: a wide radial lift behind the copy, then the blueprint rule on top. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 18% 8%, #33429B 0%, #26327A 42%, #161D4A 100%)',
        }}
      />
      <div aria-hidden className="blueprint absolute inset-0 opacity-70" />
      <div
        aria-hidden
        className="absolute -top-40 -right-32 h-[560px] w-[560px] rounded-full opacity-25 blur-3xl"
        style={{ background: 'radial-gradient(circle, #F0B429 0%, transparent 62%)' }}
      />

      <div className="shell relative pt-[124px] pb-20 md:pt-[150px] md:pb-28 lg:pt-[168px] lg:pb-32">
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)] lg:gap-16 xl:gap-20">
          <div className="max-w-[640px]">
            <Rise delay={0.02}>
              <span className="inline-flex items-center gap-2.5 rounded-full border border-white/18 bg-white/8 py-2 pr-4 pl-3 text-[13px] text-white/85 backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Dr. Yanga's Colleges · BSIT program
              </span>
            </Rise>

            {/* Set a word at a time rather than faded in as a block: the
                sentence is the page's whole argument, and watching it be built
                is the one place a heading earns motion. */}
            <WordReveal
              text="Where BSIT programs run the term."
              accent={['run', 'the', 'term']}
              delay={0.12}
              className="mt-6 text-[clamp(2.6rem,7.2vw,4.6rem)] leading-[0.98] font-extrabold text-balance"
            />

            <Rise as="p" delay={0.18} className="mt-6 max-w-[540px] text-[clamp(1rem,1.5vw,1.18rem)] leading-relaxed text-white/72">
              Projects, boards and deadlines for classes at Dr. Yanga's Colleges.
            </Rise>

            <Rise delay={0.26} className="mt-9 flex flex-wrap items-center gap-3">
              <ButtonLink to="/register" variant="accent" size="lg">
                Create your account
                <Icon name="arrowRight" size={18} />
              </ButtonLink>
              <a
                href="#how"
                className="inline-flex h-[52px] items-center rounded-full border border-white/25 px-7 text-[15.5px] font-medium text-white transition-colors duration-200 hover:bg-white/10"
              >
                See how it works
              </a>
            </Rise>

            <Rise as="ul" delay={0.34} className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
              {TRUST.map((t) => (
                <li key={t.label} className="flex items-center gap-2 text-[13.5px] text-white/60">
                  <Icon name={t.icon} size={16} className="text-amber-400" />
                  {t.label}
                </li>
              ))}
            </Rise>
          </div>

          <Rise delay={0.28} y={40} className="relative">
            <BoardPreview />
          </Rise>
        </div>
      </div>

      {/* Section seam: the hero sits on the page surface, not a hard edge. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-24"
        style={{
          background: 'linear-gradient(to bottom, transparent, rgb(0 0 0 / 0.18))',
        }}
      />
    </section>
  )
}
