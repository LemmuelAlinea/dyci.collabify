/**
 * My tasks on the work Home when nothing is assigned: a checklist drawing with a
 * done badge, a heading and one line. It fills the tile it sits in (`.empty-art`
 * in index.css): large and centred in the tall desktop tile, a small row in the
 * short two-column one.
 */
export function NoTasksEmpty({ body }: { body: string }) {
  return (
    <div data-empty="art" className="empty-art">
      <div className="empty-art-body">
        <div className="empty-art-figure">
          <ChecklistArt />
        </div>
        <div className="min-w-0">
          <p className="empty-art-title font-display font-semibold leading-tight text-ink">No open tasks</p>
          <p className="mt-1 text-[13px] leading-snug text-muted sm:text-[14px]">{body}</p>
        </div>
      </div>
    </div>
  )
}

/**
 * A clipboard: the first row checked, two still open, a done badge on its corner.
 * Outlines only, so the card shows through. The frame and open rows are muted;
 * the check, the first line and the badge ring take `banner-end`, the person's
 * banner accent held to 3:1 on the app's grounds (a darker step in light mode).
 * The badge is a thin ring with a faint tint; its middle is the card's own
 * colour so the clipboard's corner does not show through it.
 */
function ChecklistArt() {
  return (
    <svg viewBox="0 0 120 120" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g className="text-faint" stroke="currentColor" strokeWidth={2}>
        {/* The top edge stops at the clip, which has no fill of its own. */}
        <path
          d="M40 18h-9a9 9 0 0 0-9 9v64a9 9 0 0 0 9 9h44a9 9 0 0 0 9-9V27a9 9 0 0 0-9-9h-9"
          strokeOpacity={0.75}
        />
        <rect x={40} y={12} width={26} height={12} rx={4} strokeOpacity={0.75} />
        <rect x={32} y={57} width={10} height={10} rx={2.5} strokeOpacity={0.6} />
        <rect x={32} y={77} width={10} height={10} rx={2.5} strokeOpacity={0.6} />
        <path d="M51 62h22M51 82h16" strokeOpacity={0.45} />
      </g>
      <g className="text-banner-end" stroke="currentColor" strokeWidth={2.5}>
        <path d="M32 42l4 4 7-8" />
        <path d="M51 42h24" />
        <circle cx={86} cy={92} r={16} className="fill-[var(--surface)]" />
        <circle cx={86} cy={92} r={16} fill="currentColor" fillOpacity={0.1} />
        <path d="M79 92l5 5 9-10" />
      </g>
    </svg>
  )
}
