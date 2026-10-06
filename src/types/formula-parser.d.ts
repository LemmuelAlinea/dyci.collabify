// The formula engine inside Fortune-sheet. It ships without types; this is the part sheetCalc.ts uses.
declare module '@fortune-sheet/formula-parser' {
  type Coord = { index: number; isAbsolute?: boolean; label?: string }
  type CellCoord = { label: string; row: Coord; column: Coord; sheetName?: string | null }
  type Value = string | number | boolean | null | undefined | Date | unknown[]

  export class Parser {
    parse(formula: string, options?: Record<string, unknown>): { error: string | null; result: Value }
    on(event: 'callCellValue', handler: (cell: CellCoord, options: unknown, done: (value: Value) => void) => void): void
    on(
      event: 'callRangeValue',
      handler: (start: CellCoord, end: CellCoord, options: unknown, done: (values: Value[][]) => void) => void,
    ): void
  }
}
