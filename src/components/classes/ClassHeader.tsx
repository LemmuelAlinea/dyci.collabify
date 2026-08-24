import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import { Toggle } from '../ui/Field'
import { useToast } from '../ui/Toast'
import { classMeta } from '../../lib/types'
import type { ClassSummary } from '../../lib/types'

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

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(cls.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      show('Could not copy. Select the code and copy it manually.', 'error')
    }
  }

  return (
    <header>
      <Link
        to={backTo}
        className="inline-flex items-center gap-1.5 text-[13.5px] text-muted transition-colors hover:text-ink"
      >
        <Icon name="arrowLeft" size={16} />
        All classes
      </Link>

      <div className="relative mt-4 overflow-hidden rounded-panel bg-navy-600 p-4 sm:p-6 text-white md:p-8">
        <div aria-hidden className="blueprint absolute inset-0 opacity-60" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/12 font-display text-[17px] font-bold tracking-tight text-amber-400">
              {cls.initial}
            </span>
            <div className="min-w-0">
              {cls.archived_at && (
                <span className="mb-2 inline-block rounded-full bg-white/12 px-2.5 py-1 font-mono text-[9.5px] tracking-wider uppercase">
                  Archived
                </span>
              )}
              <h1 className="truncate text-[clamp(1.5rem,3vw,2.1rem)] leading-tight">{cls.name}</h1>
              <p className="mt-1.5 text-[13.5px] text-white/65">{classMeta(cls)}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={copyCode}
                  title="Copy class code"
                  className="inline-flex items-center gap-2 rounded-lg bg-navy-950/35 px-3 py-1.5 font-mono text-[13px] tracking-wide text-amber-300 transition-colors hover:bg-navy-950/55"
                >
                  {cls.code}
                  <Icon name={copied ? 'check' : 'copy'} size={14} />
                </button>
                <span className="flex items-center gap-1.5 text-[13px] text-white/65">
                  <Icon name="users" size={15} />
                  {cls.student_count} {cls.student_count === 1 ? 'student' : 'students'}
                </span>
              </div>
            </div>
          </div>

          {canManage && (
            <div className="flex flex-col items-start gap-4 sm:items-end">
              {actions}
              <label className="flex items-center gap-3 text-[13px] text-white/75">
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
