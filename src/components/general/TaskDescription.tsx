import { useLayoutEffect, useRef, useState } from 'react'
import { Field } from '../ui/Field'
import { Textarea } from '../ui/Select'
import { LIMIT } from '../../lib/limits'

export function TaskDescription({ value, onChange, disabled }: {
  value: string
  onChange?: (value: string) => void
  disabled: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)

  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const measure = () => {
      box.style.height = ''
      const needsMore = box.scrollHeight > box.clientHeight + 1
      setOverflows(needsMore)
      if (expanded && needsMore) box.style.height = `${box.scrollHeight + 2}px`
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [value, expanded])

  return (
    <div>
      <Field label="Description" optional={!disabled}>
        {(id) => <Textarea
          ref={ref}
          id={id}
          rows={6}
          maxLength={LIMIT.generalDescription}
          value={value}
          disabled={disabled}
          placeholder={disabled ? 'No description.' : 'Add a description'}
          onChange={(event) => onChange?.(event.target.value)}
          className="!resize-none overflow-y-auto"
        />}
      </Field>
      {overflows && <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        className="mt-2 text-[13px] font-medium text-navy-600 hover:underline dark:text-navy-300"
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>}
    </div>
  )
}
