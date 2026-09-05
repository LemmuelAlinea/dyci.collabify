import { Link } from 'react-router-dom'
import { Icon } from '../ui/Icon'
import type { ClassUnmeasured } from '../../lib/types'

/**
 * The classes this page cannot say anything about, and why.
 *
 * A pace needs a term to divide by and a syllabus to count against. Without
 * either, the class was simply absent — a professor with two classes read one,
 * and nothing on the page distinguished "this class is fine" from "this class
 * is not being measured". Saying what is missing, and linking to where it is
 * set, is the whole of it.
 */
export function UnmeasuredList({ rows }: { rows: ClassUnmeasured[] }) {
  if (rows.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="">Not being measured</h2>
      <p className="max-w-[66ch] text-[13px] text-muted">
        {rows.length === 1 ? 'This class is' : 'These classes are'} left out of every figure
        above. Nothing is wrong with {rows.length === 1 ? 'it' : 'them'} — there is just
        nothing to measure against yet.
      </p>
      <ul className="space-y-1.5">
        {rows.map((c) => (
          <li
            key={c.class_id}
            className="surface flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line px-3.5 py-2.5"
          >
            <span className="shrink-0 rounded-md surface-sunken px-2 py-0.5 font-mono text-[12px] text-muted">
              {c.class_initial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] text-ink">{c.class_name}</span>
              <span className="flex items-center gap-1.5 text-[12px] text-muted">
                <Icon name="alert" size={13} className="shrink-0 text-amber-500" />
                {c.needs_term && c.needs_syllabus
                  ? 'Set this class’s term dates and add its syllabus to measure its pace'
                  : c.needs_term
                    ? 'Set this class’s term dates to measure its pace'
                    : 'Add this class’s syllabus — a pace against nothing means nothing'}
              </span>
            </span>
            <Link
              to={`/professor/classes/${c.class_id}`}
              className="shrink-0 text-[12px] font-medium text-navy-600 hover:underline dark:text-navy-200"
            >
              Open the class
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
