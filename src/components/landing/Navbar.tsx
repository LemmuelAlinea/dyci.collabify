import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { useActiveSection } from './useLoop'
import { Logo } from '../brand/Logo'
import { ButtonLink } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { ThemeToggle } from '../ThemeToggle'

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#features', label: 'What is inside' },
  { href: '#roles', label: 'For roles' },
]

/** Module-level so the hook's effect is not re-subscribed on every render. */
const SECTION_IDS = LINKS.map((l) => l.href.slice(1))

export function Navbar() {
  const [stuck, setStuck] = useState(false)
  const [open, setOpen] = useState(false)
  const active = useActiveSection(SECTION_IDS)

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 text-white transition-[background-color,box-shadow,backdrop-filter] duration-400 ${
        stuck
          ? 'bg-navy-950/85 shadow-[0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl'
          : 'bg-transparent'
      }`}
    >
      <nav className="shell flex h-[74px] items-center justify-between gap-6">
        <Link to="/" className="shrink-0" aria-label="Collabify home">
          <Logo tone="onDark" subtitle="Project workspace" />
        </Link>

        {/* The pill is one element that moves between the links, not three
            that fade — so it reads as the page telling you where you are
            rather than each link lighting up on its own. */}
        <div className="hidden items-center gap-1 lg:flex">
          {LINKS.map((l) => {
            const on = active === l.href.slice(1)
            return (
              <a
                key={l.href}
                href={l.href}
                aria-current={on ? 'true' : undefined}
                className={`relative rounded-full px-4 py-2 text-[14.5px] transition-colors duration-200 hover:text-white ${
                  on ? 'text-white' : 'text-white/72'
                }`}
              >
                {on && (
                  <motion.span
                    layoutId="nav-here"
                    aria-hidden
                    className="absolute inset-0 -z-10 rounded-full bg-white/12"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
                {l.label}
              </a>
            )
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <ThemeToggle tone="onNavy" />
          {/* Wrapped rather than given `hidden` directly: Button's base class
              already sets `inline-flex`, and two display utilities are decided
              by their order in Tailwind's output, not by the order they are
              written in. `hidden` lost, so on a 360px phone this button stayed
              on screen and pushed the menu icon past the right edge where it
              could not be tapped at all. */}
          <span className="hidden sm:contents">
            <Link
              to="/login"
              className="rounded-full px-4 py-2 text-[14.5px] font-medium text-white/85 transition-colors hover:text-white"
            >
              Sign in
            </Link>
            <ButtonLink to="/register" variant="accent" size="sm">
              Get started
            </ButtonLink>
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="grid h-10 w-10 place-items-center rounded-full text-white/80 hover:bg-white/10 lg:hidden"
          >
            <Icon name="menu" size={20} />
          </button>
        </div>
      </nav>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-navy-950/70 backdrop-blur-sm"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-3 top-3 rounded-3xl bg-navy-900 p-4 sm:p-5 shadow-2xl ring-1 ring-white/10">
            <div className="flex items-center justify-between">
              <Logo tone="onDark" showSubtitle={false} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="grid h-10 w-10 place-items-center rounded-full text-white/70 hover:bg-white/10"
              >
                <Icon name="x" size={20} />
              </button>
            </div>
            <div className="mt-5 space-y-1">
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between rounded-xl px-4 py-3.5 text-[15px] text-white/85 hover:bg-white/8"
                >
                  {l.label}
                  <Icon name="chevronRight" size={17} className="text-white/40" />
                </a>
              ))}
            </div>
            <div className="mt-5 grid gap-2.5">
              <ButtonLink to="/register" variant="accent" size="md" full>
                Get started
              </ButtonLink>
              <ButtonLink to="/login" variant="onNavy" size="md" full>
                Sign in
              </ButtonLink>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
