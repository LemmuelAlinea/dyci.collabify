import { Link } from "react-router-dom";
import { Icon } from "../ui/Icon";
import { weekRange } from "../../lib/types";
import type { ClassSummary, ClassWeek } from "../../lib/types";

/** Where each class is in its syllabus right now, and what the week expects. */
export function TermStrip({
  weeks,
  classes,
  linkBase,
  hrefFor,
  onClose,
  flat = false,
}: {
  weeks: ClassWeek[];
  classes: ClassSummary[];
  linkBase: string;
  hrefFor?: (classId: string) => string;
  /** A close button in each card's corner, for a page that lets the strip fold away. */
  onClose?: () => void;
  /** Rows with an amber edge instead of cards, for inside a bento tile. */
  flat?: boolean;
}) {
  if (weeks.length === 0) return null;

  if (flat) {
    return (
      <ul className="-mx-2 space-y-1">
        {weeks.map((w) => {
          const cls = classes.find((c) => c.id === w.class_id);
          return (
            <li key={w.week_id}>
              <Link
                to={hrefFor ? hrefFor(w.class_id) : `${linkBase}/${w.class_id}`}
                className="block rounded-lg border-l-2 border-amber-400 px-3 py-2 transition-colors hover:bg-[var(--surface-sunken)]"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-[14px] font-semibold text-ink">
                    {cls ? cls.initial : "Class"} · Week {w.week_no}
                  </span>
                  <span className="font-mono text-[11px] text-faint">{weekRange(w)}</span>
                </span>
                {w.title && (
                  <span className="mt-0.5 block truncate text-[13px] text-ink">{w.title}</span>
                )}
                {w.assessments && (
                  <span className="mt-1 flex gap-1.5 text-[12px] text-warning-700 dark:text-warning-300">
                    <Icon name="checkCircle" size={13} className="mt-0.5 shrink-0" />
                    <span className="line-clamp-1">{w.assessments}</span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {weeks.map((w) => {
        const cls = classes.find((c) => c.id === w.class_id);
        return (
          <div key={w.week_id} className="relative">
            <Link
              to={hrefFor ? hrefFor(w.class_id) : `${linkBase}/${w.class_id}`}
              className="surface block h-full rounded-card border border-amber-400 bg-amber-400/8 p-4 transition-colors hover:border-amber-500"
            >
              <div
                className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 ${onClose ? "pr-8" : ""}`}
              >
                <p className="text-[14px] font-semibold text-ink">
                  {cls ? cls.initial : "Class"} · Week {w.week_no}
                </p>
                <p className="font-mono text-[12px] text-faint">
                  {weekRange(w)}
                </p>
              </div>
              {w.title && (
                <p className="mt-1 text-[13px] text-ink">{w.title}</p>
              )}
              {w.topics && (
                <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted">
                  {w.topics}
                </p>
              )}
              {w.assessments && (
                <p className="mt-2 flex gap-2 text-[12px] leading-relaxed text-warning-700 dark:text-warning-300">
                  <Icon
                    name="checkCircle"
                    size={13}
                    className="mt-0.5 shrink-0"
                  />
                  {w.assessments}
                </p>
              )}
            </Link>
            {onClose && (
              <button
                type="button"
                aria-label="Close this week"
                title="Close"
                onClick={onClose}
                className="absolute top-2.5 right-2.5 grid h-7 w-7 place-items-center rounded-lg text-faint transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
              >
                <Icon name="x" size={15} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
