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
 * The badge is drawn like No active sprint's flag: the person's banner colour as
 * its fill, the glyph colour (3:1 on it) for its lines. The clipboard is outline
 * only, so it sits on the card itself and takes `banner-end`, the same accent
 * held to 3:1 on the app's grounds (a darker step in light mode).
 */
function ChecklistArt() {
  return (
    <svg viewBox="0 0 120 120" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g className="text-banner-end" stroke="currentColor" strokeWidth={2}>
        {/* Outline only, so the card shows through; the top edge stops at the clip. */}
        <path
          d="M40 18h-9a9 9 0 0 0-9 9v64a9 9 0 0 0 9 9h44a9 9 0 0 0 9-9V27a9 9 0 0 0-9-9h-9"
          strokeOpacity={0.6}
        />
        <rect x={40} y={12} width={26} height={12} rx={4} strokeOpacity={0.6} />
        <rect x={32} y={57} width={10} height={10} rx={2.5} strokeOpacity={0.5} />
        <rect x={32} y={77} width={10} height={10} rx={2.5} strokeOpacity={0.5} />
        <path d="M51 62h22M51 82h16" strokeOpacity={0.4} />
        <path d="M32 42l4 4 7-8M51 42h24" strokeWidth={2.5} />
      </g>
      <g className="text-banner-tile-glyph" stroke="currentColor" strokeWidth={2.5}>
        <circle cx={86} cy={92} r={19} strokeWidth={1.5} strokeOpacity={0.3} className="fill-banner-tile" />
        <circle cx={86} cy={92} r={14.5} strokeOpacity={0.8} />
        <path d="M80 92l4.5 4.5 8-9" />
      </g>
    </svg>
  )
}
