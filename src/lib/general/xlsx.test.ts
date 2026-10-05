import { describe, expect, it } from 'vitest'
import { workbookToXlsx, xlsxToWorkbook } from './office'
import { serializeWorkbook } from './sheet'
import type { Workbook } from './sheet'

describe('Excel files out and back in', () => {
  it('keeps formulas, fonts, fills, alignment, number formats, borders, widths, merges and frozen panes', async () => {
    const book: Workbook = {
      sheets: [
        {
          name: 'Budget',
          rows: [['Item', ''], ['Paper', '120.5'], ['Total', '=SUM(B2:B2)']],
          styles: {
            '0:0': { bold: true, fill: '#ffff00', align: 'center', font: 'Arial', size: 14, color: '#c00000' },
            '1:1': { format: '#,##0.00', italic: true, valign: 'top', wrap: true },
          },
          cols: { '0': 152 },
          heights: { '0': 32 },
          merges: [{ r: 0, c: 0, rs: 1, cs: 2 }],
          freeze: { rows: 1, cols: 0 },
          borders: [{ r: 2, c: 1, top: { style: 'double', color: '#000000' }, bottom: { style: 'thin', color: '#0070c0' } }],
        },
      ],
    }
    const blob = await workbookToXlsx(book)
    const back = await xlsxToWorkbook(new File([await blob.arrayBuffer()], 'Budget.xlsx'))
    expect(serializeWorkbook(back)).toBe(serializeWorkbook(book))
  })
})
