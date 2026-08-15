import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** Seconds. Stagger siblings by passing 0, 0.06, 0.12 … */
  delay?: number
  y?: number
  className?: string
  as?: 'div' | 'section' | 'li' | 'article' | 'span'
  /** Re-hide when scrolled back out, so the motion is reversible. */
  once?: boolean
}

export function Reveal({
  children,
  delay = 0,
  y = 22,
  className = '',
  as: Tag = 'div',
  once = false,
}: Props) {
  const ref = useRef<HTMLElement | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          if (once) io.disconnect()
        } else if (!once) {
          setShown(false)
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [once])

  return (
    <Tag
      ref={ref as never}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : `translate3d(0, ${y}px, 0)`,
        transition: `opacity .7s var(--ease-out-soft) ${delay}s, transform .7s var(--ease-out-soft) ${delay}s`,
        willChange: 'opacity, transform',
      }}
    >
      {children}
    </Tag>
  )
}
