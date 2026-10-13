import { describe, expect, it } from 'vitest'
import { docCsvFiles, docToHtml, docToWorkbook, reportBase, sheetName } from './export'
import type { ReportDoc } from './doc'

const doc: ReportDoc = {
  header: { title: 'Individual grading sheet', subtitle: 'Lab 6', classLine: 'QM · BSIT 3A', rangeLabel: null, madeAt: 'October 13, 2026' },
  blocks: [
    { kind: 'kpis', items: [{ label: 'Students', value: 3 }, { label: 'Average final', value: 84.5 }] },
    {
      kind: 'table', id: 'grades', title: 'Grades',
      columns: [
        { key: 's', label: 'Student', type: 'text' },
        { key: 'f', label: 'Final', type: 'score', outOf: 100 },
        { key: 'st', label: 'Status', type: 'status' },
      ],
      rows: [
        ['=SUM(A1)', 84.5, { value: 'Not released', tone: 'warning' }],
        ['Ana Cruz', null, { value: 'Not confirmed', tone: 'pending' }],
      ],
    },
    { kind: 'chart', id: 'spread', title: 'Spread', chart: { kind: 'bars', rows: [{ label: '80–89%', value: 1 }], max: 1 }, summary: 'Most finals fall in 80–89%.' },
    { kind: 'table', id: 'rubric', title: 'Grades', columns: [{ key: 'c', label: 'Criterion', type: 'text' }], rows: [['Function']] },
  ],
  footer: { lines: ['Scores tagged Not released are not yet visible to students.'], signatures: [{ role: 'Prepared by', name: 'Prof. Reyes' }] },
}

describe('sheetName', () => {
  it('keeps names unique and within 31 characters', () => {
    const used = new Set<string>()
    const a = sheetName('A very long table title that goes past thirty-one', used)
    const b = sheetName('A very long table title that goes past thirty-one', used)
    expect(a.length).toBeLessThanOrEqual(31)
    expect(b.length).toBeLessThanOrEqual(31)
    expect(a).not.toBe(b)
    expect(b.endsWith('(2)')).toBe(true)
  })
  it('drops characters Excel refuses', () => {
    expect(sheetName('Grades: [Lab 6]/final?', new Set())).not.toMatch(/[[\]:*?/\\]/)
  })
})

describe('docToWorkbook', () => {
  const wb = docToWorkbook(doc)
  it('has a cover sheet and one sheet per table, uniquely named', () => {
    expect(wb.sheets).toHaveLength(3)
    expect(wb.sheets[0].name).toBe('Report')
    expect(new Set(wb.sheets.map((s) => s.name)).size).toBe(3)
  })
  it('writes headers, numbers as numeric text, and never a formula', () => {
    const grades = wb.sheets[1]
    expect(grades.rows[0]).toEqual(['Student', 'Final (of 100)', 'Status'])
    expect(grades.rows[1][1]).toBe('84.5')
    expect(grades.rows[1][0].startsWith('=')).toBe(false)
    expect(grades.rows[2][1]).toBe('')
  })
  it('puts the header, KPIs and footer on the cover', () => {
    const flat = wb.sheets[0].rows.flat()
    expect(flat).toContain('Individual grading sheet')
    expect(flat).toContain('Average final')
    expect(flat).toContain('84.5')
    expect(flat).toContain('Scores tagged Not released are not yet visible to students.')
  })
})

describe('docToHtml', () => {
  const html = docToHtml(doc)
  it('has one table per table block, plus one for the key figures', () => {
    expect(html.match(/<table>/g)).toHaveLength(3)
  })
  it('replaces the chart with its summary sentence', () => {
    expect(html).toContain('Most finals fall in 80–89%.')
    expect(html).not.toContain('<svg')
  })
  it('escapes text', () => {
    expect(docToHtml({ ...doc, header: { ...doc.header, subtitle: '<b>x</b>' } })).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})

describe('docCsvFiles', () => {
  it('writes one file per table, named after it', () => {
    const files = docCsvFiles(doc, 'grading-lab-6-2026-10-13')
    expect(files.map((f) => f.name)).toEqual(['grading-lab-6-2026-10-13-grades.csv', 'grading-lab-6-2026-10-13-grades-2.csv'])
    expect(files[0].csv).toContain('Final (of 100)')
  })
})

describe('reportBase', () => {
  it('drops the csv extension from the shared filename helper', () => {
    expect(reportBase('grading', 'Lab 6')).toMatch(/^grading-lab-6-\d{4}-\d{2}-\d{2}$/)
  })
})
