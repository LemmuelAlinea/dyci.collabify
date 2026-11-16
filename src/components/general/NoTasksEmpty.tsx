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
 * Drawn like the banner in small (No active sprint's flag): the person's banner
 * colour as the fill, its glyph colour, held to 3:1 on it, for every line.
 */
function ChecklistArt() {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-banner-tile-glyph"
    >
      <g stroke="currentColor" strokeWidth={2}>
        <rect x={22} y={18} width={62} height={82} rx={9} strokeOpacity={0.6} className="fill-banner-tile" />
        <rect x={40} y={12} width={26} height={12} rx={4} strokeOpacity={0.6} className="fill-banner-tile" />
        <rect x={32} y={57} width={10} height={10} rx={2.5} strokeOpacity={0.5} />
        <rect x={32} y={77} width={10} height={10} rx={2.5} strokeOpacity={0.5} />
        <path d="M51 62h22M51 82h16" strokeOpacity={0.4} />
      </g>
      <g stroke="currentColor" strokeWidth={2.5}>
        <path d="M32 42l4 4 7-8" />
        <path d="M51 42h24" />
        <circle cx={86} cy={92} r={19} strokeWidth={1.5} strokeOpacity={0.3} className="fill-banner-tile" />
        <circle cx={86} cy={92} r={14.5} strokeOpacity={0.8} />
        <path d="M80 92l4.5 4.5 8-9" />
      </g>
    </svg>
  )
}
