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
    // Sized by its own width, not the window's: beside the rail a laptop
    // window leaves the banner ~870px, and a viewport breakpoint split that
    // into two columns that wrapped the class name four lines deep. Two
    // columns only once the banner itself has room (960px); below that it
    // stacks, with the code, roster and joining switch in one strip.
    <header className="@container">
      <Link
        to={backTo}
        className="inline-flex items-center gap-2 text-[13px] font-medium text-muted transition-colors hover:text-ink"
      >
        <Icon name="arrowLeft" size={16} />
        All classes
      </Link>

      <div className="relative mt-4 overflow-hidden rounded-panel border border-banner-ink/10 banner-fill px-5 py-5 text-banner-ink @min-[600px]:px-7 @min-[600px]:py-6 @min-[960px]:px-9 @min-[960px]:py-8">
        <div
          aria-hidden
          className="banner-deco pointer-events-none absolute -top-48 -right-40 h-[420px] w-[420px] rounded-full bg-banner-glow/10 blur-[115px]"
        />
        <div
          aria-hidden
          className="banner-deco pointer-events-none absolute inset-0 opacity-60"
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

          <div className="mt-4 grid gap-5 @min-[960px]:mt-6 @min-[960px]:grid-cols-[minmax(0,1fr)_minmax(360px,0.7fr)] @min-[960px]:items-end @min-[960px]:gap-7">
            <div className="flex min-w-0 items-start gap-4 @min-[960px]:gap-5">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-banner-ink/8 font-display text-[15px] font-bold text-banner-accent ring-1 ring-banner-ink/12 @min-[960px]:h-16 @min-[960px]:w-16 @min-[960px]:text-[18px]">
                {cls.initial}
              </span>
              <div className="min-w-0">
                <h1 className="text-balance text-banner-ink">{cls.name}</h1>
                <p className="mt-1.5 text-[13px] text-banner-ink/55 @min-[960px]:mt-2">{classMeta(cls)}</p>
                <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-banner-ink/55 @min-[960px]:mt-3">
                  {cls.description ||
                    (canManage
                      ? 'Manage the people, projects, materials and decisions that move this class through the term.'
                      : cls.professor
                        ? `Led by ${fullName(cls.professor)}. Announcements, projects and group work stay together here.`
                        : 'Announcements, projects and group work stay together here.')}
                </p>
              </div>
            </div>

            {/* The joining switch is a third cell rather than its own row under a
                divider: side by side while stacked, under the other two in the
                narrow right-hand column. */}
            <dl
              className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-banner-ink/12 bg-banner-ink/12 ${
                canManage ? '@min-[600px]:grid-cols-3 @min-[960px]:grid-cols-2' : ''
              }`}
            >
              <div className="banner-cell px-4 py-3 @min-[960px]:py-3.5">
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
              <div className="banner-cell px-4 py-3 @min-[960px]:py-3.5">
                <dt className="text-[11px] text-banner-ink/45">Roster</dt>
                <dd className="mt-1.5 flex items-center gap-2 font-mono text-[15px] font-bold text-banner-ink">
                  <Icon name="users" size={15} className="text-banner-ink/45" />
                  {cls.student_count}
                  {cls.student_cap ? ` of ${cls.student_cap}` : ''}{' '}
                  {(cls.student_cap ?? cls.student_count) === 1 ? 'student' : 'students'}
                </dd>
              </div>
              {canManage && (
                <div className="banner-cell col-span-2 px-4 py-3 @min-[600px]:col-span-1 @min-[960px]:col-span-2 @min-[960px]:py-3.5">
                  <dt className="text-[11px] text-banner-ink/45">Joining</dt>
                  <dd className="mt-1.5">
                    <label className="flex items-center gap-3 text-[13px] font-medium text-banner-ink">
                      <Toggle
                        label="Allow students to join"
                        checked={cls.join_open}
                        disabled={Boolean(cls.archived_at)}
                        onChange={(next) => void onToggleJoin?.(next)}
                      />
                      {cls.join_open ? 'Open to new students' : 'Closed'}
                    </label>
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </header>
  )
}
