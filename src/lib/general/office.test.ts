import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { xlsxToWorkbook } from './office'

describe('xlsxToWorkbook', () => {
  it('reads an Excel workbook into editable cells', async () => {
    const book = new ExcelJS.Workbook()
    const sheet = book.addWorksheet('Budget')
    sheet.getCell('A1').value = 'Item'
    sheet.getCell('B1').value = 'Cost'
    sheet.getCell('A2').value = 'Tarpaulin'
    sheet.getCell('B2').value = 1500
    sheet.getCell('B3').value = { formula: 'B2*2' }

    const buffer = await book.xlsx.writeBuffer()
    const file = new File([buffer], 'budget.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    expect(await xlsxToWorkbook(file)).toEqual({
      sheets: [
        {
          name: 'Budget',
          rows: [['Item', 'Cost'], ['Tarpaulin', '1500'], ['', '=B2*2']],
        },
      ],
    })
  })

  it('reads CSV into editable cells', async () => {
    const file = new File(['Item,Cost\n"Tarpaulin, large",1500'], 'budget.csv', {
      type: 'text/csv',
    })

    expect(await xlsxToWorkbook(file)).toEqual({
      sheets: [
        {
          name: 'budget',
          rows: [['Item', 'Cost'], ['Tarpaulin, large', '1500']],
        },
      ],
    })
  })
})
