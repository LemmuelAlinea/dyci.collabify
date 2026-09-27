import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { Toggle } from '../ui/Field'
import { useToast } from '../ui/Toast'
import { classMeta, fullName } from '../../lib/types'
import type { ClassSummary } from '../../lib/types'
import { inviteLink } from '../../lib/pendingJoin'

export function ClassHeader({
  cls,
  backTo,
  canManage,
  onToggleJoin,
  actions,
}: {
  cls: ClassSummary
  backTo: string
  canManage: boolean
  onToggleJoin?: (open: boolean) => Promise<void>
  actions?: React.ReactNode
}) {
  const { show } = useToast()
  const [copied, setCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(cls.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      show('Could not copy. Select the code and copy it manually.', 'error')
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink(cls.code, window.location.origin))
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1800)
    } catch {
      show('Could not copy. Share the class code instead.', 'error')
    }
  }

  return (
    <header>
      <Link
        to={backTo}
        className="inline-flex items-center gap-2 text-[13px] font-medium text-muted transition-colors hover:text-ink"
      >
        <Icon name="arrowLeft" size={16} />
        All classes
      </Link>

      <div className="relative mt-4 overflow-hidden rounded-panel border border-banner-ink/10 bg-banner px-5 py-6 text-banner-ink sm:px-7 sm:py-8 lg:px-9">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-48 -right-40 h-[420px] w-[420px] rounded-full bg-banner-glow/10 blur-[115px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'linear-gradient(color-mix(in oklab, var(--banner-ink) 5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--banner-ink) 5%, transparent) 1px, transparent 1px)',
            backgroundSize: '54px 54px',
            maskImage: 'linear-gradient(90deg, #000 10%, transparent 85%)',
            WebkitMaskImage: 'linear-gradient(90deg, #000 10%, transparent 85%)',
          }}
        />

        <div className="relative">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-[11px] tracking-[0.2em] text-banner-accent-soft/70 uppercase">
                Class workspace
              </span>
              {cls.archived_at ? (
                <span className="rounded-full bg-banner-ink/10 px-2.5 py-1 text-[11px] font-medium text-banner-ink/70">
                  Archived
                </span>
              ) : (
                <span className="rounded-full bg-success-400/12 px-2.5 py-1 text-[11px] font-medium text-success-200">
                  Active term
                </span>
              )}
            </div>
            {canManage && actions}
          </div>

          <div className="mt-6 grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.7fr)] lg:items-end">
            <div className="flex min-w-0 items-start gap-4 sm:gap-5">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-banner-ink/8 font-display text-[16px] font-bold text-banner-accent ring-1 ring-banner-ink/12 sm:h-16 sm:w-16 sm:text-[18px]">
                {cls.initial}
              </span>
              <div className="min-w-0">
                <h1 className="text-balance text-banner-ink">{cls.name}</h1>
                <p className="mt-2 text-[13px] text-banner-ink/55">{classMeta(cls)}</p>
                <p className="mt-3 max-w-[62ch] text-[13px] leading-relaxed text-banner-ink/55">
                  {cls.description ||
                    (canManage
                      ? 'Manage the people, projects, materials and decisions that move this class through the term.'
                      : cls.professor
                        ? `Led by ${fullName(cls.professor)}. Announcements, projects and group work stay together here.`
                        : 'Announcements, projects and group work stay together here.')}
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-banner-ink/12 bg-banner-ink/12">
              <div className="bg-banner/85 px-4 py-3.5">
                <dt className="text-[11px] text-banner-ink/45">Class code</dt>
                <dd className="mt-1.5">
                  <button
                    type="button"
                    onClick={copyCode}
                    title="Copy class code"
                    className="inline-flex items-center gap-2 font-mono text-[15px] font-bold tracking-wide text-banner-accent transition-colors hover:text-banner-accent-soft"
                  >
                    {cls.code}
                    <Icon name={copied ? 'check' : 'copy'} size={14} />
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      onClick={copyLink}
                      className="mt-1.5 flex items-center gap-1.5 text-[12px] text-banner-ink/60 transition-colors hover:text-banner-ink"
                    >
                      <Icon name={linkCopied ? 'check' : 'copy'} size={13} />
                      {linkCopied ? 'Invite link copied' : 'Copy invite link'}
                    </button>
                  )}
                </dd>
              </div>
              <div className="bg-banner/85 px-4 py-3.5">
                <dt className="text-[11px] text-banner-ink/45">Roster</dt>
                <dd className="mt-1.5 flex items-center gap-2 font-mono text-[15px] font-bold text-banner-ink">
                  <Icon name="users" size={15} className="text-banner-ink/45" />
                  {cls.student_count}
                  {cls.student_cap ? ` of ${cls.student_cap}` : ''}{' '}
                  {(cls.student_cap ?? cls.student_count) === 1 ? 'student' : 'students'}
                </dd>
              </div>
            </dl>
          </div>

          {canManage && (
            <div className="mt-6 flex justify-end border-t border-banner-ink/10 pt-4">
              <label className="flex items-center gap-3 text-[12px] text-banner-ink/65">
                <Toggle
                  label="Allow students to join"
                  checked={cls.join_open}
                  disabled={Boolean(cls.archived_at)}
                  onChange={(next) => void onToggleJoin?.(next)}
                />
                {cls.join_open ? 'Joining open' : 'Joining closed'}
              </label>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
