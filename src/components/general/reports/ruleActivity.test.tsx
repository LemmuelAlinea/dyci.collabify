import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReportData } from '../../../hooks/useGeneralReport'
import type { ActivityRow, ScopeRow } from '../../../lib/api/generalReports'
import { sectionCsv } from './csv'
import { Activity } from './ReportSections'

const row = (over: Partial<ActivityRow>): ActivityRow => ({
  at: '2026-11-01T01:00:00Z', id: 'x', project_id: 'p1', actor_id: null, actor_name: null, subject_id: null,
  subject_name: null, kind: 'rule_applied', task_id: 't1', task_title: 'Login', detail: {}, total: 3, ...over,
})

// A rule moved "Login" (its own row and the history row with no actor) while
// another rule only sent a notice.
const rows = [
  row({ id: 'u1', kind: 'updated', detail: { fields: ['status'], status: 'in_progress' } }),
  row({ id: 'r1', detail: { rule_id: 'a', rule_name: 'Start it', action: 'move_stage', stage: 'Doing', stage_from: 'To do' } }),
  row({ id: 'r2', at: '2026-11-01T00:00:00Z', detail: { rule_id: 'b', rule_name: 'Tell QA', action: 'notify', notify_to: 'qa' } }),
]

describe('rule changes in a report', () => {
  it('reads as the rule in the timeline, with no Somebody line', () => {
    const html = renderToStaticMarkup(
      createElement(Activity, { rows, total: 3, groupBy: 'project', projectName: () => 'Portal' }),
    )
    expect(html).toContain('Moved &quot;Login&quot; from To do to Doing by the rule “Start it”')
    expect(html).toContain('Notified QA about &quot;Login&quot; by the rule “Tell QA”')
    expect(html).not.toContain('Somebody')
  })

  it('reads as the rule in the CSV, one line per change', () => {
    const projects = [{ project_id: 'p1', name: 'Portal' }] as ScopeRow[]
    const csv = sectionCsv('activity', { activity: rows } as unknown as ReportData, projects) ?? ''
    const lines = csv.split('\r\n').slice(1)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Portal,A rule,"Moved ""Login"" from To do to Doing by the rule “Start it”",Login')
    expect(lines[1]).toContain('Notified QA about ""Login"" by the rule “Tell QA”')
  })
})
