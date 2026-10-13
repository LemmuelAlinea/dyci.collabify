import { PEER_FLAG_META, analyseTeam } from '../peerMath'
import type { PeerFlag } from '../peerMath'
import { PEER_DIMENSIONS } from '../peerDimensions'
import type { PeerComment, PeerResult, PeerRoundStatus } from '../types'
import type { Block, Cell, Column, ReportDoc } from './doc'
import type { ReportHead } from './grading'

const KIND = { check_in: 'Check-in', final: 'Final' } as const
const DAY = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' })

/** The closed final round if there is one, otherwise the latest. */
export function defaultRound(rounds: PeerRoundStatus[]): PeerRoundStatus | null {
  if (rounds.length === 0) return null
  const latest = [...rounds].sort((a, b) => b.opens_at.localeCompare(a.opens_at))
  return latest.find((r) => r.kind === 'final') ?? latest[0]
}

const num = (v: number | null) => (v === null ? null : Number(v))

export function peerSummaryDoc(input: ReportHead & {
  projectTitle: string
  round: PeerRoundStatus
  results: PeerResult[]
  comments: PeerComment[] | null
}): ReportDoc {
  const { round, results } = input
  const boards = [...new Set(results.map((r) => r.board_id))]
  const analysed = boards.flatMap((b) => analyseTeam(results.filter((r) => r.board_id === b)))
  const flagCount = new Map<PeerFlag, number>()
  for (const m of analysed) for (const f of m.flags) flagCount.set(f, (flagCount.get(f) ?? 0) + 1)

  const blocks: Block[] = [
    {
      kind: 'kpis',
      items: [
        { label: 'Answered', value: `${round.answered} of ${round.expected}` },
        {
          label: 'Response rate',
          value: round.expected > 0 ? `${((round.answered / round.expected) * 100).toFixed(1)}%` : '—',
        },
        ...[...flagCount].map(([f, n]) => ({ label: PEER_FLAG_META[f].label, value: n })),
      ],
    },
  ]

  if (results.length === 0) {
    blocks.push({ kind: 'note', tone: 'info', text: 'Nobody has rated anyone in this round yet.' })
  } else {
    const dims = PEER_DIMENSIONS.map((d) => {
      const xs = results.map((r) => num((r as unknown as Record<string, number | null>)[`${d.key}_avg`])).filter((v): v is number => v !== null)
      return { label: d.label, value: xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : 0 }
    })
    blocks.push({
      kind: 'chart',
      id: 'dimensions',
      title: 'Class averages on the five behaviours (out of 5)',
      chart: { kind: 'bars', rows: dims, max: 5 },
      summary: `Across the class: ${dims.map((d) => `${d.label} ${d.value}`).join('; ')}.`,
    })

    const columns: Column[] = [
      { key: 'member', label: 'Member', type: 'text' },
      { key: 'received', label: 'From teammates', type: 'number' },
      { key: 'self', label: 'Self', type: 'number' },
      { key: 'factor', label: 'Factor', type: 'number' },
      { key: 'raters', label: 'Raters', type: 'number' },
      { key: 'flags', label: 'Flags', type: 'text' },
      ...PEER_DIMENSIONS.map<Column>((d) => ({ key: d.key, label: d.label, type: 'number' })),
    ]
    const groups = boards
      .map((b) => ({ b, name: results.find((r) => r.board_id === b)?.group_name ?? 'Group' }))
      .sort((x, y) => x.name.localeCompare(y.name))
    for (const { b, name } of groups) {
      const team = analysed.filter((m) => m.board_id === b).sort((x, y) => x.student_name.localeCompare(y.student_name))
      blocks.push({
        kind: 'table',
        id: `group-${b}`,
        title: name,
        columns,
        rows: team.map<Cell[]>((m) => [
          m.student_name,
          num(m.received_avg),
          num(m.self_avg),
          m.factor,
          m.raters,
          m.flags.map((f) => PEER_FLAG_META[f].label).join('; ') || null,
          ...PEER_DIMENSIONS.map((d) => num((m as unknown as Record<string, number | null>)[`${d.key}_avg`])),
        ]),
      })
    }
  }

  if (input.comments) {
    const groupOf = new Map(results.map((r) => [r.board_id, r.group_name ?? 'Group']))
    blocks.push({
      kind: 'table',
      id: 'comments',
      title: 'Comments',
      columns: [
        { key: 'about', label: 'About', type: 'text' },
        { key: 'group', label: 'Group', type: 'text' },
        { key: 'comment', label: 'Comment', type: 'text' },
      ],
      rows: input.comments.map((c) => [c.ratee_name, groupOf.get(c.board_id) ?? null, c.comment]),
      note: 'Who wrote each comment is left out on purpose.',
    })
  }

  return {
    header: {
      title: 'Peer evaluation summary',
      subtitle: `${input.projectTitle} · ${KIND[round.kind]} round`,
      classLine: input.classLine,
      rangeLabel: `${DAY.format(new Date(round.opens_at))} to ${DAY.format(new Date(round.closed_at ?? round.closes_at))}`,
      madeAt: input.madeAt,
      ...(input.comments ? { confidential: 'Contains confidential peer comments' } : {}),
    },
    blocks,
    footer: {
      lines: ['Teammates never see who gave which rating. A flag is a prompt for a conversation, not a grade.'],
      signatures: [{ role: 'Prepared by', name: input.professor }],
    },
  }
}
