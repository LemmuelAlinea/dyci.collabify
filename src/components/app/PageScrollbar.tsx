import { useEffect, useRef } from 'react'

export function PageScrollbar() {
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const track = bar.current!
    const thumb = track.firstElementChild as HTMLElement
    const page = document.documentElement

    const update = () => {
      const viewport = page.clientHeight
      const maxScroll = page.scrollHeight - viewport
      track.style.display = maxScroll > 1 ? 'block' : 'none'
      if (maxScroll <= 1) return

      const height = Math.max(40, viewport * viewport / page.scrollHeight)
      thumb.style.height = `${height}px`
      thumb.style.transform = `translateY(${(viewport - height) * page.scrollTop / maxScroll}px)`
    }

    const observer = new ResizeObserver(update)
    observer.observe(document.body)
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    update()
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  const scrollFromPointer = (clientY: number, offset: number) => {
    const track = bar.current!
    const thumb = track.firstElementChild as HTMLElement
    const maxTrack = track.clientHeight - thumb.offsetHeight
    if (maxTrack <= 0) return
    const fraction = Math.max(0, Math.min(1, (clientY - offset) / maxTrack))
    window.scrollTo({ top: fraction * (document.documentElement.scrollHeight - window.innerHeight), behavior: 'instant' })
  }

  return (
    <div
      ref={bar}
      className="page-scrollbar"
      aria-hidden="true"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const thumb = event.currentTarget.firstElementChild as HTMLElement
        const offset = event.target === thumb
          ? event.clientY - thumb.getBoundingClientRect().top
          : thumb.offsetHeight / 2
        event.currentTarget.setPointerCapture(event.pointerId)
        scrollFromPointer(event.clientY - event.currentTarget.getBoundingClientRect().top, offset)
        event.currentTarget.dataset.dragOffset = String(offset)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        scrollFromPointer(
          event.clientY - event.currentTarget.getBoundingClientRect().top,
          Number(event.currentTarget.dataset.dragOffset),
        )
      }}
    >
      <div className="page-scrollbar-thumb" />
    </div>
  )
}
