import { Fragment, useState } from 'react'
import { TONE_CELL } from '../charts/format'
import { PEER_DIMENSIONS } from '../../lib/peerDimensions'
import { PEER_FLAG_META, analyseTeam } from '../../lib/peerMath'
import type { PeerResult } from '../../lib/types'

const fmt = (v: number | null, places = 1) => (v === null ? '—' : Number(v).toFixed(places))

/** One group in one round. The factor appears only with enough raters to mean something. */
export function PeerResultsTable({ rows, label }: { rows: PeerResult[]; label: string }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const team = analyseTeam(rows).sort((a, b) => (a.factor ?? 9) - (b.factor ?? 9))

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13px]">
        <caption className="sr-only">How teammates rated each other: {label}</caption>
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-faint">
            <th scope="col" className="px-2 py-2 font-medium">Member</th>
            <th scope="col" className="px-2 py-2 font-medium">From teammates</th>
            <th scope="col" className="px-2 py-2 font-medium">Self</th>
            <th scope="col" className="px-2 py-2 font-medium">Factor</th>
            <th scope="col" className="px-2 py-2 font-medium">Raters</th>
            <th scope="col" className="px-2 py-2 font-medium">Flags</th>
          </tr>
        </thead>
        <tbody>
          {team.map((m) => (
            <Fragment key={m.student_id}>
              <tr className="border-b border-line last:border-0">
                <th scope="row" className="px-2 py-2 text-left font-normal">
                  <button
                    type="button"
                    aria-expanded={openId === m.student_id}
                    onClick={() => setOpenId((v) => (v === m.student_id ? null : m.student_id))}
                    className="text-ink hover:underline"
                  >
                    {m.student_name}
                  </button>
                </th>
                <td className="px-2 py-2 font-mono text-muted">{fmt(m.received_avg)}</td>
                <td className="px-2 py-2 font-mono text-muted">{fmt(m.self_avg)}</td>
                <td className="px-2 py-2 font-mono text-ink">{m.factor === null ? '—' : m.factor.toFixed(2)}</td>
                <td className="px-2 py-2 font-mono text-muted">{m.raters}</td>
                <td className="px-2 py-2">
                  <span className="flex flex-wrap gap-1">
                    {m.flags.map((f) => (
                      <span key={f} className={`rounded-md px-1.5 py-0.5 text-[11px] ${TONE_CELL[PEER_FLAG_META[f].tone]}`}>
                        {PEER_FLAG_META[f].label}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
              {openId === m.student_id && (
                <tr className="border-b border-line">
                  <td colSpan={6} className="px-2 pb-3">
                    <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                      {PEER_DIMENSIONS.map((d) => (
                        <div key={d.key} className="flex justify-between gap-3 text-[12px]">
                          <dt className="text-muted">{d.label}</dt>
                          <dd className="font-mono text-ink">{fmt(m[`${d.key}_avg`], 2)}</dd>
                        </div>
                      ))}
                    </dl>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
