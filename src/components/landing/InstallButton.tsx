import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../ui/Icon'
import { installRoute, useInstall } from '../../lib/install'
import type { InstallRoute } from '../../lib/install'

const SITE = 'https://dyci-collabify.vercel.app'

/** What to do on each kind of device when the browser has no prompt to hand over. */
const STEPS: Record<Exclude<InstallRoute, 'installed' | 'prompt'>, { title: string; steps: ReactNode[]; note?: string }> = {
  ios: {
    title: 'Add Collabify to your Home Screen',
    steps: [
      <>
        Open this page in <b>Safari</b>.
      </>,
      <>
        Tap <b>Share</b>, the square with an arrow, in the toolbar.
      </>,
      <>
        Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.
      </>,
    ],
    note: 'Collabify then opens from your Home Screen like any app, and can send you notifications.',
  },
  android: {
    title: 'Install Collabify on your phone',
    steps: [
      <>
        Open this page in <b>Chrome</b>.
      </>,
      <>
        Tap the <b>⋮</b> menu at the top right.
      </>,
      <>
        Tap <b>Install app</b> or <b>Add to Home screen</b>, then <b>Install</b>.
      </>,
    ],
    note: 'If neither shows, stay on this page for half a minute, tap anywhere on it, then open the menu again.',
  },
  desktop: {
    title: 'Install Collabify on this computer',
    steps: [
      <>
        In <b>Chrome</b> or <b>Edge</b>, select the install icon at the right end of the address bar.
      </>,
      <>
        No icon? Open the browser menu and choose <b>Install Collabify</b> (in Chrome, under{' '}
        <b>Cast, save and share</b>; in Edge, under <b>Apps</b>).
      </>,
      <>
        On a Mac in Safari, choose <b>File</b>, then <b>Add to Dock</b>.
      </>,
    ],
  },
  'in-app': {
    title: 'Open Collabify in your browser first',
    steps: [
      <>This page is open inside another app, such as Messenger or Facebook, which cannot install apps.</>,
      <>
        Tap the <b>⋯</b> or <b>⋮</b> menu and choose <b>Open in browser</b> (or <b>Open in Chrome</b> or{' '}
        <b>Open in Safari</b>).
      </>,
      <>Then tap Download the app again.</>,
    ],
  },
  unsupported: {
    title: 'Use another browser to install',
    steps: [
      <>This browser cannot install web apps.</>,
      <>
        Open <b>{SITE.replace('https://', '')}</b> in <b>Chrome</b>, <b>Edge</b> or <b>Safari</b>, then tap Download
        the app again.
      </>,
    ],
  },
}

/**
 * Installs Collabify as an app: the browser's own prompt where it has one, and
 * the steps for this device where it does not. Hidden inside the installed app.
 */
export function InstallButton({ tone = 'dark', className = '' }: { tone?: 'dark' | 'light'; className?: string }) {
  const { route, install } = useInstall()
  const dialog = useRef<HTMLDialogElement>(null)
  const [shown, setShown] = useState<keyof typeof STEPS | null>(null)
  const [copied, setCopied] = useState(false)

  if (route === 'installed') return null

  const open = async () => {
    if (route === 'prompt') {
      const result = await install()
      if (result !== null) return
    }
    // No prompt after all: the steps this device would get without one.
    const fallback =
      route === 'prompt'
        ? installRoute(navigator.userAgent, { standalone: false, hasPrompt: false, touchPoints: navigator.maxTouchPoints })
        : route
    setShown(fallback === 'installed' || fallback === 'prompt' ? 'unsupported' : fallback)
    setCopied(false)
    dialog.current?.showModal()
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SITE)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const look =
    tone === 'dark'
      ? 'border-amber-50/25 text-amber-50 hover:border-amber-50/50 hover:bg-amber-50/10'
      : 'border-navy-950/25 text-navy-950 hover:border-navy-950/50 hover:bg-navy-950/5'
  const help = shown ? STEPS[shown] : null

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={`inline-flex items-center gap-2.5 rounded-xl border px-5 py-3.5 text-[14px] font-semibold transition-[background-color,border-color,transform] duration-200 active:scale-[0.98] ${look} ${className}`}
      >
        <Icon name="download" size={17} />
        Download the app
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="install-title"
        onClose={() => setShown(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close()
        }}
        className="m-auto w-[min(440px,calc(100vw/var(--zoom,1)-32px))] rounded-[22px] bg-white p-0 text-navy-950 shadow-[0_30px_80px_-30px_rgb(8_11_33_/_0.7)] backdrop:bg-navy-950/60"
      >
        {help && (
          <div className="p-6 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <img src="/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
                <h2 id="install-title" className="font-display text-[19px] leading-tight font-bold tracking-[-0.02em]">
                  {help.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                aria-label="Close"
                className="-mt-1 -mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-navy-900/60 transition-colors hover:bg-navy-950/5 hover:text-navy-950"
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            <ol className="mt-6 space-y-4">
              {help.steps.map((step, i) => (
                <li key={i} className="grid grid-cols-[28px_1fr] gap-3 text-[14.5px] leading-relaxed text-navy-900/80">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-amber-400 font-mono text-[12px] font-bold text-navy-950">
                    {i + 1}
                  </span>
                  <span className="pt-0.5 [&_b]:font-semibold [&_b]:text-navy-950">{step}</span>
                </li>
              ))}
            </ol>

            {help.note && <p className="mt-5 text-[13px] leading-relaxed text-navy-900/60">{help.note}</p>}

            {(shown === 'in-app' || shown === 'unsupported') && (
              <button
                type="button"
                onClick={copy}
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 py-3.5 text-[14px] font-semibold text-amber-50 transition-colors hover:bg-navy-800"
              >
                <Icon name={copied ? 'check' : 'copy'} size={16} />
                {copied ? 'Link copied' : 'Copy the link'}
              </button>
            )}
          </div>
        )}
      </dialog>
    </>
  )
}
