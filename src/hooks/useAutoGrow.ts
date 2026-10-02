import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

/**
 * A text box that grows with what is written in it, up to `max` pixels, then
 * scrolls. No resize handle: the content decides the height.
 */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, max = 160) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [ref, value, max])
}
